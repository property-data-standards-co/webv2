---
title: "PDTF 2.0 — Implementation: Key Management Service"
description: "PDTF 2.0 specification document."
---


**Version:** 0.3 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Implements:** [Sub-spec 06 — Key Management](../../06-key-management/)

---

## 1. Overview

This document specifies the technical implementation of key management for Moverly's PDTF 2.0 backend. It translates the protocol-level decisions in Sub-spec 06 (algorithm selection, key categories, KMS architecture) into concrete infrastructure, service code, and operational procedures.

**What this covers:**

- **`KeyProvider` strategy pattern** — pluggable key storage backends
- **`FirestoreKeyProvider`** — naive local-key implementation for dev/staging (keys generated and stored in Firestore)
- **`KmsKeyProvider`** — production GCP Cloud KMS implementation (HSM-backed)
- GCP project and KMS infrastructure (Terraform)
- `@pdtf/key-manager` service package — TypeScript API
- Firestore schema for key metadata and DID ↔ key mappings
- DID document generation and serving
- `did:key` derivation from Ed25519 keys
- Signing and verification service integration
- Operational runbooks: provisioning, rotation, compromise response
- Monitoring, alerting, and cost management

**What this does NOT cover:**

- VC credential format or signing semantics (see 02-vc-data-model)
- TIR structure or registration (see 04-trusted-issuer-registry)
- Revocation / status list infrastructure (see 14-credential-revocation)
- Transport security (TLS), Firebase Auth, or API authentication

---

## 2. Infrastructure

### 2.1 GCP Projects

Three GCP projects isolate key material by trust level. All within the `moverly.com` organisation.

| Project | Purpose | Key Types | Protection |
|---------|---------|-----------|------------|
| `pdtf-adapters-prod` | Trusted proxy adapter signing keys | Adapter keys | HSM |
| `pdtf-platform-prod` | Moverly organisational identity + status lists | Platform key | HSM |
| `pdtf-users-prod` | Custodial user identity keys | User keys | SOFTWARE |

Staging equivalents: `pdtf-adapters-staging`, `pdtf-platform-staging`, `pdtf-users-staging`. All staging keys use SOFTWARE protection (no HSM costs for dev/test).

### 2.2 Terraform Module: `pdtf-kms`

All KMS resources are managed via Terraform. No manual key creation.

```hcl
# modules/pdtf-kms/variables.tf

variable "environment" {
  type        = string
  description = "prod or staging"
  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "Must be prod or staging."
  }
}

variable "region" {
  type    = string
  default = "europe-west2"
}

variable "adapters" {
  type = list(object({
    id          = string  # e.g. "hmlr", "epc", "ea-flood"
    description = string
  }))
  description = "List of adapters to provision keys for"
}

variable "hsm_protection" {
  type        = bool
  description = "Use HSM protection (prod=true, staging=false)"
}
```

```hcl
# modules/pdtf-kms/adapter-keys.tf

resource "google_kms_key_ring" "adapter" {
  for_each = { for a in var.adapters : a.id => a }

  name     = "${each.key}-adapter"
  location = var.region
  project  = "pdtf-adapters-${var.environment}"
}

resource "google_kms_crypto_key" "adapter_signing" {
  for_each = { for a in var.adapters : a.id => a }

  name     = "${each.key}-proxy-signing-key"
  key_ring = google_kms_key_ring.adapter[each.key].id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_ED25519"
    protection_level = var.hsm_protection ? "HSM" : "SOFTWARE"
  }

  destroy_scheduled_duration = "2592000s"  # 30 days

  labels = {
    pdtf_key_category = "adapter"
    adapter_id        = each.key
    environment       = var.environment
  }
}
```

```hcl
# modules/pdtf-kms/platform-keys.tf

resource "google_kms_key_ring" "platform" {
  name     = "platform"
  location = var.region
  project  = "pdtf-platform-${var.environment}"
}

resource "google_kms_crypto_key" "platform_signing" {
  name     = "moverly-platform-signing-key"
  key_ring = google_kms_key_ring.platform.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_ED25519"
    protection_level = var.hsm_protection ? "HSM" : "SOFTWARE"
  }

  destroy_scheduled_duration = "2592000s"

  labels = {
    pdtf_key_category = "platform"
    environment       = var.environment
  }
}

# Status list signing key: NOT provisioned separately.
# Status list VCs are signed with the same adapter/platform key used for
# VC issuance (not a separate key). This aligns with W3C Bitstring Status
# List convention where the status list VC issuer matches the credential issuer.
```

```hcl
# modules/pdtf-kms/user-keys.tf

# User keys share a single key ring.
# Individual keys are created dynamically by the key-manager service
# at user onboarding time — not via Terraform.

resource "google_kms_key_ring" "user_keys" {
  name     = "user-keys"
  location = var.region
  project  = "pdtf-users-${var.environment}"
}
```

```hcl
# modules/pdtf-kms/iam.tf

# Adapter service accounts: one per adapter, can only sign with own key
resource "google_kms_crypto_key_iam_member" "adapter_signer" {
  for_each = { for a in var.adapters : a.id => a }

  crypto_key_id = google_kms_crypto_key.adapter_signing[each.key].id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${each.key}-adapter@pdtf-adapters-${var.environment}.iam.gserviceaccount.com"
}

# DID resolver: read-only public key access across all adapter keys
resource "google_kms_key_ring_iam_member" "adapter_public_key_reader" {
  for_each = { for a in var.adapters : a.id => a }

  key_ring_id = google_kms_key_ring.adapter[each.key].id
  role        = "roles/cloudkms.publicKeyViewer"
  member      = "serviceAccount:did-resolver@pdtf-adapters-${var.environment}.iam.gserviceaccount.com"
}

# Credential service: can sign with any user key
resource "google_kms_key_ring_iam_member" "user_key_signer" {
  key_ring_id = google_kms_key_ring.user_keys.id
  role        = "roles/cloudkms.signerVerifier"
  member      = "serviceAccount:credential-service@pdtf-users-${var.environment}.iam.gserviceaccount.com"
}

# Platform service: signs TIR and platform attestations
resource "google_kms_crypto_key_iam_member" "platform_signer" {
  crypto_key_id = google_kms_crypto_key.platform_signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:platform-service@pdtf-platform-${var.environment}.iam.gserviceaccount.com"
}

# Status list signing: no separate IAM binding needed.
# Status list VCs are signed with the same adapter/platform key used for
# credential issuance. Each adapter's service account (above) and the
# platform service account already have signing permission on their
# respective keys, which are also used to sign their status lists.
```

```hcl
# environments/prod/kms.tf

module "pdtf_kms" {
  source = "../../modules/pdtf-kms"

  environment    = "prod"
  region         = "europe-west2"
  hsm_protection = true

  adapters = [
    { id = "hmlr",       description = "HM Land Registry" },
    { id = "epc",        description = "Energy Performance Certificates" },
    { id = "ea-flood",   description = "Environment Agency Flood Data" },
    { id = "local-auth", description = "Local Authority Searches" },
    { id = "os",         description = "Ordnance Survey Places API" },
  ]
}
```

### 2.3 Monitoring & Alerting

Terraform also provisions Cloud Monitoring alert policies:

```hcl
# modules/pdtf-kms/monitoring.tf

resource "google_monitoring_alert_policy" "kms_key_destruction" {
  display_name = "KMS Key Destruction Attempted"
  project      = "pdtf-platform-${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "Key version destruction scheduled"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloudkms_cryptokeyversion"
        protoPayload.methodName="ScheduleDestroyCryptoKeyVersion"
      EOT
    }
  }

  notification_channels = var.alert_channels
  alert_strategy {
    auto_close = "604800s"  # 7 days
  }
}

resource "google_monitoring_alert_policy" "kms_signing_anomaly" {
  display_name = "KMS Signing Rate Anomaly"
  project      = "pdtf-platform-${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "Signing rate spike"
    condition_threshold {
      filter = <<-EOT
        resource.type="cloudkms_cryptokeyversion"
        metric.type="serviceruntime.googleapis.com/api/request_count"
        resource.label.method="AsymmetricSign"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 500  # per minute — 10x normal
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = var.alert_channels
}

resource "google_monitoring_alert_policy" "kms_iam_change" {
  display_name = "KMS IAM Policy Changed"
  project      = "pdtf-platform-${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "IAM policy set on KMS resource"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloudkms_cryptokey" OR resource.type="cloudkms_keyring"
        protoPayload.methodName="SetIamPolicy"
      EOT
    }
  }

  notification_channels = var.alert_channels
}
```

---

## 3. `@pdtf/key-manager` Service

The key-manager is a TypeScript package that encapsulates all KMS operations. It is consumed by the credential service (signing), the DID resolver (public key retrieval), and the onboarding service (user key creation).

### 3.1 Package Structure

```
packages/key-manager/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── key-provider.ts          # KeyProvider interface (strategy pattern)
│   ├── firestore-key-provider.ts # Dev/staging: local Ed25519 keys in Firestore
│   ├── kms-key-provider.ts      # Production: GCP Cloud KMS wrapper
│   ├── create-key-provider.ts   # Factory with environment safety guard
│   ├── did-key.ts               # did:key derivation from Ed25519 public key
│   ├── did-web.ts               # did:web document construction
│   ├── signer.ts                # VC signing (canonicalize → hash → sign via KeyProvider)
│   ├── verifier.ts              # VC verification (resolve DID → verify Ed25519)
│   ├── user-key-provisioner.ts  # Create user keys at onboarding
│   ├── key-metadata.ts          # Firestore key metadata CRUD
│   ├── types.ts                 # Shared type definitions
│   └── constants.ts             # Algorithm constants, key paths
├── test/
│   ├── signer.test.ts
│   ├── verifier.test.ts
│   ├── did-key.test.ts
│   ├── did-web.test.ts
│   ├── user-key-provisioner.test.ts
│   ├── firestore-key-provider.test.ts
│   └── fixtures/                # Test VCs, keys, DID documents
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 Core Types

```typescript
// src/types.ts

/** Key categories as defined in Sub-spec 06 §3 */
export type KeyCategory = 'adapter' | 'user' | 'platform';

/** Protection level maps to GCP KMS protection */
export type ProtectionLevel = 'HSM' | 'SOFTWARE';

/** Fully-qualified KMS key version path */
export type KmsKeyVersionPath = string;
// e.g. "projects/pdtf-adapters-prod/locations/europe-west2/keyRings/hmlr-adapter/cryptoKeys/hmlr-proxy-signing-key/cryptoKeyVersions/2"

/** Key metadata stored in Firestore */
export interface KeyMetadata {
  /** Firestore document ID (auto-generated or user UID for user keys) */
  id: string;

  /** Key category (status list VCs use the issuer's own key — no separate category) */
  category: KeyCategory;

  /** DID associated with this key */
  did: string;

  /** Full KMS key resource path (without /cryptoKeyVersions) */
  kmsKeyPath: string;

  /** Active KMS key version number */
  activeVersion: number;

  /** All version numbers (for DID document construction) */
  versions: KeyVersionMetadata[];

  /** Adapter ID (only for category=adapter) */
  adapterId?: string;

  /** Firebase UID (only for category=user) */
  userId?: string;

  /** Key creation timestamp */
  createdAt: FirebaseFirestore.Timestamp;

  /** Last rotation timestamp */
  lastRotatedAt?: FirebaseFirestore.Timestamp;

  /** Key status */
  status: 'active' | 'rotating' | 'compromised' | 'disabled';
}

export interface KeyVersionMetadata {
  /** KMS version number */
  version: number;

  /** Base58btc-encoded public key (multibase with 'z' prefix) */
  publicKeyMultibase: string;

  /** Raw 32-byte public key as hex */
  publicKeyHex: string;

  /** When this version was created */
  createdAt: FirebaseFirestore.Timestamp;

  /** Whether this version is the current signing key */
  isPrimary: boolean;

  /** Whether this version has been disabled (post-rotation or compromise) */
  disabled: boolean;
}

/** DID document following W3C DID Core spec */
export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  assertionMethod: string[];
  authentication?: string[];
  service?: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: 'Ed25519VerificationKey2020';
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/** Key provider backend selection */
export type KeyProviderType = 'firestore' | 'kms';

/** Options for signing a credential */
export interface SignOptions {
  /** Which key to sign with (resolved from category + ID) */
  keyCategory: KeyCategory;
  /** Adapter ID, user ID, or omit for platform */
  entityId?: string;
  /** Override KMS key version (default: primary) */
  keyVersion?: number;
}

/** Result of a verification operation */
export interface VerificationResult {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    issuerTrusted: boolean | null;  // null = TIR check skipped
    notRevoked: boolean | null;     // null = revocation check skipped
    proofPurposeValid: boolean;
  };
  error?: string;
  /** DID that signed the credential */
  signerDid: string;
  /** Key version used */
  keyId: string;
}
```

### 3.3 Key Provider Strategy

The `KeyProvider` interface abstracts all cryptographic operations behind a strategy pattern. Two implementations exist: `FirestoreKeyProvider` for dev/staging (zero-cost, zero-setup) and `KmsKeyProvider` for production (HSM-backed). All upstream consumers — signer, provisioner, DID document builder — depend only on the interface.

```typescript
// src/key-provider.ts

/**
 * Abstract interface for key storage and signing.
 * Implementations: FirestoreKeyProvider (dev), KmsKeyProvider (prod).
 */
export interface KeyProvider {
  /** Provider type for logging/diagnostics */
  readonly type: KeyProviderType;

  /**
   * Sign raw bytes with the specified key version.
   * For Ed25519: input is the final digest (proofHash || vcHash → SHA-256),
   * and the provider performs the Ed25519 signature internally.
   */
  sign(keyVersionPath: string, data: Uint8Array): Promise<Uint8Array>;

  /**
   * Get the public key for a key version.
   * Returns raw 32-byte Ed25519 key and multibase-encoded form.
   */
  getPublicKey(keyVersionPath: string): Promise<{
    raw: Uint8Array;
    multibase: string;
  }>;

  /**
   * Create a new Ed25519 key.
   * Returns a provider-specific key path and first version path.
   */
  createKey(params: {
    project: string;
    location: string;
    keyRingId: string;
    keyId: string;
    protectionLevel: 'HSM' | 'SOFTWARE';
    labels?: Record<string, string>;
  }): Promise<{ keyPath: string; versionPath: string }>;

  /**
   * Create a new version for an existing key (rotation).
   */
  createKeyVersion(keyPath: string): Promise<{
    versionPath: string;
    versionNumber: number;
  }>;

  /**
   * Set the primary (active signing) version of a key.
   */
  setPrimaryVersion(keyPath: string, versionId: number): Promise<void>;

  /**
   * Disable a key version (compromise or decommission).
   */
  disableKeyVersion(versionPath: string): Promise<void>;
}
```

### 3.3.1 Factory & Safety Guard

```typescript
// src/create-key-provider.ts

import type { KeyProvider, KeyProviderType } from './types.js';
import { FirestoreKeyProvider } from './firestore-key-provider.js';
import { KmsKeyProvider } from './kms-key-provider.js';

/**
 * Create the appropriate KeyProvider based on configuration.
 *
 * SAFETY: FirestoreKeyProvider is blocked in production. This is enforced
 * at construction time — not just by convention — so a misconfigured
 * deployment cannot accidentally use insecure key storage.
 */
export function createKeyProvider(config: {
  type: KeyProviderType;
  environment: string;
}): KeyProvider {
  if (config.type === 'firestore' && config.environment === 'production') {
    throw new Error(
      'FATAL: FirestoreKeyProvider cannot be used in production. '
      + 'Set KEY_PROVIDER=kms for production deployments.'
    );
  }

  if (config.type === 'firestore') {
    console.warn(
      '⚠️  Using FirestoreKeyProvider — private keys stored in Firestore. '
      + 'This is NOT production-safe. Acceptable for dev/staging only.'
    );
    return new FirestoreKeyProvider();
  }

  return new KmsKeyProvider();
}
```

Environment configuration:

```yaml
# config/staging.yaml
keyProvider: firestore   # dev/staging — zero cost, zero setup

# config/production.yaml
keyProvider: kms          # production — GCP Cloud KMS, HSM-backed
```

CI enforcement (in addition to the runtime check):

```yaml
# .github/workflows/deploy-production.yml (excerpt)
- name: Verify key provider config
  run: |
    PROVIDER=$(grep keyProvider config/production.yaml | awk '{print $2}')
    if [ "$PROVIDER" != "kms" ]; then
      echo "FATAL: Production must use kms key provider, got: $PROVIDER"
      exit 1
    fi
```

### 3.3.2 `FirestoreKeyProvider` (Dev/Staging)

Generates and stores Ed25519 private keys directly in Firestore. Uses `@noble/ed25519` for all cryptographic operations — no external dependencies, no cloud API calls, no cost.

**Security posture:** Firestore's default encryption-at-rest (Google-managed AES-256) protects keys on disk, but any service with Firestore read access can extract private key material. This is explicitly accepted for dev/staging. The runtime safety guard (§3.3.1) prevents production use.

```typescript
// src/firestore-key-provider.ts

import { ed25519 } from '@noble/curves/ed25519';
import { base58btc } from 'multiformats/bases/base58';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { KeyProvider, KeyProviderType } from './types.js';

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Stores Ed25519 private keys in Firestore.
 * Zero cost, zero setup — but NOT production-safe.
 *
 * Key material is stored in the `pdtfKeyMaterial` collection,
 * separate from key metadata in `pdtfKeys`. This collection
 * exists ONLY in dev/staging Firestore instances.
 *
 * Firestore security rules MUST block client-side reads of pdtfKeyMaterial.
 */
export class FirestoreKeyProvider implements KeyProvider {
  readonly type: KeyProviderType = 'firestore';
  private db = getFirestore();

  /** In-memory cache: key version path → { privateKey, publicKey } */
  private keyCache = new Map<string, {
    privateKey: Uint8Array;
    publicKeyRaw: Uint8Array;
    publicKeyMultibase: string;
  }>();

  async sign(keyVersionPath: string, data: Uint8Array): Promise<Uint8Array> {
    const keys = await this.loadKeys(keyVersionPath);
    return ed25519.sign(data, keys.privateKey);
  }

  async getPublicKey(keyVersionPath: string): Promise<{
    raw: Uint8Array;
    multibase: string;
  }> {
    const keys = await this.loadKeys(keyVersionPath);
    return { raw: keys.publicKeyRaw, multibase: keys.publicKeyMultibase };
  }

  async createKey(params: {
    project: string;
    location: string;
    keyRingId: string;
    keyId: string;
    protectionLevel: 'HSM' | 'SOFTWARE';
    labels?: Record<string, string>;
  }): Promise<{ keyPath: string; versionPath: string }> {
    // Generate Ed25519 keypair locally
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(privateKey);

    // Build a synthetic KMS-like path for consistency
    const keyPath = `projects/${params.project}/locations/${params.location}`
      + `/keyRings/${params.keyRingId}/cryptoKeys/${params.keyId}`;
    const versionPath = `${keyPath}/cryptoKeyVersions/1`;

    // Encode public key as multibase
    const multicodecKey = new Uint8Array(2 + publicKey.length);
    multicodecKey.set(ED25519_MULTICODEC_PREFIX);
    multicodecKey.set(publicKey, 2);
    const multibase = base58btc.encode(multicodecKey);

    // Store private key material in Firestore
    await this.db.collection('pdtfKeyMaterial').doc(this.pathToDocId(versionPath)).set({
      keyPath,
      versionPath,
      privateKey: Buffer.from(privateKey).toString('hex'),
      publicKey: Buffer.from(publicKey).toString('hex'),
      publicKeyMultibase: multibase,
      protectionLevel: 'FIRESTORE_LOCAL',  // clearly not HSM
      createdAt: FieldValue.serverTimestamp(),
      labels: params.labels || {},
    });

    // Cache locally
    this.keyCache.set(versionPath, {
      privateKey,
      publicKeyRaw: publicKey,
      publicKeyMultibase: multibase,
    });

    return { keyPath, versionPath };
  }

  async createKeyVersion(keyPath: string): Promise<{
    versionPath: string;
    versionNumber: number;
  }> {
    // Find the highest existing version for this key
    const existing = await this.db.collection('pdtfKeyMaterial')
      .where('keyPath', '==', keyPath)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    const lastVersion = existing.empty ? 0 :
      parseInt(existing.docs[0].data().versionPath.split('/').pop()!, 10);
    const newVersion = lastVersion + 1;
    const versionPath = `${keyPath}/cryptoKeyVersions/${newVersion}`;

    // Generate new keypair
    const privateKey = ed25519.utils.randomPrivateKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const multicodecKey = new Uint8Array(2 + publicKey.length);
    multicodecKey.set(ED25519_MULTICODEC_PREFIX);
    multicodecKey.set(publicKey, 2);
    const multibase = base58btc.encode(multicodecKey);

    await this.db.collection('pdtfKeyMaterial').doc(this.pathToDocId(versionPath)).set({
      keyPath,
      versionPath,
      privateKey: Buffer.from(privateKey).toString('hex'),
      publicKey: Buffer.from(publicKey).toString('hex'),
      publicKeyMultibase: multibase,
      protectionLevel: 'FIRESTORE_LOCAL',
      createdAt: FieldValue.serverTimestamp(),
    });

    this.keyCache.set(versionPath, {
      privateKey,
      publicKeyRaw: publicKey,
      publicKeyMultibase: multibase,
    });

    return { versionPath, versionNumber: newVersion };
  }

  async setPrimaryVersion(_keyPath: string, _versionId: number): Promise<void> {
    // For Firestore provider, "primary" is tracked in key metadata (pdtfKeys),
    // not in the key material store. This is a no-op at the provider level —
    // the UserKeyProvisioner/KeyMetadataStore handles primary tracking.
  }

  async disableKeyVersion(versionPath: string): Promise<void> {
    await this.db.collection('pdtfKeyMaterial').doc(this.pathToDocId(versionPath)).update({
      disabled: true,
      disabledAt: FieldValue.serverTimestamp(),
    });
    this.keyCache.delete(versionPath);
  }

  /**
   * Load keys from cache or Firestore.
   */
  private async loadKeys(versionPath: string) {
    const cached = this.keyCache.get(versionPath);
    if (cached) return cached;

    const doc = await this.db.collection('pdtfKeyMaterial')
      .doc(this.pathToDocId(versionPath)).get();

    if (!doc.exists) {
      throw new Error(`Key not found in Firestore: ${versionPath}`);
    }

    const data = doc.data()!;
    if (data.disabled) {
      throw new Error(`Key version is disabled: ${versionPath}`);
    }

    const privateKey = new Uint8Array(Buffer.from(data.privateKey, 'hex'));
    const publicKeyRaw = new Uint8Array(Buffer.from(data.publicKey, 'hex'));

    const entry = {
      privateKey,
      publicKeyRaw,
      publicKeyMultibase: data.publicKeyMultibase as string,
    };

    this.keyCache.set(versionPath, entry);
    return entry;
  }

  /**
   * Convert a KMS-style path to a valid Firestore document ID.
   * Firestore IDs can't contain '/' so we replace with '__'.
   */
  private pathToDocId(path: string): string {
    return path.replace(/\//g, '__');
  }
}
```

### 3.3.3 `KmsKeyProvider` (Production)

The production implementation — wraps GCP Cloud KMS. Identical API surface to `FirestoreKeyProvider` but delegates all cryptographic operations to Cloud KMS HSMs.

```typescript
// src/kms-key-provider.ts

import { KeyManagementServiceClient } from '@google-cloud/kms';
import { base58btc } from 'multiformats/bases/base58';
import type { KeyProvider, KeyProviderType, KmsKeyVersionPath } from './types.js';

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

export class KmsKeyProvider implements KeyProvider {
  readonly type: KeyProviderType = 'kms';
  private client: KeyManagementServiceClient;

  /** In-memory cache: KMS key version path → public key bytes */
  private publicKeyCache = new Map<string, {
    raw: Uint8Array;
    multibase: string;
    expiresAt: number;
  }>();

  private static readonly CACHE_TTL_MS = 3600_000; // 1 hour

  constructor() {
    this.client = new KeyManagementServiceClient();
  }

  /**
   * Sign a digest using KMS.
   *
   * IMPORTANT: For Ed25519 in Cloud KMS, we pass the raw message bytes
   * (the proof hash from eddsa-jcs-2022), NOT a pre-hashed digest.
   * KMS performs the Ed25519 signing internally (which includes SHA-512).
   */
  async sign(keyVersionPath: KmsKeyVersionPath, data: Uint8Array): Promise<Uint8Array> {
    const [response] = await this.client.asymmetricSign({
      name: keyVersionPath,
      data: Buffer.from(data),
    });

    if (!response.signature) {
      throw new Error(`KMS sign returned empty signature for ${keyVersionPath}`);
    }

    return new Uint8Array(response.signature as ArrayBuffer);
  }

  /**
   * Get the public key for a KMS key version.
   * Returns both raw bytes and multibase-encoded form.
   * Cached for 1 hour.
   */
  async getPublicKey(keyVersionPath: KmsKeyVersionPath): Promise<{
    raw: Uint8Array;
    multibase: string;
  }> {
    const cached = this.publicKeyCache.get(keyVersionPath);
    if (cached && cached.expiresAt > Date.now()) {
      return { raw: cached.raw, multibase: cached.multibase };
    }

    const [response] = await this.client.getPublicKey({
      name: keyVersionPath,
    });

    if (!response.pem) {
      throw new Error(`KMS returned empty public key for ${keyVersionPath}`);
    }

    // Parse PEM to extract raw 32-byte Ed25519 public key
    const raw = this.pemToRawEd25519(response.pem);

    // Encode as multibase (multicodec prefix + raw key → base58btc)
    const multicodecKey = new Uint8Array(2 + raw.length);
    multicodecKey.set(ED25519_MULTICODEC_PREFIX);
    multicodecKey.set(raw, 2);
    const multibase = base58btc.encode(multicodecKey);

    this.publicKeyCache.set(keyVersionPath, {
      raw,
      multibase,
      expiresAt: Date.now() + KmsKeyProvider.CACHE_TTL_MS,
    });

    return { raw, multibase };
  }

  /**
   * Create a new Ed25519 key in an existing key ring.
   * Used for user key provisioning at onboarding.
   */
  async createKey(params: {
    project: string;
    location: string;
    keyRingId: string;
    keyId: string;
    protectionLevel: 'HSM' | 'SOFTWARE';
    labels?: Record<string, string>;
  }): Promise<{ keyPath: string; versionPath: string }> {
    const parent = `projects/${params.project}/locations/${params.location}/keyRings/${params.keyRingId}`;

    const [key] = await this.client.createCryptoKey({
      parent,
      cryptoKeyId: params.keyId,
      cryptoKey: {
        purpose: 'ASYMMETRIC_SIGN',
        versionTemplate: {
          algorithm: 'EC_SIGN_ED25519',
          protectionLevel: params.protectionLevel,
        },
        destroyScheduledDuration: { seconds: 2592000 }, // 30 days
        labels: params.labels,
      },
    });

    if (!key.name) {
      throw new Error('KMS createCryptoKey returned no name');
    }

    return {
      keyPath: key.name,
      versionPath: `${key.name}/cryptoKeyVersions/1`,
    };
  }

  /**
   * Create a new key version for rotation.
   * Returns the new version path.
   */
  async createKeyVersion(keyPath: string): Promise<{
    versionPath: string;
    versionNumber: number;
  }> {
    const [version] = await this.client.createCryptoKeyVersion({
      parent: keyPath,
    });

    if (!version.name) {
      throw new Error('KMS createCryptoKeyVersion returned no name');
    }

    // Extract version number from path
    const versionNumber = parseInt(version.name.split('/').pop()!, 10);

    return { versionPath: version.name, versionNumber };
  }

  /**
   * Update the primary version of a key (used during rotation).
   */
  async setPrimaryVersion(keyPath: string, versionId: number): Promise<void> {
    await this.client.updateCryptoKeyPrimaryVersion({
      name: keyPath,
      cryptoKeyVersionId: String(versionId),
    });
  }

  /**
   * Disable a key version (compromise or decommission).
   */
  async disableKeyVersion(versionPath: string): Promise<void> {
    await this.client.updateCryptoKeyVersion({
      cryptoKeyVersion: {
        name: versionPath,
        state: 'DISABLED',
      },
      updateMask: { paths: ['state'] },
    });
  }

  /**
   * Parse a PEM-encoded Ed25519 public key to raw 32-byte key.
   * Google Cloud KMS returns Ed25519 public keys in PKCS#8/SPKI PEM format.
   */
  private pemToRawEd25519(pem: string): Uint8Array {
    // Strip PEM headers and decode base64
    const b64 = pem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const der = Buffer.from(b64, 'base64');

    // Ed25519 SPKI structure:
    // SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING { raw key } }
    // The raw 32-byte key is the last 32 bytes of the DER encoding.
    // (The BIT STRING wrapper adds a leading 0x00 byte for "unused bits".)
    if (der.length !== 44) {
      throw new Error(`Unexpected Ed25519 SPKI length: ${der.length} (expected 44)`);
    }
    return new Uint8Array(der.subarray(12)); // Skip 12-byte SPKI header
  }
}
```

### 3.4 `did:key` Derivation

```typescript
// src/did-key.ts

import { base58btc } from 'multiformats/bases/base58';

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/**
 * Derive a did:key identifier from a raw Ed25519 public key.
 *
 * did:key encodes the public key directly in the identifier:
 *   z6Mk... = multibase(base58btc, multicodec(ed25519) || rawPubKey)
 *
 * @param publicKey Raw 32-byte Ed25519 public key
 * @returns did:key:z6Mk... string
 */
export function publicKeyToDidKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }

  const multicodecKey = new Uint8Array(2 + publicKey.length);
  multicodecKey.set(ED25519_MULTICODEC_PREFIX);
  multicodecKey.set(publicKey, 2);

  // base58btc.encode includes the 'z' multibase prefix
  const encoded = base58btc.encode(multicodecKey);
  return `did:key:${encoded}`;
}

/**
 * Extract the raw Ed25519 public key from a did:key identifier.
 *
 * @param didKey did:key:z6Mk... string
 * @returns Raw 32-byte Ed25519 public key
 */
export function didKeyToPublicKey(didKey: string): Uint8Array {
  if (!didKey.startsWith('did:key:z6Mk')) {
    throw new Error(
      `Expected Ed25519 did:key (z6Mk prefix), got: ${didKey.slice(0, 20)}...`
    );
  }

  const multibaseEncoded = didKey.slice('did:key:'.length);
  const decoded = base58btc.decode(multibaseEncoded);

  // Verify multicodec prefix
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Invalid multicodec prefix for Ed25519');
  }

  return decoded.slice(2);
}

/**
 * Construct a synthetic DID document for a did:key.
 * did:key is self-resolving — the document is deterministic from the identifier.
 */
export function resolveDidKey(didKey: string): {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  assertionMethod: string[];
  authentication: string[];
} {
  const multibaseKey = didKey.slice('did:key:'.length);
  const keyId = `${didKey}#${multibaseKey}`;

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: didKey,
    verificationMethod: [{
      id: keyId,
      type: 'Ed25519VerificationKey2020',
      controller: didKey,
      publicKeyMultibase: multibaseKey,
    }],
    assertionMethod: [keyId],
    authentication: [keyId],
  };
}
```

### 3.5 `did:web` Document Construction

```typescript
// src/did-web.ts

import type { DidDocument, KeyVersionMetadata, ServiceEndpoint } from './types.js';

/**
 * Construct a DID document for a did:web identifier from key version metadata.
 *
 * The DID document includes all non-disabled key versions in verificationMethod
 * (so old credentials remain verifiable) but only the primary version in
 * assertionMethod (so new credentials use the current key).
 */
export function constructDidWebDocument(params: {
  did: string;
  versions: KeyVersionMetadata[];
  serviceEndpoints?: ServiceEndpoint[];
}): DidDocument {
  const { did, versions, serviceEndpoints } = params;

  // Sort: primary first, then by version descending
  const sorted = [...versions]
    .filter(v => !v.disabled)
    .sort((a, b) => {
      if (a.isPrimary) return -1;
      if (b.isPrimary) return 1;
      return b.version - a.version;
    });

  if (sorted.length === 0) {
    throw new Error(`No active key versions for ${did}`);
  }

  const verificationMethod = sorted.map(v => ({
    id: `${did}#key-${v.version}`,
    type: 'Ed25519VerificationKey2020' as const,
    controller: did,
    publicKeyMultibase: v.publicKeyMultibase,
  }));

  const primary = sorted.find(v => v.isPrimary) ?? sorted[0];

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod,
    assertionMethod: [`${did}#key-${primary.version}`],
    ...(serviceEndpoints?.length ? { service: serviceEndpoints } : {}),
  };
}

/**
 * Convert a did:web to its HTTPS resolution URL.
 *
 * did:web:example.com          → https://example.com/.well-known/did.json
 * did:web:example.com:path:sub → https://example.com/path/sub/did.json
 */
export function didWebToUrl(did: string): string {
  if (!did.startsWith('did:web:')) {
    throw new Error(`Not a did:web: ${did}`);
  }

  const parts = did.slice('did:web:'.length).split(':');
  const domain = decodeURIComponent(parts[0]);

  if (parts.length === 1) {
    return `https://${domain}/.well-known/did.json`;
  }

  const path = parts.slice(1).map(decodeURIComponent).join('/');
  return `https://${domain}/${path}/did.json`;
}
```

### 3.6 VC Signer

```typescript
// src/signer.ts

import { canonicalize } from 'json-canonicalize';
import { sha256 } from '@noble/hashes/sha256';
import { base58btc } from 'multiformats/bases/base58';
import type { KeyProvider } from './key-provider.js';
import { KeyMetadataStore } from './key-metadata.js';
import type { SignOptions } from './types.js';

export class VcSigner {
  constructor(
    private keyProvider: KeyProvider,
    private keyStore: KeyMetadataStore,
  ) {}

  /**
   * Sign an unsigned VC using the eddsa-jcs-2022 cryptosuite.
   *
   * @param vc Unsigned VC (must not contain a `proof` field)
   * @param options Which key to sign with
   * @returns The VC with an attached DataIntegrityProof
   */
  async sign(
    vc: Record<string, unknown>,
    options: SignOptions,
  ): Promise<Record<string, unknown>> {
    if ('proof' in vc) {
      throw new Error('VC already has a proof — cannot re-sign');
    }

    // 1. Resolve the signing key
    const keyMeta = await this.keyStore.resolveKey(options);
    const activeVersion = keyMeta.versions.find(v =>
      options.keyVersion
        ? v.version === options.keyVersion
        : v.isPrimary
    );
    if (!activeVersion) {
      throw new Error(`No active key version for ${keyMeta.did}`);
    }

    const versionPath = `${keyMeta.kmsKeyPath}/cryptoKeyVersions/${activeVersion.version}`;
    const verificationMethodId = keyMeta.did.startsWith('did:key:')
      ? `${keyMeta.did}#${keyMeta.did.slice('did:key:'.length)}`
      : `${keyMeta.did}#key-${activeVersion.version}`;

    // 2. Construct proof options (without proofValue)
    const proofOptions = {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      verificationMethod: verificationMethodId,
      created: new Date().toISOString(),
      proofPurpose: 'assertionMethod',
    };

    // 3. Canonicalize VC and proof options independently (JCS / RFC 8785)
    const canonicalVc = canonicalize(vc);
    const canonicalProof = canonicalize(proofOptions);

    // 4. Hash both with SHA-256
    const vcHash = sha256(new TextEncoder().encode(canonicalVc));
    const proofHash = sha256(new TextEncoder().encode(canonicalProof));

    // 5. Combine: proofHash || vcHash → SHA-256
    const combined = new Uint8Array(64);
    combined.set(proofHash, 0);
    combined.set(vcHash, 32);
    const finalDigest = sha256(combined);

    // 6. Sign via KeyProvider (KMS in prod, Firestore in dev)
    const signature = await this.keyProvider.sign(versionPath, finalDigest);

    // 7. Encode as multibase base58btc
    const proofValue = base58btc.encode(signature);

    // 8. Return signed VC
    return {
      ...vc,
      proof: {
        ...proofOptions,
        proofValue,
      },
    };
  }
}
```

### 3.7 VC Verifier

```typescript
// src/verifier.ts

import { canonicalize } from 'json-canonicalize';
import { sha256 } from '@noble/hashes/sha256';
import { base58btc } from 'multiformats/bases/base58';
import { ed25519 } from '@noble/curves/ed25519';
import { resolveDidKey, didKeyToPublicKey } from './did-key.js';
import { didWebToUrl } from './did-web.js';
import type { VerificationResult, DidDocument } from './types.js';

export class VcVerifier {
  private didWebCache = new Map<string, { doc: DidDocument; expiresAt: number }>();
  private static readonly DID_WEB_CACHE_TTL_MS = 3600_000; // 1 hour

  /**
   * Verify a signed VC.
   *
   * This is a pure cryptographic verification — no KMS access needed.
   * It can run anywhere: on our backend, on a relying party's server,
   * or in a browser.
   *
   * @param signedVc VC with proof
   * @param options Optional: skip TIR or revocation checks
   */
  async verify(
    signedVc: Record<string, unknown>,
    options?: {
      skipTirCheck?: boolean;
      skipRevocationCheck?: boolean;
      tirChecker?: (issuer: string, types: string[]) => Promise<boolean>;
      revocationChecker?: (status: Record<string, unknown>) => Promise<boolean>;
    },
  ): Promise<VerificationResult> {
    const proof = signedVc.proof as Record<string, unknown> | undefined;

    // 1. Validate proof exists and is correct type
    if (!proof || proof.type !== 'DataIntegrityProof') {
      return this.fail('Missing or unsupported proof type', '', '');
    }
    if (proof.cryptosuite !== 'eddsa-jcs-2022') {
      return this.fail('Unsupported cryptosuite', '', '');
    }

    const verificationMethodId = proof.verificationMethod as string;
    const proofValue = proof.proofValue as string;

    // 2. Resolve DID → public key
    const didId = verificationMethodId.split('#')[0];
    let publicKey: Uint8Array;

    try {
      if (didId.startsWith('did:key:')) {
        publicKey = didKeyToPublicKey(didId);
      } else if (didId.startsWith('did:web:')) {
        const didDoc = await this.resolveDidWeb(didId);
        const vm = didDoc.verificationMethod.find(
          m => m.id === verificationMethodId,
        );
        if (!vm) {
          return this.fail(
            `Verification method ${verificationMethodId} not in DID document`,
            didId, verificationMethodId,
          );
        }
        // Check assertionMethod authorisation (skip for did:key — implicit)
        if (!didDoc.assertionMethod?.includes(verificationMethodId)) {
          // Allow if the key was a previous primary (retained for verification)
          // but flag that it's not the current signing key
        }
        const decoded = base58btc.decode(vm.publicKeyMultibase);
        publicKey = decoded.slice(2); // strip multicodec prefix
      } else {
        return this.fail(`Unsupported DID method: ${didId}`, didId, verificationMethodId);
      }
    } catch (err) {
      return this.fail(
        `DID resolution failed: ${(err as Error).message}`,
        didId, verificationMethodId,
      );
    }

    // 3. Reconstruct the signed data (same as signing flow)
    const { proof: _proof, ...vcWithoutProof } = signedVc;
    const { proofValue: _pv, ...proofOptions } = proof;

    const canonicalVc = canonicalize(vcWithoutProof);
    const canonicalProof = canonicalize(proofOptions);

    const vcHash = sha256(new TextEncoder().encode(canonicalVc));
    const proofHash = sha256(new TextEncoder().encode(canonicalProof));
    const combined = new Uint8Array(64);
    combined.set(proofHash, 0);
    combined.set(vcHash, 32);
    const finalDigest = sha256(combined);

    // 4. Verify Ed25519 signature
    const signatureBytes = base58btc.decode(proofValue);
    let signatureValid: boolean;
    try {
      signatureValid = ed25519.verify(signatureBytes, finalDigest, publicKey);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return {
        valid: false,
        checks: {
          signatureValid: false,
          issuerTrusted: null,
          notRevoked: null,
          proofPurposeValid: true,
        },
        error: 'Ed25519 signature verification failed',
        signerDid: didId,
        keyId: verificationMethodId,
      };
    }

    // 5. TIR check (optional)
    let issuerTrusted: boolean | null = null;
    if (!options?.skipTirCheck && options?.tirChecker) {
      const issuer = signedVc.issuer as string;
      const types = signedVc.type as string[];
      issuerTrusted = await options.tirChecker(issuer, types);
    }

    // 6. Revocation check (optional)
    let notRevoked: boolean | null = null;
    if (!options?.skipRevocationCheck && options?.revocationChecker) {
      const status = signedVc.credentialStatus as Record<string, unknown> | undefined;
      notRevoked = status ? await options.revocationChecker(status) : true;
    }

    return {
      valid: signatureValid && (issuerTrusted ?? true) && (notRevoked ?? true),
      checks: {
        signatureValid,
        issuerTrusted,
        notRevoked,
        proofPurposeValid: true,
      },
      signerDid: didId,
      keyId: verificationMethodId,
    };
  }

  /** Resolve a did:web to its DID document via HTTPS. */
  private async resolveDidWeb(did: string): Promise<DidDocument> {
    const cached = this.didWebCache.get(did);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.doc;
    }

    const url = didWebToUrl(did);
    const response = await fetch(url, {
      headers: { Accept: 'application/did+json, application/json' },
    });

    if (!response.ok) {
      throw new Error(`did:web resolution failed: ${response.status} ${url}`);
    }

    const doc = (await response.json()) as DidDocument;

    this.didWebCache.set(did, {
      doc,
      expiresAt: Date.now() + VcVerifier.DID_WEB_CACHE_TTL_MS,
    });

    return doc;
  }

  private fail(error: string, signerDid: string, keyId: string): VerificationResult {
    return {
      valid: false,
      checks: {
        signatureValid: false,
        issuerTrusted: null,
        notRevoked: null,
        proofPurposeValid: false,
      },
      error,
      signerDid,
      keyId,
    };
  }
}
```

### 3.8 User Key Provisioner

```typescript
// src/user-key-provisioner.ts

import type { KeyProvider } from './key-provider.js';
import { KeyMetadataStore } from './key-metadata.js';
import { publicKeyToDidKey } from './did-key.js';
import type { KeyMetadata, KeyVersionMetadata } from './types.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Configuration for the user key provisioner.
 * Injected at service startup — values come from environment config.
 */
export interface UserKeyProvisionerConfig {
  project: string;       // e.g. "pdtf-users-prod"
  location: string;      // e.g. "europe-west2"
  keyRingId: string;     // e.g. "user-keys"
  protectionLevel: 'HSM' | 'SOFTWARE';
}

export class UserKeyProvisioner {
  constructor(
    private keyProvider: KeyProvider,
    private keyStore: KeyMetadataStore,
    private config: UserKeyProvisionerConfig,
  ) {}

  /**
   * Provision a new Ed25519 key pair for a user.
   * Called during onboarding after identity verification.
   *
   * Returns the user's new DID and key metadata.
   *
   * @param userId Firebase Auth UID
   * @returns KeyMetadata with did:key identifier
   * @throws If user already has a key (idempotency check)
   */
  async provisionUserKey(userId: string): Promise<KeyMetadata> {
    // Idempotency: check if user already has a key
    const existing = await this.keyStore.getByUserId(userId);
    if (existing) {
      return existing;
    }

    // 1. Create key via provider (KMS in prod, Firestore in dev)
    const keyId = `user-${userId}-key`;
    const { keyPath, versionPath } = await this.keyProvider.createKey({
      project: this.config.project,
      location: this.config.location,
      keyRingId: this.config.keyRingId,
      keyId,
      protectionLevel: this.config.protectionLevel,
      labels: {
        pdtf_key_category: 'user',
        firebase_uid: userId,
      },
    });

    // 2. Get the public key
    const { raw, multibase } = await this.keyProvider.getPublicKey(versionPath);

    // 3. Derive did:key
    const did = publicKeyToDidKey(raw);

    // 4. Store metadata in Firestore
    const versionMeta: KeyVersionMetadata = {
      version: 1,
      publicKeyMultibase: multibase,
      publicKeyHex: Buffer.from(raw).toString('hex'),
      createdAt: FieldValue.serverTimestamp() as any,
      isPrimary: true,
      disabled: false,
    };

    const keyMeta: KeyMetadata = {
      id: userId,
      category: 'user',
      did,
      kmsKeyPath: keyPath,
      activeVersion: 1,
      versions: [versionMeta],
      userId,
      createdAt: FieldValue.serverTimestamp() as any,
      status: 'active',
    };

    await this.keyStore.create(keyMeta);

    return keyMeta;
  }

  /**
   * Rotate a user's key.
   *
   * WARNING: For did:key users, rotation means a new DID.
   * All credentials referencing the old DID must be re-issued.
   * Only call this on suspected compromise or wallet migration.
   *
   * @returns Object with old and new DIDs for credential re-issuance
   */
  async rotateUserKey(userId: string): Promise<{
    oldDid: string;
    newDid: string;
    keyMeta: KeyMetadata;
  }> {
    const existing = await this.keyStore.getByUserId(userId);
    if (!existing) {
      throw new Error(`No key found for user ${userId}`);
    }

    const oldDid = existing.did;

    // 1. Create new key version via provider
    const { versionPath, versionNumber } = await this.keyProvider.createKeyVersion(
      existing.kmsKeyPath,
    );

    // 2. Set new version as primary
    await this.keyProvider.setPrimaryVersion(existing.kmsKeyPath, versionNumber);

    // 3. Get new public key
    const { raw, multibase } = await this.keyProvider.getPublicKey(versionPath);

    // 4. Derive new did:key
    const newDid = publicKeyToDidKey(raw);

    // 5. Update metadata
    const newVersion: KeyVersionMetadata = {
      version: versionNumber,
      publicKeyMultibase: multibase,
      publicKeyHex: Buffer.from(raw).toString('hex'),
      createdAt: FieldValue.serverTimestamp() as any,
      isPrimary: true,
      disabled: false,
    };

    // Mark old version as non-primary
    const updatedVersions = existing.versions.map(v => ({
      ...v,
      isPrimary: false,
    }));
    updatedVersions.push(newVersion);

    const updatedMeta: Partial<KeyMetadata> = {
      did: newDid,
      activeVersion: versionNumber,
      versions: updatedVersions,
      lastRotatedAt: FieldValue.serverTimestamp() as any,
      status: 'active',
    };

    await this.keyStore.update(userId, updatedMeta);

    return {
      oldDid,
      newDid,
      keyMeta: { ...existing, ...updatedMeta } as KeyMetadata,
    };
  }
}
```

---

## 4. Firestore Schema

Key metadata is stored in Firestore for fast lookup. This is the mapping layer between application-level identifiers (user UIDs, adapter names, DIDs) and KMS resource paths.

### 4.1 Collections

```
firestore/
├── pdtfKeys/
│   ├── {keyId}                    # Document per key
│   │   ├── id: string             # = keyId
│   │   ├── category: string       # "adapter" | "user" | "platform"
│   │   ├── did: string            # DID associated with this key
│   │   ├── kmsKeyPath: string     # Full KMS resource path
│   │   ├── activeVersion: number  # Current primary version
│   │   ├── versions: array        # All version metadata
│   │   ├── adapterId?: string     # For adapter keys
│   │   ├── userId?: string        # For user keys (Firebase UID)
│   │   ├── status: string         # "active" | "rotating" | "compromised" | "disabled"
│   │   ├── createdAt: timestamp
│   │   └── lastRotatedAt?: timestamp
│   │
│   └── (indexes)
│       ├── did → keyId            # Lookup by DID
│       ├── userId → keyId         # Lookup by Firebase UID
│       └── adapterId → keyId      # Lookup by adapter name
│
├── pdtfKeyMaterial/                  # ⚠️ DEV/STAGING ONLY — private key storage
│   └── {versionPathId}              # Path with / → __ (e.g. projects__pdtf-users-staging__...)
│       ├── keyPath: string           # Synthetic KMS-like key path
│       ├── versionPath: string       # Full version path
│       ├── privateKey: string        # ⚠️ Hex-encoded Ed25519 private key
│       ├── publicKey: string         # Hex-encoded public key
│       ├── publicKeyMultibase: string
│       ├── protectionLevel: string   # Always "FIRESTORE_LOCAL"
│       ├── disabled?: boolean        # Set on key version disable
│       ├── disabledAt?: timestamp
│       ├── createdAt: timestamp
│       └── labels?: map
│
└── pdtfDidRotations/
    └── {rotationId}               # Audit trail for DID rotations
        ├── userId: string
        ├── previousDid: string
        ├── newDid: string
        ├── reason: string         # "scheduled" | "compromise" | "wallet_migration"
        ├── rotatedAt: timestamp
        └── reissuedCredentials: number  # Count of re-issued VCs
```

### 4.2 Key Metadata Store

```typescript
// src/key-metadata.ts

import { Firestore } from 'firebase-admin/firestore';
import type { KeyMetadata, SignOptions } from './types.js';

const KEYS_COLLECTION = 'pdtfKeys';

export class KeyMetadataStore {
  constructor(private db: Firestore) {}

  /** Get key metadata by document ID */
  async get(keyId: string): Promise<KeyMetadata | null> {
    const doc = await this.db.collection(KEYS_COLLECTION).doc(keyId).get();
    return doc.exists ? (doc.data() as KeyMetadata) : null;
  }

  /** Get key metadata by DID */
  async getByDid(did: string): Promise<KeyMetadata | null> {
    const snap = await this.db
      .collection(KEYS_COLLECTION)
      .where('did', '==', did)
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as KeyMetadata);
  }

  /** Get key metadata by Firebase user ID */
  async getByUserId(userId: string): Promise<KeyMetadata | null> {
    const snap = await this.db
      .collection(KEYS_COLLECTION)
      .where('userId', '==', userId)
      .where('category', '==', 'user')
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as KeyMetadata);
  }

  /** Get key metadata by adapter ID */
  async getByAdapterId(adapterId: string): Promise<KeyMetadata | null> {
    const snap = await this.db
      .collection(KEYS_COLLECTION)
      .where('adapterId', '==', adapterId)
      .where('category', '==', 'adapter')
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as KeyMetadata);
  }

  /** Get the platform key (singleton) */
  async getPlatformKey(): Promise<KeyMetadata | null> {
    const snap = await this.db
      .collection(KEYS_COLLECTION)
      .where('category', '==', 'platform')
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as KeyMetadata);
  }

  /**
   * Resolve a SignOptions to a KeyMetadata.
   * This is the main entry point for the signer — maps
   * (category, entityId) → key metadata with KMS path.
   */
  async resolveKey(options: SignOptions): Promise<KeyMetadata> {
    let meta: KeyMetadata | null;

    switch (options.keyCategory) {
      case 'adapter':
        if (!options.entityId) throw new Error('entityId required for adapter keys');
        meta = await this.getByAdapterId(options.entityId);
        break;
      case 'user':
        if (!options.entityId) throw new Error('entityId required for user keys');
        meta = await this.getByUserId(options.entityId);
        break;
      case 'platform':
        meta = await this.getPlatformKey();
        break;
      default:
        throw new Error(`Unknown key category: ${options.keyCategory}`);
    }

    if (!meta) {
      throw new Error(
        `No key found for category=${options.keyCategory} entityId=${options.entityId}`,
      );
    }

    if (meta.status !== 'active') {
      throw new Error(`Key ${meta.id} is ${meta.status}, cannot sign`);
    }

    return meta;
  }

  /** Create key metadata */
  async create(meta: KeyMetadata): Promise<void> {
    await this.db.collection(KEYS_COLLECTION).doc(meta.id).set(meta);
  }

  /** Update key metadata */
  async update(keyId: string, updates: Partial<KeyMetadata>): Promise<void> {
    await this.db.collection(KEYS_COLLECTION).doc(keyId).update(updates);
  }
}
```

### 4.3 Firestore Security Rules

```javascript
// firestore.rules (pdtfKeys collection)

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // pdtfKeys: only accessible by backend services (admin SDK)
    // No client-side access — all key operations go through Cloud Functions
    match /pdtfKeys/{keyId} {
      allow read, write: if false;  // Admin SDK bypasses rules
    }

    match /pdtfDidRotations/{rotationId} {
      allow read, write: if false;  // Admin SDK only
    }

    // pdtfKeyMaterial: private keys — DEV/STAGING ONLY
    // This collection should not exist in production Firestore.
    // Double protection: security rules block all client access,
    // and createKeyProvider() prevents FirestoreKeyProvider in production.
    match /pdtfKeyMaterial/{docId} {
      allow read, write: if false;  // Admin SDK only, never client
    }
  }
}
```

---

## 5. DID Document Serving

DID documents for `did:web` identifiers must be served at well-known HTTPS URLs. This section covers the serving infrastructure.

### 5.1 URL Mapping

| DID | URL |
|-----|-----|
| `did:web:moverly.com` | `https://moverly.com/.well-known/did.json` |
| `did:web:adapters.propdata.org.uk:hmlr` | `https://adapters.propdata.org.uk/hmlr/did.json` |
| `did:web:adapters.propdata.org.uk:epc` | `https://adapters.propdata.org.uk/epc/did.json` |
| `did:web:adapters.propdata.org.uk:ea-flood` | `https://adapters.propdata.org.uk/ea-flood/did.json` |
| `did:web:adapters.propdata.org.uk:llc` | `https://adapters.propdata.org.uk/llc/did.json` |
| `did:web:adapters.propdata.org.uk:os` | `https://adapters.propdata.org.uk/os/did.json` |

### 5.2 Serving Options

**Option A: Cloud Functions (recommended for launch)**

A lightweight Cloud Function reads key metadata from Firestore, constructs the DID document, and returns it. Simple, serverless, auto-scaling.

```typescript
// functions/src/did-document.ts

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { constructDidWebDocument } from '@pdtf/key-manager';

/**
 * Serve DID documents for adapters.propdata.org.uk/{adapter}/did.json
 *
 * Deployed to: adapters.propdata.org.uk (via Firebase Hosting rewrite)
 */
export const didDocument = onRequest(
  { region: 'europe-west2', cors: true },
  async (req, res) => {
    // Extract adapter ID from path: /{adapter}/did.json
    const pathMatch = req.path.match(/^\/([a-z-]+)\/did\.json$/);
    if (!pathMatch) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const adapterId = pathMatch[1];
    const db = getFirestore();

    // Look up key metadata
    const snap = await db
      .collection('pdtfKeys')
      .where('adapterId', '==', adapterId)
      .where('category', '==', 'adapter')
      .limit(1)
      .get();

    if (snap.empty) {
      res.status(404).json({ error: `Unknown adapter: ${adapterId}` });
      return;
    }

    const keyMeta = snap.docs[0].data();

    // Construct DID document from metadata
    const didDoc = constructDidWebDocument({
      did: keyMeta.did,
      versions: keyMeta.versions.filter((v: any) => !v.disabled),
    });

    // Serve with correct content type and caching
    res
      .set('Content-Type', 'application/did+json')
      .set('Cache-Control', 'public, max-age=3600')  // 1 hour cache
      .json(didDoc);
  },
);
```

**Option B: Static files in Cloud Storage (for stability)**

Generate DID documents as static JSON files and serve from Cloud Storage behind a CDN. Updated on key rotation by a Cloud Function trigger.

Good for: ultra-low latency, no cold starts, works even if Cloud Functions are down. Bad for: requires a rotation trigger pipeline to regenerate.

**Recommendation:** Start with Option A (simpler), migrate to Option B when verifier traffic demands it.

### 5.3 Firebase Hosting Rewrites

```json
// firebase.json (adapters.propdata.org.uk site)
{
  "hosting": {
    "site": "pdtf-adapters",
    "public": "public",
    "rewrites": [
      {
        "source": "/**/did.json",
        "function": "didDocument"
      }
    ],
    "headers": [
      {
        "source": "/**/did.json",
        "headers": [
          { "key": "Access-Control-Allow-Origin", "value": "*" },
          { "key": "Content-Type", "value": "application/did+json" }
        ]
      }
    ]
  }
}
```

### 5.4 Platform DID Document

The platform DID (`did:web:moverly.com`) is served from `https://moverly.com/.well-known/did.json`. This can be a static file deployed with the main moverly.com site, updated on the rare occasions when the platform key is rotated.

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "did:web:moverly.com",
  "verificationMethod": [
    {
      "id": "did:web:moverly.com#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:moverly.com",
      "publicKeyMultibase": "z6Mkq..."
    }
  ],
  "assertionMethod": ["did:web:moverly.com#key-1"],
  "service": [
    {
      "id": "did:web:moverly.com#tir",
      "type": "TrustedIssuerRegistry",
      "serviceEndpoint": "https://tir.moverly.com/v1/registry"
    },
    {
      "id": "did:web:moverly.com#status",
      "type": "BitstringStatusList",
      "serviceEndpoint": "https://status.moverly.com/credentials/status/"
    }
  ]
}
```

---

## 6. Integration Points

### 6.1 Credential Service Integration

The credential service is the primary consumer of the key-manager. It creates signed VCs when adapters fetch data or users submit forms.

```typescript
// Adapter credential flow
import { VcSigner, createKeyProvider, KeyMetadataStore } from '@pdtf/key-manager';

const keyProvider = createKeyProvider({ type: config.keyProvider, environment: config.environment });
const signer = new VcSigner(keyProvider, new KeyMetadataStore(db));

// When HMLR adapter fetches title data:
const unsignedVc = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://schema.pdtf.org/v4/context'],
  type: ['VerifiableCredential', 'TitleCredential'],
  issuer: 'did:web:adapters.propdata.org.uk:hmlr',
  issuanceDate: new Date().toISOString(),
  credentialSubject: {
    id: 'urn:pdtf:titleNumber:ABC123456',
    titleNumber: 'ABC123456',
    tenure: 'freehold',
    // ... title data from HMLR
  },
  credentialStatus: {
    id: 'https://status.moverly.com/credentials/status/1#42',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '42',
    statusListCredential: 'https://status.moverly.com/credentials/status/1',
  },
};

const signedVc = await signer.sign(unsignedVc, {
  keyCategory: 'adapter',
  entityId: 'hmlr',
});
```

```typescript
// User assertion flow (e.g., completing TA6 form)
const userVc = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://schema.pdtf.org/v4/context'],
  type: ['VerifiableCredential', 'PropertyCredential'],
  issuer: userDid,  // did:key:z6Mk...
  issuanceDate: new Date().toISOString(),
  credentialSubject: {
    id: `urn:pdtf:uprn:${uprn}`,
    // ... seller's property information from TA6
  },
};

const signedUserVc = await signer.sign(userVc, {
  keyCategory: 'user',
  entityId: userId,  // Firebase UID
});
```

### 6.2 Onboarding Integration

The user key provisioner is called during the onboarding flow, after identity verification.

```typescript
// Onboarding Cloud Function
import { UserKeyProvisioner, createKeyProvider, KeyMetadataStore } from '@pdtf/key-manager';

export const onUserOnboarded = onCall(
  { region: 'europe-west2' },
  async (request) => {
    const { uid } = request.auth!;

    const keyProvider = createKeyProvider({ type: config.keyProvider, environment: config.environment });
    const provisioner = new UserKeyProvisioner(
      keyProvider,
      new KeyMetadataStore(db),
      {
        project: config.users.project,
        location: config.users.location,
        keyRingId: config.users.keyRingId,
        protectionLevel: config.users.protectionLevel,
      },
    );

    const keyMeta = await provisioner.provisionUserKey(uid);

    // Store DID on user's Firestore profile for quick access
    await db.doc(`users/${uid}`).update({
      pdtfDid: keyMeta.did,
      pdtfKeyProvisioned: true,
    });

    return { did: keyMeta.did };
  },
);
```

### 6.3 Verification Service (Public)

The verifier is exposed as a public API endpoint. No authentication required — anyone can verify a PDTF credential.

```typescript
// functions/src/verify.ts

import { onRequest } from 'firebase-functions/v2/https';
import { VcVerifier } from '@pdtf/key-manager';

const verifier = new VcVerifier();

export const verifyCredential = onRequest(
  {
    region: 'europe-west2',
    cors: true,
    invoker: 'public',  // No auth required
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    const vc = req.body;
    if (!vc || !vc.proof) {
      res.status(400).json({ error: 'Request body must be a signed VC with proof' });
      return;
    }

    const result = await verifier.verify(vc, {
      tirChecker: async (issuer, types) => {
        // TODO: integrate with TIR service
        return true;
      },
      revocationChecker: async (status) => {
        // TODO: integrate with status list checker
        return true;
      },
    });

    res.json(result);
  },
);
```

---

## 7. Operational Runbooks

### 7.1 Provision a New Adapter

```bash
#!/bin/bash
# runbooks/provision-adapter.sh
#
# Usage: ./provision-adapter.sh <adapter-id> <description> <domain-path>
# Example: ./provision-adapter.sh hmlr "HM Land Registry" "adapters.propdata.org.uk:hmlr"

ADAPTER_ID=$1
DESCRIPTION=$2
DOMAIN_PATH=$3
ENV="${ENV:-prod}"

echo "=== Provisioning adapter: ${ADAPTER_ID} (${ENV}) ==="

# 1. Apply Terraform (adds the adapter to the adapters list)
cd infrastructure/terraform
terraform apply -var="environment=${ENV}" -target="module.pdtf_kms.google_kms_key_ring.adapter[\"${ADAPTER_ID}\"]" \
  -target="module.pdtf_kms.google_kms_crypto_key.adapter_signing[\"${ADAPTER_ID}\"]" \
  -target="module.pdtf_kms.google_kms_crypto_key_iam_member.adapter_signer[\"${ADAPTER_ID}\"]"

# 2. Export public key
KEY_PATH="projects/pdtf-adapters-${ENV}/locations/europe-west2/keyRings/${ADAPTER_ID}-adapter/cryptoKeys/${ADAPTER_ID}-proxy-signing-key"
gcloud kms keys versions get-public-key 1 \
  --key="${ADAPTER_ID}-proxy-signing-key" \
  --keyring="${ADAPTER_ID}-adapter" \
  --location=europe-west2 \
  --project="pdtf-adapters-${ENV}" \
  --output-file="/tmp/${ADAPTER_ID}-public-key.pem"

# 3. Derive DID
DID="did:web:${DOMAIN_PATH}"
echo "DID: ${DID}"

# 4. Store key metadata in Firestore
# (This would normally be done by a setup script using the admin SDK)
echo "Store metadata: keyPath=${KEY_PATH}, did=${DID}, adapterId=${ADAPTER_ID}"

# 5. Deploy DID document
echo "Deploy DID document to https://${DOMAIN_PATH//://}/did.json"

# 6. Register in TIR
echo "Register adapter DID in Trusted Issuer Registry"

echo "=== Done ==="
```

### 7.2 Rotate an Adapter Key

```bash
#!/bin/bash
# runbooks/rotate-adapter-key.sh
#
# Usage: ./rotate-adapter-key.sh <adapter-id>
# Example: ./rotate-adapter-key.sh hmlr

ADAPTER_ID=$1
ENV="${ENV:-prod}"
PROJECT="pdtf-adapters-${ENV}"
KEY="${ADAPTER_ID}-proxy-signing-key"
KEYRING="${ADAPTER_ID}-adapter"
LOCATION="europe-west2"

echo "=== Rotating key for adapter: ${ADAPTER_ID} ==="

# 1. Create new key version
echo "Creating new key version..."
gcloud kms keys versions create \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}"

# 2. Get the new version number
NEW_VERSION=$(gcloud kms keys versions list \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}" \
  --format="value(name)" | sort -t/ -k10 -n | tail -1 | awk -F/ '{print $NF}')
echo "New version: ${NEW_VERSION}"

# 3. Set as primary
echo "Setting version ${NEW_VERSION} as primary..."
gcloud kms keys update "${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}" \
  --primary-version="${NEW_VERSION}"

# 4. Export new public key
gcloud kms keys versions get-public-key "${NEW_VERSION}" \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}" \
  --output-file="/tmp/${ADAPTER_ID}-public-key-v${NEW_VERSION}.pem"

# 5. Update Firestore metadata (triggers DID document regeneration)
echo "Update Firestore metadata with new version..."
echo "(Run: node scripts/update-key-version.js --adapter=${ADAPTER_ID} --version=${NEW_VERSION})"

echo "=== Rotation complete ==="
echo "Old credentials remain verifiable (old key stays in DID document verificationMethod)"
echo "New credentials will use version ${NEW_VERSION}"
```

### 7.3 Compromise Response: Adapter Key

```bash
#!/bin/bash
# runbooks/compromise-adapter-key.sh
#
# EMERGENCY RUNBOOK — execute immediately on suspected compromise
#
# Usage: ./compromise-adapter-key.sh <adapter-id> <compromised-version>
# Example: ./compromise-adapter-key.sh hmlr 1

ADAPTER_ID=$1
COMPROMISED_VERSION=$2
ENV="${ENV:-prod}"
PROJECT="pdtf-adapters-${ENV}"
KEY="${ADAPTER_ID}-proxy-signing-key"
KEYRING="${ADAPTER_ID}-adapter"
LOCATION="europe-west2"

echo "!!! COMPROMISE RESPONSE: adapter=${ADAPTER_ID} version=${COMPROMISED_VERSION} !!!"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. IMMEDIATE: Disable compromised version
echo "[1/5] Disabling compromised key version..."
gcloud kms keys versions disable "${COMPROMISED_VERSION}" \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}"

# 2. IMMEDIATE: Create new version + set primary
echo "[2/5] Creating replacement key version..."
gcloud kms keys versions create \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}"

NEW_VERSION=$(gcloud kms keys versions list \
  --key="${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}" \
  --format="value(name)" --filter="state=ENABLED" | sort -t/ -k10 -n | tail -1 | awk -F/ '{print $NF}')

gcloud kms keys update "${KEY}" \
  --keyring="${KEYRING}" \
  --location="${LOCATION}" \
  --project="${PROJECT}" \
  --primary-version="${NEW_VERSION}"

echo "New primary version: ${NEW_VERSION}"

# 3. Update DID document (remove compromised key from assertionMethod)
echo "[3/5] Updating DID document..."
echo "(Run: node scripts/compromise-did-update.js --adapter=${ADAPTER_ID} --compromised=${COMPROMISED_VERSION} --new=${NEW_VERSION})"

# 4. Assess scope
echo "[4/5] Assessing scope..."
echo "Query: find all credentials signed with ${KEY}/cryptoKeyVersions/${COMPROMISED_VERSION}"
echo "(Run: node scripts/assess-compromise-scope.js --adapter=${ADAPTER_ID} --version=${COMPROMISED_VERSION})"

# 5. Notify
echo "[5/5] Notification required:"
echo "  - Security team: Slack #security-incidents"
echo "  - Affected users: email via credential-service"
echo "  - Relying parties: TIR update notification"

echo ""
echo "=== Immediate actions complete ==="
echo "Follow-up within 24h: re-issue affected credentials, root cause analysis"
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

Run against in-memory mocks, no GCP services needed.

```typescript
// test/signer.test.ts (example)

import { describe, it, expect, vi } from 'vitest';
import { VcSigner } from '../src/signer.js';

describe('VcSigner', () => {
  it('should reject VCs that already have a proof', async () => {
    const signer = new VcSigner(mockKeyProvider, mockKeyStore);
    const vc = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: 'did:web:test.example',
      issuanceDate: '2026-01-01T00:00:00Z',
      credentialSubject: { id: 'urn:test:1' },
      proof: { type: 'DataIntegrityProof' },  // already signed!
    };

    await expect(signer.sign(vc, { keyCategory: 'adapter', entityId: 'test' }))
      .rejects.toThrow('already has a proof');
  });

  it('should produce a valid DataIntegrityProof', async () => {
    const signer = new VcSigner(mockKeyProvider, mockKeyStore);
    const vc = createUnsignedVc();

    const signed = await signer.sign(vc, { keyCategory: 'adapter', entityId: 'test' });

    expect(signed.proof).toBeDefined();
    expect(signed.proof.type).toBe('DataIntegrityProof');
    expect(signed.proof.cryptosuite).toBe('eddsa-jcs-2022');
    expect(signed.proof.proofValue).toMatch(/^z/);  // multibase base58btc
    expect(signed.proof.proofPurpose).toBe('assertionMethod');
  });
});
```

### 8.2 Integration Tests (FirestoreKeyProvider + KMS Emulator)

Unit and integration tests default to `FirestoreKeyProvider` with the Firebase emulator — no GCP project needed, runs entirely locally. KMS emulator tests validate the `KmsKeyProvider` specifically.

**FirestoreKeyProvider tests** (primary — run in CI):

- Sign → verify round-trip (real Ed25519 operations, no mocks)
- Key creation, public key export, did:key derivation
- Key rotation and version management
- Safety guard: verify `createKeyProvider('firestore', 'production')` throws

**KMS emulator tests** (secondary — run when KMS emulator available):

- Sign → verify round-trip via Cloud KMS
- Key creation and public key export
- Key rotation and version management

```typescript
// test/integration/kms-roundtrip.test.ts

describe('KMS round-trip (emulator)', () => {
  it('should sign with KMS and verify locally', async () => {
    // 1. Create a test key in the emulator
    const kms = new KmsKeyProvider();
    const { keyPath, versionPath } = await kms.createKey({
      project: 'test-project',
      location: 'europe-west2',
      keyRingId: 'test-ring',
      keyId: 'test-key',
      protectionLevel: 'SOFTWARE',
    });

    // 2. Sign a VC
    const signer = new VcSigner(kms, testKeyStore);
    const signed = await signer.sign(testVc, {
      keyCategory: 'adapter',
      entityId: 'test',
    });

    // 3. Verify locally (no KMS needed)
    const verifier = new VcVerifier();
    const result = await verifier.verify(signed, { skipTirCheck: true });

    expect(result.valid).toBe(true);
    expect(result.checks.signatureValid).toBe(true);
  });
});
```

### 8.3 End-to-End Tests (Staging)

Against `pdtf-*-staging` projects with real Cloud KMS (SOFTWARE protection).

| Test | What It Validates |
|------|------------------|
| Adapter credential round-trip | Create key → sign VC → resolve DID → verify |
| User onboarding | Provision key → derive did:key → store metadata → verify |
| Key rotation (did:web) | Rotate → old VCs still verify → new VCs use new key |
| Key rotation (did:key) | Rotate → new DID → old DID still resolvable |
| Cross-adapter isolation | Adapter A's SA cannot sign with adapter B's key → IAM deny |
| Compromise response | Disable key version → signing fails → old VCs still verify |
| DID document serving | Cloud Function returns correct DID doc → correct content type |

---

## 9. Deployment

### 9.1 Package Publishing

`@pdtf/key-manager` is published to the private Moverly npm registry (or GitHub Packages under `property-data-standards-co`).

```json
// packages/key-manager/package.json
{
  "name": "@pdtf/key-manager",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "dependencies": {
    "@google-cloud/kms": "^4.5.0",
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0",
    "json-canonicalize": "^2.0.0",
    "multiformats": "^13.3.0"
  },
  "peerDependencies": {
    "firebase-admin": "^12.0.0 || ^13.0.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### 9.2 Infrastructure Deployment Order

```
1. Terraform: GCP projects + KMS resources + IAM
   └── terraform apply (environments/prod or environments/staging)

2. Platform key: Generate + export public key + publish DID doc
   └── runbooks/provision-platform-key.sh
   └── Deploy .well-known/did.json to moverly.com

3. Adapter keys: Generate + export + publish DID docs
   └── runbooks/provision-adapter.sh (per adapter)
   └── Deploy Cloud Function for adapters.propdata.org.uk DID docs

4. Firestore: Seed key metadata for platform + adapters
   └── scripts/seed-key-metadata.js

5. Cloud Functions: Deploy credential service, verification endpoint, DID doc serving
   └── firebase deploy --only functions

6. Monitoring: Verify alert policies are firing
   └── Test: trigger a dummy ScheduleDestroyCryptoKeyVersion → verify alert
```

### 9.3 Environment Configuration

```typescript
// config/key-manager.config.ts

export interface KeyManagerConfig {
  /** Key provider backend: 'firestore' (dev/staging) or 'kms' (production) */
  keyProvider: KeyProviderType;
  /** Environment name — used by safety guard to block firestore in production */
  environment: string;
  adapters: {
    project: string;
    location: string;
  };
  platform: {
    project: string;
    location: string;
  };
  users: {
    project: string;
    location: string;
    keyRingId: string;
    protectionLevel: 'HSM' | 'SOFTWARE';
  };
}

export const prodConfig: KeyManagerConfig = {
  keyProvider: 'kms',        // Production: HSM-backed GCP KMS
  environment: 'production',
  adapters: {
    project: 'pdtf-adapters-prod',
    location: 'europe-west2',
  },
  platform: {
    project: 'pdtf-platform-prod',
    location: 'europe-west2',
  },
  users: {
    project: 'pdtf-users-prod',
    location: 'europe-west2',
    keyRingId: 'user-keys',
    protectionLevel: 'SOFTWARE',
  },
};

export const stagingConfig: KeyManagerConfig = {
  keyProvider: 'firestore',  // Staging: local keys in Firestore, zero KMS cost
  environment: 'staging',
  adapters: {
    project: 'pdtf-adapters-staging',
    location: 'europe-west2',
  },
  platform: {
    project: 'pdtf-platform-staging',
    location: 'europe-west2',
  },
  users: {
    project: 'pdtf-users-staging',
    location: 'europe-west2',
    keyRingId: 'user-keys',
    protectionLevel: 'SOFTWARE',
  },
};

// Dev config — for local development and Firebase emulators
export const devConfig: KeyManagerConfig = {
  keyProvider: 'firestore',  // Dev: local keys in Firestore, zero cost
  environment: 'development',
  adapters: {
    project: 'pdtf-dev',
    location: 'europe-west2',
  },
  platform: {
    project: 'pdtf-dev',
    location: 'europe-west2',
  },
  users: {
    project: 'pdtf-dev',
    location: 'europe-west2',
    keyRingId: 'user-keys',
    protectionLevel: 'SOFTWARE',
  },
};
```

---

## 10. Cost Model

### 10.1 Per-Environment Costs

| Item | Prod (Monthly) | Staging (Monthly) |
|------|---------------|-------------------|
| HSM adapter keys (5) | $12.50 | $0 (FirestoreKeyProvider) |
| HSM platform key (1) | $2.50 | $0 (FirestoreKeyProvider) |
| SW user keys (est. 1,000) | $60.00 | $0 (FirestoreKeyProvider) |
| KMS signing ops (est. 10K/mo) | $3.00 | $0 (local Ed25519) |
| Cloud Functions (DID serving) | ~$5.00 | ~$1.00 |
| Firestore (key metadata) | ~$1.00 | ~$0.50 |
| Firestore (key material — staging) | $0 | ~$0.10 |
| **Total** | **~$84/month** | **~$1.60/month** |

> **Note:** The `FirestoreKeyProvider` eliminates all KMS costs in staging. The only staging costs are Firestore storage for key material and metadata, plus Cloud Functions for DID document serving.

### 10.2 Scaling Projections

| Users | User Keys Cost | Signing Ops Cost | Total KMS |
|-------|---------------|-----------------|-----------|
| 100 | $6/mo | $0.30/mo | ~$24/mo |
| 1,000 | $60/mo | $3/mo | ~$80/mo |
| 10,000 | $600/mo | $30/mo | ~$650/mo |
| 100,000 | $6,000/mo | $300/mo | ~$6,320/mo |

At 100K users, the cost is meaningful but still modest relative to revenue. The wallet migration (§10 of Sub-spec 06) would eliminate user key KMS costs entirely.

---

## 11. Open Questions

| # | Question | Status |
|---|----------|--------|
| IQ1 | Should the key-manager package be published to GitHub Packages or a private npm registry? | Leaning GitHub Packages |
| IQ2 | ~~Do we need a KMS emulator for CI, or can integration tests run against staging?~~ | **Resolved:** CI uses `FirestoreKeyProvider` with Firebase emulator. KMS emulator for targeted `KmsKeyProvider` tests only. |
| IQ3 | Should the DID document Cloud Function be in the main Firebase project or a separate one? | Separate (adapters.propdata.org.uk hosting) |
| IQ4 | How do we handle the `did:web` domain for local development? `did:web:localhost:3000` is technically valid but unusual. | Use `did:web:dev.adapters.propdata.org.uk` |
| IQ5 | Should we implement a key metadata cache in the credential service (beyond the KMS public key cache)? | Probably yes — Firestore reads add ~20ms |
| IQ6 | What's the monorepo structure? Is `@pdtf/key-manager` in the existing `buyer-ready-functions` repo or a new repo? | New repo: `property-data-standards-co/pdtf-services` |

---

## Appendix A: Decision Log

| ID | Decision | Rationale |
|----|----------|-----------|
| I1 | Terraform for all KMS infrastructure | Reproducible, auditable, no manual key creation |
| I2 | Firestore for key metadata | Same database as existing Moverly backend, simplifies integration |
| I3 | Cloud Functions for DID document serving | Serverless, auto-scaling, easy to deploy alongside existing Functions |
| I4 | Vitest for testing | Modern, fast, ESM-native — aligns with project standards |
| I5 | `@noble/curves` for local verification | Pure JS, audited, no native dependencies, works in browser |
| I6 | Single `@pdtf/key-manager` package | Signer, verifier, provisioner, and metadata in one package for simplicity. Split later if needed. |
| I7 | `KeyProvider` strategy pattern with `FirestoreKeyProvider` and `KmsKeyProvider` | Dev/staging uses naive local keys in Firestore (zero cost, zero setup); production uses GCP KMS. Runtime safety guard blocks Firestore provider in production. CI check enforces `kms` in production config. |
| I8 | `pdtfKeyMaterial` Firestore collection for dev/staging only | Private keys stored as hex in Firestore with default encryption-at-rest. Explicitly not production-safe — accepted for dev/staging. Collection should not exist in production Firestore. |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.3 | 1 April 2026 | Separate status list signing key removed from Terraform/IAM/cost model. Status lists use issuer's own key. |
| v0.2 | 31 March 2026 | Dual KeyProvider pattern: FirestoreKeyProvider (dev/staging, @noble/ed25519, zero KMS cost) + KmsKeyProvider (production). Factory with production safety guard. Config: `keyProvider: "firestore" | "kms"`. VcSigner, UserKeyProvisioner updated. Staging cost reduced to ~$1.60/month. |
| v0.1 | 24 March 2026 | Initial draft. GCP KMS implementation, Terraform modules, @pdtf/key-manager package, VcSigner, VcVerifier, UserKeyProvisioner, Firestore schema, DID document serving, operational runbooks, cost model (~$87/month). |

---

*This document is part of the PDTF 2.0 implementation specification suite. For the protocol-level spec, see [Sub-spec 06 — Key Management](../../06-key-management/).*
