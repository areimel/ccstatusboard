# ccstatusboard site

Single-page landing site for ccstatusboard. Standalone Astro 5 + Tailwind 4 project, isolated from the CLI (own `package.json`, excluded from root lint/prettier). Design: `../docs/superpowers/specs/2026-10-31-landing-page-design.md`.

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

## Credits

Derived from the author's Kojima Astro template (MIT + Commons Clause, upstream shadcnblocks.com). See `THIRD_PARTY_NOTICES.md`. Fonts: DM Sans and JetBrains Mono (OFL), self-hosted.
