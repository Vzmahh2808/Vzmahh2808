/** Keyboard state keyed by KeyboardEvent.code so it works on any layout. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Analog stick from touch controls: x = right, y = forward, both -1..1. */
  analog = { x: 0, y: 0 };

  constructor(target: Window = window) {
    target.addEventListener("keydown", (ev) => {
      if (ev.repeat) return;
      this.down.add(ev.code);
      this.pressed.add(ev.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.code)) ev.preventDefault();
    });
    target.addEventListener("keyup", (ev) => this.down.delete(ev.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  justPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  axis(neg: string[], pos: string[]): number {
    return (this.isDown(...pos) ? 1 : 0) - (this.isDown(...neg) ? 1 : 0);
  }

  /** Keyboard axis plus a touch analog component, clamped to -1..1. */
  mixed(neg: string[], pos: string[], analog: number): number {
    return Math.max(-1, Math.min(1, this.axis(neg, pos) + analog));
  }

  /** Simulate a key from an on-screen button. */
  press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
