import * as THREE from "three";

/** Police helicopter: hovers over the target with a searchlight. Visual plus simple follow motion. */
export class Helicopter {
  readonly group = new THREE.Group();
  private rotor: THREE.Mesh;
  private tailRotor: THREE.Mesh;
  private light: THREE.SpotLight;
  private cone: THREE.Mesh;
  private beacon: THREE.MeshStandardMaterial;
  active = false;
  x = 0;
  z = 0;
  y = 60;
  private vx = 0;
  private vz = 0;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const body = new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.5, metalness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x86b8e8, roughness: 0.1, transparent: true, opacity: 0.7 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 1.8), body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.3, 1.82), white);
    stripe.position.y = -0.3;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.6), glass);
    nose.position.set(1.9, -0.1, 0);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 0.35), body);
    boom.position.set(-3.5, 0.25, 0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.12), body);
    fin.position.set(-5.4, 0.8, 0);
    for (const s of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 0.08), white);
      skid.position.set(0, -1.2, s * 0.8);
      this.group.add(skid);
    }
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    this.rotor.position.y = 1.05;
    this.tailRotor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    this.tailRotor.position.set(-5.4, 0.9, 0.12);
    this.beacon = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff2020, emissiveIntensity: 0 });
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.2), this.beacon);
    beacon.position.set(-1, -0.85, 0);
    this.group.add(cabin, stripe, nose, boom, fin, this.rotor, this.tailRotor, beacon);
    this.group.traverse((o) => (o.castShadow = true));

    this.light = new THREE.SpotLight(0xf4f7ff, 0, 140, 0.22, 0.55, 1.2);
    this.light.position.set(0, -1, 0);
    this.group.add(this.light);
    scene.add(this.light.target);
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    coneGeo.translate(0, -0.5, 0);
    this.cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    scene.add(this.cone);
    this.group.visible = false;
    this.cone.visible = false;
    scene.add(this.group);
  }

  /** Enter from the edge of view, well above the target. */
  arrive(tx: number, tz: number): void {
    this.active = true;
    this.x = tx + 120;
    this.z = tz - 80;
    this.y = 55;
    this.group.visible = true;
    this.cone.visible = true;
  }

  leave(): void {
    this.active = false;
  }

  /** Horizontal distance to a point. */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }

  update(dt: number, tx: number, tz: number): void {
    this.t += dt;
    this.rotor.rotation.y += dt * 28;
    this.tailRotor.rotation.z += dt * 40;
    this.beacon.emissiveIntensity = Math.sin(this.t * 6) > 0.6 ? 2.5 : 0;
    if (!this.group.visible) return;
    // Circle the target slowly; fly away and hide once no longer needed.
    let gx = tx + Math.cos(this.t * 0.25) * 18;
    let gz = tz + Math.sin(this.t * 0.25) * 18;
    let gy = 34;
    if (!this.active) {
      gx = this.x + 200;
      gz = this.z - 200;
      gy = 70;
    }
    const ax = (gx - this.x) * 1.2 - this.vx * 1.6;
    const az = (gz - this.z) * 1.2 - this.vz * 1.6;
    this.vx += ax * dt;
    this.vz += az * dt;
    const sp = Math.hypot(this.vx, this.vz);
    const max = 30;
    if (sp > max) {
      this.vx *= max / sp;
      this.vz *= max / sp;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += (gy - this.y) * Math.min(1, dt * 0.8);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = -Math.atan2(this.vz, this.vx);
    this.group.rotation.z = -Math.min(0.3, sp * 0.012);

    const lit = this.active;
    this.light.intensity = lit ? 3500 : 0;
    this.light.target.position.set(tx, 0, tz);
    this.cone.visible = lit;
    if (lit) {
      const dx = tx - this.x;
      const dz = tz - this.z;
      const len = Math.hypot(dx, dz, this.y);
      this.cone.position.set(this.x, this.y - 1, this.z);
      this.cone.scale.set(len * 0.22, len, len * 0.22);
      this.cone.lookAt(tx, 0, tz);
      this.cone.rotateX(-Math.PI / 2);
    }
    if (!this.active && Math.hypot(this.x - tx, this.z - tz) > 300) {
      this.group.visible = false;
      this.cone.visible = false;
    }
  }
}
