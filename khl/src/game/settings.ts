/** Player settings kept in local storage. */
export interface Settings {
  muted: boolean;
  /** 0 easy, 1 normal, 2 hard. */
  difficulty: 0 | 1 | 2;
  /** Real length of a period: 0 short, 1 normal, 2 long. */
  length: 0 | 1 | 2;
  quality: "auto" | "high" | "low";
  /** Two-minute penalties on or off. */
  penalties: boolean;
}

export const SETTINGS_KEY = "khl.settings";
export const DIFFICULTY_VALUES = [0.35, 0.6, 0.85];
export const LENGTH_SECONDS = [90, 150, 240];
export const DIFFICULTY_NAMES = ["Лёгкий", "Обычный", "Сложный"];
export const LENGTH_NAMES = ["Короткие", "Обычные", "Долгие"];

export const defaultSettings = (): Settings => ({ muted: false, difficulty: 1, length: 1, quality: "auto", penalties: true });

export function parseSettings(raw: string | null): Settings {
  const d = defaultSettings();
  if (!raw) return d;
  try {
    const o = JSON.parse(raw) as Partial<Settings>;
    return {
      muted: typeof o.muted === "boolean" ? o.muted : d.muted,
      difficulty: o.difficulty === 0 || o.difficulty === 1 || o.difficulty === 2 ? o.difficulty : d.difficulty,
      length: o.length === 0 || o.length === 1 || o.length === 2 ? o.length : d.length,
      quality: o.quality === "high" || o.quality === "low" || o.quality === "auto" ? o.quality : d.quality,
      penalties: typeof o.penalties === "boolean" ? o.penalties : d.penalties,
    };
  } catch {
    return d;
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage may be blocked; settings just will not persist */
  }
}
