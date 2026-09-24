import { Rng } from "../core/rng";

/** Pure pattern generation for the procedural radio. Notes are MIDI numbers. */

export interface StationStyle {
  id: string;
  name: string;
  bpm: number;
  root: number;
  scale: number[];
  /** Semitone offsets of the chord roots within the scale, one per bar. */
  progression: number[];
  kick: number[];
  snare: number[];
  hat: number[];
  bassRhythm: number[];
  lead: boolean;
  wave: OscillatorType;
}

export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const X = 1;
const _ = 0;

export const STATIONS: StationStyle[] = [
  {
    id: "priliv",
    name: "Прилив FM",
    bpm: 100,
    root: 45,
    scale: MINOR,
    progression: [0, 5, 3, 4],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    snare: [_, _, _, _, X, _, _, _, _, _, _, _, X, _, _, _],
    hat: [_, _, X, _, _, _, X, _, _, _, X, _, _, _, X, _],
    bassRhythm: [X, _, X, _, X, _, X, _, X, _, X, _, X, _, X, X],
    lead: true,
    wave: "sawtooth",
  },
  {
    id: "port",
    name: "Порт 101",
    bpm: 78,
    root: 50,
    scale: DORIAN,
    progression: [0, 3, 5, 4],
    kick: [X, _, _, _, _, _, _, X, _, _, X, _, _, _, _, _],
    snare: [_, _, _, _, X, _, _, _, _, _, _, _, X, _, _, _],
    hat: [X, _, X, _, X, _, X, _, X, _, X, _, X, _, X, X],
    bassRhythm: [X, _, _, _, _, _, X, _, _, _, X, _, _, _, _, _],
    lead: false,
    wave: "triangle",
  },
  {
    id: "sirena",
    name: "Сирена",
    bpm: 126,
    root: 41,
    scale: MINOR,
    progression: [0, 0, 5, 3],
    kick: [X, _, _, _, X, _, _, _, X, _, _, _, X, _, _, _],
    snare: [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    hat: [_, _, X, _, _, _, X, _, _, _, X, _, _, _, X, _],
    bassRhythm: [_, _, X, X, _, _, X, X, _, _, X, X, _, _, X, X],
    lead: true,
    wave: "square",
  },
];

/** MIDI note of scale degree `deg` (can exceed the octave) above `root`. */
export function degree(root: number, scale: number[], deg: number): number {
  const oct = Math.floor(deg / scale.length);
  const idx = ((deg % scale.length) + scale.length) % scale.length;
  return root + oct * 12 + scale[idx];
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Triad on scale degree `deg`, built from stacked thirds in the scale. */
export function chord(root: number, scale: number[], deg: number): number[] {
  return [degree(root, scale, deg), degree(root, scale, deg + 2), degree(root, scale, deg + 4)];
}

export interface Bar {
  chord: number[];
  bass: Array<number | null>;
  lead: Array<number | null>;
}

/** One bar of 16 sixteenth-note steps. Lead melodies are seeded, so a station repeats its tunes. */
export function makeBar(style: StationStyle, barIndex: number, seed: number): Bar {
  const deg = style.progression[barIndex % style.progression.length];
  const ch = chord(style.root + 12, style.scale, deg);
  const bassNote = degree(style.root, style.scale, deg);
  const bass = style.bassRhythm.map((on, i) => (on ? bassNote + (i % 8 === 6 ? 12 : 0) : null));
  const rng = new Rng((seed * 7919 + barIndex * 104729) >>> 0);
  const lead: Array<number | null> = [];
  let step = deg + 7;
  for (let i = 0; i < 16; i++) {
    if (!style.lead || rng.next() < 0.55) {
      lead.push(null);
      continue;
    }
    step += rng.pick([-2, -1, 1, 2, 0]);
    step = Math.max(deg + 4, Math.min(deg + 12, step));
    lead.push(degree(style.root + 12, style.scale, step));
  }
  return { chord: ch, bass, lead };
}
