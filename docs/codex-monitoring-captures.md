# Codex monitoring terminal captures

Synthetic data only; fixed fixture clock. C = Claude, X = Codex, ? = unknown status, * = partial estimated cost.

## 60 × 16

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ──────────────────────────╮
│ 5h   [|||||58%] resets 2h14m        block  $12.40        │
│ Week [||   31%] resets Wed 10:32    week   $96.10        │
│ Opus [||   22%]                     today  $18.20        │
│ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂    month  $412.75       │
╰──────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────╮
│ ST    NAME                   CTX               COST      │
│ ── dashboard (2) ─────────────────────────────────────── │
│ X ◐   Codex work             ██████░░░░ 60%    ≈$2.10*   │
│ C ○   Claude work            ██████░░░░ 60%    $4.20     │
╰──────────────────────────────────────────────────────────╯
 ?Help  ↑↓Select  pProvider  PUsage  qQuit
```

With Codex usage selected (P):

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Codex · estimated USD · partial* ────────────────╮
│ 5h Codex primary [||   20%]         block  $12.40*       │
│ observed 10s · resets 1h            week   $96.10*       │
│ +2 more quota windows · enlarge t…  today  $18.20*       │
│ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂    month  $27.00*       │
╰──────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────╮
│ ST    NAME                   CTX               COST      │
│ ── dashboard (2) ─────────────────────────────────────── │
│ X ◐   Codex work             ██████░░░░ 60%    ≈$2.10*   │
│ C ○   Claude work            ██████░░░░ 60%    $4.20     │
╰──────────────────────────────────────────────────────────╯
 ?Help  ↑↓Select  pProvider  PUsage  qQuit
```

## 60 × 24

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ──────────────────────────╮
│ 5h   [|||||58%] resets 2h14m        block  $12.40        │
│ Week [||   31%] resets Wed 10:32    week   $96.10        │
│ Opus [||   22%]                     today  $18.20        │
│ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂    month  $412.75       │
╰──────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────╮
│ ST    NAME                   CTX               COST      │
│ ── dashboard (2) ─────────────────────────────────────── │
│ X ◐   Codex work             ██████░░░░ 60%    ≈$2.10*   │
│ C ○   Claude work            ██████░░░░ 60%    $4.20     │
│ ── tools (1) ─────────────────────────────────────────── │
│ X ?   Parser tests           ██████░░░░ 60%    ≈$2.10*   │
╰──────────────────────────────────────────────────────────╯
╭ Detail: Codex work ──────────────────────────────────────╮
│ Codex · observed …usy · /work/proj  model costs unknown  │
│ in 0  out 0  cache-w 0  cache-r 0                        │
│ ctx 120k / 200k (60%) · ≈$2.10*                          │
│ gpt-example-codex · agents: none …                       │
╰──────────────────────────────────────────────────────────╯
 ?Help  ↑↓Select  pProvider  PUsage  qQuit
```

With Codex usage selected (P):

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Codex · estimated USD · partial* ────────────────╮
│ 5h Codex primary [||   20%]         block  $12.40*       │
│ observed 10s · resets 1h            week   $96.10*       │
│ 7d Codex secondary [||   30%]       today  $18.20*       │
│ observed 10s · resets 1h            month  $27.00*       │
│ +1 more quota windows · enlarge t…                       │
│ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂                         │
╰──────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────╮
│ ST    NAME                   CTX               COST      │
│ ── dashboard (2) ─────────────────────────────────────── │
│ X ◐   Codex work             ██████░░░░ 60%    ≈$2.10*   │
│ C ○   Claude work            ██████░░░░ 60%    $4.20     │
╰──────────────────────────────────────────────────────────╯
╭ Detail: Codex work ──────────────────────────────────────╮
│ Codex · observed …usy · /work/proj  model costs unknown  │
│ in 0  out 0  cache-w 0  cache-r 0                        │
│ ctx 120k / 200k (60%) · ≈$2.10*                          │
│ gpt-example-codex · agents: none …                       │
╰──────────────────────────────────────────────────────────╯
 ?Help  ↑↓Select  pProvider  PUsage  qQuit
```

## 100 × 30

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ──────────────────────────────────────────────────────────────────╮
│ 5h   [||||||||||||||||||||||||||||                 58%] resets 2h14m        block  $12.40        │
│ Week [|||||||||||||||                              31%] resets Wed 10:32    week   $96.10        │
│ Opus [|||||||||||                                  22%]                     today  $18.20        │
│ Burn Rate                                                                   month  $412.75       │
│ 5h   —                                                                                           │
│ Week —                                                                                           │
│ burn $4.10/h  24h ▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃                               │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ System ──────────────────────────────────────────────────────────────────────────────────────────╮
│ sampling…                                                                                        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────────────────────────────────────────────╮
│ ST    PROJECT        NAME           MODEL      CTX               CPU   MEM    COST      LAST     │
│ ── dashboard (2) ─────────────────────────────────────────────────────────────────────────────── │
│ X ◐   dashboard      Codex work     gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      │
│ C ○   dashboard      Claude work    opus-5.5   ██████░░░░ 60%    —     —      $4.20     now      │
│ ── tools (1) ─────────────────────────────────────────────────────────────────────────────────── │
│ X ?   tools          Parser tests   gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Detail: Codex work ──────────────────────────────────────────────────────────────────────────────╮
│ Codex · observed activity · busy · /work/proj                  model costs unknown               │
│ in 0  out 0  cache-w 0  cache-r 0                                                                │
│ ctx 120k / 200k (60%) · ≈$2.10*                                                                  │
│ gpt-example-codex · agents: none active                                                          │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
 F1Help  ↑↓Select  ⏎Detail  sSort  fFilter  /Search  pProvider  PUsage  qQuit
```

## 120 × 40

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ──────────────────────────────────────────────────────────────────────────────────────╮
│ 5h   [||||||||||||||||||||||||||||||||||                     58%] resets 2h14m                  block  $12.40        │
│ Week [||||||||||||||||||                                     31%] resets Wed 10:32              week   $96.10        │
│ Opus [|||||||||||||                                          22%]                               today  $18.20        │
│ Burn Rate                                                                                       month  $412.75       │
│ 5h   —                                                                                                               │
│ Week —                                                                                                               │
│ burn $4.10/h  24h ▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃                                                   │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Usage · Codex · estimated USD · partial* ────────────────────────────────────────────────────────────────────────────╮
│ 5h Codex primary [|||||||||||                                          20%]                     block  $12.40*       │
│ observed 10s · resets 1h                                                                        week   $96.10*       │
│ 7d Codex secondary [||||||||||||||||                                   30%]                     today  $18.20*       │
│ observed 10s · resets 1h                                                                        month  $27.00*       │
│ 5h Review primary [||||||||||||||||||||||                              40%]                                          │
│ stale 6m · resets 1h                                                                                                 │
│ burn $4.10/h  24h ▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃▄▄▅▅▆▆██▁▁▂▂▃▃                                                   │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ System ──────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ sampling…                                                                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────────────────────────────────────────────────────────────────╮
│ ST    PROJECT        NAME                        MODEL      CTX               CPU   MEM    COST      LAST     UP     │
│ ── dashboard (2) ─────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ◐   dashboard      Codex work                  gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —      │
│ C ○   dashboard      Claude work                 opus-5.5   ██████░░░░ 60%    —     —      $4.20     now      12m    │
│ ── tools (1) ─────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ?   tools          Parser tests                gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Detail: Codex work ──────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Codex · observed activity · busy · /work/proj                                   model costs unknown                  │
│ in 0  out 0  cache-w 0  cache-r 0                                                                                    │
│ ctx 120k / 200k (60%) · ≈$2.10*                                                                                      │
│ gpt-example-codex · agents: none active                                                                              │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 F1Help  ↑↓Select  ⏎Detail  sSort  fFilter  /Search  pProvider  PUsage  qQuit
```

## 122 × 40

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ──────────────────────────╮  ╭ Usage · Codex · estimated USD · partial* ────────────────╮
│ 5h   [|||||58%] resets 2h14m        block  $12.40        │  │ 5h Codex primary [||   20%]         block  $12.40*       │
│ Week [||   31%] resets Wed 10:32    week   $96.10        │  │ observed 10s · resets 1h            week   $96.10*       │
│ Opus [||   22%]                     today  $18.20        │  │ 7d Codex secondary [||   30%]       today  $18.20*       │
│ Burn Rate                           month  $412.75       │  │ observed 10s · resets 1h            month  $27.00*       │
│ 5h   —                                                   │  │ 5h Review primary [|||  40%]                             │
│ Week —                                                   │  │ stale 6m · resets 1h                                     │
│ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂                         │  │ burn $4.10/h  24h ▁▂▄▆█▂▄▆█▂▄▅█▂                         │
╰──────────────────────────────────────────────────────────╯  ╰──────────────────────────────────────────────────────────╯
╭ System ────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ sampling…                                                                                                              │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ──────────────────────────────────────────────────────────────────────────────╮
│ ST    PROJECT        NAME                          MODEL      CTX               CPU   MEM    COST      LAST     UP     │
│ ── dashboard (2) ───────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ◐   dashboard      Codex work                    gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —      │
│ C ○   dashboard      Claude work                   opus-5.5   ██████░░░░ 60%    —     —      $4.20     now      12m    │
│ ── tools (1) ───────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ?   tools          Parser tests                  gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —      │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Detail: Codex work ────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Codex · observed activity · busy · /work/proj                                     model costs unknown                  │
│ in 0  out 0  cache-w 0  cache-r 0                                                                                      │
│ ctx 120k / 200k (60%) · ≈$2.10*                                                                                        │
│ gpt-example-codex · agents: none active                                                                                │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 F1Help  ↑↓Select  ⏎Detail  sSort  fFilter  /Search  pProvider  PUsage  qQuit
```

## 160 × 40

```text
 ccstatusboard · 1 live / 2 recent / 0 ended · 10:32:07
 ⚠ Codex costs partial
╭ Usage · Claude · estimated USD ─────────────────────────────────────────────╮  ╭ Usage · Codex · estimated USD · partial* ───────────────────────────────────╮
│ 5h   [||||||||||||||||        58%] resets 2h14m        block  $12.40        │  │ 5h Codex primary [|||         20%]                     block  $12.40*       │
│ Week [||||||||                31%] resets Wed 10:32    week   $96.10        │  │ observed 10s · resets 1h                               week   $96.10*       │
│ Opus [||||||                  22%]                     today  $18.20        │  │ 7d Codex secondary [||||      30%]                     today  $18.20*       │
│ Burn Rate                                              month  $412.75       │  │ observed 10s · resets 1h                               month  $27.00*       │
│ 5h   —                                                                      │  │ 5h Review primary [||||||     40%]                                          │
│ Week —                                                                      │  │ stale 6m · resets 1h                                                        │
│ burn $4.10/h  24h ▁▁▂▃▃▄▅▆▆█▁▂▂▃▄▄▅▆██▁▂▃▃▄▅▅▆█▁▁▂▃                         │  │ burn $4.10/h  24h ▁▁▂▃▃▄▅▆▆█▁▂▂▃▄▄▅▆██▁▂▃▃▄▅▅▆█▁▁▂▃                         │
╰─────────────────────────────────────────────────────────────────────────────╯  ╰─────────────────────────────────────────────────────────────────────────────╯
╭ System ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ sampling…                                                                                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Sessions ── sort: project ── filter: all ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ST    PROJECT        NAME                             MODEL      CTX               CPU   MEM    COST      LAST     UP                                        │
│ ── dashboard (2) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ◐   dashboard      Codex work                       gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —                                         │
│ C ○   dashboard      Claude work                      opus-5.5   ██████░░░░ 60%    —     —      $4.20     now      12m                                       │
│ ── tools (1) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ X ?   tools          Parser tests                     gpt-examp… ██████░░░░ 60%    —     —      ≈$2.10*   now      —                                         │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭ Detail: Codex work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Codex · observed activity · busy · /work/proj                                                                           model costs unknown                  │
│ in 0  out 0  cache-w 0  cache-r 0                                                                                                                            │
│ ctx 120k / 200k (60%) · ≈$2.10*                                                                                                                              │
│ gpt-example-codex · agents: none active                                                                                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 F1Help  ↑↓Select  ⏎Detail  sSort  fFilter  /Search  pProvider  PUsage  qQuit
```

