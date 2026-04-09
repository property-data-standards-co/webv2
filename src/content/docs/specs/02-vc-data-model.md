---
title: "PDTF 2.0 — Sub-spec 02: Verifiable Credentials Data Model"
description: "PDTF 2.0 specification document."
---


**Version:** 0.3 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](./00-architecture-overview.md)

---

## 1. Purpose

This sub-spec defines how PDTF property data is represented as W3C Verifiable Credentials. It specifies the credential types, their structure, the claims representation model, evidence, terms of use, revocation, proof format, and the JSON-LD context that binds it all together.

Every piece of property data in PDTF 2.0 — from an EPC rating to an ownership assertion to a conveyancer's mandate — is a signed, independently verifiable credential. This document is the authoritative reference for how those credentials are structured.

**Scope:**
- Credential envelope structure (W3C VC 2.0 conformance)
- PDTF-specific credential types and their `credentialSubject` shapes
- Claims representation: sparse objects with MERGE semantics and dependency pruning
- Evidence model (simplified from OIDC-derived schema)
- Terms of use (access control metadata)
- Credential status (revocation via Bitstring Status List)
- Proof format (DataIntegrityProof with eddsa-jcs-2022)
- JSON-LD context definition
- Migration path from current OIDC verified claims

**Out of scope:**
- Entity graph structure and field mapping (see [01 — Entity Graph](./01-entity-graph.md))
- DID methods and resolution (see 03 — DID Methods)
- Trusted Issuer Registry schema and validation (see 04 — TIR)
- State assembly algorithms (see 07 — State Assembly)
- Bitstring Status List hosting infrastructure (see 14 — Credential Revocation)

---

## 2. W3C VC 2.0 Conformance

PDTF 2.0 credentials conform to the [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model-2.0/) (CR as of 2024). This section specifies which parts of the W3C model we use, which we constrain, and which we omit.

### 2.1 Required Properties

Every PDTF credential MUST include:

| Property | W3C Status | PDTF Requirement | Notes |
|----------|-----------|-------------------|-------|
| `@context` | Required | Required | Always includes VC v2 context + PDTF v2 context |
| `type` | Required | Required | Always includes `VerifiableCredential` + PDTF-specific type |
| `issuer` | Required | Required | DID string (not object form) |
| `validFrom` | Optional in W3C | **Required** in PDTF | ISO 8601 datetime — when data was asserted/retrieved |
| `credentialSubject` | Required | Required | Single subject (not array). `id` is always present. |
| `credentialStatus` | Optional in W3C | **Required** in PDTF | BitstringStatusListEntry — see §8 |
| `proof` | Req. for VC | Required | DataIntegrityProof — see §9 |

### 2.2 Optional Properties (Used)

| Property | PDTF Usage | Notes |
|----------|-----------|-------|
| `id` | Optional | Credential identifier URI. MAY be omitted for privacy. When present, uses `urn:pdtf:vc:{uuid}` format. |
| `validUntil` | Optional | Expiry datetime. Used for time-limited credentials (e.g. EPC with known expiry). |
| `evidence` | Used | Simplified evidence model — see §6 |
| `termsOfUse` | Used | PdtfAccessPolicy — see §7 |

### 2.3 Optional Properties (Not Used)

| Property | Reason for Omission |
|----------|-------------------|
| `credentialSchema` | Schema validation handled by PDTF tooling against entity schemas, not via in-credential schema references. May revisit for interoperability. |
| `refreshService` | Not needed — credentials are re-issued when data changes, not refreshed in-place. |
| `name` / `description` | Human-readable metadata not needed for machine-processed property data. |
| `relatedResource` | Not needed in initial implementation. |

### 2.4 Securing Mechanism

PDTF uses **embedded proofs** (Data Integrity), not external proofs (e.g. JWT-VC, SD-JWT). Rationale:

1. **Self-contained** — a single JSON document can be verified without external envelope parsing.
2. **JSON-LD native** — embedded proofs work naturally with JSON-LD contexts.
3. **Selective disclosure** — not needed for property data (unlike personal identity credentials). Property data is either shared in full or withheld entirely, governed by `termsOfUse`.
4. **Simplicity** — one format, one verification path, one set of tooling.

### 2.5 Credential Subject Constraints

PDTF credentials use a **single** `credentialSubject` (not an array). The `credentialSubject.id` is always present and MUST be a valid DID or URN from the PDTF identifier scheme (see [01 — Entity Graph §5](./01-entity-graph.md)).

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": { ... }
  }
}
```

Not:
```json
{
  "credentialSubject": [
    { "id": "urn:pdtf:uprn:100023456789", ... },
    { "id": "urn:pdtf:uprn:200034567890", ... }
  ]
}
```

If a credential needs to make assertions about multiple entities, issue separate credentials. This keeps the trust chain clean: one issuer, one subject, one set of claims, one proof.

---

## 3. PDTF Credential Types

Each entity type in the PDTF entity graph (see [01 — Entity Graph](./01-entity-graph.md)) has a corresponding credential type. The credential type determines the expected shape of `credentialSubject` and the valid `credentialSubject.id` identifier format.

### 3.1 Type Summary

| Credential Type | Entity | Subject ID Format | Issuer | Description |
|----------------|--------|-------------------|--------|-------------|
| `PropertyCredential` | Property | `urn:pdtf:uprn:{uprn}` | Trusted proxy / root issuer / user | Property facts: EPC, flood, build info, legal questions, fixtures, searches |
| `TitleCredential` | Title | `urn:pdtf:titleNumber:{n}` or `urn:pdtf:unregisteredTitle:{id}` | HMLR proxy / root issuer | Register extract, ownership type, leasehold terms, encumbrances |
| `OwnershipCredential` | Ownership | `urn:pdtf:ownership:{id}` | Account provider (Moverly) | Thin assertion: Person/Org DID → Title URN, status, verification level |
| `RepresentationCredential` | Representation | `urn:pdtf:representation:{id}` | Person (seller/buyer) | Organisation DID, role, granted by instructing party |
| `DelegatedConsentCredential` | DelegatedConsent | `urn:pdtf:consent:{id}` | Person (granting party) | Authorised entity, access scope, terms |
| `OfferCredential` | Offer | `urn:pdtf:offer:{id}` | Buyer (Person) or platform | Buyer DID, amount, status, conditions |
| `TransactionCredential` | Transaction | `did:web:...` | Platform (Moverly) | Transaction metadata, status, milestones, financial context |

### 3.2 PropertyCredential

**Purpose:** Asserts facts about the physical property that travel with the property across transactions (the logbook — see [01 §2.1](./01-entity-graph.md)).

**Subject ID:** `urn:pdtf:uprn:{uprn}` — the property's Unique Property Reference Number.

**Credential subject shape:** Sparse subset of the Property entity schema. A single PropertyCredential covers one or more paths on the Property entity. It does NOT need to contain the full Property schema — only the paths the issuer is asserting.

**Key design decision (D4):** EPC data, flood risk, searches, and other property facts are represented as PropertyCredentials with paths on the Property entity — not as separate first-class entity types. An EPC is a PropertyCredential with `credentialSubject.energyEfficiency`, not an "EPCCredential". This keeps the entity model clean and the credential type set small. Primary issuers (MHCLG, EA) will use the same paths when they adopt the standard.

**Example paths and typical issuers:**

| Path | Data | Typical Issuer |
|------|------|---------------|
| `energyEfficiency.*` | EPC certificate, recommendations | EPC proxy / MHCLG root issuer |
| `environmentalIssues.flooding.*` | Flood risk zones, history | EA proxy / EA root issuer |
| `buildInformation.*` | Build date, type, materials | Seller (UserAttestation) |
| `residentialPropertyFeatures.*` | Bedrooms, bathrooms, parking | Estate agent / seller |
| `heating.*` | Heating system type, fuel | Seller (UserAttestation) |
| `fixturesAndFittings.*` | What's included/excluded | Seller (UserAttestation) |
| `councilTax.*` | Band, amount | VOA proxy / VOA root issuer |
| `localSearches.*` | Local land charges, authority searches | LLC proxy / search provider |
| `searches.*` | Environmental, drainage searches | Search provider |
| `disputesAndComplaints.*` | Boundary disputes | Seller (UserAttestation) |
| `alterationsAndChanges.*` | Planning, building regs | Seller + council records |
| `connectivity.*` | Broadband, mobile | Ofcom data / seller |
| `address.*` | Property address | Platform / OS AddressBase |

**Minimal PropertyCredential (EPC only):**

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-24T10:00:00Z",
  "validUntil": "2036-03-24T00:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "1234-5678-9012-3456-7890",
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "potentialEnergyRating": "B",
        "potentialEnergyEfficiency": 85,
        "lodgementDate": "2024-01-15",
        "expiryDate": "2034-01-15"
      }
    }
  },
  "evidence": [{
    "type": "ElectronicRecord",
    "source": "get-energy-performance-data.communities.gov.uk",
    "retrievedAt": "2026-03-24T09:58:00Z",
    "method": "API"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "public",
    "pii": false
  }],
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/list-042#18293",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "18293",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/list-042"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T10:00:00Z",
    "proofValue": "z4oJ9Bvn..."
  }
}
```

**Seller-attested PropertyCredential (heating):**

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-20T14:30:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "heating": {
      "heatingSystem": {
        "heatingType": "Central heating",
        "centralHeatingDetails": {
          "fuelType": "Mains gas",
          "boilerType": "Combination boiler",
          "boilerAge": "5-10 years"
        }
      }
    }
  },
  "evidence": [{
    "type": "UserAttestation",
    "source": "did:key:z6MkhSellerAbc123",
    "attestedAt": "2026-03-20T14:30:00Z",
    "method": "BASPI form completion"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": false,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer", "estateAgent", "buyer"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/property/list-007#4521",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "4521",
    "statusListCredential": "https://api.moverly.com/status/property/list-007"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-20T14:30:00Z",
    "proofValue": "z3hQ8xNr..."
  }
}
```

**Note on issuer for user attestations:** When a seller fills in a form, Moverly signs the credential on their behalf (custodial key management — see D14 in Architecture Overview). The `evidence` section records that the attestation came from the seller's DID. When wallet-held keys are available (future), the seller will sign directly.

### 3.3 TitleCredential

**Purpose:** Asserts facts about the legal title — register data, ownership type, leasehold terms, encumbrances.

**Subject ID:** `urn:pdtf:titleNumber:{number}` for registered titles, `urn:pdtf:unregisteredTitle:{id}` for unregistered titles.

**Credential subject shape:** Sparse subset of the Title entity schema.

**Typical issuer:** HMLR proxy adapter (trusted proxy for HMLR data), or HMLR directly as root issuer (future).

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "TitleCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:hmlr",
  "validFrom": "2026-03-24T08:15:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:titleNumber:AB12345",
    "registerExtract": {
      "proprietorship": {
        "owners": [
          {
            "name": "John Smith",
            "address": "1 Example Street, London, SW1A 1AA"
          }
        ],
        "priceStatedPaid": 350000,
        "dateOfRegistration": "2018-06-15"
      },
      "restrictions": [],
      "charges": [
        {
          "chargee": "Nationwide Building Society",
          "dateOfCharge": "2018-06-15"
        }
      ]
    },
    "ownership": {
      "ownershipType": "Freehold"
    }
  },
  "evidence": [{
    "type": "ElectronicRecord",
    "source": "landregistry.data.gov.uk",
    "retrievedAt": "2026-03-24T08:14:00Z",
    "method": "OC1 API"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer"]
  }],
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/hmlr/list-015#7742",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "7742",
    "statusListCredential": "https://adapters.propdata.org.uk/status/hmlr/list-015"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:hmlr#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T08:15:00Z",
    "proofValue": "zR9kW2pL..."
  }
}
```

**Leasehold TitleCredential example (partial):**

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:titleNumber:CD67890",
    "ownership": {
      "ownershipType": "Leasehold",
      "leaseholdDetails": {
        "originalLeaseLength": 125,
        "remainingLeaseLength": 98,
        "leaseStartDate": "2001-03-01",
        "groundRent": {
          "amount": 250,
          "frequency": "Annual",
          "reviewType": "Fixed"
        },
        "serviceCharge": {
          "annualAmount": 1800,
          "managingAgent": "ABC Property Management Ltd"
        },
        "freeholderName": "Freehold Estates Ltd"
      }
    }
  }
}
```

### 3.4 OwnershipCredential

**Purpose:** A thin signed assertion linking a Person or Organisation DID to a Title URN. States "this person/organisation owns this title" with a status and verification level.

**Key design decision (D28):** The OwnershipCredential does NOT duplicate title register details. Those belong on the TitleCredential. The ownership claim is verified by cross-referencing against `Title.registerExtract.proprietorship` — **claim-vs-evidence separation**. The OwnershipCredential says "X owns Y". The TitleCredential provides the evidence from HMLR that proves it.

**Subject ID:** `urn:pdtf:ownership:{id}` — a generated URN for this ownership assertion.

**Issuer:** The account provider (currently Moverly) that verified the user's identity and cross-referenced against the title register.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "OwnershipCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-18T09:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:ownership:own-a1b2c3",
    "personId": "did:key:z6MkhSellerAbc123",
    "titleId": "urn:pdtf:titleNumber:AB12345",
    "status": "verified",
    "verificationLevel": "registerCrossReferenced",
    "verifiedAt": "2026-03-18T09:00:00Z"
  },
  "evidence": [{
    "type": "ElectronicRecord",
    "source": "landregistry.data.gov.uk",
    "retrievedAt": "2026-03-18T08:55:00Z",
    "method": "OC1 proprietorship name match"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer", "estateAgent"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/ownership/list-001#892",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "892",
    "statusListCredential": "https://api.moverly.com/status/ownership/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-18T09:00:00Z",
    "proofValue": "z5tPqR7s..."
  }
}
```

**OwnershipCredential fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `personId` | DID string | One of `personId` / `organisationId` | DID of the person claiming ownership |
| `organisationId` | DID string | One of `personId` / `organisationId` | DID of the organisation (limited company) claiming ownership |
| `titleId` | URN string | Required | `urn:pdtf:titleNumber:*` or `urn:pdtf:unregisteredTitle:*` |
| `status` | enum | Required | `claimed`, `verified`, `disputed` |
| `verificationLevel` | enum | Required | `selfDeclared`, `nameMatched`, `registerCrossReferenced`, `professionallyVerified` |
| `verifiedAt` | ISO datetime | Conditional | Required when status is `verified` |

**Verification levels:**
- `selfDeclared` — owner says they own it, no cross-reference yet
- `nameMatched` — name on title register matches declared name (automated)
- `registerCrossReferenced` — full proprietorship data cross-referenced against HMLR OC1 (automated)
- `professionallyVerified` — conveyancer has confirmed identity + ownership (manual)

**Why thin?** A verifier who wants to confirm ownership checks:
1. The OwnershipCredential links Person DID X to Title URN Y with `status: "verified"`
2. The TitleCredential for URN Y has `registerExtract.proprietorship` showing the registered owner
3. The two are consistent — the OwnershipCredential's `evidence` points back to the register cross-reference
4. Both credentials are signed and not revoked

This separation means ownership can be revoked (sale completes, mandate withdrawn) without affecting the title register data. And title data can be updated (charge removed) without re-issuing the ownership assertion.

### 3.5 RepresentationCredential

**Purpose:** Delegates authority from a seller or buyer to an Organisation (conveyancer firm, estate agency). Records the instruction relationship: "I, the seller, instruct Smith & Co Solicitors as my conveyancer."

**Subject ID:** `urn:pdtf:representation:{id}` — a generated URN for this representation.

**Issuer:** The Person (seller or buyer) granting the authority. In practice, during Phase 1, Moverly signs on behalf of the person (custodial keys), so the `issuer` is `did:web:moverly.com` and the `evidence` records the person's DID and their explicit instruction.

**Key design decision (D3):** Representation credentials are issued to **Organisations** (the firm), not to individual solicitors. The professional duty, PI insurance, and regulatory obligations sit with the firm. If your solicitor goes on holiday, the firm still has access.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "RepresentationCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-15T11:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:representation:rep-d4e5f6",
    "organisationId": "did:web:smithandco.law",
    "role": "sellerConveyancer",
    "grantedBy": "did:key:z6MkhSellerAbc123",
    "transactionId": "did:web:moverly.com:transactions:tx-789",
    "status": "active"
  },
  "evidence": [{
    "type": "UserAttestation",
    "source": "did:key:z6MkhSellerAbc123",
    "attestedAt": "2026-03-15T10:55:00Z",
    "method": "Platform instruction flow"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/representation/list-001#334",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "334",
    "statusListCredential": "https://api.moverly.com/status/representation/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-15T11:00:00Z",
    "proofValue": "zK8mN4rJ..."
  }
}
```

**RepresentationCredential fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organisationId` | DID string | Required | `did:web` of the instructed firm |
| `role` | enum | Required | `sellerConveyancer`, `buyerConveyancer`, `estateAgent`, `buyerAgent`, `surveyor`, `mortgageBroker` |
| `grantedBy` | DID string | Required | `did:key` of the person granting authority |
| `transactionId` | DID string | Required | `did:web` of the transaction this applies to |
| `status` | enum | Required | `active`, `revoked` |

**Revocation is critical:** When a seller changes conveyancer, the old RepresentationCredential MUST be revoked. Without revocation, a former conveyancer could still present a valid credential. See §8 for the revocation mechanism.

### 3.6 DelegatedConsentCredential

**Purpose:** Authorises a third party (typically a lender or search provider) to access specific data about the transaction. This is the consent mechanism for entities that aren't direct participants but have legitimate data access needs.

**Subject ID:** `urn:pdtf:consent:{id}` — a generated URN for this consent.

**Issuer:** The Person granting consent (typically the buyer, for mortgage lender access).

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "DelegatedConsentCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-22T16:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:consent:dc-g7h8i9",
    "organisationId": "did:web:bigbank.co.uk",
    "grantedBy": "did:key:z6MkhBuyerXyz789",
    "transactionId": "did:web:moverly.com:transactions:tx-789",
    "scope": [
      "Property:energyEfficiency",
      "Property:buildInformation",
      "Property:environmentalIssues",
      "Property:surveys",
      "Property:valuations",
      "Title:registerExtract",
      "Title:ownership"
    ],
    "purpose": "Mortgage valuation and underwriting",
    "status": "active",
    "validUntil": "2026-09-22T16:00:00Z"
  },
  "evidence": [{
    "type": "UserAttestation",
    "source": "did:key:z6MkhBuyerXyz789",
    "attestedAt": "2026-03-22T15:50:00Z",
    "method": "Consent flow — mortgage application"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "confidential",
    "pii": true,
    "roleRestrictions": ["buyerConveyancer"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/consent/list-001#156",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "156",
    "statusListCredential": "https://api.moverly.com/status/consent/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-22T16:00:00Z",
    "proofValue": "z7bQm3vR..."
  }
}
```

**DelegatedConsentCredential fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organisationId` | DID string | Required | `did:web` of the entity receiving access |
| `grantedBy` | DID string | Required | DID of the person granting consent |
| `transactionId` | DID string | Required | Transaction scope |
| `scope` | string[] | Required | Array of `Entity:path` patterns (same format as TIR authorised paths) |
| `purpose` | string | Required | Human-readable reason for access |
| `status` | enum | Required | `active`, `revoked` |
| `validUntil` | ISO datetime | Optional | Consent expiry (auto-revoke after this date) |

**Scope patterns** use the same `Entity:path` format as the TIR (see 04 — TIR). Wildcard patterns are permitted: `Property:*` grants access to all Property paths. Specific patterns restrict access: `Property:energyEfficiency` grants access only to EPC data.

### 3.7 OfferCredential

**Purpose:** Records a buyer's offer on a transaction. Buyers exist in the transaction only through Offers — this models reality: a buyer doesn't participate until they make an offer.

**Subject ID:** `urn:pdtf:offer:{id}` — a generated URN for this offer.

**Issuer:** The platform (Moverly) on behalf of the buyer. Future: buyer signs directly with wallet-held key.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "OfferCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-20T09:30:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:offer:off-j1k2l3",
    "transactionId": "did:web:moverly.com:transactions:tx-789",
    "buyerIds": ["did:key:z6MkhBuyerXyz789"],
    "amount": 450000,
    "currency": "GBP",
    "status": "Accepted",
    "conditions": [
      "Subject to survey",
      "Subject to mortgage"
    ],
    "buyerCircumstances": {
      "isFirstTimeBuyer": true,
      "chainStatus": "No chain",
      "mortgageRequired": true,
      "mortgageAgreedInPrinciple": true
    }
  },
  "evidence": [{
    "type": "UserAttestation",
    "source": "did:key:z6MkhBuyerXyz789",
    "attestedAt": "2026-03-20T09:25:00Z",
    "method": "Offer submission"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "confidential",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer", "estateAgent"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/offers/list-001#2041",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "2041",
    "statusListCredential": "https://api.moverly.com/status/offers/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-20T09:30:00Z",
    "proofValue": "zW2nP9sK..."
  }
}
```

**OfferCredential fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `transactionId` | DID string | Required | The transaction this offer is for |
| `buyerIds` | DID string[] | Required | Array of buyer Person DIDs (joint purchasers) |
| `amount` | number | Required | Offer amount |
| `currency` | string | Required | ISO 4217 currency code |
| `status` | enum | Required | `Pending`, `Accepted`, `Withdrawn`, `Rejected`, `NoteOfInterest` |
| `conditions` | string[] | Optional | Free-text conditions |
| `inclusions` | string[] | Optional | Items included in the offer |
| `exclusions` | string[] | Optional | Items excluded from the offer |
| `buyerCircumstances` | object | Optional | First-time buyer, chain status, mortgage requirement |

### 3.8 TransactionCredential

**Purpose:** Records transaction metadata — status, milestones, financial context, chain information. The Transaction is the root of the entity graph.

**Subject ID:** `did:web:{host}:transactions:{id}` — the transaction's own DID.

**Issuer:** The platform hosting the transaction (Moverly).

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "TransactionCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-10T12:00:00Z",
  "credentialSubject": {
    "id": "did:web:moverly.com:transactions:tx-789",
    "status": "Active",
    "milestones": {
      "listed": "2026-03-01T00:00:00Z",
      "saleAgreed": "2026-03-20T00:00:00Z"
    },
    "saleContext": {
      "numberOfSellers": 1,
      "numberOfNonUkResidentSellers": 0,
      "outstandingMortgage": "Yes",
      "existingLender": "Nationwide",
      "hasHelpToBuyEquityLoan": "No",
      "isLimitedCompanySale": "No"
    },
    "propertyIds": ["urn:pdtf:uprn:100023456789"],
    "titleIds": ["urn:pdtf:titleNumber:AB12345"]
  },
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": false,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer", "estateAgent"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/transactions/list-001#5567",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "5567",
    "statusListCredential": "https://api.moverly.com/status/transactions/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-10T12:00:00Z",
    "proofValue": "zL5jH9wQ..."
  }
}
```

---

## 4. Credential Subject

### 4.1 Subject Identification

The `credentialSubject.id` field identifies the entity the credential makes assertions about. It MUST be present and MUST use the PDTF identifier scheme:

| Credential Type | Subject ID Format | Example |
|----------------|-------------------|---------|
| PropertyCredential | `urn:pdtf:uprn:{uprn}` | `urn:pdtf:uprn:100023456789` |
| TitleCredential | `urn:pdtf:titleNumber:{n}` | `urn:pdtf:titleNumber:AB12345` |
| OwnershipCredential | `urn:pdtf:ownership:{id}` | `urn:pdtf:ownership:own-a1b2c3` |
| RepresentationCredential | `urn:pdtf:representation:{id}` | `urn:pdtf:representation:rep-d4e5f6` |
| DelegatedConsentCredential | `urn:pdtf:consent:{id}` | `urn:pdtf:consent:dc-g7h8i9` |
| OfferCredential | `urn:pdtf:offer:{id}` | `urn:pdtf:offer:off-j1k2l3` |
| TransactionCredential | `did:web:{host}:transactions:{id}` | `did:web:moverly.com:transactions:tx-789` |

### 4.2 Sparse Object Model

A credential's `credentialSubject` contains only the paths the issuer is asserting — not the full entity schema. This is the **sparse object model**.

A PropertyCredential issued by the EPC adapter contains only `energyEfficiency`:

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72
      }
    }
  }
}
```

A PropertyCredential issued by the flood adapter contains only `environmentalIssues.flooding`:

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "environmentalIssues": {
      "flooding": {
        "floodZone": "1",
        "surfaceWaterRisk": "Low",
        "historicalFlooding": "No"
      }
    }
  }
}
```

State assembly merges these sparse objects to build the complete entity state. See §5 for the merge semantics.

### 4.3 Subject and Entity Relationship

The `credentialSubject.id` connects the credential to the entity graph:

```
                   ┌─────────────────────────────┐
                   │ PropertyCredential (EPC)     │
                   │ credentialSubject.id:         │
                   │   urn:pdtf:uprn:10002345...  │──┐
                   └─────────────────────────────┘  │
                                                     │  same entity
                   ┌─────────────────────────────┐  │
                   │ PropertyCredential (flood)   │  │
                   │ credentialSubject.id:         │──┤
                   │   urn:pdtf:uprn:10002345...  │  │
                   └─────────────────────────────┘  │
                                                     │
                   ┌─────────────────────────────┐  │
                   │ Entity Graph                 │  │
                   │  properties:                 │  │
                   │    "urn:pdtf:uprn:10002345": │◄─┘
                   │      { merged state }        │
                   └─────────────────────────────┘
```

Multiple credentials with the same `credentialSubject.id` assert different facts about the same entity. State assembly merges them, with later credentials (by `validFrom`) taking precedence for overlapping paths.

---

## 5. Claims Representation

### 5.1 From REPLACE to MERGE + Prune

**Decision D5 — needs LMS consensus.**

The current PDTF v1 system uses `pathKey:value` pairs with REPLACE semantics:

```json
[
  { "claimPath": "/propertyPack/heating/heatingSystem/heatingType", "claimValue": "Central heating" },
  { "claimPath": "/propertyPack/heating/heatingSystem/centralHeatingDetails/fuelType", "claimValue": "Mains gas" },
  { "claimPath": "/propertyPack/heating/heatingSystem/centralHeatingDetails/boilerType", "claimValue": "Combination boiler" }
]
```

PDTF 2.0 replaces this with **sparse objects** using **MERGE semantics** and **dependency pruning**.

### 5.2 MERGE Semantics

When assembling state from multiple credentials, claims are merged using deep-merge:

```
State = {}
For each credential (ordered by validFrom, ascending):
  State = deepMerge(State, credential.credentialSubject)
```

Deep merge rules:
- **Object + Object** → recursive merge (keys from both, later wins on conflict)
- **Primitive + Primitive** → later value wins
- **Array + Array** → later array replaces entirely (arrays are not element-merged)
- **Any + undefined** → existing value preserved
- **undefined + Any** → new value applied

This means a newer credential can update specific paths without needing to re-state the entire entity. The EPC adapter can issue a new PropertyCredential with just `energyEfficiency` and it merges cleanly with the seller's attestation of `heating`.

### 5.3 Dependency Pruning

MERGE alone isn't sufficient. Consider this scenario:

**Step 1:** Seller attests heating system:

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "heating": {
      "heatingSystem": {
        "heatingType": "Central heating",
        "centralHeatingDetails": {
          "fuelType": "Mains gas",
          "boilerType": "Combination boiler",
          "boilerAge": "5-10 years"
        }
      }
    }
  }
}
```

**Step 2:** Seller updates — the property now has no heating:

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

**After MERGE (without pruning):**

```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "None",
      "centralHeatingDetails": {
        "fuelType": "Mains gas",
        "boilerType": "Combination boiler",
        "boilerAge": "5-10 years"
      }
    }
  }
}
```

**Problem:** `heatingType` is "None" but `centralHeatingDetails` still exists from the earlier credential. The state is internally inconsistent.

**Dependency pruning** resolves this. After MERGE, a pruning pass inspects the schema's discriminator/conditional logic:

1. The schema defines `centralHeatingDetails` as conditional on `heatingType` being `"Central heating"` (via JSON Schema `oneOf` / `if-then-else`).
2. Since `heatingType` is now `"None"`, the pruning pass strips `centralHeatingDetails` from the assembled state.

**After MERGE + Prune:**

```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "None"
    }
  }
}
```

The state is now consistent.

### 5.4 Pruning Rules

Dependency pruning operates on the entity schema:

1. **oneOf discriminators** — When a discriminator field changes, prune branches that are no longer valid. The `heatingType` → `centralHeatingDetails` case above.

2. **if-then-else conditionals** — When the `if` condition is no longer met, prune fields defined only in the `then` block.

3. **enum-gated sections** — When an enum value changes and a section is only valid for the previous value, prune that section.

4. **Explicit dependencies** — The PDTF schema MAY annotate fields with a `x-pdtf-dependsOn` extension keyword to express dependencies not captured by JSON Schema conditional constructs.

**Implementation:** The pruning pass is implemented in the reference state assembly library (see 07 — State Assembly). It walks the schema tree, evaluates each conditional, and strips paths that fail their conditions.

### 5.5 Pruning and the Old Credential

An important subtlety: after pruning removes `centralHeatingDetails`, the original credential that asserted those details is not modified or revoked. The credential is still valid — it accurately records what the seller attested at that point in time. Pruning operates on **assembled state**, not on individual credentials.

The old credential's `centralHeatingDetails` data is simply no longer included in the assembled state because the newer credential's `heatingType: "None"` makes it irrelevant per the schema.

If the seller later changes back to `heatingType: "Central heating"`, the old `centralHeatingDetails` data could theoretically re-emerge from the earlier credential. Whether to allow this or require fresh attestation is an implementation decision for the state assembly layer.

### 5.6 Design Constraint: Issuers Are Stateless

Issuers assert what they know at the time of issuance. They have no visibility of the current assembled state and no obligation to know what other credentials exist. This means:

- An issuer changing `heatingType` to `None` does not know that a previous credential asserted `centralHeatingDetails`
- Issuers cannot and should not be expected to explicitly clear dependent paths
- Pruning of schema-dependent paths (e.g., removing `centralHeatingDetails` when `heatingType` changes to `None`) is necessarily a **state assembly concern**, not an issuance concern
- The schema's existing `if/then/else` and `oneOf` discriminators define the dependency rules; the assembler applies them

This constraint shapes the merge semantics debate. Section-level REPLACE avoids the pruning question entirely (the issuer replaces the whole subtree). Incremental MERGE requires the assembler to understand schema dependencies and prune accordingly. A hybrid approach — REPLACE for adapter-issued institutional data, MERGE for seller-attested incremental data — may be the pragmatic path, but requires clear rules about which credential types use which strategy.

**Why this matters per credential type:**

- **Adapter-issued credentials** (EPC, title register, searches): Section-level REPLACE works naturally. These issuers are authoritative for the whole subtree and re-issue complete data every time. When the EPC adapter issues a credential, it replaces the entire `energyEfficiency` branch.
- **Seller-attested credentials** (TA6, TA7, fixtures & fittings): Incremental MERGE is necessary because data arrives piecemeal as the seller fills in forms over time. A seller answering the heating section doesn't re-submit the entire property pack. Finer credential granularity (per-section or per-field) amplifies this need — see Q1.2.

**The consensus questions this raises:**

1. Should pruning happen at all? (vs letting contradictory data coexist with the newer credential winning on the discriminator)
2. If yes, where are the dependency rules defined? (schema-level `if/then/else` and `oneOf` discriminators are natural candidates — they already exist in the v3 schema)
3. What is the assembler's obligation? (MUST prune? SHOULD prune? MAY flag but retain?)

### 5.7 Consensus Required

**D5 status: 🟡 Needs consensus**

Sparse objects with dependency pruning is a significant departure from the current REPLACE semantics. The benefits are clear (structured data, natural JSON, schema-driven consistency), but the implementation complexity is higher. LMS and other implementers need to agree before this is finalised.

**Fallback option:** If consensus is not reached, an alternative is to use **full-object REPLACE at the section level** — each credential replaces the entire top-level path it touches (e.g. a credential asserting `heating` replaces the entire `heating` subtree). This is simpler but loses the fine-grained merge capability.

---

## 6. Evidence Model

### 6.1 Simplified from OIDC

**Decision D6:** The current OIDC-derived evidence schema is deeply nested and over-specified for actual usage patterns. PDTF 2.0 simplifies evidence to four types that reflect how property data is actually sourced.

The current v1 evidence model inherits from OpenID Connect's `verification.evidence[]` structure, which was designed for identity verification (vouching, documents, electronic records). Property data sourcing has different patterns — API fetches, PDF extraction, seller forms, professional checks — and needs a simpler model that captures provenance without the OIDC baggage.

### 6.2 Evidence Types

| Type | Description | Key Fields | When Used |
|------|-------------|-----------|-----------|
| `ElectronicRecord` | Data retrieved from an authoritative API | `source`, `retrievedAt`, `method` | EPC API, HMLR OC1, EA flood API, LLC API |
| `DocumentExtraction` | Data extracted from a document (PDF, scan, etc.) | `source`, `extractedAt`, `method`, `documentHash` | Title deeds PDF, search result documents, lease documents |
| `UserAttestation` | Data declared by a user (seller, buyer) | `source`, `attestedAt`, `method` | BASPI form, TA6/TA7/TA10, fixtures & fittings form |
| `ProfessionalVerification` | Data verified by a professional (conveyancer, surveyor) | `source`, `verifiedAt`, `method`, `professionalRole` | Conveyancer title review, surveyor inspection |

### 6.3 Common Fields

All evidence types share:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Required | One of: `ElectronicRecord`, `DocumentExtraction`, `UserAttestation`, `ProfessionalVerification` |
| `source` | string | Required | Origin of the evidence — API hostname, person DID, or document reference |
| `method` | string | Optional | How the evidence was obtained (e.g. "API", "PDF extraction", "Form completion") |

### 6.4 Type-Specific Fields

**ElectronicRecord:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `retrievedAt` | ISO datetime | Required | When the API call was made |
| `apiEndpoint` | string | Optional | Specific API endpoint called |
| `requestId` | string | Optional | API request identifier for audit trail |

```json
{
  "type": "ElectronicRecord",
  "source": "get-energy-performance-data.communities.gov.uk",
  "retrievedAt": "2026-03-24T09:58:00Z",
  "method": "API",
  "apiEndpoint": "/api/v4/domestic/certificate/1234-5678-9012-3456-7890"
}
```

**DocumentExtraction:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `extractedAt` | ISO datetime | Required | When extraction was performed |
| `documentHash` | string | Optional | SHA-256 hash of the source document |
| `documentType` | string | Optional | Type of document (e.g. "Title Register", "Environmental Search Report") |
| `pageRange` | string | Optional | Pages from which data was extracted |

```json
{
  "type": "DocumentExtraction",
  "source": "HMLR Official Copy (Title Register)",
  "extractedAt": "2026-03-24T10:15:00Z",
  "method": "PDF extraction — structured data parser",
  "documentHash": "sha256:a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
  "documentType": "Title Register"
}
```

**UserAttestation:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `attestedAt` | ISO datetime | Required | When the user made the declaration |
| `formType` | string | Optional | The form used (e.g. "BASPI", "TA6", "TA7") |
| `questionRef` | string | Optional | Specific question reference (e.g. "TA6.7.1") |

```json
{
  "type": "UserAttestation",
  "source": "did:key:z6MkhSellerAbc123",
  "attestedAt": "2026-03-20T14:30:00Z",
  "method": "BASPI form completion",
  "formType": "BASPI",
  "questionRef": "BASPI.3.2"
}
```

**ProfessionalVerification:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `verifiedAt` | ISO datetime | Required | When verification was performed |
| `professionalRole` | string | Required | Role of the verifier (e.g. "Conveyancer", "Surveyor") |
| `firmDid` | string | Optional | DID of the professional's firm |
| `notes` | string | Optional | Verification notes |

```json
{
  "type": "ProfessionalVerification",
  "source": "did:web:smithandco.law",
  "verifiedAt": "2026-03-24T11:00:00Z",
  "method": "Title review — proprietorship cross-reference",
  "professionalRole": "Conveyancer",
  "firmDid": "did:web:smithandco.law"
}
```

### 6.5 Multiple Evidence Items

A credential MAY have multiple evidence items. This is common when data has been both fetched from an API and verified by a professional:

```json
{
  "evidence": [
    {
      "type": "ElectronicRecord",
      "source": "landregistry.data.gov.uk",
      "retrievedAt": "2026-03-24T08:14:00Z",
      "method": "OC1 API"
    },
    {
      "type": "ProfessionalVerification",
      "source": "did:web:smithandco.law",
      "verifiedAt": "2026-03-24T11:00:00Z",
      "method": "Conveyancer title review",
      "professionalRole": "Conveyancer"
    }
  ]
}
```

### 6.6 Source Documents

Evidence often refers to a source file — a title register PDF, an EPC certificate, a survey report, a search result document. The evidence model needs to support referencing these files and controlling access to them.

#### 6.6.1 The sourceDocument Object

Any evidence type MAY include a `sourceDocument` field referencing the underlying file:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `digest` | string | Required | Content hash for integrity verification. Format: `sha256:{hex}` |
| `mediaType` | string | Required | MIME type (e.g. `application/pdf`, `image/jpeg`) |
| `size` | integer | Optional | File size in bytes |
| `name` | string | Optional | Human-readable filename |
| `url` | string | Required | Retrieval URL — a `pdtf://` URI that resolves via the Transaction DID's document endpoint |
| `confidentiality` | string | Required | Access level — same values as `termsOfUse` (see §7): `public`, `transactionParticipants`, `roleRestricted`, `partyOnly` |
| `authorisedRoles` | string[] | Conditional | Required when `confidentiality` is `roleRestricted`. Role identifiers from the same table as `termsOfUse` role restrictions. |

Example — title register PDF referenced from a DocumentExtraction evidence item:

```json
{
  "type": "DocumentExtraction",
  "source": "HMLR Official Copy (Title Register)",
  "extractedAt": "2026-03-24T10:15:00Z",
  "method": "PDF extraction — structured data parser",
  "documentHash": "sha256:a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
  "documentType": "Title Register",
  "sourceDocument": {
    "digest": "sha256:a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    "mediaType": "application/pdf",
    "size": 245760,
    "name": "Official Copy - Title Register NK123456.pdf",
    "url": "pdtf://transactions/abc123/documents/doc-tr-nk123456",
    "confidentiality": "roleRestricted",
    "authorisedRoles": ["sellerConveyancer", "buyerConveyancer"]
  }
}
```

Note that `documentHash` on the evidence item and `digest` on `sourceDocument` are the same value here — the evidence is *about* the document, and the document is the source. They don't have to match (evidence could reference a different file from the one that was hashed at extraction time), but when they do, it's a strong integrity chain.

Example — survey report with restricted access:

```json
{
  "type": "ProfessionalVerification",
  "source": "did:web:abcsurveys.co.uk",
  "verifiedAt": "2026-03-25T14:00:00Z",
  "method": "Level 2 HomeBuyer Report",
  "professionalRole": "Surveyor",
  "sourceDocument": {
    "digest": "sha256:f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8",
    "mediaType": "application/pdf",
    "size": 4521984,
    "name": "HomeBuyer Report - 42 Oak Lane.pdf",
    "url": "pdtf://transactions/abc123/documents/doc-survey-hb-001",
    "confidentiality": "partyOnly",
    "authorisedRoles": []
  }
}
```

A `partyOnly` survey report is accessible only to the party who commissioned it (typically the buyer). They may choose to share it by upgrading confidentiality or adding authorised roles.

#### 6.6.2 Document Retrieval Protocol

The `pdtf://` URL scheme resolves through the Transaction DID document:

1. Parse the `pdtf://` URL to extract the transaction identifier and document path
2. Resolve the Transaction DID (`did:web:moverly.com:transactions:{txnId}`)
3. Find the `PdtfDocumentEndpoint` service in the DID document:

```json
{
  "service": [{
    "id": "did:web:moverly.com:transactions:abc123#documents",
    "type": "PdtfDocumentEndpoint",
    "serviceEndpoint": "https://moverly.com/api/transactions/abc123/documents"
  }]
}
```

4. Present a Verifiable Presentation containing the requester's participation credential to the service endpoint
5. The endpoint verifies the VP, checks the requester's role against the document's `confidentiality` and `authorisedRoles`, and returns the file or a 403
6. The requester verifies the file's content against the `digest` field

```
GET /api/transactions/abc123/documents/doc-tr-nk123456
Authorization: Bearer <VP-token>

→ 200 OK
Content-Type: application/pdf
PDTF-Digest: sha256:a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0

<file bytes>
```

#### 6.6.3 Confidentiality Levels for Documents

Document confidentiality uses the same levels as credential `termsOfUse` (§7), ensuring a single access control model across the framework:

| Level | Who Can Access | Typical Documents |
|-------|---------------|-------------------|
| `public` | Anyone with the URL | EPC certificates, flood zone maps |
| `transactionParticipants` | Any party with a valid participation credential | Title registers, local authority searches |
| `roleRestricted` | Parties whose role matches `authorisedRoles` | Environmental search reports (conveyancers only), contract drafts |
| `partyOnly` | The data subject / commissioning party only | Survey reports (buyer), mortgage offers (buyer), identity documents |

Documents follow the same encryption model as credentials when synced between platforms (see Architecture Overview D30). The `confidentiality` level determines the recipient set for per-document encryption keys.

#### 6.6.4 Design Principles

- **Files are referenced, not embedded.** A 50MB survey PDF does not belong inside a VC. The credential carries the provenance metadata and integrity hash; the file lives behind an authenticated endpoint.
- **One access control model.** Documents use the same confidentiality levels and VP-based authentication as credentials. No parallel auth system.
- **Digest is the anchor.** The SHA-256 digest binds the evidence claim to a specific file. A verifier can confirm the file hasn't been tampered with regardless of where it was fetched from.
- **`pdtf://` URIs are portable.** They resolve through DID documents, not hardcoded hostnames. If a transaction migrates between platforms, the URIs still resolve — the new platform updates the Transaction DID's service endpoint.

### 6.7 Migration from v1 Evidence

The current OIDC-derived evidence types map as follows:

| v1 Evidence Type | v2 Evidence Type | Notes |
|-----------------|-----------------|-------|
| `electronic_record` | `ElectronicRecord` | Direct mapping. Flatten nested `record` object. |
| `document` | `DocumentExtraction` | Flatten `document_details`. `source` from `document.issuer.name`. |
| `vouch` | `ProfessionalVerification` | `voucher` becomes `source` (DID). `attestation` becomes `notes`. |
| *(user form data — no explicit v1 type)* | `UserAttestation` | New. Currently inferred from claim context, not explicitly typed. |

---

## 7. Terms of Use

### 7.1 PdtfAccessPolicy

Every PDTF credential SHOULD include a `termsOfUse` entry defining its access policy. The `PdtfAccessPolicy` type carries the same semantics as the current v1 `terms_of_use` but in a cleaner structure aligned with W3C VC `termsOfUse`.

```json
{
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer"]
  }]
}
```

### 7.2 Fields

| Field | Type | Required | Values | Description |
|-------|------|----------|--------|-------------|
| `type` | string | Required | `"PdtfAccessPolicy"` | Discriminator |
| `confidentiality` | enum | Required | `public`, `restricted`, `confidential` | Access tier |
| `pii` | boolean | Required | `true`, `false` | Whether the data contains personally identifiable information |
| `roleRestrictions` | string[] | Conditional | Role identifiers | Required when confidentiality is `restricted` or `confidential` |

### 7.3 Confidentiality Levels

**`public`** — Available without authentication. Anyone can read it.
- Examples: EPC data, flood risk zones, listed building status, council tax band
- `roleRestrictions` SHOULD be omitted or empty
- `pii` MUST be `false`

**`restricted`** — Available to authenticated participants with a matching role.
- Examples: Seller contact details, legal questions, title register extract, offer details
- `roleRestrictions` specifies which roles can access
- `pii` may be `true` or `false`

**`confidential`** — Available only to specifically authorised parties.
- Examples: AML verification results, delegated consent details, internal financial data
- `roleRestrictions` typically limited to direct legal representatives
- `pii` is typically `true`

### 7.4 Role Identifiers

Role identifiers correspond to `RepresentationCredential.role` values plus the implicit roles from Ownership and Offer credentials:

| Role | Source | Description |
|------|--------|-------------|
| `seller` | OwnershipCredential | Person who owns the title |
| `buyer` | OfferCredential (accepted) | Person with an accepted offer |
| `sellerConveyancer` | RepresentationCredential | Seller's instructed law firm |
| `buyerConveyancer` | RepresentationCredential | Buyer's instructed law firm |
| `estateAgent` | RepresentationCredential | Instructed estate agency |
| `buyerAgent` | RepresentationCredential | Buyer's purchasing agent |
| `surveyor` | RepresentationCredential | Instructed surveyor |
| `mortgageBroker` | RepresentationCredential | Instructed mortgage broker |
| `lender` | DelegatedConsentCredential | Mortgage lender with consent |

### 7.5 Query-Time Filtering

When a requester queries transaction state (either via the API or through the graph composer), the system applies `termsOfUse` filtering:

1. **Determine requester's roles** — from their presented credentials (Ownership → `seller`, Representation → role value, Offer → `buyer`, DelegatedConsent → `lender`).

2. **Filter credentials** — for each credential in the entity graph:
   - If `confidentiality` is `public` → include
   - If `confidentiality` is `restricted` or `confidential`:
     - Check if the requester has at least one role listed in `roleRestrictions`
     - If DelegatedConsent: also check that the credential's paths are within the consent `scope`
   - If no match → exclude the credential from the response

3. **Assemble filtered state** — compose state only from included credentials.

This means different requesters see different views of the same transaction. A buyer's conveyancer sees title register details, AML status, and legal questions. A potential buyer who hasn't yet been accepted sees only public data.

```
Buyer's Conveyancer requests state
  → Present RepresentationCredential (role: buyerConveyancer)
  → Filter: include all public + restricted/confidential where "buyerConveyancer" ∈ roleRestrictions
  → Result: property data, title register, ownership claims, offer details, legal questions

Estate Agent requests state
  → Present RepresentationCredential (role: estateAgent)
  → Filter: include all public + restricted where "estateAgent" ∈ roleRestrictions
  → Result: property data, basic offer info — NOT title register, NOT AML details

Unauthenticated request
  → No credential presented
  → Filter: include only public
  → Result: EPC rating, flood zone, address — nothing sensitive
```

### 7.6 PII Handling

The `pii` flag enables additional processing:

- **Logging:** PII-flagged data must not appear in application logs.
- **Caching:** PII-flagged credentials require shorter cache TTL or no caching.
- **Data subject requests:** PII-flagged credentials must be discoverable for GDPR subject access/erasure requests.
- **Export:** PII-flagged credentials must be excluded from anonymised datasets.

The `pii` flag is informational — it doesn't affect access control (that's `confidentiality` + `roleRestrictions`). It affects how the data is handled after access is granted.

---

## 8. Credential Status

### 8.1 Mandatory Revocation Support

**Decision D18:** Every PDTF credential MUST include a `credentialStatus` field pointing to a [W3C Bitstring Status List v2](https://www.w3.org/TR/vc-bitstring-status-list/) entry. There are no exceptions.

**Rationale:** In a property transaction, data changes frequently (new EPC, price reduction, change of conveyancer, sale falling through). Without revocation, stale credentials are indistinguishable from current ones. A verifier must be able to check whether a credential is still valid.

### 8.2 BitstringStatusListEntry

Every PDTF credential includes:

```json
{
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/list-042#18293",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "18293",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/list-042"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | URI | Unique identifier for this status entry (list URL + fragment) |
| `type` | string | Always `"BitstringStatusListEntry"` |
| `statusPurpose` | string | Always `"revocation"` for PDTF (not `"suspension"`) |
| `statusListIndex` | string | Bit position in the status list bitstring |
| `statusListCredential` | URI | URL of the status list credential |

### 8.3 Status List Credentials

Each issuer hosts one or more Bitstring Status List credentials. These are themselves VCs:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://www.w3.org/ns/credentials/status/v2"
  ],
  "type": ["VerifiableCredential", "BitstringStatusListCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-24T00:00:00Z",
  "credentialSubject": {
    "id": "https://adapters.propdata.org.uk/status/epc/list-042",
    "type": "BitstringStatusList",
    "statusPurpose": "revocation",
    "encodedList": "H4sIAAAAAAAAA-3BMQEAAADCoPVPbQ..."
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T00:00:00Z",
    "proofValue": "zH7kN3pR..."
  }
}
```

The `encodedList` is a GZIP-compressed, base64url-encoded bitstring. Each bit position corresponds to a `statusListIndex`. Bit = 0 means "not revoked"; bit = 1 means "revoked".

### 8.4 Revocation Flow

```
1. Issuer decides to revoke (data superseded, error found, mandate withdrawn)
2. Issuer flips bit at statusListIndex in the relevant status list
3. Issuer re-signs the status list credential
4. Verifiers fetch the status list (HTTP GET, cacheable with short TTL)
5. Verifier checks the bit at the credential's statusListIndex
6. If bit = 1 → credential is revoked → exclude from state assembly
```

### 8.5 Revocation Scenarios

| Scenario | Credential Revoked | Trigger |
|----------|-------------------|---------|
| New EPC issued | Old PropertyCredential (EPC paths) | New EPC VC replaces old |
| Seller changes conveyancer | Old RepresentationCredential | Seller instructs new firm |
| Sale completes | OwnershipCredential, RepresentationCredential, OfferCredential | Transaction closes |
| Sale falls through | OfferCredential | Offer withdrawn |
| Data correction | Any credential with incorrect data | Error discovered |
| Consent withdrawn | DelegatedConsentCredential | Buyer withdraws lender consent |

### 8.6 Hosting and Caching

Status list credentials are hosted at stable URLs by each issuer:

- Adapters: `https://adapters.propdata.org.uk/status/{adapter}/{list-id}`
- Platform: `https://api.moverly.com/status/{entity-type}/{list-id}`

**Caching:** Status lists SHOULD be served with `Cache-Control: max-age=300` (5 minutes). Verifiers SHOULD cache status lists and refresh on cache expiry. For time-sensitive revocations (e.g. conveyancer change), the issuer can invalidate the cache by updating the list and notifying known verifiers.

For full hosting infrastructure details, see 14 — Credential Revocation.

---

## 9. Proof

### 9.1 DataIntegrityProof with eddsa-jcs-2022

All PDTF credentials use the [Data Integrity](https://www.w3.org/TR/vc-data-integrity/) securing mechanism with the `eddsa-jcs-2022` cryptosuite.

**Why eddsa-jcs-2022:**
- **Ed25519 keys** (D16) — fast, small signatures, widely supported in the DID ecosystem
- **JCS (JSON Canonicalization Scheme)** — deterministic JSON serialisation for signing. No ambiguity about whitespace, key ordering, or Unicode normalisation.
- **W3C standard track** — part of the [EdDSA Cryptosuite v2022](https://www.w3.org/TR/vc-di-eddsa/) specification.

### 9.2 Proof Structure

```json
{
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T10:00:00Z",
    "proofValue": "z4oJ9Bvn..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"DataIntegrityProof"` |
| `cryptosuite` | string | Always `"eddsa-jcs-2022"` |
| `verificationMethod` | DID URL | Points to the issuer's public key in their DID document. Format: `{issuer-did}#{key-id}` |
| `proofPurpose` | string | Always `"assertionMethod"` for PDTF credentials |
| `created` | ISO datetime | When the proof was generated |
| `proofValue` | string | Multibase-encoded Ed25519 signature over the JCS-canonicalised document (excluding the `proof` property itself) |

### 9.3 Verification Flow

To verify a PDTF credential's proof:

1. **Extract proof** — remove the `proof` property from the credential document.
2. **Canonicalise** — apply JCS (RFC 8785) to the remaining document to produce a deterministic byte representation.
3. **Resolve verification method** — resolve the DID in `verificationMethod` to obtain the public key.
   - For `did:key`: self-resolving — the key is encoded in the DID itself.
   - For `did:web`: fetch the DID document from `https://{domain}/.well-known/did.json` (or the path-based resolution for subpath DIDs).
4. **Extract public key** — from the resolved DID document's `verificationMethod` array, find the entry matching the fragment (e.g. `#key-1`).
5. **Verify signature** — verify the Ed25519 signature (`proofValue`, multibase-decoded) against the canonicalised document using the public key.
6. **Check proof purpose** — confirm the key is listed under the DID document's `assertionMethod` relationship.

### 9.4 Key Rotation

When an issuer rotates keys:

1. New key is added to the DID document's `verificationMethod` array (e.g. `#key-2`).
2. New credentials reference `#key-2` in their `verificationMethod`.
3. Old key (`#key-1`) is retained in the DID document for a transition period (existing credentials still verify).
4. After all credentials signed with `#key-1` are expired or revoked, the old key can be removed.

The DID document is the single source of truth for which keys are valid. Key rotation does not require re-issuing existing credentials.

---

## 10. JSON-LD Context

### 10.1 PDTF v2 Context

Every PDTF credential includes two `@context` entries:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ]
}
```

1. **W3C VC v2 context** (`https://www.w3.org/ns/credentials/v2`) — defines the base credential vocabulary: `VerifiableCredential`, `issuer`, `credentialSubject`, `evidence`, `termsOfUse`, `credentialStatus`, `proof`, etc.

2. **PDTF v2 context** (`https://trust.propdata.org.uk/ns/pdtf/v2`) — defines PDTF-specific terms.

### 10.2 What the PDTF Context Defines

The PDTF v2 JSON-LD context defines:

**Credential types:**
- `PropertyCredential`
- `TitleCredential`
- `OwnershipCredential`
- `RepresentationCredential`
- `DelegatedConsentCredential`
- `OfferCredential`
- `TransactionCredential`

**Evidence types:**
- `ElectronicRecord`
- `DocumentExtraction`
- `UserAttestation`
- `ProfessionalVerification`

**Terms of use types:**
- `PdtfAccessPolicy`

**Credential subject properties:**
- All Property entity paths (e.g. `energyEfficiency`, `environmentalIssues`, `heating`, `buildInformation`)
- All Title entity paths (e.g. `registerExtract`, `ownership`, `titleExtents`)
- Ownership entity fields (`personId`, `titleId`, `status`, `verificationLevel`)
- Representation entity fields (`organisationId`, `role`, `grantedBy`)
- DelegatedConsent entity fields (`scope`, `purpose`)
- Offer entity fields (`buyerIds`, `amount`, `buyerCircumstances`)
- Transaction entity fields (`milestones`, `saleContext`, `propertyIds`, `titleIds`)

**Evidence properties:**
- `source`, `retrievedAt`, `attestedAt`, `extractedAt`, `verifiedAt`
- `method`, `apiEndpoint`, `requestId`
- `documentHash`, `documentType`, `pageRange`
- `formType`, `questionRef`
- `professionalRole`, `firmDid`

**Access policy properties:**
- `confidentiality`, `pii`, `roleRestrictions`

### 10.3 Context Hosting

The context document is hosted at `https://trust.propdata.org.uk/ns/pdtf/v2` and MUST be:
- **Immutable** for a given version — once published, the v2 context does not change.
- **Versioned** — breaking changes result in a new version (e.g. `v3`).
- **Cached** — clients SHOULD cache the context document. It is static content.
- **Available** — hosted with high availability (CDN-backed static file).

Minor additions (new optional fields) can be added without version bumps, following JSON-LD's open-world assumption. Removals or semantic changes require a new version.

### 10.4 Context Document Structure (Excerpt)

```json
{
  "@context": {
    "@version": 1.1,
    "pdtf": "https://trust.propdata.org.uk/ns/pdtf/v2#",
    
    "PropertyCredential": "pdtf:PropertyCredential",
    "TitleCredential": "pdtf:TitleCredential",
    "OwnershipCredential": "pdtf:OwnershipCredential",
    "RepresentationCredential": "pdtf:RepresentationCredential",
    "DelegatedConsentCredential": "pdtf:DelegatedConsentCredential",
    "OfferCredential": "pdtf:OfferCredential",
    "TransactionCredential": "pdtf:TransactionCredential",
    
    "ElectronicRecord": "pdtf:ElectronicRecord",
    "DocumentExtraction": "pdtf:DocumentExtraction",
    "UserAttestation": "pdtf:UserAttestation",
    "ProfessionalVerification": "pdtf:ProfessionalVerification",
    
    "PdtfAccessPolicy": "pdtf:PdtfAccessPolicy",
    "confidentiality": "pdtf:confidentiality",
    "pii": {"@id": "pdtf:pii", "@type": "http://www.w3.org/2001/XMLSchema#boolean"},
    "roleRestrictions": {"@id": "pdtf:roleRestrictions", "@container": "@set"},
    
    "personId": {"@id": "pdtf:personId", "@type": "@id"},
    "organisationId": {"@id": "pdtf:organisationId", "@type": "@id"},
    "titleId": {"@id": "pdtf:titleId", "@type": "@id"},
    "transactionId": {"@id": "pdtf:transactionId", "@type": "@id"},
    "grantedBy": {"@id": "pdtf:grantedBy", "@type": "@id"},
    "buyerIds": {"@id": "pdtf:buyerIds", "@container": "@set", "@type": "@id"},
    "propertyIds": {"@id": "pdtf:propertyIds", "@container": "@set", "@type": "@id"},
    "titleIds": {"@id": "pdtf:titleIds", "@container": "@set", "@type": "@id"},
    
    "verificationLevel": "pdtf:verificationLevel",
    "verifiedAt": {"@id": "pdtf:verifiedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
    "status": "pdtf:status",
    "role": "pdtf:role",
    "scope": {"@id": "pdtf:scope", "@container": "@set"},
    "purpose": "pdtf:purpose",
    "amount": {"@id": "pdtf:amount", "@type": "http://www.w3.org/2001/XMLSchema#decimal"},
    "currency": "pdtf:currency",
    
    "source": "pdtf:source",
    "retrievedAt": {"@id": "pdtf:retrievedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
    "attestedAt": {"@id": "pdtf:attestedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
    "extractedAt": {"@id": "pdtf:extractedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"},
    "method": "pdtf:method",
    "documentHash": "pdtf:documentHash",
    "documentType": "pdtf:documentType",
    "formType": "pdtf:formType",
    "questionRef": "pdtf:questionRef",
    "professionalRole": "pdtf:professionalRole",
    "firmDid": {"@id": "pdtf:firmDid", "@type": "@id"},
    
    "energyEfficiency": "pdtf:energyEfficiency",
    "environmentalIssues": "pdtf:environmentalIssues",
    "heating": "pdtf:heating",
    "buildInformation": "pdtf:buildInformation",
    "residentialPropertyFeatures": "pdtf:residentialPropertyFeatures",
    "fixturesAndFittings": "pdtf:fixturesAndFittings",
    "councilTax": "pdtf:councilTax",
    "connectivity": "pdtf:connectivity",
    "registerExtract": "pdtf:registerExtract",
    "milestones": "pdtf:milestones",
    "saleContext": "pdtf:saleContext",
    "buyerCircumstances": "pdtf:buyerCircumstances"
  }
}
```

**Note:** This is an excerpt. The full context will include all Property, Title, and other entity fields. The context is generated from the v4 entity schemas to ensure consistency.

---

## 11. Full Examples

### 11.1 EPC PropertyCredential (Trusted Proxy Issuer)

A complete EPC credential issued by Moverly's EPC adapter (trusted proxy for MHCLG):

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "id": "urn:pdtf:vc:epc-7f3a2b1c-9d4e-5f6a-8b7c-0d1e2f3a4b5c",
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-24T10:00:00Z",
  "validUntil": "2034-01-15T00:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "1234-5678-9012-3456-7890",
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "potentialEnergyRating": "B",
        "potentialEnergyEfficiency": 85,
        "environmentalImpactCurrent": 58,
        "environmentalImpactPotential": 74,
        "lodgementDate": "2024-01-15",
        "expiryDate": "2034-01-15",
        "totalFloorArea": 85,
        "typeOfAssessment": "RdSAP",
        "assessmentDate": "2024-01-10"
      },
      "recommendations": [
        {
          "sequence": 1,
          "improvement": "Floor insulation (suspended floor)",
          "indicativeCost": "£800 - £1,200",
          "typicalSaving": "£60/year"
        },
        {
          "sequence": 2,
          "improvement": "Solar water heating",
          "indicativeCost": "£4,000 - £6,000",
          "typicalSaving": "£35/year"
        }
      ]
    }
  },
  "evidence": [{
    "type": "ElectronicRecord",
    "source": "get-energy-performance-data.communities.gov.uk",
    "retrievedAt": "2026-03-24T09:58:00Z",
    "method": "API",
    "apiEndpoint": "/api/v4/domestic/certificate/1234-5678-9012-3456-7890"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "public",
    "pii": false
  }],
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/list-042#18293",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "18293",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/list-042"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T10:00:00Z",
    "proofValue": "z4oJ9BvnXp8kM2nRqY7tL3wS5vU1xZ6bA9dF0gH3jK4mN7pQ8rT2uW5yB1cE4fI6hL9oR2sV3xZ0bD5gJ7kM8nP1qS4tU6wY9aC2eG3iK5lN8oQ0rT7uW1yB4dF6hI9jL2mO3pR5sV8xZ1bD4gJ6kM9nP2qS0tU7wY3aC5eG8iK1lN4oQ6rT9uW2yB0dF3hI5jL8mO1pR7sV4xZ6bD2gJ9kM0nP5qS3tU8wY1aC7eG4iK6lN9oQ2rT0uW5yB3dF8hI1jL4mO6pR9sV2xZ7bD0gJ5kM3nP8qS1tU6wY4aC9eG2iK0lN7oQ5rT3uW8yB1dF6hI4jL9mO2pR0sV7xZ5bD3gJ8kM1nP6qS4tU9wY2aC0eG7iK3lN5oQ8rT1uW6yB4dF9hI2jL0mO7pR5sV3xZ8bD1gJ6kM4nP9qS2tU0wY7aC5eG3iK8lN1oQ6rT4uW9yB2dF0hI7jL5mO3pR8sV1xZ6bD4gJ9kM2nP0qS7tU5wY3aC8eG1iK6lN4oQ9rT2uW0yB7dF5hI3jL8mO1pR6sV4xZ9bD2gJ0kM7nP5qS3tU8wY1aC6eG4iK9lN2oQ0rT7uW5yB3dF8hI1jL6mO4pR9sV2xZ0bD7gJ5kM3nP8qS1tU6wY4aC9eG2iK0l"
  }
}
```

### 11.2 OwnershipCredential (Thin Claim)

A complete ownership credential — thin assertion only, no duplicated title data:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "id": "urn:pdtf:vc:own-3a2b1c7f-4e9d-6a5f-7c8b-1e0d2f3a4b5c",
  "type": ["VerifiableCredential", "OwnershipCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-18T09:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:ownership:own-a1b2c3",
    "personId": "did:key:z6MkhRqN4v5sW8xZ1bD4gJ6kM9nP2qS0tSellerAbc",
    "titleId": "urn:pdtf:titleNumber:AB12345",
    "status": "verified",
    "verificationLevel": "registerCrossReferenced",
    "verifiedAt": "2026-03-18T09:00:00Z"
  },
  "evidence": [
    {
      "type": "ElectronicRecord",
      "source": "landregistry.data.gov.uk",
      "retrievedAt": "2026-03-18T08:55:00Z",
      "method": "OC1 proprietorship name match"
    },
    {
      "type": "UserAttestation",
      "source": "did:key:z6MkhRqN4v5sW8xZ1bD4gJ6kM9nP2qS0tSellerAbc",
      "attestedAt": "2026-03-18T08:50:00Z",
      "method": "Ownership declaration during onboarding"
    }
  ],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer", "estateAgent"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/ownership/list-001#892",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "892",
    "statusListCredential": "https://api.moverly.com/status/ownership/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-18T09:00:00Z",
    "proofValue": "z5tPqR7sK2mN4vL8xZ1bD4gJ6kM9nP2qS0tU7wY3aC5eG8iK1lN4oQ6rT9uW2yB0dF3hI5jL8mO1pR7sV4xZ6bD2gJ9kM0nP5qS3tU8wY1aC7eG4iK6lN9oQ2rT0uW5yB3dF8hI1jL4mO6pR9sV2xZ7bD0gJ5kM3nP8qS1tU6wY4aC9eG2iK0lN7oQ5rT3uW8yB1dF6hI4jL9mO2pR0sV7xZ5bD3gJ8kM1nP6qS4tU9wY2aC0eG7iK3lN5oQ8rT1uW6yB4dF9hI2jL0mO7pR5sV3xZ8bD1gJ6kM4nP9qS2tU0wY7"
  }
}
```

### 11.3 RepresentationCredential (Organisation)

A complete representation credential — seller instructs a conveyancer firm:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://trust.propdata.org.uk/ns/pdtf/v2"
  ],
  "id": "urn:pdtf:vc:rep-1c7f3a2b-9d4e-5f6a-8b7c-0d1e2f3a4b5c",
  "type": ["VerifiableCredential", "RepresentationCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-15T11:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:representation:rep-d4e5f6",
    "organisationId": "did:web:smithandco.law",
    "role": "sellerConveyancer",
    "grantedBy": "did:key:z6MkhRqN4v5sW8xZ1bD4gJ6kM9nP2qS0tSellerAbc",
    "transactionId": "did:web:moverly.com:transactions:tx-789",
    "status": "active"
  },
  "evidence": [{
    "type": "UserAttestation",
    "source": "did:key:z6MkhRqN4v5sW8xZ1bD4gJ6kM9nP2qS0tSellerAbc",
    "attestedAt": "2026-03-15T10:55:00Z",
    "method": "Platform instruction flow — seller selected conveyancer"
  }],
  "termsOfUse": [{
    "type": "PdtfAccessPolicy",
    "confidentiality": "restricted",
    "pii": true,
    "roleRestrictions": ["sellerConveyancer", "buyerConveyancer"]
  }],
  "credentialStatus": {
    "id": "https://api.moverly.com/status/representation/list-001#334",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "334",
    "statusListCredential": "https://api.moverly.com/status/representation/list-001"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#platform-key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-15T11:00:00Z",
    "proofValue": "zK8mN4rJP2sL7vX0bD3gJ5kM8nQ1tU4wY6aC9eG2iK0lN7oQ5rT3uW8yB1dF6hI4jL9mO2pR0sV7xZ5bD3gJ8kM1nP6qS4tU9wY2aC0eG7iK3lN5oQ8rT1uW6yB4dF9hI2jL0mO7pR5sV3xZ8bD1gJ6kM4nP9qS2tU0wY7aC5eG3iK8lN1oQ6rT4uW9yB2dF0hI7jL5mO3pR8sV1xZ6bD4gJ9kM2nP0qS7tU5wY3aC8eG1iK6lN4oQ9rT2uW0yB7dF5hI3jL8mO1pR6sV4xZ9bD2gJ0kM7nP5qS3tU8wY1aC6eG4iK9lN2oQ0rT7"
  }
}
```

---

## 12. Migration from Verified Claims

### 12.1 Overview

The current PDTF v1 system uses an OIDC-derived verified claims model. Each claim has a path (`claimPath`), a value (`claimValue`), and verification metadata (`verification`). PDTF 2.0 replaces this with W3C Verifiable Credentials.

This section provides a detailed mapping to guide the migration.

### 12.2 Structural Mapping

| v1 Verified Claim Field | v2 VC Equivalent | Notes |
|------------------------|------------------|-------|
| `claimPath` | Position within `credentialSubject` object | e.g. `/propertyPack/heating/heatingType` → `credentialSubject.heating.heatingSystem.heatingType` |
| `claimValue` | Value at the corresponding path in `credentialSubject` | Direct value assignment |
| `verification.trust_framework` | `issuer` DID + TIR lookup | Trust is cryptographic, not framework-declared |
| `verification.time` | `validFrom` | When the verification/assertion was made |
| `verification.evidence` | `evidence` | Simplified — see §6 |
| `verification.evidence[].type` (`electronic_record`) | `evidence[].type` (`ElectronicRecord`) | PascalCase, simplified fields |
| `verification.evidence[].type` (`document`) | `evidence[].type` (`DocumentExtraction`) | Renamed, flattened |
| `verification.evidence[].type` (`vouch`) | `evidence[].type` (`ProfessionalVerification`) | Renamed, clearer semantics |
| `verification.evidence[].record.source.name` | `evidence[].source` | Flattened — no nested `record.source` |
| `verification.evidence[].record.created_at` | `evidence[].retrievedAt` | Renamed for clarity |
| `verification.evidence[].document.issuer.name` | `evidence[].source` | Flattened |
| `verification.evidence[].document.document_details` | `evidence[].documentType`, `evidence[].documentHash` | Key fields extracted, rest dropped |
| `verification.evidence[].voucher.name` | `evidence[].source` (DID) | Person/org name → DID reference |
| `verification.evidence[].attestation` | `evidence[].notes` (ProfessionalVerification) | Free text preserved |
| `terms_of_use.confidentiality` | `termsOfUse[].confidentiality` | Same semantics |
| `terms_of_use.pii` | `termsOfUse[].pii` | Same semantics |
| `terms_of_use.roleRestrictions` | `termsOfUse[].roleRestrictions` | Same semantics, same values |
| *(no equivalent)* | `credentialStatus` | **New** — revocation support |
| *(no equivalent)* | `proof` | **New** — cryptographic signature |
| *(no equivalent)* | `@context` | **New** — JSON-LD context |
| `verifiedClaim.id` | `id` (optional) | Credential identifier |

### 12.3 Path Mapping

The `claimPath` in v1 uses the v3 schema paths. In v2, paths are relative to the entity's `credentialSubject`:

| v1 claimPath | v2 Entity | v2 credentialSubject Path |
|-------------|-----------|--------------------------|
| `/propertyPack/energyEfficiency/certificate/currentEnergyRating` | PropertyCredential | `energyEfficiency.certificate.currentEnergyRating` |
| `/propertyPack/heating/heatingSystem/heatingType` | PropertyCredential | `heating.heatingSystem.heatingType` |
| `/propertyPack/environmentalIssues/flooding/floodZone` | PropertyCredential | `environmentalIssues.flooding.floodZone` |
| `/propertyPack/buildInformation/buildDate` | PropertyCredential | `buildInformation.buildDate` |
| `/propertyPack/fixturesAndFittings/bathroom/items` | PropertyCredential | `fixturesAndFittings.bathroom.items` |
| `/propertyPack/address/line1` | PropertyCredential | `address.line1` |
| `/propertyPack/titlesToBeSold/0/registerExtract/proprietorship` | TitleCredential | `registerExtract.proprietorship` |
| `/propertyPack/titlesToBeSold/0/titleNumber` | TitleCredential | *(part of subject ID)* |
| `/propertyPack/ownership/ownershipsToBeTransferred/0/ownershipType` | TitleCredential | `ownership.ownershipType` |
| `/status` | TransactionCredential | `status` |
| `/milestones/saleAgreed` | TransactionCredential | `milestones.saleAgreed` |
| `/offers/{id}/amount` | OfferCredential | `amount` |
| `/offers/{id}/status` | OfferCredential | `status` |
| `/participants/0/name` | *(Person entity — not a VC path)* | *(Person entities are not claimPath-based)* |

### 12.4 Migration Strategy

The migration is not a big-bang cutover. It follows the dual state assembly approach (see [00 — Architecture Overview §8](./00-architecture-overview.md)):

1. **Phase 1:** Continue issuing v1 verified claims. `composeStateFromClaims` works unchanged.
2. **Phase 2:** Begin issuing VCs in parallel. Each adapter produces both a v1 claim and a v2 VC for the same data. `composeV3StateFromGraph` runs in shadow mode, output compared against `composeStateFromClaims`.
3. **Phase 3:** Once outputs match consistently, switch internal consumers to `composeV3StateFromGraph` (or `composeV4StateFromGraph` for new consumers).
4. **Phase 4:** Stop issuing v1 verified claims. All data is VC-only.

The migration is per-adapter, not all-at-once. The EPC adapter migrates first (just rebuilt, natural candidate), then HMLR, then others.

### 12.5 Claim Grouping

In v1, each `claimPath:claimValue` pair is an independent claim. In v2, related paths are grouped into a single credential's `credentialSubject`. The grouping follows the entity paths — all EPC data goes into one PropertyCredential, all HMLR data into one TitleCredential, etc.

**v1 (4 separate claims):**
```json
[
  { "claimPath": "/propertyPack/energyEfficiency/certificate/currentEnergyRating", "claimValue": "C" },
  { "claimPath": "/propertyPack/energyEfficiency/certificate/currentEnergyEfficiency", "claimValue": 72 },
  { "claimPath": "/propertyPack/energyEfficiency/certificate/lodgementDate", "claimValue": "2024-01-15" },
  { "claimPath": "/propertyPack/energyEfficiency/certificate/certificateNumber", "claimValue": "1234-5678-9012-3456-7890" }
]
```

**v2 (1 credential):**
```json
{
  "type": ["VerifiableCredential", "PropertyCredential"],
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "lodgementDate": "2024-01-15",
        "certificateNumber": "1234-5678-9012-3456-7890"
      }
    }
  }
}
```

This is more natural, more efficient (one signature instead of four), and preserves the relationship between related data points.

---

## 13. Open Questions

### 13.1 For LMS / Implementer Discussion

1. **D5 consensus: Sparse objects + dependency pruning vs section-level REPLACE.** The pruning approach is more elegant but more complex to implement. Do implementers prefer the simpler section-level REPLACE? What's the minimum viable merge strategy?

2. **Credential granularity for seller forms.** When a seller fills in BASPI, should each section (heating, fixtures, legal questions) become a separate PropertyCredential, or should the entire form submission be one credential? Separate credentials allow finer-grained revocation and re-attestation. One credential is simpler to issue.

3. **termsOfUse defaults.** Should there be default access policies per credential type, or must every credential explicitly declare its termsOfUse? Defaults reduce boilerplate but add implicit behaviour.

4. **Evidence granularity.** Should evidence be per-credential (current design) or per-path within a credential? Per-credential is simpler but means all paths in a credential share the same evidence metadata. Per-path is more precise but adds significant complexity.

5. **Credential ID assignment.** Should all credentials have an `id` field, or should it be optional for privacy reasons? IDs enable deduplication and reference but create correlation vectors.

### 13.2 Architectural

6. **Multi-credential merge conflicts.** When two credentials for the same entity have overlapping paths with conflicting values, which wins? Current design: later `validFrom` wins. But what about concurrent issuance? Should there be a priority based on issuer trust level (root issuer > trusted proxy > user attestation)?

7. **Credential versioning.** When an issuer re-issues a credential for the same data (e.g. new EPC), should it explicitly reference the credential it supersedes? The W3C VC model doesn't have a built-in "supersedes" mechanism.

8. **Status list sizing.** How many credentials per status list? The W3C spec suggests 16KB minimum (131,072 bit positions). Is that sufficient for PDTF's expected credential volume per issuer?

9. **Context evolution.** How do we handle adding new property data paths to the JSON-LD context without breaking existing credentials? JSON-LD's open-world assumption helps, but tooling may not handle unknown terms gracefully.

### 13.3 Internal (Moverly)

10. **Custodial signing for user attestations.** In Phase 1, Moverly signs on behalf of users. The evidence records the user's DID. But the proof doesn't come from the user's key. Is this semantically honest? Should we use a different proof mechanism (e.g. counter-signature) that makes the custodial relationship explicit?

11. **Adapter credential caching.** Should adapters cache issued credentials (return the same VC for repeated requests for the same data) or always issue fresh ones? Caching is efficient but means the adapter stores credentials. Fresh issuance is stateless but means multiple VCs for the same data.

12. **Person/Organisation VCs.** This spec deliberately doesn't define PersonCredential or OrganisationCredential. Person and Organisation data is identity data, not property data. Should there be separate identity credentials, or are the entity records in the graph sufficient?

---

## 14. Implementation Notes

### 14.1 Reference Libraries

The following reference implementations support this spec:

| Library | Purpose | Status |
|---------|---------|--------|
| `@pdtf/vc-builder` | Create and sign PDTF VCs | Planned |
| `@pdtf/vc-validator` | Validate VC structure, proof, issuer, revocation | Planned |
| `@pdtf/did-resolver` | Resolve `did:key` and `did:web` to public keys | Planned |
| `@pdtf/state-assembler` | MERGE + prune state from VCs | Planned |
| `@pdtf/context` | PDTF v2 JSON-LD context document | Planned |

### 14.2 VC Builder Flow

```
Input: entity data (sparse object), entity ID, issuer DID, evidence, termsOfUse
  → Construct credentialSubject from entity data + ID
  → Determine credential type from entity type
  → Set @context, type, issuer, validFrom
  → Attach evidence, termsOfUse
  → Allocate status list index from issuer's current status list
  → Attach credentialStatus
  → JCS-canonicalise the document
  → Sign with issuer's Ed25519 private key
  → Attach proof
  → Output: complete signed VC
```

### 14.3 VC Validator Flow

```
Input: VC document
  → Validate JSON structure (required fields, types)
  → Validate @context includes VC v2 + PDTF v2
  → Validate type includes VerifiableCredential + PDTF type
  → Validate credentialSubject.id format matches credential type
  → Extract issuer DID
  → Resolve DID → DID document → public key
  → Verify Data Integrity proof (JCS canonical, Ed25519 verify)
  → Check credentialStatus:
      → Fetch BitstringStatusList credential (with caching)
      → Verify status list credential's own proof
      → Check bit at statusListIndex
  → Check validFrom ≤ now ≤ validUntil (if present)
  → Optionally: check issuer against TIR for authorised paths
  → Output: { valid, revoked, expired, issuerTrust, errors[] }
```

### 14.4 Credential Sizing

Estimated credential sizes (JSON, uncompressed):

| Credential Type | Typical Size | Notes |
|----------------|-------------|-------|
| PropertyCredential (EPC) | 1.5–2 KB | Certificate + recommendations |
| PropertyCredential (seller form section) | 0.5–3 KB | Varies by section |
| PropertyCredential (full seller form) | 8–15 KB | All BASPI sections combined |
| TitleCredential | 2–5 KB | Register extract + ownership type |
| OwnershipCredential | 0.8–1 KB | Thin — smallest credential type |
| RepresentationCredential | 0.8–1 KB | Thin — similar to Ownership |
| DelegatedConsentCredential | 1–1.5 KB | Includes scope array |
| OfferCredential | 1–2 KB | Amount, conditions, buyer circumstances |
| TransactionCredential | 1.5–3 KB | Status, milestones, sale context |

A typical transaction might have 20–40 credentials totalling 30–80 KB of VC data.

### 14.5 Credential Lifecycle

```
                    ┌───────────┐
                    │  Created   │
                    │ (issued +  │
                    │  signed)   │
                    └─────┬─────┘
                          │
                    ┌─────▼─────┐
                    │  Active    │◄──── Verifiers check proof +
                    │ (valid,    │      status list. Bit = 0.
                    │  not       │
                    │  revoked)  │
                    └─────┬─────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
        ┌─────▼─────┐ ┌──▼──┐ ┌─────▼─────┐
        │ Superseded │ │Revoked│ │  Expired  │
        │ (new VC    │ │(bit=1│ │ (validUntil│
        │  replaces) │ │in SL)│ │  passed)  │
        └───────────┘ └──────┘ └───────────┘
```

- **Superseded:** A new credential covers the same data. The old credential is revoked (bit flipped) and the new one takes its place.
- **Revoked:** Explicitly invalidated (e.g. mandate withdrawn, error found). Bit flipped in status list.
- **Expired:** `validUntil` has passed. No bit flip needed — verifiers check the date.

### 14.6 Relationship to Other Sub-Specs

| Sub-spec | Relationship |
|----------|-------------|
| 01 — Entity Graph | Defines the entity schemas that shape `credentialSubject`. This spec wraps those shapes in VCs. |
| 03 — DID Methods | Defines how `issuer` DIDs and `verificationMethod` DIDs resolve. This spec references them. |
| 04 — TIR | Defines which issuers are trusted for which entity:path combos. This spec's credentials are validated against TIR entries. |
| 07 — State Assembly | Implements the MERGE + prune semantics defined in §5 of this spec. |
| 08 — DE Migration | Maps DE evaluation paths to credential `credentialSubject` paths. |
| 14 — Credential Revocation | Details the hosting, caching, and operational aspects of BitstringStatusList referenced in §8. |

### 14.7 Security Considerations

1. **Proof verification is mandatory.** Never trust a credential without verifying its proof. Even internal systems must verify — defence in depth.

2. **Status list freshness.** A cached status list may not reflect recent revocations. For security-critical checks (e.g. verifying a representation credential before granting data access), use short cache TTL or force-refresh.

3. **Issuer impersonation.** `did:web` resolution depends on DNS. An attacker who compromises a domain could issue fraudulent credentials. Mitigation: TIR entries provide a second check (the issuer DID must be in the TIR for the relevant paths). Monitor DID document changes.

4. **Credential correlation.** Credentials with `id` fields create correlation vectors — the same credential ID appearing in different contexts links those contexts. For privacy-sensitive credentials, omit the `id` field.

5. **Key compromise.** If an issuer's private key is compromised, all credentials signed with that key are suspect. The issuer must: rotate keys in the DID document, revoke all credentials signed with the compromised key, re-issue with the new key. See 06 — Key Management for rotation procedures.

6. **PII in evidence.** Evidence fields like `source` may contain a person's DID, which could be PII. The `termsOfUse.pii` flag should be set accordingly, and evidence data must be handled with the same access controls as the credential subject data.

---

## Appendix A: Architectural Decisions Referenced

| # | Decision | Status | Relevance to This Spec |
|---|----------|--------|----------------------|
| D3 | Representation to Organisations, not Persons | ✅ Confirmed | §3.5 — RepresentationCredential targets Organisation DIDs |
| D4 | Property-level VCs, not first-class entity VCs | ✅ Confirmed | §3.2 — EPC is a PropertyCredential, not EPCCredential |
| D5 | Sparse objects + dependency pruning | 🟡 Needs consensus | §5 — Claims representation model |
| D6 | Simpler evidence model | ✅ Confirmed | §6 — Four evidence types replacing OIDC-derived schema |
| D7 | did:key for users, did:web for transactions/adapters | ✅ Confirmed | §9 — verificationMethod DID formats |
| D14 | Digital ID wallet binding (future, custodial for now) | ✅ Confirmed | §3.2 note on custodial signing |
| D16 | Ed25519 key algorithm | ✅ Confirmed | §9 — eddsa-jcs-2022 cryptosuite |
| D18 | Bitstring Status List revocation mandatory | ✅ Confirmed | §8 — credentialStatus required on all VCs |
| D28 | Ownership credential is thin (claim-vs-evidence separation) | ✅ Confirmed | §3.4 — OwnershipCredential design |

---

## Appendix B: Credential Type Quick Reference

```
PropertyCredential
  subject: urn:pdtf:uprn:{uprn}
  claims: property facts (EPC, flood, heating, fixtures, searches, ...)
  issuer: trusted proxy / root issuer / platform (for user attestations)

TitleCredential
  subject: urn:pdtf:titleNumber:{n} | urn:pdtf:unregisteredTitle:{id}
  claims: register extract, ownership type, leasehold terms
  issuer: HMLR proxy / HMLR root issuer

OwnershipCredential
  subject: urn:pdtf:ownership:{id}
  claims: personId/organisationId → titleId, status, verificationLevel
  issuer: account provider (Moverly)
  NOTE: thin — no title details, just the link

RepresentationCredential
  subject: urn:pdtf:representation:{id}
  claims: organisationId, role, grantedBy, transactionId, status
  issuer: platform (on behalf of person granting authority)

DelegatedConsentCredential
  subject: urn:pdtf:consent:{id}
  claims: organisationId, scope, purpose, grantedBy, transactionId
  issuer: platform (on behalf of person granting consent)

OfferCredential
  subject: urn:pdtf:offer:{id}
  claims: buyerIds, amount, currency, status, conditions, buyerCircumstances
  issuer: platform (on behalf of buyer)

TransactionCredential
  subject: did:web:{host}:transactions:{id}
  claims: status, milestones, saleContext, propertyIds, titleIds
  issuer: platform
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.3 | 1 April 2026 | Added §5.6 "Design Constraint: Issuers Are Stateless" — issuers have no visibility of assembled state, pruning is an assembly concern. Frames REPLACE vs MERGE vs hybrid tradeoff for consensus. |
| v0.2 | 30 March 2026 | Added §6.6 Source Documents — `sourceDocument` schema, `pdtf://` retrieval protocol via DID service discovery, confidentiality tiers, VP-authenticated fetch. |
| v0.1 | 24 March 2026 | Initial draft. 7 credential types with JSON examples, evidence model (4 types), termsOfUse filtering, BitstringStatusList, DataIntegrityProof (eddsa-jcs-2022), JSON-LD context, migration from verified claims. |

---

*This is a living document. As implementation progresses and LMS consensus is reached on D5, this spec will be updated accordingly.*
