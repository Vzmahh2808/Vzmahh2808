import * as THREE from "three";

/** Ring buffer of flat dark quads left behind by sliding tyres. */
export class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  added = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private max = 800) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0b0b0d, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Add a mark from (x0, z0) to (x1, z1) at height y. */
  add(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05 || len > 3) return;
    const ang = Math.atan2(z1 - z0, x1 - x0);
    this.q.setFromAxisAngle(this.up, -ang);
    this.s.set(len + 0.05, 1, 0.28);
    this.p.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.max;
    this.added++;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
