// ccstatusboard LinkedIn launch soundtrack: a slow cyberpunk trailer score. Node stdlib only.
// Run: node audio/synth.mjs       -> audio/music.wav, composition/assets/music.wav, audio/cues.md, work/audio/stem_*.wav
//      LAYERS=lead,sub node ...   -> work/audio/preview.wav only (deliverables untouched)
// Deterministic: every layer draws from its own named RNG, so changing one never reshuffles another.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BPM, DUR, CUTS, CUES, SCENES, SCORE, IMPACTS, LINES } from '../timing.mjs';

const SR = 48000, N = Math.round(SR * DUR), BEAT = 60 / BPM;
const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '../work/audio');
fs.mkdirSync(WORK, { recursive: true });

const LAYERS = process.env.LAYERS ? new Set(process.env.LAYERS.split(',')) : null;
const on = (name) => !LAYERS || LAYERS.has(name);

// ---------- mix constants (all the tuning lives here) ----------
const MASTER_GAIN = Number(process.env.GAIN ?? 1.0); // linear trim, set from ebur128 measurement
const CEILING = 10 ** (-2.1 / 20); // limiter ceiling, leaves margin for true peak
const HIT_TRIM = 10 ** (-7 / 20); // "0 dB" impact on the IMPACTS scale, relative to full scale
const BRAAM_TRIM = 10 ** (-5.5 / 20);
const LEAD_DB = [[-24, -22], [-17.5, -18.5], [-14, -13], [-13.5, -12.5], [-12, -10.5], [-8, -9], [-10, -30]]; // start/end per SCORE section
const SUB_REL_DB = -4, PHONE_DB = -8;
const PHONE_DARK_DB = (process.env.DARK ?? '-10,-14,-22,-28,-36,-60,-60').split(',').map(Number); // absolute level per SCORE section: harmonics for phone speakers while the filter is shut
const DUCK_DB = { sub: 8, reverb: 6, lead: 5, pad: 4 };
const SENDS = { lead: 0.1, pad: 0.3, drone: 0.25, braam: 0.26, crack: 0.8, stab: 0.5, ticks: 0.22, sfx: 0.3, bell: 0.8, riser: 0.2 };
const REVERB_WET = 1.6;

// ---------- utils ----------
const db = (d) => 10 ** (d / 20);
const S = (t) => Math.round(t * SR);
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const mk = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const panGains = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

function rng(name) { // mulberry32 seeded from the layer name
  let seed = 2166136261;
  for (let i = 0; i < name.length; i++) seed = Math.imul(seed ^ name.charCodeAt(i), 16777619);
  const r = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.noise = () => r() * 2 - 1;
  r.buf = (n) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; };
  return r;
}
function add(st, t0, arr, p = 0, g = 1) {
  const [gl, gr] = panGains(p), i0 = S(t0);
  for (let i = 0; i < arr.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; st.L[j] += arr[i] * gl * g; st.R[j] += arr[i] * gr * g; }
}
function addLR(st, t0, l, r, g = 1) {
  const i0 = S(t0);
  for (let i = 0; i < l.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; st.L[j] += l[i] * g; st.R[j] += r[i] * g; }
}
function svf(x, fc, Q = 0.707, mode = 'lp') { // per-sample cutoff if fc is a function of the sample index
  const out = new Float32Array(x.length), k = 1 / Q, f = typeof fc === 'function' ? fc : null;
  let s1 = 0, s2 = 0, last = -1, g = 0, a1 = 0, a2 = 0, a3 = 0;
  const set = (c) => { g = Math.tan(Math.PI * Math.min(c, SR * 0.45) / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; last = c; };
  if (!f) set(fc);
  for (let i = 0; i < x.length; i++) {
    if (f) { const c = f(i); if (c !== last) set(c); }
    const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    out[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : x[i] - k * v1 - v2;
  }
  return out;
}
const bell = (x, fc, Q, dB) => { const b = svf(x, fc, Q, 'bp'), a = (db(dB) - 1) / Q, o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] + a * b[i]; return o; };
const filtSt = (st, ...a) => { st.L = svf(st.L, ...a); st.R = svf(st.R, ...a); return st; };
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
const sawP = (ph, dt) => 2 * ph - 1 - blep(ph, dt);
const pulseP = (ph, dt, duty) => (sawP(ph, dt) - sawP((ph + duty) % 1, dt)) * 0.5; // zero mean for any duty
function saw(f, n, { detune = 0, ph0 = 0 } = {}) { // f is Hz or a function of seconds
  const o = new Float32Array(n), dm = 2 ** (detune / 1200), fn = typeof f === 'function' ? f : null;
  let ph = ph0, dt = fn ? 0 : f * dm / SR;
  for (let i = 0; i < n; i++) {
    if (fn) dt = fn(i / SR) * dm / SR;
    o[i] = sawP(ph, dt); ph += dt; if (ph >= 1) ph -= 1;
  }
  return o;
}
const peakOf = (st) => { let p = 0; for (let i = 0; i < st.L.length; i++) { p = Math.max(p, Math.abs(st.L[i]), Math.abs(st.R[i])); } return p; };
const scale = (st, g) => { for (let i = 0; i < st.L.length; i++) { st.L[i] *= g; st.R[i] *= g; } return st; };
const mulBy = (st, e) => { for (let i = 0; i < N; i++) { st.L[i] *= e[i]; st.R[i] *= e[i]; } return st; };
const sumInto = (dst, src, g = 1) => { for (let i = 0; i < N; i++) { dst.L[i] += src.L[i] * g; dst.R[i] += src.R[i] * g; } };
function automation(points) { // [[t, dB], ...] -> linear gain curve, interpolated in dB, silent outside the range
  const e = new Float32Array(N);
  for (let p = 0; p < points.length - 1; p++) {
    const [t0, d0] = points[p], [t1, d1] = points[p + 1], i0 = S(t0), i1 = Math.min(N, S(t1));
    for (let i = i0; i < i1; i++) e[i] = db(lerp(d0, d1, (i - i0) / Math.max(1, i1 - i0)));
  }
  return e;
}

// ---------- 2x-oversampled Huovilainen ladder ----------
// `os` has 2n samples at 2*SR; fcs and ks are per-output-sample control arrays. Returns n samples at SR.
const DECIM = (() => {
  const L = 63, h = new Float64Array(L), mid = (L - 1) / 2, fc = 20500 / (2 * SR); let sum = 0;
  for (let i = 0; i < L; i++) {
    const x = i - mid, w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (L - 1));
    h[i] = (x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x)) * w; sum += h[i];
  }
  for (let i = 0; i < L; i++) h[i] /= sum;
  return { h, L, mid };
})();
function ladder2x(os, fcs, ks) {
  const n = os.length >> 1, y = new Float64Array(2 * n), tanh = Math.tanh;
  let y1 = 0, y2 = 0, y3 = 0, y4 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, fb = 0;
  for (let i = 0; i < n; i++) {
    const g = 1 - Math.exp(-Math.PI * fcs[i] / SR), k4 = 4 * ks[i];
    for (let j = 0; j < 2; j++) {
      const idx = 2 * i + j, inp = os[idx], x = inp - k4 * (fb - 0.5 * inp);
      y1 += g * (tanh(x) - t1); t1 = tanh(y1);
      y2 += g * (t1 - t2); t2 = tanh(y2);
      y3 += g * (t2 - t3); t3 = tanh(y3);
      const prev = y4;
      y4 += g * (t3 - t4); t4 = tanh(y4);
      fb = 0.5 * (y4 + prev);
      y[idx] = fb;
    }
  }
  const o = new Float32Array(n), { h, L, mid } = DECIM;
  for (let i = 0; i < n; i++) {
    let s = 0; const c = 2 * i - mid;
    for (let k = 0; k < L; k++) { const q = c + k; if (q >= 0 && q < 2 * n) s += h[k] * y[q]; }
    o[i] = s;
  }
  return o;
}

// ---------- cue list ----------
const cues = [];
const cue = (t, what) => cues.push([t, what]);

// ---------- bass lead + sub ----------
const NOTES = SCORE.flatMap((sec, si) => sec.notes.map(([m, t, b]) => ({ m, t, b, end: t + b * BEAT, sec, si }))).sort((a, b) => a.t - b.t);
const LIFT_AT = SCENES.system.end - 4 * BEAT, CUT_HIT = SCENES.public.start, CUT_GAP = CUT_HIT - 0.25 * BEAT; // last-bar lift, then a held breath before the Public cut
const OCTAVE_FROM = SCENES.credit.start, OCTAVE_TO = SCORE[SCORE.length - 1].from; // A1+A2 doubling during the climax

function renderLead() {
  const r = rng('lead'), hz = new Float64Array(N), amp = new Float32Array(N), fc = new Float32Array(N), ks = new Float32Array(N), oct = new Float32Array(N), secG = new Float32Array(N), darkG = new Float32Array(N);
  let pitch = NOTES[0].m, e = 0, a = 0;
  // rests: the voice holds its pitch and the filter stays where it fell; amp has already released
  for (let n = 0; n < NOTES.length; n++) {
    const note = NOTES[n], next = NOTES[n + 1], i0 = S(note.t), i1 = next ? S(next.t) : N, nEnd = S(note.end);
    const legato = next && S(next.t) - nEnd < 8;
    const glide = note.b <= 1 ? 0.08 : note.b <= 2 ? 0.11 : 0.15;
    const atk = Math.min(0.12, 0.04 + 0.02 * note.b), fAtk = 0.35, tau = note.b <= 1 ? 0.6 : 1.2;
    const from = pitch, e0 = e, a0 = a, { base, peak, k } = note.sec, rel = legato ? 0.05 : 0.12, relAt = (nEnd - i0) / SR - rel;
    let aHold = 1;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      pitch = lerp(from, note.m, smooth(t / glide));
      hz[i] = mtof(pitch);
      e = t < fAtk ? lerp(e0, 1, Math.sin(0.5 * Math.PI * t / fAtk) ** 2) : Math.exp(-(t - fAtk) / tau);
      fc[i] = Math.log(base * (peak / base) ** e * (1 + 0.08 * Math.sin(2 * Math.PI * 0.25 * i / SR)));
      ks[i] = k;
      if (t < atk) a = lerp(a0, 1, Math.sin(0.5 * Math.PI * t / atk) ** 2);
      else if (t < relAt) { a = 0.82 + 0.18 * Math.exp(-(t - atk) / 3); aHold = a; }
      else if (legato) a = lerp(aHold, 0.5, Math.sin(0.5 * Math.PI * clamp01((t - relAt) / rel)) ** 2);
      else a = aHold * Math.exp(-(t - relAt) / 0.045);
      amp[i] = a;
      oct[i] = note.t >= OCTAVE_FROM && note.t < OCTAVE_TO ? 1 : 0;
      const [d0, d1] = LEAD_DB[note.si], { from: f0, to: f1 } = note.sec;
      secG[i] = db(lerp(d0, d1, clamp01((i / SR - f0) / (f1 - f0))));
      darkG[i] = db(PHONE_DARK_DB[note.si]);
    }
  }
  // smooth the discontinuous controls
  let lf = fc[0], lk = ks[0], lo = 0, lg = secG[0], ld = darkG[0];
  const c15 = 1 - Math.exp(-1 / (0.015 * SR)), c30 = 1 - Math.exp(-1 / (0.03 * SR));
  for (let i = 0; i < N; i++) {
    lf += c15 * (fc[i] - lf); fc[i] = Math.exp(lf);
    lk += c15 * (ks[i] - lk); ks[i] = lk;
    lo += c30 * (oct[i] - lo); oct[i] = lo;
    lg += c30 * (secG[i] - lg); secG[i] = lg;
    ld += c30 * (darkG[i] - ld); darkG[i] = ld;
  }
  // oscillators at 2x: two saws at +/-7 cents plus a 0.45 duty pulse, spread slightly L/R, octave pair during the climax
  const osL = new Float64Array(2 * N), osR = new Float64Array(2 * N), det = 2 ** (7 / 1200), DUTY = 0.45;
  let pa = r(), pb = r(), pc = r(), pd = r(), pe = r();
  for (let i = 0; i < N; i++) {
    const f = hz[i] / (2 * SR), o = oct[i];
    for (let j = 0; j < 2; j++) {
      const da = f / det, db_ = f * det;
      const sa = sawP(pa, da), sb = sawP(pb, db_), sp = pulseP(pc, f, DUTY);
      pa += da; if (pa >= 1) pa -= 1; pb += db_; if (pb >= 1) pb -= 1; pc += f; if (pc >= 1) pc -= 1;
      let oa = 0, ob = 0;
      if (o > 1e-4) { const d2 = 2 * da, e2 = 2 * db_; oa = sawP(pd, d2) * o; ob = sawP(pe, e2) * o; pd += d2; if (pd >= 1) pd -= 1; pe += e2; if (pe >= 1) pe -= 1; }
      osL[2 * i + j] = 0.42 * sa + 0.2 * sb + 0.42 * sp + 0.3 * oa + 0.14 * ob;
      osR[2 * i + j] = 0.2 * sa + 0.42 * sb + 0.42 * sp + 0.14 * oa + 0.3 * ob;
    }
  }
  const dcHp = (x) => svf(x, 16, 0.707, 'hp');
  const shape = (osc) => {
    const y = dcHp(ladder2x(osc, fc, ks));
    for (let i = 0; i < N; i++) y[i] = Math.tanh(2.5 * y[i] * amp[i]);
    const ph = svf(y, 250, 0.707, 'hp');
    for (let i = 0; i < N; i++) ph[i] = Math.tanh(4 * ph[i]);
    const pl = svf(ph, 3500, 0.707), g = db(PHONE_DB), out = bell(y, 350, 1, -3);
    // dark phone layer: hard drive turns the near-sine of a shut filter into a harmonic series, 400 Hz-2.4 kHz only
    const hard = new Float32Array(N), span = Math.log(1500 / 150);
    for (let i = 0; i < N; i++) hard[i] = Math.tanh(14 * y[i]) * amp[i] * (1 - clamp01(Math.log(fc[i] / 150) / span));
    const dark = svf(svf(svf(svf(hard, 400, 0.707, 'hp'), 400, 0.707, 'hp'), 2400, 0.707), 2400, 0.707);
    for (let i = 0; i < N; i++) out[i] = (out[i] + g * pl[i]) * secG[i] + dark[i] * darkG[i];
    return out;
  };
  const lead = { L: shape(osL), R: shape(osR) };
  // sub: pure mono sine on the same pitch and envelope, below the ladder
  const subRaw = new Float32Array(N), subG = db(SUB_REL_DB) * 0.85; let ph = r();
  for (let i = 0; i < N; i++) { ph += hz[i] / SR; if (ph >= 1) ph -= 1; subRaw[i] = Math.sin(2 * Math.PI * ph) * amp[i] * secG[i] * subG; }
  const subM = svf(subRaw, 120, 0.707);
  return { lead, sub: { L: subM, R: subM } };
}

// ---------- hits (mono bus, also drives the sidechain) ----------
function impact(bus, crack, r, t, dB, { fEnd = 40, tauA = 1.2, len = 4, crackG = 0.6 } = {}) {
  const g = db(dB) * HIT_TRIM, n = S(len), lo = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / SR; ph += (fEnd + (120 - fEnd) * Math.exp(-u / 0.8)) / SR;
    lo[i] = Math.tanh(1.5 * Math.sin(2 * Math.PI * ph)) * Math.min(u / 0.0015, 1) * Math.exp(-u / tauA) * Math.min(1, (len - u) / 0.1);
  }
  add(bus, t, lo, 0, g * Math.SQRT2);
  const cn = S(0.9), body = svf(r.buf(cn), 1700, 0.9, 'bp'), air = svf(r.buf(cn), 6000, 0.7, 'hp');
  const airR = svf(r.buf(cn), 6000, 0.7, 'hp'), bl = new Float32Array(cn), br = new Float32Array(cn);
  for (let i = 0; i < cn; i++) {
    const u = i / SR, a = Math.min(u / 0.0005, 1), tail = Math.min(1, (0.9 - u) / 0.1);
    const b = body[i] * 1.4 * Math.exp(-u / 0.018) * a;
    bl[i] = (b + air[i] * 0.3 * Math.exp(-u / 0.09) * a) * tail;
    br[i] = (b + airR[i] * 0.3 * Math.exp(-u / 0.09) * a) * tail;
  }
  addLR(crack, t, bl, br, g * crackG);
}
function lowHit(bus, crack, r, t, dB) {
  const n = S(1.1), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / SR; ph += (41 + 60 * Math.exp(-u / 0.045)) / SR;
    o[i] = Math.tanh(1.3 * Math.sin(2 * Math.PI * ph)) * Math.min(u / 0.002, 1) * Math.exp(-u / 0.3) * Math.min(1, (1.1 - u) / 0.08);
  }
  add(bus, t, o, 0, db(dB) * HIT_TRIM * Math.SQRT2);
  const cn = S(0.04), c = svf(r.buf(cn), 900, 1.2, 'bp');
  for (let i = 0; i < cn; i++) c[i] *= Math.exp(-i / SR / 0.006) * Math.min(1, (cn - i) / 40);
  add(crack, t, c, 0, db(dB) * HIT_TRIM * 0.35);
}
function braam(st, r, t, dB, { top = 3000, hold = 1.4, tau = 1.3, trim = 0 } = {}) {
  const len = 8, n = S(len), osL = new Float64Array(2 * n), osR = new Float64Array(2 * n);
  const voices = [[33, 0.34], [40, 0.27], [45, 0.25], [48, 0.2]], cents = [-14, -8.5, -3, 3, 8.5, 14];
  for (const [m, g] of voices) for (let v = 0; v < cents.length; v++) {
    const dt = mtof(m) * 2 ** (cents[v] / 1200) / (2 * SR), [gl, gr] = panGains(v % 2 ? 0.6 : -0.6); let ph = r();
    for (let i = 0; i < 2 * n; i++) { const s = sawP(ph, dt) * g; osL[i] += s * gl; osR[i] += s * gr; ph += dt; if (ph >= 1) ph -= 1; }
  }
  const fc = new Float32Array(n), ks = new Float32Array(n).fill(0.62);
  for (let i = 0; i < n; i++) { const u = i / SR; fc[i] = u < 0.25 ? 180 * (top / 180) ** (u / 0.25) : top * (300 / top) ** Math.min((u - 0.25) / 3, 1); }
  const l = ladder2x(osL, fc, ks), rr = ladder2x(osR, fc, ks), o = { L: new Float32Array(n), R: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const u = i / SR, a = Math.min(u / 0.006, 1) * (u < hold ? 1 : Math.exp(-(u - hold) / tau)) * Math.min(1, (len - u) / 0.4);
    o.L[i] = Math.tanh(1.8 * l[i]) * a; o.R[i] = Math.tanh(1.8 * rr[i]) * a;
  }
  const norm = 1 / peakOf(o);
  addLR(st, t, svf(o.L, 16, 0.707, 'hp'), svf(o.R, 16, 0.707, 'hp'), norm * db(dB + trim) * BRAAM_TRIM);
}
function enterStab(st, r, t, dB) { // A2 stab on the Enter key
  const len = 2.4, n = S(len), osL = new Float64Array(2 * n), osR = new Float64Array(2 * n);
  for (const [m, c, g] of [[45, -7, 0.45], [45, 7, 0.45], [57, -5, 0.2], [57, 5, 0.2]]) {
    const dt = mtof(m) * 2 ** (c / 1200) / (2 * SR), [gl, gr] = panGains(c < 0 ? -0.5 : 0.5); let ph = r();
    for (let i = 0; i < 2 * n; i++) { const s = sawP(ph, dt) * g; osL[i] += s * gl; osR[i] += s * gr; ph += dt; if (ph >= 1) ph -= 1; }
  }
  const fc = new Float32Array(n), ks = new Float32Array(n).fill(0.55);
  for (let i = 0; i < n; i++) fc[i] = 260 + 2400 * Math.exp(-i / SR / 0.18);
  const l = ladder2x(osL, fc, ks), rr = ladder2x(osR, fc, ks), o = { L: l, R: rr };
  for (let i = 0; i < n; i++) { const u = i / SR, a = Math.min(u / 0.003, 1) * Math.exp(-u / 0.5) * Math.min(1, (len - u) / 0.2); o.L[i] = Math.tanh(1.6 * l[i]) * a; o.R[i] = Math.tanh(1.6 * rr[i]) * a; }
  addLR(st, t, o.L, o.R, db(dB) / peakOf(o));
}

// ---------- texture layers ----------
function renderDrone() { // cold A2/E3/A3 fifth, a pale air band, the swell before the first hit
  const r = rng('drone'), st = mk(), hookEnd = SCENES.hook.end, swellAt = hookEnd - 2, swellTo = hookEnd - 0.5, secEnd = SCENES.reveal.end;
  for (const [m, g] of [[45, 0.42], [52, 0.34], [57, 0.3], [64, 0.2], [69, 0.1]]) for (const [c, p] of [[-5, -0.5], [5, 0.5]]) add(st, 0, saw(mtof(m), S(secEnd), { detune: c, ph0: r() }), p, g);
  const fcf = (i) => { const t = i / SR; return (t < swellAt ? 900 + 160 * Math.sin(2 * Math.PI * 0.11 * t) : t < swellTo ? lerp(900, 3200, ((t - swellAt) / (swellTo - swellAt)) ** 2) : 420); };
  filtSt(st, fcf, 0.8); filtSt(st, 110, 0.707, 'hp');
  const air = { L: r.buf(S(hookEnd)), R: r.buf(S(hookEnd)) };
  filtSt(air, 4800, 1.2, 'bp');
  for (let i = 0; i < air.L.length; i++) { st.L[i] += air.L[i] * 0.05; st.R[i] += air.R[i] * 0.05; }
  scale(st, 1 / peakOf(st));
  mulBy(st, automation([[0, -36], [2.5, -19], [swellAt, -18], [swellTo, -10], [hookEnd, -10], [hookEnd, -60], [hookEnd + 3, -36], [secEnd - 2, -28], [secEnd, -70], [DUR, -120]]));
  return st;
}
function renderPad(gainPoints) {
  const r = rng('pad'), dry = mk();
  const ch = { Am: [57, 60, 64, 69], F: [57, 60, 65, 69], Dm: [57, 62, 65, 69], Em: [59, 64, 67, 71], C: [55, 60, 64, 67], Bb: [58, 62, 65, 70] };
  const { product: p, system: y, public: u, credit: c } = SCENES, enter = CUES.public.enter, rest = enter - 0.5 * BEAT;
  const ROOT = { 33: 'Am', 36: 'C', 29: 'F', 41: 'F', 38: 'Dm', 40: 'Em', 34: 'Bb' }, follow = (from) => SCORE.filter((x) => x.from >= from.start && x.to <= from.end).flatMap((x) => x.notes).map(([m, t, b]) => [ROOT[m], t, b * BEAT]);
  const seq = [
    ...['Am', 'F', 'Dm', 'Em'].map((k, i) => [k, p.start + i * 4 * BEAT, 4 * BEAT]),
    ...follow(y),
    ['Am', u.start, rest - u.start], ['Em', enter, u.end - enter],
    ...follow(c),
  ];
  const cents = [[-11, -0.85], [-5, 0.45], [0, 0], [5, -0.45], [11, 0.85]];
  for (const [name, t, dur] of seq) {
    const fade = Math.min(0.9, dur * 0.35), total = dur + fade, n = S(total), env = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = i / SR; env[i] = Math.sin(0.5 * Math.PI * clamp01(v / fade)) * Math.cos(0.5 * Math.PI * clamp01((v - dur) / fade)); }
    for (const m of ch[name]) for (const [det, pan] of cents) {
      const o = saw(mtof(m), n, { detune: det, ph0: r() });
      for (let i = 0; i < n; i++) o[i] *= env[i];
      add(dry, t, o, pan, 0.1);
    }
  }
  const bright = [[p.start, 950], [p.end, 1800], [LIFT_AT, 2300], [LIFT_AT + 0.5 * BEAT, 3000], [y.end, 3200], [u.end, 3800], [c.start + 0.3, 6500], [DUR - 2, 3500], [DUR, 1200]];
  const fcf = (i) => { const t = i / SR; for (let k = 0; k < bright.length - 1; k++) if (t < bright[k + 1][0]) return lerp(bright[k][1], bright[k + 1][1], clamp01((t - bright[k][0]) / (bright[k + 1][0] - bright[k][0]))); return bright[bright.length - 1][1]; };
  filtSt(dry, fcf, 0.75); filtSt(dry, 200, 0.707, 'hp');
  scale(dry, 1 / peakOf(dry));
  return mulBy(dry, automation(gainPoints));
}
function renderTicks() {
  const r = rng('ticks'), st = mk(), { hook, product, system, public: u } = SCENES, rest = CUES.public.enter - 0.5 * BEAT, stop = u.end - 0.5 * BEAT;
  const one = () => { const n = S(0.045), o = svf(svf(r.buf(n), 4200, 0.8, 'hp'), 11000, 0.7); for (let i = 0; i < n; i++) { const t = i / SR; o[i] *= Math.min(t / 0.0007, 1) * Math.exp(-t / 0.0075) * Math.min(1, (n - i) / 48); } let pk = 0; for (const v of o) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < n; i++) o[i] /= pk; return o; };
  const lay = (from, to, step, d0, d1, acc = 2) => {
    for (let t = from, k = 0; t < to - 1e-6; k++, t = from + k * step * BEAT) {
      const onBeat = Math.abs(t / BEAT - Math.round(t / BEAT)) < 1e-6, d = lerp(d0, d1, (t - from) / (to - from)) - (onBeat ? 0 : acc) + (r() - 0.5);
      add(st, t, one(), 0.35 * Math.sin(2 * Math.PI * 0.17 * t) + 0.1 * (r() - 0.5), db(d));
    }
  };
  lay(hook.start + BEAT, hook.end - 2 * BEAT, 1, -24, -24);
  lay(product.start, product.end, 0.5, -25, -22);
  lay(system.start, LIFT_AT, 0.5, -22, -20);
  lay(LIFT_AT, CUT_GAP, 0.25, -18, -15.5);
  lay(u.start, rest, 0.5, -22, -21);
  lay(CUES.public.enter, stop, 0.25, -21, -15);
  return st;
}
function renderBell() { // sparse, distant FM plucks from A minor, ping-ponged and mostly reverb
  const r = rng('bell'), dry = mk(), { product: p, credit: c } = SCENES;
  const notes = [[88, p.start, 2], [84, p.start, 5], [81, p.start, 9], [83, p.start, 13], [88, p.start, 14.5], [88, c.start, 1.5], [91, c.start, 4.5], [84, c.start, 6.5], [86, c.start, 8.5], [88, c.start, 10.5]];
  for (const [m, t0, b] of notes) {
    const f = mtof(m), n = S(1.8), o = new Float32Array(n), ph0 = r();
    for (let i = 0; i < n; i++) { const t = i / SR, idx = 1.6 * Math.exp(-t / 0.09); o[i] = Math.sin(2 * Math.PI * (f * t + ph0) + idx * Math.sin(2 * Math.PI * 3.01 * f * t)) * Math.min(t / 0.002, 1) * Math.exp(-t / 0.42) * Math.min(1, (1.8 - t) / 0.1); }
    add(dry, t0 + b * BEAT, o, (r() - 0.5) * 0.5, 1);
  }
  const D = S(0.75 * BEAT), fb = 0.36, m = svf(Float32Array.from(dry.L, (v, i) => (v + dry.R[i]) * 0.5), 4200, 0.7), dL = new Float32Array(N), dR = new Float32Array(N);
  for (let i = D; i < N; i++) { dL[i] = m[i - D] * 0.6 + fb * dR[i - D]; dR[i] = fb * dL[i - D]; }
  const st = { L: new Float32Array(N), R: new Float32Array(N) };
  for (let i = 0; i < N; i++) { st.L[i] = dry.L[i] * 0.7 + dL[i]; st.R[i] = dry.R[i] * 0.7 + dR[i]; }
  filtSt(st, 500, 0.707, 'hp');
  return scale(st, db(-20) / peakOf(st));
}
function renderRiser() {
  const r = rng('riser'), st = mk(), at = SCENES.public.end - 4 * BEAT, stop = CUES.public.out, n = S(stop - at), span = SCENES.public.end - at, nf = (i) => 250 * (7000 / 250) ** (i / SR / span);
  const nl = svf(r.buf(n), nf, 1.4, 'bp'), nr = svf(r.buf(n), nf, 1.4, 'bp');
  const glide = (t) => mtof(45) * 2 ** (2 * t / span), lpf = (i) => 450 + 3800 * (i / n) ** 2;
  const sl = svf(saw(glide, n, { detune: -6, ph0: r() }), lpf, 0.9), sr = svf(saw(glide, n, { detune: 6, ph0: r() }), lpf, 0.9);
  const l = new Float32Array(n), rr = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = (i / n) ** 2.4 * Math.min(1, (n - i) / (0.025 * SR)); l[i] = (nl[i] * 1.6 + sl[i] * 0.35) * a; rr[i] = (nr[i] * 1.6 + sr[i] * 0.35) * a; }
  addLR(st, at, l, rr, 1);
  return scale(st, db(-11) / peakOf(st));
}
function renderSfx() { // keystrokes and chip ticks: band-passed noise at A5/E6, three rotated takes, no pitched blips
  const r = rng('sfx'), st = mk(), { typeStart, typeStep, chipsIn, chipStep } = CUES.public;
  const take = (fc, Q) => { const n = S(0.04), o = svf(r.buf(n), fc, Q, 'bp'); for (let i = 0; i < n; i++) { const t = i / SR; o[i] *= Math.min(t / 0.0004, 1) * Math.exp(-t / 0.009) * Math.min(1, (n - i) / 48); } let pk = 0; for (const v of o) pk = Math.max(pk, Math.abs(v)); for (let i = 0; i < n; i++) o[i] /= pk; return o; };
  const takes = [take(mtof(81), 3.5), take(mtof(88), 3.5), take(mtof(81) * 1.2, 3)];
  const cmd = LINES.find((l) => l.g === 'cmd'), keys = Math.round((cmd.settled - typeStart) / typeStep) + 1; // 17 chars: npx ccstatusboard
  for (let i = 0; i < keys; i++) add(st, typeStart + i * typeStep, takes[i % 3], 0.18 * Math.sin(i * 1.7), db(SFX_DB + (r() - 0.5) * 1.2));
  cue(typeStart, `Typing SFX: ${keys} key ticks at ${typeStep}s, A5/E6 band`);
  const chips = LINES.find((l) => l.g === 'public2').text.split(' ').length;
  for (let i = 0; i < chips; i++) add(st, chipsIn + i * chipStep, takes[i % 3], -0.35 + 0.7 * i / Math.max(1, chips - 1), db(SFX_DB));
  cue(chipsIn, `Chip ticks: ${chips} at ${chipStep}s`);
  return st;
}
const SFX_DB = Number(process.env.SFX_DB ?? -6.5);

// ---------- 8-line FDN reverb ----------
function fdnReverb(input, { t60 = 5.5, pre = 0.04 } = {}) {
  const inL = svf(svf(input.L, 180, 0.707, 'hp'), 6000, 0.707), inR = svf(svf(input.R, 180, 0.707, 'hp'), 6000, 0.707);
  const PRE = S(pre), M = 8, lens = [1777, 2063, 2539, 2927, 3407, 3793, 4271, 4657]; // primes, 37..97 ms at 48 kHz
  const margin = 40, lines = lens.map((l) => new Float64Array(l + margin + 2)), w = new Int32Array(M), lp = new Float64Array(M), v = new Float64Array(M);
  const gains = lens.map((l) => 10 ** (-3 * (l / SR) / t60)), damp = 0.3, h8 = 1 / Math.sqrt(8);
  const rates = [0.11, 0.17, 0.13, 0.19, 0.23, 0.07, 0.29, 0.31].map((f) => 2 * Math.PI * f / SR);
  const diffuse = (x) => {
    let o = x;
    for (const ms of [5, 7, 11, 13]) {
      const d = S(ms / 1000), g = 0.6, buf = new Float32Array(d), out = new Float32Array(N); let p = 0;
      for (let i = 0; i < N; i++) { const z = buf[p], y = z - g * o[i]; buf[p] = o[i] + g * y; out[i] = y; p = (p + 1) % d; }
      o = out;
    }
    return o;
  };
  const dl = diffuse(inL), dr = diffuse(inR), out = mk();
  for (let i = 0; i < N; i++) {
    const a = i >= PRE ? dl[i - PRE] : 0, b = i >= PRE ? dr[i - PRE] : 0;
    for (let m = 0; m < M; m++) {
      const buf = lines[m], len = buf.length, mod = margin * 0.25 * (1 + Math.sin(rates[m] * i + m)), rd = w[m] - lens[m] - mod, ri = Math.floor(rd), fr = rd - ri;
      const i0 = (ri % len + len) % len, i1 = (i0 + 1) % len, s = buf[i0] * (1 - fr) + buf[i1] * fr;
      lp[m] = s * (1 - damp) + lp[m] * damp;
      v[m] = lp[m] * gains[m];
    }
    out.L[i] = (v[0] - v[1] + v[2] - v[3] + v[4] - v[5] + v[6] - v[7]) * 0.5;
    out.R[i] = (v[0] + v[1] - v[2] - v[3] + v[4] + v[5] - v[6] - v[7]) * 0.5;
    for (let h = 4; h >= 1; h >>= 1) for (let s = 0; s < M; s += 2 * h) for (let q = s; q < s + h; q++) { const x = v[q], y = v[q + h]; v[q] = x + y; v[q + h] = x - y; }
    for (let m = 0; m < M; m++) {
      const buf = lines[m];
      buf[w[m]] = v[m] * h8 + (m % 2 ? b : a) * (m & 2 ? -0.5 : 0.5);
      w[m] = (w[m] + 1) % buf.length;
    }
  }
  return out;
}

// ---------- sidechain ----------
function sidechain(busM) { // 0..1 duck amount from the real hit bus: 5 ms lookahead, 3 ms attack, 350 ms release
  const LA = S(0.005), at = Math.exp(-1 / (0.003 * SR)), rel = Math.exp(-1 / (0.35 * SR)), ref = 0.2, s = new Float32Array(N);
  let env = 0;
  for (let i = 0; i < N; i++) { const x = Math.abs(i + LA < N ? busM[i + LA] : 0); env = x > env ? at * env + (1 - at) * x : rel * env + (1 - rel) * x; s[i] = Math.min(1, env / ref); }
  return s;
}
const duck = (st, s, depth) => { for (let i = 0; i < N; i++) { const g = 10 ** (-depth * s[i] / 20); st.L[i] *= g; st.R[i] *= g; } return st; };

// ---------- gates: the held breaths ----------
const { enter: ENTER, out: PUBLIC_OUT } = CUES.public, REST_AT = ENTER - 0.5 * BEAT, BOOM = IMPACTS[IMPACTS.length - 1].t;
const GATES = [
  { from: CUES.hook.titlesOut - 0.06, to: CUTS[0], floor: -60, wet: -52, fade: 0.12, rec: 0.004 },
  { from: CUT_GAP - 0.03, to: CUT_HIT, floor: -30, wet: -22, fade: 0.05, rec: 0.003 },
  { from: REST_AT - 0.04, to: ENTER, floor: -18, wet: -14, fade: 0.14, rec: 0.004 },
  { from: PUBLIC_OUT, to: CUTS[4], floor: -24, wet: -9, fade: 0.03, rec: 0.003 },
  { from: BOOM - 0.25, to: BOOM, floor: -11, wet: -9, fade: 0.2, rec: 0.003 },
];
function gateCurve(key) {
  const e = new Float32Array(N).fill(1);
  for (const g of GATES) {
    const i0 = S(g.from), i1 = S(g.to), a = S(g.fade), z = S(g.rec), fl = db(g[key]);
    for (let i = i0; i < i1; i++) {
      const u = i - i0, d = i1 - i, w = u < a ? Math.cos(0.5 * Math.PI * u / a) ** 2 : 0, r = d < z ? 1 - d / z : 0;
      e[i] *= Math.max(lerp(fl, 1, w), r);
    }
  }
  return e;
}

// ---------- master ----------
function master(m) {
  const n = m.L.length, side = new Float32Array(n), mid = new Float32Array(n);
  for (let i = 0; i < n; i++) { mid[i] = 0.5 * (m.L[i] + m.R[i]); side[i] = 0.5 * (m.L[i] - m.R[i]); }
  const sHp = svf(svf(side, 120, 0.707, 'hp'), 120, 0.707, 'hp'); // everything below 120 Hz is mono
  for (let i = 0; i < n; i++) { m.L[i] = mid[i] + sHp[i]; m.R[i] = mid[i] - sHp[i]; }
  filtSt(m, 28, 0.707, 'hp');
  const pre = 1.1;
  for (let i = 0; i < n; i++) { m.L[i] = Math.tanh(m.L[i] * MASTER_GAIN * pre) / pre; m.R[i] = Math.tanh(m.R[i] * MASTER_GAIN * pre) / pre; }
  // lookahead limiter: sliding minimum of required gain, 180 ms release, box smoothed over the lookahead
  const W = S(0.004), need = new Float32Array(n), mn = new Float32Array(n), g = new Float32Array(n), q = new Int32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(m.L[i]), Math.abs(m.R[i])); need[i] = p > CEILING ? CEILING / p : 1; }
  let head = 0, tail = 0, j = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + W);
    while (j <= hi) { while (tail > head && need[q[tail - 1]] >= need[j]) tail--; q[tail++] = j++; }
    while (q[head] < i - W) head++;
    mn[i] = need[q[head]];
  }
  const rel = 1 - Math.exp(-1 / (0.18 * SR)); let cur = 1;
  for (let i = 0; i < n; i++) { cur = Math.min(mn[i], cur + (1 - cur) * rel); g[i] = cur; }
  let worst = 1, over = 0, worstAt = 0; for (let i = 0; i < n; i++) { if (g[i] < worst) { worst = g[i]; worstAt = i / SR; } if (g[i] < 0.89) over++; }
  console.log(`limiter: max GR ${(-20 * Math.log10(worst)).toFixed(1)} dB at ${worstAt.toFixed(2)}s, ${(over / SR).toFixed(1)}s above 1 dB`);
  let acc = W; const win = 2 * W + 1;
  for (let k = 0; k <= W; k++) acc += g[k];
  for (let i = 0; i < n; i++) {
    const v = acc / win; m.L[i] *= v; m.R[i] *= v;
    acc += (i + 1 + W < n ? g[i + 1 + W] : 1) - (i - W >= 0 ? g[i - W] : 1);
  }
  // final fade reaches exact silence at DUR; 8 ms fade-in for click safety
  const f0 = S(DUR - 1.5), fn = N - 1 - f0;
  for (let i = f0; i < N; i++) { const v = Math.cos(0.5 * Math.PI * (i - f0) / fn) ** 2; m.L[i] *= v; m.R[i] *= v; }
  const fi = S(0.008);
  for (let i = 0; i < fi; i++) { m.L[i] *= i / fi; m.R[i] *= i / fi; }
  m.L[N - 1] = 0; m.R[N - 1] = 0;
  return m;
}

// ---------- wav io ----------
function wav24(file, st) {
  const buf = Buffer.alloc(44 + N * 6);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 6, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34); buf.write('data', 36); buf.writeUInt32LE(N * 6, 40);
  let o = 44;
  for (let i = 0; i < N; i++) for (const ch of [st.L, st.R]) { buf.writeIntLE(Math.round(Math.max(-1, Math.min(1, ch[i])) * 8388607), o, 3); o += 3; }
  fs.writeFileSync(file, buf);
}
function wavFloat(file, st) {
  const head = Buffer.alloc(44), data = new Float32Array(N * 2);
  head.write('RIFF', 0); head.writeUInt32LE(36 + N * 8, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 8, 28); head.writeUInt16LE(8, 32); head.writeUInt16LE(32, 34); head.write('data', 36); head.writeUInt32LE(N * 8, 40);
  for (let i = 0; i < N; i++) { data[2 * i] = st.L[i]; data[2 * i + 1] = st.R[i]; }
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(data.buffer)]));
}

// ---------- arrangement ----------
const T0 = Date.now();
const stems = {};
const hits = mk(), crack = mk(), braams = mk(), stab = mk();

// hits and braams
if (on('hits')) {
  const r = rng('hits');
  for (const im of IMPACTS) {
    const big = im.braam, boom = im.t === BOOM;
    if (im.enter) continue;
    impact(hits, crack, r, im.t, im.db, big ? { tauA: im.db >= 0 ? 1.0 : 1.3, len: 5 } : boom ? { fEnd: mtof(33), tauA: 0.9, len: 2, crackG: 1.1 } : im.t === CUT_HIT ? { tauA: 0.8, len: 3, crackG: 1.2 } : { tauA: 0.45, len: 2.4 });
    cue(im.t, `Impact ${im.db} dB${big ? ' + braam' : ''}${boom ? ' (A1 boom)' : ''}`);
  }
  const has = (t) => IMPACTS.some((im) => Math.abs(im.t - t) < 0.01);
  const pulse = (from, to, step, dB) => { for (let t = from; t < to - 1e-6; t += step) if (!has(t)) lowHit(hits, crack, r, t, dB); };
  pulse(SCENES.product.start, SCENES.product.end, 2 * BEAT, -6);
  cue(SCENES.product.start, 'Low hits on beats 1 and 3 begin, -6 dB');
  pulse(SCENES.system.start, SCENES.system.end, 2 * BEAT, -7);
  pulse(SCENES.public.start, REST_AT, 2 * BEAT, -7);
  pulse(SCENES.credit.start + 4 * BEAT, BOOM, 4 * BEAT, -8);
  const en = IMPACTS.find((im) => im.enter); // Enter: a short thud, not a long impact
  impact(hits, crack, r, en.t, en.db, { tauA: 0.28, len: 1.4 });
}
if (on('braam')) {
  const r = rng('braam');
  for (const im of IMPACTS) if (im.braam) braam(braams, r, im.t, im.db, im.db >= 0 ? { top: 3800, hold: 0.8, tau: 0.75 } : { top: 3000, hold: 0.9, tau: 1.1, trim: -4.5 });
}
if (on('stab')) { const en = IMPACTS.find((im) => im.enter); enterStab(stab, rng('stab'), en.t, -13); cue(en.t, 'Enter hit: thud + A2 stab; chip ticks follow'); }

// lead and sub
if (on('lead') || on('sub')) {
  const { lead, sub } = renderLead();
  if (on('lead')) stems.lead = lead;
  if (on('sub')) stems.sub = sub;
}
if (on('drone')) stems.drone = renderDrone();
if (on('pad')) {
  const { product: p, system: y, public: u, credit: c } = SCENES;
  stems.pad = renderPad([[p.start, -12], [p.end, -10], [LIFT_AT, -9.5], [LIFT_AT + 0.5 * BEAT, -7.5], [y.end, -7], [y.end, -8], [CUES.public.typeStart - 0.3, -8], [CUES.public.typeStart, -13], [CUES.public.enter - 1.5, -13], [CUES.public.enter, -12], [CUES.public.enter + 0.8, -12], [CUES.public.enter + 1.6, -8], [u.end, -7.5], [c.start, -6], [DUR, -8]]);
  cue(p.start, 'Pad Am-F-Dm-Em, -14 dB, slowly rising'); cue(y.start, 'Pad rising, chords follow the lead; ticks in 8ths'); cue(LIFT_AT, 'Tension lift: ticks to 16ths, pad and its filter step up'); cue(CUT_GAP, 'Held breath before the Public cut');
  cue(c.start, 'Full pad: Am-C-F-Bb-Am (Phrygian Bb against A)');
}
if (on('ticks')) stems.ticks = renderTicks();
if (on('bell')) stems.bell = renderBell();
if (on('riser')) { stems.riser = renderRiser(); cue(SCENES.public.end - 4 * BEAT, 'Riser: noise BP 250 Hz-7 kHz + saw glide A2-A4'); }
if (on('sfx')) stems.sfx = renderSfx();
stems.braam = braams; stems.stab = stab; stems.hits = hits; stems.crack = crack;

// sidechain from the real hit bus
const busM = new Float32Array(N); for (let i = 0; i < N; i++) busM[i] = 0.5 * (hits.L[i] + hits.R[i]);
const sc = sidechain(busM);
for (const k of ['lead', 'sub', 'pad']) if (stems[k]) duck(stems[k], sc, DUCK_DB[k]);

// breaths
const bedG = gateCurve('floor'), wetG = gateCurve('wet');
for (const k of ['lead', 'sub', 'pad', 'drone', 'bell', 'ticks']) if (stems[k]) mulBy(stems[k], bedG);

// reverb
if (on('reverb')) {
  const send = mk();
  for (const [k, g] of Object.entries(SENDS)) if (stems[k]) sumInto(send, stems[k], g);
  const wet = scale(fdnReverb(send), REVERB_WET);
  duck(wet, sc, DUCK_DB.reverb); mulBy(wet, wetG);
  stems.reverb = wet;
}

// mix, master, write
const mix = mk();
for (const st of Object.values(stems)) sumInto(mix, st);
const out = master(mix);
if (LAYERS) wav24(path.join(WORK, 'preview.wav'), out);
else {
  for (const [name, st] of Object.entries(stems)) wavFloat(path.join(WORK, `stem_${name}.wav`), st);
  const file = path.join(here, 'music.wav');
  wav24(file, out);
  fs.copyFileSync(file, path.resolve(here, '../composition/assets/music.wav'));

  cue(0, 'Cold drone, sparse ticks on the beat at -24 dB');
  cue(SCENES.hook.end - 2, 'Swell into the first hit');
  cue(GATES[0].from, 'Held breath: near-silence until the cut');
  cue(REST_AT, 'Lead rest and bed dip before Enter');
  cue(PUBLIC_OUT, 'Riser cuts; breath before the climax');
  cue(DUR - 1.5, 'Master fade begins; exact silence at the last sample');
  cue(DUR, `End (sample ${N})`);
  cues.sort((a, b) => a[0] - b[0]);
  const pos = (t) => t < 2 ? `pickup beat ${Math.floor(t / BEAT) + 1}` : `bar ${Math.floor((t - 2) / 4) + 1} beat ${Math.floor(((t - 2) % 4) / BEAT) + 1}`;
  const noteName = (m) => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][m % 12] + (Math.floor(m / 12) - 1);
  const md = `# ccstatusboard soundtrack cues\n\nGenerated by \`node audio/synth.mjs\` from \`timing.mjs\`. ${BPM} BPM, A minor with Phrygian Bb, 48 kHz stereo, ${DUR}.000 s. Downbeats at 2+4k. Scene cuts: ${CUTS.join(', ')}.\n\n| Time (s) | Position | Cue |\n|---|---|---|\n`
    + cues.map(([t, w]) => `| ${t.toFixed(3)} | ${pos(t)} | ${w} |`).join('\n')
    + `\n\n## Bass lead\n\n| Section | Filter base-peak (Hz) | k | Notes |\n|---|---|---|---|\n`
    + SCORE.map((s) => `| ${s.from}-${s.to} | ${s.base}-${s.peak} | ${s.k} | ${s.notes.map(([m, t, b]) => `${noteName(m)}@${t}(${b})`).join(' ')} |`).join('\n') + '\n';
  fs.writeFileSync(path.join(here, 'cues.md'), md);
}
console.log(`rendered ${LAYERS ? 'preview ' + [...LAYERS].join('+') : 'full mix'} in ${((Date.now() - T0) / 1000).toFixed(1)}s`);
