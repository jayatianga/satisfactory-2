// Deterministic world generation from a seed: heightmap, resource nodes and
// flora. Host and clients generate the identical world from the same seed.
import { createNoise2D, fbm, ridged, mulberry32, smoothstep, lerp, clamp } from '../core/util.js';

export const WORLD_HALF = 512;
export const CELL = 2;
export const GRID = (WORLD_HALF * 2) / CELL; // cells per side
export const WATER_LEVEL = 1.5;

export const NODE_TYPES = {
  iron_ore: { color: '#8c5b4a', glow: '#d08a6a' },
  copper_ore: { color: '#b8673a', glow: '#46c4b4' },
  limestone: { color: '#d4ccb6', glow: '#ffffff' },
  coal: { color: '#2b2b2e', glow: '#6b6b78' },
  caterium_ore: { color: '#d9b23a', glow: '#fff09a' },
  raw_quartz: { color: '#e48ad6', glow: '#ffd8f7' },
  sulfur: { color: '#e2d43a', glow: '#fff59a' },
};

// flora types
export const FLORA = { TREE: 0, PINE: 1, BUSH: 2, MUSHROOM: 3, ROCK: 4 };

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.n1 = createNoise2D(this.seed);
    this.n2 = createNoise2D(this.seed + 1013);
    this.n3 = createNoise2D(this.seed + 7919);
    this.n4 = createNoise2D(this.seed + 31337);
    const N = GRID + 1;
    this.N = N;
    this.heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + i * CELL;
        const z = -WORLD_HALF + j * CELL;
        this.heights[j * N + i] = this.rawHeight(x, z);
      }
    }
    this.spawnAngle = mulberry32(this.seed ^ 0xabc)() * Math.PI * 2;
    this.nodes = this.genNodes();
    this.flattenNodes();
    this.flora = this.genFlora();
    this.buildFloraGrid();
  }

  rawHeight(x, z) {
    const s = 1;
    const base = fbm(this.n1, x * 0.0022 * s, z * 0.0022 * s, 5);
    const mountainMask = smoothstep(0.05, 0.55, fbm(this.n2, x * 0.0016 + 40, z * 0.0016 - 70, 3));
    const ridge = ridged(this.n3, x * 0.005, z * 0.005, 4);
    const detail = fbm(this.n4, x * 0.025, z * 0.025, 3);
    let h = 9 + base * 13 + ridge * ridge * mountainMask * 70 + detail * 1.2;
    // gentle plateau around spawn
    const r = Math.sqrt(x * x + z * z);
    const f = smoothstep(55, 150, r);
    h = lerp(9 + detail * 0.6 + base * 2, h, f);
    // rising cliffs at the map edge
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(420, 500, e) * (55 + ridge * 40);
    return h;
  }

  // Exact height on the rendered triangle mesh.
  heightAt(x, z) {
    const fx = (x + WORLD_HALF) / CELL;
    const fz = (z + WORLD_HALF) / CELL;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0) i = 0; if (j < 0) j = 0;
    if (i > GRID - 1) i = GRID - 1; if (j > GRID - 1) j = GRID - 1;
    const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
    const N = this.N, H = this.heights;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  slopeAt(x, z) {
    const e = 1.5;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  normalAt(x, z) {
    const e = 1;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  // March a ray against the heightmap. Returns distance or -1.
  raycast(ox, oy, oz, dx, dy, dz, maxDist = 400) {
    let t = 0, step = 0.5;
    let prevT = 0;
    let above = oy - this.heightAt(ox, oz);
    if (above < 0) return 0;
    while (t < maxDist) {
      t += step;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (Math.abs(x) > WORLD_HALF || Math.abs(z) > WORLD_HALF) return -1;
      const d = y - this.heightAt(x, z);
      if (d <= 0) {
        // bisect
        let a = prevT, b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          const mx = ox + dx * m, my = oy + dy * m, mz = oz + dz * m;
          if (my - this.heightAt(mx, mz) > 0) a = m; else b = m;
        }
        return (a + b) / 2;
      }
      prevT = t;
      step = clamp(d * 0.5, 0.25, 4);
    }
    return -1;
  }

  inBounds(x, z, margin = 0) {
    return Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin;
  }

  genNodes() {
    const rand = mulberry32(this.seed ^ 0x5eed);
    const nodes = [];
    const add = (type, x, z, purity) => {
      nodes.push({ id: nodes.length, type, x, z, y: this.heightAt(x, z), purity });
    };
    const okSpot = (x, z, minGap) => {
      if (!this.inBounds(x, z, 40)) return false;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 1.2) return false;
      if (this.slopeAt(x, z) > 0.45) return false;
      for (const n of nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < minGap * minGap) return false;
      return true;
    };
    // Guaranteed starter nodes around spawn
    const a = this.spawnAngle;
    const starters = [
      ['iron_ore', 32, 0, 2], ['iron_ore', 46, 2.1, 1], ['copper_ore', 44, 1.0, 1],
      ['limestone', 40, 3.6, 1], ['iron_ore', 70, 4.6, 1], ['copper_ore', 85, 5.4, 2], ['limestone', 90, 1.6, 2],
    ];
    for (const [type, r, ang, pur] of starters) {
      let placed = false;
      for (let tries = 0; tries < 40 && !placed; tries++) {
        const rr = r + tries * 1.5, aa = a + ang + (tries % 2 ? 0.1 : -0.1) * tries;
        const x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
        if (okSpot(x, z, 16)) { add(type, x, z, pur); placed = true; }
      }
    }
    // Scattered nodes, rarer resources further out
    const table = [
      { type: 'iron_ore', min: 60, w: 5 },
      { type: 'copper_ore', min: 60, w: 3.5 },
      { type: 'limestone', min: 60, w: 3 },
      { type: 'coal', min: 110, w: 3 },
      { type: 'caterium_ore', min: 180, w: 1.6 },
      { type: 'raw_quartz', min: 180, w: 1.5 },
      { type: 'sulfur', min: 220, w: 1.3 },
    ];
    let attempts = 0;
    while (nodes.length < 95 && attempts < 6000) {
      attempts++;
      const x = (rand() * 2 - 1) * (WORLD_HALF - 50);
      const z = (rand() * 2 - 1) * (WORLD_HALF - 50);
      const r = Math.hypot(x, z);
      if (r < 60) continue;
      if (!okSpot(x, z, 24)) continue;
      const opts = table.filter(t => r >= t.min);
      const tot = opts.reduce((s, t) => s + t.w, 0);
      let pick = rand() * tot, chosen = opts[0];
      for (const o of opts) { pick -= o.w; if (pick <= 0) { chosen = o; break; } }
      const pr = rand();
      const purity = pr < 0.35 ? 0 : pr < 0.8 ? 1 : 2;
      add(chosen.type, x, z, purity);
    }
    // Make sure every rare type exists at least twice
    for (const t of table) {
      let count = nodes.filter(n => n.type === t.type).length;
      let guard = 0;
      while (count < 2 && guard++ < 3000) {
        const ang = rand() * Math.PI * 2, r = t.min + 30 + rand() * 200;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        if (okSpot(x, z, 20)) { add(t.type, x, z, 1); count++; }
      }
    }
    return nodes;
  }

  // Flatten terrain slightly around nodes so miners sit nicely.
  flattenNodes() {
    const N = this.N;
    for (const n of this.nodes) {
      const R = 7;
      const i0 = Math.floor((n.x - R + WORLD_HALF) / CELL), i1 = Math.ceil((n.x + R + WORLD_HALF) / CELL);
      const j0 = Math.floor((n.z - R + WORLD_HALF) / CELL), j1 = Math.ceil((n.z + R + WORLD_HALF) / CELL);
      const target = n.y;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const x = -WORLD_HALF + i * CELL, z = -WORLD_HALF + j * CELL;
        const d = Math.hypot(x - n.x, z - n.z);
        const f = 1 - smoothstep(3, R, d);
        const k = j * N + i;
        this.heights[k] = lerp(this.heights[k], target, f);
      }
      n.y = this.heightAt(n.x, n.z);
    }
  }

  genFlora() {
    const rand = mulberry32(this.seed ^ 0xf10a);
    const forest = createNoise2D(this.seed + 555);
    const list = [];
    const nearNode = (x, z, r) => {
      for (const n of this.nodes) if ((n.x - x) ** 2 + (n.z - z) ** 2 < r * r) return true;
      return false;
    };
    const target = 9000;
    let tries = 0;
    while (list.length < target && tries < target * 4) {
      tries++;
      const x = (rand() * 2 - 1) * (WORLD_HALF - 8);
      const z = (rand() * 2 - 1) * (WORLD_HALF - 8);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.3) continue;
      const slope = this.slopeAt(x, z);
      const r = Math.hypot(x, z);
      const dens = fbm(forest, x * 0.008, z * 0.008, 3);
      const roll = rand();
      let type;
      if (slope > 0.7) {
        if (roll < 0.15) type = FLORA.ROCK; else continue;
      } else if (dens > 0.12) {
        type = roll < 0.45 ? FLORA.TREE : roll < 0.7 ? FLORA.PINE : roll < 0.93 ? FLORA.BUSH : roll < 0.97 ? FLORA.MUSHROOM : FLORA.ROCK;
      } else if (dens > -0.15) {
        if (roll < 0.35) continue;
        type = roll < 0.5 ? FLORA.TREE : roll < 0.6 ? FLORA.PINE : roll < 0.9 ? FLORA.BUSH : roll < 0.94 ? FLORA.MUSHROOM : FLORA.ROCK;
      } else {
        if (roll < 0.75) continue;
        type = roll < 0.85 ? FLORA.BUSH : roll < 0.93 ? FLORA.ROCK : roll < 0.97 ? FLORA.TREE : FLORA.MUSHROOM;
      }
      if (type === FLORA.MUSHROOM && h > 40) continue;
      // keep the landing zone open
      if (r < 26 && type !== FLORA.BUSH) continue;
      if (r < 14) continue;
      if (nearNode(x, z, type === FLORA.BUSH ? 6 : 9)) continue;
      const scale = type === FLORA.ROCK ? 0.6 + rand() * 1.8 : 0.75 + rand() * 0.6;
      list.push({ id: list.length, type, x, y: h, z, s: scale, rot: rand() * Math.PI * 2, c: rand() });
    }
    return list;
  }

  buildFloraGrid() {
    this.floraGrid = new Map();
    for (const f of this.flora) {
      const k = this.cellKey(f.x, f.z);
      let arr = this.floraGrid.get(k);
      if (!arr) { arr = []; this.floraGrid.set(k, arr); }
      arr.push(f);
    }
  }

  cellKey(x, z) {
    return (Math.floor(x / 16) + 1000) * 4096 + (Math.floor(z / 16) + 1000);
  }

  floraNear(x, z, r, cb) {
    const c0 = Math.floor((x - r) / 16), c1 = Math.floor((x + r) / 16);
    const d0 = Math.floor((z - r) / 16), d1 = Math.floor((z + r) / 16);
    for (let ci = c0; ci <= c1; ci++) for (let di = d0; di <= d1; di++) {
      const arr = this.floraGrid.get((ci + 1000) * 4096 + (di + 1000));
      if (!arr) continue;
      for (const f of arr) cb(f);
    }
  }

  nodeNear(x, z, r) {
    let best = null, bd = r * r;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}

export function floraRadius(f) {
  switch (f.type) {
    case FLORA.TREE: return 0.45 * f.s;
    case FLORA.PINE: return 0.4 * f.s;
    case FLORA.ROCK: return 0.9 * f.s;
    default: return 0;
  }
}

export function floraHarvest(f) {
  switch (f.type) {
    case FLORA.TREE: return { wood: 8, leaves: 6 };
    case FLORA.PINE: return { wood: 10, leaves: 3 };
    case FLORA.BUSH: return { leaves: 12 };
    case FLORA.MUSHROOM: return { mycelia: 3 };
    default: return null;
  }
}

export function floraName(f) {
  return ['Tree', 'Pine Tree', 'Leafy Bush', 'Mycelia Shroom', 'Rock'][f.type];
}
