// ui.js — 主催者画面。sim.js の出来事（events）を時間どおりに再生し、入力を sim に渡す。
// URL: ?seed=N 乱数の種 / ?skip=1 タイトルを飛ばす / ?auto=1 自動プレイ（無音・タイトル飛ばし） / ?bg=1 タイマーで進める / ?fast=N 速さ倍率
(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const seed = parseInt(Q.get('seed') || String(1 + Math.floor(Math.random() * 99999)), 10);
const AUTO = Q.get('auto') === '1';
const BG = Q.get('bg') === '1' || AUTO;
const FAST = Math.max(0.1, parseFloat(Q.get('fast') || '1'));
const SKIP = Q.get('skip') === '1' || AUTO;
const sim = DGSim.create({ seed }); const S = sim.S; const C = DGSim.C; const SK = DGSim.SKILLS; const TR = DGSim.TRAITS;
const A = (n) => 'assets/' + n;
const P = (pid) => sim.participant(pid);
const pname = (p) => p.name + (p.trait !== 'none' ? TR[p.trait].icon : '') + (p.pop >= C.POP.star ? '⭐' : '');
const U = { screen: 'title', speed: 1, modal: false, sel: null, acc: 0, mons: {}, actors: {}, host: { mood: 'cool', line: 'ふふふ…今夜も完璧な興行にしてみせよう', until: 0, img: 'cool' }, lastGauge: {} };
const BGPOS = { bridge: 'center 40%', daruma: 'center 48%', chairs: 'center 62%' };
const LINES = {
  cool: ['ふふふ…すべて計画通りだ', '今夜も完璧な興行にしてみせよう', '慌てるな…俺は冷静だ', '視聴者ども、震えて待て'],
  busy: ['ま、まあ想定の範囲内だ…！', 'あ、あっちも見ないと…！', 'て、手が足りない…！', 'ま、まだ大丈夫…大丈夫…'],
  panic: ['まってまってまって！！', 'そっちも！？ こっちも！？', 'だ、誰か！ スタッフー！', '計画と違う！！ 計画と違う！！'],
  dizzy: ['あわわわわ…', 'もう無理…目が回る…', 'た、助けて…'],
  good: ['よし！ …じゃなくて、計画通りだ！', 'ふふ、当然の結果だな（ドヤ）', '見たか！ これが主催者の力だ！'],
  bad: ['な、なぜよける…！', 'い、今のはわざとだ！ わざとだからな！', '空振り！？ うそだろ！？', 'あいつ、警戒してやがる…！'],
  natural: ['お、勝手に落ちた。ラッキー…じゃなくて計画通り', 'ほらな、俺の仕掛けは完璧だ（震え声）'],
  fire: ['いけっ…！', 'ここだ…！', '頼む、当たれ…！'],
  star: ['人気者が落ちた！ 視聴者が沸いてる！', 'これだ！ これが見たかったんだろ！'],
};
const SIGN = { away: ['🏃 すすめ！', 'green'], turning: ['！ 振り向く…', 'yellow'], look: ['👀 みてる！', 'red'], music: ['🎵 音楽中', ''], stop: ['🛑 ストップ！', 'red'], bridge: ['🌉 1枚ずつ跳んで渡る', ''] };

// ---------- 組み立て ----------
function buildMonitors() {
  const wrap = $('#monitors'); wrap.innerHTML = '';
  for (const v of S.venues) {
    const el = document.createElement('div'); el.className = 'monitor'; el.dataset.vid = v.id;
    el.innerHTML = `<div class="mtitle"><span class="mno">会場${v.id}</span><span class="mname">${v.name}</span><span class="mlive">LIVE</span></div>
      <div class="stage kind-${v.kind}" style="background-image:url('${A('venue-' + v.kind + '.jpg')}');background-position:${BGPOS[v.kind]}">
        <div class="cast"></div><div class="sign"></div><div class="panicbadge">💀 パニックモード</div>
        <div class="lockframe"><i></i><i></i><i></i><i></i><span>TARGET LOCKED</span></div>
      </div>
      <div class="mfoot"><div class="hype"><span>盛り上がり</span><div class="bar"><i></i></div></div><div class="alive">👤 8</div><div class="status"></div></div>`;
    el.addEventListener('click', () => monitorTapped(v));
    wrap.appendChild(el);
    U.mons[v.id] = { el, stage: el.querySelector('.stage'), cast: el.querySelector('.cast'), sign: el.querySelector('.sign'), hype: el.querySelector('.hype .bar > i'), alive: el.querySelector('.alive'), status: el.querySelector('.status') };
  }
}
function buildSkills() {
  const bar = $('#skillBar'); bar.innerHTML = '';
  SK.forEach((sk, i) => {
    const b = document.createElement('button'); b.className = 'skill'; b.dataset.sid = sk.id; b.title = sk.desc;
    b.innerHTML = `<span class="key">${i + 1}</span><span class="ic">${sk.icon}</span><span class="nm">${sk.name}</span><span class="ct"></span><div class="cd"><i></i></div>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); skillTapped(sk.id); });
    bar.appendChild(b);
  });
}

// ---------- 入力 ----------
function hint(text, warn) { const h = $('#hint'); h.textContent = text; h.classList.toggle('hot', !!warn); }
function reasonText(r) { return { cooldown: 'まだクールダウン中', money: '資金が足りない', venue: 'その会場は試合の合間', locked: 'その会場は狙っている最中', paused: '一時停止中' }[r] || r; }
function skillTapped(id) {
  if (U.screen !== 'play' || U.modal) return;
  const sk = DGSim.SKILL[id];
  if ((S.cooldown[id] || 0) > 0) { hint(`${sk.name}はクールダウン中（あと${Math.ceil(S.cooldown[id])}秒）`, true); return; }
  if (S.money < sk.cost) { hint(`資金が足りない（${sk.name}は💰${sk.cost}）`, true); return; }
  U.sel = U.sel === id ? null : id;
  hint(U.sel ? `${sk.icon} ${sk.name}：${sk.desc}。会場を押す（J K L）` : '技を選ぶと、当たる相手がいる会場が光る');
  renderSkills(); renderTargetable();
}
function monitorTapped(v) {
  if (U.screen !== 'play' || U.modal) return;
  if (!U.sel) { hint('先に技を選んでね（1〜4）', true); return; }
  const res = sim.fire(U.sel, v.id);
  if (!res.ok) { hint(reasonText(res.reason), true); return; }
  U.sel = null; hint('技を選ぶと、当たる相手がいる会場が光る'); renderSkills(); renderTargetable();
}
function setSpeed(s) { U.speed = s; ['sp0', 'sp1', 'sp2'].forEach((id, i) => $('#' + id).classList.toggle('on', [0, 1, 2][i] === s)); }
document.addEventListener('keydown', (e) => {
  if (U.screen !== 'play') return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '4') skillTapped(SK[parseInt(k, 10) - 1].id);
  else if (k === 'j' || k === 'k' || k === 'l') { const v = S.venues[{ j: 0, k: 1, l: 2 }[k]]; if (v) monitorTapped(v); }
  else if (k === ' ') { e.preventDefault(); setSpeed(U.speed === 0 ? 1 : 0); }
  else if (k === 'escape') { U.sel = null; renderSkills(); renderTargetable(); }
});
$('#sp0').addEventListener('click', () => setSpeed(0));
$('#sp1').addEventListener('click', () => setSpeed(1));
$('#sp2').addEventListener('click', () => setSpeed(2));

// ---------- 出来事の再生 ----------
function log(msg, cls) {
  const el = document.createElement('div'); if (cls) el.className = cls; el.innerHTML = msg;
  const box = $('#log'); box.prepend(el); while (box.children.length > 40) box.lastChild.remove();
}
function setStatus(v, text, hot) { const M = U.mons[v.id]; M.status.textContent = text; M.status.classList.toggle('hot', !!hot); }
function setSign(v, key, extra) {
  const M = U.mons[v.id]; const s = SIGN[key]; if (!s) { M.sign.textContent = ''; M.sign.className = 'sign'; return; }
  M.sign.textContent = s[0] + (extra || ''); M.sign.className = 'sign ' + s[1];
}
function flashClass(el, cls, ms) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
function bump(id) { const el = $('#top .g-' + id); if (el) flashClass(el, 'fx-bump', 400); }
function hostReact(kind, hold) {
  const H = U.host; H.mood = kind; H.until = S.time + (hold || 3);
  const lines = LINES[kind] || LINES.cool; H.line = lines[Math.floor(Math.random() * lines.length)];
  if (kind === 'bad' || kind === 'panic') flashClass($('.hcam'), 'fx-jolt', 400);
}
function actorEl(pid) { return U.actors[pid]; }
function rebuildCast(v) {
  const M = U.mons[v.id];
  for (const pid of Object.keys(U.actors)) { const a = U.actors[pid]; if (a.vid === v.id && !v.pids.includes(+pid)) { a.el.remove(); delete U.actors[pid]; } }
  for (const pid of v.pids) {
    if (U.actors[pid]) continue;
    const p = P(pid);
    const el = document.createElement('div'); el.className = 'actor';
    el.innerHTML = `<span class="mark">❗</span><div class="body"><img class="chibi" src="${A('chibi-' + String(p.chibi).padStart(2, '0') + '.png')}" alt=""><span class="boom">💥</span></div><span class="badge">${p.trait !== 'none' ? TR[p.trait].icon : ''}</span><span class="star">${p.pop >= C.POP.star ? '⭐' : ''}</span><span class="wary"></span>`;
    el.title = `${p.name}（${p.persona}・${TR[p.trait].name}）`;
    M.cast.appendChild(el);
    U.actors[pid] = { el, vid: v.id, img: el.querySelector('img'), wary: el.querySelector('.wary'), star: el.querySelector('.star') };
  }
}
function spawnGhost(v, pid, x, y) {
  const M = U.mons[v.id]; const p = P(pid);
  const g = document.createElement('div'); g.className = 'ghost'; g.style.left = x + '%'; g.style.top = y + '%';
  g.innerHTML = `<img src="${A('ghost-' + String(p.ghost).padStart(2, '0') + '.png')}" alt="">`;
  M.cast.appendChild(g); setTimeout(() => g.remove(), 1900);
}
function sparkles(v) {
  const M = U.mons[v.id];
  for (let i = 0; i < 8; i++) { const s = document.createElement('span'); s.className = 'fx-sparkle'; s.textContent = ['✨', '🎉', '⭐', '🎊'][i % 4]; s.style.left = (10 + Math.random() * 80) + '%'; s.style.top = (20 + Math.random() * 60) + '%'; s.style.animationDelay = (Math.random() * 0.5) + 's'; M.cast.appendChild(s); setTimeout(() => s.remove(), 2000); }
}
function dropFx(v, pid) {
  const a = U.actors[pid]; if (!a) return; const M = U.mons[v.id];
  const d = document.createElement('span'); d.className = 'fx-drop'; d.textContent = '🪨'; d.style.left = a.el.style.left; d.style.top = a.el.style.top; M.cast.appendChild(d); setTimeout(() => d.remove(), 700);
}
function handleEvents() {
  for (const e of sim.drain()) {
    const v = e.venue ? S.venues[e.venue - 1] : null; const M = v ? U.mons[v.id] : null; const p = e.pid ? P(e.pid) : null;
    switch (e.type) {
      case 'matchStart': rebuildCast(v); setSign(v, v.kind === 'bridge' ? 'bridge' : v.kind === 'daruma' ? 'away' : 'music', v.kind === 'chairs' ? `・椅子${v.m.chairs}` : ''); setStatus(v, `第${e.matchNo}試合 スタート！ ${e.pids.length}人`); log(`🏟 会場${v.id}「${v.name}」第${e.matchNo}試合 スタート（${e.pids.length}人）`, 'sys'); break;
      case 'matchEnd': setStatus(v, `終了。収入 +${e.pay}。生き残り ${e.survivors.length}人${e.cut ? '（時間切れ）' : ''}`); log(`🏁 会場${v.id}「${v.name}」終了：脱落 ${e.elims}人（主催者の技 ${e.elimsHost}）・収入 +${e.pay}`, 'good'); bump('money'); setSign(v, null); break;
      case 'goal': { const a = actorEl(e.pid); if (a) a.el.classList.add('safe'); break; }
      case 'fire': { const sk = DGSim.SKILL[e.skill]; log(`${sk.icon} <b>${sk.name}</b> → 会場${v.id}`); hostReact('fire', 1.2); const b = $(`.skill[data-sid="${e.skill}"]`); if (b) flashClass(b, 'fx-ready', 400); if (sk.cost) bump('money'); break; }
      case 'lock': setStatus(v, `🎯 狙っている…（${e.windup.toFixed(1)}秒）`, true); break;
      case 'alert': { const a = actorEl(e.pid); if (a) flashClass(a.el, 'alerted', 1200); break; }
      case 'hit': { flashClass(M.stage, 'fx-flash', 350); if (e.skill === 'obstacle') dropFx(v, e.pid); break; }
      case 'elim': {
        const a = actorEl(e.pid);
        if (a) { const x = a.el.style.left, y = a.el.style.top; a.el.classList.add('fx-burst'); const el = a.el; setTimeout(() => { el.remove(); spawnGhost(v, e.pid, parseFloat(x), parseFloat(y)); }, 330); delete U.actors[e.pid]; }
        setStatus(v, `💥 ${pname(p)}：${e.how} → 👻おばけ化`, true);
        if (e.cause === 'host') { log(`💥 <b>${pname(p)}</b>（${p.persona}）：${e.how}！ → 👻 ${e.star ? '<span class="hl">人気者が脱落！ 視聴者騒然！</span>' : ''}`, e.star ? 'hl' : ''); hostReact(e.star ? 'star' : 'good', 2.5); bump('rating'); bump('susp'); }
        else { log(`👻 ${pname(p)}（${p.persona}）：${e.how} → おばけになってフワフワ退場`); hostReact('natural', 2); }
        break; }
      case 'dodge': { const a = actorEl(e.pid); if (a) flashClass(a.el, 'fx-dodge', 500); setStatus(v, `😤 ${pname(p)} が${e.why}でよけた！`, true); log(`😤 <b>${pname(p)}</b> が <span class="hl">${e.why}</span> でよけた！（🔥${e.wary}）`, 'bad'); hostReact('bad', 2.5); break; }
      case 'miss': setStatus(v, `💨 空振り：${e.reason}`, true); log(`💨 空振り！ ${e.reason}`, 'bad'); hostReact('bad', 2.5); break;
      case 'shake': flashClass(M.stage, 'fx-shake', 400); break;
      case 'turning': setSign(v, 'turning'); break;
      case 'look': setSign(v, 'look'); if (e.sudden) setStatus(v, '👀 急に振り向いた！', true); break;
      case 'away': setSign(v, 'away'); break;
      case 'music': setSign(v, 'music', `・椅子${e.chairs}`); setStatus(v, `第${e.round}ラウンド：椅子 ${e.chairs}`); break;
      case 'stop': setSign(v, 'stop'); if (e.byHost) setStatus(v, '🛑 主催者が音楽を止めた！', true); break;
      case 'boost': sparkles(v); setStatus(v, '🎆 イベント演出！ 視聴率アップ', true); log(`⭐ 会場${v.id}でイベント演出！ 視聴率 +${C.RATING.boost}`, 'good'); hostReact('good', 2); bump('rating'); break;
      case 'panicMode': setStatus(v, '💀 パニックモード！ 8秒間、参加者はよけにくい', true); log(`💀 会場${v.id}がパニックモードに！`, 'bad'); break;
      case 'ready': { const b = $(`.skill[data-sid="${e.skill}"]`); if (b) flashClass(b, 'fx-ready', 600); break; }
      case 'dayEnd': showDaySummary(e); break;
      case 'dayStart': log(`🌅 ${e.day}日目 スタート`, 'sys'); break;
      case 'over': showEnding(e); break;
    }
  }
}

// ---------- 描画 ----------
function actorPos(v, a) {
  if (v.kind === 'bridge') {
    // 絵の橋は左下から右上へ斜めに伸びているので、進むほど少し上に置く
    const n = v.m.pairs; const px = (panel) => 7 + (panel + 1) * (84 / (n + 1)); const py = (side, panel) => 66 - (panel + 1) * 2.4 + (side ? 7 : -5);
    if (a.hopping) { const f = 1 - a.hopT / 1.0; return { x: px(a.panel) + (px(a.nextPanel) - px(a.panel)) * f, y: py(a.side, a.panel) + (py(a.nextSide, a.nextPanel) - py(a.side, a.panel)) * f, lift: Math.sin(f * Math.PI) * 24, z: 6, move: true }; }
    if (a.done) return { x: 95, y: 40 + (a.pid % 4) * 5, lift: 0, z: 2, move: false };
    return { x: px(a.panel), y: py(a.side, a.panel) + (a.panel < 0 ? (a.pid % 5) * 5 - 8 : 0), lift: 0, z: 3, move: false };
  }
  if (v.kind === 'daruma') return { x: 4 + a.lane * 1.6 + a.x * 0.86, y: 64 + a.lane * 3.8, lift: 0, z: 2 + a.lane, move: a.moving };
  const pos = ((a.ang % 1) + 1) % 1; const th = pos * Math.PI * 2; const s = Math.sin(th);
  return { x: 50 + 37 * Math.cos(th), y: 62 + 15 * s, lift: 0, z: 2 + Math.round((s + 1) * 4), move: v.m.phase === 'music' && a.alert <= 0 };
}
function renderActors() {
  for (const v of S.venues) {
    const M = U.mons[v.id];
    if (v.phase !== 'running') { M.el.classList.remove('locked'); M.stage.classList.remove('looking', 'panicmode'); continue; }
    for (const pid of v.pids) {
      const p = P(pid); const a = v.actors[pid]; const ae = U.actors[pid]; if (!p.alive || !a || !ae) continue;
      const pos = actorPos(v, a);
      ae.el.style.left = pos.x.toFixed(1) + '%'; ae.el.style.top = pos.y.toFixed(1) + '%'; ae.el.style.zIndex = pos.z; ae.el.style.marginTop = (-pos.lift) + 'px';
      ae.el.classList.toggle('moving', !!pos.move); ae.el.classList.toggle('still', !pos.move);
      ae.el.classList.toggle('seated', v.kind === 'chairs' && !!a.seated && v.m.phase === 'sit');
      const w = '🔥'.repeat(Math.min(3, p.wary)); if (ae.wary.textContent !== w) ae.wary.textContent = w;
      const st = p.pop >= C.POP.star ? '⭐' : ''; if (ae.star.textContent !== st) ae.star.textContent = st;
    }
    M.el.classList.toggle('locked', !!v.lock);
    M.stage.classList.toggle('looking', v.kind === 'daruma' && v.m.phase === 'look');
    M.stage.classList.toggle('panicmode', v.panicUntil > S.time);
    M.hype.style.width = Math.round(v.hype) + '%';
    M.alive.textContent = '👤 ' + v.pids.filter(pid => P(pid).alive).length;
  }
}
function renderGauges() {
  const set = (id, val, max) => { const g = $('#top .g-' + id); g.querySelector('.lab b').textContent = Math.round(val); g.querySelector('.bar > i').style.width = Math.max(0, Math.min(100, val / max * 100)) + '%'; };
  set('rating', S.rating, 100); set('money', S.money, 1000); set('panic', S.panic, 100); set('susp', S.suspicion, 100);
  $('#dayNum').textContent = S.day; $('#dayTime').textContent = Math.max(0, Math.ceil(S.dayT));
}
function renderSkills() {
  for (const sk of SK) {
    const b = $(`.skill[data-sid="${sk.id}"]`); const cd = S.cooldown[sk.id] || 0;
    b.classList.toggle('cooling', cd > 0); b.classList.toggle('sel', U.sel === sk.id); b.classList.toggle('poor', S.money < sk.cost);
    const ct = cd > 0 ? `あと ${Math.ceil(cd)} 秒` : `${sk.cost ? '💰' + sk.cost : '無料'}・🚔${sk.susp > 0 ? '+' : ''}${sk.susp}`;
    const ctEl = b.querySelector('.ct'); if (ctEl.textContent !== ct) ctEl.textContent = ct;
    b.querySelector('.cd i').style.width = cd > 0 ? (100 - cd / sk.cd * 100) + '%' : '0%';
  }
}
function renderTargetable() {
  for (const v of S.venues) {
    const M = U.mons[v.id]; const sel = U.sel;
    const can = sel && v.phase === 'running' && !v.lock;
    const targets = can && (sel === 'trap' || sel === 'obstacle') ? sim.vulnerable(v.id, sel) : [];
    M.el.classList.toggle('targetable', !!(can && (targets.length || sel === 'boost' || sel === 'panic')));
    M.el.classList.toggle('selectable', !!can);
  }
}
function renderHost() {
  const H = U.host; const img = $('#hostImg'); const cam = $('.hcam');
  let mood = H.until > S.time ? H.mood : (S.panic >= 75 ? 'dizzy' : S.panic >= 40 ? 'busy' : 'cool');
  if (H.until <= S.time && mood !== H.mood) { H.mood = mood; const lines = LINES[mood]; H.line = lines[Math.floor(Math.random() * lines.length)]; }
  const want = (mood === 'bad' || mood === 'panic' || mood === 'fire') ? 'panic' : mood === 'dizzy' ? 'dizzy' : (mood === 'busy' && S.panic >= 60) ? 'panic' : 'cool';
  if (want !== H.img) { H.img = want; img.src = A('master-' + want + '.png'); }
  cam.classList.toggle('sweaty', S.panic >= 40 || mood === 'bad');
  const say = $('#hostSay'); if (say.textContent !== H.line) say.textContent = H.line;
}
let slowT = 0;
function render(real) {
  if (U.screen !== 'play') return;
  renderActors();
  slowT += real; if (slowT >= 0.1) { slowT = 0; renderGauges(); renderSkills(); renderTargetable(); renderHost(); }
}

// ---------- 進行 ----------
function advance(real) {
  if (U.screen !== 'play' || U.modal || U.speed === 0) return;
  U.acc += real * U.speed * FAST; let guard = 0;
  while (U.acc >= 0.1 && guard++ < 80) { U.acc -= 0.1; sim.step(0.1); if (AUTO && S.phase === 'play') DGSim.policies.timing(sim); if (S.phase !== 'play') { U.acc = 0; break; } }
  handleEvents();
}
let last = performance.now();
if (BG) { setInterval(() => { advance(0.05); render(0.05); }, 50); }
else { const frame = (now) => { const real = Math.min(0.25, (now - last) / 1000); last = now; advance(real); render(real); requestAnimationFrame(frame); }; requestAnimationFrame(frame); }

// ---------- モーダル ----------
function showModal(title, text, btns) {
  U.modal = true; $('#mTitle').textContent = title; $('#mText').textContent = text;
  const bw = $('#mBtns'); bw.innerHTML = '';
  for (const b of btns) { const btn = document.createElement('button'); btn.textContent = b.label; btn.addEventListener('click', () => { hideModal(); b.fn && b.fn(); }); bw.appendChild(btn); }
  $('#modalWrap').classList.remove('hidden');
}
function hideModal() { $('#modalWrap').classList.add('hidden'); U.modal = false; }
function showDaySummary(e) {
  const text = `スポンサー収入 +${e.sponsor}　会場の維持費 −${e.upkeep}\n今日の脱落 ${e.elims}人（主催者の技で ${e.elimsHost}人）\n\n視聴率 ${e.rating}（目標 ${C.GOAL_RATING}）\n資金 ${e.money}（目標 ${C.GOAL_MONEY}）\n疑惑度 ${e.suspicion}（100で逮捕）`;
  if (S.phase === 'over') return;   // 終わりの画面が続く
  showModal(`🌙 ${e.day}日目 終了`, text, [{ label: `▶ ${e.day + 1}日目へ`, fn: () => { sim.nextDay(); } }]);
  if (AUTO) setTimeout(() => { if (U.modal) { hideModal(); sim.nextDay(); } }, 600);
}
function showEnding(e) {
  const titles = { clear: '🏆 シーズン成功！', arrest: '🚔 逮捕エンド', bankrupt: '💸 破産エンド', fail: '📉 打ち切りエンド' };
  const texts = {
    clear: '視聴率も資金も目標達成！ デスゲームは大成功の興行となった。主催者は汗を拭いて、次のシーズンの企画書を開く…。',
    arrest: '疑惑度が限界に達した。ある朝、管制室のドアが叩かれた――。主催者のシーズンはここで終わった。',
    bankrupt: '資金が底をついた。スポンサーは去り、会場の照明が落ちる。デスゲームは静かに幕を閉じた。',
    fail: '最終日を迎えたが、目標には届かなかった。番組は打ち切り。主催者は次の企画を探しにいく…。',
  };
  const text = `${texts[e.kind]}\n\n最終成績：視聴率 ${e.rating}／資金 ${e.money}／疑惑度 ${e.suspicion}／脱落者 ${e.ghosts}人\n（種 ${seed}）`;
  showModal(titles[e.kind], text, [
    { label: '🔁 同じ種でもう一度', fn: () => { location.search = '?seed=' + seed + '&skip=1'; } },
    { label: '🎲 別の種で遊ぶ', fn: () => { location.search = '?skip=1'; } },
  ]);
  U.modal = true;
}

// ---------- 開始 ----------
function start() {
  if (U.screen === 'play') return;
  U.screen = 'play'; $('#title').classList.add('hidden'); $('#game').classList.remove('hidden');
  log('🎬 シーズン開幕！ 技を押して、会場を押す。参加者が「跳んでいる・動いている」ときが狙い目', 'sys');
  log(`目標：14日目に 視聴率${C.GOAL_RATING}・資金${C.GOAL_MONEY}。疑惑度100で逮捕`, 'sys');
  handleEvents(); renderGauges(); renderSkills(); renderHost();
}
$('#seedInfo').textContent = `種 ${seed}（URL に ?seed=${seed} で同じ試合を再現）`;
$('#startBtn').addEventListener('click', start);
buildMonitors(); buildSkills();
if (SKIP) start();

window.__dg = {
  sim, get screen() { return U.screen; }, start, setSpeed, fire: (s, v) => sim.fire(s, v),
  state() { return { screen: U.screen, day: S.day, dayT: S.dayT, time: S.time, rating: S.rating, money: S.money, panic: S.panic, suspicion: S.suspicion, phase: S.phase, over: S.over, modal: U.modal, ghosts: S.ghosts.length, fired: S.fired, hits: S.hits, dodges: S.dodges, misses: S.misses }; },
  nextDay() { if (U.modal) hideModal(); return sim.nextDay(); },
  select(id) { U.sel = id; renderSkills(); renderTargetable(); },
};
})();
