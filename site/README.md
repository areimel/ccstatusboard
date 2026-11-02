# ccstatusboard site

Site for ccstatusboard with three pages: home (marketing), docs, and contact. Standalone Astro 5 + Tailwind 4 project, isolated from the CLI (own `package.json`, excluded from root lint/prettier). Designs: `../docs/superpowers/specs/2026-10-31-landing-page-design.md` and `../docs/superpowers/specs/2026-11-02-site-pages-design.md`.

## Commands

Run inside `site/` (Node 22):

- `npm install`
- `npm run dev` - dev server at http://localhost:4321/ccstatusboard/
- `npm run build` - static output in `dist/`
- `npm run preview` - serve the build
- `npm run check` - `astro check`

Local preview of the production build: `npm run build && npm run preview` → http://localhost:4321/ccstatusboard/

## Deployment

GitHub Pages via `.github/workflows/pages.yml` (builds `site/`, publishes `site/dist`). Served from `https://areimel.github.io/ccstatusboard`, so use `import.meta.env.BASE_URL` for internal URLs.

One-time repo setting: Settings → Pages → Source: "GitHub Actions". Without it the deploy job fails.

## Contact form

The contact page posts to Web3Forms and needs an access key in `PUBLIC_WEB3FORMS_ACCESS_KEY`.

- Local development: copy `.env.example` to `.env` and set `PUBLIC_WEB3FORMS_ACCESS_KEY`.
- Production: builds read the GitHub repo variable of the same name. Set it once with `gh variable set PUBLIC_WEB3FORMS_ACCESS_KEY --body <key>`, or in the repo under Settings → Secrets and variables → Actions → Variables.
- The key is public by design and ends up in the page HTML.
- If the key is missing at build time, the contact page shows an email link instead of the form.

Contact details live in `src/content/contact.ts`.

## Credits

Derived from the author's Kojima Astro template (MIT + Commons Clause, upstream shadcnblocks.com). See `THIRD_PARTY_NOTICES.md`. Fonts: DM Sans and JetBrains Mono (OFL), self-hosted.
