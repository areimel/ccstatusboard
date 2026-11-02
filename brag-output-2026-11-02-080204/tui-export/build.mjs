// Generates composition/index.html and compositions/*.html from tui-frames.json. Re-runnable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES, DUR, EXPORT, SCENES, STEP } from '../timing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const comp = path.join(here, '../composition');
const data = JSON.parse(fs.readFileSync(path.join(here, 'tui-frames.json'), 'utf8'));
const write = (p, s) => fs.writeFileSync(path.join(comp, p), s);

// Scene-local time: every composition's timeline starts at its host's data-start.
const num = (x) => +x.toFixed(4);
const BOARD = { start: SCENES.reveal.start, end: SCENES.system.end };
const bl = (film) => num(film - BOARD.start);
const pl = (film) => num(film - SCENES.public.start);
const cl = (film) => num(film - SCENES.credit.start);
const { hook: HK, reveal: RV, product: PR, system: SY, public: PB, credit: CR } = CUES;

const TESTS = 734; // vitest total, verified at build time
const fontFaces = `
@font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2"); font-weight: 700; }
@font-face { font-family: "Board Symbols"; src: url("assets/fonts/board-symbols.woff2") format("woff2"); }
@font-face { font-family: "DM Sans"; src: url("assets/fonts/DMSans-Medium.ttf"); font-weight: 500; }
@font-face { font-family: "DM Sans"; src: url("assets/fonts/DMSans-Bold.ttf"); font-weight: 700; }`;
const scene = (id, css, body, js) => `<template>
  <style>${fontFaces}
    #root { position: absolute; inset: 0; overflow: hidden; background: #0c0c0a; }
    ${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1080">
${body}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${js}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;

// ---------- board helpers ----------
const remap = (html) => html.replaceAll('rgb(86,95,137)', 'rgb(138,148,190)').replaceAll('rgb(59,66,97)', 'rgb(84,94,138)');
const frameAt = (t) => data.frames.find((f) => f.t === t);
function framesHtml(prefix, t0, t1, startAt) {
  let out = '';
  for (let t = t0, i = 0; t < t1; t += STEP, i++) {
    out += `<pre id="${prefix}${i}" class="clip frame" data-start="${(startAt + i * STEP).toFixed(2)}" data-duration="${STEP}" data-track-index="1">${remap(frameAt(t).lines.join('\n'))}</pre>\n`;
  }
  return out;
}
const ref = frameAt(PR.nearLimitFlip + 1.5).plain; // after the flip, so hb-proj fits the wider NEAR LIMIT text
const findRow = (re) => { const r = ref.findIndex((l) => re.test(l)); if (r < 0) throw new Error('row ' + re); return r; };
const R = { h5: findRow(/^│ 5h\s+\[/), proj: findRow(/5h\s+proj/), sys: findRow(/╭ System/), sess: findRow(/╭ Sessions/), det: findRow(/╭ Detail/), rel: findRow(/●.*release-script/), press: findRow(/Press\s+mem/) };
const endCol = (r) => ref[r].replace(/[\s│]+$/, '').length;
const C = { block: ref[R.h5].indexOf('block'), mid: ref[R.sys + 1].indexOf('↓'), third: ref[R.sys + 1].indexOf('CPU', 30) };
if (R.h5 !== 2 || C.block < 0 || C.mid < 0 || C.third < 0) throw new Error('layout moved: ' + JSON.stringify({ R, C }));

// ---------- scene 1: hook ----------
const PANES = [
  { id: 'p1', name: 'landing-page', lines: ['Writing src/pages/index.astro', 'Reading src/styles/global.css', 'Editing src/components/Hero.astro', 'Running npm run build', 'Writing src/content/features.ts', 'Editing src/layouts/Base.astro'] },
  { id: 'p2', name: 'power-tools', lines: ['Reading src/cli/index.ts', 'Writing src/cli/args.ts', 'Running npm test', 'Editing src/core/runner.ts', 'Writing test/runner.test.ts', 'Running npm run lint'] },
  { id: 'p3', name: 'rate-limiter', lines: ['Editing src/limit/bucket.ts', 'Writing test/bucket.test.ts', 'Running npm test', 'Reading src/server/routes.ts', 'Editing src/limit/redis.ts', 'Writing docs/limits.md'] },
  { id: 'p4', name: 'auth-refactor', lines: ['Reading src/auth/session.ts', 'Editing src/auth/tokens.ts', 'Running npm run typecheck', 'Writing src/auth/refresh.ts', 'Editing test/auth.test.ts', 'Running npm test'] },
];
const STUCK = ['Running npm run build', 'Bumping package.json to next version', 'Writing CHANGELOG.md'];
const paneLines = (lines, n) => Array.from({ length: n }, (_, i) => `<div class="ln"><b>✻</b> ${lines[i % lines.length]}</div>`).join('');
const hookBody = `
    <div id="hook-t1" class="ttl"><span>Five AI agents.</span></div>
    <div id="hook-t2" class="ttl">Which one is <em>stuck?</em></div>
    ${PANES.map((p, i) => `<div id="${p.id}" class="pane" style="left:${i % 2 ? 556 : 72}px;top:${i < 2 ? 318 : 548}px;width:452px"><div class="bar"><i></i><i></i><i></i><span>${p.name}</span></div><div class="body"><div id="${p.id}-s" class="scroll">${paneLines(p.lines, 26)}</div></div></div>`).join('\n    ')}
    <div id="p5" class="pane" style="left:72px;top:778px;width:936px;height:230px"><div class="bar"><i></i><i></i><i></i><span>release-script</span></div><div class="body">
      ${STUCK.map((l, i) => `<div id="st${i}" class="ln hide"><b>✻</b> ${l}</div>`).join('')}
      <div id="wait" class="hide"><b>●</b> waiting: permission to run npm publish</div></div></div>`;
const hookCss = `
    .ttl { position: absolute; left: 72px; font: 700 84px/1.1 "DM Sans", sans-serif; color: #efebe0; opacity: 0; letter-spacing: -1.5px; white-space: nowrap; }
    #hook-t1 { top: 74px; opacity: 1; } #p1 { opacity: 1; } #hook-t2 { top: 172px; }
    em { font-style: normal; color: #ff4d00; }
    .pane { position: absolute; height: 212px; background: #12120f; border: 2px solid #33322c; border-radius: 12px; overflow: hidden; opacity: 0; }
    .bar { height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: #1b1a16; font: 400 22px "JetBrains Mono", monospace; color: #aaa596; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: #4a483f; }
    .bar span { margin-left: 8px; }
    .body { position: absolute; left: 16px; right: 12px; top: 54px; bottom: 8px; overflow: hidden; }
    .scroll { position: absolute; left: 0; top: 0; width: 100%; }
    .ln { font: 400 19px/30px "JetBrains Mono", "Board Symbols", monospace; color: #c9c5b8; white-space: nowrap; }
    .ln b { color: #ff4d00; font-weight: 400; }
    .hide { opacity: 0; }
    #p5 .ln { font-size: 22px; line-height: 34px; }
    #wait { font: 700 34px/48px "JetBrains Mono", "Board Symbols", monospace; color: #f2b84b; white-space: nowrap; margin-top: 4px; }`;
const hookJs = `
    const pop = (id, at) => tl.fromTo(id, { opacity: 0, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.3, ease: "expo.out", immediateRender: false }, at);
    tl.fromTo("#hook-t2", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, ${HK.t2In});
    ["#p2", "#p3", "#p4", "#p5"].forEach((id, i) => pop(id, ${JSON.stringify(HK.paneTimes)}[i + 1]));
    ["#p1-s", "#p2-s", "#p3-s", "#p4-s"].forEach((id, p) => {
      for (let k = 1; k * ${HK.scrollStep} + p * ${HK.scrollStep / 2} <= ${HK.titlesOut}; k++) tl.set(id, { y: -30 * Math.max(0, k - 2) }, k * ${HK.scrollStep} + p * ${HK.scrollStep / 2});
    });
    ["#st0", "#st1", "#st2"].forEach((id, i) => tl.set(id, { opacity: 1 }, ${JSON.stringify(HK.stuck)}[i]));
    // scene's turn: release-script stops and asks; everything else keeps moving
    tl.to("#p5", { borderColor: "#f2b84b", boxShadow: "0 0 34px rgba(242,184,75,.38)", duration: 0.25, ease: "power2.out" }, ${HK.waitIn});
    tl.fromTo("#wait", { opacity: 0 }, { opacity: 1, duration: 0.14, ease: "none", immediateRender: false }, ${HK.waitIn});
    tl.to(["#p1", "#p2", "#p3", "#p4"], { opacity: 0.42, duration: 0.35, ease: "power2.inOut" }, ${HK.dim});
    // exit: stuck pane becomes the world
    tl.to(["#hook-t1", "#hook-t2"], { opacity: 0, filter: "blur(8px)", duration: 0.2, ease: "power1.in" }, ${HK.titlesOut});
    tl.to(["#p1", "#p2", "#p3", "#p4"], { opacity: 0, duration: 0.2, ease: "power1.in" }, ${HK.titlesOut});
    tl.to("#p5", { scale: 2.6, y: -300, opacity: 0, duration: 0.42, ease: "power3.in" }, ${HK.zoom});`;
write('compositions/hook.html', scene('hook', hookCss, hookBody, hookJs));

// ---------- scene 2-4: the real board ----------
const FS = 15, CW = 9, LH = 18.5, COLS = data.cols, ROWS = data.rows;
const OX = (1080 - COLS * CW) / 2, OY = 262;
const hb = (id, r0, r1, c0, c1) => `<div id="${id}" class="hb" style="left:${c0 * CW - 4}px;top:${r0 * LH - 3}px;width:${(c1 - c0) * CW + 8}px;height:${(r1 - r0 + 1) * LH + 6}px"></div>`;
const cover = (id, r0, r1) => `<div id="${id}" class="cov" style="top:${r0 * LH}px;height:${(r1 - r0) * LH}px"></div>`;
const boardBody = `
    <div id="cam"><div id="screen" data-layout-allow-overlap>
${framesHtml('f', EXPORT.RANGES[0][0], EXPORT.RANGES[0][1], 0)}
${hb('hb-rel', R.rel, R.rel, 1, endCol(R.rel) > 70 ? 67 : endCol(R.rel))}
<div id="callout" style="left:${1 * CW}px;top:${(R.rel + 1.15) * LH}px;width:${66 * CW}px">waiting: permission to run npm publish</div>
${hb('hb-cost', R.h5, R.h5 + 4, C.block - 1, C.block + 16)}
${hb('hb-proj', R.proj, R.proj, 1, endCol(R.proj) + 1)}
${hb('hb-net', R.sys + 1, R.sys + 2, C.mid - 1, C.third - 2)}
${hb('hb-temp', R.sys + 1, R.sys + 2, C.third - 1, COLS - 2)}
${hb('hb-gpu', R.sys + 4, R.sys + 5, C.third - 1, COLS - 2)}
${hb('hb-press', R.press, R.press, 1, 38)}
${cover('c1', 1, R.sys)}${cover('c2', R.sys, R.sess)}${cover('c3', R.sess, R.det)}${cover('c4', R.det, ROWS)}
    </div></div>
    <div id="band"></div>
    <div id="title" class="clip" data-start="${bl(SCENES.reveal.start)}" data-duration="${SCENES.reveal.end - SCENES.reveal.start}" data-track-index="2"><div id="title-a">ccstatusboard</div><div id="title-b">One live dashboard for every <em>Claude Code</em> session.</div></div>
    <div id="cap3" class="clip" data-start="${bl(SCENES.product.start)}" data-duration="${SCENES.product.end - SCENES.product.start}" data-track-index="2"><div id="l1" class="l">Who needs you.</div><div id="l2" class="l">What it costs.</div><div id="l3" class="l">When you hit the limit.</div></div>
    <div id="cap4" class="clip" data-start="${bl(SCENES.system.start)}" data-duration="${SCENES.system.end - SCENES.system.start}" data-track-index="2"><div id="s-h"><em>New:</em> the whole machine, live.</div><div id="chips"><span id="ch-net" class="chip">Network</span><span id="ch-temp" class="chip">Temps</span><span id="ch-gpu" class="chip">GPU</span><span id="ch-press" class="chip">Pressure</span></div></div>`;
const boardCss = `
    #cam { position: absolute; left: 0; top: 0; width: 1080px; height: 1080px; transform-origin: 0 0; }
    #screen { position: absolute; left: ${OX}px; top: ${OY}px; width: ${COLS * CW}px; height: ${ROWS * LH}px; }
    .frame { position: absolute; left: 0; top: 0; margin: 0; font-family: "JetBrains Mono", "Board Symbols", monospace; font-size: ${FS}px; line-height: ${LH}px; white-space: pre; color: #c0caf5; font-variant-ligatures: none; }
    .cov { position: absolute; left: -6px; width: ${COLS * CW + 12}px; background: #0c0c0a; transform-origin: 100% 50%; }
    .hb { position: absolute; border: 2px solid #ff4d00; border-radius: 4px; opacity: 0; box-shadow: 0 0 10px rgba(255,77,0,.5); }
    #callout { position: absolute; opacity: 0; font: 700 16px/25px "JetBrains Mono", monospace; color: #0c0c0a; background: #f2b84b; border-radius: 4px; padding: 0 8px; white-space: nowrap; }
    #band { position: absolute; left: 0; top: 0; width: 1080px; height: 310px; background: linear-gradient(to bottom, #0c0c0a 0, #0c0c0a 256px, rgba(12,12,10,0) 310px); }
    em { font-style: normal; color: #ff4d00; }
    #title { position: absolute; left: 72px; right: 72px; top: 44px; }
    #title-a { font: 700 92px/1.1 "JetBrains Mono", monospace; color: #ff4d00; letter-spacing: -2px; opacity: 0; }
    #title-b { font: 500 38px/1.2 "DM Sans", sans-serif; color: #efebe0; margin-top: 12px; opacity: 0; white-space: nowrap; }
    #cap3 { position: absolute; left: 72px; right: 72px; top: 48px; }
    .l { font: 700 56px/68px "DM Sans", sans-serif; color: #efebe0; letter-spacing: -.8px; opacity: 0; white-space: nowrap; }
    #cap4 { position: absolute; left: 72px; right: 72px; top: 62px; }
    #s-h { font: 700 62px/1.15 "DM Sans", sans-serif; color: #efebe0; letter-spacing: -1px; opacity: 0; white-space: nowrap; }
    #chips { display: flex; gap: 14px; margin-top: 24px; }
    .chip { font: 700 32px/56px "DM Sans", sans-serif; color: #efebe0; border: 2px solid #4a483f; border-radius: 30px; padding: 0 24px; opacity: 0; white-space: nowrap; }`;
const boardJs = `
    const CW=${CW}, LH=${LH}, OX=${OX}, OY=${OY};
    const cam = (c, r, sx, sy, s) => ({ x: sx - s * (OX + c * CW), y: sy - s * (OY + r * LH), scale: s });
    const E = "power3.inOut", CAM = "#cam";
    const move = (to, at, d) => tl.to(CAM, { ...to, duration: d, ease: E }, at);
    const blur = (id, at) => tl.fromTo(id, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, at);
    const out = (ids, at) => tl.to(ids, { opacity: 0, filter: "blur(6px)", duration: 0.16, ease: "power1.in" }, at);
    const draw = (id, at) => tl.fromTo(id, { opacity: 0, clipPath: "inset(-12px 100% -12px -12px)" }, { opacity: 1, clipPath: "inset(-12px -12px -12px -12px)", duration: 0.3, ease: "power2.out", immediateRender: false }, at);
    const undraw = (ids, at) => tl.to(ids, { opacity: 0, duration: 0.16, ease: "power1.in" }, at);

    // reveal: panels wipe on, one per wipeStep
    ["#c1", "#c2", "#c3", "#c4"].forEach((id, i) => tl.to(id, { scaleX: 0, duration: ${RV.wipeDur}, ease: "power3.out" }, ${RV.wipeStep} * i));
    blur("#title-a", ${bl(RV.nameIn)}); blur("#title-b", ${bl(RV.tagIn)});
    out(["#title-a", "#title-b"], ${bl(RV.out)});

    // product: live data keeps the holds alive, so the camera stays still between moves
    move(cam(33.5, ${R.rel + 1}, 540, 560, 1.55), ${bl(PR.shot1.move)}, ${PR.shot1.moveDur});
    blur("#l1", ${bl(PR.shot1.lineIn)}); draw("#hb-rel", ${bl(PR.shot1.box)}); tl.to("#callout", { opacity: 1, duration: 0.15 }, ${bl(PR.shot1.calloutIn)});
    undraw(["#hb-rel", "#callout"], ${bl(PR.shot1.out)});
    move(cam(${C.block + 7.5}, ${R.h5 + 2.5}, 540, 600, 3), ${bl(PR.shot2.move)}, ${PR.shot2.moveDur});
    blur("#l2", ${bl(PR.shot2.lineIn)}); draw("#hb-cost", ${bl(PR.shot2.box)});
    undraw("#hb-cost", ${bl(PR.shot2.out)});
    move(cam(31, ${R.h5 + 3.5}, 540, 600, 1.72), ${bl(PR.shot3.move)}, ${PR.shot3.moveDur});
    blur("#l3", ${bl(PR.shot3.lineIn)}); draw("#hb-proj", ${bl(PR.shot3.box)});
    undraw("#hb-proj", ${bl(PR.shot3.out)});
    out(["#l1", "#l2", "#l3"], ${bl(PR.shot3.out)});

    // system: whole panel, across the new columns, back to the meters
    move(cam(55, ${R.sys + 3.5}, 540, 590, 0.98), ${bl(SY.moves[0].at)}, ${SY.moves[0].d});
    move(cam(76.5, ${R.sys + 3.5}, 540, 600, 1.62), ${bl(SY.moves[1].at)}, ${SY.moves[1].d});
    blur("#s-h", ${bl(SY.headIn)});
    const chipIn = (id, at) => tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: 0.15, immediateRender: false }, at);
    ["#ch-net", "#ch-temp", "#ch-gpu", "#ch-press"].forEach((id, i) => chipIn(id, ${bl(SY.chipsIn)} + i * 0.05));
    const lit = (chip, box, at, end) => {
      tl.to(chip, { backgroundColor: "#ff4d00", color: "#141310", borderColor: "#ff4d00", duration: 0.12 }, at);
      draw(box, at);
      tl.to(chip, { backgroundColor: "rgba(0,0,0,0)", color: "#efebe0", borderColor: "#4a483f", duration: 0.12 }, end);
      undraw(box, end);
    };
    lit("#ch-net", "#hb-net", ${bl(SY.net[0])}, ${bl(SY.net[1])});
    lit("#ch-temp", "#hb-temp", ${bl(SY.temp[0])}, ${bl(SY.temp[1])});
    lit("#ch-gpu", "#hb-gpu", ${bl(SY.gpu[0])}, ${bl(SY.gpu[1])});
    move(cam(35, ${R.sys + 3.5}, 540, 600, 1.62), ${bl(SY.moves[2].at)}, ${SY.moves[2].d});
    lit("#ch-press", "#hb-press", ${bl(SY.press[0])}, ${bl(SY.press[1])});
    out(["#s-h", "#ch-net", "#ch-temp", "#ch-gpu", "#ch-press"], ${bl(SY.out)});`;
write('compositions/board.html', scene('board', boardCss, boardBody, boardJs));

// ---------- scene 5: public ----------
const WFS = 13.5, WCW = 8.1, WLH = 16.6;
const cmd = 'npx ccstatusboard';
const pubBody = `
    <div id="pu-1" class="big">Public. Free.</div>
    <div id="pu-2" class="big">Install it <em>today.</em></div>
    <div id="win"><div id="wbar"><i></i><i></i><i></i></div>
      <div id="prompt"><span class="d">$</span> ${[...cmd].map((c, i) => `<span id="k${i}" class="k">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}<span id="caret"></span></div>
      <div id="wscreen">
${framesHtml('w', EXPORT.RANGES[1][0], EXPORT.RANGES[1][1], pl(PB.enter))}
      </div>
    </div>
    <div id="chips2"><span class="c2">npm</span><span class="c2">standalone binary</span><span class="c2">Linux</span><span class="c2">macOS</span></div>
    <div id="site">areimel.github.io/ccstatusboard</div>`;
const pubCss = `
    .big { position: absolute; left: 72px; font: 700 76px/1.1 "DM Sans", sans-serif; color: #efebe0; letter-spacing: -1.4px; opacity: 0; white-space: nowrap; }
    #pu-1 { top: 58px; } #pu-2 { top: 146px; }
    em { font-style: normal; color: #ff4d00; }
    #win { position: absolute; left: 72px; top: 256px; width: 936px; height: 540px; background: #12120f; border: 2px solid #ff4d00; border-radius: 14px; overflow: hidden; box-shadow: 0 0 40px rgba(255,77,0,.22); }
    #wbar { height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: #1b1a16; }
    #wbar i { width: 11px; height: 11px; border-radius: 50%; background: #4a483f; }
    #prompt { position: absolute; left: 96px; top: 226px; font: 700 58px/72px "JetBrains Mono", monospace; color: #efebe0; white-space: nowrap; display: flex; }
    #prompt .d { color: #ff4d00; margin-right: 34px; }
    .k { opacity: 0; }
    #caret { display: inline-block; width: 32px; height: 60px; background: #ff4d00; margin-top: 6px; }
    #wscreen { position: absolute; left: 22px; top: 44px; width: ${110 * WCW}px; height: 488px; overflow: hidden; }
    .frame { position: absolute; left: 0; top: 0; margin: 0; font-family: "JetBrains Mono", "Board Symbols", monospace; font-size: ${WFS}px; line-height: ${WLH}px; white-space: pre; color: #c0caf5; font-variant-ligatures: none; }
    #chips2 { position: absolute; left: 72px; right: 72px; top: 826px; display: flex; gap: 14px; }
    .c2 { font: 700 34px/62px "DM Sans", sans-serif; color: #efebe0; border: 2px solid #4a483f; border-radius: 32px; padding: 0 26px; white-space: nowrap; opacity: 0; }
    #site { position: absolute; left: 72px; top: 920px; font: 700 40px/1.2 "JetBrains Mono", monospace; color: #ff4d00; opacity: 0; white-space: nowrap; }`;
const pubJs = `
    const blur = (id, at) => tl.fromTo(id, { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, at);
    blur("#pu-1", ${pl(PB.l1In)}); blur("#pu-2", ${pl(PB.l2In)});
    tl.fromTo("#win", { y: 40, scale: 0.97 }, { y: 0, scale: 1, duration: 0.45, ease: "expo.out" }, 0);
    ${JSON.stringify([...cmd].map((_, i) => '#k' + i))}.forEach((id, i) => tl.set(id, { opacity: 1 }, ${pl(PB.typeStart)} + i * ${PB.typeStep}));
    // caret blinks on the half beat until typing starts, then holds steady
    for (let t = 0, on = 1; t < ${pl(PB.typeStart)}; t += 0.5, on = 1 - on) tl.set("#caret", { opacity: on }, t);
    tl.set("#caret", { opacity: 1 }, ${pl(PB.typeStart)});
    // one caret step per typed character
    for (let i = 0; i <= 17; i++) tl.set("#caret", { x: -(17 - i) * 34.8 }, i === 0 ? 0 : ${pl(PB.typeStart)} + (i - 1) * ${PB.typeStep});
    // Enter: the prompt clears and the board is running
    tl.set(["#prompt"], { opacity: 0 }, ${pl(PB.enter)});
    gsap.utils.toArray(".c2").forEach((el, i) => tl.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: ${PB.chipStep}, ease: "expo.out", immediateRender: false }, ${pl(PB.chipsIn)} + i * ${PB.chipStep}));
    blur("#site", ${pl(PB.siteIn)});
    tl.to(["#pu-1", "#pu-2", "#win", "#chips2", "#site"], { opacity: 0, duration: 0.16, ease: "power1.in" }, ${pl(PB.out)});`;
write('compositions/public.html', scene('public', pubCss, pubBody, pubJs));

// ---------- scene 6: proof + credit ----------
const name = 'Alec Reimel';
const credBody = `
    <div id="flood"></div>
    <div id="st1" class="stat"><div class="num">20 days</div><div class="lbl">to public release</div></div>
    <div id="st2" class="stat"><div id="tests" class="num">0</div><div class="lbl">tests passing</div></div>
    <div id="rule"></div>
    <div id="nm">${[...name].map((c, i) => `<span id="n${i}" class="nc">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div>
    <div id="role">Open to engineering roles</div>
    <div id="url">github.com/areimel/ccstatusboard</div>`;
const credCss = `
    #flood { position: absolute; inset: 0; background: #ff4d00; clip-path: circle(0px at 540px 1080px); }
    .stat { position: absolute; top: 164px; color: #141310; opacity: 0; }
    #st1 { left: 72px; } #st2 { left: 640px; }
    .num { font: 700 112px/1 "DM Sans", sans-serif; letter-spacing: -3px; white-space: nowrap; }
    .lbl { font: 500 38px/1.3 "DM Sans", sans-serif; margin-top: 10px; white-space: nowrap; }
    #rule { position: absolute; left: 72px; top: 386px; width: 936px; height: 4px; background: #141310; transform-origin: 0 50%; }
    #nm { position: absolute; left: 66px; top: 454px; font: 700 148px/1.05 "DM Sans", sans-serif; color: #141310; letter-spacing: -4px; white-space: nowrap; display: flex; }
    .nc { opacity: 0; }
    #role { position: absolute; left: 72px; top: 630px; font: 700 58px/1.2 "DM Sans", sans-serif; color: #141310; letter-spacing: -1px; opacity: 0; white-space: nowrap; }
    #url { position: absolute; left: 72px; top: 790px; width: 936px; font: 700 42px/104px "JetBrains Mono", monospace; color: #efebe0; background: #141310; border-radius: 16px; text-align: center; opacity: 0; white-space: nowrap; }`;
const credJs = `
    tl.to("#flood", { clipPath: "circle(1600px at 540px 1080px)", duration: ${CR.floodDur}, ease: "power2.inOut" }, ${cl(CR.flood)});
    tl.fromTo("#st1", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: "expo.out", immediateRender: false }, ${cl(CR.stat1In)});
    tl.fromTo("#st2", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: "expo.out", immediateRender: false }, ${cl(CR.stat2In)});
    const n = { v: 0 };
    tl.to(n, { v: ${TESTS}, duration: 0.3, ease: "power2.out", onUpdate: () => { document.getElementById("tests").textContent = String(Math.round(n.v)); } }, ${cl(CR.stat2In)});
    tl.fromTo("#rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, ${cl(CR.ruleIn)});
    ${JSON.stringify([...name].map((_, i) => '#n' + i))}.forEach((id, i) => tl.fromTo(id, { opacity: 0, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power1.out", immediateRender: false }, ${cl(CR.nameIn)} + i * 0.03));
    tl.fromTo("#role", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power2.out", immediateRender: false }, ${cl(CR.roleIn)});
    tl.fromTo("#url", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.25, ease: "expo.out", immediateRender: false }, ${cl(CR.urlIn)});`;
write('compositions/credit.html', scene('credit', credCss, credBody, credJs));

// ---------- root ----------
const host = (id, start, dur) => `<div id="${id}" data-composition-id="${id}" class="clip scene" data-composition-src="compositions/${id}.html" data-start="${start}" data-duration="${dur}" data-track-index="0" data-track-kind="graphics" data-width="1080" data-height="1080"></div>`;
write('index.html', `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1080px; overflow: hidden; background: #0c0c0a; }
      #root { position: relative; width: 100%; height: 100%; }
      .scene { position: absolute; inset: 0; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="1080" data-height="1080">
      ${host('hook', SCENES.hook.start, SCENES.hook.end - SCENES.hook.start)}
      ${host('board', BOARD.start, BOARD.end - BOARD.start)}
      ${host('public', SCENES.public.start, SCENES.public.end - SCENES.public.start)}
      ${host('credit', SCENES.credit.start, SCENES.credit.end - SCENES.credit.start)}
      <audio id="music" class="clip" src="assets/music.wav" data-start="0" data-duration="${DUR}" data-track-index="1"></audio>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`);
console.log('built', JSON.stringify({ R, C }));
