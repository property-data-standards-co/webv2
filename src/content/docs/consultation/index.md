---
title: Industry Consultation
description: Open architectural questions for the PDTF 2.0 specification.
sidebar:
  order: 1
---

PDTF 2.0 represents a significant architectural shift from the first iteration of the framework. As we transition from a monolithic data structure relying on central platforms to a distributed, cryptographic graph of Verifiable Credentials, we are consulting the industry on several key design decisions.

This consultation is structured to present the problem, the viable options, our current recommendation, and the specific question we are seeking feedback on.

---

## Section 1: The Data Foundation

### Q1. Core Data Structure

**The Problem:** 
Currently, property data is exchanged via proprietary API integrations. Each integration requires custom mapping, bilateral agreements, and brittle point-to-point connections. PDTF v1 solved the mapping problem with a common schema, but the data remained bound to the platform that served it.

**The Options:**
- **Option A (Status Quo):** Continue building bilateral API integrations.
- **Option B (OIDC Claims):** Use standard OAuth/OIDC to verify claims against a central property identity provider.
- **Option C (Verifiable Credentials):** Issue data as W3C Verifiable Credentials (VCs). Data becomes cryptographically verifiable, independent of the platform that issued it, and highly portable.

**Our Recommendation (Option C):** 
Verifiable Credentials are the globally adopted standard for digital trust. Aligning with VCs prepares the UK property market for interoperability with GOV.UK One Login, the EU Digital Identity Architecture, and Smart Data initiatives.

**Consultation Question:**
> *Do you agree that W3C Verifiable Credentials are the correct foundational data structure for the next generation of property data exchange?*

---

### Q2. Decomposing the Property Pack

**The Problem:** 
PDTF v1 represents a property transaction as a single JSON document (around 4,000 data paths). If an EPC rating updates, the entire transaction document is conceptually altered. Furthermore, data collected during a failed transaction is locked inside that transaction's context, rather than surviving alongside the property for the next buyer.

**The Options:**
- **Option A (Monolithic):** Retain a single massive transaction document.
- **Option B (Entity Graph):** Decompose the schema into nine distinct, independently credentialed entities: `Property` (physical facts), `Title` (legal facts), `Transaction` (this-sale facts), `Person`, `Organisation`, and relationship credentials (`SellerCapacity`, `Representation`, `DelegatedConsent`, `Offer`).

**Our Recommendation (Option B):** 
The entity graph follows the "Logbook Test" — facts that belong to the property (EPCs, flood risks) stay with the property entity and survive the transaction. Facts that belong to the title stay with the title. This enables genuine data reuse across aborted transactions.

**Consultation Question:**
> *Does the proposed Entity Graph cleanly separate physical property facts, legal title facts, and transient transaction state? Are there any missing entities?*

---

## Section 2: Identity & Wallets

### Q3. Pragmatic Identity for Firms

**The Problem:** 
To issue or present Verifiable Credentials, an entity needs a Decentralised Identifier (DID). Expecting every conveyancing firm and high-street estate agent to manage their own cryptographic keys and host a DID document (`did:web`) is an unrealistic barrier to adoption in the near term.

**The Options:**
- **Option A:** Require all participating firms to self-host `did:web` infrastructure.
- **Option B:** Mandate a central registry that generates and holds keys for everyone.
- **Option C (Provider-Managed Identity):** Allow firms to use ephemeral or provider-managed `did:key` identifiers, issued by their technology provider (e.g., their CRM or a platform like LMS). Only tech-forward firms and major platforms are expected to self-host `did:web`.

**Our Recommendation (Option C):** 
We must support account-provider-managed `did:key` identity for the vast majority of firms. It drastically lowers the barrier to entry while maintaining cryptographic integrity.

**Consultation Question:**
> *Do you agree with the assumption that the majority of participating organisations will rely on their technology providers for DID management, rather than self-hosting?*

---

### Q4. The Consumer Wallet Gap

**The Problem:** 
Consumers (buyers and sellers) do not currently possess digital wallets capable of receiving, holding, and presenting Verifiable Credentials.

**The Options:**
- **Option A:** Build a proprietary, property-specific wallet app that consumers must download.
- **Option B:** Force integration with early-stage, generic commercial wallets (fragmented market, high UX friction).
- **Option C (Delayed Consumer Wallets):** In Phase 1, consumer identity is managed ephemerally by their conveyancer or agent using `did:key`. We delay direct consumer wallet integration until GOV.UK One Login or EU DI wallets reach critical mass.

**Our Recommendation (Option C):** 
Property is too high-friction an environment to act as the wedge for consumer wallet adoption. We should abstract the cryptography away from the consumer entirely in Phase 1.

**Consultation Question:**
> *Is delaying direct consumer wallet integration in favour of provider-managed identity the most viable strategy for Phase 1 adoption?*

---

## Section 3: Trust & Governance

### Q5. OpenID Federation

**The Problem:** 
If anyone can issue a Verifiable Credential, how does a relying party (like a lender) know if the issuer is actually authorised to provide that data? (e.g., How do we know this DID belongs to a legitimate EPC assessor?)

**The Options:**
- **Option A:** Every platform maintains its own proprietary whitelist of trusted issuers.
- **Option B:** A bespoke, git-hosted Trusted Issuer Registry (the PDTF v0.8 approach).
- **Option C (OpenID Federation):** Adopt the OpenID Federation standard, using Trust Anchors, Entity Statements, and Trust Marks to cryptographically prove an issuer's authority.

**Our Recommendation (Option C):** 
OpenID Federation is an established standard designed exactly for this problem. It allows dynamic trust resolution without relying on a bespoke registry format.

**Consultation Question:**
> *Does OpenID Federation provide the correct framework for governing trust and issuer authorisation in the UK property market?*

---

### Q6. Trust Anchor Governance

**The Problem:** 
OpenID Federation relies on a root "Trust Anchor" — a cryptographic key that issues the ultimate Trust Marks to participating organisations. Someone has to hold this key and govern the policy for issuing Trust Marks.

**The Options:**
- **Option A:** A government regulator (authoritative, but likely years away from implementation).
- **Option B:** A new joint-venture consortium of major industry players (neutral, but slow to establish).
- **Option C (Interim Project Governance):** This project operates an interim, proof-of-concept Trust Anchor (`trust.pdtf.org`) to bootstrap the ecosystem, with a roadmap to transition to a formal industry consortium or regulator once proven.

**Our Recommendation (Option C):** 
To maintain momentum and prove the architecture works in practice, an interim Trust Anchor is required. Governance can be formalised as the network scales.

**Consultation Question:**
> *Is an interim, project-led Trust Anchor acceptable for bootstrapping the ecosystem, provided there is a clear transition path to formal industry or regulatory governance?*

---

### Q7. Trust Mark Granularity

**The Problem:** 
Trust is rarely binary. A provider authorised to issue an EPC credential is not necessarily authorised to issue a Title credential.

**The Options:**
- **Option A:** Blanket trust. If an issuer is in the federation, they can issue any property credential.
- **Option B (Path Delegation):** Trust Marks include a `delegation` claim that explicitly authorises the issuer for specific data paths (e.g., `Property:/energyPerformanceCertificate`). Validators reject credentials issued outside this scope.

**Our Recommendation (Option B):** 
Granular, path-based delegation is essential for a diverse ecosystem containing specialist data providers.

**Consultation Question:**
> *Do you agree that Trust Marks must explicitly declare the data paths an issuer is authorised to populate?*

---

### Q8. The Federated Smart Data Model

**The Problem:**
The Department for Business and Trade (DBT) has outlined a vision for a "Federated Smart Data Governance Model" across the UK economy, involving a central Smart Data Coordination Entity (SDCE) and Sector-Specific Implementation Entities. How should the property sector align with this impending regulation?

**The Options:**
- **Option A:** Ignore cross-sector alignment and build a property-only governance model.
- **Option B (Federated Alignment):** Design PDTF 2.0 specifically to act as the prototype "Sector-Specific Implementation Entity" for property. Our Trust Anchor (`trust.pdtf.org`) is built on standard OpenID Federation so it can seamlessly subordinate to a future government-run SDCE.

**Our Recommendation (Option B):**
Aligning with the DBT's Smart Data framework ensures PDTF 2.0 is future-proofed against incoming legislation and interoperable with other sectors (like finance and energy). HM Land Registry is identified as the likely lead regulator for property in this model.

**Consultation Question:**
> *Does the proposed governance framework (aligning PDTF 2.0 as a Sector-Specific Implementation Entity under the DBT's Smart Data model) provide a robust foundation for industry adoption? What elements of governance or accreditation are missing from this model?*

---

### Q9. GOV.UK Wallet Identity Binding

**The Problem:**
PDTF 2.0 introduces a `Person` entity represented as a Verifiable Credential. In Phase 2, consumers will hold verified digital identities in their GOV.UK Wallet. How should a person's government-verified identity be linked to their PDTF Person entity?

**The Options:**
- **Option A:** Platform-managed identity only. Each platform verifies identity independently and issues its own Person credentials with no cross-platform binding.
- **Option B (Wallet Identity Binding):** When a consumer presents their GOV.UK Wallet identity via OID4VP, the platform records the wallet's DID or a verifiable hash of the identity VC in the Person credential's `identityBinding` claim. All subsequent PDTF credentials (SellerCapacity, DelegatedConsent) are cryptographically linked to this government-verified identity.

**Our Recommendation (Option B):**
Wallet identity binding creates a single, reusable identity anchor across the transaction. The buyer or seller verifies their identity once and carries that verification to every party — conveyancer, lender, estate agent, Land Registry — without repeating KYC checks.

**Consultation Question:**
> *Should PDTF 2.0 support GOV.UK Wallet identity binding as the primary mechanism for linking real-world identities to PDTF Person entities?*

---

### Q10. Cross-Party Identity Reuse

**The Problem:**
Today, a buyer undergoes separate AML/KYC checks with their conveyancer, their mortgage lender, and sometimes their estate agent. Each check costs money, takes time, and produces inconsistent results. If a consumer holds a government-verified identity in their GOV.UK Wallet, should a single verified presentation be accepted by all parties?

**The Options:**
- **Option A:** Each party continues to run independent AML/KYC checks regardless of wallet identity.
- **Option B (Cross-Party Acceptance):** A verified GOV.UK Wallet identity presentation (at the appropriate assurance level) is accepted as sufficient AML/KYC evidence by all parties in the transaction. Each party can independently verify the credential's validity and revocation status without trusting the platform that first received it.

**Our Recommendation (Option B):**
Cross-party acceptance of a government-verified identity eliminates redundant checks, reduces transaction costs, and speeds up the process — while maintaining each party's ability to independently verify the credential.

**Consultation Question:**
> *Should a verified GOV.UK Wallet identity presentation be accepted as sufficient AML/KYC evidence across all parties in a transaction?*

---

## Section 4: Schema Decomposition & Relationships

### Q11. Single Property, Multiple Titles

**The Problem:**
A single property can be held under multiple legal titles — a freehold house with a separate leasehold garage, or a property with both a freehold and a long lease. How should the schema model this?

**The Options:**
- **Option A (Multi-Property):** Allow a transaction to reference multiple `Property` entities, each with their own titles.
- **Option B (Single Property, Multi-Title):** Constrain a transaction to exactly one `Property` entity, but allow multiple `Title` entities. This reflects the reality that forms like TA6 and BASPI assume a single physical property.

**Our Recommendation (Option B):**
Single property, multiple titles. This keeps form mapping straightforward and aligns with how conveyancing actually works. Multi-property transactions (e.g., land assembly) are a future extension, not a Phase 1 requirement.

**Consultation Question:**
> *Is the constraint of one Property per Transaction (with multiple Titles) appropriate for Phase 1, or are there common transaction types that require multiple Properties?*

---

### Q12. The Title Entity as Legal Interest

**The Problem:**
The v3 schema stored ownership details (freehold/leasehold, shared ownership terms, lease length) inside a nested `ownership` wrapper. With the entity graph, we need to decide what the `Title` entity fundamentally represents.

**The Options:**
- **Option A:** Title is a thin reference to HMLR data. Tenure details live elsewhere.
- **Option B (Title IS the Legal Interest):** The Title entity represents the legal interest being conveyed. `legalInterestType` (Freehold, Leasehold, Commonhold), `freeholdDetails`, and `leaseholdDetails` sit at the top level of the Title entity alongside `registerExtract`.

**Our Recommendation (Option B):**
The Title entity is fundamentally the legal interest. The register extract is *evidence* of that interest, the title number is the *identifier* for it, and the tenure details *describe* it. They all belong together.

**Consultation Question:**
> *Does the framing of Title as the legal interest (with legalInterestType as a top-level discriminator) correctly model how conveyancers think about titles?*

---

### Q13. Relationship Credentials and the Two Intents

**The Problem:**
In v3, all parties are stored in a flat `participants[]` array with a `role` string. This loses the semantic richness of the relationships: a seller's conveyancer represents the seller's *intent to sell*, while a buyer's conveyancer supports the buyer's *intent to buy*. These are fundamentally different trust relationships.

**The Options:**
- **Option A (Flat Participation):** Retain a single `Participation` entity with role strings.
- **Option B (Intent-Based Relationship Credentials):** Decompose participation into typed relationship credentials that orbit the relevant intent:
  - `Representation` credentials for the Estate Agent and Seller's Conveyancer orbit the **Transaction** (intent to sell).
  - `Representation` credentials for the Buyer's Conveyancer and Mortgage Broker orbit the **Offer** (intent to buy).
  - `SellerCapacity` credentials assert a person's right to sell a specific title.
  - `DelegatedConsent` credentials grant third parties (like lenders) traversal access to the graph.

**Our Recommendation (Option B):**
Typed relationship credentials provide precise, revocable, auditable authority chains. They also enable the graph itself to function as the access control model — no central ACL required.

**Consultation Question:**
> *Does the decomposition of flat participation into typed relationship credentials (Representation, SellerCapacity, DelegatedConsent, Offer) accurately model the authority chains in a property transaction? Are there relationship types we have missed?*

---

### Q14. Transaction Sale Context

**The Problem:**
The v3 schema stored sale-specific financial details (outstanding mortgage, Help to Buy equity loan, number of sellers, limited company sale) inside the `ownership` object alongside legal interest details. These are distinct concerns.

**The Options:**
- **Option A:** Keep financial sale details on the Property or Title entity.
- **Option B (Transaction.saleContext):** Move sale-specific financial details to a `saleContext` object on the `Transaction` entity, since they describe *this particular sale*, not the property or the title.

**Our Recommendation (Option B):**
These fields fail the "Logbook Test" — they are irrelevant to the next buyer. They belong on the Transaction.

**Consultation Question:**
> *Is `Transaction.saleContext` the correct location for sale-specific financial details (outstanding mortgage, Help to Buy, etc.)?*

---

### Q15. Evolving Identifiers (Unregistered Titles and Missing UPRNs)

**The Problem:**
Some properties lack a UPRN (new builds). Some titles are unregistered. Over the course of a transaction, these identifiers may be allocated. How does the graph handle an entity whose permanent identifier didn't exist when the entity was first created?

**The Options:**
- **Option A:** Reissue all credentials with the new identifier and revoke the old ones.
- **Option B (alsoKnownAs):** Use the W3C `alsoKnownAs` property on the Verifiable Credential. The new VC uses the permanent identifier as its `credentialSubject.id`, but lists the old synthetic identifier in `alsoKnownAs`. Graph traversal resolves both to the same entity.

**Our Recommendation (Option B):**
`alsoKnownAs` is a standard mechanism designed for exactly this purpose. It avoids mass credential revocation and reissuance.

**Consultation Question:**
> *Is `alsoKnownAs` a sufficient mechanism for handling identifier evolution, or are there edge cases (e.g., title splits, mergers) that require a different approach?*

---

### Q16. Search and Document Identifiers

**The Problem:**
Local authority searches, environmental reports, and other third-party documents need stable identifiers within the graph. Some providers issue their own reference numbers; others (especially PDF-based results) have no native identifier at all.

**The Options:**
- **Option A:** Mandate a central ID registry for all search products.
- **Option B (Provider-Minted IDs):** Allow providers to mint their own globally unique identifiers (URNs or UUIDs). For documents extracted from PDFs without a native ID, the platform synthesises a deterministic identifier (e.g., a hash of search type + provider + date).

**Our Recommendation (Option B):**
This avoids a central bottleneck while ensuring every credential has a stable, unique subject identifier.

**Consultation Question:**
> *Is provider-minted identification (with synthetic IDs for unstructured documents) sufficient, or do we need a central search product registry?*

---

## Section 5: Access & Exchange

### Q17. Intent-Based Access Control

**The Problem:** 
Property data is highly sensitive. How do we ensure that only authorised parties (e.g., a mortgage lender) can access the data, without relying on a central, proprietary Access Control List (ACL)?

**The Options:**
- **Option A:** Central API gateways enforce access rules based on user accounts.
- **Option B (Intent-based Graph Traversal):** The graph itself dictates access. A `Transaction` represents the intent to sell; an `Offer` represents the intent to buy. If a buyer grants a lender a `DelegatedConsent` credential referencing their accepted `Offer`, the lender is cryptographically authorised to traverse the graph and read the property data.

**Our Recommendation (Option B):** 
Using relationship credentials (`Representation`, `DelegatedConsent`) as capability tokens removes the need for central API gatekeepers.

**Consultation Question:**
> *Does the framing of Transaction (Intent to Sell) and Offer (Intent to Buy) provide a robust enough foundation for distributed access control?*

---

### Q18. Standardised Exchange Protocols

**The Problem:** 
Once a credential exists, how is it requested and delivered between different platforms?

**The Options:**
- **Option A:** Define a custom REST API specification for the property industry.
- **Option B:** Adopt OID4VCI (OpenID for Verifiable Credential Issuance) and OID4VP (OpenID for Verifiable Presentations).

**Our Recommendation (Option B):** 
Adopting existing OIDF standards ensures compatibility with generic enterprise identity infrastructure and reduces the maintenance burden on the property industry.

**Consultation Question:**
> *Should OID4VCI and OID4VP be mandated as the standard protocols for exchanging property credentials?*