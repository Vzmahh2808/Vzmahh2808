/** Keyboard state keyed by KeyboardEvent.code so it works on any layout. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

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

  endFrame(): void {
    this.pressed.clear();
  }
}
