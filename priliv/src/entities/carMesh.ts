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
  /** Police lightbar halves; absent on civilian cars. */
  sirenRed?: THREE.MeshStandardMaterial;
  sirenBlue?: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
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

  const beam = new THREE.Mesh(beamGeo, beamMaterial);
  beam.position.set(L / 2 + 6, 0.22, 0);
  beam.renderOrder = 1;
  g.add(beam);
  const visual: CarVisual = { group: g, shell, baseColor: new THREE.Color(color), lift: 0.05, wheels, frontWheels, brake, head, body, beam };
  if (kind === "taxi") {
    const roofY = 0.45 + chassisH + cabH;
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.26, W * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xfff4c2, emissive: 0xffd24a, emissiveIntensity: 0.9 }),
    );
    sign.position.set(cabX, roofY + 0.14, 0);
    shell.add(sign);
    const checkerMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const sq = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.02), checkerMat);
        sq.position.set(-L * 0.3 + i * 0.56, 0.45 + chassisH * (i % 2 ? 0.45 : 0.72), sgn * (W / 2 + 0.01));
        shell.add(sq);
      }
    }
  }
  if (kind === "police") {
    const roofY = 0.45 + chassisH + cabH;
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1b3a8a, roughness: 0.5 });
    for (const sgn of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.18, 0.02), stripeMat);
      stripe.position.set(0, 0.45 + chassisH * 0.55, sgn * (W / 2 + 0.01));
      shell.add(stripe);
    }
    const hood = new THREE.Mesh(new THREE.BoxGeometry(L * 0.28, 0.02, W * 0.9), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }));
    hood.position.set(L * 0.36, 0.45 + chassisH + 0.01, 0);
    shell.add(hood);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, W * 0.75), new THREE.MeshStandardMaterial({ color: 0x222428 }));
    base.position.set(cabX, roofY + 0.05, 0);
    shell.add(base);
    visual.sirenRed = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.1 });
    visual.sirenBlue = new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x2a5bff, emissiveIntensity: 0.1 });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, W * 0.34), visual.sirenRed);
    red.position.set(cabX, roofY + 0.18, -W * 0.19);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, W * 0.34), visual.sirenBlue);
    blue.position.set(cabX, roofY + 0.18, W * 0.19);
    shell.add(red, blue);
  }
  return visual;
}

const CHAR = new THREE.Color(0x1d1b1a);

function beamTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  // Elongated glow: bright near the bumper, fading ahead and to the sides.
  const grad = g.createRadialGradient(20, 64, 4, 20, 64, 240);
  grad.addColorStop(0, "rgba(255,246,220,0.95)");
  grad.addColorStop(0.5, "rgba(255,240,200,0.35)");
  grad.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 48);
  g.lineTo(256, 0);
  g.lineTo(256, 128);
  g.lineTo(0, 80);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shared by every car so one opacity change fades all headlight beams at dusk. */
export const beamMaterial = new THREE.MeshBasicMaterial({
  map: beamTexture(),
  transparent: true,
  opacity: 0,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const beamGeo = new THREE.PlaneGeometry(12, 6);
beamGeo.rotateX(-Math.PI / 2);

export function syncCarVisual(v: CarVisual, c: CarState, braking: boolean, groundY: number, dt: number): void {
  v.lift += (groundY - v.lift) * Math.min(1, dt * 12);
  v.group.position.set(c.x, v.lift, c.z);
  v.group.rotation.y = -c.heading;
  for (const w of v.wheels) w.rotation.z = -c.wheelSpin;
  for (const f of v.frontWheels) f.rotation.y = -c.steer;
  const lightsOn = !c.wrecked;
  const night = beamMaterial.opacity;
  v.brake.emissiveIntensity = lightsOn ? (braking ? 1.4 : 0.15 + night * 0.9) : 0;
  v.head.emissiveIntensity = lightsOn ? 0.4 + night * 2.6 : 0;
  v.beam.visible = lightsOn && night > 0.02;
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

/** Alternate the lightbar; `on` false leaves it dim. */
export function flashSiren(v: CarVisual, on: boolean, time: number): void {
  if (!v.sirenRed || !v.sirenBlue) return;
  if (!on) {
    v.sirenRed.emissiveIntensity = 0.1;
    v.sirenBlue.emissiveIntensity = 0.1;
    return;
  }
  const phase = Math.floor(time * 7) % 4;
  v.sirenRed.emissiveIntensity = phase < 2 ? 3 : 0.1;
  v.sirenBlue.emissiveIntensity = phase < 2 ? 0.1 : 3;
}
