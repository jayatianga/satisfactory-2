// Keyboard / mouse state with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, down: new Set(), clicked: new Set(), wheel: 0 };
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.typing = () => {
      const a = document.activeElement;
      return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    };
    window.addEventListener('keydown', (e) => {
      if (this.typing()) return;
      if (['Tab', 'Space', 'PageUp', 'PageDown', 'F1', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse.down.add(e.button);
      this.mouse.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => { this.mouse.down.delete(e.button); });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouse.down.clear(); this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.clicked.clear();
  }
}
