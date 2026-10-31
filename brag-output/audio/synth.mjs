// ccstatusboard launch-video soundtrack. Pure Node synth. Run: node brag-output/audio/synth.mjs
// 120 BPM, 4/4, A minor, 24.000 s @ 48 kHz stereo, everything on the sample-exact beat grid.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SR = 48000, BEAT = 0.5, BAR = 2, DUR = 24, N = SR * DUR;
const GAIN = Number(process.env.GAIN ?? 0.7); // master drive, tuned for ~-14 LUFS
const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '../work/audio');
fs.mkdirSync(WORK, { recursive: true });

// ---------- utils ----------
let seed = 20241011;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const S = (t) => Math.round(t * SR);
const mk = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
function add(st, t0, arr, p = 0, g = 1) {
  const [gl, gr] = pan(p); const i0 = S(t0);
  for (let i = 0; i < arr.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; st.L[j] += arr[i] * gl * g; st.R[j] += arr[i] * gr * g; }
}
function addLR(st, t0, l, r, g = 1) {
  const i0 = S(t0);
  for (let i = 0; i < l.length; i++) { const j = i0 + i; if (j < 0 || j >= N) continue; st.L[j] += l[i] * g; st.R[j] += r[i] * g; }
}
function svf(x, fc, Q = 0.707, mode = 'lp') {
  const out = new Float32Array(x.length); let s1 = 0, s2 = 0, last = -1, g, a1, a2, a3; const k = 1 / Q;
  const f = typeof fc === 'function' ? fc : () => fc;
  for (let i = 0; i < x.length; i++) {
    const c = f(i);
    if (c !== last) { g = Math.tan(Math.PI * Math.min(c, SR * 0.45) / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; last = c; }
    const v3 = x[i] - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
    s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
    out[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : x[i] - k * v1 - v2;
  }
  return out;
}
const filtSt = (st, ...a) => { st.L = svf(st.L, ...a); st.R = svf(st.R, ...a); return st; };
const env = (t, dur, a, tau, r) => Math.max(0, Math.min(t / a, 1) * Math.exp(-t / tau) * Math.min(1, (dur - t) / r));
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
const sawP = (ph, dt) => 2 * ph - 1 - blep(ph, dt);
function osc(type, f, n, { duty = 0.5, detune = 0, ph0 = 0 } = {}) {
  const out = new Float32Array(n); let ph = ph0; const dm = 2 ** (detune / 1200);
  for (let i = 0; i < n; i++) {
    const fr = (typeof f === 'function' ? f(i / SR) : f) * dm, dt = fr / SR;
    out[i] = type === 'sine' ? Math.sin(2 * Math.PI * ph)
      : type === 'saw' ? sawP(ph, dt)
      : sawP(ph, dt) - sawP((ph + duty) % 1, dt);
    ph += dt; if (ph >= 1) ph -= 1;
  }
  return out;
}
function tone(type, f, dur, a, tau, r, opts, g = 1) {
  const n = S(dur), o = osc(type, f, n, opts);
  for (let i = 0; i < n; i++) o[i] *= env(i / SR, dur, a, tau, r) * g;
  return o;
}
function reverb(st, wet = 1) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116], aps = [556, 441, 341, 225];
  const out = { L: new Float32Array(N), R: new Float32Array(N) };
  for (const ch of ['L', 'R']) {
    const off = ch === 'R' ? 23 : 0, x = st[ch], y = out[ch];
    for (const cl of combs) {
      const len = cl + off, buf = new Float32Array(len); let p = 0, lp = 0;
      for (let i = 0; i < N; i++) { const o = buf[p]; lp = o * 0.75 + lp * 0.25; buf[p] = x[i] * 0.2 + lp * 0.86; p = (p + 1) % len; y[i] += o; }
    }
    for (const al of aps) {
      const len = al + off, buf = new Float32Array(len); let p = 0;
      for (let i = 0; i < N; i++) { const b = buf[p], v = y[i] + b * 0.5; buf[p] = v; y[i] = b - v * 0.5; p = (p + 1) % len; }
    }
    for (let i = 0; i < N; i++) y[i] *= wet * 0.25;
  }
  return out;
}
function duckEnv(depth, tau = 0.1, t0 = 4, t1 = 22) {
  const d = new Float32Array(N).fill(1), ramp = 0.004;
  for (let i = S(t0); i < S(t1); i++) {
    const tb = (i / SR) % BEAT, f = (t) => 1 - depth * Math.exp(-t / tau);
    d[i] = tb > BEAT - ramp ? f(BEAT - ramp) + (1 - depth - f(BEAT - ramp)) * ((tb - (BEAT - ramp)) / ramp) : f(tb);
  }
  return d;
}
const applyEnv = (st, e) => { for (let i = 0; i < N; i++) { st.L[i] *= e[i]; st.R[i] *= e[i]; } };

// ---------- cue list ----------
const cues = [];
const cue = (t, what) => cues.push([t, what]);

// ---------- drum voices ----------
function kick() {
  const n = S(0.5), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 46 + 130 * Math.exp(-t / 0.022); ph += f / SR; o[i] = Math.tanh(1.4 * Math.sin(2 * Math.PI * ph)) * Math.min(t / 0.001, 1) * Math.exp(-t / 0.15) * Math.min(1, (0.5 - t) / 0.02); }
  return o;
}
function snare() {
  const n = S(0.3), nz = svf(Float32Array.from({ length: n }, noise), 1900, 0.9, 'bp'), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += (165 + 70 * Math.exp(-t / 0.02)) / SR; o[i] = (nz[i] * 1.6 * Math.exp(-t / 0.08) + Math.sin(2 * Math.PI * ph) * 0.5 * Math.exp(-t / 0.05)) * Math.min(t / 0.001, 1) * Math.min(1, (0.3 - t) / 0.02); }
  return o;
}
function hatHit(len = 0.12, tau = 0.022) {
  const n = S(len), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; o[i] = noise() * Math.min(t / 0.0006, 1) * Math.exp(-t / tau) * Math.min(1, (len - t) / 0.01); }
  return o;
}

// ---------- stems ----------
const drums = mk(), hats = mk(), bass = mk(), pad = mk(), arp = mk(), hook = mk(), fx = mk(), stab = mk(), riser = mk();
const K = kick(), SN = snare();
const kickMono = new Float32Array(N); // mono kick bus (kick + sub)
const kadd = (t, g) => { const i0 = S(t); for (let i = 0; i < K.length && i0 + i < N; i++) kickMono[i0 + i] += K[i] * g; };

// chords: [root bass midi, pad voicing, arp tones]
const CH = {
  Am: { b: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  F:  { b: 29, pad: [57, 60, 65], arp: [65, 69, 72, 77] },
  C:  { b: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] },
  G:  { b: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
};
// chord at time t (4..22): Am F C G x2, then F|G in the lift bar
const prog = ['Am', 'F', 'C', 'G'];
const chordAt = (t) => t >= 20 ? (t < 21 ? CH.F : CH.G) : CH[prog[Math.floor((t - 4) / BAR) % 4]];

// ===== HOOK 0-4 =====
cue(0, 'Hook starts: A1 bass 8ths, ticking hats (8ths), typing clicks (16ths, to 2.5s)');
for (let k = 0; k < 8 * 7; k++) { // 8ths, 0..3.5 (+3.5 note swept by the drop)
  const t = k * 0.25, g = 0.55 + 0.45 * Math.min(t / 3.5, 1);
  const o = tone('saw', mtof(33), 0.21, 0.003, 0.11, 0.02, {}, 0.45);
  const s = tone('sine', mtof(33), 0.21, 0.003, 0.14, 0.02, {}, 0.7);
  for (let i = 0; i < o.length; i++) o[i] += s[i];
  add(hook, t, svf(o, 300, 0.8), 0, 0.5 * g);
}
for (let k = 0; k < 16; k++) add(hats, k * 0.25 + 0.0, hatHit(0.1, 0.018), 0.2, 0.05 + 0.02 * (k % 2 ? 0 : 1)); // ticking 8ths
for (let k = 0; k < 20; k++) { // typing: 16ths 0..2.5
  if (rnd() < 0.3) continue; // humanise by skipping
  const t = k * 0.125, n = S(0.04), fc = 1400 + rnd() * 2200;
  const c = svf(Float32Array.from({ length: n }, (_, i) => noise() * Math.exp(-i / SR / 0.005) * Math.min(i / SR / 0.0005, 1)), fc, 5, 'bp');
  const th = tone('sine', 120 + rnd() * 60, 0.03, 0.0005, 0.006, 0.005, {}, 0.25);
  for (let i = 0; i < th.length; i++) c[i] = c[i] * 1.4 + th[i];
  add(hook, t, c, rnd() * 0.8 - 0.4, 0.07 * (0.6 + 0.4 * rnd()));
}
cue(2.5, 'Typing clicks end');
cue(3.0, 'Error chime: descending Am square E5-C5-A4 (3.000/3.125/3.250), riser starts');
[76, 72, 69].forEach((m, k) => {
  const o = tone('pulse', mtof(m), 0.45, 0.002, 0.11, 0.05, { duty: 0.5 }, 0.5);
  add(hook, 3.0 + k * 0.125, svf(o, 2800, 0.7), 0.1, 0.16);
});
// drop 3.5-4.0: filtered fall to near silence (applies to everything in hook stem)
cue(3.5, 'Filtered drop to near-silence begins (LP sweep + fade over 0.5s)');
{
  const i0 = S(3.5), i1 = S(4.0);
  const fcf = (i) => i < i0 ? 14000 : 14000 * (130 / 14000) ** (Math.min((i - i0) / (i1 - i0), 1));
  hook.L = svf(hook.L, fcf, 0.9); hook.R = svf(hook.R, fcf, 0.9);
  for (let i = i0; i < N; i++) { const u = Math.min((i - i0) / (i1 - i0), 1), g = i >= i1 ? 0 : (1 - u) ** 2 * 0.97 + 0.03 * (1 - u); hook.L[i] *= g; hook.R[i] *= g; }
  hats.L.fill(0, i0, i1); hats.R.fill(0, i0, i1); // hat ticks stop at the drop
}
// riser 3.0 -> 4.0 (reverse swell: noise BP sweep + saw glide A3->A4)
{
  const n = S(1.0), nl = Float32Array.from({ length: n }, noise), nr = Float32Array.from({ length: n }, noise);
  const fc = (i) => 250 * (7000 / 250) ** (i / n);
  const bl = svf(nl, fc, 1.5, 'bp'), br = svf(nr, fc, 1.5, 'bp');
  const sw = osc('saw', (t) => 110 * 2 ** (t * 1.0 + 1), n, { detune: 6 }); const sw2 = osc('saw', (t) => 110 * 2 ** (t * 1.0 + 1), n, { detune: -6 });
  const swf = svf(sw, (i) => 400 + 3000 * (i / n) ** 2, 1.2), swf2 = svf(sw2, (i) => 400 + 3000 * (i / n) ** 2, 1.2);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { const u = i / n, a = u ** 2.6 * Math.min(1, (n - i) / (0.003 * SR)); l[i] = (bl[i] * 1.8 + swf[i] * 0.22) * a; r[i] = (br[i] * 1.8 + swf2[i] * 0.22) * a; }
  addLR(riser, 3.0, l, r, 0.55);
}

// ===== REVEAL 4 =====
cue(4.0, 'REVEAL: kick + sub A1 + detuned saw pad Am; groove starts (4-on-floor, offbeat hats, pumping bass, 16th arp)');
{
  const sub = tone('sine', mtof(33), 1.9, 0.004, 0.7, 0.2, {}, 0.5);
  const i0 = S(4.0); for (let i = 0; i < sub.length; i++) kickMono[i0 + i] += sub[i];
}
for (let t = 4; t < 22; t += BEAT) kadd(t, t === 4 ? 1.15 : 1.0);
cue(8.0, 'Energy step 1: snare on 2 & 4 added; transition sfx');
cue(16.0, 'Energy step 2: arp octave layer added; transition sfx');
for (let t = 8; t < 22; t += BAR) { add(drums, t + 0.5, SN, -0.05, 0.42); add(drums, t + 1.5, SN, 0.05, 0.42); }
for (let t = 4; t < 22; t += BEAT) add(hats, t + 0.25, hatHit(0.13, 0.03), 0.25, 0.14);

// bass 4..22: 8ths following chord root
for (let k = 0; k < 36; k++) {
  const t = 4 + k * 0.25, c = chordAt(t), oct = (k % 8 === 2 || k % 8 === 6) ? 12 : 0, f = mtof(c.b + oct);
  const o = tone('saw', f, 0.23, 0.002, 0.13, 0.02, {}, 0.5), s = tone('sine', mtof(c.b + oct), 0.23, 0.002, 0.2, 0.02, {}, 0.8);
  for (let i = 0; i < o.length; i++) o[i] += s[i];
  add(bass, t, svf(o, 650, 0.8), 0, 0.5);
}

// pad: detuned saws, bar-long chords; lift bar splits F|G
function padChord(t, dur, c, att = 0.03) {
  for (const m of c.pad) {
    [[-11, -0.8], [0, 0], [11, 0.8], [-5, 0.4], [5, -0.4]].forEach(([d, p]) => {
      const o = tone('saw', mtof(m), dur + 0.15, att, 1e9, 0.15, { detune: d, ph0: rnd() }, 0.045);
      add(pad, t, o, p);
    });
  }
}
padChord(4, 2, CH.Am, 0.012);
for (let t = 6; t < 20; t += BAR) padChord(t, 2, chordAt(t));
padChord(20, 1, CH.F); padChord(21, 1, CH.G);
{ // pad lowpass; opens during the 20-22 lift
  const fcf = (i) => i < S(20) ? 1500 : 1500 * (11000 / 1500) ** Math.min((i - S(20)) / SR / 2, 1);
  filtSt(pad, fcf, 0.8);
}
cue(20.0, 'LIFT: crash, pad filter opens (1.5k -> 11k over 2s), F | G bar, transition sfx');
cue(21.0, 'Lift: chord moves F -> G');

// arp: square 16ths with ping-pong delay
const arpDry = mk(), pat = [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1];
for (let k = 0; k < 16 * 9; k++) { // 4..22 in 16ths = 144 steps
  const t = 4 + k * 0.125, c = chordAt(t), step = k % 16, m = c.arp[pat[step]];
  const p = (k % 2 ? 1 : -1) * 0.35;
  add(arpDry, t, tone('pulse', mtof(m), 0.11, 0.001, 0.055, 0.012, { duty: 0.25 }, 0.2), p);
  if (t >= 16) add(arpDry, t, tone('pulse', mtof(m + 12), 0.09, 0.001, 0.04, 0.01, { duty: 0.5 }, 0.1), -p);
}
{
  const fcf = (i) => i < S(20) ? 4500 : 4500 * (12000 / 4500) ** Math.min((i - S(20)) / SR / 2, 1);
  filtSt(arpDry, fcf, 0.7);
  const D = S(0.375), dL = new Float32Array(N), dR = new Float32Array(N), fb = 0.45;
  const xm = svf(Float32Array.from(arpDry.L, (v, i) => (v + arpDry.R[i]) * 0.5), 3200, 0.7);
  for (let i = D; i < N; i++) { dL[i] = xm[i - D] * 0.55 + fb * dR[i - D]; dR[i] = fb * dL[i - D]; }
  for (let i = 0; i < N; i++) { arp.L[i] = arpDry.L[i] + dL[i]; arp.R[i] = arpDry.R[i] + dR[i]; }
}

// crash at 20
{
  const n = S(2.2), l = svf(Float32Array.from({ length: n }, noise), 4500, 0.7, 'hp'), r = svf(Float32Array.from({ length: n }, noise), 4500, 0.7, 'hp');
  for (let i = 0; i < n; i++) { const t = i / SR, e = Math.min(t / 0.001, 1) * Math.exp(-t / 0.55) * Math.min(1, (2.2 - t) / 0.2); l[i] *= e; r[i] *= e; }
  addLR(drums, 20, svf(l, 11000, 0.6), svf(r, 11000, 0.6), 0.3);
}

// transition sfx at 8, 12, 16, 20: whoosh in + tuned glitch blips + short airy tail
function transition(t, blips) {
  const wl = 0.75, n = S(wl);
  const fc = (i) => 250 * (5500 / 250) ** (i / n);
  const l = svf(Float32Array.from({ length: n }, noise), fc, 1.2, 'bp'), r = svf(Float32Array.from({ length: n }, noise), fc, 1.2, 'bp');
  for (let i = 0; i < n; i++) { const u = i / n, a = Math.sin(u * Math.PI / 2) ** 3 * Math.min(1, (n - i) / (0.004 * SR)); l[i] *= a; r[i] *= a; }
  addLR(fx, t - wl, l, r, 0.55);
  const tn = S(0.45), tl = svf(Float32Array.from({ length: tn }, noise), (i) => 4000 * (300 / 4000) ** (i / tn), 1.0, 'bp'), tr = svf(Float32Array.from({ length: tn }, noise), (i) => 4000 * (300 / 4000) ** (i / tn), 1.0, 'bp');
  for (let i = 0; i < tn; i++) { const e = Math.min(i / (0.002 * SR), 1) * Math.exp(-i / SR / 0.1) * Math.min(1, (tn - i) / (0.02 * SR)); tl[i] *= e; tr[i] *= e; }
  addLR(fx, t, tl, tr, 0.4);
  const notes = [88, 93, 96, 100, 88, 93, 96, 100].slice(0, blips); // E6 A6 C7 E7 (A minor tones, up high)
  for (let k = 0; k < blips; k++) {
    const bt = t - blips * 0.0625 + k * 0.0625, o = tone('pulse', mtof(notes[k] - 24), 0.0625, 0.0008, 0.03, 0.004, { duty: 0.5 }, 0.5);
    let h = 0; for (let i = 0; i < o.length; i++) { if (i % 6 === 0) h = Math.round(o[i] * 6) / 6; o[i] = h; } // bit/rate crush
    add(fx, bt, svf(o, 5000, 0.7), (k % 2 ? 0.5 : -0.5), 0.2);
  }
  cue(t - wl, `  sfx whoosh in starts (cut at ${t.toFixed(1)}s)`);
  cue(t - blips * 0.0625, `  sfx glitch blips x${blips} (E-A-C-E arp, bitcrushed square) into cut ${t.toFixed(1)}s`);
  cue(t, `  sfx tail (airy noise fall, 0.45s) after cut ${t.toFixed(1)}s`);
}
transition(8, 4); transition(12, 4); transition(16, 6); transition(20, 8);

// ===== OUTRO 22 =====
cue(22.0, 'OUTRO: final Am chord stab (A2 E3 A3 C4 E4 A4, saws + kick + sub), reverb tail');
cue(22.5, 'Master fade (cos^2) begins; reaches exact silence at 24.0');
cue(24.0, 'End (sample 1152000)');
{
  kadd(22, 1.05);
  const sub = tone('sine', mtof(33), 2.0, 0.004, 0.6, 0.2, {}, 0.45); const i0 = S(22); for (let i = 0; i < sub.length && i0 + i < N; i++) kickMono[i0 + i] += sub[i];
  for (const m of [45, 52, 57, 60, 64, 69]) {
    [[-8, -0.7], [0, 0], [8, 0.7]].forEach(([d, p]) => add(stab, 22, tone('saw', mtof(m), 2.0, 0.003, 0.7, 0.05, { detune: d, ph0: rnd() }, 0.075), p));
  }
  filtSt(stab, (i) => 7000 * Math.exp(-(i / SR - 22) / 0.5) + 1200, 0.9);
}

// ---------- mix ----------
applyEnv(bass, duckEnv(0.72, 0.11)); applyEnv(pad, duckEnv(0.4, 0.12)); applyEnv(arp, duckEnv(0.22, 0.1));
filtSt(hats, 6500, 0.7, 'hp'); filtSt(hats, 9500, 0.6);
const kickSt = { L: kickMono, R: kickMono };
const revIn = mk(); for (let i = 0; i < N; i++) { revIn.L[i] = pad.L[i] * 0.35 + stab.L[i] * 1.0 + arp.L[i] * 0.2 + drums.L[i] * 0.1; revIn.R[i] = pad.R[i] * 0.35 + stab.R[i] * 1.0 + arp.R[i] * 0.2 + drums.R[i] * 0.1; }
const rev = reverb(revIn, 0.5);
// mono-ise bass and kick explicitly (already mono, pan 0)
const mix = mk();
const parts = [[kickSt, 1.0], [drums, 1.0], [hats, 1.0], [bass, 1.0], [pad, 1.0], [arp, 1.0], [hook, 1.6], [riser, 1.0], [fx, 1.0], [stab, 1.0], [rev, 1.0]];
for (const [st, g] of parts) for (let i = 0; i < N; i++) { mix.L[i] += st.L[i] * g; mix.R[i] += st.R[i] * g; }

// ---------- master ----------
function master(m) {
  m.L = svf(m.L, 28, 0.707, 'hp'); m.R = svf(m.R, 28, 0.707, 'hp');
  m.L = svf(m.L, 17000, 0.7); m.R = svf(m.R, 17000, 0.7);
  for (let i = 0; i < N; i++) { m.L[i] = Math.tanh(m.L[i] * GAIN * 1.15) / 1.15; m.R[i] = Math.tanh(m.R[i] * GAIN * 1.15) / 1.15; }
  // lookahead limiter, ceiling -2.0 dBFS (margin for true peak)
  const ceil = Math.pow(10, -2.0 / 20), W = 240, need = new Float32Array(N);
  for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(m.L[i]), Math.abs(m.R[i])); need[i] = p > ceil ? ceil / p : 1; }
  const mn = new Float32Array(N); // sliding min over [i-W, i+W] (monotonic deque)
  const dq = []; let j = 0;
  for (let i = 0; i < N; i++) { const hi = Math.min(N - 1, i + W); while (j <= hi) { while (dq.length && need[dq[dq.length - 1]] >= need[j]) dq.pop(); dq.push(j); j++; } while (dq[0] < i - W) dq.shift(); mn[i] = need[dq[0]]; }
  const gs = new Float32Array(N); let acc = 0; const win = W + 1;
  for (let i = 0; i < N + W; i++) { if (i < N) acc += mn[i]; if (i - win >= 0 && i - win < N) acc -= mn[i - win]; if (i - W >= 0 && i - W < N) gs[i - W] = acc / win; }
  // edges: mn is 1 outside, treat missing as 1 -> acc includes only present; fix by clamping
  for (let i = 0; i < N; i++) { const g = Math.min(gs[i] || 1, 1); m.L[i] *= g; m.R[i] *= g; }
  // fade out 22.5 -> 24.0 (cos^2) to exact silence
  const f0 = S(22.5);
  for (let i = f0; i < N; i++) { const u = (i - f0) / (N - 1 - f0), g = 0.5 + 0.5 * Math.cos(Math.PI * u); m.L[i] *= g; m.R[i] *= g; }
  // 8 ms fade-in at sample 0 for click safety
  for (let i = 0; i < S(0.008); i++) { const g = i / S(0.008); m.L[i] *= g; m.R[i] *= g; }
  m.L[N - 1] = 0; m.R[N - 1] = 0;
  return m;
}

// ---------- wav io ----------
function wav(file, st, bits) {
  const bps = bits / 8, buf = Buffer.alloc(44 + N * 2 * bps), fmt = bits === 32 ? 3 : 1;
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2 * bps, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(fmt, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2 * bps, 28); buf.writeUInt16LE(2 * bps, 32); buf.writeUInt16LE(bits, 34); buf.write('data', 36); buf.writeUInt32LE(N * 2 * bps, 40);
  let o = 44;
  for (let i = 0; i < N; i++) for (const ch of [st.L, st.R]) {
    if (bits === 32) { buf.writeFloatLE(ch[i], o); o += 4; }
    else { const v = Math.max(-1, Math.min(1, ch[i])) * 8388607; buf.writeIntLE(Math.round(v), o, 3); o += 3; }
  }
  fs.writeFileSync(file, buf);
}
for (const [name, st] of Object.entries({ kick: kickSt, drums, hats, bass, pad, arp, hook, riser, fx, stab, reverb: rev })) wav(path.join(WORK, `stem_${name}.wav`), st, 32);
const out = master(mix);
wav(path.join(here, 'music.wav'), out, 24);

// ---------- cues.md ----------
cues.sort((a, b) => a[0] - b[0]);
const bt = (t) => `bar ${Math.floor(t / BAR) + 1} beat ${Math.floor((t % BAR) / BEAT) + 1}${(t % BEAT) ? ' +' + (t % BEAT).toFixed(4) : ''}`;
const md = `# ccstatusboard soundtrack cues\n\n120 BPM, 4/4, A minor, 48 kHz stereo, 24.000 s (12 bars, 1,152,000 samples). Beat = 0.5 s, bar = 2 s.\nChords 4-20s: Am - F - C - G (one per bar, twice). 20-22s: F | G. Outro: Am.\n\n| Time (s) | Position | Cue |\n|---|---|---|\n` + cues.map(([t, w]) => `| ${t.toFixed(4)} | ${bt(t)} | ${w} |`).join('\n') + `\n\nScene cuts: 4, 8, 12, 16, 20, 22 s. Regenerate: \`node brag-output/audio/synth.mjs\`.\n`;
fs.writeFileSync(path.join(here, 'cues.md'), md);
console.log('done');
