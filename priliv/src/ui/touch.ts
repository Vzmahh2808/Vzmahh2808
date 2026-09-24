import type { Input } from "../core/input";

export interface StickVector {
  x: number;
  y: number;
  mag: number;
}

/**
 * Map a finger at (x, y) relative to the stick origin into a unit vector.
 * Screen y grows downward, so dragging up gives positive y (forward).
 * A small dead zone keeps a resting thumb from drifting.
 */
export function stickVector(ox: number, oy: number, x: number, y: number, radius: number, dead = 0.12): StickVector {
  let dx = (x - ox) / radius;
  let dy = -(y - oy) / radius;
  let mag = Math.hypot(dx, dy);
  if (mag > 1) {
    dx /= mag;
    dy /= mag;
    mag = 1;
  }
  if (mag < dead) return { x: 0, y: 0, mag: 0 };
  // Rescale so output ramps from 0 at the dead zone edge to 1 at the rim.
  const k = (mag - dead) / (1 - dead) / mag;
  return { x: dx * k, y: dy * k, mag: (mag - dead) / (1 - dead) };
}

export function isTouchDevice(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

const RADIUS = 60;

/** Floating joystick on the left half plus action buttons that feed the shared Input. */
export class TouchControls {
  enabled = false;
  private root: HTMLElement;
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private ox = 0;
  private oy = 0;

  constructor(private input: Input, force = false) {
    this.root = document.querySelector<HTMLElement>("#touch")!;
    this.zone = this.root.querySelector<HTMLElement>(".stick-zone")!;
    this.base = this.root.querySelector<HTMLElement>(".stick-base")!;
    this.knob = this.root.querySelector<HTMLElement>(".stick-knob")!;
    if (force || isTouchDevice()) this.enable();
    // A first real touch turns the controls on even on hybrid laptops.
    window.addEventListener("touchstart", () => this.enable(), { once: true, passive: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add("touch");
    this.bindStick();
    this.bindButtons();
  }

  private bindStick(): void {
    this.zone.addEventListener("pointerdown", (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try {
        this.zone.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone; moves still arrive on the zone */
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
      this.input.analog.x = 0;
      this.input.analog.y = 0;
      this.knob.style.transform = "translate(-50%, -50%)";
      this.base.classList.remove("on");
    };
    this.zone.addEventListener("pointerup", end);
    this.zone.addEventListener("pointercancel", end);
  }

  private move(x: number, y: number): void {
    const v = stickVector(this.ox, this.oy, x, y, RADIUS);
    this.input.analog.x = v.x;
    this.input.analog.y = v.y;
    const kx = Math.max(-1, Math.min(1, (x - this.ox) / RADIUS)) * RADIUS;
    const ky = Math.max(-1, Math.min(1, (y - this.oy) / RADIUS)) * RADIUS;
    this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
  }

  private bindButtons(): void {
    this.root.querySelectorAll<HTMLElement>("[data-key]").forEach((btn) => {
      const code = btn.dataset.key!;
      const hold = btn.dataset.hold === "1";
      btn.addEventListener("pointerdown", (e) => {
        this.input.press(code);
        btn.classList.add("down");
        if (!hold) setTimeout(() => this.input.release(code), 120);
        e.preventDefault();
      });
      const up = () => {
        btn.classList.remove("down");
        if (hold) this.input.release(code);
      };
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });
  }

  /** Show the buttons that matter right now. */
  setMode(inCar: boolean, canEnter: boolean, taxi = false): void {
    if (!this.enabled) return;
    this.root.classList.toggle("taxi", taxi);
    this.root.classList.toggle("in-car", inCar);
    this.root.classList.toggle("can-enter", canEnter || inCar);
    const enter = this.root.querySelector<HTMLElement>(".enter");
    const label = inCar ? "Выйти" : "Сесть";
    if (enter && enter.textContent !== label) enter.textContent = label;
  }
}
