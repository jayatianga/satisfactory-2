// The factory simulation: entities, spatial index, belts, machines and power.
// Runs identically on host and clients; the host is authoritative and
// periodically sends snapshots that clients adopt.
import { BUILDINGS, BELT_SPACING, powerUse, minerRate } from '../data/buildings.js';
import { RECIPES, START_RECIPES } from '../data/recipes.js';
import { ITEMS, ITEM_IDS, ITEM_INDEX, stackOf } from '../data/items.js';
import { START_BUILDINGS, ELEVATOR_PHASES, couponCost } from '../data/progression.js';
import { makeSlots, addItem } from './inventory.js';
import { rotXZ, toWorld, clamp } from '../core/util.js';

export const TICK = 1 / 20;
export const BASE_SLOTS = 18;
export const BATTERY_MJ = 100 * 3600; // 100 MWh
export const BATTERY_RATE = 100; // MW

export function createState(name, seed) {
  return {
    v: 1, name, seed, tick: 0, time: 0, nextId: 1,
    ents: new Map(),
    floraGone: new Set(),
    prog: {
      b: [...START_BUILDINGS], r: [...START_RECIPES], eq: [], slots: 0,
      ms: { done: [], active: null, have: {} },
      rs: { done: [], active: null, have: {} },
      elev: { phase: 0, have: {} },
      sink: { total: 0, progress: 0, coupons: 0, earned: 0 },
      shop: {},
      complete: false,
    },
    players: {},
  };
}

export function serializeState(state) {
  return {
    v: state.v, name: state.name, seed: state.seed, tick: state.tick, time: state.time, nextId: state.nextId,
    ents: [...state.ents.values()].map(serializeEnt),
    floraGone: [...state.floraGone],
    prog: structuredClone(state.prog),
    players: structuredClone(state.players),
  };
}

export function deserializeState(data) {
  const s = createState(data.name, data.seed);
  s.tick = data.tick || 0;
  s.time = data.time || 0;
  s.nextId = data.nextId || 1;
  s.floraGone = new Set(data.floraGone || []);
  s.prog = Object.assign(s.prog, structuredClone(data.prog || {}));
  s.players = structuredClone(data.players || {});
  s._entList = (data.ents || []).map(deserializeEnt);
  return s;
}

export function serializeEnt(e) {
  const o = {};
  for (const k in e) {
    if (k[0] === '_') continue;
    if (k === 'items') o.items = e.items.map(it => [it.i, Math.round(it.d * 1000) / 1000]);
    else o[k] = e[k];
  }
  return structuredClone(o);
}

export function deserializeEnt(o) {
  const e = structuredClone(o);
  if (e.items) e.items = e.items.map(([i, d]) => ({ i, d, pd: d }));
  return e;
}

export function newEntity(state, type, x, y, z, r, extra) {
  const def = BUILDINGS[type];
  const e = { id: state.nextId++, type, x, y, z, r };
  if (def.kind === 'belt') e.items = [];
  else if (def.kind === 'bld') {
    if (def.machine) { e.recipe = null; e.clock = 1; e.shards = 0; e.inBuf = []; e.outBuf = []; e.prog = 0; e.working = false; }
    if (def.miner) { e.node = -1; e.clock = 1; e.shards = 0; e.outBuf = [null]; e.prog = 0; e.working = false; }
    if (def.storage) e.slots = makeSlots(def.storage);
    if (def.gen) { e.fuel = [null]; e.burn = 0; e.tripped = false; }
    if (def.battery) e.stored = 0;
    if (def.logistic) { e.buf = null; e.rr = 0; }
    if (def.logistic === 'pole') e.h = 1;
  }
  if (extra) Object.assign(e, extra);
  return e;
}

export function setRecipe(e, recipeId) {
  e.recipe = recipeId;
  const r = RECIPES[recipeId];
  e.inBuf = r ? r.inList.map(x => ({ item: x.item, n: 0 })) : [];
  e.outBuf = r ? r.outList.map(x => ({ item: x.item, n: 0 })) : [];
  e.prog = 0;
  e.working = false;
}

// --- Bezier belt curve -----------------------------------------------------
export function computeCurve(p0, d0, p1, d1) {
  // p = [x,y,z], d = [dx,dz] horizontal unit directions of travel
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const k = clamp(chord * 0.4, 0.3, 14);
  const c0 = [p0[0] + d0[0] * k, p0[1], p0[2] + d0[1] * k];
  const c1 = [p1[0] - d1[0] * k, p1[1], p1[2] - d1[1] * k];
  const n = clamp(Math.ceil(chord * 1.2) + 6, 8, 120);
  const pts = new Float32Array((n + 1) * 3);
  const cum = new Float32Array(n + 1);
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    const x = a * p0[0] + b * c0[0] + c * c1[0] + d * p1[0];
    const y = a * p0[1] + b * c0[1] + c * c1[1] + d * p1[1];
    const z = a * p0[2] + b * c0[2] + c * c1[2] + d * p1[2];
    pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
    if (i > 0) len += Math.hypot(x - pts[i * 3 - 3], y - pts[i * 3 - 2], z - pts[i * 3 - 1]);
    cum[i] = len;
  }
  return { pts, cum, len, n };
}

// position + tangent at arc length d
export function curveAt(curve, d, out) {
  const { pts, cum, n } = curve;
  let lo = 0, hi = n;
  if (d <= 0) { lo = 0; hi = 1; }
  else if (d >= cum[n]) { lo = n - 1; hi = n; }
  else {
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] < d) lo = m; else hi = m;
    }
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = clamp((d - cum[lo]) / seg, 0, 1);
  const i0 = lo * 3, i1 = hi * 3;
  out.x = pts[i0] + (pts[i1] - pts[i0]) * t;
  out.y = pts[i0 + 1] + (pts[i1 + 1] - pts[i0 + 1]) * t;
  out.z = pts[i0 + 2] + (pts[i1 + 2] - pts[i0 + 2]) * t;
  out.tx = pts[i1] - pts[i0];
  out.ty = pts[i1 + 1] - pts[i0 + 1];
  out.tz = pts[i1 + 2] - pts[i0 + 2];
  return out;
}

const CELL = 16;
const cellKey = (cx, cz) => (cx + 1000) * 4096 + (cz + 1000);

export class Factory {
  constructor(state, world) {
    this.state = state;
    this.world = world;
    this.grid = new Map();
    this.tickers = [];
    this.belts = [];
    this.nets = [];
    this.powerDirty = true;
    this.hooks = {};
    this.minerByNode = new Map();
    if (state._entList) {
      // two passes: buildings first so belts/wires can link
      const list = state._entList;
      delete state._entList;
      for (const e of list) if (BUILDINGS[e.type] && BUILDINGS[e.type].kind === 'bld') this.addEntity(e);
      for (const e of list) if (BUILDINGS[e.type] && BUILDINGS[e.type].kind !== 'bld') this.addEntity(e);
    }
  }

  get ents() { return this.state.ents; }
  get(id) { return this.state.ents.get(id); }

  // ---------------- entity registry ----------------
  addEntity(e) {
    const def = BUILDINGS[e.type];
    this.state.ents.set(e.id, e);
    if (e.id >= this.state.nextId) this.state.nextId = e.id + 1;
    if (def.kind === 'belt') {
      const a = this.get(e.from.b), b = this.get(e.to.b);
      if (!a || !b) { this.state.ents.delete(e.id); return null; }
      a._links[e.from.p] = e.id;
      b._links[e.to.p] = e.id;
      this.updateBeltCurve(e);
      this.belts.push(e);
    } else if (def.kind === 'wire') {
      const a = this.get(e.a), b = this.get(e.b);
      if (!a || !b) { this.state.ents.delete(e.id); return null; }
      a._wires.add(e.id);
      b._wires.add(e.id);
      this.powerDirty = true;
    } else {
      e._links = new Array(def.ports.length).fill(null);
      e._wires = new Set();
      e._powered = false;
      e._net = null;
      if (def.machine || def.miner || def.logistic || def.storage || def.gen || def.power || def.ports.length) this.tickers.push(e);
      if (def.miner) this.minerByNode.set(e.node, e.id);
      if (def.conn || def.pole) this.powerDirty = true;
    }
    this.indexEnt(e);
    return e;
  }

  removeEntity(id) {
    const e = this.get(id);
    if (!e) return null;
    const def = BUILDINGS[e.type];
    this.unindexEnt(e);
    this.state.ents.delete(id);
    if (def.kind === 'belt') {
      const a = this.get(e.from.b), b = this.get(e.to.b);
      if (a && a._links[e.from.p] === id) a._links[e.from.p] = null;
      if (b && b._links[e.to.p] === id) b._links[e.to.p] = null;
      const i = this.belts.indexOf(e);
      if (i >= 0) this.belts.splice(i, 1);
    } else if (def.kind === 'wire') {
      const a = this.get(e.a), b = this.get(e.b);
      if (a) a._wires.delete(id);
      if (b) b._wires.delete(id);
      this.powerDirty = true;
    } else {
      const i = this.tickers.indexOf(e);
      if (i >= 0) this.tickers.splice(i, 1);
      if (def.miner && this.minerByNode.get(e.node) === id) this.minerByNode.delete(e.node);
      this.powerDirty = true;
    }
    return e;
  }

  // Attached belts & wires of a building
  attachments(e) {
    const out = [];
    if (e._links) for (const l of e._links) if (l) out.push(l);
    if (e._wires) for (const w of e._wires) out.push(w);
    return out;
  }

  updateBeltCurve(belt) {
    const a = this.get(belt.from.b), b = this.get(belt.to.b);
    const pa = this.portWorld(a, belt.from.p), pb = this.portWorld(b, belt.to.p);
    belt._curve = computeCurve([pa.x, pa.y, pa.z], [pa.dx, pa.dz], [pb.x, pb.y, pb.z], [-pb.dx, -pb.dz]);
    belt._len = belt._curve.len;
  }

  portWorld(e, i) {
    const def = BUILDINGS[e.type];
    const p = def.ports[i];
    const ly = def.logistic === 'pole' ? e.h : p.y;
    const [x, y, z] = toWorld(e, p.x, ly, p.z);
    const [dx, dz] = rotXZ(p.dx, p.dz, e.r);
    return { x, y, z, dx, dz, t: p.t };
  }

  connWorld(e) {
    const def = BUILDINGS[e.type];
    const c = def.conn || [0, def.size[1], 0];
    const [x, y, z] = toWorld(e, c[0], c[1], c[2]);
    return { x, y, z };
  }

  maxConns(e) {
    const def = BUILDINGS[e.type];
    if (def.pole) return def.pole;
    if (def.conn) return 3;
    return 0;
  }

  // ---------------- spatial index ----------------
  entRadius(e) {
    const def = BUILDINGS[e.type];
    if (!def.size) return 1;
    return Math.hypot(def.size[0], def.size[2]) / 2 + 0.5;
  }

  indexEnt(e) {
    const def = BUILDINGS[e.type];
    const keys = new Set();
    if (def.kind === 'belt') {
      const c = e._curve;
      for (let i = 0; i <= c.n; i++) {
        keys.add(cellKey(Math.floor(c.pts[i * 3] / CELL), Math.floor(c.pts[i * 3 + 2] / CELL)));
      }
    } else if (def.kind === 'wire') {
      return;
    } else {
      const r = this.entRadius(e);
      for (let cx = Math.floor((e.x - r) / CELL); cx <= Math.floor((e.x + r) / CELL); cx++)
        for (let cz = Math.floor((e.z - r) / CELL); cz <= Math.floor((e.z + r) / CELL); cz++) keys.add(cellKey(cx, cz));
    }
    e._cells = [...keys];
    for (const k of e._cells) {
      let s = this.grid.get(k);
      if (!s) { s = new Set(); this.grid.set(k, s); }
      s.add(e.id);
    }
  }

  unindexEnt(e) {
    if (!e._cells) return;
    for (const k of e._cells) {
      const s = this.grid.get(k);
      if (s) { s.delete(e.id); if (!s.size) this.grid.delete(k); }
    }
    e._cells = null;
  }

  // all entities whose cells touch the square around (x,z)
  near(x, z, r, out = []) {
    const seen = new Set();
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const s = this.grid.get(cellKey(cx, cz));
        if (!s) continue;
        for (const id of s) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.get(id);
          if (e) out.push(e);
        }
      }
    return out;
  }

  countType(type) {
    let n = 0;
    for (const e of this.ents.values()) if (e.type === type) n++;
    return n;
  }

  findType(type) {
    for (const e of this.ents.values()) if (e.type === type) return e;
    return null;
  }

  // ---------------- power ----------------
  rebuildPower() {
    this.powerDirty = false;
    const nets = [];
    const visited = new Set();
    for (const e of this.ents.values()) {
      const def = BUILDINGS[e.type];
      if (def.kind !== 'bld') continue;
      e._net = null;
    }
    for (const e of this.ents.values()) {
      const def = BUILDINGS[e.type];
      if (def.kind !== 'bld' || visited.has(e.id) || !(def.conn || def.pole)) continue;
      if (!e._wires.size) continue;
      const net = { id: e.id, members: [], gens: [], cons: [], bats: [], cap: 0, demand: 0, stored: 0, tripped: false };
      const stack = [e];
      visited.add(e.id);
      while (stack.length) {
        const cur = stack.pop();
        cur._net = net;
        net.members.push(cur);
        const cd = BUILDINGS[cur.type];
        if (cd.gen) net.gens.push(cur);
        if (cd.power) net.cons.push(cur);
        if (cd.battery) net.bats.push(cur);
        for (const wid of cur._wires) {
          const w = this.get(wid);
          if (!w) continue;
          const other = this.get(w.a === cur.id ? w.b : w.a);
          if (other && !visited.has(other.id)) { visited.add(other.id); stack.push(other); }
        }
      }
      net.id = Math.min(...net.members.map(m => m.id));
      nets.push(net);
    }
    this.nets = nets;
  }

  wantPower(e, def) {
    if (def.machine || def.miner) return e.working ? powerUse(def, e.clock) : 0;
    return def.power || 0;
  }

  tickPower(dt) {
    if (this.powerDirty) this.rebuildPower();
    for (const e of this.tickers) e._powered = false;
    for (const net of this.nets) {
      let cap = 0, demand = 0, stored = 0, tripped = false;
      for (const g of net.gens) {
        if (g.tripped) tripped = true;
        g._fuelOk = g.burn > 0 || !!(g.fuel[0] && g.fuel[0].n > 0);
        g._load = 0;
        if (g._fuelOk) cap += BUILDINGS[g.type].gen;
      }
      for (const c of net.cons) demand += this.wantPower(c, BUILDINGS[c.type]);
      for (const b of net.bats) stored += b.stored;
      net.cap = cap; net.demand = demand; net.stored = stored; net.tripped = tripped;
      net.prod = 0; net.batFlow = 0;
      if (tripped) continue;
      const batAvail = stored / dt;
      if (cap <= 0 && stored <= 0) continue;
      if (demand > cap + batAvail + 1e-6) {
        if (net.gens.length && cap > 0) {
          for (const g of net.gens) g.tripped = true;
          net.tripped = true;
          if (this.hooks.onTrip) this.hooks.onTrip(net);
        }
        continue;
      }
      for (const c of net.cons) c._powered = true;
      const fromGen = Math.min(demand, cap);
      const fromBat = demand - fromGen;
      let charge = 0;
      if (net.bats.length) {
        if (fromBat > 0) {
          // discharge proportionally
          let need = fromBat * dt;
          for (const b of net.bats) {
            const take = Math.min(b.stored, need * (b.stored / Math.max(stored, 1e-9)));
            b.stored -= take;
          }
        } else {
          const excess = cap - fromGen;
          for (const b of net.bats) {
            const room = BATTERY_MJ - b.stored;
            const c = Math.min(room / dt, BATTERY_RATE, Math.max(0, excess - charge));
            b.stored += c * dt;
            charge += c;
          }
        }
      }
      const load = fromGen + charge;
      net.prod = load;
      net.batFlow = charge - fromBat;
      if (cap > 0 && load > 0) {
        for (const g of net.gens) {
          if (!g._fuelOk) continue;
          const share = BUILDINGS[g.type].gen / cap;
          g._load = load * share;
          this.burn(g, load * share * dt);
        }
      }
    }
  }

  burn(g, mj) {
    let guard = 0;
    while (mj > 1e-9 && guard++ < 50) {
      if (g.burn <= 0) {
        const s = g.fuel[0];
        if (!s || s.n <= 0) { g.burn = 0; break; }
        g.burn += ITEMS[s.item].fuel;
        g.burnItem = s.item;
        s.n--;
        if (s.n <= 0) g.fuel[0] = null;
      }
      const use = Math.min(mj, g.burn);
      g.burn -= use;
      mj -= use;
    }
  }

  resetFuse(e) {
    const net = e._net;
    if (!net) return false;
    for (const g of net.gens) g.tripped = false;
    net.tripped = false;
    return true;
  }

  // ---------------- simulation step ----------------
  tick(dt) {
    this.state.tick++;
    this.state.time += dt;
    this.tickPower(dt);
    const list = this.tickers;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const def = BUILDINGS[e.type];
      if (def.machine) this.tickMachine(e, dt);
      else if (def.miner) this.tickMiner(e, def, dt);
      if (def.ports.length) this.pushOutputs(e, def);
    }
    const belts = this.belts;
    for (let i = 0; i < belts.length; i++) this.tickBelt(belts[i], dt);
  }

  tickMachine(e, dt) {
    const r = RECIPES[e.recipe];
    if (!r) { e.working = false; return; }
    if (!e.working) {
      if (!e._powered) return;
      for (let k = 0; k < r.inList.length; k++) if (e.inBuf[k].n < r.inList[k].n) return;
      for (let k = 0; k < r.outList.length; k++) if (e.outBuf[k].n + r.outList[k].n > stackOf(r.outList[k].item)) return;
      for (let k = 0; k < r.inList.length; k++) e.inBuf[k].n -= r.inList[k].n;
      e.working = true;
      e.prog = 0;
    }
    if (e._powered) e.prog += dt * e.clock;
    if (e.prog >= r.t) {
      for (let k = 0; k < r.outList.length; k++) e.outBuf[k].n += r.outList[k].n;
      e.working = false;
      e.prog = 0;
    }
  }

  tickMiner(e, def, dt) {
    const node = this.world.nodes[e.node];
    if (!node) return;
    if (!e.outBuf[0]) e.outBuf[0] = { item: node.type, n: 0 };
    const out = e.outBuf[0];
    const stack = stackOf(out.item);
    e.working = out.n < stack;
    if (!e.working || !e._powered) return;
    const t = 60 / minerRate(def, node.purity, 1);
    e.prog += dt * e.clock;
    while (e.prog >= t) {
      if (out.n >= stack) { e.prog = t; break; }
      out.n++;
      e.prog -= t;
    }
  }

  // ---------------- item transport ----------------
  canAcceptBelt(b) {
    const it = b.items;
    return it.length === 0 || it[it.length - 1].d >= BELT_SPACING;
  }

  beltWaiting(id) {
    const b = this.get(id);
    return !!(b && b.items.length && b.items[0].d >= b._len - 1e-4);
  }

  tickBelt(b, dt) {
    const speed = BUILDINGS[b.type].speed;
    const items = b.items;
    const len = b._len;
    let limit = len;
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      it.pd = it.d;
      let nd = it.d + speed * dt;
      if (nd > limit) nd = Math.max(it.d, limit);
      it.d = nd;
      limit = nd - BELT_SPACING;
    }
    if (items.length && items[0].d >= len - 1e-4) {
      const target = this.get(b.to.b);
      if (target && this.acceptInput(target, b.to.p, items[0].i)) items.shift();
    }
  }

  pushOutputs(e, def) {
    const ports = def.ports;
    if (def.logistic === 'splitter') {
      if (!e.buf) return;
      for (let k = 0; k < 3; k++) {
        const pi = 1 + ((e.rr + k) % 3);
        const bid = e._links[pi];
        if (!bid) continue;
        const belt = this.get(bid);
        if (belt && this.canAcceptBelt(belt)) {
          belt.items.push({ i: e.buf, d: 0, pd: 0 });
          e.buf = null;
          e.rr = (e.rr + k + 1) % 3;
          return;
        }
      }
      return;
    }
    for (let i = 0; i < ports.length; i++) {
      if (ports[i].t !== 'out') continue;
      const bid = e._links[i];
      if (!bid) continue;
      const belt = this.get(bid);
      if (!belt || !this.canAcceptBelt(belt)) continue;
      const item = this.takeOutput(e, def);
      if (item) belt.items.push({ i: item, d: 0, pd: 0 });
    }
  }

  takeOutput(e, def) {
    if (def.machine || def.miner) {
      const s = e.outBuf[0];
      if (s && s.n > 0) { s.n--; return s.item; }
      return null;
    }
    if (def.logistic) {
      const b = e.buf;
      e.buf = null;
      return b;
    }
    if (def.storage && !def.crate) {
      for (let i = 0; i < e.slots.length; i++) {
        const s = e.slots[i];
        if (s && s.n > 0) {
          s.n--;
          const item = s.item;
          if (s.n <= 0) e.slots[i] = null;
          return item;
        }
      }
    }
    return null;
  }

  acceptInput(e, portIdx, item) {
    const def = BUILDINGS[e.type];
    if (def.machine) {
      const r = RECIPES[e.recipe];
      if (!r) return false;
      for (let k = 0; k < e.inBuf.length; k++) {
        const s = e.inBuf[k];
        if (s.item === item) {
          const cap = Math.min(stackOf(item), Math.max(r.inList[k].n * 3, 10));
          if (s.n >= cap) return false;
          s.n++;
          return true;
        }
      }
      return false;
    }
    if (def.logistic) {
      if (e.buf) return false;
      if (def.logistic === 'merger') {
        // fair round-robin between waiting inputs
        const order = [0, 1, 2];
        const pref = order[e.rr % 3];
        if (pref !== portIdx && e._links[pref] && this.beltWaiting(e._links[pref])) return false;
        e.rr = (order.indexOf(portIdx) + 1) % 3;
      }
      e.buf = item;
      return true;
    }
    if (def.gen) {
      if (!def.fuels.includes(item)) return false;
      const s = e.fuel[0];
      if (!s) { e.fuel[0] = { item, n: 1 }; return true; }
      if (s.item !== item || s.n >= stackOf(item)) return false;
      s.n++;
      return true;
    }
    if (def.storage) return addItem(e.slots, item, 1) === 0;
    if (e.type === 'awesome_sink') {
      if (!e._powered) return false;
      const pts = ITEMS[item].points;
      if (!pts) return false;
      this.sinkPoints(pts);
      return true;
    }
    if (e.type === 'space_elevator') {
      const el = this.state.prog.elev;
      const phase = ELEVATOR_PHASES[el.phase];
      if (!phase) return false;
      const need = phase.cost[item];
      if (!need || (el.have[item] || 0) >= need) return false;
      el.have[item] = (el.have[item] || 0) + 1;
      return true;
    }
    return false;
  }

  sinkPoints(pts) {
    const s = this.state.prog.sink;
    s.total += pts;
    s.progress += pts;
    let guard = 0;
    while (s.progress >= couponCost(s.earned) && guard++ < 100) {
      s.progress -= couponCost(s.earned);
      s.earned++;
      s.coupons++;
      if (this.hooks.onCoupon) this.hooks.onCoupon();
    }
  }

  // ---------------- snapshot (dynamic state) ----------------
  dynOf(e) {
    const def = BUILDINGS[e.type];
    if (def.kind === 'belt') {
      const a = new Array(e.items.length * 2);
      for (let k = 0; k < e.items.length; k++) {
        a[k * 2] = ITEM_INDEX[e.items[k].i];
        a[k * 2 + 1] = Math.round(e.items[k].d * 100);
      }
      return a;
    }
    if (def.machine) return [e.inBuf.map(s => s.n), e.outBuf.map(s => s.n), Math.round(e.prog * 1000) / 1000, e.working ? 1 : 0];
    if (def.miner) return [e.outBuf[0] ? e.outBuf[0].n : 0, Math.round(e.prog * 1000) / 1000];
    if (def.storage) return packSlots(e.slots);
    if (def.gen) return [packSlots(e.fuel), Math.round(e.burn * 10) / 10, e.tripped ? 1 : 0];
    if (def.battery) return Math.round(e.stored);
    if (def.logistic) return [e.buf ? ITEM_INDEX[e.buf] : -1, e.rr];
    return null;
  }

  applyDyn(e, d) {
    const def = BUILDINGS[e.type];
    if (d == null) return;
    if (def.kind === 'belt') {
      const items = [];
      for (let k = 0; k < d.length; k += 2) {
        const dd = Math.min(d[k + 1] / 100, e._len);
        items.push({ i: ITEM_IDS[d[k]], d: dd, pd: dd });
      }
      e.items = items;
    } else if (def.machine) {
      if (e.inBuf.length !== d[0].length || e.outBuf.length !== d[1].length) return;
      d[0].forEach((n, k) => { e.inBuf[k].n = n; });
      d[1].forEach((n, k) => { e.outBuf[k].n = n; });
      e.prog = d[2];
      e.working = !!d[3];
    } else if (def.miner) {
      if (e.outBuf[0]) e.outBuf[0].n = d[0];
      e.prog = d[1];
    } else if (def.storage) {
      e.slots = unpackSlots(d, e.slots.length);
    } else if (def.gen) {
      e.fuel = unpackSlots(d[0], 1);
      e.burn = d[1];
      e.tripped = !!d[2];
    } else if (def.battery) {
      e.stored = d;
    } else if (def.logistic) {
      e.buf = d[0] >= 0 ? ITEM_IDS[d[0]] : null;
      e.rr = d[1];
    }
  }

  snapshot() {
    const ents = [];
    for (const e of this.ents.values()) {
      const d = this.dynOf(e);
      if (d != null) ents.push(e.id, d);
    }
    const p = this.state.prog;
    return { tick: this.state.tick, time: this.state.time, ents, sink: p.sink, elev: p.elev };
  }

  applySnapshot(s) {
    this.state.time = s.time;
    for (let i = 0; i < s.ents.length; i += 2) {
      const e = this.get(s.ents[i]);
      if (e) this.applyDyn(e, s.ents[i + 1]);
    }
    this.state.prog.sink = s.sink;
    this.state.prog.elev = s.elev;
  }
}

export function packSlots(slots) {
  const a = [];
  for (const s of slots) {
    if (s && s.n > 0) a.push(ITEM_INDEX[s.item], s.n);
    else a.push(-1, 0);
  }
  return a;
}

export function unpackSlots(a, n) {
  const slots = new Array(n).fill(null);
  for (let k = 0; k < n && k * 2 < a.length; k++) {
    if (a[k * 2] >= 0) slots[k] = { item: ITEM_IDS[a[k * 2]], n: a[k * 2 + 1] };
  }
  return slots;
}

export function playerSlotCount(state) {
  return BASE_SLOTS + (state.prog.slots || 0);
}
