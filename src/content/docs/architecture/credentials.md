---
title: Credentials
description: How PDTF 2.0 uses W3C Verifiable Credentials to wrap entity data with cryptographic proof.
---

PDTF 2.0 represents property data as **W3C Verifiable Credentials (VCs)**. Each credential is a signed, portable statement about an entity in the PDTF graph (Property, Title, Transaction, or a relationship entity).

## Why credentials

A credential carries its own cryptographic proof. A recipient can verify integrity and issuer identity without trusting the API or database that delivered the JSON.

In PDTF, signatures are necessary but not sufficient. Verifiers also consult the **OpenID Federation (relying on Trust Anchors, Federation Entity Statements, and Property Trust Marks like `title-data-provider` and `regulated-conveyancer`)** to confirm the issuer is authorised for the specific **entity:path** combinations being asserted.

## Sparse credentials

PDTF credentials are usually **sparse**. An EPC issuer does not re-issue a whole Property object. It issues a `PropertyCredential` containing only the `energyEfficiency` subtree.

State assembly combines many sparse credentials into a composed view, applying pruning when discriminators change so stale subtrees are removed.

## Credential types

Credential types align with the entity graph:

- `PropertyCredential` and `TitleCredential` for facts about those entities.
- Relationship credentials (`OwnershipCredential`, `RepresentationCredential`, `DelegatedConsentCredential`, `OfferCredential`) to express authority, access, and process.
- `TransactionCredential` for sale-specific lifecycle state.

## Access control

VCs can include `termsOfUse` to express confidentiality and role restrictions. Separately, `DelegatedConsentCredential` grants a third party, such as a lender, access to a defined scope.

## Revocation

Every PDTF credential includes `credentialStatus` so verifiers can check whether it is still valid. PDTF uses **Bitstring Status Lists** for scalable revocation.

## Where to go next

- See the protocol specs for the VC data model and revocation.
- Use `@pdtf/core` to issue and verify credentials in development.
