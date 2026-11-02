import fs from 'node:fs';
let f='tui-export/build.mjs', s=fs.readFileSync(f,'utf8');
const rep=(a,b)=>{ if(!s.includes(a)) throw new Error('missing '+a); s=s.split(a).join(b); };
// title and first pane are on screen at 0s
rep(`#hook-t1 { top: 74px; }`,`#hook-t1 { top: 74px; opacity: 1; }`);
rep(`    tl.fromTo("#hook-t1", { opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, ease: "power2.out", immediateRender: false }, 0.04);\n`,'');
rep(`["#p1", "#p2", "#p3", "#p4", "#p5"].forEach((id, i) => pop(id, i * 0.25));`,`["#p2", "#p3", "#p4", "#p5"].forEach((id, i) => pop(id, (i + 1) * 0.25));`);
rep(`.pane { position: absolute; height: 212px;`,`#p1 { opacity: 1 !important; } .pane { position: absolute; height: 212px;`);
// box geometry follows the real text
rep(`const C = {`,`const endCol = (r) => ref[r].replace(/[\\s│]+$/, '').length;\nconst C = {`);
rep("hb('hb-rel', R.rel, R.rel, 1, 62)","hb('hb-rel', R.rel, R.rel, 1, endCol(R.rel) > 70 ? 67 : endCol(R.rel))");
rep("hb('hb-proj', R.proj, R.proj, 1, 48)","hb('hb-proj', R.proj, R.proj, 1, endCol(R.proj) + 1)");
rep("top:${(R.rel + 1.35) * LH}px\">waiting","top:${(R.rel + 1.15) * LH}px;width:${66 * CW}px\">waiting");
rep("font: 700 13px/22px","font: 700 16px/25px");
rep("move(cam(31, ${R.rel + 1}, 540, 560, 1.72), 3.0);","move(cam(33.5, ${R.rel + 1}, 540, 560, 1.55), 3.0);");
rep("move(cam(76, ${R.sys + 3.5}, 540, 600, 1.55), 7.5);","move(cam(76.5, ${R.sys + 3.5}, 540, 600, 1.62), 7.5);");
rep("move(cam(36, ${R.sys + 3.5}, 540, 600, 1.55), 10.0);","move(cam(35, ${R.sys + 3.5}, 540, 600, 1.62), 10.0);");
// credit card vertically centred
rep(".stat { position: absolute; top: 130px;",".stat { position: absolute; top: 164px;");
rep("#rule { position: absolute; left: 72px; top: 352px;","#rule { position: absolute; left: 72px; top: 386px;");
rep("#nm { position: absolute; left: 66px; top: 420px;","#nm { position: absolute; left: 66px; top: 454px;");
rep("#role { position: absolute; left: 72px; top: 596px;","#role { position: absolute; left: 72px; top: 630px;");
rep("#url { position: absolute; left: 72px; top: 776px;","#url { position: absolute; left: 72px; top: 790px;");
fs.writeFileSync(f,s);
f='tui-export/export.tsx'; s=fs.readFileSync(f,'utf8');
rep("celsius: lerp(64, 88, prog(t, 11, 14))","celsius: lerp(64, 90, prog(t, 11, 13.25))");
fs.writeFileSync(f,s);
