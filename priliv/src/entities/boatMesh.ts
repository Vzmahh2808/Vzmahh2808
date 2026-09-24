import * as THREE from "three";
import type { BoatSpec, BoatState } from "./boatPhysics";
import { WATER_LEVEL } from "../world/island";

export interface BoatVisual {
  group: THREE.Group;
  /** Police light bar halves, flashed while chasing. */
  lights: [THREE.Mesh, THREE.Mesh] | null;
  bob: number;
}

/** Hull outline in the boat's own frame: +x is the bow. */
function hullShape(L: number, W: number, scale = 1): THREE.Shape {
  const l = (L / 2) * scale;
  const w = (W / 2) * scale;
  const s = new THREE.Shape();
  s.moveTo(-l, -w * 0.92);
  s.lineTo(l * 0.35, -w);
  s.quadraticCurveTo(l * 0.85, -w * 0.8, l, 0);
  s.quadraticCurveTo(l * 0.85, w * 0.8, l * 0.35, w);
  s.lineTo(-l, w * 0.92);
  s.closePath();
  return s;
}

function slab(shape: THREE.Shape, depth: number, y: number, color: number): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }));
  m.castShadow = true;
  return m;
}

function block(w: number, h: number, d: number, x: number, y: number, z: number, color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts }));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildBoatVisual(kind: string, spec: BoatSpec, color: number): BoatVisual {
  const L = spec.length;
  const W = spec.width;
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  const police = kind === "police";
  const sleek = kind === "speedboat";
  const hullH = sleek ? 0.75 : 0.95;
  // Hull sits partly under water; a darker band marks the waterline.
  group.add(slab(hullShape(L, W), hullH, -0.35, police ? 0x1e3799 : color));
  group.add(slab(hullShape(L, W, 1.01), 0.14, -0.08, police ? 0xf5f6fa : 0x2f3640));
  group.add(slab(hullShape(L, W, 0.86), 0.06, hullH - 0.36, sleek ? 0xdcdde1 : 0xc49a6c));
  // Windscreen and dashboard.
  const glass = block(0.08, 0.55, W * 0.72, L * 0.08, hullH - 0.02, 0, 0x9fd3f5, { transparent: true, opacity: 0.55, metalness: 0.3, roughness: 0.1 });
  glass.rotation.z = -0.5;
  group.add(glass, block(0.5, 0.3, W * 0.7, L * 0.02, hullH - 0.15, 0, 0x2f3640));
  // Seats.
  group.add(block(0.55, 0.35, W * 0.62, -L * 0.12, hullH - 0.15, 0, sleek ? 0xc23616 : 0xf5f6fa));
  if (!sleek) group.add(block(0.5, 0.35, W * 0.62, -L * 0.3, hullH - 0.15, 0, 0xf5f6fa));
  // Outboard motor.
  group.add(block(0.5, 0.9, 0.55, -L / 2 - 0.2, hullH - 0.1, 0, 0x2d3436));
  if (sleek) group.add(block(L * 0.55, 0.05, 0.25, L * 0.05, hullH - 0.28, W * 0.49, 0xf5f6fa), block(L * 0.55, 0.05, 0.25, L * 0.05, hullH - 0.28, -W * 0.49, 0xf5f6fa));
  let lights: BoatVisual["lights"] = null;
  if (police) {
    // Small cabin with a light bar on top.
    group.add(block(1.3, 0.9, W * 0.8, -L * 0.1, hullH + 0.2, 0, 0xf5f6fa));
    const red = block(0.3, 0.16, 0.5, -L * 0.1, hullH + 0.72, -0.3, 0x550000, { emissive: 0xff2020, emissiveIntensity: 0 });
    const blue = block(0.3, 0.16, 0.5, -L * 0.1, hullH + 0.72, 0.3, 0x000055, { emissive: 0x2050ff, emissiveIntensity: 0 });
    group.add(red, blue);
    lights = [red, blue];
  }
  return { group, lights, bob: Math.random() * 10 };
}

/** Place the boat on the water: bobbing, bow lift at speed, lean in turns, sinking. */
export function syncBoatVisual(v: BoatVisual, s: BoatState, dt: number, time: number, flashing: boolean): void {
  v.bob += dt;
  const sp = Math.hypot(s.vx, s.vz);
  const planing = Math.min(1, sp / 18);
  let y = WATER_LEVEL + Math.sin(v.bob * 1.7) * 0.06 * (1 - planing * 0.6) + planing * 0.12;
  let pitch = planing * 0.09 + Math.sin(v.bob * 1.3) * 0.02;
  let roll = Math.max(-0.2, Math.min(0.2, -s.yawRate * sp * 0.012)) + Math.sin(v.bob * 1.1) * 0.02;
  if (s.sunk) {
    y = -1.7;
    pitch = 0.3;
    roll = 0.4;
  }
  v.group.position.set(s.x, y, s.z);
  v.group.rotation.y = -s.heading;
  v.group.rotation.z = pitch;
  v.group.rotation.x = roll;
  if (v.lights) {
    const phase = Math.floor(time * 6) % 2;
    (v.lights[0].material as THREE.MeshStandardMaterial).emissiveIntensity = flashing && phase === 0 ? 3 : 0;
    (v.lights[1].material as THREE.MeshStandardMaterial).emissiveIntensity = flashing && phase === 1 ? 3 : 0;
  }
}
