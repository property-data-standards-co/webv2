---
title: Trust Architecture
description: How trust is established, verified, and evolved in PDTF 2.0.
---

PDTF 2.0 uses a federated trust model where the unit of trust is a **credential**, not the platform that served it.

A verifier answers three questions:

1. **Identity:** Who issued this credential? (DID resolution)
2. **Integrity:** Was it altered? (signature verification)
3. **Authority:** Is the issuer allowed to make this claim? (OpenID Federation (relying on Trust Anchors, Federation Entity Statements, and Property Trust Marks like `title-data-provider` and `regulated-conveyancer`) authorisation)

## Signatures are not enough

Anyone can create a DID and sign JSON. A valid signature proves *who* signed, not whether they are authoritative.

Authority is established via the **OpenID Federation**, which grants trust at **entity:path** scope.

## Trust roles

PDTF recognises three trust levels:

- `rootIssuer`: the primary authoritative source
- `trustedProxy`: an adapter that issues faithfully from a primary source
- `accountProvider`: a platform trusted to issue or manage user identities

## Three-phase evolution

PDTF expects trust to evolve:

1. Trusted proxies bootstrap the ecosystem.
2. More independently hosted adapters reduce centralisation.
3. Primary sources issue credentials directly when feasible.

The OpenID Federation is the mechanism that expresses this evolution over time.

## Visibility and conflicts

PDTF does not mandate a single conflict resolution policy across the ecosystem. It provides:

- clear issuer identity
- explicit authority scopes
- revocation checks

Consumers (lenders, conveyancers, agents) can choose how to surface or resolve conflicts.

## Where to go next

- Read the OpenID Federation spec for governance and caching rules.
- Read the VC data model and revocation specs for verification requirements.
