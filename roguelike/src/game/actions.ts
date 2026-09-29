/**
 * Compact text encoding of player actions, used to record and replay whole runs.
 *
 * Every accepted action is one or two characters:
 *   1-4, 6-9  step (or attack) in a numpad direction: 8 is north, 3 is south-east
 *   5         wait a turn
 *   g         pick up
 *   >         descend
 *   u<a-z>    use or equip inventory slot 0-25
 *   d<a-z>    drop inventory slot 0-25
 */

export type Action =
  | { type: "move"; dx: number; dy: number }
  | { type: "wait" }
  | { type: "pickup" }
  | { type: "descend" }
  | { type: "use"; index: number }
  | { type: "drop"; index: number };

const NUMPAD: Record<string, [number, number]> = {
  "1": [-1, 1],
  "2": [0, 1],
  "3": [1, 1],
  "4": [-1, 0],
  "6": [1, 0],
  "7": [-1, -1],
  "8": [0, -1],
  "9": [1, -1],
};

const SLOT_BASE = "a".charCodeAt(0);
const SLOT_COUNT = 26;

export class ActionFormatError extends Error {
  constructor(
    message: string,
    /** Character offset in the encoded string. */
    readonly offset: number,
  ) {
    super(message);
  }
}

export function encodeAction(action: Action): string {
  switch (action.type) {
    case "move": {
      for (const [key, [dx, dy]] of Object.entries(NUMPAD)) {
        if (dx === action.dx && dy === action.dy) return key;
      }
      throw new Error(`шаг (${action.dx}, ${action.dy}) нельзя записать`);
    }
    case "wait":
      return "5";
    case "pickup":
      return "g";
    case "descend":
      return ">";
    case "use":
      return "u" + slotChar(action.index);
    case "drop":
      return "d" + slotChar(action.index);
  }
}

export function encodeActions(actions: readonly Action[]): string {
  return actions.map(encodeAction).join("");
}

export function decodeActions(text: string): Action[] {
  const out: Action[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const dir = NUMPAD[c];
    if (dir) {
      out.push({ type: "move", dx: dir[0], dy: dir[1] });
      i++;
    } else if (c === "5") {
      out.push({ type: "wait" });
      i++;
    } else if (c === "g") {
      out.push({ type: "pickup" });
      i++;
    } else if (c === ">") {
      out.push({ type: "descend" });
      i++;
    } else if (c === "u" || c === "d") {
      const slot = text.charCodeAt(i + 1) - SLOT_BASE;
      if (!(slot >= 0 && slot < SLOT_COUNT)) throw new ActionFormatError(`после «${c}» ожидается буква слота a-z`, i + 1);
      out.push(c === "u" ? { type: "use", index: slot } : { type: "drop", index: slot });
      i += 2;
    } else {
      throw new ActionFormatError(`неизвестный символ «${c}»`, i);
    }
  }
  return out;
}

function slotChar(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) throw new Error(`слот ${index} нельзя записать`);
  return String.fromCharCode(SLOT_BASE + index);
}
