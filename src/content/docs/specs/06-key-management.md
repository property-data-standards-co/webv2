---
title: "PDTF 2.0 — Sub-spec 06: Key Management"
description: "PDTF 2.0 specification document."
---


**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](./00-architecture-overview.md)

---

## 1. Purpose

This specification defines how cryptographic keys are generated, stored, rotated, and managed across the PDTF 2.0 ecosystem. Every Verifiable Credential in PDTF 2.0 is cryptographically signed — the entire trust model depends on the integrity of the signing infrastructure. This document is the authoritative reference for:

- **Key algorithm selection** and rationale
- **Key categories** — what keys exist and what they sign
- **Key storage** — Google Cloud KMS architecture, project structure, and IAM
- **Key lifecycle** — generation, rotation, compromise response, and eventual decommissioning
- **Signing and verification operations** — how VCs are signed and how signatures are verified
- **Future wallet binding** — migration path from custodial to self-sovereign key management

### 1.1 Scope

This spec covers key management for **credential signing and verification only**. It does not cover:

- TLS certificates for transport security
- Firebase Auth tokens or session management
- API keys for adapter or MCP server authentication
- Encryption keys (X25519 key agreement for VC envelope encryption) — deferred to Sub-spec 12. In Phase 1, Moverly is the sole platform and VC encryption is not required. When multi-platform sync is introduced, X25519 key lifecycle management will be specified alongside the encryption model.

### 1.2 Relationship to Other Sub-specs

| Sub-spec | Relationship |
|----------|-------------|
| [01 — Entity Graph](./01-entity-graph.md) | Entities that hold DIDs backed by keys defined here |
| 03 — DID Methods | DID documents reference `verificationMethod` entries whose keys are managed here |
| 04 — VC Data Model | Credentials signed using the operations defined here |
| 05 — Trust Architecture | TIR entries reference issuer DIDs whose keys are managed here |
| 07 — Revocation | Status List credentials signed with keys managed here |

### 1.3 Key Decisions

| ID | Decision | Date | Status |
|----|----------|------|--------|
| D14 | Digital ID wallet binding at onboarding (future, custodial for now) | 2026-03-23 | ✅ Confirmed |
| D16 | Ed25519 key algorithm | 2026-03-23 | ✅ Confirmed |
| D25 | Adapters safe to open-source — key material in Cloud KMS, not in code | 2026-03-23 | ✅ Confirmed |

---

## 2. Key Algorithm

### 2.1 Selection: Ed25519 (EdDSA)

All cryptographic keys in PDTF 2.0 use **Ed25519** — the Edwards-curve Digital Signature Algorithm over Curve25519.

### 2.2 Rationale

| Property | Ed25519 | ECDSA (P-256) | RSA-2048 |
|----------|---------|---------------|----------|
| **Signature size** | 64 bytes | 64 bytes | 256 bytes |
| **Public key size** | 32 bytes | 33 bytes (compressed) | 256 bytes |
| **Sign speed** | ~60,000/sec | ~20,000/sec | ~1,000/sec |
| **Verify speed** | ~20,000/sec | ~7,000/sec | ~40,000/sec |
| **Deterministic** | ✅ Yes | ❌ No (nonce-dependent) | ❌ No (PKCS#1 v1.5 is, PSS isn't) |
| **VC ecosystem support** | ✅ Primary | ✅ Good | ⚠️ Legacy |
| **did:key support** | ✅ Native (z6Mk prefix) | ✅ Supported (zDn prefix) | ⚠️ Awkward |
| **Cloud KMS support** | ✅ Google, AWS, Azure | ✅ All | ✅ All |

**Why Ed25519 wins for PDTF 2.0:**

1. **Deterministic signing.** Given the same message and key, Ed25519 always produces the same signature. No nonce generation means no nonce reuse vulnerabilities — a class of attack that has broken ECDSA implementations in the wild (Sony PS3 breach, 2010).

2. **Small and fast.** A 32-byte public key and 64-byte signature are ideal for credentials that may be stored, transmitted, and verified at scale. Property transactions generate dozens of VCs; compact signatures reduce storage and bandwidth.

3. **VC ecosystem alignment.** The W3C Verifiable Credentials ecosystem has converged on Ed25519 as the primary algorithm. The `eddsa-jcs-2022` cryptosuite (used by PDTF 2.0) is defined specifically for EdDSA signatures with JSON Canonicalization Scheme.

4. **did:key native support.** The `did:key` method encodes the public key directly in the identifier. Ed25519 has the cleanest encoding: `z6Mk` prefix, compact base58btc representation, self-resolving without network access.

5. **No side-channel footprint.** Ed25519's constant-time operations make it resistant to timing attacks — important when signing happens in shared cloud infrastructure.

### 2.3 Cryptosuite: eddsa-jcs-2022

PDTF 2.0 uses the **`eddsa-jcs-2022`** cryptosuite as defined in the [W3C Data Integrity EdDSA Cryptosuites specification](https://www.w3.org/TR/vc-di-eddsa/).

Key properties:

- **Canonicalization:** JSON Canonicalization Scheme (JCS, RFC 8785)
- **Hash function:** SHA-256
- **Signature algorithm:** Ed25519 (EdDSA over Curve25519)
- **Proof type:** `DataIntegrityProof`
- **Multibase encoding:** base58btc for signature values

This cryptosuite was chosen over `eddsa-rdfc-2022` (which uses RDF Dataset Canonicalization) because PDTF credentials are JSON-LD but do not require RDF round-tripping. JCS is simpler, faster, and has fewer implementation pitfalls than RDFC.

### 2.4 Algorithm Constants

```
Algorithm:           Ed25519
Curve:               Curve25519 (Twisted Edwards)
Key size:            256 bits (32 bytes)
Signature size:      512 bits (64 bytes)
Hash (for proof):    SHA-256
Multicodec prefix:   0xed01 (Ed25519 public key)
Multibase encoding:  base58btc (prefix 'z')
did:key prefix:      z6Mk...
Cryptosuite:         eddsa-jcs-2022
Proof type:          DataIntegrityProof
```

---

## 3. Key Categories

PDTF 2.0 uses four categories of cryptographic key, each serving a distinct trust function.

### 3.1 Adapter Keys

| Property | Value |
|----------|-------|
| **Purpose** | Sign VCs issued by trusted proxy adapters |
| **DID method** | `did:web` (per-adapter domain) |
| **Cardinality** | One key per adapter |
| **Storage** | Google Cloud KMS (HSM-backed) |
| **Rotation** | Key version rotation in KMS; DID document updated |
| **Example** | `did:web:adapters.propdata.org.uk:hmlr` signs Title credentials |

Adapter keys are the workhorses of the system. Each trusted proxy adapter — HMLR, EPC, EA Flood, Local Authority searches — has its own signing key. When an adapter fetches data from a primary source and wraps it in a VC, it signs with its adapter key.

**Why one key per adapter:**
- **Blast radius containment.** If a key is compromised, only one adapter's credentials are affected.
- **Independent rotation.** Each adapter can rotate keys on its own schedule.
- **TIR granularity.** The Trusted Issuer Registry maps issuer DIDs to entity:path permissions. One DID per adapter means fine-grained trust delegation.

### 3.2 User Keys

| Property | Value |
|----------|-------|
| **Purpose** | Generate user's `did:key` identity; sign user-asserted credentials |
| **DID method** | `did:key` (derived from public key) |
| **Cardinality** | One key per user |
| **Storage** | Google Cloud KMS (software-backed, custodial) |
| **Rotation** | Rotation = new DID (see §7.2) |
| **Example** | `did:key:z6MkhR7...` for a seller, buyer, or conveyancer |

User keys establish individual identity in the PDTF ecosystem. Each person (seller, buyer, conveyancer, estate agent) gets a key pair at onboarding. The public key is encoded as a `did:key` identifier which becomes their persistent identity across all credentials.

**Current model: custodial.**
Moverly generates and holds user keys in Cloud KMS. Users don't directly interact with their key material. This is a pragmatic choice — most property professionals don't have digital wallets, and the onboarding friction of self-sovereign keys would be a barrier to adoption.

**Future model: wallet-bound.**
When digital identity wallets mature (see §10), users will hold their own keys. The custodial model is designed to be replaceable without breaking the credential format.

### 3.3 Platform Key

| Property | Value |
|----------|-------|
| **Purpose** | Moverly's organisational identity; signs platform-level assertions |
| **DID method** | `did:web:moverly.com` |
| **Cardinality** | One key |
| **Storage** | Google Cloud KMS (HSM-backed) |
| **Rotation** | Key version rotation; DID document updated |
| **Signs** | TIR credential, platform metadata, user DID issuance attestations |

The platform key represents Moverly as an organisation. It is used sparingly — primarily for signing the Trusted Issuer Registry credential and attesting that user DIDs were issued through a verified onboarding process.

The platform key is the **root of trust** for the PDTF ecosystem in its current form. Compromise of this key would undermine confidence in the entire TIR. It has the highest security requirements.

### 3.4 Status List Signing

| Property | Value |
|----------|-------|
| **Purpose** | Sign Bitstring Status List credentials for revocation |
| **DID method** | Same as the credential issuer |
| **Key** | Same key as the credential issuer's adapter/platform key |
| **Storage** | Google Cloud KMS (same key — no separate provisioning) |
| **Rotation** | Follows the issuer key's rotation |

Status List credentials are themselves VCs — they must be signed. Status list VCs are signed with the same key used for credential issuance. No separate status list signing key is required. This aligns with W3C Bitstring Status List convention where the status list VC issuer matches the credential issuer. The issuer who can create a credential should also be able to revoke it — and uses the same key for both operations.

**Exception:** If a separate revocation authority is introduced in the future (e.g., a regulatory body that can revoke credentials it didn't issue), it would need its own signing key and TIR entry. This would be a new issuer with its own key, not a separate "status list key."

### 3.5 Category Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PDTF 2.0 Key Categories                       │
├──────────────────┬──────────────┬───────────┬──────────────────────┤
│ Category         │ DID Method   │ Storage   │ Signs                │
├──────────────────┼──────────────┼───────────┼──────────────────────┤
│ Adapter Keys     │ did:web      │ KMS (HSM) │ Source-derived VCs   │
│ User Keys        │ did:key      │ KMS (SW)  │ User assertions      │
│ Platform Key     │ did:web      │ KMS (HSM) │ TIR, attestations    │
│ Status List      │ (same key as │ (same as  │ Bitstring Status     │
│ (not separate)   │  issuer)     │  issuer)  │ List VCs             │
└──────────────────┴──────────────┴───────────┴──────────────────────┘
```

---

## 4. Google Cloud KMS Architecture

All key material in PDTF 2.0 is stored in **Google Cloud KMS**. No private keys exist in application code, environment variables, configuration files, or any other location. This is a foundational security decision (D25).

### 4.1 Why Cloud KMS

1. **No key export.** Private keys generated in KMS never leave KMS. Signing operations happen inside the KMS boundary. Application code sends a hash and receives a signature — it never touches key material.

2. **HSM option.** Critical keys (adapter, platform) use HSM-backed protection — keys are stored in FIPS 140-2 Level 3 hardware security modules.

3. **IAM integration.** Google Cloud IAM controls which service accounts can sign with which keys. This is auditable, enforceable, and doesn't require custom access control code.

4. **Audit logging.** Every signing operation is logged in Cloud Audit Logs. If a key is misused, there's a complete trail.

5. **Automatic versioning.** KMS handles key version management natively. Old versions are retained for verification of previously-signed credentials.

### 4.2 Project Structure

```
Google Cloud Organisation: moverly.com
│
├── Project: pdtf-adapters-prod
│   │
│   ├── Key Ring: hmlr-adapter
│   │   └── Key: hmlr-proxy-signing-key (Ed25519, HSM)
│   │
│   ├── Key Ring: epc-adapter
│   │   └── Key: epc-proxy-signing-key (Ed25519, HSM)
│   │
│   ├── Key Ring: ea-flood-adapter
│   │   └── Key: ea-flood-proxy-signing-key (Ed25519, HSM)
│   │
│   ├── Key Ring: local-auth-adapter
│   │   └── Key: local-auth-proxy-signing-key (Ed25519, HSM)
│   │
│   └── Key Ring: os-adapter
│       └── Key: os-proxy-signing-key (Ed25519, HSM)
│
├── Project: pdtf-platform-prod
│   │
│   └── Key Ring: platform
│       └── Key: moverly-platform-signing-key (Ed25519, HSM)
│       # Status list VCs for platform-issued credentials are signed
│       # with this same key (no separate status list key)
│
└── Project: pdtf-users-prod
    │
    └── Key Ring: user-keys
        ├── Key: user-{uid-1}-key (Ed25519, SOFTWARE)
        ├── Key: user-{uid-2}-key (Ed25519, SOFTWARE)
        └── ... (one per user)
```

**Why separate projects:**

- **Blast radius.** A compromised service account in the adapters project cannot sign with the platform key or user keys.
- **IAM boundaries.** Project-level IAM is the strongest boundary in GCP. Service accounts are scoped to their project.
- **Billing separation.** User key operations (high volume, software-backed) have different cost profiles than adapter keys (lower volume, HSM-backed).
- **Compliance.** Separation simplifies audit: "show me all signing operations for user keys" is a single project query.

### 4.3 Key Ring Organisation

Each adapter gets its own key ring. This provides:

- **Namespace isolation.** Key names are unique within a ring, but rings are independent.
- **Rotation independence.** Rotating one adapter's key doesn't affect others.
- **IAM granularity.** Permissions can be granted at the key ring level — a service account for the HMLR adapter only has access to the `hmlr-adapter` ring.

User keys share a single key ring (`user-keys`) because:

- There may be thousands of user keys. One ring per user would be impractical.
- IAM for user signing is controlled at the application layer (the credential service checks whether the requesting user owns the key before signing).
- All user keys have the same protection level and rotation policy.

### 4.4 Key Naming Conventions

```
Pattern:  {function}-{qualifier}-signing-key
Examples:
  hmlr-proxy-signing-key
  epc-proxy-signing-key
  ea-flood-proxy-signing-key
  moverly-platform-signing-key
  status-list-signing-key
  user-{firebase-uid}-key
```

Key version names are auto-generated by KMS (e.g., `1`, `2`, `3`). The primary version is always the latest enabled version.

### 4.5 IAM Permissions

| Service Account | Project | Permission | Keys |
|----------------|---------|------------|------|
| `hmlr-adapter@pdtf-adapters-prod.iam` | pdtf-adapters-prod | `cloudkms.cryptoKeyVersions.useToSign` | `hmlr-proxy-signing-key` only |
| `epc-adapter@pdtf-adapters-prod.iam` | pdtf-adapters-prod | `cloudkms.cryptoKeyVersions.useToSign` | `epc-proxy-signing-key` only |
| `credential-service@pdtf-users-prod.iam` | pdtf-users-prod | `cloudkms.cryptoKeyVersions.useToSign` | All keys in `user-keys` ring |
| `credential-service@pdtf-users-prod.iam` | pdtf-users-prod | `cloudkms.cryptoKeyVersions.viewPublicKey` | All keys in `user-keys` ring |
| `platform-service@pdtf-platform-prod.iam` | pdtf-platform-prod | `cloudkms.cryptoKeyVersions.useToSign` | `moverly-platform-signing-key` |
| `tir-service@pdtf-platform-prod.iam` | pdtf-platform-prod | `cloudkms.cryptoKeyVersions.useToSign` | `moverly-platform-signing-key` (signs TIR + platform status lists) |
| `did-resolver@pdtf-adapters-prod.iam` | pdtf-adapters-prod | `cloudkms.cryptoKeyVersions.viewPublicKey` | All adapter keys (read-only) |

**Principle of least privilege:** Each service account can only sign with the keys it needs. The DID resolver can read public keys but cannot sign. Adapter service accounts are isolated to their own key ring.

### 4.6 HSM vs Software Protection Levels

| Protection Level | Cost (per key/month) | Use Case | PDTF Usage |
|-----------------|---------------------|----------|------------|
| **SOFTWARE** | ~$0.06 | Development, high-volume low-value | User keys |
| **HSM** | ~$1.00–$2.50 | Production, high-value | Adapter keys, platform key |

**Adapter and platform keys use HSM.** These are high-value targets — a compromised adapter key could forge credentials for an entire data source. The cost premium (~$2.50/month per key) is negligible for the security gain.

**User keys use SOFTWARE.** With potentially thousands of users, HSM costs would be significant ($2,500/month for 1,000 users). Software-backed keys are still stored in KMS (not exportable, IAM-controlled, audit-logged) — they just don't use dedicated HSM hardware. This is an acceptable trade-off because:

- User keys sign fewer credential types (primarily user assertions, not source data)
- Individual key compromise affects one user, not an entire data source
- The migration to wallet-based keys (§10) will eventually move user keys out of KMS entirely

### 4.7 Regional Considerations

All key rings are created in the **`europe-west2` (London)** region.

**UK data sovereignty:** While key material isn't "data" in the GDPR sense, keeping signing infrastructure in the UK aligns with:

- Customer expectations for a UK property platform
- Potential future regulation on digital identity infrastructure
- Latency — signing operations are faster when KMS is co-located with the application

**Disaster recovery:** Key rings can be replicated to `europe-west1` (Belgium) as a secondary region. See §11 for details.

---

## 5. Key Hierarchy

### 5.1 Full Hierarchy Diagram

```
Google Cloud KMS
│
├── Adapter Keys (did:web, per-adapter)
│   │
│   ├── hmlr-proxy-key
│   │   ├── DID: did:web:adapters.propdata.org.uk:hmlr
│   │   ├── Signs: Title VCs, register extract VCs
│   │   └── TIR entry: Title.*, Title.registerExtract.*
│   │
│   ├── epc-proxy-key
│   │   ├── DID: did:web:adapters.propdata.org.uk:epc
│   │   ├── Signs: Property.energyPerformance VCs
│   │   └── TIR entry: Property.energyPerformance.*
│   │
│   ├── ea-flood-proxy-key
│   │   ├── DID: did:web:adapters.propdata.org.uk:ea-flood
│   │   ├── Signs: Property.environmental.flooding VCs
│   │   └── TIR entry: Property.environmental.flooding.*
│   │
│   ├── local-auth-proxy-key
│   │   ├── DID: did:web:adapters.propdata.org.uk:llc
│   │   ├── Signs: Local authority search VCs
│   │   └── TIR entry: Property.localAuthority.*
│   │
│   └── os-proxy-key
│       ├── DID: did:web:adapters.propdata.org.uk:os
│       ├── Signs: Property.address VCs (OS Places)
│       └── TIR entry: Property.address.*
│
├── User Keys (did:key, per-user)
│   │
│   ├── user-{uid-1}-key
│   │   ├── DID: did:key:z6MkhR7...abc
│   │   └── Signs: TA6/TA7/TA10 form VCs, consent VCs
│   │
│   ├── user-{uid-2}-key
│   │   ├── DID: did:key:z6MkpT9...def
│   │   └── Signs: TA6/TA7/TA10 form VCs, consent VCs
│   │
│   └── ... (one per onboarded user)
│
└── Platform Key
    │
    └── moverly-platform-key
        ├── DID: did:web:moverly.com
        ├── Signs: TIR credential, platform attestations
        └── TIR entry: (root — signs the TIR itself)
```

### 5.2 Trust Chain

The key hierarchy establishes a trust chain:

```
Platform Key (did:web:moverly.com)
    │
    ├── Signs TIR ──→ TIR lists adapter DIDs as trusted issuers
    │                  for specific entity:path combinations
    │
    ├── Adapter Keys (did:web:adapters.propdata.org.uk:{adapter})
    │   └── Sign source-derived VCs ──→ Verifiable by resolving
    │       adapter DID + checking TIR entry
    │
    └── User Keys (did:key:z6Mk...)
        └── Sign user-asserted VCs ──→ Verifiable by resolving
            did:key + checking TIR userAccountProviders entry
```

**Note:** This is not a certificate chain in the X.509 sense. There's no chain-of-signatures from platform key down to adapter keys. Instead, trust is established by the TIR: the platform key signs the TIR, and the TIR declares which adapter DIDs are trusted for which credential types. Verification checks the TIR, not a certificate chain.

---

## 6. Key Generation

### 6.1 Adapter Key Generation

Adapter keys are generated when a new trusted proxy adapter is provisioned.

**Process:**

```
1. Create key ring in pdtf-adapters-prod project
   gcloud kms keyrings create {adapter}-adapter \
     --location=europe-west2 \
     --project=pdtf-adapters-prod

2. Create Ed25519 signing key (HSM-backed)
   gcloud kms keys create {adapter}-proxy-signing-key \
     --keyring={adapter}-adapter \
     --location=europe-west2 \
     --purpose=asymmetric-signing \
     --default-algorithm=ec-sign-ed25519 \
     --protection-level=hsm \
     --project=pdtf-adapters-prod

3. Export public key
   gcloud kms keys versions get-public-key 1 \
     --key={adapter}-proxy-signing-key \
     --keyring={adapter}-adapter \
     --location=europe-west2 \
     --project=pdtf-adapters-prod \
     --output-file={adapter}-public-key.pem

4. Generate DID document from public key
   → Extract raw 32-byte Ed25519 public key from PEM
   → Construct did:web:adapters.propdata.org.uk:{adapter} DID document
   → Publish DID document at https://adapters.propdata.org.uk/{adapter}/did.json

5. Register adapter DID in TIR
   → Add issuer entry with entity:path permissions
   → Sign updated TIR with platform key
```

### 6.2 User Key Generation

User keys are generated during onboarding — when a person first joins a PDTF transaction.

**Process:**

```
1. User completes onboarding (identity verification, account creation)

2. Credential service creates key in KMS
   POST https://cloudkms.googleapis.com/v1/
     projects/pdtf-users-prod/locations/europe-west2/
     keyRings/user-keys/cryptoKeys
   {
     "purpose": "ASYMMETRIC_SIGN",
     "versionTemplate": {
       "algorithm": "EC_SIGN_ED25519",
       "protectionLevel": "SOFTWARE"
     },
     "cryptoKeyId": "user-{firebase-uid}-key"
   }

3. Export public key
   GET .../cryptoKeyVersions/1/publicKey

4. Derive did:key from public key (see §6.3)

5. Store DID ↔ KMS key mapping in Firestore
   users/{uid}/did → "did:key:z6Mk..."
   users/{uid}/kmsKeyPath → "projects/pdtf-users-prod/..."
```

### 6.3 Ed25519 → did:key Derivation

The `did:key` method encodes the public key directly in the identifier. Here's the derivation:

```
Input:  Raw Ed25519 public key (32 bytes)
        Example: 0x8a7f...2b4c (32 bytes)

Step 1: Prepend multicodec prefix for Ed25519 public key
        Prefix: 0xed01 (varint-encoded)
        Result: 0xed01 || public_key (34 bytes)

Step 2: Encode as multibase (base58btc)
        Encoding: base58btc with 'z' prefix
        Result: "z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We"

Step 3: Construct did:key
        Result: "did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We"
```

**Pseudocode:**

```typescript
import { base58btc } from 'multiformats/bases/base58';

function publicKeyToDidKey(publicKey: Uint8Array): string {
  // Ed25519 multicodec prefix: 0xed 0x01
  const ED25519_CODEC = new Uint8Array([0xed, 0x01]);

  // Prepend codec prefix to public key
  const multicodecKey = new Uint8Array(2 + publicKey.length);
  multicodecKey.set(ED25519_CODEC);
  multicodecKey.set(publicKey, 2);

  // Encode as multibase base58btc (prefix 'z')
  const multibaseEncoded = base58btc.encode(multicodecKey);
  // base58btc.encode already includes the 'z' prefix

  return `did:key:${multibaseEncoded}`;
}

// Example:
// publicKey = <32 bytes from KMS>
// did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We
```

**Why the `z6Mk` prefix pattern:**

- `z` = multibase prefix for base58btc encoding
- `6Mk` = the base58btc encoding of the `0xed01` multicodec prefix

Every Ed25519 `did:key` starts with `z6Mk`. This is a useful sanity check: if a `did:key` doesn't start with `z6Mk`, it's either not Ed25519 or it's malformed.

### 6.4 Platform Key Generation

The platform key is generated once during initial PDTF 2.0 deployment. The process mirrors adapter key generation but uses the `pdtf-platform-prod` project and publishes the DID document at `https://moverly.com/.well-known/did.json`.

### 6.5 Key Generation Audit Trail

Every key generation event is logged:

```json
{
  "event": "key_generated",
  "timestamp": "2026-03-24T10:00:00Z",
  "category": "adapter|user|platform",
  "kmsKeyPath": "projects/pdtf-adapters-prod/locations/europe-west2/keyRings/hmlr-adapter/cryptoKeys/hmlr-proxy-signing-key/cryptoKeyVersions/1",
  "did": "did:web:adapters.propdata.org.uk:hmlr",
  "protectionLevel": "HSM",
  "algorithm": "EC_SIGN_ED25519",
  "generatedBy": "credential-service@pdtf-adapters-prod.iam"
}
```

---

## 7. Key Rotation

Key rotation strategies differ significantly between key categories because of the relationship between keys and DIDs.

### 7.1 Adapter Key Rotation (did:web)

Adapter keys use `did:web`, which means the DID document is hosted at a URL and can be updated. This makes rotation straightforward.

**Process:**

```
1. Create new key version in KMS
   gcloud kms keys versions create \
     --key=hmlr-proxy-signing-key \
     --keyring=hmlr-adapter \
     --location=europe-west2 \
     --project=pdtf-adapters-prod

2. Set new version as primary
   gcloud kms keys update hmlr-proxy-signing-key \
     --keyring=hmlr-adapter \
     --location=europe-west2 \
     --primary-version=2 \
     --project=pdtf-adapters-prod

3. Update DID document
   - Add new key as primary verificationMethod
   - Move old key to verificationMethod array (retained for verification)
   - Update assertionMethod to reference new key
```

**DID document after rotation:**

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:adapters.propdata.org.uk:hmlr",
  "verificationMethod": [
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#key-2",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:adapters.propdata.org.uk:hmlr",
      "publicKeyMultibase": "z6Mkn...new..."
    },
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:adapters.propdata.org.uk:hmlr",
      "publicKeyMultibase": "z6Mkh...old..."
    }
  ],
  "assertionMethod": [
    "did:web:adapters.propdata.org.uk:hmlr#key-2"
  ]
}
```

**Key properties of adapter rotation:**

- **Old VCs remain verifiable.** The old public key stays in the DID document's `verificationMethod` array. Any VC signed with `#key-1` can still be verified.
- **New VCs use the new key.** The `assertionMethod` points to `#key-2`, so new credentials reference the new key.
- **No re-issuance needed.** Existing credentials don't need to be re-signed.
- **Rotation frequency.** Recommended: annually, or immediately on suspected compromise.

### 7.2 User Key Rotation (did:key)

User key rotation is fundamentally different because `did:key` identifiers are **derived from the public key itself**. A new key means a new DID.

**The problem:**

```
Old key pair → did:key:z6MkhR7...abc
New key pair → did:key:z6MkpT9...def

These are different DIDs. Every credential that references
did:key:z6MkhR7...abc now references a DID that the user
no longer controls (if the old key is disabled).
```

**Implications:**

1. **All credentials must be re-issued.** Ownership, Representation, DelegatedConsent — every VC where the user is the `credentialSubject` or `issuer` must be re-created with the new DID.

2. **Linked credentials must be updated.** If a user's DID appears in an Offer, Ownership, or Representation credential, those credentials reference the old DID. They need re-issuance.

3. **Old credentials remain verifiable** (the old key still exists in KMS), but they reference an identity the user may no longer claim.

**Mitigation strategy:**

```
1. Retain old key in KMS (disabled for signing, enabled for verification)
2. Generate new key → new did:key
3. Create a "DID rotation" attestation:
   {
     "type": "DidRotationAttestation",
     "previousDid": "did:key:z6MkhR7...abc",
     "newDid": "did:key:z6MkpT9...def",
     "rotationDate": "2026-06-01T00:00:00Z",
     "reason": "scheduled_rotation"
   }
   Signed by the platform key (did:web:moverly.com)
4. Re-issue all active credentials with the new DID
5. Old credentials enter a grace period, then are revoked
```

**When to rotate user keys:**

- **Suspected compromise.** Immediate rotation + credential re-issuance.
- **Wallet migration (§10).** User transitions from custodial to self-sovereign — their wallet provides a new key, resulting in a new DID.
- **Routine rotation.** Not recommended for `did:key` users due to the re-issuance cost. If periodic rotation is required, consider migrating the user to `did:web` (which supports in-place rotation).

### 7.3 Platform Key Rotation

Platform key rotation follows the same pattern as adapter key rotation (§7.1): new key version in KMS, updated DID document at `https://moverly.com/.well-known/did.json`, old key retained in `verificationMethod`.

**Additional consideration:** The TIR credential is signed by the platform key. After rotation, a new TIR credential must be signed with the new key version and published. Verifiers should accept TIR credentials signed by any key version listed in the platform DID document.

### 7.4 Rotation Schedule

| Key Category | Routine Rotation | Compromise Rotation | Re-issuance Required |
|-------------|-----------------|--------------------|--------------------|
| Adapter Keys | Annually | Immediate | No |
| User Keys | Not recommended | Immediate | Yes (all credentials) |
| Platform Key | Annually | Immediate | TIR credential only |
| Status Lists | Follows issuer key | Follows issuer key | Current status list VC (signed by issuer's key) |

---

## 8. Signing Operations

This section defines how a Verifiable Credential is signed using the `eddsa-jcs-2022` cryptosuite and Google Cloud KMS.

### 8.1 Signing Flow

```
┌─────────────────────┐
│  Unsigned VC (JSON)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Canonicalise (JCS)  │  RFC 8785 — deterministic JSON serialization
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Hash (SHA-256)     │  → 32-byte digest
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Sign via KMS API   │  asymmetricSign(digest)
│   (Ed25519)          │  → 64-byte signature
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Encode multibase    │  base58btc ('z' prefix)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Attach proof to VC  │  DataIntegrityProof
└─────────────────────┘
```

### 8.2 Signing Pseudocode

```typescript
import { canonicalize } from 'json-canonicalize';  // RFC 8785
import { sha256 } from '@noble/hashes/sha256';
import { base58btc } from 'multiformats/bases/base58';
import { KeyManagementServiceClient } from '@google-cloud/kms';

interface UnsignedVC {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: Record<string, unknown>;
  credentialStatus?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SignedVC extends UnsignedVC {
  proof: DataIntegrityProof;
}

interface DataIntegrityProof {
  type: 'DataIntegrityProof';
  cryptosuite: 'eddsa-jcs-2022';
  verificationMethod: string;
  created: string;
  proofPurpose: 'assertionMethod';
  proofValue: string;  // multibase-encoded signature
}

async function signCredential(
  vc: UnsignedVC,
  kmsKeyPath: string,
  verificationMethodId: string
): Promise<SignedVC> {
  const kmsClient = new KeyManagementServiceClient();

  // Step 1: Construct proof options (without proofValue)
  const proofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    verificationMethod: verificationMethodId,
    created: new Date().toISOString(),
    proofPurpose: 'assertionMethod',
  };

  // Step 2: Canonicalise the VC (without proof) using JCS
  const canonicalVC = canonicalize(vc);

  // Step 3: Canonicalise the proof options (without proofValue)
  const canonicalProof = canonicalize(proofOptions);

  // Step 4: Hash both with SHA-256
  const vcHash = sha256(new TextEncoder().encode(canonicalVC));
  const proofHash = sha256(new TextEncoder().encode(canonicalProof));

  // Step 5: Combine hashes (proof hash || vc hash)
  const combinedHash = new Uint8Array(64);
  combinedHash.set(proofHash, 0);
  combinedHash.set(vcHash, 32);

  // Step 6: Hash the combined value
  const finalDigest = sha256(combinedHash);

  // Step 7: Sign the digest using KMS
  const [signResponse] = await kmsClient.asymmetricSign({
    name: kmsKeyPath,
    data: Buffer.from(finalDigest),
  });

  // Step 8: Encode signature as multibase (base58btc)
  const signatureBytes = new Uint8Array(signResponse.signature as ArrayBuffer);
  const proofValue = base58btc.encode(signatureBytes);

  // Step 9: Attach proof to VC
  return {
    ...vc,
    proof: {
      ...proofOptions,
      proofValue,
    },
  };
}
```

### 8.3 Example Signed Credential

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://schema.pdtf.org/v4/context"
  ],
  "type": ["VerifiableCredential", "TitleCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:hmlr",
  "issuanceDate": "2026-03-24T10:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:titleNumber:ABC123456",
    "titleNumber": "ABC123456",
    "tenure": "freehold",
    "registerExtract": {
      "proprietorship": {
        "owners": ["did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We"]
      }
    }
  },
  "credentialStatus": {
    "id": "https://status.moverly.com/credentials/status/1#42",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "42",
    "statusListCredential": "https://status.moverly.com/credentials/status/1"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:hmlr#key-2",
    "created": "2026-03-24T10:00:00Z",
    "proofPurpose": "assertionMethod",
    "proofValue": "z3FXQehFeufbEp8v6rTjLx..."
  }
}
```

### 8.4 KMS API Call Detail

The actual KMS signing call:

```typescript
// KMS key version path format:
// projects/{project}/locations/{location}/keyRings/{ring}/
//   cryptoKeys/{key}/cryptoKeyVersions/{version}

const kmsKeyVersionPath =
  'projects/pdtf-adapters-prod/locations/europe-west2/' +
  'keyRings/hmlr-adapter/cryptoKeys/hmlr-proxy-signing-key/' +
  'cryptoKeyVersions/2';

const [response] = await kmsClient.asymmetricSign({
  name: kmsKeyVersionPath,
  data: Buffer.from(digest),
  // Note: no digest type needed for Ed25519 — the full
  // message is signed, not a pre-hashed digest.
  // KMS handles Ed25519 as a "raw" signature.
});

// response.signature is a Buffer containing the 64-byte Ed25519 signature
```

**Important:** Google Cloud KMS Ed25519 signing takes the raw message bytes, not a pre-hashed digest. The KMS service performs the Ed25519 sign operation internally (which includes its own SHA-512 hash as part of the Ed25519 algorithm). Our SHA-256 hash in Step 6 above is the **proof hash** per the `eddsa-jcs-2022` spec — it produces the message that KMS then signs with Ed25519.

---

## 9. Verification Operations

Verification is the counterpart to signing — and it's the more important operation. Anyone can verify a PDTF credential without access to KMS, without being a Moverly customer, and without any special infrastructure. This is the core value proposition of the VC model.

### 9.1 Verification Flow

```
┌─────────────────────┐
│   Signed VC (JSON)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Extract proof block │  Separate proof from VC body
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Resolve DID         │  verificationMethod → DID document → public key
│  (did:key or did:web)│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Canonicalise (JCS)  │  VC without proof + proof options without proofValue
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Hash (SHA-256)     │  Same combined hash as signing
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Decode signature    │  multibase base58btc → raw bytes
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Verify Ed25519      │  verify(publicKey, message, signature)
│  signature           │  → true / false
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Check TIR entry     │  Is issuer trusted for this entity:path?
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Check revocation    │  Resolve Bitstring Status List
└─────────────────────┘
```

### 9.2 Verification Pseudocode

```typescript
import { canonicalize } from 'json-canonicalize';
import { sha256 } from '@noble/hashes/sha256';
import { base58btc } from 'multiformats/bases/base58';
import { ed25519 } from '@noble/curves/ed25519';

interface VerificationResult {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    issuerTrusted: boolean;
    notRevoked: boolean;
    proofPurposeValid: boolean;
  };
  error?: string;
}

async function verifyCredential(
  signedVC: SignedVC,
  didResolver: DIDResolver,
  tirRegistry: TIRRegistry
): Promise<VerificationResult> {

  // Step 1: Extract and separate proof
  const { proof, ...vcWithoutProof } = signedVC;

  // Step 2: Validate proof metadata
  if (proof.type !== 'DataIntegrityProof') {
    return { valid: false, error: 'Unsupported proof type', checks: { ...allFalse } };
  }
  if (proof.cryptosuite !== 'eddsa-jcs-2022') {
    return { valid: false, error: 'Unsupported cryptosuite', checks: { ...allFalse } };
  }

  // Step 3: Resolve verificationMethod → public key
  const didDocument = await didResolver.resolve(
    proof.verificationMethod.split('#')[0]
  );
  const verificationMethod = didDocument.verificationMethod.find(
    vm => vm.id === proof.verificationMethod
  );
  if (!verificationMethod) {
    return { valid: false, error: 'Verification method not found', checks: { ...allFalse } };
  }

  // Step 4: Check proof purpose — verificationMethod must be listed
  // in the DID document's assertionMethod
  if (!didDocument.assertionMethod?.includes(proof.verificationMethod)) {
    // For did:key, assertionMethod is implicit
    if (!proof.verificationMethod.startsWith('did:key:')) {
      return { valid: false, error: 'Key not authorised for assertions', checks: { ...allFalse } };
    }
  }

  // Step 5: Extract public key from multibase encoding
  const publicKeyBytes = base58btc.decode(
    verificationMethod.publicKeyMultibase
  );
  // Strip multicodec prefix (0xed01) to get raw 32-byte key
  const rawPublicKey = publicKeyBytes.slice(2);

  // Step 6: Canonicalise VC (without proof) and proof options
  const canonicalVC = canonicalize(vcWithoutProof);
  const { proofValue, ...proofOptions } = proof;
  const canonicalProof = canonicalize(proofOptions);

  // Step 7: Hash
  const vcHash = sha256(new TextEncoder().encode(canonicalVC));
  const proofHash = sha256(new TextEncoder().encode(canonicalProof));
  const combinedHash = new Uint8Array(64);
  combinedHash.set(proofHash, 0);
  combinedHash.set(vcHash, 32);
  const finalDigest = sha256(combinedHash);

  // Step 8: Decode signature from multibase
  const signatureBytes = base58btc.decode(proof.proofValue);

  // Step 9: Verify Ed25519 signature
  const signatureValid = ed25519.verify(
    signatureBytes,
    finalDigest,
    rawPublicKey
  );

  if (!signatureValid) {
    return {
      valid: false,
      error: 'Signature verification failed',
      checks: { signatureValid: false, issuerTrusted: false, notRevoked: false, proofPurposeValid: true },
    };
  }

  // Step 10: Check TIR — is this issuer trusted for this credential type?
  const issuerTrusted = await tirRegistry.isIssuerTrusted(
    signedVC.issuer,
    signedVC.type,
    signedVC.credentialSubject
  );

  // Step 11: Check revocation status
  const notRevoked = signedVC.credentialStatus
    ? await checkBitstringStatusList(signedVC.credentialStatus)
    : true;  // No status = not revocable

  return {
    valid: signatureValid && issuerTrusted && notRevoked,
    checks: {
      signatureValid,
      issuerTrusted,
      notRevoked,
      proofPurposeValid: true,
    },
  };
}
```

### 9.3 DID Resolution for Verification

Verification requires resolving the signer's DID to obtain their public key. The resolution method depends on the DID type:

**`did:key` resolution (self-resolving):**
```
did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We
         └─────────────────────────────────────────────────┘
                    ↓ decode multibase (base58btc)
                    ↓ strip multicodec prefix (0xed01)
                    ↓ 32-byte Ed25519 public key
```

No network request needed. The public key is in the identifier itself. The DID resolver constructs a synthetic DID document:

```json
{
  "id": "did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We",
  "verificationMethod": [{
    "id": "did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We#z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We",
    "publicKeyMultibase": "z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We"
  }],
  "assertionMethod": [
    "did:key:z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We#z6MkhR7dwAfmApGgfkMbZGaQmR5MoDxjTQR3TVRii5YDE4We"
  ]
}
```

**`did:web` resolution (HTTP-based):**
```
did:web:adapters.propdata.org.uk:hmlr
         ↓ map to URL
https://adapters.propdata.org.uk/hmlr/did.json
         ↓ HTTP GET
         ↓ parse JSON DID document
         ↓ find verificationMethod by ID
         ↓ extract publicKeyMultibase → decode → public key
```

**Caching:** `did:web` resolution results should be cached with a TTL (recommended: 1 hour). This reduces latency for batch verification while ensuring rotated keys are picked up within a reasonable window.

### 9.4 Verification Without Platform Access

A critical design property: **anyone can verify a PDTF credential without being a Moverly customer or having access to Moverly infrastructure.**

They need:
1. The signed VC (JSON document)
2. Internet access to resolve `did:web` DIDs (or nothing at all for `did:key`)
3. An Ed25519 verification library (available in every major language)
4. Optionally, access to the TIR (to check issuer trust) and Status List (to check revocation)

This is the fundamental difference from PDTF v1, where verification meant "trust the platform that served you the data."

---

## 10. Digital ID Wallet Binding (Future)

> **Decision D14:** Digital ID wallet binding at onboarding (future, custodial for now).

### 10.1 Current State: Custodial Keys

Today, Moverly generates and manages user keys in Cloud KMS. Users authenticate via Firebase Auth and never directly interact with their cryptographic identity. The credential service signs on their behalf when they make assertions (e.g., completing a TA6 property information form).

**Advantages of custodial model:**
- Zero onboarding friction — users don't need a wallet
- Familiar auth model (email/password, social login)
- Key backup and recovery handled by platform
- Works today, with existing infrastructure

**Disadvantages:**
- Users must trust Moverly not to sign on their behalf without consent
- Not truly self-sovereign — Moverly can revoke access to a user's identity
- Doesn't meet the highest bar of decentralised identity frameworks
- Single point of compromise for all user identities

### 10.2 Future State: Wallet-Bound Keys

When digital identity wallets reach sufficient maturity and adoption in the UK property sector, PDTF 2.0 will support **wallet-bound keys** — where the user's private key lives in their own wallet, not in Moverly's KMS.

**How it works:**

```
Today (Custodial):
  User ──→ Moverly KMS ──→ did:key:z6Mk...
  (User authenticates, Moverly signs on their behalf)

Future (Wallet-Bound):
  User ──→ Own Wallet ──→ did:key:z6Mk...
  (User's wallet signs directly, Moverly never holds the private key)
```

### 10.3 Migration Path

```
Phase 1: Custodial (Current)
  - All user keys in Cloud KMS
  - Users authenticate via Firebase Auth
  - Credential service signs on user's behalf

Phase 2: Hybrid (Transitional)
  - New users can onboard with a wallet OR email/password
  - Wallet users: wallet presents identity credential at onboarding,
    wallet's DID used directly
  - Email users: continue with custodial KMS keys
  - Both types coexist in the same transaction

Phase 3: Wallet-Preferred (Future)
  - Wallet onboarding is the default path
  - Email/password falls back to custodial
  - Existing custodial users can migrate:
    1. Install wallet app
    2. Wallet generates new key pair → new did:key
    3. Moverly verifies wallet ownership (challenge-response)
    4. DID rotation attestation signed by platform key
    5. All active credentials re-issued with new DID
    6. Old KMS key disabled for signing, retained for verification

Phase 4: Wallet-Required (Distant Future)
  - All users must use a wallet
  - Custodial model deprecated
  - Moverly's role is platform + trusted proxy, not identity provider
```

### 10.4 Wallet Interaction Protocol

When a user onboards with a wallet:

```
1. User opens Moverly, selects "Connect Wallet"
2. Moverly sends a challenge (random nonce)
3. Wallet signs the challenge with user's private key
4. Moverly verifies the signature → confirms wallet ownership
5. Wallet presents verifiable identity credential
   (e.g., from a DCMS-certified identity provider)
6. Moverly verifies identity credential
7. Wallet's did:key is associated with the user account
8. Future signing requests are routed to the wallet
   (Moverly sends unsigned VC → wallet signs → returns signed VC)
```

### 10.5 UK Digital Identity Framework Alignment

The UK Department for Culture, Media and Sport (DCMS) maintains a [UK digital identity and attributes trust framework](https://www.gov.uk/government/publications/uk-digital-identity-and-attributes-trust-framework). PDTF 2.0 is designed to align with this framework:

- **Identity proofing:** Wallets from DCMS-certified providers can issue identity credentials that PDTF verifies at onboarding.
- **Attribute assertions:** Property-specific attributes (ownership, representation) remain PDTF credentials, but the underlying identity comes from a trusted wallet.
- **Interoperability:** DCMS framework uses W3C VCs and DIDs — the same stack PDTF 2.0 is built on.

**Open question:** Which wallet providers will be supported at launch? The DCMS framework is still maturing, and adoption in the property sector is early. This is tracked in §13.

---

## 11. Backup & Recovery

### 11.1 Design Principle: No Key Export

Google Cloud KMS keys **cannot be exported**. This is a feature, not a limitation. If key material can be exported, it can be stolen. The entire security model is built on keys never leaving the KMS boundary.

**Implication:** Backup means ensuring the KMS infrastructure is resilient, not copying key material to another location.

### 11.2 KMS Built-in Protections

| Feature | How It Helps |
|---------|-------------|
| **Automatic versioning** | Every key has immutable version history. Accidental deletion of a version is recoverable within the destruction grace period (default: 24 hours). |
| **Destruction grace period** | Key versions scheduled for destruction can be restored within the grace period. Configured to 30 days for all PDTF keys. |
| **IAM protection** | Keys can only be destroyed by accounts with `cloudkms.cryptoKeys.destroy` permission. This permission is granted only to a dedicated security admin role, not to application service accounts. |
| **Organisation policy constraints** | GCP organisation policies can prevent key destruction entirely (`constraints/cloudkms.minimumDestroyScheduledDuration`). |

### 11.3 Disaster Recovery

**Scenario: Regional outage (europe-west2 unavailable)**

For `did:web` adapter and platform keys:
1. Keys in the affected region are temporarily unavailable for signing.
2. Verification continues to work (verifiers only need the public key, which is in the DID document served from separate infrastructure).
3. New credentials cannot be signed until the region recovers.
4. **Mitigation:** Consider multi-region key rings or a secondary KMS in `europe-west1`.

For `did:key` user keys:
1. Same as above — signing is unavailable until region recovers.
2. Verification is unaffected (public key is in the DID itself).

**Scenario: Key compromise**

See §12.4 for the key compromise response plan.

**Scenario: Accidental key deletion**

1. Key versions have a 30-day destruction grace period.
2. Alert triggers immediately on any `ScheduleKeyVersionDestruction` operation.
3. Recovery: `RestoreCryptoKeyVersion` within the grace period.

### 11.4 Cross-Region Replication

For production deployment, consider Cloud KMS key replication:

```
Primary:   europe-west2 (London)
Secondary: europe-west1 (Belgium)

Replication is NOT automatic for Cloud KMS.
Strategy: maintain a parallel set of key versions in the secondary region.

For adapter/platform keys:
  - Generate key in primary region (active)
  - Generate equivalent key in secondary region (standby)
  - DID document lists both keys in verificationMethod
  - Failover: switch assertionMethod to secondary key

For user keys:
  - Secondary KMS generation at user onboarding
  - Higher cost (double the keys) but full DR capability
  - Alternative: accept signing downtime during regional outage
    (verification is unaffected for did:key)
```

---

## 12. Security Considerations

### 12.1 KMS Access Controls

**Defence in depth:**

```
Layer 1: GCP Project Boundaries
  └── Adapter, platform, and user keys in separate projects
      └── Service account can only exist in one project

Layer 2: IAM Roles
  └── cloudkms.cryptoKeyVersions.useToSign — signing only
  └── cloudkms.cryptoKeyVersions.viewPublicKey — read public key only
  └── cloudkms.admin — key management (not granted to applications)
      └── Assigned to humans via break-glass procedure only

Layer 3: Key Ring Scope
  └── IAM bindings at key ring level (adapter-specific)
  └── Service accounts can only sign with their own adapter's key

Layer 4: Application-Level Controls
  └── Credential service validates user identity before signing
  └── Rate limiting on signing requests
  └── Request logging with caller identity
```

### 12.2 Audit Logging

All KMS operations generate Cloud Audit Logs:

| Operation | Log Type | Retention |
|-----------|----------|-----------|
| `AsymmetricSign` | Data Access | 30 days (default), exported to BigQuery for long-term |
| `GetPublicKey` | Data Access | 30 days |
| `CreateCryptoKey` | Admin Activity | 400 days |
| `DestroyCryptoKeyVersion` | Admin Activity | 400 days |
| `UpdateCryptoKeyPrimaryVersion` | Admin Activity | 400 days |

**Alerting:**

- Any `DestroyCryptoKeyVersion` → immediate alert to security team
- `AsymmetricSign` rate exceeding 10x normal → anomaly alert
- `AsymmetricSign` from unexpected service account → immediate alert
- Any `SetIamPolicy` on KMS resources → immediate alert

### 12.3 Separation of Concerns

```
                    ┌─────────────────────┐
                    │   Platform Key      │
                    │   (highest value)    │
                    │                     │
                    │   Separate project   │
                    │   HSM-backed         │
                    │   Break-glass only   │
                    └─────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Adapter Keys │ │ Adapter Keys │ │ Adapter Keys │
    │ (per-adapter)│ │ (per-adapter)│ │ (per-adapter)│
    │              │ │              │ │              │
    │ Own key ring │ │ Own key ring │ │ Own key ring │
    │ Own IAM      │ │ Own IAM      │ │ Own IAM      │
    └──────────────┘ └──────────────┘ └──────────────┘
              │
              │   No cross-access
              │
    ┌──────────────┐
    │  User Keys   │
    │  (high vol.) │
    │              │
    │  Separate    │
    │  project     │
    │  SW-backed   │
    └──────────────┘
```

**Key principle:** Compromise of one adapter's service account cannot affect any other adapter, any user key, or the platform key. Each adapter is an island.

### 12.4 Key Compromise Response Plan

**If an adapter key is compromised:**

```
1. IMMEDIATE: Disable the compromised key version in KMS
2. IMMEDIATE: Generate new key version, set as primary
3. WITHIN 1 HOUR: Update adapter DID document (remove compromised key
   from assertionMethod, keep in verificationMethod with "compromised" note)
4. WITHIN 4 HOURS: Assess scope — which credentials were potentially
   forged during the compromise window?
5. WITHIN 24 HOURS: Re-issue affected credentials with new key version
6. WITHIN 24 HOURS: Notify affected parties (platform users,
   relying parties)
7. POST-INCIDENT: Root cause analysis, update access controls
```

**If a user key is compromised:**

```
1. IMMEDIATE: Disable the compromised key in KMS
2. IMMEDIATE: Generate new key → new did:key for the user
3. WITHIN 1 HOUR: Revoke all credentials referencing the old DID
   (set revocation bit in Status Lists)
4. WITHIN 4 HOURS: Re-issue credentials with new DID
5. WITHIN 24 HOURS: Notify the affected user and their transaction
   counterparties
```

**If the platform key is compromised:**

```
1. IMMEDIATE: Disable the compromised key version
2. IMMEDIATE: Generate new key version
3. IMMEDIATE: Update platform DID document
4. WITHIN 1 HOUR: Re-sign the TIR with the new key
5. WITHIN 4 HOURS: Notify all relying parties that the TIR
   has been re-signed (the old TIR signature is no longer trusted)
6. POST-INCIDENT: Full security audit of all platform operations
   during the compromise window
```

### 12.5 Threat Model Summary

| Threat | Impact | Mitigation |
|--------|--------|-----------|
| Adapter key compromise | Forged credentials for one data source | Per-adapter key isolation, KMS HSM, IAM, revocation |
| User key compromise | Forged assertions for one user | Custodial control, KMS access logging, revocation |
| Platform key compromise | Forged TIR, undermined trust model | HSM, break-glass access, minimal usage, audit logging |
| KMS region outage | Signing unavailable | Cross-region DR, verification unaffected |
| Insider threat (Moverly employee) | Access to signing operations | IAM least-privilege, audit logs, break-glass for admin |
| Supply chain (library compromise) | Malformed signatures or key extraction | Dependency pinning, no key material in application memory |

---

## 13. Open Questions

| # | Question | Context | Status |
|---|----------|---------|--------|
| Q1 | Should user keys use HSM protection at higher cost, or is SOFTWARE acceptable? | Currently proposed: SOFTWARE for cost. HSM would be ~$2.50/user/month. | Leaning SOFTWARE |
| Q2 | Which digital identity wallet providers will be supported for Phase 2? | DCMS framework is evolving. No UK property-sector wallets exist yet. | Awaiting market |
| Q3 | Should we support `did:web` for users (enabling in-place rotation) as an alternative to `did:key`? | Would eliminate the re-issuance problem on rotation, but adds hosting dependency. | Under discussion |
| Q4 | What is the destruction grace period for user keys vs adapter/platform keys? | Proposed: 30 days for all. Could be longer for platform key. | 30 days proposed |
| Q5 | ~~Should Status List signing keys be separate from adapter keys?~~ | **Resolved:** Same key. Status list VCs are signed with the same key used for credential issuance. No separate status list signing key is required. This aligns with W3C Bitstring Status List convention. | ✅ Same key |
| Q6 | How do we handle adapter key rotation for credentials with long validity periods? | A Title credential might be valid for years. The old key must remain resolvable for the credential's lifetime. | Retain in DID doc |
| Q7 | Should cross-region KMS replication be implemented at launch or deferred? | Cost vs resilience trade-off. Verification is unaffected by regional outage. | Deferred |
| Q8 | What rate limits should be applied to user key signing operations? | Protects against abuse if a user's session is compromised. | TBD |

---

## 14. Implementation Notes

### 14.1 Library Dependencies

| Library | Purpose | Version |
|---------|---------|---------|
| `@google-cloud/kms` | Cloud KMS client for signing operations | ^4.x |
| `@noble/curves` | Ed25519 signature verification (no KMS needed) | ^1.x |
| `@noble/hashes` | SHA-256 hashing | ^1.x |
| `json-canonicalize` | JCS canonicalization (RFC 8785) | ^2.x |
| `multiformats` | Multibase/multicodec encoding | ^13.x |
| `did-resolver` | DID resolution framework | ^4.x |

### 14.2 Reference Implementation Packages

| Package | Repository | Status |
|---------|-----------|--------|
| `@pdtf/vc-signer` | `property-data-standards-co/pdtf-vc-signer` | Planned |
| `@pdtf/vc-verifier` | `property-data-standards-co/pdtf-vc-verifier` | Planned |
| `@pdtf/did-resolver` | `property-data-standards-co/pdtf-did-resolver` | Planned |
| `@pdtf/key-manager` | `property-data-standards-co/pdtf-key-manager` | Planned |

### 14.3 KMS Configuration Checklist

```
□ Create GCP projects: pdtf-adapters-prod, pdtf-platform-prod, pdtf-users-prod
□ Enable Cloud KMS API in all projects
□ Create key rings per §4.2
□ Create Ed25519 keys with appropriate protection levels
□ Configure IAM bindings per §4.5
□ Set destruction grace period to 30 days
□ Configure audit log export to BigQuery
□ Set up alerting per §12.2
□ Export public keys and generate DID documents
□ Publish DID documents at .well-known/did.json endpoints
□ Register adapter DIDs in TIR
```

### 14.4 Testing Strategy

**Unit tests:**
- Ed25519 key generation and `did:key` derivation
- JCS canonicalization of sample VCs
- Signature creation and verification round-trip
- Multibase encoding/decoding
- DID document construction from public key

**Integration tests (with KMS emulator):**
- Sign a VC using KMS emulator
- Verify the signed VC without KMS (public key only)
- Key rotation: sign with v1, rotate to v2, verify v1 signature still works
- `did:key` self-resolution and verification

**End-to-end tests (with real KMS, staging project):**
- Full signing flow: construct VC → canonicalize → hash → KMS sign → attach proof
- Full verification flow: resolve DID → extract key → verify signature
- Key rotation flow: create new version → update DID doc → verify old + new
- Cross-adapter isolation: adapter A's service account cannot sign with adapter B's key

### 14.5 Performance Expectations

| Operation | Expected Latency | Notes |
|-----------|-----------------|-------|
| KMS asymmetricSign (HSM) | 50–100ms | Network + HSM operation |
| KMS asymmetricSign (SW) | 20–50ms | Network + software sign |
| KMS getPublicKey | 20–50ms | Cached after first call |
| JCS canonicalization | <1ms | In-memory, deterministic |
| SHA-256 hash | <1ms | In-memory |
| Ed25519 verify (local) | <1ms | No KMS needed |
| did:key resolution | <1ms | Computed from identifier |
| did:web resolution | 50–200ms | HTTP GET + cache |

**Batch signing:** When issuing multiple credentials (e.g., bulk adapter refresh), signing operations should be parallelised. KMS supports concurrent requests — the limit is the project's signing quota (default: 1,500 requests/min, can be increased).

### 14.6 Cost Estimates

| Item | Count | Monthly Cost |
|------|-------|-------------|
| HSM adapter keys | 5 | ~$12.50 |
| HSM platform key | 1 | ~$2.50 |
| SW user keys | 1,000 | ~$60 |
| Signing operations (10K/month) | 10,000 | ~$3 |
| **Total** | | **~$78/month** |

At scale (10,000 users): ~$600/month for user keys + operations. Still modest compared to the infrastructure it protects.

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Cloud KMS** | Google Cloud Key Management Service — managed key storage and signing |
| **Cryptosuite** | A defined combination of canonicalization, hash, and signature algorithms |
| **DataIntegrityProof** | W3C proof type for Data Integrity signed credentials |
| **DID** | Decentralised Identifier — a URI that resolves to a DID document |
| **did:key** | DID method where the public key is encoded in the identifier itself |
| **did:web** | DID method where the DID document is hosted at a well-known HTTPS URL |
| **Ed25519** | Edwards-curve Digital Signature Algorithm over Curve25519 |
| **HSM** | Hardware Security Module — tamper-resistant hardware for key storage |
| **JCS** | JSON Canonicalization Scheme (RFC 8785) — deterministic JSON serialization |
| **KMS** | Key Management Service (see Cloud KMS) |
| **Multibase** | Self-describing base encoding (prefix identifies the encoding) |
| **Multicodec** | Self-describing codec identifier (prefix identifies the key type) |
| **TIR** | Trusted Issuer Registry — maps issuer DIDs to entity:path trust permissions |

## Appendix B: Related Specifications

| Specification | URL |
|--------------|-----|
| W3C Verifiable Credentials Data Model v2.0 | https://www.w3.org/TR/vc-data-model-2.0/ |
| W3C Data Integrity EdDSA Cryptosuites | https://www.w3.org/TR/vc-di-eddsa/ |
| W3C Decentralised Identifiers (DIDs) v1.0 | https://www.w3.org/TR/did-core/ |
| did:key Method Specification | https://w3c-ccg.github.io/did-method-key/ |
| did:web Method Specification | https://w3c-ccg.github.io/did-method-web/ |
| JSON Canonicalization Scheme (RFC 8785) | https://www.rfc-editor.org/rfc/rfc8785 |
| Bitstring Status List v1.0 | https://www.w3.org/TR/vc-bitstring-status-list/ |
| Multibase Data Format | https://www.w3.org/TR/multibase/ |
| Multicodec Table | https://github.com/multiformats/multicodec |
| Google Cloud KMS Documentation | https://cloud.google.com/kms/docs |
| UK Digital Identity Trust Framework | https://www.gov.uk/government/publications/uk-digital-identity-and-attributes-trust-framework |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | Status list signing aligned to issuer key — separate `status-list-signing-key` removed. §3.4 rewritten, §3.5 summary table updated, §4.2 project structure simplified, §4.5 IAM consolidated, §7.4 rotation schedule updated. Q5 resolved. Encryption keys (X25519) deferred to Sub-spec 12 (Phase 2+). Cost estimate reduced ~$78/month. |
| v0.1 | 24 March 2026 | Initial draft. Ed25519 + eddsa-jcs-2022, 4 key categories, GCP KMS architecture (3 projects), signing flow, did:key derivation, key rotation, wallet binding phases (4-phase), compromise response, cost model. |

---

*This document is part of the PDTF 2.0 specification suite. For the complete list of sub-specs, see [00 — Architecture Overview](./00-architecture-overview.md).*
