---
title: "Validation Service"
description: "Public credential validation service — verify VCs and receive signed Validation Receipts."
---

A stateless HTTP service that validates PDTF Verifiable Credentials and issues signed **Validation Receipts** as cryptographic proof of the result.

**DID:** `did:web:validate.propdata.org.uk`
**Repository:** [property-data-standards-co/validate](https://github.com/property-data-standards-co/validate)

---

## API

### Verify a Credential

```bash
curl -X POST https://validate.propdata.org.uk/v1/verify \
  -H "Content-Type: application/json" \
  -d @credential.json
```

**Request:** Send the VC directly, or wrap it:

```json
{
  "verifiableCredential": { ... },
  "credentialPaths": ["Property:/energyEfficiency/certificate"]
}
```

`credentialPaths` is optional — when provided, the TIR check verifies the issuer is authorised for those specific entity:path combinations.

**Response:**

```json
{
  "valid": true,
  "result": {
    "stages": {
      "structure": { "passed": true, "errors": [] },
      "signature": { "passed": true, "errors": [] },
      "tir": { "passed": true, "errors": [], "details": { "issuerSlug": "epc-adapter" } },
      "status": { "passed": true, "errors": [] }
    },
    "warnings": []
  },
  "receipt": { ... }
}
```

### Health Check

```bash
curl https://validate.propdata.org.uk/v1/health
```

### DID Document

```bash
curl https://validate.propdata.org.uk/.well-known/did.json
```

---

## Validation Pipeline

Every credential goes through four stages:

| Stage | What it checks | Can fail? |
|-------|---------------|-----------|
| **Structure** | W3C VC 2.0 envelope, required fields, context URIs, issuer binding | Yes |
| **Signature** | `DataIntegrityProof` verification (`eddsa-jcs-2022`), verificationMethod DID matches issuer | Yes |
| **TIR** | Issuer is registered in the Trusted Issuer Registry with authorised paths | Yes |
| **Status** | Credential not revoked/suspended via Bitstring Status List | Yes (or skipped if no status) |

All stages run regardless of earlier failures — the response always gives you the complete picture.

---

## Validation Receipts

Every response includes a **receipt**: a Verifiable Credential issued by the validation service itself.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://propdata.org.uk/credentials/v2"
  ],
  "type": ["VerifiableCredential", "ValidationReceipt"],
  "id": "urn:uuid:a1b2c3d4-...",
  "issuer": "did:web:validate.propdata.org.uk",
  "validFrom": "2026-04-03T06:30:00Z",
  "credentialSubject": {
    "id": "urn:uuid:original-credential-id",
    "validationResult": "valid",
    "checks": {
      "structure": { "status": "pass" },
      "signature": { "status": "pass" },
      "tir": { "status": "pass", "details": { "issuerSlug": "epc-adapter" } },
      "status": { "status": "pass" }
    },
    "evidence": {
      "serviceVersion": "0.1.0",
      "statusListFetched": "2026-04-03T06:30:01Z"
    }
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:web:validate.propdata.org.uk#validation-key",
    "proofPurpose": "assertionMethod",
    "proofValue": "z..."
  }
}
```

Receipts are verifiable through the same trust chain as any other PDTF credential — the validation service has its own entry in the TIR.

### Why receipts?

- **Cacheability** — verify once, store the receipt, show it to relying parties later
- **Auditability** — the evidence chain records exactly what was checked and when
- **Independence** — anyone can verify the receipt against the service's public key
- **Multiple validators** — different services can issue receipts for the same credential; consensus is possible

---

## Architecture

```
POST /v1/verify
     │
     ├─ 1. Structure check          (local)
     ├─ 2. Signature verification   (local crypto)
     ├─ 3. TIR authorisation check  (cached git fetch)
     ├─ 4. Status list check        (HTTP fetch)
     │
     └─ Sign receipt → respond
```

No database. No queues. No persistent state. The service caches TIR and DID document fetches in memory with configurable TTL.

---

## Self-Hosting

The service is designed for anyone to run:

```bash
git clone https://github.com/property-data-standards-co/validate
cd validate
npm install
cp .env.example .env
# Generate a signing key: npx @pdtf/core keygen
# Edit .env with your key and DID
npm run dev
```

Or deploy to any container platform:

```bash
docker build -t pdtf-validate .
docker run -p 8080:8080 \
  -e SERVICE_DID=did:web:your-domain.com \
  -e SIGNING_KEY_HEX=... \
  pdtf-validate
```

Multiple independent validators strengthen the trust model — compare receipts from different services to increase confidence.
