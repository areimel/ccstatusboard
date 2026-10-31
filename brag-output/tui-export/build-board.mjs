// Builds ../composition/compositions/board.html from tui-frames.json (re-runnable).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, 'tui-frames.json'), 'utf8'));
const out = path.join(here, '../composition/compositions/board.html');

const FS = 18.9; // px; 150 cols -> ~1701px
const CW = +(FS * 0.6).toFixed(4);
const LH = 22.5;
const OX = Math.round((1920 - 150 * CW) / 2);
const OY = Math.round((1080 - 42 * LH) / 2);
const BEAT = 0.5;
const T0 = 8;
const NFR = 24; // 12s / 0.5

const strip = (s) =>
  s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const plain = (f, r) => strip(f.lines[r]);
const frameAt = (t) => data.frames.find((f) => f.t === t);

// Legibility remap of the dim Tokyo-night greys on the near-black ground.
const remap = (html) =>
  html
    .replaceAll('rgb(86,95,137)', 'rgb(138,148,190)')
    .replaceAll('rgb(59,66,97)', 'rgb(84,94,138)');

// --- locate things in plain text (use the post-flip frame, t=11) ---
const ref = frameAt(11);
const r5h = 2, rProj = 7, rBurn = 9, rHdr = 18;
const rPower = data.frames[0].lines.findIndex((_, r) => /power-tools\s+power-tools/.test(plain(ref, r)));
const rTable0 = rHdr + 1;
let rTableEnd = rHdr;
for (let r = rHdr + 1; r < 34; r++) if (/[█░]{10} +\d+%/.test(plain(ref, r))) rTableEnd = r;
const hdr = plain(ref, rHdr);
const ctxC0 = hdr.indexOf('CTX');
const barC0 = plain(ref, rPower).search(/[█░]{10}/);
const projectC0 = hdr.indexOf('PROJECT');
const endOf = (s) => s.replace(/[\s│]+$/, '').length;
const L = {
  CW, LH, OX, OY, r5h, rProj, rBurn, rHdr, rPower, rTableEnd, ctxC0, barC0, projectC0,
  meterC1: endOf(plain(ref, r5h).slice(0, 100)) , // resets text end (left part only)
  projC1: endOf(plain(ref, rProj)),
  burnC1: endOf(plain(ref, rBurn)),
  powerC1: barC0 + 15,
  costC0: plain(ref, 2).indexOf('block') - 1,
  costC1: Math.max(...[2,3,4,5,6].map((r) => endOf(plain(ref, r)))) + 0.5,
  costR0: 2, costR1: 6,
};
// meter row: text before cost block
{
  const s = plain(ref, r5h);
  const i = s.indexOf('block');
  L.meterC1 = endOf(s.slice(0, i));
}

const frames = [];
for (let i = 0; i < NFR; i++) {
  const f = frameAt(T0 + i * BEAT);
  const html = f.lines.map(remap).join('\n');
  frames.push(
    `<pre id="f${i}" class="clip frame" data-start="${(i * BEAT).toFixed(1)}" data-duration="${BEAT}" data-track-index="1">${html}</pre>`,
  );
}

const box = (id, r0, r1, c0, c1) => {
  const pad = 4;
  const l = c0 * CW - pad, t = r0 * LH - pad, w = (c1 - c0) * CW + pad * 2, h = (r1 - r0 + 1) * LH + pad * 2;
  return `<div id="${id}" class="hb" style="left:${l.toFixed(1)}px;top:${t.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px"></div>`;
};
const boxes = [
  box('hb-meter', r5h, r5h, 1, L.meterC1),
  box('hb-proj', rProj, rProj, 1, L.projC1),
  box('hb-ctx', rHdr, rTableEnd, ctxC0 - 0.5, ctxC0 + 14.5),
  box('hb-power', rPower, rPower, 1, L.powerC1 + 0.5),
  box('hb-cost', L.costR0, L.costR1, L.costC0, L.costC1),
  box('hb-burn', rBurn, rBurn, 1, L.burnC1),
  `<div id="hb-label" style="left:${(ctxC0 * CW).toFixed(1)}px;top:${((rHdr - 1) * LH - 4).toFixed(1)}px">context</div>`,
].join('\n');

const tpl = fs.readFileSync(path.join(here, 'board.template.html'), 'utf8');
const html = tpl
  .replace('/*__GEOM__*/', `const G = ${JSON.stringify(L)};`)
  .replaceAll('__CW__', CW).replaceAll('__LH__', LH).replaceAll('__FS__', FS)
  .replaceAll('__OX__', OX).replaceAll('__OY__', OY)
  .replace('<!--__BOXES__-->', boxes)
  .replace('<!--__FRAMES__-->', frames.join('\n'));
fs.writeFileSync(out, html);
console.log('wrote', out, JSON.stringify(L));
