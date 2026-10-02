#!/usr/bin/env node
// Optional self-hosted server for Satisfactory 2.
//  - Serves the game files (so you can play at http://localhost:8080)
//  - Runs a WebSocket relay at /ws for the "Relay" multiplayer mode, for
//    networks where peer-to-peer WebRTC connections are blocked.
//
// Usage:  npm install && npm start        (PORT env var to change the port)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
  const file = path.resolve(ROOT, '.' + url);
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git`)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });
const rooms = new Map(); // code -> { host: ws, peers: Map<id, ws> }
let nextId = 1;

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s;
  do {
    s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(s));
  return s;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'host' && !ws.room) {
      const c = code();
      rooms.set(c, { host: ws, peers: new Map() });
      ws.room = c;
      ws.isHost = true;
      send(ws, { type: 'hosted', code: c });
      console.log(`[relay] room ${c} opened (${rooms.size} active)`);
    } else if (m.type === 'join' && !ws.room) {
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) { send(ws, { type: 'error', msg: 'No game found with that code' }); return; }
      const id = 'p' + nextId++;
      ws.room = String(m.code).toUpperCase();
      ws.peerId = id;
      room.peers.set(id, ws);
      send(ws, { type: 'joined', id });
      send(room.host, { type: 'peer-join', id });
    } else if (m.type === 'to' && ws.isHost) {
      const room = rooms.get(ws.room);
      if (room) send(room.peers.get(m.id), { type: 'data', data: m.data });
    } else if (m.type === 'data' && ws.peerId) {
      const room = rooms.get(ws.room);
      if (room) send(room.host, { type: 'from', id: ws.peerId, data: m.data });
    } else if (m.type === 'kick' && ws.isHost) {
      const room = rooms.get(ws.room);
      const p = room && room.peers.get(m.id);
      if (p) p.close();
    }
  });
  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.isHost) {
      for (const p of room.peers.values()) { send(p, { type: 'host-left' }); p.close(); }
      rooms.delete(ws.room);
      console.log(`[relay] room ${ws.room} closed`);
    } else if (ws.peerId) {
      room.peers.delete(ws.peerId);
      send(room.host, { type: 'peer-leave', id: ws.peerId });
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`Satisfactory 2 server running:  http://localhost:${PORT}`);
  console.log(`Relay endpoint:                 ws://localhost:${PORT}/ws`);
});
