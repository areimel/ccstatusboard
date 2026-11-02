# ccstatusboard: LinkedIn brag video, cinematic cut

**Audience:** employers and recruiters on LinkedIn, mostly watching muted first.
**Angle:** a problem a recruiter can follow, the tool solving it, then proof it shipped.
**Format:** 1080x1080, 30fps, 72s. The length exceeds the skill's 15-25s at the user's request, because the 24s cut was too fast to read. That cut is at commit fb0ebf9.
**Tone:** cinematic, cyberpunk-hacker trailer. Near-black with #ff4d00; JetBrains Mono and DM Sans.
**Music:** 60 BPM, A minor with a Phrygian Bb. A slow, thick, filtered bass lead through a ladder filter. Downbeats at 2+4k, every cut on a beat.

All times live in `timing.mjs`. `lint-timing.mjs` enforces 0.45s per word + 1s per line.

| # | Time | Scene | On-screen text |
|---|---|---|---|
| 1 | 0-10 | Hook: panes pop in, one stops and waits | Five AI agents. Which one is stuck? |
| 2 | 10-18 | Reveal: the real board wipes in | ccstatusboard / One live dashboard for every Claude Code session. |
| 3 | 18-34 | Product: waiting session, costs, 5h limit (NEAR LIMIT at 29.5) | Who needs you. What it costs. When you hit the limit. |
| 4 | 34-46 | System: network, temps, GPU, pressure, 2s+ each | New: the whole machine, live. |
| 5 | 46-58 | Public: types `npx ccstatusboard`, Enter at 52.5, board launches | Public. Free. Install it today. + npm, standalone binary, Linux, macOS, site |
| 6 | 58-72 | Credit: orange flood, biggest musical hit | 20 days to public release, 734 tests passing, Alec Reimel, Open to engineering roles, repo URL |

All board data is fictional: the real Ink App rendered from in-memory snapshots.
