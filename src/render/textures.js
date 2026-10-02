// Procedurally generated canvas textures — no image assets needed.
import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, w, h, n, rand, cols, size = 1) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cols[Math.floor(rand() * cols.length)];
    ctx.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

export function makeConcreteTexture() {
  const c = canvas(512);
  const ctx = c.getContext('2d');
  const rand = mulberry32(7);
  ctx.fillStyle = '#b8b5ad';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 9000, rand, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)', 'rgba(60,50,40,0.05)'], 2);
  // FICSIT foundation panel layout: 8m tile = whole texture, 4 sub-panels
  ctx.strokeStyle = 'rgba(40,40,40,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 508, 508);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(40,40,40,0.22)';
  ctx.beginPath();
  ctx.moveTo(256, 0); ctx.lineTo(256, 512);
  ctx.moveTo(0, 256); ctx.lineTo(512, 256);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(40,40,40,0.1)';
  ctx.lineWidth = 1;
  for (let i = 64; i < 512; i += 64) {
    if (i === 256) continue;
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i, 512);
    ctx.moveTo(0, i); ctx.lineTo(512, i);
    ctx.stroke();
  }
  // yellow corner markers
  ctx.fillStyle = 'rgba(230,170,40,0.75)';
  for (const [x, y] of [[8, 8], [472, 8], [8, 472], [472, 472]]) ctx.fillRect(x, y, 32, 32);
  ctx.fillStyle = 'rgba(40,40,40,0.5)';
  for (const [x, y] of [[16, 16], [480, 16], [16, 480], [480, 480]]) ctx.fillRect(x, y, 16, 16);
  return tex(c, 1);
}

export function makeHazardTexture() {
  const c = canvas(128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f2b02a';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 + 128, 128); ctx.lineTo(i + 128, 128);
    ctx.closePath();
    ctx.fill();
  }
  return tex(c, 1);
}

export function makeMetalTexture(base = '#8d9399') {
  const c = canvas(256);
  const ctx = c.getContext('2d');
  const rand = mulberry32(11);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.04})`;
    ctx.fillRect(0, y, 256, 1);
  }
  speckle(ctx, 256, 256, 1500, rand, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.05)'], 1.5);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [x, y] of [[8, 8], [244, 8], [8, 244], [244, 244]]) {
    ctx.beginPath(); ctx.arc(x + 2, y + 2, 3, 0, Math.PI * 2); ctx.fill();
  }
  return tex(c, 1);
}

export function makeBeltTexture() {
  const c = canvas(64, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#26282b';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#1a1b1d';
  for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 64, 3);
  ctx.strokeStyle = '#3a3d41';
  ctx.lineWidth = 4;
  for (let y = 0; y < 128; y += 32) {
    ctx.beginPath();
    ctx.moveTo(14, y + 22); ctx.lineTo(32, y + 8); ctx.lineTo(50, y + 22);
    ctx.stroke();
  }
  const t = tex(c, 1);
  t.repeat.set(1, 1);
  return t;
}

export function makeTerrainDetail() {
  const c = canvas(256);
  const ctx = c.getContext('2d');
  const rand = mulberry32(3);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 14000, rand, ['#6e6e6e', '#8e8e8e', '#787878', '#9a9a9a', '#686868'], 2.5);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(60,60,60,0.25)' : 'rgba(170,170,170,0.18)';
    ctx.lineWidth = 1;
    const x = rand() * 256, y = rand() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 6, y - 4 - rand() * 6);
    ctx.stroke();
  }
  const t = tex(c, 1, false);
  return t;
}

export function makeScreenTexture(text = 'FICSIT', color = '#3cc6e8') {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#071820';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.25;
  for (let y = 0; y < 128; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = 'bold 40px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);
  return tex(c, 1);
}

export function makeLogoTexture() {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8862a';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#1d1d1d';
  ctx.font = 'bold 42px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FICSIT', 128, 34);
  return tex(c, 1);
}

export function makeNameTag(text, color = '#f39c12') {
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(15,17,20,0.75)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = color;
  ctx.fillRect(0, 8, 6, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 30px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 16), 132, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeGlowTexture() {
  const c = canvas(128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.6)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makePlanetTexture() {
  const c = canvas(512);
  const ctx = c.getContext('2d');
  const rand = mulberry32(21);
  ctx.save();
  ctx.translate(256, 256);
  // rings behind
  ctx.save();
  ctx.scale(1, 0.22);
  ctx.rotate(-0.25);
  ctx.strokeStyle = 'rgba(230,210,180,0.35)';
  for (let r = 200; r < 250; r += 6) { ctx.lineWidth = 3 + rand() * 3; ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
  // body
  ctx.beginPath();
  ctx.arc(0, 0, 150, 0, Math.PI * 2);
  ctx.clip();
  const bands = ['#c99a6e', '#d9b48a', '#b9845c', '#e2c49c', '#a8714d', '#d4a87a'];
  for (let y = -150; y < 150; y += 14) {
    ctx.fillStyle = bands[Math.floor(rand() * bands.length)];
    ctx.fillRect(-150, y, 300, 14 + rand() * 6);
  }
  const sh = ctx.createRadialGradient(-60, -60, 20, 0, 0, 160);
  sh.addColorStop(0, 'rgba(255,255,255,0.15)');
  sh.addColorStop(0.7, 'rgba(0,0,0,0.1)');
  sh.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = sh;
  ctx.fillRect(-150, -150, 300, 300);
  ctx.restore();
  // rings in front
  ctx.save();
  ctx.translate(256, 256);
  ctx.scale(1, 0.22);
  ctx.rotate(-0.25);
  ctx.strokeStyle = 'rgba(240,220,190,0.55)';
  for (let r = 200; r < 250; r += 6) { ctx.lineWidth = 3 + rand() * 3; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI); ctx.stroke(); }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
