---
title: The Entity Graph
description: How PDTF 2.0 decomposes property transactions into nine independently verifiable entities.
---

## Why an entity graph?

PDTF v1 represents a property transaction as a single monolithic JSON document — approximately 4,000 paths covering everything from the seller's name to the flood risk assessment. This made the schema comprehensive, but it also meant:

- **Every credential contains everything.** A conveyancer updating the completion date must issue a claim touching the same document as the EPC provider. There's no separation of concerns.
- **Data doesn't survive the transaction.** When a sale falls through, all that verified data — searches, EPCs, title information — is locked inside a transaction object. The next buyer starts from scratch.
- **Verification is all-or-nothing.** You can't verify the EPC data independently of the title data. The trust model is coarse-grained.

PDTF 2.0 solves this by decomposing the monolithic schema into nine distinct entity types, each independently identifiable and independently verifiable.

## The nine entities

| Entity | Identifier | What it represents |
|--------|-----------|-------------------|
| **Transaction** | `did:web:host:transactions:{id}` | This particular sale: status, milestones, financial context, contracts, chain position |
| **Property** | `urn:pdtf:uprn:{uprn}` | The physical property: address, features, energy performance, environmental data, legal disclosures |
| **Title** | `urn:pdtf:titleNumber:{number}` | The legal title: register extract, ownership type, leasehold terms, encumbrances |
| **Person** | `did:key:z6Mkh...` | A natural person: name, contact details, verification status. Role-free. |
| **Organisation** | `did:web:smithandco.law` | A legal entity: law firm, estate agency, lender |
| **Ownership** | `urn:pdtf:ownership:{id}` | A signed assertion linking a Person to a Title — "this person owns this title" |
| **Representation** | `urn:pdtf:representation:{id}` | Delegated authority from a party to an Organisation — "this firm acts for this seller" |
| **DelegatedConsent** | `urn:pdtf:consent:{id}` | Authorised data access for entities with a legitimate need (e.g. lenders) |
| **Offer** | `urn:pdtf:offer:{id}` | Links buyer Person(s) to a Transaction with amount, status, and conditions |

Each entity becomes the `credentialSubject` of a W3C Verifiable Credential, signed by an authorised issuer and independently verifiable.

## The governing principle

The decomposition follows a simple test — the **Logbook Test**:

:::tip[The Logbook Test]
Ask: *"Does this fact travel with the property, the title, or the sale?"*

- **Property** = logbook facts. If the next buyer needs to know it, it belongs on Property. EPC ratings, flood risk assessments, building materials, fixtures and fittings, TA6/TA7/TA10 responses — these are property facts.
- **Title** = legal title facts. Register extract, ownership type (freehold/leasehold), encumbrances, restrictive covenants, leasehold terms. Intrinsic to the title, not the sale.
- **Transaction** = this-sale facts. Who's involved, what's the price, what stage has it reached, what's the completion date. Irrelevant to the next owner.
:::

Relationship entities (Ownership, Representation, DelegatedConsent, Offer) are **thin assertions** linking people and organisations to the transaction. They carry minimal data — just enough to express the relationship — and are revocable when circumstances change.

## Transaction-centric graph

The Transaction is the root of the entity graph. All other entities are referenced from it:

```
Transaction (did:web)
├── propertyIds → Property (urn:pdtf:uprn)
├── titleIds → Title (urn:pdtf:titleNumber)
├── ownerships
│   └── Ownership → links Person (did:key) to Title
├── representations
│   └── Representation → links Person to Organisation (did:web)
├── offers
│   └── Offer → links buyer Person(s) to Transaction
├── delegatedConsents
│   └── DelegatedConsent → authorises data access
└── participants (resolved from relationship entities)
```

This is deliberate. The Transaction provides the context — *this sale of this property* — and the graph fans out to the entities involved. But each entity exists independently of the Transaction and can participate in multiple transactions over time.

## Entity deep-dives

### Transaction

The Transaction is the only entity that uses `did:web` as its primary identifier. This means:

- The Transaction has a resolvable DID document
- The DID document contains service endpoints for API access
- Agents and systems can discover how to interact with the transaction by resolving its DID

The Transaction carries sale-specific metadata: status, milestones, financial information (price, deposit, mortgage details), contract data, and chain position. It references Properties and Titles by their URN identifiers.

### Property

The Property entity represents the physical property and carries everything that would go in a "property logbook" — data that persists across transactions:

- **Address and location** — UPRN, coordinates, full address
- **Physical characteristics** — property type, construction, bedrooms, bathrooms, parking
- **Energy performance** — EPC data, ratings, recommendations
- **Environmental data** — flood risk, subsidence, contamination, radon
- **Legal disclosures** — TA6 (property information), TA7 (leasehold information), TA10 (fittings)
- **Searches** — local authority, environmental, drainage, mining

The Property is identified by its UPRN (`urn:pdtf:uprn:{uprn}`), which is a stable, nationally unique identifier for every addressable location in the UK.

:::note[Data portability]
When a sale falls through, Property credentials remain valid. The next buyer inherits all the verified property data — searches, EPCs, environmental assessments — without re-ordering them. This is one of the most significant practical benefits of the entity decomposition.
:::

### Title

The Title entity represents the legal title registered at HM Land Registry:

- **Title number** — the unique identifier
- **Register extract** — proprietorship, charges, restrictions
- **Ownership type** — freehold, leasehold, commonhold
- **Leasehold terms** — if applicable: lease length, ground rent, service charges, management company
- **Encumbrances** — easements, covenants, notices

A single Property can have multiple Titles (e.g. the freehold and a long leasehold), and a single Title can cover multiple Properties. The relationship is many-to-many, managed through the Transaction's references.

### Person

A Person entity represents a natural person. Critically, it is **role-free**. A Person has no inherent role in a transaction — their role is determined entirely by the relationship entities that reference them:

- Referenced by an **Ownership** → they're a property owner
- Referenced by an **Offer** → they're a buyer
- Referenced by a **Representation** → they've instructed a firm

This means the same Person entity can appear in different roles across different transactions without data duplication.

### Organisation

An Organisation represents a legal entity — a law firm, estate agency, lender, or other corporate participant. Organisations use `did:web` identifiers, allowing them to host DID documents with service endpoints.

:::caution[Representation is to Organisations, not individuals]
A key design decision: Representation credentials are issued to **Organisations**, not to individual solicitors. The firm is the instructed party. Individual solicitors act under the authority of their firm's representation credential. This reflects how conveyancing actually works — clients instruct firms, not specific people.
:::

### Ownership

Ownership is a **thin credential** — a signed assertion that links a Person (or Organisation) to a Title:

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:ownership:abc123",
    "owner": "did:key:z6MkhPersonDID",
    "title": "urn:pdtf:titleNumber:ABC12345",
    "status": "verified",
    "verificationLevel": "register-confirmed"
  }
}
```

It carries no duplicated data from either the Person or the Title. It simply asserts the relationship. Verification happens by cross-referencing the Ownership claim against the Title's register extract (proprietorship data).

Ownership credentials are **revocable** via Bitstring Status List — essential for when property changes hands.

### Representation

Representation is another thin credential that delegates authority from a transaction party to an Organisation:

```json
{
  "credentialSubject": {
    "id": "urn:pdtf:representation:def456",
    "party": "did:key:z6MkhSellerDID",
    "organisation": "did:web:smithandco.law",
    "role": "seller-conveyancer",
    "scope": ["full-transaction"]
  }
}
```

Like Ownership, it's revocable — because clients can and do change solicitors mid-transaction.

### DelegatedConsent

DelegatedConsent authorises specific entities to access transaction data. This is primarily used for lenders and other parties who need visibility but aren't direct participants in the sale.

### Offer

An Offer links one or more buyer Persons to a Transaction. It captures offer amount, status (submitted, accepted, rejected, withdrawn), conditions, and buyer circumstances (first-time buyer, chain position, mortgage status).

Buyers exist in the transaction graph only through Offers — there is no separate "buyer participation" entity. This means a transaction can have multiple offers (reflecting the real process of accepting/rejecting offers) with clean semantics.

## ID-keyed collections

All entity collections in the v4 schema use **ID-keyed maps**, not arrays:

```json
{
  "properties": {
    "urn:pdtf:uprn:123456789": { /* Property entity */ },
    "urn:pdtf:uprn:987654321": { /* Another property */ }
  },
  "titles": {
    "urn:pdtf:titleNumber:ABC12345": { /* Title entity */ }
  }
}
```

This enables:
- **Deterministic addressing** — credential subjects reference entities by their ID
- **Merge semantics** — updates target a specific entity by key, no index fragility
- **Graph traversal** — follow references by ID without relying on array positions

The v3 schema's arrays are converted to ID-keyed maps during the v3 → v4 upgrade, and back during v4 → v3 downgrade for backward compatibility.

## From monolithic to graph: the transformation

The entity decomposition is a **mechanical transformation**, not a creative redesign. Every path in the v3 monolithic schema maps to exactly one entity in the v4 graph:

| v3 path prefix | v4 entity |
|---------------|-----------|
| `propertyPack.*` | Property |
| `titlesToBeSold[*].*` | Title |
| `participants[*].*` | Person |
| `participants[*].organisation.*` | Organisation |
| `transaction.*` | Transaction |
| `offers[*].*` | Offer |

The mapping is documented exhaustively in the [State Assembly specification](../specs/07-state-assembly/), which defines both `composeV3StateFromGraph()` (backward-compatible reassembly) and `composeV4StateFromGraph()` (new ID-keyed format).

[Read the full entity graph specification →](../specs/01-entity-graph/)
