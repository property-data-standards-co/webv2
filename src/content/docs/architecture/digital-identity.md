---
title: Digital Identity
description: How PDTF 2.0 integrates with GOV.UK Wallet and national digital identity infrastructure.
---

PDTF 2.0 is designed to interoperate with the UK's emerging national digital identity infrastructure — specifically **GOV.UK Wallet** and **GOV.UK One Login**. This page explains how verified digital identities flow through property transactions, eliminating redundant checks and establishing cryptographic proof of who people are and what they're authorised to do.

## The Opportunity

A typical property transaction today requires **five or more separate identity checks**:

1. The seller's conveyancer verifies their client's identity
2. The buyer's conveyancer does the same
3. The mortgage lender runs its own KYC/AML checks
4. The estate agent verifies both parties
5. HM Land Registry requires identity verification at registration

Each check is independent. None trusts the others. The buyer provides the same passport scan, the same utility bill, the same proof of address — over and over again.

A **single verified digital identity** that travels with the person across the transaction eliminates this redundancy. The identity is verified once, at government-grade assurance, and presented cryptographically to each party that needs it. No rescanning. No duplication. No inconsistency.

This isn't hypothetical. GOV.UK Wallet is being built on the same open standards that PDTF 2.0 uses.

## GOV.UK Wallet Alignment

GOV.UK Wallet and PDTF 2.0 share the same technical foundation:

| Standard | GOV.UK Wallet | PDTF 2.0 |
|---|---|---|
| **W3C Verifiable Credentials Data Model 2.0** | Credential format | Credential format |
| **OID4VCI** (OpenID for Verifiable Credential Issuance) | How credentials are issued to the wallet | How PDTF credentials are issued |
| **OID4VP** (OpenID for Verifiable Presentation) | How credentials are presented to verifiers | How PDTF credentials are presented for verification |
| **Bitstring Status List** | Credential revocation | Credential revocation |

This standards alignment is not a coincidence — it's a design choice. Because both systems use the same credential format, issuance protocol, presentation protocol, and revocation mechanism, **PDTF credentials and GOV.UK Wallet credentials are natively interoperable**. No translation layers. No format conversion. A credential issued into a GOV.UK Wallet can be presented directly to a PDTF-enabled platform, and vice versa.

For the Smart Data ecosystem, this demonstrates how a sector-specific scheme (property) can interoperate with national digital identity infrastructure without custom integration work — the standards do the heavy lifting.

## Person Identity Binding

When a consumer holds a verified identity in their GOV.UK Wallet, that identity can be **bound** to their PDTF Person entity through a simple flow:

```
┌─────────────┐    OID4VP     ┌──────────────────┐
│  GOV.UK     │──────────────▶│  Conveyancer's   │
│  Wallet     │  identity VC  │  Platform        │
└─────────────┘               └────────┬─────────┘
                                       │
                              Records DID or hash
                              in Person credential
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  PDTF Person     │
                              │  Credential      │
                              │                  │
                              │  identityBinding:│
                              │    did:key:z6Mk..│
                              └──────────────────┘
```

1. **Presentation:** The consumer presents their GOV.UK Wallet identity credential via OID4VP to their conveyancer's platform.
2. **Binding:** The platform records the wallet's DID (or a verifiable hash of the identity VC) in the Person credential's `identityBinding` claim.
3. **Linking:** From that point, all PDTF credentials associated with this person — `SellerCapacity`, `BuyerCapacity`, `DelegatedConsent` — are **cryptographically linked to a government-verified identity**.
4. **Reuse:** The identity proof is reusable across the entire transaction. When the lender needs to verify the buyer's identity, they request it via OID4VP. The wallet presents the same credential. No separate ID check required.

This means a buyer who verifies their identity once with GOV.UK One Login carries that verification through every stage of the transaction — from instruction through to Land Registry registration.

## Organisation & Employee Identity

Consumer identity is only half the picture. Property transactions involve **professionals** — conveyancers, mortgage advisers, estate agents — who also need verified identities linked to their firm and their regulatory status.

PDTF 2.0 supports a **credential chain** for professional identity:

```
GOV.UK Wallet (Person)
        │
        ▼
┌───────────────────┐
│ Personal Identity  │  Issued by: GOV.UK / DVS provider
│ VC                 │  Proves: who they are
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ Practising         │  Issued by: SRA / CLC / regulator
│ Certificate VC     │  Proves: licensed to practise
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ Employee           │  Issued by: their firm
│ Credential         │  Proves: works for this Organisation
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ PDTF              │  Checked against: entity graph
│ Representation     │  Proves: firm acts on this transaction
└───────────────────┘
```

When a professional connects to a PDTF-enabled system (via MCP or OID4VP), they present:

- Their **personal identity VC** (from GOV.UK Wallet or a DVS-certified provider)
- Their **EmployeeCredential** (issued by their firm, linking them to the Organisation entity)

The platform validates the full chain:

> **GOV.UK verified person** → **works for firm** → **firm holds Representation on transaction**

This chain establishes not just *who* the person is, but *what authority they have* within the transaction — without any platform-specific accounts or API keys.

## Wallet as Authentication

With the credential chain in place, the GOV.UK Wallet becomes the **authentication mechanism** itself:

- **Challenge-response** using the wallet's DID proves the person's identity. The platform sends a nonce; the wallet signs it with its private key. No passwords.
- Combined with **Representation** and **DelegatedConsent** credentials, this proves both **who they are** and **what they can access**.
- No API keys. No passwords. No OAuth client credentials. Just **cryptographic proof**.

A conveyancer opening a transaction file doesn't log in with a username and password. They present their wallet credentials, and the system verifies: this person is licensed, works for this firm, and this firm is instructed on this transaction. Access granted — with a full audit trail of verifiable credentials.

## Phase 1 vs Phase 2

GOV.UK Wallet is not yet widely deployed. PDTF 2.0 is designed to work **today** while being ready for **tomorrow**.

| | Phase 1 (Now) | Phase 2 (Wallet Era) |
|---|---|---|
| **Consumer identity** | Provider-managed `did:key` pairs; identity verified by the platform via traditional KYC | Consumer holds their own DID in GOV.UK Wallet; identity VC presented via OID4VP |
| **Professional identity** | Platform-issued `did:key`; regulatory status checked via API lookups | Regulator-issued practising certificate VC; firm-issued EmployeeCredential |
| **Authentication** | OAuth 2.0 / API keys with platform-managed DIDs | Wallet-based challenge-response with self-sovereign DIDs |
| **Identity binding** | Platform attests identity internally | `identityBinding` references wallet DID with government-grade assurance |

The architecture supports **both phases simultaneously**. A transaction can have some participants using Phase 1 (platform-managed) identity and others using Phase 2 (wallet-based) identity. The credential format is identical — only the DID method and assurance level differ.

This gradual migration path means the ecosystem doesn't need to wait for universal wallet adoption to start delivering value.

## Questions for OfDIA / DSIT

As PDTF 2.0 develops its digital identity integration, we'd welcome engagement with the Office for Digital Identities and Attributes (OfDIA) and DSIT on the following:

1. **Third-party issuer support:** Will GOV.UK Wallet support credentials issued by third parties (sector-specific schemes like PDTF, professional regulators like SRA/CLC), or only government-issued credentials? The interoperability value multiplies dramatically when the wallet holds both identity credentials *and* sector-specific credentials.

2. **DID methods:** Which DID method(s) will GOV.UK Wallet use for holder DIDs? This affects how PDTF 2.0 records identity bindings and resolves DIDs for verification. We currently plan for `did:key` (Phase 1) and `did:jwk` or `did:web` (Phase 2) — alignment here avoids unnecessary bridging.

3. **Asynchronous verification:** Property transactions involve offline processes (e.g., signing a transfer deed, exchanging contracts by phone). Can GOV.UK Wallet identity VCs be verified asynchronously — that is, can a verifier check a previously-presented credential's status without requiring the holder to be online? Bitstring Status List supports this, but we'd like to confirm the intended verification model.

4. **Sector-specific credential profiles:** Is there a mechanism for sector-specific schemes to register credential types with the GOV.UK Wallet ecosystem? PDTF defines credentials like `SellerCapacityCredential` and `RepresentationCredential` that have no general-purpose equivalent. Understanding the extensibility model helps us design for long-term wallet integration.

---

PDTF 2.0's alignment with GOV.UK Wallet is a concrete example of how **Smart Data interoperability** works in practice. The same person, verified once, trusted everywhere — across a property transaction and beyond.
