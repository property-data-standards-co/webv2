---
title: "Federation Schema"
description: "Reference for OpenID Federation entity statements and Property Trust Mark JWT formats used in PDTF"
---

This page documents the JWT formats for **entity statements** and **Property Trust Marks** as used in the PDTF federation. These follow the [OpenID Federation 1.0](https://openid.net/specs/openid-federation-1_0.html) specification with PDTF-specific trust mark definitions.

## Entity statement JWT

Every federation participant publishes a self-signed entity statement at `{entity_url}/.well-known/openid-federation`. The Trust Anchor also publishes **subordinate statements** for each entity it trusts.

### Header

```json
{
  "alg": "EdDSA",
  "kid": "key-1",
  "typ": "entity-statement+jwt"
}
```

### Payload (self-signed)

```json
{
  "iss": "https://adapters.propdata.org.uk/hmlr",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "iat": 1711929600,
  "exp": 1743465600,
  "jwks": {
    "keys": [
      {
        "kty": "OKP",
        "crv": "Ed25519",
        "kid": "key-1",
        "x": "base64url-encoded-public-key",
        "use": "sig"
      }
    ]
  },
  "authority_hints": [
    "https://propdata.org.uk"
  ],
  "metadata": {
    "federation_entity": {
      "organization_name": "Moverly HMLR Adapter",
      "homepage_uri": "https://moverly.com",
      "contacts": ["trust@moverly.com"]
    },
    "openid_credential_issuer": {
      "credential_endpoint": "https://adapters.propdata.org.uk/hmlr/credentials",
      "credential_configurations_supported": {}
    }
  },
  "trust_marks": [
    {
      "id": "https://propdata.org.uk/trust-marks/title-data-provider",
      "trust_mark": "eyJhbGciOiJFZERTQSIs..."
    }
  ]
}
```

### Payload fields

| Field | Type | Required | Description |
|---|---|---|---|
| `iss` | string | ✓ | Issuer — the entity itself (self-signed) or the superior (subordinate statement) |
| `sub` | string | ✓ | Subject — the entity being described |
| `iat` | number | ✓ | Issued-at timestamp (Unix seconds) |
| `exp` | number | ✓ | Expiration timestamp |
| `jwks` | object | ✓ | The entity's public keys (JWK Set) |
| `authority_hints` | string[] | ✓* | URLs of superior entities. Required for non-anchor entities |
| `metadata` | object | ✓ | Entity metadata (see below) |
| `trust_marks` | array | — | Trust marks held by this entity |
| `constraints` | object | — | Policy constraints on subordinates (anchor only) |

### Subordinate statement

The Trust Anchor publishes subordinate statements at `{anchor}/.well-known/openid-federation/fetch?sub={entity_url}`:

```json
{
  "iss": "https://propdata.org.uk",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "iat": 1711929600,
  "exp": 1743465600,
  "jwks": {
    "keys": [{ "..." : "..." }]
  },
  "metadata_policy": {
    "openid_credential_issuer": {
      "credential_endpoint": { "value": "https://adapters.propdata.org.uk/hmlr/credentials" }
    }
  }
}
```

The subordinate statement is signed by the **superior** (the Trust Anchor), not by the subject. This is what creates the trust chain.

## Metadata types

### `federation_entity`

General information about the organisation:

```json
{
  "organization_name": "Moverly HMLR Adapter",
  "homepage_uri": "https://moverly.com",
  "contacts": ["trust@moverly.com"],
  "logo_uri": "https://moverly.com/logo.png",
  "policy_uri": "https://moverly.com/trust-policy"
}
```

### `openid_credential_issuer`

Present when the entity issues credentials via [OID4VCI](/web/docs/concepts/oid4vc/):

```json
{
  "credential_endpoint": "https://adapters.propdata.org.uk/hmlr/credentials",
  "credential_configurations_supported": {
    "TitleCredential": {
      "format": "ldp_vc",
      "cryptographic_binding_methods_supported": ["did:key", "did:web"],
      "credential_definition": {
        "type": ["VerifiableCredential", "TitleCredential"]
      }
    }
  }
}
```

### `openid_relying_party`

Present when the entity is a verifier requesting credentials via OID4VP:

```json
{
  "redirect_uris": ["https://platform.example.com/callback"],
  "vp_formats": {
    "ldp_vp": {
      "proof_type": ["DataIntegrityProof"]
    }
  }
}
```

## Property Trust Mark JWT

Trust marks are signed JWTs issued by the Trust Anchor.

### Header

```json
{
  "alg": "EdDSA",
  "kid": "anchor-key-1",
  "typ": "trust-mark+jwt"
}
```

### Payload

```json
{
  "iss": "https://propdata.org.uk",
  "sub": "https://adapters.propdata.org.uk/hmlr",
  "id": "https://propdata.org.uk/trust-marks/title-data-provider",
  "iat": 1711929600,
  "exp": 1743465600,
  "trust_level": "trustedProxy",
  "proxy_for": "https://hmlr.gov.uk",
  "authorised_paths": [
    "Title:/titleNumber",
    "Title:/titleExtents",
    "Title:/registerExtract/*",
    "Title:/ownership/*"
  ],
  "ref": "https://propdata.org.uk/trust-marks/title-data-provider"
}
```

### Trust mark fields

| Field | Type | Required | Description |
|---|---|---|---|
| `iss` | string | ✓ | The Trust Anchor that issued this mark |
| `sub` | string | ✓ | The entity this mark is issued to |
| `id` | string | ✓ | Trust mark type URI |
| `iat` | number | ✓ | Issued-at timestamp |
| `exp` | number | — | Expiration (null = no expiry, check via status endpoint) |
| `trust_level` | string | ✓ | `rootIssuer`, `trustedProxy`, or `accountProvider` |
| `proxy_for` | string | — | Required for `trustedProxy` — the root issuer entity URL |
| `authorised_paths` | string[] | ✓ | Entity:path combinations this entity is authorised for |
| `ref` | string | — | Reference URI for the trust mark definition |

### Trust mark types

| ID | Slug | Purpose |
|---|---|---|
| `https://propdata.org.uk/trust-marks/title-data-provider` | `title-data-provider` | Issue Title credentials |
| `https://propdata.org.uk/trust-marks/property-data-provider` | `property-data-provider` | Issue Property credentials |
| `https://propdata.org.uk/trust-marks/regulated-conveyancer` | `regulated-conveyancer` | Act as conveyancer in transactions |
| `https://propdata.org.uk/trust-marks/account-provider` | `account-provider` | Issue user/organisation DIDs |

### Trust levels

| Level | Description |
|---|---|
| `rootIssuer` | Primary authoritative source (e.g. HMLR for title data) |
| `trustedProxy` | Authorised adapter fetching from a primary source API |
| `accountProvider` | Platform issuing user or organisation identifiers |

## Entity:path format

Authorised paths follow the pattern `Entity:/json/pointer/path` using JSON Pointer (RFC 6901):

| Pattern | Matches |
|---|---|
| `Title:/registerExtract/schedule` | Exactly that path |
| `Title:/registerExtract/*` | All paths under `/registerExtract` |
| `Property:/*` | All paths on the Property entity |

Wildcards (`*`) are only supported as the final path segment.

## Trust chain resolution

A verifier resolves trust by:

1. Fetch the leaf entity statement from `{entity}/.well-known/openid-federation`
2. For each entry in `authority_hints`, fetch the subordinate statement from `{superior}/.well-known/openid-federation/fetch?sub={entity}`
3. Verify the subordinate statement signature against the superior's keys
4. Repeat up the chain until reaching a recognised Trust Anchor
5. The chain is valid if every signature checks out and the anchor is trusted

### Trust chain validation rules

- Maximum chain depth: 5 (configurable)
- Every statement must be within its `iat`/`exp` window
- The leaf entity's `jwks` must match the keys in the subordinate statement
- Trust marks must be signed by a Trust Anchor in the resolved chain

## Trust mark status endpoint

The Trust Anchor operates a status endpoint for checking trust mark validity:

```
GET https://propdata.org.uk/.well-known/openid-federation/trust-mark-status
  ?sub=https://adapters.propdata.org.uk/hmlr
  &trust_mark_id=https://propdata.org.uk/trust-marks/title-data-provider
```

Response:

```json
{
  "active": true
}
```

This allows real-time revocation checking without waiting for trust mark expiry.
