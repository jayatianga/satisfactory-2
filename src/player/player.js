// First-person pioneer: movement, collision with terrain, buildings and flora.
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings.js';
import { WATER_LEVEL, WORLD_HALF, floraRadius, FLORA } from '../world/world.js';
import { toLocal, rotXZ, clamp } from '../core/util.js';

const RADIUS = 0.35;
const HEIGHT = 1.8;
const EYE = 1.62;
const STEP = 0.6;
const GRAVITY = 20;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.jetFuel = 1;
    this.jetting = false;
    this.swimming = false;
    this.stepTimer = 0;
    this.bob = 0;
  }

  spawnAt(x, z, yaw = 0) {
    const y = this.groundAt(x, z, 1000);
    this.pos.set(x, y + 0.1, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
  }

  colliders(x, z, r = 3) {
    const out = [];
    const f = this.game.factory;
    for (const e of f.near(x, z, r + 12)) {
      const def = BUILDINGS[e.type];
      if (def.kind !== 'bld' || !def.colliders) continue;
      for (const c of def.colliders) out.push({ e, c, slope: def.slope, h: def.size[1] });
    }
    return out;
  }

  // top surface height of collider at local point
  topOf(col, lz) {
    const [, y0, z0, , y1, z1] = col.c;
    if (col.slope) {
      const t = clamp((lz - z0) / (z1 - z0), 0, 1);
      return col.e.y + y0 + (y1 - y0) * t;
    }
    return col.e.y + y1;
  }

  groundAt(x, z, feet, cols) {
    let g = this.game.world.heightAt(x, z);
    cols = cols || this.colliders(x, z);
    for (const col of cols) {
      const [lx, lz] = toLocal(col.e, x, z);
      const [x0, , z0, x1, , z1] = col.c;
      const m = 0.05;
      if (lx < x0 - m || lx > x1 + m || lz < z0 - m || lz > z1 + m) continue;
      const top = this.topOf(col, lz);
      if (top <= feet + STEP && top > g) g = top;
    }
    return g;
  }

  update(dt, input, active) {
    const g = this.game;
    const eq = g.state.prog.eq;
    const blades = eq.includes('blade_runners');
    if (active) {
      const sens = 0.0022 * (g.settings.sensitivity || 1);
      this.yaw -= input.mouse.dx * sens;
      this.pitch -= input.mouse.dy * sens * (g.settings.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.55, 1.55);
    }
    let fx = 0, fz = 0;
    if (active) {
      if (input.down('KeyW')) fz -= 1;
      if (input.down('KeyS')) fz += 1;
      if (input.down('KeyA')) fx -= 1;
      if (input.down('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sprint = active && (input.down('ShiftLeft') || input.down('ShiftRight')) && fz < 0;
    let speed = sprint ? 9.5 : 5.5;
    if (blades) speed *= 1.25;
    if (this.swimming) speed *= 0.6;
    const [wx, wz] = rotXZ(fx, fz, this.yaw);
    const control = this.onGround ? 14 : 3.5;
    const tx = wx * speed, tz = wz * speed;
    this.vel.x += (tx - this.vel.x) * Math.min(1, control * dt);
    this.vel.z += (tz - this.vel.z) * Math.min(1, control * dt);

    // vertical
    const jump = active && input.down('Space');
    this.swimming = this.pos.y < WATER_LEVEL - 1.1;
    if (this.swimming) {
      this.vel.y -= GRAVITY * 0.15 * dt;
      this.vel.y *= 0.92;
      if (jump) this.vel.y = Math.min(this.vel.y + 18 * dt, 3.5);
    } else {
      this.vel.y -= GRAVITY * dt;
      if (jump && this.onGround && input.hit('Space')) {
        this.vel.y = blades ? 9.5 : 7;
        this.onGround = false;
      }
      this.jetting = false;
      if (eq.includes('jetpack') && jump && !this.onGround && this.jetFuel > 0 && !input.hit('Space') && this.vel.y < 1.5) {
        this.jetting = true;
        this.vel.y = Math.min(this.vel.y + 34 * dt, 6);
        this.jetFuel = Math.max(0, this.jetFuel - dt * 0.33);
      }
    }
    if (this.onGround) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.6);
    this.vel.y = Math.max(this.vel.y, -45);

    // horizontal move + collision
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    const feet = this.pos.y;
    const cols = this.colliders(nx, nz);
    for (let iter = 0; iter < 2; iter++) {
      for (const col of cols) {
        const [x0, y0, z0, x1, , z1] = col.c;
        let [lx, lz] = toLocal(col.e, nx, nz);
        if (lx <= x0 - RADIUS || lx >= x1 + RADIUS || lz <= z0 - RADIUS || lz >= z1 + RADIUS) continue;
        const top = this.topOf(col, clamp(lz, z0, z1));
        const bottom = col.e.y + y0;
        if (feet + STEP >= top) continue;
        if (feet + HEIGHT <= bottom) continue;
        const px0 = lx - (x0 - RADIUS), px1 = (x1 + RADIUS) - lx;
        const pz0 = lz - (z0 - RADIUS), pz1 = (z1 + RADIUS) - lz;
        const m = Math.min(px0, px1, pz0, pz1);
        if (m === px0) lx = x0 - RADIUS;
        else if (m === px1) lx = x1 + RADIUS;
        else if (m === pz0) lz = z0 - RADIUS;
        else lz = z1 + RADIUS;
        const [ox, oz] = rotXZ(lx, lz, col.e.r);
        nx = col.e.x + ox;
        nz = col.e.z + oz;
      }
    }
    // un-stick: if something was built on top of us, pop up onto it
    for (const col of cols) {
      const [x0, y0, z0, x1, , z1] = col.c;
      const [lx, lz] = toLocal(col.e, nx, nz);
      if (lx <= x0 + 0.05 || lx >= x1 - 0.05 || lz <= z0 + 0.05 || lz >= z1 - 0.05) continue;
      const top = this.topOf(col, lz);
      const bottom = col.e.y + y0;
      if (this.pos.y >= bottom - 0.5 && this.pos.y < top - STEP && top - this.pos.y < 14) {
        this.pos.y = top;
        this.vel.y = 0;
      }
    }
    // flora (tree trunks, rocks)
    const gone = g.state.floraGone;
    g.world.floraNear(nx, nz, 3, (f) => {
      if (f.type !== FLORA.TREE && f.type !== FLORA.PINE && f.type !== FLORA.ROCK) return;
      if (gone.has(f.id)) return;
      const r = floraRadius(f) + RADIUS;
      const dx = nx - f.x, dz = nz - f.z;
      const d2 = dx * dx + dz * dz;
      if (f.type === FLORA.ROCK && feet > f.y + f.s * 0.9) return;
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = f.x + dx / d * r;
        nz = f.z + dz / d * r;
      }
    });
    const lim = WORLD_HALF - 3;
    nx = clamp(nx, -lim, lim);
    nz = clamp(nz, -lim, lim);
    this.pos.x = nx;
    this.pos.z = nz;

    // vertical move
    let ny = this.pos.y + this.vel.y * dt;
    const ground = this.groundAt(nx, nz, Math.max(this.pos.y, ny), cols);
    // ceiling
    if (this.vel.y > 0) {
      for (const col of cols) {
        const [x0, y0, z0, x1, , z1] = col.c;
        const [lx, lz] = toLocal(col.e, nx, nz);
        if (lx < x0 || lx > x1 || lz < z0 || lz > z1) continue;
        const bottom = col.e.y + y0;
        if (this.pos.y + HEIGHT <= bottom + 0.01 && ny + HEIGHT > bottom) {
          ny = bottom - HEIGHT;
          this.vel.y = 0;
        }
      }
    }
    if (ny <= ground) {
      if (!this.onGround && this.vel.y < -12 && g.audio) g.audio.play('land');
      ny = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      // stick to ground when walking down slopes
      if (this.onGround && ny - ground < 0.35 && this.vel.y <= 0) {
        ny = ground;
        this.vel.y = 0;
      } else this.onGround = false;
    }
    this.pos.y = ny;

    // footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 1) {
      this.stepTimer -= dt * hs / 5.5;
      this.bob += dt * hs * 1.6;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        if (g.audio) g.audio.play('step');
      }
    }
  }

  applyCamera(cam) {
    const bob = this.onGround ? Math.sin(this.bob) * 0.035 : 0;
    cam.position.set(this.pos.x, this.pos.y + EYE + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }
}
