---
title: Retrieve Credentials
description: How data consumers and AI agents request and retrieve property credentials via API or MCP.
---

Once a property transaction is underway, the resulting Verifiable Credentials (VCs) do not live in a central database. They reside in the digital wallets or encrypted data hubs of the participating parties (like a conveyancer's CMS or a data hub like LMS).

To access this data, consumers must know:
1. **Where to ask** (Discovered via the Transaction's DID Document)
2. **How to authenticate** (Using standard capability tokens like `DelegatedConsent`)
3. **What protocol to use** (OID4VP for systems, MCP for agents)

---

## 1. Discovering the Service Endpoint

Every property transaction has a Decentralised Identifier (e.g., `did:web:platform.example.com:transactions:abc123`). 

Before requesting credentials, you must resolve this DID to find the correct data hub.

### The Request
```typescript
import { DidResolver } from '@pdtf/core';

const resolver = new DidResolver();
const didDocument = await resolver.resolve('did:web:platform.example.com:transactions:abc123');
```

### The Response
The DID document contains a `service` array declaring where requests should be sent:

```json
{
  "id": "did:web:platform.example.com:transactions:abc123",
  "service": [
    {
      "id": "#oid4vp",
      "type": "OID4VP",
      "serviceEndpoint": "https://platform.example.com/api/v1/transactions/abc123/present"
    },
    {
      "id": "#mcp",
      "type": "ModelContextProtocol",
      "serviceEndpoint": "wss://platform.example.com/mcp/v2/transactions/abc123"
    }
  ]
}
```

You now know the exact URLs for both system-to-system (OID4VP) and agentic (MCP) access.

---

## 2. API Access (OID4VP)

Traditional data consumers (like a lender's automated underwriting system) use the OpenID for Verifiable Presentations (OID4VP) protocol.

In PDTF 2.0, authorisation is based entirely on the entity graph. You cannot access a transaction unless you hold a capability token (such as a `DelegatedConsent` or `Representation` credential) that proves you have the right to see it.

### The Request
You send a POST request to the discovered OID4VP endpoint. The payload contains a W3C Presentation Exchange definition detailing what you need, along with the Verifiable Presentation proving your right to access it.

```bash
curl -X POST https://platform.example.com/api/v1/transactions/abc123/present \
  -H "Content-Type: application/json" \
  -d '{
    "presentation_definition": {
      "id": "lender_request_1",
      "input_descriptors": [
        {
          "id": "property_data",
          "constraints": {
            "fields": [
              { "path": ["$.type"], "filter": { "contains": "PropertyCredential" } },
              { "path": ["$.type"], "filter": { "contains": "TitleCredential" } }
            ]
          }
        }
      ]
    },
    "vp_token": {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      "type": ["VerifiablePresentation"],
      "verifiableCredential": [
        // Your DelegatedConsent credential proving your right to access
        { ... DelegatedConsent VC ... }
      ],
      "proof": { ... Your signature over the request ... }
    }
  }'
```

### The Response
The platform validates your `DelegatedConsent`, traverses the transaction graph, and returns the requested credentials bundled into a Verifiable Presentation.

```json
{
  "vp_token": {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    "type": ["VerifiablePresentation"],
    "verifiableCredential": [
      {
        "type": ["VerifiableCredential", "PropertyCredential"],
        "credentialSubject": { "id": "urn:pdtf:uprn:123", ... }
      },
      {
        "type": ["VerifiableCredential", "TitleCredential"],
        "credentialSubject": { "id": "urn:pdtf:titleNumber:ABC", ... }
      }
    ]
  }
}
```

---

## 3. Agentic Access (MCP)

AI Agents (like a conveyancer's copilot) access the exact same data using the Model Context Protocol (MCP). The authorisation logic is identical, but the transport and interface are designed for LLMs rather than traditional APIs.

### The Connection
The agent connects to the WebSocket endpoint discovered in the DID Document. During the MCP handshake, the agent authenticates by signing a challenge using the firm's `did:key` or `did:web` private key.

### The Request (Tool Call)
Once connected, the agent asks for the data using the `get_credentials` tool.

```json
{
  "jsonrpc": "2.0",
  "id": "req_1",
  "method": "tools/call",
  "params": {
    "name": "get_credentials",
    "arguments": {
      "id": "did:web:platform.example.com:transactions:abc123"
    }
  }
}
```

### The Validation
The MCP server intercepts this tool call. It knows the identity of the connected agent (e.g., `did:web:smithandco.law`). It traverses the transaction graph to see if `smithandco.law` holds a valid `Representation` credential for the seller. Because the graph proves the relationship, access is granted.

### The Response
The server returns the credentials directly into the LLM's context window.

```json
{
  "jsonrpc": "2.0",
  "id": "req_1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"type\": [\"PropertyCredential\"], \"credentialSubject\": {\"address\": \"10 Downing Street\"}}"
      }
    ]
  }
}
```

From there, the agent can use the `@pdtf/core` state assembly tools to resolve the raw credentials into a flat, readable v4 entity state or v3 JSON object to continue its reasoning.