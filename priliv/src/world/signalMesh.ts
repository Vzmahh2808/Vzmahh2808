import * as THREE from "three";
import type { CityLayout } from "./city";
import { SIGNAL_OFFSET, lightFor, type Axis, type Light } from "./signals";

const POLE_HEIGHT = 4.2;
const HEAD_Y = 3.9;

/** Corner poles: which axis each shows, and which way its lamps face. */
const CORNERS: Array<{ sx: number; sz: number; axis: Axis; fx: number; fz: number }> = [
  { sx: -1, sz: 1, axis: "x", fx: -1, fz: 0 },
  { sx: 1, sz: -1, axis: "x", fx: 1, fz: 0 },
  { sx: -1, sz: -1, axis: "z", fx: 0, fz: -1 },
  { sx: 1, sz: 1, axis: "z", fx: 0, fz: 1 },
];

const COLORS: Record<Light, [number, number, number]> = {
  red: [0xff3b30, 0x2a2426, 0x1e2a22],
  yellow: [0x3a2b26, 0xffcc00, 0x1e2a22],
  green: [0x3a2b26, 0x2a2a24, 0x2ee66b],
};

/** Traffic lights on all four corners of every intersection, drawn with three instanced meshes. */
export class SignalMesh {
  readonly group = new THREE.Group();
  private lamps: THREE.InstancedMesh;
  private last: string[];
  private layout: CityLayout;
  private tmp = new THREE.Color();

  constructor(layout: CityLayout) {
    this.layout = layout;
    const count = layout.intersections.length * CORNERS.length;
    this.last = new Array(layout.intersections.length).fill("");
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, POLE_HEIGHT, 6), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.7 }), count);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 1.15, 0.44), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 }), count);
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), new THREE.MeshBasicMaterial({ color: 0xffffff }), count * 3);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const it of layout.intersections) {
      for (const c of CORNERS) {
        const x = it.x + c.sx * SIGNAL_OFFSET;
        const z = it.z + c.sz * SIGNAL_OFFSET;
        poles.setMatrixAt(i, m.makeTranslation(x, POLE_HEIGHT / 2, z));
        heads.setMatrixAt(i, m.makeTranslation(x, HEAD_Y, z));
        for (let l = 0; l < 3; l++) {
          this.lamps.setMatrixAt(i * 3 + l, m.makeTranslation(x + c.fx * 0.2, HEAD_Y + (1 - l) * 0.36, z + c.fz * 0.2));
        }
        i++;
      }
    }
    for (const mesh of [poles, heads, this.lamps]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    poles.castShadow = true;
    this.update(0);
  }

  /** Recolour the lamps whose state changed since the last call. */
  update(time: number): void {
    const its = this.layout.intersections;
    let dirty = false;
    for (let k = 0; k < its.length; k++) {
      const it = its[k];
      const lx = lightFor("x", time, it.ix, it.iz);
      const lz = lightFor("z", time, it.ix, it.iz);
      const key = lx + lz;
      if (this.last[k] === key) continue;
      this.last[k] = key;
      dirty = true;
      CORNERS.forEach((c, ci) => {
        const cols = COLORS[c.axis === "x" ? lx : lz];
        const base = (k * CORNERS.length + ci) * 3;
        for (let l = 0; l < 3; l++) this.lamps.setColorAt(base + l, this.tmp.setHex(cols[l]));
      });
    }
    if (dirty && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
