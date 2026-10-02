// Slot-array helpers. A slot is null or { item, n }.
import { stackOf } from '../data/items.js';

export function makeSlots(n) {
  return new Array(n).fill(null);
}

export function countItem(slots, item) {
  let c = 0;
  for (const s of slots) if (s && s.item === item) c += s.n;
  return c;
}

export function hasAll(slots, cost) {
  for (const [item, n] of Object.entries(cost)) if (countItem(slots, item) < n) return false;
  return true;
}

export function removeAll(slots, cost) {
  if (!hasAll(slots, cost)) return false;
  for (const [item, n] of Object.entries(cost)) removeItem(slots, item, n);
  return true;
}

export function removeItem(slots, item, n) {
  let left = n;
  for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
    const s = slots[i];
    if (s && s.item === item) {
      const take = Math.min(s.n, left);
      s.n -= take;
      left -= take;
      if (s.n <= 0) slots[i] = null;
    }
  }
  return n - left;
}

// Adds as many as possible, returns leftover count.
export function addItem(slots, item, n) {
  const stack = stackOf(item);
  let left = n;
  for (const s of slots) {
    if (left <= 0) break;
    if (s && s.item === item && s.n < stack) {
      const put = Math.min(stack - s.n, left);
      s.n += put;
      left -= put;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (!slots[i]) {
      const put = Math.min(stack, left);
      slots[i] = { item, n: put };
      left -= put;
    }
  }
  return left;
}

export function spaceFor(slots, item) {
  const stack = stackOf(item);
  let space = 0;
  for (const s of slots) {
    if (!s) space += stack;
    else if (s.item === item) space += stack - s.n;
  }
  return space;
}

export function canAddAll(slots, items) {
  // simulate on a copy
  const copy = slots.map(s => (s ? { ...s } : null));
  for (const [item, n] of Object.entries(items)) if (addItem(copy, item, n) > 0) return false;
  return true;
}

export function isEmpty(slots) {
  return slots.every(s => !s || s.n <= 0);
}

export function cloneSlots(slots) {
  return slots.map(s => (s ? { item: s.item, n: s.n } : null));
}

export function resizeSlots(slots, n) {
  while (slots.length < n) slots.push(null);
  return slots;
}

export function sumCosts(...costs) {
  const out = {};
  for (const c of costs) for (const [k, v] of Object.entries(c || {})) out[k] = (out[k] || 0) + v;
  return out;
}
