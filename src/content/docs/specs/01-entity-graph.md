---
title: "01 Entity Graph & Schema"
description: "PDTF 2.0 specification document."
---


**Version:** 0.1 (Draft)
**Date:** 9 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft for review (LMS collaboration)
**Parent:** [00 — Architecture Overview](/web/specs/00-architecture-overview/)

---

## 1. Purpose

This sub-spec defines the PDTF 2.0 entity graph: the set of entities, their schemas, identifiers, relationships, and the rules for decomposing a monolithic transaction into entities and recomposing entities back into transaction state.

It replaces the single `pdtf-transaction.json` (combined.json) with a graph of independently identifiable, independently credentialed entities — while maintaining full backward compatibility with the v3 schema through bidirectional transformation.

---

## 2. Design Principles

### 2.1 The Logbook Test

The governing principle for entity assignment:

> **Property entity** = facts that travel with the property across transactions (the logbook). If the next buyer needs to know it, it belongs on Property.
>
> **Title entity** = facts about the legal title — register data, ownership type, encumbrances. Intrinsic to the title, not the sale.
>
> **Transaction entity** = facts about this particular sale — who's involved, financing, milestones, status. Irrelevant to the next owner.
>
> **Relationship entities** (SellerCapacity, Representation, DelegatedConsent, Offer) = who claims what role, verified how, with what authority. These are signed assertions linking persons/organisations to the transaction.

### 2.2 ID-Keyed Collections

All entity collections use ID-keyed maps, not arrays. This enables:
- Deterministic addressing (credential subjects reference entities by ID)
- Merge semantics (updates target a specific entity by key)
- Graph traversal (follow references by ID without index fragility)

Where the v3 schema uses arrays (participants, titlesToBeSold, searches, etc.), the v4 schema converts them to `{ [id]: entity }` maps.

### 2.3 Single Development Artifact

The v4 `combined.json` remains the single development artifact. Entity schemas are **generated** from it via extraction, not maintained separately. This keeps all context in one place during development and guarantees consistency.

```
v4/combined.json (ID-keyed maps — single dev artifact)
    │
    ├──→ Entity extraction ──→ v4 entity schemas
    │         │                  (Property.json, Title.json, etc.)
    │         │
    │         └──→ credentialSubject shapes for W3C VCs
    │
    ├──→ v3 downgrade ──→ v3/combined.json (arrays)
    │         │              (backward-compatible)
    │         │
    │         └──→ existing overlays, skeletons, validators
    │
    └──→ Graph composition ──→ reassemble full state from entity VCs
              (reverse of extraction)
```

---

## 3. Core Entities

### 3.1 Entity Summary

| Entity | Identifier | Schema | Description |
|--------|-----------|--------|-------------|
| **Transaction** | `did:web` | `v4/Transaction.json` | Sale metadata, status, milestones, financial context, contracts, chain. The root of the graph. |
| **Property** | `urn:pdtf:uprn:{uprn}` | `v4/Property.json` | Physical property: address, build info, features, energy, environmental, legal questions — everything that goes in the logbook. |
| **Title** | `urn:pdtf:titleNumber:{number}` or `urn:pdtf:unregisteredTitle:{id}` | `v4/Title.json` | Legal title: register extract, ownership type (freehold/leasehold), leasehold terms, encumbrances. |
| **Person** | `did:key` | `v4/Person.json` | Natural person: name, contact, address, verification status. Role-free — role is contextual via relationship entities. |
| **Organisation** | `did:key` or `did:web` | `v4/Organisation.json` | Legal entity: law firm, estate agency, lender. Access and representation are managed at org level, not individual level. |
| **SellerCapacity** | URN (generated) | `v4/SellerCapacity.json` | Thin signed assertion: "Person/Org X is the owner of Title Y". Verified against title register. Revocable. |
| **Representation** | URN (generated) | `v4/Representation.json` | Delegated authority from seller/buyer to an Organisation (conveyancer, estate agent). Issued by the instructing party. Revocable. |
| **DelegatedConsent** | URN (generated) | `v4/DelegatedConsent.json` | Authorised data access for entities with legitimate need (lenders, etc.). Part of terms of use. |
| **Offer** | URN (generated) | `v4/Offer.json` | Links buyer Person(s) to Transaction. Contains offer amount, status, conditions, buyer circumstances. |

### 3.2 Relationship Model

```
Transaction (did:web:moverly.com:transactions:{id})
    │
    ├── properties: {
    │     "urn:pdtf:uprn:100023456789": { Property }
    │   }
    │
    ├── titles: {
    │     "urn:pdtf:titleNumber:AB12345": { Title }
    │   }
    │
    ├── ownership: {
    │     "urn:pdtf:capacity:{id}": {
    │         personId: "did:key:z6Mkh...",
    │         titleId: "urn:pdtf:titleNumber:AB12345",
    │         status: "verified"
    │     }
    │   }
    │
    ├── representation: {
    │     "urn:pdtf:representation:{id}": {
    │         organisationId: "did:key:z6MkpJ...",
    │         role: "sellerConveyancer",
    │         issuedBy: "did:key:z6Mkh..."  ← the seller
    │     }
    │   }
    │
    ├── delegatedConsent: {
    │     "urn:pdtf:consent:{id}": {
    │         organisationId: "did:web:bigbank.co.uk",
    │         scope: ["propertyPack", "titleRegister"]
    │     }
    │   }
    │
    ├── persons: {
    │     "did:key:z6Mkh...abc": { Person }
    │   }
    │
    ├── organisations: {
    │     "did:web:smithandco.law": { Organisation }
    │   }
    │
    └── offers: {
          "urn:pdtf:offer:{id}": {
              buyerIds: ["did:key:z6Mkh...xyz"],
              amount: 450000,
              status: "Accepted",
              buyerCircumstances: { ... }
          }
        }
```

### 3.3 Key Design Decisions

**D26: Transaction-centric graph.** The Transaction is the root. Property and Title are referenced by the Transaction, not the other way around. This handles unregistered titles (no title number), multi-property transactions (house + garage on separate titles), and multi-title properties naturally.

**D27: Organisation as first-class entity.** Estate agents, conveyancers, and lenders participate as Organisations, not named individuals. The firm is the instructed party; internal delegation to individual fee earners is the Organisation's concern, not the transaction graph's. This reflects reality — if your solicitor goes on holiday, the firm still has access.

**D28: Thin SellerCapacity credentials.** The SellerCapacity entity is a signed assertion linking a Person/Org to a Title — "X owns Y". It does not duplicate title details (leasehold terms, restrictions). Those belong on the Title entity. The SellerCapacity claim is verified by cross-referencing against `Title.registerExtract.proprietorship` from HMLR.

**D29: Buyers through Offers.** Buyers exist in the transaction only through Offer entities. This models reality: a buyer doesn't participate until they make an offer, multiple competing offers can exist simultaneously, and each offer has its own status and conditions. The existing `offerId` on v3 participants provides the migration path.

**D30: The Logbook Test.** Data belongs on Property if and only if it's relevant to the next owner. EPC, flood risk, legal questions, fixtures — logbook. Number of sellers, outstanding mortgage, SDLT details — not logbook. This principle governs all field placement decisions.

---

## 4. Field Mapping: v3 → v4 Entities

### 4.1 Property Entity

The Property entity corresponds to `propertyPack` in v3, minus titles and minus sale-specific ownership fields.

**Included — passes the logbook test:**

| v3 Path | Description |
|---------|-------------|
| `propertyPack.address` | Property address |
| `propertyPack.uprn` | Unique Property Reference Number (becomes the entity identifier) |
| `propertyPack.location` | Lat/long, what3words |
| `propertyPack.localAuthority` | Council tax, planning authority |
| `propertyPack.priceInformation` | Guide price, listing price |
| `propertyPack.lettingInformation` | Rental history |
| `propertyPack.summaryDescription` | Marketing description |
| `propertyPack.marketingTenure` | Advertised tenure |
| `propertyPack.media` | Photos, floorplans, virtual tours |
| `propertyPack.buildInformation` | Build date, type, materials |
| `propertyPack.residentialPropertyFeatures` | Bedrooms, bathrooms, parking |
| `propertyPack.nearbyFacilities` | Schools, transport, healthcare |
| `propertyPack.delayFactors` | Known issues that may delay sale |
| `propertyPack.parking` | Parking arrangements |
| `propertyPack.listingAndConservation` | Listed building status, conservation area |
| `propertyPack.typeOfConstruction` | Wall type, roof type |
| `propertyPack.energyEfficiency` | EPC data, recommendations |
| `propertyPack.councilTax` | Band, amount |
| `propertyPack.disputesAndComplaints` | Boundary disputes, complaints |
| `propertyPack.alterationsAndChanges` | Planning permissions, building regs |
| `propertyPack.notices` | Legal notices served/received |
| `propertyPack.specialistIssues` | Japanese knotweed, flooding, subsidence |
| `propertyPack.fixturesAndFittings` | What's included/excluded |
| `propertyPack.electricity` | Supply details |
| `propertyPack.waterAndDrainage` | Water supply, drainage |
| `propertyPack.heating` | Heating system |
| `propertyPack.connectivity` | Broadband, mobile coverage |
| `propertyPack.insurance` | Building insurance details |
| `propertyPack.rightsAndInformalArrangements` | Rights of way, shared access |
| `propertyPack.environmentalIssues` | Flood, radon, contamination, ground stability |
| `propertyPack.otherIssues` | Anything else |
| `propertyPack.additionalInformation` | Free text additions |
| `propertyPack.consumerProtectionRegulationsDeclaration` | CPR compliance |
| `propertyPack.legalBoundaries` | Boundary ownership, disputes |
| `propertyPack.servicesCrossing` | Pipes, cables, drains crossing |
| `propertyPack.electricalWorks` | Electrical installation certificates |
| `propertyPack.smartHomeSystems` | Smart home tech |
| `propertyPack.guaranteesWarrantiesAndIndemnityInsurances` | Guarantees held |
| `propertyPack.occupiers` | Current occupants |
| `propertyPack.localSearches` | Local land charges, local authority searches |
| `propertyPack.searches` | Environmental, drainage, other searches |
| `propertyPack.documents` | Supporting documents |
| `propertyPack.surveys` | Building surveys |
| `propertyPack.valuations` | Property valuations |

**Excluded from Property — moved to other entities:**

| v3 Path | Moved to | Reason |
|---------|----------|--------|
| `propertyPack.titlesToBeSold` | **Title** | Intrinsic to the title, not the property |
| `propertyPack.ownership.ownershipsToBeTransferred` | **Title** (nested as `ownership`) | Leasehold terms, ownership type — title details |
| `propertyPack.ownership.numberOfSellers` | **Transaction** | This sale only |
| `propertyPack.ownership.numberOfNonUkResidentSellers` | **Transaction** | SDLT context for this sale |
| `propertyPack.ownership.outstandingMortgage` | **Transaction** | Discharged on completion |
| `propertyPack.ownership.existingLender` | **Transaction** | Gone after this sale |
| `propertyPack.ownership.hasHelpToBuyEquityLoan` | **Transaction** | Discharged on completion |
| `propertyPack.ownership.isFirstRegistration` | **Title** | Property of the title itself |
| `propertyPack.ownership.isLimitedCompanySale` | **Transaction** | About the seller entity type |
| `propertyPack.legalOwners` | **Person/Organisation** entities + **SellerCapacity** credentials | Becomes structured entities with DIDs |
| `propertyPack.confirmationOfAccuracyByOwners` | **Transaction** | Seller signatures for this sale |
| `propertyPack.saleReadyDeclarations` | **Transaction** | Seller declarations for this sale |
| `propertyPack.completionAndMoving` | **Transaction** | Completion date, key arrangements — this sale |

### 4.2 Title Entity

Each title in `propertyPack.titlesToBeSold[]` becomes a Title entity, keyed by `urn:pdtf:titleNumber:{number}`.

| Source | v4 Location | Notes |
|--------|-------------|-------|
| `titlesToBeSold[].titleNumber` | Title identifier (part of URN) | Becomes the entity key |
| `titlesToBeSold[].titleExtents` | `titleExtents` | GeoJSON boundary |
| `titlesToBeSold[].registerExtract` | `title.registerExtract` | OC1 summary + register data from HMLR |
| `titlesToBeSold[].additionalDocuments` | `title.additionalDocuments` | Filed copies, plans, etc. |
| `ownership.ownershipsToBeTransferred[].ownershipType` | `ownershipType` | Freehold/Leasehold/etc. — matched by titleNumber |
| `ownership.ownershipsToBeTransferred[].{leasehold details}` | `{leasehold details}` | Lease terms, ground rent, etc. (via discriminator) |
| `ownership.isFirstRegistration` | `isFirstRegistration` | Title registration status |

**Unregistered titles:** Use `urn:pdtf:unregisteredTitle:{generated-id}`. The title may gain a `titleNumber` after first registration, at which point the URN updates. The graph must handle this transition.

**ownershipToBeTransferred (moved to top level):**
Because a `TitleCredential` fundamentally represents an ownership interest being conveyed, the fields previously inside `ownershipsToBeTransferred[]` move to the top level of the Title entity, and the register evidence moves into a `title` sub-object:

```json
Title (credential subject):
{
  "ownershipType": "Freehold" | "Leasehold" | "CommonholdUnit",
  // additional interest-specific fields (e.g. leaseholdDetails)
  "title": {
    "registerExtract": { ... },
    "additionalDocuments": [ ... ]
  }
}
```
Note that this applies to both registered (`urn:pdtf:titleNumber:*`) and unregistered (`urn:pdtf:unregisteredTitle:*`) titles.

*These fields represent the decomposition of the v1 monolithic `ownership` schema object per Q7.1 (architecture overview §14.2.1). Unregistered title identifier resolution is tracked as Q7.2 — the schema is stable for both cases but the identifier format is pending.*


### 4.3 Transaction Entity

The Transaction is the root entity and container for sale-specific data.

| Source | v4 Location | Notes |
|--------|-------------|-------|
| `transactionId` | Transaction DID (`did:web`) | Becomes the entity identifier |
| `status` | `status` | Transaction lifecycle status |
| `externalIds` | `externalIds` | Cross-system references |
| `milestones` | `milestones` | Listed, SSTC, searches, exchange, completion |
| `contracts` | `contracts` | Contract templates, terms, signatures |
| `chain` | `chain` | Onward purchase chain links |
| `valuationComparisonData` | `valuationComparisonData` | Comparable properties data |
| `ownership.numberOfSellers` | `saleContext.numberOfSellers` | Grouped under sale context |
| `ownership.numberOfNonUkResidentSellers` | `saleContext.numberOfNonUkResidentSellers` | |
| `ownership.outstandingMortgage` | `saleContext.outstandingMortgage` | |
| `ownership.existingLender` | `saleContext.existingLender` | |
| `ownership.hasHelpToBuyEquityLoan` | `saleContext.hasHelpToBuyEquityLoan` | |
| `ownership.isLimitedCompanySale` | `saleContext.isLimitedCompanySale` | |
| `confirmationOfAccuracyByOwners` | `sellerConfirmations.accuracy` | Sale-specific seller sign-off |
| `saleReadyDeclarations` | `sellerConfirmations.saleReady` | Sale-specific declarations |
| `completionAndMoving` | `completion` | Completion date, arrangements |

### `saleContext` details
| Field | Type | Description |
|-------|------|-------------|
| `numberOfSellers` | integer | Total number of individual sellers |
| `numberOfNonUkResidentSellers` | integer | Number of sellers not UK resident for tax purposes |
| `outstandingMortgage` | enum `Yes` \| `No` | Whether the sellers have an outstanding mortgage on any title being sold |
| `existingLender` | string | Name of the existing mortgage lender (if applicable) |
| `hasHelpToBuyEquityLoan` | enum `Yes` \| `No` | Help to Buy equity loan flag |
| `isLimitedCompanySale` | enum `Yes` \| `No` | Whether the sale is from a limited company |

These are transaction-scoped facts — they describe the sale context and are re-asserted per transaction. They are not title-level facts.

*These fields represent the decomposition of the v1 monolithic `ownership` schema object per Q7.1 (architecture overview §14.2.1). Unregistered title identifier resolution is tracked as Q7.2 — the schema is stable for both cases but the identifier format is pending.*


### 4.4 Person Entity

Extracted from `participants[]` where the participant is a natural person (seller, buyer).

| Source | v4 Location | Notes |
|--------|-------------|-------|
| `participants[].name` | `name` | First, middle, last, title |
| `participants[].dateOfBirth` | `dateOfBirth` | |
| `participants[].phone` | `contact.phone` | |
| `participants[].email` | `contact.email` | |
| `participants[].address` | `address` | |
| `participants[].verification` | `verification` | Identity, AML, source of funds |
| `participants[].externalIds` | `externalIds` | |

**Not included:** `role` and `participantStatus` — these move to relationship entities (SellerCapacity, Representation, Offer). `organisation` and `organisationReference` move to Organisation entities.

Also extracted from `propertyPack.legalOwners.namesOfLegalOwners[]` where `ownerType` = "Private individual".

### 4.5 Organisation Entity *(new)*

Extracted from `participants[]` where the participant represents an organisation (conveyancer firm, estate agency, lender), and from `legalOwners` where `ownerType` = "Organisation".

| Field | Description |
|-------|-------------|
| `name` | Organisation name |
| `type` | Law firm, estate agency, lender, etc. |
| `regulatoryBody` | SRA number, RICS, etc. (future) |
| `contact` | Office contact details |
| `externalIds` | Cross-system references |

**Design note:** Individual fee earners (the solicitor handling your case) are *not* modelled in the transaction graph. The Organisation is the instructed party. Internal delegation is the Organisation's concern.

**Identity note:** Most organisations will use provider-managed `did:key` identifiers issued by their case management platform (e.g. LMS). Self-hosted `did:web` is available for firms that want direct control of their identity, but adoption is expected to be gradual. The account provider is trusted to verify the organisation's identity and regulatory status before issuing a `did:key`.

### 4.6 SellerCapacity Entity

A thin signed assertion linking a Person or Organisation to a Title.

| Field | Description |
|-------|-------------|
| `id` | Generated URN |
| `personId` or `organisationId` | DID of the claiming owner |
| `titleId` | URN of the title being claimed |
| `status` | `claimed`, `verified`, `disputed` |
| `verifiedAgainst` | Reference to Title.registerExtract.proprietorship (evidence) |

**What it is NOT:** The SellerCapacity entity does not contain leasehold terms, ownership type (freehold/leasehold), or title register details. Those are properties of the Title itself. The SellerCapacity entity is purely the relationship: "X owns Y".

### 4.7 Representation Entity

Delegated authority from a seller or buyer to an Organisation.

| Field | Description |
|-------|-------------|
| `id` | Generated URN |
| `organisationId` | DID of the instructed firm |
| `role` | `sellerConveyancer`, `buyerConveyancer`, `estateAgent`, `buyerAgent` |
| `issuedBy` | DID of the person granting authority |
| `status` | `active`, `revoked` |

**Issuer semantics:** The seller issues Representation credentials for their conveyancer and estate agent. The buyer issues Representation credentials for their conveyancer. This models the real-world instruction relationship.

### 4.8 DelegatedConsent Entity

Authorised data access for entities with legitimate need but no direct transaction role.

| Field | Description |
|-------|-------------|
| `id` | Generated URN |
| `organisationId` | DID of the authorised entity (e.g. lender) |
| `scope` | Data paths they may access |
| `grantedBy` | DID of the granting party |
| `purpose` | Why access is needed (e.g. "mortgage valuation") |
| `status` | `active`, `revoked` |

### 4.9 Offer Entity

Links buyer(s) to the Transaction. Buyers exist only through Offers.

| Source | v4 Location | Notes |
|--------|-------------|-------|
| `offers[offerId].amount` | `amount` | |
| `offers[offerId].currency` | `currency` | |
| `offers[offerId].status` | `status` | Pending, Accepted, Withdrawn, Rejected, Note of Interest |
| `offers[offerId].inclusions` | `inclusions` | |
| `offers[offerId].exclusions` | `exclusions` | |
| `offers[offerId].conditions` | `conditions` | |
| `offers[offerId].buyerCircumstances` | `buyerCircumstances` | First-time buyer, chain, mortgage requirement |
| `offers[offerId].externalIds` | `externalIds` | |
| *(new)* | `buyerIds` | Array of Person DIDs — the buyer(s) on this offer |

---

## 5. Identifier System

### 5.1 Identifier Types

| Entity | Identifier Format | Example | Source |
|--------|------------------|---------|--------|
| Transaction | `did:web` | `did:web:moverly.com:transactions:abc123` | Platform-assigned |
| Property | `urn:pdtf:uprn:{uprn}` | `urn:pdtf:uprn:100023456789` | Ordnance Survey UPRN |
| Title | `urn:pdtf:titleNumber:{number}` | `urn:pdtf:titleNumber:AB12345` | HMLR title number |
| Title (unregistered) | `urn:pdtf:unregisteredTitle:{id}` | `urn:pdtf:unregisteredTitle:ut-7f3a` | Generated, may transition to registered |
| Person | `did:key` | `did:key:z6Mkhabc123...` | Generated from key material |
| Organisation | `did:key` or `did:web` | `did:key:z6MkpJ...` or `did:web:smithandco.law` | Provider-managed or self-hosted |
| SellerCapacity | `urn:pdtf:capacity:{id}` | `urn:pdtf:capacity:own-1a2b` | Generated |
| Representation | `urn:pdtf:representation:{id}` | `urn:pdtf:representation:rep-3c4d` | Generated |
| DelegatedConsent | `urn:pdtf:consent:{id}` | `urn:pdtf:consent:dc-5e6f` | Generated |
| Offer | `urn:pdtf:offer:{id}` | `urn:pdtf:offer:off-7g8h` | Generated (or migrated from v3 offer key) |

### 5.2 ID-Key Migration from v3

| v3 Collection | v3 Key | v4 Key | Notes |
|--------------|--------|--------|-------|
| `participants[]` | Array index | Person/Org DID | Generated or matched |
| `titlesToBeSold[]` | Array index | `urn:pdtf:titleNumber:{n}` | Natural key from `titleNumber` field |
| `offers{}` | Existing string key | `urn:pdtf:offer:{existing-key}` | Already ID-keyed, wrap in URN |
| `enquiries{}` | Existing string key | Preserved | Already ID-keyed |
| `searches[]` | Array index | Generated or `providerReference` | Need stable key strategy |
| `documents[]` | Array index | Generated | Need stable key strategy |
| `surveys[]` | Array index | Generated | Need stable key strategy |
| `valuations[]` | Array index | `valuationId` | Natural key already exists |
| `contracts[]` | Array index | Generated | Need stable key strategy |
| `chain.onwardPurchase[]` | Array index | `transactionId` | Natural key already exists |

---

## 6. v4 Combined Schema

### 6.1 Top-Level Structure

The v4 combined.json uses the same top-level structure but with ID-keyed maps replacing arrays:

```json
{
  "$schema": "https://trust.propdata.org.uk/schemas/v4/combined.json",
  "transactionId": "did:web:moverly.com:transactions:abc123",
  "status": "Active",
  "externalIds": { ... },
  
  "saleContext": {
    "numberOfSellers": 2,
    "numberOfNonUkResidentSellers": 0,
    "outstandingMortgage": "Yes",
    "existingLender": "Nationwide",
    "hasHelpToBuyEquityLoan": "No",
    "isLimitedCompanySale": "No"
  },
  
  "sellerConfirmations": {
    "accuracy": { ... },
    "saleReady": { ... }
  },
  
  "completion": { ... },
  
  "milestones": { ... },
  "contracts": { ... },
  "chain": { ... },
  "valuationComparisonData": { ... },
  
  "persons": {
    "did:key:z6Mkh...abc": { /* Person */ },
    "did:key:z6Mkh...xyz": { /* Person */ }
  },
  
  "organisations": {
    "did:web:smithandco.law": { /* Organisation */ },
    "did:web:acmeestates.co.uk": { /* Organisation */ }
  },
  
  "properties": {
    "urn:pdtf:uprn:100023456789": { /* Property — full propertyPack data */ }
  },
  
  "titles": {
    "urn:pdtf:titleNumber:AB12345": { /* Title — register, ownership type, encumbrances */ }
  },
  
  "ownership": {
    "urn:pdtf:capacity:own-1": {
      "personId": "did:key:z6Mkh...abc",
      "titleId": "urn:pdtf:titleNumber:AB12345",
      "status": "verified"
    }
  },
  
  "representation": {
    "urn:pdtf:representation:rep-1": {
      "organisationId": "did:web:smithandco.law",
      "role": "sellerConveyancer",
      "issuedBy": "did:key:z6Mkh...abc"
    }
  },
  
  "delegatedConsent": {
    "urn:pdtf:consent:dc-1": {
      "organisationId": "did:web:bigbank.co.uk",
      "scope": ["propertyPack", "titleRegister"],
      "grantedBy": "did:key:z6Mkh...xyz",
      "purpose": "mortgage valuation"
    }
  },
  
  "offers": {
    "urn:pdtf:offer:off-1": {
      "buyerIds": ["did:key:z6Mkh...xyz"],
      "amount": 450000,
      "currency": "GBP",
      "status": "Accepted",
      "buyerCircumstances": { ... }
    }
  },
  
  "enquiries": { ... }
}
```

### 6.2 What Changed from v3

| Change | v3 | v4 | Breaking? |
|--------|----|----|-----------|
| Participants | `participants[]` array | `persons{}`, `organisations{}`, relationship entities | Yes — structural |
| Titles | `propertyPack.titlesToBeSold[]` | `titles{}` (top-level, ID-keyed) | Yes — moved + restructured |
| Property pack | `propertyPack` | `properties{}` (ID-keyed by UPRN) | Yes — wrapped in map |
| SellerCapacity fields | `propertyPack.ownership` | Split across Title, Transaction, SellerCapacity entity | Yes — decomposed |
| Legal owners | `propertyPack.legalOwners` | Person/Org entities + SellerCapacity credentials | Yes — restructured |
| Seller confirmations | `propertyPack.confirmationOfAccuracyByOwners`, `saleReadyDeclarations` | `sellerConfirmations` (top-level) | Yes — moved |
| Completion | `propertyPack.completionAndMoving` | `completion` (top-level) | Yes — moved |
| Offers | `offers{}` (ID-keyed) | `offers{}` (ID-keyed, adds `buyerIds`) | Minor — additive |
| Enquiries | `enquiries{}` (ID-keyed) | `enquiries{}` (unchanged) | No |

---

## 7. Transformation Rules

### 7.1 Entity Extraction (v4 combined → entity schemas)

Entity extraction generates standalone JSON Schemas for each entity from the v4 combined.json. These schemas define the `credentialSubject` shape for W3C VCs.

**Extraction rules:**

1. **Property** — Extract `properties[*]` value schema. Remove title references.
2. **Title** — Extract `titles[*]` value schema. Includes nested `ownership` (type, leasehold terms).
3. **Person** — Extract `persons[*]` value schema.
4. **Organisation** — Extract `organisations[*]` value schema.
5. **Transaction** — Extract top-level fields minus all entity collections.
6. **Relationship entities** — Extract `ownership[*]`, `representation[*]`, `delegatedConsent[*]`, `offers[*]` value schemas.

The existing `decomposeSchema.js` (576 lines, branch 263) provides the foundation. It needs updating to handle the v4 structure and new entities.

### 7.2 v3 Downgrade (v4 combined → v3 combined)

Transforms v4 combined.json to v3 combined.json for backward compatibility.

**Downgrade rules:**

1. **persons + organisations + ownership + representation** → `participants[]` array
   - Each Person/Org becomes a participant
   - `role` derived from relationship entities (SellerCapacity → "Seller", Representation → role mapping)
   - `participantStatus` derived from relationship `status`
2. **properties{} → propertyPack** — unwrap from ID-keyed map (single property assumed for v3)
3. **titles{} → propertyPack.titlesToBeSold[]** — convert to array
4. **titles[].ownership → propertyPack.ownership.ownershipsToBeTransferred[]** — extract and convert
5. **saleContext → propertyPack.ownership** — merge sale-specific fields back
6. **sellerConfirmations → propertyPack.{confirmationOfAccuracyByOwners, saleReadyDeclarations}** — move back
7. **completion → propertyPack.completionAndMoving** — move back
8. **offers{} → offers{}** — remove `buyerIds` (link maintained via participant `offerId`)

**Note on `ownership` path composition:**
v3 `/propertyPack/ownership/*` paths are composed from both Transaction `saleContext` and Title top-level ownership fields during state assembly. See Sub-spec 07 for detailed state assembly instructions.


### 7.3 Graph Composition (entity VCs → v4 state)

Assembles full transaction state from individual entity Verifiable Credentials. This is the reverse of extraction, operating on credential payloads rather than schemas.

**Composition rules:**

1. Start with Transaction VC as the root
2. Resolve Property references → merge Property VC `credentialSubject` data
3. Resolve Title references → merge Title VC data
4. Resolve Person/Org DIDs → merge identity data
5. Collect SellerCapacity, Representation, DelegatedConsent, Offer VCs → populate relationship maps
6. Verify credential signatures and revocation status during composition
7. Output: complete v4 state object (or further downgrade to v3)

**Dual output:**
- `composeV4StateFromGraph(credentials[])` → v4 combined state
- `composeV3StateFromGraph(credentials[])` → v4 composition + v3 downgrade

---

## 8. Collection Conversion Details

### 8.1 Collections Converting from Arrays to ID-Keyed Maps

| Collection | v3 (array) | v4 (ID-keyed) | ID Source |
|-----------|------------|---------------|----------|
| `participants[]` | Index-based | Explodes into `persons{}`, `organisations{}` | DID |
| `titlesToBeSold[]` | Index-based | `titles{}` | `urn:pdtf:titleNumber:{titleNumber}` |
| `searches[]` | Index-based | `properties[uprn].searches{}` | `providerReference` or generated |
| `documents[]` | Index-based | `properties[uprn].documents{}` | Generated |
| `surveys[]` | Index-based | `properties[uprn].surveys{}` | Generated |
| `valuations[]` | Index-based | `properties[uprn].valuations{}` | `valuationId` (natural key) |
| `contracts[]` | Index-based | `contracts{}` | Generated |
| `chain.onwardPurchase[]` | Index-based | `chain.onwardPurchase{}` | `transactionId` (natural key) |
| `media[]` | Index-based | `properties[uprn].media{}` | Generated |

### 8.2 Collections Already ID-Keyed (no change)

| Collection | Key Type |
|-----------|----------|
| `offers{}` | String key (becomes URN) |
| `enquiries{}` | String key (preserved) |
| All `externalIds{}` | Pattern maps |

### 8.3 Value Arrays (remain as arrays)

The following are *value lists*, not entity collections. They remain as arrays:

- `ownershipsToBeTransferred[].additionalDocuments[]`
- `energyEfficiency.recommendations[]`
- `fixturesAndFittings.*.otherItems[]`
- `localLandCharges[]`
- Planning decision arrays
- Survey photo arrays
- `legalOwners.namesOfLegalOwners[]` (migrates to Person/Org entities)
- Environmental risk subcategory arrays
- All `conditions[]`, `inclusions[]`, `exclusions[]` on Offers

---

## 9. Open Questions

### 9.1 For LMS / Implementer Discussion

1. **Search ID strategy**
   *Question:* `providerReference` is available but may not be unique across providers. Should we generate synthetic IDs, or use a composite key (`providerName:providerReference`)?
   *Working Assumption:* Providers mint their own IDs with the strict requirement that they are globally unique (effectively a URN or UUID). If extracting from PDFs without native IDs, we synthesise a deterministic ID (e.g., hash of search type + provider + date).

2. **Multi-property transactions**
   *Question:* The v4 model supports `properties{}` with multiple UPRNs. How should overlays and form mappings work when there's more than one property?
   *Working Assumption:* The schema is constrained to **single property, multi-title** only. A transaction models exactly one Property entity, but may link to multiple Title entities (e.g., freehold + leasehold, or house + separate garage). This makes form mapping trivial.

3. **Organisation discovery & identity**
   *Question:* How do Organisations identify themselves? Do we need a registry?
   *Working Assumption:* We introduce `Organisation` as a discrete entity in the graph holding org-level data (Companies House, SRA number), distinct from individual `Person` participants. Trust resolution will use OpenID Federation Trust Marks, tying identities to verifiable framework registries.

4. **Participant migration**
   *Question:* Current participants with `role: "Seller's Conveyancer"` become an Organisation + Representation credential. What's the migration strategy for live transactions?
   *Working Assumption:* Translation is purely in code and unidirectional (**v4 → v3 mapping only**). The v4 entity graph is fully self-describing, and backend systems will dynamically recompose v3 bundles for legacy consumers.

5. **Evolving identifiers (Unregistered Titles / No UPRN)**
   *Question:* When an unregistered title gets registered, or a new build receives a UPRN, how does the URN transition?
   *Working Assumption:* We use the standard W3C `alsoKnownAs` property on the Verifiable Credential. The new VC uses the permanent identifier as its `subject.id`, but lists the old synthetic/unregistered identifier in `alsoKnownAs`. Traversal logic will resolve both to the same entity.

### 9.2 Internal (Moverly)

6. **v4 combined.json creation** — First step is transforming current v3 combined.json to v4 format. This is the bootstrap for all subsequent extraction and tooling work.

7. **Overlay compatibility** — Current overlays (BASPI, NTS, TA, CON29R) reference v3 paths. Need overlay migration strategy or dual-path overlay resolution.

8. **Existing branch 263 reconciliation** — Branch 263's entity extraction needs updating to match this spec. Key changes: Participation → SellerCapacity/Representation/DelegatedConsent/Offer, Organisation entity, single property multi title constraint, and moving residual legacy fields to `Transaction.saleContext`.

---

## 10. Implementation Plan

### Phase 1: v4 Combined Schema
1. Create `v4/combined.json` from v3 — convert arrays to ID-keyed maps
2. Restructure `participants` → `persons`, `organisations`, relationship entities
3. Apply field reassignment (ownership fields → Title/Transaction per §4)
4. Validate: v4 → v3 downgrade produces valid v3 schema

### Phase 2: Entity Extraction
5. Update `decomposeSchema.js` for v4 structure
6. Generate entity schemas: Property, Title, Transaction, Person, Organisation
7. Generate relationship schemas: SellerCapacity, Representation, DelegatedConsent, Offer
8. Validate: extracted entities cover all v4 combined paths

### Phase 3: Graph Composition
9. Implement `composeV4StateFromGraph()`
10. Implement `composeV3StateFromGraph()`
11. Round-trip test: v4 combined → extract entities → compose state → compare

### Phase 4: Overlay Migration
12. Map v3 overlay paths to v4 entity paths
13. Generate entity-specific overlays
14. Validate: overlays apply correctly to entity schemas

---

## Appendix A: v3 Participant Role → v4 Entity Mapping

| v3 Role | v4 Entity | v4 Relationship | Notes |
|---------|-----------|----------------|-------|
| `Seller` | Person | SellerCapacity | SellerCapacity credential links to Title |
| `Seller's Conveyancer` | Organisation | Representation (`sellerConveyancer`) | Firm, not individual |
| `Prospective Buyer` | Person | Offer (status: Pending) | Buyer exists through Offer |
| `Buyer` | Person | Offer (status: Accepted) | |
| `Buyer's Conveyancer` | Organisation | Representation (`buyerConveyancer`) | |
| `Estate Agent` | Organisation | Representation (`estateAgent`) | |
| `Buyer's Agent` | Organisation | Representation (`buyerAgent`) | |
| `Surveyor` | Organisation | Representation (`surveyor`) | Or Person for sole practitioners? |
| `Mortgage Broker` | Organisation | Representation (`mortgageBroker`) | |
| `Lender` | Organisation | DelegatedConsent | Access, not representation |
| `Landlord` | Person | SellerCapacity (variant) | Leasehold context |
| `Tenant` | Person | *(TBD)* | Occupancy, not ownership |

---


