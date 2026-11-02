# ccstatusboard: LinkedIn video (/brag-slim)

**Audience:** employers and recruiters scrolling LinkedIn, usually muted, often on a phone.
**Angle:** a real problem with parallel AI coding, a tool that solves it, shipped to the public.
**Hook:** "Five AI agents. Which one is stuck?"
**Highlights:** who needs you / cost / limits; new system metrics; public install.
**Punchline:** 20 days to public release, 734 tests, name and open to engineering roles.
**Tone:** polished. **Format:** 1080×1080, 30fps, 24s. **Music:** 120 BPM, A minor; every cut on a beat.
**Identity:** ground #0c0c0a, site orange #ff4d00, JetBrains Mono + DM Sans from `site/`.

| # | Film time | Scene | On-screen text |
|---|---|---|---|
| 1 Hook | 0–4 | Five agent panes; release-script turns amber, waiting | Five AI agents. / Which one is stuck? |
| 2 Reveal | 4–7 | Real board assembles panel by panel | ccstatusboard / One live dashboard for every Claude Code session. |
| 3 Product | 7–11 | Push in: waiting row, cost block, 5h projection flips to NEAR LIMIT | Who needs you. / What it costs. / When you hit the limit. |
| 4 System | 11–15 | System panel; network, temps, GPU, pressure light up in turn | New: the whole machine, live. |
| 5 Public | 15–19 | Terminal types npx ccstatusboard; the board launches inside it | Public. Free. / Install it today. |
| 6 Credit | 19–24 | Orange flood; stats, then name | 20 days to public release · 734 tests passing / Alec Reimel / Open to engineering roles / github.com/areimel/ccstatusboard |

**Sources of truth:** board footage is the real `src/ui/App.tsx` rendered from in-memory snapshots (`tui-export/export.tsx`). Hook panes are illustrative. All session names, values, and network link details are fictional. 20 days = first spec commit 2026-10-11 to the v0.1.0 release 2026-10-31. 734 = `vitest` total on this branch, all passing.

**Rebuild:** from the repo root `npx tsx <this folder>/tui-export/export.tsx`, then `node <this folder>/tui-export/build.mjs`, `node <this folder>/audio/synth.mjs`, and in `composition/` `npx hyperframes@0.8.224 render -f 30 -q delivery`.
