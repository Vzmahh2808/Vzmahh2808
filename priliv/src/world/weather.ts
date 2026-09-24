import type { Rng } from "../core/rng";

export type WeatherKind = "clear" | "cloudy" | "rain" | "storm";

export const WEATHER_NAMES: Record<WeatherKind, string> = {
  clear: "Ясно",
  cloudy: "Облачно",
  rain: "Дождь",
  storm: "Гроза",
};

const TARGET_RAIN: Record<WeatherKind, number> = { clear: 0, cloudy: 0, rain: 0.6, storm: 1 };
const TARGET_CLOUD: Record<WeatherKind, number> = { clear: 0, cloudy: 0.6, rain: 0.85, storm: 1 };

/** Weather drifts between states; rain and cloud cover ease in and out rather than switching. */
export class Weather {
  kind: WeatherKind = "clear";
  rain = 0;
  cloud = 0;
  /** Road wetness lags behind the rain and dries slowly. */
  wet = 0;
  private timer: number;

  constructor(private rng: Rng, initial: WeatherKind = "clear") {
    this.kind = initial;
    this.rain = TARGET_RAIN[initial];
    this.cloud = TARGET_CLOUD[initial];
    this.wet = this.rain;
    this.timer = 90 + rng.next() * 120;
  }

  set(kind: WeatherKind): void {
    this.kind = kind;
    this.timer = 120 + this.rng.next() * 120;
  }

  private pickNext(): WeatherKind {
    const r = this.rng.next();
    switch (this.kind) {
      case "clear":
        return r < 0.7 ? "cloudy" : "clear";
      case "cloudy":
        return r < 0.4 ? "clear" : r < 0.85 ? "rain" : "storm";
      case "rain":
        return r < 0.5 ? "cloudy" : r < 0.75 ? "storm" : "rain";
      case "storm":
        return r < 0.7 ? "rain" : "cloudy";
    }
  }

  /** dt in real seconds. Returns true when the weather kind changed. */
  update(dt: number): boolean {
    this.timer -= dt;
    let changed = false;
    if (this.timer <= 0) {
      const next = this.pickNext();
      changed = next !== this.kind;
      this.set(next);
    }
    const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * Math.min(1, dt * rate);
    this.rain = ease(this.rain, TARGET_RAIN[this.kind], 0.15);
    this.cloud = ease(this.cloud, TARGET_CLOUD[this.kind], 0.1);
    this.wet = this.rain > this.wet ? ease(this.wet, this.rain, 0.3) : ease(this.wet, this.rain, 0.02);
    return changed;
  }

  /** Tyre grip multiplier: wet roads lose up to 35% grip. */
  gripFactor(): number {
    return 1 - 0.35 * this.wet;
  }

  /** How far the police can see, relative to a clear day. */
  static visibility(night: number, rain: number): number {
    return (1 - 0.3 * night) * (1 - 0.25 * rain);
  }
}
