import fs from 'node:fs';
const f = process.argv[2];
let s = fs.readFileSync(f,'utf8');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('missing '+a); s=s.split(a).join(b); };
rep("const COLS = 150;","const COLS = 110;");
rep("const ROWS = 42;","const ROWS = 44;");
rep("const FRAMES = 33;","const FRAMES = 60; // 4s..19s of film time, one frame per quarter beat\nconst STEP = 0.25;");
rep("const T0 = 8;","const T0 = 4;");
rep("const { ZERO_TOKENS, emptyWindowTotals } = await import('../../src/domain/types.js');","const { ZERO_TOKENS, emptyWindowTotals } = await import('../../src/domain/types.js');\nconst { makeFullSystemStats } = await import('../../test/helpers/system.js');");
// retime session values to this film's scenes
rep("ctx: (t) => lerp(62, 91, prog(t, 12, 16))","ctx: (t) => lerp(62, 91, prog(t, 7, 11))");
rep("cost: (t) => 4.2 + 0.2 * prog(t, 8, 16) + 0.5 * prog(t, 16, 20)","cost: (t) => 4.2 + 0.7 * prog(t, 8, 9.5)");
rep("cost: (t) => 2.35 + 0.15 * prog(t, 16, 20)","cost: (t) => 2.35 + 0.15 * prog(t, 8, 9.5)");
rep("cost: (t) => 1.1 + 0.9 * prog(t, 12, 16) + 0.3 * prog(t, 16, 20)","cost: (t) => 1.1 + 1.2 * prog(t, 8, 9.5)");
rep("cost: (t) => 3.15 + 0.1 * prog(t, 16, 20)","cost: (t) => 3.15 + 0.1 * prog(t, 8, 9.5)");
rep("cost: (t) => 7.85 + 0.4 * prog(t, 8, 16) + 0.9 * prog(t, 16, 20)","cost: (t) => 7.85 + 1.3 * prog(t, 8, 9.5)");
s=s.replaceAll("prog(t, 8, 24)","prog(t, 4, 19)");
rep("const t = T0 + i * 0.5;","const t = T0 + i * STEP;");
rep("const now = BASE_NOW + i * 1000;","const now = BASE_NOW + i * 250;");
rep("const k = prog(t, 8, 12);","const k = prog(t, 7, 10);");
rep("const blockPct = t <= 12 ? lerp(58, 86, k) : lerp(86, 87.2, prog(t, 12, 24));","const blockPct = t <= 10 ? lerp(58, 86, k) : lerp(86, 87.2, prog(t, 10, 19));");
rep("const weekPct = t <= 12 ? lerp(31, 33, k) : 33;","const weekPct = t <= 10 ? lerp(31, 33, k) : 33;");
rep("const blockProj = t <= 12 ? lerp(72, 93, k) : lerp(93, 94, prog(t, 12, 24));","// flips from UNDER to NEAR LIMIT on the 9.5s beat, as scene 3's last line lands\n  const blockProj = t < 9.5 ? lerp(72, 84, prog(t, 7, 9.5)) : lerp(93, 94, prog(t, 9.5, 19));");
rep("ratePctPerHour: t <= 12 ? lerp(12, 15, k) : 15","ratePctPerHour: t <= 10 ? lerp(12, 15, k) : 15");
rep("const c = prog(t, 16, 20);","const c = prog(t, 8, 9.5);");
rep("t <= 16 ? 0 : 0","0");
s=s.replace("block: win(lerp(12.4, 12.9, prog(t, 8, 16)) + lerp(0, 2.6, c))","block: win(12.4 + lerp(0, 2.6, c))")
 .replace("today: win(lerp(27.15, 27.9, prog(t, 8, 16)) + lerp(0, 3.4, c))","today: win(27.15 + lerp(0, 3.4, c))")
 .replace("week: win(lerp(96.1, 97.0, prog(t, 8, 16)) + lerp(0, 3.4, c))","week: win(96.1 + lerp(0, 3.4, c))")
 .replace("month: win(lerp(412.75, 414.1, prog(t, 8, 16)) + lerp(0, 3.4, c))","month: win(412.75 + lerp(0, 3.4, c))")
 .replace("lerp(3.4, 4.1, prog(t, 8, 20))","lerp(3.4, 4.1, prog(t, 7, 11))");
// system: every v0.2.0 metric group, fictional link values
const a=s.indexOf("    system: {\n      sampledAt: now,"); const b=s.indexOf("    systemHistory:");
if(a<0||b<0) throw new Error('system block');
s=s.slice(0,a)+`    system: makeFullSystemStats({
      sampledAt: now,
      cpu: { total: cpuNow, perCore: Array.from({ length: 16 }, (_, j) => Math.max(4, Math.min(100, cpuNow + 34 * Math.sin(j * 1.3 + i * 0.4)))) },
      mem: { used: lerp(12.9, 13.2, prog(t, 4, 19)) * GiB, total: 32 * GiB },
      swap: { used: 0.4 * GiB, total: 8 * GiB },
      disk: { used: 412 * GiB, total: 954 * GiB, mount: '/' },
      net: { rxPerSec: (rxHist.at(-1) ?? 200) * 1024, txPerSec: (txHist.at(-1) ?? 40) * 1024 },
      load: [cpuNow / 19, cpuNow / 25, cpuNow / 30],
      temps: [
        { label: 'CPU', celsius: lerp(64, 88, prog(t, 11, 14)) + wob(t * 3, 0.6, 1) },
        { label: 'GPU', celsius: lerp(48, 61, prog(t, 11, 14)) },
        { label: 'Board', celsius: 53 },
        { label: 'WiFi', celsius: 40 },
        { label: 'SSD', celsius: 34, warn: 78, crit: 83 },
      ],
      battery: { percent: 98, status: 'Not charging', healthPercent: 92, cycles: 40 },
      uptimeSec: 4171 + Math.floor(i * STEP),
      cpuFreq: { curHz: (4.1 + 0.3 * Math.sin(i * 0.5)) * 1e9, maxHz: 4.55e9 },
      powerProfile: 'balanced',
      gpu: { busyPercent: Math.round(22 + 16 * Math.sin(i * 0.45)), vramUsed: 936 * 1024 ** 2, clockHz: 900e6, watts: Math.round(18 + 6 * Math.sin(i * 0.45)) },
      pressure: { mem: 0.6, cpu: 2 + 1.5 * Math.sin(i * 0.3), io: 0.4 },
      diskIo: { readPerSec: (1 + Math.sin(i * 0.7)) * 8 * 1024 ** 2, writePerSec: (1 + Math.cos(i * 0.5)) * 3 * 1024 ** 2 },
      procs: { processes: 552, threads: 2926 },
      link: { iface: 'wlan0', ip: '10.0.0.42', signalDbm: -47 },
    }),
`+s.slice(b);
rep("frames.push({ t: T0 + i * 0.5, lines: lines.map(ansiLineToHtml) });","frames.push({ t: T0 + i * STEP, lines: lines.map(ansiLineToHtml), plain: lines.map(plainOf) });");
// layout is now derived per-frame in build-board.mjs
const l=s.indexOf("// ---------- layout ----------"); const m=s.indexOf("mkdirSync(HERE, { recursive: true });");
s=s.slice(0,l)+s.slice(m);
const p=s.indexOf("writeFileSync(resolve(HERE, 'tui-layout.json')");
s=s.slice(0,p)+`const pick = [0, 40, 56];
writeFileSync(resolve(WORK, 'tui-preview.html'), \`<!doctype html><meta charset="utf-8"><style>body{background:#000;margin:12px}pre{margin:0 0 12px;background:\${BG};color:\${FG};font:16px/1.25 'JetBrains Mono','DejaVu Sans Mono',monospace;width:\${COLS}ch;white-space:pre;padding:6px}</style>\${pick.map((i) => \`<pre>\${frames[i]!.lines.join('\\n')}</pre>\`).join('')}\`);
console.log(\`ok: \${FRAMES} frames \${COLS}x\${ROWS}, colour spans in frame0: \${colourSpans}\`);
console.log(frames[40]!.plain.join('\\n'));
`;
fs.writeFileSync(f,s);
