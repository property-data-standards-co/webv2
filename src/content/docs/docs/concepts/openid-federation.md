---
title: "OpenID Federation"
description: "How PDTF uses OpenID Federation to establish who can issue which property credentials"
---

**OpenID Federation** is an [OpenID standard](https://openid.net/specs/openid-federation-1_0.html) that lets organisations establish trust relationships without pre-shared secrets or centralised directories. PDTF 2.0 uses it as the backbone for deciding which data sources and adapters are authorised to issue property credentials.

If Verifiable Credentials answer *"was this data tampered with?"*, OpenID Federation answers *"should I trust the organisation that issued it?"*

## The core idea: trust chains

OpenID Federation works through **trust chains** — a sequence of signed statements that link an organisation back to a known authority.

Every participant in the federation publishes a **federation entity statement** — a signed JSON document at a well-known URL that describes who they are and what they do. A **Trust Anchor** (the top of the chain) signs **subordinate statements** about entities it trusts. Those statements can be chained — the anchor trusts an intermediate, the intermediate trusts a leaf — forming a verifiable path from any participant back to the root.

```
Trust Anchor (propdata.org.uk)
  └─ Subordinate: Moverly HMLR Adapter
  └─ Subordinate: Moverly EPC Adapter
  └─ Subordinate: LMS Title Adapter
```

Each link in the chain is a signed JWT. A verifier walks the chain from bottom to top, checking signatures at each step. If the chain terminates at a Trust Anchor the verifier recognises, the entity is trusted.

## How it works in PDTF

In the PDTF ecosystem:

- **Trust Anchor**: `propdata.org.uk` operates the federation Trust Anchor. It publishes its own entity statement at `https://propdata.org.uk/.well-known/openid-federation` and signs subordinate statements for authorised adapters.
- **Subordinate entities**: Each adapter (e.g. Moverly's HMLR proxy, an EPC adapter) publishes its own entity statement and is referenced by a subordinate statement from the Trust Anchor.
- **Trust Marks**: The Trust Anchor issues **Property Trust Marks** — signed tokens that declare what an entity is authorised to do.

### Entity statements

An entity statement is a signed JWT published at `{entity_url}/.well-known/openid-federation`. It contains:

- **`iss`** — who issued the statement (the entity itself for self-signed, or the superior for subordinate statements)
- **`sub`** — the entity being described
- **`jwks`** — the entity's public keys
- **`metadata`** — what the entity does (e.g. credential issuer metadata, federation entity metadata)
- **`trust_marks`** — the Trust Marks this entity holds

```json
{
  "iss": "https://adapters.propdata.org.uk/hmlr",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "jwks": { "keys": [{ "kty": "OKP", "crv": "Ed25519", "..." : "..." }] },
  "metadata": {
    "federation_entity": {
      "organization_name": "Moverly HMLR Adapter",
      "homepage_uri": "https://moverly.com"
    },
    "openid_credential_issuer": {
      "credential_configurations_supported": { "..." : "..." }
    }
  },
  "trust_marks": [
    { "id": "https://propdata.org.uk/trust-marks/title-data-provider", "trust_mark": "eyJ..." }
  ]
}
```

## Property Trust Marks

A **Trust Mark** is a signed JWT issued by the Trust Anchor that declares an entity's authorisation. Think of it like a digital badge — *"this adapter is an authorised title data provider"*.

Each Property Trust Mark contains:

| Field | Purpose | Example |
|---|---|---|
| `id` | The trust mark type URI | `https://propdata.org.uk/trust-marks/title-data-provider` |
| `iss` | The Trust Anchor that issued it | `https://propdata.org.uk` |
| `sub` | The entity it's issued to | `https://adapters.propdata.org.uk/hmlr` |
| `iat` / `exp` | When issued and when it expires | Standard JWT timestamps |
| `trust_level` | Root issuer or trusted proxy | `trustedProxy` |
| `authorised_paths` | Which entity:path combos the entity can issue credentials for | `["Title:/registerExtract/*", "Title:/ownership/*"]` |

### Current Property Trust Marks

| Trust Mark ID | Purpose |
|---|---|
| `title-data-provider` | Authorised to issue Title credentials (register extracts, ownership, title extents) |
| `property-data-provider` | Authorised to issue Property credentials (EPC, flood risk, council tax, etc.) |
| `regulated-conveyancer` | Authorised to act as a conveyancer in transactions (representation, delegated consent) |
| `account-provider` | Authorised to issue user and organisation DIDs |

Trust marks are **scoped** — holding `title-data-provider` doesn't grant authority over Property data, and vice versa. The `authorised_paths` field narrows trust even further:

```json
{
  "id": "https://propdata.org.uk/trust-marks/property-data-provider",
  "sub": "https://adapters.propdata.org.uk/epc",
  "trust_level": "trustedProxy",
  "authorised_paths": ["Property:/energyEfficiency/*"]
}
```

This adapter is trusted only for EPC data — not flood, not council tax, not anything else on the Property entity.

## How verification works

When a verifier receives a credential, the trust check follows this sequence:

1. **Resolve the issuer's entity statement** — fetch from `{issuer_url}/.well-known/openid-federation`
2. **Build the trust chain** — follow the chain of subordinate statements up to the Trust Anchor
3. **Validate signatures** — every statement in the chain must be properly signed
4. **Check the Trust Mark** — find the relevant trust mark for the credential type
5. **Verify path authorisation** — confirm the trust mark's `authorised_paths` cover the credential's data paths
6. **Check status** — ensure the trust mark hasn't expired or been revoked

```typescript
import { FederationRegistryResolver } from '@pdtf/core';

const resolver = new FederationRegistryResolver({
  trustAnchors: ['https://propdata.org.uk'],
});

const trustResult = await resolver.verifyIssuer({
  issuerUrl: 'https://adapters.propdata.org.uk/epc',
  credentialPaths: ['Property:/energyEfficiency/*'],
});

if (!trustResult.trusted) {
  console.error('Untrusted issuer:', trustResult.reason);
}
```

## Why this matters for property

OpenID Federation isn't just a PDTF invention — it's a standard being adopted across several adjacent ecosystems:

- **UK Smart Data** — the government's initiative for portable, verified data across sectors (energy, telecoms, finance, property)
- **GOV.UK Wallet** — the upcoming UK digital identity wallet will use OpenID Federation for trust establishment
- **EUDI Wallet** — the EU Digital Identity framework uses the same trust chain model

By building on OpenID Federation now, PDTF credentials will be verifiable by wallets and systems that don't know anything about property — they just need to recognise the Trust Anchor. A conveyancer's wallet app, a mortgage lender's system, or a government portal can all verify the same credential using the same trust chain.

This is the difference between building a proprietary trust system that only works within PDTF, and building on an open standard that interoperates with the wider digital identity ecosystem.

## Relationship to the old TIR

Earlier PDTF documentation described a **Trusted Issuer Registry (TIR)** — a static JSON file listing authorised issuers. OpenID Federation replaces this with a dynamic, standards-based approach:

| Aspect | Old TIR | OpenID Federation |
|---|---|---|
| Format | Static JSON file in a Git repo | Signed JWTs at well-known URLs |
| Trust establishment | Manual review of the JSON | Cryptographic trust chains |
| Revocation | Change status in JSON and push | Revoke the trust mark or subordinate statement |
| Interoperability | PDTF-specific | Standard across digital identity ecosystems |
| Discovery | Fetch a known URL | Automatic via `.well-known/openid-federation` |

The `@pdtf/core` library abstracts this — `FederationRegistryResolver` handles trust chain resolution, trust mark verification, and path authorisation checks behind the same `verifyIssuer` interface.
