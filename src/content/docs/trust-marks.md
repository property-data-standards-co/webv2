---
title: "Property Trust Marks"
description: "The authorisation badges that declare what each organisation can do in the PDTF ecosystem"
---

**Property Trust Marks** are signed tokens issued by the PDTF Trust Anchor (`propdata.org.uk`) that declare what an organisation is authorised to do within the federation. They are the PDTF-specific application of the [OpenID Federation trust mark](https://openid.net/specs/openid-federation-1_0.html#name-trust-marks) mechanism.

## What trust marks do

A trust mark is a digital badge. When the Trust Anchor issues a trust mark to an adapter, it's saying: *"We've reviewed this organisation, and they are authorised to issue these specific types of property credentials."*

Without trust marks, anyone could stand up an endpoint, sign credentials, and claim to be a title data provider. Trust marks make authorisation **verifiable** — a relying party can cryptographically confirm the badge was issued by the Trust Anchor and hasn't been revoked.

## Current Property Trust Marks

### `title-data-provider`

**URI:** `https://propdata.org.uk/trust-marks/title-data-provider`

Authorises the holder to issue **Title credentials** — register extracts, ownership records, title extents, and other land registry data.

Typical `authorised_paths`:
- `Title:/titleNumber`
- `Title:/titleExtents`
- `Title:/registerExtract/*`
- `Title:/ownership/*`

**Example holders:** HMLR (root issuer), Moverly HMLR Adapter (trusted proxy)

---

### `property-data-provider`

**URI:** `https://propdata.org.uk/trust-marks/property-data-provider`

Authorises the holder to issue **Property credentials** — EPCs, flood risk assessments, council tax data, local authority searches, and other property-level information.

Typical `authorised_paths` (varies per adapter):
- `Property:/energyEfficiency/*` (EPC data)
- `Property:/environmentalIssues/flooding/*` (flood risk)
- `Property:/councilTax/*` (council tax band)
- `Property:/localAuthoritySearch/*` (local searches)

**Example holders:** MHCLG EPC Register (root issuer), Environment Agency (root issuer), Moverly EPC Adapter (trusted proxy)

---

### `regulated-conveyancer`

**URI:** `https://propdata.org.uk/trust-marks/regulated-conveyancer`

Authorises the holder to act as a **conveyancer** in property transactions — issuing representation credentials, managing delegated consent, and acting on behalf of buyers or sellers.

This trust mark is only issued to organisations regulated by the **SRA** (Solicitors Regulation Authority) or **CLC** (Council of Licensed Conveyancers).

Typical `authorised_paths`:
- `Representation:/*`
- `DelegatedConsent:/*`

---

### `account-provider`

**URI:** `https://propdata.org.uk/trust-marks/account-provider`

Authorises the holder to issue **user and organisation DIDs** — the identifiers that tie real people and companies to their roles in transactions.

Account providers verify identity at onboarding and manage the link between a person's real-world identity and their cryptographic DID.

**Example holders:** Moverly (account provider)

## Trust mark structure

Each trust mark is a signed JWT containing:

```json
{
  "iss": "https://propdata.org.uk",
  "sub": "https://adapters.propdata.org.uk/epc",
  "id": "https://propdata.org.uk/trust-marks/property-data-provider",
  "iat": 1711929600,
  "exp": 1743465600,
  "trust_level": "trustedProxy",
  "proxy_for": "https://epc.communities.gov.uk",
  "authorised_paths": ["Property:/energyEfficiency/*"]
}
```

Key points:
- **`trust_level`** distinguishes root issuers from proxies — a root issuer has direct access to the canonical data; a trusted proxy fetches from a root issuer's API
- **`authorised_paths`** uses entity:path notation with wildcard support — this is what makes trust **granular**, not all-or-nothing
- **`proxy_for`** links a proxy back to the root issuer it draws data from

## How trust marks are verified

1. Extract the trust mark JWT from the entity's federation statement
2. Verify the JWT signature against the Trust Anchor's public key
3. Check `exp` hasn't passed (or query the [trust mark status endpoint](/web/docs/reference/federation-schema/#trust-mark-status-endpoint))
4. Confirm `authorised_paths` covers the credential paths being checked

```typescript
import { FederationRegistryResolver } from '@pdtf/core';

const resolver = new FederationRegistryResolver({
  trustAnchors: ['https://propdata.org.uk'],
});

const result = await resolver.verifyIssuer({
  issuerUrl: 'https://adapters.propdata.org.uk/epc',
  credentialPaths: ['Property:/energyEfficiency/*'],
});

// result.trusted === true
// result.trustMarkId === 'https://propdata.org.uk/trust-marks/property-data-provider'
// result.trustLevel === 'trustedProxy'
```

## Getting a trust mark

To receive a Property Trust Mark, an organisation must:

1. **Register as a federation entity** — publish an entity statement at `/.well-known/openid-federation`
2. **Apply to the Trust Anchor** — submit a request specifying which trust mark and which `authorised_paths`
3. **Pass review** — the Trust Anchor verifies the organisation's authority (e.g. regulatory status, API access agreements)
4. **Receive the signed trust mark** — the Trust Anchor issues a trust mark JWT and publishes a subordinate statement

The governance process for trust mark issuance is managed through the [property-data-standards-co](https://github.com/property-data-standards-co) GitHub organisation.
