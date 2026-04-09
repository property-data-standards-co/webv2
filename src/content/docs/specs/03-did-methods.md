---
title: "PDTF 2.0 — Sub-spec 03: DID Methods & Identifiers"
description: "PDTF 2.0 specification document."
---


**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](../00-architecture-overview/)

---

## 1. Purpose

This sub-specification defines the decentralised identifier (DID) system and URN naming scheme used throughout PDTF 2.0. It replaces the opaque platform-specific identifiers (Firebase Auth UIDs, Firestore document IDs) of PDTF v1 with cryptographically verifiable, standards-based identifiers that enable:

- **Portable identity** — a person's DID works across any PDTF-compliant platform, not just the one that created their account.
- **Verifiable provenance** — every Verifiable Credential links back to an issuer DID whose keys can be independently resolved and verified.
- **Machine-readable discovery** — a transaction's DID document tells any agent where to find the PDTF API and MCP endpoint, without out-of-band configuration.
- **Entity addressability** — every property, title, ownership claim, and representation mandate has a stable, globally unique identifier.

### 1.1 Scope

This spec covers:

- DID method selection and rationale (decisions **D7**, **D26**)
- URN scheme for non-DID entities (decision **D23**)
- DID document structure for each entity type
- Verification methods and key encoding
- Service endpoint types
- DID resolution procedures
- Identifier lifecycle (creation, rotation, deactivation)
- Security considerations

It does **not** cover:

- Verifiable Credential data model (see [Sub-spec 02: VC Data Model](../02-vc-data-model/))
- Trusted Issuer Registry design (see [Sub-spec 04: Trusted Issuer Registry](../04-trusted-issuer-registry/))
- Access control and credential presentation protocols (see [Sub-spec 12: Adapter Access Control](../12-adapter-access-control/))

### 1.2 Normative References

| Reference | URL |
|-----------|-----|
| W3C DID Core v1.0 | https://www.w3.org/TR/did-core/ |
| W3C did:key Method | https://w3c-ccg.github.io/did-method-key/ |
| W3C did:web Method | https://w3c-ccg.github.io/did-method-web/ |
| Multibase | https://www.w3.org/TR/controller-document/#multibase-0 |
| Multicodec | https://github.com/multiformats/multicodec |
| Ed25519 (RFC 8032) | https://www.rfc-editor.org/rfc/rfc8032 |
| URN Syntax (RFC 8141) | https://www.rfc-editor.org/rfc/rfc8141 |
| ABNF (RFC 5234) | https://www.rfc-editor.org/rfc/rfc5234 |

### 1.3 Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| **D7** | `did:key` for Persons; `did:key` or `did:web` for Organisations; `did:web` for Transactions and Trusted Adapters | Persons need zero-infrastructure identifiers derived from their signing keys. Organisations may use provider-managed `did:key` (the common case — issued by their case management platform) or self-hosted `did:web` (for firms wanting direct control). Transactions and adapters need discoverable service endpoints that `did:web` provides. |
| **D23** | `urn:pdtf:unregisteredTitle:{uuid}` for unregistered titles | Unregistered land has no HMLR title number. A PDTF-minted UUID provides a stable identifier until first registration completes. **Open:** confirm UUID version and whether the URN should survive first registration. |
| **D26** | `did:key` (provider-managed) or `did:web` (self-hosted) for Organisations | Most organisations will use provider-managed `did:key` identifiers issued by their account provider (e.g. LMS). The provider verifies the organisation's identity and regulatory status. Self-hosted `did:web` at the firm's domain is available for firms wanting direct control. |

---

## 2. DID Methods Used

### 2.1 did:key — Persons

**Specification:** [W3C did:key Method](https://w3c-ccg.github.io/did-method-key/)

`did:key` encodes a public key directly into the DID string. The DID document is *implicit* — it can be deterministically derived from the DID itself without any network request. This makes `did:key` ideal for individual persons who need:

- No infrastructure to maintain
- Instant key-pair generation (client-side, offline)
- Self-certifying identifiers — the DID *is* the public key

#### 2.1.1 Key Type

PDTF 2.0 uses **Ed25519** keys exclusively (RFC 8032). Ed25519 provides:

- 128-bit security level
- Fast signing and verification
- Small key and signature sizes (32-byte keys, 64-byte signatures)
- Deterministic signatures (no random nonce required)
- Wide library support across all platforms

#### 2.1.2 DID Derivation

The `did:key` identifier is derived from an Ed25519 public key through the following steps:

```
1. Generate an Ed25519 key pair → public key (32 bytes)
2. Prepend the multicodec prefix for Ed25519 public key: 0xed01 (2 bytes)
3. Encode the result with multibase using base58-btc (prefix 'z')
4. Prepend "did:key:" to form the DID
```

**Worked example:**

```
Raw Ed25519 public key (32 bytes, hex):
  d7 5a 98 18 2b 10 ab 7d 54 bf eb 3c 11 63 04 3c
  2b 7d 1a 31 03 66 c8 b4 05 e7 a8 43 4b 3a e1 41

With multicodec prefix (0xed 0x01):
  ed 01 d7 5a 98 18 2b 10 ab 7d 54 bf eb 3c 11 63
  04 3c 2b 7d 1a 31 03 66 c8 b4 05 e7 a8 43 4b 3a
  e1 41

Base58-btc encoded (with 'z' prefix):
  z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK

Final DID:
  did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

> **Note:** All `did:key` identifiers for Ed25519 keys begin with `z6Mk`. This prefix is deterministic: `z` is the multibase base58-btc prefix, and `6Mk` is the base58-btc encoding of the `0xed01` multicodec header. If a DID starts with `did:key:z6Mk`, you know it's an Ed25519 key.

#### 2.1.3 When to Use

| Use case | DID method |
|----------|-----------|
| Individual person (seller, buyer) | `did:key` ✓ |
| VC issuer who is a natural person | `did:key` ✓ |
| Organisation managed by an account provider | `did:key` ✓ (the common case) |
| Any entity needing service endpoints | `did:web` (not `did:key`) |

### 2.2 did:web — Organisations, Transactions, and Trusted Adapters

**Specification:** [W3C did:web Method](https://w3c-ccg.github.io/did-method-web/)

`did:web` uses existing web infrastructure (DNS + HTTPS) to host DID documents. The DID encodes a URL path where the DID document can be fetched as a JSON file. This provides:

- **Discoverability** — service endpoints (APIs, MCP servers) are embedded in the DID document
- **Domain verification** — hosting the DID document at a domain proves control of that domain
- **Key rotation** — keys can be updated by republishing the DID document
- **Rich metadata** — DID documents can include regulatory identifiers, service descriptions, and linked resources

#### 2.2.1 URL Resolution Rules

The `did:web` method maps DID identifiers to HTTPS URLs using these rules:

```
did:web:{domain}
  → https://{domain}/.well-known/did.json

did:web:{domain}:{path1}:{path2}
  → https://{domain}/{path1}/{path2}/did.json

Percent-encoded characters:
  did:web:{domain}%3A{port}:{path}
  → https://{domain}:{port}/{path}/did.json
```

**PDTF examples:**

| DID | Resolves to |
|-----|-------------|
| `did:web:smithandjones.co.uk` | `https://smithandjones.co.uk/.well-known/did.json` |
| `did:web:moverly.com:transactions:abc123` | `https://moverly.com/transactions/abc123/did.json` |
| `did:web:adapters.propdata.org.uk:hmlr` | `https://adapters.propdata.org.uk/hmlr/did.json` |
| `did:web:adapters.propdata.org.uk:epc` | `https://adapters.propdata.org.uk/epc/did.json` |

#### 2.2.2 Entity Mapping

| Entity type | DID pattern | Example | Hosted by |
|-------------|-------------|---------|-----------|
| Organisation (provider-managed) | `did:key:z6Mk{base58}` | `did:key:z6MkpJmq...` | Implicit (no hosting — key managed by account provider) |
| Organisation (self-hosted) | `did:web:{firm-domain}` | `did:web:smithandjones.co.uk` | The firm itself |
| Transaction | `did:web:{platform}:transactions:{id}` | `did:web:moverly.com:transactions:abc123` | The platform hosting the transaction |
| Trusted Adapter | `did:web:{adapter-host}:{adapter-name}` | `did:web:adapters.propdata.org.uk:hmlr` | The adapter operator |

#### 2.2.3 Domain Verification

Hosting a DID document at a domain constitutes proof of domain control. This has implications:

- **Organisations (did:web):** A conveyancer firm at `did:web:smithandjones.co.uk` has proven they control the `smithandjones.co.uk` domain. Combined with TIR registration (which cross-references SRA number and Companies House number), this provides a strong identity binding.
- **Organisations (did:key):** A provider-managed Organisation's identity is verified by the account provider. Verifiers confirm the `did:key` is listed in the provider's `managedOrganisations` registry (referenced from the TIR `accountProvider` entry).
- **Transactions:** A transaction DID like `did:web:moverly.com:transactions:abc123` is inherently scoped to the platform hosting it. The platform's TIR registration establishes its authority to host transactions.
- **Adapters:** An adapter at `did:web:adapters.propdata.org.uk:hmlr` is controlled by whoever operates the `adapters.propdata.org.uk` domain. TIR registration binds this to an authorised adapter operator.

> **Security note:** `did:web` security depends entirely on DNS and TLS. See [Section 9: Security Considerations](#9-security-considerations) for threat analysis and mitigations.

---

## 3. URN Scheme

Entities that are not actors (they don't sign credentials or authenticate) use URN identifiers in the `urn:pdtf` namespace. These entities are *subjects* of credentials, not issuers.

### 3.1 Namespace Registration

```
NID: pdtf
Registration: Informal (property-data-standards-co governance)
Registrant: Property Data Standards Company
```

### 3.2 Identifier Definitions

| URN Pattern | Entity | Source of Identifier |
|-------------|--------|---------------------|
| `urn:pdtf:uprn:{uprn}` | Property | Ordnance Survey UPRN (Unique Property Reference Number) |
| `urn:pdtf:titleNumber:{number}` | Title (registered) | HMLR title number |
| `urn:pdtf:unregisteredTitle:{uuid}` | Title (unregistered) | Platform-generated UUID v4 (D23) |
| `urn:pdtf:ownership:{uuid}` | Ownership claim | Platform-generated UUID v4 |
| `urn:pdtf:representation:{uuid}` | Representation mandate | Platform-generated UUID v4 |
| `urn:pdtf:consent:{uuid}` | Delegated consent | Platform-generated UUID v4 |
| `urn:pdtf:offer:{uuid}` | Offer | Platform-generated UUID v4 |

### 3.3 ABNF Grammar

The following ABNF grammar (per RFC 5234) defines the syntax for each URN type:

```abnf
; Top-level PDTF URN
pdtf-urn          = "urn:pdtf:" pdtf-nss

pdtf-nss          = property-urn
                  / title-urn
                  / unregistered-title-urn
                  / ownership-urn
                  / representation-urn
                  / consent-urn
                  / offer-urn

; Property — UPRN is a numeric identifier (up to 12 digits)
property-urn      = "uprn:" uprn
uprn              = 1*12DIGIT

; Title — HMLR title number format (e.g., "DN123456", "AGL12345", "WA123456")
title-urn         = "titleNumber:" title-number
title-number      = district-prefix 1*8DIGIT
district-prefix   = 1*4ALPHA

; Unregistered Title — UUID v4 (D23)
unregistered-title-urn = "unregisteredTitle:" uuid-v4

; Ownership — UUID v4
ownership-urn     = "ownership:" uuid-v4

; Representation — UUID v4
representation-urn = "representation:" uuid-v4

; Consent — UUID v4
consent-urn       = "consent:" uuid-v4

; Offer — UUID v4
offer-urn         = "offer:" uuid-v4

; UUID v4 (RFC 4122 format)
uuid-v4           = 8hexdig "-" 4hexdig "-" "4" 3hexdig "-"
                    variant-char 3hexdig "-" 12hexdig
variant-char      = "8" / "9" / "a" / "b"
                  / "A" / "B"
hexdig            = DIGIT / "a" / "b" / "c" / "d" / "e" / "f"
                  / "A" / "B" / "C" / "D" / "E" / "F"

; Imported from RFC 5234
DIGIT             = %x30-39          ; 0-9
ALPHA             = %x41-5A / %x61-7A ; A-Z / a-z
```

### 3.4 Examples

```
urn:pdtf:uprn:100023456789
urn:pdtf:titleNumber:DN123456
urn:pdtf:titleNumber:AGL12345
urn:pdtf:unregisteredTitle:f47ac10b-58cc-4372-a567-0e02b2c3d479
urn:pdtf:ownership:7c9e6679-7425-40de-944b-e07fc1f90ae7
urn:pdtf:representation:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
urn:pdtf:consent:b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e
urn:pdtf:offer:c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f
```

### 3.5 URN vs DID: When to Use Which

The boundary is clear: **actors get DIDs, subjects get URNs**.

| Has signing keys? | Has service endpoints? | Identifier type |
|-------------------|----------------------|-----------------|
| Yes | No | `did:key` |
| Yes | Yes | `did:web` |
| No | No | `urn:pdtf:*` |

- **Persons** sign credentials → `did:key`
- **Organisations** sign credentials → `did:key` (provider-managed, common case) or `did:web` (self-hosted, with service endpoints)
- **Transactions** host endpoints (PDTF API, MCP) → `did:web`
- **Properties** are credential subjects, never issuers → `urn:pdtf:uprn:*`
- **Titles** are credential subjects → `urn:pdtf:titleNumber:*`
- **Ownership, Representation, Consent, Offer** are credential subjects → `urn:pdtf:{type}:{uuid}`

---

## 4. DID Document Structure

### 4.1 Person DID Document (did:key)

`did:key` DID documents are *implicit* — they are deterministically derived from the DID string itself. No hosting is required. The resolved form is shown below for reference.

For `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "verificationMethod": [
    {
      "id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
    }
  ],
  "authentication": [
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  ],
  "assertionMethod": [
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  ],
  "capabilityDelegation": [
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  ],
  "capabilityInvocation": [
    "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
  ]
}
```

> **Note:** The `verificationMethod.id` fragment is the full multibase-encoded public key. This is the canonical form per the did:key specification. The same key serves all verification relationships (authentication, assertion, delegation, invocation) because a Person's DID has exactly one key.

### 4.2 Organisation DID Documents

Organisations may use either `did:key` (provider-managed) or `did:web` (self-hosted). When managed by an account provider, an Organisation receives a `did:key` identifier generated by the provider. The provider verifies the organisation's identity (SRA number, Companies House registration, etc.) before issuing the DID. The provider's TIR `accountProvider` entry includes the organisation's DID in its `managedOrganisations` registry, enabling verifiers to trace the `did:key` back to a trusted source. This is expected to be the dominant model — most conveyancer firms and estate agencies will not self-host `did:web` infrastructure.

#### 4.2.1 Organisation DID Document — Provider-Managed (did:key)

For a conveyancer firm `Smith & Jones LLP` managed by LMS, the Organisation receives a `did:key` identifier. Like Person `did:key` documents, the DID document is implicit — deterministically derived from the key with no hosting required:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm",
  "verificationMethod": [
    {
      "id": "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm#z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm",
      "publicKeyMultibase": "z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm"
    }
  ],
  "authentication": [
    "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm#z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm"
  ],
  "assertionMethod": [
    "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm#z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm"
  ]
}
```

**Key points:**

- No service endpoints — the Organisation's regulatory registrations and contact details live in the entity graph (Organisation entity), not in the DID document.
- The account provider (e.g. LMS) manages the key material on behalf of the Organisation.
- Verifiers trace this `did:key` back to a trusted provider via the TIR `accountProvider` entry's `managedOrganisations` registry.
- The Organisation's identity (SRA number, Companies House registration) is verified by the account provider before the DID is issued.

#### 4.2.2 Organisation DID Document — Self-Hosted (did:web)

For firms that want direct control of their identity, hosted at the firm's domain. For a conveyancer firm `Smith & Jones LLP` at `did:web:smithandjones.co.uk`, the DID document is served from `https://smithandjones.co.uk/.well-known/did.json`:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:web:smithandjones.co.uk",
  "verificationMethod": [
    {
      "id": "did:web:smithandjones.co.uk#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:smithandjones.co.uk",
      "publicKeyMultibase": "z6Mkr7JAFsC4K5Zmq3RqtEZjTNz9e3o8yBPyqGMpKVqZv2R"
    }
  ],
  "authentication": [
    "did:web:smithandjones.co.uk#key-1"
  ],
  "assertionMethod": [
    "did:web:smithandjones.co.uk#key-1"
  ],
  "service": [
    {
      "id": "did:web:smithandjones.co.uk#sra",
      "type": "RegulatoryRegistration",
      "serviceEndpoint": "https://www.sra.org.uk/solicitors/firm/612345",
      "name": "SRA Registration",
      "registrationNumber": "612345"
    },
    {
      "id": "did:web:smithandjones.co.uk#companies-house",
      "type": "CompanyRegistration",
      "serviceEndpoint": "https://find-and-update.company-information.service.gov.uk/company/OC123456",
      "name": "Companies House",
      "companyNumber": "OC123456"
    },
    {
      "id": "did:web:smithandjones.co.uk#pdtf-contact",
      "type": "PdtfOrganisationEndpoint",
      "serviceEndpoint": "https://portal.smithandjones.co.uk/pdtf",
      "description": "PDTF credential exchange endpoint"
    }
  ]
}
```

**Key points:**

- The `#sra` and `#companies-house` service endpoints provide machine-readable links to regulatory registrations. The TIR cross-references these when verifying the Organisation's identity.
- `assertionMethod` is included because Organisations may issue credentials (e.g., a conveyancer firm issuing a Representation credential confirmation).
- The firm controls key rotation by updating the DID document at their domain.

### 4.3 Transaction DID Document (did:web)

Hosted by the platform at the transaction's path. For `did:web:moverly.com:transactions:abc123`, served from `https://moverly.com/transactions/abc123/did.json`:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:web:moverly.com:transactions:abc123",
  "controller": "did:web:moverly.com",
  "verificationMethod": [
    {
      "id": "did:web:moverly.com:transactions:abc123#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:moverly.com:transactions:abc123",
      "publicKeyMultibase": "z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp7eTbCt2DADLY"
    }
  ],
  "authentication": [
    "did:web:moverly.com:transactions:abc123#key-1"
  ],
  "assertionMethod": [
    "did:web:moverly.com:transactions:abc123#key-1"
  ],
  "service": [
    {
      "id": "did:web:moverly.com:transactions:abc123#pdtf-api",
      "type": "PdtfTransactionEndpoint",
      "serviceEndpoint": "https://api.moverly.com/v2/transactions/abc123",
      "description": "PDTF v2 transaction API — credential submission, state retrieval, entity queries"
    },
    {
      "id": "did:web:moverly.com:transactions:abc123#mcp",
      "type": "McpEndpoint",
      "serviceEndpoint": "https://api.moverly.com/mcp/transactions/abc123",
      "description": "Model Context Protocol endpoint for AI agent access"
    }
  ],
  "alsoKnownAs": [
    "urn:pdtf:uprn:100023456789"
  ]
}
```

**Key points:**

- The `controller` field indicates `did:web:moverly.com` controls this transaction DID. This establishes the platform's authority over the transaction.
- `#pdtf-api` is the primary API endpoint for credential exchange and state retrieval.
- `#mcp` provides the MCP (Model Context Protocol) endpoint for AI agent interaction.
- `alsoKnownAs` links to the property UPRN for cross-referencing. Multiple URNs may be listed when a transaction involves multiple properties.

### 4.4 Trusted Adapter DID Document (did:web)

For the HMLR Official Copies adapter at `did:web:adapters.propdata.org.uk:hmlr`, served from `https://adapters.propdata.org.uk/hmlr/did.json`:

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "https://w3id.org/security/multikey/v1"
  ],
  "id": "did:web:adapters.propdata.org.uk:hmlr",
  "controller": "did:web:adapters.propdata.org.uk",
  "verificationMethod": [
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:adapters.propdata.org.uk:hmlr",
      "publicKeyMultibase": "z6MkpTHR8VNs5xhqAKbSQgpzGRwXaN7cPsMjczbEPceFRFw8"
    },
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#key-2",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:adapters.propdata.org.uk:hmlr",
      "publicKeyMultibase": "z6MkvZm1eJ9hRYdPB4q7SBLW9XprJPVt2Bv4c4f6kJfQxrKn"
    }
  ],
  "authentication": [
    "did:web:adapters.propdata.org.uk:hmlr#key-1"
  ],
  "assertionMethod": [
    "did:web:adapters.propdata.org.uk:hmlr#key-1",
    "did:web:adapters.propdata.org.uk:hmlr#key-2"
  ],
  "service": [
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#vc-issuance",
      "type": "VcIssuanceEndpoint",
      "serviceEndpoint": "https://adapters.propdata.org.uk/hmlr/credentials/issue",
      "description": "Request HMLR Official Copies as Verifiable Credentials",
      "credentialTypes": [
        "TitleCredential",
        "OwnershipCredential"
      ]
    },
    {
      "id": "did:web:adapters.propdata.org.uk:hmlr#status",
      "type": "BitstringStatusListEndpoint",
      "serviceEndpoint": "https://adapters.propdata.org.uk/hmlr/status",
      "description": "Credential revocation status lists"
    }
  ]
}
```

**Key points:**

- Multiple keys in `assertionMethod` — adapters may use key rotation with overlapping validity periods. `key-2` might be the next rotation key, already listed in `assertionMethod` but not yet primary.
- The `#vc-issuance` service endpoint tells consumers where to request VCs and what credential types the adapter issues.
- The `#status` endpoint links to the Bitstring Status List for revocation checking.
- `credentialTypes` in the service endpoint metadata lists the VC types this adapter can issue, enabling automated discovery.

---

## 5. Verification Methods

### 5.1 Key Type: Ed25519VerificationKey2020

All PDTF 2.0 verification methods use the `Ed25519VerificationKey2020` type with `publicKeyMultibase` encoding. This is the canonical representation for Ed25519 keys in the W3C DID ecosystem.

```json
{
  "id": "did:example:123#key-1",
  "type": "Ed25519VerificationKey2020",
  "controller": "did:example:123",
  "publicKeyMultibase": "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
}
```

#### 5.1.1 publicKeyMultibase Encoding

The `publicKeyMultibase` value encodes the raw Ed25519 public key using:

1. **Multicodec prefix:** `0xed01` (Ed25519 public key)
2. **Multibase encoding:** base58-btc (prefix `z`)

```
publicKeyMultibase = "z" + base58btc(0xed01 || raw_public_key_32_bytes)
```

All `publicKeyMultibase` values for Ed25519 keys will begin with `z6Mk`.

### 5.2 Key Purposes

DID documents assign keys to specific verification relationships, which determine what the key may be used for:

| Relationship | Purpose in PDTF | Required for |
|-------------|-----------------|--------------|
| `authentication` | Prove control of the DID (DID Auth challenge-response) | Access control — presenting credentials to access restricted data |
| `assertionMethod` | Sign Verifiable Credentials | VC issuance — any entity that issues credentials must have a key listed here |
| `capabilityDelegation` | Delegate authority to another DID | Person DIDs only — used when issuing Representation or DelegatedConsent credentials |
| `capabilityInvocation` | Invoke capabilities | Person DIDs only — included for completeness in did:key resolution |

#### 5.2.1 Key Purpose by Entity Type

| Entity type | `authentication` | `assertionMethod` | `capabilityDelegation` | `capabilityInvocation` |
|-------------|------------------|--------------------|------------------------|------------------------|
| Person (`did:key`) | ✓ | ✓ | ✓ | ✓ |
| Organisation (`did:key`) | ✓ | ✓ | ✓ | ✓ |
| Organisation (`did:web`) | ✓ | ✓ | — | — |
| Transaction (`did:web`) | ✓ | ✓ | — | — |
| Trusted Adapter (`did:web`) | ✓ | ✓ | — | — |

> **Note:** For `did:key`, all four relationships are automatically assigned to the single key. This is an inherent property of the did:key method — there's only one key, and it serves all purposes.

### 5.3 Proof Cryptosuite

Verifiable Credentials in PDTF 2.0 use the `eddsa-jcs-2022` cryptosuite for Data Integrity Proofs:

```json
{
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK#z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    "created": "2026-03-24T10:00:00Z",
    "proofPurpose": "assertionMethod",
    "proofValue": "z3FXQje2VihZqE3WPgtvJh4Kv8VDsK6dN4RGLMA2PdoYbzLFST..."
  }
}
```

**Why `eddsa-jcs-2022`:**

- Uses JSON Canonicalization Scheme (JCS, RFC 8785) for deterministic serialisation
- Ed25519 signatures — consistent with our key type
- No dependency on JSON-LD processing (unlike `eddsa-rdfc-2022`)
- Wide implementation support in VC libraries

The `verificationMethod` in the proof MUST reference a key listed in the issuer's DID document under `assertionMethod`.

---

## 6. Service Endpoints

Service endpoints in DID documents enable machine-readable discovery of APIs and capabilities. PDTF 2.0 defines three custom service endpoint types.

### 6.1 PdtfTransactionEndpoint

The primary API for interacting with a PDTF transaction.

```json
{
  "id": "did:web:moverly.com:transactions:abc123#pdtf-api",
  "type": "PdtfTransactionEndpoint",
  "serviceEndpoint": "https://api.moverly.com/v2/transactions/abc123",
  "description": "PDTF v2 transaction API"
}
```

**Capabilities exposed:**

| Operation | Method | Path (relative to serviceEndpoint) |
|-----------|--------|-----|
| Get composed state (v3 compat) | `GET` | `/state/v3` |
| Get composed state (v4 native) | `GET` | `/state/v4` |
| Submit credential | `POST` | `/credentials` |
| List credentials | `GET` | `/credentials` |
| Get entity | `GET` | `/entities/{entityType}/{id}` |
| Verify credential | `POST` | `/credentials/verify` |

**Authentication:** Credential presentation (Ownership, Representation, or DelegatedConsent VC) with DID Auth challenge-response. Public endpoints (state/v3, state/v4 for public-only data) may be unauthenticated.

### 6.2 McpEndpoint

The Model Context Protocol endpoint for AI agent interaction.

```json
{
  "id": "did:web:moverly.com:transactions:abc123#mcp",
  "type": "McpEndpoint",
  "serviceEndpoint": "https://api.moverly.com/mcp/transactions/abc123",
  "description": "Model Context Protocol endpoint for AI agent access"
}
```

**Capabilities:** Provides the same transaction data as the PDTF API but through the MCP protocol, enabling AI agents (property assistants, automated diligence tools, conveyancing copilots) to interact with transaction data using natural language tools.

**Authentication:** Same credential presentation model as `PdtfTransactionEndpoint`. The MCP server verifies presented credentials before exposing tools.

### 6.3 VcIssuanceEndpoint

Used by Trusted Adapters to advertise their credential issuance capability.

```json
{
  "id": "did:web:adapters.propdata.org.uk:hmlr#vc-issuance",
  "type": "VcIssuanceEndpoint",
  "serviceEndpoint": "https://adapters.propdata.org.uk/hmlr/credentials/issue",
  "description": "Request HMLR Official Copies as Verifiable Credentials",
  "credentialTypes": ["TitleCredential", "OwnershipCredential"]
}
```

**Request flow:**

1. Consumer discovers adapter DID via TIR lookup
2. Resolves adapter DID document → finds `VcIssuanceEndpoint`
3. Sends issuance request to `serviceEndpoint`:

```json
{
  "type": "TitleCredential",
  "subject": "urn:pdtf:titleNumber:DN123456",
  "requester": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "authPresentation": "eyJ..."
}
```

4. Adapter fetches data from primary source (e.g., HMLR API)
5. Adapter signs and returns VC

**`credentialTypes`** — array of VC type strings this adapter can issue. Enables automated discovery: a platform can enumerate all adapters in the TIR and determine which one to call for a given credential type.

### 6.4 Additional Service Endpoint Types

| Type | Used by | Purpose |
|------|---------|---------|
| `RegulatoryRegistration` | Organisations | Link to SRA, CLC, or other regulatory body registration |
| `CompanyRegistration` | Organisations | Link to Companies House record |
| `BitstringStatusListEndpoint` | Adapters | Credential revocation status list hosting |
| `PdtfOrganisationEndpoint` | Organisations | PDTF credential exchange endpoint for the firm |

---

## 7. DID Resolution

### 7.1 did:key Resolution

`did:key` is **self-resolving**. The DID document is deterministically derived from the DID string — no network request is needed.

**Resolution algorithm:**

```
Input:  did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
Output: DID Document (see Section 4.1)

1. Strip the "did:key:" prefix → multibase-encoded value
2. Decode base58-btc (strip 'z' prefix) → multicodec-prefixed key bytes
3. Verify multicodec prefix is 0xed01 (Ed25519)
4. Extract 32-byte raw public key
5. Construct DID document with the key in all verification relationships
```

**Properties:**

- Zero latency — no HTTP request
- Always available — no server dependency
- Deterministic — same DID always produces the same document
- Immutable — the document cannot change (key rotation = new DID)

### 7.2 did:web Resolution

`did:web` requires an HTTPS fetch to retrieve the DID document.

**Resolution algorithm:**

```
Input:  did:web:moverly.com:transactions:abc123
Output: DID Document (fetched from HTTPS)

1. Parse the DID:
   - Method: "web"
   - Domain: "moverly.com"
   - Path segments: ["transactions", "abc123"]

2. Construct the URL:
   - If path segments exist:
     https://{domain}/{path1}/{path2}/.../did.json
     → https://moverly.com/transactions/abc123/did.json
   - If no path segments:
     https://{domain}/.well-known/did.json

3. Percent-decode any encoded characters in the domain
   (e.g., %3A for port numbers)

4. Fetch the URL via HTTPS (TLS required — HTTP MUST be rejected)

5. Parse the response as JSON

6. Validate:
   a. Response Content-Type is application/json or application/did+json
   b. The "id" field matches the input DID
   c. The document is valid per DID Core specification
   d. All verificationMethod entries have valid key encodings

7. Return the DID Document
```

### 7.3 Caching Strategy

DID documents (especially for Organisations and Adapters) should be cached to avoid repeated HTTP requests during credential verification chains.

| Entity type | Cache TTL | Rationale |
|-------------|-----------|-----------|
| Person (`did:key`) | ∞ (no cache needed) | Deterministic — always the same |
| Organisation (`did:key`) | ∞ (no cache needed) | Deterministic — always the same |
| Organisation (`did:web`) | 24 hours | Keys rotate infrequently; regulatory metadata is stable |
| Transaction (`did:web`) | 1 hour | Service endpoints may update; shorter TTL acceptable |
| Trusted Adapter (`did:web`) | 24 hours | Keys rotate on a scheduled basis; longer TTL is safe |

**Cache invalidation:**

- On verification failure (signature doesn't match any listed key), the resolver MUST re-fetch the DID document bypassing cache and retry verification once.
- Implementations SHOULD respect HTTP `Cache-Control` headers from the DID document server as a minimum TTL.

### 7.4 Error Handling

| Error | Condition | Behaviour |
|-------|-----------|-----------|
| `notFound` | HTTP 404 from DID document URL | DID cannot be resolved. Verification MUST fail. |
| `invalidDidDocument` | JSON parse failure or DID Core validation failure | Treat as unresolvable. Log the error for diagnostics. |
| `idMismatch` | `"id"` in the document doesn't match the queried DID | Reject — possible misconfiguration or attack. |
| `httpError` | HTTP 5xx, timeout, or connection failure | Retry with exponential backoff (max 3 attempts). If all fail, resolution fails. Use cached document if available and not expired. |
| `tlsError` | Certificate validation failure | Resolution MUST fail. Do not fall back to HTTP. |
| `deactivated` | DID document contains `"deactivated": true` | DID is deactivated. Return the document but flag it as deactivated. Verifiers MUST reject credentials from deactivated DIDs. |

### 7.5 DNSSEC Considerations

`did:web` security ultimately depends on DNS integrity. PDTF 2.0 **recommends** but does not **require** DNSSEC for `did:web` hosts, because:

- Many UK domains (.co.uk) do not yet support DNSSEC
- The TIR cross-check (binding DID to regulatory registration) provides a secondary trust anchor
- Requiring DNSSEC would be a barrier to adoption

However, Trusted Adapter hosts (e.g., `adapters.propdata.org.uk`) **SHOULD** deploy DNSSEC, as they are high-value targets in the trust infrastructure.

---

## 8. Identifier Lifecycle

### 8.1 Creation

| Entity type | Creation process |
|-------------|------------------|
| Person (`did:key`) | Generate Ed25519 key pair (client-side). Derive DID from public key. No registration needed. |
| Organisation (`did:key`) | Account provider generates Ed25519 key pair on behalf of the Organisation. Provider verifies the org's identity (SRA number, Companies House, etc.) and adds the DID to its `managedOrganisations` registry. No self-hosting required. |
| Organisation (`did:web`) | Generate Ed25519 key pair. Create DID document with regulatory metadata. Host at firm's domain. Register in TIR. |
| Transaction (`did:web`) | Platform generates transaction ID. Creates DID document with service endpoints. Hosts at platform domain. |
| Trusted Adapter (`did:web`) | Adapter operator generates key pair. Creates DID document with issuance endpoint. Registers in TIR with credential type authorisations. |
| Property (`urn:pdtf:uprn:*`) | Derived from UPRN. No creation step — the identifier exists as long as the UPRN exists. |
| Title (`urn:pdtf:titleNumber:*`) | Derived from HMLR title number. No creation step. |
| Unregistered Title (`urn:pdtf:unregisteredTitle:*`) | Platform generates UUID v4 when a transaction involves unregistered land. |

### 8.2 Key Rotation

Key rotation differs fundamentally between `did:key` and `did:web`:

#### 8.2.1 did:key Rotation

**`did:key` cannot rotate keys.** The key *is* the identifier. Changing the key changes the DID.

When a Person needs a new key (compromise, device loss, routine rotation):

1. Generate new Ed25519 key pair → new `did:key`
2. Issue a **DID succession credential** from the old DID (if old key is still available):

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "DidSuccession"],
  "issuer": "did:key:z6MkOLD...",
  "credentialSubject": {
    "id": "did:key:z6MkNEW...",
    "succeeds": "did:key:z6MkOLD...",
    "reason": "routineRotation"
  },
  "proof": { "..." : "signed by old key" }
}
```

3. Update all credentials that reference the old DID:
   - Re-issue Ownership credentials with new DID
   - Re-issue Representation credentials with new DID
   - Previous credentials remain valid (signed by old key) but point to a now-superseded DID

4. If old key is compromised and unavailable, the Person must re-establish their identity through out-of-band verification (e.g., re-verification by the platform, re-issuance of Ownership credentials).

#### 8.2.2 did:web Rotation

**`did:web` supports in-place key rotation.** Update the DID document to add the new key and (eventually) remove the old one.

**Recommended rotation procedure:**

```
Phase 1 — Add new key (overlap period):
  verificationMethod: [key-1 (old), key-2 (new)]
  assertionMethod: [key-1, key-2]
  
  Duration: at least 2× the cache TTL for this entity type

Phase 2 — Switch primary:
  Sign new credentials with key-2
  Stop signing with key-1
  Keep key-1 in verificationMethod for verification of old credentials

Phase 3 — Remove old key (after all old credentials expire or are re-issued):
  verificationMethod: [key-2]
  assertionMethod: [key-2]
```

> **Important:** During the overlap period, verifiers may have either the old or new DID document cached. Both keys must be valid for verification during this window.

### 8.3 Deactivation

#### 8.3.1 Transaction Deactivation

When a transaction completes (or is withdrawn), the platform should:

1. Update the DID document to include `"deactivated": true`
2. Remove service endpoints (API and MCP are no longer active)
3. Retain verification methods for historical credential verification
4. Maintain the DID document at its URL for at least 7 years (legal retention)

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:moverly.com:transactions:abc123",
  "deactivated": true,
  "verificationMethod": [
    {
      "id": "did:web:moverly.com:transactions:abc123#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:moverly.com:transactions:abc123",
      "publicKeyMultibase": "z6MknGc3ocHs3zdPiJbnaaqDi58NGb4pk1Sp7eTbCt2DADLY"
    }
  ],
  "assertionMethod": [
    "did:web:moverly.com:transactions:abc123#key-1"
  ]
}
```

#### 8.3.2 Organisation Deactivation

If a firm ceases to operate (SRA de-registration, company dissolution):

1. Remove DID document from domain (or mark as deactivated)
2. TIR entry is updated to `"status": "revoked"`
3. All Representation credentials issued to this Organisation should be revoked via Bitstring Status List

#### 8.3.3 Person DID Deactivation

`did:key` cannot be "deactivated" in the DID document sense (there is no hosted document). Instead:

- The private key is securely destroyed
- Any credentials issued by this DID remain verifiable (signatures are still valid) but new credentials cannot be created
- Ownership and Representation credentials referencing this DID should be revoked if the person is withdrawing from the transaction

---

## 9. Security Considerations

### 9.1 did:web Threat Model

`did:web` inherits the security properties (and weaknesses) of the web PKI:

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|-----------|------------|
| **DNS hijacking** | Attacker serves fraudulent DID document | Low (DNSSEC mitigates) | TIR cross-check: verifier confirms DID is registered in TIR with matching regulatory IDs |
| **Domain compromise** | Attacker replaces DID document with their own keys | Low–Medium | TIR cross-check + certificate transparency monitoring + key pinning in TIR |
| **TLS interception** | MITM serves modified DID document | Low (certificate pinning mitigates) | Strict TLS validation, reject HTTP, certificate transparency |
| **Domain expiry** | Firm lets domain lapse; new owner can serve fraudulent DID doc | Medium (human process risk) | TIR monitors domain ownership changes; revoke TIR entry on ownership change |
| **Insider threat** | Firm's IT admin rotates keys and issues fraudulent credentials | Low | Credential verification includes TIR check of issuance authorisation |

### 9.2 did:key Threat Model

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|-----------|------------|
| **Key compromise** | Attacker can sign credentials as the person | High impact, low likelihood | Key rotation (new DID + succession credential). Hardware key storage (future). |
| **Key loss** | Person loses access to their DID permanently | Medium | Out-of-band identity re-verification. Platform re-issuance of credentials. |
| **Quantum computing** | Ed25519 vulnerable to quantum attacks | Future risk (10+ years) | Migration path to post-quantum algorithms. DID method is agnostic to key type — can switch to dilithium/kyber when multicodec prefixes are assigned. |

### 9.3 TIR Cross-Check as Defence in Depth

The Trusted Issuer Registry provides a critical second layer of trust for `did:web`:

```
Verification chain:
1. Resolve did:web → get DID document
2. Verify credential signature against key in DID document
3. Look up issuer DID in TIR:
   a. Is this DID registered?
   b. Is it authorised for this credential type + entity path?
   c. Does the TIR entry match the DID document's regulatory metadata?
   d. Is the TIR entry still active (not revoked)?
4. Only if ALL checks pass: credential is trusted
```

This means that even if an attacker compromises a domain and serves a fraudulent DID document, they cannot issue trusted credentials unless they also compromise the TIR (which is a separate, independently governed system).

### 9.4 Key Storage Recommendations

| Entity type | Key storage | Minimum requirement |
|-------------|-------------|---------------------|
| Person | Device keychain (iOS Keychain, Android Keystore) | Encrypted at rest, biometric-gated access |
| Organisation (`did:key`, provider-managed) | Provider's KMS infrastructure | Provider is responsible for key security |
| Organisation (`did:web`, self-hosted) | HSM or cloud KMS (AWS KMS, Google Cloud KMS) | FIPS 140-2 Level 2+ |
| Transaction | Platform KMS | Platform's standard key management |
| Trusted Adapter | HSM | FIPS 140-2 Level 2+ (adapters are high-value targets) |

---

## 10. Open Questions

### 10.1 D23 — Unregistered Title Identifier Design

**Status:** Open

Unregistered land (land not registered at HMLR) has no title number. PDTF needs to identify these titles for credential issuance and reference.

**Current proposal:** `urn:pdtf:unregisteredTitle:{uuid-v4}`

**Open questions:**

1. **UUID version:** Should we use UUID v4 (random) or UUID v5 (deterministic, based on a namespace + name like the property UPRN)? UUID v5 would mean the same unregistered title always gets the same identifier, but it creates a dependency on knowing the UPRN.

2. **First registration transition:** When unregistered land is first registered at HMLR, it receives a title number. Should:
   - (a) The `urn:pdtf:unregisteredTitle:{uuid}` be retired and replaced with `urn:pdtf:titleNumber:{number}`, with a succession credential linking them?
   - (b) The unregistered title URN remain as an alias (`alsoKnownAs`) alongside the new title number URN?
   - (c) Both — succession credential + alias?

3. **Scope:** Does the identifier cover the title (the legal interest) or the physical extent of unregistered land? Multiple titles can overlap the same land.

### 10.2 D26 — Organisation DID Methods

**Status:** Decided (`did:key` provider-managed as default, `did:web` self-hosted as option)

**Decision:** Most organisations will use provider-managed `did:key` identifiers issued by their account provider (e.g. LMS). The account provider verifies the organisation's identity and regulatory status before issuing the DID, and lists it in their `managedOrganisations` registry. Self-hosted `did:web` at the firm's domain is available for firms wanting direct control, but adoption is expected to be gradual.

**Remaining questions:**

1. **Self-hosted `did:web` guidance:** For firms that choose `did:web`, should PDTF provide a standard tool/template for generating and hosting DID documents? (Likely yes — see Implementation Notes.)

2. **Domain verification cadence:** For `did:web` Organisations, how often should the TIR re-verify that a firm's DID document is still hosted and unchanged? (Proposal: daily automated check.)

3. **Provider migration:** If an Organisation switches account providers, how is the `did:key` transitioned? The new provider would issue a new `did:key` and update its `managedOrganisations` registry. A DID succession credential from the old provider may be needed.

### 10.3 Multi-Key Entities

Should Organisations be allowed to have multiple active keys for different purposes (e.g., one key for credential signing, another for authentication)? The current spec allows it (multiple entries in `verificationMethod`) but does not mandate it. Need to assess whether the added complexity is justified.

### 10.4 DID Method Migration

If `did:web` is superseded by a more secure method (e.g., `did:webvh` with verifiable history, or `did:tdw`), what is the migration path? The TIR can support multiple DID methods simultaneously, but credential re-issuance may be needed.

---

## 11. Implementation Notes

### 11.1 Reference Implementation: pdtf-did-resolver

The `pdtf-did-resolver` package (to be published at `property-data-standards-co/pdtf-did-resolver` on GitHub) provides:

- **did:key resolution** — deterministic DID document generation from Ed25519 keys
- **did:web resolution** — HTTPS fetch with caching, error handling, and TLS validation
- **URN validation** — ABNF grammar validation for all `urn:pdtf:*` identifiers
- **Key derivation** — Ed25519 key pair generation and `did:key` derivation
- **DID document builder** — typed builder for constructing Organisation, Transaction, and Adapter DID documents

#### 11.1.1 API Surface (TypeScript)

```typescript
import {
  resolveDidKey,
  resolveDidWeb,
  resolveDid,
  generateDidKey,
  validatePdtfUrn,
  DidDocumentBuilder
} from '@pdtf/did-resolver';

// Generate a new did:key
const { did, publicKey, privateKey } = await generateDidKey();
// → did = "did:key:z6Mk..."

// Resolve any DID
const didDocument = await resolveDid('did:web:moverly.com:transactions:abc123');
// → { id: "did:web:...", verificationMethod: [...], service: [...] }

// Resolve did:key (synchronous — no network)
const keyDoc = resolveDidKey('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK');

// Validate a PDTF URN
const valid = validatePdtfUrn('urn:pdtf:titleNumber:DN123456');
// → true

// Build a DID document
const doc = new DidDocumentBuilder('did:web:smithandjones.co.uk')
  .addVerificationMethod({
    id: '#key-1',
    type: 'Ed25519VerificationKey2020',
    publicKeyMultibase: 'z6Mkr7JAFsC4...'
  })
  .addAuthentication('#key-1')
  .addAssertionMethod('#key-1')
  .addService({
    id: '#sra',
    type: 'RegulatoryRegistration',
    serviceEndpoint: 'https://www.sra.org.uk/solicitors/firm/612345',
    registrationNumber: '612345'
  })
  .build();
```

#### 11.1.2 DID Document Hosting for did:web

Organisations and platforms hosting `did:web` DID documents must serve them with:

- **Content-Type:** `application/json` or `application/did+json`
- **HTTPS only** — HTTP MUST be rejected by resolvers
- **CORS headers:** `Access-Control-Allow-Origin: *` (DID documents are public by design)
- **Cache-Control:** Set appropriate TTL (recommended: `max-age=3600` for transactions, `max-age=86400` for organisations)

**Minimal hosting example (static file):**

A conveyancer firm can host their DID document as a static JSON file at `https://smithandjones.co.uk/.well-known/did.json`. No dynamic server required — a CDN or static site host (GitHub Pages, Cloudflare Pages, Netlify) is sufficient.

### 11.2 Dependencies

| Package | Purpose |
|---------|---------|
| `@noble/ed25519` | Ed25519 key generation, signing, verification |
| `multiformats` | Multibase/multicodec encoding and decoding |
| `@digitalbazaar/ed25519-verification-key-2020` | Ed25519VerificationKey2020 type implementation |

### 11.3 Test Vectors

The reference implementation MUST include test vectors for:

1. **did:key derivation** — known public key → expected DID string
2. **did:key resolution** — known DID → expected DID document
3. **did:web URL construction** — known DID → expected HTTPS URL
4. **URN validation** — valid and invalid URN strings for each type
5. **Round-trip** — generate key pair → derive DID → resolve → verify key matches

### 11.4 Organisation Onboarding Tool

To lower the barrier for firms, PDTF will provide a CLI tool:

```bash
# Generate Organisation DID document
npx @pdtf/did-tools org-init \
  --domain smithandjones.co.uk \
  --sra-number 612345 \
  --company-number OC123456 \
  --output .well-known/did.json

# Verify DID document is correctly hosted
npx @pdtf/did-tools org-verify --did did:web:smithandjones.co.uk
```

This generates the key pair, constructs the DID document with regulatory metadata, and outputs the file for hosting. The `org-verify` command checks that the document is accessible, valid, and matches the expected format.

---

## Appendix A: Identifier Quick Reference

| Entity | Identifier Type | Pattern | Example |
|--------|----------------|---------|---------|
| Person | `did:key` | `did:key:z6Mk{base58}` | `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK` |
| Organisation (provider-managed) | `did:key` | `did:key:z6Mk{base58}` | `did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm` |
| Organisation (self-hosted) | `did:web` | `did:web:{domain}` | `did:web:smithandjones.co.uk` |
| Transaction | `did:web` | `did:web:{platform}:transactions:{id}` | `did:web:moverly.com:transactions:abc123` |
| Trusted Adapter | `did:web` | `did:web:{host}:{adapter}` | `did:web:adapters.propdata.org.uk:hmlr` |
| Property | URN | `urn:pdtf:uprn:{uprn}` | `urn:pdtf:uprn:100023456789` |
| Title (registered) | URN | `urn:pdtf:titleNumber:{number}` | `urn:pdtf:titleNumber:DN123456` |
| Title (unregistered) | URN | `urn:pdtf:unregisteredTitle:{uuid}` | `urn:pdtf:unregisteredTitle:f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| Ownership | URN | `urn:pdtf:ownership:{uuid}` | `urn:pdtf:ownership:7c9e6679-7425-40de-944b-e07fc1f90ae7` |
| Representation | URN | `urn:pdtf:representation:{uuid}` | `urn:pdtf:representation:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` |
| Consent | URN | `urn:pdtf:consent:{uuid}` | `urn:pdtf:consent:b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e` |
| Offer | URN | `urn:pdtf:offer:{uuid}` | `urn:pdtf:offer:c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f` |

## Appendix B: Decision Log

| ID | Decision | Date | Status |
|----|----------|------|--------|
| D7 | `did:key` for Persons; `did:key` or `did:web` for Organisations; `did:web` for Transactions/Adapters | 2026-03-23 | **Updated** — Organisations may use provider-managed `did:key` (common case) or self-hosted `did:web` |
| D23 | `urn:pdtf:unregisteredTitle:{uuid}` for unregistered titles | 2026-03-24 | **Open** — UUID version and first-registration transition TBD |
| D26 | Organisations use `did:key` (provider-managed, default) or `did:web` (self-hosted) | 2026-03-24 | **Updated** — `did:key` via account provider is the common path; `did:web` for firms wanting direct control |

## Appendix C: Related Sub-specs

| Sub-spec | Relevance |
|----------|-----------|
| [01 — Entity Graph & Schema](../01-entity-graph/) | Entity types that these identifiers address |
| [02 — VC Data Model](../02-vc-data-model/) | How DIDs appear in `issuer` and `credentialSubject.id` fields |
| [04 — Trusted Issuer Registry](../04-trusted-issuer-registry/) | TIR registration of `did:web` entities |
| [12 — Adapter Access Control](../12-adapter-access-control/) | DID Auth and credential presentation protocols |
| [07 — State Assembly](../07-state-assembly/) | How identifiers are used in graph composition |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | Organisation `did:key` support added throughout: DID document examples, key decisions (D7/D26), entity mapping, creation lifecycle, cache TTLs, key storage. Provider-managed `did:key` as default path. `managedOrganisations` verification via TIR. |
| v0.1 | 24 March 2026 | Initial draft. `did:key` for Persons, `did:web` for Organisations/Transactions/Adapters, URN scheme (7 types), DID document patterns, cache strategy, key rotation, deactivation, TIR cross-check. |

---

*End of Sub-spec 03.*
