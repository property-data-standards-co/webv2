---
title: "00 Architecture Overview"
description: "PDTF 2.0 specification document."
---


**Version:** 0.8 (Draft)
**Date:** 9 April 2026
**Author:** Ed Molyneux / Moverly

---

## 1. Executive Summary

PDTF 2.0 replaces the OpenID Connect verified claims model with W3C Verifiable Credentials, decomposes the monolithic schema into an entity graph, and introduces decentralised identifiers and cryptographic signing. The result is a framework where property data is independently verifiable, portable between systems, and machine-readable by any agent or platform — without needing to trust the intermediary serving it.

This document is the master reference for the PDTF 2.0 implementation. It links to sub-specs for each workstream and captures architectural decisions as they're made.

---

## 2. What Changes from v1

| Aspect | PDTF v1 (Current) | PDTF 2.0 |
|--------|-------------------|-----------|
| **Data model** | Monolithic `pdtf-transaction.json` (~4,000 paths) | Entity graph: Transaction, Property, Title, Person, Organisation, Ownership, Representation, DelegatedConsent, Offer |
| **Claims** | OpenID Connect verified claims with pathKey:value REPLACE semantics | W3C Verifiable Credentials with sparse objects. Merge strategy (REPLACE vs incremental MERGE vs hybrid) pending consensus — see Q1.1 |
| **Identity** | Firebase Auth UIDs, no universal identifiers | DIDs: `did:key` (persons, managed orgs), `did:web` (self-hosting orgs, transactions, adapters) |
| **Entity identifiers** | Internal Firestore document IDs | URNs: `urn:pdtf:titleNumber:{value}`, `urn:pdtf:uprn:{value}` |
| **Verification** | Trust the platform serving the data | Cryptographic proof — verify the signature, not the intermediary |
| **Provenance** | OIDC-derived evidence schema (deeply nested) | Simpler evidence model reflecting actual usage patterns |
| **Access control** | Platform-enforced role checks | Per-credential `termsOfUse` (confidentiality + role restrictions) + participation credential presentation |
| **Interoperability** | REST API, platform-specific | Unified MCP + OpenAPI interface, DID documents with service endpoints, AI agent skills |
| **Data sync** | Platform-to-platform API calls | Encrypted VC replication — GDPR-safe sync with per-recipient envelope encryption *(target architecture; Phase 1 uses platform-level access control)* |
| **Trust** | Single platform trust | Federated trust via Trusted Issuer Registry |

---

## 3. Entity Graph

### 3.1 Core Entities

| Entity | Identifier | Schema | Description |
|--------|-----------|--------|-------------|
| **Transaction** | `did:web` | `v4/Transaction.json` | Metadata, status, dates, financial info. References Property and Titles. DID document hosts service endpoints. |
| **Property** | `urn:pdtf:uprn:{uprn}` | `v4/Property.json` | Physical property: address, build info, features, energy, environmental, legal questions. All "property pack" data lives here. |
| **Title** | `urn:pdtf:titleNumber:{number}` | `v4/Title.json` | Legal ownership: title number, extents (geoJSON), register extract, ownership type (freehold/leasehold), leasehold info. |
| **Person** | `did:key` | `v4/Person.json` | Individual: name, contact, address, verification status. Role-free — role is contextual via Ownership, Representation, or Offer. |
| **Organisation** | `did:key` or `did:web` | `v4/Organisation.json` | Firm or company: conveyancer firm, estate agency, lender. Uses `did:key` when managed by an account provider (e.g. LMS) or `did:web` when self-hosting identity. |
| **Ownership** | URN (generated) | `v4/Ownership.json` | Self-asserted claim of legal ownership linking a Person/Organisation DID to a Title URN. Starts as the owner's own assertion; verified against Title.registerExtract.proprietorship (claim-vs-evidence separation). The ownership claim establishes the right to sell. Revocable. |
| **Representation** | URN (generated) | `v4/Representation.json` | Delegated authority to act on behalf of a seller or buyer. Typically issued to an Organisation (the firm), but supports Person holders too. Revocable. |
| **DelegatedConsent** | URN (generated) | `v4/DelegatedConsent.json` | Authorised data access for entities like lenders. Part of terms of use for specific authorised entities (Q4.2 resolved via DelegatedConsentCredential). |
| **Offer** | URN (generated) | `v4/Offer.json` (TBD) | Links buyer Person(s) or Organisation(s) to Transaction. Buyers participate only through Offers. Contains offer details, status, conditions. |
| **Mortgage** | URN (generated) | Future | Tied to Offer/buyer. Flagged for growth — not in initial implementation. |

### 3.2 Entity Relationship Diagram

![PDTF 2.0 Entity Relationship Model](/web/diagrams/entity-graph.png)

### 3.3 Relationship Model

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
    ├── Ownership[] ──→ Person/Organisation ──→ Title
    │     └── Self-asserted claim of legal ownership, linking
    │         a Person/Organisation DID to a Title URN.
    │         Verified against Title.registerExtract.proprietorship.
    │         The ownership claim is what gives the holder the
    │         right to sell — the Transaction's Titles are "for sale"
    │         because someone with an Ownership credential says so.
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
- **Ownership** — self-asserted claim of legal ownership, linking a Person or Organisation DID to a Title URN. The owner starts by asserting their own ownership; the platform then seeks to verify this against Title.registerExtract.proprietorship (claim-vs-evidence separation). The ownership claim is what establishes the right to sell: a Transaction's referenced Titles are "for sale" because the legal owner — who holds the Ownership credential — is offering them for sale.
- **Representation** — delegated authority to act on someone's behalf. Typically issued to an Organisation (the conveyancer firm, not the individual solicitor), because the professional duty and insurance liability sits with the firm. But the credential model supports both Person and Organisation holders — companies can also represent other companies.
- **DelegatedConsent** — authorised access for entities like lenders, as part of terms of use (Q4.2 resolved via DelegatedConsentCredential). General consent mechanism for entities that aren't direct participants but have legitimate data access needs.

**Person vs Organisation:** Both can own, sell, buy, represent, and consent. The difference is structural, not role-based: an Organisation has a Companies House identity, SRA registration, and PI insurance — attributes that don't belong on a Person entity. Both get relationship credentials; both can be on either side of a transaction.

### 3.3 Key Design Decisions

- **Buyers participate only through Offers** — no Participation entity for buyers. This models the real-world relationship: a buyer doesn't "participate" in the seller's transaction until they make an offer, and multiple offers can exist simultaneously. Buyers can be Persons or Organisations (companies buy property too).
- **Ownership establishes the right to sell** — the legal owner self-asserts ownership by issuing an Ownership credential linking their DID to a Title URN. This is what puts a title "for sale" in a transaction. The platform then verifies the claim against the proprietorship register. No separate "listing" entity is needed — the Ownership credential IS the assertion of the right to dispose of the title.
- **ID-keyed collections** — v4 moves from arrays (participants[], searches[]) to ID-keyed maps (like current offers). Breaking change to schema structure but not to the underlying data — path handling code updates required.
- **Property-level VCs** — EPC, flood risk, searches etc. are Property VCs with paths like `/energyEfficiency/certificate`, not first-class entity VCs. Primary issuers will use the same paths when they adopt the standard.

### 3.4 Entity Separation Principle — The Logbook Test

The governing question for field assignment: **"Does this fact travel with the property to a new owner?"**

- **Property** = enduring facts (the "logbook"): EPC, flood risk, build info, legal questions, fixtures & fittings, environmental data. If a new buyer inherits it, it's a Property fact.
- **Title** = legal title facts: title number, extents (geoJSON), register extract (including proprietorship as evidence), ownership type (freehold/leasehold), leasehold terms and restrictions, isFirstRegistration, mortgage/charge information. The existing branch 263 work already merges `ownershipsToBeTransferred` into the Title entity.
- **Transaction** = this-sale facts: numberOfSellers, numberOfNonUkResidentSellers, outstandingMortgage, existingLender, hasHelpToBuyEquityLoan, isLimitedCompanySale. None of these pass the logbook test — they describe this specific transaction, not the property itself.
- **Ownership** = self-asserted claim of legal ownership linking a Person or Organisation DID to a Title URN, with status and verification level. The owner starts by asserting this themselves — their ownership claim is what establishes the right to sell. The evidence (proprietorship register) lives on the Title entity — Ownership is the claim, Title holds the evidence.

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

Each piece of property data becomes a signed Verifiable Credential:

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

### 4.2 Migration from Verified Claims

| Current (OIDC verified claims) | PDTF 2.0 (W3C VC) |
|-------------------------------|-------------------|
| `claimPath` + `claimValue` (REPLACE semantics) | `credentialSubject` with sparse object (MERGE + prune) |
| `verification.trust_framework` | `issuer` DID + Trusted Issuer Registry lookup |
| `verification.evidence[].type` (vouch, electronic_record, etc.) | `evidence[].type` (simplified, fewer nesting levels) |
| `verification.evidence[].document` (OIDC document_details) | `evidence[].source`, `evidence[].retrievedAt`, `evidence[].method` |
| `terms_of_use` (confidentiality, pii, roleRestrictions) | `termsOfUse[]` with same semantics, cleaner structure |
| No revocation mechanism | `credentialStatus` with Bitstring Status List for revocation |
| No cryptographic verification | `proof` with digital signature |

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

PDTF 2.0 uses **Data Integrity proofs** (`eddsa-jcs-2022`) rather than **JWS** (RFC 7515) / **VC-JWT**. Both are valid securing mechanisms for W3C VCs. The choice has meaningful consequences.

| | Data Integrity (PDTF choice) | JWS / VC-JWT |
|---|---|---|
| Proof location | `proof` object embedded in the VC JSON | Detached JWS or entire VC wrapped as a JWT (header.payload.signature) |
| Canonicalisation | JCS (JSON Canonicalization Scheme, RFC 8785) | None needed — signs raw bytes |
| Human readability | VC is plain JSON, directly inspectable | VC-JWT requires base64 decoding before any claims are visible |
| Selective disclosure path | Foundation for BBS+ and JSON-LD ZKP mechanisms | Requires SD-JWT (separate spec) |
| W3C VC 2.0 positioning | Primary securing mechanism | Supported but positioned as legacy |
| Ecosystem fit | Emerging VC/DID ecosystem | Mature OIDC/OAuth ecosystem |
| Key algorithm | Ed25519 (via `eddsa-jcs-2022` cryptosuite) | Algorithm-agnostic (RS256, ES256, EdDSA, etc.) |

**Rationale for Data Integrity:**

1. **JSON-native.** PDTF VCs stay as parseable JSON throughout their lifecycle. Consumers, debuggers, and AI agents can read claims without decoding. VC-JWT produces opaque base64 blobs that must be unpacked before inspection.

2. **Selective disclosure upgrade path.** Data Integrity is the foundation for BBS+ signatures, enabling future scenarios like "share the EPC rating but not the address" without re-issuance. JWS has no equivalent path — SD-JWT is a separate, less mature specification.

3. **W3C alignment.** The VC Data Model v2.0 editors have positioned Data Integrity as the primary path forward. Choosing it keeps PDTF aligned with the spec's direction of travel.

4. **Deterministic serialisation.** JCS provides a canonical JSON form regardless of whitespace or key ordering. VC-JWT avoids this by signing raw bytes, but that makes the exact byte representation significant — fragile when VCs move between systems that may re-serialise.

**Where JWS remains relevant to PDTF:**

- **Transport layer.** OAuth-based auth flows, VP tokens in OIDC4VP presentations, and DID Auth challenges may use JWS/JWT as the *transport envelope* while the credentials inside remain Data Integrity VCs.
- **Interoperability bridges.** Systems with existing JWT infrastructure (common in LMS and lender platforms) may prefer a VC-JWT view. A bridge that re-wraps a Data Integrity VC as a VC-JWT is mechanically straightforward.
- **Status list credentials.** The Bitstring Status List spec permits either securing mechanism. PDTF uses Data Integrity for consistency, but JWS would technically work.

---

## 5. Identifiers & Discovery

### 5.1 DID Methods

| Entity             | DID Method           | Example                                           | Resolution                                                                                     |
|--------------------|----------------------|---------------------------------------------------|------------------------------------------------------------------------------------------------|
| Persons            | `did:key`            | `did:key:z6Mkh...abc`                             | Self-resolving from public key, no hosting needed                                              |
| Organisations      | `did:key` or `did:web` | `did:key:z6Mkf...xyz` or `did:web:smithandjones.co.uk` | `did:key` when managed by account provider (e.g. LMS); `did:web` when self-hosting identity |
| Transactions       | `did:web`            | `did:web:moverly.com:transactions:abc123`         | Hosted DID document at `https://moverly.com/transactions/abc123/did.json`                      |
| Trusted Adapters   | `did:web`            | `did:web:adapters.propdata.org.uk:hmlr`           | Hosted DID document with service endpoints for VC requests                                     |

### 5.2 URN Scheme

```
urn:pdtf:uprn:{uprn}           → Property identifier
urn:pdtf:titleNumber:{number}  → Title identifier
urn:pdtf:ownership:{uuid}      → Ownership claim
urn:pdtf:representation:{uuid} → Representation mandate (Organisation)
urn:pdtf:consent:{uuid}        → Delegated consent
urn:pdtf:offer:{uuid}          → Offer relationship
```

### 5.3 Transaction DID Documents

A transaction's DID document serves as the discovery and API endpoint:

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:web:moverly.com:transactions:abc123",
  "verificationMethod": [{
    "id": "did:web:moverly.com:transactions:abc123#key-1",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:web:moverly.com:transactions:abc123",
    "publicKeyMultibase": "z6Mkh..."
  }],
  "service": [{
    "id": "#pdtf-api",
    "type": "PdtfTransactionEndpoint",
    "serviceEndpoint": "https://api.moverly.com/v2/transactions/abc123"
  }, {
    "id": "#mcp",
    "type": "McpEndpoint",
    "serviceEndpoint": "https://api.moverly.com/mcpService/mcp"
  }]
}
```

### 5.4 Access Control

To access restricted or confidential VCs (or the pre-composed state derived from them), a requester must:

1. **Present a valid credential** — an Ownership, Representation, or DelegatedConsent credential proving their relationship to the transaction
2. **Prove control of their DID** — cryptographic challenge-response proving they hold the private key for the DID in the credential
3. **Revocation check** — the presented credential must not be revoked (Bitstring Status List check)
4. **termsOfUse filtering** — the system returns only VCs whose `termsOfUse` policy permits access for the requester's role

Public VCs (title deeds, EPCs, searches) require no authentication.

---

## 6. Trust Architecture

### 6.1 Federated Trust (Model C/D hybrid)

```
                    ┌──────────────────────┐
                    │  Trusted Issuer       │
                    │  Registry (GitHub)    │
                    │  ─────────────────    │
                    │  rootIssuers:         │
                    │    HMLR, VoA, etc.    │
                    │  trustedProxies:      │
                    │    moverly, tmGroup   │
                    └──────────┬───────────┘
                               │ lookup
                    ┌──────────▼───────────┐
                    │  Verifier            │
                    │  (any participant's   │
                    │   agent/software)     │
                    └──────────┬───────────┘
                               │ verify signature
                    ┌──────────▼───────────┐
                    │  Issuer's DID        │
                    │  (did:web or did:key) │
                    │  → public key        │
                    └──────────────────────┘
```

### 6.2 Trusted Issuer Registry (TIR)

GitHub-based, AI agent-managed, no UI. Lives at `property-data-standards-co/trusted-issuer-registry`.

**Key design:** TIR entries describe **entity:path combinations**, not just issuers. An entry authorises a specific issuer DID for specific data paths on specific entity types:

```json
{
  "version": "1.0",
  "updated": "2026-03-23T07:00:00Z",
  "issuers": {
    "hmlr": {
      "name": "HM Land Registry",
      "did": "did:web:hmlr.gov.uk",
      "authorisedPaths": [
        "Title:/titleNumber",
        "Title:/titleExtents",
        "Title:/registerExtract",
        "Title:/ownership/*"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned"
    },
    "mhclg-epc": {
      "name": "Ministry of Housing — EPC Register",
      "did": "did:web:epc.communities.gov.uk",
      "authorisedPaths": [
        "Property:/energyEfficiency/certificate"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned"
    },
    "voa": {
      "name": "Valuation Office Agency",
      "did": "did:web:voa.gov.uk",
      "authorisedPaths": [
        "Property:/councilTax/*"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned"
    },
    "moverly-hmlr": {
      "name": "Moverly (HMLR Proxy)",
      "did": "did:web:adapters.propdata.org.uk:hmlr",
      "authorisedPaths": [
        "Title:/titleNumber",
        "Title:/titleExtents",
        "Title:/registerExtract",
        "Title:/ownership/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "hmlr",
      "status": "active"
    },
    "moverly-epc": {
      "name": "Moverly (EPC Proxy)",
      "did": "did:web:adapters.propdata.org.uk:epc",
      "authorisedPaths": [
        "Property:/energyEfficiency/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "mhclg-epc",
      "status": "active"
    },
    "moverly-ea": {
      "name": "Moverly (Environment Agency Proxy)",
      "did": "did:web:adapters.propdata.org.uk:ea-flood",
      "authorisedPaths": [
        "Property:/environmentalIssues/flooding/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "environment-agency",
      "status": "active"
    }
  },
  "userAccountProviders": {
    "moverly": {
      "name": "Moverly",
      "did": "did:web:moverly.com",
      "description": "Issues user DIDs (did:key) as account provider. Validates user identity at onboarding.",
      "trustLevel": "accountProvider",
      "status": "active"
    }
  }
}
```

### 6.3 User DID Issuers in the TIR

Issuers of user DIDs (the `did:key` identities for sellers, buyers, conveyancers etc.) **must also be listed in the TIR**. When verifying an Ownership or Representation credential, the verifier needs to confirm that the person's DID was issued by a recognised account provider. These are categorised as `userAccountProviders` in the TIR — currently Moverly, but extensible to any onboarding platform (e.g. a digital ID wallet provider, an LMS user portal).

### 6.4 Trust Infrastructure Comparison: TIR vs OpenID Federation vs EBSI

The PDTF Trusted Issuer Registry is one of several approaches to the problem of "who is authorised to issue which credentials?". The two major alternatives are **OpenID Federation** and **EBSI's Root-TAO/TAO hierarchy**.

| | PDTF TIR (current) | OpenID Federation | EBSI Root-TAO / TAO |
|---|---|---|---|
| Trust anchor | GitHub-hosted registry JSON | Trust Anchor Entity Statement | Root TAO (governmental) |
| Authority scope | entity:path combos | metadata_policy on credential types | VerifiableAccreditation VC |
| Discovery | Fetch registry, lookup issuer DID | HTTP `.well-known/openid-federation` chain resolution | DID resolution + on-chain registry |
| Chain depth | Flat (anchor → issuer) | Flexible (n levels) | Fixed 3-tier (Root TAO → TAO → TI) |
| Chain format | Plain JSON | Signed JWTs (Entity Statements) | VCs (accreditations are VCs) |
| Revocation of trust | Remove entry from registry | Expire/withdraw Entity Statement | Revoke the accreditation VC |
| Governance | PR-based, human review | Federated (each anchor sets policy) | Centralised (EU institutional) |
| Infrastructure | Git + HTTPS | HTTPS endpoints | Permissioned blockchain (EBSI ledger) |
| UK ecosystem fit | High (simple, transparent) | High (OIDC-native) | Low (EU-centric, blockchain dependency) |

**Why the flat TIR is right for Phase 1–2:**

- Small issuer count (< 20). A flat registry is the simplest correct solution.
- PR-based governance provides full transparency and audit trail — critical for industry trust-building.
- No infrastructure dependencies beyond Git and HTTPS.

**OpenID Federation as the likely Phase 3 evolution:**

When primary sources (HMLR, local authorities) issue credentials directly, they will not submit PRs to a third-party GitHub repo. OpenID Federation allows each organisation to publish trust metadata at their own endpoints, with verifiers resolving chains back to a shared trust anchor. Key advantages:

- Plugs into existing OAuth/OIDC infrastructure that platforms already operate.
- Flexible chain depth accommodates the lateral trust relationships in property (HMLR does not "accredit" conveyancing firms in a top-down hierarchy).
- Credential-format agnostic — works with Data Integrity VCs.
- Being adopted by the EU Digital Identity Wallet (EUDI) architecture, giving potential future EU interoperability.

**Why not EBSI's model:**

EBSI's Root-TAO/TAO hierarchy is conceptually elegant — trust chains are VCs all the way down. But it carries dependencies that do not fit the UK property ecosystem:

- Requires a permissioned blockchain. The UK government is not investing in this infrastructure for property.
- Fixed three-tier hierarchy assumes governmental top-down accreditation. Property trust relationships are more lateral than hierarchical.
- Schema overhead: every accreditation level needs its own VC type, issuance flow, and revocation mechanism.

**A possible hybrid for Phase 3:** Use VC-based accreditations (like EBSI's model) but resolve them via HTTP discovery (like OpenID Federation) rather than a ledger. The TIR becomes a set of discoverable accreditation VCs hosted at well-known endpoints, rather than a single GitHub JSON file.

**Design implication:** The TIR client API (`isAuthorised(issuerDid, entityPaths)`) is deliberately backend-agnostic. The implementation can evolve from "fetch GitHub JSON" to "resolve OpenID Federation trust chain" without changing the verification interface. This is intentional forward-compatibility.

### 6.5 Three-Phase Evolution

**Phase 1 (now): Moverly Trusted Proxies**
- Moverly's existing collectors become VC-issuing adapters
- Each adapter has its own `did:web` identity and signing key
- "Map-and-wrap": call existing APIs (HMLR OC1, EPC API, EA flood), repackage as signed VCs
- TIR lists these as trusted proxies with specified entity:path combinations
- Moverly is the sole account provider for user DIDs

**Phase 2 (medium-term): Separately Hosted Trusted Adapters**
- Adapters move to independently hosted infrastructure (potentially a JV or open-source project)
- Separate domain (`adapters.propdata.org.uk`) with its own GCP project
- Key material and credentials remain secure regardless of code visibility
- **Open-sourcing adapters is viable** — the signing keys live in Cloud KMS, not in the code. The code is just the API mapping logic.
- Multiple organisations can run adapters (e.g. TM Group, LMS) — each with their own TIR entries

**Phase 3 (future): Primary Source Root Issuers**
- HMLR, MHCLG, Environment Agency issue PDTF-compliant VCs directly
- TIR entries graduate from `trustedProxy` to `rootIssuer`
- Signature verification resolves to the primary source's own DID
- No code changes needed for verifiers — just higher trust level
- Trusted proxy entries for those paths can be deprecated or kept as fallback

---

## 7. Key Management

### 7.1 Architecture

- **Google Cloud KMS** for all key storage
- **Ed25519** key algorithm (most common for `did:key`, fast, small signatures)
- One key per user (generates their `did:key` identity)
- One key per trusted proxy adapter (for signing proxy-issued VCs)
- One key for Moverly platform (for signing user-vouched VCs on behalf of users)

### 7.2 Credential Revocation

All issuers **must** support revocation via [W3C Bitstring Status List v2](https://www.w3.org/TR/vc-bitstring-status-list/). This is critical for:

- **Ownership/Representation credentials** — must be revocable when a sale completes, a mandate is withdrawn, or a conveyancer is replaced. Without revocation, a former seller's conveyancer could still present a valid credential.
- **Property data VCs** — revocable when data is superseded (e.g. new EPC issued, updated flood risk assessment) or found to be incorrect.
- **User DID credentials** — revocable when a user account is disabled or identity verification is invalidated.

**How it works:**
1. Each issuer hosts one or more Bitstring Status List credentials at a public URL
2. Each VC includes a `credentialStatus` field pointing to its entry in the status list
3. The status list is a compressed bitstring — each bit position maps to a credential
4. To revoke: issuer flips the bit at the credential's `statusListIndex`
5. Verifiers fetch the status list (cacheable with short TTL) and check the bit

**Adapter hosting:** Each adapter hosts its own status list endpoints (e.g. `adapters.propdata.org.uk/status/epc/{listId}`). Status lists are signed by the same adapter key used for VC issuance.

### 7.3 Key Hierarchy

```
Google Cloud KMS
├── Adapter Keys (did:web, per-adapter)
│   ├── hmlr-proxy-key → did:web:adapters.propdata.org.uk:hmlr
│   ├── epc-proxy-key → did:web:adapters.propdata.org.uk:epc
│   └── ea-flood-proxy-key → did:web:adapters.propdata.org.uk:ea-flood
│
├── User Keys (did:key, per-user)
│   ├── user-{uid}-key → did:key:z6Mkh...abc
│   └── ...
│
└── Platform Key (Moverly's own identity)
    └── moverly-platform-key → did:web:moverly.com
```

### 7.4 Digital ID Wallet Binding (Future)

The vision: a user's verified digital identity lives in their mobile wallet (e.g. UK DCMS-approved digital ID). At onboarding:

1. User authenticates via QR code flow (wallet presents identity credential)
2. Wallet's DID is bound to the Participation credential
3. All subsequent attestations are signed by the user's wallet-held key
4. Each login proves: "I am the verified person who is the seller in this transaction"
5. Through the graph: all their attestations are provably signed by a real, verified person

Initially, Moverly generates and manages keys on behalf of users (custodial). The wallet binding is the migration path to user-held keys.

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

Each adapter:
- Has its own `did:web` identity (DID document at `adapters.propdata.org.uk/{adapter}/did.json`)
- Has its own signing key in Google Cloud KMS
- Calls existing source APIs (HMLR OC1, EPC API, EA flood data, LLC API, etc.)
- Issues signed VCs in PDTF 2.0 format
- Is listed in the Trusted Issuer Registry as a trusted proxy

### 9.2 Initial Adapters (from existing collectors)

| Adapter | Source API | Claim Paths | Priority |
|---------|-----------|-------------|----------|
| `hmlr` | HMLR OC1/OC2 | `/titles/*`, `/ownership/*` | High |
| `epc` | MHCLG EPC API | `/energyEfficiency/*` | High (just rebuilt) |
| `ea-flood` | EA Flood Risk API | `/environmentalIssues/flooding/*` | High |
| `llc` | HMLR LLC API | `/localLandCharges/*` | Medium |
| `bsr` | BSR Register API | `/buildingSafety/*` | Medium |
| `voa` | VOA Council Tax | `/councilTax/*` | Lower |

### 9.3 Adapter VC Issuance Flow (Synchronous)

```
Request VC → Adapter validates requester
           → Adapter calls source API
           → Adapter maps response to PDTF entity schema
           → Adapter signs VC with its KMS key
           → Returns signed VC
```

### 9.4 Access Control for Adapter API

The general adapter API access control mechanism:

1. Requester presents an **Ownership, Representation, or DelegatedConsent credential** for the relevant transaction
2. Requester proves **DID control** (challenge-response)
3. Adapter verifies credential is **not revoked** (Bitstring Status List)
4. Adapter checks `termsOfUse` of requested entity:paths against requester's role
4. If authorised: fetch data, issue VC, return
5. If public data: no authentication required

*(Full spec: `papers/pdtf-v2/12-adapter-access-control.md` — TBD)*

---

## 10. Reference Implementations

### 10.1 Planned

| Component | Description | Language | Repo |
|-----------|-------------|---------|------|
| **VC Validator** | Validates VC signature, checks issuer against TIR, verifies proof | TypeScript | `property-data-standards-co/pdtf-vc-validator` |
| **Graph Composer** | Traverses entity graph, assembles state from VCs | TypeScript | Part of `@pdtf/schemas` |
| **DID Resolver** | Resolves `did:key` and `did:web` identifiers | TypeScript | `property-data-standards-co/pdtf-did-resolver` |
| **Credential Builder** | Creates and signs VCs with PDTF context | TypeScript | `property-data-standards-co/pdtf-vc-builder` |

### 10.2 Validator Flow

```
Input: VC document
  → Parse and validate structure (JSON-LD context, required fields)
  → Extract issuer DID
  → Resolve DID → public key
  → Verify proof signature against public key
  → Look up issuer in TIR (cached)
  → Check issuer is authorised for the credential's entity:path combinations
  → Check credential is not expired
  → Check credential revocation status:
      → Fetch Bitstring Status List from credentialStatus.statusListCredential (cached, short TTL)
      → Verify status list credential signature
      → Check bit at statusListIndex — if set, credential is revoked
  → Return: { valid: true, trustLevel: "trustedProxy", issuer: "moverly-epc", revoked: false }
```

---

## 11. NPTN Integration

NPTN (National Property Transaction Network) is LMS's implementation of PDTF v1 as a data hub. PDTF 2.0 needs to work with NPTN, not replace it.

### 11.1 Strategy

- NPTN continues as the transaction orchestration layer (the "road")
- PDTF 2.0 VCs flow through NPTN as the data format
- NPTN validates VCs using the reference validator
- NPTN's existing claim filtering (confidentiality, role-based) maps to VC `termsOfUse`
- LMS documentation (spec 10) explains the architecture in terms they can implement

### 11.2 LMS Documentation Plan

Comprehensive guide covering:
- Why VCs (business case, not just technical)
- How NPTN handles VCs (receive, validate, store, filter, serve)
- Migration path from current verified claims to VCs
- Reference validator integration
- Timeline aligned with NPTN roadmap

---

## 12. API Design & Access Model

### 12.1 Unified API: MCP + OpenAPI

The core PDTF API is **MCP-compliant** (Model Context Protocol). Every transaction is a discoverable, agent-accessible resource via the transaction DID document's service endpoints. The same underlying operations are exposed through both:

- **MCP binding** — tools, resources, and prompts for AI agents. An agent can authenticate, browse transactions, fetch and verify credentials, compose state, and run diligence queries through MCP tool calls.
- **OpenAPI binding** — conventional REST endpoints with typed schemas for traditional integrators building web applications, mobile apps, and backend services.

Both bindings share the same service layer, authentication model, and credential access rules. The MCP binding is not a wrapper around the REST API — they are peer interfaces to the same operations.

**Core operations (both bindings):**

| Operation | Description |
|-----------|-------------|
| `resolveTransaction(did)` | Resolve a transaction DID → DID document, service endpoints, metadata |
| `fetchCredentials(identifier, options)` | Fetch VCs by entity identifier (UPRN, title number, transaction DID) with optional type/path filtering |
| `composeState(transactionDid, options)` | Traverse the full entity graph from a transaction DID, collect all VCs, compose state with dependency pruning. Options: v3/v4 format, include provenance |
| `verifyCredential(vc)` | Verify a single VC: signature check, TIR lookup, revocation status |
| `issueCredential(type, subject, data)` | Issue a new VC (adapter/platform only) |
| `revokeCredential(id)` | Revoke a VC by flipping its status bit (issuer only) |
| `listParticipants(transactionDid)` | List ownership, representation, and consent credentials for a transaction |
| `submitOffer(transactionDid, offer)` | Submit a buyer offer |

**AI agent skill layer:** PDTF publishes agent skills (tool definitions + usage documentation) that allow AI agents to:
- Build interface code against the API (code generation from the skill)
- Directly operate on transactions (fetch VCs, compose state, run diligence) via MCP tool calls
- Authenticate and prove participation without manual credential management

### 12.2 Authentication & DID Ownership Proof

Access to transaction data requires proof that the requester is a participant (holds an Ownership, Representation, DelegatedConsent, or Offer credential). The authentication model has two phases matching the key management evolution (D14):

#### Phase 1: Account Provider Delegation (Custodial)

In Phase 1, the account provider (LMS, Moverly) holds the user's private key in KMS. Authentication works via OAuth:

1. **Agent/client authenticates** via standard OAuth 2.0 flow with the account provider
2. **Account provider verifies** the user's identity and maps to their `did:key`
3. **Account provider signs a Verifiable Presentation (VP)** on behalf of the user using their KMS-held key — the VP contains the user's participation credential(s)
4. **PDTF service verifies** the VP signature against the user's DID document, confirms participation credential validity, and grants access

The OAuth flow *is* the challenge-response — the account provider's token endpoint is the signing oracle. The user never touches their private key. The VP is short-lived (minutes) and scoped to the specific transaction being accessed.

```
Agent → OAuth → Account Provider → KMS Sign VP → Agent → VP → PDTF Service → Verify → Access
```

#### Phase 2: Direct DID Auth (Wallet)

When users hold their own keys (wallet binding), standard DID Auth challenge-response:

1. **Agent requests access** to a transaction
2. **PDTF service issues challenge** — a nonce signed by the service
3. **Agent signs the challenge** with their `did:key` private key
4. **PDTF service verifies** the signature against the DID document and checks participation credentials

In both phases, the participation credential (stored locally by the agent/wallet) is presented as part of the authentication flow. The credential itself is the authorization — no separate role-check needed.

### 12.3 Platform-to-Platform Sync & VC Encryption

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

1. New Representation credential is issued
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

### 12.4 Key Agreement Key Derivation

X25519 key agreement keys are derived alongside Ed25519 signing keys:

- **`did:key` (Persons, managed Organisations):** The Ed25519 private key is converted to an X25519 private key using the birational map (RFC 7748 §6.1). The `did:key` document implicitly includes both verification and key agreement methods.
- **`did:web` (self-hosting Organisations, Transactions):** The DID document explicitly lists both an `Ed25519VerificationKey2020` (for signing) and an `X25519KeyAgreementKey2020` (for encryption) in `verificationMethod`, with the latter referenced from `keyAgreement`.

*(Full spec: `papers/pdtf-v2/11-api-design.md` — TODO, `papers/pdtf-v2/12-adapter-access-control.md` — TODO)*

### 12.5 Environment Separation

PDTF 2.0 uses `did:web` domains as the structural trust boundary between environments. A credential signed in staging is cryptographically untrusted in production because the issuer DID resolves to a different domain — no configuration flags or environment variables control this; it is an intrinsic property of the identifier.

#### Three-tier model

| Tier | Identity Model | Key Storage | TIR Source | DID Document Hosting |
|------|---------------|-------------|------------|---------------------|
| **Local dev** | `did:key` only | In-memory | Local JSON file | None (no did:web resolution needed) |
| **Staging** | `did:web:*.staging.propdata.org.uk` | Firestore | `staging` branch of `pdtf-tir` | GCS staging bucket |
| **Production** | `did:web:*.propdata.org.uk` | Cloud KMS (HSM-backed) | `main` branch of `pdtf-tir` | GCS prod bucket + CDN |

#### Domain conventions

```
Production:    did:web:adapters.propdata.org.uk:{adapter}
Staging:       did:web:adapters.staging.propdata.org.uk:{adapter}

Production:    did:web:transactions.propdata.org.uk:txn:{id}
Staging:       did:web:transactions.staging.propdata.org.uk:txn:{id}

Production:    did:web:auth.moverly.com
Staging:       did:web:auth.staging.moverly.com
```

#### What differs per environment

- **Adapter DIDs** — different domain, different key pairs, different DID documents
- **Transaction DIDs** — different domain prefix, separate GCS bucket / CDN
- **Account provider DID** — different auth domain
- **TIR registry** — separate branch (staging includes test issuers not present in production)
- **Status lists** — separate hosting domain (`status.staging.propdata.org.uk`)
- **Key material** — staging uses Firestore for convenience; production uses Cloud KMS with audit logging

#### What stays the same

- **Application code** — `@pdtf/core`, adapters, CLI tooling are environment-agnostic. The environment is determined entirely by configuration: which domain, which `KeyProvider` implementation, which TIR URL.
- **Schemas** — entity graph structure, VC data model, and JSON Schema definitions are identical across all tiers.
- **Root issuer entries** — aspirational entries for Environment Agency, HMLR etc. appear in both branches (they are placeholders until those organisations host their own DIDs).

#### Cross-contamination protection

Because `did:web` encodes the domain into the identifier itself, a staging credential presented to a production verifier will fail TIR lookup — the issuer DID simply does not exist in the production registry. This is not a policy check; it is a structural impossibility. No "wrong environment" bug can cause staging data to be trusted in production unless someone manually copies keys and registry entries between environments, which CI validation on the TIR repo is designed to prevent.

#### Local development

For local development and unit testing, `did:key` eliminates all infrastructure dependencies. The `MemoryKeyProvider` generates ephemeral keys, the `VcValidator` resolves `did:key` DIDs locally without network access, and a local `registry.json` file serves as the TIR. This means a developer can sign, verify, and compose credentials on a laptop with zero cloud access.

---

## 13. Sub-Specs Index

| # | Document | Status | Description |
|---|----------|--------|-------------|
| 00 | `00-architecture-overview.md` | **This document** | Master reference |
| 01 | `01-entity-graph.md` | DRAFTED | V4 schema decomposition, ID-keyed collections, entity relationships |
| 02 | `02-vc-data-model.md` | DRAFTED | W3C VC mapping, evidence model, termsOfUse, claims representation |
| 03 | `03-did-methods.md` | DRAFTED | did:key, did:web, URN schemes, DID document structure |
| 04 | `04-trusted-issuer-registry.md` | DRAFTED | GitHub-based TIR, entry schema, validation, caching |
| 05 | `05-hosted-adapter-services.md` | TODO | Adapter architecture, issuance flow, deployment |
| 06 | `06-key-management.md` | DRAFTED | Google Cloud KMS, key hierarchy, rotation, wallet binding. X25519 encryption key management deferred to Sub-spec 12. |
| 07 | `07-state-assembly.md` | DRAFTED | composeV3/V4StateFromGraph, dependency pruning, migration |
| 08 | `08-diligence-engine-migration.md` | TODO | entity:path mapping, pdtfPaths.js evolution |
| 09 | `09-nptn-integration.md` | TODO | VC flow through NPTN, LMS migration guide |
| 10 | `10-lms-documentation.md` | TODO | Architecture guide for LMS stakeholders |
| 11 | `11-api-design.md` | TODO | Unified MCP + OpenAPI interface, VC fetch/compose/verify operations, AI agent skills |
| 12 | `12-access-control-and-encryption.md` | TODO | DID Auth (OAuth delegation + direct), VP presentation, VC envelope encryption *(Phase 2+)*, platform sync |
| 13 | `13-reference-implementations.md` | DRAFTED | VC validator, graph composer, DID resolver specs |
| 14 | `14-credential-revocation.md` | DRAFTED | Bitstring Status List hosting, revocation flows, cache strategy |
| 15 | `15-conformance-testing.md` | DRAFTED | Conformance levels, test vectors, interop protocols |

---

## 14. Decisions Log

All architectural decisions made through v0.3 of this document are baked into the spec text above. The decision log below tracks only the consensus questions identified for industry review.

### 14.1 Resolved consensus decisions

| # | Question | Decision | Date |
|---|----------|----------|------|
| Q1.2 | Credential granularity for seller attestations | PDTF does not prescribe granularity. Issuers choose what subtree to assert per credential. This tradeoff absorbs into Q1.1 — see resolution note there. | Apr 2026 |
| Q1.3 | Multi-credential merge conflicts | PDTF does not prescribe conflict resolution logic. The state assembly library provides a simple timestamp-ordered merge as a convenience; verifiers apply their own business logic (trust level weighting, recency, source preference) on top. All underlying credentials remain available for inspection. | Apr 2026 |
| Q2.2 | Trust-level conflict visibility | Conflict surfacing is a verifier/UI concern, not a spec requirement. All trust levels and sources are carried in the credentials themselves, so consumers can render them however they wish. | Apr 2026 |
| Q3.3 | Credential `id` required | Yes — every credential MUST include an `id` for deduplication during state assembly. Privacy implications of credential correlation are secondary to assembly determinism. Format: `urn:pdtf:vc:{uuid}`. | Apr 2026 |
| Q4.1 | Organisation DID hosting for small firms | Both self-hosted `did:web` and orchestrator-hosted DIDs are supported. In Phase 1 and beyond, small firms are expected to use orchestrator-hosted identities — orchestrators provide the account and auth UX firms already rely on, and manage DIDs on their behalf. | Apr 2026 |
| Q4.2 | Lender access pattern | Lenders access transaction data via DelegatedConsentCredential (see sub-spec 02 §3.6). The buyer explicitly grants consent to a specific lender's Organisation DID per application. This composes with `termsOfUse.confidentiality: "restricted"` — restricted data requires either direct participation (Ownership / Representation / Offer) or an explicit DelegatedConsentCredential. No role-based lender pooling. | Apr 2026 |
| Q5.2 | Multiple issuers per path | Permitted and expected. Multiple commercial search providers, valuation services, and similar will legitimately issue credentials against the same entity:path combinations. The TIR does not enforce exclusivity. | Apr 2026 |
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
| Q7.1 | Where does the schema-level `ownership` object decompose to? | Top-level properties of v1 `ownership` (numberOfSellers, outstandingMortgage, existingLender, helpToBuyEquityLoan, limitedCompanySale, etc.) move to `Transaction.saleContext.*`. The legal interest being transferred (formerly `ownershipsToBeTransferred[]`) moves to the top level of the `Title` entity, because a `TitleCredential` fundamentally represents an ownership interest being conveyed. Supporting register evidence (register extract, charges) moves under a `title` sub-object on the `Title` entity. Note: this is the schema decomposition question — distinct from the entity-graph-level Ownership credential (the thin Person↔Title assertion, see sub-spec 02 §3.4), which is unchanged. | Preferred |
| Q7.2 | Identifier for unregistered titles | `urn:pdtf:unregisteredTitle:{uuid}` per sub-spec 03 §10.1, but UUID derivation method (v4 random vs v5 deterministic from UPRN) and first-registration transition mechanism still open. This is a hard dependency for Q7.1 — `Title.ownershipToBeTransferred` applies to registered and unregistered titles equally, so the identifier question blocks finalisation. | Open |
| Q7.3 | Field-level seams between Property and Title | The boundary between physical property facts (EPC, flood, construction) and legal title facts (charges, proprietorship, lease terms) is clear in principle, but edge cases exist (e.g., boundary disputes, rights of way). Validate on a field-by-field basis during schema review. | Open |

---

## 15. Implementation Priority

1. **Entity graph spec** (01) — formalise v4 schemas, build on existing branch work
2. **VC data model** (02) — define the credential format, evidence, termsOfUse
3. **Trusted Issuer Registry** (04) — GitHub repo, initial entries, validation schema
4. **DID methods** (03) — key generation, DID document hosting
5. **Key management** (06) — Google Cloud KMS setup
6. **One adapter PoC** (05) — EPC adapter (just rebuilt the collector, natural first candidate)
7. **State assembly** (07) — composeV3StateFromGraph with validation against existing output
8. **Reference implementations** (13) — VC validator, DID resolver
9. **Access control** (12) — participation credential verification
10. **DE migration** (08) — entity:path mapping
11. **NPTN integration** (09) — VC flow design for LMS
12. **API design** (11) — MCP-compliant endpoints
13. **LMS documentation** (10) — stakeholder guide

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.8 | 14 April 2026 | §4.4 Proof Format Comparison added — Data Integrity vs JWS/VC-JWT rationale. §6.4 Trust Infrastructure Comparison added — TIR vs OpenID Federation vs EBSI Root-TAO/TAO with Phase 3 evolution path. Previous §6.4 renumbered to §6.5. |
| v0.7 | 9 April 2026 | §14 Decisions Log restructured. Consensus questions resolved and moved to §14.1. Theme 7 Entity Model Boundaries added. |
| v0.6 | 2 April 2026 | §12.5 Environment Separation added — three-tier model (local dev/staging/prod), domain conventions, cross-contamination protection. Q5.3 resolved. |
| v0.5 | 1 April 2026 | Encryption deferred to Phase 2+ (§12.3 Phase 1 note). Organisation `did:key` support formalised alongside `did:web`. Status list signing aligned to issuer key. Merge semantics (Q1.1) reframed: issuers are stateless, pruning is an assembly concern. Q1.2 updated to connect credential granularity to merge strategy. |
| v0.4 | 29 March 2026 | Person/Organisation symmetry — all relationship credentials support both. Ownership reframed as self-asserted right to sell. Decision log restructured: D1–D32 baked into spec text, log now tracks only 17 consensus questions (Q1.1–Q6.3). Entity relationship diagram rebuilt with Organisation as first-class entity. |
| v0.3 | 29 March 2026 | §12 API Design expanded: MCP + OpenAPI dual binding, agent DID authentication, VC envelope encryption model (ECDH-ES+A256KW), platform sync architecture. Decisions D29–D32 added. Organisation `did:key` option introduced (D7/D26 updated). PDF table formatting improved. |
| v0.2 | 24 March 2026 | Organisation added as first-class entity. Representation targets Organisations not Persons. Logbook test (§3.4) for field assignment. Ownership as thin credential with claim-vs-evidence separation. Decisions D26–D28 added, D3 resolved. Sub-spec 01 marked DRAFTED. |
| v0.1 | 23 March 2026 | Initial draft. Entity graph, trust evolution (3-phase), TIR concept, 25 architectural decisions (D1–D25). |

---

*This is a living document. As sub-specs are written and decisions are made, this overview will be updated to reflect the current state.*
