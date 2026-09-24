import * as THREE from "three";
import { Rng } from "./core/rng";
import { Input } from "./core/input";
import { clampToCity, generateCity, resolveCircleVsBuildings, ROAD_WIDTH } from "./world/city";
import { buildCityMeshes } from "./world/cityMesh";
import { CAR_SPECS, collideCar, forwardSpeed, makeCar, separateCars, speedOf, stepCar, type CarInput, type CarState } from "./entities/carPhysics";
import { buildCarVisual, syncCarVisual, type CarVisual } from "./entities/carMesh";
import { animatePedestrian, buildPedestrian } from "./entities/pedestrian";
import { driveTraffic, spawnTraffic, type Obstacle, type TrafficCar } from "./entities/traffic";
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

// ---------------------------------------------------------------- world

const seed = 20260924;
const rng = new Rng(seed);
const layout = generateCity(rng, 8);
scene.add(buildCityMeshes(layout).group);

const COLORS = [0xd64545, 0x2e86de, 0xf5f6fa, 0x2d3436, 0xfbc531, 0x44bd32, 0x8c7ae6, 0xe67e22, 0x7f8fa6, 0x16a085];

interface Vehicle {
  state: CarState;
  kind: string;
  visual: CarVisual;
  input: CarInput;
  ai: TrafficCar | null;
  radius: number;
}

const vehicles: Vehicle[] = [];

function addVehicle(state: CarState, kind: string, color: number, ai: TrafficCar | null): Vehicle {
  const spec = CAR_SPECS[kind];
  const visual = buildCarVisual(kind, spec, color);
  scene.add(visual.group);
  const v: Vehicle = { state, kind, visual, input: ai ? ai.input : { throttle: 0, steer: 0, brake: false, handbrake: false }, ai, radius: spec.length * 0.42 };
  vehicles.push(v);
  return v;
}

for (const p of layout.parking) {
  if (rng.chance(0.6)) continue;
  const kind = rng.pick(Object.keys(CAR_SPECS));
  addVehicle(makeCar(p.x, p.z, p.rot), kind, rng.pick(COLORS), null);
}
for (const t of spawnTraffic(rng, layout, 45, COLORS)) addVehicle(t.state, t.kind, t.color, t);

// ---------------------------------------------------------------- player

const playerVis = buildPedestrian(0x2e86de, 0x2d3436);
scene.add(playerVis.group);
const player = { x: 0, z: ROAD_WIDTH / 2 - 1.5, heading: 0, speed: 0, vehicle: null as Vehicle | null, health: 100 };
// Put the player on a sidewalk next to the first parked car if there is one.
{
  // Start downtown: the parked car closest to the city centre.
  const parked = vehicles.filter((v) => !v.ai).sort((a, b) => Math.hypot(a.state.x, a.state.z) - Math.hypot(b.state.x, b.state.z))[0];
  if (parked) {
    player.x = parked.state.x + 3;
    player.z = parked.state.z + 2.5;
    player.heading = parked.state.heading;
  }
}

// ---------------------------------------------------------------- HUD, input, audio

const input = new Input();
const audio = new CarAudio();
const minimap = new Minimap($<HTMLCanvasElement>("#minimap"), layout);
const speedEl = $("#speed .num");
const hintEl = $("#hint");
const healthEl = $<HTMLDivElement>("#health .fill");
const statsEl = $("#stats");
let cameraMode = 0;
let started = false;
let paused = true;

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

// ---------------------------------------------------------------- simulation

const camPos = new THREE.Vector3(player.x - 8, 6, player.z);
const camLook = new THREE.Vector3(player.x, 1, player.z);

function nearestEnterable(): Vehicle | null {
  let best: Vehicle | null = null;
  let bestD = 4.5;
  for (const v of vehicles) {
    const d = Math.hypot(v.state.x - player.x, v.state.z - player.z);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function enterVehicle(v: Vehicle): void {
  player.vehicle = v;
  if (v.ai) {
    // Carjack: the driver bails out and the car becomes the player's.
    v.ai = null;
    v.input = { throttle: 0, steer: 0, brake: false, handbrake: false };
  }
  playerVis.group.visible = false;
}

function exitVehicle(): void {
  const v = player.vehicle;
  if (!v) return;
  const s = v.state;
  // Step out on the left side.
  const lx = Math.cos(s.heading - Math.PI / 2);
  const lz = Math.sin(s.heading - Math.PI / 2);
  player.x = s.x + lx * 2.2;
  player.z = s.z + lz * 2.2;
  player.heading = s.heading;
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
  if (!player.vehicle) list.push({ x: player.x, z: player.z, r: 0.6, vx: 0, vz: 0 });
  return list;
}

let lastCrash = 0;

function update(dt: number, now: number): void {
  if (input.justPressed("KeyC")) cameraMode = (cameraMode + 1) % 2;
  if (input.justPressed("KeyM")) audio.muted = !audio.muted;

  // Player on foot or driving.
  if (player.vehicle) {
    const v = player.vehicle;
    v.input.throttle = input.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    v.input.steer = input.axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    v.input.handbrake = input.isDown("Space");
    v.input.brake = false;
    if (input.justPressed("KeyE", "KeyF") && speedOf(v.state) < 6) exitVehicle();
  } else {
    const run = input.isDown("ShiftLeft", "ShiftRight");
    const fwd = input.axis(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"]);
    const turn = input.axis(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"]);
    // Movement is relative to the camera yaw.
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
    // Cars push pedestrians aside and hurt them at speed.
    for (const v of vehicles) {
      const dx = player.x - v.state.x;
      const dz = player.z - v.state.z;
      const d = Math.hypot(dx, dz);
      const min = v.radius * 0.8 + 0.4;
      if (d < min && d > 0) {
        player.x += (dx / d) * (min - d);
        player.z += (dz / d) * (min - d);
        const sp = speedOf(v.state);
        if (sp > 5) player.health = Math.max(0, player.health - sp * 0.6 * dt * 10);
      }
    }
    const near = nearestEnterable();
    if (near && input.justPressed("KeyE", "KeyF")) enterVehicle(near);
  }

  // Vehicles.
  for (const v of vehicles) {
    if (v.ai) driveTraffic(v.ai, layout, rng, obstaclesFor(v), dt);
    const spec = CAR_SPECS[v.kind];
    stepCar(v.state, spec, v.input, dt);
    const push = resolveCircleVsBuildings(layout, v.state.x, v.state.z, v.radius * 0.85);
    if (push) {
      const dmg = collideCar(v.state, push.x, push.z);
      if (v === player.vehicle && dmg > 2 && now - lastCrash > 250) {
        audio.crash(dmg);
        lastCrash = now;
      }
      if (v.ai) v.ai.stunned = Math.max(v.ai.stunned, 1.5);
    }
    const cl = clampToCity(layout, v.state.x, v.state.z);
    if (cl.x !== v.state.x || cl.z !== v.state.z) {
      collideCar(v.state, cl.x - v.state.x, cl.z - v.state.z);
    }
  }
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
          lastCrash = now;
        }
        if (a.ai) a.ai.stunned = Math.max(a.ai.stunned, 1.2);
        if (b.ai) b.ai.stunned = Math.max(b.ai.stunned, 1.2);
      }
    }
  }

  if (player.vehicle) {
    player.x = player.vehicle.state.x;
    player.z = player.vehicle.state.z;
  }
  if (input.isDown("KeyH") && player.vehicle) audio.horn(true);
  else audio.horn(false);
  const pv = player.vehicle;
  audio.engine(pv ? speedOf(pv.state) : 0, pv ? Math.max(0, pv.input.throttle) : 0, pv !== null, dt);

  // Regenerate on foot slowly.
  if (player.health < 100) player.health = Math.min(100, player.health + dt * 2);
  if (player.health <= 0) {
    player.health = 100;
    const parked = vehicles.find((v) => !v.ai && v !== player.vehicle);
    player.x = parked ? parked.state.x + 3 : 0;
    player.z = parked ? parked.state.z + 2.5 : 0;
  }
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
  const want = new THREE.Vector3(tx - Math.cos(heading) * dist, height, tz - Math.sin(heading) * dist);
  const k = 1 - Math.exp(-dt * (v ? 4 : 6));
  camPos.lerp(want, k);
  // Keep the camera out of buildings by pulling it toward the target.
  const push = resolveCircleVsBuildings(layout, camPos.x, camPos.z, 0.5);
  if (push) {
    camPos.x += push.x;
    camPos.z += push.z;
  }
  camLook.lerp(new THREE.Vector3(tx, v ? 1.2 : 1.4, tz), 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (v) {
    const target = 60 + Math.min(18, speedOf(v.state) * 0.35);
    camera.fov += (target - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
  // Shadow camera follows the player.
  sun.position.set(tx + 60, 110, tz + 40);
  sun.target.position.set(tx, 0, tz);
}

function syncVisuals(dt: number): void {
  for (const v of vehicles) {
    const braking = v.input.brake || v.input.handbrake || (v.input.throttle < 0 && forwardSpeed(v.state) > 0.5);
    syncCarVisual(v.visual, v.state, braking);
  }
  if (!player.vehicle) {
    playerVis.group.position.x = player.x;
    playerVis.group.position.z = player.z;
    playerVis.group.rotation.y = -player.heading + Math.PI / 2;
    animatePedestrian(playerVis, player.speed, dt);
  }
}

function updateHud(): void {
  const v = player.vehicle;
  speedEl.textContent = v ? String(Math.round(speedOf(v.state) * 3.6)) : "—";
  healthEl.style.width = `${v ? v.state.health : player.health}%`;
  if (v) hintEl.textContent = speedOf(v.state) < 6 ? "E — выйти · Пробел — ручник · H — сигнал" : "Пробел — ручник · C — камера";
  else hintEl.textContent = nearestEnterable() ? "E — сесть в машину" : "WASD — идти · Shift — бежать";
  const dots = vehicles.map((x) => ({ x: x.state.x, z: x.state.z, color: x === v ? "#ffd32a" : x.ai ? "#dfe6e9" : "#74b9ff" }));
  minimap.draw(player.x, player.z, v ? v.state.heading : player.heading, dots);
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
const FIXED = 1 / 60;
let accumulator = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    accumulator += dt;
    while (accumulator >= FIXED) {
      update(FIXED, now);
      input.endFrame();
      accumulator -= FIXED;
    }
  }
  updateCamera(dt);
  syncVisuals(dt);
  updateHud();
  renderer.render(scene, camera);
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    statsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS · ${vehicles.length} машин`;
    fpsAcc = 0;
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
    start: () => $("#btn-start").click(),
    started: () => started,
  };
}
