import fs from 'node:fs';
const f=process.argv[2]; let s=fs.readFileSync(f,'utf8');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('missing '+a); s=s.split(a).join(b); };
rep("// ccstatusboard launch-video soundtrack. Pure Node synth. Run: node brag-output/audio/synth.mjs","// ccstatusboard LinkedIn video soundtrack. Pure Node synth. Run: node <folder>/audio/synth.mjs");
rep("function duckEnv(depth, tau = 0.1, t0 = 4, t1 = 22)","function duckEnv(depth, tau = 0.1, t0 = 4, t1 = 20)");
rep("t >= 20 ? (t < 21 ? CH.F : CH.G)","t >= 18 ? (t < 19 ? CH.F : CH.G)");
// hook: soft two-note "waiting" on the 2.0s beat instead of an error chime
rep("cue(3.0, 'Error chime: descending Am square E5-C5-A4 (3.000/3.125/3.250), riser starts');","cue(2.0, 'Waiting tone: E5 then C5, soft, as the pane turns amber');");
rep("[76, 72, 69].forEach((m, k) => {","[76, 72].forEach((m, k) => {");
rep("add(hook, 3.0 + k * 0.125, svf(o, 2800, 0.7), 0.1, 0.16);","add(hook, 2.0 + k * 0.25, svf(o, 2200, 0.7), 0.1, 0.1);");
rep("addLR(riser, 3.0, l, r, 0.55);","addLR(riser, 3.0, l, r, 0.32);");
// energy steps and groove end at 20 (film's final chord)
rep("cue(8.0, 'Energy step 1: snare on 2 & 4 added; transition sfx');","cue(8.0, 'Energy step 1: snare on 2 & 4 added');");
rep("cue(16.0, 'Energy step 2: arp octave layer added; transition sfx');","cue(16.0, 'Energy step 2: arp octave layer added');");
rep("for (let t = 4; t < 22; t += BEAT) kadd(t, t === 4 ? 1.15 : 1.0);","for (let t = 4; t < 20; t += BEAT) kadd(t, t === 4 ? 1.1 : 0.9);");
rep("for (let t = 8; t < 22; t += BAR) { add(drums, t + 0.5, SN, -0.05, 0.42); add(drums, t + 1.5, SN, 0.05, 0.42); }","for (let t = 8; t < 20; t += BAR) { add(drums, t + 0.5, SN, -0.05, 0.26); add(drums, t + 1.5, SN, 0.05, 0.26); }");
rep("for (let t = 4; t < 22; t += BEAT) add(hats, t + 0.25, hatHit(0.13, 0.03), 0.25, 0.14);","for (let t = 4; t < 20; t += BEAT) add(hats, t + 0.25, hatHit(0.13, 0.03), 0.25, 0.1);");
rep("for (let k = 0; k < 36; k++) {\n  const t = 4 + k * 0.25, c = chordAt(t)","for (let k = 0; k < 64; k++) {\n  const t = 4 + k * 0.25, c = chordAt(t)");
rep("for (let t = 6; t < 20; t += BAR) padChord(t, 2, chordAt(t));\npadChord(20, 1, CH.F); padChord(21, 1, CH.G);","for (let t = 6; t < 18; t += BAR) padChord(t, 2, chordAt(t));\npadChord(18, 1, CH.F); padChord(19, 1, CH.G);");
rep("const fcf = (i) => i < S(20) ? 1500 : 1500 * (11000 / 1500) ** Math.min((i - S(20)) / SR / 2, 1);","const fcf = (i) => i < S(18) ? 1500 : 1500 * (9000 / 1500) ** Math.min((i - S(18)) / SR / 2, 1);");
rep("cue(20.0, 'LIFT: crash, pad filter opens (1.5k -> 11k over 2s), F | G bar, transition sfx');","cue(18.0, 'LIFT: pad filter opens, F | G bar');");
rep("cue(21.0, 'Lift: chord moves F -> G');","cue(19.0, 'Credit flood: chord moves F -> G, soft crash');");
rep("for (let k = 0; k < 16 * 9; k++) { // 4..22 in 16ths = 144 steps","for (let k = 0; k < 16 * 8; k++) { // 4..20 in 16ths = 128 steps");
rep("0.11, 0.001, 0.055, 0.012, { duty: 0.25 }, 0.2), p);","0.11, 0.001, 0.055, 0.012, { duty: 0.25 }, 0.14), p);");
rep("0.09, 0.001, 0.04, 0.01, { duty: 0.5 }, 0.1), -p);","0.09, 0.001, 0.04, 0.01, { duty: 0.5 }, 0.06), -p);");
rep("const fcf = (i) => i < S(20) ? 4500 : 4500 * (12000 / 4500) ** Math.min((i - S(20)) / SR / 2, 1);","const fcf = (i) => i < S(18) ? 4500 : 4500 * (9000 / 4500) ** Math.min((i - S(18)) / SR / 2, 1);");
rep("// crash at 20","// crash at 19");
rep("addLR(drums, 20, svf(l, 11000, 0.6), svf(r, 11000, 0.6), 0.3);","addLR(drums, 19, svf(l, 11000, 0.6), svf(r, 11000, 0.6), 0.16);");
// quieter cuts, same grid
rep("addLR(fx, t - wl, l, r, 0.55);","addLR(fx, t - wl, l, r, 0.24);");
rep("addLR(fx, t, tl, tr, 0.4);","addLR(fx, t, tl, tr, 0.18);");
rep("svf(o, 5000, 0.7), (k % 2 ? 0.5 : -0.5), 0.2);","svf(o, 3800, 0.7), (k % 2 ? 0.5 : -0.5), 0.08);");
rep("transition(8, 4); transition(12, 4); transition(16, 6); transition(20, 8);",`transition(7, 2); transition(11, 2); transition(15, 2); transition(19, 4);
// terminal typing in scene 5: 16ths from 15.25, then Enter on the 16.5 beat
for (let k = 0; k < 10; k++) {
  const t = 15.25 + k * 0.125, n = S(0.04), fc = 1600 + rnd() * 1600;
  add(fx, t, svf(Float32Array.from({ length: n }, (_, i) => noise() * Math.exp(-i / SR / 0.005) * Math.min(i / SR / 0.0005, 1)), fc, 5, 'bp'), rnd() * 0.5 - 0.25, 0.09);
}
cue(16.5, 'Enter: soft A4 tick as the board launches');
add(fx, 16.5, svf(tone('pulse', mtof(69), 0.2, 0.001, 0.06, 0.03, { duty: 0.5 }, 0.5), 2400, 0.7), 0, 0.1);`);
// final chord lands on 20
rep("cue(22.0, 'OUTRO: final Am chord stab (A2 E3 A3 C4 E4 A4, saws + kick + sub), reverb tail');","cue(20.0, 'OUTRO: final Am chord (A2 E3 A3 C4 E4 A4, saws + kick + sub), reverb tail');");
rep("kadd(22, 1.05);","kadd(20, 0.95);");
rep("const i0 = S(22); for (let i = 0; i < sub.length && i0 + i < N; i++)","const i0 = S(20); for (let i = 0; i < sub.length && i0 + i < N; i++)");
rep("add(stab, 22, tone('saw', mtof(m), 2.0, 0.003, 0.7, 0.05,","add(stab, 20, tone('saw', mtof(m), 3.6, 0.003, 1.3, 0.05,");
rep("filtSt(stab, (i) => 7000 * Math.exp(-(i / SR - 22) / 0.5) + 1200, 0.9);","filtSt(stab, (i) => 5000 * Math.exp(-Math.max(0, i / SR - 20) / 0.7) + 900, 0.9);");
rep("Chords 4-20s: Am - F - C - G (one per bar, twice). 20-22s: F | G. Outro: Am.","Chords 4-18s: Am - F - C - G (one per bar). 18-20s: F | G. Outro from 20s: Am.");
rep("Scene cuts: 4, 8, 12, 16, 20, 22 s. Regenerate: \\`node brag-output/audio/synth.mjs\\`.","Scene cuts: 4, 7, 11, 15, 19 s. Regenerate: \\`node audio/synth.mjs\\`.");
fs.writeFileSync(f,s);
