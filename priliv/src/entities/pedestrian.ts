import * as THREE from "three";

export interface PedVisual {
  group: THREE.Group;
  body: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  phase: number;
}

const torsoGeo = new THREE.BoxGeometry(0.42, 0.6, 0.26);
const headGeo = new THREE.BoxGeometry(0.26, 0.28, 0.26);
const hairGeo = new THREE.BoxGeometry(0.28, 0.1, 0.28);
const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.16);
legGeo.translate(0, -0.4, 0);
const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
armGeo.translate(0, -0.3, 0);

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number): THREE.MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    matCache.set(color, m);
  }
  return m;
}

export const SHIRTS = [0x2e86de, 0xd64545, 0x44bd32, 0xfbc531, 0x8c7ae6, 0xf5f6fa, 0x2d3436, 0xe67e22, 0x16a085, 0xe84393];
export const PANTS = [0x2d3436, 0x273c75, 0x636e72, 0x6d4c41, 0x1e272e, 0x3d3d3d];
export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa0663f];
export const HAIR = [0x2b1d12, 0x111111, 0x6b4a2b, 0xd6b370, 0x8a8a8a];

export function buildPedestrian(shirt: number, pants: number, skin = 0xe7b58d, hair = 0x2b1d12): PedVisual {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, 0);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  add(torsoGeo, shirt, 0, 1.15);
  add(headGeo, skin, 0, 1.62);
  add(hairGeo, hair, 0, 1.78);
  const legL = add(legGeo, pants, -0.11, 0.85);
  const legR = add(legGeo, pants, 0.11, 0.85);
  const armL = add(armGeo, shirt, -0.3, 1.42);
  const armR = add(armGeo, shirt, 0.3, 1.42);
  return { group: g, body, legL, legR, armL, armR, phase: Math.random() * 6 };
}

export function animatePedestrian(p: PedVisual, speed: number, dt: number, fall = 0): void {
  p.phase += dt * Math.min(14, 4 + speed * 2.2);
  const amp = Math.min(0.9, speed * 0.18) * (1 - fall);
  const s = Math.sin(p.phase) * amp;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8 - fall * 2.4;
  p.armR.rotation.x = s * 0.8 - fall * 2.4;
  p.body.position.y = Math.abs(Math.sin(p.phase)) * amp * 0.06 + fall * 0.15;
  // Falling tips the whole body backwards around the feet.
  p.body.rotation.x = -fall * Math.PI * 0.48;
}
