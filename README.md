# propdata.org.uk

The documentation site for **PDTF 2.0 — Property Data Trust Framework**, an open standard for verifiable property data in UK conveyancing.

Built with [Starlight](https://starlight.astro.build/) (Astro).

## Development

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Structure

- `src/content/docs/` — all content pages (Markdown/MDX)
  - `about/` — what PDTF is and why it matters
  - `architecture/` — technical architecture for decision-makers
  - `docs/` — developer documentation (quickstart, concepts, guides, reference, packages)
  - `specs/` — the formal PDTF 2.0 specification suite (9 sub-specifications)
  - `blog/` — technical blog posts
  - `community/` — contribution and governance information
- `public/` — static assets
  - `llms.txt` — LLM-friendly summary of the site content

## LLM content

- `public/llms.txt` — summary with links to each spec and documentation page
- `llms-full.txt` — generated at build time (build step to be added), concatenates all spec content into a single file for LLM consumption

## About

Developed by the **Property Data Standards Company**. The specifications, reference implementations, and tooling are published under an open licence.

- Website: [propdata.org.uk](https://propdata.org.uk)
- GitHub: [property-data-standards-co](https://github.com/property-data-standards-co)
