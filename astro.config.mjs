// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://property-data-standards-co.github.io',
	base: '/web',
	integrations: [
		starlight({
			title: 'PDTF2',
			customCss: ['./src/styles/custom.css'],
			components: {
				Banner: './src/components/Banner.astro',
			},

			logo: {
				src: './public/logo.png',
				alt: 'PDTF',
			},
			favicon: '/favicon.png',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/property-data-standards-co',
				},
			],
			sidebar: [
				{
					label: 'About',
					items: [
						{ label: 'The Problem', slug: 'about/problem' },
						{ label: 'The Solution', slug: 'about/solution' },
						{ label: 'Trust Model', slug: 'about/trust-model' },
						{ label: 'Roadmap', slug: 'about/roadmap' },
					],
				},
				{
					label: 'Consultation',
					items: [
						{ label: 'Industry Consultation', slug: 'consultation' },
					],
				},
				{
					label: 'Architecture',
					items: [
						{ label: 'Overview', slug: 'architecture/overview' },
						{ label: 'Entity Graph', slug: 'architecture/entities' },
						{ label: 'Credentials', slug: 'architecture/credentials' },
						{ label: 'Identifiers', slug: 'architecture/identifiers' },
						{ label: 'Trust', slug: 'architecture/trust' },
						{ label: 'Digital Identity', slug: 'architecture/digital-identity' },
						{ label: 'Auth & Exchange', slug: 'architecture/exchange' },
						{ label: 'Migration', slug: 'architecture/migration' },
					],
				},
				{
					label: 'Developer Docs',
					items: [
						{ label: 'Quickstart', slug: 'docs/quickstart' },
						{
							label: 'Concepts',
							items: [
								{ label: 'Credentials', slug: 'docs/concepts/credentials' },
								{ label: 'Entities', slug: 'docs/concepts/entities' },
								{ label: 'DIDs', slug: 'docs/concepts/dids' },
								{ label: 'Signing', slug: 'docs/concepts/signing' },
								{ label: 'Revocation', slug: 'docs/concepts/revocation' },
								{ label: 'OpenID Federation', slug: 'docs/concepts/openid-federation' },
								{ label: 'Credential Exchange', slug: 'docs/concepts/oid4vc' },
								{ label: 'AI Agents & MCP', slug: 'docs/concepts/agents' },
							],
						},
						{
							label: 'Guides',
							items: [
								{ label: 'Verify a Credential', slug: 'docs/guides/verify-credential' },
								{ label: 'Issue a Credential', slug: 'docs/guides/issue-credential' },
								{ label: 'Retrieve Credentials', slug: 'docs/guides/retrieve-credentials' },
								{ label: 'Build an Adapter', slug: 'docs/guides/build-adapter' },
								{ label: 'Verify Trust', slug: 'docs/guides/integrate-federation' },
								{ label: 'Check Revocation', slug: 'docs/guides/check-revocation' },
								{ label: 'Host a DID Document', slug: 'docs/guides/host-did-document' },
								{ label: 'Organisation Onboarding', slug: 'docs/guides/org-onboarding' },
								{ label: 'Key Management', slug: 'docs/guides/key-management' },
							],
						},
						{
							label: 'Reference',
							items: [
								{ label: 'Schemas', slug: 'docs/reference/schemas' },
								{ label: 'Credential Types', slug: 'docs/reference/credential-types' },
								{ label: 'DID Methods', slug: 'docs/reference/did-methods' },
								{ label: 'URN Scheme', slug: 'docs/reference/urn-scheme' },
								{ label: 'Federation Schema', slug: 'docs/reference/federation-schema' },
								{ label: 'Status Codes', slug: 'docs/reference/status-codes' },
							],
						},
						{
							label: 'Packages',
							items: [
								{ label: '@pdtf/core (TypeScript)', slug: 'docs/packages/core' },
								{ label: 'pdtf-core (Rust)', slug: 'docs/packages/core-rs' },
								{ label: 'pdtf-core (Python)', slug: 'docs/packages/python' },
								{ label: 'Pdtf.Core (.NET)', slug: 'docs/packages/dotnet' },
								{ label: 'Cross-Language Interop', slug: 'docs/packages/interop' },
							{ label: 'Validation Service', slug: 'docs/packages/validate' },
							],
						},
					],
				},
				{
					label: 'Specifications',
					items: [
						{
							label: 'Protocol Specs',
							items: [
								{ label: '00 — Architecture Overview', slug: 'specs/00-architecture-overview' },
								{ label: '01 — Entity Graph', slug: 'specs/01-entity-graph' },
								{ label: '02 — VC Data Model', slug: 'specs/02-vc-data-model' },
								{ label: '03 — DID Methods', slug: 'specs/03-did-methods' },
								{ label: '04 — OpenID Federation', slug: 'specs/04-openid-federation' },
								{ label: '06 — Key Management', slug: 'specs/06-key-management' },
								{ label: '07 — State Assembly', slug: 'specs/07-state-assembly' },
								{ label: '13 — Reference Implementations', slug: 'specs/13-reference-implementations' },
								{ label: '14 — Credential Revocation', slug: 'specs/14-credential-revocation' },
								{ label: '15 — Conformance Testing', slug: 'specs/15-conformance-testing' },
							],
						},

					],
				},
				{
					label: 'Registry',
					items: [
						{ label: 'Property Trust Marks', slug: 'trust-marks' },
					],
				},
				{
					label: 'Blog',
					items: [
						{ label: 'Why Verifiable Credentials', slug: 'blog/why-verifiable-credentials' },
						{ label: 'The Entity Graph', slug: 'blog/entity-graph-decomposition' },
					],
				},
				{
					label: 'Community',
					items: [
						{ label: 'Contribute', slug: 'community/contribute' },
						{ label: 'Governance', slug: 'community/governance' },
						{ label: 'GitHub', slug: 'community/github' },
					],
				},
			],
		}),
	],
});
