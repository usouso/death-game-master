// bot/run.js — 画面なしで何十周も遊ばせて、数字を表にする。
// 使い方: node bot/run.js [--seeds 40] [--policies idle,spam,timing,careful] [--days 14] [--verbose]
const DG = require('../sim.js');
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }
const seeds = parseInt(arg('seeds', '40'), 10);
const names = arg('policies', 'idle,spam,timing,careful').split(',');
const verbose = process.argv.includes('--verbose');
const POL = {
  idle: (sim) => DG.policies.idle(sim),
  spam: (sim) => DG.policies.spam(sim),
  timing: (sim) => DG.policies.timing(sim, { suspGuard: 75 }),
  careful: (sim) => DG.policies.timing(sim, { suspGuard: 55 }),
};

function runOne(seed, pol) {
  const sim = DG.create({ seed });
  let n = 0; const days = [];
  while (sim.S.phase !== 'over' && n < 600000) {
    sim.step(0.1); POL[pol](sim);
    if (sim.S.phase === 'dayEnd') { days.push(Object.assign({}, sim.S.lastDay)); sim.nextDay(); }
    n++;
  }
  if (sim.S.lastDay && (!days.length || days[days.length - 1].day !== sim.S.lastDay.day)) days.push(Object.assign({}, sim.S.lastDay));
  const S = sim.S;
  const ev = S.events; const count = (t) => ev.filter(e => e.type === t).length;
  return { seed, over: S.over, day: S.day, rating: S.rating, money: S.money, susp: S.suspicion, fired: S.fired, hits: S.hits, dodges: S.dodges, misses: S.misses, ghosts: S.ghosts.length,
    elimHost: ev.filter(e => e.type === 'elim' && e.cause === 'host').length, elimNat: ev.filter(e => e.type === 'elim' && e.cause === 'natural').length,
    alerts: count('alert'), matches: count('matchEnd'), stats: S.stats, days, maxSusp: Math.max(...days.map(d => d.suspicion), S.suspicion),
    byKind: S.venues.reduce((o, v) => { o[v.kind] = { host: ev.filter(e => e.type === 'elim' && e.venue === v.id && e.cause === 'host').length, nat: ev.filter(e => e.type === 'elim' && e.venue === v.id && e.cause === 'natural').length, matches: ev.filter(e => e.type === 'matchEnd' && e.venue === v.id).length }; return o; }, {}) };
}
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const pct = (a) => Math.round(avg(a) * 100);
const r1 = (x) => Math.round(x * 10) / 10;

console.log(`seeds=${seeds}  日数=${DG.C.SEASON_DAYS}  1日=${DG.C.DAY_LEN}秒  目標 視聴率${DG.C.GOAL_RATING} 資金${DG.C.GOAL_MONEY}`);
console.log('方針     | クリア | 逮捕 | 破産 | 未達 | 視聴率 | 資金 | 疑惑max | 発動/周 | 命中 | 回避 | 空振り | 予兆回避 | 主催者脱落 | 自然脱落 | 試合数');
const all = {};
for (const pol of names) {
  const rs = []; for (let s = 1; s <= seeds; s++) rs.push(runOne(s, pol));
  all[pol] = rs;
  const hitRate = avg(rs.map(r => r.hits)) / Math.max(1, avg(rs.map(r => r.hits + r.dodges + r.misses)));
  console.log(`${pol.padEnd(8)} | ${String(pct(rs.map(r => r.over === 'clear'))).padStart(5)}% | ${String(pct(rs.map(r => r.over === 'arrest'))).padStart(3)}% | ${String(pct(rs.map(r => r.over === 'bankrupt'))).padStart(3)}% | ${String(pct(rs.map(r => r.over === 'fail'))).padStart(3)}% | ${String(r1(avg(rs.map(r => r.rating)))).padStart(6)} | ${String(Math.round(avg(rs.map(r => r.money)))).padStart(4)} | ${String(r1(avg(rs.map(r => r.maxSusp)))).padStart(7)} | ${String(r1(avg(rs.map(r => r.fired)))).padStart(7)} | ${String(Math.round(hitRate * 100)).padStart(3)}% | ${String(r1(avg(rs.map(r => r.dodges)))).padStart(4)} | ${String(r1(avg(rs.map(r => r.misses)))).padStart(6)} | ${String(r1(avg(rs.map(r => r.alerts)))).padStart(8)} | ${String(r1(avg(rs.map(r => r.elimHost)))).padStart(10)} | ${String(r1(avg(rs.map(r => r.elimNat)))).padStart(8)} | ${String(r1(avg(rs.map(r => r.matches)))).padStart(5)}`);
}
// 技ごとの命中率（timing）
for (const pol of names) {
  const rs = all[pol]; const sum = {};
  for (const r of rs) for (const k of ['fired', 'hits', 'dodges', 'misses', 'fireHit']) for (const sk in r.stats[k]) { sum[sk] = sum[sk] || { fired: 0, hits: 0, dodges: 0, misses: 0, fireHit: 0 }; sum[sk][k] += r.stats[k][sk]; }
  const line = Object.keys(sum).map(sk => `${sk}: 発動${r1(sum[sk].fired / rs.length)} 命中${r1(sum[sk].hits / rs.length)} 回避${r1(sum[sk].dodges / rs.length)} 空振り${r1(sum[sk].misses / rs.length)}` + (sum[sk].fired && (sk === 'trap' || sk === 'obstacle') ? ` 成功率${Math.round(100 * sum[sk].fireHit / sum[sk].fired)}%` : '')).join(' / ');
  console.log(`  [${pol}] ${line || '（発動なし）'}`);
}
// 会場ごとの脱落（1周あたり）
for (const pol of names) {
  const rs = all[pol]; const kinds = Object.keys(rs[0].byKind);
  console.log(`  [${pol}] 会場ごと 主催者脱落/自然脱落/試合数: ` + kinds.map(k => `${DG.VENUES[k].name} ${r1(avg(rs.map(r => r.byKind[k].host)))}/${r1(avg(rs.map(r => r.byKind[k].nat)))}/${r1(avg(rs.map(r => r.byKind[k].matches)))}`).join('  '));
}
// 日ごとの平均（timing）
for (const pol of names) {
  const rs = all[pol]; const byDay = {};
  for (const r of rs) for (const d of r.days) { byDay[d.day] = byDay[d.day] || { rating: [], money: [], susp: [], elims: [] }; byDay[d.day].rating.push(d.rating); byDay[d.day].money.push(d.money); byDay[d.day].susp.push(d.suspicion); byDay[d.day].elims.push(d.elims); }
  const cells = Object.keys(byDay).map(d => `${d}日:${Math.round(avg(byDay[d].rating))}/${Math.round(avg(byDay[d].money))}/${Math.round(avg(byDay[d].susp))}`);
  console.log(`  [${pol}] 日ごと 視聴率/資金/疑惑: ${cells.join('  ')}`);
}
if (verbose) console.log(JSON.stringify(all.timing[0].days, null, 0));
