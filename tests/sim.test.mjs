// Headless tests for the simulation, actions and host->client replication.
// Run with:  node tests/sim.test.mjs
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { createState, Factory, TICK, serializeEnt, serializeState, deserializeState, playerSlotCount } from '../src/sim/factory.js';
import { handleAction, invAccess } from '../src/sim/actions.js';
import { applySimEvent } from '../src/sim/replicate.js';
import { makeSlots, addItem, countItem, isEmpty } from '../src/sim/inventory.js';
import { BUILDINGS } from '../src/data/buildings.js';
import { RECIPES } from '../src/data/recipes.js';
import { ITEMS } from '../src/data/items.js';
import { MILESTONES, RESEARCH } from '../src/data/progression.js';
import { encode, Reassembler } from '../src/net/transport.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name);
    console.error(e);
    process.exitCode = 1;
  }
}

// Minimal host stand-in exposing the same helpers sim/actions.js uses.
class HeadlessHost {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.factory = new Factory(state, world);
    this.events = [];
    this.notes = [];
  }
  out(ev) { this.events.push(structuredClone(ev)); }
  addEnt(e) { if (this.factory.addEntity(e)) this.out({ k: 'add', e: serializeEnt(e) }); }
  delEnt(id) { if (this.factory.removeEntity(id)) this.out({ k: 'del', id }); }
  updEnt(e) { this.out({ k: 'upd', e: serializeEnt(e) }); }
  updInv(pid) { this.out({ k: 'inv', pid, inv: this.state.players[pid].inv }); }
  updProg() { this.out({ k: 'prog', p: this.state.prog }); }
  notify(text, kind, pid) { this.notes.push({ text, kind, pid }); }
  removeFlora(ids) { for (const id of ids) this.state.floraGone.add(id); this.out({ k: 'flora', ids }); }
  clearFloraFor() {}
  sfx() {}
  invAccess(pid, ref) { return invAccess(this.state, this.factory, pid, ref); }
  afterXfer(pid, ref) {
    if (ref.p) return this.updInv(pid);
    const e = this.factory.get(ref.e);
    if (!e) return;
    if (BUILDINGS[e.type].crate && isEmpty(e.slots)) this.delEnt(e.id);
    else this.updEnt(e);
  }
  act(pid, a) { handleAction(this, pid, a); }
  lastErr() { const n = this.notes.filter(x => x.kind === 'err'); return n.length ? n[n.length - 1].text : null; }
}

function setup(seed = 4242) {
  const state = createState('Test', seed);
  const world = new World(seed);
  const host = new HeadlessHost(state, world);
  state.players.alice = { name: 'alice', color: '#fff', inv: makeSlots(playerSlotCount(state)), x: 0, y: 10, z: 0, online: true };
  return { state, world, host };
}

function give(state, pid, items) {
  for (const [k, v] of Object.entries(items)) addItem(state.players[pid].inv, k, v);
}

function unlockAll(state) {
  state.prog.b = Object.keys(BUILDINGS);
  state.prog.r = Object.keys(RECIPES);
  state.prog.slots = 60;
  state.players.alice.inv = makeSlots(playerSlotCount(state));
}

function run(host, seconds) {
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) host.factory.tick(TICK);
}

console.log('Satisfactory 2 — simulation tests');

test('data integrity: recipes, buildings and milestones reference valid ids', () => {
  for (const r of Object.values(RECIPES)) {
    for (const k of [...Object.keys(r.in), ...Object.keys(r.out)]) assert.ok(ITEMS[k], `recipe ${r.id} uses unknown item ${k}`);
    assert.ok(['smelter', 'foundry', 'constructor', 'assembler', 'manufacturer'].includes(r.m), r.id);
  }
  for (const b of Object.values(BUILDINGS)) for (const k of Object.keys(b.cost || {})) assert.ok(ITEMS[k], `building ${b.id} cost uses ${k}`);
  for (const m of [...MILESTONES, ...RESEARCH]) {
    for (const k of Object.keys(m.cost)) assert.ok(ITEMS[k], `${m.id} cost ${k}`);
    for (const b of (m.unlocks.b || [])) assert.ok(BUILDINGS[b], `${m.id} unlocks unknown building ${b}`);
    for (const r of (m.unlocks.r || [])) assert.ok(RECIPES[r], `${m.id} unlocks unknown recipe ${r}`);
  }
  // every recipe should be obtainable
  const unlockable = new Set(['iron_ingot', 'iron_plate', 'iron_rod']);
  for (const m of [...MILESTONES, ...RESEARCH]) for (const r of (m.unlocks.r || [])) unlockable.add(r);
  for (const id of Object.keys(RECIPES)) assert.ok(unlockable.has(id), `recipe ${id} can never be unlocked`);
});

test('world generation is deterministic and has starter nodes', () => {
  const a = new World(99), b = new World(99);
  assert.equal(a.heights.length, b.heights.length);
  assert.equal(a.heightAt(12.3, -45.6), b.heightAt(12.3, -45.6));
  assert.equal(a.nodes.length, b.nodes.length);
  assert.equal(a.flora.length, b.flora.length);
  const near = (type) => a.nodes.filter(n => n.type === type && Math.hypot(n.x, n.z) < 120).length;
  assert.ok(near('iron_ore') >= 2, 'iron near spawn');
  assert.ok(near('copper_ore') >= 1, 'copper near spawn');
  assert.ok(near('limestone') >= 1, 'limestone near spawn');
  for (const t of ['coal', 'caterium_ore', 'raw_quartz', 'sulfur']) assert.ok(a.nodes.some(n => n.type === t), t);
});

test('hand gathering, crafting and the first milestone', () => {
  const { state, world, host } = setup();
  const iron = world.nodes.find(n => n.type === 'iron_ore');
  state.players.alice.x = iron.x; state.players.alice.z = iron.z;
  for (let i = 0; i < 40; i++) host.act('alice', { k: 'mine', node: iron.id });
  const ore = countItem(state.players.alice.inv, 'iron_ore');
  assert.ok(ore >= 40, 'mined ore: ' + ore);
  for (let i = 0; i < 30; i++) host.act('alice', { k: 'craft', recipe: 'iron_ingot' });
  for (let i = 0; i < 12; i++) host.act('alice', { k: 'craft', recipe: 'iron_rod' });
  assert.equal(countItem(state.players.alice.inv, 'iron_rod'), 12);
  host.act('alice', { k: 'build', type: 'hub', x: 0, y: world.heightAt(0, 0), z: 0, r: 0 });
  assert.equal(host.factory.countType('hub'), 1, host.lastErr());
  host.act('alice', { k: 'select', kind: 'ms', id: 'hub1' });
  host.act('alice', { k: 'submit', kind: 'ms' });
  host.act('alice', { k: 'complete', kind: 'ms' });
  assert.ok(state.prog.ms.done.includes('hub1'));
  assert.ok(state.prog.b.includes('storage_container'));
  assert.equal(state.players.alice.inv.length, 21, 'inventory grew by 3 slots');
  // a second HUB is rejected
  host.act('alice', { k: 'build', type: 'hub', x: 50, y: world.heightAt(50, 0), z: 0, r: 0 });
  assert.equal(host.factory.countType('hub'), 1);
});

test('miner -> belt -> smelter -> belt -> storage, powered by a biomass burner', () => {
  const { state, world, host } = setup();
  unlockAll(state);
  give(state, 'alice', { iron_plate: 200, iron_rod: 200, concrete: 100, wire: 200, cable: 50, screw: 100, wood: 100 });
  const node = world.nodes.find(n => n.type === 'iron_ore');
  const P = state.players.alice;
  P.x = node.x; P.y = node.y; P.z = node.z;
  host.act('alice', { k: 'build', type: 'miner_mk1', node: node.id, x: 0, y: 0, z: 0, r: 0 });
  assert.equal(host.lastErr(), 'A Pioneer is in the way', 'cannot build on top of a player');
  P.x = node.x + 9;
  host.act('alice', { k: 'build', type: 'miner_mk1', node: node.id, x: 0, y: 0, z: 0, r: 0 });
  const miner = host.factory.findType('miner_mk1');
  assert.ok(miner, 'miner placed: ' + host.lastErr());
  // smelter 20m in front of the miner (miner faces +Z at r=0)
  const sx = node.x, sz = node.z + 22;
  const sy = Math.max(...[[-3, -4.5], [3, -4.5], [-3, 4.5], [3, 4.5], [0, 0]].map(([dx, dz]) => world.heightAt(sx + dx, sz + dz)));
  host.act('alice', { k: 'build', type: 'smelter', x: sx, y: sy, z: sz, r: 0 });
  const smelter = host.factory.findType('smelter');
  assert.ok(smelter, 'smelter placed: ' + host.lastErr());
  host.act('alice', { k: 'recipe', id: smelter.id, recipe: 'iron_ingot' });
  assert.equal(smelter.recipe, 'iron_ingot');
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: miner.id, p: 0 }, b: { b: smelter.id, p: 0 } });
  assert.equal(host.factory.belts.length, 1, 'belt 1: ' + host.lastErr());
  // storage after the smelter
  const cx = sx, cz = sz + 16;
  const cy = Math.max(...[[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5], [0, 0]].map(([dx, dz]) => world.heightAt(cx + dx, cz + dz)));
  host.act('alice', { k: 'build', type: 'storage_container', x: cx, y: cy, z: cz, r: 0 });
  const box = host.factory.findType('storage_container');
  assert.ok(box, 'storage: ' + host.lastErr());
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: smelter.id, p: 1 }, b: { b: box.id, p: 0 } });
  assert.equal(host.factory.belts.length, 2, 'belt 2: ' + host.lastErr());
  // power
  const bx = node.x + 14, bz = node.z + 10;
  const by = Math.max(...[[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5], [0, 0]].map(([dx, dz]) => world.heightAt(bx + dx, bz + dz)));
  host.act('alice', { k: 'build', type: 'biomass_burner', x: bx, y: by, z: bz, r: 0 });
  const burner = host.factory.findType('biomass_burner');
  assert.ok(burner, 'burner: ' + host.lastErr());
  host.act('alice', { k: 'wire', a: { id: burner.id }, b: { id: miner.id } });
  host.act('alice', { k: 'wire', a: { id: burner.id }, b: { id: smelter.id } });
  assert.equal([...host.factory.ents.values()].filter(e => e.type === 'power_line').length, 2, 'wires: ' + host.lastErr());
  // nothing runs without fuel
  run(host, 3);
  assert.equal(countItem(box.slots, 'iron_ingot'), 0);
  host.act('alice', { k: 'xfer', src: { p: 1 }, si: P.inv.findIndex(s => s && s.item === 'wood'), dst: { e: burner.id, w: 'fuel' }, di: 0 });
  assert.ok(burner.fuel[0] && burner.fuel[0].item === 'wood', 'fuel loaded');
  run(host, 90);
  const ingots = countItem(box.slots, 'iron_ingot');
  assert.ok(ingots > 20, 'ingots delivered to storage: ' + ingots);
  assert.ok(burner.fuel[0].n < 100, 'fuel was burned');
  const net = miner._net;
  assert.ok(net && net.cap === 30 && net.demand > 0 && net.demand <= 9.01, 'power stats ' + JSON.stringify({ cap: net && net.cap, d: net && net.demand }));

  // dismantling the smelter removes its belts and refunds
  const platesBefore = countItem(P.inv, 'iron_plate');
  host.act('alice', { k: 'dismantle', id: smelter.id });
  assert.equal(host.factory.findType('smelter'), null);
  assert.equal(host.factory.belts.length, 0);
  assert.ok(countItem(P.inv, 'iron_plate') > platesBefore, 'belt refund');
});

test('fuse trips on overload and can be reset', () => {
  const { state, world, host } = setup();
  unlockAll(state);
  give(state, 'alice', { iron_plate: 400, iron_rod: 300, wire: 400, cable: 100, screw: 100, concrete: 100, leaves: 500 });
  const P = state.players.alice;
  const base = world.nodes.find(n => n.type === 'iron_ore');
  P.x = base.x; P.z = base.z;
  const place = (type, x, z) => {
    const def = BUILDINGS[type];
    const [w, , d] = def.size;
    const y = Math.max(...[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]].map(([dx, dz]) => world.heightAt(x + dx, z + dz)));
    host.act('alice', { k: 'build', type, x, y, z, r: 0 });
    return [...host.factory.ents.values()].pop();
  };
  const burner = place('biomass_burner', base.x + 20, base.z);
  const pole = place('power_pole_mk2', base.x + 20, base.z + 12);
  P.x = base.x + 20; P.z = base.z + 12;
  host.act('alice', { k: 'wire', a: { id: burner.id }, b: { id: pole.id } });
  const smelters = [];
  for (let i = 0; i < 4; i++) {
    const s = place('constructor', base.x + 8 + i * 9, base.z + 26);
    assert.equal(s.type, 'constructor', host.lastErr());
    host.act('alice', { k: 'recipe', id: s.id, recipe: 'biomass_leaves' });
    host.act('alice', { k: 'xfer', src: { p: 1 }, si: P.inv.findIndex(x => x && x.item === 'leaves'), dst: { e: s.id, w: 'in' }, di: 0, n: 30 });
    host.act('alice', { k: 'wire', a: { id: pole.id }, b: { id: s.id } });
    smelters.push(s);
  }
  host.act('alice', { k: 'xfer', src: { p: 1 }, si: P.inv.findIndex(x => x && x.item === 'leaves'), dst: { e: burner.id, w: 'fuel' }, di: 0, n: 100 });
  run(host, 2);
  // 4 constructors x 4MW = 16MW < 30MW: fine
  assert.ok(!burner.tripped, 'not tripped at 16MW');
  assert.ok(smelters.every(s => s.working), 'all working');
  // overclock them to blow the fuse: 4 * 4 * 2.5^1.32 = ~53MW
  for (const s of smelters) { s.shards = 3; host.act('alice', { k: 'clock', id: s.id, clock: 2.5 }); }
  run(host, 1);
  assert.ok(burner.tripped, 'fuse tripped');
  assert.ok(smelters.every(s => !s._powered), 'machines unpowered');
  for (const s of smelters) host.act('alice', { k: 'clock', id: s.id, clock: 1 });
  host.act('alice', { k: 'fuse', id: pole.id });
  run(host, 1);
  assert.ok(!burner.tripped, 'reset');
  assert.ok(smelters.some(s => s._powered), 'powered again');
});

test('splitter distributes evenly and merger combines', () => {
  const { state, world, host } = setup();
  unlockAll(state);
  give(state, 'alice', { iron_plate: 500, iron_rod: 300, cable: 50 });
  const P = state.players.alice;
  const f = host.factory;
  const ox = 40, oz = -200;
  P.x = ox; P.z = oz;
  const gy = (x, z) => Math.max(...[[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5], [0, 0]].map(([dx, dz]) => world.heightAt(x + dx, z + dz)));
  // source storage full of ore -> splitter -> 3 storages
  host.act('alice', { k: 'build', type: 'storage_container', x: ox, y: gy(ox, oz), z: oz, r: 0 });
  const src = f.findType('storage_container');
  assert.ok(src, host.lastErr());
  addItem(src.slots, 'iron_ore', 90);
  host.act('alice', { k: 'build', type: 'splitter', x: ox, y: gy(ox, oz + 10), z: oz + 10, r: 0 });
  const sp = f.findType('splitter');
  assert.ok(sp, host.lastErr());
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: src.id, p: 1 }, b: { b: sp.id, p: 0 } });
  const outs = [];
  for (const [pi, dx, dz] of [[1, 0, 10], [2, -10, 0], [3, 10, 0]]) {
    const x = ox + dx, z = oz + 10 + dz;
    host.act('alice', { k: 'build', type: 'storage_container', x, y: gy(x, z), z, r: 0 });
    const s = [...f.ents.values()].pop();
    assert.equal(s.type, 'storage_container', host.lastErr());
    host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: sp.id, p: pi }, b: { b: s.id, p: 0 } });
    outs.push(s);
  }
  assert.equal(f.belts.length, 4, host.lastErr());
  run(host, 200);
  const counts = outs.map(s => countItem(s.slots, 'iron_ore'));
  assert.equal(counts.reduce((a, b) => a + b, 0), 90, 'all delivered ' + counts);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'even split ' + counts);
});

test('belt poles: belt from a machine to a new pole and onwards', () => {
  const { state, world, host } = setup();
  unlockAll(state);
  give(state, 'alice', { iron_plate: 100, iron_rod: 100 });
  const f = host.factory;
  const ox = -60, oz = 150;
  state.players.alice.x = ox; state.players.alice.z = oz;
  const gy = (x, z) => Math.max(...[[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5], [0, 0]].map(([dx, dz]) => world.heightAt(x + dx, z + dz)));
  host.act('alice', { k: 'build', type: 'storage_container', x: ox, y: gy(ox, oz), z: oz, r: 0 });
  const box = f.findType('storage_container');
  addItem(box.slots, 'copper_ore', 10);
  const px = ox, pz = oz + 15;
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: box.id, p: 1 }, b: { x: px, y: world.heightAt(px, pz), z: pz, r: 0, h: 1.5 } });
  const pole = f.findType('conveyor_pole');
  assert.ok(pole, 'pole auto-created: ' + host.lastErr());
  assert.equal(pole.h, 1.5);
  const qx = ox + 10, qz = oz + 25;
  host.act('alice', { k: 'build', type: 'storage_container', x: qx, y: gy(qx, qz), z: qz, r: 0 });
  const box2 = [...f.ents.values()].pop();
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: pole.id, p: 1 }, b: { b: box2.id, p: 0 } });
  assert.equal(f.belts.length, 2, host.lastErr());
  run(host, 60);
  assert.equal(countItem(box2.slots, 'copper_ore'), 10);
});

test('replication: a client mirror stays in sync through events + snapshots', () => {
  const { state, world, host } = setup(777);
  unlockAll(state);
  give(state, 'alice', { iron_plate: 300, iron_rod: 300, concrete: 100, wire: 300, wood: 50 });
  const node = world.nodes.find(n => n.type === 'copper_ore');
  state.players.alice.x = node.x; state.players.alice.z = node.z - 9;
  // client joins
  const welcome = JSON.parse(JSON.stringify(serializeState(state)));
  const cstate = deserializeState(welcome);
  const client = new Factory(cstate, new World(777));
  host.events = [];
  host.act('alice', { k: 'build', type: 'miner_mk1', node: node.id, x: 0, y: 0, z: 0, r: 0 });
  const miner = host.factory.findType('miner_mk1');
  const bx = node.x + 12, bz = node.z;
  host.act('alice', { k: 'build', type: 'biomass_burner', x: bx, y: Math.max(...[-3.5, 3.5].flatMap(dx => [-3.5, 3.5].map(dz => world.heightAt(bx + dx, bz + dz)))), z: bz, r: 0 });
  const burner = host.factory.findType('biomass_burner');
  assert.ok(burner, host.lastErr());
  host.act('alice', { k: 'wire', a: { id: burner.id }, b: { id: miner.id } });
  host.act('alice', { k: 'xfer', src: { p: 1 }, si: state.players.alice.inv.findIndex(s => s && s.item === 'wood'), dst: { e: burner.id, w: 'fuel' }, di: 0 });
  const px = node.x, pz = node.z + 20;
  host.act('alice', { k: 'belt', type: 'belt_mk1', a: { b: miner.id, p: 0 }, b: { x: px, y: world.heightAt(px, pz), z: pz, r: 0, h: 1 } });
  // ship events over a JSON "wire"
  const wireEvents = JSON.parse(JSON.stringify(host.events));
  for (const ev of wireEvents) applySimEvent(cstate, client, ev);
  assert.equal(cstate.ents.size, state.ents.size, 'same entity count');
  for (const [id, e] of state.ents) assert.equal(cstate.ents.get(id).type, e.type);
  // both simulate; then apply a snapshot
  for (let i = 0; i < 200; i++) { host.factory.tick(TICK); client.tick(TICK); }
  const snap = JSON.parse(JSON.stringify(host.factory.snapshot()));
  client.applySnapshot(snap);
  const hb = host.factory.belts[0], cb = client.belts[0];
  assert.equal(cb.items.length, hb.items.length, 'belt items in sync');
  assert.ok(hb.items.length > 0, 'items on belt');
  assert.equal(client.get(miner.id).outBuf[0].n, miner.outBuf[0].n);
  assert.equal(client.get(burner.id).fuel[0].n, burner.fuel[0].n);
  // save/load round trip
  const saved = JSON.parse(JSON.stringify(serializeState(state)));
  const re = new Factory(deserializeState(saved), world);
  assert.equal(re.state.ents.size, state.ents.size);
  assert.equal(re.belts.length, 1);
  assert.equal(re.get(miner.id)._links[0], hb.id, 'links restored');
});

test('network chunking reassembles large messages', () => {
  const big = { t: 'welcome', data: 'x'.repeat(100000), arr: Array.from({ length: 2000 }, (_, i) => i) };
  const parts = encode(big);
  assert.ok(parts.length > 5);
  const r = new Reassembler();
  let out = null;
  for (const p of parts.reverse()) out = r.feed(p) || out;
  assert.deepEqual(out, big);
  assert.deepEqual(new Reassembler().feed(encode({ a: 1 })[0]), { a: 1 });
});

test('AWESOME sink awards coupons and the shop spends them', () => {
  const { state, world, host } = setup();
  unlockAll(state);
  host.factory.sinkPoints(5000);
  assert.ok(state.prog.sink.coupons >= 3, 'coupons ' + state.prog.sink.coupons);
  const before = state.players.alice.inv.length;
  host.act('alice', { k: 'shop', id: 'inv_upgrade' });
  assert.equal(state.players.alice.inv.length, before + 5);
});

console.log(`\n${passed} tests passed${process.exitCode ? ', some FAILED' : ''}`);
