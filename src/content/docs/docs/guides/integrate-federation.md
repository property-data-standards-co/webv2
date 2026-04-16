---
title: "Verify Trust"
description: "How to verify an issuer's trust mark using OpenID Federation and @pdtf/core"
---

Every PDTF credential has a cryptographic signature, but a valid signature only proves the credential wasn't tampered with. To know whether the issuer is **authorised** for the data they're asserting, you need to verify their trust mark through OpenID Federation.

The `@pdtf/core` library handles trust chain resolution and trust mark verification through `FederationRegistryResolver`.

## 1. Create a resolver

```typescript
import { FederationRegistryResolver } from '@pdtf/core';

const resolver = new FederationRegistryResolver({
  trustAnchors: ['https://propdata.org.uk'],
  cacheTtlMs: 60 * 60 * 1000, // 1 hour
});
```

The resolver fetches entity statements from `.well-known/openid-federation` endpoints, builds trust chains, and caches the results. You only need one resolver instance per application.

### Configuration options

| Option | Default | Description |
|---|---|---|
| `trustAnchors` | required | Array of Trust Anchor URLs to recognise |
| `cacheTtlMs` | `3600000` | How long to cache resolved trust chains |
| `httpTimeoutMs` | `10000` | Timeout for fetching entity statements |
| `maxChainDepth` | `5` | Maximum trust chain length (prevents loops) |

## 2. Verify an issuer's trust mark

The primary operation is checking whether an issuer is authorised for specific credential paths:

```typescript
const result = await resolver.verifyIssuer({
  issuerUrl: 'https://adapters.propdata.org.uk/epc',
  credentialPaths: ['Property:/energyEfficiency/*'],
});

if (!result.trusted) {
  console.error('Uncovered paths:', result.uncoveredPaths);
  throw new Error(`Issuer not authorised: ${result.reason}`);
}

console.log(result.trustLevel);      // 'trustedProxy'
console.log(result.trustMarkId);     // 'https://propdata.org.uk/trust-marks/property-data-provider'
console.log(result.chainLength);     // 2
```

### What `verifyIssuer` checks

1. Fetches the issuer's entity statement from `{issuerUrl}/.well-known/openid-federation`
2. Resolves the trust chain up to a recognised Trust Anchor
3. Validates every signature in the chain
4. Finds a trust mark matching the requested credential paths
5. Verifies the trust mark was issued by the Trust Anchor
6. Confirms the trust mark hasn't expired
7. Checks that `authorised_paths` in the trust mark cover all requested paths

## 3. Resolve a trust chain directly

For debugging or audit purposes, you can resolve the full trust chain:

```typescript
const chain = await resolver.resolveTrustChain(
  'https://adapters.propdata.org.uk/hmlr'
);

console.log(chain.anchor);        // 'https://propdata.org.uk'
console.log(chain.entities);      // [{url, statement, signedBy}, ...]
console.log(chain.trustMarks);    // trust marks held by the leaf entity

for (const entity of chain.entities) {
  console.log(`${entity.url} — signed by ${entity.signedBy}`);
}
```

## 4. List an entity's trust marks

```typescript
const marks = await resolver.getTrustMarks(
  'https://adapters.propdata.org.uk/hmlr'
);

for (const mark of marks) {
  console.log(mark.id);               // trust mark type URI
  console.log(mark.trustLevel);       // 'rootIssuer' | 'trustedProxy'
  console.log(mark.authorisedPaths);  // ['Title:/registerExtract/*', ...]
  console.log(mark.expiresAt);        // Date or null
}
```

## 5. Integrate with full credential verification

If you're using `VcValidator` (the normal path for verifier applications), federation verification is built in:

```typescript
import { DidResolver, FederationRegistryResolver, VcValidator } from '@pdtf/core';

const validator = new VcValidator();

const result = await validator.validate(credential, {
  didResolver: new DidResolver(),
  federationResolver: new FederationRegistryResolver({
    trustAnchors: ['https://propdata.org.uk'],
  }),
  credentialPaths: ['Property:/energyEfficiency/*'],
});

if (!result.valid) {
  console.error(result.errors);
}

// Trust information is included in the result
console.log(result.trust.trusted);
console.log(result.trust.trustLevel);
console.log(result.trust.trustMarkId);
```

Use direct `verifyIssuer` calls when you want federation checks outside of full credential validation — for example, pre-checking an adapter before accepting credentials from it.

## 6. Error handling

Federation resolution can fail for several reasons:

```typescript
try {
  const result = await resolver.verifyIssuer({
    issuerUrl: 'https://adapters.propdata.org.uk/epc',
    credentialPaths: ['Property:/energyEfficiency/*'],
  });
} catch (err) {
  if (err.code === 'CHAIN_RESOLUTION_FAILED') {
    // Could not build a trust chain to a recognised anchor
  } else if (err.code === 'ENTITY_STATEMENT_FETCH_FAILED') {
    // Could not reach the entity's .well-known endpoint
  } else if (err.code === 'SIGNATURE_INVALID') {
    // A statement in the chain has an invalid signature
  }
}
```

### Resilience recommendations

- Cache resolved trust chains (the resolver does this by default)
- Set reasonable timeouts — entity statement endpoints may be slow
- On transient failures, serve cached results for up to 24 hours
- Log all trust verification failures for audit

## 7. Migrating from TIR

If you're using the older `TirClient` API:

```typescript
// Old (TIR)
import { TirClient, verifyIssuer } from '@pdtf/core';
const tir = new TirClient({ registryUrl: '...' });
const result = await verifyIssuer({ issuerDid, credentialPaths, tirClient: tir });

// New (OpenID Federation)
import { FederationRegistryResolver } from '@pdtf/core';
const resolver = new FederationRegistryResolver({ trustAnchors: ['https://propdata.org.uk'] });
const result = await resolver.verifyIssuer({ issuerUrl, credentialPaths });
```

Key differences:
- Use `issuerUrl` (the entity's base URL) instead of `issuerDid`
- No need to specify a registry URL — discovery is automatic via `.well-known/openid-federation`
- Trust information comes from signed trust marks instead of a static JSON file
- The `TirClient` API remains available for backward compatibility but is deprecated
