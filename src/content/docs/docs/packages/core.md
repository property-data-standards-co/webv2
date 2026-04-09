---
title: "@pdtf/core (TypeScript)"
description: "The TypeScript reference implementation — signing, verification, DIDs, status lists, TIR client, and CLI."
---

The TypeScript reference implementation of PDTF 2.0. All core functionality in a single dependency.

```bash
npm install @pdtf/core
```

**Repository:** [property-data-standards-co/core-ts](https://github.com/property-data-standards-co/core-ts)

---

## Modules

### keys

Ed25519 key generation and `did:key` derivation.

```ts
import { generateKeyPair, deriveDidKey, publicKeyToMultibase } from '@pdtf/core';

const keypair = generateKeyPair();
// { publicKey: Uint8Array, secretKey: Uint8Array }

const did = deriveDidKey(keypair.publicKey);
// did:key:z6Mk...

const multibase = publicKeyToMultibase(keypair.publicKey);
// z6Mk...
```

Keys use the `0xed01` multicodec prefix with base58-btc encoding (`z` prefix). All PDTF `did:key` identifiers start with `did:key:z6Mk`.

#### Key Providers

`@pdtf/core` ships with four `KeyProvider` implementations for different environments:

| Provider | Backend | Use case | Install |
|----------|---------|----------|---------|
| `InMemoryKeyProvider` | RAM | Unit tests | Built-in |
| `SqliteKeyProvider` | Local file | Dev / third-party testing | `npm i better-sqlite3` |
| `FirestoreKeyProvider` | Firestore | Staging | `npm i @google-cloud/firestore` |
| `KmsKeyProvider` | GCP Cloud KMS (HSM) | Production | `npm i @google-cloud/kms` |

```ts
import { SqliteKeyProvider, VcSigner } from '@pdtf/core';

// Zero-config local key management
const keys = new SqliteKeyProvider({ dbPath: './pdtf-keys.db' });
const key = await keys.generateKey('my-adapter', 'adapter');
const signer = new VcSigner(keys, 'my-adapter', key.did);

// Start signing credentials
const vc = await signer.sign({
  type: 'PropertyDataCredential',
  credentialSubject: {
    id: 'urn:pdtf:uprn:100023336956',
    energyEfficiency: { rating: 'B', score: 85 },
  },
});
```

For production with Cloud KMS:

```ts
import { KmsKeyProvider, VcSigner } from '@pdtf/core';

const keys = new KmsKeyProvider({
  projectId: 'my-project',
  locationId: 'europe-west2',
  keyRingId: 'pdtf',
});
const key = await keys.generateKey('epc-adapter', 'adapter');
const signer = new VcSigner(keys, 'epc-adapter', key.did);
```

See the [Key Management guide](../../docs/guides/key-management) for full setup instructions.

### signer

Create `DataIntegrityProof` signatures using `eddsa-jcs-2022`.

```ts
import { VcSigner } from '@pdtf/core';

const signer = new VcSigner(keyProvider);
const signed = await signer.sign(credential, {
  keyId: 'my-key',
  verificationMethod: 'did:key:z6Mk...#z6Mk...',
});
```

**Signing algorithm** (eddsa-jcs-2022):
1. JCS-canonicalize proof options → SHA-256 hash
2. JCS-canonicalize document (without proof) → SHA-256 hash
3. Concatenate both hashes (64 bytes)
4. Sign with Ed25519 (raw, not pre-hashed)
5. Encode signature as base58-btc (`z` prefix)

### validator

Verify `DataIntegrityProof` signatures.

```ts
import { verifyProof } from '@pdtf/core';

const valid = verifyProof(signedCredential, publicKey);
// true | false
```

### did

DID resolution for `did:key` and URN identifiers (`urn:pdtf:uprn:*`, `urn:pdtf:titleNumber:*`).

```ts
import { resolveDidKey, TransactionDidManager } from '@pdtf/core';

// Resolve did:key to DID Document
const doc = resolveDidKey('did:key:z6Mk...');

// Transaction DID lifecycle
const manager = new TransactionDidManager(config);
const txDid = await manager.create({ uprn: '100023336956' });
```

### status

Bitstring Status List — create, encode, decode, and check credential revocation.

```ts
import { createStatusList, encodeStatusList, decodeStatusList, setBit, getBit } from '@pdtf/core';

const list = createStatusList(131072);  // 131,072-bit minimum
setBit(list, 42);
const encoded = encodeStatusList(list); // base64(gzip(bitstring))

const decoded = decodeStatusList(encoded);
const isRevoked = getBit(decoded, 42);  // true
```

### tir

Trusted Issuer Registry client — load and validate issuer authorisations.

```ts
import { loadRegistry, isAuthorised } from '@pdtf/core';

const registry = await loadRegistry('https://github.com/property-data-standards-co/tir');
const result = isAuthorised(registry, issuerDid, ['Property:/energyEfficiency/certificate']);
// { trusted: true, issuerSlug: 'epc-adapter', trustLevel: 'rootIssuer', ... }
```

**Path matching:** The TIR supports wildcard patterns:
- `Property:/energyEfficiency/certificate` — exact match
- `Property:/energyEfficiency/*` — matches any path under `/energyEfficiency/`
- `Property:*` — matches any Property path

---

## CLI

Five commands for development and testing:

```bash
# Resolve a DID document
npx @pdtf/core did-resolve did:key:z6Mk...

# Initialise an organisation DID
npx @pdtf/core org-init --domain example.com --output ./keys

# Validate a TIR registry file
npx @pdtf/core tir-validate ./registry.json

# Inspect a VC (print structure without verification)
npx @pdtf/core vc-inspect ./credential.json

# Verify a VC signature
npx @pdtf/core vc-verify ./credential.json
```

---

## Tests

86 tests covering all modules:

| Module | Tests | Coverage |
|--------|-------|----------|
| keys | 17 | Key generation, did:key derivation, roundtrip, multibase encoding, SQLite provider, KMS provider |
| signer | 3 | Proof creation, deterministic signing, proof structure |
| did | 29 | Transaction DID manager, URN parsing, did:key resolution |
| status | 7 | Create, encode/decode, set/get bits, roundtrip |
| tir | 7 | Path matching, wildcard semantics, edge cases |
| vectors | 17 | Cross-language vector generation and self-validation |

```bash
npm test
```
