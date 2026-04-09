---
title: "PDTF 2.0 — Implementation: DID Infrastructure"
description: "PDTF 2.0 specification document."
---


**Version:** 0.1 (Draft)
**Date:** 24 March 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Implements:** [Sub-spec 03 — DID Methods & Identifiers](../../03-did-methods/)

---

## 1. Overview

This document specifies the technical implementation of DID infrastructure for Moverly's PDTF 2.0 backend. It covers how we create, host, resolve, cache, and lifecycle-manage DID documents for all entity types.

**Relationship to other impl specs:**

- Key-manager impl (06) already defines: `did:key` derivation, `did:web` document construction, adapter DID document serving via Cloud Functions, KMS integration. This spec does **not** duplicate that.
- This spec covers: **transaction DID lifecycle**, **organisation onboarding**, **DID resolver service**, **URN validation**, **the `@pdtf/did-tools` CLI**, and **Firestore schema for DID metadata**.

**What this covers:**

- Transaction DID document lifecycle (create → serve → deactivate → archive)
- Organisation DID onboarding (key generation, document template, hosting verification)
- `@pdtf/did-resolver` package — universal resolver with caching
- `@pdtf/did-tools` CLI — organisation onboarding tool
- URN validation and registry
- Firestore schema for DID metadata
- DID document hosting infrastructure (transactions, platform)
- Monitoring and operational procedures

**What this does NOT cover:**

- Key generation/storage/rotation in KMS (see impl/06-key-management-impl.md)
- Adapter DID document serving (see impl/06-key-management-impl.md §5)
- VC signing/verification (see impl/06-key-management-impl.md §3.6–3.7)
- Status list infrastructure (see impl/14-credential-revocation-impl.md)

---

## 2. Transaction DID Lifecycle

Transactions are the most dynamic DID entities. Each transaction gets a `did:web` identifier with service endpoints for the PDTF API and MCP server. The DID document is created when the transaction starts and deactivated when it completes.

### 2.1 Firestore Schema

```
firestore/
├── transactionDids/
│   └── {transactionId}                    # One doc per transaction
│       ├── transactionId: string           # e.g. "abc123"
│       ├── did: string                     # "did:web:moverly.com:transactions:abc123"
│       ├── kmsKeyPath: string              # Reference to key in pdtf-platform-prod
│       ├── activeKeyVersion: number
│       ├── keyVersions: array              # Key version metadata (same as pdtfKeys)
│       ├── status: string                  # "active" | "deactivated" | "archived"
│       ├── propertyUrns: string[]          # ["urn:pdtf:uprn:100023456789"]
│       ├── titleUrns: string[]             # ["urn:pdtf:titleNumber:DN123456"]
│       ├── createdAt: timestamp
│       ├── deactivatedAt: timestamp | null
│       └── archivedAt: timestamp | null
```

### 2.2 Transaction DID Creation

When a new transaction is created in the platform:

```typescript
// services/transaction/src/create-transaction-did.ts

import { KmsClient } from '@pdtf/key-manager';
import { constructDidWebDocument } from '@pdtf/key-manager';
import { Firestore, FieldValue } from 'firebase-admin/firestore';

interface CreateTransactionDidParams {
  transactionId: string;
  propertyUrns: string[];
  titleUrns: string[];
}

export async function createTransactionDid(
  params: CreateTransactionDidParams,
  db: Firestore,
  kms: KmsClient,
): Promise<{ did: string }> {
  const { transactionId, propertyUrns, titleUrns } = params;
  const did = `did:web:moverly.com:transactions:${transactionId}`;

  // 1. Create a dedicated signing key for this transaction
  // Transaction keys go in the platform project (not adapters or users)
  const { keyPath, versionPath } = await kms.createKey({
    project: 'pdtf-platform-prod',
    location: 'europe-west2',
    keyRingId: 'transaction-keys',
    keyId: `txn-${transactionId}-key`,
    protectionLevel: 'SOFTWARE', // Transactions use SW — volume is high
    labels: {
      pdtf_key_category: 'transaction',
      transaction_id: transactionId,
    },
  });

  // 2. Get public key
  const { raw, multibase } = await kms.getPublicKey(versionPath);

  // 3. Store metadata
  await db.collection('transactionDids').doc(transactionId).set({
    transactionId,
    did,
    kmsKeyPath: keyPath,
    activeKeyVersion: 1,
    keyVersions: [{
      version: 1,
      publicKeyMultibase: multibase,
      publicKeyHex: Buffer.from(raw).toString('hex'),
      createdAt: FieldValue.serverTimestamp(),
      isPrimary: true,
      disabled: false,
    }],
    status: 'active',
    propertyUrns,
    titleUrns,
    createdAt: FieldValue.serverTimestamp(),
    deactivatedAt: null,
    archivedAt: null,
  });

  // 4. Generate and upload the DID document to GCS
  await publishTransactionDidDocument(transactionId, db);

  return { did };
}
```

### 2.3 Transaction DID Document Serving

Transaction DID documents are static JSON files served from Cloud Storage behind Cloud CDN, at `https://moverly.com/transactions/{id}/did.json`.

```typescript
// services/transaction/src/publish-did-document.ts

import { Storage } from '@google-cloud/storage';
import { constructDidWebDocument } from '@pdtf/key-manager';
import { Firestore } from 'firebase-admin/firestore';

const storage = new Storage();
const BUCKET = 'pdtf-did-documents-prod';

export async function publishTransactionDidDocument(
  transactionId: string,
  db: Firestore,
): Promise<void> {
  const doc = await db.collection('transactionDids').doc(transactionId).get();
  if (!doc.exists) throw new Error(`Transaction DID not found: ${transactionId}`);

  const data = doc.data()!;
  const did = data.did as string;

  // Build DID document
  const didDocument = constructDidWebDocument({
    did,
    versions: data.keyVersions.filter((v: any) => !v.disabled),
    serviceEndpoints: data.status === 'active'
      ? [
          {
            id: `${did}#pdtf-api`,
            type: 'PdtfTransactionEndpoint',
            serviceEndpoint: `https://api.moverly.com/v2/transactions/${transactionId}`,
          },
          {
            id: `${did}#mcp`,
            type: 'McpEndpoint',
            serviceEndpoint: `https://api.moverly.com/mcp/transactions/${transactionId}`,
          },
        ]
      : [], // No service endpoints for deactivated transactions
  });

  // Add controller and alsoKnownAs
  const fullDocument = {
    ...didDocument,
    controller: 'did:web:moverly.com',
    ...(data.propertyUrns?.length ? { alsoKnownAs: data.propertyUrns } : {}),
    ...(data.status === 'deactivated' ? { deactivated: true } : {}),
  };

  // Upload to GCS
  const gcsPath = `transactions/${transactionId}/did.json`;
  const bucket = storage.bucket(BUCKET);
  const file = bucket.file(gcsPath);

  await file.save(JSON.stringify(fullDocument, null, 2), {
    contentType: 'application/did+json',
    metadata: {
      cacheControl: 'public, max-age=3600', // 1 hour for transactions
    },
  });
}
```

### 2.4 Transaction Deactivation

When a transaction completes or is withdrawn:

```typescript
export async function deactivateTransactionDid(
  transactionId: string,
  db: Firestore,
): Promise<void> {
  // 1. Update Firestore
  await db.collection('transactionDids').doc(transactionId).update({
    status: 'deactivated',
    deactivatedAt: FieldValue.serverTimestamp(),
  });

  // 2. Re-publish DID document (now with deactivated: true, no service endpoints)
  await publishTransactionDidDocument(transactionId, db);

  // 3. Disable the signing key (no new credentials can be issued)
  const data = (await db.collection('transactionDids').doc(transactionId).get()).data()!;
  const kms = new KmsClient();
  const versionPath = `${data.kmsKeyPath}/cryptoKeyVersions/${data.activeKeyVersion}`;
  await kms.disableKeyVersion(versionPath);
}
```

### 2.5 Archival

After 7 years (legal retention period), transaction DID documents can be moved to cold storage:

```typescript
// Scheduled Cloud Function — runs monthly
export async function archiveOldTransactionDids(): Promise<void> {
  const sevenYearsAgo = new Date();
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

  const snap = await db
    .collection('transactionDids')
    .where('status', '==', 'deactivated')
    .where('deactivatedAt', '<=', sevenYearsAgo)
    .get();

  for (const doc of snap.docs) {
    // Move GCS object to archive bucket (Coldline storage)
    const transactionId = doc.id;
    const srcPath = `transactions/${transactionId}/did.json`;
    const dstPath = `archive/transactions/${transactionId}/did.json`;

    await storage
      .bucket(BUCKET)
      .file(srcPath)
      .copy(storage.bucket('pdtf-did-documents-archive').file(dstPath));

    // Keep original at the URL (did:web must remain resolvable)
    // but update to serve from archive with longer cache TTL
    await doc.ref.update({
      status: 'archived',
      archivedAt: FieldValue.serverTimestamp(),
    });
  }
}
```

---

## 3. Organisation DID Onboarding

Organisations (conveyancer firms, estate agencies) host their own DID documents at their domains. We provide tooling to make this painless.

### 3.1 Onboarding Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Firm uses    │     │  Firm hosts   │     │  Moverly     │
│  @pdtf/       │────▶│  did.json at  │────▶│  verifies +  │
│  did-tools    │     │  their domain │     │  registers   │
│  CLI          │     │               │     │  in TIR      │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 3.2 `@pdtf/did-tools` CLI

```
packages/did-tools/
├── src/
│   ├── index.ts              # CLI entry point (commander.js)
│   ├── commands/
│   │   ├── org-init.ts       # Generate org DID document
│   │   ├── org-verify.ts     # Verify hosted DID document
│   │   ├── org-rotate.ts     # Add a new key version
│   │   └── urn-validate.ts   # Validate PDTF URNs
│   ├── templates/
│   │   └── org-did-doc.ts    # DID document template builder
│   └── utils/
│       ├── ed25519.ts        # Key generation
│       └── multibase.ts      # Encoding utilities
├── package.json
├── tsconfig.json
└── README.md
```

### 3.3 `org-init` Command

Generates an Ed25519 key pair and a DID document for a firm.

```typescript
// src/commands/org-init.ts

import { Command } from 'commander';
import { ed25519 } from '@noble/curves/ed25519';
import { base58btc } from 'multiformats/bases/base58';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

interface OrgInitOptions {
  domain: string;
  sraNumber?: string;
  companyNumber?: string;
  output: string;
}

export function registerOrgInit(program: Command): void {
  program
    .command('org-init')
    .description('Generate an Organisation DID document and key pair')
    .requiredOption('--domain <domain>', 'Organisation domain (e.g. smithandjones.co.uk)')
    .option('--sra-number <number>', 'SRA registration number')
    .option('--company-number <number>', 'Companies House number')
    .option('--output <dir>', 'Output directory', '.')
    .action(async (opts: OrgInitOptions) => {
      console.log(`\n🔑 Generating DID for did:web:${opts.domain}\n`);

      // 1. Generate Ed25519 key pair
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);

      // 2. Encode public key as multibase
      const multicodecKey = new Uint8Array(2 + publicKey.length);
      multicodecKey.set(ED25519_MULTICODEC);
      multicodecKey.set(publicKey, 2);
      const publicKeyMultibase = base58btc.encode(multicodecKey);

      // 3. Build DID document
      const did = `did:web:${opts.domain}`;
      const didDocument: Record<string, unknown> = {
        '@context': [
          'https://www.w3.org/ns/did/v1',
          'https://w3id.org/security/suites/ed25519-2020/v1',
        ],
        id: did,
        verificationMethod: [
          {
            id: `${did}#key-1`,
            type: 'Ed25519VerificationKey2020',
            controller: did,
            publicKeyMultibase,
          },
        ],
        authentication: [`${did}#key-1`],
        assertionMethod: [`${did}#key-1`],
        service: [],
      };

      // Add regulatory services
      const services = didDocument.service as Array<Record<string, unknown>>;

      if (opts.sraNumber) {
        services.push({
          id: `${did}#sra`,
          type: 'RegulatoryRegistration',
          serviceEndpoint: `https://www.sra.org.uk/solicitors/firm/${opts.sraNumber}`,
          name: 'SRA Registration',
          registrationNumber: opts.sraNumber,
        });
      }

      if (opts.companyNumber) {
        services.push({
          id: `${did}#companies-house`,
          type: 'CompanyRegistration',
          serviceEndpoint: `https://find-and-update.company-information.service.gov.uk/company/${opts.companyNumber}`,
          name: 'Companies House',
          companyNumber: opts.companyNumber,
        });
      }

      services.push({
        id: `${did}#pdtf-contact`,
        type: 'PdtfOrganisationEndpoint',
        serviceEndpoint: `https://${opts.domain}/pdtf`,
        description: 'PDTF credential exchange endpoint',
      });

      // 4. Write files
      const outputDir = opts.output;
      const wellKnownDir = join(outputDir, '.well-known');
      mkdirSync(wellKnownDir, { recursive: true });

      // DID document
      const didDocPath = join(wellKnownDir, 'did.json');
      writeFileSync(didDocPath, JSON.stringify(didDocument, null, 2));
      console.log(`✅ DID document:  ${didDocPath}`);

      // Private key (KEEP SECRET)
      const privateKeyPath = join(outputDir, 'private-key.json');
      writeFileSync(privateKeyPath, JSON.stringify({
        did,
        keyId: `${did}#key-1`,
        algorithm: 'Ed25519',
        privateKeyHex: Buffer.from(privateKey).toString('hex'),
        publicKeyHex: Buffer.from(publicKey).toString('hex'),
        publicKeyMultibase,
        generatedAt: new Date().toISOString(),
        warning: 'THIS IS YOUR PRIVATE KEY. Store securely. Do not commit to version control.',
      }, null, 2));
      console.log(`🔐 Private key:   ${privateKeyPath}`);
      console.log(`   ⚠️  KEEP THIS SECRET. Back it up securely.`);

      // 5. Print instructions
      console.log(`\n📋 Next steps:`);
      console.log(`   1. Host ${didDocPath} at https://${opts.domain}/.well-known/did.json`);
      console.log(`   2. Ensure HTTPS is configured for ${opts.domain}`);
      console.log(`   3. Verify: npx @pdtf/did-tools org-verify --did ${did}`);
      console.log(`   4. Register with Moverly to be added to the Trusted Issuer Registry`);
      console.log(`   5. Store the private key in a secure key management system (e.g., AWS KMS, Google Cloud KMS)`);
      console.log(`      Do NOT keep it as a file in production.\n`);
    });
}
```

### 3.4 `org-verify` Command

Verifies that an organisation's DID document is correctly hosted and valid.

```typescript
// src/commands/org-verify.ts

interface VerifyResult {
  did: string;
  url: string;
  reachable: boolean;
  validJson: boolean;
  idMatch: boolean;
  hasVerificationMethod: boolean;
  hasAssertionMethod: boolean;
  keyType: string | null;
  corsHeaders: boolean;
  contentType: string | null;
  httpsOnly: boolean;
  services: string[];
  errors: string[];
  warnings: string[];
}

export async function verifyOrgDid(did: string): Promise<VerifyResult> {
  const result: VerifyResult = {
    did,
    url: '',
    reachable: false,
    validJson: false,
    idMatch: false,
    hasVerificationMethod: false,
    hasAssertionMethod: false,
    keyType: null,
    corsHeaders: false,
    contentType: null,
    httpsOnly: true,
    services: [],
    errors: [],
    warnings: [],
  };

  // 1. Construct URL
  if (!did.startsWith('did:web:')) {
    result.errors.push('Not a did:web identifier');
    return result;
  }

  const parts = did.slice('did:web:'.length).split(':');
  const domain = decodeURIComponent(parts[0]);
  if (parts.length === 1) {
    result.url = `https://${domain}/.well-known/did.json`;
  } else {
    const path = parts.slice(1).map(decodeURIComponent).join('/');
    result.url = `https://${domain}/${path}/did.json`;
  }

  // 2. Fetch
  try {
    const response = await fetch(result.url, {
      headers: { Accept: 'application/did+json, application/json' },
    });

    result.reachable = response.ok;
    result.contentType = response.headers.get('content-type');
    result.corsHeaders = response.headers.get('access-control-allow-origin') === '*';

    if (!result.reachable) {
      result.errors.push(`HTTP ${response.status} ${response.statusText}`);
      return result;
    }

    // 3. Parse JSON
    const doc = await response.json() as Record<string, unknown>;
    result.validJson = true;

    // 4. Check id matches
    result.idMatch = doc.id === did;
    if (!result.idMatch) {
      result.errors.push(`id mismatch: expected "${did}", got "${doc.id}"`);
    }

    // 5. Check verificationMethod
    const vms = doc.verificationMethod as Array<Record<string, unknown>> | undefined;
    result.hasVerificationMethod = Array.isArray(vms) && vms.length > 0;
    if (result.hasVerificationMethod) {
      result.keyType = vms![0].type as string;
      if (result.keyType !== 'Ed25519VerificationKey2020') {
        result.warnings.push(`Key type ${result.keyType} — PDTF recommends Ed25519VerificationKey2020`);
      }
      // Verify publicKeyMultibase starts with z6Mk (Ed25519)
      const pkm = vms![0].publicKeyMultibase as string;
      if (pkm && !pkm.startsWith('z6Mk')) {
        result.warnings.push('publicKeyMultibase does not start with z6Mk — may not be Ed25519');
      }
    } else {
      result.errors.push('No verificationMethod found');
    }

    // 6. Check assertionMethod
    const am = doc.assertionMethod as string[] | undefined;
    result.hasAssertionMethod = Array.isArray(am) && am.length > 0;
    if (!result.hasAssertionMethod) {
      result.errors.push('No assertionMethod — this DID cannot sign credentials');
    }

    // 7. List services
    const services = doc.service as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(services)) {
      result.services = services.map(s => `${s.type} (${s.id})`);
    }

    // 8. Warnings
    if (!result.corsHeaders) {
      result.warnings.push('Missing Access-Control-Allow-Origin: * header — cross-origin resolution may fail');
    }
    if (result.contentType && !result.contentType.includes('json')) {
      result.warnings.push(`Content-Type is "${result.contentType}" — should be application/json or application/did+json`);
    }

  } catch (err) {
    result.errors.push(`Fetch failed: ${(err as Error).message}`);
  }

  return result;
}
```

### 3.5 Organisation Registry (Firestore)

When an organisation completes onboarding and their DID document is verified, we store a reference:

```
firestore/
├── organisationDids/
│   └── {organisationId}
│       ├── did: string                    # "did:web:smithandjones.co.uk"
│       ├── domain: string                 # "smithandjones.co.uk"
│       ├── organisationName: string
│       ├── sraNumber: string | null
│       ├── companyNumber: string | null
│       ├── lastVerifiedAt: timestamp      # When we last checked did.json
│       ├── lastVerifiedKeyMultibase: string  # Key hash for change detection
│       ├── verificationStatus: string     # "verified" | "pending" | "failed"
│       ├── tirEntryId: string | null      # Reference to TIR entry
│       ├── registeredAt: timestamp
│       └── deactivatedAt: timestamp | null
```

### 3.6 Periodic Verification

A scheduled Cloud Function re-verifies organisation DID documents daily:

```typescript
// functions/src/verify-org-dids.ts

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { verifyOrgDid } from '@pdtf/did-tools';

/**
 * Daily verification of all registered organisation DID documents.
 * Detects: domain expiry, document removal, key changes, format issues.
 */
export const verifyOrgDids = onSchedule(
  {
    schedule: 'every 24 hours',
    region: 'europe-west2',
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();
    const snap = await db
      .collection('organisationDids')
      .where('deactivatedAt', '==', null)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const result = await verifyOrgDid(data.did);

      const updates: Record<string, unknown> = {
        lastVerifiedAt: FieldValue.serverTimestamp(),
      };

      if (result.errors.length > 0) {
        updates.verificationStatus = 'failed';
        console.error(`Organisation DID verification failed: ${data.did}`, result.errors);
        // TODO: Alert — org DID no longer valid
      } else {
        updates.verificationStatus = 'verified';

        // Detect key changes
        const currentKey = result.keyType; // simplified — should hash all keys
        if (data.lastVerifiedKeyMultibase && currentKey !== data.lastVerifiedKeyMultibase) {
          console.warn(`Key change detected for ${data.did}`);
          // TODO: Alert — key changed, may need TIR update
        }
      }

      await doc.ref.update(updates);
    }
  },
);
```

---

## 4. `@pdtf/did-resolver` Package

The universal DID resolver for PDTF. Handles both `did:key` and `did:web`, with caching and error handling.

### 4.1 Package Structure

```
packages/did-resolver/
├── src/
│   ├── index.ts                 # Public exports
│   ├── resolver.ts              # Universal resolver (did:key + did:web)
│   ├── did-key-resolver.ts      # did:key self-resolution (sync, no network)
│   ├── did-web-resolver.ts      # did:web HTTPS resolution with caching
│   ├── urn-validator.ts         # PDTF URN validation
│   ├── cache.ts                 # LRU cache with TTL
│   ├── types.ts                 # DID document types
│   └── errors.ts                # Resolution error types
├── test/
│   ├── resolver.test.ts
│   ├── did-key-resolver.test.ts
│   ├── did-web-resolver.test.ts
│   ├── urn-validator.test.ts
│   └── fixtures/
│       ├── test-vectors.json    # Known DID → document mappings
│       └── sample-did-docs/     # Sample DID documents for each entity type
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 Universal Resolver

```typescript
// src/resolver.ts

import { resolveDidKey } from './did-key-resolver.js';
import { DidWebResolver } from './did-web-resolver.js';
import type { DidDocument, ResolutionResult, ResolverOptions } from './types.js';

export class PdtfDidResolver {
  private webResolver: DidWebResolver;

  constructor(options?: ResolverOptions) {
    this.webResolver = new DidWebResolver({
      defaultCacheTtlMs: options?.cacheTtlMs ?? 3600_000,
      fetchTimeoutMs: options?.fetchTimeoutMs ?? 5_000,
      maxRetries: options?.maxRetries ?? 3,
      maxCacheSize: options?.maxCacheSize ?? 1000,
    });
  }

  /**
   * Resolve any PDTF DID to its DID document.
   *
   * did:key → synchronous, no network
   * did:web → HTTPS fetch with caching
   */
  async resolve(did: string): Promise<ResolutionResult> {
    if (did.startsWith('did:key:')) {
      try {
        const document = resolveDidKey(did);
        return {
          didDocument: document,
          didResolutionMetadata: { contentType: 'application/did+json' },
          didDocumentMetadata: {},
        };
      } catch (err) {
        return {
          didDocument: null,
          didResolutionMetadata: {
            error: 'invalidDid',
            message: (err as Error).message,
          },
          didDocumentMetadata: {},
        };
      }
    }

    if (did.startsWith('did:web:')) {
      return this.webResolver.resolve(did);
    }

    return {
      didDocument: null,
      didResolutionMetadata: {
        error: 'methodNotSupported',
        message: `Unsupported DID method: ${did.split(':')[1]}`,
      },
      didDocumentMetadata: {},
    };
  }

  /**
   * Extract the public key from a resolved DID document for a specific
   * verification method ID.
   */
  async resolveVerificationMethod(
    verificationMethodId: string,
  ): Promise<{ publicKey: Uint8Array; did: string } | null> {
    const did = verificationMethodId.split('#')[0];
    const result = await this.resolve(did);

    if (!result.didDocument) return null;

    const vm = result.didDocument.verificationMethod?.find(
      m => m.id === verificationMethodId,
    );
    if (!vm) return null;

    // Decode publicKeyMultibase → raw public key
    const { base58btc } = await import('multiformats/bases/base58');
    const decoded = base58btc.decode(vm.publicKeyMultibase);
    // Strip multicodec prefix (0xed01)
    const publicKey = decoded.slice(2);

    return { publicKey, did };
  }

  /** Clear the did:web cache (useful for tests or after key rotation) */
  clearCache(): void {
    this.webResolver.clearCache();
  }
}
```

### 4.3 `did:web` Resolver with Cache

```typescript
// src/did-web-resolver.ts

import { LRUCache } from './cache.js';
import type { DidDocument, ResolutionResult } from './types.js';

interface DidWebResolverOptions {
  defaultCacheTtlMs: number;
  fetchTimeoutMs: number;
  maxRetries: number;
  maxCacheSize: number;
}

// Entity-specific cache TTLs per Sub-spec 03 §7.3
const CACHE_TTLS: Record<string, number> = {
  'moverly.com:transactions:': 3600_000,      // 1 hour for transactions
  'adapters.propdata.org.uk:': 86400_000,     // 24 hours for adapters
  default: 86400_000,                          // 24 hours for organisations
};

export class DidWebResolver {
  private cache: LRUCache<string, { doc: DidDocument; fetchedAt: number; ttl: number }>;
  private options: DidWebResolverOptions;

  constructor(options: DidWebResolverOptions) {
    this.options = options;
    this.cache = new LRUCache(options.maxCacheSize);
  }

  async resolve(did: string): Promise<ResolutionResult> {
    // 1. Check cache
    const cached = this.cache.get(did);
    if (cached && (Date.now() - cached.fetchedAt) < cached.ttl) {
      return {
        didDocument: cached.doc,
        didResolutionMetadata: { contentType: 'application/did+json', cached: true },
        didDocumentMetadata: {},
      };
    }

    // 2. Construct URL
    const url = this.didToUrl(did);

    // 3. Fetch with retries
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.options.fetchTimeoutMs,
        );

        const response = await fetch(url, {
          headers: { Accept: 'application/did+json, application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          if (response.status === 404) {
            return {
              didDocument: null,
              didResolutionMetadata: { error: 'notFound' },
              didDocumentMetadata: {},
            };
          }
          throw new Error(`HTTP ${response.status}`);
        }

        const doc = (await response.json()) as DidDocument;

        // 4. Validate
        if (doc.id !== did) {
          return {
            didDocument: null,
            didResolutionMetadata: {
              error: 'invalidDidDocument',
              message: `id mismatch: expected ${did}, got ${doc.id}`,
            },
            didDocumentMetadata: {},
          };
        }

        // Check for deactivation
        const deactivated = (doc as any).deactivated === true;

        // 5. Cache
        const ttl = this.getTtl(did);
        this.cache.set(did, { doc, fetchedAt: Date.now(), ttl });

        return {
          didDocument: doc,
          didResolutionMetadata: { contentType: 'application/did+json' },
          didDocumentMetadata: { deactivated },
        };
      } catch (err) {
        lastError = err as Error;
        // Exponential backoff
        if (attempt < this.options.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    // 6. All retries failed — use stale cache if available
    if (cached) {
      return {
        didDocument: cached.doc,
        didResolutionMetadata: {
          contentType: 'application/did+json',
          cached: true,
          stale: true,
          error: 'staleCache',
          message: `Fetch failed after ${this.options.maxRetries} retries, using stale cache`,
        },
        didDocumentMetadata: {},
      };
    }

    return {
      didDocument: null,
      didResolutionMetadata: {
        error: 'notFound',
        message: lastError?.message ?? 'Resolution failed',
      },
      didDocumentMetadata: {},
    };
  }

  private didToUrl(did: string): string {
    const parts = did.slice('did:web:'.length).split(':');
    const domain = decodeURIComponent(parts[0]);
    if (parts.length === 1) {
      return `https://${domain}/.well-known/did.json`;
    }
    const path = parts.slice(1).map(decodeURIComponent).join('/');
    return `https://${domain}/${path}/did.json`;
  }

  private getTtl(did: string): number {
    const didBody = did.slice('did:web:'.length);
    for (const [prefix, ttl] of Object.entries(CACHE_TTLS)) {
      if (prefix !== 'default' && didBody.includes(prefix)) {
        return ttl;
      }
    }
    return CACHE_TTLS.default;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
```

### 4.4 URN Validator

```typescript
// src/urn-validator.ts

/**
 * Validate PDTF URN identifiers per Sub-spec 03 §3.
 */

const URN_PATTERNS: Record<string, RegExp> = {
  uprn: /^urn:pdtf:uprn:\d{1,12}$/,
  titleNumber: /^urn:pdtf:titleNumber:[A-Za-z]{1,4}\d{1,8}$/,
  unregisteredTitle: /^urn:pdtf:unregisteredTitle:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ownership: /^urn:pdtf:ownership:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  representation: /^urn:pdtf:representation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  consent: /^urn:pdtf:consent:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  offer: /^urn:pdtf:offer:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

export type PdtfUrnType = keyof typeof URN_PATTERNS;

export interface UrnValidationResult {
  valid: boolean;
  urnType: PdtfUrnType | null;
  value: string | null;
  error?: string;
}

/**
 * Validate a PDTF URN string.
 *
 * @returns Validation result with parsed type and value
 *
 * @example
 * validatePdtfUrn('urn:pdtf:uprn:100023456789')
 * // → { valid: true, urnType: 'uprn', value: '100023456789' }
 *
 * validatePdtfUrn('urn:pdtf:titleNumber:DN123456')
 * // → { valid: true, urnType: 'titleNumber', value: 'DN123456' }
 */
export function validatePdtfUrn(urn: string): UrnValidationResult {
  if (!urn.startsWith('urn:pdtf:')) {
    return { valid: false, urnType: null, value: null, error: 'Not a PDTF URN' };
  }

  for (const [type, pattern] of Object.entries(URN_PATTERNS)) {
    if (pattern.test(urn)) {
      // Extract value (everything after the type prefix)
      const prefix = `urn:pdtf:${type}:`;
      const value = urn.slice(prefix.length);
      return { valid: true, urnType: type as PdtfUrnType, value };
    }
  }

  return {
    valid: false,
    urnType: null,
    value: null,
    error: `URN does not match any known PDTF pattern: ${urn}`,
  };
}

/**
 * Generate a new PDTF URN for an entity type that uses UUID v4.
 */
export function generatePdtfUrn(
  type: 'ownership' | 'representation' | 'consent' | 'offer' | 'unregisteredTitle',
): string {
  const uuid = crypto.randomUUID();
  return `urn:pdtf:${type}:${uuid}`;
}

/**
 * Construct a PDTF URN from a known value (UPRN or title number).
 */
export function constructPdtfUrn(
  type: 'uprn',
  value: string,
): string;
export function constructPdtfUrn(
  type: 'titleNumber',
  value: string,
): string;
export function constructPdtfUrn(type: string, value: string): string {
  const urn = `urn:pdtf:${type}:${value}`;
  const result = validatePdtfUrn(urn);
  if (!result.valid) {
    throw new Error(`Invalid ${type} value "${value}": ${result.error}`);
  }
  return urn;
}
```

---

## 5. GCS Infrastructure for DID Documents

### 5.1 Bucket Configuration

```hcl
# modules/pdtf-did-docs/storage.tf

resource "google_storage_bucket" "did_documents" {
  name          = "pdtf-did-documents-${var.environment}"
  location      = "EUROPE-WEST2"
  project       = "pdtf-platform-${var.environment}"
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Cache-Control", "ETag"]
    max_age_seconds = 3600
  }

  labels = {
    service     = "pdtf-did-documents"
    environment = var.environment
  }
}

# Archive bucket for deactivated transaction DIDs (Coldline storage)
resource "google_storage_bucket" "did_documents_archive" {
  name          = "pdtf-did-documents-archive"
  location      = "EUROPE-WEST2"
  project       = "pdtf-platform-${var.environment}"
  force_destroy = false
  storage_class = "COLDLINE"

  uniform_bucket_level_access = true

  labels = {
    service     = "pdtf-did-documents-archive"
    environment = var.environment
  }
}

# Public read access
resource "google_storage_bucket_iam_member" "did_docs_public_read" {
  bucket = google_storage_bucket.did_documents.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
```

### 5.2 GCS Object Layout

```
gs://pdtf-did-documents-prod/
├── transactions/
│   ├── abc123/
│   │   └── did.json           # did:web:moverly.com:transactions:abc123
│   ├── def456/
│   │   └── did.json
│   └── ...
└── .well-known/
    └── did.json               # did:web:moverly.com (platform DID)
```

Adapter DID documents are served by the Cloud Function defined in impl/06 (from Firestore, not GCS). Organisation DID documents are hosted by the firms themselves. Only transaction DIDs and the platform DID are in this bucket.

### 5.3 CDN / Firebase Hosting Rewrite

Transaction DID documents are served via Firebase Hosting with a rewrite to GCS:

```json
// firebase.json (moverly.com site)
{
  "hosting": {
    "site": "moverly-platform",
    "rewrites": [
      {
        "source": "/transactions/*/did.json",
        "destination": "/transactions/*/did.json"
      },
      {
        "source": "/.well-known/did.json",
        "destination": "/.well-known/did.json"
      }
    ],
    "headers": [
      {
        "source": "**/did.json",
        "headers": [
          { "key": "Access-Control-Allow-Origin", "value": "*" },
          { "key": "Content-Type", "value": "application/did+json" },
          { "key": "Cache-Control", "value": "public, max-age=3600" }
        ]
      }
    ]
  }
}
```

---

## 6. Monitoring

### 6.1 Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Transaction DID creation latency | Cloud Function duration | > 5s (P95) |
| DID document fetch errors | did:web resolver logs | > 10 failures/hour |
| Organisation DID verification failures | Daily verification job | Any failure |
| Transaction DID documents served | GCS/CDN access logs | Baseline tracking |
| DID document 404s | GCS access logs | > 50/hour (indicates broken references) |

### 6.2 Alert Policies

```hcl
resource "google_monitoring_alert_policy" "org_did_verification_failure" {
  display_name = "Organisation DID Verification Failed"
  project      = "pdtf-platform-${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "Org DID document unreachable or invalid"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_function"
        labels.function_name="verifyOrgDids"
        textPayload=~"verification failed"
        severity >= ERROR
      EOT
    }
  }

  notification_channels = var.alert_channels
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

| Test | Validates |
|------|-----------|
| `did:key` derivation round-trip | Known public key → expected DID → resolve → key matches |
| `did:web` URL construction | All patterns (root, path, port) → correct HTTPS URL |
| URN validation | All 7 URN types: valid examples pass, invalid examples fail |
| URN generation | Generated URNs pass validation |
| DID document construction | All entity types produce valid documents |
| Cache TTL by entity type | Transactions get 1h, adapters get 24h, orgs get 24h |

### 7.2 Integration Tests

| Test | Validates |
|------|-----------|
| Transaction DID lifecycle | Create → serve → resolve → deactivate → resolve (deactivated) |
| Organisation verification | Host test DID doc → verify → check all fields |
| Resolver caching | Fetch → cache hit → invalidate → cache miss |
| Resolver retry | Mock server errors → verify retries → eventual success |
| Resolver stale cache | Mock server down → verify stale cache returned |

### 7.3 Test Vectors

```json
// test/fixtures/test-vectors.json
{
  "didKeyDerivation": [
    {
      "publicKeyHex": "d75a98182b10ab7d54bfeb3c1163043c2b7d1a310366c8b405e7a8434b3ae141",
      "expectedDid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      "expectedMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }
  ],
  "didWebUrls": [
    { "did": "did:web:example.com", "url": "https://example.com/.well-known/did.json" },
    { "did": "did:web:example.com:path:sub", "url": "https://example.com/path/sub/did.json" },
    { "did": "did:web:moverly.com:transactions:abc123", "url": "https://moverly.com/transactions/abc123/did.json" }
  ],
  "urnValidation": {
    "valid": [
      "urn:pdtf:uprn:100023456789",
      "urn:pdtf:titleNumber:DN123456",
      "urn:pdtf:titleNumber:AGL12345",
      "urn:pdtf:unregisteredTitle:f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "urn:pdtf:ownership:7c9e6679-7425-40de-944b-e07fc1f90ae7"
    ],
    "invalid": [
      "urn:pdtf:uprn:1234567890123",
      "urn:pdtf:titleNumber:123456",
      "urn:pdtf:ownership:not-a-uuid",
      "urn:other:uprn:123",
      ""
    ]
  }
}
```

---

## 8. Cost Model

| Item | Prod (Monthly) | Notes |
|------|---------------|-------|
| GCS storage (DID documents) | ~$0.20 | Small JSON files, low volume |
| GCS operations | ~$0.50 | Read-heavy, CDN absorbs most |
| Firebase Hosting / CDN | ~$2.00 | Included in existing Moverly hosting |
| KMS keys for transaction DIDs | ~$0.06/txn | SOFTWARE keys, created per transaction |
| Firestore (DID metadata) | ~$1.00 | Low volume reads/writes |
| Cloud Functions (verification) | ~$0.50 | Daily org verification |
| **Total** | **~$5/month** | Plus ~$0.06 per new transaction |

At 1,000 active transactions: ~$65/month for transaction DID KMS keys. Modest.

---

## 9. Open Questions

| # | Question | Status |
|---|----------|--------|
| DQ1 | Should transaction DIDs get their own KMS key ring or share the platform key ring? | Leaning separate ring: `transaction-keys` |
| DQ2 | Should we offer hosted DID documents for small firms that can't self-host? e.g. `did:web:registry.propdata.org.uk:firms:{sraNumber}` | Probably yes — reduces adoption friction |
| DQ3 | How do we handle the platform DID document (`did:web:moverly.com`)? Static file deployed with moverly.com, or dynamic from Firestore? | Static — rarely changes |
| DQ4 | Should the org verification job run more frequently than daily? | Daily sufficient for launch; weekly for low-risk, hourly for high-value |
| DQ5 | Do we need a DID document builder web UI for firms, or is the CLI sufficient? | CLI for tech-savvy firms, web UI later for broader adoption |

---

## Appendix A: Decision Log

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | GCS + CDN for transaction DID documents | Static files, CDN-friendly, same pattern as status lists |
| D2 | Separate Firestore collection for transaction DIDs | Clean separation from pdtfKeys (which is adapter/user/platform focused) |
| D3 | Daily org DID verification | Catches domain expiry, document removal, key changes |
| D4 | CLI-first org onboarding | Fastest path to production; web UI is follow-up |
| D5 | Transaction DIDs use SOFTWARE KMS keys | Volume is high, value per key is lower than adapters |

---

*This document is part of the PDTF 2.0 implementation specification suite. For the protocol-level spec, see [Sub-spec 03 — DID Methods & Identifiers](../../03-did-methods/).*
