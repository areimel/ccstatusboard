# Microsite split: marketing home, docs page, contact page

## Context

The ccstatusboard site (`site/`, Astro 5, static, GitHub Pages under `/ccstatusboard`) is one long page. Alec finds it gets hard to read at the Safety and Usage sections, which read like a manual. The goal is to make the site easier to read and understand by splitting it up:

- **Home** has one job: a first-time visitor sees the board, trusts that it's safe, and installs it.
- **Docs** holds all the reference material on one page.
- **Contact** is about hiring Alec, the developer: freelance work, job offers and similar. It is not project support.

## Decided by Alec

- A separate docs page; home is geared to showcasing and marketing.
- Standalone contact page with a Web3Forms form. The key comes from an env var, and `site/.env.example` is added. Alec will provide the key.
- Contact page layout: 50/50 split, "Contact Info | Contact Form", stacking on mobile.
- Contact page purpose: reach Alec for freelance work, job offers, etc., with his contact info and links.
- Contact details, verbatim:
  - Alec Reimel
  - Available for work in PA & NJ - Greater Philadelphia Area
  - alecreimel1@gmail.com
  - https://alecreimel.com
  - https://bio.alecreimel.com
  - https://www.linkedin.com/in/alecwreimel/
  - GitHub: https://github.com/areimel (his original request listed GitHub; the profile URL comes from the repo owner)
- Page split as sketched and approved:
  - Home: hero with live board; one-board-vs-one-statusline comparison; six panels (one line each); safety promise plus 3 facts linking to docs; single install ending (npm | binary, copy command, link to docs).
  - Docs: one page with a sticky sidebar: Install, Usage, Panels, Privacy and safety.
  - Header nav: Docs, Contact, GitHub.

## Goals, non-goals, anti-goals

- Goals: home is short and leads to install; every fact currently on the site remains findable in docs; the form delivers mail to Alec on the live site.
- Non-goals: no multi-page docs, docs search, blog, CMS or backend. No changes to the CLI.
- Anti-goals: the contact form must not read as a support channel; bug reports point to GitHub Issues. Docs must not become a second copy of content that drifts from the README. A live form must never fail silently because of a missing key.

## Builder's calls (Claude's, for Alec to check)

### Routes and navigation

- `/ccstatusboard/docs/` (`src/pages/docs.astro`) and `/ccstatusboard/contact/` (`src/pages/contact.astro`). Each gets its own `<title>` and description through `Base.astro`.
- `Header.astro`: links become Docs, Contact, GitHub, built with `import.meta.env.BASE_URL`, with `aria-current="page"` on the current one. The wordmark links to the home page rather than `#top`, because `#top` breaks on other pages.
- `Footer.astro`: add Docs and Contact links.
- `Cta.astro`'s `#install` link now points at `docs/#install`.

### Home (`src/pages/index.astro`)

- Order: Hero, Why, Features, short Safety, install ending. FIG numbers renumber in page order: 01 board, 02 why, 03 instruments, 04 safety. Update the comment in `index.astro`.
- `FeaturePlate.astro`: add a `showDetails` prop (default `false`). Home shows title, summary, excerpt. Each plate links to `docs/#panel-<id>`.
- Features intro copy: the current "all read from your local Claude Code files" is wrong for usage limits, which come from Anthropic's API. Change it to say the panels come from local files and the usage API. Add one line carrying the caveat that would otherwise leave home: "Costs are estimates from API list prices. On a Pro/Max subscription you are not billed these amounts."
- Short safety: rewrite `SafetySection.astro` as the home version. Keep the headline "It reads your Claude Code data and changes none of it", then three facts:
  1. Never writes inside `~/.claude`.
  2. Your OAuth token is only sent to Anthropic's usage endpoint; `--no-usage-api` turns that off.
  3. Only two hosts are contacted: api.anthropic.com and raw.githubusercontent.com.
  Then a link: "Read the full privacy and safety details" to `docs/#privacy`.
- Install ending: extend `Cta.astro`. Keep "Open a terminal and run it." Show two labelled `CopyCommand`s, "With npm" (`npx ccstatusboard`, Node 22+) and "Standalone binary" (`CURL_INSTALL`, no Node needed), plus "All install options" to `docs/#install`. No tabs on home, so no script is needed.

### Docs (`src/pages/docs.astro`)

- Layout: two columns on wide screens with a sticky sidebar. On narrow screens the sidebar becomes a plain link list at the top, not sticky. Anchored sections clear the sticky header through the existing `scroll-padding-top` on `html`. The current sidebar link is marked with a small IntersectionObserver script; without JS the links still work.
- Sections and anchors, reusing what exists:
  - `#install`: move `InstallSection.astro` as is (tabs script included), dropping `SectionIndex`.
  - `#usage`: move `UsageSection.astro` as is, dropping `SectionIndex`, with `FlagTable` and `KeyGrid` unchanged.
  - `#panels`: `FEATURES` rendered with `FeaturePlate showDetails`, each with `id="panel-<id>"`, in one column.
  - `#privacy`: new `PrivacySection.astro` holding the current `SafetySection` content in full: all `SAFETY` items, the cost caveat, hosts, data sources table.
- FIG labels stay on home only. Docs uses plain headings.
- Content stays in `src/content/*.ts`, so it keeps matching the README ("Update both together").

### Contact (`src/pages/contact.astro`)

- Details go in a new `src/content/contact.ts`: name, availability, email, and a `LINKS` array of `{label, url}` (Website, Bio, LinkedIn, GitHub). Adding a microsite later means adding one array entry.
- `ContactForm.astro` holds the form and its script.
- Layout: two equal columns from 900px, stacked below that with Info first.
- Left column: H1 "Work with Alec Reimel", the availability line as given, a line saying he takes freelance work and job offers, email as `mailto:`, links list, and a small note: "Found a bug in ccstatusboard? Open a GitHub issue." linking to `ISSUES_URL`.
- Right column, in a `.plate`:
  - Fields, all required: Name, Email, "What's this about?" (select: Freelance project, Job offer, Something else), Message.
  - Hidden: `access_key`, `subject` ("ccstatusboard site: new contact"), `from_name` ("ccstatusboard site").
  - Honeypot `botcheck` checkbox, hidden.
  - Button: "Send message".
- Reused look: `.plate`, tokens, `--ring` focus outline. Inputs are square-cornered with `--input` borders, matching `CopyCommand`. Labels are visible, not placeholders.
- Memorable element: the info column's availability shown as a board row using the status glyph styling (`tui` classes), so the page still feels like this product. Everything else stays quiet.

### Form behaviour (Web3Forms docs checked 2026-11-02)

- POST JSON with fetch to `https://api.web3forms.com/submit`, headers `Content-Type` and `Accept: application/json`, body from `FormData`. Success is `response.status === 200`, as in their AJAX example. The docs define no other response schema, so do not depend on a `success` field.
- States:
  - Sending: button disabled, reads "Sending...".
  - Sent: form replaced by "Message sent. Alec will reply to the email you gave." in an `aria-live` region; focus moves to it.
  - Failed: fields kept, inline message "Your message wasn't sent. Try again, or email alecreimel1@gmail.com." showing the API's `message` if present. Network errors take the same path.
- No key at build time: render the email link instead of the form, with a `console.warn` during build. The email link is visible by default and the script swaps it for the form once submit is handled, so no-JS visitors or a failed script get the link. The form has no `method` or `action`, so it can never post natively.
- Spam: Web3Forms' server-side check plus the `botcheck` honeypot, no captcha. Their docs mark the honeypot deprecated, and free hCaptcha is available but adds a third-party script and a challenge. For a low-traffic page, start without it; adding it later is a small change. Domain restriction is a paid (Pro) feature, so it is not used. Free-plan limits could not be confirmed (web3forms.com returned 403).

### Env var and deployment

- Variable: `PUBLIC_WEB3FORMS_ACCESS_KEY`. The `PUBLIC_` prefix is what makes Astro expose it. Web3Forms states the key is meant to be public, and it ends up in the page HTML.
- `site/.env.example` with the variable, empty, and a comment on where to get it. `site/.env` with Alec's real key once provided. Add `.env` and `.env.*` with `!.env.example` to `site/.gitignore`; nothing currently ignores them.
- `src/env.d.ts`: type the variable on `ImportMetaEnv`.
- `.github/workflows/pages.yml`, "Build site" step: `env: PUBLIC_WEB3FORMS_ACCESS_KEY: ${{ vars.PUBLIC_WEB3FORMS_ACCESS_KEY }}`. A repo variable rather than a secret, since the value is public. Pages builds in CI, so a local `.env` never reaches the live site.
- Alec's one-time step: `gh variable set PUBLIC_WEB3FORMS_ACCESS_KEY --body <key>`, or do it in repo settings. Claude does not set it without being asked.
- Docs: update `site/README.md` ("Single-page landing site" is no longer true; add env setup), and the site line in root `CLAUDE.md`.

### Design system

No new palette or typefaces: Alec approved staying with the existing look so the pages read as one site.

- Color: existing `kojima.css` tokens only.
- Type: DM Sans for text, JetBrains Mono for commands and terminal content, with the current heading scale.
- Layout: `.page-wrap`, hairline `.plate` frames, left aligned. Line lengths under 80 characters, with existing `max-width` values.
- Principles: the live board stays the one loud thing on the site. Docs is plain and scannable. Contact is calm, with one product-flavoured touch. Don't add entrance animations or new `→` link suffixes or middot strings. Respect reduced motion and keep visible keyboard focus. Copy is sentence case, plain verbs.

### Git

Branch `feat/site-pages` from `main`. The current branch `brag-linkedin` is at the same commit as `main` and has an unrelated name. Leave the untracked `.vitest/` and `brag-output-2026-11-02-080204/` alone. Save this design to `docs/superpowers/specs/2026-11-02-site-pages-design.md`.

## Left to the builder

Exact spacing, sidebar width, wording of small notes, and how `FeaturePlate`'s links and anchors are marked up.

## Execution: parallel subagents (Alec's request, up to 12 Sonnet and/or Haiku)

All agents work in one checkout on `feat/site-pages`. Each owns only the files listed, so edits can't collide. Each gets this document and these shared names, so they can build before the others finish:

- `FeaturePlate` props: `showDetails?: boolean`, and `id="panel-<id>"` on its article when `showDetails` is true.
- Components: `PrivacySection.astro`, `ContactForm.astro` (no props; reads `import.meta.env.PUBLIC_WEB3FORMS_ACCESS_KEY` and `src/content/contact.ts`).
- `src/content/contact.ts` exports: `NAME`, `AVAILABILITY`, `EMAIL`, `LINKS`.

Claude first creates the branch and saves the spec. No commits unless Alec asks.

Build, in parallel:

| # | Model | Owns |
|---|---|---|
| 1 | Haiku | `site/.env.example`, `site/.gitignore`, `src/env.d.ts`, `.github/workflows/pages.yml` |
| 2 | Sonnet | `Header.astro`, `Footer.astro` |
| 3 | Sonnet | `FeaturePlate.astro`, `FeatureSection.astro`, `index.astro` |
| 4 | Sonnet | `SafetySection.astro` (short), new `PrivacySection.astro` |
| 5 | Sonnet | `Cta.astro` |
| 6 | Sonnet | new `docs.astro`, `InstallSection.astro`, `UsageSection.astro` |
| 7 | Sonnet | new `contact.astro`, `src/content/contact.ts` |
| 8 | Sonnet | new `ContactForm.astro` |
| 9 | Haiku | `site/README.md`, root `CLAUDE.md` site line |

Build agents using visual judgment follow the design system section above and the frontend-design guidance.

Then Claude runs `npm run check` and `npm run build` and fixes integration issues. Then, in parallel:

| # | Model | Job |
|---|---|---|
| 10 | Haiku | Content audit (verification step 3); reports only |
| 11 | Sonnet | Playwright checks at both widths and themes, with mocked form states (steps 2 and 4); reports with screenshots |
| 12 | Sonnet | Code review of the full diff; reports only |

Claude reviews screenshots itself, applies the fixes and re-verifies before reporting back.

## Verification

From `site/`:

1. `npm run check` and `npm run build` pass, with and without the env var. Without it, the built contact page shows the email link and no form; with it, `dist/contact/index.html` contains the key.
2. `npm run dev`, then in Playwright at 1440px and 375px check all three pages: no horizontal scroll, nav and `aria-current`, sidebar anchors clear the sticky header, `docs/#panel-*` links land, home install commands copy, docs tabs work, light and dark themes.
3. Content audit: every flag, key, safety item, data source, env var and feature detail from the old page appears in the built docs page.
4. Form: mock the endpoint in Playwright for the success, API failure and network failure states; check required-field validation, keyboard path and focus. One real send with Alec's key, only with his go-ahead, then he confirms it arrived.
5. After merge, Alec sets the repo variable before the deploy and confirms the live form appears.
