// Fails if any line, or any group of lines sharing the screen, gets too little reading time.
import { LINES, SCENES, CUTS, DUR, SCORE, STEP } from './timing.mjs';
const need = (t) => 0.45 * t.trim().split(/\s+/).length + 1;
let bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };
for (const l of LINES) {
  const w = l.out - l.settled, n = need(l.text);
  if (w < n - 1e-9) fail(`"${l.text}" ${w.toFixed(2)}s < ${n.toFixed(2)}s`);
}
for (const g of new Set(LINES.map((l) => l.g))) {
  const ls = LINES.filter((l) => l.g === g);
  const sum = ls.reduce((a, l) => a + need(l.text), 0), w = Math.max(...ls.map((l) => l.out)) - ls[0].settled;
  console.log(`${g.padEnd(8)} window ${w.toFixed(2)}s, reading ${sum.toFixed(2)}s`);
  if (w < sum - 1e-9) fail(`group ${g}: ${w.toFixed(2)}s < ${sum.toFixed(2)}s`);
}
const s = Object.values(SCENES);
s.forEach((x, i) => { if (i && x.start !== s[i - 1].end) fail('scene gap at ' + x.start); });
if (s.at(-1).end !== DUR) fail('scenes do not reach DUR');
for (const c of CUTS) if (c % 1) fail('cut off the beat: ' + c);
for (const sec of SCORE) for (const [, t, b] of sec.notes) if (t + b > sec.to + 1e-9 || t < sec.from) fail(`note at ${t} leaves its section`);
if (STEP % 0.25) fail('STEP must be a multiple of 0.25');
if (bad) { console.log(bad + ' failure(s)'); process.exit(1); }
console.log('timing OK');
