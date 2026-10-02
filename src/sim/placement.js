// Placement validation shared by the build gun (client preview) and the host.
import { BUILDINGS, MAX_POLE_HEIGHT } from '../data/buildings.js';
import { rotXZ } from '../core/util.js';
import { WORLD_HALF } from '../world/world.js';

export function entHeight(e, def) {
  if (def.logistic === 'pole') return e.h || 1;
  return def.size[1];
}

export function boxOf(type, x, y, z, r, h) {
  const def = BUILDINGS[type];
  const [w, hh, d] = def.size;
  return { x, z, r, hw: w / 2, hd: d / 2, y0: y, y1: y + (def.logistic === 'pole' ? (h || 1) : hh) };
}

function axes(r) {
  const c = Math.cos(r), s = Math.sin(r);
  // local x axis and z axis in world (matching rotXZ)
  return [[c, -s], [s, c]];
}

export function obbOverlap(a, b, eps = 0.05) {
  if (a.y1 - eps <= b.y0 || b.y1 - eps <= a.y0) return false;
  const A = axes(a.r), B = axes(b.r);
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const ax of [A[0], A[1], B[0], B[1]]) {
    const ra = Math.abs(A[0][0] * ax[0] + A[0][1] * ax[1]) * a.hw + Math.abs(A[1][0] * ax[0] + A[1][1] * ax[1]) * a.hd;
    const rb = Math.abs(B[0][0] * ax[0] + B[0][1] * ax[1]) * b.hw + Math.abs(B[1][0] * ax[0] + B[1][1] * ax[1]) * b.hd;
    const dist = Math.abs(dx * ax[0] + dz * ax[1]);
    if (dist >= ra + rb - eps) return false;
  }
  return true;
}

export function checkPlacement(factory, world, prog, type, x, y, z, r, opts = {}) {
  const def = BUILDINGS[type];
  if (!def || def.kind !== 'bld') return { ok: false, reason: 'Unknown building' };
  if (!opts.skipUnlock && !prog.b.includes(type)) return { ok: false, reason: 'Not unlocked yet' };
  if (Math.abs(x) > WORLD_HALF - 4 || Math.abs(z) > WORLD_HALF - 4) return { ok: false, reason: 'Out of bounds' };
  if (!isFinite(x + y + z + r)) return { ok: false, reason: 'Invalid position' };
  if (def.unique && factory.countType(type) > 0) return { ok: false, reason: `Only one ${def.name} allowed` };
  if (def.snap === 'node') {
    const node = world.nodes[opts.node];
    if (!node) return { ok: false, reason: 'Must be placed on a resource node' };
    if (factory.minerByNode.has(node.id)) return { ok: false, reason: 'Node already has a miner' };
  }
  if (def.logistic === 'pole' && (opts.h < 0.5 || opts.h > MAX_POLE_HEIGHT)) return { ok: false, reason: 'Invalid height' };
  const box = boxOf(type, x, y, z, r, opts.h);
  const near = factory.near(x, z, Math.max(box.hw, box.hd) + 12);
  for (const e of near) {
    const ed = BUILDINGS[e.type];
    if (ed.kind !== 'bld' || ed.crate) continue;
    if (opts.ignore && opts.ignore.includes(e.id)) continue;
    const eb = boxOf(e.type, e.x, e.y, e.z, e.r, e.h);
    if (obbOverlap(box, eb)) return { ok: false, reason: `Blocked by ${ed.name}` };
  }
  if (opts.players && !def.arch && !def.noCollide) {
    for (const p of opts.players) {
      const [lx, lz] = rotXZ(p.x - x, p.z - z, -r);
      if (Math.abs(lx) < box.hw - 0.2 && Math.abs(lz) < box.hd - 0.2 && p.y + 1.8 > box.y0 && p.y < box.y1) {
        return { ok: false, reason: 'A Pioneer is in the way' };
      }
    }
  }
  if (!def.arch && def.snap !== 'node') {
    // must not be buried: check footprint corners against terrain
    const [w, , d] = def.size;
    let maxBuried = 0;
    for (const [cx, cz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
      const [ox, oz] = rotXZ(cx, cz, r);
      const th = world.heightAt(x + ox, z + oz);
      maxBuried = Math.max(maxBuried, th - y);
    }
    if (maxBuried > 1.0) return { ok: false, reason: 'Terrain in the way' };
  }
  return { ok: true };
}
