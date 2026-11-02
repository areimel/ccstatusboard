// Generates ../composition/compositions/outro.html from tui-frames.json (t=20.0..21.5).
import { readFileSync, writeFileSync } from "node:fs";
const J = JSON.parse(readFileSync(new URL("./tui-frames.json", import.meta.url)));
const frames = J.frames.filter((f) => f.t >= 20 && f.t <= 21.5);
const stepT = frames.map((f) => +(f.t - 20).toFixed(2));
const CMD = "npx ccstatusboard";
const fs = 1700 / J.cols / 0.6, lh = 21;
const frameHtml = frames
  .map((f, i) => `<pre class="tf" id="tf${i}">${f.lines.join("\n")}</pre>`)
  .join("\n        ");
const out = `<template>
  <style>
    @font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
    @font-face { font-family: "JetBrains Mono"; src: url("assets/fonts/jetbrains-mono-latin-700-normal.woff2") format("woff2"); font-weight: 700; }
    @font-face { font-family: "Board Symbols"; src: url("assets/fonts/board-symbols.woff2") format("woff2"); }
    @font-face { font-family: "DM Sans"; src: url("assets/fonts/DMSans-Medium.ttf") format("truetype"); font-weight: 500; }
    @font-face { font-family: "DM Sans"; src: url("assets/fonts/DMSans-Bold.ttf") format("truetype"); font-weight: 700; }
    #root { position: absolute; inset: 0; background: #0c0c0a; overflow: hidden; font-family: "DM Sans", sans-serif; }
    #root * { box-sizing: border-box; margin: 0; }
    /* ---------- scene 6: payoff ---------- */
    #s6 { position: absolute; inset: 0; }
    #warp { position: absolute; left: 110px; top: 99px; width: 1700px; height: ${lh * J.rows}px; border-radius: 22px; overflow: hidden; background: ${J.bg}; transform: perspective(1400px) rotateY(-3.5deg) rotateX(1.6deg); box-shadow: 0 0 0 2px rgba(255,77,0,.35), 0 0 80px rgba(255,77,0,.18); }
    #boardin { position: absolute; inset: 0; transform-origin: 50% 50%; }
    .tf { position: absolute; left: 0; top: 0; font: 400 ${fs.toFixed(3)}px/${lh}px "JetBrains Mono","Board Symbols",monospace; color: ${J.fg}; white-space: pre; opacity: 0; }
    #tf0 { opacity: 1; }
    .yt-screen-fx { position: absolute; inset: 0; pointer-events: none; opacity: 0;
      background: linear-gradient(115deg, rgba(255,255,255,.09) 0%, transparent 30%),
        repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 1px, transparent 1px 3px),
        repeating-linear-gradient(90deg, rgba(0,0,0,.06) 0 1px, transparent 1px 4px);
      box-shadow: inset 0 0 90px rgba(0,0,0,.45), inset 0 0 8px rgba(0,0,0,.5); }
    #scrim { position: absolute; left: 0; right: 0; top: 400px; height: 280px; background: linear-gradient(180deg, rgba(12,12,10,0) 0%, rgba(12,12,10,.88) 28%, rgba(12,12,10,.88) 72%, rgba(12,12,10,0) 100%); opacity: 0; }
    #head { font-family: "DM Sans", sans-serif; position: absolute; left: 0; right: 0; top: 470px; text-align: center; font-weight: 700; font-size: 80px; line-height: 1; color: #efebe0; white-space: nowrap; opacity: 0; text-shadow: 0 4px 30px rgba(0,0,0,.8); }
    #head em { font-style: normal; color: #ff4d00; }
    #flash { position: absolute; left: 110px; right: 110px; top: 536px; height: 8px; background: #efebe0; opacity: 0; border-radius: 4px; box-shadow: 0 0 40px 10px rgba(157,255,176,.7); }
    /* ---------- scene 7: outro ---------- */
    #s7 { position: absolute; inset: 0; opacity: 0; }
    .hf-catalog-terminal-simulator { position: absolute; left: 410px; top: 270px; width: 1100px; border-radius: 22px; overflow: hidden; background: #070b08; color: #9dffb0; font-family: "JetBrains Mono", monospace; box-shadow: 0 0 0 2px rgba(255,77,0,.55), 0 0 90px rgba(255,77,0,.22), 0 28px 80px rgba(0,0,0,.6); }
    .hf-catalog-terminal-simulator .chrome { height: 52px; display: flex; align-items: center; gap: 8px; padding: 0 20px; background: #14110d; color: #aaa596; font-size: 20px; border-bottom: 1px solid rgba(255,77,0,.3); }
    .hf-catalog-terminal-simulator .dot { width: 12px; height: 12px; border-radius: 999px; background: #ff6b5e; box-shadow: 20px 0 #e8b04a, 40px 0 #7fc97a; margin-right: 56px; }
    .hf-catalog-terminal-simulator .terminal { position: relative; padding: 36px 48px 56px; min-height: 480px; }
    .prompt { font-size: 40px; line-height: 1.2; white-space: nowrap; display: flex; align-items: center; height: 56px; }
    .prompt .sig { color: #ff4d00; font-weight: 700; margin-right: 22px; }
    #typed { display: inline-block; overflow: hidden; width: 0; white-space: nowrap; color: #9dffb0; text-shadow: 0 0 14px rgba(157,255,176,.5); }
    #cur { display: inline-block; width: 22px; height: 44px; background: #9dffb0; margin-left: 4px; opacity: 0; }
    #mark { margin-top: 44px; font-weight: 700; font-size: 110px; line-height: 1.05; color: #ff4d00; white-space: nowrap; opacity: 0; text-shadow: 0 0 36px rgba(255,77,0,.55), 0 0 90px rgba(255,77,0,.25); }
    #tag { font-family: "DM Sans", sans-serif; margin-top: 26px; font-weight: 500; font-size: 36px; color: #efebe0; opacity: 0; }
    #tag i { font-style: normal; color: #ff4d00; padding: 0 10px; }
    #url { margin-top: 20px; font-family: "JetBrains Mono", monospace; font-size: 26px; color: #aaa596; opacity: 0; }
    .crt { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 1px, transparent 1px 3px); box-shadow: inset 0 0 120px rgba(0,0,0,.5); }
  </style>
  <div id="root" data-composition-id="outro" data-start="0" data-duration="4" data-width="1920" data-height="1080">
    <div id="s6" class="clip" data-start="0" data-duration="2.05" data-track-index="0">
      <div id="warp" class="yt-screen-warp3d">
        <div id="boardin">
        ${frameHtml}
        </div>
        <div class="yt-screen-fx" id="fx"></div>
      </div>
      <div id="scrim"></div>
      <h1 id="head">Every Claude Code session. <em>One screen.</em></h1>
      <div id="flash"></div>
    </div>
    <div id="s7" class="clip" data-start="2" data-duration="2" data-track-index="1">
      <div class="hf-catalog-terminal-simulator" id="term">
        <div class="chrome"><span class="dot"></span><span>~ / terminal</span></div>
        <div class="terminal">
          <div class="prompt"><span class="sig">$</span><span id="typed">${CMD}</span><span id="cur"></span></div>
          <div id="mark">ccstatusboard</div>
          <div id="tag">Free<i>·</i>open source<i>·</i>read-only</div>
          <div id="url">github.com/areimel/ccstatusboard</div>
          <div class="crt"></div>
        </div>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const ytScreenOn = (t, target, at) => t.to(target, { opacity: 1, duration: 0.5, ease: "power2.out" }, at);
    // frames step per beat
    const steps = ${JSON.stringify(stepT)};
    for (let i = 1; i < steps.length; i++) {
      tl.set("#tf" + (i - 1), { opacity: 0 }, steps[i]);
      tl.set("#tf" + i, { opacity: 1 }, steps[i]);
    }
    // screen on: board bends in
    gsap.set("#boardin", { scaleX: 1.04, scaleY: 0.9, opacity: 0, filter: "brightness(2.2)" });
    tl.to("#boardin", { scaleX: 1, scaleY: 1, opacity: 1, filter: "brightness(1)", duration: 0.4, ease: "power3.out" }, 0);
    ytScreenOn(tl, "#fx", 0);
    // headline
    tl.to("#scrim", { opacity: 1, duration: 0.25, ease: "power2.out" }, 0.15);
    tl.fromTo("#head", { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25, ease: "power3.out" }, 0.15);
    tl.to("#head", { opacity: 0, duration: 0.12, ease: "power2.in" }, 1.73);
    tl.to("#scrim", { opacity: 0, duration: 0.12 }, 1.73);
    // CRT power-down 1.75 -> 2.0
    tl.to("#boardin", { scaleY: 0.006, filter: "brightness(3)", duration: 0.14, ease: "power3.in" }, 1.75);
    tl.set("#flash", { opacity: 1 }, 1.88);
    tl.to("#boardin", { opacity: 0, duration: 0.02 }, 1.89);
    tl.to("#flash", { opacity: 0, scaleX: 0.02, duration: 0.11, ease: "power2.in" }, 1.9);
    tl.to("#fx", { opacity: 0, duration: 0.15, ease: "power2.in" }, 1.8);
    // scene 7: terminal powers on
    tl.set("#s7", { opacity: 1 }, 2.0);
    gsap.set("#term", { opacity: 0 });
    tl.fromTo("#term", { opacity: 0, filter: "brightness(2.5)" }, { opacity: 1, filter: "brightness(1)", duration: 0.12, ease: "power2.out" }, 2.0);
    tl.to("#typed", { width: "${CMD.length}ch", duration: 0.6, ease: "steps(${CMD.length})" }, 2.1);
    // cursor blink, driven by timeline
    for (let k = 0; k < 16; k++) tl.set("#cur", { opacity: k % 2 === 0 ? 1 : 0 }, 2.0 + k * 0.25);
    tl.set("#cur", { opacity: 1 }, 2.8);
    // reveal
    tl.fromTo("#mark", { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power3.out" }, 2.8);
    tl.fromTo("#tag", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.2, ease: "power3.out" }, 2.85);
    tl.fromTo("#url", { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power2.out" }, 2.9);
    window.__timelines["outro"] = tl;
  </script>
</template>
`;
writeFileSync(new URL("../composition/compositions/outro.html", import.meta.url), out);
console.log("ok", frames.length, "frames");
