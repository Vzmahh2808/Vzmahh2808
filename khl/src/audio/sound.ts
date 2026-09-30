/**
 * All sound is synthesised: a crowd from filtered noise that swells with the
 * play, a goal horn, a goal chant, clapping, and the knocks of hockey.
 */
import type { GameEvent } from "../sim/state";
import type { Match } from "../sim/match";
import { attackDir, goalX } from "../sim/rink";

type Ctx = AudioContext;

function noiseBuffer(ctx: Ctx, kind: "white" | "pink" | "brown", seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  // Small deterministic generator so the crowd loop is the same on every start.
  let s = 12345;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    if (kind === "white") d[i] = w;
    else if (kind === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

export class Sound {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private white!: AudioBuffer;
  private crowdGain!: GainNode;
  private crowdBand!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private skateGain!: GainNode;
  private excite = 0.15;
  private target = 0.15;
  muted = false;
  /** Sound is off while an ad plays or the tab is hidden. */
  suspended = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.white = noiseBuffer(ctx, "white", 2);
    const pink = noiseBuffer(ctx, "pink", 4);
    const brown = noiseBuffer(ctx, "brown", 4);

    // Crowd bed: pink noise through a band, brown noise rumble, slow swell.
    const cSrc = ctx.createBufferSource();
    cSrc.buffer = pink;
    cSrc.loop = true;
    this.crowdBand = ctx.createBiquadFilter();
    this.crowdBand.type = "bandpass";
    this.crowdBand.frequency.value = 520;
    this.crowdBand.Q.value = 0.7;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.1;
    cSrc.connect(this.crowdBand).connect(this.crowdGain).connect(this.master);
    cSrc.start();
    const rSrc = ctx.createBufferSource();
    rSrc.buffer = brown;
    rSrc.loop = true;
    const rLow = ctx.createBiquadFilter();
    rLow.type = "lowpass";
    rLow.frequency.value = 240;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.16;
    rSrc.connect(rLow).connect(this.rumbleGain).connect(this.master);
    rSrc.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    lfo.start();

    // Skate hiss for the puck carrier.
    const sSrc = ctx.createBufferSource();
    sSrc.buffer = this.white;
    sSrc.loop = true;
    const sBand = ctx.createBiquadFilter();
    sBand.type = "bandpass";
    sBand.frequency.value = 4200;
    sBand.Q.value = 0.9;
    this.skateGain = ctx.createGain();
    this.skateGain.gain.value = 0;
    sSrc.connect(sBand).connect(this.skateGain).connect(this.master);
    sSrc.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m || this.suspended ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  setSuspended(s: boolean): void {
    this.suspended = s;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted || s ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private burst(filter: BiquadFilterType, freq: number, q: number, dur: number, gain: number, at = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t0 = this.t + at;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t0 = this.t + at;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private horn(at: number, len: number): void {
    const ctx = this.ctx!;
    const t0 = this.t + at;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(0.5, t0 + 0.05);
    out.gain.setValueAtTime(0.5, t0 + len);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.15);
    lp.Q.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    lp.connect(shaper).connect(out).connect(this.master);
    for (const [f, detune] of [[220, 0], [220, 9], [220, -8], [110, 4]] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = detune;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = 6;
      vib.connect(vg).connect(o.detune);
      o.connect(lp);
      o.start(t0);
      vib.start(t0);
      o.stop(t0 + len + 0.5);
      vib.stop(t0 + len + 0.5);
    }
  }

  private clap(at: number, gain = 0.28): void {
    this.burst("bandpass", 1500, 1.2, 0.09, gain, at);
    this.burst("highpass", 3500, 0.7, 0.05, gain * 0.5, at);
  }

  /** "Ша-й-бу, ша-й-бу" as a clap pattern. */
  private chant(): void {
    const b = 0.42;
    const pattern = [0, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7];
    for (const p of pattern) this.clap(0.9 + p * b);
    this.excite = Math.min(1, this.excite + 0.5);
  }

  private organ(): void {
    const ctx = this.ctx!;
    const notes = [261.6, 329.6, 392, 523.3, 392, 523.3];
    const times = [0, 0.18, 0.36, 0.54, 0.9, 1.08];
    notes.forEach((f, i) => {
      const t0 = this.t + 1.6 + times[i];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
      g.gain.setValueAtTime(0.06, t0 + 0.13);
      g.gain.linearRampToValueAtTime(0, t0 + 0.2);
      g.connect(this.master);
      for (let h = 1; h <= 4; h++) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f * h;
        const hg = ctx.createGain();
        hg.gain.value = 1 / h;
        o.connect(hg).connect(g);
        o.start(t0);
        o.stop(t0 + 0.25);
      }
    });
  }

  handle(events: GameEvent[]): void {
    if (!this.ctx || this.suspended) return;
    for (const e of events) {
      switch (e.type) {
        case "shot":
          this.tone("square", 210 + 60 * e.power, 70, 0.05 + 0.03 * e.power, 0.16 + 0.1 * e.power);
          this.burst("bandpass", 2200, 1, 0.05, 0.2 + 0.2 * e.power);
          this.target = Math.max(this.target, 0.5);
          break;
        case "pass":
          this.burst("bandpass", 1800, 1.5, 0.04, 0.09);
          break;
        case "hit":
          this.tone("sine", 100, 38, 0.22, 0.5);
          this.burst("lowpass", 500, 0.7, 0.16, 0.5);
          this.excite = Math.min(1, this.excite + 0.15);
          break;
        case "poke":
          this.burst("bandpass", 1300, 2, 0.05, e.ok ? 0.14 : 0.06);
          break;
        case "board":
          this.tone("sine", 140, 60, 0.12, Math.min(0.4, e.speed / 30));
          this.burst("lowpass", 900, 0.8, 0.1, Math.min(0.35, e.speed / 40));
          break;
        case "post":
          this.tone("sine", 1250, 1200, 0.5, 0.22);
          this.tone("sine", 2950, 2900, 0.35, 0.12);
          this.excite = Math.min(1, this.excite + 0.3);
          break;
        case "block":
          this.tone("sine", 160, 60, 0.1, 0.3);
          break;
        case "save":
          this.burst("lowpass", 520, 0.8, 0.09, 0.35);
          this.excite = Math.min(1, this.excite + 0.2);
          break;
        case "goal":
          this.horn(0, 1.5);
          this.horn(2.1, 0.6);
          this.chant();
          this.organ();
          this.excite = 1;
          break;
        case "whistle": {
          const ctx = this.ctx!;
          const t0 = this.t;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
          g.gain.setValueAtTime(0.2, t0 + 0.5);
          g.gain.linearRampToValueAtTime(0, t0 + 0.6);
          const trem = ctx.createOscillator();
          trem.frequency.value = 26;
          const tg = ctx.createGain();
          tg.gain.value = 0.08;
          trem.connect(tg).connect(g.gain);
          g.connect(this.master);
          for (const f of [2200, 2900]) {
            const o = ctx.createOscillator();
            o.type = "square";
            o.frequency.value = f;
            o.connect(g);
            o.start(t0);
            o.stop(t0 + 0.65);
          }
          trem.start(t0);
          trem.stop(t0 + 0.65);
          this.burst("bandpass", 2500, 1, 0.5, 0.05);
          break;
        }
        case "faceoff":
          this.tone("square", 320, 120, 0.05, 0.14);
          break;
      }
    }
  }

  /** Call every frame: eases the crowd toward the mood of the play. */
  update(dt: number, m: Match | null): void {
    if (!this.ctx) return;
    let mood = 0.15;
    let skate = 0;
    if (m && (m.phase === "play" || m.phase === "shootout")) {
      const p = m.w.puck;
      const c = p.carrier >= 0 ? m.w.skaters[p.carrier] : null;
      for (const team of [0, 1] as const) {
        const gx = goalX(team);
        const d = Math.hypot(p.pos.x - gx, p.pos.y);
        // The nearer the puck to a net, the louder the crowd.
        mood = Math.max(mood, 0.15 + 0.55 * Math.max(0, 1 - d / 22) * (attackDir(team) ? 1 : 1));
      }
      if (m.phase === "shootout") mood = Math.max(mood, 0.6);
      if (c) skate = Math.min(1, Math.hypot(c.vel.x, c.vel.y) / 9);
    }
    this.target = Math.max(mood, this.target - dt * 0.35);
    this.excite += (this.target - this.excite) * (1 - Math.exp(-2 * dt));
    this.target = Math.max(0.12, this.target);
    const t = this.t;
    this.crowdGain.gain.setTargetAtTime(0.07 + 0.2 * this.excite, t, 0.25);
    this.crowdBand.frequency.setTargetAtTime(420 + 700 * this.excite, t, 0.3);
    this.rumbleGain.gain.setTargetAtTime(0.1 + 0.16 * this.excite, t, 0.3);
    this.skateGain.gain.setTargetAtTime(0.012 * skate, t, 0.08);
  }
}
