import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BRIDGE, CAPE, CITY_EAST_SHORE, ISLAND, ISLAND_ROADS, ISLAND_TOP, LIGHTHOUSE, PIER_TOP, WATER_LEVEL, type IslandLayout, type Rect } from "./island";

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, color);
}

function rectBox(r: Rect, y0: number, y1: number, color: number): THREE.BufferGeometry {
  return box(r.x1 - r.x0, y1 - y0, r.z1 - r.z0, (r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2, color);
}

function rippleTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const w = 6 + Math.random() * 18;
    g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.15})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface IslandMeshes {
  group: THREE.Group;
  /** Animate water and the lighthouse beam. */
  update(dt: number, sky: THREE.Color, night: number): void;
}

export function buildIslandMeshes(island: IslandLayout, lampHead: THREE.Material): IslandMeshes {
  const group = new THREE.Group();

  // Water east of the shore, and a sand strip where the city meets it.
  const ripple = rippleTexture();
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f4f6e, map: ripple, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.94 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2000), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CITY_EAST_SHORE + 700, WATER_LEVEL, 0);
  water.receiveShadow = true;
  group.add(water);

  const solid: THREE.BufferGeometry[] = [];
  solid.push(box(10, 0.3, 700, CITY_EAST_SHORE - 3, -0.1, 0, 0xd8c690));

  // Island ground, roads and markings.
  solid.push(rectBox(ISLAND, -1.5, ISLAND_TOP - 0.01, 0x676c73));
  solid.push(rectBox(CAPE, -1.5, ISLAND_TOP - 0.01, 0x7a7f86));
  for (const r of ISLAND_ROADS) solid.push(rectBox(r, ISLAND_TOP - 0.01, ISLAND_TOP + 0.01, 0x2c2f36));
  for (const r of ISLAND_ROADS) {
    const alongX = r.x1 - r.x0 > r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let s = 3; s < len - 3; s += 7) {
      if (alongX) solid.push(box(3.5, 0.02, 0.18, r.x0 + s, ISLAND_TOP + 0.02, (r.z0 + r.z1) / 2, 0xe0c040));
      else solid.push(box(0.18, 0.02, 3.5, (r.x0 + r.x1) / 2, ISLAND_TOP + 0.02, r.z0 + s, 0xe0c040));
    }
  }
  // Quay edge.
  solid.push(box(ISLAND.x1 - ISLAND.x0, 0.5, 0.6, (ISLAND.x0 + ISLAND.x1) / 2, ISLAND_TOP, ISLAND.z0, 0x3d4148));
  solid.push(box(ISLAND.x1 - ISLAND.x0, 0.5, 0.6, (ISLAND.x0 + ISLAND.x1) / 2, ISLAND_TOP, ISLAND.z1, 0x3d4148));

  // Bridge deck, pylons and cables.
  solid.push(rectBox(BRIDGE, -1.2, ISLAND_TOP, 0x5d626b));
  for (let x = BRIDGE.x0 + 4; x < BRIDGE.x1 - 4; x += 6) solid.push(box(3, 0.02, 0.16, x, ISLAND_TOP + 0.02, 0, 0xe0c040));
  for (let x = BRIDGE.x0 + 20; x < BRIDGE.x1; x += 30) {
    solid.push(box(2, 4, 16, x, -3, 0, 0x4a4e55)); // piers under the deck
  }
  for (const px of [290, 355]) {
    for (const sz of [-8.5, 8.5]) solid.push(box(1.6, 26, 1.6, px, 13, sz, 0xb03a2e));
    solid.push(box(1.4, 1.2, 18.6, px, 25, 0, 0xb03a2e));
    for (const sz of [-8.5, 8.5]) {
      for (const dir of [-1, 1]) {
        const cable = new THREE.BoxGeometry(0.12, 0.12, 34);
        cable.rotateX(Math.atan2(24, 30));
        cable.rotateY(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        cable.translate(px + dir * 15, 12.5, sz);
        solid.push(colored(cable, 0xdfe6e9));
      }
    }
  }

  // Rails and every other collider-backed structure.
  for (const b of island.colliders) {
    if (b.kind === "rail") solid.push(box(b.w, b.h, b.d, b.x, ISLAND_TOP + b.h / 2, b.z, 0x9aa3ad));
    if (b.kind === "warehouse") {
      solid.push(box(b.w, b.h, b.d, b.x, ISLAND_TOP + b.h / 2, b.z, b.color));
      solid.push(box(b.w + 0.6, 0.6, b.d + 0.6, b.x, ISLAND_TOP + b.h + 0.3, b.z, 0x4b5563));
      for (let i = -2; i <= 2; i++) solid.push(box(6, 5, 0.2, b.x + i * (b.w / 5), ISLAND_TOP + 2.5, b.z + b.d / 2 + 0.05, 0x2d3436));
    }
  }
  // Piers.
  for (const p of island.piers) solid.push(rectBox(p, -0.2, PIER_TOP, 0x8d6e4c));

  // Cranes: four legs, a beam and a cab.
  for (const c of island.cranes) {
    for (const dx of [-14, 14]) for (const dz of [-6, 6]) solid.push(box(1, 22, 1, c.x + dx, ISLAND_TOP + 11, c.z + dz, 0xf1c40f));
    solid.push(box(34, 1.6, 14, c.x, ISLAND_TOP + 22.5, c.z, 0xf1c40f));
    solid.push(box(4, 3, 4, c.x + 6, ISLAND_TOP + 20, c.z, 0xc0392b));
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const mesh = new THREE.Mesh(mergeGeometries(solid), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Containers as one instanced mesh.
  const cGeo = new THREE.BoxGeometry(12, 2.5, 2.4);
  cGeo.translate(0, 1.25, 0);
  const containers = new THREE.InstancedMesh(cGeo, new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }), island.containers.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  island.containers.forEach((c, i) => {
    m.makeRotationY(c.rot).setPosition(c.x, ISLAND_TOP + c.y + 0.05, c.z);
    containers.setMatrixAt(i, m);
    containers.setColorAt(i, col.setHex(c.color));
  });
  containers.castShadow = containers.receiveShadow = true;
  group.add(containers);

  // Bridge lamps share the city lamp material so they light up with it.
  const lampGeos: THREE.BufferGeometry[] = [];
  for (let x = BRIDGE.x0 + 10; x < BRIDGE.x1 - 5; x += 24) {
    for (const sz of [-7.6, 7.6]) {
      const g = new THREE.BoxGeometry(0.6, 0.3, 0.9);
      g.translate(x, ISLAND_TOP + 6.5, sz * 0.8);
      lampGeos.push(g);
      solid.push(box(0.2, 6.5, 0.2, x, ISLAND_TOP + 3.25, sz, 0x555a63));
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(lampGeos), lampHead));
  const poleGeos = solid.slice(solid.length - lampGeos.length);
  group.add(new THREE.Mesh(mergeGeometries(poleGeos), mat));

  // Lighthouse: striped tower, lantern and a sweeping beam.
  const tower = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(2.1 - i * 0.18, 2.3 - i * 0.18, 4, 16),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc0392b : 0xf5f6fa, roughness: 0.6 }),
    );
    seg.position.y = ISLAND_TOP + 2 + i * 4;
    seg.castShadow = true;
    tower.add(seg);
  }
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xfff6d5, emissive: 0xffe08a, emissiveIntensity: 0.4 });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 12), lanternMat);
  lantern.position.y = ISLAND_TOP + 25;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0x2d3436 }));
  cap.position.y = ISLAND_TOP + 26.9;
  tower.add(lantern, cap);
  const beamGeo = new THREE.ConeGeometry(6, 120, 20, 1, true);
  beamGeo.translate(0, -60, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const beam = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat);
  const b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  beam.position.y = ISLAND_TOP + 25;
  tower.add(beam);
  tower.position.set(LIGHTHOUSE.x, 0, LIGHTHOUSE.z);
  group.add(tower);

  const deep = new THREE.Color(0x1f4f6e);
  const tmp = new THREE.Color();
  return {
    group,
    update(dt, sky, night) {
      ripple.offset.x += dt * 0.004;
      ripple.offset.y += dt * 0.0025;
      waterMat.color.copy(tmp.copy(deep).lerp(sky, 0.3).multiplyScalar(1 - night * 0.6));
      // A little self-light keeps the water readable when the sun is low.
      waterMat.emissive.copy(tmp).multiplyScalar(0.28);
      beam.rotation.y += dt * 0.9;
      beamMat.opacity = night * 0.16;
      lanternMat.emissiveIntensity = 0.4 + night * 3;
    },
  };
}
