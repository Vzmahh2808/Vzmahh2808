export const SAVE_VERSION = 2;

/** Hours of walking available each day. */
export const DAY_HOURS = 10;

export type Terrain =
  | "meadow"
  | "forest"
  | "swamp"
  | "scree"
  | "glacier"
  | "rock"
  | "river"
  | "bridge"
  | "lake"
  | "pass"
  | "peak"
  | "village";

export interface Tile {
  t: Terrain;
  /** Normalized height 0..1, used for shading and for carving passes. */
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Weather = "clear" | "cloudy" | "rain" | "storm" | "snow";

export type Role = "leader" | "quartermaster" | "medic" | "mechanic";

export interface Member {
  id: number;
  name: string;
  female: boolean;
  role: Role;
  /** 1..5, widens the target zone at technical stages. */
  technique: number;
  /** 1..5, lowers stamina cost of walking. */
  strength: number;
  /** 0..100. At 0 the member has to be evacuated and the route is over. */
  health: number;
  /** 0..100. Low stamina slows the group and makes stages harder. */
  stamina: number;
  /** Days of injury left; an injured member slows everyone down. */
  injury: number;
}

export interface Supplies {
  /** Person-days of food. */
  food: number;
  /** Days of stove gas. */
  gas: number;
  rope: boolean;
  /** First-aid kit uses. */
  kit: number;
}

export interface Checkpoint {
  id: number;
  pos: Point;
  name: string;
  taken: boolean;
}

export type Category = 1 | 2 | 3;

export type StageKind = "river" | "pass";
export type RiverMethod = "ford" | "rope";

export interface StageChallenge {
  kind: StageKind;
  from: Point;
  to: Point;
  /** Methods the player may pick for a river; a pass is always fixed ropes. */
  methods: RiverMethod[];
  /** Chosen river method; null until the UI picks one. */
  method: RiverMethod | null;
  /** Half-width of the target zone in 0..0.5 for each member (index matches members). */
  zones: number[];
  /** Hours the crossing takes once resolved. */
  hours: number;
  /** For the pass sequence mini-game: how many moves the leader has to repeat. */
  sequence: number;
}

/** What the player decided before leaving the village. */
export interface Setup {
  memberIds: number[];
  foodPerMember: number;
  gas: number;
  kit: number;
  rope: boolean;
}

export interface ChoiceOption {
  label: string;
  hint: string;
}

/** A dilemma on the trail; the engine keeps only serializable text, effects live in a registry. */
export interface Choice {
  id: string;
  title: string;
  text: string;
  options: ChoiceOption[];
}

export type LogKind = "info" | "good" | "bad" | "warn" | "system";

export interface LogEntry {
  day: number;
  text: string;
  kind: LogKind;
}

export type Status = "playing" | "won" | "lost";

export interface Stats {
  tiles: number;
  stages: number;
  falls: number;
  peaks: number;
  restDays: number;
}

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  category: Category;
  width: number;
  height: number;
  tiles: Tile[];
  start: Point;
  finish: Point;
  checkpoints: Checkpoint[];
  pos: Point;
  day: number;
  deadline: number;
  hours: number;
  weather: Weather;
  forecast: Weather;
  members: Member[];
  supplies: Supplies;
  /** 0..100 group morale. */
  morale: number;
  pending: StageChallenge | null;
  pendingChoice: Choice | null;
  /** Day on which the last trail dilemma fired, so there is at most one per day. */
  choiceDay: number;
  status: Status;
  endReason: string;
  stats: Stats;
  log: LogEntry[];
  /** Tiles the group has stood on, for the trail drawn on the map. */
  trail: Point[];
}

export type GameEvent =
  | { type: "move"; from: Point; to: Point }
  | { type: "stage"; kind: StageKind }
  | { type: "choice" }
  | { type: "stageResult"; ok: boolean }
  | { type: "checkpoint"; id: number }
  | { type: "camp"; rest: boolean }
  | { type: "peak" }
  | { type: "hurt"; memberId: number }
  | { type: "won" }
  | { type: "lost" };
