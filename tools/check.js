// tools/check.js — ヘッドレス Chrome で自動プレイし、画面写真・エラー・文字の重なり/はみ出し・スクロールを検査する。
// 使い方: node tools/check.js [--seed N] [--sizes 1920x910,1366x650,375x812] [--days 2] [--maxsec 120]
// 終了コード 0 = 合格。1 = 例外/pageerror、要求日数未完、重なり/はみ出し、スクロール違反（PC）のどれかあり。
// puppeteer-core は、このフォルダの node_modules か、C:/dev/gohan/node_modules のものを使う（試作の置き場所が決まったら npm install する）。
const path = require('path'); const fs = require('fs');
let puppeteer; for (const p of ['puppeteer-core', 'C:/dev/gohan/node_modules/puppeteer-core']) { try { puppeteer = require(p); break; } catch (e) { } }
if (!puppeteer) { console.error('puppeteer-core が見つからない'); process.exit(2); }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }
const seed = arg('seed', '7'); const sizes = arg('sizes', '1920x910,1366x650,375x812').split(',').map(s => s.split('x').map(Number));
const wantDays = parseInt(arg('days', '2'), 10); const maxSec = parseFloat(arg('maxsec', '120'));
const outDir = path.join(__dirname, '..', 'screenshots'); fs.mkdirSync(outDir, { recursive: true });
const url = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') + `?auto=1&mute=1&bg=1&fast=4&seed=${seed}`;

// ページ内で動かす検査：文字の行ごとの範囲を集めて、交差とはみ出しを数える（内側の overflow で隠れる部分は数えない。body の overflow:hidden は数える。消えかけ opacity<.3 と絵文字だけの印は除外）
const TEXT_CHECK = `(() => {
  const rects = []; const vw = innerWidth, vh = innerHeight;
  // モーダル（結果の画面）が出ている間は、その中の文字だけを見る（後ろの文字は不透明な箱に隠れている）
  const modal = document.querySelector('#modalWrap'); const modalOpen = modal && getComputedStyle(modal).display !== 'none';
  const walker = document.createTreeWalker(modalOpen ? document.querySelector('#modal') : document.body, NodeFilter.SHOW_TEXT);
  let node; while ((node = walker.nextNode())) {
    if (!node.nodeValue.trim()) continue; const el = node.parentElement; if (!el) continue;
    if (!/[0-9A-Za-z぀-ヿ㐀-鿿０-ｚ]/.test(node.nodeValue)) continue;   // 絵文字だけの印（⚡🔥💥 など）は文字として数えない
    let hidden = false; for (let a = el; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < .3) { hidden = true; break; } } if (hidden) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    let clip = { x: -1e9, y: -1e9, r: 1e9, b: 1e9 }; for (let a = el; a; a = a.parentElement) { if (a === document.body || a === document.documentElement) continue; const s = getComputedStyle(a); if (/(hidden|auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY)) { const cr = a.getBoundingClientRect(); clip = { x: Math.max(clip.x, cr.left), y: Math.max(clip.y, cr.top), r: Math.min(clip.r, cr.right), b: Math.min(clip.b, cr.bottom) }; } }
    for (const r0 of range.getClientRects()) { const x = Math.max(r0.left, clip.x), y = Math.max(r0.top, clip.y), r = Math.min(r0.right, clip.r), b = Math.min(r0.bottom, clip.b); if (r - x < 1 || b - y < 1) continue; rects.push({ x, y, w: r - x, h: b - y, t: node.nodeValue.trim().slice(0, 20), el }); }
  }
  let overlaps = 0, overflow = 0; const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i]; if (a.x < -1 || a.y < -1 || a.x + a.w > vw + 1 || a.y + a.h > vh + 1) { overflow++; pairs.push('はみ出し:' + a.t); }
    for (let j = i + 1; j < rects.length; j++) { const b = rects[j]; if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 3 && iy > 3) { overlaps++; pairs.push(a.t + ' × ' + b.t); } }
  }
  const scrollX = document.documentElement.scrollWidth - vw, scrollY = document.documentElement.scrollHeight - vh;
  return { texts: rects.length, overlaps, overflow, scrollX: Math.max(0, scrollX), scrollY: Math.max(0, scrollY), pairs: pairs.slice(0, 8) };
})()`;

(async () => {
  if (!CHROME) { console.error('Chrome が見つからない'); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--disable-gpu', '--no-first-run'] });
  let fail = 0; const report = { seed, url, sizes: [] };
  for (const [w, h] of sizes) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h });
    const errors = []; page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const t0 = Date.now(); const tag = `${w}x${h}`; const pc = w >= 900;
    const res = { size: tag, errors, text: { overlaps: 0, overflow: 0, scroll: 0, pairs: [] }, shots: [], checks: 0 };
    const textAgg = (r) => { res.checks++; res.text.overlaps += r.overlaps; res.text.overflow += r.overflow; if (pc && (r.scrollX > 0 || r.scrollY > 0)) res.text.scroll++; for (const p of r.pairs) if (res.text.pairs.length < 10 && !res.text.pairs.includes(p)) res.text.pairs.push(p); };
    const shot = async name => { const f = path.join(outDir, `${name}-${tag}.png`); await page.screenshot({ path: f }); res.shots.push(path.relative(path.join(__dirname, '..'), f)); };
    // タイトル（auto なしで一度見る）
    await page.goto(url.replace('auto=1&', '') + '&notitle=0', { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 200));
    textAgg(await page.evaluate(TEXT_CHECK)); await shot('01-title');
    // 自動プレイ
    await page.goto(url, { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 200));
    let state = null; let shots = 0; let lastDay = 1;
    while (Date.now() - t0 < maxSec * 1000) {
      state = await page.evaluate(() => window.__dg.state());
      if (state.over) break;
      if (state.day > lastDay) { lastDay = state.day; }
      if (state.day > wantDays) break;
      if (shots === 0 && state.time > 6) { await shot('02-play-a'); shots++; }
      if (shots === 1 && state.time > 40) { await shot('03-play-b'); shots++; }
      if (shots === 2 && state.modal) { await shot('04-dayend'); shots++; }
      textAgg(await page.evaluate(TEXT_CHECK)); await new Promise(r => setTimeout(r, 100));
    }
    state = await page.evaluate(() => window.__dg.state()); res.final = state;
    await shot('05-last');
    const reached = state && (state.day > wantDays || state.over);
    const ok = errors.length === 0 && res.text.overlaps === 0 && res.text.overflow === 0 && res.text.scroll === 0 && reached;
    res.ok = ok; if (!ok) fail = 1; report.sizes.push(res);
    console.log(`[${tag}] ${ok ? '合格' : '失敗'}  errors=${errors.length} overlaps=${res.text.overlaps} overflow=${res.text.overflow} scroll=${res.text.scroll} checks=${res.checks} reachedDay=${state && state.day} over=${state && state.over} ghosts=${state && state.ghosts} fired=${state && state.fired} hits=${state && state.hits} dodges=${state && state.dodges} misses=${state && state.misses}`);
    if (errors.length) console.log('  ' + errors.slice(0, 5).join('\n  '));
    if (res.text.pairs.length) console.log('  重なり/はみ出し: ' + res.text.pairs.join(' | '));
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'check-report.json'), JSON.stringify(report, null, 2));
  process.exit(fail);
})().catch(e => { console.error(e); process.exit(1); });
