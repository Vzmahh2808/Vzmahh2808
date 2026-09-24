import * as THREE from "three";

/** Rain streaks in a box that follows the camera; one draw call. */
export class Rain {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private speed: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private readonly box = { x: 50, y: 30, z: 50 };

  constructor(scene: THREE.Scene, private count = 2500) {
    this.pos = new Float32Array(count * 6);
    this.speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * this.box.x;
      const y = Math.random() * this.box.y;
      const z = (Math.random() - 0.5) * this.box.z;
      this.pos.set([x, y, z, x, y - 0.7, z], i * 6);
      this.speed[i] = 22 + Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: 0xb8cce6, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  update(dt: number, intensity: number, cx: number, cy: number, cz: number): void {
    const n = Math.floor(this.count * Math.min(1, intensity));
    this.lines.visible = n > 0;
    if (!n) return;
    this.mat.opacity = 0.25 + 0.3 * intensity;
    this.lines.geometry.setDrawRange(0, n * 2);
    this.lines.position.set(cx, cy - 12, cz);
    const wind = 0.12;
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      const dy = this.speed[i] * dt;
      this.pos[o + 1] -= dy;
      this.pos[o + 4] -= dy;
      this.pos[o] += dy * wind;
      this.pos[o + 3] += dy * wind;
      if (this.pos[o + 1] < 0) {
        const x = (Math.random() - 0.5) * this.box.x;
        const z = (Math.random() - 0.5) * this.box.z;
        this.pos.set([x, this.box.y, z, x - 0.08, this.box.y - 0.7, z], o);
      }
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
