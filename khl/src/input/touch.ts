/** Floating joystick on the left, action buttons on the right. */
export interface TouchState {
  x: number;
  y: number;
  sprint: boolean;
  shoot: boolean;
  pass: boolean;
  check: boolean;
}

export function isTouchDevice(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

const RADIUS = 56;

export class TouchControls {
  enabled = false;
  readonly state: TouchState = { x: 0, y: 0, sprint: false, shoot: false, pass: false, check: false };
  private root: HTMLElement;
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private ox = 0;
  private oy = 0;
  /** One-shot flags are consumed by `take`. */
  private tapPass = false;
  private tapCheck = false;

  constructor(force = false) {
    this.root = document.querySelector<HTMLElement>("#touch")!;
    this.zone = this.root.querySelector<HTMLElement>(".stick-zone")!;
    this.base = this.root.querySelector<HTMLElement>(".stick-base")!;
    this.knob = this.root.querySelector<HTMLElement>(".stick-knob")!;
    if (force || isTouchDevice()) this.enable();
    window.addEventListener("touchstart", () => this.enable(), { once: true, passive: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add("touch");
    this.bindStick();
    this.bindButtons();
  }

  /** Snapshot for the keyboard mixer; tap buttons report once. */
  take(): TouchState {
    const s = { ...this.state, pass: this.tapPass, check: this.tapCheck };
    this.tapPass = false;
    this.tapCheck = false;
    return s;
  }

  private bindStick(): void {
    this.zone.addEventListener("pointerdown", (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try {
        this.zone.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
      this.base.classList.add("on");
      this.move(e.clientX, e.clientY);
      e.preventDefault();
    });
    this.zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stickId) return;
      this.move(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.state.x = 0;
      this.state.y = 0;
      this.knob.style.transform = "translate(-50%, -50%)";
      this.base.classList.remove("on");
    };
    this.zone.addEventListener("pointerup", end);
    this.zone.addEventListener("pointercancel", end);
  }

  private move(x: number, y: number): void {
    let dx = (x - this.ox) / RADIUS;
    let dy = (y - this.oy) / RADIUS;
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    const dead = 0.14;
    const mag = Math.hypot(dx, dy);
    if (mag < dead) {
      this.state.x = 0;
      this.state.y = 0;
    } else {
      const k = (mag - dead) / (1 - dead) / mag;
      this.state.x = dx * k;
      this.state.y = dy * k;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx * RADIUS}px), calc(-50% + ${dy * RADIUS}px))`;
  }

  private bindButtons(): void {
    this.root.querySelectorAll<HTMLElement>("[data-act]").forEach((btn) => {
      const act = btn.dataset.act!;
      const hold = act === "shoot" || act === "sprint";
      btn.addEventListener("pointerdown", (e) => {
        btn.classList.add("down");
        if (act === "shoot") this.state.shoot = true;
        else if (act === "sprint") this.state.sprint = true;
        else if (act === "pass") this.tapPass = true;
        else if (act === "check") this.tapCheck = true;
        e.preventDefault();
      });
      const up = () => {
        btn.classList.remove("down");
        if (!hold) return;
        if (act === "shoot") this.state.shoot = false;
        if (act === "sprint") this.state.sprint = false;
      };
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });
  }
}
