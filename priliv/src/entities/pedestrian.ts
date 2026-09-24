import * as THREE from "three";

export interface PedVisual {
  group: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  phase: number;
}

export function buildPedestrian(shirt: number, pants: number, skin = 0xe7b58d): PedVisual {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.26), shirtMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), new THREE.MeshStandardMaterial({ color: 0x2b1d12 }));
  hair.position.y = 1.78;
  g.add(hair);

  const mkLimb = (w: number, h: number, mat: THREE.Material, x: number, y: number) => {
    const pivot = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    pivot.geometry.translate(0, -h / 2, 0);
    pivot.position.set(x, y, 0);
    pivot.castShadow = true;
    g.add(pivot);
    return pivot;
  };
  const legL = mkLimb(0.16, 0.8, pantsMat, -0.11, 0.85);
  const legR = mkLimb(0.16, 0.8, pantsMat, 0.11, 0.85);
  const armL = mkLimb(0.12, 0.6, shirtMat, -0.3, 1.42);
  const armR = mkLimb(0.12, 0.6, shirtMat, 0.3, 1.42);
  return { group: g, legL, legR, armL, armR, phase: 0 };
}

export function animatePedestrian(p: PedVisual, speed: number, dt: number): void {
  p.phase += dt * Math.min(14, 4 + speed * 2.2);
  const amp = Math.min(0.9, speed * 0.18);
  const s = Math.sin(p.phase) * amp;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.8;
  p.armR.rotation.x = s * 0.8;
  p.group.position.y = Math.abs(Math.sin(p.phase)) * amp * 0.06;
}
