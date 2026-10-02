// Top-down map: terrain, resource nodes, buildings, belts and players.
import { BUILDINGS } from '../data/buildings.js';
import { ITEMS } from '../data/items.js';
import { WORLD_HALF, WATER_LEVEL, NODE_TYPES } from '../world/world.js';
import { clamp, escapeHtml } from '../core/util.js';

export class MapPanel {
  constructor(game) {
    this.game = game;
    this.scale = 1.2; // px per metre
    this.cx = null;
    this.cz = null;
    this.base = null;
  }

  terrainImage() {
    if (this.base) return this.base;
    const w = this.game.world;
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -WORLD_HALF + (i + 0.5) * (WORLD_HALF * 2 / S);
        const z = -WORLD_HALF + (j + 0.5) * (WORLD_HALF * 2 / S);
        const h = w.heightAt(x, z);
        const k = (j * S + i) * 4;
        let r, g, b;
        if (h < WATER_LEVEL) { r = 40; g = 95; b = 125; }
        else {
          const t = clamp((h - WATER_LEVEL) / 70, 0, 1);
          const shade = 0.75 + 0.25 * Math.sin(h * 0.6);
          r = (70 + t * 90) * shade; g = (120 + t * 40) * shade; b = (60 + t * 50) * shade;
          // contour lines
          if (Math.abs((h % 10) - 5) < 0.35) { r *= 0.8; g *= 0.8; b *= 0.8; }
        }
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
    return c;
  }

  html() {
    const legend = Object.keys(NODE_TYPES).map(t => `<span><i style="background:${NODE_TYPES[t].glow}"></i>${ITEMS[t].name}</span>`).join('');
    return `<div class="win"><header><h2>Map</h2><button class="x" data-act="close">✕</button></header><div class="body">
      <div id="mapwrap"><canvas id="mapc"></canvas></div>
      <div class="legend">${legend}<span><i style="background:#f39c38;border-radius:0"></i>Buildings</span><span class="muted">Wheel: zoom · Drag: pan</span></div></div></div>`;
  }

  mount(root) {
    this.canvas = root.querySelector('#mapc');
    this.wrap = root.querySelector('#mapwrap');
    const r = this.wrap.getBoundingClientRect();
    this.canvas.width = r.width;
    this.canvas.height = r.height;
    if (this.cx == null || !this.follow) {
      const p = this.game.player.pos;
      this.cx = p.x; this.cz = p.z;
    }
    this.terrainImage();
    this.draw();
  }

  wheel(e) {
    const f = e.deltaY > 0 ? 0.8 : 1.25;
    this.scale = clamp(this.scale * f, 0.4, 8);
  }

  down(e) {
    this.dragging = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz };
  }

  up() { this.dragging = null; }

  draw() {
    if (!this.canvas || !this.canvas.isConnected) return;
    if (this.dragging && this.game.ui.mouseX != null) {
      const d = this.dragging;
      this.cx = d.cx - (this.game.ui.mouseX - d.x) / this.scale;
      this.cz = d.cz - (this.game.ui.mouseY - d.y) / this.scale;
    }
    const g = this.game;
    const c = this.canvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height, s = this.scale;
    const toX = (x) => W / 2 + (x - this.cx) * s;
    const toY = (z) => H / 2 + (z - this.cz) * s;
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrainImage(), toX(-WORLD_HALF), toY(-WORLD_HALF), WORLD_HALF * 2 * s, WORLD_HALF * 2 * s);
    // belts
    ctx.strokeStyle = 'rgba(30,30,30,0.9)';
    ctx.lineWidth = Math.max(1, s * 1.2);
    for (const b of g.factory.belts) {
      const p = b._curve.pts;
      ctx.beginPath();
      ctx.moveTo(toX(p[0]), toY(p[2]));
      for (let i = 1; i <= b._curve.n; i++) ctx.lineTo(toX(p[i * 3]), toY(p[i * 3 + 2]));
      ctx.stroke();
    }
    // buildings
    for (const e of g.factory.ents.values()) {
      const def = BUILDINGS[e.type];
      if (def.kind !== 'bld') continue;
      const [w, , d] = def.size;
      ctx.save();
      ctx.translate(toX(e.x), toY(e.z));
      ctx.rotate(-e.r);
      ctx.fillStyle = def.arch ? 'rgba(170,168,160,0.85)' : def.cat === 'power' ? '#ffd23c' : e.type === 'hub' ? '#ffffff' : '#f39c38';
      ctx.fillRect(-w / 2 * s, -d / 2 * s, Math.max(2, w * s), Math.max(2, d * s));
      ctx.restore();
    }
    // nodes
    for (const n of g.world.nodes) {
      const x = toX(n.x), y = toY(n.z);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3 + n.purity * 1.5 + s * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = NODE_TYPES[n.type].glow;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (s > 2.5) {
        ctx.fillStyle = '#fff';
        ctx.font = '11px sans-serif';
        ctx.fillText(ITEMS[n.type].name, x + 8, y + 4);
      }
    }
    // players
    const drawPlayer = (x, z, yaw, color, name) => {
      const px = toX(x), py = toY(z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(name, px + 10, py - 8);
    };
    for (const [pid, P] of Object.entries(g.state.players)) {
      if (pid === g.pid || !P.online || P.x == null) continue;
      drawPlayer(P.x, P.z, P.yaw || 0, P.color, P.name);
    }
    const me = g.player;
    drawPlayer(me.pos.x, me.pos.z, me.yaw, '#ffffff', 'You');
  }
}
