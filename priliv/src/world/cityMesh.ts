import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BLOCK_SIZE, LANE_WIDTH, ROAD_WIDTH, SIDEWALK, roadCoord, type CityLayout } from "./city";

function windowTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8e8e8";
  g.fillRect(0, 0, size, size);
  // 4x4 windows per tile (a tile is 3x3 metres in world space).
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = Math.random() < 0.25;
      g.fillStyle = lit ? "#fff3c4" : "#3a4657";
      g.fillRect(x * 32 + 6, y * 32 + 5, 20, 22);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(x * 32 + 6, y * 32 + 5, 8, 22);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Box with window UVs scaled so one texture tile is 3 metres; roof gets uv (0,0) to stay plain. */
function buildingBox(w: number, h: number, d: number, x: number, z: number, color: THREE.Color): THREE.BufferGeometry {
  const g = box(w, h, d, x, h / 2, z, color);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const scales: Array<[number, number]> = [
    [d / 3, h / 3],
    [d / 3, h / 3],
    [0, 0],
    [0, 0],
    [w / 3, h / 3],
    [w / 3, h / 3],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = scales[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
  }
  return g;
}

export interface CityMeshes {
  group: THREE.Group;
}

export function buildCityMeshes(layout: CityLayout): CityMeshes {
  const group = new THREE.Group();
  const n = layout.n;
  const outer = layout.half + ROAD_WIDTH / 2;

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(outer * 2 + 400, outer * 2 + 400), new THREE.MeshStandardMaterial({ color: 0x4f7a3c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  // Roads (asphalt) as one merged mesh.
  const asphalt = new THREE.Color(0x2c2f36);
  const roadGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= n; i++) {
    const c = roadCoord(n, i);
    roadGeos.push(box(outer * 2, 0.1, ROAD_WIDTH, 0, 0, c, asphalt));
    roadGeos.push(box(ROAD_WIDTH, 0.1, outer * 2, c, 0, 0, asphalt));
  }
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  roads.receiveShadow = true;
  group.add(roads);

  // Sidewalks and block pavement.
  const pave = new THREE.Color(0x9a9da3);
  const grass = new THREE.Color(0x5f9a48);
  const paveGeos: THREE.BufferGeometry[] = [];
  for (let bz = 0; bz < n; bz++) {
    for (let bx = 0; bx < n; bx++) {
      const cx = roadCoord(n, bx) + ROAD_WIDTH / 2 + BLOCK_SIZE / 2;
      const cz = roadCoord(n, bz) + ROAD_WIDTH / 2 + BLOCK_SIZE / 2;
      const s = BLOCK_SIZE + SIDEWALK * 2;
      paveGeos.push(box(s, 0.3, s, cx, 0.1, cz, pave));
      const hasBuilding = layout.buildings.some((b) => Math.abs(b.x - cx) < BLOCK_SIZE / 2 && Math.abs(b.z - cz) < BLOCK_SIZE / 2);
      if (!hasBuilding) paveGeos.push(box(BLOCK_SIZE - 2, 0.32, BLOCK_SIZE - 2, cx, 0.1, cz, grass));
    }
  }
  const pavement = new THREE.Mesh(mergeGeometries(paveGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  pavement.receiveShadow = true;
  group.add(pavement);

  // Lane markings and crosswalks.
  const white = new THREE.Color(0xe8e8e8);
  const yellow = new THREE.Color(0xe0c040);
  const markGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= n; i++) {
    const c = roadCoord(n, i);
    for (let j = 0; j < n; j++) {
      const a = roadCoord(n, j) + ROAD_WIDTH / 2;
      for (let s = 2; s < BLOCK_SIZE - 2; s += 6) {
        markGeos.push(box(3, 0.02, 0.15, a + s + 1.5, 0.12, c, yellow));
        markGeos.push(box(3, 0.02, 0.12, a + s + 1.5, 0.12, c - LANE_WIDTH, white));
        markGeos.push(box(3, 0.02, 0.12, a + s + 1.5, 0.12, c + LANE_WIDTH, white));
        markGeos.push(box(0.15, 0.02, 3, c, 0.12, a + s + 1.5, yellow));
        markGeos.push(box(0.12, 0.02, 3, c - LANE_WIDTH, 0.12, a + s + 1.5, white));
        markGeos.push(box(0.12, 0.02, 3, c + LANE_WIDTH, 0.12, a + s + 1.5, white));
      }
    }
  }
  for (const it of layout.intersections) {
    const w = ROAD_WIDTH - SIDEWALK * 2;
    for (let k = -4; k <= 4; k++) {
      const off = k * 1.1;
      // Four crosswalks around the intersection.
      markGeos.push(box(0.6, 0.02, 2.2, it.x + off, 0.12, it.z - w / 2 - 1.6, white));
      markGeos.push(box(0.6, 0.02, 2.2, it.x + off, 0.12, it.z + w / 2 + 1.6, white));
      markGeos.push(box(2.2, 0.02, 0.6, it.x - w / 2 - 1.6, 0.12, it.z + off, white));
      markGeos.push(box(2.2, 0.02, 0.6, it.x + w / 2 + 1.6, 0.12, it.z + off, white));
    }
  }
  const marks = new THREE.Mesh(mergeGeometries(markGeos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  group.add(marks);

  // Buildings.
  const bGeos: THREE.BufferGeometry[] = [];
  for (const b of layout.buildings) {
    const col = new THREE.Color(b.color);
    bGeos.push(buildingBox(b.w, b.h, b.d, b.x, b.z, col));
    // Roof parapet / rooftop box for variety.
    if (b.kind === "tower" || b.kind === "office") {
      bGeos.push(box(Math.min(b.w, b.d) * 0.35, 2.5, Math.min(b.w, b.d) * 0.35, b.x + b.w * 0.15, b.h + 1.25, b.z - b.d * 0.15, col.clone().multiplyScalar(0.8)));
    } else {
      bGeos.push(box(b.w + 0.6, 0.5, b.d + 0.6, b.x, b.h + 0.25, b.z, col.clone().multiplyScalar(0.6)));
    }
  }
  const buildings = new THREE.Mesh(
    mergeGeometries(bGeos),
    new THREE.MeshStandardMaterial({ vertexColors: true, map: windowTexture(), roughness: 0.75, metalness: 0.05 }),
  );
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  group.add(buildings);

  // Trees: instanced trunk + crown.
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6);
  const crownGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }), layout.trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9, flatShading: true }), layout.trees.length);
  const m = new THREE.Matrix4();
  const crownColor = new THREE.Color();
  layout.trees.forEach((t, i) => {
    m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, 1.1 * t.scale + 0.3, t.z);
    trunks.setMatrixAt(i, m);
    m.makeScale(t.scale, t.scale * 1.2, t.scale).setPosition(t.x, 3.6 * t.scale + 0.3, t.z);
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, crownColor.setHSL(0.3 + Math.random() * 0.06, 0.5, 0.32 + Math.random() * 0.12));
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  // Street lamps: instanced pole + arm + lamp head.
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(2.4, 0.14, 0.14);
  armGeo.translate(1.1, 7, 0);
  const headGeo = new THREE.BoxGeometry(0.9, 0.25, 0.4);
  headGeo.translate(2.1, 6.9, 0);
  const lampGeo = mergeGeometries([poleGeo, armGeo]);
  const poles = new THREE.InstancedMesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.6, metalness: 0.4 }), layout.lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffe9a0, emissiveIntensity: 0.6 }), layout.lamps.length);
  layout.lamps.forEach((l, i) => {
    m.makeRotationY(-l.rot).setPosition(l.x, 0.3, l.z);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  group.add(poles, heads);

  return { group };
}
