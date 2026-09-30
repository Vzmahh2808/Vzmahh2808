import * as THREE from "three";
import { RAIL_HEIGHT, eastStrip, stripFurniture, stripSpans, type Strip } from "./embankment";

const PAVED_TOP = 0.09;
const QUAY_TOP = 0.32;

/** Paving, quay wall, railing, benches and lamps for one waterfront strip. */
export function buildStrip(strip: Strip, paved: { from: number; to: number }, lampHeadMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const tiles = new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 0.95 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe6e9, roughness: 0.4, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 });

  /** World position of a point `u` along the strip and `back` metres inland from the shore. */
  const at = (u: number, back: number): [number, number] => {
    const c = strip.shore - strip.dir * back;
    return strip.alongX ? [u, c] : [c, u];
  };
  /** Box size for `along` x `thick` measured along and across the strip. */
  const size = (along: number, y: number, thick: number): [number, number, number] => (strip.alongX ? [along, y, thick] : [thick, y, along]);
  const place = (m: THREE.Object3D, u: number, back: number, y: number) => {
    const [x, z] = at(u, back);
    m.position.set(x, y, z);
    return m;
  };

  // Paving from the road edge to the quay wall, with a lighter strip for the walkway (bare edges have none).
  const len = paved.to - paved.from;
  const mid = (paved.from + paved.to) / 2;
  const bare = strip.depth <= 0;
  if (!bare) {
    const pave = new THREE.Mesh(new THREE.BoxGeometry(...size(len, PAVED_TOP, strip.depth)), tiles);
    place(pave, mid, strip.depth / 2, PAVED_TOP / 2 - 0.02);
    pave.receiveShadow = true;
    group.add(pave);
    const walk = new THREE.Mesh(new THREE.BoxGeometry(...size(len, 0.02, 4)), new THREE.MeshStandardMaterial({ color: 0xd6cfc0, roughness: 0.95 }));
    place(walk, mid, strip.depth - 6, PAVED_TOP - 0.01);
    walk.receiveShadow = true;
    group.add(walk);
  }

  const spans = stripSpans(strip);
  for (const s of spans) {
    const l = s.z1 - s.z0;
    const m = (s.z0 + s.z1) / 2;
    // Quay wall: a low stone kerb along the water, broken where a bridge or pier comes down.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...size(l, QUAY_TOP, 1.6)), stone);
    place(wall, m, 0.5, QUAY_TOP / 2 - 0.02);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    // A lower bar and a top handrail.
    for (const y of [RAIL_HEIGHT * 0.45, RAIL_HEIGHT]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(...size(l, y === RAIL_HEIGHT ? 0.09 : 0.05, 0.07)), steel);
      place(bar, m, 1.4, y);
      group.add(bar);
    }
  }

  // Railing posts every 3 m.
  const postPositions: number[] = [];
  for (const s of spans) for (let u = s.z0; u <= s.z1 + 0.01; u += 3) postPositions.push(u);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, RAIL_HEIGHT, 0.1), steel, postPositions.length);
  const mat4 = new THREE.Matrix4();
  postPositions.forEach((u, i) => {
    const [x, z] = at(u, 1.4);
    posts.setMatrixAt(i, mat4.makeTranslation(x, RAIL_HEIGHT / 2, z));
  });
  posts.frustumCulled = false;
  group.add(posts);

  const { benches, lamps } = bare ? { benches: [], lamps: [] } : stripFurniture(strip, paved.from, paved.to);
  const seatSize: [number, number, number] = strip.alongX ? [2, 0.08, 0.5] : [0.5, 0.08, 2];
  const backSize: [number, number, number] = strip.alongX ? [2, 0.5, 0.08] : [0.08, 0.5, 2];
  const legSize: [number, number, number] = strip.alongX ? [1.8, 0.42, 0.4] : [0.4, 0.42, 1.8];
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(...seatSize), wood, benches.length);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(...backSize), wood, benches.length);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(...legSize), iron, benches.length);
  const put = (mesh: THREE.InstancedMesh, i: number, u: number, backDist: number, y: number) => {
    const [x, z] = at(u, backDist);
    mesh.setMatrixAt(i, mat4.makeTranslation(x, y, z));
  };
  benches.forEach((u, i) => {
    put(seat, i, u, 4.4, 0.5);
    put(back, i, u, 4.7, 0.75); // the backrest is on the landward side, so the sitter faces the sea
    put(legs, i, u, 4.4, 0.25);
  });
  group.add(seat, back, legs);

  // Old-fashioned lamps along the walkway.
  const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 6), iron, lamps.length);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 8, 6), lampHeadMaterial, lamps.length);
  lamps.forEach((u, i) => {
    put(stem, i, u, 6.9, 1.7);
    const [x, z] = at(u, 6.9);
    head.setMatrixAt(i, mat4.makeTranslation(x, 3.5, z));
  });
  stem.castShadow = true;
  group.add(stem, head);
  return group;
}

/** The east promenade: paved to `pavedLimit` north and south, railed to `limit`. */
export function buildEmbankment(pavedLimit: number, limit: number, lampHeadMaterial: THREE.Material): THREE.Group {
  return buildStrip(eastStrip(limit), { from: -pavedLimit, to: pavedLimit }, lampHeadMaterial);
}
