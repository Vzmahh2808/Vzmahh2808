import * as THREE from "three";
import type { CarSpec, CarState } from "./carPhysics";

export interface CarVisual {
  group: THREE.Group;
  /** Everything above the wheels; tilted and darkened to show damage. */
  shell: THREE.Group;
  baseColor: THREE.Color;
  lift: number;
  wheels: THREE.Mesh[];
  frontWheels: THREE.Object3D[];
  brake: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  body: THREE.MeshStandardMaterial;
}

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
wheelGeo.rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bb, roughness: 0.4, metalness: 0.6 });
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8);
hubGeo.rotateX(Math.PI / 2);
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.75 });

export function buildCarVisual(kind: string, spec: CarSpec, color: number): CarVisual {
  const g = new THREE.Group();
  const shell = new THREE.Group();
  g.add(shell);
  const L = spec.length;
  const W = spec.width;
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });

  const chassisH = kind === "van" ? 0.7 : 0.55;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(L, chassisH, W), body);
  chassis.position.y = 0.45 + chassisH / 2;
  chassis.castShadow = true;
  shell.add(chassis);

  // Cabin.
  let cabL = L * 0.5;
  let cabX = -L * 0.05;
  let cabH = 0.7;
  if (kind === "van") {
    cabL = L * 0.85;
    cabX = -L * 0.05;
    cabH = 0.9;
  } else if (kind === "pickup") {
    cabL = L * 0.35;
    cabX = L * 0.1;
  } else if (kind === "sport") {
    cabL = L * 0.42;
    cabH = 0.55;
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabL, cabH, W * 0.86), body);
  cabin.position.set(cabX, 0.45 + chassisH + cabH / 2, 0);
  cabin.castShadow = true;
  shell.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(cabL * 1.02, cabH * 0.55, W * 0.88), glassMat);
  glass.position.set(cabX, 0.45 + chassisH + cabH * 0.55, 0);
  shell.add(glass);
  if (kind === "pickup") {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(L * 0.45, 0.3, W * 0.9), dark);
    bed.position.set(-L * 0.25, 0.45 + chassisH + 0.15, 0);
    shell.add(bed);
  }

  // Bumpers.
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, W * 0.95), dark);
  bumper.position.set(L / 2, 0.5, 0);
  shell.add(bumper);
  const bumperR = bumper.clone();
  bumperR.position.x = -L / 2;
  shell.add(bumperR);

  // Lights.
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.4 });
  const brake = new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff2020, emissiveIntensity: 0.15 });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.4), head);
    hl.position.set(L / 2 + 0.02, 0.45 + chassisH * 0.7, s * (W / 2 - 0.35));
    shell.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.45), brake);
    tl.position.set(-L / 2 - 0.02, 0.45 + chassisH * 0.7, s * (W / 2 - 0.35));
    shell.add(tl);
  }

  // Wheels.
  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const axle = spec.wheelBase / 2;
  for (const [x, z] of [
    [axle, W / 2],
    [axle, -W / 2],
    [-axle, W / 2],
    [-axle, -W / 2],
  ]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, 0.36, z);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.castShadow = true;
    wheel.add(new THREE.Mesh(hubGeo, hubMat));
    pivot.add(wheel);
    g.add(pivot);
    wheels.push(wheel);
    if (x > 0) frontWheels.push(pivot);
  }

  return { group: g, shell, baseColor: new THREE.Color(color), lift: 0.05, wheels, frontWheels, brake, head, body };
}

const CHAR = new THREE.Color(0x1d1b1a);

export function syncCarVisual(v: CarVisual, c: CarState, braking: boolean, groundY: number, dt: number): void {
  v.lift += (groundY - v.lift) * Math.min(1, dt * 12);
  v.group.position.set(c.x, v.lift, c.z);
  v.group.rotation.y = -c.heading;
  for (const w of v.wheels) w.rotation.z = -c.wheelSpin;
  for (const f of v.frontWheels) f.rotation.y = -c.steer;
  const lightsOn = !c.wrecked;
  v.brake.emissiveIntensity = lightsOn ? (braking ? 1.4 : 0.15) : 0;
  v.head.emissiveIntensity = lightsOn ? 0.4 : 0;
  // Paint scorches toward charcoal as health drops; wrecks are fully burnt.
  const dmg = c.wrecked ? 1 : Math.min(1, (100 - c.health) / 100) * 0.55 + (c.burning ? 0.3 : 0);
  v.body.color.copy(v.baseColor).lerp(CHAR, dmg);
  v.body.roughness = 0.35 + dmg * 0.6;
  v.body.metalness = 0.3 * (1 - dmg);
  // Heavy damage sags the shell to one side.
  const sag = Math.max(0, (50 - c.health) / 50);
  v.shell.rotation.x = sag * 0.05;
  v.shell.rotation.z = sag * -0.03;
  v.shell.position.y = c.wrecked ? -0.18 : -sag * 0.08;
}
