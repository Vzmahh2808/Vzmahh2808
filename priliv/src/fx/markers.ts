import * as THREE from "three";

function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fillStyle = "rgba(10,12,18,0.85)";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = "bold 72px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Glowing ground ring with a floating badge, used for places and mission goals. */
export class ZoneMarker {
  readonly group = new THREE.Group();
  private wall: THREE.Mesh;
  private badge: THREE.Sprite;
  private t = Math.random() * 10;

  constructor(scene: THREE.Scene, color: number, label: string, radius = 4) {
    const css = "#" + color.toString(16).padStart(6, "0");
    const wallGeo = new THREE.CylinderGeometry(radius, radius, 2.2, 40, 1, true);
    wallGeo.translate(0, 1.1, 0);
    this.wall = new THREE.Mesh(
      wallGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.35, radius, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.32;
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, css), depthWrite: false }));
    this.badge.scale.set(2.2, 2.2, 1);
    this.badge.position.y = 4;
    this.group.add(this.wall, ring, this.badge);
    this.group.renderOrder = 4;
    this.group.visible = false;
    scene.add(this.group);
  }

  /** `y` lifts the marker onto raised ground such as a pier deck. */
  show(x: number, z: number, y = 0): void {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    this.badge.position.y = 4 + Math.sin(this.t * 2.2) * 0.35;
    (this.wall.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(this.t * 3) * 0.08;
  }
}

/** Tall light beam for race checkpoints, visible from far away. */
export class BeamMarker {
  readonly group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, color: number, radius = 8) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const geo = new THREE.CylinderGeometry(radius, radius, 60, 40, 1, true);
    geo.translate(0, 30, 0);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.5, radius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.32;
    this.group.add(new THREE.Mesh(geo, this.mat), ring);
    this.group.visible = false;
    scene.add(this.group);
  }

  show(x: number, z: number, strong: boolean): void {
    this.group.position.set(x, 0, z);
    this.mat.opacity = strong ? 0.25 : 0.08;
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}

/** Bobbing arrow above a mission vehicle. */
export class TargetArrow {
  readonly mesh: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.ConeGeometry(0.7, 1.4, 4);
    geo.rotateX(Math.PI);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7bed9f }));
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  show(x: number, z: number, color: number, dt: number): void {
    this.t += dt;
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.mesh.position.set(x, 4 + Math.sin(this.t * 3) * 0.4, z);
    this.mesh.rotation.y += dt * 2;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
