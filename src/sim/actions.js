// Host-side handlers for player actions. Every state mutation that clients
// need to know about goes out through the game's event helpers.
import { BUILDINGS, MAX_POLE_HEIGHT, lengthCost } from '../data/buildings.js';
import { RECIPES } from '../data/recipes.js';
import { stackOf } from '../data/items.js';
import { MILESTONE_BY_ID, RESEARCH_BY_ID, ELEVATOR_PHASES, TIER_REQ, SHOP } from '../data/progression.js';
import { newEntity, setRecipe, computeCurve, playerSlotCount } from './factory.js';
import { checkPlacement } from './placement.js';
import { removeAll, hasAll, addItem, removeItem, canAddAll, sumCosts, resizeSlots } from './inventory.js';
import { clamp } from '../core/util.js';
import { floraHarvest } from '../world/world.js';

const REACH = 14;

// Access wrapper around any inventory a player can touch.
// ref: { p: 1 } for the player's own inventory, or { e: entityId, w: 'in'|'out'|'fuel'|'slots' }
export function invAccess(state, factory, pid, ref) {
  const P = state.players[pid];
  if (!P || !ref) return null;
  const stackCap = (k, item) => stackOf(item);
  if (ref.p) return { slots: P.inv, accepts: () => true, cap: stackCap, keep: false, free: true };
  const e = factory.get(ref.e);
  if (!e) return null;
  const def = BUILDINGS[e.type];
  if ((P.x - e.x) ** 2 + (P.z - e.z) ** 2 > 40 * 40) return null;
  switch (ref.w) {
    case 'in':
      if (!e.inBuf) return null;
      return { slots: e.inBuf, accepts: (k, item) => !!e.inBuf[k] && e.inBuf[k].item === item, cap: stackCap, keep: true };
    case 'out':
      if (!e.outBuf) return null;
      return { slots: e.outBuf, accepts: () => false, cap: stackCap, keep: true };
    case 'fuel':
      if (!e.fuel) return null;
      return { slots: e.fuel, accepts: (k, item) => def.fuels.includes(item), cap: stackCap, keep: false };
    case 'slots':
      if (!e.slots) return null;
      return { slots: e.slots, accepts: () => !def.crate, cap: stackCap, keep: false, free: !def.crate };
    default: return null;
  }
}

const own = (obj, k) => k != null && Object.prototype.hasOwnProperty.call(obj, k);

export function handleAction(g, pid, a) {
  if (!a || typeof a !== 'object' || !own(HANDLERS, a.k)) return;
  // reject ids that are not real keys (e.g. "constructor", "__proto__")
  if (a.type != null && !own(BUILDINGS, a.type)) return;
  if (a.recipe != null && a.recipe !== '' && !own(RECIPES, a.recipe)) return;
  const fn = HANDLERS[a.k];
  const P = g.state.players[pid];
  if (!P) return;
  try {
    fn(g, pid, a, P);
  } catch (err) {
    console.error('action failed', a, err);
  }
}

function err(g, pid, text) {
  g.notify(text, 'err', pid);
}

function near(P, x, z, r) {
  return (P.x - x) ** 2 + (P.z - z) ** 2 <= r * r;
}

// Give items to player; anything that does not fit goes into a crate nearby.
export function giveOrCrate(g, pid, items, x, y, z) {
  const P = g.state.players[pid];
  const overflow = {};
  for (const [item, n] of Object.entries(items)) {
    if (n <= 0) continue;
    const left = addItem(P.inv, item, n);
    if (left > 0) overflow[item] = left;
  }
  if (Object.keys(overflow).length) {
    const crate = newEntity(g.state, 'crate', x, y, z, 0);
    for (const [item, n] of Object.entries(overflow)) addItem(crate.slots, item, n);
    g.addEnt(crate);
    g.notify('Inventory full — leftovers placed in a Dismantle Crate', 'warn', pid);
  }
}

function contentsOf(e) {
  const out = {};
  const add = (item, n) => { if (item && n > 0) out[item] = (out[item] || 0) + n; };
  if (e.inBuf) for (const s of e.inBuf) if (s) add(s.item, s.n);
  if (e.outBuf) for (const s of e.outBuf) if (s) add(s.item, s.n);
  if (e.slots) for (const s of e.slots) if (s) add(s.item, s.n);
  if (e.fuel) for (const s of e.fuel) if (s) add(s.item, s.n);
  if (e.buf) add(e.buf, 1);
  if (e.items) for (const it of e.items) add(it.i, 1);
  return out;
}

function refundOf(e) {
  const def = BUILDINGS[e.type];
  if (def.kind === 'belt' || def.kind === 'wire') return lengthCost(def, e._len || 1);
  return def.cost || {};
}

function poleEntity(g, type, ep) {
  const def = BUILDINGS[type];
  const extra = def.logistic === 'pole' ? { h: clamp(Number(ep.h) || 1, 0.5, MAX_POLE_HEIGHT) } : undefined;
  const e = newEntity(g.state, type, Number(ep.x), Number(ep.y), Number(ep.z), Number(ep.r) || 0, extra);
  return e;
}

// Temporarily take an id for a pole we may or may not add.
function previewPole(g, type, ep) {
  const save = g.state.nextId;
  const e = poleEntity(g, type, ep);
  g.state.nextId = save;
  return e;
}

function wireLen(g, a, b) {
  const pa = g.factory.connWorld(a), pb = g.factory.connWorld(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}

const HANDLERS = {
  build(g, pid, a, P) {
    const def = BUILDINGS[a.type];
    if (!def || def.kind !== 'bld' || def.crate) return;
    const extra = {};
    let x = Number(a.x), y = Number(a.y), z = Number(a.z), r = Number(a.r) || 0;
    if (def.snap === 'node') {
      const node = g.world.nodes[a.node];
      if (!node) return err(g, pid, 'Must be placed on a resource node');
      x = node.x; z = node.z; y = node.y;
      extra.node = node.id;
    }
    if (def.logistic === 'pole') extra.h = clamp(Number(a.h) || 1, 0.5, MAX_POLE_HEIGHT);
    const players = Object.values(g.state.players).filter(p => p.online && p.x != null);
    const res = checkPlacement(g.factory, g.world, g.state.prog, a.type, x, y, z, r, { node: extra.node, h: extra.h, players });
    if (!res.ok) return err(g, pid, res.reason);
    if (!removeAll(P.inv, def.cost)) return err(g, pid, 'Not enough resources');
    const e = newEntity(g.state, a.type, x, y, z, r, extra);
    if (def.miner) e.outBuf = [{ item: g.world.nodes[e.node].type, n: 0 }];
    g.addEnt(e);
    g.clearFloraFor(e);
    g.updInv(pid);
    g.sfx('build', e.x, e.y, e.z);
  },

  belt(g, pid, a, P) {
    const def = BUILDINGS[a.type];
    if (!def || def.kind !== 'belt') return;
    if (!g.state.prog.b.includes(a.type)) return err(g, pid, 'Not unlocked yet');
    let cost = {};
    const newPoles = [];
    const resolve = (ep, want) => {
      if (ep.b != null) {
        const e = g.factory.get(ep.b);
        if (!e) return null;
        const pd = BUILDINGS[e.type].ports[ep.p];
        if (!pd || pd.t !== want || e._links[ep.p]) return null;
        return { e, p: ep.p };
      }
      if (!g.state.prog.b.includes('conveyor_pole')) return null;
      const pole = previewPole(g, 'conveyor_pole', ep);
      const chk = checkPlacement(g.factory, g.world, g.state.prog, 'conveyor_pole', pole.x, pole.y, pole.z, pole.r, { h: pole.h });
      if (!chk.ok) return null;
      cost = sumCosts(cost, BUILDINGS.conveyor_pole.cost);
      newPoles.push(pole);
      return { e: pole, p: want === 'out' ? 1 : 0, isNew: true };
    };
    const A = resolve(a.a, 'out');
    const B = resolve(a.b, 'in');
    if (!A || !B) return err(g, pid, 'Invalid conveyor connection');
    if (A.e === B.e || (A.e.id === B.e.id && !A.isNew)) return err(g, pid, 'Cannot connect a building to itself');
    const pa = g.factory.portWorld(A.e, A.p), pb = g.factory.portWorld(B.e, B.p);
    const curve = computeCurve([pa.x, pa.y, pa.z], [pa.dx, pa.dz], [pb.x, pb.y, pb.z], [-pb.dx, -pb.dz]);
    if (curve.len < 0.5) return err(g, pid, 'Conveyor too short');
    if (curve.len > def.maxLen) return err(g, pid, `Conveyor too long (max ${def.maxLen} m)`);
    cost = sumCosts(cost, lengthCost(def, curve.len));
    if (!removeAll(P.inv, cost)) return err(g, pid, 'Not enough resources');
    for (const pole of newPoles) {
      pole.id = g.state.nextId++;
      g.addEnt(pole);
    }
    const belt = newEntity(g.state, a.type, 0, 0, 0, 0, { from: { b: A.e.id, p: A.p }, to: { b: B.e.id, p: B.p } });
    g.addEnt(belt);
    g.updInv(pid);
    g.sfx('build', pa.x, pa.y, pa.z);
  },

  wire(g, pid, a, P) {
    const def = BUILDINGS.power_line;
    if (!g.state.prog.b.includes('power_line')) return err(g, pid, 'Not unlocked yet');
    let cost = {};
    const newPoles = [];
    const poleType = BUILDINGS[a.pole] && BUILDINGS[a.pole].pole && g.state.prog.b.includes(a.pole) ? a.pole : 'power_pole_mk1';
    const resolve = (ep) => {
      if (ep.id != null) {
        const e = g.factory.get(ep.id);
        if (!e || !g.factory.maxConns(e)) return null;
        return e;
      }
      if (!g.state.prog.b.includes(poleType)) return null;
      const pole = previewPole(g, poleType, ep);
      const chk = checkPlacement(g.factory, g.world, g.state.prog, poleType, pole.x, pole.y, pole.z, 0, {});
      if (!chk.ok) return null;
      cost = sumCosts(cost, BUILDINGS[poleType].cost);
      newPoles.push(pole);
      return pole;
    };
    const A = resolve(a.a), B = resolve(a.b);
    if (!A || !B || A === B) return err(g, pid, 'Invalid power connection');
    if (A._wires && A._wires.size >= g.factory.maxConns(A)) return err(g, pid, 'No free power connections');
    if (B._wires && B._wires.size >= g.factory.maxConns(B)) return err(g, pid, 'No free power connections');
    if (A._wires && B._wires) {
      for (const wid of A._wires) {
        const w = g.factory.get(wid);
        if (w && (w.a === B.id || w.b === B.id)) return err(g, pid, 'Already connected');
      }
    }
    const len = wireLen(g, A, B);
    if (len > def.maxLen) return err(g, pid, `Power line too long (max ${def.maxLen} m)`);
    cost = sumCosts(cost, lengthCost(def, len));
    if (!removeAll(P.inv, cost)) return err(g, pid, 'Not enough resources');
    for (const pole of newPoles) {
      pole.id = g.state.nextId++;
      g.addEnt(pole);
      g.clearFloraFor(pole);
    }
    const w = newEntity(g.state, 'power_line', 0, 0, 0, 0, { a: A.id, b: B.id });
    g.addEnt(w);
    g.updInv(pid);
    g.sfx('wire', P.x, P.y, P.z);
  },

  dismantle(g, pid, a, P) {
    const e = g.factory.get(a.id);
    if (!e) return;
    const def = BUILDINGS[e.type];
    const list = [e];
    if (def.kind === 'bld') for (const id of g.factory.attachments(e)) { const x = g.factory.get(id); if (x) list.push(x); }
    let total = {};
    for (const x of list) total = sumCosts(total, refundOf(x), contentsOf(x));
    let px = e.x, py = e.y, pz = e.z;
    if (def.kind === 'belt' && e._curve) { const c = e._curve; const m = Math.floor(c.n / 2) * 3; px = c.pts[m]; py = c.pts[m + 1]; pz = c.pts[m + 2]; }
    if (def.kind === 'wire') { px = P.x; py = P.y; pz = P.z; }
    // remove attachments first, then the building itself
    for (let i = list.length - 1; i >= 0; i--) g.delEnt(list[i].id);
    giveOrCrate(g, pid, total, px, py, pz);
    g.updInv(pid);
    g.sfx('dismantle', px, py, pz);
  },

  recipe(g, pid, a, P) {
    const e = g.factory.get(a.id);
    if (!e) return;
    const def = BUILDINGS[e.type];
    const r = RECIPES[a.recipe];
    if (!def.machine || (a.recipe && (!r || r.m !== def.machine || !g.state.prog.r.includes(a.recipe)))) return;
    const back = contentsOf({ inBuf: e.inBuf, outBuf: e.outBuf });
    setRecipe(e, a.recipe || null);
    giveOrCrate(g, pid, back, e.x, e.y + 1, e.z);
    g.updEnt(e);
    g.updInv(pid);
  },

  clock(g, pid, a, P) {
    const e = g.factory.get(a.id);
    if (!e || e.clock == null) return;
    e.clock = clamp(Number(a.clock) || 1, 0.01, 1 + 0.5 * e.shards);
    g.updEnt(e);
  },

  shard(g, pid, a, P) {
    const e = g.factory.get(a.id);
    if (!e || e.shards == null) return;
    if (a.d > 0) {
      if (e.shards >= 3) return err(g, pid, 'Maximum of 3 Power Shards');
      if (!removeAll(P.inv, { power_shard: 1 })) return err(g, pid, 'You have no Power Shards');
      e.shards++;
    } else {
      if (e.shards <= 0) return;
      e.shards--;
      e.clock = Math.min(e.clock, 1 + 0.5 * e.shards);
      giveOrCrate(g, pid, { power_shard: 1 }, e.x, e.y + 1, e.z);
    }
    g.updEnt(e);
    g.updInv(pid);
  },

  xfer(g, pid, a, P) {
    if (!Number.isInteger(a.si) || (a.di != null && !Number.isInteger(a.di))) return;
    const src = g.invAccess(pid, a.src), dst = g.invAccess(pid, a.dst);
    if (!src || !dst) return;
    const s = src.slots[a.si];
    if (!s || s.n <= 0) return;
    const item = s.item;
    const want = Math.floor(Number(a.n));
    let n = a.n == null || !(want > 0) ? s.n : Math.min(want, s.n);
    let moved = 0;
    if (a.di == null || a.di < 0) {
      for (let k = 0; k < dst.slots.length && moved < n; k++) {
        const d = dst.slots[k];
        if (d && d.item === item && dst.accepts(k, item)) {
          const put = Math.min(n - moved, dst.cap(k, item) - d.n);
          if (put > 0) { d.n += put; moved += put; }
        }
      }
      for (let k = 0; k < dst.slots.length && moved < n; k++) {
        if (!dst.slots[k] && dst.accepts(k, item)) {
          const put = Math.min(n - moved, dst.cap(k, item));
          dst.slots[k] = { item, n: put };
          moved += put;
        }
      }
    } else {
      const k = a.di;
      if (k >= dst.slots.length || !dst.accepts(k, item)) {
        // allow swapping stacks between two free-form inventories
        if (!(k < dst.slots.length && dst.free && src.free)) return;
      }
      const d = dst.slots[k];
      if (!d || (d.n === 0 && !dst.keep)) {
        moved = Math.min(n, dst.cap(k, item));
        dst.slots[k] = { item, n: moved };
      } else if (d.item === item) {
        moved = Math.max(0, Math.min(n, dst.cap(k, item) - d.n));
        d.n += moved;
      } else if (dst.free && src.free && n === s.n) {
        // swap
        dst.slots[k] = s;
        src.slots[a.si] = d;
        g.afterXfer(pid, a.src, src);
        g.afterXfer(pid, a.dst, dst);
        return;
      } else return;
    }
    if (moved <= 0) return;
    s.n -= moved;
    if (s.n <= 0 && !src.keep) src.slots[a.si] = null;
    g.afterXfer(pid, a.src, src);
    if (JSON.stringify(a.src) !== JSON.stringify(a.dst)) g.afterXfer(pid, a.dst, dst);
  },

  // take everything from a building inventory
  takeall(g, pid, a, P) {
    const src = g.invAccess(pid, a.src);
    if (!src) return;
    for (let k = 0; k < src.slots.length; k++) {
      const s = src.slots[k];
      if (!s || s.n <= 0) continue;
      const left = addItem(P.inv, s.item, s.n);
      s.n = left;
      if (s.n <= 0 && !src.keep) src.slots[k] = null;
    }
    g.afterXfer(pid, a.src, src);
    g.updInv(pid);
  },

  trash(g, pid, a, P) {
    if (!Number.isInteger(a.si) || !P.inv[a.si]) return;
    P.inv[a.si] = null;
    g.updInv(pid);
  },

  sort(g, pid, a, P) {
    const items = {};
    for (const s of P.inv) if (s) items[s.item] = (items[s.item] || 0) + s.n;
    P.inv.fill(null);
    for (const [item, n] of Object.entries(items)) addItem(P.inv, item, n);
    g.updInv(pid);
  },

  craft(g, pid, a, P) {
    const r = RECIPES[a.recipe];
    if (!r || !r.hand || !g.state.prog.r.includes(r.id)) return;
    if (!hasAll(P.inv, r.in)) return err(g, pid, 'Missing ingredients');
    const after = P.inv.map(s => (s ? { ...s } : null));
    removeAll(after, r.in);
    if (!canAddAll(after, r.out)) return err(g, pid, 'Inventory full');
    removeAll(P.inv, r.in);
    for (const [item, n] of Object.entries(r.out)) addItem(P.inv, item, n);
    g.updInv(pid);
  },

  mine(g, pid, a, P) {
    const node = g.world.nodes[a.node];
    if (!node || !near(P, node.x, node.z, REACH)) return;
    const n = node.purity === 2 ? 2 : 1;
    if (addItem(P.inv, node.type, n) >= n) return err(g, pid, 'Inventory full');
    g.updInv(pid);
  },

  harvest(g, pid, a, P) {
    const f = g.world.flora[a.f];
    if (!f || g.state.floraGone.has(f.id) || !near(P, f.x, f.z, REACH)) return;
    const loot = floraHarvest(f);
    if (!loot) return;
    for (const [item, n] of Object.entries(loot)) addItem(P.inv, item, n);
    g.removeFlora([f.id]);
    g.updInv(pid);
    g.sfx('harvest', f.x, f.y, f.z);
  },

  // ---- progression: HUB milestones (ms), MAM research (rs), Space Elevator (elev)
  select(g, pid, a, P) {
    const prog = g.state.prog;
    if (a.kind === 'ms') {
      const m = MILESTONE_BY_ID[a.id];
      if (!m || prog.ms.done.includes(m.id)) return;
      if (prog.elev.phase < TIER_REQ[m.tier]) return err(g, pid, 'Tier locked — deliver Space Elevator parts first');
      prog.ms.active = m.id;
    } else if (a.kind === 'rs') {
      const m = RESEARCH_BY_ID[a.id];
      if (!m || prog.rs.done.includes(m.id)) return;
      if (m.req && !prog.rs.done.includes(m.req)) return err(g, pid, 'Requires previous research');
      prog.rs.active = m.id;
    }
    g.updProg();
  },

  submit(g, pid, a, P) {
    const prog = g.state.prog;
    let cost, have;
    if (a.kind === 'ms' || a.kind === 'rs') {
      const sect = prog[a.kind];
      const m = a.kind === 'ms' ? MILESTONE_BY_ID[sect.active] : RESEARCH_BY_ID[sect.active];
      if (!m) return;
      cost = m.cost;
      sect.have[m.id] = sect.have[m.id] || {};
      have = sect.have[m.id];
    } else if (a.kind === 'elev') {
      const ph = ELEVATOR_PHASES[prog.elev.phase];
      if (!ph) return;
      cost = ph.cost;
      have = prog.elev.have;
    } else return;
    let any = false;
    for (const [item, need] of Object.entries(cost)) {
      const want = need - (have[item] || 0);
      if (want <= 0) continue;
      const got = removeItem(P.inv, item, want);
      if (got > 0) { have[item] = (have[item] || 0) + got; any = true; }
    }
    if (!any) return err(g, pid, 'You have none of the required items');
    g.updInv(pid);
    g.updProg();
    g.sfx('submit', P.x, P.y, P.z);
  },

  complete(g, pid, a, P) {
    const prog = g.state.prog;
    if (a.kind === 'ms' || a.kind === 'rs') {
      const sect = prog[a.kind];
      const m = a.kind === 'ms' ? MILESTONE_BY_ID[sect.active] : RESEARCH_BY_ID[sect.active];
      if (!m) return;
      const have = sect.have[m.id] || {};
      for (const [item, need] of Object.entries(m.cost)) if ((have[item] || 0) < need) return err(g, pid, 'Requirements not met');
      sect.done.push(m.id);
      sect.active = null;
      delete sect.have[m.id];
      applyUnlocks(g, m.unlocks, pid);
      g.notify(`${a.kind === 'ms' ? 'Milestone' : 'Research'} complete: ${m.name}`, 'big');
      g.sfx('milestone', P.x, P.y, P.z, true);
    } else if (a.kind === 'elev') {
      const ph = ELEVATOR_PHASES[prog.elev.phase];
      if (!ph) return;
      for (const [item, need] of Object.entries(ph.cost)) if ((prog.elev.have[item] || 0) < need) return err(g, pid, 'Requirements not met');
      prog.elev.phase++;
      prog.elev.have = {};
      if (prog.elev.phase >= ELEVATOR_PHASES.length) {
        prog.complete = true;
        g.notify('PROJECT ASSEMBLY COMPLETE! FICSIT thanks you, Pioneers.', 'big');
      } else {
        g.notify(`Space Elevator Phase ${prog.elev.phase} delivered! ${ph.unlocksText}`, 'big');
      }
      g.sfx('milestone', P.x, P.y, P.z, true);
    }
    g.updProg();
  },

  fuse(g, pid, a, P) {
    const e = g.factory.get(a.id);
    if (!e || !e._net) return;
    g.factory.resetFuse(e);
    for (const gen of e._net.gens) g.updEnt(gen);
    g.notify('Fuse reset', 'info', pid);
  },

  shop(g, pid, a, P) {
    const it = SHOP.find(s => s.id === a.id);
    const prog = g.state.prog;
    if (!it) return;
    const bought = prog.shop[it.id] || 0;
    if (it.max && bought >= it.max) return err(g, pid, 'Already purchased');
    if (prog.sink.coupons < it.price) return err(g, pid, 'Not enough FICSIT Coupons');
    prog.sink.coupons -= it.price;
    prog.shop[it.id] = bought + 1;
    if (it.id === 'inv_upgrade') {
      prog.slots += 5;
      resizeAllInventories(g);
    } else if (it.id === 'power_shard') {
      giveOrCrate(g, pid, { power_shard: 1 }, P.x, P.y, P.z);
    } else if (it.id === 'blade_runners') {
      if (!prog.eq.includes('blade_runners')) prog.eq.push('blade_runners');
    } else if (it.id === 'coupon_smart') {
      giveOrCrate(g, pid, { smart_plating: 20 }, P.x, P.y, P.z);
    }
    g.updInv(pid);
    g.updProg();
    g.notify(`Purchased ${it.name}`, 'info', pid);
  },
};

function resizeAllInventories(g) {
  const n = playerSlotCount(g.state);
  for (const pid of Object.keys(g.state.players)) {
    resizeSlots(g.state.players[pid].inv, n);
    g.updInv(pid);
  }
}

function applyUnlocks(g, u, pid) {
  const prog = g.state.prog;
  if (!u) return;
  for (const b of u.b || []) if (!prog.b.includes(b)) prog.b.push(b);
  for (const r of u.r || []) if (!prog.r.includes(r)) prog.r.push(r);
  for (const e of u.eq || []) if (!prog.eq.includes(e)) prog.eq.push(e);
  if (u.slots) {
    prog.slots += u.slots;
    resizeAllInventories(g);
  }
  if (u.gift) giveOrCrate(g, pid, u.gift, g.state.players[pid].x, g.state.players[pid].y, g.state.players[pid].z);
}
