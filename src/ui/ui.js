// In-game HUD and panels (inventory, build menu, machines, HUB, MAM, map, pause).
import * as THREE from 'three';
import { ITEMS, itemName, stackOf } from '../data/items.js';
import { RECIPES, handTime, perMinute } from '../data/recipes.js';
import { BUILDINGS, CATEGORIES, PURITY, beltRate, minerRate, powerUse } from '../data/buildings.js';
import { MILESTONES, MILESTONE_BY_ID, RESEARCH, RESEARCH_BY_ID, ELEVATOR_PHASES, TIER_REQ, SHOP, couponCost } from '../data/progression.js';
import { countItem, hasAll } from '../sim/inventory.js';
import { BATTERY_MJ } from '../sim/factory.js';
import { itemIcon, buildingIcons } from './icons.js';
import { buildTemplate } from '../render/models.js';
import { escapeHtml, fmt, fmtBig, clamp } from '../core/util.js';
import { MapPanel } from './map.js';

const $ = (sel, root = document) => root.querySelector(sel);

function costHtml(cost, inv, mult = 1) {
  return Object.entries(cost).map(([item, n]) => {
    const need = n * mult;
    const have = inv ? countItem(inv, item) : need;
    return `<span class="cost ${have < need ? 'lack' : ''}" data-tip="${ITEMS[item].name}"><img src="${itemIcon(item, 32)}">${need}${inv ? `<span class="muted small">/${have}</span>` : ''}</span>`;
  }).join('');
}

function ioHtml(list) {
  return list.map(({ item, n }) => `<span><img src="${itemIcon(item, 32)}">${n}</span>`).join('<span>+</span>');
}

export function beltIcon(tier) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  const col = ['#e8862a', '#3d74c8', '#8e44ad', '#2fa86b', '#d64545'][tier - 1];
  ctx.translate(48, 48);
  ctx.rotate(-0.5);
  ctx.fillStyle = '#5b6066'; ctx.fillRect(-44, -18, 88, 36);
  ctx.fillStyle = '#26282b'; ctx.fillRect(-44, -13, 88, 26);
  ctx.strokeStyle = '#555a60'; ctx.lineWidth = 4;
  for (let x = -36; x < 40; x += 16) { ctx.beginPath(); ctx.moveTo(x, -8); ctx.lineTo(x + 7, 0); ctx.lineTo(x, 8); ctx.stroke(); }
  ctx.fillStyle = col; ctx.fillRect(-44, -18, 88, 4); ctx.fillRect(-44, 14, 88, 4);
  ctx.rotate(0.5);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('Mk' + tier, 10, 40);
  return c.toDataURL();
}

export class UI {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.game = null;
    this.panel = null;
    this.dirty = false;
    this.refreshTimer = 0;
    this.trackerTimer = 0;
    this.pointerDown = false;
    this.bIcons = Object.create(null);
    this.chatLines = [];
    this.crafting = null;
    this.hoverBuild = null;
    this.buildCat = 'production';
    this.hubTab = 'milestones';
    this.msSel = null;
    this.sinkTab = 'sink';
    this.lastPrompt = '';
    this.lastInfo = '';
    this.buildDom();
    this.bindGlobal();
  }

  // ================================================================ DOM
  buildDom() {
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div id="compass"></div>
        <div id="netinfo" class="hidden"></div>
        <div id="alerts"></div>
        <div id="crosshair"></div>
        <div id="prompt"></div>
        <div id="holdbar" class="hidden"><div></div></div>
        <div id="buildinfo" class="hidden"></div>
        <div id="jetbar" class="hidden"><div></div></div>
        <div id="hotbar"></div>
        <div id="tracker"></div>
        <div id="toasts"></div>
        <div id="banner"></div>
        <div id="chatlog"></div>
        <input id="chatinput" class="hidden" maxlength="200" placeholder="Say something… (Enter to send, Esc to cancel)">
        <div id="clickstart" class="hidden">Click to play</div>
        <div id="stats"></div>
      </div>
      <div id="panel" class="hidden"></div>
      <div id="menu" class="hidden"></div>
      <div id="loading" class="hidden"><div class="spinner"></div><div class="t">LOADING</div><div class="s"></div></div>
      <div id="tip" class="hidden"></div>`;
    this.hud = $('#hud');
    this.panelEl = $('#panel');
    this.tipEl = $('#tip');
    this.compassEl = $('#compass');
    const marks = [];
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = 0; deg < 360; deg += 15) {
      const el = document.createElement('div');
      el.className = 'mark' + (names[deg] ? (deg % 90 === 0 ? ' card' : '') : '');
      el.textContent = names[deg] || (deg % 45 ? '·' : '');
      this.compassEl.appendChild(el);
      marks.push({ el, b: deg * Math.PI / 180 });
    }
    this.compassMarks = marks;
    this.compassPois = new Map();
  }

  showLoading(text, sub = '') {
    const l = $('#loading');
    l.classList.toggle('hidden', !text);
    if (text) { $('.t', l).textContent = text; $('.s', l).textContent = sub; }
  }

  bindGlobal() {
    const root = this.root;
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t && !this.drag) {
        this.tipEl.innerHTML = t.getAttribute('data-tip');
        this.tipEl.classList.remove('hidden');
        const x = Math.min(window.innerWidth - 300, e.clientX + 16), y = Math.min(window.innerHeight - 80, e.clientY + 14);
        this.tipEl.style.left = x + 'px';
        this.tipEl.style.top = y + 'px';
      } else this.tipEl.classList.add('hidden');
      if (this.drag) this.moveDrag(e);
      const bi = e.target && e.target.closest ? e.target.closest('[data-build]') : null;
      this.hoverBuild = bi ? bi.getAttribute('data-build') : null;
    });
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    document.addEventListener('pointerup', (e) => this.onPointerUp(e));
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('wheel', (e) => { if (this.mapPanel && this.panel && this.panel.kind === 'map') this.mapPanel.wheel(e); }, { passive: true });
    const chat = $('#chatinput');
    chat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (this.game) this.game.sendChat(chat.value);
        chat.value = '';
        this.closeChat();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        chat.value = '';
        this.closeChat();
        e.preventDefault();
      }
      e.stopPropagation();
    });
  }

  attach(game) {
    this.game = game;
    this.hud.classList.remove('hidden');
    $('#menu').classList.add('hidden');
    this.panel = null;
    this.panelEl.classList.add('hidden');
    this.chatLines = [];
    $('#chatlog').innerHTML = '';
    $('#toasts').innerHTML = '';
    this.mapPanel = new MapPanel(game);
    this.renderHotbar();
    this.netChanged();
    this.updateTracker();
    if (!Object.keys(this.bIcons).length) {
      buildingIcons(THREE, buildTemplate, BUILDINGS, game.view.renderer).then((icons) => {
        this.bIcons = Object.assign(Object.create(null), icons);
        for (let t = 1; t <= 5; t++) this.bIcons['belt_mk' + t] = beltIcon(t);
        this.bIcons.power_line = itemIcon('wire', 96);
        this.renderHotbar();
        if (this.panel && this.panel.kind === 'build') this.render();
      });
    }
    $('#clickstart').classList.remove('hidden');
  }

  detach() {
    this.game = null;
    this.hud.classList.add('hidden');
    this.closePanel(true);
  }

  // ================================================================ state notifications
  invChanged() { if (this.panel) this.dirty = true; this.trackerTimer = 0; }
  progChanged(soft) {
    if (this.panel && (!soft || ['hub', 'ent', 'mam'].includes(this.panel.kind))) this.dirty = true;
    this.trackerTimer = 0;
    if (!soft) this.autoHotbar();
  }
  entChanged(id, removed) {
    if (this.panel && this.panel.kind === 'ent' && this.panel.id === id) {
      if (removed) this.closePanel();
      else this.dirty = true;
    }
  }

  netChanged() {
    const g = this.game;
    const el = $('#netinfo');
    if (!g || !g.net) { el.classList.add('hidden'); if (this.panel && this.panel.kind === 'pause') this.dirty = true; return; }
    el.classList.remove('hidden');
    const players = Object.entries(g.state.players).filter(([, P]) => P.online);
    el.innerHTML = `<div>${g.isHost ? 'Hosting' : 'Connected'} · <span class="code">${escapeHtml(g.netCode || '')}</span> <span class="muted small">(${g.netMethod === 'relay' ? 'relay' : g.netMethod === 'local' ? 'local' : 'online'})</span></div>` +
      players.map(([pid, P]) => `<div class="pl"><span class="dot" style="background:${escapeHtml(P.color)}"></span>${escapeHtml(P.name)}${pid === g.pid ? ' <span class="muted">(you)</span>' : ''}</div>`).join('');
    if (this.panel && this.panel.kind === 'pause') this.dirty = true;
  }

  // ================================================================ notifications
  toast(text, kind = 'info', ms = 4200) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => el.classList.add('fade'), ms);
    setTimeout(() => el.remove(), ms + 700);
  }

  notify(text, kind = 'info') {
    if (kind === 'big') {
      const b = $('#banner');
      b.innerHTML = `<div class="b"><small>FICSIT INC.</small>${escapeHtml(text)}</div>`;
      clearTimeout(this.bannerT);
      this.bannerT = setTimeout(() => { b.innerHTML = ''; }, 5000);
      this.game && this.game.audio.play('milestone');
      return;
    }
    if (kind === 'err' && this.game) this.game.audio.play('error');
    else if (this.game) this.game.audio.play('notify', 0.5);
    this.toast(text, kind);
  }

  pickupFx(item, n) {
    this.toast(`+${n} ${itemName(item)}`, 'good', 1200);
  }

  chat(name, color, text) {
    const log = $('#chatlog');
    const el = document.createElement('div');
    el.className = 'line';
    el.innerHTML = `<b style="color:${escapeHtml(color || '#f39c38')}">${escapeHtml(name)}:</b>${escapeHtml(text)}`;
    log.appendChild(el);
    while (log.children.length > 10) log.removeChild(log.firstChild);
    setTimeout(() => el.classList.add('old'), 12000);
    this.game && this.game.audio.play('chat');
  }

  openChat() {
    const c = $('#chatinput');
    c.classList.remove('hidden');
    $('#chatlog').classList.add('open');
    this.chatOpen = true;
    this.intentionalUnlock = true;
    this.game.input.unlock();
    setTimeout(() => c.focus(), 0);
  }

  closeChat() {
    const c = $('#chatinput');
    c.classList.add('hidden');
    c.blur();
    $('#chatlog').classList.remove('open');
    this.chatOpen = false;
    if (this.game) this.game.input.lock();
  }

  disconnected(reason) {
    this.closePanel(true);
    this.openPanel('disconnected', { reason });
  }

  autosave() {
    if (this.app && this.game && this.game.isHost) this.app.saveGame(this.game, true);
  }

  blocking() {
    return !!this.panel || !!this.chatOpen;
  }

  // ================================================================ panels
  openPanel(kind, extra = {}) {
    this.panel = { kind, ...extra };
    this.justOpened = true; // ignore the key that opened it for the rest of this frame
    this.panelEl.classList.remove('hidden');
    this.intentionalUnlock = true;
    if (this.game) {
      this.game.input.unlock();
      if (kind !== 'build') this.game.build.cancel();
    }
    this.render();
    this.game && this.game.audio.play('click');
  }

  closePanel(silent) {
    if (!this.panel) return;
    this.panel = null;
    this.crafting = null;
    this.panelEl.classList.add('hidden');
    this.panelEl.innerHTML = '';
    this.tipEl.classList.add('hidden');
    if (!silent && this.game && this.game.running) this.game.input.lock();
  }

  togglePanel(kind, extra) {
    if (this.panel && this.panel.kind === kind) this.closePanel();
    else this.openPanel(kind, extra);
  }

  openEntity(id) {
    const e = this.game.factory.get(id);
    if (!e) return;
    const def = BUILDINGS[e.type];
    if (def.ui === 'hub' || def.ui === 'bench') return this.openPanel('hub', { id, tab: def.ui === 'bench' ? 'craft' : null });
    if (def.ui === 'mam') return this.openPanel('mam', { id });
    if (def.ui === 'elevator') return this.openPanel('elevator', { id });
    this.openPanel('ent', { id });
  }

  render() {
    this.dirty = false;
    if (!this.panel) return;
    const k = this.panel.kind;
    let html = '';
    try {
      switch (k) {
        case 'inventory': html = this.renderInventory(); break;
        case 'build': html = this.renderBuildMenu(); break;
        case 'ent': html = this.renderEntity(); break;
        case 'hub': html = this.renderHub(); break;
        case 'mam': html = this.renderMam(); break;
        case 'elevator': html = this.renderElevator(); break;
        case 'map': html = this.mapPanel.html(); break;
        case 'pause': html = this.renderPause(); break;
        case 'settings': html = this.app.settingsHtml(true); break;
        case 'help': html = this.win('How to Play', this.app.helpHtml(), 'help'); break;
        case 'disconnected': html = this.win('Disconnected', `<p>${escapeHtml(this.panel.reason || '')}</p><div class="row-btns"><button class="btn primary" data-act="quit">Back to Main Menu</button></div>`, 'disconnected', false); break;
        default: html = '';
      }
    } catch (err) {
      console.error(err);
      html = this.win('Error', `<pre>${escapeHtml(err.stack || err)}</pre>`);
    }
    const scroll = this.panelEl.querySelector('.body');
    const st = scroll ? scroll.scrollTop : 0;
    const scrolls = [...this.panelEl.querySelectorAll('[data-keepscroll]')].map(el => el.scrollTop);
    this.panelEl.innerHTML = html;
    const ns = this.panelEl.querySelector('.body');
    if (ns) ns.scrollTop = st;
    [...this.panelEl.querySelectorAll('[data-keepscroll]')].forEach((el, i) => { if (scrolls[i]) el.scrollTop = scrolls[i]; });
    if (k === 'map') this.mapPanel.mount(this.panelEl);
  }

  win(title, body, cls = '', closable = true, width = null) {
    return `<div class="win ${cls}" style="${width ? `width:min(${width}px, 96vw)` : ''}"><header><h2>${title}</h2>${closable ? '<button class="x" data-act="close">✕</button>' : ''}</header><div class="body">${body}</div></div>`;
  }

  // ---------------------------------------------------------------- slots
  slotHtml(ref, i, s, opts = {}) {
    const has = s && s.n > 0;
    const ghost = s && !has && s.item;
    const tip = s && s.item ? `<b>${ITEMS[s.item].name}</b>${has ? `<br>${s.n} / ${stackOf(s.item)}` : ''}` : '';
    return `<div class="slot ${ghost ? 'ghost' : ''}" data-ref="${ref}" data-si="${i}" ${tip ? `data-tip="${escapeHtml(tip)}"` : ''}>` +
      (opts.label ? `<span class="lbl">${opts.label}</span>` : '') +
      (s && s.item ? `<img src="${itemIcon(s.item)}">` : '') +
      (has ? `<span class="n">${s.n}</span>` : '') + '</div>';
  }

  playerInvHtml(title = 'Inventory') {
    const me = this.game.me;
    const cols = me.inv.length > 30 ? 'w8' : '';
    return `<div class="sect"><h3>${title}</h3><div class="grid ${cols}">${me.inv.map((s, i) => this.slotHtml('p', i, s)).join('')}</div>
      <div class="row-btns"><div id="trash" data-trash="1">Drop here to trash</div><button class="btn small" data-act="sort">Sort</button></div></div>`;
  }

  renderInventory() {
    const g = this.game;
    const eq = g.state.prog.eq;
    const body = `<div class="cols"><div class="col">${this.playerInvHtml()}</div>
      <div class="col" style="max-width:260px"><div class="sect"><h3>Equipment</h3>
        <div class="stat"><span>Build Gun</span><span class="good">Equipped</span></div>
        <div class="stat"><span>Jetpack</span><span class="${eq.includes('jetpack') ? 'good' : 'muted'}">${eq.includes('jetpack') ? 'Equipped (hold Space)' : 'Locked'}</span></div>
        <div class="stat"><span>Blade Runners</span><span class="${eq.includes('blade_runners') ? 'good' : 'muted'}">${eq.includes('blade_runners') ? 'Equipped' : 'Locked'}</span></div>
        <div class="stat"><span>Flashlight [V]</span><span class="good">Equipped</span></div>
      </div><div class="sect"><h3>Tips</h3><div class="small muted">Click a stack to move it to the open machine. Drag to rearrange. Right-click moves half a stack.</div></div></div></div>`;
    return this.win('Inventory', body, '', true);
  }

  // ---------------------------------------------------------------- build menu
  buildableIn(cat) {
    const prog = this.game.state.prog;
    return Object.values(BUILDINGS).filter(d => d.cat === cat && prog.b.includes(d.id));
  }

  renderBuildMenu() {
    const g = this.game;
    const prog = g.state.prog;
    if (!this.buildableIn(this.buildCat).length) {
      const first = CATEGORIES.find(c => this.buildableIn(c.id).length);
      if (first) this.buildCat = first.id;
    }
    const cats = CATEGORIES.map(c => {
      const n = this.buildableIn(c.id).length;
      return `<button class="cat ${this.buildCat === c.id ? 'sel' : ''}" data-act="bcat" data-cat="${c.id}">${c.name} <span class="small">(${n})</span></button>`;
    }).join('');
    const list = this.buildableIn(this.buildCat);
    const locked = Object.values(BUILDINGS).filter(d => d.cat === this.buildCat && !prog.b.includes(d.id)).length;
    const hk = this.app.settings.hotbar || [];
    const items = list.map(d => {
      const idx = hk.indexOf(d.id);
      const icon = this.bIcons[d.id];
      return `<div class="bi" data-act="pick" data-build="${d.id}" data-tip="${escapeHtml(this.buildTip(d))}">
        ${idx >= 0 ? `<span class="hk">[${(idx + 1) % 10}]</span>` : ''}
        ${icon ? `<img src="${icon}">` : '<div style="height:96px"></div>'}<span class="nm">${d.name}</span></div>`;
    }).join('');
    const body = `<div class="bm"><div class="cats">${cats}<div class="small muted" style="margin-top:10px">Hover a building and press 1–0 to put it on your hotbar.</div></div>
      <div class="items" data-keepscroll>${items || '<div class="muted">Nothing unlocked in this category yet. Complete Milestones at the HUB.</div>'}
      ${locked ? `<div class="muted small" style="grid-column:1/-1">${locked} more to unlock via Milestones / Research.</div>` : ''}</div></div>`;
    return this.win('Build Menu', body, '', true, 1060);
  }

  buildTip(d) {
    const inv = this.game.me.inv;
    let s = `<b>${d.name}</b><br>${d.desc || ''}<br>`;
    if (d.kind === 'belt') s += `Cost: ${Object.entries(d.cost).map(([k, v]) => `${v} ${itemName(k)}`).join(', ')} per ${d.costPer} m<br>Throughput: ${beltRate(d)}/min`;
    else if (d.kind === 'wire') s += `Cost: 1 Wire per ${d.costPer} m`;
    else {
      const c = Object.entries(d.cost);
      s += c.length ? 'Cost: ' + c.map(([k, v]) => `<span class="${countItem(inv, k) < v ? 'bad' : ''}">${v} ${itemName(k)}</span>`).join(', ') : 'Free';
      if (d.power) s += `<br>Power: ${d.power} MW`;
      if (d.gen) s += `<br>Produces: ${d.gen} MW`;
      if (d.size) s += `<br>Size: ${d.size[0]} × ${d.size[2]} m`;
    }
    return s;
  }

  // ---------------------------------------------------------------- entity panels
  renderEntity() {
    const g = this.game;
    const e = g.factory.get(this.panel.id);
    if (!e) { this.panel = null; this.panelEl.classList.add('hidden'); return ''; }
    const def = BUILDINGS[e.type];
    let left = '';
    switch (def.ui) {
      case 'machine': left = this.machineHtml(e, def); break;
      case 'miner': left = this.minerHtml(e, def); break;
      case 'generator': left = this.genHtml(e, def); break;
      case 'battery': left = this.batteryHtml(e, def); break;
      case 'storage': left = this.storageHtml(e, def); break;
      case 'pole': left = this.netHtml(e) + this.poleHtml(e, def); break;
      case 'sink': left = this.sinkHtml(e, def); break;
      default: left = `<div class="sect">${def.desc || ''}</div>`;
    }
    const body = `<div class="cols"><div class="col" style="min-width:420px">${left}</div><div class="col" style="flex:0 0 auto">${this.playerInvHtml()}</div></div>`;
    return this.win(def.name, body, '', true);
  }

  statusLine(e, def) {
    if (def.machine && !e.recipe) return '<span class="muted">Idle — select a recipe</span>';
    if (!e._net) return '<span class="bad">Not connected to power</span>';
    if (e._net.tripped) return '<span class="bad">Fuse tripped!</span>';
    if (!e._powered && (e.working || def.power)) return '<span class="bad">No power</span>';
    if (e.working) return '<span class="good">Operating</span>';
    return '<span class="warn">Idle — waiting for input / output full</span>';
  }

  clockHtml(e, def) {
    const max = 100 + 50 * e.shards;
    const pct = Math.round(e.clock * 100);
    return `<div class="sect"><h3>Clock Speed</h3>
      <div class="flow"><input type="range" min="1" max="${max}" value="${pct}" data-change="clock" data-id="${e.id}" style="flex:1"><b>${pct}%</b></div>
      <div class="small muted">Power: ${fmt(powerUse(def, e.clock), 1)} MW · Power Shards: ${e.shards}/3 (each allows +50%)</div>
      <div class="row-btns"><button class="btn small" data-act="shard" data-d="1" data-id="${e.id}">Insert Shard</button><button class="btn small" data-act="shard" data-d="-1" data-id="${e.id}" ${e.shards ? '' : 'disabled'}>Remove Shard</button></div></div>`;
  }

  machineHtml(e, def) {
    const g = this.game;
    const prog = g.state.prog;
    const r = RECIPES[e.recipe];
    const avail = Object.values(RECIPES).filter(x => x.m === def.machine && prog.r.includes(x.id));
    let html = `<div class="sect"><h3>Status</h3>${this.statusLine(e, def)}</div>`;
    if (!r || this.panel.pickRecipe) {
      html += `<div class="sect"><h3>Select Recipe</h3><div class="recipes" data-keepscroll style="max-height:46vh;overflow:auto">` +
        (avail.length ? avail.map(x => `<div class="recipe ${x.alt ? 'alt' : ''} ${x.id === e.recipe ? 'sel' : ''}" data-act="recipe" data-id="${e.id}" data-r="${x.id}">
          <div class="t"><img src="${itemIcon(x.outList[0].item, 56)}">${x.name}</div>
          <div class="io">${ioHtml(x.inList)} <span>→</span> ${ioHtml(x.outList)} <span class="muted">· ${x.t}s</span></div></div>`).join('') : '<div class="muted">No recipes unlocked for this machine yet.</div>') +
        `</div>${r ? '<div class="row-btns"><button class="btn small" data-act="cancelpick">Cancel</button></div>' : ''}</div>`;
      return html;
    }
    const pct = clamp(e.prog / r.t, 0, 1) * 100;
    html += `<div class="sect"><h3>${r.name} <button class="btn small" data-act="pickrecipe" style="float:right">Change Recipe</button></h3>
      <div class="flow">
        <div>${e.inBuf.map((s, i) => this.slotHtml(`e:${e.id}:in`, i, s)).join('')}</div>
        <div class="arrow"><div style="width:${pct}%"></div></div>
        <div>${e.outBuf.map((s, i) => this.slotHtml(`e:${e.id}:out`, i, s)).join('')}</div>
      </div>
      <div class="small muted" style="margin-top:8px">
        In: ${r.inList.map(x => `${fmt(perMinute(r, x.n, e.clock))} ${ITEMS[x.item].name}/min`).join(', ')}<br>
        Out: ${r.outList.map(x => `${fmt(perMinute(r, x.n, e.clock))} ${ITEMS[x.item].name}/min`).join(', ')}
      </div>
      <div class="row-btns"><button class="btn small" data-act="takeall" data-ref="e:${e.id}:out">Take Output</button></div></div>`;
    html += this.clockHtml(e, def);
    return html;
  }

  minerHtml(e, def) {
    const node = this.game.world.nodes[e.node];
    const rate = node ? minerRate(def, node.purity, e.clock) : 0;
    const t = node ? 60 / minerRate(def, node.purity, 1) : 1;
    return `<div class="sect"><h3>Status</h3>${this.statusLine(e, def)}</div>
      <div class="sect"><h3>Extraction</h3>
        <div class="flow"><img src="${itemIcon(node.type, 56)}" style="width:48px">
        <div><b>${ITEMS[node.type].name}</b><br><span class="muted">${PURITY[node.purity]} node · ${fmt(rate)}/min</span></div>
        <div class="arrow"><div style="width:${clamp(e.prog / t, 0, 1) * 100}%"></div></div>
        ${this.slotHtml(`e:${e.id}:out`, 0, e.outBuf[0])}</div>
        <div class="row-btns"><button class="btn small" data-act="takeall" data-ref="e:${e.id}:out">Take Output</button></div>
      </div>${this.clockHtml(e, def)}`;
  }

  netHtml(e) {
    const net = e._net;
    if (!net) return `<div class="sect"><h3>Power Grid</h3><span class="muted">Not connected. Use a Power Line (Build Menu → Power) to connect this to a generator.</span></div>`;
    const cap = net.cap, demand = net.demand, stored = net.stored;
    return `<div class="sect"><h3>Power Grid</h3>
      <div class="stat"><span>Production capacity</span><b>${fmt(cap)} MW</b></div>
      <div class="stat"><span>Consumption</span><b class="${demand > cap ? 'bad' : ''}">${fmt(demand, 1)} MW</b></div>
      ${net.bats.length ? `<div class="stat"><span>Battery storage</span><b>${fmt(stored / 3600, 1)} / ${net.bats.length * 100} MWh</b></div>` : ''}
      <div class="stat"><span>Buildings on grid</span><b>${net.members.length}</b></div>
      ${net.tripped ? `<div class="bad" style="margin-top:6px">⚡ FUSE TRIPPED — consumption exceeded production.</div><div class="row-btns"><button class="btn primary" data-act="fuse" data-id="${e.id}">Reset Fuse</button></div>` : ''}
      <div class="bar"><div style="width:${cap ? clamp(demand / cap, 0, 1) * 100 : 0}%"></div></div></div>`;
  }

  genHtml(e, def) {
    const fuel = e.fuel[0];
    const fuelItem = fuel ? fuel.item : e.burnItem;
    const energy = fuelItem ? ITEMS[fuelItem].fuel : 0;
    const burnPct = energy ? clamp(e.burn / energy, 0, 1) * 100 : 0;
    const perMin = fuelItem && e._load ? (e._load / ITEMS[fuelItem].fuel) * 60 : 0;
    return `<div class="sect"><h3>Generator</h3>
      <div class="flow">${this.slotHtml(`e:${e.id}:fuel`, 0, fuel, { label: 'FUEL' })}
      <div style="flex:1"><div class="small">Burning: ${fuelItem ? ITEMS[fuelItem].name : '—'}</div><div class="bar"><div style="width:${burnPct}%"></div></div>
      <div class="small muted" style="margin-top:4px">Output: ${fmt(e._load || 0, 1)} / ${def.gen} MW${perMin ? ` · ${fmt(perMin, 1)} fuel/min` : ''}</div></div></div>
      <div class="small muted" style="margin-top:6px">Accepts: ${def.fuels.map(f => ITEMS[f].name).join(', ')}</div></div>` + this.netHtml(e);
  }

  batteryHtml(e) {
    const pct = clamp(e.stored / BATTERY_MJ, 0, 1) * 100;
    return `<div class="sect"><h3>Power Storage</h3><div class="stat"><span>Stored</span><b>${fmt(e.stored / 3600, 1)} / 100 MWh</b></div>
      <div class="bar cyan"><div style="width:${pct}%"></div></div></div>` + this.netHtml(e);
  }

  poleHtml(e, def) {
    if (!def.pole) return '';
    return `<div class="sect"><h3>Connections</h3>${e._wires.size} / ${def.pole}</div>`;
  }

  storageHtml(e, def) {
    const cols = e.slots.length > 24 ? 'w8' : '';
    return `<div class="sect"><h3>${def.crate ? 'Contents' : 'Storage'}</h3><div class="grid ${cols}">${e.slots.map((s, i) => this.slotHtml(`e:${e.id}:slots`, i, s)).join('')}</div>
      <div class="row-btns"><button class="btn small" data-act="takeall" data-ref="e:${e.id}:slots">Take All</button></div></div>`;
  }

  sinkHtml(e, def) {
    const s = this.game.state.prog.sink;
    const prog = this.game.state.prog;
    const need = couponCost(s.earned);
    let html = `<div class="tabs"><button class="tab ${this.sinkTab === 'sink' ? 'sel' : ''}" data-act="sinktab" data-t="sink">AWESOME Sink</button><button class="tab ${this.sinkTab === 'shop' ? 'sel' : ''}" data-act="sinktab" data-t="shop">AWESOME Shop</button></div>`;
    if (this.sinkTab === 'sink') {
      html += `<div class="sect"><h3>Status</h3>${this.statusLine(e, def)}</div>
        <div class="sect"><h3>Points</h3>
        <div class="stat"><span>Total points</span><b>${fmtBig(s.total)}</b></div>
        <div class="stat"><span>FICSIT Coupons</span><b class="good">${s.coupons}</b></div>
        <div class="small muted" style="margin-top:6px">Next coupon: ${fmtBig(s.progress)} / ${fmtBig(need)}</div>
        <div class="bar"><div style="width:${clamp(s.progress / need, 0, 1) * 100}%"></div></div>
        <div class="small muted" style="margin-top:8px">Feed any part into the Sink by conveyor. More complex parts are worth more points.</div></div>`;
    } else {
      html += `<div class="sect"><h3>Coupons: ${s.coupons}</h3>` + SHOP.map(it => {
        const bought = prog.shop[it.id] || 0;
        const maxed = it.max && bought >= it.max;
        return `<div class="stat"><span><b>${it.name}</b><br><span class="small muted">${it.desc}${it.max ? ` (${bought}/${it.max})` : ''}</span></span>
          <button class="btn small ${maxed ? '' : 'primary'}" data-act="shop" data-id="${it.id}" ${maxed || s.coupons < it.price ? 'disabled' : ''}>${maxed ? 'Owned' : it.price + ' coupons'}</button></div>`;
      }).join('') + '</div>';
    }
    return html;
  }

  // ---------------------------------------------------------------- HUB
  milestoneState(m) {
    const prog = this.game.state.prog;
    if (prog.ms.done.includes(m.id)) return 'done';
    if (prog.elev.phase < TIER_REQ[m.tier]) return 'locked';
    return 'open';
  }

  renderHub() {
    const tab = this.panel.tab || this.hubTab;
    const tabs = `<div class="tabs"><button class="tab ${tab === 'milestones' ? 'sel' : ''}" data-act="hubtab" data-t="milestones">Milestones</button><button class="tab ${tab === 'craft' ? 'sel' : ''}" data-act="hubtab" data-t="craft">Craft Bench</button></div>`;
    const body = tabs + (tab === 'craft' ? this.craftHtml() : this.milestonesHtml());
    return this.win('The HUB', body, '', true, 1080);
  }

  milestonesHtml() {
    const prog = this.game.state.prog;
    const tiers = [0, 1, 2, 3, 4, 5];
    if (!this.msSel) this.msSel = prog.ms.active || (MILESTONES.find(m => this.milestoneState(m) === 'open') || MILESTONES[0]).id;
    const list = tiers.map(t => {
      const locked = prog.elev.phase < TIER_REQ[t];
      return `<div class="ms-tier">Tier ${t}${locked ? ` · <span class="muted">requires Space Elevator Phase ${TIER_REQ[t]}</span>` : ''}</div>` +
        MILESTONES.filter(m => m.tier === t).map(m => {
          const st = this.milestoneState(m);
          return `<div class="ms ${st} ${this.msSel === m.id ? 'sel' : ''} ${prog.ms.active === m.id ? 'active' : ''}" data-act="mssel" data-id="${m.id}"><span>${m.name}</span>${st === 'done' ? '✔' : st === 'locked' ? '🔒' : ''}</div>`;
        }).join('');
    }).join('');
    const m = MILESTONE_BY_ID[this.msSel];
    return `<div class="cols"><div class="ms-list" data-keepscroll>${list}</div><div class="col">${this.progressDetail('ms', m, this.milestoneState(m))}</div></div>`;
  }

  progressDetail(kind, m, st) {
    const g = this.game;
    const prog = g.state.prog;
    const sect = prog[kind];
    const active = sect.active === m.id;
    const have = (sect.have && sect.have[m.id]) || {};
    const inv = g.me.inv;
    let complete = true;
    const reqs = Object.entries(m.cost).map(([item, need]) => {
      const h = Math.min(need, have[item] || 0);
      if (h < need) complete = false;
      const inInv = countItem(inv, item);
      return `<div class="req"><img src="${itemIcon(item)}"><div class="nm">${ITEMS[item].name}<div class="bar ${h >= need ? 'good' : ''}"><div style="width:${h / need * 100}%"></div></div></div><b>${h} / ${need}</b><span class="small muted">(${inInv} in inv.)</span></div>`;
    }).join('');
    const u = m.unlocks || {};
    const unl = [
      ...(u.b || []).map(b => `<span class="u">🏗 ${BUILDINGS[b].name}</span>`),
      ...(u.r || []).map(r => `<span class="u">⚙ ${RECIPES[r].name}</span>`),
      ...(u.eq || []).map(x => `<span class="u">🎒 ${x === 'jetpack' ? 'Jetpack' : x}</span>`),
      ...(u.slots ? [`<span class="u">+${u.slots} Inventory Slots</span>`] : []),
      ...(u.gift ? Object.entries(u.gift).map(([k, v]) => `<span class="u">🎁 ${v} ${ITEMS[k].name}</span>`) : []),
    ].join('');
    let btns = '';
    if (st === 'done') btns = '<span class="good">Completed</span>';
    else if (st === 'locked') btns = `<span class="muted">${kind === 'ms' ? 'Tier locked — deliver Space Elevator parts.' : 'Requires previous research.'}</span>`;
    else if (!active) btns = `<button class="btn primary" data-act="select" data-kind="${kind}" data-id="${m.id}">Select as Active</button>`;
    else btns = `<button class="btn" data-act="submit" data-kind="${kind}">Submit Parts from Inventory</button>
      <button class="btn primary" data-act="complete" data-kind="${kind}" ${complete ? '' : 'disabled'}>${kind === 'ms' ? 'Ship with Freighter' : 'Complete Research'}</button>`;
    return `<div class="sect"><h3>${m.name}${m.tier != null ? ` · Tier ${m.tier}` : ''}</h3>${reqs}<div class="row-btns">${btns}</div></div>
      <div class="sect"><h3>Unlocks</h3><div class="unl">${unl || '<span class="muted">—</span>'}</div></div>`;
  }

  craftHtml() {
    const g = this.game;
    const prog = g.state.prog;
    const inv = g.me.inv;
    const list = Object.values(RECIPES).filter(r => r.hand && prog.r.includes(r.id));
    const cards = list.map(r => {
      const ok = hasAll(inv, r.in);
      return `<div class="recipe">
        <div class="t"><img src="${itemIcon(r.outList[0].item, 56)}">${r.name} <span class="muted small">×${r.outList[0].n}</span></div>
        <div class="io">${Object.entries(r.in).map(([k, v]) => `<span class="${countItem(inv, k) < v ? 'bad' : ''}"><img src="${itemIcon(k, 32)}">${v}</span>`).join('<span>+</span>')}</div>
        <button class="btn small craftbtn ${ok ? 'primary' : ''}" data-craft="${r.id}" ${ok ? '' : 'disabled'}><span class="p" data-craftp="${r.id}"></span>Hold to Craft (${fmt(handTime(r), 1)}s)</button></div>`;
    }).join('');
    return `<div class="cols"><div class="col"><div class="recipes" data-keepscroll style="max-height:62vh;overflow:auto">${cards}</div></div><div class="col" style="flex:0 0 auto">${this.playerInvHtml()}</div></div>`;
  }

  // ---------------------------------------------------------------- MAM
  renderMam() {
    const prog = this.game.state.prog;
    if (!this.rsSel) this.rsSel = prog.rs.active || RESEARCH[0].id;
    const trees = [...new Set(RESEARCH.map(r => r.tree))];
    const st = (r) => prog.rs.done.includes(r.id) ? 'done' : r.req && !prog.rs.done.includes(r.req) ? 'locked' : 'open';
    const list = trees.map(t => `<div class="ms-tier">${t}</div>` + RESEARCH.filter(r => r.tree === t).map(r =>
      `<div class="ms ${st(r)} ${this.rsSel === r.id ? 'sel' : ''} ${prog.rs.active === r.id ? 'active' : ''}" data-act="rssel" data-id="${r.id}"><span>${r.name}</span>${st(r) === 'done' ? '✔' : st(r) === 'locked' ? '🔒' : ''}</div>`).join('')).join('');
    const r = RESEARCH_BY_ID[this.rsSel];
    const body = `<div class="cols"><div class="ms-list" data-keepscroll>${list}</div><div class="col">${this.progressDetail('rs', r, st(r))}
      <div class="small muted">Research analyses resources you find in the world and unlocks new recipes. Submit samples from your inventory.</div></div></div>`;
    return this.win('Molecular Analysis Machine', body, '', true, 980);
  }

  // ---------------------------------------------------------------- Space Elevator
  renderElevator() {
    const g = this.game;
    const el = g.state.prog.elev;
    const ph = ELEVATOR_PHASES[el.phase];
    let body;
    if (!ph) {
      body = `<div class="sect"><h3>Project Assembly Complete</h3><p>All phases delivered. FICSIT is proud of you, Pioneers. Keep expanding your factory!</p></div>`;
    } else {
      let complete = true;
      const reqs = Object.entries(ph.cost).map(([item, need]) => {
        const h = Math.min(need, el.have[item] || 0);
        if (h < need) complete = false;
        return `<div class="req"><img src="${itemIcon(item)}"><div class="nm">${ITEMS[item].name}<div class="bar ${h >= need ? 'good' : ''}"><div style="width:${h / need * 100}%"></div></div></div><b>${h} / ${need}</b><span class="small muted">(${countItem(g.me.inv, item)} in inv.)</span></div>`;
      }).join('');
      body = `<div class="sect"><h3>Phase ${el.phase + 1}: ${ph.name}</h3>${reqs}
        <div class="row-btns"><button class="btn" data-act="submit" data-kind="elev">Submit Parts from Inventory</button>
        <button class="btn primary" data-act="complete" data-kind="elev" ${complete ? '' : 'disabled'}>Send to Orbit</button></div></div>
        <div class="sect"><h3>Reward</h3>${ph.unlocksText}</div>
        <div class="small muted">Tip: connect conveyors to the Space Elevator's inputs to deliver parts automatically.</div>`;
    }
    const phases = ELEVATOR_PHASES.map((p, i) => `<div class="stat"><span>Phase ${i + 1}: ${p.name}</span><span class="${i < el.phase ? 'good' : 'muted'}">${i < el.phase ? 'Delivered' : i === el.phase ? 'In progress' : 'Locked'}</span></div>`).join('');
    return this.win('Space Elevator — Project Assembly', `<div class="cols"><div class="col">${body}</div><div class="col" style="max-width:320px"><div class="sect"><h3>Phases</h3>${phases}</div></div></div>`, '', true, 900);
  }

  // ---------------------------------------------------------------- pause
  renderPause() {
    const g = this.game;
    let mp = '';
    if (g.isHost) {
      if (g.net) {
        const link = this.app.inviteLink(g.netCode, g.netMethod);
        mp = `<div class="stat"><span>Status</span><b class="good">Hosting (${g.netMethod === 'relay' ? 'Relay' : g.netMethod === 'local' ? 'Local' : 'Online P2P'})</b></div>
          <div class="stat"><span>Game code</span><b class="code" style="font-family:var(--head);font-size:22px;letter-spacing:4px;color:var(--orange)">${escapeHtml(g.netCode)}</b></div>
          <div class="row-btns"><button class="btn primary" data-act="copy" data-text="${escapeHtml(g.netCode)}">Copy Code</button><button class="btn" data-act="copy" data-text="${escapeHtml(link)}">Copy Invite Link</button><button class="btn danger" data-act="stophost">Stop Hosting</button></div>
          <div class="small muted" style="margin-top:8px">Send the code or link to your friend. They choose <b>Join Friend</b> on the main menu and enter it. Works across different networks — no port forwarding needed.</div>`;
      } else {
        mp = `<div class="small muted">Your world is currently private. Open it so a friend on another network can join:</div>
          <div class="row-btns"><button class="btn primary" data-act="host" data-m="online">Invite Friend (Online)</button><button class="btn" data-act="host" data-m="relay">Host via Relay Server</button></div>
          <div class="small muted" style="margin-top:6px">Online uses a free peer-to-peer connection (WebRTC). Use Relay only if Online fails and you run the relay server (see README).</div>`;
      }
    } else {
      mp = `<div class="stat"><span>Connected to</span><b>${escapeHtml(g.netCode || '')}</b></div><div class="small muted">You are playing in your friend's world. Progress is saved on the host's computer.</div>`;
    }
    const body = `<div class="cols"><div class="col" style="max-width:260px">
        <button class="btn primary" style="width:100%;margin-bottom:6px" data-act="close">Resume</button>
        ${g.isHost ? '<button class="btn" style="width:100%;margin-bottom:6px" data-act="save">Save Game</button><button class="btn" style="width:100%;margin-bottom:6px" data-act="export">Export Save File</button>' : ''}
        <button class="btn" style="width:100%;margin-bottom:6px" data-act="settings">Settings</button>
        <button class="btn" style="width:100%;margin-bottom:6px" data-act="help">Controls & Help</button>
        <button class="btn danger" style="width:100%" data-act="quit">${g.isHost ? 'Save & Quit to Menu' : 'Leave Game'}</button>
      </div><div class="col"><div class="sect"><h3>Multiplayer</h3>${mp}</div>
      <div class="sect"><h3>World</h3><div class="stat"><span>Name</span><b>${escapeHtml(g.state.name)}</b></div><div class="stat"><span>Seed</span><b>${g.state.seed}</b></div>
      <div class="stat"><span>Play time</span><b>${Math.floor(g.state.time / 3600)}h ${Math.floor(g.state.time / 60) % 60}m</b></div>
      <div class="stat"><span>Buildings</span><b>${g.state.ents.size}</b></div></div></div></div>`;
    return this.win('Paused', body, '', true, 820);
  }

  // ================================================================ events
  parseRef(s) {
    if (s === 'p') return { p: 1 };
    const [, id, w] = s.split(':');
    return { e: Number(id), w };
  }

  panelTargetRef(item) {
    if (!this.panel || this.panel.kind !== 'ent') return null;
    const e = this.game.factory.get(this.panel.id);
    if (!e) return null;
    const def = BUILDINGS[e.type];
    if (def.machine && e.inBuf.some(s => s.item === item)) return { e: e.id, w: 'in' };
    if (def.gen && def.fuels.includes(item)) return { e: e.id, w: 'fuel' };
    if (def.storage && !def.crate) return { e: e.id, w: 'slots' };
    return null;
  }

  quickMove(refStr, si, half) {
    const g = this.game;
    const src = this.parseRef(refStr);
    const acc = g.invAccess(g.pid, src);
    const s = acc && acc.slots[si];
    if (!s || !s.n) return;
    const n = half ? Math.ceil(s.n / 2) : s.n;
    let dst;
    if (src.p) dst = this.panelTargetRef(s.item);
    else dst = { p: 1 };
    if (!dst) return;
    g.dispatch({ k: 'xfer', src, si, dst, di: -1, n });
    g.audio.play('pickup');
  }

  onPointerDown(e) {
    this.pointerDown = true;
    const slot = e.target.closest('.slot');
    if (slot && this.game) {
      const ref = slot.getAttribute('data-ref');
      const si = Number(slot.getAttribute('data-si'));
      const acc = this.game.invAccess(this.game.pid, this.parseRef(ref));
      const s = acc && acc.slots[si];
      if (s && s.n > 0) {
        this.drag = { ref, si, x: e.clientX, y: e.clientY, button: e.button, moved: false, item: s.item, shift: e.shiftKey };
      }
      e.preventDefault();
    }
    const cb = e.target.closest('[data-craft]');
    if (cb && !cb.disabled) this.crafting = { r: cb.getAttribute('data-craft'), start: performance.now() };
    if (this.panel && this.panel.kind === 'map' && e.target.closest('#mapwrap')) this.mapPanel.down(e);
  }

  moveDrag(e) {
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) {
      d.moved = true;
      d.ghost = document.createElement('div');
      d.ghost.className = 'dragghost';
      d.ghost.innerHTML = `<img src="${itemIcon(d.item)}">`;
      document.body.appendChild(d.ghost);
    }
    if (d.ghost) {
      d.ghost.style.left = (e.clientX - 25) + 'px';
      d.ghost.style.top = (e.clientY - 25) + 'px';
    }
  }

  onPointerUp(e) {
    this.pointerDown = false;
    this.crafting = null;
    if (this.mapPanel) this.mapPanel.up(e);
    const d = this.drag;
    this.drag = null;
    if (!d || !this.game) return;
    if (d.ghost) d.ghost.remove();
    if (d.moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slot = el && el.closest ? el.closest('.slot') : null;
      const trash = el && el.closest ? el.closest('[data-trash]') : null;
      if (trash && d.ref === 'p') {
        this.game.dispatch({ k: 'trash', si: d.si });
        this.game.audio.play('dismantle', 0.4);
      } else if (slot) {
        const ref = slot.getAttribute('data-ref');
        const si = Number(slot.getAttribute('data-si'));
        if (ref !== d.ref || si !== d.si) {
          this.game.dispatch({ k: 'xfer', src: this.parseRef(d.ref), si: d.si, dst: this.parseRef(ref), di: si, n: d.button === 2 ? null : null });
          this.game.audio.play('pickup');
        }
      }
    } else {
      this.quickMove(d.ref, d.si, d.button === 2);
    }
  }

  onChange(e) {
    const t = e.target;
    const ch = t.getAttribute('data-change');
    if (ch === 'clock') {
      this.game.dispatch({ k: 'clock', id: Number(t.getAttribute('data-id')), clock: Number(t.value) / 100 });
    } else if (ch === 'setting') {
      this.app.changeSetting(t);
    }
  }

  onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target === this.panelEl && this.panel && !['disconnected'].includes(this.panel.kind)) this.closePanel();
      return;
    }
    const act = el.getAttribute('data-act');
    const g = this.game;
    const id = Number(el.getAttribute('data-id'));
    if (g) g.audio.play('click');
    switch (act) {
      case 'close': this.closePanel(); break;
      case 'bcat': this.buildCat = el.getAttribute('data-cat'); this.render(); break;
      case 'pick': {
        const type = el.getAttribute('data-build');
        this.closePanel();
        g.build.select(type);
        break;
      }
      case 'recipe': g.dispatch({ k: 'recipe', id, recipe: el.getAttribute('data-r') }); this.panel.pickRecipe = false; break;
      case 'pickrecipe': this.panel.pickRecipe = true; this.render(); break;
      case 'cancelpick': this.panel.pickRecipe = false; this.render(); break;
      case 'shard': g.dispatch({ k: 'shard', id, d: Number(el.getAttribute('data-d')) }); break;
      case 'takeall': g.dispatch({ k: 'takeall', src: this.parseRef(el.getAttribute('data-ref')) }); g.audio.play('pickup'); break;
      case 'sort': g.dispatch({ k: 'sort' }); break;
      case 'fuse': g.dispatch({ k: 'fuse', id }); break;
      case 'hubtab': this.hubTab = el.getAttribute('data-t'); this.panel.tab = null; this.render(); break;
      case 'sinktab': this.sinkTab = el.getAttribute('data-t'); this.render(); break;
      case 'mssel': this.msSel = el.getAttribute('data-id'); this.render(); break;
      case 'rssel': this.rsSel = el.getAttribute('data-id'); this.render(); break;
      case 'select': g.dispatch({ k: 'select', kind: el.getAttribute('data-kind'), id: el.getAttribute('data-id') }); break;
      case 'submit': g.dispatch({ k: 'submit', kind: el.getAttribute('data-kind') }); break;
      case 'complete': g.dispatch({ k: 'complete', kind: el.getAttribute('data-kind') }); break;
      case 'shop': g.dispatch({ k: 'shop', id: el.getAttribute('data-id') }); break;
      case 'save': this.app.saveGame(g); break;
      case 'export': this.app.exportSave(g); break;
      case 'settings': this.openPanel('settings'); break;
      case 'help': this.openPanel('help'); break;
      case 'quit': this.app.quitToMenu(); break;
      case 'host': this.app.startHosting(el.getAttribute('data-m')); break;
      case 'stophost': g.stopHosting(); this.render(); break;
      case 'copy': {
        const text = el.getAttribute('data-text');
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => this.toast('Copied to clipboard', 'good'), () => { window.prompt('Copy this:', text); });
        break;
      }
      case 'back': this.openPanel('pause'); break;
      default:
        if (this.app.onAct) this.app.onAct(act, el);
    }
  }

  // ================================================================ hotbar
  autoHotbar() {
    if (!this.game) return;
    const s = this.app.settings;
    const hb = s.hotbar || (s.hotbar = new Array(10).fill(null));
    const prefer = ['hub', 'miner_mk1', 'belt_mk1', 'smelter', 'constructor', 'power_pole_mk1', 'power_line', 'biomass_burner', 'foundation_1', 'storage_container',
      'conveyor_pole', 'assembler', 'splitter', 'merger', 'belt_mk2', 'coal_generator', 'foundry', 'belt_mk3', 'miner_mk2', 'manufacturer'];
    const prog = this.game.state.prog;
    let changed = false;
    for (const t of prefer) {
      if (!prog.b.includes(t) || hb.includes(t)) continue;
      const idx = hb.indexOf(null);
      if (idx < 0) break;
      hb[idx] = t;
      changed = true;
    }
    if (hb[0] === 'hub' && this.game.factory.countType('hub') > 0 && prog.b.length > 3) {
      hb[0] = null;
      changed = true;
    }
    if (changed) { this.app.saveSettings(); this.renderHotbar(); }
  }

  renderHotbar() {
    if (!this.game) return;
    const hb = this.app.settings.hotbar || [];
    const el = $('#hotbar');
    let html = '';
    for (let i = 0; i < 10; i++) {
      const t = hb[i];
      const sel = this.game.build.mode === 'build' && this.game.build.type === t;
      html += `<div class="hb ${sel ? 'sel' : ''}"><span class="k">${(i + 1) % 10}</span>${t && this.bIcons[t] ? `<img src="${this.bIcons[t]}">` : ''}${t ? `<span class="nm">${BUILDINGS[t].name}</span>` : ''}</div>`;
    }
    el.innerHTML = html;
    this.hotbarKey = `${this.game.build.mode}:${this.game.build.type}:${hb.join(',')}:${Object.keys(this.bIcons).length}`;
  }

  // ================================================================ per frame
  handleKeys() {
    const g = this.game;
    const input = g.input;
    if (this.chatOpen) return;
    const p = this.panel;
    if (this.justOpened) { this.justOpened = false; return; }
    if (input.hit('Escape')) {
      if (p) { if (p.kind === 'settings' || p.kind === 'help') this.openPanel('pause'); else if (p.kind !== 'disconnected') this.closePanel(); }
      else if (g.build.mode) g.build.cancel();
      else this.openPanel('pause');
      return;
    }
    if (p && p.kind === 'build') {
      for (let i = 0; i < 10; i++) {
        if (input.hit('Digit' + ((i + 1) % 10)) && this.hoverBuild) {
          const hb = this.app.settings.hotbar || (this.app.settings.hotbar = new Array(10).fill(null));
          const j = hb.indexOf(this.hoverBuild);
          if (j >= 0) hb[j] = null;
          hb[i] = this.hoverBuild;
          this.app.saveSettings();
          this.renderHotbar();
          this.render();
          this.toast(`Hotbar ${(i + 1) % 10}: ${BUILDINGS[this.hoverBuild].name}`, 'info', 1500);
        }
      }
    }
    if (p && !['inventory', 'build', 'ent', 'hub', 'mam', 'elevator', 'map'].includes(p.kind)) return;
    if (input.hit('Tab') || input.hit('KeyI')) { this.togglePanel('inventory'); return; }
    if (input.hit('KeyQ')) { this.togglePanel('build'); return; }
    if (input.hit('KeyM')) { this.togglePanel('map'); return; }
    if (p && input.hit('KeyE')) { this.closePanel(); return; }
    if (p) return;
    if (input.hit('Enter') || input.hit('KeyT')) { if (g.net) { this.openChat(); return; } }
    if (input.hit('KeyF')) { if (g.build.mode === 'dismantle') g.build.cancel(); else g.build.dismantle(); }
    if (input.hit('KeyV')) { g.flashlight = !g.flashlight; g.audio.play('click'); }
    if (input.hit('KeyH')) { this.hideHud = !this.hideHud; }
    for (let i = 0; i < 10; i++) {
      if (input.hit('Digit' + ((i + 1) % 10))) {
        const t = (this.app.settings.hotbar || [])[i];
        if (t && g.state.prog.b.includes(t)) {
          if (g.build.mode === 'build' && g.build.type === t) g.build.cancel();
          else g.build.select(t);
        }
      }
    }
  }

  update(dt) {
    const g = this.game;
    if (!g) return;
    this.handleKeys();
    // pointer lock prompts
    const locked = g.input.locked;
    $('#clickstart').classList.toggle('hidden', locked || !!this.panel || !!this.chatOpen);
    if (this.wasLocked && !locked && !this.panel && !this.chatOpen && !this.intentionalUnlock && g.running) {
      this.openPanel('pause');
    }
    if (locked) this.intentionalUnlock = false;
    this.wasLocked = locked;

    this.hud.style.opacity = this.hideHud ? '0' : '1';

    // crafting hold
    if (this.crafting && this.panel && this.panel.kind === 'hub') {
      const r = RECIPES[this.crafting.r];
      const t = (performance.now() - this.crafting.start) / 1000;
      const need = handTime(r);
      const bar = this.panelEl.querySelector(`[data-craftp="${r.id}"]`);
      if (bar) bar.style.width = clamp(t / need, 0, 1) * 100 + '%';
      if (t >= need) {
        this.crafting.start = performance.now();
        if (hasAll(g.me.inv, r.in)) { g.dispatch({ k: 'craft', recipe: r.id }); g.audio.play('craft'); }
        else this.crafting = null;
      }
    }

    // panel refresh
    this.refreshTimer -= dt;
    if (this.panel && this.refreshTimer <= 0 && ['ent', 'hub', 'mam', 'elevator'].includes(this.panel.kind)) {
      this.refreshTimer = 0.3;
      if (this.panel.kind === 'ent') this.dirty = true;
    }
    if (this.panel && this.panel.kind === 'map') this.mapPanel.draw();
    const focused = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && this.panelEl.contains(document.activeElement);
    if (this.dirty && !this.pointerDown && !this.drag && !focused) this.render();

    // HUD bits
    const key = `${g.build.mode}:${g.build.type}:${(this.app.settings.hotbar || []).join(',')}:${Object.keys(this.bIcons).length}`;
    if (key !== this.hotbarKey) this.renderHotbar();
    this.updatePrompt();
    this.updateBuildInfo();
    this.updateCompass();
    this.trackerTimer -= dt;
    if (this.trackerTimer <= 0) { this.trackerTimer = 0.5; this.updateTracker(); this.updateAlerts(); }
    const jet = $('#jetbar');
    const showJet = g.state.prog.eq.includes('jetpack') && g.player.jetFuel < 0.999;
    jet.classList.toggle('hidden', !showJet);
    if (showJet) jet.firstChild.style.width = g.player.jetFuel * 100 + '%';
    const hold = $('#holdbar');
    const it = g.interact;
    const showHold = it.target && it.target.kind === 'flora' && it.hold > 0;
    hold.classList.toggle('hidden', !showHold);
    if (showHold) hold.firstChild.style.width = clamp(it.hold / (it.holdNeed || 1), 0, 1) * 100 + '%';
    this.fpsAcc = (this.fpsAcc || 0) + dt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 1) {
      const fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0; this.fpsN = 0;
      const p = g.player.pos;
      $('#stats').textContent = this.app.settings.showFps ? `${Math.round(fps)} FPS · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}` : '';
    }
  }

  updatePrompt() {
    const g = this.game;
    let html = '';
    if (!g.build.mode && !this.panel) html = g.interact.promptHtml();
    if (html !== this.lastPrompt) {
      $('#prompt').innerHTML = html;
      this.lastPrompt = html;
    }
    const ch = $('#crosshair');
    ch.className = g.build.mode === 'build' ? 'build' : g.build.mode === 'dismantle' ? 'dismantle' : '';
  }

  updateBuildInfo() {
    const g = this.game;
    const b = g.build;
    const el = $('#buildinfo');
    if (!b.mode || this.panel) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); this.lastInfo = ''; return; }
    let html;
    if (b.mode === 'dismantle') {
      const t = b.target;
      let refund = '';
      if (t) {
        const def = BUILDINGS[t.type];
        refund = def.kind === 'bld' ? costHtml(def.cost) : '';
      }
      html = `<h3>Dismantle Mode</h3><div>${escapeHtml(b.info)}</div>${refund ? `<div class="costs">${refund}</div>` : ''}<div class="hint">LMB dismantle · F / RMB exit</div>`;
      el.className = 'dismantle';
    } else {
      const def = BUILDINGS[b.type];
      const inv = g.me.inv;
      let cost = '';
      if (def.kind === 'belt' || def.kind === 'wire') cost = b.costPreview && b.start ? costHtml(b.costPreview, inv) : costHtml(def.cost, inv) + `<span class="small muted">per ${def.costPer} m</span>`;
      else cost = Object.keys(def.cost).length ? costHtml(def.cost, inv) : '<span class="muted">Free</span>';
      let hint;
      if (def.kind === 'belt') hint = b.start ? 'LMB place · RMB cancel segment · PgUp/PgDn pole height' : 'LMB start at an output port or the ground · PgUp/PgDn pole height';
      else if (def.kind === 'wire') hint = b.start ? 'LMB connect · RMB cancel' : 'LMB start at a building or pole';
      else if (def.snap === 'grid8' || def.snap === 'wall') hint = 'LMB build · R / Wheel rotate · PgUp/PgDn height · RMB cancel';
      else hint = 'LMB build · R / Wheel rotate · RMB cancel';
      const extra = def.logistic === 'pole' ? ` · height ${fmt(clamp(1 + b.hOff, 0.5, 12), 1)} m` : (def.arch && b.hOff ? ` · offset ${b.hOff} m` : '');
      html = `<h3>${def.name}</h3><div class="costs">${cost}</div>${b.info ? `<div class="${b.info.startsWith('Length') || b.info.startsWith('Power Line') || b.info.startsWith('Click') || b.info.startsWith('Place') || b.info.includes('connections') ? '' : 'err'}">${escapeHtml(b.info)}</div>` : ''}<div class="hint">${hint}${extra}</div>`;
      el.className = '';
    }
    if (html !== this.lastInfo) { el.innerHTML = html; this.lastInfo = html; }
  }

  updateCompass() {
    const g = this.game;
    const heading = -g.player.yaw;
    const W = this.compassEl.clientWidth || 500;
    const span = Math.PI * 0.9;
    const place = (el, b) => {
      let rel = b - heading;
      rel = ((rel + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(rel) > span / 2) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.left = (W / 2 + rel / (span / 2) * W / 2) + 'px';
    };
    for (const m of this.compassMarks) place(m.el, m.b);
    // points of interest: HUB, other players
    const pos = g.player.pos;
    const pois = [];
    const hub = g.factory.findType('hub');
    if (hub) pois.push({ key: 'hub', label: '⌂ HUB', x: hub.x, z: hub.z, cls: 'poi' });
    const el = g.factory.findType('space_elevator');
    if (el) pois.push({ key: 'elev', label: '▲ Elevator', x: el.x, z: el.z, cls: 'poi' });
    for (const [pid, P] of Object.entries(g.state.players)) {
      if (pid === g.pid || !P.online || P.x == null) continue;
      pois.push({ key: 'p:' + pid, label: '● ' + P.name, x: P.x, z: P.z, cls: 'player', color: P.color });
    }
    const seen = new Set();
    for (const p of pois) {
      seen.add(p.key);
      let e = this.compassPois.get(p.key);
      if (!e) {
        e = document.createElement('div');
        e.className = 'mark ' + p.cls;
        this.compassEl.appendChild(e);
        this.compassPois.set(p.key, e);
      }
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      const txt = `${p.label} ${Math.round(d)}m`;
      if (e.textContent !== txt) e.textContent = txt;
      if (p.color) e.style.color = p.color;
      place(e, Math.atan2(p.x - pos.x, -(p.z - pos.z)));
    }
    for (const [k, e] of this.compassPois) if (!seen.has(k)) { e.remove(); this.compassPois.delete(k); }
  }

  updateTracker() {
    const g = this.game;
    if (!g) return;
    const prog = g.state.prog;
    const inv = g.me.inv;
    const el = $('#tracker');
    let html = '';
    const hub = g.factory.findType('hub');
    if (!hub) {
      html = `<h4>Getting Started</h4><div class="tip">Welcome, Pioneer! Press <b>Q</b> to open the Build Menu and place <b>The HUB</b> on flat ground near your landing site.</div>`;
    } else if (!prog.ms.active) {
      const next = MILESTONES.find(m => this.milestoneState(m) === 'open');
      if (next) html = `<h4>Next Milestone</h4><div class="tip">Walk up to the HUB terminal, press <b>E</b> and select <b>${next.name}</b> as your active milestone.</div>`;
      else if (ELEVATOR_PHASES[prog.elev.phase]) html = `<h4>Project Assembly</h4><div class="tip">All available milestones are done! Deliver Space Elevator Phase ${prog.elev.phase + 1} parts to unlock more tiers.</div>`;
      else html = `<h4>Project Assembly</h4><div class="tip good">Complete! Keep building your dream factory.</div>`;
    } else {
      const m = MILESTONE_BY_ID[prog.ms.active];
      const have = prog.ms.have[m.id] || {};
      html = `<h4>${m.name}</h4>` + Object.entries(m.cost).map(([item, need]) => {
        const dep = have[item] || 0;
        const tot = Math.min(need, dep + countItem(inv, item));
        return `<div class="row ${dep >= need ? 'done' : ''}"><img src="${itemIcon(item, 32)}"><span class="nm">${ITEMS[item].name}</span><span>${tot}/${need}</span></div>`;
      }).join('');
      html += `<div class="tip">${this.tipFor(m)}</div>`;
    }
    if (html !== this.lastTracker) { el.innerHTML = html; this.lastTracker = html; }
  }

  tipFor(m) {
    const prog = this.game.state.prog;
    if (m.id === 'hub1') return 'Hold <b>LMB</b> on an Iron Ore node to mine it by hand. Then use the HUB <b>Craft Bench</b> (E on HUB → Craft Bench) to make Iron Ingots and Iron Rods.';
    if (m.id === 'hub2') return 'Craft Iron Plates & Rods at the Craft Bench, then <b>Submit</b> and <b>Ship</b> at the HUB terminal.';
    if (m.id === 'hub3') return 'Mine Copper Ore for Wire. Harvest leaves & wood (hold LMB on plants) to fuel a Biomass Burner.';
    if (m.id === 'hub4') return 'Mine Limestone for Concrete. Build Miners on nodes, connect them with Conveyor Belts to Smelters, and power everything with Power Lines.';
    if (!prog.b.includes('space_elevator') && m.tier >= 2) return 'The Space Elevator unlocks with Part Assembly.';
    return 'Automate production with Miners → Smelters → Constructors. Submit parts at the HUB.';
  }

  updateAlerts() {
    const g = this.game;
    const out = [];
    let tripped = false;
    for (const n of g.factory.nets) if (n.tripped) tripped = true;
    if (tripped) out.push('⚡ POWER FUSE TRIPPED — open a generator and Reset Fuse');
    if (g.me.inv.every(s => s && s.n >= stackOf(s.item))) out.push('Inventory full');
    const html = out.map(t => `<div class="alert">${t}</div>`).join('');
    const el = $('#alerts');
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}
