# ccstatusboard landing page — design

Date: 2026-10-31. Branch: `feat/landing-page`.

## Intent

ccstatusboard has no web presence besides its README. We want a single-page marketing micro-site, hosted on GitHub Pages, that convinces Claude Code users to install the tool and doubles as install + usage documentation. It is built on the author's own **Kojima** Astro template (https://github.com/areimel/kojima-astro-template, demo https://kojima-astro-template.netlify.app/): high-tech, retro-future, spy-agency instrument-plate aesthetic in warm charcoal, ivory and safety orange.

### Goals
- A visitor understands in one screen what it is ("htop for all your Claude Code sessions") and sees it working.
- Copy-paste install in one click (`npx ccstatusboard`, `npm i -g`, or the curl standalone binary).
- Usage reference (flags, keys, themes, options) good enough that most people never need the README.
- Builds trust: local-only, read-only toward Claude Code, honest about estimates and undocumented internals.

### Non-goals
- Multi-page docs, blog/journal, pricing, auth, contact forms (all template pages dropped).
- Live data of any kind. The hero board is a scripted replica.
- Windows support messaging beyond "not supported".

### Anti-goals (failure even if it works)
- Looks like a generic SaaS template or a generic "AI-generated" dark page with one acid accent.
- Invented stats, testimonials, download counts or features not in README.md.
- Heavy JS: shipping React to the client, autoplaying decorative motion everywhere.
- Breaking the CLI's own tooling (root lint/typecheck/test) or the npm package contents.

## Decisions (made by the user)
- Location: `site/` folder of this repo, its own Astro project; deployed by a GitHub Actions Pages workflow.
- Template: trimmed to one page; keep Astro 5, Tailwind 4, Kojima tokens + theme toggle, DM Sans, `InstrumentGraphic`.
- Hero: animated HTML/CSS replica of the TUI (fake data).
- URL: `https://areimel.github.io/ccstatusboard` → Astro `site: 'https://areimel.github.io'`, `base: '/ccstatusboard'`.

## Visual system

- **Color:** Kojima semantic tokens as-is (`bg-background`, `text-foreground`, `border-border`, `--primary` safety orange, `--kojima-accent-ink` for orange text on ivory). `<html data-theme="kojima" class="dark">` default; toggle removes `dark` for the ivory palette; persisted in localStorage under `theme`, wrapped in try/catch.
- **TUI status colors** inside the replica mirror the app's default theme semantics: waiting `●` = warn (amber), busy `◐` = ok (green), idle `○` = dim, ended `·` = dim. Map these to site tokens (`--tui-ok`, `--tui-warn`, `--tui-danger`, `--tui-dim`, `--tui-accent`) defined for both palettes with AA contrast.
- **Type:** DM Sans (template's local files) for headlines and prose. JetBrains Mono (self-hosted woff2, OFL) only for real terminal content: the replica, commands, flags, keycaps, config keys. Clear type scale; prose measure < 72ch.
- **Plate labels:** Kojima's "FIG. 01 / PLATE" captions are the signature device. Use them as genuine section indices that match the nav order (FIG. 01 board, 02 field of view, 03 instruments, 04 safety, 05 install, 06 usage), not as eyebrows over every heading. Only the install steps get 1-2-3 numbering (real sequence).
- **The one bold thing:** the hero board. Everything else is quiet: hairline borders, generous spacing, no gradients, no per-section fade-ins, no hover animations on cards.
- **Motion:** one orchestrated moment — the board "powers on" panel by panel once on load (~1.5 s), then settles into a gentle live tick (clock each second, meters creep, a session flips busy→waiting→busy, subagent row appears/disappears, sparkline shifts). `prefers-reduced-motion: reduce` → static fully-rendered frame, no ticking. Pause ticking when the board is offscreen (IntersectionObserver) or tab hidden.
- **Copy:** sentence case, plain and specific, user's perspective. Headline: "Every Claude Code session. One board." Facts only from README.md. Buttons say what happens ("Copy install command", "View on GitHub"); copy buttons confirm with "Copied". No `→` glyphs on buttons.

## Page structure (single column, left-aligned, wide plates)

1. **Header:** wordmark `ccstatusboard`, anchor nav (Features, Install, Usage), GitHub link, theme toggle. Skip-to-content link.
2. **Hero:** headline, one-line pitch ("An htop-style terminal dashboard for all your Claude Code sessions: usage limits, estimated costs, and what every session is doing right now."), copy box with `npx ccstatusboard`, secondary "View on GitHub". Below: FIG. 01 plate containing the animated board (full content width; horizontally scrollable *inside* the plate on narrow screens, or scaled; the page itself never scrolls horizontally).
3. **Field of view (why):** ccstatusline shows a statusline inside one session; ccstatusboard runs in its own window and watches every session on the machine. A simple diagram: one session vs many sessions feeding one board.
4. **Instruments (features):** plates for Limits & resets, Burn-rate projection (UNDER / NEAR LIMIT / OVER / CRITICAL bands), Estimated cost (block/today/week/month, plan ratio), Sessions grouped by project + subagent tree, System meters, Detail pane. Each plate shows a tiny real-looking TUI excerpt; `InstrumentGraphic` may appear sparingly as texture (SSR only).
5. **Safety:** read-only toward Claude Code, never writes in `~/.claude`, never opens `*.key`, never refreshes tokens, only two hosts contacted, `--no-usage-api` opt-out; costs are estimates; relies on undocumented internals (verified on Claude Code 2.1.x).
6. **Install:** step 1 choose method (tabs: npm Node 22+ | standalone binary), step 2 run, step 3 (optional) set theme/options. Platforms list (Linux x64, macOS arm64/x64; Linux arm64 → npm; Windows unsupported). Env vars table (`CCSTATUSBOARD_VERSION`, `CCSTATUSBOARD_INSTALL_DIR`). Update/uninstall in `<details>`. Tabs are accessible (roles, arrow keys) and without JS both panels are visible.
7. **Usage:** flags table, keycap grid for keys, theme name list, Options menu summary + config path.
8. **Closing CTA:** "Open a terminal and run it." + copy box.
9. **Footer:** MIT license, GitHub, Issues, Releases, author.

## Architecture

- `site/` standalone Astro 5 + Tailwind 4 (`@tailwindcss/vite`), own `package.json` + `package-lock.json`, Node 22.
- `@astrojs/react` only to server-render `InstrumentGraphic`; never use a `client:*` directive. Interactivity = small vanilla TS `<script>` modules (board animation, copy buttons, theme toggle, tabs).
- Ported from the template: `styles/global.css`, `styles/kojima.css`, relevant parts of `kojima-home.css`, DM Sans fonts, `components/kojima/instrument-graphic.tsx`, theme toggle logic, favicon/OG pattern. Credit the template + upstream MIT notices.
- Content data in `site/src/content/*.ts`, transcribed from README.md (source of truth; header comment notes drift risk).
- Components in `site/src/components/`; page `site/src/pages/index.astro`; layout `site/src/layouts/Base.astro`. All internal URLs through `import.meta.env.BASE_URL`.
- `.github/workflows/pages.yml`: on push to `main` (paths `site/**`, the workflow) + `workflow_dispatch`; `actions/checkout`, `actions/setup-node` (22, npm cache on `site/package-lock.json`), `npm ci && npm run build` in `site/`, `actions/configure-pages`, `actions/upload-pages-artifact` (`site/dist`), `actions/deploy-pages`. Permissions `pages: write`, `id-token: write`, `contents: read`; concurrency group `pages`.
- Root isolation: `site/**` in `eslint.config.js` ignores, `site/` in `.prettierignore`.

## Quality floor
Responsive 320–1440 px with no page-level horizontal scroll; visible keyboard focus; axe: no serious/critical violations in both palettes; readable with JS disabled; reduced motion respected; Lighthouse-friendly (no client React, fonts preloaded, `font-display: swap`).

## Left to the builder
Exact spacing scale, plate border treatments, the precise fake data for the board, the field-of-view diagram's form, OG image composition.
