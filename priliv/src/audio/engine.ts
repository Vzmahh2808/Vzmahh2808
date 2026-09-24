/** Procedural engine, horn and crash sounds on Web Audio. */
export class CarAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private hornOsc: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "square";
    this.engineOsc.connect(this.filter);
    this.engineOsc2.connect(this.filter);
    this.filter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornOsc = ctx.createOscillator();
    this.hornOsc.type = "square";
    this.hornOsc.frequency.value = 420;
    this.hornOsc.connect(this.hornGain).connect(this.master);
    this.hornOsc.start();
  }

  /** speed in m/s, throttle 0..1, driving = player is in a car. */
  engine(speed: number, throttle: number, driving: boolean, dt: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.filter) return;
    const rpm = driving ? 40 + speed * 3.2 + throttle * 25 : 0;
    const target = driving ? (this.muted ? 0 : 0.12 + throttle * 0.1 + Math.min(0.12, speed * 0.004)) : 0;
    const k = Math.min(1, dt * 8);
    const now = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(Math.max(30, rpm), now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(Math.max(15, rpm / 2), now, 0.05);
    this.filter.frequency.setTargetAtTime(400 + speed * 30 + throttle * 600, now, 0.08);
    this.engineGain.gain.value += (target - this.engineGain.gain.value) * k;
  }

  horn(on: boolean): void {
    if (!this.hornGain || !this.ctx) return;
    this.hornGain.gain.setTargetAtTime(on && !this.muted ? 0.15 : 0, this.ctx.currentTime, 0.01);
  }

  crash(intensity: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.6, 0.15 + intensity * 0.02);
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }
}
