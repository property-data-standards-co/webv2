---
title: "Impl: Credential Revocation"
description: "Implementation details for credential revocation infrastructure."
---

# PDTF 2.0 — Implementation: Credential Revocation Infrastructure

**Version:** 0.1 (Draft)
**Date:** 24 March 2026
**Author:** Ed Molyneux / Moverly
**Status:** Draft
**Implements:** [Sub-spec 14 — Credential Revocation](../14-credential-revocation.md)

---

## 1. Overview

This document specifies the technical implementation of credential revocation infrastructure for Moverly's PDTF 2.0 backend. It translates the W3C Bitstring Status List protocol (Sub-spec 14) into concrete infrastructure, services, and operational procedures.

**What this covers:**

- Firestore schema for status list state and index allocation
- `@pdtf/status-list` service package — TypeScript API
- Status list credential signing integration with `@pdtf/key-manager`
- Hosting: Cloud Functions + Cloud CDN for status list endpoints
- Revocation event pipeline (Firestore triggers → status list update → CDN invalidation)
- Batch revocation for transaction lifecycle events
- Suspension support for ownership and representation credentials
- Monitoring, alerting, and SLA targets
- Disaster recovery for status list infrastructure

**What this does NOT cover:**

- Protocol-level Bitstring Status List semantics (see Sub-spec 14)
- Key management (see impl/06-key-management-impl.md)
- VC signing format (see Sub-spec 02)
- TIR integration (see Sub-spec 04)

---

## 2. Architecture

### 2.1 System Diagram

```
                                    ┌─────────────────────────┐
                                    │    Credential Service    │
                                    │  (issues VCs, allocates  │
                                    │   status list indices)   │
                                    └────────┬────────────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │              │              │
                              ▼              ▼              ▼
                    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                    │  Firestore   │ │  Firestore   │ │  Firestore   │
                    │  statusLists │ │  statusIndex │ │  revocations │
                    │  (bitstring  │ │  (credential │ │  (event log) │
                    │   state)     │ │   → index)   │ │              │
                    └──────┬───────┘ └──────────────┘ └──────────────┘
                           │
                           │ Firestore onWrite trigger
                           ▼
                    ┌──────────────────┐
                    │  Status List     │
                    │  Publisher       │
                    │  (Cloud Function)│
                    │                  │
                    │  • Encode list   │
                    │  • Sign with KMS │
                    │  • Write to GCS  │
                    │  • Invalidate CDN│
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Cloud Storage   │
                    │  (status list    │──────┐
                    │   VCs as JSON)   │      │
                    └──────────────────┘      │
                                              │ Cloud CDN
                                              ▼
                                    ┌──────────────────┐
                                    │  CDN Edge        │
                                    │                  │
                                    │  adapters.       │
                                    │  propdata.org.uk │
                                    │  /status/...     │
                                    │                  │
                                    │  moverly.com     │
                                    │  /status/...     │
                                    └────────┬─────────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │    Verifiers      │
                                    │  (any party)      │
                                    └──────────────────┘
```

### 2.2 Key Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| R1 | Firestore for status list state, Cloud Storage for published VCs | Firestore gives us atomic updates and triggers; GCS gives us CDN-friendly static serving |
| R2 | Firestore trigger for publish pipeline | Decouples revocation (write to Firestore) from publishing (encode + sign + upload). Revocation is fast; publishing is async. |
| R3 | Cloud CDN in front of GCS | Status lists are read-heavy, write-infrequent. CDN caching is ideal. |
| R4 | One status list document per issuer per purpose per list ID | Clean Firestore document model; each doc is independently updatable |
| R5 | Atomic index allocation via Firestore transaction | Prevents index collisions under concurrent issuance |

---

## 3. Firestore Schema

### 3.1 Collections

```
firestore/
├── statusLists/
│   └── {issuerDid}:{purpose}:{listId}     # e.g. "did:web:adapters.propdata.org.uk:epc:revocation:00001"
│       ├── issuerDid: string
│       ├── purpose: "revocation" | "suspension"
│       ├── listId: string                   # "00001", "00002", etc.
│       ├── capacity: number                 # 131072 (default)
│       ├── nextIndex: number                # Atomic counter
│       ├── bitstring: Bytes                 # Raw bitstring (Firestore Bytes type)
│       ├── isActive: boolean                # Accepting new allocations?
│       ├── revokedCount: number             # Count of set bits (for monitoring)
│       ├── createdAt: timestamp
│       ├── lastModifiedAt: timestamp        # Last bit flip
│       ├── lastPublishedAt: timestamp       # Last GCS upload
│       ├── publishedVersion: number         # Increments on each publish
│       └── dirty: boolean                   # true = needs re-publish
│
├── statusIndex/
│   └── {credentialId}                       # Lookup: credential → status entry
│       ├── credentialId: string
│       ├── issuerDid: string
│       ├── credentialType: string
│       ├── subjectDid: string
│       ├── listId: string
│       ├── purpose: "revocation" | "suspension"
│       ├── statusIndex: number
│       ├── statusListDocId: string          # Reference to statusLists doc
│       ├── issuedAt: timestamp
│       ├── revokedAt: timestamp | null
│       ├── suspendedAt: timestamp | null
│       ├── revocationReason: string | null
│       └── transactionDid: string | null    # Transaction context
│
├── statusIndex_bySubject/                   # Composite index collection
│   └── {subjectDid}:{credentialType}        # For "revoke all for user" queries
│       └── credentialIds: string[]
│
└── revocationEvents/
    └── {eventId}                            # Audit log
        ├── eventType: string                # "revoke" | "suspend" | "reinstate"
        ├── credentialIds: string[]
        ├── reason: string
        ├── triggeredBy: string              # Service account or user action
        ├── transactionDid: string | null
        ├── timestamp: timestamp
        └── batchId: string | null           # Groups related revocations
```

### 3.2 Firestore Indexes

```
# statusIndex — for revocation flow queries
statusIndex:
  - subjectDid ASC, credentialType ASC, revokedAt ASC
  - issuerDid ASC, listId ASC, statusIndex ASC
  - transactionDid ASC, credentialType ASC, revokedAt ASC

# statusLists — for finding active list
statusLists:
  - issuerDid ASC, purpose ASC, isActive ASC
```

### 3.3 Why Firestore (Not Postgres)

The protocol spec (Sub-spec 14 §6) shows a SQL schema. We use Firestore instead because:

1. **Existing infrastructure.** Moverly's backend is Firebase. No new database to provision/maintain.
2. **Atomic transactions.** Firestore transactions give us atomic index allocation without explicit row locking.
3. **Triggers.** Firestore `onWrite` triggers drive the publish pipeline — no separate event bus needed.
4. **Scaling.** Firestore auto-scales. Status list operations are low-volume (tens of revocations per hour, not thousands per second).
5. **Cost.** At our scale, Firestore is essentially free for this workload.

If we ever need SQL-level query flexibility (complex revocation reporting, cross-issuer analytics), we can export to BigQuery.

---

## 4. `@pdtf/status-list` Service Package

### 4.1 Package Structure

```
packages/status-list/
├── src/
│   ├── index.ts                   # Public API exports
│   ├── bitstring.ts               # Bitstring operations (create, set, get, encode, decode)
│   ├── allocator.ts               # Index allocation (atomic Firestore transaction)
│   ├── revoker.ts                 # Revocation operations (single + batch)
│   ├── publisher.ts               # Status list VC construction + signing + GCS upload
│   ├── checker.ts                 # Status checking (for verifiers)
│   ├── lifecycle.ts               # List creation, rotation, dormancy
│   ├── types.ts                   # Shared types
│   └── constants.ts               # List size, URL patterns, TTLs
├── test/
│   ├── bitstring.test.ts
│   ├── allocator.test.ts
│   ├── revoker.test.ts
│   ├── publisher.test.ts
│   ├── checker.test.ts
│   └── fixtures/
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 Core Types

```typescript
// src/types.ts

export type StatusPurpose = 'revocation' | 'suspension';

export interface StatusListState {
  /** Firestore document ID: {issuerDid}:{purpose}:{listId} */
  docId: string;
  issuerDid: string;
  purpose: StatusPurpose;
  listId: string;
  capacity: number;
  nextIndex: number;
  /** Raw bitstring — Uint8Array where each bit represents one credential */
  bitstring: Uint8Array;
  isActive: boolean;
  revokedCount: number;
  createdAt: FirebaseFirestore.Timestamp;
  lastModifiedAt: FirebaseFirestore.Timestamp;
  lastPublishedAt: FirebaseFirestore.Timestamp;
  publishedVersion: number;
  dirty: boolean;
}

export interface StatusIndexEntry {
  credentialId: string;
  issuerDid: string;
  credentialType: string;
  subjectDid: string;
  listId: string;
  purpose: StatusPurpose;
  statusIndex: number;
  statusListDocId: string;
  issuedAt: FirebaseFirestore.Timestamp;
  revokedAt: FirebaseFirestore.Timestamp | null;
  suspendedAt: FirebaseFirestore.Timestamp | null;
  revocationReason: string | null;
  transactionDid: string | null;
}

/** Returned to the credential service at issuance time */
export interface AllocatedStatus {
  /** Full credentialStatus object to embed in the VC */
  credentialStatus: {
    id: string;
    type: 'BitstringStatusListEntry';
    statusPurpose: StatusPurpose;
    statusListIndex: string;
    statusListCredential: string;
  };
  /** Internal tracking */
  listId: string;
  index: number;
}

export interface RevocationRequest {
  credentialId: string;
  reason: string;
  triggeredBy: string;
  transactionDid?: string;
}

export interface BatchRevocationRequest {
  credentialIds: string[];
  reason: string;
  triggeredBy: string;
  transactionDid?: string;
}

export interface StatusCheckResult {
  credentialId?: string;
  status: 'active' | 'revoked' | 'suspended';
  checkedAt: string;
  /** Only present if revoked/suspended */
  purpose?: StatusPurpose;
  listId?: string;
  index?: number;
}

export interface StatusListConfig {
  /** Default list capacity */
  defaultCapacity: number;
  /** Base URLs for status list endpoints */
  adapterBaseUrl: string;    // e.g. "https://adapters.propdata.org.uk/status"
  platformBaseUrl: string;   // e.g. "https://moverly.com/status"
  /** GCS bucket for published status list VCs */
  gcsBucket: string;
  /** CDN cache TTL in seconds */
  cacheTtlSeconds: number;
}
```

### 4.3 Bitstring Operations

```typescript
// src/bitstring.ts

import { gzipSync, gunzipSync } from 'node:zlib';

const DEFAULT_CAPACITY = 131_072; // 16KB = 131,072 bits

/**
 * Create a new empty bitstring.
 * All bits initialised to 0 (no revocations).
 */
export function createBitstring(capacity: number = DEFAULT_CAPACITY): Uint8Array {
  const byteLength = Math.ceil(capacity / 8);
  return new Uint8Array(byteLength);
}

/**
 * Set a bit at the given index to 1 (revoke/suspend).
 * Mutates the bitstring in place.
 */
export function setBit(bitstring: Uint8Array, index: number): void {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = 7 - (index % 8); // MSB first per W3C spec

  if (byteIndex >= bitstring.length) {
    throw new RangeError(
      `Index ${index} exceeds bitstring capacity (${bitstring.length * 8} bits)`
    );
  }

  bitstring[byteIndex] |= (1 << bitIndex);
}

/**
 * Clear a bit at the given index to 0 (reinstate from suspension).
 * Only valid for suspension lists — revocation bits MUST NOT be cleared.
 */
export function clearBit(bitstring: Uint8Array, index: number): void {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = 7 - (index % 8);

  if (byteIndex >= bitstring.length) {
    throw new RangeError(
      `Index ${index} exceeds bitstring capacity (${bitstring.length * 8} bits)`
    );
  }

  bitstring[byteIndex] &= ~(1 << bitIndex);
}

/**
 * Get the value of a bit at the given index.
 * Returns true if the bit is set (revoked/suspended).
 */
export function getBit(bitstring: Uint8Array, index: number): boolean {
  const byteIndex = Math.floor(index / 8);
  const bitIndex = 7 - (index % 8);

  if (byteIndex >= bitstring.length) {
    throw new RangeError(
      `Index ${index} exceeds bitstring capacity (${bitstring.length * 8} bits)`
    );
  }

  return ((bitstring[byteIndex] >> bitIndex) & 1) === 1;
}

/**
 * Count the number of set bits (revocations) in a bitstring.
 */
export function countSetBits(bitstring: Uint8Array): number {
  let count = 0;
  for (const byte of bitstring) {
    // Brian Kernighan's algorithm per byte
    let b = byte;
    while (b) {
      b &= b - 1;
      count++;
    }
  }
  return count;
}

/**
 * Encode a bitstring for the status list credential's encodedList field.
 * gzip compress → base64 encode (no padding, per W3C spec).
 */
export function encodeBitstring(bitstring: Uint8Array): string {
  const compressed = gzipSync(Buffer.from(bitstring));
  return compressed.toString('base64url');
}

/**
 * Decode an encodedList value back to a raw bitstring.
 * base64 decode → gzip decompress.
 */
export function decodeBitstring(encodedList: string): Uint8Array {
  // Handle both base64url and standard base64
  const compressed = Buffer.from(encodedList, 'base64url');
  const decompressed = gunzipSync(compressed);
  return new Uint8Array(decompressed);
}
```

### 4.4 Index Allocator

```typescript
// src/allocator.ts

import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { createBitstring } from './bitstring.js';
import type {
  StatusPurpose,
  AllocatedStatus,
  StatusListState,
  StatusListConfig,
  StatusIndexEntry,
} from './types.js';

const STATUS_LISTS = 'statusLists';
const STATUS_INDEX = 'statusIndex';

export class IndexAllocator {
  constructor(
    private db: Firestore,
    private config: StatusListConfig,
  ) {}

  /**
   * Allocate a status list index for a new credential.
   *
   * This is called at credential issuance time. It:
   * 1. Finds or creates the active status list for this issuer+purpose
   * 2. Atomically reserves the next index
   * 3. Stores the credential → index mapping
   * 4. Returns the credentialStatus object to embed in the VC
   *
   * Uses a Firestore transaction for atomicity.
   */
  async allocate(params: {
    issuerDid: string;
    purpose: StatusPurpose;
    credentialId: string;
    credentialType: string;
    subjectDid: string;
    transactionDid?: string;
  }): Promise<AllocatedStatus> {
    const { issuerDid, purpose, credentialId, credentialType, subjectDid, transactionDid } = params;

    return this.db.runTransaction(async (tx) => {
      // 1. Find active list for this issuer + purpose
      const activeListQuery = this.db
        .collection(STATUS_LISTS)
        .where('issuerDid', '==', issuerDid)
        .where('purpose', '==', purpose)
        .where('isActive', '==', true)
        .limit(1);

      const activeSnap = await tx.get(activeListQuery);
      let listDoc: FirebaseFirestore.DocumentSnapshot;
      let listState: StatusListState;

      if (activeSnap.empty) {
        // No active list — create the first one
        const newListId = '00001';
        const docId = `${issuerDid}:${purpose}:${newListId}`;
        const newBitstring = createBitstring(this.config.defaultCapacity);

        listState = {
          docId,
          issuerDid,
          purpose,
          listId: newListId,
          capacity: this.config.defaultCapacity,
          nextIndex: 0,
          bitstring: newBitstring,
          isActive: true,
          revokedCount: 0,
          createdAt: FieldValue.serverTimestamp() as any,
          lastModifiedAt: FieldValue.serverTimestamp() as any,
          lastPublishedAt: FieldValue.serverTimestamp() as any,
          publishedVersion: 0,
          dirty: true,
        };

        const newDocRef = this.db.collection(STATUS_LISTS).doc(docId);
        tx.set(newDocRef, {
          ...listState,
          bitstring: Buffer.from(newBitstring),
        });
        listDoc = await tx.get(newDocRef);
      } else {
        listDoc = activeSnap.docs[0];
        listState = listDoc.data() as StatusListState;
      }

      // 2. Check capacity
      if (listState.nextIndex >= listState.capacity) {
        // Current list is full — create a new one
        // Mark current as inactive
        tx.update(listDoc.ref, { isActive: false });

        // Create next list
        const nextListNum = parseInt(listState.listId, 10) + 1;
        const newListId = String(nextListNum).padStart(5, '0');
        const newDocId = `${issuerDid}:${purpose}:${newListId}`;
        const newBitstring = createBitstring(this.config.defaultCapacity);

        listState = {
          docId: newDocId,
          issuerDid,
          purpose,
          listId: newListId,
          capacity: this.config.defaultCapacity,
          nextIndex: 0,
          bitstring: newBitstring,
          isActive: true,
          revokedCount: 0,
          createdAt: FieldValue.serverTimestamp() as any,
          lastModifiedAt: FieldValue.serverTimestamp() as any,
          lastPublishedAt: FieldValue.serverTimestamp() as any,
          publishedVersion: 0,
          dirty: true,
        };

        const newDocRef = this.db.collection(STATUS_LISTS).doc(newDocId);
        tx.set(newDocRef, {
          ...listState,
          bitstring: Buffer.from(newBitstring),
        });
      }

      // 3. Allocate index
      const allocatedIndex = listState.nextIndex;
      const listDocRef = this.db.collection(STATUS_LISTS).doc(listState.docId);
      tx.update(listDocRef, {
        nextIndex: FieldValue.increment(1),
      });

      // 4. Store credential → index mapping
      const indexEntry: StatusIndexEntry = {
        credentialId,
        issuerDid,
        credentialType,
        subjectDid,
        listId: listState.listId,
        purpose,
        statusIndex: allocatedIndex,
        statusListDocId: listState.docId,
        issuedAt: FieldValue.serverTimestamp() as any,
        revokedAt: null,
        suspendedAt: null,
        revocationReason: null,
        transactionDid: transactionDid ?? null,
      };

      tx.set(this.db.collection(STATUS_INDEX).doc(credentialId), indexEntry);

      // 5. Build the credentialStatus object for the VC
      const baseUrl = this.resolveBaseUrl(issuerDid);
      const adapterPath = this.resolveAdapterPath(issuerDid);
      const statusListUrl = `${baseUrl}/${adapterPath}/${listState.listId}`;

      return {
        credentialStatus: {
          id: `${statusListUrl}#${allocatedIndex}`,
          type: 'BitstringStatusListEntry' as const,
          statusPurpose: purpose,
          statusListIndex: String(allocatedIndex),
          statusListCredential: statusListUrl,
        },
        listId: listState.listId,
        index: allocatedIndex,
      };
    });
  }

  /**
   * Allocate dual status entries (revocation + suspension) for credentials
   * that support both.
   */
  async allocateDual(params: {
    issuerDid: string;
    credentialId: string;
    credentialType: string;
    subjectDid: string;
    transactionDid?: string;
  }): Promise<{
    revocation: AllocatedStatus;
    suspension: AllocatedStatus;
  }> {
    // Allocate from separate lists (revocation and suspension are independent)
    const [revocation, suspension] = await Promise.all([
      this.allocate({ ...params, purpose: 'revocation' }),
      this.allocate({ ...params, purpose: 'suspension' }),
    ]);

    return { revocation, suspension };
  }

  /** Map issuer DID to base URL */
  private resolveBaseUrl(issuerDid: string): string {
    if (issuerDid.startsWith('did:web:adapters.propdata.org.uk')) {
      return this.config.adapterBaseUrl;
    }
    return this.config.platformBaseUrl;
  }

  /** Extract adapter path from DID for URL construction */
  private resolveAdapterPath(issuerDid: string): string {
    // did:web:adapters.propdata.org.uk:epc → "epc"
    // did:web:moverly.com → "platform"
    const parts = issuerDid.split(':');
    if (parts.length > 3 && parts[2] === 'adapters.propdata.org.uk') {
      return parts.slice(3).join('/');
    }
    return 'platform';
  }
}
```

### 4.5 Revoker

```typescript
// src/revoker.ts

import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { setBit, clearBit } from './bitstring.js';
import type {
  RevocationRequest,
  BatchRevocationRequest,
  StatusIndexEntry,
  StatusListState,
} from './types.js';

const STATUS_LISTS = 'statusLists';
const STATUS_INDEX = 'statusIndex';
const REVOCATION_EVENTS = 'revocationEvents';

export class Revoker {
  constructor(private db: Firestore) {}

  /**
   * Revoke a single credential.
   *
   * Sets the bit in the status list bitstring and marks the index entry.
   * The publish pipeline (Firestore trigger) handles re-signing and uploading.
   */
  async revoke(request: RevocationRequest): Promise<void> {
    const { credentialId, reason, triggeredBy, transactionDid } = request;

    await this.db.runTransaction(async (tx) => {
      // 1. Look up the credential's status index entry
      const indexDoc = await tx.get(
        this.db.collection(STATUS_INDEX).doc(credentialId),
      );

      if (!indexDoc.exists) {
        throw new Error(`No status index entry for credential ${credentialId}`);
      }

      const entry = indexDoc.data() as StatusIndexEntry;

      if (entry.revokedAt !== null) {
        // Already revoked — idempotent
        return;
      }

      // 2. Load the status list document
      const listDoc = await tx.get(
        this.db.collection(STATUS_LISTS).doc(entry.statusListDocId),
      );

      if (!listDoc.exists) {
        throw new Error(`Status list ${entry.statusListDocId} not found`);
      }

      const listState = listDoc.data() as StatusListState;
      const bitstring = new Uint8Array(
        (listState.bitstring as any as Buffer).buffer,
      );

      // 3. Set the bit
      setBit(bitstring, entry.statusIndex);

      // 4. Update status list document
      tx.update(listDoc.ref, {
        bitstring: Buffer.from(bitstring),
        revokedCount: FieldValue.increment(1),
        lastModifiedAt: FieldValue.serverTimestamp(),
        dirty: true,
      });

      // 5. Update index entry
      tx.update(indexDoc.ref, {
        revokedAt: FieldValue.serverTimestamp(),
        revocationReason: reason,
      });

      // 6. Write audit event
      tx.create(this.db.collection(REVOCATION_EVENTS).doc(), {
        eventType: 'revoke',
        credentialIds: [credentialId],
        reason,
        triggeredBy,
        transactionDid: transactionDid ?? null,
        timestamp: FieldValue.serverTimestamp(),
        batchId: null,
      });
    });
  }

  /**
   * Revoke multiple credentials in a batch.
   *
   * Groups by status list for efficiency — each list is updated once
   * regardless of how many credentials in the batch reference it.
   */
  async revokeBatch(request: BatchRevocationRequest): Promise<{
    revoked: string[];
    alreadyRevoked: string[];
    notFound: string[];
  }> {
    const { credentialIds, reason, triggeredBy, transactionDid } = request;
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const revoked: string[] = [];
    const alreadyRevoked: string[] = [];
    const notFound: string[] = [];

    // 1. Load all index entries
    const indexDocs = await Promise.all(
      credentialIds.map(id =>
        this.db.collection(STATUS_INDEX).doc(id).get()
      ),
    );

    // 2. Group by status list document
    const byList = new Map<string, {
      listDocId: string;
      entries: Array<{ credentialId: string; index: number; docRef: FirebaseFirestore.DocumentReference }>;
    }>();

    for (let i = 0; i < credentialIds.length; i++) {
      const doc = indexDocs[i];
      const credentialId = credentialIds[i];

      if (!doc.exists) {
        notFound.push(credentialId);
        continue;
      }

      const entry = doc.data() as StatusIndexEntry;

      if (entry.revokedAt !== null) {
        alreadyRevoked.push(credentialId);
        continue;
      }

      const key = entry.statusListDocId;
      if (!byList.has(key)) {
        byList.set(key, { listDocId: key, entries: [] });
      }
      byList.get(key)!.entries.push({
        credentialId,
        index: entry.statusIndex,
        docRef: doc.ref,
      });
    }

    // 3. Process each status list in a transaction
    for (const [, group] of byList) {
      await this.db.runTransaction(async (tx) => {
        const listDoc = await tx.get(
          this.db.collection(STATUS_LISTS).doc(group.listDocId),
        );

        if (!listDoc.exists) return;

        const listState = listDoc.data() as StatusListState;
        const bitstring = new Uint8Array(
          (listState.bitstring as any as Buffer).buffer,
        );

        // Set all bits
        for (const entry of group.entries) {
          setBit(bitstring, entry.index);
        }

        // Update list
        tx.update(listDoc.ref, {
          bitstring: Buffer.from(bitstring),
          revokedCount: FieldValue.increment(group.entries.length),
          lastModifiedAt: FieldValue.serverTimestamp(),
          dirty: true,
        });

        // Update each index entry
        for (const entry of group.entries) {
          tx.update(entry.docRef, {
            revokedAt: FieldValue.serverTimestamp(),
            revocationReason: reason,
          });
          revoked.push(entry.credentialId);
        }
      });
    }

    // 4. Write batch audit event
    if (revoked.length > 0) {
      await this.db.collection(REVOCATION_EVENTS).add({
        eventType: 'revoke',
        credentialIds: revoked,
        reason,
        triggeredBy,
        transactionDid: transactionDid ?? null,
        timestamp: FieldValue.serverTimestamp(),
        batchId,
      });
    }

    return { revoked, alreadyRevoked, notFound };
  }

  /**
   * Suspend a credential (reversible).
   * Only works on suspension status lists.
   */
  async suspend(credentialId: string, reason: string, triggeredBy: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      // Find the suspension index entry (not revocation)
      const indexSnap = await tx.get(
        this.db.collection(STATUS_INDEX)
          .where('credentialId', '==', credentialId)
          .where('purpose', '==', 'suspension')
          .limit(1),
      );

      // Fallback: check if there's a single entry with suspension purpose
      // (dual-purpose credentials have separate entries)
      // ... similar to revoke() but targeting suspension list
      // Omitted for brevity — follows same pattern as revoke()
    });
  }

  /**
   * Reinstate a suspended credential (clear the suspension bit).
   * Only valid for suspension lists. Revocation is permanent.
   */
  async reinstate(credentialId: string, triggeredBy: string): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const indexDoc = await tx.get(
        this.db.collection(STATUS_INDEX).doc(`${credentialId}:suspension`),
      );

      if (!indexDoc.exists) {
        throw new Error(`No suspension entry for credential ${credentialId}`);
      }

      const entry = indexDoc.data() as StatusIndexEntry;

      if (entry.suspendedAt === null) {
        return; // Not suspended — nothing to do
      }

      const listDoc = await tx.get(
        this.db.collection(STATUS_LISTS).doc(entry.statusListDocId),
      );

      if (!listDoc.exists) {
        throw new Error(`Status list ${entry.statusListDocId} not found`);
      }

      const listState = listDoc.data() as StatusListState;
      const bitstring = new Uint8Array(
        (listState.bitstring as any as Buffer).buffer,
      );

      // Clear the bit (reinstate)
      clearBit(bitstring, entry.statusIndex);

      tx.update(listDoc.ref, {
        bitstring: Buffer.from(bitstring),
        revokedCount: FieldValue.increment(-1),
        lastModifiedAt: FieldValue.serverTimestamp(),
        dirty: true,
      });

      tx.update(indexDoc.ref, {
        suspendedAt: null,
      });

      tx.create(this.db.collection(REVOCATION_EVENTS).doc(), {
        eventType: 'reinstate',
        credentialIds: [credentialId],
        reason: 'suspension_lifted',
        triggeredBy,
        transactionDid: null,
        timestamp: FieldValue.serverTimestamp(),
        batchId: null,
      });
    });
  }
}
```

### 4.6 Publisher (Firestore Trigger → GCS)

```typescript
// src/publisher.ts

import { Storage } from '@google-cloud/storage';
import { VcSigner } from '@pdtf/key-manager';
import { encodeBitstring } from './bitstring.js';
import type { StatusListState, StatusListConfig } from './types.js';

export class StatusListPublisher {
  private storage: Storage;

  constructor(
    private signer: VcSigner,
    private config: StatusListConfig,
  ) {
    this.storage = new Storage();
  }

  /**
   * Publish a status list to GCS as a signed Verifiable Credential.
   *
   * Called by the Firestore onWrite trigger when dirty=true.
   *
   * Flow:
   * 1. Encode the bitstring (gzip + base64)
   * 2. Construct the status list VC
   * 3. Sign with the issuer's key (via @pdtf/key-manager)
   * 4. Upload to GCS
   * 5. Invalidate CDN cache
   * 6. Update Firestore: dirty=false, publishedVersion++, lastPublishedAt
   */
  async publish(listState: StatusListState): Promise<{ gcsPath: string }> {
    const { issuerDid, purpose, listId, bitstring } = listState;

    // 1. Encode bitstring
    const encodedList = encodeBitstring(bitstring);

    // 2. Construct status list URL
    const baseUrl = this.resolveBaseUrl(issuerDid);
    const adapterPath = this.resolveAdapterPath(issuerDid);
    const statusListUrl = `${baseUrl}/${adapterPath}/${listId}`;

    // 3. Build unsigned status list VC
    const unsignedVc = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: statusListUrl,
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: issuerDid,
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: `${statusListUrl}#list`,
        type: 'BitstringStatusList',
        statusPurpose: purpose,
        encodedList,
      },
    };

    // 4. Sign with issuer's key
    const signedVc = await this.signer.sign(unsignedVc, {
      keyCategory: this.resolveKeyCategory(issuerDid),
      entityId: this.resolveEntityId(issuerDid),
    });

    // 5. Upload to GCS
    const gcsPath = `${adapterPath}/${listId}`;
    const bucket = this.storage.bucket(this.config.gcsBucket);
    const file = bucket.file(gcsPath);

    await file.save(JSON.stringify(signedVc, null, 2), {
      contentType: 'application/vc+ld+json',
      metadata: {
        cacheControl: `public, max-age=${this.config.cacheTtlSeconds}`,
      },
    });

    // 6. Invalidate CDN cache for this URL
    await this.invalidateCdnCache(gcsPath);

    return { gcsPath };
  }

  /** Invalidate CDN cache for a specific status list URL */
  private async invalidateCdnCache(path: string): Promise<void> {
    // Cloud CDN cache invalidation via the Compute Engine API
    // In practice, this is a gcloud command or API call:
    //   gcloud compute url-maps invalidate-cdn-cache <url-map> --path="/status/{path}"
    //
    // For launch, we rely on short TTLs (5 min) rather than explicit invalidation.
    // Explicit invalidation is a nice-to-have for time-sensitive revocations.
    //
    // TODO: Implement via @google-cloud/compute when needed
  }

  private resolveBaseUrl(issuerDid: string): string {
    if (issuerDid.startsWith('did:web:adapters.propdata.org.uk')) {
      return this.config.adapterBaseUrl;
    }
    return this.config.platformBaseUrl;
  }

  private resolveAdapterPath(issuerDid: string): string {
    const parts = issuerDid.split(':');
    if (parts.length > 3 && parts[2] === 'adapters.propdata.org.uk') {
      return parts.slice(3).join('/');
    }
    return 'platform';
  }

  private resolveKeyCategory(issuerDid: string): 'adapter' | 'platform' {
    if (issuerDid.startsWith('did:web:adapters.propdata.org.uk')) {
      return 'adapter';
    }
    return 'platform';
  }

  private resolveEntityId(issuerDid: string): string | undefined {
    const parts = issuerDid.split(':');
    if (parts.length > 3 && parts[2] === 'adapters.propdata.org.uk') {
      return parts[3]; // e.g. "epc", "hmlr"
    }
    return undefined;
  }
}
```

### 4.7 Status Checker (for Verifiers)

```typescript
// src/checker.ts

import { decodeBitstring, getBit } from './bitstring.js';
import { VcVerifier } from '@pdtf/key-manager';
import type { StatusCheckResult } from './types.js';

interface CacheEntry {
  vc: Record<string, unknown>;
  bitstring: Uint8Array;
  fetchedAt: number;
}

/**
 * Status checker for verifiers.
 *
 * This is a standalone module that does NOT require Firestore access.
 * It fetches status list VCs over HTTPS, verifies their signatures,
 * and checks individual bits. Suitable for use by any party.
 */
export class StatusChecker {
  private cache = new Map<string, CacheEntry>();
  private verifier: VcVerifier;

  constructor(
    private options: {
      /** Cache TTL in milliseconds (default: 300_000 = 5 min) */
      cacheTtlMs?: number;
      /** Fetch timeout in milliseconds (default: 5_000) */
      fetchTimeoutMs?: number;
      /** Fail closed on fetch failure? (default: true) */
      failClosed?: boolean;
    } = {},
  ) {
    this.verifier = new VcVerifier();
  }

  /**
   * Check the revocation/suspension status of a credential.
   *
   * @param credentialStatus The credentialStatus field from the VC
   * @param issuerDid The credential's issuer DID (for signature verification)
   * @returns Status check result
   */
  async check(
    credentialStatus: {
      id: string;
      type: string;
      statusPurpose: string;
      statusListIndex: string;
      statusListCredential: string;
    },
    issuerDid: string,
  ): Promise<StatusCheckResult> {
    const cacheTtlMs = this.options.cacheTtlMs ?? 300_000;
    const fetchTimeoutMs = this.options.fetchTimeoutMs ?? 5_000;
    const failClosed = this.options.failClosed ?? true;

    if (credentialStatus.type !== 'BitstringStatusListEntry') {
      throw new Error(`Unsupported status type: ${credentialStatus.type}`);
    }

    const listUrl = credentialStatus.statusListCredential;
    const index = parseInt(credentialStatus.statusListIndex, 10);

    // 1. Check cache
    let entry = this.cache.get(listUrl);
    if (entry && (Date.now() - entry.fetchedAt) < cacheTtlMs) {
      return this.checkBit(entry.bitstring, index, credentialStatus.statusPurpose);
    }

    // 2. Fetch status list VC
    let statusListVc: Record<string, unknown>;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

      const response = await fetch(listUrl, {
        headers: { Accept: 'application/vc+ld+json, application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      statusListVc = await response.json() as Record<string, unknown>;
    } catch (err) {
      if (failClosed) {
        return {
          status: 'revoked', // Fail closed = treat as revoked
          checkedAt: new Date().toISOString(),
          purpose: credentialStatus.statusPurpose as any,
        };
      }
      // Fail open — use stale cache if available
      if (entry) {
        return this.checkBit(entry.bitstring, index, credentialStatus.statusPurpose);
      }
      throw new Error(`Status list unavailable and no cache: ${(err as Error).message}`);
    }

    // 3. Verify status list VC signature
    const verifyResult = await this.verifier.verify(statusListVc, {
      skipTirCheck: true,
      skipRevocationCheck: true, // Don't recursively check status of the status list!
    });

    if (!verifyResult.valid) {
      throw new Error(`Status list signature invalid: ${verifyResult.error}`);
    }

    // 4. Verify issuer match
    if (statusListVc.issuer !== issuerDid) {
      throw new Error(
        `Status list issuer mismatch: expected ${issuerDid}, got ${statusListVc.issuer}`,
      );
    }

    // 5. Decode bitstring
    const subject = statusListVc.credentialSubject as Record<string, unknown>;
    const bitstring = decodeBitstring(subject.encodedList as string);

    // 6. Cache
    this.cache.set(listUrl, {
      vc: statusListVc,
      bitstring,
      fetchedAt: Date.now(),
    });

    // 7. Check bit
    return this.checkBit(bitstring, index, credentialStatus.statusPurpose);
  }

  /**
   * Check multiple credentials' status in bulk.
   * Deduplicates status list fetches for efficiency.
   */
  async checkBulk(
    credentials: Array<{
      credentialId: string;
      credentialStatus: {
        type: string;
        statusPurpose: string;
        statusListIndex: string;
        statusListCredential: string;
      };
      issuerDid: string;
    }>,
  ): Promise<Map<string, StatusCheckResult>> {
    const results = new Map<string, StatusCheckResult>();

    // Group by status list URL to deduplicate fetches
    const byList = new Map<string, typeof credentials>();
    for (const cred of credentials) {
      const url = cred.credentialStatus.statusListCredential;
      if (!byList.has(url)) byList.set(url, []);
      byList.get(url)!.push(cred);
    }

    // Process each list (fetch once, check multiple bits)
    for (const [, group] of byList) {
      for (const cred of group) {
        const result = await this.check(cred.credentialStatus as any, cred.issuerDid);
        results.set(cred.credentialId, result);
      }
    }

    return results;
  }

  private checkBit(
    bitstring: Uint8Array,
    index: number,
    purpose: string,
  ): StatusCheckResult {
    const isSet = getBit(bitstring, index);

    return {
      status: isSet
        ? (purpose === 'suspension' ? 'suspended' : 'revoked')
        : 'active',
      checkedAt: new Date().toISOString(),
      ...(isSet ? { purpose: purpose as any, index } : {}),
    };
  }
}
```

---

## 5. Cloud Functions

### 5.1 Publish Trigger

A Firestore `onWrite` trigger watches the `statusLists` collection. When a document becomes dirty (a revocation has been applied), it triggers the publish pipeline.

```typescript
// functions/src/status-list-trigger.ts

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { StatusListPublisher } from '@pdtf/status-list';
import { VcSigner, KmsClient, KeyMetadataStore } from '@pdtf/key-manager';
import { statusListConfig } from './config.js';

const db = getFirestore();
const signer = new VcSigner(new KmsClient(), new KeyMetadataStore(db));
const publisher = new StatusListPublisher(signer, statusListConfig);

/**
 * Triggered when a statusLists document is updated.
 * If the document is dirty (bitstring changed), publish the updated
 * status list VC to GCS.
 */
export const publishStatusList = onDocumentUpdated(
  {
    document: 'statusLists/{docId}',
    region: 'europe-west2',
    // Retry on failure — revocation publishing must succeed
    retry: true,
  },
  async (event) => {
    const after = event.data?.after.data();
    const before = event.data?.before.data();

    if (!after || !after.dirty) {
      return; // Not dirty — nothing to publish
    }

    // Debounce: if multiple revocations happen in quick succession,
    // only the last trigger needs to publish.
    // Check if the document is still dirty (another trigger may have handled it).
    const currentDoc = await db
      .collection('statusLists')
      .doc(event.params.docId)
      .get();

    const current = currentDoc.data();
    if (!current || !current.dirty) {
      return; // Already published by another trigger invocation
    }

    const listState = current as any;
    listState.bitstring = new Uint8Array(current.bitstring.buffer || current.bitstring);

    try {
      // Publish to GCS
      const { gcsPath } = await publisher.publish(listState);

      // Mark as clean
      await db.collection('statusLists').doc(event.params.docId).update({
        dirty: false,
        lastPublishedAt: FieldValue.serverTimestamp(),
        publishedVersion: FieldValue.increment(1),
      });

      console.log(
        `Published status list: ${event.params.docId} → gs://${statusListConfig.gcsBucket}/${gcsPath}`,
      );
    } catch (err) {
      console.error(`Failed to publish status list ${event.params.docId}:`, err);
      // Retry will handle this — the document stays dirty
      throw err;
    }
  },
);
```

### 5.2 Status List Serving (Fallback)

Primary serving is via Cloud CDN → Cloud Storage (static files). This Cloud Function is a fallback for dynamic requests or when GCS hasn't been populated yet.

```typescript
// functions/src/status-list-serve.ts

import { onRequest } from 'firebase-functions/v2/https';
import { Storage } from '@google-cloud/storage';
import { statusListConfig } from './config.js';

const storage = new Storage();

/**
 * Fallback endpoint for status list serving.
 *
 * In production, Cloud CDN serves directly from GCS.
 * This function handles edge cases:
 * - Initial requests before first publish
 * - CDN cache misses that bypass GCS
 *
 * URL: /status/{adapter}/{listId}
 */
export const statusListServe = onRequest(
  {
    region: 'europe-west2',
    cors: true,
    invoker: 'public',
  },
  async (req, res) => {
    // Parse path: /status/{adapter}/{listId}
    const pathMatch = req.path.match(/^\/status\/([a-z-]+)\/(\d{5})$/);
    if (!pathMatch) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const adapter = pathMatch[1];
    const listId = pathMatch[2];
    const gcsPath = `${adapter}/${listId}`;

    try {
      const bucket = storage.bucket(statusListConfig.gcsBucket);
      const file = bucket.file(gcsPath);
      const [exists] = await file.exists();

      if (!exists) {
        res.status(404).json({ error: 'Status list not found' });
        return;
      }

      const [content] = await file.download();
      const vc = JSON.parse(content.toString());

      res
        .set('Content-Type', 'application/vc+ld+json')
        .set('Cache-Control', `public, max-age=${statusListConfig.cacheTtlSeconds}`)
        .set('Access-Control-Allow-Origin', '*')
        .json(vc);
    } catch (err) {
      console.error(`Status list serve error for ${gcsPath}:`, err);
      res.status(500).json({ error: 'Internal error' });
    }
  },
);
```

---

## 6. Cloud Storage & CDN

### 6.1 GCS Bucket Configuration

```hcl
# modules/pdtf-status-lists/storage.tf

resource "google_storage_bucket" "status_lists" {
  name          = "pdtf-status-lists-${var.environment}"
  location      = "EUROPE-WEST2"
  project       = "pdtf-platform-${var.environment}"
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true  # Keep history of status list updates
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 10  # Keep last 10 versions
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["Content-Type", "Cache-Control", "ETag"]
    max_age_seconds = 3600
  }

  labels = {
    service     = "pdtf-status-lists"
    environment = var.environment
  }
}

# Public read access (status lists are public by design)
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.status_lists.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Publisher service account: write access
resource "google_storage_bucket_iam_member" "publisher_write" {
  bucket = google_storage_bucket.status_lists.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:status-list-publisher@pdtf-platform-${var.environment}.iam.gserviceaccount.com"
}
```

### 6.2 Cloud CDN Configuration

```hcl
# modules/pdtf-status-lists/cdn.tf

# Backend bucket (GCS → CDN)
resource "google_compute_backend_bucket" "status_lists" {
  name        = "pdtf-status-lists-backend-${var.environment}"
  project     = "pdtf-platform-${var.environment}"
  bucket_name = google_storage_bucket.status_lists.name
  enable_cdn  = true

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 300    # 5 minutes
    max_ttl                      = 3600   # 1 hour max
    serve_while_stale            = 60     # Serve stale for 60s during revalidation
    signed_url_cache_max_age     = 0      # No signed URLs
    negative_caching             = true
    negative_caching_policy {
      code = 404
      ttl  = 60  # Cache 404s briefly (list not yet published)
    }
  }
}

# URL map: route /status/* to the backend bucket
resource "google_compute_url_map" "status_lists" {
  name            = "pdtf-status-lists-urlmap-${var.environment}"
  project         = "pdtf-platform-${var.environment}"
  default_service = google_compute_backend_bucket.status_lists.id

  host_rule {
    hosts        = [var.adapter_domain]  # adapters.propdata.org.uk
    path_matcher = "adapter-status"
  }

  path_matcher {
    name            = "adapter-status"
    default_service = google_compute_backend_bucket.status_lists.id

    path_rule {
      paths   = ["/status/*"]
      service = google_compute_backend_bucket.status_lists.id
    }
  }
}

# HTTPS proxy + managed SSL cert
resource "google_compute_managed_ssl_certificate" "status_lists" {
  name    = "pdtf-status-lists-cert-${var.environment}"
  project = "pdtf-platform-${var.environment}"

  managed {
    domains = [var.adapter_domain]
  }
}

resource "google_compute_target_https_proxy" "status_lists" {
  name             = "pdtf-status-lists-https-${var.environment}"
  project          = "pdtf-platform-${var.environment}"
  url_map          = google_compute_url_map.status_lists.id
  ssl_certificates = [google_compute_managed_ssl_certificate.status_lists.id]
}

resource "google_compute_global_forwarding_rule" "status_lists" {
  name       = "pdtf-status-lists-fwd-${var.environment}"
  project    = "pdtf-platform-${var.environment}"
  target     = google_compute_target_https_proxy.status_lists.id
  port_range = "443"
  ip_address = google_compute_global_address.status_lists.address
}

resource "google_compute_global_address" "status_lists" {
  name    = "pdtf-status-lists-ip-${var.environment}"
  project = "pdtf-platform-${var.environment}"
}
```

### 6.3 GCS Object Layout

```
gs://pdtf-status-lists-prod/
├── epc/
│   ├── 00001       # Status list VC (JSON)
│   ├── 00002
│   └── ...
├── hmlr/
│   ├── 00001
│   └── ...
├── ea-flood/
│   └── 00001
├── local-auth/
│   └── 00001
├── os/
│   └── 00001
└── platform/
    ├── ownership/
    │   └── 00001
    ├── representation/
    │   └── 00001
    └── consent/
        └── 00001
```

Each file is a complete signed status list VC (JSON). Content-Type: `application/vc+ld+json`.

---

## 7. Transaction Lifecycle Revocations

The most common revocation trigger is a transaction lifecycle event. This section defines the integration between the transaction engine and the revocation service.

### 7.1 Transaction Completion

When a property sale completes:

```typescript
// services/transaction/src/on-completion.ts

import { Revoker } from '@pdtf/status-list';

async function onTransactionCompleted(transactionDid: string): Promise<void> {
  const revoker = new Revoker(db);

  // 1. Find all credentials to revoke for this transaction
  const toRevoke = await findTransactionCredentials(transactionDid, [
    'OwnershipCredential',       // Seller's ownership → revoke (title transferred)
    'RepresentationCredential',  // All representations → revoke (transaction over)
    'DelegatedConsentCredential', // All consents → revoke (no longer needed)
  ]);

  // 2. Batch revoke
  const result = await revoker.revokeBatch({
    credentialIds: toRevoke.map(c => c.credentialId),
    reason: 'transaction_completed',
    triggeredBy: 'transaction-engine',
    transactionDid,
  });

  console.log(
    `Transaction ${transactionDid} completion: ` +
    `revoked ${result.revoked.length}, ` +
    `already revoked ${result.alreadyRevoked.length}`,
  );

  // 3. Issue new OwnershipCredential to buyer
  // (handled by credential service, not revocation)
}

async function findTransactionCredentials(
  transactionDid: string,
  types: string[],
): Promise<Array<{ credentialId: string }>> {
  const results: Array<{ credentialId: string }> = [];

  for (const type of types) {
    const snap = await db
      .collection('statusIndex')
      .where('transactionDid', '==', transactionDid)
      .where('credentialType', '==', type)
      .where('revokedAt', '==', null)
      .get();

    for (const doc of snap.docs) {
      results.push({ credentialId: doc.id });
    }
  }

  return results;
}
```

### 7.2 Mandate Withdrawal

When a seller withdraws a conveyancer's mandate:

```typescript
async function onMandateWithdrawn(
  sellerDid: string,
  conveyancerDid: string,
  transactionDid: string,
): Promise<void> {
  const revoker = new Revoker(db);

  // Find the specific representation credential
  const snap = await db
    .collection('statusIndex')
    .where('transactionDid', '==', transactionDid)
    .where('credentialType', '==', 'RepresentationCredential')
    .where('subjectDid', '==', conveyancerDid)
    .where('revokedAt', '==', null)
    .get();

  for (const doc of snap.docs) {
    await revoker.revoke({
      credentialId: doc.id,
      reason: 'mandate_withdrawn',
      triggeredBy: `user:${sellerDid}`,
      transactionDid,
    });
  }
}
```

### 7.3 Data Refresh (Adapter)

When an adapter detects updated source data:

```typescript
async function onDataRefreshed(
  adapterId: string,
  propertyUrn: string,
  oldCredentialId: string,
): Promise<void> {
  const revoker = new Revoker(db);

  // Revoke the old credential
  await revoker.revoke({
    credentialId: oldCredentialId,
    reason: 'data_superseded',
    triggeredBy: `adapter:${adapterId}`,
  });

  // New credential is issued separately by the adapter
  // (with a new status list index)
}
```

### 7.4 Account Termination

```typescript
async function onAccountTerminated(userId: string, userDid: string): Promise<void> {
  const revoker = new Revoker(db);

  // Find ALL active credentials for this user
  const snap = await db
    .collection('statusIndex')
    .where('subjectDid', '==', userDid)
    .where('revokedAt', '==', null)
    .get();

  if (snap.empty) return;

  await revoker.revokeBatch({
    credentialIds: snap.docs.map(d => d.id),
    reason: 'account_terminated',
    triggeredBy: `admin:account-management`,
  });
}
```

---

## 8. Monitoring & Alerting

### 8.1 Metrics

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Revocations per minute | Firestore trigger count | > 100/min (anomaly) |
| Publish latency (revocation → GCS upload) | Cloud Function duration | > 10s (P95) |
| Status list endpoint availability | Cloud Monitoring uptime check | < 99.9% over 5min |
| CDN cache hit ratio | Cloud CDN metrics | < 80% (indicates caching problem) |
| Dirty lists count | Custom metric (Firestore query) | > 0 for > 5min (publish pipeline stuck) |
| Status list fetch errors (verifiers) | Log-based metric | > 10/min from our verifier |

### 8.2 Alert Policies

```hcl
# modules/pdtf-status-lists/monitoring.tf

resource "google_monitoring_uptime_check_config" "status_list_availability" {
  display_name = "Status List Endpoint Availability"
  project      = "pdtf-platform-${var.environment}"

  http_check {
    path         = "/status/epc/00001"
    port         = 443
    use_ssl      = true
    validate_ssl = true

    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.adapter_domain
      project_id = "pdtf-platform-${var.environment}"
    }
  }

  period  = "60s"
  timeout = "10s"
}

resource "google_monitoring_alert_policy" "publish_pipeline_stuck" {
  display_name = "Status List Publish Pipeline Stuck"
  project      = "pdtf-platform-${var.environment}"
  combiner     = "OR"

  conditions {
    display_name = "Dirty lists for > 5 minutes"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_function"
        textPayload=~"Failed to publish status list"
        severity >= ERROR
      EOT
    }
  }

  notification_channels = var.alert_channels
}
```

### 8.3 Dashboard

Key dashboard panels:

1. **Revocation activity** — time series of revocations by type and reason
2. **Publish latency** — P50/P95/P99 of revocation → publish time
3. **CDN performance** — cache hit ratio, origin requests, bandwidth
4. **List utilisation** — index allocation rate per issuer, capacity remaining
5. **Error rate** — publish failures, fetch errors

---

## 9. Disaster Recovery

### 9.1 Data Hierarchy

| Data | Source of Truth | Backup | Recovery |
|------|----------------|--------|----------|
| Bitstring state | Firestore `statusLists` | Firestore point-in-time recovery | Restore from Firestore backup |
| Index mappings | Firestore `statusIndex` | Firestore PITR | Restore from backup |
| Published VCs | GCS bucket (versioned) | GCS object versioning | Restore previous version |
| CDN cache | Cloud CDN | N/A (ephemeral) | Auto-repopulates from GCS |

### 9.2 Failure Scenarios

**Firestore unavailable:**
- Revocations cannot be processed (writes fail)
- Published status lists in GCS remain available (reads work)
- CDN serves cached versions
- Impact: new revocations delayed, not lost (retried when Firestore recovers)

**GCS unavailable:**
- CDN serves cached versions (stale-if-error: 1 hour)
- Publish pipeline retries
- Impact: stale status lists for up to cache TTL + stale-if-error duration

**CDN unavailable:**
- Fallback Cloud Function serves directly from GCS
- Higher latency, no caching benefit
- Impact: increased latency, higher origin load

**KMS unavailable:**
- Cannot sign new status list VCs
- Published status lists in GCS remain valid
- Impact: new revocations are written to Firestore but not published until KMS recovers

### 9.3 Recovery Procedures

**Rebuild published status lists from Firestore:**

If GCS is corrupted or lost, all status list VCs can be regenerated:

```typescript
async function rebuildAllStatusLists(): Promise<void> {
  const publisher = new StatusListPublisher(signer, config);

  const snap = await db.collection('statusLists').get();

  for (const doc of snap.docs) {
    const state = doc.data() as StatusListState;
    state.bitstring = new Uint8Array(state.bitstring);

    await publisher.publish(state);

    await doc.ref.update({
      dirty: false,
      lastPublishedAt: FieldValue.serverTimestamp(),
      publishedVersion: FieldValue.increment(1),
    });
  }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// test/bitstring.test.ts
describe('Bitstring', () => {
  it('should create empty bitstring of correct size', () => {
    const bs = createBitstring(131_072);
    expect(bs.length).toBe(16_384); // 131072 / 8
    expect(countSetBits(bs)).toBe(0);
  });

  it('should set and get bits correctly', () => {
    const bs = createBitstring(131_072);
    setBit(bs, 0);
    setBit(bs, 67890);
    setBit(bs, 131071);

    expect(getBit(bs, 0)).toBe(true);
    expect(getBit(bs, 1)).toBe(false);
    expect(getBit(bs, 67890)).toBe(true);
    expect(getBit(bs, 131071)).toBe(true);
    expect(countSetBits(bs)).toBe(3);
  });

  it('should encode and decode round-trip', () => {
    const bs = createBitstring(131_072);
    setBit(bs, 42);
    setBit(bs, 99999);

    const encoded = encodeBitstring(bs);
    const decoded = decodeBitstring(encoded);

    expect(getBit(decoded, 42)).toBe(true);
    expect(getBit(decoded, 99999)).toBe(true);
    expect(getBit(decoded, 0)).toBe(false);
  });

  it('should compress efficiently when sparse', () => {
    const bs = createBitstring(131_072);
    setBit(bs, 0);
    const encoded = encodeBitstring(bs);
    // Sparse bitstring should compress well
    expect(encoded.length).toBeLessThan(200);
  });
});
```

### 10.2 Integration Tests

| Test | Validates |
|------|-----------|
| Allocate → revoke → check | Full lifecycle: index assigned, bit set, verifier sees revoked |
| Concurrent allocation | Two simultaneous allocations get different indices |
| Batch revoke across lists | Multiple credentials across lists revoked in one call |
| Publish trigger fires | Firestore write triggers Cloud Function, GCS updated |
| CDN serves correct content | Published VC reachable via CDN URL |
| Suspension + reinstate | Bit set then cleared, verifier sees active again |
| List overflow | List reaches capacity, new list created automatically |

### 10.3 End-to-End Tests (Staging)

Full stack against staging infrastructure:

1. Issue a credential (with status index allocation)
2. Verify the credential passes revocation check
3. Revoke the credential
4. Wait for publish (≤ 10s)
5. Verify the credential now fails revocation check via CDN URL
6. Verify the status list VC signature is valid

---

## 11. SLA Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Revocation propagation time | < 60 seconds | Time from revocation API call to CDN-served status list update |
| Status list endpoint availability | 99.9% | Uptime check, monthly |
| Status list fetch latency (CDN hit) | < 50ms | P95, Cloud CDN metrics |
| Status list fetch latency (CDN miss) | < 500ms | P95, GCS + CDN metrics |
| Index allocation latency | < 100ms | P95, Firestore transaction |
| Batch revocation throughput | 1,000 credentials / 10s | Firestore transaction batching |

---

## 12. Cost Model

### 12.1 Per-Environment Costs

| Item | Prod (Monthly) | Staging (Monthly) |
|------|---------------|-------------------|
| GCS storage (status lists) | ~$0.50 | ~$0.10 |
| GCS operations (reads) | ~$2.00 | ~$0.20 |
| Cloud CDN bandwidth | ~$5.00 | ~$0.50 |
| Cloud CDN cache fills | ~$1.00 | ~$0.10 |
| Firestore reads/writes | ~$3.00 | ~$0.30 |
| Cloud Functions (publish trigger) | ~$2.00 | ~$0.20 |
| KMS signing (status list VCs) | ~$0.50 | ~$0.05 |
| Cloud Monitoring | ~$1.00 | ~$0.10 |
| **Total** | **~$15/month** | **~$2/month** |

Status list infrastructure is cheap. The CDN cost is the largest component and scales with verifier traffic, not with our issuance rate.

### 12.2 Scaling

At 10x scale (10,000 users, 100K credentials):
- More status list documents in Firestore: +$5/month
- More CDN bandwidth: +$20/month
- More KMS signing for publishes: +$2/month
- **Total at scale: ~$45/month**

---

## 13. Open Questions

| # | Question | Status |
|---|----------|--------|
| RQ1 | Should we use Cloud Tasks for the publish pipeline instead of Firestore triggers? Cloud Tasks give better retry control and dead-letter queues. | Leaning Firestore triggers for simplicity; Cloud Tasks if we need DLQ |
| RQ2 | Do we need explicit CDN cache invalidation on revocation, or is 5-minute TTL sufficient? | 5-minute TTL for launch; explicit invalidation for ownership/representation later |
| RQ3 | Should the StatusChecker be a separate npm package from the issuer-side code? Verifiers don't need Firestore deps. | Yes — split into `@pdtf/status-list` (issuer) and `@pdtf/status-checker` (verifier) |
| RQ4 | How do we handle status list serving during the initial period before any lists exist? 404 with appropriate messaging? | 404 with `Retry-After` header |
| RQ5 | Should we pre-create status lists for all adapters at infrastructure provisioning time? | Yes — avoids cold-start on first credential issuance |

---

## Appendix A: Decision Log

| ID | Decision | Rationale |
|----|----------|-----------|
| R1 | Firestore for state, GCS for serving | Atomic writes + CDN-friendly static files |
| R2 | Firestore trigger for publish pipeline | Decoupled, automatic, retryable |
| R3 | Cloud CDN with 5-min TTL | Read-heavy workload, acceptable revocation delay |
| R4 | GCS object versioning | Audit trail for status list updates |
| R5 | Atomic Firestore transactions for index allocation | Prevents index collisions |
| R6 | Batch revocation groups by list | Minimises re-signing operations |
| R7 | Separate status checker package for verifiers | No Firestore/GCP dependency for external verifiers |

---

*This document is part of the PDTF 2.0 implementation specification suite. For the protocol-level spec, see [Sub-spec 14 — Credential Revocation](../14-credential-revocation.md).*
