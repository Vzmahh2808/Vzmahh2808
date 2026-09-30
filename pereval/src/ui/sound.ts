import type { GameEvent } from "../game/types";

const MUTE_KEY = "pereval.muted";

/** Small procedural sound bank on Web Audio; nothing is loaded from files. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

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
      this.master.gain.value = 0.4;
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

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number; delay?: number } = {}): void {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  step(): void {
    this.tone(180, 0.05, { type: "triangle", gain: 0.08 });
  }
  tick(): void {
    this.tone(900, 0.03, { type: "square", gain: 0.05 });
  }
  hit(): void {
    this.tone(660, 0.12, { type: "triangle", gain: 0.2 });
    this.tone(990, 0.15, { type: "triangle", gain: 0.15, delay: 0.08 });
  }
  slip(): void {
    this.tone(300, 0.2, { type: "sawtooth", gain: 0.12, slideTo: 200 });
  }
  fall(): void {
    this.tone(220, 0.35, { type: "sawtooth", gain: 0.2, slideTo: 60 });
  }
  checkpoint(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: "triangle", gain: 0.18, delay: i * 0.1 }));
  }
  camp(): void {
    this.tone(330, 0.3, { type: "sine", gain: 0.15 });
    this.tone(262, 0.4, { type: "sine", gain: 0.12, delay: 0.25 });
  }
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", gain: 0.2, delay: i * 0.15 }));
  }
  lose(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, { type: "sine", gain: 0.2, delay: i * 0.3 }));
  }

  handle(e: GameEvent): void {
    switch (e.type) {
      case "move":
        this.step();
        break;
      case "hurt":
        this.fall();
        break;
      case "checkpoint":
      case "peak":
        this.checkpoint();
        break;
      case "camp":
        this.camp();
        break;
      case "won":
        this.win();
        break;
      case "lost":
        this.lose();
        break;
      default:
        break;
    }
  }
}
