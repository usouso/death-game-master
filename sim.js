// sim.js — デスゲーム主催者シミュレータ ルール部分（画面なし）
// ブラウザ（window.DGSim）と Node（require）の両方で使う。乱数は seed で固定。
// 画面は、このファイルが出す「出来事（events）」を時間どおりに再生するだけにする。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DGSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EPS = 1e-6;   // タイマーの比較用（0.5 - 0.1*5 が 0 にならない対策）

// ---------------- 数値（全部ここ。ボットで測って直す） ----------------
const C = {
  SEASON_DAYS: 14, DAY_LEN: 90, GOAL_RATING: 70, GOAL_MONEY: 800,
  START: { rating: 30, money: 300, panic: 10, suspicion: 10 },
  MATCH_SIZE: 8, VENUE_UPKEEP: 55, SPONSOR_PER_RATING: 2.0, BETWEEN_MATCHES: 3,
  MATCH_PAY: { base: 6, perRating: 0.05, perElim: 3 },
  RATING: { elimHost: 2.5, elimNatural: 0.4, popBonus: 2, dodge: 0.6, boost: 5, floor: 20, decayK: 0.005 },
  HYPE: { elimHost: 15, elimNatural: 10, dodge: 8, miss: 2, boost: 25, panicMode: 8, panicModePerSec: 1, decay: 1.2, popPresence: 3 },
  PANIC: { miss: 8, dodge: 5, fire: 2, natural: 2, decay: 1.5, windupSlowAt: 60, windupMul: 1.3, cdSlowAt: 80, cdMul: 0.75 },
  SUSP: { elimHost: 2, elimNatural: 0, dayDecay: 12, perSec: 0.05 },
  DODGE: { agile: 0.45, wary: 0.12, waryMax: 3, panicModeMul: 0.5 },   // wary＝警戒🔥。会場に技を撃つたびに、その会場の全員が +1
  POP: { star: 5, max: 6 },
};

const SKILLS = [
  { id: 'trap',     name: 'トラップ発動',     icon: '⚡', cd: 8,  cost: 0,  susp: 2,  windup: 0.8, maxHits: 2, desc: '会場の仕掛けを作動。跳んでいる・動いている参加者に当たる' },
  { id: 'obstacle', name: '障害物落とし',     icon: '💣', cd: 12, cost: 10, susp: 2,  windup: 1.2, maxHits: 1, desc: '先頭の参加者の足元に落とす。1人に当たる' },
  { id: 'panic',    name: 'パニックモード',   icon: '💀', cd: 25, cost: 25, susp: 4,  windup: 0,   duration: 8, desc: '8秒間、会場が難しくなる。参加者はよけにくくなる' },
  { id: 'boost',    name: 'イベントブースト', icon: '⭐', cd: 20, cost: 40, susp: -2, windup: 0,   desc: '演出で視聴率 +5。脱落は出ない。疑惑が少し下がる' },
];
const SKILL = Object.fromEntries(SKILLS.map(s => [s.id, s]));

const TRAITS = {
  agile:  { id: 'agile',  name: 'すばしっこい', icon: '⚡', desc: '技をよける（45%）' },
  sense:  { id: 'sense',  name: '勘がいい',     icon: '👁', desc: '予兆に気づいて止まる' },
  guts:   { id: 'guts',   name: '度胸',         icon: '💪', desc: '先に進む。速い' },
  clumsy: { id: 'clumsy', name: 'あわてんぼう', icon: '💦', desc: '自分で失敗しやすい' },
  none:   { id: 'none',   name: 'ふつう',       icon: '',   desc: '' },
};
const NAMES = ['ハルト','ユイ','ソラ','リン','カイト','ミオ','レン','アカリ','ショウ','ヒナ','ダイチ','サクラ','ユウト','メイ','コウキ','アオイ','ツバサ','ノア','リク','カンナ','セナ','タクミ','ユラ','ケン','マホ','シン','アヤ','ゴウ','チカ','リュウ','エマ','ジン','ホタル','カズ','ミク','オト','サラ','テツ','ナギ','フウ'];
const PERSONA = ['熱血','クール','天然','策士','臆病','目立ちたがり','優しい','負けず嫌い','マイペース','お調子者'];

// ---------------- 参加者 ----------------
function makeParticipant(S) {
  const i = S.nextPid++;
  const r = S.rng; const t = r();
  const trait = t < 0.18 ? 'agile' : t < 0.36 ? 'sense' : t < 0.52 ? 'guts' : t < 0.68 ? 'clumsy' : 'none';
  return {
    id: i, name: NAMES[(i * 7) % NAMES.length] + (i > NAMES.length ? Math.ceil(i / NAMES.length) : ''),
    persona: r.pick(PERSONA), trait,
    face: ((i - 1) % 12) + 1, chibi: ((i - 1) % 12) + 1, ghost: ((i - 1) % 6) + 1,
    pop: r.int(1, 2), alive: true, busy: false, matches: 0, survived: 0, wary: 0, outDay: 0, outHow: '',
  };
}
function pById(S, pid) { return S.pool[pid - 1]; }

// ---------------- 会場（3種） ----------------
// 各会場は start / step / vulnerable(skill) / onTrap / warn / progress を持つ。actors は参加者ごとの会場内の状態。
const VENUES = {
  bridge: {
    name: 'ガラスの橋', dur: 40, pairs: 8,
    start(v, S) {
      const r = S.rng;
      v.m = { pairs: this.pairs, safe: Array.from({ length: this.pairs }, () => r.int(0, 1)), known: Array(this.pairs).fill(-1), crack: -1, crackT: 0 };
      v.pids.forEach((pid, i) => {
        const p = pById(S, pid);
        v.actors[pid] = { pid, panel: -1, side: 0, hopping: false, hopT: (p.trait === 'guts' ? r.range(0.8, 1.6) : r.range(1.4, 2.8)) + i * 0.3, nextPanel: -1, nextSide: 0, done: false, alert: 0 };
      });
    },
    step(v, S, dt) {
      const m = v.m; const r = S.rng; const panicOn = v.panicUntil > S.time;
      if (m.crackT > 0) { m.crackT -= dt; if (m.crackT <= EPS) m.crack = -1; }
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive && !a.done);
      const lead = alive.reduce((mx, a) => Math.max(mx, a.panel), -1);
      for (const a of alive) {
        const p = pById(S, a.pid);
        if (a.hopping) {
          a.hopT -= dt;
          if (a.hopT <= EPS) {
            a.hopping = false; a.panel = a.nextPanel; a.side = a.nextSide;
            if (a.panel >= m.pairs) { a.done = true; emit(S, { type: 'goal', venue: v.id, pid: a.pid }); continue; }
            if (m.safe[a.panel] !== a.side) {
              m.known[a.panel] = m.safe[a.panel]; m.crack = a.panel; m.crackT = 1.2;
              eliminate(S, v, p, 'natural', 'ガラスが割れた');
              continue;
            }
            m.known[a.panel] = a.side;
            a.hopT = (p.trait === 'guts' ? r.range(0.8, 1.5) : r.range(1.4, 2.6)) * (panicOn ? 0.5 : 1);
          }
          continue;
        }
        if (a.alert > 0) { a.alert -= dt; continue; }   // 予兆に気づいて足を止めている
        a.hopT -= dt;
        if (a.hopT > EPS) continue;
        const next = a.panel + 1; let side = 0;
        if (next < m.pairs) {
          if (m.known[next] >= 0) side = m.known[next];
          else {
            if (a.panel < lead || alive.some(o => o.hopping && o.nextPanel === next)) { a.hopT = 0.4; continue; }   // 先頭でない人は、先頭が確かめるのを待つ
            const see = (p.trait === 'sense' ? 0.92 : 0.86) - (panicOn ? 0.25 : 0);
            side = r() < see ? m.safe[next] : 1 - m.safe[next];
          }
        }
        a.hopping = true; a.hopT = 1.0; a.nextPanel = next; a.nextSide = side;
        emit(S, { type: 'hop', venue: v.id, pid: a.pid, panel: next, side });
      }
      const left = v.pids.filter(pid => pById(S, pid).alive && !v.actors[pid].done).length;
      return left === 0 || v.t >= this.dur;
    },
    vulnerable(v, S, skillId) {
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive && !a.done);
      if (skillId === 'trap') return alive.filter(a => a.hopping).map(a => ({ pid: a.pid, reason: '跳んでいる最中に橋が揺れた' }));
      if (skillId === 'obstacle') {
        const standing = alive.filter(a => !a.hopping && a.panel >= 0);
        if (!standing.length) return [];
        const lead = standing.reduce((b, a) => a.panel > b.panel ? a : b, standing[0]);
        return [{ pid: lead.pid, reason: '足元のガラスに障害物が落ちた' }];
      }
      return [];
    },
    onTrap(v, S) { emit(S, { type: 'shake', venue: v.id }); },
    warn(v, S, windup) {  // 予兆：勘がいい人は足を止める
      for (const pid of v.pids) { const p = pById(S, pid); const a = v.actors[pid]; if (p.alive && !a.done && p.trait === 'sense' && !a.hopping) { a.alert = windup + 0.4; emit(S, { type: 'alert', venue: v.id, pid }); } }
    },
    progress(v, S) { const m = v.m; const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive); const lead = alive.reduce((mx, a) => Math.max(mx, a.done ? m.pairs : a.panel), -1); return clamp((lead + 1) / (m.pairs + 1), 0, 1); },
  },

  daruma: {
    name: 'だるまさんがころんだ', dur: 40,
    start(v, S) {
      const r = S.rng;
      v.m = { phase: 'away', t: r.range(2.0, 3.5), turnT: 0 };
      v.pids.forEach((pid, i) => {
        const p = pById(S, pid);
        v.actors[pid] = { pid, x: 0, speed: (p.trait === 'guts' ? r.range(9, 11) : r.range(6.5, 9)), moving: true, stopAt: 0, done: false, alert: 0, lane: i };
      });
    },
    step(v, S, dt) {
      const m = v.m; const r = S.rng; const panicOn = v.panicUntil > S.time;
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive && !a.done);
      m.t -= dt;
      if (m.phase === 'away') {
        for (const a of alive) {
          if (a.alert > 0) { a.alert -= dt; a.moving = false; continue; }
          a.moving = true; a.x += a.speed * dt;
          if (a.x >= 100) { a.x = 100; a.done = true; a.moving = false; emit(S, { type: 'goal', venue: v.id, pid: a.pid }); }
        }
        if (m.t <= EPS) {
          m.phase = 'turning'; m.t = panicOn ? 0.3 : 0.5; m.turnT = 0;
          for (const a of alive) { const p = pById(S, a.pid); a.stopAt = (p.trait === 'sense' ? 0.1 + r.range(0, 0.15) : p.trait === 'clumsy' ? 0.33 + r.range(0, 0.25) : 0.25 + r.range(0, 0.22)) + (panicOn ? 0.1 : 0); }
          emit(S, { type: 'turning', venue: v.id });
        }
      } else if (m.phase === 'turning') {
        m.turnT += dt;
        for (const a of alive) { if (a.moving && m.turnT >= a.stopAt) a.moving = false; else if (a.moving) a.x = Math.min(100, a.x + a.speed * dt); }
        if (m.t <= EPS) {
          m.phase = 'look'; m.t = r.range(1.5, 2.5);
          emit(S, { type: 'look', venue: v.id });
          for (const a of alive) if (a.moving) { a.moving = false; eliminate(S, v, pById(S, a.pid), 'natural', 'だるまに見つかった'); }
        }
      } else if (m.phase === 'look') {
        if (m.t <= EPS) { m.phase = 'away'; m.t = panicOn ? r.range(1.2, 2.0) : r.range(2.0, 3.5); emit(S, { type: 'away', venue: v.id }); }
      }
      const left = v.pids.filter(pid => pById(S, pid).alive && !v.actors[pid].done).length;
      return left === 0 || v.t >= this.dur;
    },
    vulnerable(v, S, skillId) {
      const m = v.m; if (m.phase !== 'away') return [];
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive && !a.done && a.moving);
      if (skillId === 'trap') return alive.map(a => ({ pid: a.pid, reason: '急に振り向かれたとき動いていた' }));
      if (skillId === 'obstacle') {
        if (!alive.length) return [];
        const lead = alive.reduce((b, a) => a.x > b.x ? a : b, alive[0]);
        return [{ pid: lead.pid, reason: '進路に障害物が落ちた' }];
      }
      return [];
    },
    onTrap(v, S) { const m = v.m; m.phase = 'look'; m.t = 2.0; emit(S, { type: 'look', venue: v.id, sudden: true }); for (const pid of v.pids) { const a = v.actors[pid]; if (a) a.moving = false; } },
    warn(v, S, windup) {
      for (const pid of v.pids) { const p = pById(S, pid); const a = v.actors[pid]; if (p.alive && !a.done && p.trait === 'sense') { a.alert = windup + 0.4; a.moving = false; emit(S, { type: 'alert', venue: v.id, pid }); } }
    },
    progress(v, S) { const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive); return alive.length ? clamp(alive.reduce((mx, a) => Math.max(mx, a.x), 0) / 100, 0, 1) : 1; },
  },

  chairs: {
    name: '椅子取りゲーム', dur: 45, chairArc: 0.6, maxStops: 3,
    start(v, S) {
      const r = S.rng; const n = v.pids.length;
      v.m = { chairs: n - 1, phase: 'music', t: r.range(8, 11), round: 1, stops: 0, loserPid: 0 };
      v.pids.forEach((pid, i) => {
        const p = pById(S, pid);
        v.actors[pid] = { pid, ang: i / n, speed: (p.trait === 'agile' ? 0.11 : 0.085) + r.range(0, 0.02), seated: false, done: false, alert: 0 };
      });
    },
    pos(a) { return ((a.ang % 1) + 1) % 1; },
    inArc(a) { return this.pos(a) < this.chairArc; },
    step(v, S, dt) {
      const m = v.m; const r = S.rng; const panicOn = v.panicUntil > S.time;
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive);
      m.t -= dt;
      if (m.phase === 'music') {
        for (const a of alive) { a.seated = false; if (a.alert > 0) { a.alert -= dt; continue; } a.ang += a.speed * dt; }
        if (m.t <= EPS) {
          const losers = this.stopMusic(v, S, false);
          for (const l of losers) eliminate(S, v, l.p, 'natural', '椅子に座れなかった');
        }
      } else if (m.phase === 'sit') {
        if (m.t <= EPS) {
          const left = v.pids.filter(pid => pById(S, pid).alive).length;
          if (left <= 4 || m.chairs <= 1 || m.stops >= this.maxStops) return true;
          m.chairs = Math.max(1, Math.min(m.chairs - 1, left - 1)); m.round++;
          m.phase = 'music'; m.t = panicOn ? r.range(3, 5) : r.range(8, 11);
          emit(S, { type: 'music', venue: v.id, round: m.round, chairs: m.chairs });
        }
      }
      return v.t >= this.dur;
    },
    reach(a, p, S) { return (this.inArc(a) ? 1 : 0) + (p.trait === 'agile' ? 0.5 : 0) + (p.trait === 'guts' ? 0.2 : 0) - (p.trait === 'clumsy' ? 0.3 : 0) + S.rng() * 0.6; },
    stopMusic(v, S, byHost) {
      const m = v.m;
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive);
      const ranked = alive.map(a => ({ a, p: pById(S, a.pid), s: this.reach(a, pById(S, a.pid), S) })).sort((x, y) => y.s - x.s);
      ranked.forEach((e, i) => { e.a.seated = i < m.chairs; });
      m.phase = 'sit'; m.t = 2.5; m.stops++;
      emit(S, { type: 'stop', venue: v.id, byHost });
      const losers = ranked.slice(m.chairs);
      m.loserPid = losers.length ? losers[0].a.pid : 0;
      return losers;
    },
    vulnerable(v, S, skillId) {
      const m = v.m; if (m.phase !== 'music') return [];
      const alive = v.pids.map(pid => v.actors[pid]).filter(a => pById(S, a.pid).alive);
      const out = alive.filter(a => !this.inArc(a));
      if (!out.length) return [];
      if (skillId === 'trap') {
        // 音楽を止めたとき、椅子のない側にいて一番遠い人
        const far = out.reduce((b, a) => this.pos(a) > this.pos(b) ? a : b, out[0]);
        return [{ pid: far.pid, reason: '音楽が止まったとき椅子から遠かった' }];
      }
      if (skillId === 'obstacle') return [{ pid: out[0].pid, reason: '歩いている所に障害物が落ちた' }];
      return [];
    },
    onTrap(v, S, hits) {
      // 止めた瞬間に、生きている人が椅子を取り合う（当たった人はもういない）。よけられた時は、別の誰かが座れずに脱落する。
      const losers = this.stopMusic(v, S, true);
      for (const l of losers) eliminate(S, v, l.p, 'natural', '椅子に座れなかった');
    },
    warn(v, S, windup) {
      for (const pid of v.pids) { const p = pById(S, pid); const a = v.actors[pid]; if (p.alive && p.trait === 'sense' && !this.inArc(a)) { a.ang = Math.floor(a.ang) + this.chairArc * 0.5; a.alert = windup + 0.4; emit(S, { type: 'alert', venue: v.id, pid }); } }
    },
    progress(v, S) { return clamp((v.m.round - 1) / 5, 0, 1); },
  },
};

// ---------------- 出来事 ----------------
function emit(S, e) { e.t = S.time; e.day = S.day; S.events.push(e); S.pending.push(e); }

function eliminate(S, v, p, cause, how) {
  if (!p.alive) return;
  p.alive = false; p.busy = false; p.outDay = S.day; p.outHow = how;
  v.elims++; if (cause === 'host') v.elimsHost++;
  const star = p.pop >= C.POP.star;
  S.rating = clamp(S.rating + (cause === 'host' ? C.RATING.elimHost + (star ? C.RATING.popBonus : 0) : C.RATING.elimNatural), 0, 100);
  v.hype = clamp(v.hype + (cause === 'host' ? C.HYPE.elimHost + (star ? 5 : 0) : C.HYPE.elimNatural), 0, 100);
  S.suspicion = clamp(S.suspicion + (cause === 'host' ? C.SUSP.elimHost : C.SUSP.elimNatural), 0, 100);
  if (cause !== 'host') S.panic = clamp(S.panic + C.PANIC.natural, 0, 100);
  S.dayElims++; if (cause === 'host') S.dayElimsHost++;
  S.ghosts.push(p.id);
  emit(S, { type: 'elim', venue: v.id, pid: p.id, cause, how, star });
}

// ---------------- 状態 ----------------
function create(opts) {
  opts = opts || {};
  const S = {
    seed: opts.seed || 1, rng: makeRng(opts.seed || 1), time: 0, day: 1, dayT: C.DAY_LEN,
    phase: 'play',                 // play | dayEnd | over
    over: null,                    // clear | fail | arrest | bankrupt
    rating: C.START.rating, money: C.START.money, panic: C.START.panic, suspicion: C.START.suspicion,
    venues: [], pool: [], nextPid: 1, ghosts: [], cooldown: {}, events: [], pending: [],
    dayElims: 0, dayElimsHost: 0, fired: 0, hits: 0, dodges: 0, misses: 0, stats: { fired: {}, hits: {}, dodges: {}, misses: {}, fireHit: {} },
    lastDay: null,
  };
  const kinds = opts.venues || ['bridge', 'daruma', 'chairs'];
  kinds.forEach((k, i) => S.venues.push({ id: i + 1, kind: k, name: VENUES[k].name, phase: 'idle', t: 0, restT: 0, pids: [], actors: {}, m: null, hype: 40, panicUntil: 0, lock: null, matchNo: 0, elims: 0, elimsHost: 0 }));
  for (let i = 0; i < 24; i++) S.pool.push(makeParticipant(S));
  const sim = {
    S, C, SKILLS, SKILL, TRAITS, VENUES,
    step: (dt) => step(S, dt),
    fire: (skillId, venueId) => fire(S, skillId, venueId),
    vulnerable: (venueId, skillId) => { const v = S.venues[venueId - 1]; return (v && v.phase === 'running') ? VENUES[v.kind].vulnerable(v, S, skillId) : []; },
    canFire: (skillId, venueId) => canFire(S, skillId, venueId),
    nextDay: () => nextDay(S),
    drain: () => { const p = S.pending; S.pending = []; return p; },
    participant: (pid) => pById(S, pid),
    progress: (venueId) => { const v = S.venues[venueId - 1]; return v.phase === 'running' ? VENUES[v.kind].progress(v, S) : 0; },
  };
  S.venues.forEach(v => startMatch(S, v));
  return sim;
}

function takeParticipants(S, n) {
  const avail = S.pool.filter(p => p.alive && !p.busy).sort((a, b) => a.matches - b.matches || a.id - b.id);
  while (avail.length < n + 3) { const p = makeParticipant(S); S.pool.push(p); avail.push(p); }
  // 少し混ぜる（同じ顔ぶれが固定されないように）
  const picked = avail.slice(0, n + 3);
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(S.rng() * (i + 1)); const tmp = picked[i]; picked[i] = picked[j]; picked[j] = tmp; }
  return picked.slice(0, n);
}
function startMatch(S, v) {
  const def = VENUES[v.kind];
  const parts = takeParticipants(S, C.MATCH_SIZE);
  v.pids = parts.map(p => p.id); parts.forEach(p => { p.busy = true; p.matches++; });
  v.actors = {}; v.phase = 'running'; v.t = 0; v.matchNo++; v.elims = 0; v.elimsHost = 0; v.lock = null; v.panicUntil = 0;
  v.hype = clamp(v.hype * 0.5 + 25 + parts.filter(p => p.pop >= C.POP.star).length * C.HYPE.popPresence, 0, 100);
  def.start(v, S);
  emit(S, { type: 'matchStart', venue: v.id, kind: v.kind, pids: v.pids.slice(), matchNo: v.matchNo });
}
function finishMatch(S, v, cut) {
  const survivors = v.pids.filter(pid => pById(S, pid).alive);
  const pay = Math.round(C.MATCH_PAY.base + S.rating * C.MATCH_PAY.perRating + v.elims * C.MATCH_PAY.perElim);
  S.money += pay;
  for (const pid of survivors) { const p = pById(S, pid); p.busy = false; p.survived++; p.pop = Math.min(C.POP.max, p.pop + 1); }
  emit(S, { type: 'matchEnd', venue: v.id, kind: v.kind, pay, survivors: survivors.slice(), elims: v.elims, elimsHost: v.elimsHost, cut: !!cut });
  v.phase = 'rest'; v.restT = C.BETWEEN_MATCHES; v.lock = null; v.pids = []; v.actors = {};
}

function canFire(S, skillId, venueId) {
  const sk = SKILL[skillId]; if (!sk) return { ok: false, reason: 'no skill' };
  if (S.phase !== 'play') return { ok: false, reason: 'paused' };
  if ((S.cooldown[skillId] || 0) > 0) return { ok: false, reason: 'cooldown' };
  if (S.money < sk.cost) return { ok: false, reason: 'money' };
  const v = S.venues[venueId - 1]; if (!v || v.phase !== 'running') return { ok: false, reason: 'venue' };
  if (v.lock) return { ok: false, reason: 'locked' };
  return { ok: true };
}
function fire(S, skillId, venueId) {
  const chk = canFire(S, skillId, venueId); if (!chk.ok) return chk;
  const sk = SKILL[skillId]; const v = S.venues[venueId - 1];
  S.money -= sk.cost; S.cooldown[skillId] = sk.cd; S.suspicion = clamp(S.suspicion + sk.susp, 0, 100);
  S.panic = clamp(S.panic + C.PANIC.fire, 0, 100);
  S.fired++; S.stats.fired[skillId] = (S.stats.fired[skillId] || 0) + 1;
  emit(S, { type: 'fire', venue: v.id, skill: skillId });
  if (sk.windup > 0) {
    const w = sk.windup * (S.panic >= C.PANIC.windupSlowAt ? C.PANIC.windupMul : 1);
    v.lock = { skill: skillId, t: w, total: w };
    VENUES[v.kind].warn(v, S, w);
    emit(S, { type: 'lock', venue: v.id, skill: skillId, windup: w });
  } else resolve(S, v, skillId);
  return { ok: true };
}
function resolve(S, v, skillId) {
  const sk = SKILL[skillId]; const def = VENUES[v.kind]; v.lock = null;
  if (skillId === 'boost') {
    S.rating = clamp(S.rating + C.RATING.boost, 0, 100); v.hype = clamp(v.hype + C.HYPE.boost, 0, 100);
    emit(S, { type: 'boost', venue: v.id }); return;
  }
  if (skillId === 'panic') {
    v.panicUntil = S.time + sk.duration; v.hype = clamp(v.hype + C.HYPE.panicMode, 0, 100);
    emit(S, { type: 'panicMode', venue: v.id, until: v.panicUntil }); return;
  }
  const cands = def.vulnerable(v, S, skillId).slice(0, sk.maxHits);
  if (!cands.length) {
    S.misses++; S.stats.misses[skillId] = (S.stats.misses[skillId] || 0) + 1;
    S.panic = clamp(S.panic + C.PANIC.miss, 0, 100); v.hype = clamp(v.hype + C.HYPE.miss, 0, 100);
    emit(S, { type: 'miss', venue: v.id, skill: skillId, reason: v.kind === 'bridge' ? '誰も跳んでいなかった' : v.kind === 'daruma' ? '誰も動いていなかった' : '椅子のない側に誰もいなかった' });
    if (skillId === 'trap' && v.kind !== 'chairs') def.onTrap(v, S, []);
    for (const pid of v.pids) { const p = pById(S, pid); if (p.alive && p.wary < C.DODGE.waryMax) { p.wary++; emit(S, { type: 'wary', venue: v.id, pid, wary: p.wary }); } }
    return;
  }
  const panicOn = v.panicUntil > S.time; const hits = [];
  for (const c of cands) {
    const p = pById(S, c.pid);
    let dodge = (p.trait === 'agile' ? C.DODGE.agile : 0) + Math.min(p.wary, C.DODGE.waryMax) * C.DODGE.wary;
    if (panicOn) dodge *= C.DODGE.panicModeMul;
    if (S.rng() < dodge) {
      S.dodges++; S.stats.dodges[skillId] = (S.stats.dodges[skillId] || 0) + 1;
      S.panic = clamp(S.panic + C.PANIC.dodge, 0, 100); v.hype = clamp(v.hype + C.HYPE.dodge, 0, 100); S.rating = clamp(S.rating + C.RATING.dodge, 0, 100);
      emit(S, { type: 'dodge', venue: v.id, pid: p.id, skill: skillId, why: p.trait === 'agile' ? 'すばしっこい' : '警戒していた', wary: p.wary });
    } else {
      hits.push(p); S.hits++; S.stats.hits[skillId] = (S.stats.hits[skillId] || 0) + 1;
      emit(S, { type: 'hit', venue: v.id, pid: p.id, skill: skillId, reason: c.reason });
      eliminate(S, v, p, 'host', c.reason);
    }
  }
  if (hits.length) S.stats.fireHit[skillId] = (S.stats.fireHit[skillId] || 0) + 1;
  if (skillId === 'trap') def.onTrap(v, S, hits);
  // 技を見た生き残りは警戒する（🔥）。次からよけやすくなる
  for (const pid of v.pids) { const p = pById(S, pid); if (p.alive && p.wary < C.DODGE.waryMax) { p.wary++; emit(S, { type: 'wary', venue: v.id, pid, wary: p.wary }); } }
}

function step(S, dt) {
  if (S.phase !== 'play') return;
  if (Math.round(S.suspicion) >= 100) return endGame(S, 'arrest');   // 画面に出る数（四捨五入）で判定
  S.time += dt; S.dayT -= dt;
  const cdMul = S.panic >= C.PANIC.cdSlowAt ? C.PANIC.cdMul : 1;
  for (const k in S.cooldown) if (S.cooldown[k] > 0) { S.cooldown[k] = Math.max(0, S.cooldown[k] - dt * cdMul); if (S.cooldown[k] === 0) emit(S, { type: 'ready', skill: k }); }
  S.panic = clamp(S.panic - C.PANIC.decay * dt, 0, 100);
  S.suspicion = clamp(S.suspicion - C.SUSP.perSec * dt, 0, 100);
  let hypeSum = 0;
  for (const v of S.venues) {
    if (v.phase === 'rest') { v.restT -= dt; if (v.restT <= EPS) startMatch(S, v); continue; }
    if (v.phase !== 'running') continue;
    v.t += dt;
    if (v.lock) { v.lock.t -= dt; if (v.lock.t <= EPS) resolve(S, v, v.lock.skill); }
    const panicOn = v.panicUntil > S.time;
    v.hype = clamp(v.hype - C.HYPE.decay * dt + (panicOn ? C.HYPE.panicModePerSec * dt : 0), 0, 100);
    const done = VENUES[v.kind].step(v, S, dt);
    hypeSum += v.hype;
    if (done) finishMatch(S, v, false);
  }
  if (S.rating > C.RATING.floor) S.rating = Math.max(C.RATING.floor, S.rating - (S.rating - C.RATING.floor) * C.RATING.decayK * dt);
  if (Math.round(S.suspicion) >= 100) return endGame(S, 'arrest');
  if (S.dayT <= EPS) endDay(S);
}

function endDay(S) {
  for (const v of S.venues) if (v.phase === 'running') finishMatch(S, v, true);
  const sponsor = Math.round(S.rating * C.SPONSOR_PER_RATING); const upkeep = S.venues.length * C.VENUE_UPKEEP;
  S.money += sponsor - upkeep;
  S.suspicion = clamp(S.suspicion - C.SUSP.dayDecay, 0, 100);
  S.lastDay = { day: S.day, sponsor, upkeep, elims: S.dayElims, elimsHost: S.dayElimsHost, rating: Math.round(S.rating), money: Math.round(S.money), suspicion: Math.round(S.suspicion) };
  emit(S, Object.assign({ type: 'dayEnd' }, S.lastDay));
  if (Math.round(S.money) < 0) return endGame(S, 'bankrupt');
  if (S.day >= C.SEASON_DAYS) return endGame(S, (Math.round(S.rating) >= C.GOAL_RATING && Math.round(S.money) >= C.GOAL_MONEY) ? 'clear' : 'fail');
  S.phase = 'dayEnd';
}
function nextDay(S) {
  if (S.phase !== 'dayEnd') return false;
  S.day++; S.dayT = C.DAY_LEN; S.dayElims = 0; S.dayElimsHost = 0; S.phase = 'play';
  for (const v of S.venues) { v.phase = 'rest'; v.restT = 0.5; v.lock = null; }
  emit(S, { type: 'dayStart', day: S.day });
  return true;
}
function endGame(S, kind) { S.phase = 'over'; S.over = kind; emit(S, { type: 'over', kind, rating: Math.round(S.rating), money: Math.round(S.money), suspicion: Math.round(S.suspicion), ghosts: S.ghosts.length }); }

// ---------------- 自動プレイ（ボット・?auto=1 用） ----------------
const policies = {
  idle() {},
  spam(sim) {
    const S = sim.S; const running = S.venues.filter(v => v.phase === 'running' && !v.lock);
    if (!running.length) return;
    for (const sk of SKILLS) { const v = running[Math.floor(S.rng() * running.length)]; if (sim.canFire(sk.id, v.id).ok) { sim.fire(sk.id, v.id); return; } }
  },
  timing(sim, opt) {
    opt = opt || {}; const S = sim.S; const guard = opt.suspGuard != null ? opt.suspGuard : 75;
    const pace = (S.day / C.SEASON_DAYS) * C.GOAL_RATING + 8;
    const running = S.venues.filter(v => v.phase === 'running' && !v.lock);
    if (!running.length) return;
    if (S.rating < pace && S.money >= SKILL.boost.cost + 60 && sim.canFire('boost', running[0].id).ok) { sim.fire('boost', running[0].id); return; }
    if (S.suspicion >= guard) return;
    let best = null;
    for (const v of running) {
      const c = sim.vulnerable(v.id, 'trap'); const star = c.some(x => sim.participant(x.pid).pop >= C.POP.star);
      const score = c.length + (star ? 1 : 0);
      const good = v.kind === 'chairs' ? (c.length >= 1 && star) : c.length >= 2;
      if (good && (!best || score > best.score)) best = { v, score };
    }
    if (best && sim.canFire('trap', best.v.id).ok) { sim.fire('trap', best.v.id); return; }
    for (const v of running) {
      const c = sim.vulnerable(v.id, 'obstacle');
      if (c.length && S.money >= SKILL.obstacle.cost + 80 && (sim.participant(c[0].pid).pop >= 3 || S.day >= 4) && sim.canFire('obstacle', v.id).ok) { sim.fire('obstacle', v.id); return; }
    }
    for (const v of running) if (v.hype < 30 && S.money >= SKILL.panic.cost + 120 && S.suspicion < guard - 15 && sim.canFire('panic', v.id).ok) { sim.fire('panic', v.id); return; }
  },
};

return { create, C, SKILLS, SKILL, TRAITS, VENUES, policies, makeRng };
});
