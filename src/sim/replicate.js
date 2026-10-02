// Client-side application of replicated host events to the simulation state.
// Returns a small description of what changed so the caller can update visuals.
import { deserializeEnt } from './factory.js';

export function applySimEvent(state, factory, ev) {
  switch (ev.k) {
    case 'add': {
      let replaced = null;
      if (factory.get(ev.e.id)) { factory.removeEntity(ev.e.id); replaced = ev.e.id; }
      const e = deserializeEnt(ev.e);
      return { added: factory.addEntity(e), replaced };
    }
    case 'del':
      return { removed: factory.removeEntity(ev.id) ? ev.id : null };
    case 'upd': {
      const e = factory.get(ev.e.id);
      if (!e) return {};
      const d = deserializeEnt(ev.e);
      for (const k of Object.keys(d)) e[k] = d[k];
      return { updated: e };
    }
    case 'inv': {
      const P = state.players[ev.pid];
      if (P) P.inv = ev.inv;
      return { inv: ev.pid };
    }
    case 'prog':
      state.prog = ev.p;
      return { prog: true };
    case 'flora':
      for (const id of ev.ids) state.floraGone.add(id);
      return { flora: ev.ids };
    default:
      return {};
  }
}
