---
title: "00 Architecture Overview"
description: "PDTF 2.0 specification document."
---


**Version:** 0.1 (Draft)
**Date:** 15 April 2026
**Author:** Ed Molyneux / Moverly

---

## 1. Executive Summary

PDTF 2.0 is the property-specific domain profile for the emerging UK digital identity and credentials ecosystem. It defines property credential types, trust marks, and composition rules within the OpenID Federation framework.

Where PDTF v1 bound property data to a single platform's verified claims model, PDTF 2.0 makes property data portable, independently verifiable, and interoperable — by adopting the same standards that UK Smart Data, GOV.UK Wallet, and the EU Digital Identity Architecture are converging on: **OpenID Federation** for trust, **OID4VCI** for credential issuance, **OID4VP** for credential presentation, and **FAPI 2.0** for high-assurance API security.

PDTF's unique contribution is the **domain layer**: an entity graph that decomposes a property transaction into its constituent parts (Transaction, Property, Title, Person, Organisation, SellerCapacity, Representation, DelegatedConsent, Offer), a schema system that defines what property credentials contain, and composition rules that assemble individual credentials into coherent transaction state.

This document is the master reference for the PDTF 2.0 implementation. It links to sub-specs for each workstream and captures architectural decisions as they're made.

---

## 2. What Changes from v1

| Aspect | PDTF v1 (Current) | PDTF 2.0 |
|--------|-------------------|-----------|
| **Data model** | Monolithic `pdtf-transaction.json` (~4,000 paths) | Entity graph: Transaction, Property, Title, Person, Organisation, SellerCapacity, Representation, DelegatedConsent, Offer |
| **Claims** | OpenID Connect verified claims with pathKey:value REPLACE semantics | W3C Verifiable Credentials with sparse objects, issued via OID4VCI |
| **Identity** | Firebase Auth UIDs, no universal identifiers | DIDs (`did:key` for persons, `did:web` for organisations) within a governed OpenID Federation |
| **Entity identifiers** | Internal Firestore document IDs | URNs: `urn:pdtf:titleNumber:{value}`, `urn:pdtf:uprn:{value}` |
| **Verification** | Trust the platform serving the data | Cryptographic proof — verify the credential signature, check issuer trust via federation chain |
| **Credential exchange** | Platform-specific API calls | OID4VCI (issuance) + OID4VP (presentation) — standard protocols |
| **Provenance** | OIDC-derived evidence schema (deeply nested) | Simpler evidence model reflecting actual usage patterns |
| **Access control** | Platform-enforced role checks | Per-credential `termsOfUse` + OID4VP presentation with participation credentials |
| **Trust** | Single platform trust | OpenID Federation trust chain with property-specific trust marks |
| **Interoperability** | REST API, platform-specific | FAPI 2.0 security profile, MCP + OpenAPI interface, federation metadata discovery |
| **Data sync** | Platform-to-platform API calls | Encrypted VC replication — GDPR-safe sync with per-recipient envelope encryption *(target architecture; Phase 1 uses platform-level access control)* |

The key shift is not "OIDC → DIDs" but **"platform-bound claims → portable credentials within a federated trust ecosystem."** DIDs remain useful as identifiers for organisations, transactions, and persons — but they sit within a governed federation, not as standalone trust roots.

---

## 3. Entity Graph

### 3.1 Core Entities

| Entity | Identifier | Schema | Description |
|--------|-----------|--------|-------------|
| **Transaction** | `did:web` | `v4/Transaction.json` | The intent to sell. Metadata, status, dates, and financial context (`saleContext`). References exactly one Property and one or more Titles. DID document hosts service endpoints. |
| **Property** | `urn:pdtf:uprn:{uprn}` | `v4/Property.json` | The physical land and buildings. Physical facts, construction, energy, environmental. Governed by the "logbook test" — only facts that survive the transaction belong here. |
| **Title** | `urn:pdtf:titleNumber:{number}` | `v4/Title.json` | The legal right. Legal boundary, registered owner, tenure, charges. |
| **Person** | `did:key` | `v4/Person.json` | A natural person (seller, buyer). |
| **Organisation** | `did:key` or `did:web` | `v4/Organisation.json` | A company (conveyancer, estate agent, lender). Includes regulatory IDs (SRA, Companies House). |

### 3.2 Relationship Entities (Thin Assertions)

These are signed assertions expressing authority, intent, and process state. They contain minimal data beyond the relationship they describe.

| Entity | Identifier | Schema | Description |
|--------|-----------|--------|-------------|
| **SellerCapacity** | URN (generated) | `v4/SellerCapacity.json` | A self-asserted claim linking a Person/Organisation to a Title ("this person is acting as registered owner/executor"). Starts as the owner's own assertion; verified against Title.registerExtract.proprietorship. Establishes right to sell. Revocable. |
| **Representation** | URN (generated) | `v4/Representation.json` | Signed assertion linking a representative (Organisation) to a represented party (Person). Records the role (Conveyancer, Estate Agent, Mortgage Broker). Revocable. |
| **DelegatedConsent** | URN (generated) | `v4/DelegatedConsent.json` | Signed permission granting read access to specific credentials. Typically issued by a buyer/seller to a third party (like a lender). |
| **Offer** | URN (generated) | `v4/Offer.json` | The intent to buy. Links buyer(s) to a Transaction. Contains offer details, status, conditions. |
| **Mortgage** | URN (generated) | Future | Tied to Offer/buyer. Flagged for growth — not in initial implementation. |

### 3.3 The Two Intents: Selling and Buying

A clear way of thinking about the graph architecture is through the lens of intent:

1. **Transaction = Intent to Sell.** The `Transaction` entity represents the seller's active intent to sell the referenced `Property` and `Title`(s). 
2. **Offer = Intent to Buy.** The `Offer` entity represents a buyer's intent to purchase them.

**Relationship credentials orbit these intents:**
- The Estate Agent and Seller's Conveyancer hold `Representation` credentials orbiting the **Transaction** (they are representing the intent to sell).
- The Buyer's Conveyancer and Mortgage Broker hold `Representation` credentials orbiting the **Offer** (they are supporting the intent to buy).

This cleanly partitions the entities. Buyers participate *only* through Offers until exchange of contracts.

### 3.4 Access Control and Traversal

Because relationships orbit the intent, the graph itself becomes the access control model. No central ACL is required.

Consider a mortgage lender who needs to view the property data to issue a formal mortgage offer:
1. **Decision in Principle:** The buyer holds a `MortgagePromise` VC issued by the lender. The buyer presents this to the agent as part of their `Offer`.
2. **Traversal Authorisation:** If the offer is accepted, the lender needs to see the property data. They don't have a direct `Representation` credential (they aren't acting *for* the buyer, they are funding them). Instead, the buyer issues a `DelegatedConsent` credential to the lender.
3. **Graph Resolution:** The `DelegatedConsent` acts as a capability token. The lender presents it to the agent's MCP server/adapter. The server validates the chain: "This lender holds consent from the buyer, who holds an accepted `Offer` on this `Transaction`." Therefore, the lender is authorised to traverse the transaction graph and read the `Property` and `Title` VCs.

### 3.5 Entity Relationship Diagram

![PDTF 2.0 Entity Relationship Model](/web/diagrams/entity-graph.png)

### 3.6 Relationship Model

The relationship is **Transaction-centric**, not Property → Title → Transaction. This matters because:
- **Unregistered titles** exist — no title number, so no `urn:pdtf:titleNumber:*`. We need an identifier method for titles which are currently unregistered but for which title evidence is being gathered.
- A transaction may involve **multiple properties and multiple titles** (e.g. a house and its garage on separate titles).
- The DID-based relationship model handles this naturally — a Transaction DID document references its associated Property and Title identifiers.

```
Transaction (did:web:moverly.com:transactions:*)
    ├── Property[] (urn:pdtf:uprn:*)
    │     └── (may have no title — new build, unregistered)
    ├── Title[] (urn:pdtf:titleNumber:* OR urn:pdtf:unregisteredTitle:*)
    │     └── (may span multiple properties)
    │
    ├── Person[] (did:key:*)
    │     └── Individual people
    ├── Organisation[] (did:key:* or did:web:*)
    │     └── Firms and companies
    │
    ├── SellerCapacity[] ──→ Person/Organisation ──→ Title
    │     └── Self-asserted claim of legal ownership, linking
    │         a Person/Organisation DID to a Title URN.
    │         Verified against Title.registerExtract.proprietorship.
    │         The ownership claim is what gives the holder the
    │         right to sell — the Transaction's Titles are "for sale"
    │         because someone with an SellerCapacity credential says so.
    │
    ├── Representation[] ──→ Person/Organisation
    │     ├── role: "sellerConveyancer" (issued by seller/owner)
    │     ├── role: "estateAgent" (issued by seller/owner)
    │     └── role: "buyerConveyancer" (issued by buyer)
    │     (typically issued to firms, but the credential model
    │      supports both Person and Organisation holders)
    │
    ├── DelegatedConsent[] ──→ Person/Organisation
    │     └── Authorised entities (e.g. lenders) with specific
    │         data access rights under terms of use
    │
    └── Offer[] ──→ Person/Organisation
          ├── role: "buyer" (implicit)
          ├── status, amount, conditions
          └── Mortgage (future)
```

**Participation decomposed:** The old "Participation" entity is replaced by three precise relationship types:
- **SellerCapacity** — self-asserted claim of legal ownership, linking a Person or Organisation DID to a Title URN. The owner starts by asserting their own ownership; the platform then seeks to verify this against Title.registerExtract.proprietorship (claim-vs-evidence separation). The ownership claim is what establishes the right to sell: a Transaction's referenced Titles are "for sale" because the legal owner — who holds the SellerCapacity credential — is offering them for sale.
- **Representation** — delegated authority to act on someone's behalf. Typically issued to an Organisation (the conveyancer firm, not the individual solicitor), because the professional duty and insurance liability sits with the firm. But the credential model supports both Person and Organisation holders — companies can also represent other companies.
- **DelegatedConsent** — authorised access for entities like lenders, as part of terms of use (Q4.2 resolved via DelegatedConsentCredential). General consent mechanism for entities that aren't direct participants but have legitimate data access needs.

**Person vs Organisation:** Both can own, sell, buy, represent, and consent. The difference is structural, not role-based: an Organisation has a Companies House identity, SRA registration, and PI insurance — attributes that don't belong on a Person entity. Both get relationship credentials; both can be on either side of a transaction.

### 3.3 Key Design Decisions

- **Buyers participate only through Offers** — no Participation entity for buyers. This models the real-world relationship: a buyer doesn't "participate" in the seller's transaction until they make an offer, and multiple offers can exist simultaneously. Buyers can be Persons or Organisations (companies buy property too).
- **SellerCapacity establishes the right to sell** — the legal owner self-asserts ownership by issuing an SellerCapacity credential linking their DID to a Title URN. This is what puts a title "for sale" in a transaction. The platform then verifies the claim against the proprietorship register. No separate "listing" entity is needed — the SellerCapacity credential IS the assertion of the right to dispose of the title.
- **ID-keyed collections** — v4 moves from arrays (participants[], searches[]) to ID-keyed maps (like current offers). Breaking change to schema structure but not to the underlying data — path handling code updates required.
- **Property-level VCs** — EPC, flood risk, searches etc. are Property VCs with paths like `/energyEfficiency/certificate`, not first-class entity VCs. Primary issuers will use the same paths when they adopt the standard.

### 3.4 Entity Separation Principle — The Logbook Test

The governing question for field assignment: **"Does this fact travel with the property to a new owner?"**

- **Property** = enduring facts (the "logbook"): EPC, flood risk, build info, legal questions, fixtures & fittings, environmental data. If a new buyer inherits it, it's a Property fact.
- **Title** = legal title facts: title number, extents (geoJSON), register extract (including proprietorship as evidence), ownership type (freehold/leasehold), leasehold terms and restrictions, isFirstRegistration, mortgage/charge information. The existing branch 263 work already merges `ownershipsToBeTransferred` into the Title entity.
- **Transaction** = this-sale facts: numberOfSellers, numberOfNonUkResidentSellers, outstandingMortgage, existingLender, hasHelpToBuyEquityLoan, isLimitedCompanySale. None of these pass the logbook test — they describe this specific transaction, not the property itself.
- **SellerCapacity** = self-asserted claim of legal ownership linking a Person or Organisation DID to a Title URN, with status and verification level. The owner starts by asserting this themselves — their ownership claim is what establishes the right to sell. The evidence (proprietorship register) lives on the Title entity — SellerCapacity is the claim, Title holds the evidence.

### 3.5 Existing Work

The entity decomposition is already in progress on the schemas repo:
- **Branch:** `263-extract-separate-entity-schemas-from-combinedjson-in-preparation-for-pdtf-20`
- **120 files changed**, 224K lines added
- Extraction utility: `src/utils/decomposeSchema.js` (576 lines)
- Entity overlay system: per-entity overlay directories with form-specific overlays
- Tests: entity validation, overlay application, extension handling
- V4 entity schemas: Transaction, Property, Title, Person, Participation (Offer not yet created)

---

## 4. Verifiable Credentials

### 4.1 W3C VC Data Model

Each piece of property data becomes a signed Verifiable Credential. PDTF defines property-specific credential types within the W3C VC Data Model v2.0, issued and presented using OpenID protocols (see §4.5).

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:key:z6Mkh...abc",
  "validFrom": "2026-03-23T07:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "1234-5678-9012-3456-7890",
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "lodgementDate": "2024-01-15"
      }
    }
  },
  "evidence": [{
    "type": "ElectronicRecord",
    "source": "get-energy-performance-data.communities.gov.uk",
    "retrievedAt": "2026-03-23T06:30:00Z",
    "method": "API"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "public",
    "pii": false
  }],
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/12345#67890",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "67890",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/12345"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:key:z6Mkh...abc#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z3FXQje..."
  }
}
```

### 4.2 Relationship to OpenID Verified Claims

PDTF v1 used OpenID Connect verified claims with a `pathKey:value` model. PDTF 2.0 moves to W3C Verifiable Credentials, but the transition is enabled — not complicated — by the OpenID ecosystem's own evolution. OID4VCI and OID4VP now provide standard protocols for issuing and presenting VCs, meaning PDTF credentials live within the same ecosystem as the v1 OIDC claims, just in a more expressive and portable format.

Implementers migrating from v1 should note:
- The `credentialSubject` sparse object replaces `claimPath` + `claimValue`
- The `evidence` model simplifies the deeply nested OIDC evidence schema
- `termsOfUse` carries the same confidentiality/PII/role semantics as before
- `credentialStatus` adds revocation capability (absent in v1)
- `proof` adds cryptographic verification (absent in v1)

### 4.3 Claims Representation — Sparse Objects + Dependency Pruning

**Decision:** Move away from pathKey:value REPLACE semantics toward sparse objects with dependency pruning. *Consensus needed from LMS and other implementers.*

**Current approach (v1):**
```json
{ "claimPath": "/propertyPack/heating/heatingSystem/heatingType", "claimValue": "Central heating" }
{ "claimPath": "/propertyPack/heating/heatingSystem/centralHeatingDetails/fuelType", "claimValue": "Mains gas" }
```
When `heatingType` changes from "Central heating" to "None", the `centralHeatingDetails` claim still exists in the database — REPLACE only overwrites the specific path.

**New approach (v2):**
```json
{
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "heating": {
      "heatingSystem": {
        "heatingType": "None"
      }
    }
  }
}
```
State assembly uses MERGE semantics. A **dependency pruning pass** then strips `centralHeatingDetails` because the schema's `oneOf` discriminator on `heatingType` makes it irrelevant when value is "None".

**Why this matters:** The pruning pass is the clean, spec-compliant way to handle dependent data. It requires implementers to understand schema discriminators, but the reference implementation will handle it and the alternative (REPLACE semantics with potential stale nested data) is worse.

### 4.4 Proof Format: Data Integrity vs JWS/VC-JWT

PDTF 2.0 uses **Data Integrity proofs** (`eddsa-jcs-2022`) as the primary securing mechanism for credentials at rest and in storage. Both Data Integrity and JWS are valid securing mechanisms for W3C VCs. The choice has meaningful consequences.

| | Data Integrity (PDTF primary) | JWS / VC-JWT |
|---|---|---|
| Proof location | `proof` object embedded in the VC JSON | Detached JWS or entire VC wrapped as a JWT (header.payload.signature) |
| Canonicalisation | JCS (JSON Canonicalization Scheme, RFC 8785) | None needed — signs raw bytes |
| Human readability | VC is plain JSON, directly inspectable | VC-JWT requires base64 decoding before any claims are visible |
| Selective disclosure path | Foundation for BBS+ and JSON-LD ZKP mechanisms | Requires SD-JWT (separate spec) |
| W3C VC 2.0 positioning | Primary securing mechanism | Supported but positioned as legacy |
| OID4VCI format | `ldp_vc` credential format | `jwt_vc_json` credential format |
| Key algorithm | Ed25519 (via `eddsa-jcs-2022` cryptosuite) | Algorithm-agnostic (RS256, ES256, EdDSA, etc.) |

**Rationale for Data Integrity as primary format:**

1. **JSON-native.** PDTF VCs stay as parseable JSON throughout their lifecycle. Consumers, debuggers, and AI agents can read claims without decoding. VC-JWT produces opaque base64 blobs that must be unpacked before inspection.

2. **Selective disclosure upgrade path.** Data Integrity is the foundation for BBS+ signatures, enabling future scenarios like "share the EPC rating but not the address" without re-issuance.

3. **W3C alignment.** The VC Data Model v2.0 editors have positioned Data Integrity as the primary path forward.

4. **Deterministic serialisation.** JCS provides a canonical JSON form regardless of whitespace or key ordering.

**Where JWS/JWT is used in PDTF 2.0:**

- **OID4VCI credential responses** may use `jwt_vc_json` format when interacting with wallet implementations that prefer JWT. PDTF adapters MUST support `ldp_vc` and SHOULD support `jwt_vc_json`.
- **OID4VP presentation tokens** use JWT as the transport envelope (VP Token), while the credentials inside remain Data Integrity VCs.
- **OpenID Federation entity statements** are signed JWTs by definition — this is the federation layer, not the credential layer.
- **Status list credentials** use Data Integrity for consistency, but JWS is technically permitted.

### 4.5 Credential Issuance and Presentation Protocols

PDTF 2.0 uses OpenID standards for credential exchange:

**OID4VCI (OpenID for Verifiable Credential Issuance)** — how credentials are issued:
- Adapters and primary sources act as OID4VCI credential issuers
- Each issuer publishes a credential issuer metadata document at `/.well-known/openid-credential-issuer`
- Supported credential formats: `ldp_vc` (primary), `jwt_vc_json` (interoperability)
- Credential types are PDTF-defined: `PropertyCredential`, `TitleCredential`, `SellerCapacityCredential`, `RepresentationCredential`, etc.
- Pre-authorised code flow for adapter-initiated issuance (no user interaction needed for data lookups)
- Authorization code flow for user-initiated credential requests

**OID4VP (OpenID for Verifiable Presentations)** — how credentials are presented:
- Participants present credentials to prove their relationship to a transaction
- Presentation definition specifies which credential types are required (e.g. `SellerCapacityCredential` or `RepresentationCredential`)
- VP Token contains the Verifiable Presentation with the requested credentials
- Used for both human-initiated flows (wallet) and machine-to-machine (API access)

```json
{
  "presentation_definition": {
    "id": "pdtf-transaction-access",
    "input_descriptors": [{
      "id": "participation-proof",
      "constraints": {
        "fields": [{
          "path": ["$.type"],
          "filter": {
            "type": "array",
            "contains": {
              "enum": ["SellerCapacityCredential", "RepresentationCredential", "DelegatedConsentCredential"]
            }
          }
        }]
      }
    }]
  }
}
```

---

## 5. Identifiers & Discovery

### 5.1 DID Methods

DIDs serve as identifiers for organisations, persons, and transactions within the PDTF ecosystem. They are not standalone trust roots — trust is established through the OpenID Federation chain (§6), and DIDs provide the cryptographic binding between an entity and its keys.

| Entity             | DID Method           | Example                                           | Resolution                                                                                     |
|--------------------|----------------------|---------------------------------------------------|------------------------------------------------------------------------------------------------|
| Persons            | `did:key`            | `did:key:z6Mkh...abc`                             | Self-resolving from public key, no hosting needed                                              |
| Organisations      | `did:key` or `did:web` | `did:key:z6Mkf...xyz` or `did:web:smithandjones.co.uk` | `did:key` when managed by account provider (e.g. LMS); `did:web` when self-hosting identity |
| Transactions       | `did:web`            | `did:web:moverly.com:transactions:abc123`         | Hosted DID document at `https://moverly.com/transactions/abc123/did.json`                      |
| Trusted Adapters   | `did:web`            | `did:web:adapters.propdata.org.uk:hmlr`           | Hosted DID document with service endpoints for VC requests + federation entity configuration   |

### 5.2 URN Scheme

```
urn:pdtf:uprn:{uprn}           → Property identifier
urn:pdtf:titleNumber:{number}  → Title identifier
urn:pdtf:capacity:{uuid}      → SellerCapacity claim
urn:pdtf:representation:{uuid} → Representation mandate (Organisation)
urn:pdtf:consent:{uuid}        → Delegated consent
urn:pdtf:offer:{uuid}          → Offer relationship
```

### 5.3 Discovery Model

Discovery in PDTF 2.0 combines OpenID Federation metadata resolution with DID document resolution:

1. **Federation metadata** — resolve the entity's OpenID Federation entity configuration at `/.well-known/openid-federation`. This establishes trust (is this entity part of the federation?) and capabilities (what credential types does it issue?).

2. **DID document** — resolve the entity's DID document for cryptographic keys and service endpoints. For `did:web` entities, this is at the standard `did.json` path.

3. **Credential issuer metadata** — for adapters/issuers, resolve `/.well-known/openid-credential-issuer` for OID4VCI-specific metadata (supported credential types, formats, endpoints).

For a transaction, the discovery flow is:
```
Transaction DID (did:web:moverly.com:transactions:abc123)
  → DID Document (keys, service endpoints including PDTF API and MCP)
  → Federation entity configuration (trust chain, trust marks)
  → Credential issuer metadata (for adapters providing data to this transaction)
```

### 5.4 Access Control

To access restricted or confidential VCs (or the pre-composed state derived from them), a requester must:

1. **Present a valid credential via OID4VP** — an SellerCapacity, Representation, or DelegatedConsent credential proving their relationship to the transaction
2. **Prove control of their DID** — implicit in the OID4VP flow (the VP is signed by the holder's key)
3. **Revocation check** — the presented credential must not be revoked (Bitstring Status List check)
4. **termsOfUse filtering** — the system returns only VCs whose `termsOfUse` policy permits access for the requester's role

Public VCs (title deeds, EPCs, searches) require no authentication.

---

## 6. Trust Architecture

### 6.1 Federated Trust via OpenID Federation

PDTF 2.0 uses **OpenID Federation (RFC 9396)** as its trust infrastructure. The federation model establishes who is authorised to issue which property credentials, using a chain of signed entity statements from a trust anchor down to leaf entities.

```
                    ┌──────────────────────────┐
                    │  Trust Anchor             │
                    │  (propdata.org.uk)        │
                    │  ──────────────────       │
                    │  Entity Configuration     │
                    │  + Trust Mark Issuer      │
                    └──────────┬───────────────┘
                               │ subordinate statement
                    ┌──────────▼───────────────┐
                    │  Intermediate Entity      │
                    │  (sector authority, e.g.  │
                    │   property data services) │
                    └──────────┬───────────────┘
                               │ subordinate statement
                    ┌──────────▼───────────────┐
                    │  Leaf Entity              │
                    │  (adapter / issuer)       │
                    │  ──────────────────       │
                    │  Entity Configuration     │
                    │  + Trust Marks held       │
                    │  + OID4VCI metadata       │
                    └──────────────────────────┘
```

**How it works:**

1. The **Trust Anchor** publishes its entity configuration at `https://propdata.org.uk/.well-known/openid-federation`, containing its signing keys and federation policy.

2. The Trust Anchor issues **subordinate entity statements** for each authorised entity in the federation — these are signed JWTs that bind the subordinate's identifier to its metadata and any constraints.

3. Each **leaf entity** (adapter, issuer) publishes its own entity configuration at its domain, including the trust marks it holds and its OID4VCI credential issuer metadata.

4. A **verifier** resolves the trust chain by fetching the leaf entity's configuration, walking up through subordinate statements to the trust anchor, and validating signatures at each level.

**Entity configuration example (adapter):**

```json
{
  "iss": "https://adapters.propdata.org.uk/hmlr",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "iat": 1713186000,
  "exp": 1744722000,
  "jwks": {
    "keys": [{
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik",
      "kid": "hmlr-adapter-key-1",
      "use": "sig"
    }]
  },
  "metadata": {
    "openid_credential_issuer": {
      "credential_issuer": "https://adapters.propdata.org.uk/hmlr",
      "credential_endpoint": "https://adapters.propdata.org.uk/hmlr/credential",
      "credentials_supported": [{
        "format": "ldp_vc",
        "types": ["VerifiableCredential", "TitleCredential"],
        "cryptographic_binding_methods_supported": ["did:key", "did:web"]
      }]
    }
  },
  "trust_marks": [{
    "id": "https://propdata.org.uk/trust-marks/title-data-provider",
    "trust_mark": "eyJhbGciOiJFZERTQSIs..."
  }],
  "authority_hints": ["https://propdata.org.uk"]
}
```

### 6.2 Property Trust Marks

Trust marks are the PDTF-specific mechanism for expressing what an entity is authorised to do within the property ecosystem. They use the OpenID Federation trust mark standard (see [Sub-spec 04](/web/specs/04-openid-federation/)).

Each trust mark is a signed JWT issued by the trust anchor (or a delegated trust mark issuer), asserting that an entity meets the requirements for a specific role:

| Trust Mark ID | Meaning | Issued To |
|---------------|---------|-----------|
| `https://propdata.org.uk/trust-marks/title-data-provider` | Authorised to issue TitleCredentials | HMLR, adapters proxying HMLR data |
| `https://propdata.org.uk/trust-marks/search-provider` | Authorised to issue property search credentials | Search providers, LLC adapters |
| `https://propdata.org.uk/trust-marks/regulated-conveyancer` | SRA/CLC regulated conveyancing firm | Conveyancer organisations |
| `https://propdata.org.uk/trust-marks/energy-data-provider` | Authorised to issue EPC/energy credentials | MHCLG, EPC adapters |
| `https://propdata.org.uk/trust-marks/environmental-data-provider` | Authorised to issue environmental risk credentials | EA, flood risk adapters |
| `https://propdata.org.uk/trust-marks/account-provider` | Authorised to issue user DIDs on behalf of persons | Moverly, LMS, wallet providers |

**Trust mark structure:**

```json
{
  "iss": "https://propdata.org.uk",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "id": "https://propdata.org.uk/trust-marks/title-data-provider",
  "iat": 1713186000,
  "exp": 1744722000,
  "ref": "https://propdata.org.uk/trust-marks/title-data-provider/policy",
  "delegation": {
    "authorised_paths": [
      "Title:/titleNumber",
      "Title:/titleExtents",
      "Title:/registerExtract",
      "Title:/ownership/*"
    ],
    "trust_level": "trusted_proxy",
    "proxy_for": "hmlr.gov.uk"
  }
}
```

The `delegation` claim is a PDTF extension to the standard trust mark. It carries the **entity:path authorisation** — specifying exactly which credential subject paths an issuer is authorised to populate. This is PDTF's domain-specific contribution to the trust mark: not just "this entity is a title data provider" but "this entity is authorised to issue credentials covering these specific data paths."

### 6.3 Issuer Accreditation

How an entity obtains trust marks and joins the federation:

**Phase 1 (bootstrap):**
1. Entity applies to the trust anchor operator (initially Moverly/propdata.org.uk)
2. Trust anchor verifies the entity's identity and authorisation (e.g. SRA registration for conveyancers, contractual relationship for data adapters)
3. Trust anchor issues a subordinate entity statement and the appropriate trust marks
4. Entity publishes its entity configuration referencing the trust anchor

**Phase 2+ (federated governance):**
1. A property sector governance body operates the trust anchor
2. Multiple trust mark issuers may exist (e.g. SRA issues `regulated-conveyancer` trust marks directly)
3. Trust chains can be deeper — a sector authority issues subordinate statements for categories of issuers

All federation metadata is signed-JWT-based: Entity Configurations, Subordinate Entity Statements, and Trust Marks. See [Sub-spec 04: OpenID Federation](/web/specs/04-openid-federation/) for the full trust architecture.

### 6.4 Trust Infrastructure Comparison

| | OpenID Federation (PDTF) | EBSI Root-TAO / TAO |
|---|---|---|
| Trust anchor | Trust Anchor Entity Statement | Root TAO (governmental) |
| Authority scope | Trust marks + metadata_policy | VerifiableAccreditation VC |
| Discovery | HTTP `.well-known/openid-federation` chain resolution | DID resolution + on-chain registry |
| Chain depth | Flexible (n levels) | Fixed 3-tier (Root TAO → TAO → TI) |
| Chain format | Signed JWTs (Entity Statements) | VCs (accreditations are VCs) |
| Revocation of trust | Expire/withdraw Entity Statement | Revoke the accreditation VC |
| Governance | Federated (each anchor sets policy) | Centralised (EU institutional) |
| Infrastructure | HTTPS endpoints | Permissioned blockchain (EBSI ledger) |
| UK ecosystem fit | **High** (OIDC-native, UK gov direction) | Low (EU-centric, blockchain dependency) |

**Why OpenID Federation is the right choice:**

OpenID Federation provides:
- **Signed trust chains** — every level of the chain is cryptographically verifiable, not just the leaf credentials
- **Decentralised governance** — each trust anchor sets its own policy; no single registry to control
- **Ecosystem alignment** — UK Smart Data, GOV.UK Wallet, and EUDI are all converging on OpenID Federation
- **Credential-format agnostic** — works with both Data Integrity VCs and JWT VCs
- **Existing infrastructure** — plugs into OAuth/OIDC infrastructure that platforms already operate

**Why not EBSI's model:**

EBSI's Root-TAO/TAO hierarchy is conceptually elegant — trust chains are VCs all the way down. But it requires a permissioned blockchain, assumes governmental top-down accreditation, and carries schema overhead that doesn't fit the UK property ecosystem's lateral trust relationships.

### 6.5 Three-Phase Evolution

**Phase 1 (now): Moverly as Federation Trust Anchor**
- Moverly operates the trust anchor at `propdata.org.uk`
- Existing collectors become OID4VCI credential issuers (adapters) as leaf entities
- Each adapter holds trust marks issued by the trust anchor
- Federation metadata served from the PDTF Trust Anchor at `trust.pdtf.org`
- Moverly is the sole account provider for user DIDs
- "Map-and-wrap": call existing APIs (HMLR OC1, EPC API, EA flood), issue as signed VCs via OID4VCI

**Phase 2 (medium-term): Federated Governance**
- Property sector governance body operates the trust anchor (or becomes a higher-level trust anchor above Moverly)
- Multiple organisations can run adapters (TM Group, LMS) — each with their own entity configuration and trust marks
- Adapters hosted independently (`adapters.propdata.org.uk`) with their own federation metadata
- SRA/CLC issue `regulated-conveyancer` trust marks directly
- Multiple account providers for user DIDs

**Phase 3 (future): Government Sources as Trust Anchors**
- HMLR, MHCLG, Environment Agency publish their own federation entity configurations
- They become trust anchors or intermediate entities in their own right, issuing credentials directly via OID4VCI
- Trust marks for adapter proxies carry `proxy_for` indicating the primary source
- Primary source credentials carry higher trust weight than proxy credentials
- Verifiers can resolve trust chains to government sources without intermediaries

---

## 7. Key Management

### 7.1 Architecture

- **Google Cloud KMS** for all key storage in production
- **Ed25519** key algorithm (expressed as JWK in federation metadata and DID documents)
- One key per user (generates their `did:key` identity)
- One key per adapter (for signing VCs and federation entity configuration)
- One key for Moverly platform / trust anchor (for signing trust marks and subordinate entity statements)

Keys are published in two places:
1. **Federation entity configuration** — JWKS in the entity statement, used for federation trust chain verification
2. **DID documents** — verification methods, used for VC signature verification

Both reference the same underlying key material. The federation JWKS uses standard JWK format:

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik",
  "kid": "hmlr-adapter-key-1",
  "use": "sig"
}
```

### 7.2 Key Rotation

Key rotation follows **OpenID Federation metadata update semantics**:

1. Generate new key pair in Cloud KMS
2. Update the entity configuration to include both old and new keys in the JWKS (overlap period)
3. Update the DID document's `verificationMethod` to include the new key
4. Begin signing new credentials and entity statements with the new key
5. After the overlap period (determined by `exp` on existing credentials and entity statements), remove the old key
6. Trust anchor re-issues subordinate entity statements referencing the updated JWKS

The overlap period ensures that credentials signed with the old key remain verifiable until they expire or are superseded. Federation entity statements have their own `exp` — rotating the statement key requires the trust anchor to re-issue the subordinate statement.

### 7.3 Credential Revocation

All issuers **must** support revocation via [W3C Bitstring Status List v2](https://www.w3.org/TR/vc-bitstring-status-list/). This is critical for:

- **SellerCapacity/Representation credentials** — must be revocable when a sale completes, a mandate is withdrawn, or a conveyancer is replaced
- **Property data VCs** — revocable when data is superseded (e.g. new EPC issued, updated flood risk assessment)
- **User DID credentials** — revocable when a user account is disabled or identity verification is invalidated
- **Trust marks** — revocable when an entity's accreditation is withdrawn (complementing the trust mark's `exp`)

**How it works:**
1. Each issuer hosts one or more Bitstring Status List credentials at a public URL
2. Each VC includes a `credentialStatus` field pointing to its entry in the status list
3. The status list is a compressed bitstring — each bit position maps to a credential
4. To revoke: issuer flips the bit at the credential's `statusListIndex`
5. Verifiers fetch the status list (cacheable with short TTL) and check the bit

**Adapter hosting:** Each adapter hosts its own status list endpoints (e.g. `adapters.propdata.org.uk/status/epc/{listId}`). Status lists are signed by the same adapter key used for VC issuance.

### 7.4 Key Hierarchy

```
Google Cloud KMS
├── Trust Anchor Key (propdata.org.uk)
│   └── Signs: subordinate entity statements, trust marks
│
├── Adapter Keys (did:web, per-adapter)
│   ├── hmlr-proxy-key → did:web:adapters.propdata.org.uk:hmlr
│   ├── epc-proxy-key → did:web:adapters.propdata.org.uk:epc
│   └── ea-flood-proxy-key → did:web:adapters.propdata.org.uk:ea-flood
│   (Each signs: VCs, entity configuration, status lists)
│
├── User Keys (did:key, per-user)
│   ├── user-{uid}-key → did:key:z6Mkh...abc
│   └── ...
│
└── Platform Key (Moverly's own identity)
    └── moverly-platform-key → did:web:moverly.com
```

### 7.5 Custodial Cloud Wallets vs Bring-Your-Own-Wallet

A strict Verifiable Credential model assumes users hold their own keys in a mobile wallet app, signing every assertion they make. In a property transaction, prompting a user to sign every page of a property information form (TA6) via a mobile app pop-up creates an unacceptable user experience.

To solve this while retaining cryptographic provenance, PDTF platforms use a **Custodial Cloud Wallet** pattern:

1. **Onboarding & IDV:** The platform performs AML/ID checks and issues an Identity VC for the user.
2. **Key Provisioning:** The platform generates a unique, secure enclave key pair (e.g. in Cloud KMS) for that specific user.
3. **Session Binding:** When the user logs into the web portal, their session is securely bound to that cloud wallet key.
4. **Seamless Signing:** As the user fills out forms, the platform backend uses the user's KMS key to sign the assertions in the background.
5. **Presentation:** The platform packages the signed assertions plus the Identity VC into an OID4VP presentation and delivers it to the verifier (e.g. the buyer's conveyancer).

To the verifier, this looks exactly like a standard OpenID presentation from a personal digital wallet — they receive cryptographic proof that the verified person made the assertions. To the user, it feels like a normal web application.

**Future migration to BYOW:** When government or ecosystem wallets (e.g. GOV.UK Wallet, EUDI) become mainstream, users can choose to "Bring Your Own Wallet" (BYOW). They authenticate via OID4VP and sign a finalised document at the end of the process using their own device key. The underlying PDTF architecture and verification logic does not need to change to support this migration.

---

## 8. State Assembly

### 8.1 Dual Composition

Three state assembly functions, used in sequence:

1. **`composeStateFromClaims`** (current) — aggregates pathKey:value verified claims with REPLACE semantics. No changes, backward compatible, continues to power existing v3 endpoints.

2. **`composeV3StateFromGraph`** — traverses the entity graph, assembles VCs into a v3-compatible flat state. Uses the existing combined.json schema shape. Replaces `composeStateFromClaims` once coverage is complete.

3. **`composeV4StateFromGraph`** — traverses the entity graph, assembles VCs into a v4 entity-based state. Internal handlers migrate to this. Uses sparse object MERGE + dependency pruning.

### 8.2 Migration Path

Migration strategy is resolved via parallel running (Q6.1–Q6.3 resolved).

```
Phase 1: composeStateFromClaims (existing, v3 shape)
         ↓ parallel
Phase 2: composeV3StateFromGraph (same output as Phase 1, different input) - parallel running resolves Q6
         → validate: outputs must match
         → once confident, replace Phase 1 internally
         ↓ parallel
Phase 3: composeV4StateFromGraph (new entity-based shape)
         → internal handlers migrate one by one
         → external v3 API continues to use composeV3StateFromGraph
```

### 8.3 DiligenceEngine Path Migration

Current DE paths: `propertyPack/heating/heatingSystem/heatingType`
Entity paths: `property:heating/heatingSystem/heatingType`

The `property:` prefix maps to the Property entity. `pdtfPaths.js` becomes a mapper that resolves `entity:path` to the appropriate entity and sub-path. The paths themselves aren't entity-specific (no UPRN in the path) — the entity context is provided by which entity the path is being evaluated against.

---

## 9. Hosted Adapter Services

### 9.1 Architecture

Separate domain: `adapters.propdata.org.uk` (new GCP project, potentially open-sourced).

Each adapter is an **OID4VCI credential issuer** and an **OpenID Federation leaf entity**:
- Has its own `did:web` identity (DID document at `adapters.propdata.org.uk/{adapter}/did.json`)
- Publishes federation entity configuration at `adapters.propdata.org.uk/{adapter}/.well-known/openid-federation`
- Publishes credential issuer metadata at `adapters.propdata.org.uk/{adapter}/.well-known/openid-credential-issuer`
- Holds trust marks from the property sector trust anchor
- Has its own signing key in Google Cloud KMS
- Calls existing source APIs (HMLR OC1, EPC API, EA flood data, LLC API, etc.)
- Issues signed VCs in PDTF 2.0 format via OID4VCI credential endpoint

### 9.2 Initial Adapters (from existing collectors)

| Adapter | Source API | Credential Types | Trust Mark | Priority |
|---------|-----------|-----------------|------------|----------|
| `hmlr` | HMLR OC1/OC2 | `TitleCredential` | `title-data-provider` | High |
| `epc` | MHCLG EPC API | `PropertyCredential` (energy paths) | `energy-data-provider` | High (just rebuilt) |
| `ea-flood` | EA Flood Risk API | `PropertyCredential` (flood paths) | `environmental-data-provider` | High |
| `llc` | HMLR LLC API | `PropertyCredential` (LLC paths) | `search-provider` | Medium |
| `bsr` | BSR Register API | `PropertyCredential` (building safety) | `search-provider` | Medium |
| `voa` | VOA Council Tax | `PropertyCredential` (council tax) | `search-provider` | Lower |

### 9.3 Adapter Credential Issuance Flow

```
OID4VCI Credential Request
  → Adapter validates requester (OID4VP participation proof or pre-authorised code)
  → Adapter calls source API
  → Adapter maps response to PDTF entity schema
  → Adapter signs VC with its KMS key
  → Returns signed VC in OID4VCI credential response
```

The pre-authorised code flow is typical for adapter-initiated issuance: the platform requests a credential for a specific property/title, and the adapter issues it without user interaction. The authorization code flow is used when a user initiates a credential request through a wallet or application.

### 9.4 Access Control for Adapter API

1. Requester presents an **SellerCapacity, Representation, or DelegatedConsent credential** via OID4VP
2. Adapter verifies the VP signature and the contained credential(s)
3. Adapter checks credential is **not revoked** (Bitstring Status List)
4. Adapter verifies its own **trust chain** is valid (federation metadata)
5. Adapter checks `termsOfUse` of requested entity:paths against requester's role
6. If authorised: fetch data, issue VC, return
7. If public data: no authentication required

*(Full spec: `papers/pdtf-v2/12-adapter-access-control.md` — TBD)*

---

## 10. Reference Implementations

### 10.1 Planned

| Component | Description | Language | Repo |
|-----------|-------------|---------|------|
| **VC Validator** | Validates VC signature, resolves federation trust chain, checks trust marks, verifies proof | TypeScript | `property-data-standards-co/pdtf-vc-validator` |
| **Graph Composer** | Traverses entity graph, assembles state from VCs | TypeScript | Part of `@pdtf/schemas` |
| **DID Resolver** | Resolves `did:key` and `did:web` identifiers | TypeScript | `property-data-standards-co/pdtf-did-resolver` |
| **Credential Builder** | Creates and signs VCs with PDTF context, OID4VCI-compatible | TypeScript | `property-data-standards-co/pdtf-vc-builder` |
| **Federation Client** | Resolves OpenID Federation trust chains, validates trust marks | TypeScript | `property-data-standards-co/pdtf-federation-client` |

### 10.2 Validator Flow

```
Input: VC document
  → Parse and validate structure (JSON-LD context, required fields)
  → Extract issuer DID
  → Resolve DID → public key
  → Verify proof signature against public key
  → Resolve federation trust chain for issuer:
      → Fetch issuer's entity configuration
      → Walk authority_hints to trust anchor
      → Validate subordinate entity statements at each level
      → Verify trust marks held by issuer
  → Check issuer's trust marks cover the credential's entity:path combinations
  → Check credential is not expired
  → Check credential revocation status:
      → Fetch Bitstring Status List from credentialStatus.statusListCredential (cached, short TTL)
      → Verify status list credential signature
      → Check bit at statusListIndex — if set, credential is revoked
  → Return: { valid: true, trustLevel: "trusted_proxy", trustMarks: ["title-data-provider"], revoked: false }
```

---

## 11. NPTN Integration

NPTN (National Property Transaction Network) is LMS's implementation of PDTF v1 as a data hub. PDTF 2.0 needs to work with NPTN, not replace it.

### 11.1 Strategy

- NPTN continues as the transaction orchestration layer (the "road")
- PDTF 2.0 VCs flow through NPTN as the data format
- NPTN validates VCs using the reference validator (which now includes federation trust chain resolution)
- Credential exchange between NPTN and participants uses **OID4VP** — participants present credentials to prove their relationship, and NPTN presents credentials to participants
- NPTN's existing claim filtering (confidentiality, role-based) maps to VC `termsOfUse`
- NPTN can act as a federation intermediate entity, with trust marks authorising it to relay credentials
- LMS documentation (spec 10) explains the architecture in terms they can implement

### 11.2 LMS Documentation Plan

Comprehensive guide covering:
- Why VCs and OpenID Federation (business case, not just technical)
- How NPTN handles VCs (receive via OID4VCI, validate, store, present via OID4VP, filter, serve)
- Migration path from current verified claims to VCs
- Reference validator and federation client integration
- Timeline aligned with NPTN roadmap

---

## 12. API Design & Access Model

### 12.1 Security Profile: FAPI 2.0

PDTF 2.0 adopts **FAPI 2.0 (Financial-grade API Security Profile)** as its high-assurance security layer. Property transactions involve sensitive personal and financial data — the same security guarantees required in open banking apply here.

FAPI 2.0 provides:
- **Sender-constrained tokens** (DPoP or mTLS) — tokens are bound to the client that requested them, preventing token theft/replay
- **PAR (Pushed Authorization Requests)** — authorization parameters are sent directly to the server, not via browser redirect
- **JARM (JWT-Secured Authorization Response Mode)** — authorization responses are signed, preventing response injection
- **PKCE** — mandatory for all authorization code flows

This is not "FAPI for transport only" — FAPI 2.0 is the security profile for all API interactions, including OID4VCI credential requests and OID4VP presentation flows.

### 12.2 Unified API: MCP + OpenAPI

The core PDTF API is **MCP-compliant** (Model Context Protocol). Every transaction is a discoverable, agent-accessible resource via the transaction DID document's service endpoints. The same underlying operations are exposed through both:

- **MCP binding** — tools, resources, and prompts for AI agents. An agent can authenticate, browse transactions, fetch and verify credentials, compose state, and run diligence queries through MCP tool calls.
- **OpenAPI binding** — conventional REST endpoints with typed schemas for traditional integrators building web applications, mobile apps, and backend services.

Both bindings share the same service layer, authentication model (FAPI 2.0), and credential access rules. The MCP binding is not a wrapper around the REST API — they are peer interfaces to the same operations.

**Core operations (both bindings):**

| Operation | Description |
|-----------|-------------|
| `resolveTransaction(did)` | Resolve a transaction DID → DID document, service endpoints, federation metadata |
| `fetchCredentials(identifier, options)` | Fetch VCs by entity identifier (UPRN, title number, transaction DID) with optional type/path filtering |
| `composeState(transactionDid, options)` | Traverse the full entity graph from a transaction DID, collect all VCs, compose state with dependency pruning. Options: v3/v4 format, include provenance |
| `verifyCredential(vc)` | Verify a single VC: signature check, federation trust chain resolution, revocation status |
| `issueCredential(type, subject, data)` | Issue a new VC via OID4VCI (adapter/platform only) |
| `revokeCredential(id)` | Revoke a VC by flipping its status bit (issuer only) |
| `listParticipants(transactionDid)` | List ownership, representation, and consent credentials for a transaction |
| `submitOffer(transactionDid, offer)` | Submit a buyer offer |
| `presentCredentials(presentationDefinition)` | OID4VP credential presentation |

**AI agent skill layer:** PDTF publishes agent skills (tool definitions + usage documentation) that allow AI agents to:
- Build interface code against the API (code generation from the skill)
- Directly operate on transactions (fetch VCs, compose state, run diligence) via MCP tool calls
- Authenticate and prove participation via OID4VP without manual credential management

### 12.3 Authentication via OID4VP

Access to transaction data requires proof that the requester is a participant. Authentication uses OID4VP:

#### Phase 1: Account Provider Delegation (Custodial)

In Phase 1, the account provider (LMS, Moverly) holds the user's private key in KMS. Authentication works via OAuth + OID4VP:

1. **Agent/client authenticates** via FAPI 2.0 flow with the account provider
2. **Account provider verifies** the user's identity and maps to their `did:key`
3. **Account provider constructs a Verifiable Presentation (VP)** on behalf of the user using their KMS-held key — the VP contains the user's participation credential(s)
4. **PDTF service verifies** the VP via OID4VP, confirms participation credential validity and federation trust chain, grants access

```
Agent → FAPI 2.0 → Account Provider → KMS Sign VP → Agent → OID4VP → PDTF Service → Verify → Access
```

#### Phase 2: Direct Wallet Auth

When users hold their own keys (wallet binding), standard OID4VP flow:

1. **PDTF service sends presentation request** with a presentation definition specifying required credential types
2. **User's wallet constructs VP** containing the requested credentials, signed with the wallet key
3. **PDTF service verifies** the VP signature, credential validity, federation trust chain, and revocation status

In both phases, the participation credential is the authorization — no separate role-check needed.

### 12.4 Platform-to-Platform Sync & VC Encryption

> **Phase 1 note:** Envelope encryption is the target architecture for multi-platform sync. In Phase 1, where Moverly is the sole platform, VC encryption is not implemented — data access is controlled through platform-level authentication and `termsOfUse` filtering. The encryption model described here will be specified in detail in Sub-spec 12 when multi-platform sync is introduced.

Platforms (LMS systems, conveyancer software, orchestrators) need to sync VC collections to ensure all participants have the latest data. The challenge: GDPR exposure. A platform shouldn't hold decryptable personal data for transactions it's not a participant in.

**Solution: Envelope encryption on credential content.**

#### Encryption Model

PDTF uses **ECDH-ES+A256KW** (Elliptic Curve Diffie-Hellman Ephemeral Static + AES-256 Key Wrap) with **X25519** key agreement, complementing the Ed25519 signing keys already in the architecture:

1. **Every DID document includes a `keyAgreement` verification method** — an X25519 public key derived from (or alongside) the Ed25519 signing key
2. **Credential content is encrypted** with a random AES-256-GCM content encryption key (CEK)
3. **The CEK is wrapped (encrypted) per-recipient** — one wrapped key per participant DID that has access rights (based on `termsOfUse` role restrictions)
4. **The encrypted VC is a JWE (JSON Web Encryption)** envelope containing: encrypted payload + per-recipient wrapped keys + metadata

```json
{
  "protected": { "alg": "ECDH-ES+A256KW", "enc": "A256GCM" },
  "recipients": [
    { "header": { "kid": "did:key:z6Mk...#key-agreement" }, "encrypted_key": "..." },
    { "header": { "kid": "did:web:smithandjones.co.uk#key-agreement" }, "encrypted_key": "..." },
    { "header": { "kid": "did:web:moverly.com#key-agreement" }, "encrypted_key": "..." }
  ],
  "iv": "...",
  "ciphertext": "...",
  "tag": "..."
}
```

#### Sync Model

With envelope encryption, platforms can sync freely:

- **Replicate all encrypted VCs** for a transaction — they're opaque blobs to non-participants
- **Only participants with a wrapped key can decrypt** — decryption requires the X25519 private key matching one of the `recipients`
- **A platform that can't decrypt is not a data controller** for that content under GDPR
- **Revocation status is still public** (Bitstring Status Lists are unsigned data) — platforms can check revocation without decrypting content
- **VC signatures remain valid inside the encryption envelope** — decrypt first, then verify the inner VC proof

#### Recipient Management

When a new participant joins a transaction (e.g. buyer's conveyancer appointed):

1. New Representation credential is issued via OID4VCI
2. Existing encrypted VCs are **re-wrapped** — the CEK for each VC is wrapped with the new participant's X25519 public key and added to the `recipients` array
3. No re-encryption of the content needed — only the key wrapping changes

When a participant is removed or a credential is revoked:

1. The revoked participant's wrapped key entry is removed
2. Optionally, re-key: generate new CEK, re-encrypt content, wrap for remaining participants (provides forward secrecy)

#### Confidentiality Tiers

Not all VCs need encryption. The encryption model follows the existing `termsOfUse` confidentiality levels:

| Confidentiality | Encryption | Rationale |
|----------------|------------|-----------|
| `public` | None — plaintext VC | Public register data, EPC ratings |
| `transactionParticipants` | Encrypted, all participant DIDs as recipients | Most property data |
| `roleRestricted` | Encrypted, only matching-role DIDs as recipients | Financial data, personal details |
| `partyOnly` | Encrypted, only the data subject's DID as recipient | Identity verification details |

### 12.5 Key Agreement Key Derivation

X25519 key agreement keys are derived alongside Ed25519 signing keys:

- **`did:key` (Persons, managed Organisations):** The Ed25519 private key is converted to an X25519 private key using the birational map (RFC 7748 §6.1). The `did:key` document implicitly includes both verification and key agreement methods.
- **`did:web` (self-hosting Organisations, Transactions):** The DID document explicitly lists both an `Ed25519VerificationKey2020` (for signing) and an `X25519KeyAgreementKey2020` (for encryption) in `verificationMethod`, with the latter referenced from `keyAgreement`.

*(Full spec: `papers/pdtf-v2/11-api-design.md` — TODO, `papers/pdtf-v2/12-adapter-access-control.md` — TODO)*

### 12.6 Environment Separation

PDTF 2.0 uses `did:web` domains as the structural trust boundary between environments. A credential signed in staging is cryptographically untrusted in production because the issuer DID resolves to a different domain — no configuration flags or environment variables control this; it is an intrinsic property of the identifier.

#### Three-tier model

| Tier | Identity Model | Key Storage | Trust Source | DID Document Hosting |
|------|---------------|-------------|--------------|---------------------|
| **Local dev** | `did:key` only | In-memory | Local JSON file | None (no did:web resolution needed) |
| **Staging** | `did:web:*.staging.propdata.org.uk` | Firestore | Staging federation metadata | GCS staging bucket |
| **Production** | `did:web:*.propdata.org.uk` | Cloud KMS (HSM-backed) | Production federation trust anchor | GCS prod bucket + CDN |

#### Domain conventions

```
Production:    did:web:adapters.propdata.org.uk:{adapter}
Staging:       did:web:adapters.staging.propdata.org.uk:{adapter}

Production:    did:web:transactions.propdata.org.uk:txn:{id}
Staging:       did:web:transactions.staging.propdata.org.uk:txn:{id}

Production:    did:web:auth.moverly.com
Staging:       did:web:auth.staging.moverly.com

Federation:
Production:    https://propdata.org.uk/.well-known/openid-federation
Staging:       https://staging.propdata.org.uk/.well-known/openid-federation
```

#### What differs per environment

- **Adapter DIDs** — different domain, different key pairs, different DID documents
- **Transaction DIDs** — different domain prefix, separate GCS bucket / CDN
- **Account provider DID** — different auth domain
- **Federation trust anchor** — separate trust anchor with separate signing key
- **Trust marks** — issued by environment-specific trust anchor
- **Status lists** — separate hosting domain (`status.staging.propdata.org.uk`)
- **Key material** — staging uses Firestore for convenience; production uses Cloud KMS with audit logging

#### What stays the same

- **Application code** — `@pdtf/core`, adapters, CLI tooling are environment-agnostic. The environment is determined entirely by configuration: which domain, which `KeyProvider` implementation, which federation trust anchor URL.
- **Schemas** — entity graph structure, VC data model, and JSON Schema definitions are identical across all tiers.
- **Trust mark definitions** — the trust mark IDs and their semantics are the same; only the issuer differs.

#### Cross-contamination protection

Because `did:web` encodes the domain into the identifier itself, a staging credential presented to a production verifier will fail federation trust chain resolution — the issuer's entity configuration points to the staging trust anchor, not the production one. This is not a policy check; it is a structural impossibility. No "wrong environment" bug can cause staging data to be trusted in production unless someone manually copies keys, federation metadata, and trust marks between environments.

#### Local development

For local development and unit testing, `did:key` eliminates all infrastructure dependencies. The `MemoryKeyProvider` generates ephemeral keys, the `VcValidator` resolves `did:key` DIDs locally without network access, and an in-memory mock federation (Entity Statements + Trust Marks signed by a dev-only Trust Anchor key) replaces the live `trust.pdtf.org` endpoints. This means a developer can sign, verify, and compose credentials on a laptop with zero cloud access.

---

## 13. Sub-Specs Index

| # | Document | Status | Description |
|---|----------|--------|-------------|
| 00 | `00-architecture-overview.md` | **This document** | Master reference |
| 01 | `01-entity-graph.md` | DRAFTED | V4 schema decomposition, ID-keyed collections, entity relationships |
| 02 | `02-vc-data-model.md` | DRAFTED | W3C VC mapping, evidence model, termsOfUse, claims representation |
| 03 | `03-did-methods.md` | DRAFTED | did:key, did:web, URN schemes, DID document structure |
| 04 | [`04-openid-federation.md`](/web/specs/04-openid-federation/) | Drafted | OpenID Federation trust architecture: Trust Anchor, Entity Statements, Trust Marks, entity:path `delegation` claim. |
| 05 | `05-hosted-adapter-services.md` | TODO | Adapter architecture as OID4VCI issuers, federation leaf entities, issuance flow, deployment |
| 06 | `06-key-management.md` | DRAFTED | Google Cloud KMS, key hierarchy, rotation, wallet binding, federation key handling. X25519 encryption key management deferred to Sub-spec 12. |
| 07 | `07-state-assembly.md` | DRAFTED | composeV3/V4StateFromGraph, dependency pruning, migration |
| 08 | `08-diligence-engine-migration.md` | TODO | entity:path mapping, pdtfPaths.js evolution |
| 09 | `09-nptn-integration.md` | TODO | OID4VP credential exchange through NPTN, LMS migration guide |
| 10 | `10-lms-documentation.md` | TODO | Architecture guide for LMS stakeholders |
| 11 | `11-api-design.md` | TODO | FAPI 2.0 security profile, MCP + OpenAPI interface, OID4VCI/OID4VP flows, AI agent skills |
| 12 | `12-access-control-and-encryption.md` | TODO | OID4VP authentication, VP presentation, VC envelope encryption *(Phase 2+)*, platform sync |
| 13 | `13-reference-implementations.md` | DRAFTED | VC validator, federation client, graph composer, DID resolver specs |
| 14 | `14-credential-revocation.md` | DRAFTED | Bitstring Status List hosting, revocation flows, cache strategy |
| 15 | `15-conformance-testing.md` | DRAFTED | Conformance levels, test vectors, interop protocols |

---

## 14. Decisions Log

All architectural decisions made through v0.3 of this document are baked into the spec text above. The decision log below tracks the consensus questions identified for industry review.

### 14.1 Resolved consensus decisions

| # | Question | Decision | Date |
|---|----------|----------|------|
| Q1.2 | Credential granularity for seller attestations | PDTF does not prescribe granularity. Issuers choose what subtree to assert per credential. This tradeoff absorbs into Q1.1 — see resolution note there. | Apr 2026 |
| Q1.3 | Multi-credential merge conflicts | PDTF does not prescribe conflict resolution logic. The state assembly library provides a simple timestamp-ordered merge as a convenience; verifiers apply their own business logic (trust level weighting, recency, source preference) on top. All underlying credentials remain available for inspection. | Apr 2026 |
| Q2.2 | Trust-level conflict visibility | Conflict surfacing is a verifier/UI concern, not a spec requirement. All trust levels and sources are carried in the credentials themselves, so consumers can render them however they wish. | Apr 2026 |
| Q3.3 | Credential `id` required | Yes — every credential MUST include an `id` for deduplication during state assembly. Privacy implications of credential correlation are secondary to assembly determinism. Format: `urn:pdtf:vc:{uuid}`. | Apr 2026 |
| Q4.1 | Organisation DID hosting for small firms | Both self-hosted `did:web` and orchestrator-hosted DIDs are supported. In Phase 1 and beyond, small firms are expected to use orchestrator-hosted identities — orchestrators provide the account and auth UX firms already rely on, and manage DIDs on their behalf. | Apr 2026 |
| Q4.2 | Lender access pattern | Lenders access transaction data via DelegatedConsentCredential (see sub-spec 02 §3.6). The buyer explicitly grants consent to a specific lender's Organisation DID per application. This composes with `termsOfUse.confidentiality: "restricted"` — restricted data requires either direct participation (SellerCapacity / Representation / Offer) or an explicit DelegatedConsentCredential. No role-based lender pooling. | Apr 2026 |
| Q5.2 | Multiple issuers per path | Permitted and expected. Multiple commercial search providers, valuation services, and similar will legitimately issue credentials against the same entity:path combinations. Trust marks do not enforce exclusivity. | Apr 2026 |
| Q6.1–Q6.3 | Migration strategy | Migration proceeds by running PDTF v1 and v2 operations in parallel. New transactions start on v2; in-flight transactions continue on v1 until they close. When all active transactions support v2 output, v1 is retired. State assembly supports both formats throughout the overlap. | Apr 2026 |

### 14.2 Open consensus questions

| # | Question | Spec Ref | Decision | Date |
|---|----------|----------|----------|------|
| Q1.1 | Claims merge strategy: REPLACE vs MERGE vs hybrid. | 02 §5, 07 §4 | Issuer-driven credential granularity cannot be mandated (see Q1.2 resolution), which weakens the REPLACE case: REPLACE requires issuers to understand path boundaries precisely. MERGE with schema-driven pruning is simpler for issuers but requires the assembler to understand dependencies. Tradeoff still open for industry consensus. | |
| Q2.1 | Multi-property transactions: how do overlays, form mappings, and v3 `propertyPack` (singular) handle multiple properties? | 01 §9.1, 07 §12.1 | | |

### 14.2.1 Theme 7: Entity Model Boundaries

Decomposing the v1 monolithic property pack schema into entity-scoped schemas raises design questions that weren't captured in the original themes. The Entity Graph (sub-spec 01) defines the entities and their relationships, but the exact field-level seams between them require validation. This theme collects those decisions.

| # | Question | Preferred direction | Status |
|---|----------|---------------------|--------|
| Q7.1 | Where does the schema-level `ownership` object decompose to? | Top-level properties of v1 `ownership` (numberOfSellers, outstandingMortgage, existingLender, helpToBuyEquityLoan, limitedCompanySale, etc.) move to `Transaction.saleContext.*`. The legal interest being transferred (formerly `ownershipsToBeTransferred[]`) moves to the top level of the `Title` entity, because a `TitleCredential` fundamentally represents an ownership interest being conveyed. Supporting register evidence (register extract, charges) moves under a `title` sub-object on the `Title` entity. Note: this is the schema decomposition question — distinct from the entity-graph-level SellerCapacity credential (the thin Person↔Title assertion, see sub-spec 02 §3.4), which is unchanged. | Preferred |
| Q7.2 | Identifier for unregistered titles | `urn:pdtf:unregisteredTitle:{uuid}` per sub-spec 03 §10.1, but UUID derivation method (v4 random vs v5 deterministic from UPRN) and first-registration transition mechanism still open. This is a hard dependency for Q7.1 — `Title.ownershipToBeTransferred` applies to registered and unregistered titles equally, so the identifier question blocks finalisation. | Open |
| Q7.3 | Field-level seams between Property and Title | The boundary between physical property facts (EPC, flood, construction) and legal title facts (charges, proprietorship, lease terms) is clear in principle, but edge cases exist (e.g., boundary disputes, rights of way). Validate on a field-by-field basis during schema review. | Open |

---

## 15. Implementation Priority

Reordered to reflect the OpenID ecosystem alignment:

1. **Entity graph spec** (01) — formalise v4 schemas, build on existing branch work
2. **VC data model** (02) — define the credential format, evidence, termsOfUse
3. **OpenID Federation** (04) — Trust Anchor, Entity Statements, Trust Marks, entity:path `delegation` authorisation
4. **DID methods** (03) — key generation, DID document hosting, federation entity configuration
5. **Key management** (06) — Google Cloud KMS setup, federation key handling
6. **One adapter PoC** (05) — EPC adapter as OID4VCI credential issuer with federation entity configuration
7. **State assembly** (07) — composeV3StateFromGraph with validation against existing output
8. **Reference implementations** (13) — VC validator with federation trust chain resolution, federation client
9. **API design** (11) — FAPI 2.0 security profile, OID4VCI/OID4VP endpoints, MCP binding
10. **Access control** (12) — OID4VP participation credential verification
11. **DE migration** (08) — entity:path mapping
12. **NPTN integration** (09) — OID4VP credential exchange design for LMS
13. **LMS documentation** (10) — stakeholder guide

---


