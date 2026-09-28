import * as THREE from "three";
import type { Ramp } from "../entities/jumps";

/** Yellow and black warning stripes across the ramp. */
function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f6c90e";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#1e1e24";
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - 64, 64);
    g.lineTo(i - 64, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A wedge in the ramp's own frame: +x climbs from 0 to `height` over `length`. */
function wedge(r: Ramp): THREE.BufferGeometry {
  const L = r.length;
  const W = r.width / 2;
  const H = r.height;
  // Top slope, the tall back face and the two sides.
  const p = [
    // slope
    [0, 0, -W], [L, H, -W], [L, H, W],
    [0, 0, -W], [L, H, W], [0, 0, W],
    // back
    [L, 0, -W], [L, 0, W], [L, H, W],
    [L, 0, -W], [L, H, W], [L, H, -W],
    // sides
    [0, 0, -W], [L, 0, -W], [L, H, -W],
    [0, 0, W], [L, H, W], [L, 0, W],
  ];
  const uv = [
    [0, 0], [L / 3, 0], [L / 3, r.width / 3],
    [0, 0], [L / 3, r.width / 3], [0, r.width / 3],
    [0, 0], [1, 0], [1, 1],
    [0, 0], [1, 1], [0, 1],
    [0, 0], [1, 0], [1, 1],
    [0, 0], [1, 1], [1, 0],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p.flat(), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv.flat(), 2));
  g.computeVertexNormals();
  return g;
}

export function buildRamps(ramps: Ramp[], groundAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const slopeMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7, side: THREE.DoubleSide });
  for (const r of ramps) {
    const m = new THREE.Mesh(wedge(r), slopeMat);
    m.position.set(r.x, groundAt(r.x, r.z), r.z);
    m.rotation.y = -r.heading;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
