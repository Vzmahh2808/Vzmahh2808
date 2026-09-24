import type { GameEvent } from "../game/types";

const MUTE_KEY = "dungeon-delver.muted";

type Wave = OscillatorType;

/**
 * Tiny procedural sound bank on Web Audio. Everything is synthesized, so the game ships
 * without audio files. The context is created lazily on the first user gesture.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;
  private lastStep = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  /** Call from a user gesture so the browser lets audio start. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return this.muted;
  }

  private get ready(): boolean {
    return !this.muted && this.ctx !== null && this.master !== null;
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; gain?: number; slideTo?: number; delay?: number; attack?: number } = {}): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, opts: { gain?: number; freq?: number; freqTo?: number; q?: number; delay?: number; type?: BiquadFilterType } = {}): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type ?? "lowpass";
    filter.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(opts.freqTo, t0 + dur);
    filter.Q.value = opts.q ?? 0.7;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  step(): void {
    const now = performance.now();
    if (now - this.lastStep < 60) return;
    this.lastStep = now;
    this.noise(0.04, { gain: 0.05, freq: 500, type: "bandpass", q: 1.5 });
  }

  hit(): void {
    this.noise(0.09, { gain: 0.3, freq: 1800, freqTo: 200 });
    this.tone(160, 0.12, { type: "triangle", gain: 0.25, slideTo: 60 });
  }

  hurt(): void {
    this.tone(220, 0.18, { type: "sawtooth", gain: 0.22, slideTo: 70 });
    this.noise(0.12, { gain: 0.2, freq: 900, freqTo: 150 });
  }

  miss(): void {
    this.noise(0.12, { gain: 0.12, freq: 400, freqTo: 2500, type: "bandpass", q: 2 });
  }

  blocked(): void {
    this.tone(90, 0.06, { type: "square", gain: 0.06 });
  }

  gold(): void {
    this.tone(1320, 0.08, { gain: 0.15 });
    this.tone(1760, 0.12, { gain: 0.15, delay: 0.07 });
  }

  pickup(): void {
    this.tone(600, 0.1, { type: "triangle", gain: 0.18, slideTo: 900 });
  }

  potion(): void {
    for (let i = 0; i < 3; i++) this.tone(420 + i * 110, 0.09, { gain: 0.16, delay: i * 0.07 });
  }

  scroll(): void {
    this.tone(700, 0.25, { type: "triangle", gain: 0.14, slideTo: 1800 });
    this.noise(0.25, { gain: 0.06, freq: 3000, freqTo: 6000, type: "highpass" });
  }

  fire(): void {
    this.noise(0.5, { gain: 0.4, freq: 3000, freqTo: 120 });
    this.tone(70, 0.5, { type: "sawtooth", gain: 0.2, slideTo: 30 });
  }

  teleport(): void {
    this.tone(300, 0.18, { gain: 0.15, slideTo: 1600 });
    this.tone(1600, 0.2, { gain: 0.15, slideTo: 300, delay: 0.18 });
  }

  levelUp(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: "triangle", gain: 0.18, delay: i * 0.09 }));
  }

  descend(): void {
    [360, 270, 190].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", gain: 0.16, delay: i * 0.12 }));
    this.noise(0.6, { gain: 0.15, freq: 300, freqTo: 60 });
  }

  death(): void {
    this.tone(180, 0.9, { type: "sawtooth", gain: 0.25, slideTo: 35, attack: 0.02 });
    this.noise(0.6, { gain: 0.2, freq: 800, freqTo: 80 });
  }

  win(): void {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", gain: 0.18, delay: i * 0.11 }));
    this.tone(2093, 0.8, { type: "sine", gain: 0.12, delay: 0.66 });
  }

  /** Map an engine event to a sound. */
  handle(ev: GameEvent, playerId: number): void {
    switch (ev.type) {
      case "move":
        if (ev.id === playerId) this.step();
        break;
      case "attack":
        if (!ev.hit) this.miss();
        break;
      case "damage":
        if (ev.player) this.hurt();
        else this.hit();
        break;
      case "blocked":
        this.blocked();
        break;
      case "gold":
        this.gold();
        break;
      case "pickup":
        this.pickup();
        break;
      case "potion":
        this.potion();
        break;
      case "scroll":
        if (ev.effect === "fire") this.fire();
        else if (ev.effect === "teleport") this.teleport();
        else this.scroll();
        break;
      case "levelup":
        this.levelUp();
        break;
      case "descend":
        this.descend();
        break;
      case "death":
        this.death();
        break;
      case "win":
        this.win();
        break;
      default:
        break;
    }
  }
}
