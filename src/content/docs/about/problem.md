---
title: The problem with property data
description: Why property data in UK conveyancing is slow, fragile, and built on misplaced trust.
---

## Property data is broken

Buying or selling a property in England and Wales takes an average of 20 weeks. A significant chunk of that time is spent chasing, checking, and re-checking data — not because the data doesn't exist, but because nobody can independently verify it.

The conveyancing process runs on trust in intermediaries. You trust that the estate agent forwarded the correct title plan. You trust that the seller's solicitor sent an authentic copy of the local authority search. You trust that the EPC certificate hasn't expired since it was last checked. You trust that the property information form was actually completed by the person who claims to own the property.

And when that trust breaks down — as it regularly does — transactions fall through, costs mount, and people's lives are put on hold.

## What goes wrong

### Stale data

A local authority search is valid at the point it's issued. By the time it's been emailed from the search provider to the seller's solicitor, forwarded to the buyer's solicitor, and uploaded to the lender's portal, weeks have passed. Nobody re-checks. Nobody can tell whether the data is still current without ordering a fresh search.

The same applies to title registers, EPC certificates, environmental reports, and almost every other document in the pack. Data goes stale silently.

### Unverifiable documents

When a conveyancer receives a PDF of a title register, they're trusting that it's genuine. There's no cryptographic signature. No way to verify it came from HM Land Registry rather than being edited in a PDF tool. The document looks real, and that's considered enough.

This isn't a theoretical risk. Title fraud — where fraudsters forge documents to sell properties they don't own — costs the UK property market millions each year. The Land Registry's own indemnity fund pays out over £80 million annually.

### Trust in the wrong layer

Today, trust sits with the platform or the intermediary. You trust Rightmove's listing data because you trust Rightmove. You trust the property pack because you trust the solicitor who compiled it. You trust the search results because you trust the search provider's reputation.

But platforms aggregate data from many sources. Solicitors compile packs from documents they received from other parties. Search providers pull from local authority databases that may themselves be out of date. The trust chain is long, opaque, and fragile.

When something goes wrong, there's no audit trail. No way to determine where in the chain data was altered, delayed, or fabricated. The response is typically more process — more checks, more forms, more delays.

### Email chains of unverifiable documents

A typical conveyancing transaction involves dozens of documents passing between multiple parties via email. Each forwarded attachment is a copy of a copy. By the time a document reaches the end of the chain, there's no way to verify it matches what was originally issued.

Conveyancers spend significant time on the phone confirming receipt, checking versions, and requesting re-sends. This isn't skilled legal work — it's logistics made necessary by the absence of verifiable data.

### The "property pack" problem

The current model treats property data as a monolithic pack — a bundle of documents compiled for a specific transaction. When a transaction falls through, the pack often can't be reused because it was assembled for a particular buyer and seller combination. Data that is fundamentally about the *property* gets locked into documents that are about the *transaction*.

This means the next buyer starts from scratch, ordering fresh searches and compiling a new pack from the same underlying data. The industry estimates that approximately £1 billion per year is wasted on duplicated property data.

## The root cause

These problems share a common root: **property data lacks provenance**. There's no standard way for the *source* of the data to sign it, for recipients to *verify* that signature, or for anyone to check whether the data is still *valid*.

Without provenance, every participant in the chain has to re-verify data through manual processes, phone calls, and professional judgement. The system works — just about — but it's slow, expensive, and fragile.

PDTF 2.0 addresses this root cause directly. By making every piece of property data independently verifiable, it removes the need to trust intermediaries and replaces it with something more reliable: cryptographic proof.

[Read how PDTF 2.0 solves this →](../about/solution/)
