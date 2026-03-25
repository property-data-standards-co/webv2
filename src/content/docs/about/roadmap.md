---
title: Roadmap
description: The three phases of PDTF 2.0 adoption — from trusted proxies to primary source issuers.
---

## Where we are and where we're going

PDTF 2.0 is designed for incremental adoption. The architecture supports a gradual transition from the current state of property data — unverifiable documents passed between intermediaries — to a fully decentralised model where data sources issue Verifiable Credentials directly.

This happens in three phases.

## Phase 1: Trusted proxies

**Status: Current phase**

In this phase, a small number of organisations act as trusted proxies. They connect to existing data sources (HM Land Registry, search providers, EPC registers) through their current APIs and interfaces, then re-issue the data as signed Verifiable Credentials.

The proxy model works because:

- It doesn't require existing data sources to change anything
- It provides immediate value to credential consumers (conveyancers, lenders)
- It establishes the credential format, verification infrastructure, and trust registry
- It proves the model works before asking root sources to adopt it

**What's in place:**
- The PDTF 2.0 specification suite (9 sub-specifications)
- Entity graph and Verifiable Credential data model
- Trusted Issuer Registry schema and initial entries
- Reference implementations for credential issuance and verification
- Credential revocation via Bitstring Status List

**What's being built:**
- npm packages for credential verification, DID resolution, and TIR checking
- CLI tools for developers
- Adapter reference implementations

## Phase 2: Independent adapters

In this phase, third-party organisations build and host their own adapters. Instead of a single proxy issuing credentials, multiple organisations independently connect to data sources and issue credentials under their own identity.

This decentralises the issuance layer. A conveyancer receiving a title register credential might get it from one of several authorised adapters, each independently registered in the TIR.

**What this requires:**
- Published adapter specifications and guides
- Accreditation process for new issuers
- Multiple TIR entries per credential type
- Monitoring and trust level management

**Why it matters:**
No single point of failure. No single organisation controlling the flow of verified property data. The trust model works because it's distributed, not because it's centralised.

## Phase 3: Primary source issuers

The end state. Data sources — HM Land Registry, local authorities, the EPC register, regulated professionals — issue Verifiable Credentials directly. No proxies needed.

When HMLR issues a title register as a Verifiable Credential signed with their own DID, the credential carries the highest possible trust level. No intermediary, no re-signing, no trust delegation. The source *is* the issuer.

**What this requires:**
- Government and institutional adoption of VC standards
- DID infrastructure at data source organisations
- Regulatory alignment (CLC, SRA, FCA recognising VC-based data)
- Maturity of the broader Verifiable Credentials ecosystem

**Why it matters:**
This is the model that scales. Once data sources issue credentials directly, the entire property data ecosystem becomes self-verifying. New platforms, new tools, new AI agents — they can all consume and verify property data without asking permission or building bespoke integrations.

## Timeline

| Phase | Focus | Horizon |
|-------|-------|---------|
| Phase 1 | Trusted proxies, core infrastructure | Now — 2026 |
| Phase 2 | Independent adapters, decentralised issuance | 2026 — 2027 |
| Phase 3 | Primary source issuers | 2027+ |

These are estimates based on current progress and industry engagement. The architecture is designed so that all three phases can coexist — Phase 1 credentials remain valid even as Phase 3 issuers come online.

## How to get involved

PDTF 2.0 is an open standard. The specifications, reference implementations, and tooling are all developed in the open.

- **Data sources** interested in becoming issuers: [contact us via GitHub](https://github.com/property-data-standards-co)
- **Developers** building adapters or integrations: [read the quickstart](/docs/quickstart/)
- **Industry stakeholders** wanting to understand the impact: [read the architecture overview](/architecture/overview/)

[Explore the architecture →](/architecture/overview/)
