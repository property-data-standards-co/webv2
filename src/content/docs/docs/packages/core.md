---
title: "@pdtf/core"
description: "The consolidated PDTF 2.0 library — signing, verification, DIDs, status lists, TIR client, and CLI."
---

# @pdtf/core

The consolidated PDTF 2.0 library. All functionality that was previously split across seven packages is now available from a single dependency.

```bash
npm install @pdtf/core
```

**Repository:** [property-data-standards-co/core](https://github.com/property-data-standards-co/core)

---

## Modules

### keys

Key generation, storage, and rotation for Ed25519 signing keys.

```ts
import { keys } from '@pdtf/core';

const keypair = await keys.generate('ed25519');
const jwk = keys.toJwk(keypair);
```

### signer

Create and verify `DataIntegrityProof` signatures using `eddsa-jcs-2022`.

```ts
import { signer } from '@pdtf/core';

const signed = await signer.sign(credential, keypair);
const result = await signer.verify(signed);
```

### validator

Validate W3C Verifiable Credentials against PDTF 2.0 schemas and proof chains.

```ts
import { validator } from '@pdtf/core';

const result = await validator.validate(credential);
// { valid: true, checks: [...] }
```

### did

DID resolution and document creation for `did:key`, `did:web`, and `urn:pdtf:*`.

```ts
import { did } from '@pdtf/core';

const doc = await did.resolve('did:web:example.com:transactions:abc123');
const keyDid = did.fromPublicKey(publicKey);
```

### status

Bitstring Status List v1.0 — create, publish, and check credential revocation status.

```ts
import { status } from '@pdtf/core';

const list = await status.create({ length: 131072 });
await status.revoke(list, credentialIndex);
const isRevoked = await status.check(credential);
```

### tir

Trusted Issuer Registry client — query authorised issuers and validate entity:path permissions.

```ts
import { tir } from '@pdtf/core';

const registry = await tir.load('https://github.com/property-data-standards-co/tir');
const authorised = await tir.isAuthorised(registry, issuerDid, entityPath);
```

---

## CLI

The package includes a CLI for common operations:

```bash
npx @pdtf/core keygen              # Generate a new Ed25519 keypair
npx @pdtf/core sign <file>         # Sign a credential
npx @pdtf/core verify <file>       # Verify a credential
npx @pdtf/core did resolve <did>   # Resolve a DID document
npx @pdtf/core status check <cred> # Check revocation status
npx @pdtf/core tir check <did> <path>  # Check TIR authorisation
```

---

## Migration from separate packages

| Old package | New import |
|---|---|
| `@pdtf/key-manager` | `import { keys } from '@pdtf/core'` |
| `@pdtf/vc-validator` | `import { validator } from '@pdtf/core'` |
| `@pdtf/did-resolver` | `import { did } from '@pdtf/core'` |
| `@pdtf/did-tools` | `import { did } from '@pdtf/core'` |
| `@pdtf/status-list` | `import { status } from '@pdtf/core'` |
| `@pdtf/tir-tools` | `import { tir } from '@pdtf/core'` |
| `@pdtf/cli` | `npx @pdtf/core <command>` |
