---
title: "Spec: Credential Revocation"
description: "W3C Bitstring Status List-based credential revocation."
---

# PDTF 2.0 — Sub-spec 14: Credential Revocation

**Version:** 0.2 (Draft)
**Date:** 1 April 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Parent:** [00 — Architecture Overview](./00-architecture-overview.md)

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [W3C Bitstring Status List v2](#2-w3c-bitstring-status-list-v2)
3. [Credential Status Field](#3-credential-status-field)
4. [Status List Credential](#4-status-list-credential)
5. [Hosting Architecture](#5-hosting-architecture)
6. [Index Allocation](#6-index-allocation)
7. [Revocation Flows](#7-revocation-flows)
8. [Suspension vs Revocation](#8-suspension-vs-revocation)
9. [Verification Flow](#9-verification-flow)
10. [Batch Revocation](#10-batch-revocation)
11. [Status List Rotation](#11-status-list-rotation)
12. [Privacy Considerations](#12-privacy-considerations)
13. [Security Considerations](#13-security-considerations)
14. [Open Questions](#14-open-questions)
15. [Implementation Notes](#15-implementation-notes)

---

## 1. Purpose

Verifiable Credentials in PDTF 2.0 assert facts about properties, ownership, representation, and consent at a specific point in time. Those facts change. Properties are sold. Mandates are withdrawn. EPCs are superseded. Accounts are disabled. Without a mechanism to signal that a previously-issued credential is no longer valid, verifiers would continue to trust stale assertions — with real consequences for conveyancing transactions.

Credential revocation is the mechanism by which an issuer declares that a credential it previously issued MUST no longer be accepted by verifiers. It is a foundational infrastructure concern: every credential in the PDTF 2.0 ecosystem — whether issued by a Moverly adapter, a primary-source authority, or the platform itself — MUST support revocation from the moment of issuance.

### Why Revocation Is Critical in Property Transactions

**Ownership changes.** When a property sale completes, the seller's ownership credential becomes false. Title transfers to the buyer. Any credential asserting the seller's ownership MUST be revoked immediately upon completion, and a new credential issued to the buyer. Failure to revoke creates a window where two parties could both present valid ownership claims.

**Mandate withdrawal.** A seller may change conveyancer mid-transaction, or revoke a conveyancer's authority to act on their behalf. The representation credential linking conveyancer to seller MUST be revocable independently of the transaction lifecycle.

**Data superseded.** Property data changes over time. A new EPC is issued, a local authority search is refreshed, a lease is varied. When the underlying data changes, the credential wrapping the old data MUST be revoked so verifiers fetch the current version.

**Account disabled.** If a user's account is suspended or terminated — for fraud, compliance reasons, or at the user's request — all credentials asserting that user's identity or roles MUST be revocable.

**Consent withdrawn.** DelegatedConsent credentials grant third parties (lenders, insurers) access to transaction data. The granting party MUST be able to revoke that consent at any time, and the revocation MUST be verifiable without contacting the consent grantor.

### Design Principle

> **D18:** All Verifiable Credentials issued within the PDTF 2.0 ecosystem MUST include a `credentialStatus` field referencing a W3C Bitstring Status List. Issuers MUST maintain status list infrastructure capable of revoking any credential they have issued.

This is not optional. Credentials without revocation support MUST be rejected by conformant verifiers.

---

## 2. W3C Bitstring Status List v2

### Overview

The [W3C Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/) specification defines a privacy-preserving, scalable mechanism for publishing the revocation status of Verifiable Credentials. PDTF 2.0 adopts this specification as the mandatory revocation mechanism for all credentials.

### How It Works

The core idea is elegant:

1. **Each issuer maintains one or more status lists.** A status list is a bitstring — a sequence of bits, each representing one credential.
2. **Each credential is assigned an index** in a specific status list at the time of issuance. This index is recorded in the credential's `credentialStatus` field.
3. **To revoke a credential**, the issuer flips the bit at the credential's index from `0` to `1`.
4. **To check revocation status**, a verifier fetches the status list, decompresses it, and reads the bit at the credential's index.

The status list itself is published as a Verifiable Credential, signed by the issuer. This means verifiers can authenticate the status list using the same trust infrastructure they use to verify the credentials themselves.

```
┌─────────────────────────────────────────────────────────┐
│                    Status List (bitstring)               │
│                                                         │
│  Index:  0  1  2  3  4  5  6  7  8  9  ...  67890  ... │
│  Value:  0  0  1  0  0  0  1  0  0  0  ...    1    ... │
│              │        │                    │             │
│              │        │                    │             │
│          credential  credential       credential        │
│          #2 revoked  #6 revoked       #67890 revoked    │
│                                                         │
│  Compressed: gzip → base64 → encodedList field          │
│  Published as: Verifiable Credential (signed by issuer) │
└─────────────────────────────────────────────────────────┘
```

### Compression

The bitstring is compressed using gzip and then base64-encoded into the `encodedList` field of the status list credential. A 16KB uncompressed bitstring (131,072 bits) compresses to a few hundred bytes when most bits are `0`, making status lists extremely efficient to transfer.

### Why Bitstring Status List v2

PDTF 2.0 evaluated several revocation mechanisms before selecting Bitstring Status List:

| Mechanism | Pros | Cons | Decision |
|-----------|------|------|----------|
| **Bitstring Status List** | W3C standard, privacy-preserving, cacheable, simple | Requires issuer to host status endpoint | ✅ **Selected** |
| **StatusList2021** | Predecessor, widely implemented | Superseded by Bitstring Status List | ❌ Superseded |
| **Certificate Revocation Lists (CRL)** | Well-understood (X.509) | Not designed for VCs, poor privacy | ❌ Wrong ecosystem |
| **OCSP** | Real-time status | Requires online responder, privacy leak (issuer sees every check) | ❌ Privacy concern |
| **Short-lived credentials** | No revocation needed | Impractical for property data (credentials valid for months) | ❌ Impractical |
| **Accumulator-based** | Cryptographically elegant | Complex, limited tooling, not standardised | ❌ Too experimental |

The Bitstring Status List strikes the right balance: it is a W3C standard with growing adoption, it preserves privacy through herd anonymity (verifiers fetch the entire list, not individual statuses), it is cacheable and CDN-friendly, and it requires only simple infrastructure from issuers.

---

## 3. Credential Status Field

### Requirement

Every Verifiable Credential issued within PDTF 2.0 MUST include a `credentialStatus` property. Credentials without this property MUST be rejected by conformant verifiers, regardless of whether the credential signature is valid.

### Structure

The `credentialStatus` field conforms to the `BitstringStatusListEntry` type:

```json
{
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/12345#67890",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "67890",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/12345"
  }
}
```

### Field Definitions

#### `id`

A unique identifier for this status entry. Constructed as the `statusListCredential` URL with the `statusListIndex` as a fragment identifier. This allows direct dereferencing in linked-data contexts.

**Format:** `{statusListCredential}#{statusListIndex}`

#### `type`

MUST be `"BitstringStatusListEntry"`. This identifies the entry as conforming to the W3C Bitstring Status List specification.

#### `statusPurpose`

Indicates what the status bit represents. PDTF 2.0 uses two purposes:

- **`"revocation"`** — The primary purpose. A set bit (value `1`) means the credential has been permanently revoked and MUST NOT be accepted.
- **`"suspension"`** — A set bit means the credential is temporarily suspended. Suspension is reversible; see [§8 Suspension vs Revocation](#8-suspension-vs-revocation).

A credential MAY include multiple `credentialStatus` entries with different purposes (one for revocation, one for suspension), referencing different status lists.

#### `statusListIndex`

A string representation of a non-negative integer identifying the position of the credential's status bit within the status list bitstring. The value is a string (not an integer) per the W3C specification.

**Constraints:**
- Assigned at credential issuance
- MUST be unique within the referenced status list
- MUST NOT be reused, even after the credential is revoked
- Valid range: `"0"` to `"131071"` for standard 16KB lists (or higher for larger lists)

#### `statusListCredential`

The URL of the Verifiable Credential that contains the status list bitstring. This URL:
- MUST be HTTPS
- MUST be dereferenceable (returns a valid status list VC)
- SHOULD be stable (the URL does not change over the lifetime of the credential)
- MUST be hosted by the credential issuer or their designated infrastructure

### Full Credential Example

An EPC credential with revocation status:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://schemas.propdata.org.uk/pdtf/v2"
  ],
  "type": ["VerifiableCredential", "EpcCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-03-15T10:30:00Z",
  "credentialSubject": {
    "id": "did:web:propdata.org.uk:property:pd-00000001",
    "epc": {
      "rating": "C",
      "score": 72,
      "certificateNumber": "0123-4567-8901-2345-6789",
      "validUntil": "2036-03-15"
    }
  },
  "credentialStatus": {
    "id": "https://adapters.propdata.org.uk/status/epc/12345#67890",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "67890",
    "statusListCredential": "https://adapters.propdata.org.uk/status/epc/12345"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-15T10:30:00Z",
    "proofValue": "z3FXQjecWufY46...yUzjGtJPQs8"
  }
}
```

### Dual-Purpose Status (Revocation + Suspension)

When a credential supports both permanent revocation and temporary suspension, it includes two `credentialStatus` entries, each referencing a different status list:

```json
{
  "credentialStatus": [
    {
      "id": "https://adapters.propdata.org.uk/status/epc/rev/12345#67890",
      "type": "BitstringStatusListEntry",
      "statusPurpose": "revocation",
      "statusListIndex": "67890",
      "statusListCredential": "https://adapters.propdata.org.uk/status/epc/rev/12345"
    },
    {
      "id": "https://adapters.propdata.org.uk/status/epc/sus/12345#67890",
      "type": "BitstringStatusListEntry",
      "statusPurpose": "suspension",
      "statusListIndex": "67890",
      "statusListCredential": "https://adapters.propdata.org.uk/status/epc/sus/12345"
    }
  ]
}
```

Note: revocation and suspension lists are separate. A credential may be suspended (bit set on suspension list) but not revoked (bit unset on revocation list). See [§8](#8-suspension-vs-revocation) for the state matrix.

---

## 4. Status List Credential

### Structure

The status list itself is published as a Verifiable Credential. This is a key design choice: it means the status list is authenticated using the same trust infrastructure as the credentials it governs. Verifiers do not need a separate trust mechanism for revocation data.

### Requirements

- **Signed by the credential issuer's key.** The status list credential MUST be signed by the same DID — and the same signing key — that issued the credentials it covers. No separate status list signing key is required or recommended. This aligns with W3C Bitstring Status List convention where the status list VC issuer matches the credential issuer, and prevents an attacker from publishing a forged status list.
- **Contains the encoded bitstring.** The `credentialSubject.encodedList` field contains the gzip-compressed, base64-encoded bitstring.
- **Minimum size.** The uncompressed bitstring MUST be at least 16KB (131,072 bits = 131,072 credential slots). This minimum ensures herd privacy — see [§12](#12-privacy-considerations).
- **Identified by URL.** The `id` of the status list credential MUST match the URL at which it is hosted.

### Full Example

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2"
  ],
  "id": "https://adapters.propdata.org.uk/status/epc/12345",
  "type": ["VerifiableCredential", "BitstringStatusListCredential"],
  "issuer": "did:web:adapters.propdata.org.uk:epc",
  "validFrom": "2026-01-01T00:00:00Z",
  "credentialSubject": {
    "id": "https://adapters.propdata.org.uk/status/epc/12345#list",
    "type": "BitstringStatusList",
    "statusPurpose": "revocation",
    "encodedList": "H4sIAAAAAAAAA-3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAIC3AYbSVKsAQAAA"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:adapters.propdata.org.uk:epc#key-1",
    "proofPurpose": "assertionMethod",
    "created": "2026-03-24T12:00:00Z",
    "proofValue": "z4dahJ1WnWwGGQ...8Xq5hTHFZVCR"
  }
}
```

### Field Details

| Field | Description |
|-------|-------------|
| `id` | MUST match the hosted URL. This is the value referenced by `statusListCredential` in individual credentials. |
| `type` | MUST include `"BitstringStatusListCredential"` |
| `issuer` | MUST match the issuer DID of the credentials this list covers |
| `validFrom` | Timestamp of list creation |
| `credentialSubject.type` | MUST be `"BitstringStatusList"` |
| `credentialSubject.statusPurpose` | `"revocation"` or `"suspension"` — MUST match the purpose in referencing credentials |
| `credentialSubject.encodedList` | Base64-encoded, gzip-compressed bitstring. Multibase prefix omitted (raw base64). |
| `proof` | Data Integrity proof using `eddsa-jcs-2022` cryptosuite |

### Encoding the List

To produce the `encodedList` value:

```
1. Start with a bitstring of at least 131,072 bits (all zeros initially)
2. For each revoked credential, set the bit at its statusListIndex to 1
3. Compress the bitstring using gzip (RFC 1952)
4. Encode the compressed bytes as base64 (RFC 4648, no padding)
```

To decode:

```
1. Base64-decode the encodedList value
2. Gzip-decompress the result
3. The result is the raw bitstring
4. Read the bit at the target statusListIndex
```

### Size Characteristics

| List Size (bits) | Uncompressed | Compressed (empty) | Compressed (1% revoked) | Credential Slots |
|-------------------|-------------|-------------------|------------------------|-----------------|
| 131,072 (16KB) | 16 KB | ~30 bytes | ~200 bytes | 131,072 |
| 1,048,576 (128KB) | 128 KB | ~150 bytes | ~1.5 KB | 1,048,576 |

The gzip compression is highly effective for sparse bitstrings (few revocations), making status lists efficient to transfer even at scale.

---

## 5. Hosting Architecture

### Principle

Each credential issuer is responsible for hosting the status lists for the credentials it issues. In the PDTF 2.0 trust evolution model, this means:

- **Phase 1 (Moverly proxies):** Moverly hosts status lists for all adapter-issued credentials at `adapters.propdata.org.uk`
- **Phase 2 (Separate adapters):** Each adapter host manages its own status lists at its own domain
- **Phase 3 (Primary sources):** Authoritative issuers host their own status lists

### URL Patterns

#### Adapter-Issued Credentials (Phase 1–2)

```
https://adapters.propdata.org.uk/status/{adapter}/{listId}
```

Examples:
```
https://adapters.propdata.org.uk/status/epc/12345
https://adapters.propdata.org.uk/status/title/00001
https://adapters.propdata.org.uk/status/local-search/00042
https://adapters.propdata.org.uk/status/water-drainage/00003
```

#### Platform-Issued Credentials (User VCs, Consent VCs)

```
https://moverly.com/status/{category}/{listId}
```

Examples:
```
https://moverly.com/status/ownership/00001
https://moverly.com/status/representation/00001
https://moverly.com/status/consent/00001
https://moverly.com/status/user/00001
```

#### Primary-Source Issued Credentials (Phase 3)

When primary sources issue credentials directly, they host their own status lists:

```
https://epc.service.gov.uk/status/{listId}
https://landregistry.gov.uk/credentials/status/{listId}
```

### HTTP Requirements

Status list endpoints MUST support the following:

#### Response Headers

```http
HTTP/1.1 200 OK
Content-Type: application/vc+ld+json
Cache-Control: public, max-age=300
ETag: "a1b2c3d4"
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Accept
X-Content-Type-Options: nosniff
```

#### CORS

Status list endpoints MUST include CORS headers permitting cross-origin GET requests. Browser-based verifiers (wallet apps, web-based conveyancing platforms) will fetch status lists from different origins.

```
Access-Control-Allow-Origin: *
```

The wildcard is acceptable because status lists are public data — revocation status is not sensitive (by design; see [§12 Privacy](#12-privacy-considerations)).

#### Caching

Status lists SHOULD be served with `Cache-Control: public, max-age=300` (5 minutes). This balances:

- **Freshness:** Revocations propagate within 5 minutes
- **Efficiency:** CDN and client caching reduce load on issuer infrastructure
- **Cost:** Fewer origin requests

Issuers MAY use shorter TTLs (e.g., 60 seconds) for high-sensitivity credential types (ownership, representation) where faster revocation propagation is critical.

#### CDN Deployment

Status lists are ideal candidates for CDN caching:

```
┌──────────┐     ┌─────┐     ┌────────────┐
│ Verifier │────▶│ CDN │────▶│ Origin     │
│          │     │     │     │ (Adapter)  │
└──────────┘     └─────┘     └────────────┘
                   │
              Cached for TTL
              Serves stale on
              origin failure
```

Recommended CDN configuration:
- Cache key: URL path only (no query parameters)
- TTL: Honor `Cache-Control` from origin
- Stale-while-revalidate: 60 seconds
- Stale-if-error: 3600 seconds (serve stale if origin is down)

---

## 6. Index Allocation

### Allocation Strategy

Each issuer maintains an index counter per status list. When a new credential is issued:

1. Read the current index counter for the active status list
2. Assign that index to the new credential
3. Increment the counter
4. Store the mapping: `(listId, index) → credentialId`

### Sequential Allocation

Indices are allocated sequentially within a list, starting from `0`:

```
Credential A → list 12345, index 0
Credential B → list 12345, index 1
Credential C → list 12345, index 2
...
Credential N → list 12345, index 131071
```

### List Capacity and Overflow

When a status list reaches capacity (all indices allocated):

1. Create a new status list with an incremented `listId`
2. Reset the index counter to `0`
3. Begin allocating from the new list
4. The old list remains active and hosted indefinitely

```
List 12345: indices 0–131071 (full, read-only except for revocations)
List 12346: indices 0–...     (active, accepting new allocations)
```

### Index Reuse Prohibition

**Indices MUST NOT be reused.** Even when a credential is revoked, its index remains permanently assigned. This prevents:

- **Confusion:** A new credential inheriting a revoked credential's index would appear revoked
- **Replay attacks:** An attacker presenting a revoked credential at a reused index

### Database Schema

Issuers MUST maintain a persistent mapping between status list indices and credentials:

```sql
CREATE TABLE credential_status (
  issuer_did       TEXT NOT NULL,
  list_id          TEXT NOT NULL,
  status_index     INTEGER NOT NULL,
  credential_id    TEXT NOT NULL,
  credential_type  TEXT NOT NULL,
  subject_did      TEXT,
  issued_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMP,
  revocation_reason TEXT,

  PRIMARY KEY (issuer_did, list_id, status_index),
  UNIQUE (credential_id)
);

CREATE TABLE status_list (
  issuer_did       TEXT NOT NULL,
  list_id          TEXT NOT NULL,
  status_purpose   TEXT NOT NULL DEFAULT 'revocation',
  next_index       INTEGER NOT NULL DEFAULT 0,
  capacity         INTEGER NOT NULL DEFAULT 131072,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  last_updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  PRIMARY KEY (issuer_did, list_id)
);
```

### Concurrency

Index allocation MUST be atomic. In high-throughput scenarios (batch credential issuance), use database-level locking or atomic increment operations to prevent index collisions:

```sql
-- Atomic index allocation
UPDATE status_list
SET next_index = next_index + 1, last_updated_at = NOW()
WHERE issuer_did = $1 AND list_id = $2 AND is_active = TRUE
RETURNING next_index - 1 AS allocated_index;
```

---

## 7. Revocation Flows

This section details the revocation process for each credential type in the PDTF 2.0 ecosystem. Each flow identifies the trigger event, the initiating party, the system actions, and the status list update.

### 7.1 Ownership Credential Revocation

Ownership credentials assert that a party holds legal title to a property. They are revoked when ownership changes.

**Trigger:** Sale completion (transfer of title registered at Land Registry)

**Initiator:** Platform (automated on completion event)

**Flow:**

```
1. Land Registry confirms title transfer
       │
2. Platform receives completion notification
       │
3. Platform identifies seller's ownership credential
   ┌───┴───────────────────────────────────────────┐
   │ SELECT credential_id, list_id, status_index   │
   │ FROM credential_status                         │
   │ WHERE subject_did = {seller_did}               │
   │   AND credential_type = 'OwnershipCredential'  │
   │   AND revoked_at IS NULL                       │
   └───┬───────────────────────────────────────────┘
       │
4. Set bit at status_index in revocation list
       │
5. Re-sign the status list credential
       │
6. Publish updated status list
       │
7. Record revocation in database
   ┌───┴───────────────────────────────────────────┐
   │ UPDATE credential_status                       │
   │ SET revoked_at = NOW(),                        │
   │     revocation_reason = 'title_transferred'    │
   │ WHERE credential_id = {credential_id}          │
   └───┬───────────────────────────────────────────┘
       │
8. Issue new OwnershipCredential to buyer
```

**Timing:** Revocation MUST occur before or simultaneously with the new ownership credential issuance. There MUST NOT be a window where both the old and new ownership credentials are valid.

### 7.2 Representation Credential Revocation

Representation credentials assert that a conveyancer is authorised to act on behalf of a property owner in a transaction.

**Trigger:** Mandate withdrawn, conveyancer replaced, transaction completed, or transaction cancelled

**Initiator:** Seller (mandate withdrawal) or Platform (completion/cancellation)

**Flow:**

```
1. Trigger event occurs (seller withdraws mandate / transaction completes)
       │
2. Platform receives revocation request
       │
3. Platform identifies representation credential(s)
   ┌───┴───────────────────────────────────────────┐
   │ May be multiple: one per conveyancer per side  │
   │ of the transaction (seller's, buyer's)         │
   └───┬───────────────────────────────────────────┘
       │
4. For each credential:
   │  a. Set bit in revocation list
   │  b. Record revocation with reason
       │
5. Re-sign affected status list(s)
       │
6. Publish updated status list(s)
       │
7. Notify affected conveyancer (out of band)
```

**Reasons:**
- `mandate_withdrawn` — seller explicitly revoked authority
- `conveyancer_replaced` — new conveyancer appointed
- `transaction_completed` — representation no longer needed
- `transaction_cancelled` — transaction fell through

### 7.3 Property Data VC Revocation

Property data VCs wrap data from external sources (EPC, title register, local searches, water/drainage, environmental). They are revoked when the underlying data changes.

**Trigger:** New data available from source (new EPC issued, search refreshed, title updated)

**Initiator:** Adapter (on detecting updated source data)

**Flow:**

```
1. Adapter polls or receives notification of updated source data
       │
2. Adapter identifies existing credential for this property + data type
       │
3. Adapter revokes old credential
   │  a. Set bit in revocation list
   │  b. Re-sign status list
   │  c. Publish updated status list
       │
4. Adapter issues new credential with current data
   │  a. Allocate new index in status list
   │  b. Sign new credential
       │
5. Update entity graph with new credential reference
```

**Note:** The old credential remains verifiable (signature is still valid) but its revocation status will show it as revoked. Verifiers MUST check status before accepting any credential.

### 7.4 User DID Credential Revocation

User DID credentials bind a user's identity to their DID. They are revoked when an account is disabled.

**Trigger:** Account suspended, account deleted, fraud detection, user request

**Initiator:** Platform (account management)

**Flow:**

```
1. Account status change event
       │
2. Platform identifies all active credentials for user DID
   ┌───┴───────────────────────────────────────────┐
   │ This includes:                                 │
   │ - User identity credential                     │
   │ - Any ownership credentials                    │
   │ - Any representation credentials               │
   │ - Any consent credentials granted by this user │
   └───┬───────────────────────────────────────────┘
       │
3. Revoke all credentials (see §10 Batch Revocation)
       │
4. Publish updated status lists
       │
5. If suspension (not deletion): use suspension list
   instead of revocation list (reversible)
```

**Cascade:** User account revocation triggers cascade revocation of all credentials issued to or by that user. This is the most impactful revocation event and MUST be handled carefully.

### 7.5 DelegatedConsent Credential Revocation

DelegatedConsent credentials grant third parties (lenders, insurers, surveyors) access to specific transaction data.

**Trigger:** Consent withdrawn by granting party, access period expired, transaction completed

**Initiator:** Granting party (consent withdrawal) or Platform (expiry/completion)

**Flow:**

```
1. Consent withdrawal event
       │
2. Platform identifies DelegatedConsent credential
       │
3. Revoke credential
   │  a. Set bit in revocation list
   │  b. Re-sign status list
   │  c. Publish updated status list
       │
4. Notify affected third party (out of band)
       │
5. Platform enforcement: reject data requests
   presenting revoked consent credential
```

**Important:** Revocation of a consent credential does not retroactively invalidate data already shared. It prevents future access only. The third party may retain data already received, subject to their own data retention policies and GDPR obligations.

---

## 8. Suspension vs Revocation

### Definitions

| | Revocation | Suspension |
|---|---|---|
| **Purpose** | Permanent invalidation | Temporary hold |
| **Reversible** | No | Yes |
| **statusPurpose** | `"revocation"` | `"suspension"` |
| **Bit meaning** | `1` = permanently revoked | `1` = currently suspended |
| **Unsetting bit** | MUST NOT (bit stays set forever) | MAY (restores credential) |

### State Matrix

A credential with both revocation and suspension status entries can be in one of four states:

| Revocation Bit | Suspension Bit | Credential State | Verifier Action |
|---------------|---------------|-----------------|-----------------|
| 0 | 0 | **Active** | Accept |
| 0 | 1 | **Suspended** | Reject (temporary) |
| 1 | 0 | **Revoked** | Reject (permanent) |
| 1 | 1 | **Revoked** | Reject (permanent — revocation takes precedence) |

### When to Use Suspension

Suspension is appropriate when the invalidation may be temporary:

**Pending investigation.** A fraud report has been filed but not yet confirmed. Suspending the credential prevents its use during investigation while allowing reinstatement if the report is unfounded.

**Temporary access hold.** A lender requests a temporary freeze on consent credentials while reviewing a case.

**Disputed ownership.** An ownership claim is challenged but not yet resolved. Suspension prevents the credential from being relied upon without permanently revoking it.

**Account review.** A user's account is flagged for review but not yet disabled. Suspension of their credentials provides immediate protection.

### When to Use Revocation

Revocation is appropriate when the invalidation is permanent:

- Title has transferred (ownership credential)
- Conveyancer has been permanently replaced (representation credential)
- New EPC has been issued (old EPC credential)
- Account has been permanently deleted
- Consent has been formally withdrawn

### Implementation Note

Suspension requires the issuer to maintain the ability to flip bits back to `0` and re-sign the status list. This is operationally more complex than revocation (where bits are only ever set, never unset). Issuers SHOULD implement suspension only for credential types where temporary invalidation is a real requirement.

---

## 9. Verification Flow

### Overview

Every verifier in the PDTF 2.0 ecosystem MUST check the revocation status of a credential before accepting it. The verification flow is deterministic and cacheable.

### Step-by-Step Process

```
┌─────────────────────────────────────────────────────────────────┐
│                     Credential Verification                      │
│                                                                  │
│  1. Receive credential (VC)                                      │
│     │                                                            │
│  2. Verify credential proof (signature)                          │
│     │  └─ If invalid → REJECT                                   │
│     │                                                            │
│  3. Extract credentialStatus field                               │
│     │  └─ If missing → REJECT (D18 requires it)                 │
│     │                                                            │
│  4. For each credentialStatus entry:                             │
│     │                                                            │
│     │  a. Check local cache for statusListCredential             │
│     │     └─ If cached and fresh → use cached version            │
│     │     └─ If stale/missing → fetch from URL                   │
│     │                                                            │
│     │  b. Fetch statusListCredential from URL                    │
│     │     ├─ HTTP GET with Accept: application/vc+ld+json        │
│     │     ├─ Respect Cache-Control headers                       │
│     │     └─ If fetch fails → see §13 (fail-closed)             │
│     │                                                            │
│     │  c. Verify status list credential proof                    │
│     │     ├─ Issuer DID MUST match credential issuer             │
│     │     └─ If invalid → REJECT                                │
│     │                                                            │
│     │  d. Decode encodedList                                     │
│     │     ├─ Base64 decode                                       │
│     │     ├─ Gzip decompress                                     │
│     │     └─ Result: raw bitstring                               │
│     │                                                            │
│     │  e. Read bit at statusListIndex                            │
│     │     ├─ If bit = 1 and purpose = "revocation" → REVOKED    │
│     │     ├─ If bit = 1 and purpose = "suspension" → SUSPENDED  │
│     │     └─ If bit = 0 → status OK for this purpose            │
│     │                                                            │
│  5. Aggregate results                                            │
│     ├─ Any revocation bit set → REJECT                          │
│     ├─ Any suspension bit set → REJECT (or warn, per policy)    │
│     └─ All bits clear → credential is ACTIVE                    │
│                                                                  │
│  6. Continue with remaining credential validation                │
│     (expiry, schema, trust chain, etc.)                          │
└─────────────────────────────────────────────────────────────────┘
```

### Pseudocode

```javascript
async function checkRevocationStatus(credential) {
  const statusEntries = Array.isArray(credential.credentialStatus)
    ? credential.credentialStatus
    : [credential.credentialStatus];

  for (const entry of statusEntries) {
    if (entry.type !== 'BitstringStatusListEntry') {
      throw new UnsupportedStatusType(entry.type);
    }

    // Fetch status list (with caching)
    const statusListVC = await fetchWithCache(
      entry.statusListCredential,
      { maxAge: 300_000 } // 5 minutes
    );

    // Verify status list credential signature
    const isValid = await verifyProof(statusListVC);
    if (!isValid) {
      throw new InvalidStatusList('Signature verification failed');
    }

    // Verify issuer match
    if (statusListVC.issuer !== credential.issuer) {
      throw new IssuerMismatch(
        `Status list issuer ${statusListVC.issuer} does not match ` +
        `credential issuer ${credential.issuer}`
      );
    }

    // Decode the bitstring
    const compressed = base64Decode(
      statusListVC.credentialSubject.encodedList
    );
    const bitstring = gzipDecompress(compressed);

    // Check the bit
    const index = parseInt(entry.statusListIndex, 10);
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    const bit = (bitstring[byteIndex] >> (7 - bitIndex)) & 1;

    if (bit === 1) {
      return {
        status: entry.statusPurpose, // 'revocation' or 'suspension'
        index: entry.statusListIndex,
        listCredential: entry.statusListCredential
      };
    }
  }

  return { status: 'active' };
}
```

### Caching Strategy

Verifiers SHOULD implement caching for status list credentials:

| Header | Recommended Value | Purpose |
|--------|------------------|---------|
| `Cache-Control` | `public, max-age=300` | 5-minute client cache |
| `ETag` | Hash of current list | Conditional requests |
| `Last-Modified` | Timestamp of last revocation | Conditional requests |

Verifiers SHOULD:
- Cache status list credentials for the duration specified by `Cache-Control`
- Use `If-None-Match` / `If-Modified-Since` for conditional fetches
- Accept stale cached lists for up to 60 seconds beyond TTL if the origin is unreachable
- Maintain a maximum cache size based on the number of distinct issuers they interact with

### Issuer Matching

The status list credential's `issuer` MUST match the original credential's `issuer`. This prevents an attacker from standing up a fake status list that claims a credential is not revoked:

```
Credential issuer:    did:web:adapters.propdata.org.uk:epc
Status list issuer:   did:web:adapters.propdata.org.uk:epc  ✅ Match

Credential issuer:    did:web:adapters.propdata.org.uk:epc
Status list issuer:   did:web:evil.example.com:epc          ❌ Mismatch → REJECT
```

---

## 10. Batch Revocation

### Use Case

Several scenarios require revoking multiple credentials simultaneously:

- **Transaction completion:** All representation credentials, consent credentials, and the seller's ownership credential for a transaction
- **Account termination:** All credentials issued to a user
- **Adapter key rotation:** All credentials signed with a compromised key (reissue with new key)

### Process

Batch revocation is efficient because multiple bits can be flipped in a single status list update:

```
1. Identify all credentials to revoke
       │
2. Group by status list
   ┌───┴───────────────────────────────────────────┐
   │ List 12345: indices [4, 17, 892, 67890]       │
   │ List 12346: indices [3, 55]                    │
   └───┬───────────────────────────────────────────┘
       │
3. For each affected status list:
   │  a. Load current bitstring
   │  b. Set all target bits to 1
   │  c. Compress and encode
   │  d. Re-sign the status list credential
   │  e. Publish updated status list
       │
4. Record all revocations in database (single transaction)
```

### Atomicity

Batch revocation SHOULD be atomic within a single status list. Either all bits in the batch are flipped and the list is re-signed, or none are. This prevents partial revocation states.

For revocations spanning multiple status lists, each list update is independent. The overall batch is eventually consistent — some lists may update before others, creating a brief window where some credentials in the batch appear revoked while others do not.

### Performance

Re-signing a status list is the most expensive operation (asymmetric cryptography). Batching amortises this cost:

| Approach | Signatures Required | Time (estimate) |
|----------|-------------------|-----------------|
| Individual revocation (100 credentials) | 100 | ~10 seconds |
| Batch revocation (100 credentials, 1 list) | 1 | ~0.1 seconds |
| Batch revocation (100 credentials, 3 lists) | 3 | ~0.3 seconds |

---

## 11. Status List Rotation

### Lifecycle

Status lists have a lifecycle driven by capacity:

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ List 001 │     │ List 002 │     │ List 003 │
│ FULL     │     │ FULL     │     │ ACTIVE   │
│ 131072/  │     │ 131072/  │     │ 45000/   │
│ 131072   │     │ 131072   │     │ 131072   │
└──────────┘     └──────────┘     └──────────┘
   Still             Still           Accepting
   hosted            hosted          new creds
   (revocations      (revocations
   still applied)    still applied)
```

### Rotation Rules

1. **One active list per issuer per purpose.** At any time, an issuer has exactly one active status list per `statusPurpose` for allocating new indices.
2. **Create new list when full.** When `next_index` reaches `capacity`, create a new list and mark the old one as inactive for allocation (but still active for revocation).
3. **Old lists are permanent.** A status list MUST remain hosted and accessible for as long as any credential references it. In practice, this means indefinitely — credentials may be presented years after issuance.
4. **Revocations on old lists.** Even a "full" list (no more indices available for new credentials) continues to accept revocation updates. The issuer can still flip bits and re-sign.

### List ID Scheme

List IDs are issuer-scoped and sequential:

```
Issuer: did:web:adapters.propdata.org.uk:epc
Lists:
  - epc/00001 (full, 131072 credentials)
  - epc/00002 (full, 131072 credentials)
  - epc/00003 (active, 45000 credentials allocated)
```

### Archival

Over time, lists where all referenced credentials have expired naturally become dormant (no revocation activity). However, they MUST NOT be deleted — a verifier may encounter an old credential and need to check its status.

Issuers MAY move dormant lists to cold storage with slower access times, but the URL MUST remain dereferenceable.

---

## 12. Privacy Considerations

### Herd Privacy

The Bitstring Status List design provides privacy through herd anonymity. When a verifier fetches a status list to check one credential, the issuer cannot determine which credential the verifier is checking — the verifier downloads the entire list.

This is analogous to k-anonymity: the credential being checked is hidden among all credentials in the same list.

### Minimum List Size

The W3C specification recommends a minimum uncompressed bitstring size of 16KB (131,072 bits). PDTF 2.0 mandates this minimum. Smaller lists would reduce the anonymity set and potentially allow the issuer to correlate verification requests with specific credentials.

**Example:** If a status list contained only 10 credentials and the issuer observed a fetch, they could narrow down which credential was being verified to 1 in 10. With 131,072 slots, the anonymity set is vastly larger.

### No Existence Leakage

The bitstring does not reveal which indices have been allocated. An unallocated index and a non-revoked allocated index both have bit value `0`. Observing the status list does not reveal:

- How many credentials have been issued
- Which indices are in use
- The rate of credential issuance

The only information leaked is the number of revocations (count of `1` bits), which is considered acceptable.

### Verifier Privacy

Verifiers fetch status lists via HTTPS GET. The issuer sees the request (IP address, timing) but not which credential is being checked. To further enhance privacy:

- Verifiers SHOULD use cached status lists when possible (reducing fetch frequency)
- Verifiers MAY fetch status lists through a proxy or VPN
- CDN caching naturally anonymises requests (CDN fetches from origin, not individual verifiers)

### Issuer Correlation Risk

An issuer operating multiple status lists could potentially correlate credential verification patterns across lists. PDTF 2.0 mitigates this through:

- Large list sizes (fewer lists needed, harder to correlate)
- CDN caching (origin sees fewer direct requests)
- No requirement for verifiers to identify themselves

---

## 13. Security Considerations

### Status List Credential Signing

The status list credential MUST be signed by the same DID — using the same signing key — that issued the credentials it covers. No separate status list signing key is provisioned. This is the fundamental security property: an attacker cannot forge revocation status without compromising the issuer's signing key, and the same key is used for both credential issuance and status list signing.

**Key compromise impact:** If an issuer's signing key is compromised, an attacker could:
- Forge a status list showing revoked credentials as active
- Forge a status list showing active credentials as revoked

**Mitigation:** Key rotation procedures, monitoring for unexpected status list changes, and the TIR (Trusted Issuer Registry) providing an additional layer of issuer authentication.

### Cache Poisoning

An attacker who can poison a verifier's cache could serve a stale status list that does not reflect recent revocations.

**Mitigations:**
- HTTPS prevents man-in-the-middle attacks on status list fetches
- Verifiers MUST verify the status list credential signature after fetching
- Short cache TTLs (5 minutes) limit the window of vulnerability
- CDN providers implement their own cache poisoning protections

### Availability: Fail Open vs Fail Closed

**What happens when the status list URL is unreachable?**

PDTF 2.0 mandates **fail closed** for high-stakes credentials:

| Credential Type | On Status List Unavailable | Rationale |
|----------------|---------------------------|-----------|
| OwnershipCredential | **REJECT** | Cannot risk accepting revoked ownership |
| RepresentationCredential | **REJECT** | Cannot risk accepting revoked mandate |
| DelegatedConsent | **REJECT** | Cannot risk granting revoked access |
| Property data VCs | **WARN + ACCEPT** (configurable) | Lower risk; data may still be valid |
| User DID credential | **REJECT** | Cannot verify identity without status |

Verifiers SHOULD:
- Use cached status lists as fallback (if within an extended grace period)
- Retry with exponential backoff before failing
- Log all status check failures for audit
- Alert operators when status list endpoints become unreachable

### Denial of Service

An attacker could target status list endpoints to prevent revocation checks, forcing verifiers into fail-open behaviour. Mitigations:

- CDN distribution (DDoS protection)
- Multiple CDN edge locations
- Stale-if-error caching (serve cached version during outage)
- Rate limiting at origin

### Replay Attacks

A status list is a point-in-time snapshot. An attacker who captures an older version of a status list (before a revocation) could attempt to serve it to verifiers.

**Mitigation:** The status list credential includes a `proof.created` timestamp. Verifiers SHOULD reject status lists that are significantly older than expected (e.g., more than 1 hour old when the TTL is 5 minutes). However, this check must be balanced against clock skew and legitimate caching.

---

## 14. Open Questions

### Q1: Suspension Scope

Should all credential types support suspension, or only specific types (ownership, representation)? Suspension adds operational complexity (the ability to un-set bits and re-sign). Property data VCs may not need suspension — if data is wrong, revoke and reissue.

**Proposed resolution:** Suspension is OPTIONAL for property data VCs, RECOMMENDED for ownership and representation credentials, and REQUIRED for DelegatedConsent credentials.

### Q2: Cross-Issuer Revocation

In Phase 3 (primary source issuers), how does the platform trigger revocation of a credential it did not issue? For example, when a transaction completes, the platform needs to revoke ownership credentials that may have been issued by a Land Registry adapter.

**Proposed approach:** The platform sends a revocation request to the issuer via a defined API. The issuer performs the actual revocation. This maintains the principle that only the issuer can modify its status lists.

### Q3: Revocation Notification

Should there be a push notification mechanism when a credential is revoked? Currently, verifiers must poll status lists. For time-sensitive revocations (ownership transfer), a push mechanism could reduce the window of vulnerability.

**Proposed approach:** Out-of-band notification (webhook, event stream) as a complement to — not a replacement for — status list checking. The status list remains the source of truth.

### Q4: Status List Size Optimisation

The 16KB minimum (131,072 slots) is generous for most adapters. A small adapter issuing 100 credentials per year would take over 1,000 years to fill a single list. Should we allow smaller lists for low-volume issuers?

**Proposed resolution:** Maintain the 16KB minimum per W3C recommendation. The privacy benefits outweigh the minimal storage cost.

### Q5: Historical Status

Should verifiers be able to determine *when* a credential was revoked, not just *whether* it was revoked? The current bitstring mechanism only provides current status.

**Proposed approach:** The status list itself does not provide historical data. Issuers MAY maintain revocation timestamps in their database and expose them through an optional API, but this is out of scope for the core revocation specification.

### Q6: Multi-Key Issuers

When an issuer rotates keys, the new key signs the status list. But the status list covers credentials signed by the old key. Should there be a constraint that status lists are signed by the same key as the credentials they cover, or just the same DID?

**Resolution:** Same DID is sufficient. Status list VCs are signed with the issuer's current primary key (the same key used for new credential issuance — there is no separate status list signing key). The DID document lists all valid keys. Key rotation is a normal operational event: after rotation, the new primary key signs both new credentials and updated status lists, while old credentials signed by the previous key remain verifiable via the DID document's `verificationMethod` array.

---

## 15. Implementation Notes

### Reference Implementation: @pdtf/vc-validator

The `@pdtf/vc-validator` package (in the `property-data-standards-co` GitHub org) provides the reference implementation for status list verification:

```typescript
import { checkStatus } from '@pdtf/vc-validator';

const result = await checkStatus(credential, {
  cache: statusListCache,  // LRU cache instance
  timeout: 5000,           // fetch timeout in ms
  failClosed: true,        // reject on fetch failure
  maxAge: 300_000,         // cache TTL in ms
});

if (result.revoked) {
  console.error(`Credential revoked: ${result.reason}`);
}
if (result.suspended) {
  console.warn(`Credential suspended`);
}
```

### Status List Builder

For issuers, `@pdtf/vc-validator` also exports status list construction utilities:

```typescript
import {
  createStatusList,
  revokeCredential,
  encodeStatusList,
} from '@pdtf/vc-validator';

// Create a new empty status list
const bitstring = createStatusList(131_072); // 16KB

// Revoke credentials by index
revokeCredential(bitstring, 67890);
revokeCredential(bitstring, 12345);

// Encode for the status list credential
const encodedList = encodeStatusList(bitstring);
// → "H4sIAAAAAAAAA-3BMQ..."
```

### Database Schema Notes

The schema in [§6](#6-index-allocation) is illustrative. Production implementations should consider:

- **Indexing:** Index on `(credential_type, subject_did)` for fast lookups during revocation flows
- **Partitioning:** Partition `credential_status` by `issuer_did` for multi-tenant deployments
- **Audit log:** Maintain a separate `revocation_audit_log` table recording who triggered each revocation and why
- **Backup:** Status list state is critical infrastructure — include in disaster recovery plans

### Monitoring

Issuers SHOULD monitor:

- **Status list endpoint availability** — uptime monitoring with alerting
- **Revocation latency** — time from revocation trigger to status list publication
- **Cache hit rates** — at CDN and origin
- **List utilisation** — percentage of indices allocated per list (trigger rotation planning)
- **Signature verification failures** — may indicate key issues or attacks

### Testing

Conformance testing for revocation:

1. **Issuance:** Verify every issued credential includes `credentialStatus`
2. **Revocation:** Verify revoking a credential sets the correct bit
3. **Verification:** Verify a revoked credential is rejected by the validator
4. **Suspension:** Verify a suspended credential is rejected, then reinstated
5. **Cache:** Verify cached status lists are used within TTL
6. **Fail-closed:** Verify unreachable status lists cause rejection (for applicable types)
7. **Batch:** Verify batch revocation correctly updates multiple bits
8. **Issuer match:** Verify status lists from wrong issuer are rejected

### Migration from PDTF v1/v3

PDTF v1/v3 does not have credential revocation (claims are asserted through OIDC verified claims, not VCs). During the dual-state assembly period:

- V2 credentials MUST include `credentialStatus`
- V3 state assembly (`composeV3StateFromGraph`) ignores revocation — it operates on OIDC claims
- V4 state assembly (`composeV4StateFromGraph`) MUST check revocation before including any credential in the assembled state
- The transition period may surface inconsistencies where a V3 state includes data from a revoked V2 credential — this is a known limitation addressed in the state assembly migration path (see [07 — State Assembly](./07-state-assembly.md))

---

## Appendix A: Decision Log

| ID | Decision | Rationale | Date |
|----|----------|-----------|------|
| D18 | Bitstring Status List mandatory for all issuers | W3C standard, privacy-preserving, cacheable, simple infrastructure requirement | 2026-03-24 |
| D18.1 | Minimum 16KB (131,072 bit) status lists | W3C recommendation for herd privacy; storage cost negligible | 2026-03-24 |
| D18.2 | Fail-closed for ownership/representation/consent credentials | Risk of accepting revoked credentials in property transactions too high | 2026-03-24 |
| D18.3 | Indices never reused | Prevents confusion and replay attacks | 2026-03-24 |
| D18.4 | 5-minute cache TTL recommended | Balance between freshness and efficiency | 2026-03-24 |

---

## Appendix B: Status List Lifecycle Diagram

```
                    ┌─────────────────┐
                    │   List Created   │
                    │  (all bits = 0)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │     Active       │◄──── Credentials allocated
                    │  (accepting new  │      Revocations applied
                    │   credentials)   │      Re-signed as needed
                    └────────┬────────┘
                             │
                    capacity reached
                             │
                    ┌────────▼────────┐
                    │      Full        │◄──── No new allocations
                    │  (revocations    │      Revocations still applied
                    │   still applied) │      Re-signed as needed
                    └────────┬────────┘
                             │
               all referenced credentials expired
                             │
                    ┌────────▼────────┐
                    │    Dormant       │◄──── No activity expected
                    │  (still hosted,  │      URL still dereferenceable
                    │   cold storage   │      May move to cold storage
                    │   eligible)      │
                    └─────────────────┘
```

---

## Appendix C: Related Specifications

- [W3C Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/)
- [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [Sub-spec 02 — VC Data Model](./02-vc-data-model.md) (credential structure)
- [Sub-spec 03 — DID Methods & Identifiers](./03-did-methods.md) (issuer DIDs)
- [Sub-spec 04 — Trusted Issuer Registry](./04-trusted-issuer-registry.md) (issuer trust)
- [Sub-spec 05 — Hosted Adapter Services](./05-hosted-adapter-services.md) (adapter-hosted status lists)
- [Sub-spec 07 — State Assembly](./07-state-assembly.md) (dual-state assembly)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.2 | 1 April 2026 | Status list signing explicitly requires same key as credential issuance — §4 requirements strengthened, §13 security updated, Q6 resolved. |
| v0.1 | 24 March 2026 | Initial draft. W3C Bitstring Status List v1.0, 16KB minimum lists, revocation + suspension purposes, fail-closed policy, 5-min cache TTL, CDN hosting, batch revocation, index allocation, reference packages. |
