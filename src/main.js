// App entry: main menu, settings, saves, starting/joining games and the frame loop.
import { World } from './world/world.js';
import { createState, deserializeState, playerSlotCount } from './sim/factory.js';
import { Game, PROTOCOL } from './game.js';
import { UI } from './ui/ui.js';
import { Input } from './player/input.js';
import { Audio } from './audio.js';
import { makeHost, makeClient } from './net/transport.js';
import { hashString, escapeHtml } from './core/util.js';
import { BUILDINGS } from './data/buildings.js';
import { RECIPES } from './data/recipes.js';
import { ITEMS } from './data/items.js';
import { addItem } from './sim/inventory.js';

const VERSION = '1.0.0';
const COLORS = ['#e8862a', '#3d9be8', '#5ad06a', '#e84a5f', '#b06ae8', '#f2d03b', '#3de0c8', '#ffffff'];
const SETTINGS_KEY = 'sf2:settings';
const SAVES_KEY = 'sf2:saves';

const DEFAULT_SETTINGS = {
  name: 'Pioneer', color: COLORS[0], sensitivity: 1, invertY: false, fov: 75, viewDistance: 650, shadows: true,
  pixelRatio: 1.5, volume: 0.5, relayUrl: '', peerServer: '', extraIce: '', showFps: false, hotbar: null,
};

class App {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = this.loadSettings();
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.ui = new UI(document.getElementById('ui'), this);
    this.game = null;
    this.menuEl = document.getElementById('menu');
    this.menuEl.addEventListener('click', (e) => this.onMenuClick(e));
    this.menuEl.addEventListener('change', (e) => { if (e.target.getAttribute('data-change') === 'setting') this.changeSetting(e.target); });
    this.canvas.addEventListener('click', () => {
      this.audio.ensure();
      if (this.game && !this.ui.blocking()) this.input.lock();
    });
    document.addEventListener('keydown', () => this.audio.ensure(), { once: true });
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    // Background heartbeat: requestAnimationFrame stops in hidden tabs, but a
    // worker timer keeps firing, so the simulation and networking keep going.
    try {
      const blob = new Blob(['setInterval(() => postMessage(0), 100);'], { type: 'text/javascript' });
      this.beat = new Worker(URL.createObjectURL(blob));
      this.beat.onmessage = () => this.background();
    } catch (e) { /* workers unavailable: background play pauses */ }
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get('join')) {
      this.pendingJoin = { code: hash.get('join'), method: hash.get('m') || 'online', relay: hash.get('r') || '' };
      this.showMenu('join');
    } else this.showMenu('main');
    window.addEventListener('beforeunload', () => {
      if (this.game && this.game.isHost) this.saveGame(this.game, true);
    });
    window.addEventListener('pagehide', () => { if (this.game) this.game.goodbye(); });
  }

  // ================================================================ settings
  loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { s = {}; }
    const out = { ...DEFAULT_SETTINGS, ...s };
    if (!Array.isArray(out.hotbar) || out.hotbar.length !== 10) out.hotbar = new Array(10).fill(null);
    if (out.hotbar.every(x => !x)) out.hotbar[0] = 'hub';
    return out;
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  extraIce() {
    if (!this.settings.extraIce) return null;
    try { return JSON.parse(this.settings.extraIce); } catch (e) { return null; }
  }

  changeSetting(el) {
    const k = el.getAttribute('data-k');
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range' || el.type === 'number') v = Number(el.value);
    else v = el.value;
    this.settings[k] = v;
    this.saveSettings();
    if (k === 'volume') this.audio.setVolume(v);
    if (this.game) this.game.view.applySettings(this.settings);
    if (this.ui.panel && this.ui.panel.kind === 'settings') this.ui.render();
    else if (this.menuScreen === 'settings') this.showMenu('settings');
  }

  settingsHtml(inGame) {
    const s = this.settings;
    const rng = (k, label, min, max, step, fmtv) => `<label class="f">${label}: <b>${fmtv ? fmtv(s[k]) : s[k]}</b></label><input type="range" data-change="setting" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}">`;
    const chk = (k, label) => `<label class="check"><input type="checkbox" data-change="setting" data-k="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
    const body = `<div class="cols"><div class="col">
      ${rng('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, v => Number(v).toFixed(2))}
      ${chk('invertY', 'Invert mouse Y')}
      ${rng('fov', 'Field of view', 60, 100, 1)}
      ${rng('volume', 'Volume', 0, 1, 0.05, v => Math.round(v * 100) + '%')}
      ${chk('showFps', 'Show FPS')}
    </div><div class="col">
      ${rng('viewDistance', 'View distance', 250, 1200, 50, v => v + ' m')}
      ${rng('pixelRatio', 'Render resolution', 0.5, 2, 0.25, v => Math.round(v * 100) + '%')}
      ${chk('shadows', 'Shadows')}
      <label class="f">Relay server URL (optional)</label><input class="t" data-change="setting" data-k="relayUrl" value="${escapeHtml(s.relayUrl || '')}" placeholder="e.g. my-relay.onrender.com">
      <label class="f">Custom PeerJS signalling server (optional)</label><input class="t" data-change="setting" data-k="peerServer" value="${escapeHtml(s.peerServer || '')}" placeholder="leave empty for the free public server">
      <label class="f">Extra ICE/TURN servers (JSON, optional)</label><input class="t" data-change="setting" data-k="extraIce" value="${escapeHtml(s.extraIce || '')}" placeholder='[{"urls":"turn:...","username":"..","credential":".."}]'>
    </div></div>${inGame ? '<div class="row-btns"><button class="btn" data-act="back">Back</button></div>' : ''}`;
    if (inGame) return `<div class="win" style="width:760px"><header><h2>Settings</h2><button class="x" data-act="close">✕</button></header><div class="body">${body}</div></div>`;
    return body;
  }

  helpHtml() {
    return `<div class="help"><table>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Move</td><td><kbd>Space</kbd></td><td>Jump (hold for Jetpack)</td></tr>
      <tr><td><kbd>Shift</kbd></td><td>Sprint</td><td><kbd>E</kbd></td><td>Interact / open machine</td></tr>
      <tr><td><kbd>Q</kbd></td><td>Build menu</td><td><kbd>F</kbd></td><td>Dismantle mode</td></tr>
      <tr><td><kbd>Tab</kbd> / <kbd>I</kbd></td><td>Inventory</td><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>0</kbd></td><td>Hotbar buildings</td><td><kbd>R</kbd> / Wheel</td><td>Rotate hologram</td></tr>
      <tr><td><kbd>PgUp</kbd>/<kbd>PgDn</kbd></td><td>Raise / lower (foundations, poles)</td><td>RMB</td><td>Cancel build</td></tr>
      <tr><td><kbd>V</kbd></td><td>Flashlight</td><td><kbd>Enter</kbd></td><td>Chat (multiplayer)</td></tr>
      <tr><td>LMB (hold)</td><td>Mine ore / harvest plants</td><td><kbd>H</kbd></td><td>Hide HUD</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Pause / close</td><td></td><td></td></tr></table>
      <h3>The gameplay loop</h3>
      <ol>
        <li><b>Land & build the HUB.</b> Press <kbd>Q</kbd> and place The HUB. It holds your Milestone terminal and Craft Bench.</li>
        <li><b>Gather by hand.</b> Hold LMB on resource nodes to mine ore, and on plants to harvest Leaves, Wood and Mycelia.</li>
        <li><b>Craft & complete Milestones.</b> Craft parts at the Craft Bench, select a Milestone at the HUB, submit the parts and ship them. Each Milestone unlocks new buildings and recipes.</li>
        <li><b>Automate.</b> Place Miners on nodes, connect Conveyor Belts from output ports (green) to input ports (orange) of Smelters and Constructors.</li>
        <li><b>Power it.</b> Build Biomass Burners (later Coal Generators), then use Power Lines and Power Poles to connect machines. If consumption exceeds production the fuse trips!</li>
        <li><b>Expand.</b> Research at the M.A.M., sink spare parts in the AWESOME Sink for coupons, and deliver Project Parts to the Space Elevator to unlock higher tiers.</li>
      </ol>
      <h3>Multiplayer</h3>
      <p>Open the pause menu and click <b>Invite Friend</b> to get a game code (or tick “Open to friends” when creating a world). Your friend opens the same game page, chooses <b>Join Friend</b> and enters the code. It connects peer-to-peer across the internet — no port forwarding. Progress is shared and saved on the host's computer.</p></div>`;
  }

  // ================================================================ saves
  listSaves() {
    try { return JSON.parse(localStorage.getItem(SAVES_KEY) || '[]'); } catch (e) { return []; }
  }

  saveGame(game, quiet = false) {
    if (!game || !game.isHost) return;
    const data = game.saveData();
    const id = game.saveId || (game.saveId = 'w' + Date.now().toString(36));
    try {
      localStorage.setItem('sf2:save:' + id, JSON.stringify(data));
      const list = this.listSaves().filter(s => s.id !== id);
      list.unshift({ id, name: game.state.name, seed: game.state.seed, updated: Date.now(), time: game.state.time, ents: game.state.ents.size });
      localStorage.setItem(SAVES_KEY, JSON.stringify(list));
      if (!quiet) this.ui.toast('Game saved', 'good');
    } catch (e) {
      this.ui.toast('Could not save to browser storage (full?). Use Export Save instead.', 'err');
    }
  }

  readSave(id) {
    try { return JSON.parse(localStorage.getItem('sf2:save:' + id)); } catch (e) { return null; }
  }

  deleteSave(id) {
    localStorage.removeItem('sf2:save:' + id);
    localStorage.setItem(SAVES_KEY, JSON.stringify(this.listSaves().filter(s => s.id !== id)));
  }

  download(name, data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  exportSave(game) {
    const data = game.saveData();
    this.download(`${game.state.name.replace(/[^\w-]+/g, '_')}.sf2save.json`, { format: 'sf2', version: VERSION, save: data });
  }

  importSave() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const save = obj.save || obj;
        if (!save.seed || !save.ents) throw new Error('Not a Satisfactory 2 save');
        const id = 'w' + Date.now().toString(36);
        localStorage.setItem('sf2:save:' + id, JSON.stringify(save));
        const list = this.listSaves();
        list.unshift({ id, name: save.name, seed: save.seed, updated: Date.now(), time: save.time, ents: save.ents.length });
        localStorage.setItem(SAVES_KEY, JSON.stringify(list));
        this.showMenu('load');
      } catch (e) {
        alert('Could not import save: ' + e.message);
      }
    };
    inp.click();
  }

  // ================================================================ menus
  skyline() {
    return `<svg class="skyline" viewBox="0 0 1600 400" preserveAspectRatio="none">
      <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1f29"/><stop offset="1" stop-color="#07080b"/></linearGradient></defs>
      <path fill="url(#sg)" d="M0 400 V300 H60 V250 H90 V300 H140 V220 H150 V140 H162 V220 H175 V280 H240 V230 H300 V280 H330 V180 H380 V280 H420 V250 H470 V160 L500 120 L530 160 V260 H600 V300 H640 V210 H660 V90 H672 V210 H700 V290 H780 V240 H860 V200 H900 V240 H930 V170 H950 V240 H1010 V280 H1060 V190 H1130 V270 H1190 V230 H1230 V110 H1244 V230 H1280 V290 H1350 V250 H1400 V200 H1460 V260 H1520 V230 H1600 V400 Z"/>
      <g fill="#f39c38" opacity="0.8"><rect x="155" y="150" width="4" height="4"/><rect x="664" y="100" width="4" height="4"/><rect x="1235" y="120" width="4" height="4"/><rect x="495" y="130" width="10" height="4"/></g>
      <g fill="#ffd27a" opacity="0.35">${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 97) % 1580 + 10}" y="${250 + (i * 37) % 100}" width="6" height="3"/>`).join('')}</g></svg>`;
  }

  showMenu(screen, extra = {}) {
    this.menuScreen = screen;
    const el = this.menuEl;
    el.classList.remove('hidden');
    const s = this.settings;
    const colorPick = `<div class="colors">${COLORS.map(c => `<div class="c ${s.color === c ? 'sel' : ''}" style="background:${c}" data-mact="color" data-c="${c}"></div>`).join('')}</div>`;
    let card = '';
    const err = extra.error ? `<div class="err">${escapeHtml(extra.error)}</div>` : '';
    if (screen === 'main') {
      const saves = this.listSaves();
      card = `<div class="logo">SATISFACTORY<br><span>2</span></div><div class="tag">FICSIT INC. · PROJECT ASSEMBLY</div>
        ${saves.length ? `<button class="mbtn" data-mact="continue">Continue<small>${escapeHtml(saves[0].name)}</small></button>` : ''}
        <button class="mbtn" data-mact="new">New Game<small>Land on a new planet and start your factory</small></button>
        <button class="mbtn" data-mact="load">Load Game<small>${saves.length} saved world${saves.length === 1 ? '' : 's'}</small></button>
        <button class="mbtn" data-mact="join">Join Friend<small>Enter a game code to play together online</small></button>
        <button class="mbtn" data-mact="settings">Settings</button>
        <button class="mbtn" data-mact="help">How to Play</button>`;
    } else if (screen === 'new') {
      card = `<div class="form"><h2>New Game</h2>
        <label class="f">World name</label><input class="t" id="m-world" value="${escapeHtml(extra.world || 'New Factory')}" maxlength="32">
        <label class="f">Seed (optional)</label><input class="t" id="m-seed" placeholder="random" maxlength="24">
        <label class="f">Your pioneer name</label><input class="t" id="m-name" value="${escapeHtml(s.name)}" maxlength="16">
        <label class="f">Suit colour</label>${colorPick}
        <label class="check"><input type="checkbox" id="m-online" checked> Open to friends online (get an invite code)</label>
        ${err}<div class="row-btns"><button class="btn primary" data-mact="start-new">Land</button><button class="btn" data-mact="main">Back</button></div></div>`;
    } else if (screen === 'load') {
      const saves = this.listSaves();
      card = `<div class="form"><h2>Load Game</h2><div class="saves">${saves.map(sv => `<div class="save"><div class="nm"><b>${escapeHtml(sv.name)}</b><br><span class="small muted">${new Date(sv.updated).toLocaleString()} · ${Math.floor((sv.time || 0) / 60)} min played · ${sv.ents || 0} buildings</span></div>
          <button class="btn small primary" data-mact="load-one" data-id="${sv.id}">Load</button><button class="btn small" data-mact="export-one" data-id="${sv.id}">Export</button><button class="btn small danger" data-mact="del-one" data-id="${sv.id}">✕</button></div>`).join('') || '<div class="muted">No saved worlds yet.</div>'}</div>
        <label class="check"><input type="checkbox" id="m-online" checked> Open to friends online when loaded</label>
        ${err}<div class="row-btns"><button class="btn" data-mact="import">Import Save File</button><button class="btn" data-mact="main">Back</button></div></div>`;
    } else if (screen === 'join') {
      const pj = this.pendingJoin || {};
      card = `<div class="form"><h2>Join Friend</h2>
        <label class="f">Game code</label><input class="t code" id="m-code" value="${escapeHtml(pj.code || '')}" maxlength="8" placeholder="ABC123">
        <label class="f">Your pioneer name</label><input class="t" id="m-name" value="${escapeHtml(s.name)}" maxlength="16">
        <label class="f">Suit colour</label>${colorPick}
        <label class="f">Connection</label><select class="t" id="m-method">
          <option value="online" ${pj.method !== 'relay' && pj.method !== 'local' ? 'selected' : ''}>Online (peer-to-peer, recommended)</option>
          <option value="relay" ${pj.method === 'relay' ? 'selected' : ''}>Relay server</option>
          <option value="local" ${pj.method === 'local' ? 'selected' : ''}>Same browser (testing)</option></select>
        ${err}<div class="row-btns"><button class="btn primary" data-mact="start-join">Join</button><button class="btn" data-mact="main">Back</button></div>
        <div class="small muted" style="margin-top:10px">Ask the host for their code — it appears in the top-left of their screen and in their pause menu.</div></div>`;
    } else if (screen === 'settings') {
      card = `<div class="form" style="width:min(760px,90vw)"><h2>Settings</h2>${this.settingsHtml(false)}<div class="row-btns"><button class="btn" data-mact="main">Back</button></div></div>`;
    } else if (screen === 'help') {
      card = `<div class="form" style="width:min(820px,90vw)"><h2>How to Play</h2>${this.helpHtml()}<div class="row-btns"><button class="btn" data-mact="main">Back</button></div></div>`;
    } else if (screen === 'connecting') {
      card = `<div class="form"><h2>Connecting…</h2><div class="muted">${escapeHtml(extra.text || '')}</div><div class="row-btns"><button class="btn" data-mact="cancel-join">Cancel</button></div></div>`;
    }
    el.innerHTML = `${this.skyline()}<div class="card">${card}</div><div class="ver">Satisfactory 2 v${VERSION} · fan-made, not affiliated with Coffee Stain Studios</div>`;
    if (screen === 'join' && !this.pendingJoin) setTimeout(() => { const c = document.getElementById('m-code'); if (c) c.focus(); }, 50);
  }

  onMenuClick(e) {
    const el = e.target.closest('[data-mact]');
    if (!el) return;
    this.audio.ensure();
    this.audio.play('click');
    const a = el.getAttribute('data-mact');
    const val = (id) => { const x = document.getElementById(id); return x ? x.value : ''; };
    const checked = (id) => { const x = document.getElementById(id); return x ? x.checked : false; };
    switch (a) {
      case 'main': case 'new': case 'load': case 'join': case 'settings': case 'help': this.showMenu(a); break;
      case 'color':
        this.settings.color = el.getAttribute('data-c');
        this.saveSettings();
        el.parentElement.querySelectorAll('.c').forEach(c => c.classList.toggle('sel', c === el));
        break;
      case 'continue': {
        const s = this.listSaves()[0];
        if (s) this.startSaved(s.id, false);
        break;
      }
      case 'start-new': {
        const name = val('m-name').trim() || 'Pioneer';
        this.settings.name = name;
        this.saveSettings();
        const seedStr = val('m-seed').trim();
        const seed = seedStr ? (/^\d+$/.test(seedStr) ? Number(seedStr) >>> 0 : hashString(seedStr)) : (Math.random() * 2 ** 31) >>> 0;
        this.startNew(val('m-world').trim() || 'New Factory', seed, checked('m-online'));
        break;
      }
      case 'load-one': this.startSaved(el.getAttribute('data-id'), checked('m-online')); break;
      case 'export-one': {
        const data = this.readSave(el.getAttribute('data-id'));
        if (data) this.download(`${(data.name || 'world').replace(/[^\w-]+/g, '_')}.sf2save.json`, { format: 'sf2', version: VERSION, save: data });
        break;
      }
      case 'del-one':
        if (confirm('Delete this world permanently?')) { this.deleteSave(el.getAttribute('data-id')); this.showMenu('load'); }
        break;
      case 'import': this.importSave(); break;
      case 'start-join': {
        const name = val('m-name').trim() || 'Pioneer';
        this.settings.name = name;
        this.saveSettings();
        const code = val('m-code').trim().toUpperCase();
        if (!code) { this.showMenu('join', { error: 'Enter the game code from your friend.' }); return; }
        this.joinGame(code, val('m-method') || 'online');
        break;
      }
      case 'cancel-join':
        if (this.joining) { this.joining.close(); this.joining = null; }
        this.showMenu('join');
        break;
      default: break;
    }
  }

  inviteLink(code, method) {
    const base = location.href.split('#')[0];
    let h = `#join=${encodeURIComponent(code)}`;
    if (method === 'relay') h += `&m=relay${this.settings.relayUrl ? `&r=${encodeURIComponent(this.settings.relayUrl)}` : ''}`;
    if (method === 'local') h += '&m=local';
    return base + h;
  }

  // ================================================================ start games
  async withLoading(text, fn) {
    this.ui.showLoading(text, 'Generating terrain…');
    await new Promise(r => setTimeout(r, 30));
    try {
      return await fn();
    } finally {
      this.ui.showLoading(null);
    }
  }

  async startNew(name, seed, online) {
    const state = createState(name, seed);
    await this.launchHost(state, null, online);
  }

  async startSaved(id, online) {
    const data = this.readSave(id);
    if (!data) { this.showMenu('load', { error: 'Save not found' }); return; }
    const state = deserializeState(data);
    await this.launchHost(state, id, online);
  }

  async launchHost(state, saveId, online) {
    await this.withLoading('LANDING', async () => {
      const world = new World(state.seed);
      const pid = this.claimLocalPid(state);
      this.game = new Game({
        role: 'host', state, world, pid, settings: this.settings, ui: this.ui, audio: this.audio, input: this.input,
        canvas: this.canvas, name: this.settings.name, color: this.settings.color, saveId,
      });
      const me = this.game.me;
      me.color = this.settings.color;
      this.menuEl.classList.add('hidden');
      this.ui.attach(this.game);
      this.ui.autoHotbar();
      if (!saveId) this.saveGame(this.game, true);
    });
    if (online) this.startHosting('online');
  }

  claimLocalPid(state) {
    const name = (this.settings.name || 'Pioneer').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Pioneer';
    return name;
  }

  async startHosting(method) {
    const g = this.game;
    if (!g || !g.isHost || g.net) return;
    if (method === 'relay' && !this.settings.relayUrl && location.protocol === 'file:') {
      this.ui.toast('Set a Relay server URL in Settings first.', 'err');
      return;
    }
    this.ui.toast('Opening your world to friends…', 'info');
    try {
      const t = makeHost(method, { relayUrl: this.settings.relayUrl, peerServer: this.settings.peerServer, extraIce: this.extraIce() });
      const code = await g.startHosting(t, method);
      this.ui.notify(`Multiplayer ready! Game code: ${code}`, 'good');
      this.ui.toast('Share the code (pause menu → Copy Invite Link) with your friend.', 'info', 8000);
      if (this.ui.panel && this.ui.panel.kind === 'pause') this.ui.render();
    } catch (e) {
      g.net = null;
      this.ui.notify('Could not start multiplayer: ' + e.message, 'err');
    }
  }

  async joinGame(code, method) {
    this.showMenu('connecting', { text: `Contacting game ${code}…` });
    const t = makeClient(method, { relayUrl: this.pendingJoin && this.pendingJoin.relay ? this.pendingJoin.relay : this.settings.relayUrl, peerServer: this.settings.peerServer, extraIce: this.extraIce() });
    this.joining = t;
    try {
      await t.connect(code);
      if (this.joining !== t) return;
      this.showMenu('connecting', { text: 'Connected! Downloading world…' });
      const welcome = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Host did not respond')), 30000);
        t.onMsg = (msg) => {
          if (msg.t === 'welcome') { clearTimeout(timer); resolve(msg); }
          else if (msg.t === 'kick') { clearTimeout(timer); reject(new Error(msg.reason)); }
        };
        t.onClose = (r) => { clearTimeout(timer); reject(new Error(r)); };
        t.send({ t: 'hello', ver: PROTOCOL, name: this.settings.name, color: this.settings.color });
      });
      if (this.joining !== t) return;
      this.joining = null;
      // buffer messages that arrive while we build the world
      const queue = [];
      t.onMsg = (m) => queue.push(m);
      await this.withLoading('JOINING', async () => {
        const state = deserializeState(welcome.save);
        const world = new World(state.seed);
        this.game = new Game({
          role: 'client', state, world, pid: welcome.pid, settings: this.settings, ui: this.ui, audio: this.audio, input: this.input, canvas: this.canvas,
        });
        this.game.attachClient(t, welcome.code || code, method);
        this.menuEl.classList.add('hidden');
        this.ui.attach(this.game);
        this.ui.autoHotbar();
        for (const m of queue) this.game.onClientMsg(m);
      });
      history.replaceState(null, '', location.pathname + location.search);
      this.pendingJoin = null;
      this.ui.notify(`Joined ${welcome.pid === this.settings.name ? 'the game' : 'as ' + welcome.pid}!`, 'good');
    } catch (e) {
      t.close();
      if (this.joining === t || !this.game) {
        this.joining = null;
        this.showMenu('join', { error: e.message || String(e) });
      }
    }
  }

  quitToMenu() {
    const g = this.game;
    if (!g) return;
    if (g.isHost) this.saveGame(g, true);
    this.input.unlock();
    g.dispose();
    this.game = null;
    this.ui.detach();
    // the WebGL canvas keeps the last frame — clear it
    const ctx = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
    if (ctx) { ctx.clearColor(0, 0, 0, 1); ctx.clear(ctx.COLOR_BUFFER_BIT); }
    this.showMenu('main');
  }

  // ================================================================ loop
  background() {
    if (!this.game || !document.hidden) return;
    const now = performance.now();
    const dt = Math.min(1, (now - this.last) / 1000);
    this.last = now;
    try { this.game.tickCore(dt, 20); } catch (err) { console.error(err); }
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.game) {
      try {
        this.game.frame(dt);
      } catch (err) {
        console.error(err);
        if (!this.loggedErr) { this.loggedErr = true; this.ui.toast('Error: ' + err.message, 'err', 10000); }
      }
    }
    this.input.endFrame();
  }
}

window.app = new App();

// Console helpers for testing / sandbox play (host only): sf2.unlockAll(), sf2.give('iron_plate', 100)
window.sf2 = {
  BUILDINGS, RECIPES, ITEMS,
  unlockAll() {
    const g = window.app.game;
    if (!g || !g.isHost) return 'host only';
    g.state.prog.b = Object.keys(BUILDINGS).filter(b => b !== 'crate');
    g.state.prog.r = Object.keys(RECIPES);
    g.state.prog.eq = ['jetpack', 'blade_runners'];
    g.updProg();
    return 'unlocked';
  },
  give(item, n = 100) {
    const g = window.app.game;
    if (!g || !g.isHost || !ITEMS[item]) return 'host only / unknown item';
    addItem(g.me.inv, item, n);
    g.updInv(g.pid);
    return 'ok';
  },
};
