import * as THREE from "three";
import { PROMENADE_X0, RAIL_HEIGHT, RAIL_X, promenadeFurniture, railSpans } from "./embankment";
import { CITY_EAST_SHORE } from "./island";
import { BRIDGE } from "./island";

const PAVED_TOP = 0.09;
const QUAY_TOP = 0.32;

/** The promenade, its quay wall, railings, benches and lamps. */
export function buildEmbankment(pavedLimit: number, limit: number, lampHeadMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const tiles = new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 0.95 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe6e9, roughness: 0.4, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 });

  // Paving from the road edge to the quay wall, with a lighter strip for the walkway.
  const paved = new THREE.Mesh(new THREE.BoxGeometry(CITY_EAST_SHORE - PROMENADE_X0, PAVED_TOP, pavedLimit * 2), tiles);
  paved.position.set((PROMENADE_X0 + CITY_EAST_SHORE) / 2, PAVED_TOP / 2 - 0.02, 0);
  paved.receiveShadow = true;
  group.add(paved);
  const walk = new THREE.Mesh(new THREE.BoxGeometry(4, 0.02, pavedLimit * 2), new THREE.MeshStandardMaterial({ color: 0xd6cfc0, roughness: 0.95 }));
  walk.position.set(PROMENADE_X0 + 6, PAVED_TOP - 0.01, 0);
  walk.receiveShadow = true;
  group.add(walk);

  // Quay wall: a low stone kerb along the water, broken where the bridge and pier come down.
  for (const s of railSpans(limit)) {
    const len = s.z1 - s.z0;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, QUAY_TOP, len), stone);
    wall.position.set(CITY_EAST_SHORE - 0.5, QUAY_TOP / 2 - 0.02, (s.z0 + s.z1) / 2);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    // Two horizontal bars and a top handrail.
    for (const y of [RAIL_HEIGHT * 0.45, RAIL_HEIGHT]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, y === RAIL_HEIGHT ? 0.09 : 0.05, len), steel);
      bar.position.set(RAIL_X, y, (s.z0 + s.z1) / 2);
      group.add(bar);
    }
  }

  // Railing posts every 3 m.
  const postPositions: number[] = [];
  for (const s of railSpans(limit)) for (let z = s.z0; z <= s.z1 + 0.01; z += 3) postPositions.push(z);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, RAIL_HEIGHT, 0.1), steel, postPositions.length);
  const m = new THREE.Matrix4();
  postPositions.forEach((z, i) => posts.setMatrixAt(i, m.makeTranslation(RAIL_X, RAIL_HEIGHT / 2, z)));
  posts.frustumCulled = false;
  group.add(posts);

  const { benches, lamps } = promenadeFurniture(pavedLimit);
  // Benches facing the sea.
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 2), wood, benches.length);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.5, 2), wood, benches.length);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.42, 1.8), iron, benches.length);
  benches.forEach((z, i) => {
    const x = RAIL_X - 3;
    seat.setMatrixAt(i, m.makeTranslation(x, 0.5, z));
    back.setMatrixAt(i, m.makeTranslation(x - 0.28, 0.75, z));
    legs.setMatrixAt(i, m.makeTranslation(x, 0.25, z));
  });
  group.add(seat, back, legs);

  // Old-fashioned lamps along the walkway.
  const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 3.4, 6), iron, lamps.length);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 8, 6), lampHeadMaterial, lamps.length);
  lamps.forEach((z, i) => {
    const x = RAIL_X - 5.5;
    stem.setMatrixAt(i, m.makeTranslation(x, 1.7, z));
    head.setMatrixAt(i, m.makeTranslation(x, 3.5, z));
  });
  stem.castShadow = true;
  group.add(stem, head);

  // A stone landing where the bridge meets the shore.
  const landing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, BRIDGE.z1 - BRIDGE.z0 + 6), stone);
  landing.position.set(CITY_EAST_SHORE - 3, 0.04, 0);
  landing.receiveShadow = true;
  group.add(landing);
  return group;
}
