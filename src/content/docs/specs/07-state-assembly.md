---
title: "Spec: State Assembly"
description: "How entity-level VCs compose into a complete transaction state."
---

# PDTF 2.0 — Sub-spec 07: State Assembly

**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](./00-architecture-overview.md)

---

## 1. Purpose

State assembly is the process of compositing individual Verifiable Credentials into a coherent, complete transaction state object. It is the reverse of entity decomposition: where [Sub-spec 01](./01-entity-graph.md) defines how a monolithic transaction is *decomposed* into entities and credentials, this spec defines how those credentials are *recomposed* into usable state.

This is the central read-path operation in PDTF 2.0. Every consumer of transaction data — the diligence engine, the conveyancing UI, the MCP API, the v3 backward-compatible endpoints — depends on state assembly to turn a bag of signed credentials into a structured object they can query.

### 1.1 Why Three Composers?

PDTF has three distinct data formats that must coexist during migration:

| Format | Shape | Input | Consumers |
|--------|-------|-------|-----------|
| **v1/v3 claims** | Flat `combined.json` | `pathKey:value` verified claims | Existing DE, existing API, all current consumers |
| **v3 from graph** | Flat `combined.json` (identical output) | Entity graph VCs | Same consumers, new input pipeline |
| **v4 entity-based** | ID-keyed entity maps | Entity graph VCs | New internal handlers, future API |

The three composition functions produce these three formats. During migration, they run in parallel to validate correctness before any cutover.

### 1.2 Key Decisions

| Decision | Reference | Status |
|----------|-----------|--------|
| Dual state assembly (v3 + v4 composers) | D10 | ✅ Confirmed |
| ID-keyed collections in v4 | D15 | ✅ Confirmed |
| Sparse objects + dependency pruning | D5 | 🟡 Needs LMS consensus |

---

## 2. The Three Composition Functions

### 2.1 `composeStateFromClaims` (Existing — v1/v3)

The current production composer. Takes pathKey:value verified claims and assembles them into a flat `combined.json` state using REPLACE semantics.

**Signature:**
```typescript
function composeStateFromClaims(
  claims: VerifiedClaim[]
): CombinedStateV3
```

**Semantics:**
- Each claim has a `claimPath` (e.g. `/propertyPack/heating/heatingSystem/heatingType`) and a `claimValue`
- Claims are applied in order (sorted by timestamp)
- Later claims REPLACE earlier claims at the same path — no merging, no pruning
- The output is the familiar v3 `combined.json` shape

**No changes.** This function continues to power all existing v3 endpoints. It is the baseline against which `composeV3StateFromGraph` is validated.

**Known limitation:** REPLACE semantics leave stale dependent data. If `heatingType` changes from "Central heating" to "None", the `centralHeatingDetails` object still exists in the composed state because no claim explicitly removed it. Consumers must be aware of schema discriminators to interpret correctly. This is the core motivation for dependency pruning in v2.

### 2.2 `composeV4StateFromGraph` (New — Entity-Based)

The new primary composer. Takes entity graph VCs and produces v4 entity-based state with ID-keyed maps, sparse object merging, and dependency pruning.

**Signature:**
```typescript
function composeV4StateFromGraph(
  credentials: VerifiableCredential[],
  schemas: EntitySchemaMap,
  options?: CompositionOptions
): ComposedStateV4
```

**Semantics:**
- Credentials are grouped by `credentialSubject.id` (entity identifier)
- Within each entity, credentials are sorted by `validFrom` (latest wins for conflicts)
- `credentialSubject` sparse objects are deep-merged
- A schema-aware dependency pruning pass removes stale dependent data
- The output is the v4 shape: ID-keyed maps of entities (see §4)

**This is the target state.** All new internal consumers should migrate to v4 state.

### 2.3 `composeV3StateFromGraph` (New — Backward Compatible)

The bridge composer. Takes entity graph VCs, composes v4 state internally, then transforms it back to v3 `combined.json` shape.

**Signature:**
```typescript
function composeV3StateFromGraph(
  credentials: VerifiableCredential[],
  schemas: EntitySchemaMap,
  options?: CompositionOptions
): CombinedStateV3
```

**Semantics:**
- Internally calls `composeV4StateFromGraph` to produce v4 state
- Applies collection conversion rules (§10) to flatten ID-keyed maps back to arrays
- Reassigns fields that moved between entities (§5.4)
- Output MUST be identical to `composeStateFromClaims` for the same underlying data

**This is the validation bridge.** During Phase 2 migration, both `composeStateFromClaims` and `composeV3StateFromGraph` run in parallel. Their outputs are diffed. Any discrepancy is a bug.

---

## 3. Entity Graph Input

### 3.1 What the Composer Receives

The composer's input is a set of Verifiable Credentials associated with a transaction. Each VC targets a specific entity via `credentialSubject.id`:

```json
[
  {
    "type": ["VerifiableCredential", "PropertyCredential"],
    "issuer": "did:web:adapters.propdata.org.uk:epc",
    "validFrom": "2026-03-20T10:00:00Z",
    "credentialSubject": {
      "id": "urn:pdtf:uprn:100023456789",
      "energyEfficiency": {
        "certificate": {
          "currentEnergyRating": "C",
          "currentEnergyEfficiency": 72
        }
      }
    },
    "proof": { "..." : "..." }
  },
  {
    "type": ["VerifiableCredential", "PropertyCredential"],
    "issuer": "did:key:z6Mkh...seller",
    "validFrom": "2026-03-21T14:30:00Z",
    "credentialSubject": {
      "id": "urn:pdtf:uprn:100023456789",
      "heating": {
        "heatingSystem": {
          "heatingType": "Central heating",
          "centralHeatingDetails": {
            "fuelType": "Mains gas",
            "boilerAge": "3-6 years old"
          }
        }
      }
    },
    "proof": { "..." : "..." }
  },
  {
    "type": ["VerifiableCredential", "TitleCredential"],
    "issuer": "did:web:adapters.propdata.org.uk:hmlr",
    "validFrom": "2026-03-19T08:00:00Z",
    "credentialSubject": {
      "id": "urn:pdtf:titleNumber:AB12345",
      "registerExtract": {
        "titleNumber": "AB12345",
        "tenure": "Freehold",
        "proprietorship": {
          "owners": ["Jane Smith"]
        }
      }
    },
    "proof": { "..." : "..." }
  }
]
```

### 3.2 Credential Properties Relevant to Assembly

| Property | Role in Assembly |
|----------|-----------------|
| `credentialSubject.id` | Groups credential to entity — the entity identifier (DID or URN) |
| `credentialSubject.*` | The sparse data to merge into entity state |
| `issuer` | Determines trust level via TIR lookup (§7) |
| `validFrom` | Temporal ordering — latest wins for conflicting paths |
| `type` | Entity type classification (PropertyCredential, TitleCredential, etc.) |
| `credentialStatus` | Revocation check — revoked credentials are excluded from assembly |
| `proof` | Signature verification — invalid signatures are excluded |

### 3.3 Pre-Assembly Filtering

Before composition begins, credentials are filtered:

1. **Signature verification** — invalid proofs are rejected
2. **Revocation check** — revoked credentials (Bitstring Status List) are excluded
3. **Expiry check** — credentials past `validUntil` are excluded
4. **TIR lookup** — issuer must be listed in the Trusted Issuer Registry for the entity:path combinations they claim

Only credentials passing all four checks enter the composition pipeline.

### 3.4 Entity Type Resolution

The composer must determine which entity type each credential targets. This is resolved from:

1. **`credentialSubject.id` prefix** — URN scheme reveals entity type:
   - `urn:pdtf:uprn:*` → Property
   - `urn:pdtf:titleNumber:*` / `urn:pdtf:unregisteredTitle:*` → Title
   - `urn:pdtf:ownership:*` → Ownership
   - `urn:pdtf:representation:*` → Representation
   - `urn:pdtf:consent:*` → DelegatedConsent
   - `urn:pdtf:offer:*` → Offer
   - `did:key:*` → Person
   - `did:web:*` (not transaction DID) → Organisation

2. **`type` array** — provides additional confirmation:
   - `PropertyCredential` → Property
   - `TitleCredential` → Title
   - `PersonCredential` → Person
   - `TransactionCredential` → Transaction
   - etc.

3. **Transaction DID** — credentials targeting `did:web:moverly.com:transactions:*` are Transaction credentials

---

## 4. V4 State Assembly (`composeV4StateFromGraph`)

This is the core algorithm. It takes a filtered set of VCs and produces an ID-keyed entity state.

### 4.1 Algorithm Overview

```
Input: VerifiableCredential[]
Output: ComposedStateV4

1. Group credentials by credentialSubject.id
2. For each entity group:
   a. Sort credentials by validFrom (ascending — latest applied last, so latest wins)
   b. Resolve trust levels from TIR
   c. For conflicting paths: apply conflict resolution (§7)
   d. Deep-merge credentialSubject sparse objects (in sorted order)
   e. Apply dependency pruning against entity schema (§6)
   f. Record provenance (which VC contributed which paths)
3. Assemble entity groups into ID-keyed maps by entity type
4. Return composed v4 state
```

### 4.2 Step-by-Step Example

Consider a Property entity (`urn:pdtf:uprn:100023456789`) with three VCs arriving over time.

**VC 1 — EPC adapter (trusted proxy), issued 2026-03-18:**
```json
{
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-18T10:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "1234-5678-9012-3456-7890",
        "currentEnergyRating": "D",
        "currentEnergyEfficiency": 58,
        "potentialEnergyRating": "C",
        "potentialEnergyEfficiency": 75,
        "lodgementDate": "2023-06-15"
      }
    }
  }
}
```

**VC 2 — Seller (account provider), issued 2026-03-20:**
```json
{
  "issuer": "did:key:z6Mkh...seller",
  "validFrom": "2026-03-20T14:30:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "heating": {
      "heatingSystem": {
        "heatingType": "Central heating",
        "centralHeatingDetails": {
          "fuelType": "Mains gas",
          "boilerAge": "3-6 years old"
        }
      }
    },
    "address": {
      "line1": "42 Oak Lane",
      "town": "Peebles",
      "postcode": "EH45 8AB"
    }
  }
}
```

**VC 3 — Updated EPC (trusted proxy), issued 2026-03-22:**
```json
{
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-22T09:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "9876-5432-1098-7654-3210",
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "potentialEnergyRating": "B",
        "potentialEnergyEfficiency": 84,
        "lodgementDate": "2026-03-21"
      }
    }
  }
}
```

**Assembly process:**

**Step 1 — Group by entity ID:**
All three target `urn:pdtf:uprn:100023456789` → one entity group.

**Step 2a — Sort by validFrom:**
VC 1 (2026-03-18) → VC 2 (2026-03-20) → VC 3 (2026-03-22)

**Step 2b — Resolve trust levels:**
- VC 1: `adapters.propdata.org.uk:epc` → TIR lookup → `trustedProxy` for `Property:/energyEfficiency/*`
- VC 2: `did:key:z6Mkh...seller` → TIR lookup → `accountProvider` (user attestation)
- VC 3: `adapters.propdata.org.uk:epc` → TIR lookup → `trustedProxy` for `Property:/energyEfficiency/*`

**Step 2c — Conflict resolution:**
VC 1 and VC 3 both claim `energyEfficiency.certificate.*`. Same trust level (trustedProxy), so latest validFrom wins. VC 3 supersedes VC 1 for all `energyEfficiency` paths.

**Step 2d — Deep merge (applied in sorted order):**

After VC 1:
```json
{
  "id": "urn:pdtf:uprn:100023456789",
  "energyEfficiency": {
    "certificate": {
      "certificateNumber": "1234-5678-9012-3456-7890",
      "currentEnergyRating": "D",
      "currentEnergyEfficiency": 58,
      "potentialEnergyRating": "C",
      "potentialEnergyEfficiency": 75,
      "lodgementDate": "2023-06-15"
    }
  }
}
```

After VC 2 (merge — no conflicts, different paths):
```json
{
  "id": "urn:pdtf:uprn:100023456789",
  "energyEfficiency": {
    "certificate": {
      "certificateNumber": "1234-5678-9012-3456-7890",
      "currentEnergyRating": "D",
      "currentEnergyEfficiency": 58,
      "potentialEnergyRating": "C",
      "potentialEnergyEfficiency": 75,
      "lodgementDate": "2023-06-15"
    }
  },
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating",
      "centralHeatingDetails": {
        "fuelType": "Mains gas",
        "boilerAge": "3-6 years old"
      }
    }
  },
  "address": {
    "line1": "42 Oak Lane",
    "town": "Peebles",
    "postcode": "EH45 8AB"
  }
}
```

After VC 3 (merge — overwrites energyEfficiency from VC 1):
```json
{
  "id": "urn:pdtf:uprn:100023456789",
  "energyEfficiency": {
    "certificate": {
      "certificateNumber": "9876-5432-1098-7654-3210",
      "currentEnergyRating": "C",
      "currentEnergyEfficiency": 72,
      "potentialEnergyRating": "B",
      "potentialEnergyEfficiency": 84,
      "lodgementDate": "2026-03-21"
    }
  },
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating",
      "centralHeatingDetails": {
        "fuelType": "Mains gas",
        "boilerAge": "3-6 years old"
      }
    }
  },
  "address": {
    "line1": "42 Oak Lane",
    "town": "Peebles",
    "postcode": "EH45 8AB"
  }
}
```

**Step 2e — Dependency pruning:**
Schema check: `heatingType` = "Central heating" → `centralHeatingDetails` is valid. No pruning needed.

**Step 2f — Provenance record:**
```json
{
  "energyEfficiency.certificate": {
    "vcId": "vc-3-id",
    "issuer": "did:web:adapters.propdata.org.uk:epc",
    "trustLevel": "trustedProxy",
    "validFrom": "2026-03-22T09:00:00Z"
  },
  "heating": {
    "vcId": "vc-2-id",
    "issuer": "did:key:z6Mkh...seller",
    "trustLevel": "accountProvider",
    "validFrom": "2026-03-20T14:30:00Z"
  },
  "address": {
    "vcId": "vc-2-id",
    "issuer": "did:key:z6Mkh...seller",
    "trustLevel": "accountProvider",
    "validFrom": "2026-03-20T14:30:00Z"
  }
}
```

### 4.3 Deep Merge Semantics

The merge algorithm operates on sparse JSON objects:

```typescript
function deepMerge(target: object, source: object): object {
  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      // Recursive merge for nested objects
      target[key] = deepMerge(target[key], source[key]);
    } else {
      // Scalar, array, or null: replace entirely
      target[key] = source[key];
    }
  }
  return target;
}
```

**Rules:**
- **Objects merge recursively** — keys from the source are applied into the target
- **Scalars replace** — a new value at a leaf path overwrites the old value
- **Arrays replace entirely** — arrays are treated as atomic values (no element-level merge)
- **`null` replaces** — explicitly setting a value to `null` clears it
- **Missing keys are preserved** — if the source doesn't mention a key, the target's value survives

**Why arrays replace:** Arrays in the PDTF schema are value lists (rooms, recommendations, fixtures), not entity collections. Entity collections are ID-keyed maps in v4. There is no meaningful element-level merge for value arrays — if the list changes, the whole list changes.

### 4.4 V4 Output Shape

The composed v4 state follows the structure defined in [Sub-spec 01 §6](./01-entity-graph.md):

```json
{
  "transactionId": "did:web:moverly.com:transactions:abc123",
  "status": "Active",
  "saleContext": {
    "numberOfSellers": 2,
    "outstandingMortgage": "Yes",
    "existingLender": "Nationwide"
  },
  "milestones": { "..." : "..." },

  "properties": {
    "urn:pdtf:uprn:100023456789": {
      "address": { "line1": "42 Oak Lane", "town": "Peebles", "postcode": "EH45 8AB" },
      "energyEfficiency": { "..." : "..." },
      "heating": { "..." : "..." },
      "searches": {
        "search-env-001": { "..." : "..." },
        "search-llc-002": { "..." : "..." }
      }
    }
  },

  "titles": {
    "urn:pdtf:titleNumber:AB12345": {
      "registerExtract": { "..." : "..." },
      "ownership": { "ownershipType": "Freehold" }
    }
  },

  "persons": {
    "did:key:z6Mkh...seller1": { "name": { "first": "Jane", "last": "Smith" } },
    "did:key:z6Mkh...seller2": { "name": { "first": "John", "last": "Smith" } },
    "did:key:z6Mkh...buyer":   { "name": { "first": "Alice", "last": "Brown" } }
  },

  "organisations": {
    "did:web:smithandco.law": { "name": "Smith & Co Solicitors", "type": "lawFirm" },
    "did:web:acmeestates.co.uk": { "name": "Acme Estates", "type": "estateAgency" }
  },

  "ownership": {
    "urn:pdtf:ownership:own-1": {
      "personId": "did:key:z6Mkh...seller1",
      "titleId": "urn:pdtf:titleNumber:AB12345",
      "status": "verified"
    },
    "urn:pdtf:ownership:own-2": {
      "personId": "did:key:z6Mkh...seller2",
      "titleId": "urn:pdtf:titleNumber:AB12345",
      "status": "verified"
    }
  },

  "representation": {
    "urn:pdtf:representation:rep-1": {
      "organisationId": "did:web:smithandco.law",
      "role": "sellerConveyancer",
      "issuedBy": "did:key:z6Mkh...seller1"
    },
    "urn:pdtf:representation:rep-2": {
      "organisationId": "did:web:acmeestates.co.uk",
      "role": "estateAgent",
      "issuedBy": "did:key:z6Mkh...seller1"
    }
  },

  "delegatedConsent": {},

  "offers": {
    "urn:pdtf:offer:off-1": {
      "buyerIds": ["did:key:z6Mkh...buyer"],
      "amount": 450000,
      "currency": "GBP",
      "status": "Accepted"
    }
  },

  "enquiries": {},

  "_provenance": {
    "urn:pdtf:uprn:100023456789": {
      "energyEfficiency.certificate": {
        "vcId": "vc-epc-003",
        "issuer": "did:web:adapters.propdata.org.uk:epc",
        "trustLevel": "trustedProxy",
        "validFrom": "2026-03-22T09:00:00Z"
      }
    }
  }
}
```

### 4.5 The `_provenance` Sidecar

The provenance map is not part of the PDTF schema — it's metadata about the composition. It records, for each entity and path, which VC contributed that data. This enables:

- **Audit trail** — which adapter or user provided each piece of data
- **Trust display** — UI can show trust level badges per field
- **Conflict debugging** — when data seems wrong, provenance shows where it came from
- **Selective re-verification** — re-fetch only the VCs that contributed specific paths

The provenance map is keyed by entity ID, then by JSON path within that entity. Each entry records the VC ID, issuer, trust level, and issuance timestamp.

---

## 5. V3 State Assembly (`composeV3StateFromGraph`)

### 5.1 Purpose

The v3 composer exists to maintain backward compatibility during migration. It produces the exact same `combined.json` shape that `composeStateFromClaims` produces, but from entity graph VCs instead of pathKey:value claims.

This is critical because:
- The diligence engine evaluates paths against v3 state
- All existing API consumers expect v3 shape
- Overlays and form mappings reference v3 paths
- The v3 composer validates the entire v4 pipeline — if v3 output matches, the entity decomposition and recomposition are correct

### 5.2 Algorithm

```
Input: VerifiableCredential[]
Output: CombinedStateV3

1. Compose v4 state: v4State = composeV4StateFromGraph(credentials, schemas)
2. Convert v4 → v3:
   a. Convert ID-keyed maps to arrays (§10)
   b. Reassign fields across entity boundaries (§5.4)
   c. Rebuild participants array from persons + organisations + relationships (§5.3)
   d. Flatten properties map to propertyPack (single property assumed for v3)
   e. Flatten titles map to propertyPack.titlesToBeSold array
3. Return v3 combined state
```

### 5.3 Participant Reconstruction

The most complex transformation. V4 decomposes v3's `participants[]` array into five separate entity types. The v3 composer must reconstruct participants from them.

**V4 entities involved:**
- `persons{}` — identity data (name, contact, address)
- `organisations{}` — firm data (name, type)
- `ownership{}` — links person → title (seller role)
- `representation{}` — links organisation → transaction (professional role)
- `offers{}` — links person → transaction (buyer role)

**Reconstruction algorithm:**

```typescript
function reconstructParticipants(v4State: ComposedStateV4): Participant[] {
  const participants: Participant[] = [];

  // 1. Sellers — persons with Ownership credentials
  for (const [ownId, ownership] of Object.entries(v4State.ownership)) {
    const person = v4State.persons[ownership.personId];
    if (!person) continue;

    participants.push({
      ...person,
      role: "Seller",
      participantStatus: mapOwnershipStatus(ownership.status),
      // Preserve the ownership credential ID for round-trip
      _ownershipId: ownId
    });
  }

  // 2. Representatives — organisations with Representation credentials
  for (const [repId, representation] of Object.entries(v4State.representation)) {
    const org = v4State.organisations[representation.organisationId];
    if (!org) continue;

    participants.push({
      ...flattenOrgToParticipant(org),
      role: mapRepresentationRole(representation.role),
      participantStatus: "Active",
      _representationId: repId
    });
  }

  // 3. Buyers — persons referenced by accepted/pending Offers
  for (const [offerId, offer] of Object.entries(v4State.offers)) {
    for (const buyerId of offer.buyerIds || []) {
      const person = v4State.persons[buyerId];
      if (!person) continue;

      participants.push({
        ...person,
        role: offer.status === "Accepted" ? "Buyer" : "Prospective Buyer",
        offerId: offerId,
        participantStatus: mapOfferStatus(offer.status)
      });
    }
  }

  // 4. Delegated consent entities (lenders, etc.)
  for (const [dcId, consent] of Object.entries(v4State.delegatedConsent)) {
    const org = v4State.organisations[consent.organisationId];
    if (!org) continue;

    participants.push({
      ...flattenOrgToParticipant(org),
      role: "Lender", // Or derive from consent.purpose
      participantStatus: "Active",
      _consentId: dcId
    });
  }

  return participants;
}
```

**Role mapping (v4 → v3):**

| V4 Representation Role | V3 Participant Role |
|------------------------|-------------------|
| `sellerConveyancer` | `Seller's Conveyancer` |
| `buyerConveyancer` | `Buyer's Conveyancer` |
| `estateAgent` | `Estate Agent` |
| `buyerAgent` | `Buyer's Agent` |
| `surveyor` | `Surveyor` |
| `mortgageBroker` | `Mortgage Broker` |

### 5.4 Field Reassignment (V4 → V3)

Several fields moved between entities in the v4 restructuring. The v3 composer must move them back:

**Transaction → Property (v4 → v3):**
```
v4: transaction.saleContext.numberOfSellers
v3: propertyPack.ownership.numberOfSellers

v4: transaction.saleContext.numberOfNonUkResidentSellers
v3: propertyPack.ownership.numberOfNonUkResidentSellers

v4: transaction.saleContext.outstandingMortgage
v3: propertyPack.ownership.outstandingMortgage

v4: transaction.saleContext.existingLender
v3: propertyPack.ownership.existingLender

v4: transaction.saleContext.hasHelpToBuyEquityLoan
v3: propertyPack.ownership.hasHelpToBuyEquityLoan

v4: transaction.saleContext.isLimitedCompanySale
v3: propertyPack.ownership.isLimitedCompanySale
```

**Title → Property (v4 → v3):**
```
v4: titles[titleUrn].ownership.ownershipType
v3: propertyPack.ownership.ownershipsToBeTransferred[i].ownershipType

v4: titles[titleUrn].ownership.{leaseholdDetails}
v3: propertyPack.ownership.ownershipsToBeTransferred[i].{leaseholdDetails}

v4: titles[titleUrn].isFirstRegistration
v3: propertyPack.ownership.isFirstRegistration
```

**Transaction → Property (seller confirmations):**
```
v4: transaction.sellerConfirmations.accuracy
v3: propertyPack.confirmationOfAccuracyByOwners

v4: transaction.sellerConfirmations.saleReady
v3: propertyPack.saleReadyDeclarations

v4: transaction.completion
v3: propertyPack.completionAndMoving
```

### 5.5 Property Flattening

V4 wraps properties in an ID-keyed map. V3 expects a flat `propertyPack`:

```typescript
function flattenProperties(v4State: ComposedStateV4): object {
  const propertyIds = Object.keys(v4State.properties);

  if (propertyIds.length === 0) {
    return {};
  }

  // V3 assumes single property — take the first (or only)
  // Multi-property support is a v4-only concern
  const primaryProperty = v4State.properties[propertyIds[0]];
  const uprn = propertyIds[0].replace('urn:pdtf:uprn:', '');

  return {
    ...primaryProperty,
    uprn: uprn,
    // titlesToBeSold array injected separately (§5.6)
    // ownership fields injected from saleContext + titles (§5.4)
  };
}
```

### 5.6 Title Array Reconstruction

V4 titles are an ID-keyed map. V3 expects `propertyPack.titlesToBeSold[]`:

```typescript
function reconstructTitlesArray(v4State: ComposedStateV4): object[] {
  return Object.entries(v4State.titles).map(([titleUrn, title]) => {
    const titleNumber = titleUrn.replace('urn:pdtf:titleNumber:', '');
    return {
      titleNumber: titleNumber,
      titleExtents: title.titleExtents,
      registerExtract: title.registerExtract,
      additionalDocuments: title.additionalDocuments
      // ownership.ownershipType etc. → separate ownershipsToBeTransferred array
    };
  });
}
```

### 5.7 Validation: v3 Output Comparison

The critical correctness check:

```typescript
async function validateComposers(
  claims: VerifiedClaim[],
  credentials: VerifiableCredential[],
  schemas: EntitySchemaMap
): Promise<ValidationResult> {
  const v3FromClaims = composeStateFromClaims(claims);
  const v3FromGraph  = composeV3StateFromGraph(credentials, schemas);

  const diff = deepDiff(v3FromClaims, v3FromGraph);

  if (diff.length === 0) {
    return { valid: true };
  }

  return {
    valid: false,
    discrepancies: diff.map(d => ({
      path: d.path,
      fromClaims: d.left,
      fromGraph: d.right,
      analysis: classifyDiscrepancy(d)
    }))
  };
}
```

**Expected discrepancy categories:**
- **Pruning improvements** — v3-from-graph may correctly prune stale dependent data that v3-from-claims preserves (this is a feature, not a bug — but must be tracked)
- **Ordering differences** — array ordering may differ if v3-from-claims relies on claim insertion order
- **Null handling** — sparse object merge may handle absent-vs-null differently

During Phase 2, discrepancies are logged and triaged. The goal is zero *unexpected* discrepancies before Phase 3 cutover.

---

## 6. Dependency Pruning

### 6.1 The Problem

When a discriminator value changes, dependent branches become stale. With REPLACE semantics (v1/v3), stale data is never cleaned up — it persists silently in the composed state.

**Example — Heating:**

1. Seller fills in BASPI form: `heatingType` = "Central heating", plus `centralHeatingDetails` (fuel type, boiler age, etc.)
2. Seller later corrects: `heatingType` = "None" (the property has no heating)
3. In v1: both claims exist. The composed state has `heatingType: "None"` AND `centralHeatingDetails: { fuelType: "Mains gas", ... }`. These are contradictory but nothing cleans up the stale data.

**Example — Planning:**

1. Seller answers: `planningPermissionRequired` = "Yes"
2. Seller fills in: `planningPermissionDetails` = { ... }
3. Seller corrects: `planningPermissionRequired` = "No"
4. In v1: `planningPermissionRequired: "No"` coexists with `planningPermissionDetails: { ... }`

### 6.2 The Solution: Schema-Aware Pruning

After deep-merging all VCs for an entity, the composer performs a pruning pass that walks the entity schema and removes branches that are no longer valid given the current discriminator values.

**Definition:** A *discriminator* is a JSON Schema construct that makes the validity of one set of fields conditional on the value of another field. In JSON Schema, these are expressed through:

- `oneOf` / `anyOf` with discriminating properties
- `if` / `then` / `else` conditional schemas
- `dependencies` (property dependencies)
- `allOf` with conditional sub-schemas

### 6.3 Pruning Algorithm

```typescript
function applyDependencyPruning(
  entity: object,
  schema: JSONSchema
): object {
  // 1. Walk the schema to build a dependency graph
  const depGraph = buildDependencyGraph(schema);

  // 2. For each discriminator in the graph:
  for (const discriminator of depGraph.discriminators) {
    const currentValue = getValueAtPath(entity, discriminator.path);

    if (currentValue === undefined) continue;

    // 3. Find which branch is active for the current value
    const activeBranch = discriminator.branches.find(
      b => b.matchesValue(currentValue)
    );

    // 4. Prune all inactive branches
    for (const branch of discriminator.branches) {
      if (branch === activeBranch) continue;

      for (const dependentPath of branch.dependentPaths) {
        deleteAtPath(entity, dependentPath);
      }
    }
  }

  return entity;
}
```

### 6.4 Building the Dependency Graph

The dependency graph is extracted from the JSON Schema at startup (not per-request). It maps discriminator fields to their dependent branches:

```typescript
interface DependencyGraph {
  discriminators: Discriminator[];
}

interface Discriminator {
  /** Path to the discriminator field */
  path: string;
  /** The branches this discriminator controls */
  branches: Branch[];
}

interface Branch {
  /** Values that activate this branch */
  values: any[];
  /** Paths that are only valid when this branch is active */
  dependentPaths: string[];
  /** Check if a value matches this branch */
  matchesValue(value: any): boolean;
}
```

**Example — Heating schema structure:**

```json
{
  "heatingSystem": {
    "type": "object",
    "properties": {
      "heatingType": {
        "type": "string",
        "enum": ["Central heating", "Storage heaters", "Other", "None"]
      }
    },
    "allOf": [{
      "if": {
        "properties": { "heatingType": { "const": "Central heating" } }
      },
      "then": {
        "properties": {
          "centralHeatingDetails": {
            "type": "object",
            "properties": {
              "fuelType": { "..." : "..." },
              "boilerAge": { "..." : "..." }
            }
          }
        }
      }
    }]
  }
}
```

**Extracted dependency:**
```json
{
  "path": "heating.heatingSystem.heatingType",
  "branches": [
    {
      "values": ["Central heating"],
      "dependentPaths": ["heating.heatingSystem.centralHeatingDetails"]
    },
    {
      "values": ["Storage heaters"],
      "dependentPaths": ["heating.heatingSystem.storageHeaterDetails"]
    }
  ]
}
```

### 6.5 Detailed Pruning Example

**Before pruning:**
```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "None",
      "centralHeatingDetails": {
        "fuelType": "Mains gas",
        "boilerAge": "3-6 years old",
        "boilerMake": "Worcester Bosch",
        "lastServiced": "2025-01-15"
      }
    }
  }
}
```

**Pruning pass:**
1. Discriminator: `heating.heatingSystem.heatingType`
2. Current value: `"None"`
3. Active branch: none of the defined branches match "None"
4. Inactive branches: all — including the "Central heating" branch
5. Prune: `heating.heatingSystem.centralHeatingDetails` (dependent path of "Central heating" branch)

**After pruning:**
```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "None"
    }
  }
}
```

### 6.6 Another Example — Ownership Type Discriminator

**Before pruning:**
```json
{
  "ownership": {
    "ownershipType": "Freehold",
    "leaseholdInformation": {
      "yearsRemaining": 85,
      "groundRent": 250,
      "serviceCharge": 1200,
      "managingAgent": "Premier Estates"
    }
  }
}
```

The schema has an `if/then` on `ownershipType`:
- If "Leasehold" → require `leaseholdInformation`
- If "Freehold" → `leaseholdInformation` is not applicable

**Pruning pass:**
1. Discriminator: `ownership.ownershipType`
2. Current value: `"Freehold"`
3. Active branch: Freehold (no dependent paths)
4. Prune: `ownership.leaseholdInformation` (dependent on "Leasehold" branch)

**After pruning:**
```json
{
  "ownership": {
    "ownershipType": "Freehold"
  }
}
```

### 6.7 Nested Discriminators

Discriminators can be nested. When a parent discriminator prunes a branch, any discriminators within that branch are also implicitly resolved:

```
alterationsAndChanges.planningPermission.required = "Yes"
  └── planningPermissionDetails.type = "Full planning"
        └── fullPlanningDetails.{ ... }
```

If `required` changes to "No", the pruning pass removes `planningPermissionDetails` entirely — which also removes `fullPlanningDetails` and any discriminators within it. The implementation handles this naturally because pruning deletes the entire subtree.

### 6.8 Pruning and the Diligence Engine

The diligence engine currently handles stale data by checking discriminator values in its rule definitions. With dependency pruning, the DE can rely on the composed state being clean — if a path exists, its discriminator conditions are satisfied.

**Impact on DE rules:**
- Rules that currently check `heatingType !== "None" && centralHeatingDetails` can simplify to just checking `centralHeatingDetails` (if it exists post-pruning, the heating type is compatible)
- Rules that flag contradictory state (discriminator says X but details say Y) become unnecessary — pruning prevents contradictions
- The DE migration path (Sub-spec 08) should document which rules simplify after pruning is enabled

### 6.9 Consensus Requirement (D5)

Dependency pruning changes the semantics of state assembly. It must be agreed with LMS and other implementers before deployment:

**What needs consensus:**
- The principle: "discriminator changes prune dependent branches"
- The implementation: schema-walking at startup, pruning at composition time
- The validation: pruned state passes schema validation; unpruned state may not
- The compatibility: v3-from-graph output will differ from v3-from-claims where pruning applies (these differences are *improvements*, but must be acknowledged)

**What doesn't need consensus:**
- The deep merge algorithm (standard practice)
- The conflict resolution rules (internal to Moverly initially)
- The v4 state shape (new, no backward-compat constraint)

### 6.10 Assembler Pruning Obligation (Pending Q1.1)

If incremental MERGE semantics are adopted for any credential type, the assembler MUST apply schema dependency rules to prune stale paths. Pruning rules are derived from the schema's `if/then/else` conditions and `oneOf` discriminators. Issuers are stateless and have no visibility of assembled state — they cannot be expected to clear dependent paths. The assembler is the only component with full context to apply pruning correctly.

This obligation exists because:
- Issuers assert what they know at the time of issuance — an issuer changing `heatingType` to `None` does not know that a previous credential asserted `centralHeatingDetails`
- Only the assembler sees all credentials for an entity and can evaluate which schema branches are active
- The schema's existing conditional constructs (`if/then/else`, `oneOf` discriminators) already define the dependency rules — the assembler applies them during composition

For adapter-issued credentials (EPC, title register, searches), section-level REPLACE may avoid the pruning question entirely — these issuers are authoritative for their whole subtree and re-issue complete data. For seller-attested credentials (TA6, TA7, fixtures), where data arrives incrementally, the assembler's pruning obligation is unavoidable under MERGE semantics.

---

## 7. Conflict Resolution

### 7.1 When Conflicts Occur

A conflict occurs when two or more VCs claim the same path on the same entity. For example:
- An EPC adapter VC claims `energyEfficiency.certificate.currentEnergyRating = "C"`
- A seller VC also claims `energyEfficiency.certificate.currentEnergyRating = "D"`

The composer must decide which value wins.

### 7.2 Trust Level Ordering

The primary resolution mechanism is trust level, defined by the Trusted Issuer Registry:

```
rootIssuer > trustedProxy > accountProvider
```

| Trust Level | Description | Example Issuers |
|------------|-------------|-----------------|
| `rootIssuer` | Primary data source — the authority itself | HMLR, MHCLG (EPC), Environment Agency, VOA |
| `trustedProxy` | Adapter that fetches from the primary source and signs | Moverly HMLR adapter, Moverly EPC adapter |
| `accountProvider` | User-attested data via a platform account | Moverly (on behalf of sellers/buyers) |

**Rule:** A credential from a higher trust level always wins, regardless of timestamp.

### 7.3 Temporal Resolution (Same Trust Level)

When two VCs have the same trust level, the later `validFrom` wins:

```typescript
function resolveConflict(vc1: VC, vc2: VC, tir: TIR): VC {
  const trust1 = tir.getTrustLevel(vc1.issuer);
  const trust2 = tir.getTrustLevel(vc2.issuer);

  // Higher trust level wins
  if (trustRank(trust1) > trustRank(trust2)) return vc1;
  if (trustRank(trust2) > trustRank(trust1)) return vc2;

  // Same trust level: latest validFrom wins
  if (vc1.validFrom > vc2.validFrom) return vc1;
  if (vc2.validFrom > vc1.validFrom) return vc2;

  // Absolute tie: deterministic tiebreaker (e.g. VC ID lexicographic)
  return vc1.id < vc2.id ? vc1 : vc2;
}

function trustRank(level: string): number {
  switch (level) {
    case 'rootIssuer': return 3;
    case 'trustedProxy': return 2;
    case 'accountProvider': return 1;
    default: return 0;
  }
}
```

### 7.4 Path-Level vs VC-Level Resolution

Conflict resolution operates at the **path level**, not the VC level. A single VC may contain data at multiple paths, and different paths from that VC may have different conflict outcomes:

```
VC from EPC adapter (trustedProxy):
  energyEfficiency.certificate.currentEnergyRating = "C"   ← wins (higher trust)
  address.postcode = "EH45 8AB"                             ← loses (not authorised for address)

VC from seller (accountProvider):
  energyEfficiency.certificate.currentEnergyRating = "D"    ← loses
  address.postcode = "EH45 8AB"                             ← wins (authorised for address paths)
```

The TIR's `authorisedPaths` determine whether an issuer is even *permitted* to claim a given path. Claims outside an issuer's authorised paths are ignored during assembly (they can still be stored for audit, but don't contribute to composed state).

### 7.5 Provenance Tracking

Every path in the composed state is annotated with its provenance — which VC contributed it and why:

```json
{
  "path": "energyEfficiency.certificate.currentEnergyRating",
  "value": "C",
  "source": {
    "vcId": "urn:uuid:epc-vc-2026-03-22",
    "issuer": "did:web:adapters.propdata.org.uk:epc",
    "trustLevel": "trustedProxy",
    "validFrom": "2026-03-22T09:00:00Z"
  },
  "superseded": [
    {
      "vcId": "urn:uuid:epc-vc-2026-03-18",
      "issuer": "did:web:adapters.propdata.org.uk:epc",
      "trustLevel": "trustedProxy",
      "validFrom": "2026-03-18T10:00:00Z",
      "reason": "superseded_by_later_vc"
    }
  ]
}
```

The `superseded` array provides a full audit trail. For most paths, it will be empty (single source). For contested paths, it records every VC that attempted to claim that path and why it lost.

### 7.6 Conflict Alerting

Some conflicts should be flagged rather than silently resolved:

- **Trust level conflicts** — a seller claims a different EPC rating than the EPC adapter. The adapter wins, but the discrepancy should be logged.
- **Stale data** — a VC with `validFrom` more than N days old is superseded by a much newer VC. May indicate the old data was never updated.
- **Multi-issuer conflicts** — two different trusted proxies claim the same path with different values. This shouldn't happen (TIR authorisedPaths should prevent it) but must be detected.

These alerts feed into the diligence engine's quality assessment layer.

---

## 8. Migration Path

### 8.1 Phase 1: `composeStateFromClaims` (Current)

**Status:** Production. No changes.

The existing composer continues to power all v3 endpoints. Claims flow in via the current OIDC verified claims pipeline, and the composer aggregates them with REPLACE semantics.

```
Claims DB → composeStateFromClaims() → v3 combined state → API / DE / UI
```

### 8.2 Phase 2: `composeV3StateFromGraph` (Parallel Validation)

**Goal:** Prove that the entity graph pipeline produces identical output to the claims pipeline.

```
Claims DB → composeStateFromClaims() → v3 state (primary) ──→ API / DE / UI
                                                              ↑ compare
Entity VCs → composeV3StateFromGraph() → v3 state (shadow) ──┘
```

**Steps:**
1. Deploy `composeV3StateFromGraph` in shadow mode — it runs but its output is not served
2. For each transaction state request, run both composers
3. Diff the outputs using `validateComposers()` (§5.7)
4. Log discrepancies, triage into:
   - **Pruning improvements** — expected, beneficial, track separately
   - **Ordering differences** — normalise and recheck
   - **Genuine bugs** — fix in the graph composer
5. Target: zero unexpected discrepancies for 30 days
6. Cutover: `composeV3StateFromGraph` becomes primary, `composeStateFromClaims` becomes shadow
7. Deprecate `composeStateFromClaims` after confidence period

**Duration estimate:** 2–4 months of parallel running, depending on discrepancy volume.

### 8.3 Phase 3: `composeV4StateFromGraph` (New Consumers)

**Goal:** Migrate internal consumers to v4 entity-based state.

```
Entity VCs → composeV4StateFromGraph() → v4 state ──→ New internal handlers
           ↘                                          
            composeV3StateFromGraph() → v3 state ──→ External API / legacy DE
```

**Steps:**
1. Identify internal consumers that can benefit from v4 state (entity-aware operations)
2. Migrate handlers one by one, starting with lowest-risk
3. External v3 API continues to use `composeV3StateFromGraph` indefinitely
4. New API endpoints (v2 API, MCP) serve v4 state directly

**Consumer migration order (suggested):**
1. Transaction summary / dashboard (low risk, read-only)
2. Document generation (benefits from entity structure)
3. MCP API endpoints (new, designed for v4)
4. Diligence engine (highest impact, most complex — see Sub-spec 08)

### 8.4 Validation Strategy

```
┌─────────────────────┐     ┌──────────────────────┐
│ composeStateFromClaims │    │ composeV3StateFromGraph │
│ (pathKey:value input)  │    │ (entity VC input)       │
└──────────┬────────────┘    └──────────┬─────────────┘
           │ v3 output                   │ v3 output
           ▼                             ▼
     ┌─────────────────────────────────────┐
     │        Deep Diff Comparator         │
     │                                     │
     │  • Structural identity check        │
     │  • Path-level value comparison      │
     │  • Array ordering normalisation     │
     │  • Expected-discrepancy whitelist   │
     │  • Pruning-improvement tracking     │
     └──────────┬──────────────────────────┘
                │
                ▼
     ┌──────────────────────┐
     │   Discrepancy Log    │
     │                      │
     │  zero unexpected     │
     │  = ready for cutover │
     └──────────────────────┘
```

---

## 9. Existing Code

### 9.1 `decomposeSchema.js` (Branch 263)

The schema extraction utility (576 lines) on branch `263-extract-separate-entity-schemas-from-combinedjson-in-preparation-for-pdtf-20` handles the forward direction: extracting entity schemas from the combined schema.

**Key functions:**
- Schema walking and path extraction
- Entity boundary detection
- Reference resolution (`$ref` handling)
- Overlay-aware extraction (respects form-specific overlays)

This is the *schema* decomposition. State assembly is the *data* composition — the reverse direction operating on credential payloads rather than schemas.

### 9.2 `composeStateFromGraph.js` (To Be Built)

The implementation of the algorithms in this spec. Located in the `@pdtf/schemas` package alongside `decomposeSchema.js`.

**Planned modules:**

| Module | Description | Estimated Size |
|--------|-------------|---------------|
| `composeV4StateFromGraph.js` | Core v4 composer (§4) | ~300 lines |
| `composeV3StateFromGraph.js` | V3 bridge composer (§5) | ~400 lines |
| `dependencyPruning.js` | Schema-aware pruning (§6) | ~250 lines |
| `conflictResolution.js` | Trust-level and temporal resolution (§7) | ~150 lines |
| `collectionConversion.js` | Array↔map conversion rules (§10) | ~200 lines |
| `provenanceTracker.js` | Path-level provenance recording (§4.5) | ~100 lines |

**Total estimate:** ~1,400 lines of implementation code, plus tests.

### 9.3 Relationship to `decomposeSchema.js`

The two utilities are complementary:

```
decomposeSchema.js (existing)
  Input:  v4/combined.json (schema)
  Output: Entity JSON Schemas (Property.json, Title.json, etc.)
  Purpose: Define the shape of credentialSubject for each entity type

composeStateFromGraph.js (new)
  Input:  Verifiable Credentials (data instances conforming to entity schemas)
  Output: Composed state (v4 or v3 format)
  Purpose: Assemble data from multiple VCs into a single queryable state
```

The entity schemas generated by `decomposeSchema.js` are used by `composeStateFromGraph.js` for:
- Entity type resolution (which schema does this VC conform to?)
- Dependency graph extraction (which fields are discriminators?)
- Validation (does the composed state pass schema validation?)

---

## 10. Collection Conversion Rules

### 10.1 Overview

V4 uses ID-keyed maps for entity collections. V3 uses arrays. The v3 composer must convert between them. The v4 composer receives VCs targeting individual entities by ID, so maps are the natural output.

### 10.2 Collections Already ID-Keyed (No Conversion Needed)

These collections are already ID-keyed in v3 and remain so in v4:

| Collection | V3 Key Type | V4 Key Type | Notes |
|-----------|-------------|-------------|-------|
| `offers` | String key | `urn:pdtf:offer:{key}` | Wrap existing key in URN |
| `enquiries` | String key | Preserved | No change |
| `externalIds` | Pattern map | Pattern map | No change |

### 10.3 Collections Requiring Conversion

These collections change from arrays (v3) to ID-keyed maps (v4):

#### 10.3.1 Participants → Multiple Entity Types

The most complex conversion. V3's `participants[]` explodes into five v4 entity types:

```
V3: participants[] (mixed array of all participant types)
    ↕
V4: persons{}            — keyed by did:key
    organisations{}      — keyed by did:web
    ownership{}          — keyed by urn:pdtf:ownership:*
    representation{}     — keyed by urn:pdtf:representation:*
    delegatedConsent{}   — keyed by urn:pdtf:consent:*
```

**V3 → V4 (decomposition):**
```typescript
function decomposeParticipants(
  participants: V3Participant[]
): { persons, organisations, ownership, representation, delegatedConsent } {
  const result = {
    persons: {},
    organisations: {},
    ownership: {},
    representation: {},
    delegatedConsent: {}
  };

  for (const p of participants) {
    if (isOrganisation(p)) {
      // Estate agents, conveyancers, lenders
      const orgDid = resolveOrgDid(p);
      result.organisations[orgDid] = extractOrgFields(p);

      if (isRepresentative(p.role)) {
        const repUrn = generateRepresentationUrn();
        result.representation[repUrn] = {
          organisationId: orgDid,
          role: mapRoleToV4(p.role),
          status: p.participantStatus
        };
      } else if (p.role === 'Lender') {
        const dcUrn = generateConsentUrn();
        result.delegatedConsent[dcUrn] = {
          organisationId: orgDid,
          scope: ['propertyPack', 'titleRegister'],
          purpose: 'mortgage'
        };
      }
    } else {
      // Natural persons (sellers, buyers)
      const personDid = resolvePersonDid(p);
      result.persons[personDid] = extractPersonFields(p);

      if (p.role === 'Seller') {
        const ownUrn = generateOwnershipUrn();
        result.ownership[ownUrn] = {
          personId: personDid,
          titleId: resolveSellerTitle(p),
          status: mapOwnershipStatus(p.participantStatus)
        };
      }
      // Buyers: handled via offers (offerId on participant)
    }
  }

  return result;
}
```

**V4 → V3 (reconstruction):** See §5.3.

#### 10.3.2 Titles

```
V3: propertyPack.titlesToBeSold[] (array, indexed)
    ↕
V4: titles{} (keyed by urn:pdtf:titleNumber:{titleNumber})
```

**ID source:** `titleNumber` field within each title object. Natural key.

**Conversion:**
```typescript
// V3 → V4
const titles = {};
for (const title of v3State.propertyPack.titlesToBeSold) {
  const urn = `urn:pdtf:titleNumber:${title.titleNumber}`;
  titles[urn] = { ...title };
  delete titles[urn].titleNumber; // Now part of the key
}

// V4 → V3
const titlesToBeSold = Object.entries(v4State.titles).map(
  ([urn, title]) => ({
    titleNumber: urn.replace('urn:pdtf:titleNumber:', ''),
    ...title
  })
);
```

#### 10.3.3 Searches

```
V3: propertyPack.searches[] (array)
    ↕
V4: properties[uprn].searches{} (keyed by providerReference or generated ID)
```

**ID source:** `providerReference` if unique, otherwise `{providerName}:{providerReference}` composite, otherwise generated UUID.

#### 10.3.4 Documents

```
V3: propertyPack.documents[] (array)
    ↕
V4: properties[uprn].documents{} (keyed by generated ID)
```

**ID source:** Generated. Documents don't have a natural unique key. Use stable UUID generated from document content hash or upload timestamp.

#### 10.3.5 Surveys

```
V3: propertyPack.surveys[] (array)
    ↕
V4: properties[uprn].surveys{} (keyed by generated ID)
```

**ID source:** Generated, or `surveyReference` if available.

#### 10.3.6 Valuations

```
V3: propertyPack.valuations[] (array)
    ↕
V4: properties[uprn].valuations{} (keyed by valuationId)
```

**ID source:** `valuationId` — natural key already present in the schema.

#### 10.3.7 Contracts

```
V3: contracts[] (array)
    ↕
V4: contracts{} (keyed by generated ID)
```

#### 10.3.8 Chain

```
V3: chain.onwardPurchase[] (array)
    ↕
V4: chain.onwardPurchase{} (keyed by transactionId)
```

**ID source:** `transactionId` — natural key.

#### 10.3.9 Media

```
V3: propertyPack.media[] (array)
    ↕
V4: properties[uprn].media{} (keyed by generated ID)
```

**ID source:** Generated from URL hash or upload order.

### 10.4 Value Arrays (Remain as Arrays)

These are value lists within entities, not entity collections. They stay as arrays in both v3 and v4:

| Array | Location | Why it stays an array |
|-------|----------|----------------------|
| `rooms[]` | Property features | Value list, no individual identity |
| `fixtures[]` | Fixtures and fittings | Value list |
| `recommendations[]` | EPC recommendations | Value list |
| `localLandCharges[]` | LLC results | Value list |
| `conditions[]` | Offer conditions | Value list |
| `inclusions[]` | Offer inclusions | Value list |
| `exclusions[]` | Offer exclusions | Value list |
| `additionalDocuments[]` | Title supporting docs | Value list |
| Planning decision arrays | Alterations/changes | Value list |
| Environmental risk arrays | Environmental issues | Value list |

**Rule of thumb:** If items in the array don't have individual identity (no natural key, no DID, no URN), it stays an array. If items are independently addressable entities, it becomes a map.

### 10.5 Round-Trip Guarantee

For any transaction state, the following must hold:

```
v3State → decomposeToV4(v3State) → composeToV3(v4State) === v3State
```

This means the collection conversion must be lossless. Key concerns:

- **Array ordering** — v3 arrays have implicit ordering. V4 maps lose ordering. When converting back, a canonical ordering must be applied (e.g. by creation timestamp, or by key sort).
- **ID generation** — when converting v3 → v4, generated IDs must be deterministic (content-addressable or seeded from stable data) to ensure the same input always produces the same v4 keys.
- **Null vs absent** — a v3 field that is `null` must not be lost in the v4 conversion and must be `null` (not absent) when converting back.

---

## 11. Performance Considerations

### 11.1 Composition Cost

State assembly is the hot path for every read operation. Its performance characteristics:

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Credential grouping | O(n) | Single pass over VC list |
| Sorting by validFrom | O(n log n) per entity | Typically few VCs per entity |
| Deep merge | O(p) per entity | p = total paths across VCs |
| Dependency pruning | O(s) per entity | s = schema discriminator count (fixed, small) |
| Conflict resolution | O(c) per entity | c = conflicting paths (typically very few) |
| Collection conversion (v3) | O(e) | e = total entities across all types |

For a typical transaction with ~50 VCs and ~4,000 paths total: estimated <50ms for full composition.

### 11.2 Caching Strategy

Composed state should be cached because:
- Most reads are of the same state (VCs don't change between reads)
- Composition involves signature verification, TIR lookups, and deep merging
- Multiple consumers may request state for the same transaction concurrently

**Cache design:**

```typescript
interface StateCache {
  /** Cache key: transaction DID + hash of contributing VC IDs */
  key: string;
  /** Composed v4 state */
  v4State: ComposedStateV4;
  /** Composed v3 state (derived from v4) */
  v3State: CombinedStateV3;
  /** Provenance map */
  provenance: ProvenanceMap;
  /** Timestamp of last VC that contributed */
  lastVcTimestamp: string;
  /** Set of VC IDs that contributed (for invalidation) */
  contributingVcIds: Set<string>;
}
```

### 11.3 Cache Invalidation

The cache is invalidated when:

1. **New VC arrives** — any new credential for any entity in the transaction
2. **VC revoked** — a credential in `contributingVcIds` is revoked
3. **TIR updated** — trust levels may change, affecting conflict resolution
4. **TTL expiry** — background refresh after configurable TTL (e.g. 5 minutes)

**Invalidation strategy:** Event-driven. When a new VC is stored, emit an event that invalidates the cache for the affected transaction. Don't recompose eagerly — wait for the next read.

### 11.4 Incremental Recomposition

For performance optimisation (future), the composer could support incremental updates:

- When a single new VC arrives, only recompose the affected entity
- Deep merge the new VC's `credentialSubject` into the cached entity state
- Re-run dependency pruning for that entity only
- Re-run conflict resolution for affected paths only
- Update provenance for affected paths

**Complexity:** O(p_new) where p_new is the number of paths in the new VC, vs O(p_total) for full recomposition.

**Risk:** Incremental recomposition may produce different results than full recomposition if there are ordering-dependent interactions between VCs. Must be validated: `incremental(state, newVC) === fullRecompose(allVCs)`.

**Recommendation:** Implement full recomposition first. Add incremental as an optimisation only if composition latency becomes a bottleneck in production.

---

## 12. Open Questions

### 12.1 For LMS / Implementer Discussion

1. **Pruning semantics agreement** — Does LMS agree that discriminator changes should prune dependent branches? This changes composed state output. The alternative is to continue with REPLACE semantics and handle stale data in consumers. (Relates to D5.)

2. **Array ordering guarantee** — Should the v3-from-graph composer guarantee the same array ordering as the v3-from-claims composer? If so, what ordering convention? Insertion order is fragile.

3. **Multi-property transactions** — When a transaction has multiple properties (e.g. house + garage), how does the v3 composer flatten `properties{}` to `propertyPack`? Options:
   - Primary property only (lose data)
   - Merge all properties (conflicts)
   - Array of property packs (v3 schema change)

4. **Conflict visibility** — Should trust-level conflicts be visible to transaction participants? E.g., should a seller see "The EPC adapter says your energy rating is C, but you claimed D"? Or is this internal only?

### 12.2 Internal (Moverly)

5. **Dependency graph extraction from real schemas** — The pruning algorithm requires walking the actual PDTF JSON Schemas to identify discriminators. How complete are the current schemas' use of `if/then/else` and `oneOf`? Are there discriminator patterns that aren't expressed in the schema today?

6. **Provenance storage** — Where does the `_provenance` sidecar live? Options:
   - In the composed state object (convenient, but bloats responses)
   - Separate endpoint/query (cleaner, but extra fetch)
   - Only in the cache (lost on cache eviction)

7. **Testing strategy** — How to generate realistic VC sets for testing? Options:
   - Convert existing claims to VCs (automated migration script)
   - Manual VC creation for test cases
   - Snapshot real transaction claims and convert

8. **Incremental recomposition correctness** — How to prove that incremental recomposition always matches full recomposition? Formal proof or extensive fuzzing?

---

## 13. Implementation Notes

### 13.1 Implementation Order

1. **`dependencyPruning.js`** — Start here. It's the most novel component and needs the most validation. Build the schema walker, extract discriminators from real PDTF schemas, write extensive tests.

2. **`conflictResolution.js`** — Trust level lookup and temporal ordering. Depends on TIR format being stable (Sub-spec 04).

3. **`composeV4StateFromGraph.js`** — Core composer. Once pruning and conflict resolution are solid, this is straightforward deep merging with orchestration.

4. **`collectionConversion.js`** — Array↔map conversion. Well-defined transformation rules, mostly mechanical.

5. **`composeV3StateFromGraph.js`** — Bridge composer. Depends on all above components plus field reassignment rules.

6. **`provenanceTracker.js`** — Can be added incrementally. Doesn't affect correctness, only observability.

### 13.2 Test Strategy

**Unit tests:**
- Deep merge: various sparse object combinations, null handling, array replacement
- Dependency pruning: every discriminator pattern in the PDTF schema
- Conflict resolution: trust level ordering, temporal ordering, tie-breaking
- Collection conversion: round-trip for every collection type

**Integration tests:**
- Full composition from realistic VC sets
- V3 comparison: `composeV3StateFromGraph` output matches `composeStateFromClaims` for known transactions
- Round-trip: v3 → v4 → v3 identity check

**Property-based tests (recommended):**
- Generate random sparse objects → merge → verify all paths present
- Generate random discriminator values → prune → verify schema validity
- Generate random VC sets → compose v4 → compose v3 → compare with claims-based v3

### 13.3 Error Handling

| Error | Handling |
|-------|---------|
| VC with unknown entity type | Log warning, skip VC, continue composition |
| VC with invalid `credentialSubject.id` | Log error, skip VC |
| Schema not found for entity type | Log error, skip entity (cannot prune without schema) |
| TIR lookup failure | Fall back to `accountProvider` trust level |
| Merge produces invalid state (fails schema validation) | Log error, return last valid state, alert |
| Collection conversion loses data | Fatal error — this should never happen in production |

### 13.4 Logging and Observability

State assembly is a critical path. Every composition should log:

- Transaction ID
- Number of input VCs (total and per entity type)
- Number of VCs filtered (invalid, revoked, expired, unauthorised)
- Number of conflicts resolved (and resolution reasons)
- Number of paths pruned (dependency pruning)
- Composition duration (ms)
- Cache hit/miss
- Discrepancies (Phase 2 validation)

### 13.5 Key Decision Dependencies

| Decision | This Spec Depends On | Status |
|----------|---------------------|--------|
| D5 — Sparse objects + pruning | §6 (pruning algorithm), §8 (migration) | 🟡 Needs LMS consensus |
| D10 — Dual state assembly | §2 (three composers), §8 (migration phases) | ✅ Confirmed |
| D15 — ID-keyed collections | §10 (conversion rules), §4.4 (v4 output shape) | ✅ Confirmed |
| D20 — TIR entity:path combos | §7 (conflict resolution), §3.3 (pre-assembly filtering) | ✅ Confirmed |
| D27 — Logbook test | §5.4 (field reassignment) | ✅ Confirmed |

---

## Appendix A: Deep Merge Walkthrough

### A.1 Simple Merge (No Conflicts)

**Base state:**
```json
{
  "address": {
    "line1": "42 Oak Lane",
    "postcode": "EH45 8AB"
  }
}
```

**Incoming sparse object:**
```json
{
  "address": {
    "town": "Peebles",
    "county": "Scottish Borders"
  },
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating"
    }
  }
}
```

**Result:**
```json
{
  "address": {
    "line1": "42 Oak Lane",
    "postcode": "EH45 8AB",
    "town": "Peebles",
    "county": "Scottish Borders"
  },
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating"
    }
  }
}
```

### A.2 Overwrite at Leaf

**Base state:**
```json
{
  "energyEfficiency": {
    "certificate": {
      "currentEnergyRating": "D",
      "currentEnergyEfficiency": 58
    }
  }
}
```

**Incoming (new EPC):**
```json
{
  "energyEfficiency": {
    "certificate": {
      "currentEnergyRating": "C",
      "currentEnergyEfficiency": 72
    }
  }
}
```

**Result:**
```json
{
  "energyEfficiency": {
    "certificate": {
      "currentEnergyRating": "C",
      "currentEnergyEfficiency": 72
    }
  }
}
```

Both leaf values overwritten. Structure preserved.

### A.3 Array Replacement

**Base state:**
```json
{
  "energyEfficiency": {
    "recommendations": [
      { "measure": "Loft insulation", "rating": "A" },
      { "measure": "Double glazing", "rating": "B" }
    ]
  }
}
```

**Incoming (updated recommendations):**
```json
{
  "energyEfficiency": {
    "recommendations": [
      { "measure": "Solar panels", "rating": "A" },
      { "measure": "Heat pump", "rating": "A" },
      { "measure": "Loft insulation", "rating": "A" }
    ]
  }
}
```

**Result:**
```json
{
  "energyEfficiency": {
    "recommendations": [
      { "measure": "Solar panels", "rating": "A" },
      { "measure": "Heat pump", "rating": "A" },
      { "measure": "Loft insulation", "rating": "A" }
    ]
  }
}
```

Entire array replaced. No element-level merge.

### A.4 Explicit Null

**Base state:**
```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating",
      "centralHeatingDetails": {
        "fuelType": "Mains gas"
      }
    }
  }
}
```

**Incoming (explicitly null out details):**
```json
{
  "heating": {
    "heatingSystem": {
      "centralHeatingDetails": null
    }
  }
}
```

**Result:**
```json
{
  "heating": {
    "heatingSystem": {
      "heatingType": "Central heating",
      "centralHeatingDetails": null
    }
  }
}
```

The `null` is an explicit signal: "this field has been cleared." Dependency pruning may also remove it if the schema discriminator makes it invalid, but the explicit null takes effect first.

---

## Appendix B: Full Composition Example

A complete worked example showing composition of a realistic transaction from VCs through to v4 and v3 state.

### B.1 Input: Five VCs for a Transaction

**VC 1 — Transaction metadata (Moverly platform):**
```json
{
  "type": ["VerifiableCredential", "TransactionCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-15T10:00:00Z",
  "credentialSubject": {
    "id": "did:web:moverly.com:transactions:tx-42",
    "status": "Active",
    "saleContext": {
      "numberOfSellers": 1,
      "outstandingMortgage": "Yes",
      "existingLender": "Nationwide"
    }
  }
}
```

**VC 2 — Property data (seller attestation):**
```json
{
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:key:z6Mkh...seller",
  "validFrom": "2026-03-16T14:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "address": {
      "line1": "42 Oak Lane",
      "town": "Peebles",
      "postcode": "EH45 8AB"
    },
    "heating": {
      "heatingSystem": {
        "heatingType": "Central heating",
        "centralHeatingDetails": {
          "fuelType": "Mains gas",
          "boilerAge": "3-6 years old"
        }
      }
    },
    "buildInformation": {
      "propertyType": "Detached",
      "approximateAge": "1900-1929"
    }
  }
}
```

**VC 3 — EPC data (trusted proxy):**
```json
{
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-17T09:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "certificateNumber": "1234-5678-9012-3456-7890",
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72,
        "lodgementDate": "2026-03-15"
      }
    }
  }
}
```

**VC 4 — Title data (HMLR proxy):**
```json
{
  "type": ["VerifiableCredential", "TitleCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:hmlr",
  "validFrom": "2026-03-17T10:00:00Z",
  "credentialSubject": {
    "id": "urn:pdtf:titleNumber:AB12345",
    "registerExtract": {
      "titleNumber": "AB12345",
      "tenure": "Freehold",
      "proprietorship": {
        "owners": [{ "name": "Jane Smith", "address": "42 Oak Lane, Peebles" }]
      },
      "priceHistory": [
        { "date": "2018-05-14", "price": 320000 }
      ]
    },
    "titleExtents": {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": ["..."] }
    },
    "ownership": {
      "ownershipType": "Freehold"
    }
  }
}
```

**VC 5 — Person identity (Moverly platform):**
```json
{
  "type": ["VerifiableCredential", "PersonCredential"],
  "issuer": "did:web:moverly.com",
  "validFrom": "2026-03-15T09:00:00Z",
  "credentialSubject": {
    "id": "did:key:z6Mkh...seller",
    "name": {
      "first": "Jane",
      "last": "Smith"
    },
    "contact": {
      "email": "jane@example.com",
      "phone": "07700900000"
    }
  }
}
```

### B.2 Composition Steps

**Step 1 — Group by entity:**

| Entity ID | VCs |
|-----------|-----|
| `did:web:moverly.com:transactions:tx-42` | VC 1 |
| `urn:pdtf:uprn:100023456789` | VC 2, VC 3 |
| `urn:pdtf:titleNumber:AB12345` | VC 4 |
| `did:key:z6Mkh...seller` | VC 5 |

**Step 2 — Compose each entity group:**

Property (VC 2 + VC 3, sorted by validFrom):
- Apply VC 2 (seller attestation): address, heating, buildInformation
- Apply VC 3 (EPC proxy): energyEfficiency
- No conflicts (different paths)
- Dependency pruning: heatingType = "Central heating" → centralHeatingDetails valid ✓

Transaction (VC 1 only): direct use of credentialSubject.

Title (VC 4 only): direct use of credentialSubject.

Person (VC 5 only): direct use of credentialSubject.

**Step 3 — Assemble v4 state:** See §4.4 for the output shape (this example produces a subset of that structure).

### B.3 V3 Conversion

From the v4 state, the v3 composer:

1. Flattens `properties["urn:pdtf:uprn:100023456789"]` → `propertyPack`
2. Converts `titles["urn:pdtf:titleNumber:AB12345"]` → `propertyPack.titlesToBeSold[0]`
3. Moves `transaction.saleContext.numberOfSellers` → `propertyPack.ownership.numberOfSellers`
4. Moves `titles[...].ownership.ownershipType` → `propertyPack.ownership.ownershipsToBeTransferred[0].ownershipType`
5. Reconstructs `participants[]` from persons + ownership (no representation or offers in this example)
6. Adds `propertyPack.uprn = "100023456789"`

**Result:** A v3 `combined.json` that matches what `composeStateFromClaims` would produce from the equivalent pathKey:value claims.

---

## Appendix C: Dependency Graph for Common PDTF Discriminators

A non-exhaustive list of discriminator patterns in the PDTF schema that the pruning pass must handle:

| Discriminator Path | Values | Dependent Branches |
|-------------------|--------|-------------------|
| `heating.heatingSystem.heatingType` | "Central heating" | `centralHeatingDetails` |
| | "Storage heaters" | `storageHeaterDetails` |
| | "Other" | `otherHeatingDetails` |
| | "None" | *(no dependents)* |
| `ownership.ownershipType` | "Leasehold" | `leaseholdInformation` |
| | "Commonhold" | `commonholdInformation` |
| | "Freehold" | *(no dependents)* |
| `waterAndDrainage.waterSupplyType` | "Mains" | `mainsWaterDetails` |
| | "Private" | `privateWaterDetails` |
| `electricity.electricitySupplyType` | "Mains" | `mainsElectricityDetails` |
| | "Off-grid" | `offGridDetails` |
| `alterationsAndChanges.planningPermission.required` | "Yes" | `planningPermissionDetails` |
| | "No" | *(no dependents)* |
| `alterationsAndChanges.buildingRegulations.required` | "Yes" | `buildingRegulationsDetails` |
| | "No" | *(no dependents)* |
| `insurance.buildingInsurance.hasInsurance` | "Yes" | `insuranceDetails` |
| | "No" | `noInsuranceReason` |
| `parking.parkingArrangements` | "Garage" | `garageDetails` |
| | "Driveway" | `drivewayDetails` |
| | "Allocated space" | `allocatedSpaceDetails` |

**Note:** This table is illustrative. The authoritative list comes from walking the actual JSON Schemas. The implementation must discover discriminators dynamically, not from a hardcoded list.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | Added §6.10 "Assembler Pruning Obligation" — assembler MUST apply schema dependency rules if MERGE semantics adopted. Issuers are stateless; pruning is assembly-time only. Schema `if/then/else` and `oneOf` discriminators define rules. |
| v0.1 | 24 March 2026 | Initial draft. composeV4StateFromGraph and composeV3StateFromGraph algorithms, dependency pruning, conflict resolution, v3 backward compatibility, dual state assembly, trust-level-aware composition. |

---

*This is a living document. Decisions made here relate to D5, D10, and D15 in the [Architecture Overview](./00-architecture-overview.md). As the implementation progresses, this spec will be updated to reflect actual code and any design changes.*
