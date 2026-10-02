// The build gun: holograms, snapping, belts, power lines and dismantling.
import * as THREE from 'three';
import { BUILDINGS, MAX_POLE_HEIGHT, lengthCost } from '../data/buildings.js';
import { checkPlacement } from '../sim/placement.js';
import { computeCurve } from '../sim/factory.js';
import { hasAll, sumCosts } from '../sim/inventory.js';
import { rotXZ, toLocal, clamp } from '../core/util.js';

const RANGE = 60;
const snap = (v, s) => Math.round(v / s) * s;
const HALF_PI = Math.PI / 2;

export class BuildGun {
  constructor(game) {
    this.game = game;
    this.mode = null; // 'build' | 'dismantle'
    this.type = null;
    this.rot = 0;
    this.hOff = 0;
    this.start = null; // first endpoint for belts / wires
    this.chainAt = null;
    this.preview = null; // last computed placement
    this.info = '';
    this.raycaster = new THREE.Raycaster();
  }

  select(type) {
    const def = BUILDINGS[type];
    if (!def) return;
    this.mode = 'build';
    this.type = type;
    this.start = null;
    this.chainAt = null;
    if (def.logistic === 'pole') this.hOff = 0;
    this.game.audio && this.game.audio.play('click');
  }

  dismantle() {
    this.cancel();
    this.mode = 'dismantle';
    this.game.audio && this.game.audio.play('click');
  }

  cancel() {
    this.mode = null;
    this.type = null;
    this.start = null;
    this.chainAt = null;
    this.preview = null;
    const v = this.game.view;
    v.hideHologram();
    v.showBeltPreview(null);
    v.showWirePreview(null);
    v.showPortMarker(null);
    v.setHighlight(null);
  }

  // ---------------------------------------------------------------- raycast
  castRay() {
    const g = this.game;
    const cam = g.view.camera;
    this.raycaster.setFromCamera({ x: 0, y: 0 }, cam);
    this.raycaster.far = RANGE;
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    const ent = g.view.pickEntity(this.raycaster, o, RANGE);
    let tdist = g.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, RANGE);
    const res = { origin: o.clone(), dir: d.clone(), ent: null, point: null, normal: null, terrain: false };
    if (ent && (tdist < 0 || ent.dist <= tdist + 0.01)) {
      res.ent = g.factory.get(ent.id);
      res.point = ent.point;
      res.normal = ent.normal;
      res.dist = ent.dist;
    } else if (tdist >= 0) {
      res.point = o.clone().addScaledVector(d, tdist);
      res.normal = new THREE.Vector3(...g.world.normalAt(res.point.x, res.point.z));
      res.terrain = true;
      res.dist = tdist;
    }
    return res;
  }

  // ---------------------------------------------------------------- update
  update(dt, input) {
    const g = this.game;
    const v = g.view;
    if (!this.mode) return;
    if (input.mouse.clicked.has(2)) {
      if (this.start) { this.start = null; this.chainAt = null; g.audio.play('click'); }
      else this.cancel();
      return;
    }
    const hit = this.castRay();
    if (this.mode === 'dismantle') return this.updateDismantle(hit, input);
    const def = BUILDINGS[this.type];
    if (input.hit('KeyR')) { this.rot += def.snap === 'free' || def.snap === 'node' ? Math.PI / 4 : HALF_PI; g.audio.play('tick'); }
    if (input.mouse.wheel) {
      if (input.down('ControlLeft') || input.down('ControlRight')) this.hOff += -input.mouse.wheel * (def.logistic === 'pole' ? 0.5 : 1);
      else this.rot += input.mouse.wheel * (def.snap === 'free' || def.snap === 'node' ? Math.PI / 12 : HALF_PI);
      g.audio.play('tick');
    }
    if (input.hit('PageUp')) this.hOff += def.logistic === 'pole' ? 0.5 : 1;
    if (input.hit('PageDown')) this.hOff -= def.logistic === 'pole' ? 0.5 : 1;
    this.hOff = clamp(this.hOff, -8, 16);
    if (def.kind === 'belt') return this.updateBelt(hit, input, def);
    if (def.kind === 'wire') return this.updateWire(hit, input, def);
    v.showBeltPreview(null);
    v.showWirePreview(null);
    v.showPortMarker(null);
    const p = this.placement(hit, def);
    this.preview = p;
    if (!p) { v.hideHologram(); this.info = 'Aim at the ground'; return; }
    const prog = g.state.prog;
    const players = Object.values(g.state.players).filter(q => q.online && q.x != null);
    let chk = checkPlacement(g.factory, g.world, prog, this.type, p.x, p.y, p.z, p.r, { node: p.node, h: p.h, players });
    const afford = hasAll(g.me.inv, def.cost);
    if (chk.ok && !afford) chk = { ok: false, reason: 'Not enough resources' };
    v.showHologram(this.type, p.x, p.y, p.z, p.r, chk.ok, p.h);
    this.info = chk.ok ? '' : chk.reason;
    if (input.mouse.clicked.has(0)) {
      if (!chk.ok) { g.audio.play('error'); g.ui.toast(chk.reason, 'err'); return; }
      g.dispatch({ k: 'build', type: this.type, x: p.x, y: p.y, z: p.z, r: p.r, node: p.node, h: p.h });
    }
  }

  surfaceY(hit) {
    // top of what we hit, or terrain
    return hit.point.y;
  }

  footprintGround(def, x, z, r) {
    const w = this.game.world;
    const [sx, , sz] = def.size;
    let m = -Infinity;
    for (const [cx, cz] of [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [-sx / 2, sz / 2], [sx / 2, sz / 2], [0, 0], [0, sz / 2], [0, -sz / 2], [sx / 2, 0], [-sx / 2, 0]]) {
      const [ox, oz] = rotXZ(cx, cz, r);
      m = Math.max(m, w.heightAt(x + ox, z + oz));
    }
    return m;
  }

  placement(hit, def) {
    if (!hit.point) return null;
    const g = this.game;
    const P = hit.point;
    const hitDef = hit.ent ? BUILDINGS[hit.ent.type] : null;
    const onTop = hit.ent && hit.normal && hit.normal.y > 0.7;
    if (def.snap === 'node') {
      const node = g.world.nodeNear(P.x, P.z, 10);
      if (!node) return null;
      return { x: node.x, y: node.y, z: node.z, r: this.rot, node: node.id };
    }
    if (def.snap === 'grid8') {
      const h = def.size[1];
      const r = snap(this.rot, HALF_PI);
      if (hitDef && hitDef.snap === 'grid8') {
        const f = hit.ent;
        const fh = hitDef.size[1];
        if (onTop) {
          return { x: f.x, y: f.y + fh + this.hOff, z: f.z, r };
        }
        // side: extend outward in the foundation's frame
        const [lx, lz] = toLocal(f, P.x, P.z);
        let ox = 0, oz = 0;
        if (Math.abs(lx) > Math.abs(lz)) ox = Math.sign(lx) * 8; else oz = Math.sign(lz) * 8;
        const [wx, wz] = rotXZ(ox, oz, f.r);
        return { x: f.x + wx, y: f.y + fh - h + this.hOff, z: f.z + wz, r };
      }
      if (onTop && hit.ent) {
        return { x: snap(P.x, 8), y: P.y + this.hOff, z: snap(P.z, 8), r };
      }
      const x = snap(P.x, 8), z = snap(P.z, 8);
      // align with a neighbouring foundation if any
      for (const e of g.factory.near(x, z, 10)) {
        const ed = BUILDINGS[e.type];
        if (ed.snap !== 'grid8') continue;
        if ((Math.abs(e.x - x) < 0.1 && Math.abs(Math.abs(e.z - z) - 8) < 0.1) || (Math.abs(e.z - z) < 0.1 && Math.abs(Math.abs(e.x - x) - 8) < 0.1)) {
          return { x, y: e.y + ed.size[1] - h + this.hOff, z, r };
        }
      }
      const top = Math.round(P.y) + 1;
      return { x, y: top - h + this.hOff, z, r };
    }
    if (def.snap === 'wall') {
      if (hitDef && hitDef.snap === 'grid8' && onTop) {
        const f = hit.ent;
        const [lx, lz] = toLocal(f, P.x, P.z);
        let ang;
        if (Math.abs(lx) > Math.abs(lz)) ang = lx > 0 ? HALF_PI : -HALF_PI; else ang = lz > 0 ? 0 : Math.PI;
        ang += f.r;
        const [ox, oz] = rotXZ(0, 4 - def.size[2] / 2, ang);
        return { x: f.x + ox, y: f.y + hitDef.size[1], z: f.z + oz, r: ang };
      }
      const r = snap(this.rot, HALF_PI);
      const [ox, oz] = rotXZ(0, 4 - def.size[2] / 2, r);
      return { x: snap(P.x, 8) + ox, y: Math.round(P.y) + this.hOff, z: snap(P.z, 8) + oz, r };
    }
    // free placement
    const r = this.rot;
    let x = snap(P.x, 0.5), z = snap(P.z, 0.5);
    let y;
    if (onTop) y = P.y;
    else if (hit.terrain) y = this.footprintGround(def, x, z, r);
    else y = P.y;
    if (def.logistic === 'pole') {
      return { x, y, z, r, h: clamp(1 + this.hOff, 0.5, MAX_POLE_HEIGHT) };
    }
    if (def.pole || def.lamp) return { x, y, z, r };
    return { x, y: y + (def.arch ? this.hOff : 0), z, r };
  }

  // ---------------------------------------------------------------- belts
  findPort(point, want, exclude) {
    const f = this.game.factory;
    let best = null, bd = 2.6 * 2.6;
    for (const e of f.near(point.x, point.z, 6)) {
      const def = BUILDINGS[e.type];
      if (def.kind !== 'bld' || !def.ports.length) continue;
      for (let i = 0; i < def.ports.length; i++) {
        if (def.ports[i].t !== want || e._links[i]) continue;
        if (exclude && exclude.b === e.id) continue;
        const p = f.portWorld(e, i);
        const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 * 0.5 + (p.z - point.z) ** 2;
        if (d < bd) { bd = d; best = { b: e.id, p: i, pos: p }; }
      }
    }
    return best;
  }

  groundPoint(hit) {
    const def = hit.ent ? BUILDINGS[hit.ent.type] : null;
    if (hit.terrain || (hit.normal && hit.normal.y > 0.7 && def && def.kind === 'bld')) return hit.point;
    return null;
  }

  updateBelt(hit, input, def) {
    const g = this.game, v = g.view, f = g.factory;
    v.hideHologram();
    v.showWirePreview(null);
    const pt = hit.point;
    if (!this.start && this.chainAt) {
      const port = this.findPort(this.chainAt, 'out');
      if (port && Math.hypot(port.pos.x - this.chainAt.x, port.pos.z - this.chainAt.z) < 0.6) {
        this.start = { b: port.b, p: port.p, pos: port.pos };
        this.chainAt = null;
      }
    }
    if (!pt) { v.showBeltPreview(null); v.showPortMarker(null); this.info = 'Aim at a conveyor port or the ground'; return; }
    const poleH = clamp(1 + this.hOff, 0.5, MAX_POLE_HEIGHT);
    if (!this.start) {
      v.showBeltPreview(null);
      const port = this.findPort(pt, 'out');
      if (port) {
        v.showPortMarker(port.pos);
        this.info = 'Click to start conveyor at output';
        if (input.mouse.clicked.has(0)) { this.start = { b: port.b, p: port.p, pos: port.pos }; g.audio.play('tick'); }
        return;
      }
      const gp = this.groundPoint(hit);
      v.showPortMarker(null);
      if (!gp) { this.info = 'Aim at an output port or the ground'; return; }
      const x = snap(gp.x, 0.5), z = snap(gp.z, 0.5);
      v.showHologram('conveyor_pole', x, gp.y, z, this.rot, true, poleH);
      this.info = 'Click to start conveyor (places a Conveyor Pole)';
      if (input.mouse.clicked.has(0)) {
        this.start = { pole: { x, y: gp.y, z, h: poleH }, pos: { x, y: gp.y + poleH, z, dx: 0, dz: 1 } };
        g.audio.play('tick');
      }
      return;
    }
    // second endpoint
    const startPos = this.start.pos;
    let end, endPos, endDir;
    const port = this.findPort(pt, 'in', this.start.b != null ? this.start : null);
    if (port) {
      end = { b: port.b, p: port.p };
      endPos = port.pos;
      endDir = [-port.pos.dx, -port.pos.dz];
      v.showPortMarker(port.pos);
      v.hideHologram();
    } else {
      v.showPortMarker(null);
      const gp = this.groundPoint(hit) || pt;
      const x = snap(gp.x, 0.5), z = snap(gp.z, 0.5);
      const dx = x - startPos.x, dz = z - startPos.z;
      const l = Math.hypot(dx, dz) || 1;
      const r = Math.atan2(dx / l, dz / l);
      end = { x, y: gp.y, z, r, h: poleH };
      endPos = { x, y: gp.y + poleH, z };
      endDir = [Math.sin(r), Math.cos(r)];
      v.showHologram('conveyor_pole', x, gp.y, z, r, true, poleH);
    }
    let startDir;
    let startEp;
    if (this.start.pole) {
      const dx = endPos.x - startPos.x, dz = endPos.z - startPos.z;
      const l = Math.hypot(dx, dz) || 1;
      const r = Math.atan2(dx / l, dz / l);
      startDir = [Math.sin(r), Math.cos(r)];
      startEp = { ...this.start.pole, r };
    } else {
      startDir = [startPos.dx, startPos.dz];
      startEp = { b: this.start.b, p: this.start.p };
    }
    const curve = computeCurve([startPos.x, startPos.y, startPos.z], startDir, [endPos.x, endPos.y, endPos.z], endDir);
    let cost = lengthCost(def, curve.len);
    if (this.start.pole) cost = sumCosts(cost, BUILDINGS.conveyor_pole.cost);
    if (!end.b && end.b !== 0) cost = sumCosts(cost, BUILDINGS.conveyor_pole.cost);
    let ok = true, reason = '';
    if (curve.len < 0.5) { ok = false; reason = 'Too short'; }
    else if (curve.len > def.maxLen) { ok = false; reason = `Too long (max ${def.maxLen} m)`; }
    else if (!hasAll(g.me.inv, cost)) { ok = false; reason = 'Not enough resources'; }
    else if (end.b == null && !g.state.prog.b.includes('conveyor_pole')) { ok = false; reason = 'Conveyor Pole not unlocked'; }
    v.showBeltPreview(curve, ok);
    this.info = ok ? `Length ${curve.len.toFixed(1)} m` : reason;
    this.costPreview = cost;
    if (input.mouse.clicked.has(0)) {
      if (!ok) { g.audio.play('error'); g.ui.toast(reason, 'err'); return; }
      g.dispatch({ k: 'belt', type: this.type, a: startEp, b: end });
      if (end.b == null) this.chainAt = { x: end.x, y: end.y + end.h, z: end.z };
      this.start = null;
    }
  }

  // ---------------------------------------------------------------- power lines
  // highest-tier pole that is unlocked and affordable (falls back to Mk.1)
  bestPole() {
    const b = this.game.state.prog.b;
    const inv = this.game.me.inv;
    for (const t of ['power_pole_mk3', 'power_pole_mk2', 'power_pole_mk1']) {
      if (b.includes(t) && hasAll(inv, sumCosts(BUILDINGS[t].cost, BUILDINGS[t].cost))) return t;
    }
    return 'power_pole_mk1';
  }

  updateWire(hit, input, def) {
    const g = this.game, v = g.view, f = g.factory;
    v.hideHologram();
    v.showBeltPreview(null);
    v.showPortMarker(null);
    if (!this.start && this.chainAt) {
      for (const e of f.near(this.chainAt.x, this.chainAt.z, 2)) {
        if (BUILDINGS[e.type].pole && Math.hypot(e.x - this.chainAt.x, e.z - this.chainAt.z) < 0.3) {
          this.start = { id: e.id, pos: f.connWorld(e) };
          this.chainAt = null;
          break;
        }
      }
    }
    if (!hit.point) { v.showWirePreview(null); this.info = 'Aim at a building or the ground'; return; }
    const poleType = this.bestPole();
    let ep, pos;
    if (hit.ent && f.maxConns(hit.ent)) {
      ep = { id: hit.ent.id };
      pos = f.connWorld(hit.ent);
      const used = hit.ent._wires.size, max = f.maxConns(hit.ent);
      this.info = `${BUILDINGS[hit.ent.type].name} — connections ${used}/${max}`;
    } else {
      const gp = this.groundPoint(hit);
      if (!gp) { v.showWirePreview(null); this.info = 'Aim at a building or the ground'; return; }
      const x = snap(gp.x, 0.5), z = snap(gp.z, 0.5);
      ep = { x, y: gp.y, z };
      const pd = BUILDINGS[poleType];
      pos = { x, y: gp.y + pd.conn[1], z };
      v.showHologram(poleType, x, gp.y, z, 0, true);
      this.info = `Place ${pd.name}`;
    }
    if (!this.start) {
      v.showWirePreview(null);
      if (input.mouse.clicked.has(0)) {
        if (ep.id != null) {
          const e = f.get(ep.id);
          if (e._wires.size >= f.maxConns(e)) { g.ui.toast('No free connections', 'err'); g.audio.play('error'); return; }
          this.start = { id: ep.id, pos };
        } else {
          this.start = { pole: ep, pos };
        }
        g.audio.play('tick');
      }
      return;
    }
    const sp = this.start.pos;
    const len = Math.hypot(pos.x - sp.x, pos.y - sp.y, pos.z - sp.z);
    let cost = lengthCost(def, len);
    if (this.start.pole) cost = sumCosts(cost, BUILDINGS[poleType].cost);
    if (ep.id == null) cost = sumCosts(cost, BUILDINGS[poleType].cost);
    let ok = true, reason = '';
    if (len > def.maxLen) { ok = false; reason = `Too long (max ${def.maxLen} m)`; }
    else if (ep.id != null && ep.id === this.start.id) { ok = false; reason = 'Same building'; }
    else if (!hasAll(g.me.inv, cost)) { ok = false; reason = 'Not enough resources'; }
    v.showWirePreview(sp, pos, ok);
    this.info = ok ? `Power Line ${len.toFixed(1)} m` : reason;
    this.costPreview = cost;
    if (input.mouse.clicked.has(0)) {
      if (!ok) { g.audio.play('error'); g.ui.toast(reason, 'err'); return; }
      const a = this.start.id != null ? { id: this.start.id } : this.start.pole;
      g.dispatch({ k: 'wire', a, b: ep, pole: poleType });
      if (ep.id == null) this.chainAt = { x: ep.x, z: ep.z };
      else if (BUILDINGS[f.get(ep.id).type].pole) this.chainAt = { x: f.get(ep.id).x, z: f.get(ep.id).z };
      this.start = null;
    }
  }

  // ---------------------------------------------------------------- dismantle
  updateDismantle(hit, input) {
    const g = this.game;
    const e = hit.ent;
    g.view.setHighlight(e ? e.id : null);
    this.target = e;
    this.info = e ? `Dismantle ${BUILDINGS[e.type].name}` : 'Aim at something to dismantle';
    if (e && input.mouse.clicked.has(0)) {
      g.view.setHighlight(null);
      g.dispatch({ k: 'dismantle', id: e.id });
    }
  }
}
