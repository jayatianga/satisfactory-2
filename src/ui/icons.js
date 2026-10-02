// Procedural item icons drawn on canvas, cached as data URLs.
import { ITEMS } from '../data/items.js';

const cache = Object.create(null);

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function poly(ctx, pts, fill, stroke = 'rgba(0,0,0,0.45)') {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

// isometric box helper
function isoBox(ctx, cx, cy, w, d, h, col) {
  const a = [cx, cy - d / 2], b = [cx + w / 2, cy - d / 4 + 0], c = [cx, cy], e = [cx - w / 2, cy - d / 4];
  poly(ctx, [[a[0], a[1] - h], [b[0], b[1] - h], [c[0], c[1] - h], [e[0], e[1] - h]], shade(col, 0.25));
  poly(ctx, [[e[0], e[1] - h], [c[0], c[1] - h], [c[0], c[1]], [e[0], e[1]]], col);
  poly(ctx, [[c[0], c[1] - h], [b[0], b[1] - h], [b[0], b[1]], [c[0], c[1]]], shade(col, -0.3));
}

function draw(ctx, item, S) {
  const c = item.color, c2 = item.c2 || shade(c, 0.4);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  const s = S / 64;
  ctx.scale(s, s);
  switch (item.shape) {
    case 'ore': {
      poly(ctx, [[-20, 6], [-12, -14], [4, -20], [20, -8], [22, 10], [6, 20], [-14, 18]], c);
      poly(ctx, [[-6, -6], [6, -12], [12, -2], [2, 4]], c2);
      poly(ctx, [[-14, 8], [-8, 2], [-2, 10]], shade(c, 0.2));
      break;
    }
    case 'crystal': {
      poly(ctx, [[0, -24], [10, -6], [6, 20], [-6, 20], [-10, -6]], c);
      poly(ctx, [[0, -24], [10, -6], [0, 0]], c2);
      poly(ctx, [[-16, -4], [-8, 4], [-12, 20], [-20, 12]], shade(c, -0.15));
      poly(ctx, [[14, -10], [22, 2], [18, 18], [10, 12]], shade(c, 0.15));
      break;
    }
    case 'ingot': {
      poly(ctx, [[-22, 4], [-10, -8], [22, -8], [12, 4]], shade(c, 0.3));
      poly(ctx, [[-22, 4], [12, 4], [14, 16], [-24, 16]], c);
      poly(ctx, [[12, 4], [22, -8], [24, 4], [14, 16]], shade(c, -0.3));
      break;
    }
    case 'plate': case 'sheet': {
      poly(ctx, [[-24, 2], [0, -14], [24, 2], [0, 18]], c);
      poly(ctx, [[-24, 2], [0, 18], [0, 22], [-24, 6]], shade(c, -0.25));
      poly(ctx, [[0, 18], [24, 2], [24, 6], [0, 22]], shade(c, -0.4));
      if (item.shape === 'plate') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (const [x, y] of [[-12, 2], [12, 2], [0, -6], [0, 10]]) { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 7); ctx.fill(); } }
      break;
    }
    case 'rplate': case 'smart': {
      isoBox(ctx, 0, 14, 44, 40, 10, c);
      poly(ctx, [[-14, -2], [0, -9], [14, -2], [0, 5]], c2);
      if (item.shape === 'smart') { ctx.fillStyle = c2; ctx.fillRect(-4, -22, 8, 10); }
      break;
    }
    case 'rod': case 'pipe': {
      ctx.rotate(-0.7);
      const w = item.shape === 'pipe' ? 9 : 5;
      for (const o of item.shape === 'pipe' ? [0] : [-7, 0, 7]) {
        ctx.fillStyle = c; ctx.fillRect(-24, o - w / 2, 48, w);
        ctx.fillStyle = shade(c, 0.35); ctx.fillRect(-24, o - w / 2, 48, w / 3);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(-24, o - w / 2, 48, w);
        if (item.shape === 'pipe') { ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(24, o, 2, w / 2 - 1.5, 0, 0, 7); ctx.fill(); }
      }
      break;
    }
    case 'beam': case 'ebeam': {
      ctx.rotate(-0.6);
      ctx.fillStyle = item.shape === 'ebeam' ? c : c;
      ctx.fillRect(-26, -10, 52, 20);
      ctx.fillStyle = shade(c, -0.3);
      ctx.fillRect(-26, -4, 52, 8);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeRect(-26, -10, 52, 20);
      if (item.shape === 'ebeam') { ctx.fillStyle = c2; ctx.fillRect(-20, -3, 40, 6); }
      break;
    }
    case 'screw': {
      ctx.rotate(-0.6);
      for (const o of [-9, 9]) {
        ctx.fillStyle = shade(c, -0.2); ctx.fillRect(-14, o - 3, 22, 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        for (let x = -12; x < 8; x += 4) { ctx.beginPath(); ctx.moveTo(x, o - 3); ctx.lineTo(x + 2, o + 3); ctx.stroke(); }
        ctx.fillStyle = c; ctx.fillRect(8, o - 6, 7, 12); ctx.strokeRect(8, o - 6, 7, 12);
      }
      break;
    }
    case 'wire': {
      ctx.strokeStyle = shade(c, -0.25); ctx.lineWidth = 4;
      for (let r = 6; r <= 20; r += 4) { ctx.beginPath(); ctx.ellipse(0, 2, r, r * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = c; ctx.lineWidth = 2;
      for (let r = 6; r <= 20; r += 4) { ctx.beginPath(); ctx.ellipse(0, 1, r, r * 0.7, 0, Math.PI, Math.PI * 2); ctx.stroke(); }
      break;
    }
    case 'cable': {
      ctx.strokeStyle = c; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.ellipse(0, 2, 18, 12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 2, 10, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = c2; ctx.fillRect(14, -2, 10, 6);
      break;
    }
    case 'block': {
      isoBox(ctx, 0, 18, 40, 36, 20, c);
      break;
    }
    case 'frame': case 'vframe': case 'hframe': {
      const col = c;
      isoBox(ctx, 0, 18, 42, 38, 6, shade(col, -0.1));
      ctx.strokeStyle = shade(col, -0.35); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-21, 8); ctx.lineTo(-21, -14); ctx.moveTo(21, 8); ctx.lineTo(21, -14); ctx.moveTo(0, 18); ctx.lineTo(0, -4); ctx.stroke();
      isoBox(ctx, 0, -4, 42, 38, 6, col);
      if (item.shape !== 'frame') { ctx.fillStyle = c2; ctx.fillRect(-6, -8, 12, 18); }
      break;
    }
    case 'rotor': {
      ctx.fillStyle = shade(c, -0.3); ctx.fillRect(-4, -24, 8, 48);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2 + 0.3); poly(ctx, [[0, -2], [22, -6], [22, 6], [0, 2]], c); ctx.restore(); }
      ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
      break;
    }
    case 'stator': case 'motor': {
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, 20, 20, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = c2; ctx.lineWidth = 3;
      for (let r = 8; r < 18; r += 4) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
      if (item.shape === 'motor') { ctx.fillStyle = shade(c, -0.4); ctx.fillRect(16, -4, 10, 8); ctx.fillStyle = c2; ctx.fillRect(-26, -8, 8, 16); }
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      break;
    }
    case 'awiring': {
      isoBox(ctx, 0, 16, 40, 34, 12, c);
      ctx.strokeStyle = c2; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-16, -8); ctx.bezierCurveTo(-4, -26, 8, -2, 18, -16); ctx.stroke();
      break;
    }
    case 'oscillator': {
      isoBox(ctx, 0, 16, 40, 34, 12, c);
      poly(ctx, [[0, -26], [8, -12], [0, 0], [-8, -12]], c2);
      break;
    }
    case 'leaf': {
      for (const [x, y, r] of [[-8, 4, -0.6], [8, 0, 0.5], [0, -8, 0]]) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(r);
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, 8, 16, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = c2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 14); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'log': {
      ctx.rotate(-0.4);
      ctx.fillStyle = c; ctx.fillRect(-22, -9, 40, 18);
      ctx.fillStyle = c2; ctx.beginPath(); ctx.ellipse(18, 0, 5, 9, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(18, 0, 2.5, 5, 0, 0, 7); ctx.stroke();
      break;
    }
    case 'mush': {
      ctx.fillStyle = '#e0d8e8'; ctx.fillRect(-4, -2, 8, 20);
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -4, 20, 12, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = c2; for (const [x, y] of [[-8, -9], [6, -11], [0, -6]]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
      break;
    }
    case 'bale': {
      isoBox(ctx, 0, 16, 40, 34, 18, c);
      ctx.strokeStyle = c2; ctx.lineWidth = 2;
      for (let i = -12; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(i - 8, 6); ctx.lineTo(i + 4, 0); ctx.stroke(); }
      break;
    }
    case 'pellet': case 'powder': {
      for (const [x, y] of [[-10, 6], [6, 8], [-2, -4], [12, -6], [-12, -8], [2, 16], [16, 10]]) {
        ctx.fillStyle = (x + y) % 2 ? c : c2;
        ctx.beginPath(); ctx.arc(x, y, item.shape === 'powder' ? 7 : 5, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
      }
      break;
    }
    case 'shard': {
      poly(ctx, [[0, -26], [14, -4], [0, 26], [-14, -4]], c);
      poly(ctx, [[0, -26], [14, -4], [0, 0]], c2);
      break;
    }
    default:
      ctx.fillStyle = c; ctx.fillRect(-18, -18, 36, 36);
  }
  ctx.restore();
}

export function itemIcon(id, size = 64) {
  const key = id + '@' + size;
  if (cache[key]) return cache[key];
  const it = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (it) draw(ctx, it, size);
  cache[key] = c.toDataURL();
  return cache[key];
}

// Renders 3D building thumbnails through the game's own renderer into an
// offscreen render target (no extra WebGL context needed).
export async function buildingIcons(THREE, buildTemplate, BUILDINGS, renderer) {
  const out = Object.create(null);
  const size = 128;
  if (!renderer) return out;
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#666666', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.8);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  const px = new Uint8Array(size * size * 4);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    // linear -> sRGB with a gentle filmic shoulder
    const t = v / (1 + v * 0.35) * 1.35;
    lut[i] = Math.round(255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(Math.min(1, t), 1 / 2.4) - 0.055));
  }
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (def.kind !== 'bld' || def.crate) continue;
    const obj = buildTemplate(id).clone(true);
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const sz = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.95;
    cam.position.set(ctr.x + r * 1.25, ctr.y + r * 0.85, ctr.z + r * 1.6);
    cam.lookAt(ctr);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ((size - 1 - y) * size + x) * 4, d = (y * size + x) * 4;
        img.data[d] = lut[px[s]];
        img.data[d + 1] = lut[px[s + 1]];
        img.data[d + 2] = lut[px[s + 2]];
        img.data[d + 3] = px[s + 3];
      }
    }
    ctx.putImageData(img, 0, 0);
    out[id] = c.toDataURL();
    scene.remove(obj);
    renderer.setRenderTarget(prevTarget);
    await new Promise(r2 => setTimeout(r2, 0));
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return out;
}
