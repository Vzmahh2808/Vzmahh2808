/** Keyboard for one or two people on the same keyboard. */
import type { Match } from "../sim/match";

interface Keys {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  sprint: string[];
  pass: string[];
  shoot: string[];
  check: string[];
}

const P1: Keys = {
  up: ["KeyW"],
  down: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  sprint: ["ShiftLeft"],
  pass: ["Space", "KeyE"],
  shoot: ["KeyF", "KeyJ"],
  check: ["KeyG", "KeyK"],
};
const P2: Keys = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  sprint: ["ShiftRight"],
  pass: ["Enter"],
  shoot: ["Period"],
  check: ["Slash"],
};

const PREVENT = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash", "Enter"]);

export class Keyboard {
  private down = new Set<string>();
  private shootWas: [boolean, boolean] = [false, false];
  /** When false, the arrow keys also drive player one. */
  twoPlayers = false;
  onPause: (() => void) | null = null;
  onSwitch: ((team: 0 | 1) => void) | null = null;
  onMute: (() => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (PREVENT.has(e.code) && !(e.target instanceof HTMLElement && e.target.closest("button, input, select"))) e.preventDefault();
      this.down.add(e.code);
      if (e.code === "Escape" || e.code === "KeyP") this.onPause?.();
      if (e.code === "KeyM") this.onMute?.();
      this.pending(e.code);
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  private pendingPass: [boolean, boolean] = [false, false];
  private pendingCheck: [boolean, boolean] = [false, false];

  private pending(code: string): void {
    const p1pass = P1.pass.includes(code);
    const p2pass = P2.pass.includes(code);
    if (p1pass) this.pendingPass[0] = true;
    if (p2pass) this.pendingPass[1] = true;
    if (P1.check.includes(code)) this.pendingCheck[0] = true;
    if (P2.check.includes(code)) this.pendingCheck[1] = true;
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  private shootDown(team: 0 | 1, touchShoot: boolean): boolean {
    const keys = team === 0 ? P1 : P2;
    return this.any(keys.shoot) || (team === 0 && !this.twoPlayers && this.down.has("Period")) || (team === 0 && touchShoot);
  }

  /**
   * While play is stopped (faceoff, goal, break), forget one-shot presses and
   * releases so they do not fire the moment play resumes.
   */
  discard(m: Match, touch: { shoot: boolean } | null): void {
    this.pendingPass = [false, false];
    this.pendingCheck = [false, false];
    for (const team of [0, 1] as const) {
      this.shootWas[team] = this.shootDown(team, touch?.shoot ?? false);
      const h = m.humanInput[team];
      h.pass = false;
      h.check = false;
      h.shootReleased = false;
    }
  }

  /** Write the current state into the match inputs. */
  apply(m: Match, touch: { x: number; y: number; sprint: boolean; shoot: boolean; pass: boolean; check: boolean } | null): void {
    for (const team of [0, 1] as const) {
      if (!m.w.human[team]) continue;
      const keys = team === 0 ? P1 : P2;
      const h = m.humanInput[team];
      let mx = (this.any(keys.right) ? 1 : 0) - (this.any(keys.left) ? 1 : 0);
      let my = (this.any(keys.down) ? 1 : 0) - (this.any(keys.up) ? 1 : 0);
      if (team === 0 && !this.twoPlayers) {
        mx += (this.down.has("ArrowRight") ? 1 : 0) - (this.down.has("ArrowLeft") ? 1 : 0);
        my += (this.down.has("ArrowDown") ? 1 : 0) - (this.down.has("ArrowUp") ? 1 : 0);
      }
      let sprint = this.any(keys.sprint);
      let shoot = this.shootDown(team, false);
      if (team === 0 && touch) {
        if (Math.hypot(touch.x, touch.y) > 0.05) {
          mx = touch.x;
          my = touch.y;
        }
        sprint = sprint || touch.sprint;
        shoot = shoot || touch.shoot;
        if (touch.pass) this.pendingPass[0] = true;
        if (touch.check) this.pendingCheck[0] = true;
      }
      const l = Math.hypot(mx, my);
      if (l > 1) {
        mx /= l;
        my /= l;
      }
      h.mx = mx;
      h.my = my;
      h.sprint = sprint;
      h.shootHeld = shoot;
      if (this.shootWas[team] && !shoot) h.shootReleased = true;
      this.shootWas[team] = shoot;
      if (this.pendingPass[team]) h.pass = true;
      if (this.pendingCheck[team]) h.check = true;
      this.pendingPass[team] = false;
      this.pendingCheck[team] = false;
    }
  }

  clearPending(): void {
    this.pendingPass = [false, false];
    this.pendingCheck = [false, false];
  }
}
