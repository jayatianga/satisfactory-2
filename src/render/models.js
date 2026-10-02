// Procedural building models. Each building type is built once from
// primitives, merged per material, and cloned per instance.
import * as THREE from 'three';
import { BufferGeometryUtils } from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { makeConcreteTexture, makeHazardTexture, makeMetalTexture, makeScreenTexture, makeLogoTexture } from './textures.js';

let M = null;

export function materials() {
  if (M) return M;
  const metal = makeMetalTexture('#ffffff');
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const concrete = makeConcreteTexture();
  M = {
    orange: std({ color: '#e8862a', metalness: 0.35, roughness: 0.5, map: metal }),
    steel: std({ color: '#7c848c', metalness: 0.75, roughness: 0.38, map: metal }),
    dark: std({ color: '#3a3e44', metalness: 0.6, roughness: 0.55, map: metal }),
    light: std({ color: '#c9ccd0', metalness: 0.3, roughness: 0.55, map: metal }),
    white: std({ color: '#eef0f2', metalness: 0.15, roughness: 0.6 }),
    concrete: std({ color: '#ffffff', metalness: 0.0, roughness: 0.92, map: concrete }),
    concSide: std({ color: '#8f8c86', metalness: 0.0, roughness: 0.95 }),
    hazard: std({ color: '#ffffff', metalness: 0.2, roughness: 0.6, map: makeHazardTexture() }),
    glass: std({ color: '#9fd8ff', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
    glow: std({ color: '#ff7a1a', emissive: '#ff6a00', emissiveIntensity: 2.2, roughness: 0.6 }),
    screen: std({ color: '#0a1a20', emissive: '#ffffff', emissiveMap: makeScreenTexture('FICSIT'), emissiveIntensity: 1.3, map: makeScreenTexture('FICSIT') }),
    cyan: std({ color: '#0c2a33', emissive: '#3cc6e8', emissiveIntensity: 1.6 }),
    rubber: std({ color: '#1d1e20', metalness: 0.1, roughness: 0.92 }),
    copper: std({ color: '#c27a45', metalness: 0.85, roughness: 0.35 }),
    logo: std({ color: '#ffffff', metalness: 0.3, roughness: 0.5, map: makeLogoTexture() }),
    portIn: std({ color: '#402010', emissive: '#ff8a2a', emissiveIntensity: 1.4 }),
    portOut: std({ color: '#103010', emissive: '#4cff6a', emissiveIntensity: 1.2 }),
    lampOn: std({ color: '#fff4d0', emissive: '#ffe6a0', emissiveIntensity: 3 }),
    lampOff: std({ color: '#777' }),
    sinkGlow: std({ color: '#200a40', emissive: '#a24cff', emissiveIntensity: 2.2, side: THREE.DoubleSide }),
    st_work: new THREE.MeshBasicMaterial({ color: '#46ff6e' }),
    st_idle: new THREE.MeshBasicMaterial({ color: '#ffd23c' }),
    st_off: new THREE.MeshBasicMaterial({ color: '#ff3c3c' }),
    st_none: new THREE.MeshBasicMaterial({ color: '#6b7078' }),
    wire: std({ color: '#1b1b1b', roughness: 0.8 }),
    tints: Object.create(null),
  };
  return M;
}

export function tintMaterial(color) {
  const m = materials();
  if (!m.tints[color]) {
    m.tints[color] = m.orange.clone();
    m.tints[color].color = new THREE.Color(color);
  }
  return m.tints[color];
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: (seg) => new THREE.CylinderGeometry(1, 1, 1, seg),
};
const cylCache = Object.create(null);
function cylGeo(rt, rb, seg) {
  const k = `${rt}_${rb}_${seg}`;
  if (!cylCache[k]) cylCache[k] = new THREE.CylinderGeometry(rt, rb, 1, seg);
  return cylCache[k];
}

export function wedgeGeometry(w, h, d) {
  // rises from y=0 at z=-d/2 to y=h at z=+d/2
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, h, z1, x0, h, z1], 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  top.setIndex([0, 3, 2, 0, 2, 1]);
  top.computeVertexNormals();
  const pos = [], uv = [], idx = [];
  const quad = (a, b, c, d2) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d2);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const tri = (a, b, c) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c);
    uv.push(0, 0, 1, 0, 1, 1);
    idx.push(i, i + 1, i + 2);
  };
  quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]); // front
  quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]); // bottom
  tri([x0, 0, z0], [x0, h, z1], [x0, 0, z1]); // left
  tri([x1, 0, z0], [x1, 0, z1], [x1, h, z1]); // right
  const rest = new THREE.BufferGeometry();
  rest.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rest.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rest.setIndex(idx);
  rest.computeVertexNormals();
  return { top, rest };
}

class Builder {
  constructor() {
    this.parts = new Map();
    this.extra = [];
  }
  add(mat, geo, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = geo.clone();
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
    g.applyMatrix4(_m4);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  // box centred at x,y,z
  box(mat, w, h, d, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    return this.add(mat, GEO.box, x, y, z, w, h, d, rx, ry, rz);
  }
  // box from y0 up with height h
  slab(mat, w, h, d, x, y0, z, ry = 0) {
    return this.box(mat, w, h, d, x, y0 + h / 2, z, ry);
  }
  cyl(mat, r, h, x, y, z, seg = 16, rx = 0, rz = 0, rTop = null) {
    const geo = cylGeo(rTop == null ? 1 : rTop / r, 1, seg);
    return this.add(mat, geo, x, y, z, r, h, r, rx, 0, rz);
  }
  cone(mat, r, h, x, y, z, seg = 16, flip = false) {
    const geo = cylGeo(flip ? 1 : 0.001, flip ? 0.001 : 1, seg);
    return this.add(mat, geo, x, y, z, r, h, r);
  }
  // named separately-transformable sub-object (for animation)
  named(name, fn) {
    const sub = new Builder();
    fn(sub);
    const grp = sub.build();
    grp.name = name;
    this.extra.push(grp);
    return grp;
  }
  build() {
    const g = new THREE.Group();
    const mats = materials();
    for (const [key, list] of this.parts) {
      const mat = typeof key === 'string' ? mats[key] : key;
      const geo = list.length === 1 ? list[0] : BufferGeometryUtils.mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mat !== mats.glass;
      mesh.receiveShadow = true;
      mesh.userData.matKey = typeof key === 'string' ? key : 'custom';
      g.add(mesh);
    }
    for (const x of this.extra) g.add(x);
    return g;
  }
}

function addPorts(b, def) {
  for (const p of def.ports) {
    const ry = Math.atan2(p.dx, p.dz);
    const ox = p.x - p.dx * 0.12, oz = p.z - p.dz * 0.12;
    b.box('dark', 1.7, 1.25, 0.24, ox, p.y + 0.2, oz, ry);
    b.box(p.t === 'in' ? 'portIn' : 'portOut', 1.1, 0.12, 0.26, ox, p.y + 0.86, oz, ry);
  }
}

function statusLight(b, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), materials().st_none);
  m.position.set(x, y, z);
  m.name = 'status';
  b.extra.push(m);
}

const BUILDERS = {
  hub(b) {
    b.slab('dark', 10, 0.4, 8, 0, 0, 0);
    b.box('hazard', 10, 0.12, 0.08, 0, 0.3, 4.0);
    b.slab('light', 6, 3.2, 4.4, -1.5, 0.4, -1.4);
    b.slab('orange', 6.2, 0.5, 4.6, -1.5, 3.6, -1.4);
    b.box('logo', 3, 0.75, 0.06, -1.5, 2.4, 0.83);
    b.slab('orange', 3, 2.6, 3, 3, 0.4, -2);
    b.box('glass', 2.6, 1.0, 0.08, 3, 2.2, -0.48);
    b.cyl('steel', 0.18, 9, -3.9, 4.1 + 4.5, -3.2, 8);
    b.cone('light', 1.4, 0.6, -3.9, 8.6, -3.2, 16, true);
    b.cyl('glow', 0.12, 0.3, -3.9, 13.2, -3.2, 8);
    // terminal
    b.slab('dark', 1.2, 1.7, 0.7, -2.2, 0.4, 2.4);
    b.box('screen', 1.0, 0.7, 0.05, -2.2, 1.65, 2.77);
    // craft bench
    b.slab('steel', 2.6, 0.15, 1.2, 2.2, 1.05, 2.4);
    for (const [x, z] of [[1.05, 1.9], [3.35, 1.9], [1.05, 2.9], [3.35, 2.9]]) b.slab('dark', 0.15, 0.65, 0.15, x, 0.4, z);
    b.slab('orange', 0.5, 0.4, 0.5, 2.9, 1.2, 2.4);
    b.box('cyan', 0.6, 0.35, 0.04, 1.6, 1.45, 2.95);
  },
  craft_bench(b) {
    b.slab('steel', 3, 0.15, 2, 0, 0.95, 0);
    for (const [x, z] of [[-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85]]) b.slab('dark', 0.15, 0.95, 0.15, x, 0, z);
    b.slab('orange', 0.6, 0.45, 0.5, 0.9, 1.1, 0);
    b.slab('dark', 0.8, 0.5, 0.1, -0.6, 1.1, -0.8);
    b.box('cyan', 0.6, 0.3, 0.04, -0.6, 1.4, -0.74);
  },
  mam(b) {
    b.slab('dark', 6, 0.3, 5, 0, 0, 0);
    b.slab('light', 4, 1.0, 2, 0, 0.3, -0.8);
    b.slab('orange', 4.2, 0.1, 2.2, 0, 1.3, -0.8);
    b.slab('orange', 0.4, 2.6, 0.4, -2.4, 0.3, 1);
    b.slab('orange', 0.4, 2.6, 0.4, 2.4, 0.3, 1);
    b.slab('orange', 5.2, 0.4, 0.4, 0, 2.6, 1);
    b.cyl('glass', 0.8, 1.4, 0, 1.4 + 0.7, -0.8, 16);
    b.cyl('cyan', 0.3, 1.0, 0, 1.4 + 0.5, -0.8, 12);
    b.box('screen', 1.4, 0.8, 0.05, 1.5, 1.9, -1.75);
  },
  space_elevator(b) {
    b.slab('concrete', 22, 4, 22, 0, 0, 0);
    b.box('hazard', 22.1, 0.3, 22.1, 0, 3.6, 0);
    b.cyl('orange', 8, 1, 0, 4.5, 0, 32);
    b.slab('light', 8, 26, 8, 0, 4, 0);
    for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.slab('orange', 1.2, 28, 1.2, x, 4, z);
    for (let y = 8; y < 30; y += 5) b.slab('dark', 8.6, 0.5, 8.6, 0, y, 0);
    b.cone('steel', 4.4, 4, 0, 32, 0, 24);
    b.cyl('glow', 0.4, 2, 0, 35, 0, 8);
    b.box('logo', 6, 1.5, 0.1, 0, 20, 4.06);
    b.box('screen', 3, 1.6, 0.1, 6, 5.2, 9);
  },
  awesome_sink(b) {
    b.slab('dark', 10, 6, 10, 0, 0, 0);
    b.box('hazard', 10.05, 0.4, 10.05, 0, 5.6, 0);
    b.cyl('steel', 3.4, 3, 0, 7.5, 0, 24, 0, 0, 5);
    b.slab('orange', 1.2, 6, 10.2, -4.4, 0, 0);
    b.slab('orange', 1.2, 6, 10.2, 4.4, 0, 0);
    b.named('swirl', (s) => {
      s.add('sinkGlow', new THREE.TorusGeometry(2.2, 0.25, 8, 32), 0, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0);
      s.add('sinkGlow', new THREE.TorusGeometry(1.2, 0.2, 8, 24), 0, -0.6, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    }).position.set(0, 8.4, 0);
    b.box('screen', 3, 1.6, 0.1, 0, 3.4, 5.06);
  },
  miner_mk1(b) {
    for (const [x, z] of [[-2.6, -4.4], [2.6, -4.4], [-2.6, 4.4], [2.6, 4.4]]) b.box('dark', 0.6, 5, 0.6, x, -1.5, z);
    b.slab('steel', 6, 1.0, 10, 0, 0.5, 0);
    b.box('hazard', 6.05, 0.25, 10.05, 0, 1.1, 0);
    b.slab('orange', 3.2, 5, 3.2, 0, 1.5, 0);
    b.slab('steel', 2.2, 3, 2.2, 0, 6.5, 0);
    b.slab('dark', 2.6, 0.4, 2.6, 0, 9.5, 0);
    b.slab('light', 2.6, 2.2, 2.2, 0, 1.5, -3.5);
    b.slab('dark', 1.6, 1.1, 3, 0, 0.6, 3.4);
    b.cyl('copper', 0.2, 4, 1.4, 3.5, -3.5, 8);
    b.named('drill', (s) => {
      s.cyl('steel', 0.9, 1.6, 0, 0, 0, 12);
      s.cone('dark', 0.9, 1.6, 0, -1.6, 0, 12, true);
      s.box('orange', 2.0, 0.3, 0.3, 0, 0.2, 0);
    }).position.set(0, 0.2, 0);
    statusLight(b, 1.7, 6.2, 1.7);
  },
  smelter(b) {
    b.slab('dark', 6, 0.6, 9, 0, 0, 0);
    b.slab('orange', 4.6, 4.2, 5.2, 0, 0.6, -0.5);
    b.slab('dark', 4.8, 0.3, 5.4, 0, 4.8, -0.5);
    b.box('glow', 2.2, 1.1, 0.12, 0, 2.4, 2.12);
    b.cyl('steel', 0.8, 2.6, 1.1, 5.1 + 1.3, -1.6, 12);
    b.cyl('dark', 0.9, 0.3, 1.1, 7.6, -1.6, 12);
    b.slab('steel', 2.6, 1.8, 1.6, 0, 0.6, -3.7);
    b.slab('steel', 2.0, 0.6, 1.6, 0, 0.6, 3.5);
    b.cyl('copper', 0.18, 3.6, -1.8, 2.6, 2.3, 8);
    b.box('screen', 1.0, 0.6, 0.05, 1.6, 3.6, 2.13);
    statusLight(b, -2.0, 4.6, 2.2);
  },
  constructor(b) {
    b.slab('dark', 8, 0.6, 10, 0, 0, 0);
    for (const [x, z] of [[-3.4, -4.4], [3.4, -4.4], [-3.4, 4.4], [3.4, 4.4]]) b.slab('orange', 0.6, 6.2, 0.6, x, 0.6, z);
    b.box('orange', 7.4, 0.6, 0.6, 0, 6.5, -4.4);
    b.box('orange', 7.4, 0.6, 0.6, 0, 6.5, 4.4);
    b.box('orange', 0.6, 0.6, 9.4, -3.4, 6.5, 0);
    b.box('orange', 0.6, 0.6, 9.4, 3.4, 6.5, 0);
    b.slab('light', 4.2, 3.2, 5.4, 0, 0.6, 0);
    b.box('glass', 3.6, 1.6, 0.1, 0, 2.6, 2.75);
    b.slab('dark', 4.4, 0.3, 5.6, 0, 3.8, 0);
    b.slab('steel', 2.2, 0.7, 2.2, 0, 0.6, -3.6);
    b.slab('steel', 2.2, 0.7, 2.2, 0, 0.6, 3.6);
    b.box('screen', 1.2, 0.7, 0.05, 2.6, 2.0, 2.75);
    b.named('arm', (s) => {
      s.box('steel', 0.9, 0.5, 8.4, 0, 0, 0);
      s.box('dark', 0.5, 2.0, 0.5, 0, -1.2, 0);
      s.box('orange', 0.8, 0.4, 0.8, 0, -2.3, 0);
    }).position.set(0, 6.0, 0);
    statusLight(b, -3.4, 7.1, 4.4);
  },
  assembler(b) {
    b.slab('dark', 10, 0.6, 15, 0, 0, 0);
    b.slab('light', 8, 5, 9, 0, 0.6, 0);
    b.slab('orange', 8.6, 0.6, 9.6, 0, 5.6, 0);
    b.box('glass', 6, 2.4, 0.1, 0, 3.0, 4.55);
    for (const x of [-2, 2]) {
      b.slab('steel', 2.2, 1.6, 2.6, x, 0.6, -6.0);
      b.cone('steel', 1.3, 1.4, x, 2.9, -6.0, 4, true);
    }
    b.slab('steel', 2.2, 0.7, 3, 0, 0.6, 6);
    for (const z of [-4.8, 4.8]) {
      b.slab('orange', 0.5, 7.5, 0.5, -4.6, 0.6, z);
      b.slab('orange', 0.5, 7.5, 0.5, 4.6, 0.6, z);
      b.box('orange', 9.7, 0.5, 0.5, 0, 8.1, z);
    }
    b.box('screen', 1.6, 0.9, 0.05, 3.0, 4.6, 4.56);
    b.named('arm', (s) => {
      s.box('steel', 9.2, 0.4, 0.6, 0, 0, 0);
      s.box('dark', 0.5, 1.6, 0.5, 0, -1.0, 0);
      s.box('orange', 1.0, 0.4, 1.0, 0, -1.9, 0);
    }).position.set(0, 7.6, 0);
    statusLight(b, -4.6, 8.6, 4.8);
  },
  foundry(b) {
    b.slab('dark', 10, 0.6, 9, 0, 0, 0);
    for (const x of [-2.4, 2.4]) {
      b.cyl('orange', 2.0, 4.8, x, 0.6 + 2.4, -0.4, 20);
      b.cyl('dark', 2.15, 0.4, x, 5.4, -0.4, 20);
      b.cyl('glow', 1.6, 0.12, x, 5.62, -0.4, 20);
    }
    b.slab('light', 6, 2.6, 2, 0, 0.6, 3.2);
    b.box('glow', 2.4, 0.8, 0.1, 0, 2.2, 4.21);
    b.cyl('steel', 0.85, 4, 0, 6.6, -3.4, 12);
    b.cyl('dark', 0.95, 0.3, 0, 8.7, -3.4, 12);
    b.slab('steel', 2.2, 0.7, 1.4, -2, 0.6, -3.8);
    b.slab('steel', 2.2, 0.7, 1.4, 2, 0.6, -3.8);
    statusLight(b, 4.5, 4.0, 3.8);
  },
  manufacturer(b) {
    b.slab('dark', 18, 0.8, 20, 0, 0, 0);
    b.slab('light', 16, 8, 16, 0, 0.8, 0);
    b.slab('orange', 16.6, 0.8, 16.6, 0, 8.8, 0);
    b.box('glass', 12, 3, 0.1, 0, 4.6, 8.05);
    b.box('glass', 0.1, 3, 12, -8.05, 4.6, 0);
    b.box('glass', 0.1, 3, 12, 8.05, 4.6, 0);
    for (const x of [-5, 0, 5]) b.cyl('steel', 0.8, 2.6, x, 9.6 + 1.3, -4, 12);
    for (const x of [-6, -2, 2, 6]) b.slab('steel', 2.4, 1.8, 2.4, x, 0.8, -9);
    b.slab('steel', 3, 0.8, 2.4, 0, 0.8, 9);
    for (const [x, z] of [[-8.3, -8.3], [8.3, -8.3], [-8.3, 8.3], [8.3, 8.3]]) b.slab('orange', 0.9, 9.6, 0.9, x, 0.8, z);
    b.box('logo', 6, 1.5, 0.1, 0, 7.4, 8.06);
    b.named('arm', (s) => {
      s.box('steel', 14, 0.5, 0.8, 0, 0, 0);
      s.box('dark', 0.6, 2.4, 0.6, 0, -1.4, 0);
    }).position.set(0, 7.6, 0);
    statusLight(b, -8.3, 10.7, 8.3);
  },
  storage_container(b) {
    b.slab('orange', 4.6, 2.6, 4.6, 0, 0.1, 0);
    b.slab('dark', 5, 0.15, 5, 0, 0, 0);
    b.slab('steel', 5, 0.4, 5, 0, 2.7, 0);
    for (const [x, z] of [[-2.35, -2.35], [2.35, -2.35], [-2.35, 2.35], [2.35, 2.35]]) b.slab('dark', 0.3, 2.7, 0.3, x, 0.1, z);
    b.box('logo', 2.4, 0.6, 0.05, 0, 1.8, 2.32);
  },
  industrial_storage(b) {
    b.slab('steel', 5.6, 5.4, 9.6, 0, 0.2, 0);
    b.slab('dark', 6, 0.2, 10, 0, 0, 0);
    b.slab('orange', 6, 0.4, 10, 0, 5.6, 0);
    for (const z of [-3, 0, 3]) b.box('orange', 5.7, 0.3, 0.3, 0, 3, z);
    for (const [x, z] of [[-2.85, -4.85], [2.85, -4.85], [-2.85, 4.85], [2.85, 4.85]]) b.slab('dark', 0.3, 5.6, 0.3, x, 0.2, z);
    b.box('logo', 3, 0.75, 0.05, 0, 4.4, 4.82);
  },
  crate(b) {
    b.slab('orange', 1.3, 0.9, 1.3, 0, 0, 0);
    b.slab('dark', 1.4, 0.12, 1.4, 0, 0.9, 0);
    b.box('dark', 1.42, 0.12, 0.12, 0, 0.45, 0.62);
    b.box('dark', 1.42, 0.12, 0.12, 0, 0.45, -0.62);
  },
  splitter(b) {
    b.slab('dark', 2.6, 1.7, 2.6, 0, 0, 0);
    b.slab('orange', 2.9, 0.3, 2.9, 0, 1.7, 0);
    b.cone('glow', 0.3, 0.3, 0, 2.15, 0, 3);
  },
  merger(b) {
    b.slab('dark', 2.6, 1.7, 2.6, 0, 0, 0);
    b.slab('steel', 2.9, 0.3, 2.9, 0, 1.7, 0);
    b.box('orange', 0.6, 0.12, 2.0, 0, 2.06, 0);
  },
  biomass_burner(b) {
    b.slab('dark', 7, 0.5, 7, 0, 0, 0);
    b.cyl('orange', 2.8, 5, 0, 3.0, 0, 20);
    b.cyl('dark', 2.95, 0.4, 0, 5.6, 0, 20);
    b.cone('steel', 2.6, 1.2, 0, 6.4, 0, 20);
    b.box('glow', 1.6, 1.2, 0.3, 0, 2.2, 2.72);
    b.cyl('steel', 0.45, 2.2, 1.4, 7.3, -1.0, 10);
    b.slab('steel', 2.0, 1.4, 1.6, 0, 0.5, -3.0);
    statusLight(b, -2.4, 5.6, 1.6);
  },
  coal_generator(b) {
    b.slab('dark', 10, 0.8, 20, 0, 0, 0);
    b.slab('light', 8, 6, 10, 0, 0.8, 3);
    b.slab('orange', 8.4, 0.6, 10.4, 0, 6.8, 3);
    b.cyl('orange', 3, 8, 0, 4, -5, 20, Math.PI / 2);
    b.cyl('dark', 3.2, 0.6, 0, 4, -1.1, 20, Math.PI / 2);
    for (const x of [-2.5, 2.5]) {
      b.cyl('steel', 1.4, 6, x, 7.4 + 3, 5, 16, 0, 0, 1.1);
      b.cyl('dark', 1.2, 0.4, x, 13.4, 5, 16);
    }
    b.box('glow', 3, 1.2, 0.1, 0, 3, 8.06);
    b.slab('steel', 2.2, 1, 2, 0, 0.8, -9);
    statusLight(b, 3.8, 7.6, 8);
  },
  power_storage(b) {
    b.slab('dark', 6, 0.4, 6, 0, 0, 0);
    b.slab('light', 5.4, 5.2, 5.4, 0, 0.4, 0);
    b.slab('orange', 5.6, 0.4, 5.6, 0, 5.6, 0);
    for (const [x, z, ry] of [[0, 2.72, 0], [0, -2.72, 0], [2.72, 0, Math.PI / 2], [-2.72, 0, Math.PI / 2]]) {
      for (const o of [-1.4, 0, 1.4]) {
        const dx = ry ? 0 : o, dz = ry ? o : 0;
        b.box('cyan', 0.35, 3.6, 0.1, x + dx, 3, z + dz, ry);
      }
    }
    statusLight(b, 2.5, 6.2, 2.5);
  },
  power_pole_mk1(b, def) {
    const h = def.size[1];
    b.slab('concSide', 0.9, 0.35, 0.9, 0, 0, 0);
    b.cyl('steel', 0.13, h - 0.2, 0, (h - 0.2) / 2 + 0.2, 0, 8, 0, 0, 0.09);
    b.box('dark', 1.2, 0.16, 0.16, 0, h - 0.4, 0);
    b.cyl('orange', 0.14, 0.4, -0.5, h - 0.15, 0, 8);
    b.cyl('orange', 0.14, 0.4, 0.5, h - 0.15, 0, 8);
    b.cyl('orange', 0.16, 0.3, 0, h - 0.05, 0, 8);
  },
  lamp(b) {
    b.slab('concSide', 0.6, 0.3, 0.6, 0, 0, 0);
    b.cyl('dark', 0.1, 5.6, 0, 3.0, 0, 8);
    b.box('dark', 0.15, 0.15, 1.6, 0, 5.75, 0.7);
    b.slab('steel', 0.7, 0.3, 0.9, 0, 5.45, 1.4);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.75), materials().lampOff);
    bulb.position.set(0, 5.42, 1.4);
    bulb.name = 'bulb';
    b.extra.push(bulb);
  },
  foundation(b, def) {
    const [w, h, d] = def.size;
    b.slab('concSide', w, h - 0.08, d, 0, 0, 0);
    b.slab('concrete', w, 0.08, d, 0, h - 0.08, 0);
    b.box('dark', w + 0.02, 0.12, 0.12, 0, h - 0.14, d / 2);
    b.box('dark', w + 0.02, 0.12, 0.12, 0, h - 0.14, -d / 2);
    b.box('dark', 0.12, 0.12, d + 0.02, w / 2, h - 0.14, 0);
    b.box('dark', 0.12, 0.12, d + 0.02, -w / 2, h - 0.14, 0);
  },
  ramp(b, def) {
    const [w, h, d] = def.size;
    const { top, rest } = wedgeGeometry(w, h, d);
    b.add('concrete', top);
    b.add('concSide', rest);
  },
  wall(b, def) {
    const [w, h, d] = def.size;
    b.slab('concSide', w, h, d, 0, 0, 0);
    b.box('dark', w + 0.02, 0.2, d + 0.04, 0, h - 0.1, 0);
    b.box('hazard', w + 0.02, 0.2, d + 0.04, 0, 0.1, 0);
  },
  wall_window(b, def) {
    const [w, h, d] = def.size;
    b.slab('concSide', w, 1.2, d, 0, 0, 0);
    b.slab('concSide', w, 0.8, d, 0, 3.2, 0);
    b.slab('concSide', 1, 2, d, -3.5, 1.2, 0);
    b.slab('concSide', 1, 2, d, 3.5, 1.2, 0);
    b.slab('dark', 0.15, 2, d * 0.6, 0, 1.2, 0);
    b.box('glass', 6, 2, 0.06, 0, 2.2, 0);
    b.box('dark', w + 0.02, 0.2, d + 0.04, 0, h - 0.1, 0);
  },
};
BUILDERS.foundation_1 = BUILDERS.foundation_2 = BUILDERS.foundation_4 = BUILDERS.foundation;
BUILDERS.ramp_2 = BUILDERS.ramp_4 = BUILDERS.ramp;

const templates = new Map();

export function buildTemplate(type) {
  if (templates.has(type)) return templates.get(type);
  const def = BUILDINGS[type];
  const b = new Builder();
  const key = def.model || type;
  const fn = BUILDERS[key];
  if (fn) fn(b, def);
  else b.slab('orange', def.size[0], def.size[1], def.size[2], 0, 0, 0);
  addPorts(b, def);
  if (def.tint) {
    const t = tintMaterial(def.tint);
    if (b.parts.has('orange')) {
      b.parts.set(t, b.parts.get('orange'));
      b.parts.delete('orange');
    }
  }
  const g = b.build();
  templates.set(type, g);
  return g;
}

export function conveyorPoleModel(h) {
  const b = new Builder();
  b.slab('dark', 0.7, 0.1, 0.7, 0, 0, 0);
  b.cyl('steel', 0.1, Math.max(0.1, h - 0.3), 0, (h - 0.3) / 2 + 0.1, 0, 8);
  b.box('orange', 1.5, 0.14, 0.5, 0, h - 0.2, 0);
  b.box('dark', 0.2, 0.3, 0.6, -0.7, h - 0.05, 0);
  b.box('dark', 0.2, 0.3, 0.6, 0.7, h - 0.05, 0);
  return b.build();
}

export function instantiate(type, ent) {
  const def = BUILDINGS[type];
  let obj;
  if (def.logistic === 'pole') obj = conveyorPoleModel(ent ? ent.h : 1);
  else obj = buildTemplate(type).clone(true);
  return obj;
}

// Pioneer avatar for remote players
export function pioneerModel(color = '#e8862a') {
  const g = new THREE.Group();
  const mats = materials();
  const suit = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  mk(new THREE.BoxGeometry(0.62, 0.7, 0.36), suit, 0, 1.15, 0);
  mk(new THREE.BoxGeometry(0.66, 0.12, 0.4), mats.dark, 0, 0.82, 0);
  mk(new THREE.BoxGeometry(0.5, 0.6, 0.25), mats.light, 0, 1.2, -0.3);
  mk(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), mats.orange, 0.15, 1.3, -0.45);
  const head = mk(new THREE.SphereGeometry(0.24, 16, 12), mats.white, 0, 1.68, 0);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.35), new THREE.MeshStandardMaterial({ color: '#1a2a3a', metalness: 0.9, roughness: 0.1, emissive: '#0b3a55', emissiveIntensity: 0.5 }));
  visor.position.set(0, 0, 0.06);
  head.add(visor);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.16, 0.82, 0);
  legR.position.set(0.16, 0.82, 0);
  for (const leg of [legL, legR]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.26), suit);
    m.position.y = -0.4;
    m.castShadow = true;
    leg.add(m);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.32), mats.dark);
    boot.position.set(0, -0.76, 0.03);
    leg.add(boot);
    g.add(leg);
  }
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.42, 1.45, 0);
  armR.position.set(0.42, 1.45, 0);
  for (const arm of [armL, armR]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.66, 0.2), suit);
    m.position.y = -0.3;
    m.castShadow = true;
    arm.add(m);
    g.add(arm);
  }
  // build gun
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.5), mats.orange);
  gun.position.set(0, -0.62, 0.2);
  armR.add(gun);
  g.userData = { legL, legR, armL, armR, head };
  return g;
}
