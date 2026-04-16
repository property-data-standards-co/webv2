---
title: "Credential Exchange Protocols"
description: "How PDTF credentials are issued and verified using OID4VCI, OID4VP, and FAPI 2.0"
---

PDTF credentials use the **W3C Verifiable Credential** format, but format alone doesn't define how credentials move between systems. The **OpenID for Verifiable Credentials** family of protocols handles the exchange — how an adapter issues a credential to a wallet, and how a verifier requests and checks one.

## The three protocols

| Protocol | What it does | PDTF example |
|---|---|---|
| **OID4VCI** | Issuer → Holder (credential issuance) | EPC adapter issues an energy credential to a seller's wallet |
| **OID4VP** | Holder → Verifier (credential presentation) | Buyer's conveyancer requests and receives title credentials |
| **FAPI 2.0** | Security layer underneath both | OAuth 2.0 with DPoP, PAR, and strong client authentication |

## OID4VCI — How credentials are issued

[OpenID for Verifiable Credential Issuance](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html) defines how a credential issuer delivers signed credentials to a holder.

In PDTF, the "issuers" are typically **adapters** — services that fetch data from primary sources (HMLR, EPC register, Environment Agency) and package it as signed Verifiable Credentials.

### The issuance flow

```
1. Wallet/Platform discovers the adapter's credential endpoint
   (from the federation entity statement's openid_credential_issuer metadata)

2. Platform authenticates using FAPI 2.0
   (OAuth 2.0 with DPoP proof and Pushed Authorisation Request)

3. Platform requests a specific credential type
   POST /credentials
   {
     "credential_identifier": "TitleCredential",
     "proof": { "proof_type": "jwt", "jwt": "..." }
   }

4. Adapter fetches the data from the primary source

5. Adapter signs the credential and returns it
   { "credential": "eyJhbGci...", "format": "ldp_vc" }
```

### What makes this different from a plain API?

With a traditional API, you trust the platform serving the data. With OID4VCI:

- The credential is **signed by the adapter** — it's verifiable even if received second-hand
- The adapter's authority is **provable** via its federation trust mark
- The credential is **portable** — it can be stored in a wallet and presented to anyone, not just the original requester
- **Revocation** is built in via Bitstring Status List

### Credential offer

An adapter can also push a **credential offer** to a wallet — useful when data becomes available (e.g. a new EPC is registered) and the adapter wants to notify the holder:

```json
{
  "credential_issuer": "https://adapters.propdata.org.uk/epc",
  "credential_configuration_ids": ["PropertyCredential"],
  "grants": {
    "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
      "pre-authorized_code": "abc123"
    }
  }
}
```

## OID4VP — How credentials are presented

[OpenID for Verifiable Presentations](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) defines how a verifier requests credentials from a holder.

In PDTF, verifiers are typically **conveyancer platforms**, **mortgage lenders**, or **other transaction participants** who need to see property data with cryptographic proof of its source.

### The presentation flow

```
1. Verifier creates an authorisation request
   (specifies which credential types and paths are needed)

2. Request is sent to the holder's wallet
   (via redirect, QR code, or direct API call for custodial wallets)

3. Wallet checks which credentials match the request

4. Holder consents to sharing (or it's pre-authorised for custodial wallets)

5. Wallet creates a Verifiable Presentation wrapping the credentials

6. Presentation is returned to the verifier

7. Verifier validates:
   - VP signature
   - Each VC signature
   - Each issuer's federation trust mark
   - Revocation status
```

### Presentation definition

The verifier specifies what they need using a **presentation definition**:

```json
{
  "id": "title-check",
  "input_descriptors": [
    {
      "id": "title-register",
      "constraints": {
        "fields": [
          {
            "path": ["$.type"],
            "filter": { "contains": { "const": "TitleCredential" } }
          },
          {
            "path": ["$.credentialSubject.registerExtract"],
            "purpose": "Need the title register extract"
          }
        ]
      }
    }
  ]
}
```

This is how a buyer's conveyancer says *"I need to see the title register extract as a signed credential from a trusted issuer"* rather than just *"send me some JSON"*.

## FAPI 2.0 — The security layer

Both OID4VCI and OID4VP run on top of [FAPI 2.0 Security Profile](https://openid.net/specs/fapi-security-profile-2_0.html) — a hardened version of OAuth 2.0 designed for high-value data.

FAPI 2.0 adds:

- **DPoP (Demonstration of Proof of Possession)** — access tokens are bound to the client's key pair, preventing token theft
- **PAR (Pushed Authorisation Requests)** — authorisation parameters are sent server-to-server, not exposed in browser redirects
- **Strong client authentication** — clients authenticate with private key JWTs, not shared secrets
- **Sender-constrained tokens** — tokens can only be used by the party they were issued to

### Why FAPI 2.0 matters for property

Property data includes PII (names, addresses, financial information) and has legal significance (title ownership, contractual obligations). The standard OAuth 2.0 security model isn't sufficient:

- Token theft could expose someone's entire property transaction
- Replay attacks could forge credential requests
- Weak client authentication could allow unauthorised platforms to request credentials

FAPI 2.0 is already the standard for UK Open Banking and is being adopted by the UK Smart Data initiative. Using it for PDTF means the security model is proven and familiar to UK financial services implementers.

## Custodial Cloud Wallets

Not every property transaction participant will have a mobile wallet app. A seller completing their TA6 form doesn't want to install an app and manage cryptographic keys.

PDTF supports **custodial cloud wallets** — server-side wallets operated by platforms (like Moverly or LMS) on behalf of users:

- The platform holds the user's keys in a secure enclave
- Credentials are stored server-side, not on a device
- The user interacts through the platform's normal web interface
- Consent is managed through the platform's existing auth flow (not a separate wallet consent screen)

### How it works

```
1. Seller logs into Moverly and completes their TA6 form
2. Moverly's custodial wallet receives the signed TA6 credential
3. Buyer's conveyancer requests the TA6 via OID4VP
4. Moverly's wallet checks the seller's consent settings
5. If consented, the wallet creates a VP and returns it
6. The conveyancer verifies the VP — same trust chain as a mobile wallet
```

The credential is just as verifiable whether it came from a custodial cloud wallet or a mobile app. The trust mark on the issuer, the signature on the credential, and the revocation status are all identical.

### When mobile wallets make sense

As the ecosystem matures and tools like the **GOV.UK Wallet** become available, some participants may use personal wallets:

- **Conveyancers** — who handle many transactions and benefit from credential portability across platforms
- **Repeat buyers/sellers** — who want to carry verified data between transactions
- **Institutional participants** — mortgage lenders, local authorities, utilities

The protocol layer (OID4VCI/OID4VP) is the same regardless of wallet type. That's the point — the exchange protocol doesn't care whether the wallet is a phone app, a browser extension, or a cloud service.

## How these protocols fit together

```
┌─────────────────┐     OID4VCI      ┌──────────────┐
│  HMLR Adapter    │ ──────────────→  │  Seller's    │
│  (Issuer)        │   FAPI 2.0      │  Wallet      │
└─────────────────┘                   └──────┬───────┘
                                             │
                                        OID4VP│  FAPI 2.0
                                             │
                                      ┌──────▼───────┐
                                      │  Buyer's     │
                                      │  Conveyancer │
                                      │  (Verifier)  │
                                      └──────────────┘
```

1. The adapter **issues** a title credential to the seller's wallet via OID4VCI
2. The conveyancer **requests** the credential from the wallet via OID4VP
3. Both exchanges are secured with FAPI 2.0
4. The conveyancer **verifies** the credential and checks the adapter's federation trust mark

The credentials are portable — the conveyancer doesn't need an account with Moverly or a direct connection to HMLR. They verify the credential itself, check the trust chain, and make their own trust decision.
