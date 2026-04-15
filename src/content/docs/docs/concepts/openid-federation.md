---
title: "OpenID Federation (relying on Trust Anchors, Federation Entity Statements, and Property Trust Marks like `title-data-provider` and `regulated-conveyancer`)"
description: "How the OpenID Federation governs who can issue which credentials"
---

The **OpenID Federation** is the policy layer of PDTF 2.0. A valid signature tells you *who* signed a credential. The OpenID Federation tells you whether that issuer is actually **authorised** to make that kind of claim.

## Why the OpenID Federation exists

Anyone can generate a DID and sign JSON. That is not enough.

For example, a credential claiming title-register data should only be trusted if the issuer is recognised for the relevant **entity and path**, such as:

- `Title:/registerExtract/*`
- `Title:/ownership/*`

The OpenID Federation is how verifiers distinguish between:

- a genuine root issuer
- a trusted proxy adapter
- an unrelated signer with no authority

## What the OpenID Federation contains

The registry is a public, version-controlled JSON document. It records:

- issuer name
- issuer DID
- authorised entity:path combinations
- trust level
- lifecycle status
- optional metadata such as contact details

It also separately records **user account providers** that issue trusted user identities.

## Entity:path authorisation

A core PDTF design choice is that trust is not granted at whole-issuer level. It is granted at **entity:path** level.

Example:

```json
{
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
  "status": "active"
}
```

That means the issuer is trusted only for those title-related claims, not for unrelated Property or Transaction data.

## Trust levels

PDTF currently recognises three main trust roles:

- **`rootIssuer`**: the primary authoritative source
- **`trustedProxy`**: an intermediary adapter issuing faithfully from a primary source
- **`accountProvider`**: a platform trusted to issue or manage user DIDs

This supports PDTF's three-phase trust evolution:

1. trusted proxies today
2. more independently hosted adapters
3. eventual primary-source issuance

## How verification uses the OpenID Federation

A verifier should not stop after checking the credential signature. It should also:

1. resolve the issuer DID
2. verify the credential proof
3. load the OpenID Federation
4. find the issuer entry
5. confirm the issuer is active
6. confirm the issuer is authorised for the credential's entity paths

Only then should the claim be treated as trusted.

## Why GitHub-based governance

The OpenID Federation is designed as a public GitHub repository rather than a hidden service. That gives:

- version history
- visible change control
- easy review through pull requests
- straightforward machine access
- simple caching and mirroring

That is a good fit for trust infrastructure, where transparency matters as much as uptime.

## Why it matters

The OpenID Federation is what makes federation workable. It decouples **cryptographic identity** from **domain authority**.

A verifier does not need to hardcode trust in Moverly, LMS, HMLR, or any future adapter. It checks the issuer's DID, then checks the OpenID Federation to see whether that issuer is trusted for the exact claims being made.

That is the missing layer between "signed" and "authoritative", and it is essential to PDTF 2.0's trust model.
