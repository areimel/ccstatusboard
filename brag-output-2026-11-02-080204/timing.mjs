// Single source of truth for the 72s cut. All values are absolute film seconds.
// 60 BPM: 1 beat = 1s, 1 bar = 4s. A 2-beat pickup puts downbeats at 2 + 4k.
export const BPM = 60;
export const DUR = 72;
export const STEP = 0.5; // seconds between exported TUI frames

export const SCENES = {
  hook: { start: 0, end: 10 },
  reveal: { start: 10, end: 18 },
  product: { start: 18, end: 34 },
  system: { start: 34, end: 46 },
  public: { start: 46, end: 58 },
  credit: { start: 58, end: 72 },
};
export const CUTS = [10, 18, 34, 46, 58];

export const CUES = {
  hook: { paneTimes: [0, 0.5, 1, 1.5, 2], stuck: [2, 2.5, 3], t2In: 2.35, waitIn: 5.25, dim: 5.75, titlesOut: 9.5, zoom: 9.58, scrollStep: 0.5 },
  reveal: { wipeStep: 0.5, wipeDur: 0.8, nameIn: 10.1, tagIn: 11.75, out: 17.6 },
  product: {
    shot1: { move: 18, moveDur: 1.2, lineIn: 18.2, box: 19.5, calloutIn: 20.75, out: 24.7 },
    shot2: { move: 25, moveDur: 1, lineIn: 25.2, box: 26, out: 27.8 },
    shot3: { move: 28, moveDur: 1, lineIn: 28.2, box: 29.25, out: 33.7 },
    nearLimitFlip: 29.5,
  },
  system: {
    moves: [{ at: 34, d: 1 }, { at: 35, d: 1.2 }, { at: 42.5, d: 0.6 }],
    headIn: 34.2, chipsIn: 35,
    net: [36.5, 38.5], temp: [38.5, 40.5], gpu: [40.5, 42.5], press: [43, 45.75],
    cpuRamp: [38, 39.75], gpuRamp: [38, 42], out: 45.75,
  },
  public: { l1In: 46, l2In: 48, typeStart: 48.4, typeStep: 0.125, enter: 52.5, chipsIn: 52.5, chipStep: 0.135, siteIn: 54, out: 57.84 },
  credit: { flood: 58, floodDur: 0.75, stat1In: 58.5, stat2In: 61.75, ruleIn: 64, nameIn: 64.5, roleIn: 66.75, urlIn: 68 },
};

// Exported data: film time equals data time. The board uses 10..46, the launch 52.5..58.
export const EXPORT = { T0: 10, T1: 58, RANGES: [[10, 46], [52.5, 58]] };
export const RAMPS = { cost: [25.5, 27.5], block: [18, 29.5], session: [18, 34], global: [10, 58] };

// Reading contract, checked by lint-timing.mjs: 0.45s per word + 1s per line.
const CMD_LEN = 'npx ccstatusboard'.length;
export const LINES = [
  { g: 'hook', text: 'Five AI agents.', settled: 0, out: 9.5 },
  { g: 'hook', text: 'Which one is stuck?', settled: 2.53, out: 9.5 },
  { g: 'hook', text: 'waiting: permission to run npm publish', settled: 5.39, out: 9.5 },
  { g: 'reveal', text: 'ccstatusboard', settled: 10.28, out: 17.6 },
  { g: 'reveal', text: 'One live dashboard for every Claude Code session.', settled: 11.93, out: 17.6 },
  { g: 'p1', text: 'Who needs you.', settled: 18.38, out: 24.7 },
  { g: 'p1', text: 'waiting: permission to run npm publish', settled: 20.9, out: 24.7 },
  { g: 'p2', text: 'What it costs.', settled: 25.38, out: 33.7 },
  { g: 'p2', text: 'When you hit the limit.', settled: 28.38, out: 33.7 },
  { g: 'p3', text: '5h proj 93% NEAR LIMIT', settled: 29.5, out: 33.7 },
  { g: 'system', text: 'New: the whole machine, live.', settled: 34.38, out: 45.75 },
  { g: 'system', text: 'Network Temps GPU Pressure', settled: 35.3, out: 45.75 },
  { g: 'public', text: 'Public. Free.', settled: 46.18, out: 57.84 },
  { g: 'public', text: 'Install it today.', settled: 48.18, out: 57.84 },
  { g: 'cmd', text: '$ npx', settled: 48.4 + (CMD_LEN - 1) * 0.125, out: 52.5 },
  { g: 'public2', text: 'npm standalone binary Linux macOS', settled: 53.04, out: 57.84 },
  { g: 'public2', text: 'areimel.github.io/ccstatusboard', settled: 54.18, out: 57.84 },
  { g: 'credit', text: '20 days to public release', settled: 58.8, out: 72 },
  { g: 'credit', text: '734 tests passing', settled: 62.05, out: 72 },
  { g: 'credit', text: 'Alec Reimel', settled: 65, out: 72 },
  { g: 'credit', text: 'Open to engineering roles', settled: 66.95, out: 72 },
  { g: 'credit', text: 'github.com/areimel/ccstatusboard', settled: 68.25, out: 72 },
];

// Bass lead: [midi, startSeconds, beats]. A1 = 33. Rest at 48-48.5. Sections carry the filter.
const seq = (start, notes) => { let t = start; return notes.map(([m, b]) => { const n = [m, t, b]; t += b; return n; }); };
export const SCORE = [
  { from: 0, to: 10, base: 90, peak: 220, k: 0.55, notes: seq(0, [[33, 6], [34, 2], [33, 1.5]]) },
  { from: 10, to: 18, base: 110, peak: 500, k: 0.6, notes: seq(10, [[33, 3], [36, 1], [34, 2], [31, 2]]) },
  { from: 18, to: 34, base: 120, peak: 750, k: 0.65, notes: seq(18, [[33, 3], [36, 1], [29, 4], [38, 3], [36, 1], [40, 4]]) },
  { from: 34, to: 46, base: 140, peak: 1100, k: 0.7, notes: seq(34, [[33, 2], [40, 2], [41, 2], [38, 2], [33, 2], [40, 1], [41, 1]]) },
  { from: 46, to: 58, base: 160, peak: 1600, k: 0.72, notes: [...seq(46, [[33, 2], [36, 1], [38, 1], [40, 1], [41, 1]]), [40, 52.5, 5.5]] },
  { from: 58, to: 70, base: 200, peak: 2600, k: 0.75, notes: seq(58, [[33, 4], [36, 2], [29, 2], [34, 2], [33, 2]]) },
  { from: 70, to: 72, base: 200, peak: 300, k: 0.5, notes: [[33, 70, 2]] },
];
export const IMPACTS = [{ t: 10, db: -2, braam: true }, { t: 18, db: -10 }, { t: 34, db: -6 }, { t: 46, db: -2 }, { t: 52.5, db: -8, enter: true }, { t: 58, db: 0, braam: true }, { t: 70, db: -4 }];
