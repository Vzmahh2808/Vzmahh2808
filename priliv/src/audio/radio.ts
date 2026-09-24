import { STATIONS, makeBar, midiToHz, type StationStyle } from "./music";

const LOOKAHEAD = 0.25;

/** Procedural radio: a lookahead scheduler that plays generated bars on Web Audio. */
export class Radio {
  /** -1 = off, otherwise an index into STATIONS. */
  station = 0;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer = 0;
  private nextTime = 0;
  private stepIndex = 0;
  private bar = 0;
  private seed = 1;
  private audible = false;

  constructor(private getCtx: () => { ctx: AudioContext; master: GainNode } | null) {}

  get style(): StationStyle | null {
    return this.station >= 0 ? STATIONS[this.station] : null;
  }

  get name(): string {
    return this.style ? this.style.name : "Радио выключено";
  }

  /** Cycle off → station 1 → … → off. */
  next(): string {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.bar = 0;
    this.stepIndex = 0;
    this.seed = Math.floor(Math.random() * 1e6);
    const a = this.getCtx();
    if (a) this.nextTime = a.ctx.currentTime + 0.05;
    return this.name;
  }

  private ensure(): { ctx: AudioContext; master: GainNode } | null {
    const a = this.getCtx();
    if (!a) return null;
    if (!this.out) {
      this.out = a.ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(a.master);
      const len = a.ctx.sampleRate;
      this.noise = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.nextTime = a.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 50);
    }
    return a;
  }

  /** Call every frame: plays while the player sits in a car and sound is on. */
  update(audible: boolean): void {
    const a = this.ensure();
    if (!a || !this.out) return;
    const on = audible && this.station >= 0;
    if (on !== this.audible) {
      this.audible = on;
      this.out.gain.setTargetAtTime(on ? 0.32 : 0, a.ctx.currentTime, on ? 0.3 : 0.1);
      if (on) this.nextTime = Math.max(this.nextTime, a.ctx.currentTime + 0.05);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private schedule(): void {
    const a = this.getCtx();
    const st = this.style;
    if (!a || !st || !this.out || !this.audible) return;
    const ctx = a.ctx;
    const stepDur = 60 / st.bpm / 4;
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const i = this.stepIndex;
      const bar = makeBar(st, this.bar, this.seed);
      const t = this.nextTime;
      if (i === 0) this.pad(t, bar.chord, stepDur * 16, st);
      if (st.kick[i]) this.kick(t);
      if (st.snare[i]) this.snare(t);
      if (st.hat[i]) this.hat(t, st.id === "port" ? 0.05 : 0.08);
      const b = bar.bass[i];
      if (b !== null) this.tone(t, midiToHz(b), stepDur * 1.6, st.wave === "triangle" ? "triangle" : "sawtooth", 0.16, 500);
      const l = bar.lead[i];
      if (l !== null) this.tone(t, midiToHz(l), stepDur * 1.2, st.wave, 0.06, 2400);
      if (st.id === "port" && i % 4 === 0) this.crackle(t);
      this.nextTime += stepDur;
      this.stepIndex = (i + 1) % 16;
      if (this.stepIndex === 0) this.bar++;
    }
  }

  private env(t: number, peak: number, attack: number, dur: number): GainNode {
    const ctx = this.getCtx()!.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out!);
    return g;
  }

  private tone(t: number, hz: number, dur: number, type: OscillatorType, peak: number, cutoff: number): void {
    const ctx = this.getCtx()!.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    o.connect(f).connect(this.env(t, peak, 0.01, dur));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(t: number, notes: number[], dur: number, st: StationStyle): void {
    const ctx = this.getCtx()!.ctx;
    const g = this.env(t, st.id === "sirena" ? 0.025 : 0.045, dur * 0.25, dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    f.connect(g);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiToHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  private kick(t: number): void {
    const ctx = this.getCtx()!.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.2);
    o.connect(this.env(t, 0.5, 0.003, 0.3));
    o.start(t);
    o.stop(t + 0.35);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, dur: number): void {
    const ctx = this.getCtx()!.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(t, peak, 0.002, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private snare(t: number): void {
    this.noiseHit(t, "bandpass", 1800, 0.22, 0.18);
    this.tone(t, 185, 0.1, "triangle", 0.12, 1000);
  }

  private hat(t: number, peak: number): void {
    this.noiseHit(t, "highpass", 7000, peak, 0.05);
  }

  private crackle(t: number): void {
    this.noiseHit(t + Math.random() * 0.1, "highpass", 3000, 0.012, 0.02);
  }
}
