---
title: Decomposing the Monolithic Schema
description: Why PDTF 2.0 breaks the single transaction document into nine entity types — and the design principle behind the split.
---

*Published by the Property Data Standards Company*

## The monolithic schema

PDTF v1 represents a property transaction as a single JSON document. One schema. One document. Approximately 4,000 data paths covering everything from the property's EPC rating to the buyer's mortgage status.

This made sense for v1. A single document is simple to reason about, simple to store, and simple to transmit. Every participant works with the same object. Every update is a merge against the same structure.

But as PDTF moved from concept to production, the limitations became clear.

## The problems with one big document

### Data doesn't survive the transaction

When a sale falls through — and roughly 30% of residential transactions in England and Wales do — all the verified data dies with it. The next buyer's conveyancer orders fresh searches, requests new EPCs, and re-verifies everything. The property data was locked inside a transaction-scoped document.

Some of that data is intrinsic to the property. An EPC rating doesn't change because the buyer changed. Flood risk data doesn't reset when a sale collapses. These are **property facts**, not **transaction facts**, and they should persist independently.

### Credential granularity is too coarse

In the OIDC model, claims target specific paths within the monolithic document. But in a Verifiable Credentials model, the credential needs a coherent subject. What is the "subject" of a credential that covers `propertyPack.energyPerformance` and `transaction.status`?

If we issued one credential per monolithic document, verification would be all-or-nothing. If we issued one per field, the system would drown in credentials. The answer is to group related data into entities that make natural credential subjects.

### Participants aren't just participants

In v1, everyone involved in the transaction is a "participant" with a role. But the relationships between people and the transaction are fundamentally different:

- A **seller** owns the property. That ownership predates the transaction and survives it.
- A **conveyancer** represents a party. That representation can be revoked mid-transaction.
- A **buyer** is defined by their offer. Multiple buyers might make offers. One offer gets accepted.

Flattening these into a single `participants[]` array with a `role` field loses the semantic richness of these relationships — and makes it impossible to model them with appropriately scoped credentials.

## The decomposition

PDTF 2.0 decomposes the monolithic document into nine entity types. The governing principle is the **Logbook Test**:

> Ask: *"Does this fact travel with the property, the title, or the sale?"*

| If the fact... | It belongs on... | Examples |
|---------------|-----------------|----------|
| Travels with the property | **Property** | EPC rating, flood risk, building materials, fixtures, TA6 responses |
| Is intrinsic to the legal title | **Title** | Register extract, ownership type, leasehold terms, encumbrances |
| Is specific to this sale | **Transaction** | Price, completion date, chain position, status |
| Asserts a relationship | **Ownership / Representation / Offer / DelegatedConsent** | "X owns Y", "X instructs Z", "X offers £N" |

### Property: the logbook

The Property entity is identified by its UPRN — a stable, nationally unique identifier. Property credentials survive transactions. When a sale collapses, the Property credentials issued by search providers, EPC assessors, and environmental data sources remain valid.

The next buyer inherits them. No re-ordering. No re-verification (unless the data has expired or been revoked). This alone could save weeks and hundreds of pounds per aborted transaction.

### Title: the legal register

The Title entity is identified by its HM Land Registry title number. It carries register extract data, ownership type, leasehold terms, and encumbrances.

Title is separated from Property because a property can have multiple titles (freehold plus leasehold) and a title can cover multiple properties (e.g. a title covering a house and its garage on a separate parcel).

### Transaction: this sale

The Transaction carries everything specific to this particular sale. Strip away the property facts, the title facts, and the relationship assertions, and what's left is the Transaction: status, milestones, price, deposit, chain position, contract data.

The Transaction uses `did:web` as its identifier, which means it has a resolvable DID document with service endpoints. Systems discover how to interact with a transaction by resolving its DID.

### Relationship entities: thin and revocable

The four relationship entities — Ownership, Representation, DelegatedConsent, and Offer — are deliberately **thin**. They contain just enough data to express the relationship:

- **Ownership**: "Person X owns Title Y" (with verification level)
- **Representation**: "Person X has instructed Organisation Y" (with scope)
- **Offer**: "Person X offers £N on Transaction Y" (with conditions)
- **DelegatedConsent**: "Entity X may access data of type Y" (with constraints)

Each is a separate Verifiable Credential, independently revocable. When a client changes solicitor, the old Representation credential is revoked and a new one issued. When property changes hands, the Ownership credential is revoked. Clean, auditable, verifiable.

## What the decomposition enables

### Independent verification

A lender can verify a Property credential (EPC data, flood risk) without seeing the Transaction. A search provider can issue an environmental data credential against the Property's UPRN without knowing anything about the sale. Each credential stands alone.

### Multi-issuer trust

Different entities can be credentialed by different issuers. The Property credential might come from Moverly (as a trusted proxy for the EPC register), while the Title credential comes from a different adapter connected to HM Land Registry. The Trusted Issuer Registry governs who can issue what.

### Data portability

Property and Title credentials, identified by URN, can be referenced across transactions, across platforms, and across time. A UPRN-keyed Property credential issued in 2026 is still verifiable in 2030 — the signature doesn't expire (though the issuer might revoke it if the data becomes outdated).

### Backward compatibility

The [state assembly specification](/specs/07-state-assembly/) provides two composition functions:

- `composeV3StateFromGraph()` — reassembles entity credentials back into the v3 monolithic format
- `composeV4StateFromGraph()` — assembles into the new ID-keyed v4 format

Existing systems consuming v3 data continue working without modification. They don't need to understand the entity graph — they receive the same monolithic document they always did, assembled from individually verified credentials.

## The single development artifact

One concern with entity decomposition is schema drift — maintaining nine separate schemas and keeping them consistent. PDTF 2.0 handles this by maintaining a single `combined.json` as the development artifact:

```
v4/combined.json (single source of truth)
    │
    ├── Entity extraction → v4 entity schemas (generated)
    ├── v3 downgrade → v3/combined.json (backward compatible)
    └── Graph composition → reassemble from credentials
```

Entity schemas are **extracted** from the combined schema, not maintained independently. This guarantees consistency and keeps all context in one place during development.

## Conclusion

The entity graph isn't a theoretical exercise in data modelling. It solves concrete problems: data that dies with failed transactions, verification that's too coarse-grained, relationships that can't be independently managed.

The Logbook Test provides a simple, repeatable principle for deciding where data belongs. The result is a graph of nine entities, each independently identifiable, independently verifiable, and independently revocable.

[Explore the entity graph in detail →](/architecture/entities/)
