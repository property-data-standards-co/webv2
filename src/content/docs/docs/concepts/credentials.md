---
title: "Credentials"
description: "W3C Verifiable Credentials in the PDTF context"
---

PDTF 2.0 uses **W3C Verifiable Credentials v2** as the core format for property data. Instead of trusting whichever platform happens to be serving the data, consumers verify a signed credential issued by a recognised source or trusted adapter.

## What a credential does

A credential packages together:

- the **issuer** (`did:key` or `did:web`)
- the **subject** of the claim (`urn:pdtf:uprn:*`, `urn:pdtf:titleNumber:*`, or a PDTF DID)
- the **data being asserted**
- **evidence** showing where the data came from
- **terms of use** controlling who may access it
- **status** information for revocation
- a cryptographic **proof**

This makes every claim independently portable and verifiable.

## Credential types in PDTF 2.0

PDTF keeps the set of credential types small and aligned to the entity graph:

- `PropertyCredential`
- `TitleCredential`
- `OwnershipCredential`
- `RepresentationCredential`
- `DelegatedConsentCredential`
- `OfferCredential`
- `TransactionCredential`

A key design choice is that domain-specific datasets like EPCs or flood data are not separate credential types. They are `PropertyCredential`s asserting specific paths on the Property entity.

## Sparse subjects, not giant payloads

A PDTF credential usually carries a **sparse object**, not a full entity.

For example, an EPC credential only needs to assert the energy section:

```json
{
  "type": ["VerifiableCredential", "PropertyCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "credentialSubject": {
    "id": "urn:pdtf:uprn:100023456789",
    "energyEfficiency": {
      "certificate": {
        "currentEnergyRating": "C",
        "currentEnergyEfficiency": 72
      }
    }
  }
}
```

Later, state assembly merges multiple credentials for the same entity. PDTF 2.0 is moving toward **MERGE + schema-driven pruning**, so dependent stale subtrees can be removed when a discriminator changes.

## Evidence and access control

Each credential can include an `evidence` array describing where the claim came from. PDTF uses a simplified evidence model with four common types:

- `ElectronicRecord`
- `DocumentExtraction`
- `UserAttestation`
- `ProfessionalVerification`

Access is controlled with `termsOfUse`, typically through a `PdtfAccessPolicy` that records:

- confidentiality level
- whether the data contains PII
- role restrictions

That means the same transaction can yield different views depending on whether the requester is a seller, buyer, conveyancer, or unauthenticated user.

## Status and proof

Every PDTF credential includes:

- `credentialStatus` using **Bitstring Status List**
- `proof` using **Data Integrity** with **`eddsa-jcs-2022`**

That gives two essential checks:

1. **Was it really signed by the issuer?**
2. **Is it still current and not revoked?**

## Credential exchange protocols

The credential format (W3C VC) defines what a credential looks like. But how do credentials actually move between systems?

PDTF uses the **OpenID for Verifiable Credentials** protocol family:

- **OID4VCI** (Verifiable Credential Issuance) — how an adapter issues a signed credential to a wallet or platform. For example, the EPC adapter uses OID4VCI to deliver an energy credential to a seller's custodial wallet.
- **OID4VP** (Verifiable Presentations) — how a verifier requests and receives credentials. A buyer's conveyancer uses OID4VP to request title credentials, receiving them as a signed Verifiable Presentation.

Both protocols run on top of **FAPI 2.0** — a hardened OAuth 2.0 profile with DPoP token binding, pushed authorisation requests, and strong client authentication. This is the same security model used by UK Open Banking.

For participants who don't have a mobile wallet app, PDTF supports **custodial cloud wallets** — server-side wallets operated by platforms on behalf of users. The exchange protocols are identical; only the wallet location differs.

→ [Read more about credential exchange protocols](/web/docs/concepts/oid4vc/)

## Why this matters

PDTF 2.0 credentials turn property data into something that can move safely between platforms, APIs, and agents without losing provenance. A verifier no longer needs to trust Moverly, LMS, or any other intermediary just because they served the JSON. It verifies the credential itself, checks the issuer's [federation trust mark](/web/docs/concepts/openid-federation/), and decides on that basis.

That is the core trust shift in PDTF 2.0: **make trust portable, by verifying the credential itself**.
