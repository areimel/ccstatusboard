# ccstatusboard launch video (/brag-slim)

## Context
User wants a ~25s hacker/terminal-aesthetic launch video for ccstatusboard aimed at **non-technical vibe-coders** who don't realize they should watch 5h/weekly usage limits, context fill and cost. Content source: the landing microsite (`site/src/content/*.ts`, `site/src/styles/kojima*.css`, fonts in `site/src/assets/fonts/`). Visuals built in HyperFrames (`npx hyperframes@0.8.224`), using catalog items: `terminal-simulator`, `yt-lcd-background`, `yt-screen-warp`, `wireframe-portal-title`.

Decisions from Q&A:
- **No vhs** (not installed; skip it). "Real TUI" footage instead comes from rendering the real Ink `App` (`src/ui/App.tsx`) against fabricated `Snapshot`s → ANSI → HTML. Deterministic, no real user data.
- **~24s landscape** 1920×1080, 30fps.
- **Commit** sources + final outputs (brag.mp4/jpg, share-copy); gitignore `brag-output/work/`.

## Output layout
`brag-output/` (repo root): `brag-plan.md`, `brag.mp4`, `brag.jpg`, `share-copy.txt`, `composition/` (HyperFrames project), `tui-export/` (frame exporter), `audio/` (synth script + final mix), `work/` (gitignored: frames, downloads, stems, stills).

## Storyboard — 120 BPM (beat 0.5s, bar 2s), 24s = 12 bars, all cuts on bar lines
| # | Time | Scene | Content |
|---|---|---|---|
| 1 Hook | 0–4s | LCD background + terminal-simulator | Prompt types "build me an app…", Claude busily working, then red line: "Usage limit reached · resets in 4h 12m". Caption: "Vibe coding? You just hit a wall you couldn't see." |
| 2 Reveal | 4–8s | wireframe-portal-title | "ccstatusboard" through the portal; tagline (site copy): "Your usage limits, estimated costs, and what every session is doing right now." |
| 3 Limits | 8–12s | Real TUI render, zoom on Usage panel | 5h meter climbing, burn band flips to NEAR LIMIT. Caption: "See how much of your 5-hour and weekly limit is gone." |
| 4 Context | 12–16s | Pan to Sessions table, context column highlighted | Caption: "See how full each chat's memory is." (context-window fill) |
| 5 Cost | 16–19s→20s | Cost block + $/h sparkline | Caption: "See what it's costing (estimated)." |
| 6 Payoff | 20–22s | yt-screen-warp into full board | "Every Claude Code session. One screen." |
| 7 Outro | 22–24s | terminal-simulator types install cmd from `site/src/content/install.ts` | "ccstatusboard · free · read-only" + github.com/areimel/ccstatusboard |

Fake data: reuse sample projects from `site/src/scripts/tui-board.ts` (`GROUPS`: ccstatusboard, power-tools, api-gateway, dotfiles). No real names/paths/tokens. Colors: site `--kojima-orange #ff4d00`, TUI status tokens, phosphor-green/amber for the LCD; fonts JetBrains Mono + DM Sans from the site.

Sound: one generated track, 120 BPM, A minor, synthwave/chiptune; kick/bass/arp + soft glitch SFX on cuts, same key, mixed under music, sample-aligned to the beat grid from frame 0.

## Subagents & TODOs (run in waves)
**Wave 1 (parallel)**
- **H1 Haiku – HyperFrames research:** read the 4 catalog pages + CLI docs (init, `add`, preview, render, frame-capture); report install commands, props, and render flags.
- **H2 Haiku – brand extraction:** pull copy (TAGLINE, FEATURES summaries, install command), colors and font files from `site/` into `work/brand.json` + copy fonts.
- **S1 Sonnet – TUI exporter** (`brag-output/tui-export/`): run via `tsx`, render real `App` with fabricated Snapshot timeline (reuse `makeSession`-style shape from `test/helpers/snapshot.ts`, `renderSized` pattern from `test/helpers/renderSized.ts`, colors forced via `FORCE_COLOR=3`), 160×45 cols; convert ANSI→HTML spans; emit `tui-frames.json` (one frame per beat across scenes 3–6).
- **S2 Sonnet – audio** (`brag-output/audio/`): synth with whatever's on the machine (node/ffmpeg/sox/python), export `music.wav`; cue list in seconds.

**Wave 2 (parallel, after H1/H2/S1)**
- **S3 Sonnet – scenes 1–2** (LCD bg + terminal-simulator hook, portal title).
- **S4 Sonnet – scenes 3–5** (TUI frames with zoom/pan/highlight + captions).
- **S5 Sonnet – scenes 6–7** (screen-warp payoff, install outro).
- Me: own `composition/index.html` root timeline, merge scenes, keep every frame a pure function of time.

**Wave 3**
- **H3 Haiku – stills QA:** capture stills at each scene midpoint and every mid-transition; report overflow/collisions/contrast/readability (0.3s/word rule).
- Me: fixes, full render, mux audio, poster frame → `brag.jpg`, bake as frame 0, `share-copy.txt`.

## Commits (on `brag-video`)
1. `chore(brag): add video plan and output scaffold` — brag-plan.md, `.gitignore` for `brag-output/work/`.
2. `feat(brag): export real TUI frames from fixture snapshots`
3. `feat(brag): hyperframes composition — hook, reveal, highlights`
4. `feat(brag): soundtrack + payoff/outro scenes`
5. `feat(brag): final render, poster and share copy`

## Constraints
- Never touch `~/.claude`; exporter uses only in-memory fixtures (no collectors, no network).
- `npx hyperframes` downloads from npm — that's the only install. Ask before installing anything else.
- Root lint/prettier: add `brag-output/` to ignores if it trips `npm run lint`.

## Verification
- `npm test && npm run typecheck && npm run lint` still pass (no src changes expected).
- Stills reviewed for every scene + transition; `ffprobe brag.mp4` → 1920×1080, 30fps, ~24.0s, audio present; frame 0 matches `brag.jpg`; watch full render once.

## Build notes (as built)
- vhs was not installed, so the "real TUI" footage is the real Ink `App` rendered against in-memory fixtures (`tui-export/export.tsx`), converted ANSI→HTML. All names and paths are fictional sample data mirroring the landing page.
- The wireframe-portal-title block (WebGL) stalls the full-video renderer at its first frame, so it's pre-rendered standalone from `work/portal-proj` and mounted as `composition/assets/portal.mp4`. To change it: edit `compositions/wireframe-portal-title/wireframe-portal-title.html`, copy it to `work/portal-proj/index.html`, re-render with the variables in `index.html`'s comment.
- Rebuild: `node tui-export/build-board.mjs && node tui-export/build-outro.mjs`, then `cd composition && npx hyperframes@0.8.224 render -f 30 -q delivery -o ../work/render.mp4`, then bake `brag.jpg` (t=20.8s) as frame 0.
