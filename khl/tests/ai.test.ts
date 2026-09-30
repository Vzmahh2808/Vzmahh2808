import { describe, expect, it } from "vitest";
import { defenseSlot, offenseSlot } from "../src/sim/ai";
import type { Role } from "../src/sim/state";

const ROLES: Role[] = ["C", "LW", "RW", "LD", "RD"];

describe("team shape is mirror-symmetric between the two teams", () => {
  it("defence slots mirror across the centre line", () => {
    for (const role of ROLES) {
      for (const px of [-25, -12, -3, 0, 6, 18, 24]) {
        for (const py of [-11, -4, 0, 5, 12]) {
          const a = { x: 0, y: 0 };
          const b = { x: 0, y: 0 };
          defenseSlot(0, role, px, py, a);
          defenseSlot(1, role, -px, py, b);
          expect(b.x).toBeCloseTo(-a.x, 6);
          expect(b.y).toBeCloseTo(a.y, 6);
        }
      }
    }
  });

  it("attack slots mirror across the centre line", () => {
    for (const role of ROLES) {
      for (const refX of [-20, -8, 0, 9, 15, 22]) {
        for (const refY of [-10, -3, 0, 4, 9]) {
          const a = { x: 0, y: 0 };
          const b = { x: 0, y: 0 };
          offenseSlot(0, role, refX, refY, a);
          offenseSlot(1, role, refX, refY, b);
          expect(b.x).toBeCloseTo(-a.x, 6);
          expect(b.y).toBeCloseTo(a.y, 6);
        }
      }
    }
  });
});
