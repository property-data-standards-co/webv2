// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://property-data-standards-co.github.io',
	base: '/web',
	integrations: [
		starlight({
			title: 'PDTF 2.0 — Property Data Trust Framework',
			customCss: ['./src/styles/custom.css'],
			head: [
				{
					tag: 'script',
					content: `
						document.addEventListener('DOMContentLoaded', () => {
							const banner = document.createElement('div');
							banner.className = 'candidate-banner';
							banner.innerHTML = '⚠️ Candidate Specification — This is a proposal published for industry review. It does not yet represent an adopted standard.';
							document.body.prepend(banner);
						});
					`,
				},
			],

			logo: {
				src: './public/logo.png',
				alt: 'PDTF Logo',
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
					label: 'Architecture',
					items: [
						{ label: 'Overview', slug: 'architecture/overview' },
						{ label: 'Entity Graph', slug: 'architecture/entities' },
						{ label: 'Credentials', slug: 'architecture/credentials' },
						{ label: 'Identifiers', slug: 'architecture/identifiers' },
						{ label: 'Trust', slug: 'architecture/trust' },
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
								{ label: 'Trusted Issuer Registry', slug: 'docs/concepts/tir' },
							],
						},
						{
							label: 'Guides',
							items: [
								{ label: 'Verify a Credential', slug: 'docs/guides/verify-credential' },
								{ label: 'Issue a Credential', slug: 'docs/guides/issue-credential' },
								{ label: 'Build an Adapter', slug: 'docs/guides/build-adapter' },
								{ label: 'Integrate with TIR', slug: 'docs/guides/integrate-tir' },
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
								{ label: 'TIR Schema', slug: 'docs/reference/tir-schema' },
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
								{ label: '04 — Trusted Issuer Registry', slug: 'specs/04-trusted-issuer-registry' },
								{ label: '06 — Key Management', slug: 'specs/06-key-management' },
								{ label: '07 — State Assembly', slug: 'specs/07-state-assembly' },
								{ label: '13 — Reference Implementations', slug: 'specs/13-reference-implementations' },
								{ label: '14 — Credential Revocation', slug: 'specs/14-credential-revocation' },
							],
						},

					],
				},
				{
					label: 'Registry',
					items: [
						{ label: 'Trusted Issuer Registry', slug: 'registry' },
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
