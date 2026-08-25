/* audio.js — NES-style sound effects synthesized with WebAudio (no files needed) */
(function () {
  'use strict';

  const SFX = {
    ctx: null,
    noiseBuf: null,
    enabled: true,

    /* must be called from a user gesture (button tap) */
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      // shared white-noise buffer
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },

    _now() { return this.ctx ? this.ctx.currentTime : 0; },

    _tone(type, f0, f1, t0, dur, vol, slideType) {
      if (!this.ctx || !this.enabled) return;
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      const start = this._now() + t0;
      o.frequency.setValueAtTime(Math.max(20, f0), start);
      if (f1 !== f0) o.frequency[slideType === 'exp' ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime'](Math.max(20, f1), start + dur);
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      o.connect(g).connect(c.destination);
      o.start(start);
      o.stop(start + dur + 0.02);
    },

    _noise(t0, dur, vol, filterFreq) {
      if (!this.ctx || !this.enabled) return;
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      const g = c.createGain();
      const start = this._now() + t0;
      g.gain.setValueAtTime(vol, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      s.connect(f).connect(g).connect(c.destination);
      s.start(start);
      s.stop(start + dur + 0.02);
    },

    /* ---- game sounds ---- */

    shot() {            // loud gunshot: noise crack + low punch
      this._noise(0, 0.16, 0.55, 2600);
      this._tone('square', 160, 40, 0, 0.12, 0.35, 'exp');
    },

    emptyClick() { this._tone('square', 900, 500, 0, 0.05, 0.12); },

    flap() {            // wing beat while duck flies
      this._tone('triangle', 340, 220, 0, 0.055, 0.08);
    },

    quack() {
      this._tone('sawtooth', 520, 300, 0, 0.09, 0.1);
      this._tone('sawtooth', 480, 280, 0.1, 0.09, 0.08);
    },

    hitDuck() {         // sharp "got it!" chirp
      this._tone('square', 990, 990, 0, 0.06, 0.18);
      this._tone('square', 1320, 1320, 0.07, 0.09, 0.18);
    },

    fallWhistle() {     // falling duck descending whistle
      this._tone('triangle', 1400, 240, 0, 0.75, 0.16, 'exp');
    },

    thud() {
      this._noise(0, 0.1, 0.3, 500);
      this._tone('sine', 110, 50, 0, 0.14, 0.3, 'exp');
    },

    flyAway() {         // duck escapes: rising flap away
      this._tone('triangle', 300, 800, 0, 0.4, 0.12, 'exp');
    },

    laugh() {           // the infamous dog laugh: "ha-ha-ha-ha"
      const seq = [740, 587, 740, 587, 740, 587, 740, 494];
      seq.forEach((f, i) => this._tone('square', f, f, i * 0.11, 0.09, 0.14));
    },

    dogJump() { this._tone('square', 220, 660, 0, 0.18, 0.14, 'exp'); },

    pickup() {          // dog presents ducks
      this._tone('square', 523, 523, 0, 0.08, 0.13);
      this._tone('square', 659, 659, 0.09, 0.08, 0.13);
      this._tone('square', 784, 784, 0.18, 0.12, 0.13);
    },

    roundStart() {      // little fanfare
      const n = [523, 659, 784, 1047];
      n.forEach((f, i) => this._tone('square', f, f, i * 0.12, 0.11, 0.13));
    },

    perfect() {         // perfect round bonus jingle
      const n = [784, 988, 1175, 1568, 1175, 1568];
      n.forEach((f, i) => this._tone('square', f, f, i * 0.1, 0.1, 0.14));
    },

    gameOver() {        // sad descending line
      const n = [523, 494, 440, 392, 330, 262];
      n.forEach((f, i) => this._tone('square', f, f, i * 0.16, 0.15, 0.14));
    },

    select() { this._tone('square', 880, 1320, 0, 0.07, 0.12); },
  };

  window.SFX = SFX;
})();
