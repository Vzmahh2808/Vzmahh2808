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
  private screechGain: GainNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
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

    // Tyre screech: looping band-passed noise, gain driven by slip.
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2200;
    bp.Q.value = 6;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    src.connect(bp).connect(this.screechGain).connect(this.master);
    src.start();

    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = "sawtooth";
    this.sirenOsc.frequency.value = 800;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "lowpass";
    sirenFilter.frequency.value = 2200;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(sirenFilter).connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  /** distance to the nearest active police car, or Infinity for silence. */
  siren(distance: number, time: number): void {
    if (!this.sirenOsc || !this.sirenGain || !this.ctx) return;
    // Wail: a slow sweep between two pitches.
    const f = 720 + 480 * (0.5 + 0.5 * Math.sin(time * Math.PI * 1.25));
    this.sirenOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03);
    const vol = this.muted || !isFinite(distance) ? 0 : 0.09 * Math.max(0, 1 - distance / 170);
    this.sirenGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
  }

  /** Short rising chime when the wanted level goes up. */
  alert(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    [520, 780].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.12;
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  }

  /** slip in m/s of sideways sliding; 0 silences the screech. */
  screech(slip: number): void {
    if (!this.screechGain || !this.ctx) return;
    const g = this.muted ? 0 : Math.min(0.18, Math.max(0, slip - 3) * 0.025);
    this.screechGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }

  private burst(dur: number, freq: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  /** distance attenuates volume; 0 = right next to the listener. */
  explosion(distance: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const k = Math.max(0.05, 1 - distance / 160);
    this.burst(1.6, 2200, 0.9 * k);
    this.burst(0.5, 6000, 0.35 * k, 0.02);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(90, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + 1.2);
    g.gain.setValueAtTime(0.6 * k, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.3);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + 1.4);
  }

  thud(): void {
    this.burst(0.18, 500, 0.35);
  }

  ignite(): void {
    this.burst(0.7, 1500, 0.25);
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
