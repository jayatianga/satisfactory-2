// Network transports. All share the same shape:
//   Host:   start() -> Promise<code>; onJoin(peer), onMsg(peer, msg), onLeave(peer); send(peer, msg); close()
//   Client: connect(code) -> Promise; onMsg(msg), onClose(reason); send(msg); close()
//
// Online (default): PeerJS / WebRTC — peer-to-peer, works across networks using
// the free public PeerJS signalling server. Relay: a tiny WebSocket relay
// (server/relay.js) for networks where WebRTC is blocked. Local: BroadcastChannel
// between tabs of the same browser (for testing).
import { randomCode } from '../core/util.js';

const CHUNK = 12000;
const PREFIX = 'sf2-';

export function encode(obj) {
  const s = JSON.stringify(obj);
  if (s.length <= CHUNK) return [s];
  const id = Math.random().toString(36).slice(2, 10);
  const n = Math.ceil(s.length / CHUNK);
  const out = [];
  for (let i = 0; i < n; i++) out.push(`~${id}:${i}:${n}:` + s.slice(i * CHUNK, (i + 1) * CHUNK));
  return out;
}

export class Reassembler {
  constructor() { this.parts = new Map(); }
  feed(str) {
    if (typeof str !== 'string') {
      try { str = new TextDecoder().decode(str); } catch (e) { return null; }
    }
    if (str[0] !== '~') {
      try { return JSON.parse(str); } catch (e) { return null; }
    }
    const m = /^~([^:]+):(\d+):(\d+):/.exec(str);
    if (!m) return null;
    const [head, id, iS, nS] = m;
    const i = +iS, n = +nS;
    let p = this.parts.get(id);
    if (!p) { p = { got: 0, arr: new Array(n) }; this.parts.set(id, p); }
    if (p.arr[i] == null) { p.arr[i] = str.slice(head.length); p.got++; }
    if (p.got === n) {
      this.parts.delete(id);
      try { return JSON.parse(p.arr.join('')); } catch (e) { return null; }
    }
    return null;
  }
}

// Optional self-hosted PeerJS signalling server, e.g. "my-peer.example.com" or "http://localhost:9000/".
export function peerOptions(opts) {
  const o = { debug: 1, config: { iceServers: defaultIce(opts.ice) } };
  const str = (opts.peerServer || '').trim();
  if (str) {
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(str) ? str : 'https://' + str);
      o.host = u.hostname;
      o.secure = u.protocol === 'https:' || u.protocol === 'wss:';
      o.port = u.port ? Number(u.port) : (o.secure ? 443 : 80);
      o.path = u.pathname || '/';
    } catch (e) { /* ignore malformed */ }
  }
  return o;
}

export function defaultIce(extra) {
  const ice = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (Array.isArray(extra)) ice.push(...extra);
  return ice;
}

// ------------------------------------------------------------------ PeerJS
export class PeerHost {
  constructor(opts = {}) {
    this.opts = opts;
    this.conns = new Map();
    this.onJoin = () => {};
    this.onMsg = () => {};
    this.onLeave = () => {};
    this.onStatus = () => {};
  }

  start(code) {
    if (!window.Peer) return Promise.reject(new Error('PeerJS failed to load (are you offline?)'));
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const c = code || randomCode(6);
        const peer = new window.Peer(PREFIX + c, peerOptions(this.opts));
        this.peer = peer;
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.code = c;
          resolve(c);
        });
        peer.on('error', (err) => {
          if (!opened && err.type === 'unavailable-id' && tries++ < 4) { peer.destroy(); code = null; attempt(); return; }
          if (!opened) { reject(new Error(describePeerError(err))); return; }
          this.onStatus('error', describePeerError(err));
        });
        peer.on('disconnected', () => {
          // lost the signalling server; existing peers keep working, try to get it back for new joins
          this.onStatus('signal-lost');
          setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { /* ignore */ } }, 2000);
        });
        peer.on('connection', (conn) => this.accept(conn));
      };
      attempt();
    });
  }

  accept(conn) {
    const id = conn.peer + ':' + conn.connectionId;
    const re = new Reassembler();
    conn.on('open', () => {
      this.conns.set(id, conn);
      this.onJoin(id);
    });
    conn.on('data', (d) => {
      const msg = re.feed(d);
      if (msg) this.onMsg(id, msg);
    });
    const leave = () => {
      if (!this.conns.has(id)) return;
      this.conns.delete(id);
      this.onLeave(id);
    };
    conn.on('close', leave);
    conn.on('error', leave);
    conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') leave(); });
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (!c || !c.open) return;
    for (const part of encode(msg)) c.send(part);
  }

  broadcast(msg, except) {
    const parts = encode(msg);
    for (const [id, c] of this.conns) {
      if (id === except || !c.open) continue;
      for (const p of parts) c.send(p);
    }
  }

  kick(id) {
    const c = this.conns.get(id);
    if (c) c.close();
  }

  close() {
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
    this.conns.clear();
  }
}

export class PeerClient {
  constructor(opts = {}) {
    this.opts = opts;
    this.onMsg = () => {};
    this.onClose = () => {};
    this.re = new Reassembler();
  }

  connect(code) {
    if (!window.Peer) return Promise.reject(new Error('PeerJS failed to load (are you offline?)'));
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(peerOptions(this.opts));
      this.peer = peer;
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject(new Error('Timed out connecting. Check the code, or try the Relay option.')); peer.destroy(); }
      }, 25000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
        this.conn = conn;
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (d) => {
          const msg = this.re.feed(d);
          if (msg) this.onMsg(msg);
        });
        conn.on('close', () => this.onClose('Connection to host closed'));
        conn.on('error', (e) => this.onClose('Connection error: ' + (e && e.message)));
        conn.on('iceStateChanged', (s) => { if (s === 'failed') this.onClose('Connection lost (network)'); });
      });
      peer.on('error', (err) => {
        if (!done) { done = true; clearTimeout(timer); reject(new Error(describePeerError(err))); return; }
        if (err.type !== 'peer-unavailable') this.onClose(describePeerError(err));
      });
    });
  }

  send(msg) {
    if (!this.conn || !this.conn.open) return;
    for (const p of encode(msg)) this.conn.send(p);
  }

  close() {
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
  }
}

function describePeerError(err) {
  const t = err && err.type;
  switch (t) {
    case 'peer-unavailable': return 'No game found with that code. Check the code and make sure the host is online.';
    case 'network': return 'Could not reach the matchmaking server. Check your internet connection.';
    case 'server-error': return 'Matchmaking server error. Try again, or use the Relay option.';
    case 'browser-incompatible': return 'Your browser does not support WebRTC.';
    case 'unavailable-id': return 'That game code is already taken.';
    default: return (err && err.message) || String(err);
  }
}

// ------------------------------------------------------------------ WebSocket relay
function wsUrl(url) {
  if (!url) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  if (/^https?:/.test(url)) url = url.replace(/^http/, 'ws');
  if (!/^wss?:/.test(url)) url = 'wss://' + url;
  if (!/\/ws$/.test(url)) url = url.replace(/\/$/, '') + '/ws';
  return url;
}

export class RelayHost {
  constructor(opts = {}) {
    this.url = wsUrl(opts.url);
    this.res = new Map();
    this.peers = new Set();
    this.onJoin = () => {};
    this.onMsg = () => {};
    this.onLeave = () => {};
    this.onStatus = () => {};
  }

  start() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'host' }));
      ws.onerror = () => { if (!opened) reject(new Error('Could not reach relay server at ' + this.url)); };
      ws.onclose = () => { if (opened) this.onStatus('error', 'Relay connection closed'); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'hosted') { opened = true; this.code = m.code; resolve(m.code); }
        else if (m.type === 'peer-join') { this.peers.add(m.id); this.res.set(m.id, new Reassembler()); this.onJoin(m.id); }
        else if (m.type === 'peer-leave') { this.peers.delete(m.id); this.res.delete(m.id); this.onLeave(m.id); }
        else if (m.type === 'from') {
          const r = this.res.get(m.id);
          const msg = r && r.feed(m.data);
          if (msg) this.onMsg(m.id, msg);
        }
      };
    });
  }

  send(id, msg) {
    if (!this.ws || this.ws.readyState !== 1) return;
    for (const p of encode(msg)) this.ws.send(JSON.stringify({ type: 'to', id, data: p }));
  }

  broadcast(msg, except) {
    for (const id of this.peers) if (id !== except) this.send(id, msg);
  }

  kick(id) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'kick', id }));
  }

  close() { try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
}

export class RelayClient {
  constructor(opts = {}) {
    this.url = wsUrl(opts.url);
    this.re = new Reassembler();
    this.onMsg = () => {};
    this.onClose = () => {};
  }

  connect(code) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let ok = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code }));
      ws.onerror = () => { if (!ok) reject(new Error('Could not reach relay server at ' + this.url)); };
      ws.onclose = () => { if (ok) this.onClose('Relay connection closed'); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'joined') { ok = true; resolve(); }
        else if (m.type === 'error') { if (!ok) reject(new Error(m.msg)); }
        else if (m.type === 'host-left') this.onClose('The host left the game');
        else if (m.type === 'data') {
          const msg = this.re.feed(m.data);
          if (msg) this.onMsg(msg);
        }
      };
    });
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) return;
    for (const p of encode(msg)) this.ws.send(JSON.stringify({ type: 'data', data: p }));
  }

  close() { try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } }
}

// ------------------------------------------------------------------ same-browser (testing)
export class LocalHost {
  constructor() {
    this.onJoin = () => {};
    this.onMsg = () => {};
    this.onLeave = () => {};
    this.onStatus = () => {};
    this.peers = new Set();
  }

  start(code) {
    this.code = code || randomCode(6);
    this.ch = new BroadcastChannel(PREFIX + this.code);
    this.ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.to !== 'host') return;
      if (m.type === 'join') { this.peers.add(m.from); this.onJoin(m.from); this.ch.postMessage({ to: m.from, type: 'joined' }); }
      else if (m.type === 'leave') { this.peers.delete(m.from); this.onLeave(m.from); }
      else if (m.type === 'data') this.onMsg(m.from, JSON.parse(m.data));
    };
    return Promise.resolve(this.code);
  }

  send(id, msg) { this.ch.postMessage({ to: id, type: 'data', data: JSON.stringify(msg) }); }
  broadcast(msg, except) { for (const id of this.peers) if (id !== except) this.send(id, msg); }
  kick() {}
  close() { try { this.ch.close(); } catch (e) { /* ignore */ } }
}

export class LocalClient {
  constructor() {
    this.id = 'local-' + Math.random().toString(36).slice(2, 8);
    this.onMsg = () => {};
    this.onClose = () => {};
  }

  connect(code) {
    code = code.trim().toUpperCase();
    this.ch = new BroadcastChannel(PREFIX + code);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No local game with that code')), 3000);
      this.ch.onmessage = (ev) => {
        const m = ev.data;
        if (m.to !== this.id) return;
        if (m.type === 'joined') { clearTimeout(t); resolve(); }
        else if (m.type === 'data') this.onMsg(JSON.parse(m.data));
      };
      this.ch.postMessage({ to: 'host', from: this.id, type: 'join' });
      window.addEventListener('beforeunload', () => this.close());
    });
  }

  send(msg) { this.ch.postMessage({ to: 'host', from: this.id, type: 'data', data: JSON.stringify(msg) }); }
  close() { try { this.ch.postMessage({ to: 'host', from: this.id, type: 'leave' }); this.ch.close(); } catch (e) { /* ignore */ } }
}

export function makeHost(method, settings) {
  if (method === 'relay') return new RelayHost({ url: settings.relayUrl });
  if (method === 'local') return new LocalHost();
  return new PeerHost({ ice: settings.extraIce, peerServer: settings.peerServer });
}

export function makeClient(method, settings) {
  if (method === 'relay') return new RelayClient({ url: settings.relayUrl });
  if (method === 'local') return new LocalClient();
  return new PeerClient({ ice: settings.extraIce, peerServer: settings.peerServer });
}
