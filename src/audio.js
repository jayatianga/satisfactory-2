// Tiny synthesized sound effects via WebAudio — no audio files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.lastPlay = {};
  }

  ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
    } catch (e) {
      this.ctx = null;
    }
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, freq = 1200, q = 1, gain = 0.25, type = 'bandpass', delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ensure() || this.volume <= 0) return;
    const now = performance.now();
    if (this.lastPlay[name] && now - this.lastPlay[name] < 40) return;
    this.lastPlay[name] = now;
    const v = vol;
    switch (name) {
      case 'click': this.tone(880, 0.06, 'square', 0.05 * v); break;
      case 'tick': this.tone(1400, 0.03, 'square', 0.03 * v); break;
      case 'error': this.tone(220, 0.15, 'sawtooth', 0.08 * v); this.tone(180, 0.18, 'sawtooth', 0.06 * v, null, 0.08); break;
      case 'build':
        this.burst(0.25, 400, 0.8, 0.35 * v, 'lowpass');
        this.tone(140, 0.3, 'sine', 0.3 * v, 60);
        this.tone(900, 0.12, 'triangle', 0.05 * v, 1800, 0.02);
        break;
      case 'dismantle':
        this.tone(300, 0.35, 'sawtooth', 0.06 * v, 80);
        this.burst(0.3, 2000, 0.5, 0.12 * v);
        break;
      case 'wire': this.tone(1200, 0.12, 'sine', 0.08 * v, 2400); this.burst(0.08, 5000, 2, 0.06 * v); break;
      case 'mine': this.burst(0.12, 2600, 1.2, 0.3 * v); this.tone(420, 0.08, 'triangle', 0.08 * v, 260); break;
      case 'harvest': this.burst(0.2, 900, 0.7, 0.25 * v, 'lowpass'); break;
      case 'pickup': this.tone(660, 0.07, 'triangle', 0.08 * v, 990); break;
      case 'craft': this.tone(520, 0.08, 'square', 0.04 * v); this.tone(780, 0.1, 'square', 0.04 * v, null, 0.07); break;
      case 'submit': this.tone(440, 0.1, 'triangle', 0.1 * v, 660); break;
      case 'milestone':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12 * v, null, i * 0.12));
        this.tone(1047, 0.8, 'sine', 0.06 * v, null, 0.5);
        break;
      case 'notify': this.tone(990, 0.08, 'sine', 0.07 * v); this.tone(1320, 0.12, 'sine', 0.06 * v, null, 0.08); break;
      case 'chat': this.tone(1200, 0.05, 'sine', 0.05 * v); break;
      case 'step': this.burst(0.06, 500 + Math.random() * 300, 0.8, 0.05 * v, 'lowpass'); break;
      case 'land': this.burst(0.15, 300, 0.7, 0.2 * v, 'lowpass'); break;
      case 'fuse': this.burst(0.5, 3000, 0.4, 0.3 * v); this.tone(120, 0.6, 'sawtooth', 0.1 * v, 40); break;
      case 'jet': this.burst(0.12, 700, 0.5, 0.06 * v, 'lowpass'); break;
      default: break;
    }
  }

  startAmbience() {
    const c = this.ctx;
    // soft wind
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.025;
    s.connect(f).connect(this.windGain).connect(this.master);
    s.start();
    // factory hum: two detuned oscillators, volume driven by nearby machines
    this.humGain = c.createGain();
    this.humGain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    for (const fr of [55, 82.4, 110.3]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(lp);
      o.start();
    }
    lp.connect(this.humGain).connect(this.master);
  }

  setHum(level) {
    if (!this.humGain) return;
    const target = Math.min(0.05, level * 0.006);
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.3);
  }
}
