---
title: "15 — Conformance Testing"
description: "PDTF 2.0 conformance levels, test vectors, and interop protocols."
---


**Version:** 0.1 (Draft)
**Date:** 15 April 2026
**Author:** Ed Molyneux / Moverly

**Parent:** [00 — Architecture Overview](/web/specs/00-architecture-overview/)

This specification defines how a software package proves it correctly implements PDTF 2.0. Conformance is established by verifying output against the official test vectors and participating in interop testing.

## 1. Conformance Levels

Implementations can claim conformance at different levels depending on their scope.

### Level 1: Credential Verification
The minimum implementation needed by a consumer (e.g. a lender portal or conveyancing CMS) to trust a single PDTF credential.

To claim Level 1, an implementation MUST correctly process all Level 1 test vectors, which cover:
- W3C VC v2 format validation
- DID resolution (`did:key` and `did:web`)
- Data Integrity signature verification (`eddsa-jcs-2022`)
- Bitstring Status List resolution and bit checking
- OpenID Federation trust resolution and Trust Mark `delegation` authorisation checks

### Level 2: Entity State Assembly
Required for systems that compose the entity graph and manage transaction state.

To claim Level 2, an implementation MUST pass Level 1, plus all Level 2 test vectors covering:
- Deep merge semantics
- Schema-driven dependency pruning (e.g. stripping stale branches when discriminators change)
- Overlapping credentials across multiple issuers
- Conflict surfacing

### Level 3: Dual-State Extraction
Required for platforms that bridge PDTF 2.0 verifiable credentials to legacy PDTF v1/v3 JSON structures.

To claim Level 3, an implementation MUST pass Level 2, plus all Level 3 test vectors covering:
- `composeV3StateFromGraph` generation
- Mapping array elements back to legacy structures
- Handling `v4` entity collection semantics (e.g. ID-keyed objects to lists)

## 2. Test Vectors

The official test suite is hosted in the `property-data-standards-co/conformance` repository. 

Test vectors are provided as static JSON fixtures. Implementations SHOULD download these fixtures during their CI test runs and verify that their libraries produce the expected pass/fail output for each.

### 2.1 Vector Structure

Each test category contains a `manifest.json` describing the test cases:

```json
{
  "category": "vc-verification",
  "tests": [
    {
      "id": "vc-valid-epc",
      "description": "A valid EPC credential signed with eddsa-jcs-2022",
      "input": "fixtures/valid/epc-1.json",
      "expect": "pass"
    },
    {
      "id": "vc-invalid-signature",
      "description": "An EPC credential where the subject data has been tampered with after signing",
      "input": "fixtures/invalid/tampered-epc-1.json",
      "expect": "fail",
      "failReason": "signature_mismatch"
    }
  ]
}
```

### 2.2 Test Categories

1. **VC Verification:** Valid VCs, tampered subjects, invalid dates, missing required fields.
2. **DID Resolution:** Valid `did:key` derivations, valid `did:web` documents, incorrect `assertionMethod` arrays, key format errors.
3. **Status Lists:** Active credentials, revoked credentials, suspended credentials, out-of-bounds indices.
4. **Federation Trust Resolution:** Trust Mark `delegation.authorised_paths` coverage, unauthorised paths, wildcard matching (e.g. `Title:*`), trust level inheritance.
5. **State Assembly:** Pruning tests (e.g. changing `heatingType` to "None" and ensuring `centralHeatingDetails` is stripped).

## 3. Interoperability Protocol

Test vectors prove a library works in isolation. Interoperability testing proves that two independent implementations can exchange data.

If a vendor implements PDTF in a language other than the reference implementations (TypeScript, Rust, Python, .NET), they MUST successfully complete an interop test with `@pdtf/core` before claiming full PDTF 2.0 support.

The interop protocol requires:
1. Vendor implementation issues and signs a VC.
2. Reference implementation successfully verifies the VC, including signature and status list checks.
3. Reference implementation issues and signs a VC.
4. Vendor implementation successfully verifies the VC, including signature and status list checks.

---

*This document is part of the PDTF 2.0 specification suite. For the complete list of sub-specs, see [00 — Architecture Overview](/web/specs/00-architecture-overview/).*
