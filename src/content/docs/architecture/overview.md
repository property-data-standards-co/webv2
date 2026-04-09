---
title: Architecture Overview
description: A 10-minute overview of the PDTF 2.0 architecture for technical decision-makers.
---

## What is PDTF 2.0?

PDTF 2.0 is a complete redesign of the Property Data Trust Framework. It replaces the OpenID Connect verified claims model with W3C Verifiable Credentials, decomposes the monolithic schema into an entity graph, and introduces decentralised identifiers (DIDs) and cryptographic signing.

The result: property data that is independently verifiable, portable between systems, and machine-readable by any agent or platform — without trusting the intermediary serving it.

## What changed from v1

| Aspect | PDTF v1 (Current) | PDTF 2.0 |
|--------|-------------------|-----------|
| **Data model** | Monolithic `pdtf-transaction.json` (~4,000 paths) | Entity graph: 9 distinct entities |
| **Claims** | OpenID Connect verified claims with pathKey:value REPLACE semantics | W3C Verifiable Credentials with sparse objects |
| **Identity** | Firebase Auth UIDs, no universal identifiers | DIDs: `did:key` (users), `did:web` (transactions, adapters) |
| **Entity identifiers** | Internal Firestore document IDs | URNs: `urn:pdtf:titleNumber:{value}`, `urn:pdtf:uprn:{value}` |
| **Verification** | Trust the platform serving the data | Cryptographic proof — verify the signature, not the intermediary |
| **Provenance** | OIDC-derived evidence schema (deeply nested) | Simpler evidence model reflecting actual usage patterns |
| **Access control** | Platform-enforced role checks | Per-credential `termsOfUse` + participation credential presentation |
| **Interoperability** | REST API, platform-specific | DID documents with service endpoints, MCP-compliant API |
| **Trust** | Single platform trust | Federated trust via Trusted Issuer Registry |

## The entity graph

PDTF 2.0 decomposes the monolithic property data pack into nine distinct entities:

| Entity | Identifier | Purpose |
|--------|-----------|---------|
| **Transaction** | `did:web` | Sale metadata, status, milestones, financial context. The root of the graph. |
| **Property** | `urn:pdtf:uprn:{uprn}` | Physical property: address, features, energy, environmental data. Everything in the "logbook". |
| **Title** | `urn:pdtf:titleNumber:{number}` | Legal title: register extract, ownership type, leasehold terms, encumbrances. |
| **Person** | `did:key` | Natural person: name, contact details, verification status. Role-free. |
| **Organisation** | `did:web` | Legal entity: law firm, estate agency, lender. |
| **Ownership** | URN (generated) | Signed assertion linking a Person to a Title. Revocable. |
| **Representation** | URN (generated) | Delegated authority from seller/buyer to an Organisation. Revocable. |
| **DelegatedConsent** | URN (generated) | Authorised data access for entities like lenders. |
| **Offer** | URN (generated) | Links buyer Person(s) to Transaction with amount, status, conditions. |

The graph is **transaction-centric**: the Transaction is the root, and it references associated Property, Title, Person, Organisation, and relationship entities.

This decomposition means:

- **Property data travels with the property**, not the transaction. When a sale falls through, the next buyer inherits verified property data.
- **Each entity is independently credentialed**. An EPC credential about the Property can be verified without any knowledge of the Transaction.
- **Relationship entities are thin and revocable**. Ownership and Representation are signed assertions, not duplicated data.

[Read the full entity graph specification →](/web/specs/01-entity-graph/)

## Verifiable Credentials

Every entity in the graph is wrapped in a W3C Verifiable Credential. A credential contains:

- **The data** — the entity itself (e.g. a Property with its address, EPC rating, flood risk data)
- **The issuer** — identified by a DID, registered in the Trusted Issuer Registry
- **A cryptographic signature** — proving the data came from the issuer and hasn't been modified
- **Evidence** — provenance chain showing where the data came from
- **Terms of use** — confidentiality and access restrictions
- **Status** — a revocation endpoint for checking whether the credential is still valid

The credential format follows the W3C Verifiable Credentials Data Model v2.0 specification, using the `eddsa-jcs-2022` cryptosuite for signatures.

[Read the VC data model specification →](/web/specs/02-vc-data-model/)

## Decentralised Identifiers (DIDs)

PDTF 2.0 uses two DID methods:

- **`did:key`** — for individual persons. Derived from a cryptographic key pair, self-certifying, no external resolution needed. Ideal for users who don't control a web domain.
- **`did:web`** — for organisations, transactions, and adapters. Resolves to a DID document hosted at a well-known URL. Provides service endpoints for API access.

Each entity type has a specific identifier scheme:

| Entity | Identifier format |
|--------|------------------|
| Transaction | `did:web:example.com:transactions:{id}` |
| Property | `urn:pdtf:uprn:{uprn}` |
| Title | `urn:pdtf:titleNumber:{number}` |
| Person | `did:key:z6Mkh...` |
| Organisation | `did:web:smithandco.law` |

[Read the DID methods specification →](/web/specs/03-did-methods/)

## Trusted Issuer Registry (TIR)

The TIR answers a critical question: **who is authorised to issue which types of credentials?**

It's a public, version-controlled JSON file that maps issuer DIDs to the entity types and data paths they can credential. Each entry specifies:

- The issuer's DID
- Authorised entity:path combinations (e.g. `property:energyPerformance`, `title:registerExtract`)
- Trust level (root issuer, accredited issuer, or trusted proxy)
- Status (active, planned, deprecated, revoked)
- Proxy relationships (which root issuer a proxy is acting on behalf of)

Verifiers check the TIR as part of credential verification — confirming not just that the signature is valid, but that the issuer is authorised for this specific type of data.

[Read the TIR specification →](/web/specs/04-trusted-issuer-registry/)

## Trust evolution

The trust model evolves through three phases:

### Phase 1: Trusted proxies (current)

A small number of organisations act as trusted proxies. They connect to existing data sources (HMLR, search providers, EPC registers) and re-issue data as signed Verifiable Credentials. This requires no changes from data sources.

### Phase 2: Independent adapters

Third-party organisations build and host their own adapters, each independently registered in the TIR. Multiple issuers per credential type. No single point of failure.

### Phase 3: Primary source issuers

Data sources (HMLR, local authorities, EPC register) issue Verifiable Credentials directly. The highest trust level, no intermediaries.

## State assembly

For backward compatibility with existing systems, PDTF 2.0 provides bidirectional state assembly:

- **`composeV3StateFromGraph()`** — assembles entity-graph credentials back into the v3 monolithic format. Existing systems continue working without modification.
- **`composeV4StateFromGraph()`** — assembles entity-graph credentials into the new v4 ID-keyed format.

This means adopters can consume PDTF 2.0 credentials through either the new entity-graph model or the existing v3 format during migration.

[Read the state assembly specification →](/web/specs/07-state-assembly/)

## Credential revocation

All credentials support revocation via W3C Bitstring Status List. Each credential includes a `credentialStatus` field pointing to a publicly accessible status list. Issuers can revoke credentials at any time by flipping a bit in the list.

This is particularly critical for:

- **Ownership credentials** — when a property is sold, the previous ownership credential must be revoked
- **Representation credentials** — when a client changes solicitor, the old representation must be revoked
- **Time-sensitive data** — EPCs, search results, and other data that expires or becomes outdated

[Read the credential revocation specification →](/web/specs/14-credential-revocation/)

## Specification suite

The complete PDTF 2.0 specification is organised into focused sub-specifications:

| Spec | Title | Focus |
|------|-------|-------|
| [00](/web/specs/00-architecture-overview/) | Architecture Overview | Master reference, design decisions, trust model |
| [01](/web/specs/01-entity-graph/) | Entity Graph & Schema | Entity definitions, schemas, field mapping |
| [02](/web/specs/02-vc-data-model/) | VC Data Model | Credential format, evidence, terms of use |
| [03](/web/specs/03-did-methods/) | DID Methods & Identifiers | `did:key`, `did:web`, URN schemes |
| [04](/web/specs/04-trusted-issuer-registry/) | Trusted Issuer Registry | Registry schema, trust levels, verification |
| [06](/web/specs/06-key-management/) | Key Management | Key generation, storage, rotation |
| [07](/web/specs/07-state-assembly/) | State Assembly | Graph composition, v3 compatibility |
| [13](/web/specs/13-reference-implementations/) | Reference Implementations | Package architecture, CLI tools |
| [14](/web/specs/14-credential-revocation/) | Credential Revocation | Bitstring Status List, revocation flows |

[Browse all specifications →](/web/specs/00-architecture-overview/)
