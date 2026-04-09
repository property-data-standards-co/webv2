---
title: Why Verifiable Credentials?
description: Why PDTF 2.0 moves from OpenID Connect verified claims to W3C Verifiable Credentials — and what this means for property data trust.
---

*Published by the Property Data Standards Company*

## The original approach

When PDTF v1 was designed, it used OpenID Connect (OIDC) verified claims as the trust mechanism. The model worked like this: an authorised data provider would submit a claim against a specific path in the property data schema — say, `propertyPack.energyPerformance.currentRating` — and the platform would record who made the claim and when.

This was pragmatic. OIDC is well-understood, widely deployed, and has mature tooling. For a system where one platform orchestrates data collection and all parties access data through that platform, it works.

But it has fundamental limitations.

## What's wrong with OIDC verified claims for property data?

### Trust is platform-bound

In the OIDC model, you trust the claim because you trust the platform that recorded it. The platform verified the provider's identity (via OAuth tokens), accepted the claim, and stored it. Verification means asking the platform: "Did provider X submit this data?"

This creates a single point of trust. If the platform is unavailable, compromised, or disputed, the claim's provenance is unverifiable. The data is only as trustworthy as the platform serving it.

### Claims aren't portable

An OIDC verified claim is meaningful only within the context of the platform that issued it. Export the data to another system and you lose the provenance chain. The receiving system has no way to independently verify who produced the data or whether it's been modified.

For property data, this matters. Transactions involve multiple parties on different systems — estate agents, conveyancers, lenders, search providers. Data needs to move between them without losing its trust properties.

### No selective disclosure

The OIDC model operates on the full transaction document. A claim covers a specific path, but verification requires access to the platform's claim records. There's no mechanism for a party to present a subset of verified data — say, just the EPC and flood risk — without exposing the full transaction context.

### Provenance is complex

PDTF v1's evidence schema, derived from OIDC patterns, became deeply nested and difficult to implement. In practice, most claims followed a simple pattern: "this data came from this source, retrieved on this date." The evidence model was over-engineered for the actual use cases.

## What Verifiable Credentials solve

W3C Verifiable Credentials address each of these limitations:

### Cryptographic verification

A Verifiable Credential contains a digital signature from its issuer. Anyone with the issuer's public key can verify the signature — no need to contact the issuer or any intermediary platform. The data carries its own proof.

```
Platform trust:  "Do I trust the platform that stored this claim?"
Crypto trust:    "Does the signature verify against the issuer's public key?"
```

The second question can be answered by any party, at any time, without network access to the original issuer.

### Portability

A credential is a self-contained document. It includes the data, the issuer's identifier, the cryptographic proof, and provenance information. Move it between systems, store it offline, transmit it via email — the trust properties travel with it.

This is transformative for property transactions, where data flows through multiple organisations over weeks or months.

### Federated trust

Instead of a single trusted platform, PDTF 2.0 uses a Trusted Issuer Registry (TIR) — a public, version-controlled list of authorised issuers. Verifiers check two things:

1. Does the cryptographic signature verify?
2. Is the issuer registered in the TIR for this type of data?

Multiple organisations can issue the same types of credentials. No single point of failure. New issuers can be added by updating the registry.

### Simpler evidence model

Verifiable Credentials have a built-in `evidence` field that naturally supports the patterns PDTF actually needs:

```json
{
  "evidence": [{
    "type": "DataSourceEvidence",
    "source": "urn:pdtf:datasource:hmlr",
    "retrievedAt": "2026-03-15T10:30:00Z",
    "reference": "OC12345"
  }]
}
```

Clean, flat, implementable. No deeply nested OIDC-derived structures.

### Selective disclosure by design

Because each entity in the PDTF graph is a separate credential, parties can share exactly the credentials they need. A buyer's conveyancer can present the Property credential and the Title credential to a lender without exposing the Transaction details. The lender verifies each credential independently.

## The trade-offs

Moving to Verifiable Credentials isn't without cost:

| Consideration | Impact |
|--------------|--------|
| **Key management** | Issuers need to generate, store, and rotate cryptographic keys. More complex than OAuth client credentials. |
| **Revocation** | Credentials need a revocation mechanism. PDTF uses Bitstring Status List — effective but requires issuers to maintain status list endpoints. |
| **Standards maturity** | The VC ecosystem is younger than OIDC. Tooling exists but isn't as battle-tested. |
| **Migration** | Existing PDTF v1 implementations need to adopt new libraries and patterns. The [state assembly layer](/web/specs/07-state-assembly/) provides backward compatibility during transition. |

These are real costs, but they're implementation costs — they add complexity for system builders, not for end users. And the benefits — portable trust, cryptographic verification, federated issuance — are architectural advantages that compound over time.

## The bottom line

OIDC verified claims were the right choice for PDTF v1: pragmatic, quick to implement, and sufficient for a single-platform model.

But property data needs to be trusted across platforms, across organisations, and across time. Verifiable Credentials make the data itself trustworthy, not just the system serving it. That's the foundation PDTF 2.0 builds on.

[Read the architecture overview →](/web/architecture/overview/)
