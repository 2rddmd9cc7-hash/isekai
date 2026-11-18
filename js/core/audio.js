import { G } from './state.js';
import { clamp, rand } from './utils.js';

/* ================================================================== */
/*  Procedural audio: ambience, SFX and a small adaptive score.        */
/*  Everything is synthesised — no asset downloads.                    */
/* ================================================================== */

const MIDI = m => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.mode = 'explore';
    this.step = 0;
    this.nextTime = 0;
    this.bpm = 76;
    this.waterNear = 0;
    this.fireNear = 0;
    this.combatNear = 0;
    this.bossNear = 0;
    this.birdTimer = 3;
    this.windGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.ambGain = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 5;
      comp.attack.value = 0.004; comp.release.value = 0.22; comp.connect(master);
      this.master = master;
      this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(comp);
      this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 0.8; this.sfxGain.connect(comp);
      this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.75; this.ambGain.connect(comp);
      // noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.startAmbience();
      this.startMusic();
      this.ready = true;
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { console.warn('Audio unavailable', e); }
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.t);
    this.master.gain.linearRampToValueAtTime(m ? 0 : 0.85, this.t + 0.25);
  }

  /* ---------------- ambience ---------------- */
  startAmbience() {
    const ctx = this.ctx;
    // wind: filtered looped noise
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.8;
    const gain = this.windGain = ctx.createGain(); gain.gain.value = 0.055;
    src.connect(lp); lp.connect(gain); gain.connect(this.ambGain); src.start();
    // slow swell
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(gain.gain); lfo.start();
    // water layer
    const wsrc = ctx.createBufferSource(); wsrc.buffer = this.noiseBuf; wsrc.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.5;
    const wg = this.waterGain = ctx.createGain(); wg.gain.value = 0;
    wsrc.connect(bp); bp.connect(wg); wg.connect(this.ambGain); wsrc.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.9;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.5; lfo2.connect(lg2); lg2.connect(wg.gain); lfo2.start();
    // fire layer
    const fsrc = ctx.createBufferSource(); fsrc.buffer = this.noiseBuf; fsrc.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const fg = this.fireGain = ctx.createGain(); fg.gain.value = 0;
    fsrc.connect(hp); hp.connect(fg); fg.connect(this.ambGain); fsrc.start();
  }

  startMusic() {
    this.nextTime = this.t + 0.4;
    this.step = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 140);
  }

  setMusicMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.bpm = mode === 'boss' ? 150 : mode === 'combat' ? 128 : mode === 'victory' ? 92 : 76;
    this.step = 0;
    if (this.ctx) this.nextTime = Math.max(this.nextTime, this.t + 0.25);
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.cancelScheduledValues(this.t);
      this.musicGain.gain.setTargetAtTime(mode === 'none' ? 0 : 0.5, this.t, 0.9);
    }
  }

  scheduleMusic() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const spb = 60 / this.bpm / 2; // eighth notes
    while (this.nextTime < this.t + 0.35) {
      this.playStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += spb;
    }
  }

  playStep(step, t) {
    const mode = this.mode;
    if (mode === 'none') return;
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    // chord roots (A minor / F / C / G)
    const roots = [57, 53, 60, 55];
    const root = roots[bar];
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const combat = mode === 'combat' || mode === 'boss';
    const boss = mode === 'boss';
    const g = this.musicGain.gain.value > 0 ? this.musicGain : null;
    if (!g) return;
    // pad at bar start
    if (s === 0) {
      this.pad(root, t, 60 / this.bpm * 4.2, boss ? 0.5 : combat ? 0.34 : 0.28);
      this.pad(root + 7, t, 60 / this.bpm * 4.2, boss ? 0.3 : 0.18);
    }
    // bass
    if (combat && (s === 0 || s === 6 || s === 8 || s === 14)) {
      this.pluck(MIDI(root - 12 + (s === 14 ? 2 : 0)), t, 0.28, 0.18, 'triangle');
    } else if (!combat && s === 0) {
      this.pluck(MIDI(root - 12), t, 0.9, 0.12, 'sine');
    }
    // arpeggio
    if (!combat) {
      if (s % 2 === 0 && (s === 0 || s === 2 || s === 4 || s === 8 || s === 10 || s === 12)) {
        const n = scale[[0, 2, 4, 2, 5, 3, 1, 4][(step / 2) % 8 | 0]];
        this.pluck(MIDI(root + 12 + n), t, 0.7, 0.055, 'triangle');
      }
    } else {
      const pat = boss ? [0, 4, 2, 4, 6, 4, 2, 1] : [0, 2, 4, 2, 5, 4, 2, 3];
      if (s % 2 === 0) this.pluck(MIDI(root + 12 + scale[pat[(step / 2) % 8 | 0] % 7]), t, 0.2, boss ? 0.1 : 0.07, 'square');
    }
    // percussion
    if (combat) {
      if (s === 0 || s === 6 || s === 8 || (boss && s === 11)) this.kick(t, boss ? 0.75 : 0.55);
      if (s === 4 || s === 12) this.snare(t, boss ? 0.32 : 0.22);
      if (boss && s % 2 === 0) this.hat(t, 0.045);
      else if (s % 4 === 2) this.hat(t, 0.03);
    }
    // boss brass stabs
    if (boss && (s === 0 || s === 8)) {
      this.brass(root - 12, t, 0.5);
    }
  }

  pad(midi, t, dur, vol) {
    const ctx = this.ctx;
    const f = MIDI(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.5);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    }
    lp.connect(g); g.connect(this.musicGain);
  }
  pluck(f, t, dur, vol, type = 'triangle') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3400, t); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  brass(midi, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = MIDI(midi);
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = MIDI(midi) * 1.005;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur); o2.start(t); o2.stop(t + dur);
  }
  kick(t, vol = 0.5) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.3);
  }
  snare(t, vol = 0.25) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(hp); hp.connect(g); g.connect(this.musicGain);
    src.start(t, rand(0, 1)); src.stop(t + 0.2);
  }
  hat(t, vol = 0.03) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp); hp.connect(g); g.connect(this.musicGain);
    src.start(t, rand(0, 1)); src.stop(t + 0.08);
  }

  update(dt) {
    if (!this.ready) return;
    // ambient layers follow proximity
    const t = this.t;
    if (this.waterGain) this.waterGain.gain.setTargetAtTime(0.004 + this.waterNear * 0.16, t, 0.6);
    if (this.fireGain) this.fireGain.gain.setTargetAtTime(this.fireNear * 0.055, t, 0.5);
    // birds by day
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(4, 11);
      if (this.combatNear < 0.4 && !this.muted) {
        const n = 2 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++) setTimeout(() => this.bird(), i * rand(90, 160));
      }
    }
    // combat music trigger
    if (!G.paused && G.player && !G.over) {
      let near = 0, boss = 0;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const d = e.group.position.distanceTo(G.player.group.position);
        if (d < 22 && e.aggro) near = Math.max(near, 1 - d / 24);
        if (e.isBoss && d < 40) boss = 1;
      }
      this.combatNear = near; this.bossNear = boss;
      const mode = boss > 0 ? 'boss' : near > 0.25 ? 'combat' : 'explore';
      this.setMusicMode(mode);
    }
  }

  bird() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = this.t;
    const base = rand(1900, 3200);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base;
    const g = ctx.createGain();
    const dur = rand(0.07, 0.14);
    for (let i = 0; i < 2; i++) {
      const tt = t + i * rand(0.1, 0.2);
      o.frequency.setValueAtTime(base * (i ? 1.14 : 1), tt);
      o.frequency.exponentialRampToValueAtTime(base * (i ? 0.86 : 1.22), tt + dur);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.035, tt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
    }
    o.connect(g); g.connect(this.ambGain); o.start(t); o.stop(t + 0.5);
  }

  /* ---------------- SFX primitives ---------------- */
  noise(t, dur, vol, type, freq, q = 1, dest = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    src.start(t, rand(0, 1.4)); src.stop(t + dur + 0.05);
    return { src, f, g };
  }
  tone(t, freq, dur, vol, type = 'sine', slideTo = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }

  sfx(name, opt = {}) {
    if (!this.ready || this.muted) return;
    const t = this.t + 0.001;
    const p = opt.pitch || 1;
    switch (name) {
      case 'swing':
        this.noise(t, 0.16, 0.18, 'bandpass', 900 * p, 1.4);
        this.noise(t + 0.03, 0.12, 0.1, 'highpass', 2600, 0.7);
        break;
      case 'heavySwing':
        this.noise(t, 0.34, 0.24, 'bandpass', 500, 1.2);
        break;
      case 'hit':
        this.tone(t, 130, 0.16, 0.22, 'triangle', 55);
        this.noise(t, 0.09, 0.16, 'highpass', 2400, 0.8);
        break;
      case 'crit':
        this.tone(t, 180, 0.2, 0.22, 'square', 70);
        this.noise(t, 0.14, 0.22, 'highpass', 3200, 0.7);
        this.tone(t + 0.02, 1300, 0.2, 0.09, 'triangle', 700);
        break;
      case 'stepGrass': this.noise(t, 0.1, 0.075, 'lowpass', 620 + rand(-80, 80), .6); break;
      case 'stepStone': this.noise(t, 0.07, 0.1, 'bandpass', 1800 + rand(-300, 300), 1.8); break;
      case 'stepWood': this.noise(t, 0.09, 0.09, 'bandpass', 620, 3); break;
      case 'stepWater': this.noise(t, 0.16, 0.13, 'bandpass', 1100, .8); this.tone(t, 480, 0.09, 0.03, 'sine', 700); break;
      case 'jump': this.noise(t, 0.18, 0.08, 'bandpass', 700, 1); this.tone(t, 300, 0.12, 0.04, 'sine', 480); break;
      case 'land': this.tone(t, 90, 0.16, 0.16, 'triangle', 45); this.noise(t, 0.1, 0.1, 'lowpass', 500); break;
      case 'dodge': this.noise(t, 0.26, 0.14, 'bandpass', 600, 0.8); this.tone(t, 200, 0.2, 0.04, 'sine', 480); break;
      case 'fireCharge': this.noise(t, 0.6, 0.08, 'bandpass', 400, 1.2); this.tone(t, 140, 0.55, 0.06, 'sawtooth', 420); break;
      case 'fireCast':
        this.noise(t, 0.3, 0.16, 'bandpass', 800, 0.7);
        this.tone(t, 300, 0.25, 0.08, 'sawtooth', 700);
        break;
      case 'explosion':
        this.noise(t, 0.65, 0.3, 'lowpass', 700, 0.8);
        this.tone(t, 90, 0.5, 0.24, 'sine', 32);
        this.noise(t + 0.02, 0.3, 0.15, 'highpass', 1800, 0.5);
        break;
      case 'bolt':
        this.noise(t, 0.32, 0.32, 'highpass', 2600, 0.5);
        this.tone(t, 1800, 0.22, 0.13, 'square', 80);
        this.tone(t + 0.03, 90, 0.4, 0.2, 'sine', 35);
        break;
      case 'iceCast':
        this.tone(t, 1400, 0.3, 0.08, 'sine', 700);
        this.tone(t + 0.03, 2100, 0.24, 0.06, 'triangle', 1100);
        this.noise(t, 0.2, 0.07, 'highpass', 4200, 0.8);
        break;
      case 'freeze':
        this.tone(t, 1900, 0.5, 0.07, 'sine', 520);
        this.noise(t, 0.4, 0.09, 'highpass', 5200, 0.7);
        break;
      case 'shatter':
        for (let i = 0; i < 5; i++) this.tone(t + i * 0.035, rand(1800, 3600), 0.22, 0.05, 'triangle', rand(600, 900));
        this.noise(t, 0.3, 0.12, 'highpass', 3500, 0.6);
        break;
      case 'heal':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.07, f, 0.4, 0.05, 'sine'));
        break;
      case 'pickup':
        this.tone(t, 880, 0.12, 0.07, 'triangle', 1320);
        this.tone(t + 0.08, 1320, 0.18, 0.055, 'sine', 1760);
        break;
      case 'coin':
        this.tone(t, 1200, 0.09, 0.05, 'triangle');
        this.tone(t + 0.06, 1800, 0.14, 0.045, 'sine');
        break;
      case 'quest':
        [392, 523, 659, 784].forEach((f, i) => this.tone(t + i * 0.09, f, 0.6, 0.055, 'triangle'));
        break;
      case 'level':
        [392, 494, 587, 784, 988].forEach((f, i) => this.tone(t + i * 0.08, f, 0.7, 0.06, 'sine'));
        break;
      case 'ui': this.tone(t, 620, 0.06, 0.03, 'sine', 820); break;
      case 'error': this.tone(t, 180, 0.14, 0.05, 'square', 120); break;
      case 'arrow':
        this.noise(t, 0.2, 0.07, 'bandpass', 2200, 1.2);
        break;
      case 'goblin':
        this.tone(t, rand(240, 320), 0.16, 0.08, 'sawtooth', rand(140, 200));
        this.tone(t + 0.09, rand(180, 240), 0.18, 0.06, 'square', 120);
        this.noise(t, 0.12, 0.05, 'bandpass', 900, 2);
        break;
      case 'goblinDie': this.tone(t, rand(220, 280), 0.5, 0.09, 'sawtooth', 70); this.noise(t, 0.4, 0.08, 'lowpass', 700); break;
      case 'roar':
        this.tone(t, 110, 1.1, 0.16, 'sawtooth', 55);
        this.tone(t + 0.04, 78, 1.0, 0.14, 'square', 42);
        this.noise(t, 1.1, 0.12, 'lowpass', 380, 1.4);
        break;
      case 'slam':
        this.tone(t, 70, 0.5, 0.26, 'sine', 30);
        this.noise(t, 0.45, 0.2, 'lowpass', 420);
        break;
      case 'bossDie':
        this.noise(t, 1.6, 0.25, 'lowpass', 900);
        this.tone(t, 90, 1.4, 0.2, 'sawtooth', 25);
        [0, 0.22, 0.47, 0.8].forEach((d, i) => this.tone(t + d, 300 - i * 40, 0.5, 0.08, 'sawtooth', 60));
        break;
      case 'hurt': this.tone(t, 160, 0.2, 0.16, 'sawtooth', 80); this.noise(t, 0.12, 0.12, 'bandpass', 700, 1); break;
      case 'door': this.noise(t, 0.5, 0.09, 'bandpass', 300, 2); break;
      case 'splash': this.noise(t, 0.35, 0.14, 'bandpass', 1300, .6); break;
      case 'victory':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(t + i * 0.16, f, 1.4, 0.07, 'triangle'));
        break;
      case 'charge':
        this.tone(t, 200, 0.5, 0.05, 'sawtooth', 700);
        break;
    }
  }

  setProximity({ water = 0, fire = 0, combat = 0 } = {}) {
    this.waterNear = water; this.fireNear = fire; this.combatNear = Math.max(this.combatNear, combat);
  }
}
