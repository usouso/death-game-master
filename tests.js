// tests.js — ルールが「書いてあるとおり」に動くかの文字どおりテスト。 node tests.js  （終了コード 0 = 全部合格）
const DG = require('./sim.js');
const C = DG.C;
let pass = 0, fail = 0;
function ok(cond, name, info) { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  NG  ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }
function run(sim, secs) { for (let i = 0; i < Math.round(secs / 0.1); i++) sim.step(0.1); }
function setTrait(sim, pid, trait) { sim.participant(pid).trait = trait; }

console.log('1. 技の表');
ok(DG.SKILLS.length === 4, '技は4つ');
ok(DG.SKILL.boost.cost === 40 && DG.SKILL.boost.cd === 20, 'イベントブースト：資金40・クールダウン20秒');
ok(DG.SKILL.trap.cost === 0 && DG.SKILL.trap.cd === 8, 'トラップ：資金0・クールダウン8秒');

console.log('2. イベントブースト：視聴率が書いてある数だけ上がり、脱落は出ない');
{ const sim = DG.create({ seed: 5 }); const r0 = sim.S.rating, m0 = sim.S.money, s0 = sim.S.suspicion;
  const res = sim.fire('boost', 1);
  ok(res.ok, '発動できる', res);
  ok(Math.abs(sim.S.rating - (r0 + C.RATING.boost)) < 1e-9, `視聴率 +${C.RATING.boost}`, sim.S.rating - r0);
  ok(sim.S.money === m0 - DG.SKILL.boost.cost, `資金 -${DG.SKILL.boost.cost}`);
  ok(Math.abs(sim.S.suspicion - (s0 + DG.SKILL.boost.susp)) < 1e-9, `疑惑 ${DG.SKILL.boost.susp}`);
  ok(sim.S.ghosts.length === 0, '脱落なし');
  ok(sim.S.cooldown.boost === DG.SKILL.boost.cd, 'クールダウンが入る');
  ok(!sim.fire('boost', 2).ok, 'クールダウン中は撃てない'); }

console.log('3. トラップ（橋）：跳んでいる人に当たる。ふつうの人は必ず当たる');
{ const sim = DG.create({ seed: 7, venues: ['bridge'] }); const v = sim.S.venues[0];
  v.pids.forEach(pid => setTrait(sim, pid, 'none'));
  // 2人を強制的に「跳んでいる」状態にする
  const [a, b, c] = v.pids.map(pid => v.actors[pid]);
  a.hopping = true; a.hopT = 5; a.nextPanel = 0; a.nextSide = v.m.safe[0];
  b.hopping = true; b.hopT = 5; b.nextPanel = 0; b.nextSide = v.m.safe[0];
  c.hopping = false; c.hopT = 99;
  v.pids.forEach(pid => { if (pid !== a.pid && pid !== b.pid) v.actors[pid].hopT = 99; });
  const cands = sim.vulnerable(1, 'trap');
  ok(cands.length === 2, '狙える相手は跳んでいる2人', cands);
  const g0 = sim.S.ghosts.length; const s0 = sim.S.suspicion;
  sim.fire('trap', 1);
  ok(!!v.lock && Math.abs(v.lock.t - DG.SKILL.trap.windup) < 1e-9, `予兆（${DG.SKILL.trap.windup}秒）が出る`);
  run(sim, DG.SKILL.trap.windup + 0.05);
  ok(sim.S.ghosts.length === g0 + 2, '2人とも脱落（主催者）', sim.S.ghosts.length - g0);
  ok(Math.abs(sim.S.suspicion - (s0 + DG.SKILL.trap.susp + 2 * C.SUSP.elimHost)) < 0.1, `疑惑 +${DG.SKILL.trap.susp} +${C.SUSP.elimHost}×2（1秒ぶんの減りは除く）`, sim.S.suspicion - s0);
  ok(sim.S.events.some(e => e.type === 'shake'), '橋が揺れる出来事が出る'); }

console.log('4. トラップ（橋）：誰も跳んでいなければ空振り。あわて度が上がる');
{ const sim = DG.create({ seed: 7, venues: ['bridge'] }); const v = sim.S.venues[0];
  v.pids.forEach(pid => { v.actors[pid].hopT = 99; v.actors[pid].hopping = false; });
  const p0 = sim.S.panic; sim.fire('trap', 1); run(sim, DG.SKILL.trap.windup + 0.05);
  const miss = sim.S.events.find(e => e.type === 'miss');
  ok(!!miss && miss.reason === '誰も跳んでいなかった', '空振りの理由が出る', miss);
  ok(sim.S.panic > p0, 'あわて度が上がる'); }

console.log('5. すばしっこい：よける率が書いてある数（±4%）');
{ let dodged = 0, trials = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const sim = DG.create({ seed, venues: ['daruma'] }); const v = sim.S.venues[0];
    v.pids.forEach(pid => { setTrait(sim, pid, 'none'); sim.participant(pid).wary = 0; });
    const pid = v.pids[0]; setTrait(sim, pid, 'agile');
    // 先頭だけ動いている状態にして、障害物を落とす
    v.m.phase = 'away'; v.m.t = 99; v.pids.forEach(q => { v.actors[q].moving = (q === pid); v.actors[q].x = (q === pid ? 50 : 1); });
    sim.fire('obstacle', 1); run(sim, DG.SKILL.obstacle.windup + 0.05);
    const e = sim.S.events.find(x => x.type === 'dodge' || x.type === 'hit'); if (!e) continue;
    trials++; if (e.type === 'dodge') dodged++;
  }
  const rate = dodged / trials;
  ok(trials >= 950 && Math.abs(rate - C.DODGE.agile) < 0.04, `すばしっこいの回避率 ${Math.round(rate * 100)}% ≈ ${Math.round(C.DODGE.agile * 100)}%`, { trials, rate }); }

console.log('6. 勘がいい：予兆で足を止めるので当たらない（だるま）');
{ const sim = DG.create({ seed: 9, venues: ['daruma'] }); const v = sim.S.venues[0];
  v.pids.forEach(pid => setTrait(sim, pid, 'sense')); v.m.phase = 'away'; v.m.t = 99;
  sim.fire('trap', 1);
  ok(sim.S.events.filter(e => e.type === 'alert').length === 8, '8人全員が予兆に気づく');
  run(sim, DG.SKILL.trap.windup + 0.05);
  ok(sim.S.events.some(e => e.type === 'miss'), '当たらない（空振り）');
  ok(sim.S.ghosts.length === 0, '脱落なし'); }

console.log('7. だるま：振り向きは0.5秒ぴったり（タイマーのずれがない）');
{ const sim = DG.create({ seed: 11, venues: ['daruma'] }); run(sim, 12);
  const ev = sim.S.events.filter(e => e.type === 'turning' || e.type === 'look');
  let good = true; for (let i = 0; i + 1 < ev.length; i++) if (ev[i].type === 'turning' && ev[i + 1].type === 'look' && Math.abs((ev[i + 1].t - ev[i].t) - 0.5) > 0.011) good = false;
  ok(ev.length >= 2 && good, '振り向き→見る が 0.5秒', ev.map(e => e.type + '@' + e.t.toFixed(2)).join(' ')); }

console.log('8. 椅子取り：止まるたびに1人座れない（自然脱落）。3回止まったら終わり');
{ const sim = DG.create({ seed: 13, venues: ['chairs'] }); run(sim, 45);
  const stops = sim.S.events.filter(e => e.type === 'stop').length; const elims = sim.S.events.filter(e => e.type === 'elim').length;
  ok(stops === 3 && elims === 3, `止まった回数 ${stops}・脱落 ${elims}`, { stops, elims });
  ok(sim.S.events.some(e => e.type === 'matchEnd' && e.survivors.length === 5), '生き残りは5人'); }

console.log('9. 終わり方');
{ const sim = DG.create({ seed: 1 }); sim.S.suspicion = 99.99; sim.S.cooldown.trap = 0; sim.fire('trap', 1); sim.step(0.1);
  ok(sim.S.over === 'arrest', '疑惑100で逮捕'); }
{ const sim = DG.create({ seed: 1 }); sim.S.money = 10; sim.S.dayT = 0.05; sim.step(0.1);
  ok(sim.S.over === 'bankrupt', '日の終わりに資金が0未満で破産', sim.S.money); }
{ const sim = DG.create({ seed: 1 }); sim.S.day = C.SEASON_DAYS; sim.S.rating = C.GOAL_RATING + 0.3; sim.S.money = C.GOAL_MONEY + 3 * C.VENUE_UPKEEP; sim.S.dayT = 0.05; sim.step(0.1);
  ok(sim.S.over === 'clear', `14日目に視聴率${C.GOAL_RATING}以上・資金${C.GOAL_MONEY}以上でクリア`, { over: sim.S.over, money: sim.S.money }); }
{ const sim = DG.create({ seed: 1 }); sim.S.day = C.SEASON_DAYS; sim.S.rating = C.GOAL_RATING - 1; sim.S.money = 5000; sim.S.dayT = 0.05; sim.step(0.1);
  ok(sim.S.over === 'fail', '視聴率が足りないと打ち切り'); }

console.log('10. 同じ seed なら同じ結果（再現できる）');
{ const a = DG.create({ seed: 21 }), b = DG.create({ seed: 21 });
  for (let i = 0; i < 900; i++) { a.step(0.1); b.step(0.1); DG.policies.timing(a); DG.policies.timing(b); }
  ok(a.S.events.length === b.S.events.length && a.S.rating === b.S.rating && a.S.money === b.S.money, '900ステップ後の出来事数・視聴率・資金が一致'); }

console.log(`\n合格 ${pass} / 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
