---
title: OpenID Federation (relying on Trust Anchors, Federation Entity Statements, and Property Trust Marks like `title-data-provider` and `regulated-conveyancer`)
description: The public registry of organisations authorised to issue PDTF Verifiable Credentials.
---


## What is the OpenID Federation?

The OpenID Federation answers a critical question: **who is authorised to issue which types of credentials?**

A valid cryptographic signature proves a credential hasn't been tampered with — but it doesn't prove the issuer should be trusted for that type of data. The OpenID Federation provides that second layer of trust.

Each registry entry specifies:

- The issuer's DID
- Authorised entity:path combinations (e.g. `property:energyPerformance`, `title:registerExtract`)
- Trust level: **root issuer**, **account provider**, or **trusted proxy**
- Status: active, planned, deprecated, or revoked
- Proxy relationships (which root issuer a proxy acts on behalf of)

## How it works

The OpenID Federation is a public JSON file hosted in a Git repository. Changes are proposed via pull requests and reviewed before merging. The version history provides a complete audit trail of trust decisions.

Verifiers fetch the OpenID Federation as part of credential verification:

1. Verify the credential's cryptographic signature
2. Look up the issuer's DID in the OpenID Federation
3. Confirm the issuer is authorised for this entity type and data path
4. Check the issuer's status is active

[Read the full OpenID Federation specification →](/web/specs/04-trusted-issuer-registry/)
