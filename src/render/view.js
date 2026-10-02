// Scene setup and per-frame visual sync of the simulation.
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { ITEMS, beltForm } from '../data/items.js';
import { WORLD_HALF, CELL, GRID, WATER_LEVEL, NODE_TYPES, FLORA } from '../world/world.js';
import { materials, instantiate, buildTemplate, pioneerModel, conveyorPoleModel } from './models.js';
import { makeBeltTexture, makeTerrainDetail, makeNameTag, makeGlowTexture, makePlanetTexture } from './textures.js';
import { curveAt } from '../sim/factory.js';
import { createNoise2D, mulberry32, clamp, lerp } from '../core/util.js';

const DAY_LENGTH = 1200; // seconds for a full day/night cycle

export class View {
  constructor(canvas, world, factory, settings) {
    this.world = world;
    this.factory = factory;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio || 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = settings.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov || 75, 1, 0.1, (settings.viewDistance || 650) + 150);
    this.scene.add(this.camera);
    this.ents = new Map();
    this.remotes = new Map();
    this.beltMats = {};
    this.time = 0;
    this.statusTimer = 0;
    this.setupLights();
    this.setupSky();
    this.buildTerrain();
    this.buildWater();
    this.buildNodes();
    this.buildFlora();
    this.setupItemMeshes();
    this.setupHolograms();
    this.setupSmoke();
    this.flashlight = new THREE.SpotLight('#fff6e0', 0, 60, Math.PI / 7, 0.5, 1.2);
    this.flashlight.position.set(0.3, -0.2, 0);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.flashlight.target.position.set(0, 0, -10);
    this.glowTex = makeGlowTexture();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings(s) {
    this.settings = s;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio || 1.5));
    this.renderer.shadowMap.enabled = s.shadows !== false;
    this.sun.castShadow = s.shadows !== false;
    this.camera.fov = s.fov || 75;
    this.camera.far = (s.viewDistance || 650) + 150;
    this.camera.updateProjectionMatrix();
    this.scene.fog.far = s.viewDistance || 650;
    this.scene.fog.near = Math.max(80, (s.viewDistance || 650) * 0.25);
    this.resize();
  }

  // ---------------------------------------------------------------- lights/sky
  setupLights() {
    this.hemi = new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.castShadow = this.settings.shadows !== false;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const vd = this.settings.viewDistance || 650;
    this.scene.fog = new THREE.Fog('#bcd6ea', Math.max(80, vd * 0.25), vd);
  }

  setupSky() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.skyUniforms = {
      top: { value: new THREE.Color('#3a7bd5') },
      horizon: { value: new THREE.Color('#bcd6ea') },
      bottom: { value: new THREE.Color('#8fa7b8') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#fff2cc') },
      stars: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float stars;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (smoothstep(0.99955, 0.9998, s) * 6.0 + pow(s, 220.0) * 0.6 + pow(s, 10.0) * 0.18);
          if (stars > 0.0 && h > 0.0) {
            vec3 q = floor(d * 400.0);
            float st = step(0.9985, hash(q));
            col += vec3(st) * stars * smoothstep(0.0, 0.3, h);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    // a couple of alien moons for flavour
    const moonMat = new THREE.MeshBasicMaterial({ color: '#dfe8f0', fog: false, transparent: true, opacity: 0.9 });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), moonMat);
    this.scene.add(this.moon);
    this.planet = new THREE.Sprite(new THREE.SpriteMaterial({ map: makePlanetTexture(), fog: false, transparent: true, depthWrite: false, opacity: 0.8 }));
    this.planet.scale.set(1, 1, 1);
    this.scene.add(this.planet);
  }

  updateSky(time, camPos) {
    const t = ((time / DAY_LENGTH) + 0.3) % 1; // start in the morning
    const ang = t * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), Math.cos(ang) * 0.35 + 0.25).normalize();
    const day = clamp(sunDir.y * 3 + 0.35, 0, 1);
    const dusk = clamp(1 - Math.abs(sunDir.y) * 4, 0, 1);
    this.dayFactor = day;
    const topDay = new THREE.Color('#3f86d8'), topNight = new THREE.Color('#0b1428');
    const horDay = new THREE.Color('#b4d0e8'), horNight = new THREE.Color('#1c2a40'), horDusk = new THREE.Color('#f0a060');
    const top = topNight.clone().lerp(topDay, day);
    const hor = horNight.clone().lerp(horDay, day).lerp(horDusk, dusk * 0.55);
    this.skyUniforms.top.value.copy(top);
    this.skyUniforms.horizon.value.copy(hor);
    this.skyUniforms.bottom.value.copy(hor).multiplyScalar(0.7);
    this.skyUniforms.sunDir.value.copy(sunDir);
    this.skyUniforms.stars.value = clamp(1 - day * 1.6, 0, 1);
    const R = this.camera.far * 0.9;
    this.sky.position.copy(camPos);
    this.sky.scale.setScalar(R);
    this.scene.fog.color.copy(hor).lerp(new THREE.Color('#7f9fbf'), 0.22 * day);
    this.renderer.setClearColor(hor);
    // light: sun by day, moon by night
    const moonDir = sunDir.clone().multiplyScalar(-1);
    const useSun = sunDir.y > -0.05;
    const ldir = useSun ? sunDir : moonDir;
    this.sun.position.copy(camPos).addScaledVector(ldir, 250);
    this.sun.target.position.copy(camPos);
    if (useSun) {
      this.sun.color.set('#fff1d6').lerp(new THREE.Color('#ffb070'), dusk * 0.6);
      this.sun.intensity = 0.4 + 2.4 * day;
    } else {
      this.sun.color.set('#8fa8ff');
      this.sun.intensity = 0.55;
    }
    this.hemi.intensity = 0.35 + 0.65 * day;
    this.hemi.color.copy(top).lerp(new THREE.Color('#ffffff'), 0.5);
    this.moon.position.copy(camPos).addScaledVector(moonDir, R * 0.8);
    this.moon.scale.setScalar(R * 0.027);
    this.planet.position.copy(camPos).add(new THREE.Vector3(-0.47, 0.28, -0.6).multiplyScalar(R * 0.8));
    this.planet.scale.set(R * 0.35, R * 0.35, 1);
    this.planet.material.opacity = 0.35 + 0.5 * (1 - day * 0.6);
    this.moon.material.opacity = clamp(1 - day * 1.2, 0.15, 0.95);
    this.night = day < 0.35;
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const N = this.world.N;
    const H = this.world.heights;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const noise = createNoise2D(this.world.seed + 99);
    const cGrass = new THREE.Color('#4e8a2c'), cGrass2 = new THREE.Color('#7da23a'), cDry = new THREE.Color('#9a9a52');
    const cDirt = new THREE.Color('#7a6248'), cRock = new THREE.Color('#7b766d'), cRock2 = new THREE.Color('#5d5a55'), cSand = new THREE.Color('#c9b98a');
    const tmp = new THREE.Color();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = -WORLD_HALF + i * CELL, z = -WORLD_HALF + j * CELL, y = H[k];
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
        const slope = this.world.slopeAt(x, z);
        const n = noise(x * 0.02, z * 0.02) * 0.5 + 0.5;
        const n2 = noise(x * 0.1 + 50, z * 0.1) * 0.5 + 0.5;
        tmp.copy(cGrass).lerp(cGrass2, n * 0.8);
        if (y > 28) tmp.lerp(cDry, clamp((y - 28) / 20, 0, 0.8));
        if (slope > 0.3) tmp.lerp(cDirt, clamp((slope - 0.3) * 3, 0, 1));
        if (slope > 0.6) tmp.lerp(n2 > 0.5 ? cRock : cRock2, clamp((slope - 0.6) * 2.5, 0, 1));
        if (y < WATER_LEVEL + 1.5) tmp.lerp(cSand, clamp((WATER_LEVEL + 1.5 - y) / 1.5, 0, 1));
        if (y > 60) tmp.lerp(cRock, clamp((y - 60) / 20, 0, 1));
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    // darken around resource nodes
    for (const node of this.world.nodes) {
      const R = 9;
      const i0 = Math.max(0, Math.floor((node.x - R + WORLD_HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((node.x + R + WORLD_HALF) / CELL));
      const j0 = Math.max(0, Math.floor((node.z - R + WORLD_HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((node.z + R + WORLD_HALF) / CELL));
      const nc = new THREE.Color(NODE_TYPES[node.type].color);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * N + i;
        const d = Math.hypot(pos[k * 3] - node.x, pos[k * 3 + 2] - node.z);
        const f = clamp(1 - d / R, 0, 1) * 0.6;
        tmp.setRGB(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]).lerp(cDirt, f).lerp(nc, f * 0.5);
        col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
      }
    }
    // smooth normals straight from the heightmap so chunk borders have no seams
    const H2 = this.world.heights;
    const nrm = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const hl = H2[j * N + Math.max(0, i - 1)], hr = H2[j * N + Math.min(N - 1, i + 1)];
        const hd = H2[Math.max(0, j - 1) * N + i], hu = H2[Math.min(N - 1, j + 1) * N + i];
        let nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        const k = (j * N + i) * 3;
        nrm[k] = nx / l; nrm[k + 1] = ny / l; nrm[k + 2] = nz / l;
      }
    }
    // split into chunks so the camera can frustum-cull what is off screen
    const CH = 64; // cells per chunk side
    const detail = makeTerrainDetail();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 });
    this.terrainChunks = [];
    for (let cj = 0; cj < GRID; cj += CH) {
      for (let ci = 0; ci < GRID; ci += CH) {
        const M = CH + 1;
        const cp = new Float32Array(M * M * 3), cc = new Float32Array(M * M * 3), cn = new Float32Array(M * M * 3), cu = new Float32Array(M * M * 2);
        for (let j = 0; j < M; j++) {
          for (let i = 0; i < M; i++) {
            const src = (cj + j) * N + (ci + i), dst = j * M + i;
            for (let q = 0; q < 3; q++) { cp[dst * 3 + q] = pos[src * 3 + q]; cc[dst * 3 + q] = col[src * 3 + q]; cn[dst * 3 + q] = nrm[src * 3 + q]; }
            cu[dst * 2] = uv[src * 2]; cu[dst * 2 + 1] = uv[src * 2 + 1];
          }
        }
        const idx = new Uint32Array(CH * CH * 6);
        let p = 0;
        for (let j = 0; j < CH; j++) {
          for (let i = 0; i < CH; i++) {
            const a = j * M + i, b = j * M + i + 1, c = (j + 1) * M + i, d = (j + 1) * M + i + 1;
            // triangles (a, c, b) and (b, c, d) — matches World.heightAt
            idx[p++] = a; idx[p++] = c; idx[p++] = b;
            idx[p++] = b; idx[p++] = c; idx[p++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(cn, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(cu, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.terrainChunks.push(mesh);
      }
    }
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(WORLD_HALF * 2.4, WORLD_HALF * 2.4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({ color: '#2a6f8f', transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.3 });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.position.y = WATER_LEVEL;
    this.scene.add(this.water);
  }

  // ---------------------------------------------------------------- resource nodes
  buildNodes() {
    const rand = mulberry32(this.world.seed ^ 0x1234);
    const rocks = [];
    const veins = [];
    for (const n of this.world.nodes) {
      const count = 6 + n.purity * 2;
      const base = new THREE.Color(NODE_TYPES[n.type].color);
      const glow = new THREE.Color(NODE_TYPES[n.type].glow);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.5;
        const r = 1.6 + rand() * 1.8;
        const s = 0.7 + rand() * 0.8 + n.purity * 0.15;
        const x = n.x + Math.cos(a) * r, z = n.z + Math.sin(a) * r;
        rocks.push({ x, y: this.world.heightAt(x, z) + s * 0.25, z, s, sy: s * (0.7 + rand() * 0.5), rot: rand() * 6.28, c: base.clone().multiplyScalar(0.8 + rand() * 0.4) });
        if (rand() < 0.7) veins.push({ x: x + (rand() - 0.5), y: this.world.heightAt(x, z) + s * 0.7, z: z + (rand() - 0.5), s: 0.25 + rand() * 0.3, rot: rand() * 6.28, c: glow });
      }
      rocks.push({ x: n.x, y: n.y + 0.2, z: n.z, s: 1.4 + n.purity * 0.3, sy: 1.0, rot: rand() * 6.28, c: base.clone().multiplyScalar(0.7) });
    }
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.15, flatShading: true });
    const im = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    rocks.forEach((r, i) => {
      e.set(r.rot * 0.3, r.rot, r.rot * 0.2);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.sy, r.s));
      im.setMatrixAt(i, m);
      im.setColorAt(i, r.c);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.scene.add(im);
    const vGeo = new THREE.OctahedronGeometry(1, 0);
    const vMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.25, flatShading: true });
    const vm = new THREE.InstancedMesh(vGeo, vMat, veins.length);
    veins.forEach((r, i) => {
      e.set(r.rot, r.rot * 0.5, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.s, r.s * 1.6, r.s));
      vm.setMatrixAt(i, m);
      vm.setColorAt(i, r.c);
    });
    this.scene.add(vm);
  }

  // ---------------------------------------------------------------- flora
  buildFlora() {
    const CH = 256;
    const chunks = new Map();
    const parts = this.floraParts();
    this.floraRefs = new Map();
    for (const f of this.world.flora) {
      const key = `${Math.floor((f.x + WORLD_HALF) / CH)}_${Math.floor((f.z + WORLD_HALF) / CH)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(f);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    this.floraMeshes = [];
    for (const [, list] of chunks) {
      for (const part of parts) {
        const mine = list.filter(f => part.types.includes(f.type));
        if (!mine.length) continue;
        const im = new THREE.InstancedMesh(part.geo, part.mat, mine.length);
        mine.forEach((f, i) => {
          const t = part.xf(f);
          e.set(t.rx || 0, f.rot, t.rz || 0);
          q.setFromEuler(e);
          m.compose(v.set(f.x, f.y + t.y, f.z), q, s.set(t.sx, t.sy, t.sz));
          im.setMatrixAt(i, m);
          part.color(f, col);
          im.setColorAt(i, col);
          if (this.world && this.factory.state.floraGone.has(f.id)) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
          if (!this.floraRefs.has(f.id)) this.floraRefs.set(f.id, []);
          this.floraRefs.get(f.id).push([im, i]);
        });
        im.castShadow = part.shadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.scene.add(im);
        this.floraMeshes.push(im);
      }
    }
  }

  floraParts() {
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0, flatShading: true }, o));
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const pineGeo = (() => {
      const a = new THREE.ConeGeometry(1.6, 2.6, 7); a.translate(0, 1.3, 0);
      const b = new THREE.ConeGeometry(1.25, 2.2, 7); b.translate(0, 2.6, 0);
      const c = new THREE.ConeGeometry(0.85, 1.8, 7); c.translate(0, 3.7, 0);
      const { BufferGeometryUtils } = THREE;
      return BufferGeometryUtils.mergeGeometries([a, b, c]);
    })();
    const capGeo = new THREE.SphereGeometry(0.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    stemGeo.translate(0, 0.5, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const trunkMat = std({ color: '#ffffff' });
    const leafMat = std({ color: '#ffffff' });
    const capMat = std({ color: '#ffffff', emissive: '#5a2080', emissiveIntensity: 0.5 });
    const rockMat = std({ color: '#ffffff', roughness: 0.95 });
    const greens = ['#3f7d2a', '#4b8f30', '#5a9b34', '#2f6e3a', '#6aa23c', '#3c8a5a', '#c08a2a', '#4a8a2e'];
    return [
      { types: [FLORA.TREE], geo: trunkGeo, mat: trunkMat, shadow: true, xf: f => ({ y: 0, sx: f.s, sy: 4.2 * f.s, sz: f.s }), color: (f, c) => c.set('#5d4330') },
      { types: [FLORA.TREE], geo: canopyGeo, mat: leafMat, shadow: true, xf: f => ({ y: 4.6 * f.s, sx: 2.7 * f.s, sy: 2.2 * f.s, sz: 2.7 * f.s }), color: (f, c) => c.set(greens[Math.floor(f.c * greens.length)]) },
      { types: [FLORA.PINE], geo: trunkGeo, mat: trunkMat, shadow: true, xf: f => ({ y: 0, sx: 0.8 * f.s, sy: 2.5 * f.s, sz: 0.8 * f.s }), color: (f, c) => c.set('#4a3524') },
      { types: [FLORA.PINE], geo: pineGeo, mat: leafMat, shadow: true, xf: f => ({ y: 1.6 * f.s, sx: 1.1 * f.s, sy: 1.4 * f.s, sz: 1.1 * f.s }), color: (f, c) => c.set(f.c < 0.5 ? '#2d5e34' : '#356b2e') },
      { types: [FLORA.BUSH], geo: canopyGeo, mat: leafMat, shadow: false, xf: f => ({ y: 0.35 * f.s, sx: 1.2 * f.s, sy: 0.85 * f.s, sz: 1.2 * f.s }), color: (f, c) => c.set(f.c < 0.3 ? '#5fa83a' : f.c < 0.6 ? '#4c9433' : '#77b046') },
      { types: [FLORA.MUSHROOM], geo: stemGeo, mat: trunkMat, shadow: false, xf: f => ({ y: 0, sx: f.s, sy: 0.9 * f.s, sz: f.s }), color: (f, c) => c.set('#d8d0e0') },
      { types: [FLORA.MUSHROOM], geo: capGeo, mat: capMat, shadow: false, xf: f => ({ y: 0.85 * f.s, sx: f.s, sy: 0.8 * f.s, sz: f.s }), color: (f, c) => c.set(f.c < 0.5 ? '#9b5fc0' : '#c06fb8') },
      { types: [FLORA.ROCK], geo: rockGeo, mat: rockMat, shadow: true, xf: f => ({ y: 0.2 * f.s, sx: 1.3 * f.s, sy: 0.85 * f.s, sz: 1.1 * f.s, rx: f.c, rz: f.c * 0.5 }), color: (f, c) => c.set(f.c < 0.5 ? '#8a857c' : '#6f6b65') },
    ];
  }

  removeFlora(ids) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const id of ids) {
      const refs = this.floraRefs.get(id);
      if (!refs) continue;
      for (const [im, i] of refs) {
        im.setMatrixAt(i, zero);
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------- entities
  addEnt(e) {
    const def = BUILDINGS[e.type];
    if (this.ents.has(e.id)) this.removeEnt(e.id);
    let obj;
    if (def.kind === 'belt') obj = this.makeBeltMesh(e);
    else if (def.kind === 'wire') obj = this.makeWireMesh(e);
    else {
      obj = instantiate(e.type, e);
      obj.position.set(e.x, e.y, e.z);
      obj.rotation.y = e.r;
    }
    obj.traverse(o => { o.userData.entId = e.id; });
    obj.userData.entId = e.id;
    this.scene.add(obj);
    const rec = {
      obj, type: e.type,
      status: obj.getObjectByName ? obj.getObjectByName('status') : null,
      drill: obj.getObjectByName('drill'),
      arm: obj.getObjectByName('arm'),
      swirl: obj.getObjectByName('swirl'),
      bulb: obj.getObjectByName('bulb'),
      phase: Math.random() * 10,
      ownGeo: def.kind !== 'bld' || def.logistic === 'pole',
    };
    if (def.lamp) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ffd890', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.set(5, 5, 5);
      sp.position.set(0, 5.2, 1.4);
      sp.visible = false;
      obj.add(sp);
      rec.halo = sp;
    }
    this.ents.set(e.id, rec);
    // belts need redraw if a pole height changes etc — not needed here
  }

  removeEnt(id) {
    const rec = this.ents.get(id);
    if (!rec) return;
    this.scene.remove(rec.obj);
    if (rec.ownGeo) rec.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.ents.delete(id);
  }

  updateEnt(e) {
    // re-create only if visual shape could change (poles height); otherwise status handles it
    const def = BUILDINGS[e.type];
    if (def.logistic === 'pole') this.addEnt(e);
  }

  beltMaterial(tier) {
    if (!this.beltMats[tier]) {
      const t = makeBeltTexture();
      const tint = ['#26282b', '#2b2d30', '#2b2f36', '#352c26', '#2b3330'][tier - 1] || '#26282b';
      this.beltMats[tier] = new THREE.MeshStandardMaterial({ map: t, color: '#ffffff', roughness: 0.85, metalness: 0.1, emissive: tint, emissiveIntensity: 0.0 });
    }
    return this.beltMats[tier];
  }

  beltGeometry(curve, withFrame = true) {
    const n = curve.n;
    const pts = curve.pts;
    const up = new THREE.Vector3(0, 1, 0);
    const T = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3(), P = new THREE.Vector3();
    const prof = withFrame
      ? [[-0.6, 0.0], [0.6, 0.0], null, [-0.74, 0.14], [-0.74, -0.32], [0.74, -0.32], [0.74, 0.14]]
      : [[-0.6, 0.0], [0.6, 0.0]];
    const top = { pos: [], uv: [], idx: [] };
    const frame = { pos: [], uv: [], idx: [] };
    const lastR = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
      T.set(pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2]).normalize();
      R.crossVectors(T, up);
      if (R.lengthSq() < 1e-6) R.copy(lastR); else R.normalize();
      lastR.copy(R);
      U.crossVectors(R, T).normalize();
      P.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      const v = curve.cum[i] / 2;
      // top surface
      for (let k = 0; k < 2; k++) {
        const [ox, oy] = prof[k];
        top.pos.push(P.x + R.x * ox + U.x * oy, P.y + R.y * ox + U.y * oy, P.z + R.z * ox + U.z * oy);
        top.uv.push(k, v);
      }
      if (withFrame) {
        for (let k = 3; k < 7; k++) {
          const [ox, oy] = prof[k];
          frame.pos.push(P.x + R.x * ox + U.x * oy, P.y + R.y * ox + U.y * oy, P.z + R.z * ox + U.z * oy);
          frame.uv.push(k / 6, v);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = (i + 1) * 2;
      top.idx.push(a, a + 1, b, a + 1, b + 1, b);
      if (withFrame) {
        const fa = i * 4, fb = (i + 1) * 4;
        for (let k = 0; k < 3; k++) {
          frame.idx.push(fa + k, fa + k + 1, fb + k, fa + k + 1, fb + k + 1, fb + k);
        }
      }
    }
    const mk = (d) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
      g.setIndex(d.idx);
      g.computeVertexNormals();
      return g;
    };
    return { top: mk(top), frame: withFrame ? mk(frame) : null };
  }

  makeBeltMesh(e) {
    const def = BUILDINGS[e.type];
    const g = new THREE.Group();
    const { top, frame } = this.beltGeometry(e._curve);
    const mTop = new THREE.Mesh(top, this.beltMaterial(def.tier));
    mTop.receiveShadow = true;
    if (!this.beltFrameMat) {
      this.beltFrameMat = materials().dark.clone();
      this.beltFrameMat.side = THREE.DoubleSide;
    }
    const mFrame = new THREE.Mesh(frame, this.beltFrameMat);
    mFrame.castShadow = true;
    mFrame.receiveShadow = true;
    g.add(mTop, mFrame);
    // simple supports under long elevated belts
    const c = e._curve;
    const step = 12;
    for (let d = step / 2; d < c.len - 2; d += step) {
      const p = curveAt(c, d, {});
      const gy = this.world.heightAt(p.x, p.z);
      const h = p.y - 0.3 - gy;
      if (h > 0.8 && h < 30) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), materials().steel);
        leg.position.set(p.x, gy + h / 2, p.z);
        leg.castShadow = true;
        g.add(leg);
      }
    }
    return g;
  }

  makeWireMesh(e) {
    const a = this.factory.get(e.a), b = this.factory.get(e.b);
    const g = new THREE.Group();
    if (!a || !b) return g;
    const pa = this.factory.connWorld(a), pb = this.factory.connWorld(b);
    const pts = this.catenary(pa, pb);
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.05, 5, false), materials().wire);
    tube.castShadow = true;
    const pick = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.35, 4, false), materials().wire);
    pick.visible = false;
    g.add(tube, pick);
    return g;
  }

  catenary(pa, pb) {
    const pts = [];
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const sag = Math.min(3, len * 0.04);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector3(lerp(pa.x, pb.x, t), lerp(pa.y, pb.y, t) - Math.sin(t * Math.PI) * sag, lerp(pa.z, pb.z, t)));
    }
    return pts;
  }

  // wires attached to a moved/re-created entity are static; nothing to do
  refreshWiresFor() {}

  // ---------------------------------------------------------------- belt items
  setupItemMeshes() {
    const forms = {
      chunk: new THREE.IcosahedronGeometry(0.24, 0),
      ingot: (() => { const g = new THREE.BoxGeometry(0.5, 0.18, 0.28); return g; })(),
      plate: new THREE.BoxGeometry(0.55, 0.07, 0.55),
      rod: (() => { const g = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6); g.rotateX(Math.PI / 2); return g; })(),
      small: new THREE.BoxGeometry(0.22, 0.12, 0.22),
      box: new THREE.BoxGeometry(0.5, 0.38, 0.5),
      crystal: new THREE.OctahedronGeometry(0.26, 0),
    };
    this.itemForms = {};
    this.itemFormOffset = { chunk: 0.2, ingot: 0.1, plate: 0.05, rod: 0.08, small: 0.07, box: 0.2, crystal: 0.26 };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.45, flatShading: true });
    for (const [k, geo] of Object.entries(forms)) {
      this.itemForms[k] = { geo, mat, mesh: null, cap: 0 };
      this.growItemMesh(k, 256);
    }
    this.itemColor = {};
    for (const [id, it] of Object.entries(ITEMS)) this.itemColor[id] = new THREE.Color(it.color);
    this.itemFormOf = {};
    for (const id of Object.keys(ITEMS)) this.itemFormOf[id] = beltForm(id);
  }

  growItemMesh(k, cap) {
    const f = this.itemForms[k];
    if (f.mesh) { this.scene.remove(f.mesh); f.mesh.dispose(); }
    f.mesh = new THREE.InstancedMesh(f.geo, f.mat, cap);
    f.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    f.mesh.count = 0;
    f.mesh.frustumCulled = false;
    f.mesh.castShadow = false;
    f.mesh.setColorAt(0, new THREE.Color());
    this.scene.add(f.mesh);
    f.cap = cap;
  }

  updateItems(alpha, camPos) {
    const counts = {};
    for (const k in this.itemForms) counts[k] = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
    const out = {};
    const R2 = 140 * 140;
    for (const b of this.factory.belts) {
      if (!b.items.length || !b._curve) continue;
      const c = b._curve;
      const mid = Math.floor(c.n / 2) * 3;
      const dx = c.pts[mid] - camPos.x, dz = c.pts[mid + 2] - camPos.z;
      if (dx * dx + dz * dz > R2 + c.len * c.len) continue;
      for (const it of b.items) {
        const form = this.itemFormOf[it.i];
        const f = this.itemForms[form];
        if (counts[form] >= f.cap) { this.growItemMesh(form, f.cap * 2); }
        const d = it.pd + (it.d - it.pd) * alpha;
        curveAt(c, d, out);
        const yaw = Math.atan2(out.tx, out.tz);
        q.setFromAxisAngle(yAxis, form === 'chunk' || form === 'crystal' ? yaw + d * 0.6 : yaw);
        m.compose(v.set(out.x, out.y + this.itemFormOffset[form] + 0.02, out.z), q, one);
        const mesh = this.itemForms[form].mesh;
        mesh.setMatrixAt(counts[form], m);
        mesh.setColorAt(counts[form], this.itemColor[it.i]);
        counts[form]++;
      }
    }
    for (const k in this.itemForms) {
      const mesh = this.itemForms[k].mesh;
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- chimney smoke
  setupSmoke() {
    const MAX = 700;
    this.smokeMax = MAX;
    const geo = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(MAX * 3);
    this.smokeSize = new Float32Array(MAX);
    this.smokeAlpha = new Float32Array(MAX);
    this.smokeShade = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.smokeSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.smokeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.BufferAttribute(this.smokeShade, 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeUniforms = { light: { value: 1 }, scale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.smokeUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; varying float vA; varying float vS; uniform float scale;
        void main(){ vA = aAlpha; vS = aShade; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying float vS; uniform float light;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(vS) * light, a); }`,
    });
    this.smoke = new THREE.Points(geo, mat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 3;
    this.scene.add(this.smoke);
    this.particles = [];
    this.smokeTimer = 0;
  }

  updateSmoke(dt, camPos) {
    // spawn from active chimneys near the camera
    const tmp = [0, 0, 0];
    for (const e of this.factory.near(camPos.x, camPos.z, 120)) {
      const def = BUILDINGS[e.type];
      if (!def.smoke) continue;
      const active = def.gen ? e._load > 0 && !e.tripped : e.working && e._powered;
      if (!active) continue;
      for (const [lx, ly, lz] of def.smoke) {
        e._smokeAcc = (e._smokeAcc || 0) + dt * (def.steam ? 7 : 4);
        while (e._smokeAcc >= 1 && this.particles.length < this.smokeMax) {
          e._smokeAcc -= 1;
          const c = Math.cos(e.r), sn = Math.sin(e.r);
          tmp[0] = e.x + lx * c + lz * sn;
          tmp[1] = e.y + ly;
          tmp[2] = e.z - lx * sn + lz * c;
          this.particles.push({
            x: tmp[0] + (Math.random() - 0.5) * 0.4, y: tmp[1], z: tmp[2] + (Math.random() - 0.5) * 0.4,
            vx: (Math.random() - 0.5) * 0.5 + 0.6, vy: 1.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.5 + 0.3,
            age: 0, life: 3 + Math.random() * 2, shade: def.steam ? 0.95 : 0.45 + Math.random() * 0.2, size: def.steam ? 2.2 : 1.4,
          });
        }
      }
    }
    const P = this.particles;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy *= 0.995;
      const t = p.age / p.life;
      this.smokePos[n * 3] = p.x; this.smokePos[n * 3 + 1] = p.y; this.smokePos[n * 3 + 2] = p.z;
      this.smokeSize[n] = p.size * (1 + t * 3);
      this.smokeAlpha[n] = Math.min(1, t * 6) * (1 - t) * 0.55;
      this.smokeShade[n] = p.shade;
      P[n] = p;
      n++;
    }
    P.length = n;
    const geo = this.smoke.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aShade']) geo.attributes[k].needsUpdate = true;
    this.smokeUniforms.light.value = 0.35 + 0.65 * (this.dayFactor == null ? 1 : this.dayFactor);
    this.smokeUniforms.scale.value = window.innerHeight * 0.9;
  }

  // ---------------------------------------------------------------- remote players
  updateRemote(pid, p, name, color) {
    let r = this.remotes.get(pid);
    if (!r) {
      const obj = pioneerModel(color);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeNameTag(name, color), depthTest: false, transparent: true }));
      tag.scale.set(2.4, 0.6, 1);
      tag.position.set(0, 2.35, 0);
      tag.renderOrder = 10;
      obj.add(tag);
      this.scene.add(obj);
      r = { obj, x: p.x, y: p.y, z: p.z, yaw: p.yaw, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, walk: 0 };
      this.remotes.set(pid, r);
    }
    r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw; r.pitch = p.pitch || 0;
  }

  removeRemote(pid) {
    const r = this.remotes.get(pid);
    if (!r) return;
    this.scene.remove(r.obj);
    this.remotes.delete(pid);
  }

  animateRemotes(dt) {
    for (const r of this.remotes.values()) {
      const k = Math.min(1, dt * 12);
      const px = r.x, pz = r.z;
      r.x = lerp(r.x, r.tx, k); r.y = lerp(r.y, r.ty, k); r.z = lerp(r.z, r.tz, k);
      let dy = r.tyaw - r.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw += dy * k;
      const speed = Math.hypot(r.x - px, r.z - pz) / Math.max(dt, 1e-3);
      r.walk += dt * Math.min(speed, 10) * 2.2;
      const sw = Math.sin(r.walk) * Math.min(1, speed / 3) * 0.7;
      const u = r.obj.userData;
      u.legL.rotation.x = sw; u.legR.rotation.x = -sw;
      u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.3 - 0.5;
      u.head.rotation.x = -(r.pitch || 0) * 0.5;
      r.obj.position.set(r.x, r.y, r.z);
      r.obj.rotation.y = r.yaw + Math.PI;
    }
  }

  // ---------------------------------------------------------------- holograms
  setupHolograms() {
    this.holoMat = new THREE.MeshBasicMaterial({ color: '#58b8ff', transparent: true, opacity: 0.38, depthWrite: false });
    this.holoBad = new THREE.MeshBasicMaterial({ color: '#ff4040', transparent: true, opacity: 0.38, depthWrite: false });
    this.dismantleMat = new THREE.MeshBasicMaterial({ color: '#ff5030', transparent: true, opacity: 0.55, depthWrite: false });
    this.holos = new Map();
    this.holo = null;
    this.beltHolo = null;
    this.wireHolo = null;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: '#7dff8a', depthTest: false, transparent: true }));
    ring.renderOrder = 5;
    ring.visible = false;
    this.portMarker = ring;
    this.scene.add(ring);
  }

  hologramFor(type, h) {
    const def = BUILDINGS[type];
    const key = def.logistic === 'pole' ? `${type}_${h}` : type;
    if (!this.holos.has(key)) {
      const obj = def.logistic === 'pole' ? conveyorPoleModel(h) : buildTemplate(type).clone(true);
      obj.traverse(o => { if (o.isMesh) { o.material = this.holoMat; o.castShadow = false; o.receiveShadow = false; } });
      if (def.logistic === 'pole') this.holos.clear();
      this.holos.set(key, obj);
    }
    return this.holos.get(key);
  }

  showHologram(type, x, y, z, r, valid, h) {
    const obj = this.hologramFor(type, h);
    if (this.holo !== obj) {
      if (this.holo) this.scene.remove(this.holo);
      this.holo = obj;
      this.scene.add(obj);
    }
    obj.position.set(x, y, z);
    obj.rotation.y = r;
    const mat = valid ? this.holoMat : this.holoBad;
    obj.traverse(o => { if (o.isMesh) o.material = mat; });
    obj.visible = true;
  }

  hideHologram() {
    if (this.holo) { this.scene.remove(this.holo); this.holo = null; }
  }

  showBeltPreview(curve, valid) {
    if (this.beltHolo) { this.scene.remove(this.beltHolo); this.beltHolo.geometry.dispose(); this.beltHolo = null; }
    if (!curve) return;
    const { top } = this.beltGeometry(curve, false);
    this.beltHolo = new THREE.Mesh(top, valid ? this.holoMat : this.holoBad);
    this.beltHolo.material.side = THREE.DoubleSide;
    this.scene.add(this.beltHolo);
  }

  showWirePreview(pa, pb, valid) {
    if (this.wireHolo) { this.scene.remove(this.wireHolo); this.wireHolo.geometry.dispose(); this.wireHolo = null; }
    if (!pa) return;
    const pts = this.catenary(pa, pb);
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.08, 4, false);
    this.wireHolo = new THREE.Mesh(geo, valid ? this.holoMat : this.holoBad);
    this.scene.add(this.wireHolo);
  }

  showPortMarker(p) {
    if (!p) { this.portMarker.visible = false; return; }
    this.portMarker.visible = true;
    this.portMarker.position.set(p.x, p.y + 0.15, p.z);
    this.portMarker.rotation.set(0, Math.atan2(p.dx, p.dz), 0);
  }

  setHighlight(id) {
    if (this.highlighted === id) return;
    if (this.highlighted != null) {
      const rec = this.ents.get(this.highlighted);
      if (rec) rec.obj.traverse(o => { if (o.isMesh && o.userData.origMat) { o.material = o.userData.origMat; delete o.userData.origMat; } });
    }
    this.highlighted = id;
    if (id != null) {
      const rec = this.ents.get(id);
      if (rec) rec.obj.traverse(o => { if (o.isMesh) { o.userData.origMat = o.material; o.material = this.dismantleMat; } });
    }
  }

  // ---------------------------------------------------------------- picking
  pickEntity(raycaster, center, radius = 30) {
    const near = this.factory.near(center.x, center.z, radius);
    const objs = [];
    for (const e of near) {
      const rec = this.ents.get(e.id);
      if (rec) objs.push(rec.obj);
    }
    // wires are not spatially indexed: test the ones attached to nearby buildings
    const seen = new Set();
    for (const e of near) {
      if (!e._wires) continue;
      for (const w of e._wires) {
        if (seen.has(w)) continue;
        seen.add(w);
        const rec = this.ents.get(w);
        if (rec) objs.push(rec.obj);
      }
    }
    const hits = raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      if (h.object.material === this.holoMat) continue;
      let o = h.object;
      while (o && o.userData.entId == null) o = o.parent;
      if (o) return { id: o.userData.entId, point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0), dist: h.distance, object: h.object };
    }
    return null;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, alpha, camPos, simTime) {
    this.time += dt;
    this.updateSky(simTime, camPos);
    this.updateItems(alpha, camPos);
    this.animateRemotes(dt);
    this.updateSmoke(dt, camPos);
    for (const [tier, mat] of Object.entries(this.beltMats)) {
      const speed = BUILDINGS['belt_mk' + tier].speed;
      mat.map.offset.y -= speed * dt / 2;
    }
    this.statusTimer -= dt;
    const doStatus = this.statusTimer <= 0;
    if (doStatus) this.statusTimer = 0.25;
    const mats = materials();
    for (const [id, rec] of this.ents) {
      const e = this.factory.get(id);
      if (!e) continue;
      const def = BUILDINGS[e.type];
      let active = false;
      if (def.machine) active = e.working && e._powered;
      else if (def.miner) active = e.working && e._powered;
      else if (def.gen) active = !!e._load && !e.tripped;
      else if (e.type === 'awesome_sink') active = e._powered;
      if (rec.drill) rec.drill.rotation.y += dt * (active ? 6 : 0);
      if (rec.arm && active) {
        rec.phase += dt;
        if (def.machine === 'constructor') rec.arm.position.x = Math.sin(rec.phase * 1.5) * 2.2;
        else rec.arm.position.z = Math.sin(rec.phase * 1.2) * 3;
      }
      if (rec.swirl) rec.swirl.rotation.y += dt * (active ? 3 : 0.3);
      if (doStatus && rec.status && this.highlighted !== id) {
        let m = mats.st_none;
        if (def.machine) m = !e.recipe ? mats.st_none : !e._powered ? mats.st_off : e.working ? mats.st_work : mats.st_idle;
        else if (def.miner) m = !e._powered ? mats.st_off : e.working ? mats.st_work : mats.st_idle;
        else if (def.gen) m = e.tripped ? mats.st_off : e._load > 0 ? mats.st_work : e._fuelOk ? mats.st_idle : mats.st_off;
        else if (def.battery) m = e.stored > 1 ? mats.st_work : mats.st_idle;
        rec.status.material = m;
      }
      if (doStatus && rec.bulb && this.highlighted !== id) {
        const on = e._powered && this.night;
        rec.bulb.material = on ? mats.lampOn : mats.lampOff;
        rec.halo.visible = on;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
