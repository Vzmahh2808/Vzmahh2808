import * as THREE from "three";

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  life: number;
  size0: number;
  size1: number;
  color: number;
  color1?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

const VERT = /* glsl */ `
attribute vec3 offset;
attribute float psize;
attribute vec3 pcolor;
attribute float palpha;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vUv = uv;
  vColor = pcolor;
  vAlpha = palpha;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  mv.xy += position.xy * psize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

/** Camera-facing soft particles in one draw call, backed by a fixed-size ring buffer. */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private max: number;
  private next = 0;
  private live = 0;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private offset: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private color: THREE.InstancedBufferAttribute;
  private alpha: THREE.InstancedBufferAttribute;
  private tmp0 = new THREE.Color();
  private tmp1 = new THREE.Color();

  constructor(max: number, additive: boolean) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.attributes.position);
    geo.setAttribute("uv", base.attributes.uv);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.offset, this.size, this.color, this.alpha]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("offset", this.offset);
    geo.setAttribute("psize", this.size);
    geo.setAttribute("pcolor", this.color);
    geo.setAttribute("palpha", this.alpha);
    geo.instanceCount = max;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    const f = () => new Float32Array(max);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = f();
    this.grav = f();
    this.drag = f();
  }

  get count(): number {
    return this.live;
  }

  emit(o: EmitOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const sp = o.spread ?? 0;
    this.px[i] = o.x;
    this.py[i] = o.y;
    this.pz[i] = o.z;
    this.vx[i] = (o.vx ?? 0) + (Math.random() - 0.5) * sp;
    this.vy[i] = (o.vy ?? 0) + (Math.random() - 0.5) * sp;
    this.vz[i] = (o.vz ?? 0) + (Math.random() - 0.5) * sp;
    this.age[i] = 0;
    this.life[i] = o.life * (0.75 + Math.random() * 0.5);
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.tmp0.setHex(o.color);
    this.tmp1.setHex(o.color1 ?? o.color);
    this.c0.set([this.tmp0.r, this.tmp0.g, this.tmp0.b], i * 3);
    this.c1.set([this.tmp1.r, this.tmp1.g, this.tmp1.b], i * 3);
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
  }

  update(dt: number): void {
    let live = 0;
    const off = this.offset.array as Float32Array;
    const size = this.size.array as Float32Array;
    const col = this.color.array as Float32Array;
    const alpha = this.alpha.array as Float32Array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      live++;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k - this.grav[i] * dt;
      this.vz[i] *= k;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.1) {
        this.py[i] = 0.1;
        this.vy[i] *= -0.3;
      }
      off[i * 3] = this.px[i];
      off[i * 3 + 1] = this.py[i];
      off[i * 3 + 2] = this.pz[i];
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let c = 0; c < 3; c++) col[i * 3 + c] = this.c0[i * 3 + c] + (this.c1[i * 3 + c] - this.c0[i * 3 + c]) * t;
      // Fade in quickly, fade out over the second half of life.
      alpha[i] = this.a0[i] * Math.min(1, t * 8) * Math.min(1, (1 - t) * 2);
    }
    this.live = live;
    this.offset.needsUpdate = true;
    this.size.needsUpdate = true;
    this.color.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
