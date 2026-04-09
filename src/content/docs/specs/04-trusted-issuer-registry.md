---
title: "PDTF 2.0 — Sub-spec 04: Trusted Issuer Registry"
description: "PDTF 2.0 specification document."
---


**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](../00-architecture-overview/)

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Design Principles](#2-design-principles)
3. [Registry Location](#3-registry-location)
4. [Registry Schema](#4-registry-schema)
5. [Entity:Path Authorisation](#5-entitypath-authorisation)
6. [Trust Levels](#6-trust-levels)
7. [Verification Flow](#7-verification-flow)
8. [Registry Governance](#8-registry-governance)
9. [Caching Strategy](#9-caching-strategy)
10. [Initial Registry Entries](#10-initial-registry-entries)
11. [Migration Path](#11-migration-path)
12. [Security Considerations](#12-security-considerations)
13. [Open Questions](#13-open-questions)
14. [Implementation Notes](#14-implementation-notes)

---

## 1. Purpose

PDTF 2.0 replaces the single-platform trust model of v1 with a federated architecture where multiple issuers produce W3C Verifiable Credentials about property data. This creates a fundamental question: **how does a verifier know whether a given issuer is authorised to make the claims it's making?**

A Verifiable Credential's cryptographic signature proves that the credential hasn't been tampered with and was issued by the entity controlling the signing key. But it does *not* prove that the issuer had the **authority** to make those claims. Anyone can mint a VC claiming a property has an EPC rating of A — the question is whether the issuer is recognised as a legitimate source for EPC data.

The **Trusted Issuer Registry (TIR)** answers this question. It is a publicly accessible, version-controlled registry that maps issuer DIDs to the specific data paths they are authorised to issue credentials about. Verifiers consult the TIR as part of credential validation to determine:

- Whether the issuer is recognised at all
- What specific entity:path combinations they are authorised for
- What trust level applies (primary source vs intermediary vs account provider)
- Whether the issuer's authorisation is currently active

Without a TIR, every verifier would need to maintain its own list of trusted issuers, leading to fragmentation, inconsistency, and an inability to evolve trust relationships as primary sources adopt PDTF 2.0.

### 1.1 What the TIR Is Not

The TIR is **not** a certificate authority. It does not issue or manage cryptographic keys. Issuers manage their own key material (see [Sub-spec 06: Key Management](../06-key-management/)).

The TIR is **not** a DID registry. DID resolution happens separately via the appropriate DID method (`did:web` resolution, `did:key` derivation). The TIR references issuer DIDs but does not host DID documents.

The TIR is **not** an access control list. It governs *issuance authority*, not *read access*. Who can access a credential is governed by `termsOfUse` within the credential itself and by participation credentials presented at the API layer.

---

## 2. Design Principles

### 2.1 GitHub-Based (Version Controlled, Auditable)

The TIR is a JSON file in a public GitHub repository. Every change is a git commit with a full audit trail: who changed what, when, and why. No custom database, no admin UI, no opaque backend.

**Rationale:** Trust registries are governance infrastructure. Changes must be visible, reversible, and attributable. Git provides all of this natively. A PR-based workflow means changes are reviewed before they take effect.

### 2.2 AI Agent-Manageable

The registry format is designed to be read and written by AI agents and automated tooling, not just humans. The JSON structure is flat and predictable. Field names are self-documenting. There are no nested hierarchies that require special parsing logic.

**Rationale:** In practice, TIR lookups will be performed by VC validators running as part of automated verification pipelines, MCP servers, and AI-powered property intelligence systems. The format must be trivially parseable by code.

### 2.3 Entity:Path Granularity

Trust is not binary ("this issuer is trusted / not trusted"). The TIR specifies exactly which entity types and JSON paths an issuer is authorised for. An issuer trusted for EPC data is not automatically trusted for title register data.

**Rationale:** Different data paths have different authoritative sources. HMLR is the authority for title data. MHCLG (via the EPC register) is the authority for energy performance data. A trusted proxy adapter that correctly fetches EPC data has no authority over title register data, even if it's operated by the same organisation.

> **Decision D20:** TIR describes entity:path combinations (e.g. `Property:/energyEfficiency/certificate`), not just issuer-level trust.

### 2.4 Extensible Without Breaking Changes

New issuers, new entity types, and new paths can be added without changing the schema. The TIR is additive by design — existing entries are never invalidated by new additions. Removal follows a deprecation lifecycle (active → deprecated → revoked).

### 2.5 No Central Authority Required

The TIR is currently maintained by Moverly as the PDTF 2.0 steward, but its design supports evolution toward multi-stakeholder governance. Any organisation could fork, mirror, or propose changes via pull request. The governance model is designed to decentralise over time.

> **Decision D8:** GitHub-based TIR at `property-data-standards-co`.

---

## 3. Registry Location

The canonical TIR lives at:

```
https://github.com/property-data-standards-co/trusted-issuer-registry
```

### 3.1 Repository Structure

```
trusted-issuer-registry/
├── README.md                  # Human-readable overview and governance rules
├── registry.json              # The canonical TIR file
├── schema/
│   └── tir-schema.json        # JSON Schema for registry.json validation
├── CHANGELOG.md               # Human-readable change log
├── .github/
│   └── workflows/
│       └── validate.yml       # CI: validates registry.json against schema on every PR
└── scripts/
    └── validate.js            # Schema validation script
```

### 3.2 Access URLs

| Purpose | URL |
|---------|-----|
| **Repository** | `https://github.com/property-data-standards-co/trusted-issuer-registry` |
| **Raw registry (main branch)** | `https://raw.githubusercontent.com/property-data-standards-co/trusted-issuer-registry/main/registry.json` |
| **GitHub API (with ETag support)** | `https://api.github.com/repos/property-data-standards-co/trusted-issuer-registry/contents/registry.json` |
| **JSON Schema** | `https://raw.githubusercontent.com/property-data-standards-co/trusted-issuer-registry/main/schema/tir-schema.json` |

Verifiers SHOULD use the GitHub API endpoint to benefit from `ETag` / `If-None-Match` caching headers (see [Section 9](#9-caching-strategy)).

---

## 4. Registry Schema

### 4.1 Top-Level Structure

The `registry.json` file has the following top-level structure:

```json
{
  "$schema": "./schema/tir-schema.json",
  "version": "1.0",
  "updated": "2026-03-24T12:00:00Z",
  "issuers": { ... },
  "userAccountProviders": { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | RECOMMENDED | Relative path to the JSON Schema file for validation tooling |
| `version` | string | REQUIRED | Semantic version of the registry format |
| `updated` | string (ISO 8601) | REQUIRED | Timestamp of the last modification to any entry |
| `issuers` | object | REQUIRED | Map of issuer entries, keyed by issuer slug |
| `userAccountProviders` | object | REQUIRED | Map of account provider entries, keyed by provider slug |

### 4.2 Issuer Entry

Each key in the `issuers` map is a **slug** — a lowercase, hyphenated, human-readable identifier for the issuer (e.g. `moverly-hmlr`, `hmlr`, `mhclg-epc`). The slug is stable and MUST NOT change once an entry is published.

```json
{
  "moverly-hmlr": {
    "name": "Moverly (HMLR Proxy)",
    "did": "did:web:adapters.propdata.org.uk:hmlr",
    "authorisedPaths": [
      "Title:/titleNumber",
      "Title:/titleExtents",
      "Title:/registerExtract/*",
      "Title:/ownership/*"
    ],
    "trustLevel": "trustedProxy",
    "proxyFor": "hmlr",
    "status": "active",
    "validFrom": "2026-03-01T00:00:00Z",
    "validUntil": null,
    "contact": "trust@moverly.com",
    "website": "https://moverly.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | REQUIRED | Human-readable display name |
| `did` | string (DID) | REQUIRED | The issuer's Decentralised Identifier. For `planned` issuers, this MAY be a placeholder that is updated when the issuer goes active. |
| `authorisedPaths` | array of strings | REQUIRED | Entity:path combinations this issuer may issue credentials for (see [Section 5](#5-entitypath-authorisation)) |
| `trustLevel` | enum | REQUIRED | One of: `rootIssuer`, `trustedProxy`, `accountProvider` (see [Section 6](#6-trust-levels)) |
| `proxyFor` | string | CONDITIONAL | Required when `trustLevel` is `trustedProxy`. The slug of the root issuer this proxy fetches data from. |
| `status` | enum | REQUIRED | One of: `active`, `planned`, `deprecated`, `revoked` |
| `validFrom` | string (ISO 8601) or null | OPTIONAL | Date from which this entry is valid. If null or absent, valid from the entry's creation. |
| `validUntil` | string (ISO 8601) or null | OPTIONAL | Date after which this entry expires. If null or absent, no expiry. |
| `contact` | string | OPTIONAL | Contact email for the issuer organisation |
| `website` | string (URL) | OPTIONAL | Website for the issuer organisation |

### 4.3 User Account Provider Entry

The `userAccountProviders` section lists platforms that issue user DIDs (`did:key` identities for sellers, buyers, conveyancers, etc.). These entries are structurally similar to issuer entries but serve a distinct purpose: they allow a verifier to confirm that a person's DID was created by a recognised identity provider.

> **Decision D21:** User DID issuers (account providers) must also be listed in the TIR.

```json
{
  "moverly": {
    "name": "Moverly",
    "did": "did:web:moverly.com",
    "description": "Issues user DIDs (did:key) as account provider. Validates user identity at onboarding.",
    "trustLevel": "accountProvider",
    "identityVerification": {
      "methods": ["email", "sms", "govuk-verify"],
      "description": "Email + SMS verification at registration. GOV.UK Verify integration planned."
    },
    "managedOrganisations": "https://moverly.com/.well-known/pdtf-managed-orgs.json",
    "status": "active",
    "validFrom": "2026-03-01T00:00:00Z",
    "validUntil": null,
    "contact": "trust@moverly.com",
    "website": "https://moverly.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | REQUIRED | Human-readable name |
| `did` | string (DID) | REQUIRED | Platform's DID |
| `description` | string | OPTIONAL | What this provider does |
| `trustLevel` | string | REQUIRED | Always `accountProvider` |
| `identityVerification` | object | OPTIONAL | Describes the identity verification methods used at onboarding |
| `identityVerification.methods` | array of strings | OPTIONAL | List of verification methods (e.g. `email`, `sms`, `govuk-verify`, `document-check`) |
| `identityVerification.description` | string | OPTIONAL | Human-readable description of verification process |
| `managedOrganisations` | string (URL) | OPTIONAL | URL pointing to a signed JSON document listing the `did:key` identifiers of organisations whose identity has been verified by this account provider. Verifiers use this to trace an Organisation's `did:key` back to a trusted provider. See [Section 4.3.1](#431-managed-organisations-document). |
| `status` | enum | REQUIRED | One of: `active`, `planned`, `deprecated`, `revoked` |
| `validFrom` | string (ISO 8601) or null | OPTIONAL | Validity start date |
| `validUntil` | string (ISO 8601) or null | OPTIONAL | Validity end date |
| `contact` | string | OPTIONAL | Contact email |
| `website` | string (URL) | OPTIONAL | Website |

#### 4.3.1 Managed Organisations Document

The `managedOrganisations` URL points to a signed JSON document listing the `did:key` identifiers of organisations whose identity has been verified by this account provider. The document is hosted by the provider and MUST be served over HTTPS.

**Example document** at `https://moverly.com/.well-known/pdtf-managed-orgs.json`:

```json
{
  "provider": "did:web:moverly.com",
  "updated": "2026-03-24T12:00:00Z",
  "organisations": [
    {
      "did": "did:key:z6MkpJmqLFMmaFHCqS9jVjMNRNHriSNkFCyG3MLbiqkVMhvm",
      "name": "Smith & Jones LLP",
      "sraNumber": "612345",
      "companyNumber": "OC123456",
      "verifiedAt": "2026-03-15T10:30:00Z"
    },
    {
      "did": "did:key:z6MkrHKY8pMWMjEQj3FBaYGPnXtvAqRwPsGy2nVN6HRhk4tQ",
      "name": "Acme Estate Agents Ltd",
      "companyNumber": "12345678",
      "verifiedAt": "2026-03-18T14:00:00Z"
    }
  ],
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:moverly.com#key-1",
    "created": "2026-03-24T12:00:00Z",
    "proofPurpose": "assertionMethod",
    "proofValue": "z4FXQje2VihZqE3WPgtvJh4Kv8..."
  }
}
```

**Key points:**

- The document is signed by the account provider's DID key, providing integrity and non-repudiation.
- Each organisation entry includes the `did:key` identifier and the regulatory identifiers that were verified.
- The `verifiedAt` timestamp indicates when the organisation's identity was last verified.
- Verifiers SHOULD cache this document (recommended TTL: 1 hour) and use conditional requests (ETag/If-None-Match) where supported.
- The provider MUST update this document when organisations are added or removed.

### 4.4 JSON Schema Definition

The following JSON Schema (`schema/tir-schema.json`) validates the `registry.json` file:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://raw.githubusercontent.com/property-data-standards-co/trusted-issuer-registry/main/schema/tir-schema.json",
  "title": "PDTF Trusted Issuer Registry",
  "description": "Schema for the PDTF 2.0 Trusted Issuer Registry (TIR). Defines authorised issuers and account providers for the Property Data Trust Framework.",
  "type": "object",
  "required": ["version", "updated", "issuers", "userAccountProviders"],
  "additionalProperties": false,
  "properties": {
    "$schema": {
      "type": "string",
      "description": "Reference to the JSON Schema file"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$",
      "description": "Semantic version of the registry format"
    },
    "updated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of the last modification"
    },
    "issuers": {
      "type": "object",
      "description": "Map of credential issuers, keyed by slug",
      "patternProperties": {
        "^[a-z][a-z0-9-]*$": {
          "$ref": "#/$defs/issuerEntry"
        }
      },
      "additionalProperties": false
    },
    "userAccountProviders": {
      "type": "object",
      "description": "Map of user DID account providers, keyed by slug",
      "patternProperties": {
        "^[a-z][a-z0-9-]*$": {
          "$ref": "#/$defs/accountProviderEntry"
        }
      },
      "additionalProperties": false
    }
  },
  "$defs": {
    "issuerEntry": {
      "type": "object",
      "required": ["name", "did", "authorisedPaths", "trustLevel", "status"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "Human-readable display name"
        },
        "did": {
          "type": "string",
          "pattern": "^did:[a-z]+:.+$",
          "description": "Issuer's Decentralised Identifier"
        },
        "authorisedPaths": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[A-Z][a-zA-Z]*:/[a-zA-Z0-9/*_-][a-zA-Z0-9/*._-]*$",
            "description": "Entity:path authorisation string"
          },
          "minItems": 1,
          "uniqueItems": true,
          "description": "Entity:path combinations this issuer is authorised for"
        },
        "trustLevel": {
          "type": "string",
          "enum": ["rootIssuer", "trustedProxy", "accountProvider"],
          "description": "Trust classification for this issuer"
        },
        "proxyFor": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$",
          "description": "Slug of the root issuer this proxy fetches data from. Required when trustLevel is trustedProxy."
        },
        "status": {
          "type": "string",
          "enum": ["active", "planned", "deprecated", "revoked"],
          "description": "Current status of this registry entry"
        },
        "validFrom": {
          "type": ["string", "null"],
          "format": "date-time",
          "description": "ISO 8601 datetime from which this entry is valid"
        },
        "validUntil": {
          "type": ["string", "null"],
          "format": "date-time",
          "description": "ISO 8601 datetime after which this entry expires"
        },
        "contact": {
          "type": "string",
          "format": "email",
          "description": "Contact email for the issuer"
        },
        "website": {
          "type": "string",
          "format": "uri",
          "description": "Website URL for the issuer"
        }
      },
      "if": {
        "properties": {
          "trustLevel": { "const": "trustedProxy" }
        }
      },
      "then": {
        "required": ["proxyFor"]
      }
    },
    "accountProviderEntry": {
      "type": "object",
      "required": ["name", "did", "trustLevel", "status"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "Human-readable name"
        },
        "did": {
          "type": "string",
          "pattern": "^did:[a-z]+:.+$",
          "description": "Provider's Decentralised Identifier"
        },
        "description": {
          "type": "string",
          "description": "What this account provider does"
        },
        "trustLevel": {
          "type": "string",
          "const": "accountProvider",
          "description": "Always accountProvider for this section"
        },
        "identityVerification": {
          "type": "object",
          "properties": {
            "methods": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Identity verification methods used"
            },
            "description": {
              "type": "string",
              "description": "Human-readable description of verification process"
            }
          },
          "additionalProperties": false
        },
        "managedOrganisations": {
          "type": "string",
          "format": "uri",
          "description": "URL of a signed JSON document listing organisation did:key identifiers managed by this provider"
        },
        "status": {
          "type": "string",
          "enum": ["active", "planned", "deprecated", "revoked"],
          "description": "Current status"
        },
        "validFrom": {
          "type": ["string", "null"],
          "format": "date-time"
        },
        "validUntil": {
          "type": ["string", "null"],
          "format": "date-time"
        },
        "contact": {
          "type": "string",
          "format": "email"
        },
        "website": {
          "type": "string",
          "format": "uri"
        }
      }
    }
  }
}
```

### 4.5 Slug Conventions

Issuer slugs follow these rules:

- Lowercase alphanumeric characters and hyphens only: `^[a-z][a-z0-9-]*$`
- Start with a letter, not a number or hyphen
- Stable once published — slugs MUST NOT be renamed (create a new entry instead)
- Use organisation name as prefix for proxy adapters: `moverly-hmlr`, `moverly-epc`
- Root issuers use their natural abbreviation: `hmlr`, `voa`, `mhclg-epc`

---

## 5. Entity:Path Authorisation

### 5.1 Format

Each authorised path string follows the format:

```
Entity:/json/pointer/path
```

Where:
- **Entity** is the PDTF entity type name, capitalised as per the entity graph (e.g. `Property`, `Title`, `Person`, `Organisation`, `Ownership`, `Representation`, `Transaction`)
- The colon `:` separates entity from path
- **Path** is a JSON Pointer (RFC 6901) referencing a location in the entity's schema, prefixed with `/`

### 5.2 Wildcards

A path segment of `*` matches any subtree beneath the preceding path:

| Pattern | Matches |
|---------|---------|
| `Title:/registerExtract/*` | Any path under `/registerExtract` — e.g. `/registerExtract/proprietorship`, `/registerExtract/charges`, `/registerExtract/restrictions` |
| `Property:/energyEfficiency/*` | Any path under `/energyEfficiency` — e.g. `/energyEfficiency/certificate`, `/energyEfficiency/recommendation` |
| `Property:/*` | Any path on the Property entity — full entity authority |
| `Title:/*` | Any path on the Title entity — full entity authority |

The wildcard `*` MUST appear only as the **final** path segment. Mid-path wildcards (e.g. `Property:/*/certificate`) are not supported.

### 5.3 Examples

#### Specific Path — EPC Certificate Data

```json
"authorisedPaths": [
  "Property:/energyEfficiency/certificate"
]
```

The issuer is authorised only for the EPC certificate data on the Property entity. A VC from this issuer claiming data at `Property:/buildingConstruction` would **fail** TIR verification.

#### Wildcard Subtree — Title Register Extract

```json
"authorisedPaths": [
  "Title:/registerExtract/*"
]
```

The issuer is authorised for any data beneath the register extract section of the Title entity, including proprietorship data, charges, restrictions, and other register sections.

#### Multiple Paths — HMLR Proxy

```json
"authorisedPaths": [
  "Title:/titleNumber",
  "Title:/titleExtents",
  "Title:/registerExtract/*",
  "Title:/ownership/*"
]
```

The issuer is authorised for title identification, title extents (boundary geometry), all register extract data, and ownership assertions on the Title entity. It is **not** authorised for Property data, Representation data, or anything outside these specific paths.

#### Full Entity Authority — Future Root Issuer

```json
"authorisedPaths": [
  "Property:/*"
]
```

Full authority over all paths on the Property entity. This would typically only be granted to a root issuer with comprehensive authority (unlikely in practice — more typically, different authorities cover different property data domains).

### 5.4 Path Matching Algorithm

When a VC is received, the verifier extracts the entity type and data paths from the credential's `credentialSubject` and checks each against the issuer's `authorisedPaths`:

```
function isPathAuthorised(entityType, dataPath, authorisedPaths):
    for each authorisedPath in authorisedPaths:
        [authEntity, authPath] = split(authorisedPath, ":")

        // Entity type must match exactly
        if authEntity != entityType:
            continue

        // Exact match
        if authPath == dataPath:
            return true

        // Wildcard match: "/foo/*" covers "/foo/bar", "/foo/bar/baz", etc.
        if authPath ends with "/*":
            prefix = authPath without trailing "/*"
            if dataPath starts with prefix + "/":
                return true
            // Also match the prefix itself: "/foo/*" covers "/foo"
            if dataPath == prefix:
                return true

    return false
```

### 5.5 Credential-to-Path Mapping

A single Verifiable Credential maps to one or more entity:path combinations based on its `credentialSubject`:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "PropertyEnergyCredential"],
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "entityType": "Property",
    "path": "/energyEfficiency/certificate",
    "data": {
      "currentRating": "C",
      "potentialRating": "B",
      "expiryDate": "2034-05-12",
      "certificateNumber": "0123-4567-8901-2345-6789"
    }
  }
}
```

The verifier derives the entity:path as `Property:/energyEfficiency/certificate` and checks it against the issuer's `authorisedPaths` in the TIR.

---

## 6. Trust Levels

### 6.1 rootIssuer

| | |
|---|---|
| **Definition** | The primary authoritative source for the data. Issues VCs directly from its own canonical dataset. |
| **Examples** | HM Land Registry (title data), MHCLG EPC Register (energy performance), Valuation Office Agency (council tax bands) |
| **Trust semantics** | Highest trust. The VC is a signed assertion from the data's origin. No intermediary involved. |
| **Requirements** | Must control the DID listed in the TIR. Must operate its own VC issuance infrastructure. DID document must be resolvable and contain the signing key. |
| **proxyFor** | Not applicable — root issuers do not proxy for anyone. |

Root issuers represent the end state of PDTF 2.0's trust model. Initially, most root issuer entries will have `status: "planned"` because government agencies have not yet adopted PDTF 2.0 VC issuance. As adoption grows, these entries transition to `active`.

### 6.2 trustedProxy

| | |
|---|---|
| **Definition** | An authorised intermediary that fetches data from a primary source's API and repackages it as signed Verifiable Credentials. |
| **Examples** | Moverly's HMLR adapter (fetches via OC1 API), Moverly's EPC adapter (fetches via domestic energy API), any licensed data reseller with API access |
| **Trust semantics** | Intermediate trust. The verifier trusts that the proxy faithfully reproduced the source data without modification. The VC's `evidence` section should reference the source API call for auditability. |
| **Requirements** | Must declare `proxyFor` referencing the root issuer slug. Must have legitimate API access to the primary source. Must faithfully reproduce source data without modification or interpretation. |
| **proxyFor** | REQUIRED. References the slug of the root issuer whose data this proxy repackages. |

Trusted proxies are the **Phase 1** mechanism for PDTF 2.0 adoption. They bridge the gap between existing government APIs (which return JSON/XML, not VCs) and the PDTF 2.0 credential model.

### 6.3 accountProvider

| | |
|---|---|
| **Definition** | A platform that issues user or organisation DIDs and is responsible for identity verification at onboarding. |
| **Examples** | Moverly (issues `did:key` identifiers for sellers, buyers, conveyancers), future digital identity wallet providers, LMS user portals |
| **Trust semantics** | Trusted to have performed adequate identity verification before issuing a DID. The level of verification is described in the `identityVerification` field. |
| **Requirements** | Must describe its identity verification methods. Must maintain the binding between real-world identity and DID. Listed in `userAccountProviders`, not `issuers`. |
| **proxyFor** | Not applicable. |

Account providers answer a different question from data issuers: "Was this person's DID created by a platform I trust to have verified their identity?" This matters for Ownership and Representation credentials, where the credential's validity depends partly on the legitimacy of the subject's DID.

### 6.4 Trust Level Comparison

| Aspect | rootIssuer | trustedProxy | accountProvider |
|--------|-----------|--------------|-----------------|
| **Data source** | Own canonical dataset | Primary source API | User onboarding |
| **VC content** | Authoritative assertion | Faithful reproduction | Identity binding |
| **proxyFor required** | No | Yes | No |
| **Registry section** | `issuers` | `issuers` | `userAccountProviders` |
| **Phase** | Phase 3 (future) | Phase 1 (now) | Phase 1 (now) |
| **Example DID** | `did:web:hmlr.gov.uk` | `did:web:adapters.propdata.org.uk:hmlr` | `did:web:moverly.com` |

---

## 7. Verification Flow

### 7.1 Overview

When a verifier receives a Verifiable Credential, TIR verification is one step in the overall validation pipeline. The full pipeline is:

1. **Parse** the VC envelope and extract claims
2. **Resolve** the issuer's DID and retrieve the public key
3. **Verify** the cryptographic signature
4. **Check revocation** status (Bitstring Status List)
5. **Check TIR** — is this issuer authorised for these claims?
6. **Return** the composite verification result

Steps 1–4 are covered in other sub-specs. This section details step 5.

### 7.2 TIR Verification Steps

```
┌─────────────────────────────────────┐
│  1. Receive Verifiable Credential   │
│     Extract: issuer DID, entity     │
│     type, data paths                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  2. Look up issuer DID in TIR      │
│     Search both `issuers` and       │
│     `userAccountProviders`          │
│     by matching `did` field         │
└──────────────┬──────────────────────┘
               │
          ┌────┴────┐
          │ Found?  │
          └────┬────┘
         No    │    Yes
         │     │     │
         ▼     │     ▼
┌──────────┐   │  ┌─────────────────────────────────┐
│ UNTRUSTED│   │  │  3. Check status                 │
│ Return:  │   │  │     active → continue            │
│ unknown  │   │  │     planned → UNTRUSTED (not yet)│
│ issuer   │   │  │     deprecated → WARN + continue │
└──────────┘   │  │     revoked → UNTRUSTED          │
               │  └──────────────┬──────────────────┘
               │                 │
               │                 ▼
               │  ┌─────────────────────────────────┐
               │  │  4. Check validity period         │
               │  │     now < validFrom → UNTRUSTED  │
               │  │     now > validUntil → UNTRUSTED │
               │  │     else → continue              │
               │  └──────────────┬──────────────────┘
               │                 │
               │                 ▼
               │  ┌─────────────────────────────────┐
               │  │  5. Check authorisedPaths        │
               │  │     For each entity:path in VC:  │
               │  │     Run path matching algorithm  │
               │  │     All covered → continue       │
               │  │     Any uncovered → PARTIAL      │
               │  └──────────────┬──────────────────┘
               │                 │
               │                 ▼
               │  ┌─────────────────────────────────┐
               │  │  6. Return result                 │
               │  │     {                             │
               │  │       trusted: true,              │
               │  │       issuerSlug: "moverly-epc",  │
               │  │       trustLevel: "trustedProxy", │
               │  │       status: "active",           │
               │  │       pathsCovered: true,          │
               │  │       warnings: []                │
               │  │     }                             │
               │  └───────────────────────────────────┘
```

### 7.3 Verification Result Object

```typescript
interface TIRVerificationResult {
  /** Whether the issuer is trusted for the claimed paths */
  trusted: boolean;

  /** The issuer's slug in the TIR, or null if not found */
  issuerSlug: string | null;

  /** The trust level, or null if not found */
  trustLevel: "rootIssuer" | "trustedProxy" | "accountProvider" | null;

  /** The issuer's status in the TIR */
  status: "active" | "planned" | "deprecated" | "revoked" | "unknown";

  /** Whether all entity:paths in the VC are covered by authorisedPaths */
  pathsCovered: boolean;

  /** Paths in the VC not covered by the issuer's authorisedPaths */
  uncoveredPaths: string[];

  /** Non-fatal warnings (e.g. deprecated issuer) */
  warnings: string[];
}
```

### 7.4 Example: Successful Verification

A VC is received with:
- Issuer DID: `did:web:adapters.propdata.org.uk:epc`
- Entity type: `Property`
- Data path: `/energyEfficiency/certificate`

TIR lookup:
1. Find entry with `did` matching `did:web:adapters.propdata.org.uk:epc` → slug: `moverly-epc`
2. Status: `active` ✓
3. Validity: `validFrom` in the past, no `validUntil` ✓
4. Path check: `Property:/energyEfficiency/certificate` against `authorisedPaths: ["Property:/energyEfficiency/*"]` → wildcard match ✓

Result:
```json
{
  "trusted": true,
  "issuerSlug": "moverly-epc",
  "trustLevel": "trustedProxy",
  "status": "active",
  "pathsCovered": true,
  "uncoveredPaths": [],
  "warnings": []
}
```

### 7.5 Example: Path Not Authorised

A VC is received with:
- Issuer DID: `did:web:adapters.propdata.org.uk:epc`
- Entity type: `Property`
- Data path: `/buildingConstruction/wallType`

TIR lookup:
1. Find entry → slug: `moverly-epc`
2. Status: `active` ✓
3. Path check: `Property:/buildingConstruction/wallType` against `authorisedPaths: ["Property:/energyEfficiency/*"]` → no match ✗

Result:
```json
{
  "trusted": false,
  "issuerSlug": "moverly-epc",
  "trustLevel": "trustedProxy",
  "status": "active",
  "pathsCovered": false,
  "uncoveredPaths": ["Property:/buildingConstruction/wallType"],
  "warnings": ["Issuer moverly-epc is not authorised for path Property:/buildingConstruction/wallType"]
}
```

### 7.6 Example: Deprecated Issuer

When a root issuer goes active and the corresponding trusted proxy is deprecated:

```json
{
  "trusted": true,
  "issuerSlug": "moverly-hmlr",
  "trustLevel": "trustedProxy",
  "status": "deprecated",
  "pathsCovered": true,
  "uncoveredPaths": [],
  "warnings": [
    "Issuer moverly-hmlr is deprecated. Root issuer hmlr is now active. Credentials from this issuer will be rejected after 2027-06-01T00:00:00Z."
  ]
}
```

---

## 8. Registry Governance

### 8.1 Current Governance (Phase 1)

During Phase 1, the TIR is maintained by Moverly as the PDTF 2.0 steward:

| Role | Responsibility | Current Holder |
|------|---------------|----------------|
| **Registry maintainer** | Merges PRs, manages releases | Moverly (Ed Molyneux) |
| **Entry proposer** | Creates PRs to add/modify entries | Any organisation |
| **Schema guardian** | Approves changes to the TIR JSON Schema | Moverly |

### 8.2 Change Process

All changes to `registry.json` follow this workflow:

1. **Fork** the repository (or create a branch if you have write access)
2. **Modify** `registry.json` — add, update, or deprecate entries
3. **Update** the `updated` timestamp to the current ISO 8601 datetime
4. **Validate** locally: `node scripts/validate.js` (runs the JSON Schema check)
5. **Create a Pull Request** with:
   - Clear description of the change
   - Justification for new entries or status changes
   - Evidence of authority (e.g. organisation authorisation for a new adapter)
6. **CI validation** runs automatically — PR cannot merge if schema validation fails
7. **Review** by at least one registry maintainer
8. **Signed commit** — the merge commit MUST be GPG-signed by a maintainer
9. **Merge** to `main` — the TIR is immediately live

### 8.3 Change Categories

| Change Type | Review Required | Additional Evidence |
|-------------|----------------|-------------------|
| **New trusted proxy** | 1 maintainer | Proof of API access to source, organisation details |
| **New root issuer** | 2 maintainers | Confirmation from the issuing organisation |
| **New account provider** | 2 maintainers | Description of identity verification process |
| **Status change (active → deprecated)** | 1 maintainer | Reason for deprecation, migration timeline |
| **Status change (any → revoked)** | 1 maintainer | Immediate — can bypass PR in emergencies |
| **Path additions** | 1 maintainer | Justification for expanded scope |
| **Path removals** | 1 maintainer | Impact assessment (existing VCs at those paths) |
| **Schema changes** | 2 maintainers + RFC | Backward compatibility analysis |

### 8.4 Emergency Revocation

If an issuer is compromised or found to be issuing fraudulent credentials:

1. A maintainer MAY push a direct commit to `main` (bypassing the PR process)
2. The entry's `status` is set to `revoked`
3. A post-hoc PR is created documenting the revocation and rationale
4. All verifiers will pick up the revocation on their next cache refresh (see [Section 9](#9-caching-strategy))

### 8.5 Future Governance (Phase 2+)

As PDTF 2.0 adoption grows, governance should evolve:

- **Multi-stakeholder review board** — representatives from multiple organisations with merge rights
- **Formal RFC process** for schema changes
- **Automated validation** — beyond schema checks, verify that DID documents resolve and contain signing keys
- **Signed registry** — the `registry.json` itself could be signed (JWS detached payload) for additional integrity
- **Potential move to a smart contract or distributed ledger** — only if GitHub-based governance proves insufficient (not anticipated near-term)

---

## 9. Caching Strategy

### 9.1 Fetching the TIR

Verifiers MUST NOT fetch the TIR from GitHub on every credential verification. The TIR changes infrequently (new entries are added at most weekly), and GitHub rate limits apply to API requests.

**Recommended approach:** Use the GitHub Contents API with conditional requests:

```http
GET /repos/property-data-standards-co/trusted-issuer-registry/contents/registry.json
Accept: application/vnd.github.raw+json
If-None-Match: "abc123def456"
```

Response if unchanged:
```http
HTTP/1.1 304 Not Modified
```

Response if changed:
```http
HTTP/1.1 200 OK
ETag: "xyz789ghi012"
Content-Type: application/json

{ ... registry content ... }
```

### 9.2 Cache Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **TTL (normal)** | 1 hour | Balances freshness with GitHub API rate limits |
| **TTL (after error)** | 5 minutes | Retry sooner after transient failures |
| **Max stale** | 24 hours | If GitHub is completely unreachable, use the last known good TIR for up to 24 hours |
| **ETag storage** | Persistent | Store the ETag alongside the cached registry to enable conditional requests |

### 9.3 Cache Implementation

```typescript
interface TIRCache {
  /** The cached registry data */
  registry: TrustedIssuerRegistry;

  /** ETag from the last successful fetch */
  etag: string | null;

  /** Timestamp of the last successful fetch */
  lastFetched: Date;

  /** Timestamp of the last successful update (registry actually changed) */
  lastUpdated: Date;

  /** Number of consecutive fetch failures */
  failureCount: number;
}

async function fetchTIR(cache: TIRCache): Promise<TIRCache> {
  const now = new Date();
  const ttl = cache.failureCount > 0 ? 5 * 60 * 1000 : 60 * 60 * 1000;

  // Within TTL — return cached
  if (now.getTime() - cache.lastFetched.getTime() < ttl) {
    return cache;
  }

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: {
        'Accept': 'application/vnd.github.raw+json',
        ...(cache.etag ? { 'If-None-Match': cache.etag } : {})
      }
    });

    if (response.status === 304) {
      // Not modified — update lastFetched, keep data
      return { ...cache, lastFetched: now, failureCount: 0 };
    }

    if (response.ok) {
      const registry = await response.json();
      const etag = response.headers.get('etag');
      return {
        registry,
        etag,
        lastFetched: now,
        lastUpdated: now,
        failureCount: 0
      };
    }

    throw new Error(`GitHub API returned ${response.status}`);
  } catch (error) {
    const staleDuration = now.getTime() - cache.lastFetched.getTime();
    const maxStale = 24 * 60 * 60 * 1000;

    if (staleDuration < maxStale && cache.registry) {
      // Use stale cache
      console.warn(`TIR fetch failed, using stale cache (age: ${staleDuration}ms)`);
      return { ...cache, failureCount: cache.failureCount + 1 };
    }

    throw new Error('TIR unavailable and cache expired');
  }
}
```

### 9.4 Fallback Behaviour

If the TIR cannot be fetched and the cache has expired beyond `maxStale`:

| Scenario | Behaviour |
|----------|-----------|
| **Stale cache within 24h** | Use cached TIR, log warning, continue verification |
| **Stale cache beyond 24h** | Fail open or fail closed depending on verifier configuration |
| **No cache at all** | MUST fail verification — cannot verify issuer trust without a TIR |

**Fail-open vs fail-closed** is a deployment decision:

- **Fail-closed** (recommended for high-assurance contexts): If the TIR is unavailable, treat all issuers as untrusted. Verification fails.
- **Fail-open** (acceptable for low-assurance contexts like UI display): If the TIR is unavailable, skip TIR verification and flag the result as `trustUnverified`.

### 9.5 Bundled Bootstrap TIR

Reference implementations SHOULD ship with a bundled copy of the TIR at build time. This bootstrap copy is used:

- On first run before any network fetch
- As a last resort if both live fetch and cache fail

The bundled TIR MUST be updated with each release of the reference implementation.

---

## 10. Initial Registry Entries

The following entries constitute the initial TIR, aligned with the architecture overview:

### 10.1 Full Initial `registry.json`

```json
{
  "$schema": "./schema/tir-schema.json",
  "version": "1.0",
  "updated": "2026-03-24T12:00:00Z",
  "issuers": {
    "hmlr": {
      "name": "HM Land Registry",
      "did": "did:web:hmlr.gov.uk",
      "authorisedPaths": [
        "Title:/titleNumber",
        "Title:/titleExtents",
        "Title:/registerExtract/*",
        "Title:/ownership/*"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned",
      "validFrom": null,
      "validUntil": null,
      "contact": null,
      "website": "https://www.gov.uk/government/organisations/land-registry"
    },
    "mhclg-epc": {
      "name": "Ministry of Housing — EPC Register",
      "did": "did:web:epc.communities.gov.uk",
      "authorisedPaths": [
        "Property:/energyEfficiency/certificate"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned",
      "validFrom": null,
      "validUntil": null,
      "contact": null,
      "website": "https://www.gov.uk/find-energy-certificate"
    },
    "voa": {
      "name": "Valuation Office Agency",
      "did": "did:web:voa.gov.uk",
      "authorisedPaths": [
        "Property:/councilTax/*"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned",
      "validFrom": null,
      "validUntil": null,
      "contact": null,
      "website": "https://www.gov.uk/government/organisations/valuation-office-agency"
    },
    "moverly-hmlr": {
      "name": "Moverly (HMLR Proxy)",
      "did": "did:web:adapters.propdata.org.uk:hmlr",
      "authorisedPaths": [
        "Title:/titleNumber",
        "Title:/titleExtents",
        "Title:/registerExtract/*",
        "Title:/ownership/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "hmlr",
      "status": "active",
      "validFrom": "2026-03-01T00:00:00Z",
      "validUntil": null,
      "contact": "trust@moverly.com",
      "website": "https://moverly.com"
    },
    "moverly-epc": {
      "name": "Moverly (EPC Proxy)",
      "did": "did:web:adapters.propdata.org.uk:epc",
      "authorisedPaths": [
        "Property:/energyEfficiency/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "mhclg-epc",
      "status": "active",
      "validFrom": "2026-03-01T00:00:00Z",
      "validUntil": null,
      "contact": "trust@moverly.com",
      "website": "https://moverly.com"
    },
    "moverly-ea": {
      "name": "Moverly (Environment Agency Proxy)",
      "did": "did:web:adapters.propdata.org.uk:ea-flood",
      "authorisedPaths": [
        "Property:/environmentalIssues/flooding/*"
      ],
      "trustLevel": "trustedProxy",
      "proxyFor": "environment-agency",
      "status": "active",
      "validFrom": "2026-03-01T00:00:00Z",
      "validUntil": null,
      "contact": "trust@moverly.com",
      "website": "https://moverly.com"
    },
    "environment-agency": {
      "name": "Environment Agency",
      "did": "did:web:environment.data.gov.uk",
      "authorisedPaths": [
        "Property:/environmentalIssues/flooding/*"
      ],
      "trustLevel": "rootIssuer",
      "status": "planned",
      "validFrom": null,
      "validUntil": null,
      "contact": null,
      "website": "https://www.gov.uk/government/organisations/environment-agency"
    }
  },
  "userAccountProviders": {
    "moverly": {
      "name": "Moverly",
      "did": "did:web:moverly.com",
      "description": "Issues user DIDs (did:key) as account provider. Validates user and organisation identity at onboarding via email, SMS, and document verification.",
      "trustLevel": "accountProvider",
      "identityVerification": {
        "methods": ["email", "sms", "document-check"],
        "description": "Email verification at registration, SMS verification for account recovery, document-based identity checks for seller/buyer roles. Organisation identity verified via SRA number and Companies House registration."
      },
      "managedOrganisations": "https://moverly.com/.well-known/pdtf-managed-orgs.json",
      "status": "active",
      "validFrom": "2026-03-01T00:00:00Z",
      "validUntil": null,
      "contact": "trust@moverly.com",
      "website": "https://moverly.com"
    }
  }
}
```

### 10.2 Entry Summary

| Slug | Name | Trust Level | Status | Authorised Paths |
|------|------|-------------|--------|-----------------|
| `hmlr` | HM Land Registry | rootIssuer | planned | Title: titleNumber, titleExtents, registerExtract/*, ownership/* |
| `mhclg-epc` | MHCLG — EPC Register | rootIssuer | planned | Property: energyEfficiency/certificate |
| `voa` | Valuation Office Agency | rootIssuer | planned | Property: councilTax/* |
| `environment-agency` | Environment Agency | rootIssuer | planned | Property: environmentalIssues/flooding/* |
| `moverly-hmlr` | Moverly (HMLR Proxy) | trustedProxy | active | Title: titleNumber, titleExtents, registerExtract/*, ownership/* |
| `moverly-epc` | Moverly (EPC Proxy) | trustedProxy | active | Property: energyEfficiency/* |
| `moverly-ea` | Moverly (EA Proxy) | trustedProxy | active | Property: environmentalIssues/flooding/* |
| `moverly` | Moverly (Account Provider) | accountProvider | active | — (user DIDs) |

---

## 11. Migration Path

> **Decision D24:** 3-phase evolution: Moverly proxies → separately hosted adapters → root issuers.

### 11.1 Phase 1 → Phase 2: Adapter Independence

When adapters move from Moverly-hosted to independently hosted infrastructure:

1. **New entries** are added for the independently hosted adapters (e.g. `propdata-hmlr`)
2. **DID changes** — the new adapter gets its own `did:web` under the independent domain
3. **Old entries** (`moverly-hmlr`, etc.) transition to `deprecated` with a `validUntil` date
4. **Overlap period** — both old and new entries are `active` during migration
5. **Old entries** eventually transition to `revoked` after the overlap period

Example diff:
```json
{
  "moverly-hmlr": {
    "status": "deprecated",
    "validUntil": "2027-06-01T00:00:00Z"
  },
  "propdata-hmlr": {
    "name": "PropData Standards (HMLR Adapter)",
    "did": "did:web:adapters.propdata.org.uk:hmlr-v2",
    "authorisedPaths": [
      "Title:/titleNumber",
      "Title:/titleExtents",
      "Title:/registerExtract/*",
      "Title:/ownership/*"
    ],
    "trustLevel": "trustedProxy",
    "proxyFor": "hmlr",
    "status": "active",
    "validFrom": "2027-01-01T00:00:00Z"
  }
}
```

### 11.2 Phase 2 → Phase 3: Root Issuer Activation

When a primary source (e.g. HMLR) begins issuing PDTF-compliant VCs directly:

1. The root issuer entry transitions from `planned` to `active`
2. The `did` field is updated to the issuer's actual production DID (if it differs from the placeholder)
3. The corresponding trusted proxy entry transitions to `deprecated`
4. A `validUntil` date is set on the proxy entry (e.g. 6 months from root issuer activation)
5. After the overlap period, the proxy entry is `revoked`

```
Timeline:
─────────────────────────────────────────────────────────────
Phase 1        Phase 2              Phase 3
(now)          (medium-term)        (future)

moverly-hmlr:  ████ active ████     ▓▓ deprecated ▓▓  revoked
propdata-hmlr:                      ████ active ████   ▓▓ deprecated ▓▓
hmlr:          planned              planned            ████ active ████
─────────────────────────────────────────────────────────────
```

### 11.3 Backward Compatibility

Existing VCs issued by deprecated or revoked issuers remain cryptographically valid — their signatures don't change. The TIR status affects **new verification decisions**, not historical ones.

Verifiers SHOULD implement a policy for handling credentials from deprecated issuers:

- **Accept with warning** during the overlap period
- **Reject** after `validUntil` for revoked issuers
- **Log** for audit purposes when a deprecated issuer's credential is encountered (signals that the data consumer needs to refresh)

---

## 12. Security Considerations

### 12.1 GitHub Repository Compromise

**Threat:** An attacker gains write access to the `trusted-issuer-registry` repository and adds a malicious issuer entry.

**Mitigations:**
- **Branch protection** on `main` — no direct pushes except emergency revocations
- **Required reviews** — at least 1 (or 2 for high-impact changes) maintainer approvals
- **Signed commits** — all merge commits must be GPG-signed by a known maintainer key
- **CI validation** — schema validation and entry cross-checks run on every PR
- **Audit log** — GitHub provides a full audit log of all repository events
- **Monitoring** — automated alerts on unexpected registry changes (e.g. new entries appearing without a corresponding PR)

**Residual risk:** If a maintainer's GitHub account and GPG key are both compromised, a malicious entry could be merged. Multi-stakeholder governance (Phase 2+) reduces this by requiring multiple independent approvals.

### 12.2 DID:web DNS Attacks

**Threat:** An attacker compromises DNS for a `did:web` domain (e.g. `adapters.propdata.org.uk`) and serves a malicious DID document with their own signing key. If the attacker's DID matches a TIR entry, verifiers would trust credentials signed by the attacker.

**Mitigations:**
- **DNSSEC** — all `did:web` domains used in the TIR SHOULD use DNSSEC
- **DID document pinning** — verifiers MAY cache DID documents and alert on unexpected key changes
- **Certificate Transparency** — monitor CT logs for certificates issued for TIR-listed domains
- **TIR cross-check** — the TIR `did` field provides a second source of truth. If DID resolution returns a different DID than what's in the TIR, verification fails.

### 12.3 Stale Cache Exploitation

**Threat:** An attacker targets the window between an issuer being revoked in the TIR and verifiers refreshing their cache.

**Mitigations:**
- **1-hour TTL** limits the exposure window
- **Revocation is defence-in-depth** — VC revocation via Bitstring Status List is a separate, faster mechanism. A compromised issuer's credentials should be revoked at the credential level (immediate) as well as at the TIR level (within cache TTL).
- **Push notifications** (future) — webhook or event-driven cache invalidation for critical changes

### 12.4 Issuer Key Rotation Without TIR Update

**Threat:** An issuer rotates their signing key but the TIR still references the old DID. If the DID method handles key rotation correctly (e.g. DID document updated with new key), this is not a TIR issue. But if the issuer changes their DID entirely, the TIR entry must be updated.

**Mitigation:** TIR entries reference DIDs, not keys. DID methods handle key rotation internally. If an issuer changes their DID (e.g. domain change), a new TIR entry is required.

### 12.5 Enumeration and Privacy

**Consideration:** The TIR is public. It reveals which organisations are participating in PDTF 2.0, their DIDs, and what data paths they are authorised for. This is intentional — transparency is a feature of the trust model, not a bug. However:

- The TIR does NOT contain personal data
- The TIR does NOT reveal which specific properties have been queried
- User DIDs are `did:key` (not `did:web`), so the TIR reveals the account *provider* but not individual users

---

## 13. Open Questions

| # | Question | Context | Status |
|---|----------|---------|--------|
| Q1 | Should the TIR support multiple DIDs per issuer (for key rotation)? | If an issuer transitions from one DID to another, should the TIR entry list both during the overlap? Or should two entries exist? | Open |
| Q2 | Should the TIR be signed (JWS detached payload)? | This would provide integrity verification beyond GitHub's audit trail. Useful if the TIR is fetched from a mirror. | Open |
| Q3 | How should "multi-path" credentials be handled? | A single VC covering data from multiple entity:path combinations — should ALL paths be authorised, or is partial coverage acceptable? | Leaning: ALL paths must be covered |
| Q4 | Should there be a TIR for test/staging environments? | Separate registry for non-production issuers, or a `test` status in the main registry? | Open |
| Q5 | Should trust levels have numeric weights for programmatic comparison? | e.g. rootIssuer=3, trustedProxy=2, accountProvider=1 — or is the enum sufficient? | Leaning: enum is sufficient |
| Q6 | How should verifiers handle the case where two issuers are authorised for the same entity:path? | Multiple trusted proxies for the same data source — is this allowed? Should there be conflict resolution? | Leaning: allowed, verifier accepts any matching entry |
| Q7 | Should the TIR include a `revokedAt` timestamp when an entry is revoked? | Useful for audit: "this issuer was revoked at X, any credentials issued after X are suspect" | Open |
| Q8 | Should the `environment-agency` root issuer entry exist at launch? | It was not in the original architecture overview `issuers` map — added here for completeness. The `moverly-ea` proxy needs a `proxyFor` target. | Needs confirmation |

---

## 14. Implementation Notes

### 14.1 Reference Implementation

The TIR verification logic will be implemented in the `pdtf-vc-validator` package:

```
property-data-standards-co/pdtf-vc-validator
├── src/
│   ├── tir/
│   │   ├── fetch.ts          # TIR fetching with caching
│   │   ├── cache.ts          # Cache management
│   │   ├── verify.ts         # TIR verification logic
│   │   ├── pathMatch.ts      # Entity:path matching algorithm
│   │   └── types.ts          # TypeScript types for TIR
│   └── ...
```

### 14.2 Key Dependencies

- **TIR fetch:** `fetch` API (Node 18+) or `undici` for HTTP requests with ETag support
- **JSON Schema validation:** `ajv` for validating `registry.json` against the schema
- **DID resolution:** Separate concern — `pdtf-did-resolver` package handles DID document fetching

### 14.3 Integration with VC Validator

The TIR check is called from the main VC validation pipeline:

```typescript
import { verifyCredential } from '@pdtf/vc-validator';

const result = await verifyCredential(credential, {
  tirUrl: 'https://api.github.com/repos/property-data-standards-co/trusted-issuer-registry/contents/registry.json',
  tirCache: cache,           // Persistent cache instance
  tirFailMode: 'closed',    // 'closed' | 'open'
});

// result.tir contains TIRVerificationResult
// result.signature contains cryptographic verification result
// result.revocation contains revocation check result
// result.valid is the composite boolean
```

### 14.4 CI Validation Workflow

The `trusted-issuer-registry` repo includes a GitHub Actions workflow that validates the registry on every PR:

```yaml
# .github/workflows/validate.yml
name: Validate Registry

on:
  pull_request:
    paths: ['registry.json']

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Validate registry against schema
        run: node scripts/validate.js

      - name: Check slug uniqueness
        run: node scripts/check-slugs.js

      - name: Verify DID format
        run: node scripts/check-dids.js

      - name: Check proxyFor references
        run: node scripts/check-proxy-refs.js
```

### 14.5 Architecture Decision References

| Decision | Summary | Date | Status |
|----------|---------|------|--------|
| **D8** | GitHub-based TIR at `property-data-standards-co` | 2026-03-23 | ✅ Confirmed |
| **D20** | TIR describes entity:path combos (e.g. `Property:/energyEfficiency/certificate`) | 2026-03-23 | ✅ Confirmed |
| **D21** | User DID issuers (account providers) must also be in TIR | 2026-03-23 | ✅ Confirmed |
| **D24** | 3-phase evolution: Moverly proxies → separately hosted adapters → root issuers | 2026-03-23 | ✅ Confirmed |

---

## Appendix A: Entity:Path Quick Reference

Common entity:path combinations referenced across PDTF 2.0 sub-specs:

| Entity:Path | Description | Typical Issuer |
|------------|-------------|----------------|
| `Title:/titleNumber` | Title number | HMLR (via proxy) |
| `Title:/titleExtents` | Boundary geometry (GeoJSON) | HMLR (via proxy) |
| `Title:/registerExtract/*` | Full register extract | HMLR (via proxy) |
| `Title:/registerExtract/proprietorship` | Proprietorship register | HMLR (via proxy) |
| `Title:/registerExtract/charges` | Charges register | HMLR (via proxy) |
| `Title:/registerExtract/restrictions` | Restrictions | HMLR (via proxy) |
| `Title:/ownership/*` | Ownership assertions | HMLR (via proxy) |
| `Property:/energyEfficiency/certificate` | EPC certificate | MHCLG (via proxy) |
| `Property:/energyEfficiency/recommendation` | EPC recommendations | MHCLG (via proxy) |
| `Property:/environmentalIssues/flooding/*` | Flood risk data | EA (via proxy) |
| `Property:/councilTax/*` | Council tax band + valuation | VOA (via proxy) |
| `Property:/address` | Property address | Multiple sources |
| `Ownership:/status` | Ownership claim status | Account provider |
| `Representation:/role` | Representation role | Account provider |

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **TIR** | Trusted Issuer Registry — the canonical list of authorised VC issuers |
| **Issuer slug** | Stable, lowercase-hyphenated identifier for a registry entry |
| **Entity:path** | Format `Entity:/json/pointer/path` describing a specific data location |
| **Root issuer** | Primary authoritative data source (e.g. HMLR) |
| **Trusted proxy** | Authorised intermediary that repackages source data as VCs |
| **Account provider** | Platform that issues user/org DIDs with identity verification |
| **DID** | Decentralised Identifier (W3C standard) |
| **VC** | Verifiable Credential (W3C standard) |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | `managedOrganisations` field added to `accountProvider` entries — URL to signed JSON listing verified Organisation `did:key` identifiers. JSON Schema updated. Initial registry entry for Moverly updated. |
| v0.1 | 24 March 2026 | Initial draft. GitHub-hosted registry, entity:path authorisation, trust levels (rootIssuer/trustedProxy/accountProvider), status lifecycle, caching, CI validation, governance model, initial registry entries. |

---

*This document is part of the PDTF 2.0 specification suite. See [00 — Architecture Overview](../00-architecture-overview/) for the full sub-spec index.*
