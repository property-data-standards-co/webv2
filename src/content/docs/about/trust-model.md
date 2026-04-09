---
title: How trust works
description: The chain of trust in PDTF 2.0 — issuers, credentials, verification, and revocation explained without jargon.
---

## Trust without trusting

In the current property market, trust is personal. You trust a document because you trust the person who sent it. You trust data because you trust the platform that displays it. If someone in the chain is wrong — or dishonest — the mistake flows downstream undetected.

PDTF 2.0 replaces personal trust with *verifiable trust*. You don't need to trust anyone in the chain. You verify the data yourself.

This page explains how that works, step by step.

## The four parts of trust

### 1. The issuer signs the data

When an organisation produces property data — a title register, an EPC certificate, a local authority search — they wrap it in a Verifiable Credential and sign it with their private key. This is their digital equivalent of a wax seal on a letter: it proves the data came from them and hasn't been altered.

The signing happens automatically, as part of the organisation's systems. They don't need to do anything different — their software handles the cryptography.

### 2. The registry confirms authority

A valid signature tells you *who* issued the data. But how do you know they're *authorised* to issue it?

That's the job of the Trusted Issuer Registry (TIR). It's a public list that records which organisations are authorised to issue which types of property data.

Think of it like the SRA roll for solicitors or the FCA register for financial firms. You can check whether someone is on it, and what they're authorised to do.

The TIR answers a specific question: "Is this organisation allowed to issue this type of credential?" If the answer is yes, the credential is considered trustworthy. If not, it should be treated with caution.

### 3. The verifier checks everything

When someone receives a property data credential — a conveyancer checking title data, a lender verifying an EPC — they run three checks:

1. **Signature check** — Does the digital signature match the data? Has anything been altered?
2. **Registry check** — Is the issuer registered in the TIR for this type of data?
3. **Revocation check** — Has the credential been revoked since it was issued?

All three checks happen automatically, in milliseconds. No phone calls, no emails, no manual review. The verifier's software does the work.

If all three pass: the data is verified. Proceed with confidence.

If any check fails: the data should not be relied upon. The system flags exactly which check failed and why.

### 4. Revocation keeps data current

Property data changes. Properties are sold. EPCs expire. Search results become outdated. When data is no longer valid, the original issuer revokes the credential.

Revocation is public and checkable. The issuer updates a revocation list — a publicly accessible record of which credentials have been revoked. Anyone verifying a credential checks this list automatically.

This solves the stale data problem. You don't need to wonder whether a document is still current. You check the revocation status, and you know.

## The trust chain in practice

Here's how it works for a real example — a local authority search:

1. **Issuance.** The search provider conducts the search and issues a Verifiable Credential containing the results. The credential is signed with the search provider's private key.

2. **Registration.** The search provider is listed in the TIR as an authorised issuer of local authority search credentials. Their registration includes their digital identity and the specific types of data they can issue.

3. **Delivery.** The credential is delivered to the buyer's conveyancer — via whatever channel (email, API, portal). It doesn't matter how it arrives, because the credential proves itself.

4. **Verification.** The conveyancer's case management system automatically verifies the credential:
   - Signature: valid ✓
   - Registry: the issuer is authorised for this credential type ✓
   - Revocation: the credential has not been revoked ✓

5. **Reliance.** The conveyancer can rely on the search results with cryptographic confidence, not just professional trust.

6. **Later: revocation.** Six months later, the search results are out of date. The search provider revokes the credential. Anyone who tries to verify it going forward sees that it has been revoked and should not be relied upon.

## Trust levels

Not all issuers are equal. PDTF 2.0 recognises three trust levels:

| Level | Description | Example |
|-------|-------------|---------|
| **Root issuer** | The original source of the data | HM Land Registry, the EPC Register |
| **Accredited issuer** | An organisation independently authorised to issue data | A CLC-regulated conveyancer issuing property information |
| **Trusted proxy** | An intermediary that issues on behalf of a root source | An adapter that re-signs data sourced from a root issuer |

During the early adoption phase, most credentials will come from trusted proxies — organisations that source data from existing systems and wrap it in Verifiable Credentials. Over time, the goal is for root issuers (like HMLR) to issue credentials directly, removing the need for proxies.

The TIR records the trust level of each issuer, so verifiers always know the provenance chain.

## What makes this different from today

| | Today | PDTF 2.0 |
|---|---|---|
| **Trust basis** | Trust the intermediary | Verify the proof |
| **Verification** | Manual (phone, email, reputation) | Automatic (cryptographic) |
| **Staleness detection** | None (hope for the best) | Revocation checking |
| **Issuer authority** | Assumed from context | Checked against the registry |
| **Audit trail** | Scattered across email threads | Built into every credential |
| **Data portability** | Locked in transaction-specific packs | Travels with the property |

The fundamental shift is from *trusting people* to *verifying proofs*. The people are still there — conveyancers, search providers, registries — but their data now carries its own evidence.

[See the roadmap →](/web/about/roadmap/)
