import * as THREE from "three";
import { Rng } from "./core/rng";
import { Input } from "./core/input";
import { clampToCity, generateCity, isOnCarriageway, resolveCircleVsBuildings, surfaceHeight } from "./world/city";
import { buildCityMeshes } from "./world/cityMesh";
import { buildWalkGraph } from "./world/sidewalks";
import { CAR_SPECS, collideCar, forwardSpeed, lateralSpeed, makeCar, separateCars, speedOf, stepCar, type CarInput, type CarState } from "./entities/carPhysics";
import { applyBlastToCar, blastDamage, conditionOf, stepDamage } from "./entities/damage";
import { buildCarVisual, syncCarVisual, type CarVisual } from "./entities/carMesh";
import { animatePedestrian, buildPedestrian, HAIR, PANTS, SHIRTS, SKINS, type PedVisual } from "./entities/pedestrian";
import { knockPed, rejoinNetwork, scare, spawnPeds, stepPed, type Ped, type Threat } from "./entities/peds";
import { driveTraffic, spawnTraffic, type Obstacle, type TrafficCar } from "./entities/traffic";
import { ParticleSystem } from "./fx/particles";
import { SkidMarks } from "./fx/skids";
import { Minimap } from "./ui/minimap";
import { CarAudio } from "./audio/engine";

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ---------------------------------------------------------------- renderer & scene

const canvas = $<HTMLCanvasElement>("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc7ec);
scene.fog = new THREE.Fog(0x9cc7ec, 120, 420);

const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 1200);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4f5a3a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 90;
sun.shadow.camera.left = -SH;
sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH;
sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const flash = new THREE.PointLight(0xffa24a, 0, 70, 1.6);
scene.add(flash);

// ---------------------------------------------------------------- world

const seed = 20260924;
const rng = new Rng(seed);
const layout = generateCity(rng, 8);
scene.add(buildCityMeshes(layout).group);
const walkGraph = buildWalkGraph(layout);
const ground = (x: number, z: number) => surfaceHeight(layout.n, x, z);

const smoke = new ParticleSystem(2500, false);
const fire = new ParticleSystem(2000, true);
const skids = new SkidMarks(900);
scene.add(skids.mesh, smoke.mesh, fire.mesh);

const COLORS = [0xd64545, 0x2e86de, 0xf5f6fa, 0x2d3436, 0xfbc531, 0x44bd32, 0x8c7ae6, 0xe67e22, 0x7f8fa6, 0x16a085];

interface Vehicle {
  state: CarState;
  kind: string;
  visual: CarVisual;
  input: CarInput;
  ai: TrafficCar | null;
  radius: number;
  wreckAge: number;
  rearPrev: [number, number, number, number] | null;
}

const vehicles: Vehicle[] = [];

function addVehicle(state: CarState, kind: string, color: number, ai: TrafficCar | null): Vehicle {
  const spec = CAR_SPECS[kind];
  const visual = buildCarVisual(kind, spec, color);
  scene.add(visual.group);
  const v: Vehicle = {
    state,
    kind,
    visual,
    input: ai ? ai.input : { throttle: 0, steer: 0, brake: false, handbrake: false },
    ai,
    radius: spec.length * 0.42,
    wreckAge: 0,
    rearPrev: null,
  };
  vehicles.push(v);
  return v;
}

/** Turn a long-dead wreck back into a fresh traffic car so the city keeps moving. */
function recycleAsTraffic(v: Vehicle): void {
  const fresh = spawnTraffic(rng, layout, 1, COLORS)[0];
  if (!fresh) return;
  scene.remove(v.visual.group);
  const spec = CAR_SPECS[fresh.kind];
  v.state = fresh.state;
  v.kind = fresh.kind;
  v.ai = fresh;
  v.input = fresh.input;
  v.radius = spec.length * 0.42;
  v.visual = buildCarVisual(fresh.kind, spec, fresh.color);
  v.wreckAge = 0;
  v.rearPrev = null;
  scene.add(v.visual.group);
}

for (const p of layout.parking) {
  if (rng.chance(0.6)) continue;
  const kind = rng.pick(Object.keys(CAR_SPECS));
  addVehicle(makeCar(p.x, p.z, p.rot), kind, rng.pick(COLORS), null);
}
for (const t of spawnTraffic(rng, layout, 45, COLORS)) addVehicle(t.state, t.kind, t.color, t);

// ---------------------------------------------------------------- pedestrians

const PED_COUNT = 80;
const peds: Ped[] = spawnPeds(rng, walkGraph, PED_COUNT);
const pedVisuals: PedVisual[] = peds.map(() => {
  const v = buildPedestrian(rng.pick(SHIRTS), rng.pick(PANTS), rng.pick(SKINS), rng.pick(HAIR));
  // Crowd shadows cost a draw call each; only the player casts one.
  v.group.traverse((o) => (o.castShadow = false));
  scene.add(v.group);
  return v;
});
const PED_NEAR = 35;
const PED_FAR = 120;
const PED_RECYCLE = 135;

/** Pull a ped from the pool (a gone one, else the farthest) and drop it at (x, z) running from `from`. */
function emergePed(x: number, z: number, from: { x: number; z: number }): void {
  let pick = peds.find((p) => p.state === "gone");
  if (!pick) {
    pick = peds.reduce((a, b) => (Math.hypot(a.x - player.x, a.z - player.z) > Math.hypot(b.x - player.x, b.z - player.z) ? a : b));
  }
  pick.x = x;
  pick.z = z;
  pick.y = 0;
  pick.vx = pick.vy = pick.vz = 0;
  pick.fall = 0;
  pick.state = "walk";
  pick.timer = 0;
  scare(pick, from, 5);
}

/** Respawn gone or far-away peds on the network in a ring around the player, so the crowd follows you. */
function recyclePeds(budget: number, minD = PED_NEAR): void {
  for (const p of peds) {
    if (budget <= 0) return;
    const far = Math.hypot(p.x - player.x, p.z - player.z) > PED_RECYCLE;
    if (p.state !== "gone" && !far) continue;
    for (let tries = 0; tries < 12; tries++) {
      const n = rng.int(0, walkGraph.nodes.length - 1);
      const node = walkGraph.nodes[n];
      const d = Math.hypot(node.x - player.x, node.z - player.z);
      if (d < minD || d > PED_FAR) continue;
      p.x = node.x;
      p.z = node.z;
      p.y = 0;
      p.vx = p.vy = p.vz = 0;
      p.fall = 0;
      p.state = "walk";
      p.speed = 0;
      // Start somewhere along an edge rather than exactly on the corner.
      const nb = walkGraph.nodes[rng.pick(walkGraph.edges[n])];
      const t = rng.next();
      p.x = node.x + (nb.x - node.x) * t;
      p.z = node.z + (nb.z - node.z) * t;
      rejoinNetwork(p, walkGraph, rng);
      budget--;
      break;
    }
  }
}

// ---------------------------------------------------------------- player

const playerVis = buildPedestrian(0x2e86de, 0x2d3436);
scene.add(playerVis.group);
const player = { x: 0, z: 0, heading: 0, speed: 0, vehicle: null as Vehicle | null, health: 100, dead: 0 };

function placeAtStart(): void {
  const parked = vehicles
    .filter((v) => !v.ai && !v.state.wrecked && !v.state.burning)
    .sort((a, b) => Math.hypot(a.state.x, a.state.z) - Math.hypot(b.state.x, b.state.z))[0];
  player.x = parked ? parked.state.x + 3 : 0;
  player.z = parked ? parked.state.z + 2.5 : 0;
  player.heading = parked ? parked.state.heading : 0;
}
placeAtStart();
// Fill the streets around the starting point right away.
recyclePeds(PED_COUNT, 6);

// ---------------------------------------------------------------- HUD, input, audio

const input = new Input();
const audio = new CarAudio();
const minimap = new Minimap($<HTMLCanvasElement>("#minimap"), layout);
const speedEl = $("#speed .num");
const hintEl = $("#hint");
const healthEl = $<HTMLDivElement>("#health .fill");
const carHpEl = $<HTMLDivElement>("#carhp .fill");
const carHpWrap = $<HTMLDivElement>("#carhp");
const statsEl = $("#stats");
const deathEl = $<HTMLDivElement>("#death");
let cameraMode = 0;
let started = false;
let paused = true;
let shake = 0;

$("#btn-start").addEventListener("click", () => {
  $("#start").classList.add("hidden");
  audio.unlock();
  started = true;
  paused = false;
});
window.addEventListener("keydown", () => audio.unlock());

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- helpers

const camPos = new THREE.Vector3(player.x - 8, 6, player.z);
const camLook = new THREE.Vector3(player.x, 1, player.z);

function nearestEnterable(): Vehicle | null {
  let best: Vehicle | null = null;
  let bestD = 4.5;
  for (const v of vehicles) {
    if (v.state.wrecked) continue;
    const d = Math.hypot(v.state.x - player.x, v.state.z - player.z);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function sideDoor(s: CarState, dist: number): { x: number; z: number } {
  return { x: s.x + Math.cos(s.heading - Math.PI / 2) * dist, z: s.z + Math.sin(s.heading - Math.PI / 2) * dist };
}

function enterVehicle(v: Vehicle): void {
  player.vehicle = v;
  if (v.ai) {
    // Carjack: the driver is thrown out and runs away.
    const door = sideDoor(v.state, 2.2);
    emergePed(door.x, door.z, { x: player.x, z: player.z });
    v.ai = null;
    v.input = { throttle: 0, steer: 0, brake: false, handbrake: false };
  }
  playerVis.group.visible = false;
}

function exitVehicle(): void {
  const v = player.vehicle;
  if (!v) return;
  const door = sideDoor(v.state, 2.2);
  player.x = door.x;
  player.z = door.z;
  player.heading = v.state.heading;
  player.vehicle = null;
  v.input = { throttle: 0, steer: 0, brake: false, handbrake: true };
  playerVis.group.visible = true;
}

function obstaclesFor(self: Vehicle): Obstacle[] {
  const list: Obstacle[] = [];
  for (const v of vehicles) {
    if (v === self) continue;
    const dx = v.state.x - self.state.x;
    const dz = v.state.z - self.state.z;
    if (dx * dx + dz * dz > 30 * 30) continue;
    list.push({ x: v.state.x, z: v.state.z, r: v.radius, vx: v.state.vx, vz: v.state.vz });
  }
  for (const p of peds) {
    if (p.state === "gone" || p.state === "down") continue;
    const dx = p.x - self.state.x;
    const dz = p.z - self.state.z;
    if (dx * dx + dz * dz > 25 * 25) continue;
    list.push({ x: p.x, z: p.z, r: 0.5, vx: 0, vz: 0 });
  }
  if (!player.vehicle && !player.dead) list.push({ x: player.x, z: player.z, r: 0.6, vx: 0, vz: 0 });
  return list;
}

function killPlayer(): void {
  if (player.dead > 0) return;
  player.dead = 3.5;
  player.health = 0;
  deathEl.classList.add("show");
}

function respawnPlayer(): void {
  player.dead = 0;
  player.health = 100;
  player.vehicle = null;
  player.speed = 0;
  playerVis.group.visible = true;
  placeAtStart();
  camPos.set(player.x - 6, 4, player.z);
  deathEl.classList.remove("show");
}

function explode(x: number, z: number, source: Vehicle | null): void {
  const dPlayer = Math.hypot(x - player.x, z - player.z);
  audio.explosion(dPlayer);
  shake = Math.max(shake, 1.4 * Math.max(0, 1 - dPlayer / 90));
  flash.position.set(x, 3, z);
  flash.intensity = 1200;
  for (let i = 0; i < 45; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 4 + Math.random() * 9;
    fire.emit({ x, y: 1.2, z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 9, vz: Math.sin(a) * sp, life: 0.9, size0: 1.8, size1: 4, color: 0xffd98a, color1: 0xc42a00, alpha: 0.55, drag: 2.5, gravity: -1 });
  }
  for (let i = 0; i < 45; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 5;
    smoke.emit({ x, y: 1.5, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 5, vz: Math.sin(a) * sp, life: 4, size0: 3, size1: 9, color: 0x2a2624, color1: 0x5a5856, alpha: 0.85, drag: 0.8, gravity: -0.6 });
  }
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 8 + Math.random() * 14;
    fire.emit({ x, y: 1, z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 10, vz: Math.sin(a) * sp, life: 1.1, size0: 0.35, size1: 0.1, color: 0xffd27a, color1: 0xff5a00, gravity: 18, drag: 0.4 });
  }
  if (source) {
    source.state.vx *= 0.3;
    source.state.vz *= 0.3;
  }
  for (const v of vehicles) {
    if (v === source) continue;
    if (applyBlastToCar(v.state, x, z) > 0 && v.ai) v.ai.stunned = Math.max(v.ai.stunned, 3);
  }
  for (const p of peds) {
    if (p.state === "gone") continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 11) knockPed(p, (dx / (d || 1)) * (16 - d), (dz / (d || 1)) * (16 - d));
    else if (d < 40) scare(p, { x, z }, 6);
  }
  if (source && source === player.vehicle) killPlayer();
  else if (!player.vehicle) {
    player.health -= blastDamage(dPlayer, 11, 95);
    if (player.health <= 0) killPlayer();
  }
}

// ---------------------------------------------------------------- simulation

let lastCrash = 0;
let recycleTimer = 0;

function update(dt: number, now: number): void {
  if (input.justPressed("KeyC")) cameraMode = (cameraMode + 1) % 2;
  if (input.justPressed("KeyM")) audio.muted = !audio.muted;

  const threats: Threat[] = [];

  if (player.dead > 0) {
    player.dead -= dt;
    if (player.dead <= 0) respawnPlayer();
  } else if (player.vehicle) {
    const v = player.vehicle;
    v.input.throttle = input.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    v.input.steer = input.axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    v.input.handbrake = input.isDown("Space");
    v.input.brake = false;
    if (input.isDown("KeyH")) threats.push({ x: v.state.x, z: v.state.z, radius: 14 });
    if (v.state.burning) {
      player.health -= dt * 6;
      if (player.health <= 0) killPlayer();
    }
    if (input.justPressed("KeyE", "KeyF") && speedOf(v.state) < 6) exitVehicle();
  } else {
    const run = input.isDown("ShiftLeft", "ShiftRight");
    const fwd = input.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    const turn = input.axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    const camYaw = Math.atan2(camLook.z - camPos.z, camLook.x - camPos.x);
    let mx = 0;
    let mz = 0;
    if (fwd || turn) {
      const ang = camYaw + Math.atan2(turn, fwd);
      mx = Math.cos(ang);
      mz = Math.sin(ang);
      let d = ang - player.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      player.heading += d * Math.min(1, dt * 12);
    }
    const targetSpeed = fwd || turn ? (run ? 7.5 : 3.2) : 0;
    player.speed += (targetSpeed - player.speed) * Math.min(1, dt * 10);
    player.x += mx * player.speed * dt;
    player.z += mz * player.speed * dt;
    const push = resolveCircleVsBuildings(layout, player.x, player.z, 0.4);
    if (push) {
      player.x += push.x;
      player.z += push.z;
    }
    const cl = clampToCity(layout, player.x, player.z);
    player.x = cl.x;
    player.z = cl.z;
    for (const v of vehicles) {
      const dx = player.x - v.state.x;
      const dz = player.z - v.state.z;
      const d = Math.hypot(dx, dz);
      const min = v.radius * 0.8 + 0.4;
      if (d < min && d > 0) {
        player.x += (dx / d) * (min - d);
        player.z += (dz / d) * (min - d);
        const sp = speedOf(v.state);
        if (sp > 5) {
          player.health -= sp * 0.6 * dt * 10;
          if (player.health <= 0) killPlayer();
        }
      }
    }
    const near = nearestEnterable();
    if (near && input.justPressed("KeyE", "KeyF")) enterVehicle(near);
  }

  // Vehicles.
  for (const v of vehicles) {
    const s = v.state;
    if (s.burning && v.ai) {
      // The driver bails out of a burning car.
      const door = sideDoor(s, 2.2);
      emergePed(door.x, door.z, s);
      v.ai = null;
      v.input = { throttle: 0, steer: 0, brake: true, handbrake: true };
    }
    if (s.wrecked) {
      v.input.throttle = 0;
      v.input.steer = 0;
      v.input.handbrake = true;
      v.wreckAge += dt;
    }
    if (v.ai) driveTraffic(v.ai, layout, rng, obstaclesFor(v), dt);
    stepCar(s, CAR_SPECS[v.kind], v.input, dt);
    const push = resolveCircleVsBuildings(layout, s.x, s.z, v.radius * 0.85);
    if (push) {
      const dmg = collideCar(s, push.x, push.z);
      if (v === player.vehicle && dmg > 2 && now - lastCrash > 250) {
        audio.crash(dmg);
        shake = Math.max(shake, Math.min(0.8, dmg * 0.03));
        lastCrash = now;
      }
      if (v.ai) v.ai.stunned = Math.max(v.ai.stunned, 1.5);
    }
    const cl = clampToCity(layout, s.x, s.z);
    if (cl.x !== s.x || cl.z !== s.z) collideCar(s, cl.x - s.x, cl.z - s.z);

    const sp = speedOf(s);
    // Fast cars scare people: the player's car always, others when they mount the sidewalk.
    if (sp > 8 && (v === player.vehicle || !isOnCarriageway(layout.n, s.x, s.z))) {
      threats.push({ x: s.x + s.vx * 0.5, z: s.z + s.vz * 0.5, radius: 7 });
    }
    if (s.burning) threats.push({ x: s.x, z: s.z, radius: 12 });

    const ev = stepDamage(s, dt);
    if (ev === "ignite" && Math.hypot(s.x - player.x, s.z - player.z) < 60) audio.ignite();
    if (ev === "explode") explode(s.x, s.z, v);
  }

  // Car-to-car collisions.
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const dx = a.state.x - b.state.x;
      const dz = a.state.z - b.state.z;
      if (dx * dx + dz * dz > 36) continue;
      const before = speedOf(a.state) + speedOf(b.state);
      if (separateCars(a.state, b.state, a.radius, b.radius)) {
        const after = speedOf(a.state) + speedOf(b.state);
        if ((a === player.vehicle || b === player.vehicle) && before - after > 3 && now - lastCrash > 250) {
          audio.crash(before - after);
          shake = Math.max(shake, Math.min(0.8, (before - after) * 0.04));
          lastCrash = now;
        }
        if (a.ai) a.ai.stunned = Math.max(a.ai.stunned, 1.2);
        if (b.ai) b.ai.stunned = Math.max(b.ai.stunned, 1.2);
      }
    }
  }

  // Pedestrians.
  const collidePed = (x: number, z: number) => resolveCircleVsBuildings(layout, x, z, 0.35);
  for (const p of peds) {
    if (p.state === "gone") continue;
    if (Math.abs(p.x - player.x) > 200 || Math.abs(p.z - player.z) > 200) continue;
    stepPed(p, walkGraph, rng, dt, threats, collidePed);
    if (p.state === "down") continue;
    for (const v of vehicles) {
      const dx = p.x - v.state.x;
      const dz = p.z - v.state.z;
      const min = v.radius * 0.85 + 0.35;
      if (dx * dx + dz * dz > min * min) continue;
      const sp = speedOf(v.state);
      if (sp > 3.5) {
        knockPed(p, v.state.vx, v.state.vz);
        v.state.vx *= 0.92;
        v.state.vz *= 0.92;
        if (Math.hypot(p.x - player.x, p.z - player.z) < 40) audio.thud();
        for (const o of peds) if (o !== p && Math.hypot(o.x - p.x, o.z - p.z) < 18) scare(o, p, 5);
        break;
      }
      const d = Math.hypot(dx, dz) || 1;
      p.x += (dx / d) * (min - d);
      p.z += (dz / d) * (min - d);
    }
    if (!player.vehicle && !player.dead) {
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 0) {
        p.x += (dx / d) * (0.7 - d);
        p.z += (dz / d) * (0.7 - d);
      }
    }
  }

  recycleTimer -= dt;
  if (recycleTimer <= 0) {
    recycleTimer = 0.5;
    recyclePeds(4);
    for (const v of vehicles) {
      if (v.state.wrecked && v.wreckAge > 40 && Math.hypot(v.state.x - player.x, v.state.z - player.z) > 90) recycleAsTraffic(v);
    }
  }

  if (player.vehicle) {
    player.x = player.vehicle.state.x;
    player.z = player.vehicle.state.z;
  }
  audio.horn(input.isDown("KeyH") && player.vehicle !== null && !player.dead);
  const pv = player.dead ? null : player.vehicle;
  audio.engine(pv ? speedOf(pv.state) : 0, pv ? Math.max(0, pv.input.throttle) : 0, pv !== null && !pv.state.wrecked, dt);
  audio.screech(pv ? Math.abs(lateralSpeed(pv.state)) + (pv.input.handbrake && speedOf(pv.state) > 6 ? 4 : 0) : 0);

  if (player.health < 100 && player.health > 0 && !player.vehicle?.state.burning) player.health = Math.min(100, player.health + dt * 2);
}

// ---------------------------------------------------------------- render sync

function updateCamera(dt: number): void {
  const v = player.vehicle;
  let tx: number;
  let tz: number;
  let heading: number;
  let dist: number;
  let height: number;
  if (v) {
    const sp = speedOf(v.state);
    heading = Math.atan2(v.state.vz, v.state.vx);
    if (sp < 2 || forwardSpeed(v.state) < 0) heading = v.state.heading;
    tx = v.state.x;
    tz = v.state.z;
    dist = cameraMode === 0 ? 9 + sp * 0.12 : 22;
    height = cameraMode === 0 ? 3.6 + sp * 0.03 : 20;
  } else {
    heading = player.heading;
    tx = player.x;
    tz = player.z;
    dist = cameraMode === 0 ? 5.5 : 18;
    height = cameraMode === 0 ? 2.6 : 16;
  }
  if (player.dead > 0) {
    dist += 6;
    height += 8;
  }
  const want = new THREE.Vector3(tx - Math.cos(heading) * dist, height, tz - Math.sin(heading) * dist);
  const k = 1 - Math.exp(-dt * (v ? 4 : 6));
  camPos.lerp(want, k);
  const push = resolveCircleVsBuildings(layout, camPos.x, camPos.z, 0.5);
  if (push) {
    camPos.x += push.x;
    camPos.z += push.z;
  }
  camLook.lerp(new THREE.Vector3(tx, v ? 1.2 : 1.4, tz), 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 1.6);
  }
  camera.lookAt(camLook);
  if (v) {
    const target = 60 + Math.min(18, speedOf(v.state) * 0.35);
    camera.fov += (target - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
  sun.position.set(tx + 60, 110, tz + 40);
  sun.target.position.set(tx, 0, tz);
}

function emitVehicleFx(v: Vehicle, dt: number): void {
  const s = v.state;
  const dx = s.x - player.x;
  const dz = s.z - player.z;
  if (dx * dx + dz * dz > 160 * 160) return;
  const spec = CAR_SPECS[v.kind];
  const fx = Math.cos(s.heading);
  const fz = Math.sin(s.heading);
  const hoodX = s.x + fx * spec.length * 0.3;
  const hoodZ = s.z + fz * spec.length * 0.3;
  const y = v.visual.lift + 1.1;
  const cond = conditionOf(s);
  const chance = (rate: number) => Math.random() < rate * dt;
  if (cond === "smoking" && chance(6)) smoke.emit({ x: hoodX, y, z: hoodZ, vy: 1.6, spread: 0.6, life: 2.2, size0: 0.6, size1: 2.4, color: 0xb0b0b0, alpha: 0.5, drag: 0.3 });
  if (cond === "heavy" && chance(14)) smoke.emit({ x: hoodX, y, z: hoodZ, vy: 2, spread: 0.7, life: 2.8, size0: 0.8, size1: 3.2, color: 0x3c3a38, alpha: 0.7, drag: 0.3 });
  if (cond === "burning") {
    const n = Math.floor(40 * dt + Math.random());
    for (let i = 0; i < n; i++) fire.emit({ x: hoodX + (Math.random() - 0.5) * 1.4, y: y - 0.2, z: hoodZ + (Math.random() - 0.5) * 1.4, vy: 2.5, spread: 0.8, life: 0.7, size0: 1.2, size1: 0.3, color: 0xffe08a, color1: 0xff3a00, gravity: -2 });
    if (chance(20)) smoke.emit({ x: hoodX, y: y + 0.8, z: hoodZ, vy: 3, spread: 0.8, life: 3.5, size0: 1.2, size1: 5, color: 0x1e1c1b, color1: 0x4a4847, alpha: 0.8, drag: 0.2 });
  }
  if (cond === "wrecked" && v.wreckAge < 25 && chance(5)) smoke.emit({ x: s.x, y: y - 0.3, z: s.z, vy: 1.4, spread: 0.8, life: 3, size0: 1, size1: 3.5, color: 0x333130, alpha: 0.55, drag: 0.2 });

  // Skid marks and tyre smoke from the rear wheels.
  const sp = speedOf(s);
  const slip = Math.abs(lateralSpeed(s));
  const hard = (v.input.handbrake && sp > 5) || slip > 3.5 || (v.input.throttle < 0 && forwardSpeed(s) > 10);
  const rx = s.x - fx * spec.wheelBase * 0.5;
  const rz = s.z - fz * spec.wheelBase * 0.5;
  const px = -fz * spec.width * 0.5;
  const pz = fx * spec.width * 0.5;
  const cur: [number, number, number, number] = [rx + px, rz + pz, rx - px, rz - pz];
  if (hard && v.rearPrev && !s.wrecked) {
    const gy = v.visual.lift + 0.04;
    skids.add(v.rearPrev[0], v.rearPrev[1], cur[0], cur[1], gy);
    skids.add(v.rearPrev[2], v.rearPrev[3], cur[2], cur[3], gy);
    if (slip > 6 && chance(30)) smoke.emit({ x: cur[0], y: 0.4, z: cur[1], vy: 0.8, spread: 1.2, life: 1.6, size0: 0.7, size1: 2.8, color: 0xe6e6e6, alpha: 0.45, drag: 1 });
  }
  v.rearPrev = cur;
}

function syncVisuals(dt: number): void {
  for (const v of vehicles) {
    const braking = v.input.brake || v.input.handbrake || (v.input.throttle < 0 && forwardSpeed(v.state) > 0.5);
    syncCarVisual(v.visual, v.state, braking, ground(v.state.x, v.state.z), dt);
    emitVehicleFx(v, dt);
  }
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    const vis = pedVisuals[i];
    const far = Math.abs(p.x - player.x) > PED_RECYCLE || Math.abs(p.z - player.z) > PED_RECYCLE;
    vis.group.visible = p.state !== "gone" && !far;
    if (!vis.group.visible) continue;
    vis.group.position.set(p.x, ground(p.x, p.z) + p.y, p.z);
    vis.group.rotation.y = -p.heading + Math.PI / 2;
    animatePedestrian(vis, p.speed, dt, p.fall);
  }
  if (!player.vehicle) {
    playerVis.group.position.set(player.x, ground(player.x, player.z), player.z);
    playerVis.group.rotation.y = -player.heading + Math.PI / 2;
    animatePedestrian(playerVis, player.dead > 0 ? 0 : player.speed, dt, player.dead > 0 ? 1 : 0);
  }
  smoke.update(dt);
  fire.update(dt);
  flash.intensity *= Math.exp(-dt * 7);
}

function updateHud(): void {
  const v = player.vehicle;
  speedEl.textContent = v ? String(Math.round(speedOf(v.state) * 3.6)) : "—";
  healthEl.style.width = `${Math.max(0, player.health)}%`;
  carHpWrap.style.display = v ? "block" : "none";
  if (v) carHpEl.style.width = `${v.state.health}%`;
  hintEl.classList.toggle("alert", !!v && v.state.burning);
  if (player.dead > 0) hintEl.textContent = "";
  else if (v && v.state.burning) hintEl.textContent = speedOf(v.state) < 6 ? "Машина горит! E — выйти" : "Машина горит! Тормозите и выходите";
  else if (v) hintEl.textContent = speedOf(v.state) < 6 ? "E — выйти · Пробел — ручник · H — сигнал" : "Пробел — ручник · C — камера";
  else hintEl.textContent = nearestEnterable() ? "E — сесть в машину" : "WASD — идти · Shift — бежать";
  const dots = vehicles.map((x) => ({ x: x.state.x, z: x.state.z, color: x === v ? "#ffd32a" : x.state.wrecked ? "#555" : x.state.burning ? "#ff6b3a" : x.ai ? "#dfe6e9" : "#74b9ff" }));
  minimap.draw(player.x, player.z, v ? v.state.heading : player.heading, dots);
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let fpsWall = 0;
const perf = { update: 0, render: 0 };
let fpsAcc = 0;
let fpsFrames = 0;
const FIXED = 1 / 60;
let accumulator = 0;

function frame(now: number): void {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.1, raw);
  last = now;
  fpsWall += raw;
  const t0 = performance.now();
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED && steps < 6) {
      update(FIXED, now);
      input.endFrame();
      accumulator -= FIXED;
      steps++;
    }
    if (steps === 6) accumulator = 0;
  }
  updateCamera(dt);
  syncVisuals(paused ? 0 : dt);
  updateHud();
  const t1 = performance.now();
  renderer.render(scene, camera);
  const t2 = performance.now();
  perf.update += (t1 - t0 - perf.update) * 0.1;
  perf.render += (t2 - t1 - perf.render) * 0.1;
  fpsAcc = fpsWall;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    const walking = peds.filter((p) => p.state !== "gone").length;
    statsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS · ${vehicles.length} машин · ${walking} прохожих`;
    fpsWall = 0;
    fpsFrames = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook for automated play-testing.
if (location.search.includes("debug")) {
  (window as unknown as { __pr: unknown }).__pr = {
    player,
    vehicles,
    peds,
    explode: (x: number, z: number) => explode(x, z, null),
    particles: () => ({ smoke: smoke.count, fire: fire.count }),
    skids: () => skids.added,
    perf,
    drawCalls: () => renderer.info.render.calls,
    start: () => $("#btn-start").click(),
    started: () => started,
  };
}
