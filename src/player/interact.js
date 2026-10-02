// What the player is looking at when not using the build gun: buildings to
// open, resource nodes to hand-mine and plants to harvest.
import * as THREE from 'three';
import { BUILDINGS, PURITY } from '../data/buildings.js';
import { ITEMS } from '../data/items.js';
import { RECIPES } from '../data/recipes.js';
import { FLORA, floraHarvest, floraName } from '../world/world.js';

const REACH = 8;

function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (c < 0 ? 0 : -1);
}

export class Interact {
  constructor(game) {
    this.game = game;
    this.target = null;
    this.mineTimer = 0;
    this.hold = 0;
    this.raycaster = new THREE.Raycaster();
  }

  clear() {
    this.target = null;
    this.hold = 0;
  }

  update(dt, input) {
    const g = this.game;
    if (g.build.mode) { this.clear(); return; }
    const cam = g.view.camera;
    this.raycaster.setFromCamera({ x: 0, y: 0 }, cam);
    this.raycaster.far = REACH + 2;
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    let best = null;
    const ent = g.view.pickEntity(this.raycaster, o, 14);
    if (ent && ent.dist < REACH) {
      const e = g.factory.get(ent.id);
      if (e) {
        const def = BUILDINGS[e.type];
        if (def.ui || def.kind === 'belt') best = { kind: 'ent', id: e.id, dist: ent.dist };
        else best = { kind: 'solid', dist: ent.dist };
      }
    }
    const tdist = g.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, REACH + 2);
    const limit = Math.min(best ? best.dist : REACH, tdist >= 0 ? tdist + 1.5 : REACH);
    // resource nodes
    for (const n of g.world.nodes) {
      if (Math.abs(n.x - o.x) > 14 || Math.abs(n.z - o.z) > 14) continue;
      const t = raySphere(o, d, n.x, n.y + 0.6, n.z, 2.8);
      if (t >= 0 && t < limit && (!best || t < best.dist)) best = { kind: 'node', node: n, dist: t };
    }
    // flora
    const gone = g.state.floraGone;
    g.world.floraNear(o.x, o.z, REACH, (f) => {
      if (gone.has(f.id) || f.type === FLORA.ROCK) return;
      let cy, r;
      if (f.type === FLORA.TREE) { cy = f.y + 2.2 * f.s; r = 1.4 * f.s; }
      else if (f.type === FLORA.PINE) { cy = f.y + 2.2 * f.s; r = 1.3 * f.s; }
      else if (f.type === FLORA.BUSH) { cy = f.y + 0.4 * f.s; r = 1.1 * f.s; }
      else { cy = f.y + 0.5 * f.s; r = 0.7 * f.s; }
      const t = raySphere(o, d, f.x, cy, f.z, r);
      if (t >= 0 && t < Math.min(limit, 6) && (!best || t < best.dist)) best = { kind: 'flora', flora: f, dist: t };
    });
    if (best && best.kind === 'solid') best = null;
    if (!best || !this.target || best.kind !== this.target.kind || best.id !== this.target.id || best.flora !== this.target.flora || best.node !== this.target.node) this.hold = 0;
    this.target = best;
    if (!best) return;

    if (best.kind === 'ent') {
      if (input.hit('KeyE')) {
        const e = g.factory.get(best.id);
        if (e && BUILDINGS[e.type].ui) g.ui.openEntity(best.id);
      }
    } else if (best.kind === 'node') {
      if (input.mouse.down.has(0)) {
        this.mineTimer -= dt;
        if (this.mineTimer <= 0) {
          this.mineTimer = 0.5;
          g.dispatch({ k: 'mine', node: best.node.id });
          g.audio.play('mine');
          g.ui.pickupFx(best.node.type, best.node.purity === 2 ? 2 : 1);
        }
      } else this.mineTimer = 0;
    } else if (best.kind === 'flora') {
      if (input.mouse.down.has(0)) {
        const need = best.flora.type === FLORA.TREE || best.flora.type === FLORA.PINE ? 1.2 : 0.45;
        this.hold += dt;
        if (this.hold >= need) {
          this.hold = 0;
          g.dispatch({ k: 'harvest', f: best.flora.id });
          const loot = floraHarvest(best.flora);
          if (loot) for (const [item, n] of Object.entries(loot)) g.ui.pickupFx(item, n);
        }
        this.holdNeed = need;
      } else this.hold = 0;
    }
  }

  promptHtml() {
    const t = this.target;
    const g = this.game;
    if (!t) return '';
    if (t.kind === 'ent') {
      const e = g.factory.get(t.id);
      if (!e) return '';
      const def = BUILDINGS[e.type];
      if (def.kind === 'belt') {
        return `${def.name}<span class="sub">${e.items.length} items · ${Math.round(e._len)} m</span>`;
      }
      let sub = '';
      if (def.machine) sub = e.recipe ? `Producing ${(RECIPES[e.recipe] ? RECIPES[e.recipe].name : '')}` : 'No recipe set';
      return `<span class="key">E</span>${def.name}${sub ? `<span class="sub">${sub}</span>` : ''}`;
    }
    if (t.kind === 'node') {
      const n = t.node;
      return `<span class="key">LMB</span>Mine ${ITEMS[n.type].name}<span class="sub">${PURITY[n.purity]} node · place a Miner here to automate</span>`;
    }
    if (t.kind === 'flora') {
      const loot = floraHarvest(t.flora);
      const what = loot ? Object.keys(loot).map(k => ITEMS[k].name).join(' + ') : '';
      return `<span class="key">Hold LMB</span>Harvest ${floraName(t.flora)}<span class="sub">${what}</span>`;
    }
    return '';
  }
}
