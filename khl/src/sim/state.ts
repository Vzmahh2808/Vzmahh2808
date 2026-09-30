/** Plain data for the simulation: no DOM, no Date, no Math.random. */
import { Rng } from "../core/rng";
import type { Vec } from "../core/vec";
import { attackDir, goalX, type TeamId } from "./rink";

export type Role = "C" | "LW" | "RW" | "LD" | "RD" | "G";

/** Team strength on a 55..95 scale, 75 is average. */
export interface Ratings {
  off: number;
  def: number;
  gk: number;
  spd: number;
}

export const AVERAGE: Ratings = { off: 75, def: 75, gk: 75, spd: 75 };

export interface SkaterInput {
  /** Desired velocity as a fraction of top speed: length 0..1. */
  mx: number;
  my: number;
  sprint: boolean;
  /** Pass was pressed this step. */
  pass: boolean;
  /** Shoot button is down. */
  shootHeld: boolean;
  /** Shoot button was released this step. */
  shootReleased: boolean;
  /** Check or poke was pressed this step. */
  check: boolean;
}

export const idleInput = (): SkaterInput => ({ mx: 0, my: 0, sprint: false, pass: false, shootHeld: false, shootReleased: false, check: false });

export interface Skater {
  id: number;
  team: TeamId;
  role: Role;
  /** False when the skater is off the ice (3 on 3, shootout). */
  active: boolean;
  pos: Vec;
  vel: Vec;
  heading: number;
  stamina: number;
  stun: number;
  pickupCd: number;
  pokeCd: number;
  blockCd: number;
  /** Seconds the shoot button has been held. */
  charge: number;
  /** Seconds left in which a released shot fires the moment a pass arrives. */
  shotBuffer: number;
  bufferedCharge: number;
  /** Multipliers around 1. */
  speed: number;
  shot: number;
  pass: number;
  def: number;
  input: SkaterInput;
  // goalie state
  gHold: number;
  gDive: number;
  gDiveDir: number;
  gReact: number;
  gTarget: number;
  // AI memory
  aiTimer: number;
  aiMode: number;
  aiTarget: Vec;
  aiShootIn: number;
  aiChargeFor: number;
  aiPassIn: number;
}

export interface Puck {
  pos: Vec;
  vel: Vec;
  /** Skater id carrying the puck, or -1. */
  carrier: number;
  lastTouch: number;
  lastTeam: TeamId | -1;
  /** Skater who released the last shot; cannot block it for a moment. */
  shooter: number;
  shooterCd: number;
  /** Receiver of a pass in flight, or -1. */
  passTo: number;
  /** Seconds since the last shot or pass left a stick. */
  flight: number;
  /** Goalie id that has already been beaten by this shot. */
  beaten: number;
  /** Seconds a rebound stays dangerous. */
  rebound: number;
  /** Set when the last release was a slap-style shot on goal. */
  shotTeam: TeamId | -1;
  shotSpeed: number;
  /** Distance to the goal when the last shot left the stick. */
  shotDist: number;
}

export type GameEvent =
  | { type: "shot"; team: TeamId; power: number; oneTimer: boolean }
  | { type: "pass"; team: TeamId }
  | { type: "hit"; team: TeamId; power: number }
  | { type: "poke"; team: TeamId; ok: boolean }
  | { type: "board"; speed: number }
  | { type: "post"; speed: number }
  | { type: "block"; team: TeamId }
  | { type: "save"; team: TeamId; held: boolean }
  | { type: "goal"; team: TeamId; scorer: number; assist: number[] }
  | { type: "whistle" }
  | { type: "faceoff" };

export interface World {
  t: number;
  skaters: Skater[];
  puck: Puck;
  rng: Rng;
  ratings: [Ratings, Ratings];
  events: GameEvent[];
  /** Skater ids that touched the puck last, newest first, for assists. */
  touches: number[];
  /** Ids of the skater each human team controls, or -1. */
  controlled: [number, number];
  /** Which sides a person plays. */
  human: [boolean, boolean];
  /** AI difficulty 0..1 for each team. */
  difficulty: [number, number];
}

const ROLES: Role[] = ["C", "LW", "RW", "LD", "RD", "G"];

export const skaterId = (team: TeamId, role: Role): number => team * 6 + ROLES.indexOf(role);
export const goalieId = (team: TeamId): number => skaterId(team, "G");

const k = (r: number, per: number): number => 1 + (r - 75) * per;

export function makeSkater(id: number, team: TeamId, role: Role, r: Ratings): Skater {
  const dir = attackDir(team);
  return {
    id,
    team,
    role,
    active: true,
    pos: { x: -dir * 10, y: 0 },
    vel: { x: 0, y: 0 },
    heading: dir > 0 ? 0 : Math.PI,
    stamina: 1,
    stun: 0,
    pickupCd: 0,
    pokeCd: 0,
    blockCd: 0,
    charge: 0,
    shotBuffer: 0,
    bufferedCharge: 0,
    speed: k(r.spd, 0.004),
    shot: k(r.off, 0.005),
    pass: k(r.off, 0.004),
    def: k(r.def, 0.005),
    input: idleInput(),
    gHold: 0,
    gDive: 0,
    gDiveDir: 0,
    gReact: 0,
    gTarget: 0,
    aiTimer: 0,
    aiMode: 0,
    aiTarget: { x: 0, y: 0 },
    aiShootIn: 0,
    aiChargeFor: 0,
    aiPassIn: 0,
  };
}

export function makePuck(): Puck {
  return {
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    carrier: -1,
    lastTouch: -1,
    lastTeam: -1,
    shooter: -1,
    shooterCd: 0,
    passTo: -1,
    flight: 99,
    beaten: -1,
    rebound: 0,
    shotTeam: -1,
    shotSpeed: 0,
    shotDist: 30,
  };
}

export function makeWorld(seed: number, home: Ratings = AVERAGE, away: Ratings = AVERAGE): World {
  const skaters: Skater[] = [];
  for (const team of [0, 1] as TeamId[]) {
    const r = team === 0 ? home : away;
    for (const role of ROLES) skaters.push(makeSkater(skaterId(team, role), team, role, r));
  }
  return {
    t: 0,
    skaters,
    puck: makePuck(),
    rng: new Rng(seed),
    ratings: [home, away],
    events: [],
    touches: [],
    controlled: [-1, -1],
    human: [false, false],
    difficulty: [0.6, 0.6],
  };
}

/** Where a goalie stands at rest. */
export function goalieHome(team: TeamId): Vec {
  return { x: goalX(team) + attackDir(team) * 0.6, y: 0 };
}

export const teamSkaters = (w: World, team: TeamId): Skater[] => w.skaters.filter((s) => s.team === team && s.active && s.role !== "G");
export const goalieOf = (w: World, team: TeamId): Skater => w.skaters[goalieId(team)];
