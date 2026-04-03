---
title: "Key Management"
description: "Generate, store, and manage Ed25519 signing keys across development, staging, and production environments."
---

Every PDTF credential is signed with an Ed25519 key. How you store and manage those keys depends on your environment and security requirements. `@pdtf/core` provides a `KeyProvider` interface with four built-in implementations.

## Quick Start

For local development and testing, SQLite is the fastest path:

```bash
npm install @pdtf/core better-sqlite3
```

```ts
import { SqliteKeyProvider, VcSigner } from '@pdtf/core';

const keys = new SqliteKeyProvider({ dbPath: './pdtf-keys.db' });
const key = await keys.generateKey('my-adapter', 'adapter');
const signer = new VcSigner(keys, 'my-adapter', key.did);

console.log(`Adapter DID: ${key.did}`);
// did:key:z6Mk...

const vc = await signer.sign({
  type: 'PropertyDataCredential',
  credentialSubject: {
    id: 'urn:pdtf:uprn:100023336956',
    energyEfficiency: { rating: 'B', score: 85 },
  },
});
```

That's it. The SQLite file contains your keys — back it up, don't commit it to git.

## Choosing a Provider

| Provider | Security | Setup | Best for |
|----------|----------|-------|----------|
| `InMemoryKeyProvider` | None (RAM only) | Zero | Unit tests |
| `SqliteKeyProvider` | File-system encryption | `npm i better-sqlite3` | Local dev, CI, third-party testing |
| `FirestoreKeyProvider` | GCP encryption at rest | Firestore project | Staging, small deployments |
| `KmsKeyProvider` | HSM-backed, keys never exported | GCP KMS keyring | Production |

All providers implement the same `KeyProvider` interface. Your signing code doesn't change when you move from dev to production — only the provider instantiation.

## KeyProvider Interface

```ts
interface KeyProvider {
  generateKey(keyId: string, category: KeyCategory): Promise<KeyRecord>;
  sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;
  getPublicKey(keyId: string): Promise<Uint8Array>;
  resolveDidKey(keyId: string): Promise<string>;
}

type KeyCategory = 'adapter' | 'user' | 'platform' | 'organisation';
```

**Key categories** are metadata only — they don't affect cryptographic operations. Use them to organise and audit your keys:

| Category | Purpose | Example |
|----------|---------|---------|
| `adapter` | Signs credentials from a data source adapter | EPC adapter, HMLR adapter |
| `user` | Signs user-initiated attestations | Seller property information |
| `platform` | Signs platform-level credentials | Transaction lifecycle events |
| `organisation` | Organisation identity key | `did:web:moverly.com` anchor |

---

## SQLite Provider

Zero-infrastructure key management. Keys are stored in a local SQLite database with Ed25519 secret keys in a `BLOB` column.

```ts
import { SqliteKeyProvider } from '@pdtf/core';

// File-based (persistent)
const keys = new SqliteKeyProvider({ dbPath: './pdtf-keys.db' });

// In-memory (tests)
const testKeys = new SqliteKeyProvider({ dbPath: ':memory:' });
```

The provider auto-creates the `pdtf_keys` table on first use. Schema:

```sql
CREATE TABLE pdtf_keys (
  key_id     TEXT PRIMARY KEY,
  category   TEXT NOT NULL,
  secret_key BLOB NOT NULL,
  public_key BLOB NOT NULL,
  did        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### Security considerations

- The secret key is stored **unencrypted** in the SQLite file. Protect it with file-system permissions.
- For CI pipelines, use `:memory:` or a temporary file that's deleted after the run.
- Don't commit `.db` files to version control. Add `*.db` to `.gitignore`.

---

## Cloud KMS Provider

For production deployments where signing keys must never leave a hardware security module.

```bash
npm install @pdtf/core @google-cloud/kms
```

### Prerequisites

1. A GCP project with the Cloud KMS API enabled
2. A KMS keyring (create manually or via Terraform)
3. Service account with `roles/cloudkms.signerVerifier` and `roles/cloudkms.publicKeyViewer`

```bash
# Create the keyring (one-time setup)
gcloud kms keyrings create pdtf \
  --location europe-west2 \
  --project my-project
```

### Usage

```ts
import { KmsKeyProvider, VcSigner } from '@pdtf/core';

const keys = new KmsKeyProvider({
  projectId: 'my-project',
  locationId: 'europe-west2',
  keyRingId: 'pdtf',
});

// Generate creates a CryptoKey in KMS
const key = await keys.generateKey('epc-adapter', 'adapter');
console.log(`DID: ${key.did}`);

// Sign operations call KMS — the secret key never leaves the HSM
const signer = new VcSigner(keys, 'epc-adapter', key.did);
const vc = await signer.sign({ ... });
```

### How it works

- `generateKey()` creates a KMS `CryptoKey` with purpose `ASYMMETRIC_SIGN` and algorithm `EC_SIGN_ED25519`
- `sign()` calls the KMS `asymmetricSign` API — the key never leaves Google's infrastructure
- `getPublicKey()` fetches the PEM-encoded public key from KMS and extracts the raw 32-byte Ed25519 key (cached in memory)
- `resolveDidKey()` derives the `did:key` from the public key

### Key rotation

KMS supports key versions. To rotate:

1. Create a new key version in KMS (or let auto-rotation handle it)
2. Update the TIR with the new `did:key`
3. Disable the old key version after a grace period
4. Old credentials remain verifiable (the public key was embedded in the DID)

---

## Environment Strategy

A typical deployment uses different providers per environment:

```ts
function createKeyProvider(): KeyProvider {
  switch (process.env.NODE_ENV) {
    case 'production':
      return new KmsKeyProvider({
        projectId: process.env.GCP_PROJECT!,
        locationId: process.env.GCP_LOCATION!,
        keyRingId: process.env.KMS_KEYRING!,
      });

    case 'staging':
      return new FirestoreKeyProvider({
        projectId: process.env.GCP_PROJECT!,
        collection: 'pdtf-keys',
      });

    default:
      return new SqliteKeyProvider({
        dbPath: './pdtf-keys.db',
      });
  }
}
```

### Key naming conventions

Use consistent key IDs across environments:

```
adapter/epc          → EPC data source adapter
adapter/hmlr         → HMLR title data adapter
platform/transaction → Transaction lifecycle signing
org/moverly          → Organisation identity key
service/validate     → Validation service receipt signing
```

---

## For Third-Party Implementers

If you're building a PDTF adapter (e.g., for a conveyancing platform), here's the minimal path:

```bash
npm install @pdtf/core better-sqlite3
```

```ts
import { SqliteKeyProvider, VcSigner, TirClient } from '@pdtf/core';

// 1. Set up key management
const keys = new SqliteKeyProvider({ dbPath: './keys.db' });
const key = await keys.generateKey('my-adapter', 'adapter');

// 2. Register your DID in the TIR
//    → Submit a PR to property-data-standards-co/tir
//    → Add your issuer entry with key.did and authorised paths
console.log(`Register this DID in the TIR: ${key.did}`);

// 3. Start signing credentials
const signer = new VcSigner(keys, 'my-adapter', key.did);

const vc = await signer.sign({
  type: 'PropertyDataCredential',
  credentialSubject: {
    id: 'urn:pdtf:uprn:100023336956',
    localAuthority: { name: 'Camden', code: 'E09000007' },
  },
});
```

When you're ready for production, swap `SqliteKeyProvider` for `KmsKeyProvider` (or your own `KeyProvider` implementation) — the signing code stays identical.

### Custom providers

Implement the `KeyProvider` interface to integrate with your own key management:

```ts
import type { KeyProvider, KeyRecord, KeyCategory } from '@pdtf/core';

class MyKeyVaultProvider implements KeyProvider {
  async generateKey(keyId: string, category: KeyCategory): Promise<KeyRecord> {
    // Your key generation logic
  }
  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    // Your signing logic — must return raw Ed25519 signature (64 bytes)
  }
  async getPublicKey(keyId: string): Promise<Uint8Array> {
    // Return raw Ed25519 public key (32 bytes)
  }
  async resolveDidKey(keyId: string): Promise<string> {
    const pubKey = await this.getPublicKey(keyId);
    return deriveDidKey(pubKey);
  }
}
```

The only requirement: Ed25519 keys, raw byte signatures. Everything else is up to you.
