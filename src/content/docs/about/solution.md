---
title: How PDTF 2.0 solves it
description: Verifiable Credentials, cryptographic signatures, and a Trusted Issuer Registry — making property data independently verifiable.
---

## From photocopies to notarised originals

Today, property data works like a photocopy. When you receive a document, you're looking at a copy that's been passed through several hands. You can't tell if it's been altered. You can't confirm it came from the original source. You just have to trust the person who gave it to you.

PDTF 2.0 makes property data work like a notarised original. Every piece of data carries a digital signature from its source — the organisation that actually produced the data. Anyone can verify that signature instantly, without calling anyone or trusting any intermediary.

If the data has been tampered with, the signature won't match. If the source has revoked the data (because it's out of date, or was issued in error), the revocation is publicly checkable. The data proves itself.

## Three building blocks

### 1. Verifiable Credentials

A Verifiable Credential is a standard format for data that can be cryptographically verified. Think of it as a digital document that carries its own proof of authenticity.

When HM Land Registry issues a title register, it could be wrapped in a Verifiable Credential. That credential contains the title data, plus a digital signature from HMLR. Anyone receiving it can check that signature and confirm the data genuinely came from HMLR and hasn't been modified.

This isn't a new concept — it's a W3C international standard already in use for digital identity, education credentials, and healthcare records. PDTF 2.0 applies it to property data.

**Before:** You receive a PDF of a title register. You trust it because you trust the solicitor who sent it.

**After:** You receive a Verifiable Credential containing title data. You verify it yourself in milliseconds, cryptographically confirming it was issued by HMLR.

### 2. Cryptographic signatures

Every credential is signed using the same kind of cryptography that secures online banking and government communications. The signature is mathematically tied to the data and the issuer's identity. Change a single character of the data, and the signature becomes invalid.

This means:

- **Authenticity** — you can confirm who issued the data
- **Integrity** — you can confirm the data hasn't been modified
- **Non-repudiation** — the issuer can't deny having issued it

No phone calls. No emails. No "can you confirm you sent this?" Just maths.

### 3. Trusted Issuer Registry

Signatures prove *who* signed the data. But how do you know they're *authorised* to sign it?

The Trusted Issuer Registry (TIR) is a public registry that records which organisations are authorised to issue which types of property data. It's the directory that connects identity to authority.

For example, the TIR might record that:

- HM Land Registry is authorised to issue title register credentials
- An accredited search provider is authorised to issue local authority search credentials
- A regulated energy assessor is authorised to issue EPC credentials

When you verify a credential, you check two things: does the signature match the issuer, and is the issuer registered in the TIR for this type of data? If both checks pass, you have verified, trustworthy data.

## What changes for each participant

### For conveyancers

Stop chasing documents by email. Receive property data as verified credentials that your case management system can check automatically. Reduce professional indemnity risk because data provenance is provable. Spend time on legal analysis, not document logistics.

### For estate agents and portals

Property listings backed by verified data from day one. Property packs that travel with the listing, not the transaction — so when a buyer drops out, the data doesn't have to be re-compiled. Verified data badges that buyers and sellers can trust.

### For lenders

Automated verification of title data, search results, and property information. Reduced manual underwriting checks. Cryptographic proof that the data supporting a lending decision is genuine and current.

### For data sources

Issue your data once, in a standard format, and let the ecosystem verify it. No need to build bespoke integrations with every platform. Become a trusted issuer in the registry and your data flows automatically.

## What doesn't change

PDTF 2.0 doesn't replace existing organisations or roles. Conveyancers still do conveyancing. Search providers still provide searches. HM Land Registry still maintains the register.

What changes is the *format* and *trustworthiness* of the data that flows between them. Instead of unverifiable documents passed through intermediaries, property data becomes self-proving and independently verifiable.

The transition is gradual. Today's systems continue working. PDTF 2.0 adds a layer of verifiability on top — and over time, that layer becomes the default.

[Understand how trust works →](../about/trust-model/)
