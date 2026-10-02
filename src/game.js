// Ties together simulation, rendering, the local player, UI and networking.
// The host runs the authoritative simulation and validates every action;
// clients run the same simulation locally for smooth visuals and adopt the
// host's periodic snapshots.
import { BUILDINGS } from './data/buildings.js';
import { Factory, TICK, serializeEnt, serializeState, playerSlotCount } from './sim/factory.js';
import { handleAction, invAccess } from './sim/actions.js';
import { applySimEvent } from './sim/replicate.js';
import { makeSlots, resizeSlots, isEmpty } from './sim/inventory.js';
import { View } from './render/view.js';
import { Player } from './player/player.js';
import { BuildGun } from './player/buildgun.js';
import { Interact } from './player/interact.js';
import { toLocal } from './core/util.js';
import { FLORA } from './world/world.js';

export const PROTOCOL = 3;
const SNAP_INTERVAL = 1.0;
const PS_INTERVAL = 1 / 15;
const AUTOSAVE = 60;
const PEER_TIMEOUT = 90000;

export class Game {
  constructor(o) {
    this.role = o.role;
    this.isHost = o.role === 'host';
    this.state = o.state;
    this.world = o.world;
    this.pid = o.pid;
    this.settings = o.settings;
    this.ui = o.ui;
    this.audio = o.audio;
    this.input = o.input;
    this.saveId = o.saveId || null;
    this.net = null;
    this.netCode = null;
    this.netMethod = null;
    this.peers = new Map();
    this.outbox = [];
    this.acc = 0;
    this.snapTimer = 0;
    this.psTimer = 0;
    this.saveTimer = AUTOSAVE;
    this.running = true;
    this.factory = new Factory(this.state, this.world);
    this.factory.hooks = this.isHost ? {
      onTrip: () => { this.notify('Power fuse tripped! Reset it at a generator.', 'err'); this.sfxAll('fuse'); },
      onCoupon: () => this.notify('FICSIT Coupon earned at the AWESOME Sink!', 'good'),
    } : {};
    this.view = new View(o.canvas, this.world, this.factory, this.settings);
    for (const e of this.state.ents.values()) this.view.addEnt(e);
    this.player = new Player(this);
    this.build = new BuildGun(this);
    this.interact = new Interact(this);
    if (this.isHost && !this.state.players[this.pid]) this.createPlayer(this.pid, o.name, o.color);
    const me = this.me;
    me.online = true;
    if (me.x != null && me.y != null) {
      this.player.pos.set(me.x, me.y, me.z);
      this.player.yaw = me.yaw || 0;
    } else {
      const a = this.world.spawnAngle + Math.PI;
      this.player.spawnAt(Math.cos(a) * 6, Math.sin(a) * 6, 0);
    }
    for (const [pid, P] of Object.entries(this.state.players)) {
      if (pid !== this.pid && P.online && P.x != null) this.view.updateRemote(pid, { x: P.x, y: P.y, z: P.z, yaw: P.yaw || 0 }, P.name, P.color);
    }
  }

  get me() { return this.state.players[this.pid]; }

  createPlayer(pid, name, color) {
    const a = this.world.spawnAngle + Math.PI + Object.keys(this.state.players).length * 0.6;
    const x = Math.cos(a) * 7, z = Math.sin(a) * 7;
    const P = {
      name: name || pid, color: color || '#e8862a',
      inv: makeSlots(playerSlotCount(this.state)),
      x, y: this.world.heightAt(x, z) + 0.1, z, yaw: 0, online: true,
    };
    this.state.players[pid] = P;
    return P;
  }

  // ================================================================ actions
  dispatch(a) {
    if (this.isHost) handleAction(this, this.pid, a);
    else if (this.net) this.net.send({ t: 'act', a });
  }

  // ---------- host-side event helpers (called by sim/actions.js) ----------
  out(ev) {
    if (this.isHost && this.net) this.outbox.push(ev);
  }

  addEnt(e) {
    if (!this.factory.addEntity(e)) return;
    this.view.addEnt(e);
    this.out({ k: 'add', e: serializeEnt(e) });
    this.ui.entChanged(e.id);
  }

  delEnt(id) {
    const e = this.factory.removeEntity(id);
    if (!e) return;
    this.view.removeEnt(id);
    this.out({ k: 'del', id });
    this.ui.entChanged(id, true);
  }

  updEnt(e) {
    this.view.updateEnt(e);
    this.out({ k: 'upd', e: serializeEnt(e) });
    this.ui.entChanged(e.id);
  }

  updInv(pid) {
    const P = this.state.players[pid];
    if (!P) return;
    if (pid === this.pid) this.ui.invChanged();
    this.out({ k: 'inv', pid, inv: P.inv });
  }

  updProg() {
    this.ui.progChanged();
    this.out({ k: 'prog', p: this.state.prog });
  }

  notify(text, kind = 'info', pid = null) {
    if (!pid || pid === this.pid) this.ui.notify(text, kind);
    this.out({ k: 'msg', text, kind, pid });
  }

  removeFlora(ids) {
    for (const id of ids) this.state.floraGone.add(id);
    this.view.removeFlora(ids);
    this.out({ k: 'flora', ids });
  }

  clearFloraFor(e) {
    const def = BUILDINGS[e.type];
    if (!def.size) return;
    const [w, , d] = def.size;
    const ids = [];
    this.world.floraNear(e.x, e.z, Math.hypot(w, d) / 2 + 2, (f) => {
      if (this.state.floraGone.has(f.id)) return;
      const [lx, lz] = toLocal(e, f.x, f.z);
      const m = f.type === FLORA.TREE || f.type === FLORA.PINE ? 1.2 : 0.4;
      if (Math.abs(lx) < w / 2 + m && Math.abs(lz) < d / 2 + m && f.y < e.y + def.size[1] + 1) ids.push(f.id);
    });
    if (ids.length) this.removeFlora(ids);
  }

  sfx(name, x, y, z, global = false) {
    this.playSfxAt(name, x, y, z, global);
    this.out({ k: 'sfx', n: name, x, y, z, g: global });
  }

  sfxAll(name) { this.sfx(name, 0, 0, 0, true); }

  playSfxAt(name, x, y, z, global) {
    if (global) { this.audio.play(name); return; }
    const p = this.player.pos;
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (d < 60) this.audio.play(name, Math.max(0.15, 1 - d / 60));
  }

  invAccess(pid, ref) {
    return invAccess(this.state, this.factory, pid, ref);
  }

  afterXfer(pid, ref) {
    if (ref.p) { this.updInv(pid); return; }
    const e = this.factory.get(ref.e);
    if (!e) return;
    if (BUILDINGS[e.type].crate && isEmpty(e.slots)) { this.delEnt(e.id); return; }
    this.updEnt(e);
  }

  // ================================================================ client events
  applyEvent(ev) {
    if (ev.k === 'msg') {
      if (!ev.pid || ev.pid === this.pid) this.ui.notify(ev.text, ev.kind);
      return;
    }
    if (ev.k === 'sfx') {
      this.playSfxAt(ev.n, ev.x, ev.y, ev.z, ev.g);
      return;
    }
    const r = applySimEvent(this.state, this.factory, ev);
    if (r.replaced != null) this.view.removeEnt(r.replaced);
    if (r.added) { this.view.addEnt(r.added); this.ui.entChanged(r.added.id); }
    if (r.removed != null) { this.view.removeEnt(r.removed); this.ui.entChanged(r.removed, true); }
    if (r.updated) { this.view.updateEnt(r.updated); this.ui.entChanged(r.updated.id); }
    if (r.inv === this.pid) this.ui.invChanged();
    if (r.prog) this.ui.progChanged();
    if (r.flora) this.view.removeFlora(r.flora);
  }

  // ================================================================ networking
  async startHosting(transport, method) {
    this.net = transport;
    this.netMethod = method;
    transport.onJoin = (peer) => { this.peers.set(peer, { pid: null, seen: performance.now() }); };
    transport.onLeave = (peer) => this.onPeerLeave(peer);
    transport.onMsg = (peer, msg) => this.onHostMsg(peer, msg);
    transport.onStatus = (kind, text) => { if (kind === 'error') this.ui.notify(text, 'err'); };
    this.netCode = await transport.start();
    this.ui.netChanged();
    return this.netCode;
  }

  stopHosting() {
    if (!this.net) return;
    this.broadcast({ t: 'kick', reason: 'The host closed the session.' });
    this.net.close();
    this.net = null;
    this.netCode = null;
    for (const [, info] of this.peers) {
      if (info.pid) {
        this.state.players[info.pid].online = false;
        this.view.removeRemote(info.pid);
      }
    }
    this.peers.clear();
    this.ui.netChanged();
  }

  broadcast(msg, except) {
    if (this.net && this.isHost) this.net.broadcast(msg, except);
  }

  flush() {
    if (!this.outbox.length) return;
    const e = this.outbox;
    this.outbox = [];
    this.broadcast({ t: 'ev', e });
  }

  claimName(name) {
    let base = String(name || 'Pioneer').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Pioneer';
    let pid = base;
    let n = 2;
    while (this.state.players[pid] && this.state.players[pid].online) pid = `${base} (${n++})`;
    return pid;
  }

  onHostMsg(peer, msg) {
    const info = this.peers.get(peer);
    if (!info) return;
    info.seen = performance.now();
    if (msg.t === 'hello') {
      if (msg.ver !== PROTOCOL) {
        this.net.send(peer, { t: 'kick', reason: 'Game version mismatch — both players should refresh the page.' });
        return;
      }
      const pid = this.claimName(msg.name);
      info.pid = pid;
      const P = this.state.players[pid] || this.createPlayer(pid, pid, msg.color);
      P.online = true;
      P.color = msg.color || P.color;
      resizeSlots(P.inv, playerSlotCount(this.state));
      this.flush();
      this.net.send(peer, { t: 'welcome', pid, code: this.netCode, save: serializeState(this.state) });
      this.broadcast({ t: 'pj', pid, P: { name: P.name, color: P.color, inv: P.inv, x: P.x, y: P.y, z: P.z, yaw: P.yaw, online: true } }, peer);
      this.view.updateRemote(pid, { x: P.x, y: P.y, z: P.z, yaw: P.yaw || 0 }, P.name, P.color);
      this.notify(`${P.name} joined the game`, 'good');
      this.audio.play('notify');
      this.ui.netChanged();
      return;
    }
    const pid = info.pid;
    if (!pid) return;
    const P = this.state.players[pid];
    switch (msg.t) {
      case 'ps':
        P.x = msg.p[0]; P.y = msg.p[1]; P.z = msg.p[2]; P.yaw = msg.yaw;
        this.view.updateRemote(pid, { x: P.x, y: P.y, z: P.z, yaw: msg.yaw, pitch: msg.pitch }, P.name, P.color);
        this.broadcast({ t: 'ps', pid, p: msg.p, yaw: msg.yaw, pitch: msg.pitch }, peer);
        break;
      case 'act':
        handleAction(this, pid, msg.a || {});
        this.flush(); // reply right away instead of waiting for the next frame
        break;
      case 'bye':
        this.onPeerLeave(peer);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 200);
        if (!text) break;
        this.broadcast({ t: 'chat', from: P.name, color: P.color, text });
        this.ui.chat(P.name, P.color, text);
        break;
      }
      default: break;
    }
  }

  onPeerLeave(peer) {
    const info = this.peers.get(peer);
    this.peers.delete(peer);
    if (!info || !info.pid) return;
    const P = this.state.players[info.pid];
    if (P) P.online = false;
    this.view.removeRemote(info.pid);
    this.broadcast({ t: 'pl', pid: info.pid });
    this.notify(`${info.pid} left the game`, 'warn');
    this.ui.netChanged();
  }

  // client side
  attachClient(transport, code, method) {
    this.net = transport;
    this.netCode = code;
    this.netMethod = method;
    transport.onMsg = (msg) => this.onClientMsg(msg);
    transport.onClose = (reason) => this.onDisconnected(reason);
  }

  onClientMsg(msg) {
    switch (msg.t) {
      case 'ev':
        for (const e of msg.e) this.applyEvent(e);
        break;
      case 'snap':
        this.factory.applySnapshot(msg.s);
        this.ui.progChanged(true);
        break;
      case 'ps': {
        const P = this.state.players[msg.pid];
        if (!P || msg.pid === this.pid) break;
        P.x = msg.p[0]; P.y = msg.p[1]; P.z = msg.p[2]; P.yaw = msg.yaw;
        this.view.updateRemote(msg.pid, { x: P.x, y: P.y, z: P.z, yaw: msg.yaw, pitch: msg.pitch }, P.name, P.color);
        break;
      }
      case 'pj':
        this.state.players[msg.pid] = msg.P;
        this.view.updateRemote(msg.pid, msg.P, msg.P.name, msg.P.color);
        this.ui.netChanged();
        break;
      case 'pl': {
        const P = this.state.players[msg.pid];
        if (P) P.online = false;
        this.view.removeRemote(msg.pid);
        this.ui.netChanged();
        break;
      }
      case 'chat':
        this.ui.chat(msg.from, msg.color, msg.text);
        break;
      case 'kick':
        this.onDisconnected(msg.reason || 'Disconnected by host');
        break;
      default: break;
    }
  }

  onDisconnected(reason) {
    if (!this.running || this.isHost) return;
    this.running = false;
    this.ui.disconnected(reason);
  }

  sendChat(text) {
    text = String(text).trim().slice(0, 200);
    if (!text) return;
    const me = this.me;
    if (this.isHost) {
      this.broadcast({ t: 'chat', from: me.name, color: me.color, text });
      this.ui.chat(me.name, me.color, text);
    } else if (this.net) {
      this.net.send({ t: 'chat', text });
    }
  }

  // ================================================================ save
  saveData() {
    const me = this.me;
    me.x = this.player.pos.x; me.y = this.player.pos.y; me.z = this.player.pos.z; me.yaw = this.player.yaw;
    const data = serializeState(this.state);
    for (const P of Object.values(data.players)) P.online = false;
    return data;
  }

  // ================================================================ frame
  // Simulation + networking. Also driven from a worker heartbeat while the tab
  // is hidden, so a host that alt-tabs keeps the world running for its guests.
  tickCore(dt, maxSteps) {
    if (!this.running) return;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK && steps < maxSteps) {
      this.factory.tick(TICK);
      this.acc -= TICK;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    // keep our own record up to date (used by the host for reach checks)
    const me = this.me;
    me.x = this.player.pos.x; me.y = this.player.pos.y; me.z = this.player.pos.z; me.yaw = this.player.yaw;
    // networking
    if (this.net) {
      this.psTimer -= dt;
      if (this.psTimer <= 0) {
        this.psTimer = PS_INTERVAL;
        const p = [round2(me.x), round2(me.y), round2(me.z)];
        const msg = { t: 'ps', p, yaw: round2(this.player.yaw), pitch: round2(this.player.pitch) };
        if (this.isHost) this.broadcast({ ...msg, pid: this.pid });
        else this.net.send(msg);
      }
      if (this.isHost) {
        // drop peers that silently vanished (closed laptop, lost network…)
        const now = performance.now();
        for (const [peer, info] of this.peers) {
          if (now - info.seen > PEER_TIMEOUT) {
            if (this.net.kick) this.net.kick(peer);
            this.onPeerLeave(peer);
          }
        }
        this.snapTimer -= dt;
        if (this.snapTimer <= 0) {
          this.snapTimer = SNAP_INTERVAL;
          this.flush();
          if (this.peers.size) this.broadcast({ t: 'snap', s: this.factory.snapshot() });
        }
        this.flush();
      }
    }
    if (this.isHost) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) {
        this.saveTimer = AUTOSAVE;
        this.ui.autosave();
      }
    }
  }

  frame(dt) {
    if (!this.running) return;
    const input = this.input;
    const uiBlocking = this.ui.blocking();
    const active = input.locked && !uiBlocking;
    this.player.update(dt, input, active);
    if (active) {
      this.build.update(dt, input);
      this.interact.update(dt, input);
    } else {
      this.interact.clear();
    }
    this.tickCore(dt, 6);
    const alpha = Math.min(1, this.acc / TICK);
    // ambient factory hum
    this.humTimer = (this.humTimer || 0) - dt;
    if (this.humTimer <= 0) {
      this.humTimer = 0.5;
      let n = 0;
      const p = this.player.pos;
      for (const e of this.factory.near(p.x, p.z, 30)) if (e.working && e._powered) n++;
      this.audio.setHum(n);
    }
    this.player.applyCamera(this.view.camera);
    this.view.flashlight.intensity = this.flashlight ? 60 : 0;
    this.view.update(dt, alpha, this.view.camera.position, this.state.time);
    this.ui.update(dt);
  }

  // tab is closing: tell the other side right away
  goodbye() {
    if (!this.net) return;
    try {
      if (this.isHost) this.broadcast({ t: 'kick', reason: 'The host left the game.' });
      else this.net.send({ t: 'bye' });
    } catch (e) { /* ignore */ }
  }

  dispose() {
    this.running = false;
    if (this.net) {
      if (this.isHost) this.stopHosting();
      else this.net.close();
    }
    this.view.dispose();
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
