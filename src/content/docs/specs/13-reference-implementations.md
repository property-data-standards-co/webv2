---
title: "PDTF 2.0 — Sub-spec 13: Reference Implementations"
description: "PDTF 2.0 specification document."
---


**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](./00-architecture-overview.md)

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Repository Structure](#2-repository-structure)
3. [VC Validator (`@pdtf/vc-validator`)](#3-vc-validator-pdtfvc-validator)
4. [DID Resolver (`@pdtf/did-resolver`)](#4-did-resolver-pdtfdid-resolver)
5. [Credential Builder (`@pdtf/vc-builder`)](#5-credential-builder-pdtfvc-builder)
6. [Graph Composer (`@pdtf/schemas`)](#6-graph-composer-pdtfschemas)
7. [Testing Strategy](#7-testing-strategy)
8. [Package Publishing](#8-package-publishing)
9. [Security Considerations](#9-security-considerations)
10. [Open Questions](#10-open-questions)
11. [Implementation Notes](#11-implementation-notes)

---

## 1. Purpose

The PDTF 2.0 specification suite defines a trust architecture built on W3C Verifiable Credentials, Decentralised Identifiers, and a federated Trusted Issuer Registry. Specifications alone are insufficient — implementers need working code that demonstrates correct behaviour, provides ready-to-use libraries, and serves as the canonical interpretation of the spec when ambiguity arises.

The reference implementations serve four goals:

1. **Proof of correctness.** Every sub-spec is validated by running code. If a design cannot be implemented cleanly, the spec is wrong — not the code.
2. **Implementer acceleration.** LMS providers, conveyancing platforms, and data aggregators can integrate `@pdtf` packages directly rather than building from scratch.
3. **Interoperability baseline.** The test vectors and validation suites define the canonical behaviour all implementations must match.
4. **Living documentation.** The TypeScript types serve as machine-readable documentation of the data model, complementing the prose specifications.

All reference implementations are open-source under the Apache 2.0 licence, published to npm under the `@pdtf` scope, and maintained within the `property-data-standards-co` GitHub organisation.

---

## 2. Repository Structure

All repositories live under the [`property-data-standards-co`](https://github.com/property-data-standards-co) GitHub organisation.

| Repository | npm Package | Description |
|---|---|---|
| `pdtf-vc-validator` | `@pdtf/vc-validator` | Credential validation pipeline |
| `pdtf-did-resolver` | `@pdtf/did-resolver` | DID resolution for `did:key` and `did:web` |
| `pdtf-vc-builder` | `@pdtf/vc-builder` | Credential construction and signing |
| `pdtf-schemas` | `@pdtf/schemas` | JSON schemas, entity types, and Graph Composer |

### 2.1 Dependency Graph

Each package occupies its own repository. This keeps dependency trees minimal, allows independent versioning, and means consumers install only what they need. The `pdtf-schemas` repo bundles the Graph Composer alongside the JSON schemas because composition logic is tightly coupled to the schema definitions.

```
@pdtf/vc-validator
  ├── @pdtf/did-resolver    (peer dependency)
  └── @pdtf/schemas         (peer dependency — for type definitions)

@pdtf/vc-builder
  ├── @pdtf/did-resolver    (optional — for DID document verification)
  └── @pdtf/schemas         (peer dependency — for credential type constants)

@pdtf/schemas               (no @pdtf dependencies — leaf package)
@pdtf/did-resolver           (no @pdtf dependencies — leaf package)
```

### 2.2 Common Repository Layout

```
pdtf-vc-validator/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # TypeScript interfaces
│   ├── validator.ts          # Core implementation
│   └── errors.ts             # Error types
├── test/
│   ├── vectors/              # Test vector fixtures (JSON)
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
└── LICENSE                   # Apache 2.0
```

---

## 3. VC Validator (`@pdtf/vc-validator`)

The VC Validator takes a Verifiable Credential document and returns a comprehensive validation result covering structure, cryptographic integrity, issuer trust, and revocation status.

### 3.1 Validation Pipeline

The validator executes a sequential pipeline. Each stage can short-circuit on fatal errors:

```
1. Structure Validation  →  2. Resolve Issuer DID  →  3. Verify Signature
        →  4. TIR Lookup  →  5. Expiry Check  →  6. Revocation Check  →  Result
```

**Stage 1 — Structure Validation.** Validates the VC JSON against W3C VC Data Model 2.0 structure and PDTF-specific requirements: `@context` includes the PDTF context URL, `type` includes a recognised PDTF credential type, `credentialSubject` conforms to the entity schema, and `proof` is present with a supported cryptosuite.

**Stage 2 — Issuer DID Resolution.** Resolves the `issuer` field using the configured `@pdtf/did-resolver` instance. Extracts the verification method matching the proof's `verificationMethod` reference.

**Stage 3 — Signature Verification.** Canonicalises the credential using JCS (RFC 8785), then verifies the `eddsa-jcs-2022` proof against the resolved public key.

**Stage 4 — TIR Lookup.** Queries the Trusted Issuer Registry to confirm the issuer DID is authorised for the specific `entity:path` combination claimed by the credential. When verifying a credential issued by or about an Organisation with a `did:key` identifier, the validator MUST check the TIR `accountProvider` entries' `managedOrganisations` registries to confirm the `did:key` is managed by a trusted provider.

**Stage 5 — Expiry Check.** Validates `validFrom` ≤ now ≤ `validUntil` (if present). Configurable clock skew tolerance (default: 60 seconds).

**Stage 6 — Revocation Check.** If the credential contains a `credentialStatus` of type `BitstringStatusListEntry`, fetches the referenced status list credential, validates it, and checks the specific bit index.

### 3.2 TypeScript Interfaces

```typescript
interface ValidationResult {
  /** Overall validity — true only if all checks pass. */
  valid: boolean;
  /** Trust level derived from TIR lookup. */
  trustLevel: TrustLevel;
  /** Resolved issuer information. */
  issuer: ResolvedIssuer | null;
  /** Whether the credential has been revoked. */
  revoked: boolean;
  /** Ordered list of errors encountered during validation. */
  errors: ValidationError[];
  /** Per-stage timing and status metadata. */
  stages: StageResult[];
}

type TrustLevel =
  | 'root'          // Primary source issuer (e.g., HMLR for title data)
  | 'delegated'     // Issuer with explicit delegation from root
  | 'proxy'         // Trusted proxy (e.g., Moverly aggregating data)
  | 'self-asserted' // Seller/owner self-declaration
  | 'unknown';      // Issuer not found in TIR

interface ResolvedIssuer {
  did: string;
  name?: string;
  verificationMethodId: string;
  authorisedPaths: string[];
}

interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  stage: ValidationStage;
  fatal: boolean;
}

type ValidationStage =
  | 'structure' | 'did-resolution' | 'signature'
  | 'tir-lookup' | 'expiry' | 'revocation';

interface StageResult {
  stage: ValidationStage;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  durationMs: number;
  errors: ValidationError[];
}
```

### 3.3 Error Taxonomy

```typescript
type ValidationErrorCode =
  // Structure errors
  | 'INVALID_JSON'
  | 'MISSING_CONTEXT'
  | 'MISSING_TYPE'
  | 'UNKNOWN_CREDENTIAL_TYPE'
  | 'INVALID_SUBJECT'
  | 'MISSING_PROOF'
  | 'UNSUPPORTED_CRYPTOSUITE'
  // DID resolution errors
  | 'ISSUER_DID_NOT_FOUND'
  | 'ISSUER_DID_INVALID'
  | 'DID_RESOLUTION_NETWORK'
  | 'VERIFICATION_METHOD_MISSING'
  // Signature errors
  | 'INVALID_SIGNATURE'
  | 'CANONICALIZATION_ERROR'
  // TIR errors
  | 'ISSUER_NOT_IN_TIR'
  | 'UNTRUSTED_PATH'
  | 'TIR_NETWORK_ERROR'
  | 'ORG_DID_KEY_NOT_IN_MANAGED_ORGS'
  // Temporal errors
  | 'CREDENTIAL_NOT_YET_VALID'
  | 'CREDENTIAL_EXPIRED'
  // Revocation errors
  | 'CREDENTIAL_REVOKED'
  | 'STATUS_LIST_FETCH_ERROR'
  | 'STATUS_LIST_INVALID';
```

### 3.4 Configuration

```typescript
interface ValidatorConfig {
  /** URL of the Trusted Issuer Registry API. */
  tirUrl: string;
  /** DID resolver instance. If not provided, a default resolver is created. */
  didResolver?: DIDResolver;
  /** Cache TTL for TIR lookups in milliseconds. Default: 300_000 (5 min). */
  tirCacheTtlMs?: number;
  /** Cache TTL for status list fetches in milliseconds. Default: 60_000 (1 min). */
  statusListCacheTtlMs?: number;
  /** Clock skew tolerance in seconds for expiry checks. Default: 60. */
  clockSkewSeconds?: number;
  /** Custom fetch implementation (for testing or custom transports). */
  fetch?: typeof globalThis.fetch;
  /** Stages to skip. Use with caution — primarily for testing. */
  skipStages?: ValidationStage[];
}
```

### 3.5 Usage

```typescript
import { createValidator } from '@pdtf/vc-validator';
import { createResolver } from '@pdtf/did-resolver';

const validator = createValidator({
  tirUrl: 'https://tir.pdtf.org/api/v1',
  didResolver: createResolver({ cacheTtlMs: 600_000 }),
});

// Single credential
const result: ValidationResult = await validator.validate(credentialJson);

if (result.valid) {
  console.log(`Valid credential from ${result.issuer?.name}`);
  console.log(`Trust level: ${result.trustLevel}`);
} else {
  for (const error of result.errors) {
    console.error(`[${error.stage}] ${error.code}: ${error.message}`);
  }
}

// Batch validation
const results = await validator.validateBatch(credentials, { concurrency: 5 });

// Single-stage validation (e.g., structure-only during ingestion)
const structureResult = await validator.validateStructure(credentialJson);
```

---

## 4. DID Resolver (`@pdtf/did-resolver`)

Implements W3C DID Core §7 (DID Resolution) for the two DID methods used in PDTF 2.0: `did:key` (ephemeral and test identities) and `did:web` (organisational identities).

### 4.1 Supported Methods

**`did:key`** — Deterministic resolution, no network calls:
1. Parse multibase prefix (`z` = base58btc) and multicodec prefix (`0xed01` = Ed25519)
2. Extract the 32-byte Ed25519 public key
3. Construct DID Document with a single `Ed25519VerificationKey2020` verification method

**`did:web`** — Network-based resolution with TLS validation:
1. Parse DID string: `did:web:<domain>[:path]*`
2. Convert to URL: `https://<domain>[/path]*/.well-known/did.json`
3. Fetch via HTTPS (TLS required — no HTTP fallback)
4. Validate the `id` field matches the DID being resolved
5. Cache with configurable TTL

### 4.2 TypeScript Interfaces

```typescript
/** W3C DID Resolution Result (DID Core §7.1). */
interface DIDResolutionResult {
  didDocument: DIDDocument | null;
  didResolutionMetadata: DIDResolutionMetadata;
  didDocumentMetadata: DIDDocumentMetadata;
}

interface DIDDocument {
  '@context': string | string[];
  id: string;
  controller?: string | string[];
  verificationMethod?: VerificationMethod[];
  authentication?: (string | VerificationMethod)[];
  assertionMethod?: (string | VerificationMethod)[];
  service?: ServiceEndpoint[];
}

interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  publicKeyJwk?: JsonWebKey;
}

interface DIDResolutionMetadata {
  contentType?: string;
  error?: 'notFound' | 'invalidDid' | 'representationNotSupported'
    | 'methodNotSupported' | 'networkError' | 'tlsError' | 'documentIdMismatch';
  duration?: number;
  cached?: boolean;
}

interface DIDDocumentMetadata {
  created?: string;
  updated?: string;
  deactivated?: boolean;
  versionId?: string;
}
```

### 4.3 Configuration and API

```typescript
interface ResolverConfig {
  cacheTtlMs?: number;           // Default: 300_000 (5 min)
  cacheMaxEntries?: number;      // Default: 1000 (LRU eviction)
  fetchTimeoutMs?: number;       // Default: 10_000
  fetch?: typeof globalThis.fetch;
  allowInsecure?: boolean;       // Testing only. Default: false
  methods?: Record<string, DIDMethodHandler>; // Extensible
}

interface DIDMethodHandler {
  resolve(did: string): Promise<DIDResolutionResult>;
}
```

```typescript
import { createResolver } from '@pdtf/did-resolver';

const resolver = createResolver({ cacheTtlMs: 600_000 });

// Resolve did:key (deterministic, instant)
const keyResult = await resolver.resolve(
  'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
);

// Resolve did:web (network fetch, cached)
const webResult = await resolver.resolve('did:web:hmlr.gov.uk');

// Cache management
resolver.invalidate('did:web:hmlr.gov.uk');
resolver.clearCache();
```

### 4.4 Caching Strategy

- **`did:key`**: Cached indefinitely (deterministic resolution). Only evicted by LRU pressure.
- **`did:web`**: Cached for the configured TTL. No stale-while-revalidate — a stale `did:web` document could reference rotated keys, leading to false validation results.
- **Error results are NOT cached** — transient network failures should be retried.

### 4.5 Error Handling

The resolver never throws exceptions. All failure modes are captured in `DIDResolutionMetadata.error` per W3C DID Core §7.1:

```typescript
const result = await resolver.resolve('did:key:invalidMultibase');
// result.didResolutionMetadata.error === 'invalidDid'
// result.didDocument === null
```

---

## 5. Credential Builder (`@pdtf/vc-builder`)

Constructs W3C Verifiable Credentials conforming to the PDTF 2.0 data model, signs them using configurable signers, and outputs complete credentials.

### 5.1 Signer Interface

The builder separates credential construction from signing via a `Signer` interface:

```typescript
interface Signer {
  /** Sign arbitrary data and return the signature bytes. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Key ID used in the proof's verificationMethod field. */
  keyId: string;
  /** Signing algorithm identifier. */
  algorithm: string;
}
```

### 5.2 Signer Implementations

**Local Signer (Testing):**

```typescript
import { createLocalSigner } from '@pdtf/vc-builder';

// Generate a new Ed25519 key pair
const signer = await createLocalSigner();

// Or provide an existing private key
const signer = createLocalSigner({
  privateKey: existingEd25519PrivateKey,
  did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
});
```

**Google Cloud KMS Signer:**

```typescript
import { createGcpKmsSigner } from '@pdtf/vc-builder/kms/gcp';

const signer = createGcpKmsSigner({
  projectId: 'moverly-prod',
  locationId: 'europe-west2',
  keyRingId: 'pdtf-signing',
  keyId: 'property-credentials',
  keyVersion: '1',
  did: 'did:web:moverly.com',
  verificationMethodFragment: '#key-1',
});
```

The GCP KMS signer calls `asymmetricSign` on the Cloud KMS API, requires the `cloudkms.cryptoKeyVersions.useToSign` IAM permission, and supports the `EC_SIGN_ED25519` key type.

### 5.3 Build API

```typescript
interface BuildCredentialOptions {
  type: string | string[];
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
  evidence?: Evidence[];
  termsOfUse?: TermsOfUse[];
  status?: CredentialStatusConfig;
  validFrom?: string;       // Defaults to now
  validUntil?: string;      // If omitted, no expiry
  id?: string;              // If omitted, UUID URN generated
}

interface CredentialStatusConfig {
  statusListCredential: string;
  statusListIndex: number;
  statusPurpose: 'revocation' | 'suspension';
}
```

```typescript
import { createBuilder, createLocalSigner } from '@pdtf/vc-builder';

const signer = await createLocalSigner();
const builder = createBuilder({
  signer,
  defaultContext: [
    'https://www.w3.org/ns/credentials/v2',
    'https://purl.org/pdtf/v2/context',
  ],
});

const credential = await builder.buildCredential({
  type: 'PropertyEPCCredential',
  issuer: signer.keyId.split('#')[0],
  subject: 'urn:pdtf:property:10001234',
  claims: {
    'property:epc': {
      rating: 'C',
      score: 72,
      validUntil: '2033-06-15',
      certificateNumber: '0123-4567-8901-2345',
    },
  },
  evidence: [{
    type: 'DataRetrievalEvidence',
    source: 'https://epc.opendatacommunities.org/api/v1/...',
    retrievedAt: '2026-03-24T12:00:00Z',
  }],
  status: {
    statusListCredential: 'https://moverly.com/.well-known/status/1',
    statusListIndex: 42,
    statusPurpose: 'revocation',
  },
});
```

### 5.4 Signing Process

The builder follows the `eddsa-jcs-2022` Data Integrity cryptosuite:

1. **Assemble** the unsigned credential — populate all fields, generate UUID URN if no `id` provided.
2. **Construct proof options** — `type: 'DataIntegrityProof'`, `cryptosuite: 'eddsa-jcs-2022'`, `created`, `verificationMethod`, `proofPurpose: 'assertionMethod'`.
3. **Canonicalise** proof options via JCS (RFC 8785), hash with SHA-256 → `proofOptionsHash`.
4. **Canonicalise** the credential (without proof) via JCS, hash with SHA-256 → `documentHash`.
5. **Concatenate**: `hashData = proofOptionsHash || documentHash` (64 bytes).
6. **Sign** `hashData` using the configured `Signer` → signature bytes.
7. **Encode** signature as multibase (base58btc, prefix `z`).
8. **Attach** the completed proof to the credential and return.

```typescript
interface DataIntegrityProof {
  type: 'DataIntegrityProof';
  cryptosuite: 'eddsa-jcs-2022';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  proofValue: string; // Multibase-encoded signature
}
```

---

## 6. Graph Composer (`@pdtf/schemas`)

The Graph Composer lives within `@pdtf/schemas` because it is tightly coupled to entity type definitions and JSON schemas. It assembles validated credentials into coherent entity state — either the v4 graph format or backward-compatible v3 flat format.

### 6.1 TypeScript Interfaces

```typescript
interface ValidatedCredential {
  credential: VerifiableCredential;
  validation: ValidationResult;
}

/** V4 entity state — the new PDTF 2.0 graph format. */
interface V4EntityState {
  entityType: string;
  entityId: string;
  claims: Record<string, unknown>;
  provenance: Record<string, ClaimProvenance>;
  children: V4EntityState[];
}

interface ClaimProvenance {
  credentialId: string;
  issuer: string;
  trustLevel: TrustLevel;
  issuedAt: string;
  conflictResolution?: ConflictResolution;
}

interface ConflictResolution {
  rejectedCredentialId: string;
  reason: 'higher-trust-level' | 'more-recent' | 'manual-override';
}

/** V3 flat state — backward-compatible with PDTF v3 consumers. */
interface V3FlatState {
  [path: string]: {
    value: unknown;
    verified: boolean;
    source: string;
    updatedAt: string;
  };
}

interface ComposerConfig {
  conflictStrategy: 'trust-then-recency' | 'recency-only' | 'strict-trust';
  minimumTrustLevel?: TrustLevel;
  includeRevoked?: boolean;
  dependencyGraph?: DependencyGraph;
}
```

### 6.2 API

```typescript
import { composeV4StateFromGraph, composeV3StateFromGraph } from '@pdtf/schemas';

const v4State = composeV4StateFromGraph(validatedCredentials, {
  conflictStrategy: 'trust-then-recency',
  minimumTrustLevel: 'proxy',
});

const v3State = composeV3StateFromGraph(validatedCredentials, {
  conflictStrategy: 'trust-then-recency',
});

// Access claims with provenance
console.log(v4State.claims['epc']);
console.log(v4State.provenance['epc'].trustLevel); // 'root'
console.log(v4State.provenance['epc'].issuer);     // 'did:web:epc.gov.uk'
```

### 6.3 Dependency Pruning

The Graph Composer implements dependency pruning to remove entity branches that are incomplete or have broken trust chains:

```typescript
interface DependencyGraph {
  dependencies: Record<string, DependencyRule[]>;
}

interface DependencyRule {
  requiredPath: string;
  type: 'hard' | 'soft'; // Hard = prune if missing; soft = warn only
}
```

Algorithm:
1. Build the entity tree from validated credentials.
2. For each entity, check all `hard` dependencies.
3. If a hard dependency is missing or revoked, mark the entity and all its dependants for pruning.
4. For `soft` dependencies, emit a warning but retain the entity.
5. Remove pruned entities from the final state.

### 6.4 Conflict Resolution

When multiple credentials assert claims for the same `entity:path`:

- **`trust-then-recency`** (default): Compare trust levels (`root` > `delegated` > `proxy` > `self-asserted` > `unknown`). If tied, prefer more recently issued credential. Record decision in `ClaimProvenance`.
- **`recency-only`**: Always prefer the most recently issued credential.
- **`strict-trust`**: Compare trust levels only. If tied, emit an error requiring manual resolution.

---

## 7. Testing Strategy

### 7.1 Test Vectors

Each package ships with `test/vectors/` containing known-good and known-bad fixtures:

```
test/vectors/
├── valid/
│   ├── property-epc-credential.json
│   ├── title-register-credential.json
│   ├── ownership-credential.json
│   └── multi-entity-graph.json
├── invalid/
│   ├── expired-credential.json
│   ├── revoked-credential.json
│   ├── bad-signature.json
│   ├── missing-context.json
│   ├── unknown-issuer.json
│   └── untrusted-path.json
└── keys/
    ├── test-key-1.json
    ├── test-key-2.json
    └── test-did-documents.json
```

All vectors include pre-computed signatures. Private keys are published alongside — they are **test-only** and must never be used in production.

### 7.2 Interoperability Tests

- **Digital Bazaar `vc` library** — verify credentials built by `@pdtf/vc-builder` validate with `@digitalbazaar/vc`
- **SpruceID DIDKit** — cross-validate DID resolution results
- **W3C VC Test Suite** — run the official VC Data Model 2.0 test suite against builder output

### 7.3 Round-Trip Tests

The most comprehensive test category — exercises the full pipeline:

```typescript
describe('round-trip', () => {
  it('build → validate → compose → verify state', async () => {
    const signer = await createLocalSigner();
    const builder = createBuilder({ signer });
    const vc = await builder.buildCredential({
      type: 'PropertyEPCCredential',
      issuer: signer.keyId.split('#')[0],
      subject: 'urn:pdtf:property:10001234',
      claims: { 'property:epc': { rating: 'C', score: 72 } },
    });

    const validator = createValidator({
      tirUrl: 'mock://tir',
      skipStages: ['tir-lookup', 'revocation'],
    });
    const result = await validator.validate(vc);
    expect(result.valid).toBe(true);

    const state = composeV4StateFromGraph(
      [{ credential: vc, validation: result }],
      { conflictStrategy: 'trust-then-recency' }
    );
    expect(state.claims['property:epc']).toEqual({ rating: 'C', score: 72 });
    expect(state.provenance['property:epc'].issuer).toBe(
      signer.keyId.split('#')[0]
    );
  });
});
```

### 7.4 Fixture Generation

```bash
# Generate all test vectors with fresh keys
npx @pdtf/vc-builder generate-fixtures --output test/vectors/

# Generate a specific credential type
npx @pdtf/vc-builder generate-fixtures \
  --type PropertyEPCCredential \
  --output test/vectors/valid/
```

---

## 8. Package Publishing

### 8.1 npm Scope and Packages

| Package | Description |
|---|---|
| `@pdtf/vc-validator` | Credential validation pipeline |
| `@pdtf/did-resolver` | DID resolution (`did:key`, `did:web`) |
| `@pdtf/vc-builder` | Credential construction and signing |
| `@pdtf/schemas` | JSON schemas, types, and Graph Composer |

### 8.2 Versioning

Semantic Versioning aligned with spec versions:

| Spec Version | Package Version Series |
|---|---|
| PDTF 2.0 Draft | `0.1.x` – `0.9.x` |
| PDTF 2.0 RC | `1.0.0-rc.x` |
| PDTF 2.0 Final | `1.0.0` |

### 8.3 Build and Distribution

All packages are TypeScript, distributed as ESM + CJS dual format with full `.d.ts` type declarations:

```json
{
  "name": "@pdtf/vc-validator",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.cjs",
      "types": "./dist/types/index.d.ts"
    }
  },
  "files": ["dist/", "LICENSE", "README.md"],
  "engines": { "node": ">=18.0.0" },
  "sideEffects": false
}
```

### 8.4 Dependency Policy

Minimal external dependencies to reduce attack surface and enable browser/edge compatibility:

| Dependency | Purpose | Used by |
|---|---|---|
| `@noble/ed25519` | Ed25519 signatures | validator, builder |
| `@noble/hashes` | SHA-256 hashing | validator, builder |
| `canonicalize` | JCS (RFC 8785) | validator, builder |
| `multiformats` | Multibase/multicodec | did-resolver |

Explicitly excluded: `jsonld` (too heavy), `node-forge` (native crypto preferred), framework-specific libraries.

---

## 9. Security Considerations

### 9.1 Supply Chain Security

- **Lockfiles committed.** `package-lock.json` in version control for all repos.
- **Signed commits.** GPG-signed maintainer commits; branch protection requires signed commits on `main`.
- **Dependency auditing.** `npm audit` in CI on every PR. Critical/high vulnerabilities block merge.
- **Provenance attestation.** Published packages include npm provenance attestations linking to source commit.

### 9.2 Key Material

- **No private keys in packages.** Test key fixtures excluded from `files` in `package.json`.
- **Test keys clearly labelled.** All test fixtures include `"purpose": "test-only"`.
- **KMS signers never expose keys.** The `Signer` interface accepts data and returns signatures — private keys never leave the KMS boundary.

### 9.3 Network Security

- **TLS-only for `did:web`.** No HTTP fallback. `allowInsecure` gated behind explicit opt-in with warning.
- **Timeout enforcement.** All network operations have configurable timeouts (10s DID resolution, 10s status list fetch, 30s TIR queries).

### 9.4 Input Validation

- **Schema-first.** All credential input validated against JSON schemas before cryptographic operations.
- **Canonicalization safety.** JCS is deterministic and side-effect-free. No prototype pollution vectors.
- **No `eval` or dynamic code execution** in any reference implementation.

---

## 10. Open Questions

| # | Question | Context |
|---|---|---|
| 1 | Publish `@pdtf/test-vectors` as a separate package? | Allows third-party implementations to run our test suite independently. |
| 2 | Include status list credential building in `@pdtf/vc-builder`? | Status list credentials are VCs — the builder could create and update them. |
| 3 | DID method extensibility beyond `did:key` and `did:web`? | `DIDMethodHandler` interface allows pluggable methods. Support `did:ion`, `did:pkh`? |
| 4 | Streaming/incremental graph composition? | For large graphs, incremental composition may outperform batch. |
| 5 | Browser bundle size budget? | Target: <50KB gzipped per package. |
| 6 | WASM build for non-JS environments? | Ed25519 + JCS could compile to WASM for Go, Python, etc. |
| 7 | `@pdtf/vc-presenter` for Verifiable Presentations? | VP construction for selective disclosure — defer to future sub-spec? |

---

## 11. Implementation Notes

### 11.1 Implementation Priority

Packages should be implemented in dependency order:

1. **`@pdtf/did-resolver`** — no `@pdtf` dependencies; foundational
2. **`@pdtf/schemas`** — defines types used everywhere
3. **`@pdtf/vc-builder`** — depends on did-resolver (optional) and schemas
4. **`@pdtf/vc-validator`** — depends on did-resolver and schemas; most complex

### 11.2 CI/CD Pipeline

Each repository uses GitHub Actions:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: npm ci && npm run build && npm test && npm audit --audit-level=high

  publish:
    needs: test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci && npm run build && npm publish --provenance --access public
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

### 11.3 API Design Principles

- **Factory functions over classes.** `createValidator()`, `createResolver()`, `createBuilder()` — hides implementation, allows refactoring.
- **Immutable configuration.** Config read at construction; changing behaviour requires a new instance.
- **No side effects on import.** Importing never triggers network requests, file access, or global state mutation.
- **Errors in return values, not exceptions.** Following W3C DID Core: resolution errors in metadata, validation errors in result objects. Exceptions reserved for programmer errors.

### 11.4 Browser Compatibility

All packages target modern browsers (last 2 versions of Chrome, Firefox, Safari, Edge):

- **No Node.js built-ins.** Use `crypto.subtle` via `@noble/ed25519` — not `node:crypto`.
- **No `fs` or `path`.** Test fixtures loaded differently per environment.
- **Standard `fetch` API.** Custom `fetch` injectable for environments without native support.
- **Tree-shakeable.** Named exports only. No default exports or barrel re-exports.

### 11.5 Performance Targets

| Operation | Target | Notes |
|---|---|---|
| `did:key` resolution | < 1ms | Deterministic, no network |
| `did:web` resolution (cached) | < 1ms | LRU cache hit |
| `did:web` resolution (cold) | < 500ms | Network fetch + parse |
| VC structure validation | < 5ms | JSON schema validation |
| VC signature verification | < 10ms | JCS + Ed25519 verify |
| Full validation pipeline | < 100ms | All stages, warm caches |
| Build + sign credential | < 10ms | JCS + Ed25519 sign |
| Compose v4 state (10 VCs) | < 20ms | Conflict resolution + merge |
| Compose v4 state (100 VCs) | < 200ms | Larger graph |

### 11.6 Future Packages

Anticipated but out of scope for initial release:

- **`@pdtf/vc-presenter`** — Verifiable Presentation construction for selective disclosure
- **`@pdtf/status-list`** — Bitstring Status List credential creation and management
- **`@pdtf/tir-client`** — Typed client for the Trusted Issuer Registry API
- **`@pdtf/migration`** — Tools for migrating PDTF v1/v3 data to v4 credential format

---

## References

- [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Decentralised Identifiers (DIDs) v1.0](https://www.w3.org/TR/did-core/)
- [W3C DID Core §7 — DID Resolution](https://www.w3.org/TR/did-core/#resolution)
- [Data Integrity EdDSA Cryptosuites v1.0](https://www.w3.org/TR/vc-di-eddsa/)
- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/)
- [Sub-spec 01 — Entity Graph & Schema](./01-entity-graph.md)
- [Sub-spec 02 — VC Data Model](./02-vc-data-model.md)
- [Sub-spec 03 — DID Methods & Identifiers](./03-did-methods.md)
- [Sub-spec 04 — Trusted Issuer Registry](./04-trusted-issuer-registry.md)
- [Sub-spec 06 — Key Management](./06-key-management.md)
- [Sub-spec 07 — State Assembly](./07-state-assembly.md)
- [Sub-spec 14 — Credential Revocation](./14-credential-revocation.md)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | Organisation `did:key` verification added to §3.1 Stage 4 — validator MUST check TIR `managedOrganisations` registries. `ORG_DID_KEY_NOT_IN_MANAGED_ORGS` error code added to §3.3 taxonomy. |
| v0.1 | 24 March 2026 | Initial draft. @pdtf/vc-validator (4-stage pipeline), @pdtf/vc-signer, @pdtf/did-resolver, @pdtf/graph-composer, @pdtf/tir-client packages. Error taxonomy, test vectors, integration patterns. |

---

*This specification is part of the PDTF 2.0 suite. For the full architecture, see [00 — Architecture Overview](./00-architecture-overview.md).*
