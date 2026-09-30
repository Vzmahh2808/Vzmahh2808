import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ISLAND_TOP, PIER_TOP, RESORT, RESORT_PIERS, RESORT_ROADS, SOUTH_BRIDGE } from "./island";
import { resortEdgeStrips, resortStrip } from "./embankment";
import { buildStrip } from "./embankmentMesh";
import { box, colored, rectBox } from "./islandMesh";
import { resortBlocks, type ResortLayout } from "./resort";

const TOP = ISLAND_TOP;

/** Everything visible on the resort island; call once and add `group` to the scene. */
export function buildResortMeshes(resort: ResortLayout, lampHead: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const solid: THREE.BufferGeometry[] = [];

  // Island body: pale paving, with the roads laid over it.
  solid.push(rectBox(RESORT, -1.5, TOP - 0.01, 0xd8d1bf));
  for (const b of resortBlocks()) {
    const lawn = b.style === "villas" || b.style === "plaza";
    solid.push(box(b.x1 - b.x0, 0.03, b.z1 - b.z0, (b.x0 + b.x1) / 2, TOP + 0.005, (b.z0 + b.z1) / 2, lawn ? 0x5b9448 : 0xcbc3ae));
  }
  for (const r of RESORT_ROADS) solid.push(rectBox(r, TOP - 0.01, TOP + 0.02, 0x2c2f36));
  for (const r of RESORT_ROADS) {
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let s = 3; s < len - 3; s += 7) {
      if (alongX) solid.push(box(3.5, 0.02, 0.18, r.x0 + s, TOP + 0.04, (r.z0 + r.z1) / 2, 0xe0c040));
      else solid.push(box(0.18, 0.02, 3.5, (r.x0 + r.x1) / 2, TOP + 0.04, r.z0 + s, 0xe0c040));
    }
  }
  // Zebra crossings where the boulevard meets the streets.
  for (const zs of [490, 580, 650]) {
    for (const sgn of [-1, 1]) {
      for (let i = -3; i <= 3; i++) solid.push(box(0.7, 0.02, 3, i * 1.8, TOP + 0.04, zs + sgn * 8.2, 0xf2f2f2));
    }
  }

  // Plaza and forecourts: tiled circle round the fountain.
  const f = resort.fountain;
  solid.push(box(30, 0.03, 30, f.x, TOP + 0.03, f.z, 0xe9e3d2));

  // South bridge: deck, supports, portals and its side rails.
  const SB = SOUTH_BRIDGE;
  solid.push(rectBox(SB, -1.2, TOP, 0x5d626b));
  for (let z = SB.z0 + 6; z < SB.z1 - 4; z += 6) solid.push(box(0.16, 0.02, 3, 0, TOP + 0.02, z, 0xe0c040));
  for (let z = SB.z0 + 24; z < SB.z1; z += 30) solid.push(box(16, 4, 2, 0, -3, z, 0x4a4e55));
  for (const pz of [310, 380]) {
    for (const sx of [-8.5, 8.5]) solid.push(box(1.4, 14, 1.4, sx, 7, pz, 0xf5f6fa));
    solid.push(box(19, 1.2, 1.6, 0, 14, pz, 0xf5f6fa));
    solid.push(box(19, 0.6, 1.0, 0, 11.5, pz, 0x4fc3f7));
  }

  // Marina piers.
  for (const p of RESORT_PIERS) solid.push(rectBox(p, -0.2, PIER_TOP, 0x8d6e4c));
  // Steps of decking along the pier heads.
  for (const p of RESORT_PIERS) for (let z = p.z0 + 2; z < p.z1 - 1; z += 4) solid.push(box(p.x1 - p.x0 + 0.4, 0.06, 0.3, (p.x0 + p.x1) / 2, PIER_TOP + 0.03, z, 0x6d4f36));

  // Buildings and the bridge rails.
  const pool = 0x4fc3f7;
  for (const b of resort.colliders) {
    if (b.kind === "tower") {
      solid.push(box(b.w, b.h, b.d, b.x, TOP + b.h / 2, b.z, b.color));
      solid.push(box(b.w + 0.8, 0.8, b.d + 0.8, b.x, TOP + b.h + 0.4, b.z, 0xe9e4d8));
      solid.push(box(b.w * 0.45, 3, b.d * 0.45, b.x, TOP + b.h + 2.3, b.z, 0xcfc6b2));
      solid.push(box(b.w * 0.5, 0.05, b.d * 0.3, b.x, TOP + b.h + 0.85, b.z + b.d * 0.28, pool));
      // Window bands round all four sides, one per floor pair.
      for (let y = 4; y < b.h - 2; y += 3.6) {
        solid.push(box(b.w - 1.6, 1.6, b.d + 0.12, b.x, TOP + y, b.z, 0x3b5b73));
        solid.push(box(b.w + 0.12, 1.6, b.d - 1.6, b.x, TOP + y, b.z, 0x3b5b73));
      }
      // A canopy over the entrance.
      solid.push(box(8, 0.4, 4, b.x, TOP + 4.2, b.z + b.d / 2 + 2, 0xd63031));
      solid.push(box(0.4, 4, 0.4, b.x - 3.6, TOP + 2, b.z + b.d / 2 + 3.6, 0xf5f6fa));
      solid.push(box(0.4, 4, 0.4, b.x + 3.6, TOP + 2, b.z + b.d / 2 + 3.6, 0xf5f6fa));
    } else if (b.kind === "house") {
      solid.push(box(b.w, b.h, b.d, b.x, TOP + b.h / 2, b.z, b.color));
      const roof = new THREE.ConeGeometry(0.72, 1, 4);
      roof.rotateY(Math.PI / 4);
      roof.scale(b.w * 1.02, 3.4, b.d * 1.02);
      roof.translate(b.x, TOP + b.h + 1.7, b.z);
      solid.push(colored(roof, 0xc0623b));
      solid.push(box(1.6, 2.6, 0.2, b.x, TOP + 1.3, b.z + b.d / 2 + 0.05, 0x5d4037));
      for (const dx of [-b.w * 0.3, b.w * 0.3]) {
        solid.push(box(2, 1.6, 0.2, b.x + dx, TOP + b.h * 0.55, b.z + b.d / 2 + 0.05, 0x3b5b73));
        solid.push(box(2, 1.6, 0.2, b.x + dx, TOP + b.h * 0.55, b.z - b.d / 2 - 0.05, 0x3b5b73));
      }
      solid.push(box(b.w * 0.7, 0.05, 5, b.x, TOP + 0.06, b.z + b.d / 2 + 5, pool));
    } else if (b.kind === "shop") {
      solid.push(box(b.w, b.h, b.d, b.x, TOP + b.h / 2, b.z, b.color));
      solid.push(box(b.w + 0.4, 0.5, b.d + 0.4, b.x, TOP + b.h + 0.25, b.z, 0xf5f6fa));
      solid.push(box(b.w - 1.5, 2.2, 0.2, b.x, TOP + 1.8, b.z + b.d / 2 + 0.06, 0x3b5b73));
      solid.push(box(b.w - 1, 0.4, 1.6, b.x, TOP + 3.3, b.z + b.d / 2 + 0.8, 0xf5f6fa));
      solid.push(box(b.w - 1, 0.42, 0.7, b.x, TOP + 3.3, b.z + b.d / 2 + 1.1, b.color));
    } else if (b.kind === "rail" && Math.abs(Math.abs(b.x) - 7.4) < 0.3 && b.d > 100) {
      solid.push(box(b.w, b.h, b.d, b.x, TOP + b.h / 2, b.z, 0x9aa3ad));
    }
  }

  // Fountain: stone basin, water, a jet.
  solid.push(box(16, 1.2, 16, f.x, TOP + 0.6, f.z, 0xb0bec5));
  solid.push(box(14, 0.1, 14, f.x, TOP + 1.16, f.z, pool));
  solid.push(box(2.2, 2.6, 2.2, f.x, TOP + 1.9, f.z, 0xcfd8dc));
  solid.push(box(0.5, 2.2, 0.5, f.x, TOP + 4, f.z, 0xbbe9ff));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const mesh = new THREE.Mesh(mergeGeometries(solid), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Palms: one trunk mesh and one crown mesh, instanced.
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6);
  trunkGeo.translate(0, 2.8, 0);
  const crownGeo = new THREE.SphereGeometry(1.7, 7, 4);
  crownGeo.scale(1.5, 0.45, 1.5);
  crownGeo.translate(0, 5.8, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x8d6e4c, roughness: 0.9 }), resort.palms.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3f8f43, roughness: 0.85 }), resort.palms.length);
  const m = new THREE.Matrix4();
  resort.palms.forEach((p, i) => {
    m.makeScale(p.scale, p.scale, p.scale).setPosition(p.x, TOP, p.z);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  // Street lamps share the city lamp material so they light up with it.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6);
  poleGeo.translate(0, 3.2, 0);
  const headGeo = new THREE.BoxGeometry(0.8, 0.3, 0.8);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.7 }), resort.lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, lampHead, resort.lamps.length);
  resort.lamps.forEach((l, i) => {
    poles.setMatrixAt(i, m.makeTranslation(l.x, TOP, l.z));
    heads.setMatrixAt(i, m.makeTranslation(l.x, TOP + 6.4, l.z));
  });
  group.add(poles, heads);

  // Seafront promenade with benches and lamps, and bare railings round the island's other edges.
  const fronts = new THREE.Group();
  fronts.add(buildStrip(resortStrip(), { from: RESORT.x0, to: RESORT.x1 }, lampHead));
  for (const s of resortEdgeStrips()) fronts.add(buildStrip(s, { from: s.from, to: s.to }, lampHead));
  // The strips are drawn for ground at height 0; lift them onto the island's deck.
  fronts.position.y = TOP - 0.02;
  group.add(fronts);
  return group;
}
