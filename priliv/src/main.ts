import * as THREE from "three";
import { Rng } from "./core/rng";
import { Input } from "./core/input";
import { PITCH, ROAD_WIDTH, clampToCity, generateCity, isOnCarriageway, resolveCircleVsBuildings, roadCoord, surfaceHeight } from "./world/city";
import { buildCityMeshes } from "./world/cityMesh";
import { buildWalkGraph } from "./world/sidewalks";
import { CAR_SPECS, CIVILIAN_KINDS, NO_MODS, armorFactor, collideCar, forwardSpeed, lateralSpeed, makeCar, moddedSpec, separateCars, speedOf, stepCar, type CarInput, type CarMods, type CarState } from "./entities/carPhysics";
import { applyBlastToCar, blastDamage, conditionOf, stepDamage } from "./entities/damage";
import { beamMaterial, buildCarVisual, flashSiren, syncCarVisual, type CarVisual } from "./entities/carMesh";
import { animatePedestrian, buildPedestrian, HAIR, PANTS, SHIRTS, SKINS, type PedVisual } from "./entities/pedestrian";
import { knockPed, rejoinNetwork, scare, spawnPeds, stepPed, type Ped, type Threat } from "./entities/peds";
import { driveTraffic, spawnTraffic, type Obstacle, type TrafficCar } from "./entities/traffic";
import { ParticleSystem } from "./fx/particles";
import { SkidMarks } from "./fx/skids";
import { Minimap } from "./ui/minimap";
import { Wanted, type Crime } from "./police/wanted";
import { lineOfSight, makeUnit, nearestIntersection, policeDrive, type PoliceUnit } from "./police/policeAI";
import { Helicopter } from "./police/helicopter";
import { clearSave, freshSave, loadSave, storeInGarage, writeSave, type SaveData } from "./game/save";
import { MissionRunner, type Mission, type MissionEvent } from "./game/missions";
import { places, raceMission, storyMissions } from "./game/story";
import { MOD_SHOP, SHOP, buy, makeCourierRun, makeTaxiFare, taxiFare, type TaxiFare } from "./game/jobs";
import { BeamMarker, TargetArrow, ZoneMarker } from "./fx/markers";
import { SECONDS_PER_HOUR, formatClock, lerpColor, lightingAt, wrapHour } from "./world/timeOfDay";
import { WEATHER_NAMES, Weather, type WeatherKind } from "./world/weather";
import { Radio } from "./audio/radio";
import { TouchControls, isTouchDevice } from "./ui/touch";
import { Rain } from "./fx/rain";
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
const cityMeshes = buildCityMeshes(layout);
scene.add(cityMeshes.group);
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
  police: PoliceUnit | null;
  /** simTime the player last drove or hit this car; used to blame explosions. */
  blame: number;
  /** Key of the mission this car belongs to, while that mission runs. */
  missionKey: string | null;
  /** Already stored in the player's garage. */
  garaged: boolean;
  mods: CarMods;
}

const vehicles: Vehicle[] = [];

function addVehicle(state: CarState, kind: string, color: number, ai: TrafficCar | null, police: PoliceUnit | null = null): Vehicle {
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
    police,
    blame: -1e9,
    missionKey: null,
    garaged: false,
    mods: { ...NO_MODS },
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
  v.police = null;
  v.blame = -1e9;
  scene.add(v.visual.group);
}

for (const p of layout.parking) {
  if (rng.chance(0.6)) continue;
  const kind = rng.pick(CIVILIAN_KINDS);
  addVehicle(makeCar(p.x, p.z, p.rot), kind, rng.pick(COLORS), null);
}
for (const t of spawnTraffic(rng, layout, 45, COLORS)) addVehicle(t.state, t.kind, t.color, t);

// ---------------------------------------------------------------- police

const POLICE_WHITE = 0xf2f4f7;
const PATROLS = 3;
const PURSUERS_BY_STARS = [0, 2, 3, 5, 7, 9];
const wanted = new Wanted();
const heli = new Helicopter(scene);
let simTime = 0;
let policeSpawnTimer = 0;
let roadblockTimer = 8;
let bustTimer = 0;
let banner = { text: "", ttl: 0 };

function addPatrol(): Vehicle | null {
  const t = spawnTraffic(rng, layout, 1, [POLICE_WHITE])[0];
  if (!t) return null;
  t.kind = "police";
  return addVehicle(t.state, "police", POLICE_WHITE, t, makeUnit("patrol"));
}
for (let i = 0; i < PATROLS; i++) addPatrol();

// ---------------------------------------------------------------- progress

const hasSave = loadSave() !== null;
let save: SaveData = loadSave() ?? newGameSave();
const PLACES = places(layout.n);

function newGameSave(): SaveData {
  const s = freshSave();
  // A starter car waits in the garage.
  s.garage.push({ kind: "sedan", color: 0x2e86de });
  return s;
}

function spawnGarageCars(): void {
  save.garage.forEach((c, i) => {
    const slot = PLACES.garageSlots[i];
    if (!slot || !CAR_SPECS[c.kind]) return;
    const v = addVehicle(makeCar(slot.x, slot.z, slot.heading), c.kind, c.color, null);
    v.garaged = true;
    v.mods = { ...NO_MODS, ...c.mods };
  });
}
spawnGarageCars();

// ---------------------------------------------------------------- atmosphere

let clock = save.clock;
const weather = new Weather(new Rng(seed ^ 0x5eed), "clear");
let visibility = 1;
let lightningTimer = 8;
let lightningFlash = 0;
const rainFx = new Rain(scene);
const headlight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.55, 0.6, 1.2);
scene.add(headlight, headlight.target);
const copLight = new THREE.PointLight(0xff2020, 0, 40, 1.6);
scene.add(copLight);
const WEATHER_ICON: Record<WeatherKind, string> = { clear: "☀", cloudy: "☁", rain: "🌧", storm: "⛈" };

function persist(): void {
  save.clock = wrapHour(clock);
  writeSave(save);
}

/** Car specs with grip scaled for wet roads; rebuilt when the road wetness changes. */
let wetSpecs: Record<string, (typeof CAR_SPECS)[string]> = CAR_SPECS;
let wetGrip = 1;
function specFor(kind: string) {
  const g = weather.gripFactor();
  if (Math.abs(g - wetGrip) > 0.01) {
    wetGrip = g;
    wetSpecs = Object.fromEntries(Object.entries(CAR_SPECS).map(([k, sp]) => [k, { ...sp, grip: sp.grip * g, handbrakeGrip: sp.handbrakeGrip * g }]));
  }
  return wetSpecs[kind];
}

function applyAtmosphere(dt: number): void {
  const L = lightingAt(clock);
  const cloud = weather.cloud;
  const rainI = weather.rain;
  const grey = lerpColor(0x7d8590, 0x151820, L.night);
  let sky = lerpColor(L.skyColor, grey, cloud * 0.8);
  let flashK = 0;
  if (lightningFlash > 0) {
    lightningFlash -= dt;
    flashK = Math.max(0, Math.sin(lightningFlash * 40)) * Math.min(1, lightningFlash * 4);
    sky = lerpColor(sky, 0xdfe6ff, flashK * 0.7);
  }
  (scene.background as THREE.Color).setHex(sky);
  const fog = scene.fog as THREE.Fog;
  fog.color.setHex(sky);
  fog.near = 120 * (1 - 0.6 * rainI);
  fog.far = Math.max(140, 420 * (1 - 0.45 * rainI) - 80 * L.night);
  const dark = Math.max(L.night, cloud * 0.35);
  sun.intensity = L.sunIntensity * (1 - 0.6 * cloud);
  sun.color.setHex(L.sunColor);
  hemi.intensity = L.hemiIntensity * (1 - 0.3 * cloud) + flashK * 2.5;
  hemi.color.setHex(lerpColor(0xcfe6ff, sky, 0.5));
  hemi.groundColor.setHex(L.groundColor);
  renderer.toneMappingExposure = 1.05 + 0.35 * L.night;
  cityMeshes.buildingMaterial.emissiveIntensity = L.night * 1.1;
  cityMeshes.lampHeadMaterial.emissiveIntensity = 0.2 + L.night * 2.5;
  cityMeshes.lampPoolMaterial.opacity = L.night * 0.55;
  beamMaterial.opacity = dark * 0.45;
  const wet = weather.wet;
  cityMeshes.roadMaterial.roughness = 0.95 - 0.55 * wet;
  cityMeshes.roadMaterial.metalness = 0.2 * wet;
  cityMeshes.roadMaterial.color.setScalar(1 - 0.35 * wet);
  cityMeshes.pavementMaterial.roughness = 0.9 - 0.4 * wet;
  cityMeshes.pavementMaterial.color.setScalar(1 - 0.2 * wet);
  cityMeshes.groundMaterial.color.setHex(lerpColor(0x4f7a3c, 0x33502a, wet * 0.6));

  // The player's car throws a real light at night.
  const pv = player.vehicle;
  if (pv && dark > 0.1 && !pv.state.wrecked) {
    const fx = Math.cos(pv.state.heading);
    const fz = Math.sin(pv.state.heading);
    headlight.position.set(pv.state.x + fx * 2.4, 1, pv.state.z + fz * 2.4);
    headlight.target.position.set(pv.state.x + fx * 18, 0, pv.state.z + fz * 18);
    headlight.intensity = 450 * dark;
  } else headlight.intensity = 0;

  // One flashing light for the closest chasing cruiser.
  let best: Vehicle | null = null;
  let bestD = 60;
  for (const v of vehicles) {
    if (!isActivePolice(v) || v.police!.mode === "patrol") continue;
    const d = Math.hypot(v.state.x - player.x, v.state.z - player.z);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (best) {
    copLight.position.set(best.state.x, 2.4, best.state.z);
    copLight.color.setHex(Math.floor(simTime * 7) % 4 < 2 ? 0xff2020 : 0x2a5bff);
    copLight.intensity = 260 * Math.max(0.25, dark);
  } else copLight.intensity = 0;

  rainFx.update(dt, rainI, camera.position.x, camera.position.y, camera.position.z);
}

interface Cop {
  ped: Ped;
  vis: PedVisual;
  leaving: boolean;
}
const cops: Cop[] = [];

function spawnCop(x: number, z: number): void {
  if (cops.length >= 6) return;
  const vis = buildPedestrian(0x1b2d5c, 0x141c33, rng.pick(SKINS), 0x0d0d12);
  vis.group.traverse((o) => (o.castShadow = false));
  scene.add(vis.group);
  const ped: Ped = { id: -1, x, z, y: 0, vx: 0, vy: 0, vz: 0, heading: 0, speed: 0, state: "walk", from: 0, to: 0, timer: 0, fall: 0, walkSpeed: 0, look: 0 };
  cops.push({ ped, vis, leaving: false });
}

function removeCop(i: number): void {
  scene.remove(cops[i].vis.group);
  cops.splice(i, 1);
}

/** A crewed police car: chasing, blocking the road, or out on patrol with a driver. */
function isActivePolice(v: Vehicle): boolean {
  if (!v.police || v === player.vehicle || v.state.wrecked || v.state.burning) return false;
  return v.police.mode !== "patrol" || v.ai !== null;
}

/** Does any police unit see the point (x, z)? */
function policeCanSee(x: number, z: number, range = 65): boolean {
  // Darkness and rain make it easier to slip away.
  const carRange = range * visibility;
  for (const v of vehicles) {
    if (!isActivePolice(v)) continue;
    const d = Math.hypot(v.state.x - x, v.state.z - z);
    if (d < carRange && lineOfSight(layout, v.state.x, v.state.z, x, z)) return true;
  }
  for (const c of cops) {
    if (c.leaving || c.ped.state === "down" || c.ped.state === "gone") continue;
    if (Math.hypot(c.ped.x - x, c.ped.z - z) < 35) return true;
  }
  return heli.active && heli.distanceTo(x, z) < 90;
}

function crime(kind: Crime, x: number, z: number, needsWitness: boolean): void {
  // Minor crimes only count when police see them or a bystander calls it in.
  if (needsWitness && !policeCanSee(x, z, 80) && !rng.chance(0.4)) return;
  if (wanted.add(kind)) {
    audio.alert();
    starsEl.classList.remove("pulse");
    void starsEl.offsetWidth;
    starsEl.classList.add("pulse");
  }
}

/** Point a car's traffic AI at the street it is already on. */
function trafficFor(v: Vehicle): TrafficCar {
  const s = v.state;
  const a = nearestIntersection(layout.n, s.x, s.z);
  const cx = Math.cos(s.heading);
  const cz = Math.sin(s.heading);
  let b = Math.abs(cx) > Math.abs(cz) ? { ix: a.ix + Math.sign(cx), iz: a.iz } : { ix: a.ix, iz: a.iz + Math.sign(cz) };
  if (b.ix < 0 || b.ix > layout.n || b.iz < 0 || b.iz > layout.n || (b.ix === a.ix && b.iz === a.iz)) b = { ix: a.ix === 0 ? 1 : a.ix - 1, iz: a.iz };
  return { state: s, kind: v.kind, color: POLICE_WHITE, a, b, stunned: 0, input: { throttle: 0, steer: 0, brake: false, handbrake: false } };
}

/** Wanted level cleared: units go back to patrolling, cops walk off, the helicopter leaves. */
function standDown(): void {
  for (const v of vehicles) {
    if (!v.police || v === player.vehicle || v.state.wrecked) continue;
    if (v.police.mode === "patrol") continue;
    v.police.mode = "patrol";
    v.police.node = null;
    v.ai = trafficFor(v);
    v.input = v.ai.input;
  }
  for (const c of cops) c.leaving = true;
  heli.leave();
  bustTimer = 0;
}

function spawnPursuer(): void {
  for (let tries = 0; tries < 20; tries++) {
    const ix = rng.int(0, layout.n);
    const iz = rng.int(0, layout.n);
    const x = roadCoord(layout.n, ix);
    const z = roadCoord(layout.n, iz);
    const d = Math.hypot(x - player.x, z - player.z);
    if (d < 90 || d > 170) continue;
    const car = makeCar(x, z, Math.atan2(player.z - z, player.x - x));
    addVehicle(car, "police", POLICE_WHITE, null, makeUnit("pursuit"));
    return;
  }
}

/** Two cruisers parked across the road ahead of the player. */
function placeRoadblock(): void {
  const v = player.vehicle;
  const hx = v ? v.state.vx : Math.cos(player.heading);
  const hz = v ? v.state.vz : Math.sin(player.heading);
  if (Math.hypot(hx, hz) < 0.5) return;
  const alongX = Math.abs(hx) > Math.abs(hz);
  const lim = layout.half - 10;
  let x: number;
  let z: number;
  if (alongX) {
    z = roadCoord(layout.n, nearestIntersection(layout.n, player.x, player.z).iz);
    x = player.x + Math.sign(hx) * 80;
    // Stay mid-block so the block does not sit inside an intersection.
    x = Math.round((x - ROAD_WIDTH / 2) / PITCH) * PITCH + PITCH / 2;
  } else {
    x = roadCoord(layout.n, nearestIntersection(layout.n, player.x, player.z).ix);
    z = player.z + Math.sign(hz) * 80;
    z = Math.round((z - ROAD_WIDTH / 2) / PITCH) * PITCH + PITCH / 2;
  }
  if (Math.abs(x) > lim || Math.abs(z) > lim) return;
  const rot = alongX ? Math.PI / 2 : 0;
  for (const off of [-2.6, 2.6]) {
    const cx = alongX ? x : x + off;
    const cz = alongX ? z + off : z;
    addVehicle(makeCar(cx, cz, rot + (off > 0 ? Math.PI : 0)), "police", POLICE_WHITE, null, makeUnit("roadblock"));
  }
}

function managePolice(dt: number): void {
  const seen = !player.dead && policeCanSee(player.x, player.z);
  if (wanted.update(dt, seen)) {
    standDown();
    showBanner("Вы оторвались от полиции");
  }
  const level = wanted.level;
  let pursuers = 0;
  let patrols = 0;
  for (const v of vehicles) {
    if (!isActivePolice(v)) continue;
    if (v.police!.mode === "pursuit") pursuers++;
    if (v.police!.mode === "patrol") patrols++;
  }
  if (level > 0) {
    // Nearby patrols join the chase first, then reinforcements arrive from afar.
    for (const v of vehicles) {
      if (pursuers >= PURSUERS_BY_STARS[level]) break;
      if (!isActivePolice(v) || v.police!.mode !== "patrol") continue;
      if (Math.hypot(v.state.x - player.x, v.state.z - player.z) > 200) continue;
      v.police!.mode = "pursuit";
      v.ai = null;
      pursuers++;
    }
    policeSpawnTimer -= dt;
    if (pursuers < PURSUERS_BY_STARS[level] && policeSpawnTimer <= 0) {
      spawnPursuer();
      policeSpawnTimer = 2.5;
    }
    if (level >= 4 && !heli.active) heli.arrive(player.x, player.z);
    roadblockTimer -= dt;
    if (level >= 3 && player.vehicle && roadblockTimer <= 0) {
      placeRoadblock();
      roadblockTimer = 22;
    }
  } else if (patrols < PATROLS) {
    policeSpawnTimer -= dt;
    if (policeSpawnTimer <= 0) {
      addPatrol();
      policeSpawnTimer = 5;
    }
  }

  // Arrest: stopped next to a cruiser, or grabbed by a cop on foot.
  let grabbing = false;
  if (level > 0 && !player.dead) {
    if (player.vehicle) {
      if (speedOf(player.vehicle.state) < 2) {
        for (const v of vehicles) {
          if (isActivePolice(v) && v.police!.mode !== "patrol" && Math.hypot(v.state.x - player.x, v.state.z - player.z) < 6) grabbing = true;
        }
      }
    } else {
      for (const c of cops) {
        if (!c.leaving && c.ped.state !== "down" && Math.hypot(c.ped.x - player.x, c.ped.z - player.z) < 1.3) grabbing = true;
      }
    }
  }
  bustTimer = grabbing ? bustTimer + dt : Math.max(0, bustTimer - dt * 2);
  if (bustTimer > 2) arrestPlayer();
}

function stepCops(dt: number): void {
  const collide = (x: number, z: number) => resolveCircleVsBuildings(layout, x, z, 0.35);
  for (let i = cops.length - 1; i >= 0; i--) {
    const c = cops[i];
    const p = c.ped;
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (p.state === "gone" || (c.leaving && d > 70) || d > 200) {
      removeCop(i);
      continue;
    }
    if (p.state === "down") {
      stepPed(p, walkGraph, rng, dt, [], collide);
      continue;
    }
    // A cop gives up on foot once the player drives off.
    if (player.vehicle && speedOf(player.vehicle.state) > 9 && d > 25) c.leaving = true;
    const away = c.leaving || player.dead > 0;
    const ang = away ? Math.atan2(p.z - player.z, p.x - player.x) : Math.atan2(player.z - p.z, player.x - p.x);
    p.heading = ang;
    const target = away ? 3 : d < 1.1 ? 0 : 6.4;
    p.speed += (target - p.speed) * Math.min(1, dt * 6);
    p.x += Math.cos(ang) * p.speed * dt;
    p.z += Math.sin(ang) * p.speed * dt;
    const push = collide(p.x, p.z);
    if (push) {
      p.x += push.x;
      p.z += push.z;
    }
    for (const v of vehicles) {
      const dx = p.x - v.state.x;
      const dz = p.z - v.state.z;
      const min = v.radius * 0.85 + 0.35;
      if (dx * dx + dz * dz > min * min) continue;
      if (speedOf(v.state) > 3.5) {
        knockPed(p, v.state.vx, v.state.vz);
        audio.thud();
        if (v === player.vehicle) crime("hitCop", p.x, p.z, false);
        break;
      }
      const dd = Math.hypot(dx, dz) || 1;
      p.x += (dx / dd) * (min - dd);
      p.z += (dz / dd) * (min - dd);
    }
  }
}

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

/** Home is the sidewalk outside the garage. */
function placeAtStart(): void {
  player.x = PLACES.garage.x;
  player.z = PLACES.garage.z + 6.6;
  player.heading = -Math.PI / 2;
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
const starsEl = $<HTMLDivElement>("#wanted");
const bannerEl = $<HTMLDivElement>("#banner");
const moneyEl = $<HTMLDivElement>("#money");
const objectiveEl = $<HTMLDivElement>("#objective");
const arrowEl = $<HTMLDivElement>("#goal-arrow");
const briefEl = $<HTMLDivElement>("#brief");
const clockEl = $<HTMLDivElement>("#clock");
let cameraMode = 0;
let started = false;
let paused = true;
let shake = 0;

function beginPlay(): void {
  $("#start").classList.add("hidden");
  audio.unlock();
  audio.muted = save.muted;
  started = true;
  paused = false;
}

function newGame(): void {
  clearSave();
  try {
    sessionStorage.setItem("priliv.autostart", "1");
  } catch {
    /* ignore */
  }
  location.reload();
}

const continueBtn = $<HTMLButtonElement>("#btn-continue");
continueBtn.hidden = !hasSave;
$("#btn-start").textContent = hasSave ? "Новая игра" : "Начать";
continueBtn.addEventListener("click", beginPlay);
$("#btn-start").addEventListener("click", () => (hasSave ? newGame() : beginPlay()));
try {
  if (sessionStorage.getItem("priliv.autostart") === "1") {
    sessionStorage.removeItem("priliv.autostart");
    queueMicrotask(beginPlay);
  }
} catch {
  /* ignore */
}

const radio = new Radio(() => audio.node());
radio.station = save.radio;

const touch = new TouchControls(input, location.search.includes("touch"));
/** Keyboard or touch wording for on-screen hints. */
const k = (keys: string, tap: string) => (touch.enabled ? tap : keys);

let lowQuality = false;
function applyQuality(): void {
  const pref = save.quality;
  lowQuality = pref === "low" || (pref === "auto" && isTouchDevice());
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio, 2));
  const size = lowQuality ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  resize();
  const btn = document.querySelector("#btn-quality");
  if (btn) btn.textContent = `Качество: ${pref === "auto" ? (lowQuality ? "авто, низкое" : "авто, высокое") : pref === "low" ? "низкое" : "высокое"}`;
}
applyQuality();

const pauseEl = $<HTMLDivElement>("#pause");
let confirmNew = false;
function setPaused(on: boolean): void {
  if (!started) return;
  paused = on;
  // Drop any taps that happened while the menu was open so they do not replay.
  input.endFrame();
  confirmNew = false;
  pauseEl.classList.toggle("hidden", !on);
  if (on) {
    const story = storyMissions(layout.n).length;
    $("#pause-stats").innerHTML =
      `<dt>Деньги</dt><dd>$${save.money.toLocaleString("ru-RU")}</dd>` +
      `<dt>Сюжет</dt><dd>${save.missionsDone.length} из ${story}</dd>` +
      `<dt>Лучший круг</dt><dd>${save.bestRace ? save.bestRace.toFixed(1) + " с" : "—"}</dd>` +
      `<dt>Машины в гараже</dt><dd>${save.garage.length}</dd>`;
    $("#btn-sound").textContent = audio.muted ? "Включить звук" : "Выключить звук";
    $("#btn-new").textContent = "Новая игра";
    audio.engine(0, 0, false, 1);
    audio.siren(Infinity, 0);
    audio.screech(0);
    audio.horn(false);
    audio.rain(0);
    radio.update(false);
  }
}
$("#btn-resume").addEventListener("click", () => setPaused(false));
$("#btn-quality").addEventListener("click", () => {
  save.quality = save.quality === "auto" ? (lowQuality ? "high" : "low") : save.quality === "low" ? "high" : "low";
  persist();
  applyQuality();
});
$("#btn-sound").addEventListener("click", () => {
  audio.muted = !audio.muted;
  save.muted = audio.muted;
  persist();
  $("#btn-sound").textContent = audio.muted ? "Включить звук" : "Выключить звук";
});
$("#btn-new").addEventListener("click", () => {
  if (!confirmNew) {
    confirmNew = true;
    $("#btn-new").textContent = "Точно? Прогресс удалится";
    return;
  }
  newGame();
});
window.addEventListener("keydown", (ev) => {
  if (ev.code !== "Escape" || !started) return;
  // Esc closes a shop or workshop menu first, otherwise toggles the pause menu.
  const menu = document.querySelector("#menu");
  if (menu && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    input.endFrame();
    paused = false;
    return;
  }
  setPaused(!paused);
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
  if (v.police) {
    crime("stealCop", v.state.x, v.state.z, false);
    v.police.mode = "patrol";
  } else if (v.ai) crime("carjack", v.state.x, v.state.z, true);
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
  v.blame = simTime;
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

function showOverlay(title: string, sub: string): void {
  deathEl.innerHTML = `<div>${title}</div><small>${sub}</small>`;
  deathEl.classList.add("show");
}

function showBanner(text: string): void {
  banner = { text, ttl: 3.5 };
}

function killPlayer(): void {
  if (player.dead > 0) return;
  player.dead = 3.5;
  player.health = 0;
  wanted.clear();
  standDown();
  failMission("вы погибли");
  const fee = Math.min(save.money, 100);
  save.money -= fee;
  save.stats.deaths++;
  persist();
  showOverlay("Вы погибли", fee > 0 ? `Больница: −$${fee}` : "Возвращение домой…");
}

/** Test switches, only reachable through the ?debug hook. */
const debugFlags = { noArrest: false };

function arrestPlayer(): void {
  if (player.dead > 0 || debugFlags.noArrest) return;
  player.dead = 3.5;
  if (player.vehicle) {
    player.vehicle.input = { throttle: 0, steer: 0, brake: true, handbrake: true };
    player.speed = 0;
  }
  wanted.clear();
  standDown();
  bustTimer = 0;
  failMission("вас задержали");
  const fine = Math.min(save.money, Math.max(50, Math.round(save.money * 0.1)));
  save.money -= fine;
  save.stats.arrests++;
  persist();
  showOverlay("Задержаны", `Штраф $${fine}. Розыск снят, машина конфискована.`);
}

function respawnPlayer(): void {
  if (player.vehicle) {
    player.vehicle.input = { throttle: 0, steer: 0, brake: false, handbrake: true };
  }
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
    const hp = v.state.health;
    if (applyBlastToCar(v.state, x, z) > 0) {
      if (v.ai) v.ai.stunned = Math.max(v.ai.stunned, 3);
      if (v.mods.armor && !v.state.wrecked) v.state.health = hp - (hp - v.state.health) * armorFactor(v.mods);
    }
  }
  for (const p of peds) {
    if (p.state === "gone") continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 11) knockPed(p, (dx / (d || 1)) * (16 - d), (dz / (d || 1)) * (16 - d));
    else if (d < 40) scare(p, { x, z }, 6);
  }
  const playerCaused = !!source && (source === player.vehicle || simTime - source.blame < 20);
  if (playerCaused) {
    save.stats.carsDestroyed++;
    for (const v of vehicles) if (Math.hypot(v.state.x - x, v.state.z - z) < 13) v.blame = simTime;
    crime(source!.kind === "police" ? "killCop" : "explosion", x, z, false);
  }
  for (const c of cops) {
    const d = Math.hypot(c.ped.x - x, c.ped.z - z);
    if (d < 11) knockPed(c.ped, ((c.ped.x - x) / (d || 1)) * (16 - d), ((c.ped.z - z) / (d || 1)) * (16 - d));
  }
  if (source && source === player.vehicle) killPlayer();
  else if (!player.vehicle) {
    player.health -= blastDamage(dPlayer, 11, 95);
    if (player.health <= 0) killPlayer();
  }
}

// ---------------------------------------------------------------- missions, garage, paint shop

const STORY = storyMissions(layout.n);
const RACE = raceMission(layout.n);
const runner = new MissionRunner();
const missionCars = new Map<string, Vehicle>();
const contactMarker = new ZoneMarker(scene, 0xffd32a, "!", 4);
const raceMarker = new ZoneMarker(scene, 0xff9f43, "З", 5);
const garageMarker = new ZoneMarker(scene, 0x7bed9f, "Г", 5);
const paintMarker = new ZoneMarker(scene, 0x48dbfb, "П", 5);
const shopMarker = new ZoneMarker(scene, 0xc56cf0, "А", 4);
const depotMarker = new ZoneMarker(scene, 0xe1b12c, "Д", 5);
const goalMarker = new ZoneMarker(scene, 0xffd32a, "★", 6);
const beam = new BeamMarker(scene, 0xff9f43, 9);
const beamNext = new BeamMarker(scene, 0xff9f43, 9);
const targetArrow = new TargetArrow(scene);
garageMarker.show(PLACES.garage.x, PLACES.garage.z);
paintMarker.show(PLACES.paint.x, PLACES.paint.z);
shopMarker.show(PLACES.shop.x, PLACES.shop.z);
const PAINT_COST = 150;
const inside = { contact: false, race: false, garage: false, paint: false, shop: false, depot: false };
let objectiveText = "";
let briefTimer = 0;
let autosaveTimer = 20;
/** simTime of the last mission end; the garage and paint zones ignore that frame. */
let missionEndedAt = -1e9;

function nextStory(): Mission | undefined {
  return STORY.find((m) => !save.missionsDone.includes(m.id));
}

function addMoney(amount: number): void {
  save.money = Math.max(0, save.money + amount);
  moneyEl.classList.remove("pulse");
  void moneyEl.offsetWidth;
  moneyEl.classList.add("pulse");
}

function startMission(m: Mission): void {
  for (const [key, spec] of Object.entries(m.spawns ?? {})) {
    const v = addVehicle(makeCar(spec.x, spec.z, spec.heading), spec.kind, spec.color, null);
    if (spec.drives) {
      v.ai = trafficFor(v);
      v.input = v.ai.input;
    }
    v.missionKey = key;
    missionCars.set(key, v);
  }
  $("#brief-title").textContent = m.title;
  $("#brief-text").textContent = m.brief;
  briefTimer = 7;
  handleMissionEvents(runner.start(m));
}

function endMission(): void {
  missionEndedAt = simTime;
  for (const v of missionCars.values()) v.missionKey = null;
  missionCars.clear();
  objectiveText = "";
  goalMarker.hide();
  beam.hide();
  beamNext.hide();
  targetArrow.hide();
}

function failMission(reason: string): void {
  if (runner.active) handleMissionEvents(runner.fail(reason));
}

function handleMissionEvents(events: MissionEvent[]): void {
  for (const e of events) {
    switch (e.type) {
      case "step":
        objectiveText = e.text;
        // Passenger gets in once the taxi stops beside them.
        if (taxi && e.index === 1 && taxi.passenger) taxi.passenger.state = "gone";
        break;
      case "checkpoint":
        audio.alert();
        showBanner(`Точка ${e.index} из ${e.total}`);
        break;
      case "heat":
        wanted.atLeast(e.stars);
        audio.alert();
        break;
      case "done": {
        if (e.mission.id === "taxi" && taxi?.fare) {
          const pay = taxiFare(taxi.fare.distance, (e.mission.time ?? 0) - e.time, e.mission.time ?? 0);
          addMoney(pay);
          taxi.fares++;
          taxi.earned += pay;
          if (player.vehicle) {
            const door = sideDoor(player.vehicle.state, 2.2);
            emergePed(door.x, door.z, { x: door.x, z: door.z - 10 });
          }
          persist();
          endMission();
          showBanner(`Поездка оплачена: +$${pay}`);
          setTimeout(() => {
            if (taxi && !runner.active) nextFare();
          }, 1500);
          break;
        }
        addMoney(e.reward);
        save.stats.missions++;
        let extra = "";
        if (e.mission.id === RACE.id) {
          const best = save.bestRace === null || e.time < save.bestRace;
          if (best) save.bestRace = e.time;
          extra = ` · ${e.time.toFixed(1)} с${best ? " — рекорд!" : ""}`;
        } else if (e.mission.id !== "courier" && !save.missionsDone.includes(e.mission.id)) {
          save.missionsDone.push(e.mission.id);
        }
        persist();
        endMission();
        showBanner(`Миссия выполнена: +$${e.reward}${extra}`);
        if (!nextStory() && e.mission.id !== RACE.id) setTimeout(() => showBanner("Сюжет пройден. Город ваш."), 4000);
        break;
      }
      case "fail":
        endMission();
        if (taxi) endTaxiShift(e.reason);
        else showBanner(`Провал: ${e.reason}`);
        break;
      default:
        break;
    }
  }
}

/** Fire once when the player enters a zone, not every frame they stay in it. */
function entered(key: keyof typeof inside, x: number, z: number, r: number, ok: boolean): boolean {
  const isIn = ok && Math.hypot(player.x - x, player.z - z) < r;
  const fired = isIn && !inside[key];
  inside[key] = isIn;
  return fired;
}

function updateMissions(dt: number): void {
  if (player.dead > 0) return;
  const v = player.vehicle;
  const slow = !v || speedOf(v.state) < 5;
  if (runner.active) {
    const destroyed = new Set<string>();
    const positions: Record<string, { x: number; z: number }> = {};
    for (const [key, mv] of missionCars) {
      if (mv.state.burning || mv.state.wrecked) destroyed.add(key);
      positions[key] = { x: mv.state.x, z: mv.state.z };
    }
    handleMissionEvents(
      runner.update({ x: player.x, z: player.z, vehicle: v ? v.missionKey ?? "any" : null, stars: wanted.level, speed: v ? speedOf(v.state) : player.speed, destroyed }, dt),
    );
  } else {
    const story = nextStory();
    if (story && entered("contact", PLACES.contact.x, PLACES.contact.z, 5, slow)) startMission(story);
    else if (entered("race", PLACES.race.x, PLACES.race.z, 6, !!v && slow)) startMission(RACE);
  }

  // A mission that just ended in a zone must not also trigger it; wait until the player leaves.
  if (simTime - missionEndedAt < 0.5) {
    inside.garage = inside.garage || Math.hypot(player.x - PLACES.garage.x, player.z - PLACES.garage.z) < 6;
    inside.paint = inside.paint || Math.hypot(player.x - PLACES.paint.x, player.z - PLACES.paint.z) < 6;
  }
  if (v && entered("garage", PLACES.garage.x, PLACES.garage.z, 6, speedOf(v.state) < 3)) {
    if (v.police || v.missionKey) showBanner("Эту машину в гараж не поставить");
    else if (v.garaged) showBanner("Машина уже в гараже");
    else {
      storeInGarage(save, { kind: v.kind, color: v.visual.baseColor.getHex(), mods: { ...v.mods } });
      v.garaged = true;
      persist();
      showBanner("Машина в гараже");
    }
  }
  if (v && entered("paint", PLACES.paint.x, PLACES.paint.z, 6, speedOf(v.state) < 3)) {
    if (v.police) showBanner("Полицейскую машину здесь не возьмут");
    else openWorkshop(v);
  }
  if (!runner.active && entered("shop", PLACES.shop.x, PLACES.shop.z, 5, !v || speedOf(v.state) < 3)) openShop();
  if (!runner.active && v && entered("depot", PLACES.depot.x, PLACES.depot.z, 6, speedOf(v.state) < 4)) {
    startMission(makeCourierRun(rng, roadPoints, PLACES.depot));
  }
  if (v && !runner.active && v.kind === "taxi" && input.justPressed("KeyJ")) startTaxiShift();
  if (taxi && runner.active && runner.mission?.id === "taxi" && (!v || v.kind !== "taxi")) failMission("вы вышли из такси");

  autosaveTimer -= dt;
  if (autosaveTimer <= 0) {
    autosaveTimer = 20;
    persist();
  }
}

// ---------------------------------------------------------------- jobs, shop, workshop

const roadPoints: Array<{ x: number; z: number }> = layout.intersections.map((it) => ({ x: it.x, z: it.z }));
const curbside = walkGraph.nodes;
let taxi: { fares: number; earned: number; fare: TaxiFare | null; passenger: Ped | null } | null = null;

function startTaxiShift(): void {
  taxi = { fares: 0, earned: 0, fare: null, passenger: null };
  showBanner("Смена такси началась");
  nextFare();
}

function nextFare(): void {
  if (!taxi || !player.vehicle) return;
  const fare = makeTaxiFare(rng, curbside, { x: player.x, z: player.z });
  taxi.fare = fare;
  // Put a waiting passenger at the kerb.
  const p = peds.find((q) => q.state === "gone") ?? peds.reduce((a, b) => (Math.hypot(a.x - player.x, a.z - player.z) > Math.hypot(b.x - player.x, b.z - player.z) ? a : b));
  p.x = fare.pickup.x;
  p.z = fare.pickup.z;
  p.y = 0;
  p.vx = p.vy = p.vz = 0;
  p.fall = 0;
  p.speed = 0;
  p.state = "wait";
  taxi.passenger = p;
  handleMissionEvents(runner.start(fare.mission));
}

function endTaxiShift(reason: string): void {
  if (!taxi) return;
  if (taxi.passenger && taxi.passenger.state === "wait") taxi.passenger.state = "walk";
  const t = taxi;
  taxi = null;
  showBanner(`Смена окончена: ${reason}. Заказов ${t.fares}, заработано $${t.earned}`);
}

interface MenuItem {
  label: string;
  note?: string;
  price?: number;
  owned?: boolean;
  action: () => void;
}

const menuEl = $<HTMLDivElement>("#menu");
function openMenu(title: string, items: MenuItem[]): void {
  paused = true;
  input.endFrame();
  menuEl.classList.remove("hidden");
  const list = items
    .map((it, i) => {
      const cant = !it.owned && it.price !== undefined && save.money < it.price;
      const right = it.owned ? "установлено" : it.price !== undefined ? `$${it.price.toLocaleString("ru-RU")}` : "";
      return `<button class="menu-item" data-i="${i}" ${it.owned || cant ? "disabled" : ""}><span><b>${it.label}</b>${it.note ? `<small>${it.note}</small>` : ""}</span><span class="price">${right}</span></button>`;
    })
    .join("");
  menuEl.innerHTML = `<div class="card"><h2>${title}</h2><p class="bal">На счету $${save.money.toLocaleString("ru-RU")}</p><div class="menu-list">${list}</div><div class="start-buttons"><button class="secondary" data-close>Закрыть</button></div></div>`;
  menuEl.querySelectorAll<HTMLButtonElement>(".menu-item").forEach((b) =>
    b.addEventListener("click", () => {
      items[Number(b.dataset.i)].action();
    }),
  );
  menuEl.querySelector("[data-close]")!.addEventListener("click", closeMenu);
}
function closeMenu(): void {
  menuEl.classList.add("hidden");
  input.endFrame();
  paused = false;
}

/** Keep the garage copy of a car in sync after paint or mods. */
function syncGarageEntry(v: Vehicle, oldColor: number): void {
  if (!v.garaged) return;
  const entry = save.garage.find((c) => c.kind === v.kind && c.color === oldColor);
  if (entry) {
    entry.color = v.visual.baseColor.getHex();
    entry.mods = { ...v.mods };
  }
}

function openShop(): void {
  openMenu(
    "Автосалон «Причал»",
    SHOP.map((c) => ({
      label: c.name,
      note: `${Math.round(CAR_SPECS[c.kind].maxSpeed * 3.6)} км/ч`,
      price: c.price,
      action: () => {
        const left = buy(save.money, c.price);
        if (left === null) return;
        save.money = left;
        const lot = PLACES.shopLot;
        const car = addVehicle(makeCar(lot.x, lot.z, lot.heading), c.kind, c.color, null);
        car.garaged = true;
        storeInGarage(save, { kind: c.kind, color: c.color, mods: { ...NO_MODS } });
        persist();
        closeMenu();
        showBanner(`Куплено: ${c.name}. Машина у салона и в гараже`);
      },
    })),
  );
}

function openWorkshop(v: Vehicle): void {
  const items: MenuItem[] = [
    {
      label: "Ремонт и покраска",
      note: "Чинит, тушит и сбивает розыск, если вас не видят",
      price: PAINT_COST,
      action: () => {
        if (buy(save.money, PAINT_COST) === null) return;
        addMoney(-PAINT_COST);
        const old = v.visual.baseColor.getHex();
        v.state.health = 100;
        v.state.burning = false;
        v.state.fire = 0;
        v.visual.baseColor.setHex(rng.pick(COLORS));
        syncGarageEntry(v, old);
        const hidden = wanted.level > 0 && !policeCanSee(player.x, player.z);
        if (hidden) {
          wanted.clear();
          standDown();
        }
        persist();
        closeMenu();
        showBanner(hidden ? "Новый цвет. Полиция вас потеряла" : wanted.level > 0 ? "Отремонтировано, но полиция всё видела" : "Машина как новая");
      },
    },
    ...MOD_SHOP.map((m) => ({
      label: m.name,
      note: m.note,
      price: m.price,
      owned: v.mods[m.key],
      action: () => {
        if (v.mods[m.key] || buy(save.money, m.price) === null) return;
        addMoney(-m.price);
        v.mods[m.key] = true;
        syncGarageEntry(v, v.visual.baseColor.getHex());
        persist();
        openWorkshop(v);
        showBanner(`Установлено: ${m.name.toLowerCase()}`);
      },
    })),
  ];
  openMenu("Мастерская", items);
}

function syncMissionVisuals(dt: number): void {
  const story = nextStory();
  if (!runner.active && story) contactMarker.show(PLACES.contact.x, PLACES.contact.z);
  else contactMarker.hide();
  if (!runner.active) raceMarker.show(PLACES.race.x, PLACES.race.z);
  else raceMarker.hide();
  if (!runner.active) depotMarker.show(PLACES.depot.x, PLACES.depot.z);
  else depotMarker.hide();
  goalMarker.hide();
  beam.hide();
  beamNext.hide();
  targetArrow.hide();
  const step = runner.currentStep;
  if (step?.kind === "goto") goalMarker.show(step.at.x, step.at.z);
  if (step?.kind === "race") {
    const p = step.points[runner.checkpoint];
    const q = step.points[runner.checkpoint + 1];
    if (p) beam.show(p.x, p.z, true);
    if (q) beamNext.show(q.x, q.z, false);
  }
  if (step && (step.kind === "enter" || step.kind === "destroy")) {
    const mv = missionCars.get(step.target);
    if (mv && mv !== player.vehicle) targetArrow.show(mv.state.x, mv.state.z, step.kind === "destroy" ? 0xff4d6d : 0x7bed9f, dt);
  }
  for (const m of [contactMarker, raceMarker, garageMarker, paintMarker, goalMarker, shopMarker, depotMarker]) m.update(dt);
}

// ---------------------------------------------------------------- simulation

let lastCrash = 0;
let recycleTimer = 0;

function playerTarget() {
  const v = player.vehicle;
  if (v) return { x: v.state.x, z: v.state.z, vx: v.state.vx, vz: v.state.vz };
  return { x: player.x, z: player.z, vx: Math.cos(player.heading) * player.speed, vz: Math.sin(player.heading) * player.speed };
}

function update(dt: number, now: number): void {
  simTime += dt;
  clock = wrapHour(clock + dt / SECONDS_PER_HOUR);
  if (weather.update(dt)) showBanner(`${WEATHER_ICON[weather.kind]} ${WEATHER_NAMES[weather.kind]}`);
  visibility = Weather.visibility(lightingAt(clock).night, weather.rain);
  if (weather.kind === "storm") {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningTimer = 6 + Math.random() * 10;
      lightningFlash = 0.35;
      audio.thunder(0.4 + Math.random() * 1.6);
    }
  }
  audio.rain(weather.rain);
  radio.update(!!player.vehicle && player.dead === 0 && !audio.muted);
  if (input.justPressed("KeyC")) cameraMode = (cameraMode + 1) % 2;
  if (input.justPressed("Escape") && touch.enabled) setPaused(true);
  if (input.justPressed("KeyR")) {
    const name = radio.next();
    save.radio = radio.station;
    persist();
    showBanner(radio.station >= 0 ? `📻 ${name}` : name);
  }
  if (input.justPressed("KeyM")) {
    audio.muted = !audio.muted;
    save.muted = audio.muted;
    persist();
  }

  const threats: Threat[] = [];

  if (player.dead > 0) {
    player.dead -= dt;
    if (player.dead <= 0) respawnPlayer();
  } else if (player.vehicle) {
    const v = player.vehicle;
    v.blame = simTime;
    v.input.throttle = input.mixed(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"], input.analog.y);
    v.input.steer = input.mixed(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"], input.analog.x);
    v.input.handbrake = input.isDown("Space");
    v.input.brake = false;
    if (input.isDown("KeyH")) threats.push({ x: v.state.x, z: v.state.z, radius: 14 });
    if (v.state.burning) {
      player.health -= dt * 6;
      if (player.health <= 0) killPlayer();
    }
    if (input.justPressed("KeyE", "KeyF") && speedOf(v.state) < 6) exitVehicle();
  } else {
    const stickMag = Math.hypot(input.analog.x, input.analog.y);
    const run = input.isDown("ShiftLeft", "ShiftRight") || stickMag > 0.92;
    const fwd = input.mixed(["KeyS", "ArrowDown"], ["KeyW", "ArrowUp"], input.analog.y);
    const turn = input.mixed(["KeyA", "ArrowLeft"], ["KeyD", "ArrowRight"], input.analog.x);
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
    // Analog sticks walk slower when pushed only part-way.
    const effort = Math.min(1, Math.max(Math.abs(fwd), Math.abs(turn), stickMag));
    const targetSpeed = fwd || turn ? (run ? 7.5 : 3.2 * Math.max(0.4, effort)) : 0;
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
    if (s.burning && v !== player.vehicle && (v.ai || (v.police && v.police.mode !== "patrol"))) {
      // The driver bails out of a burning car.
      const door = sideDoor(s, 2.2);
      emergePed(door.x, door.z, s);
      v.ai = null;
      if (v.police) v.police.mode = "patrol";
      v.input = { throttle: 0, steer: 0, brake: true, handbrake: true };
    }
    if (v.police && v !== player.vehicle && !s.wrecked && !s.burning) {
      if (v.police.mode === "pursuit" && !player.dead) {
        v.input = policeDrive(s, v.police, layout, playerTarget(), dt);
        // Drop a cop off when the player is on foot nearby.
        if (!player.vehicle && !v.police.copOut && speedOf(s) < 5 && Math.hypot(s.x - player.x, s.z - player.z) < 16) {
          const door = sideDoor(s, 2.2);
          spawnCop(door.x, door.z);
          v.police.copOut = true;
        }
      } else if (v.police.mode === "roadblock") {
        v.input = { throttle: 0, steer: 0, brake: true, handbrake: true };
        if (wanted.level > 0 && Math.hypot(s.x - player.x, s.z - player.z) < 25) v.police.mode = "pursuit";
      } else if (v.police.mode === "pursuit") {
        v.input = { throttle: 0, steer: 0, brake: true, handbrake: false };
      }
    }
    if (s.wrecked) {
      v.input.throttle = 0;
      v.input.steer = 0;
      v.input.handbrake = true;
      v.wreckAge += dt;
    }
    if (v.ai) driveTraffic(v.ai, layout, rng, obstaclesFor(v), dt);
    stepCar(s, moddedSpec(specFor(v.kind), v.mods), v.input, dt);
    const push = resolveCircleVsBuildings(layout, s.x, s.z, v.radius * 0.85);
    if (push) {
      const hpBefore = s.health;
      const dmg = collideCar(s, push.x, push.z);
      if (v.mods.armor) s.health = Math.min(100, hpBefore - (hpBefore - s.health) * armorFactor(v.mods));
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
      const sa = speedOf(a.state);
      const sb = speedOf(b.state);
      const before = sa + sb;
      const ha = a.state.health;
      const hb = b.state.health;
      if (separateCars(a.state, b.state, a.radius, b.radius)) {
        if (a.mods.armor) a.state.health = ha - (ha - a.state.health) * armorFactor(a.mods);
        if (b.mods.armor) b.state.health = hb - (hb - b.state.health) * armorFactor(b.mods);
        const after = speedOf(a.state) + speedOf(b.state);
        const pv = a === player.vehicle ? a : b === player.vehicle ? b : null;
        if (pv) {
          const other = pv === a ? b : a;
          other.blame = simTime;
          // Only the player's own ramming counts; being rammed by the police is not a crime.
          const mine = pv === a ? sa : sb;
          const theirs = pv === a ? sb : sa;
          if (other.police && before - after > 4 && mine > 6 && mine > theirs) crime("ramCop", other.state.x, other.state.z, false);
        }
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
        if (v === player.vehicle) crime("hitPed", p.x, p.z, true);
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

  stepCops(dt);
  managePolice(dt);
  updateMissions(dt);

  recycleTimer -= dt;
  if (recycleTimer <= 0) {
    recycleTimer = 0.5;
    recyclePeds(4);
    for (const v of vehicles) {
      if (v.state.wrecked && !v.missionKey && v.wreckAge > 40 && Math.hypot(v.state.x - player.x, v.state.z - player.z) > 90) recycleAsTraffic(v);
    }
    // Send surplus police home once they are far away.
    let patrolsKept = 0;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      if (!v.police || v === player.vehicle || v.state.wrecked) continue;
      const far = Math.hypot(v.state.x - player.x, v.state.z - player.z) > 230;
      const surplus = v.police.mode === "roadblock" ? wanted.level === 0 || far : v.police.mode === "patrol" && ++patrolsKept > PATROLS;
      if (far && surplus) {
        scene.remove(v.visual.group);
        vehicles.splice(i, 1);
      }
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
  let sirenD = Infinity;
  for (const v of vehicles) {
    if (isActivePolice(v) && v.police!.mode !== "patrol") sirenD = Math.min(sirenD, Math.hypot(v.state.x - player.x, v.state.z - player.z));
  }
  audio.siren(sirenD, simTime);
  if (banner.ttl > 0) banner.ttl -= dt;
  if (briefTimer > 0) briefTimer -= dt;

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
  // The sun sweeps east to west with the clock; at night a high moon casts soft light.
  const L = lightingAt(clock);
  if (L.sunElevation > 0) {
    const el = Math.max(0.2, L.sunElevation);
    const az = ((wrapHour(clock) - 6) / 12) * Math.PI;
    const r = 150;
    sun.position.set(tx + Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, tz + Math.cos(el) * r * 0.35);
  } else {
    sun.position.set(tx + 50, 120, tz + 60);
  }
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
    flashSiren(v.visual, !!v.police && v.police.mode !== "patrol" && !v.state.wrecked && v !== player.vehicle, simTime);
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
  for (const c of cops) {
    const p = c.ped;
    c.vis.group.position.set(p.x, ground(p.x, p.z) + p.y, p.z);
    c.vis.group.rotation.y = -p.heading + Math.PI / 2;
    animatePedestrian(c.vis, p.speed, dt, p.fall);
  }
  heli.update(dt, player.x, player.z);
  syncMissionVisuals(dt);
  applyAtmosphere(dt);
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
  if (player.dead > 0) hintEl.textContent = "";
  else if (v && v.state.burning) hintEl.textContent = speedOf(v.state) < 6 ? k("Машина горит! E — выйти", "Машина горит! Жмите «Сесть», чтобы выйти") : "Машина горит! Тормозите и выходите";
  else if (v && v.kind === "taxi" && !runner.active) hintEl.textContent = k("J — начать смену такси", "Жмите «Работа», чтобы взять заказы");
  else if (v) hintEl.textContent = touch.enabled ? "" : speedOf(v.state) < 6 ? "E — выйти · Пробел — ручник · H — сигнал · R — радио" : "Пробел — ручник · C — камера";
  else if (bustTimer > 0.2) hintEl.textContent = "Вас задерживают! Уезжайте или бегите";
  else hintEl.textContent = nearestEnterable() ? k("E — сесть в машину", "Жмите «Сесть»") : touch.enabled ? "" : "WASD — идти · Shift — бежать";
  touch.setMode(!!v, !!nearestEnterable(), !!v && v.kind === "taxi" && !runner.active);
  hintEl.classList.toggle("alert", (!!v && v.state.burning) || bustTimer > 0.2);
  const stars = starsEl.children;
  for (let i = 0; i < stars.length; i++) stars[i].classList.toggle("on", i < wanted.level);
  starsEl.classList.toggle("searching", wanted.searching);
  starsEl.style.setProperty("--escape", String(wanted.escapeProgress()));
  bannerEl.textContent = banner.text;
  bannerEl.classList.toggle("show", banner.ttl > 0);
  moneyEl.textContent = `$${save.money.toLocaleString("ru-RU")}`;
  const icon = weather.kind === "clear" && lightingAt(clock).night > 0.5 ? "☾" : WEATHER_ICON[weather.kind];
  clockEl.textContent = `${icon} ${formatClock(clock)}`;
  briefEl.classList.toggle("show", briefTimer > 0 && runner.active);
  const left = runner.timeLeft;
  const timer = left === null ? "" : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
  const jobTitle = taxi && runner.mission?.id === "taxi" ? `Такси · заказ ${taxi.fares + 1} · $${taxi.earned}` : runner.mission?.title ?? "";
  objectiveEl.innerHTML = runner.active ? `<b>${jobTitle}</b> ${objectiveText}${timer ? ` <span class="${left! < 20 ? "hot" : ""}">${timer}</span>` : ""}` : "";
  const targets: Record<string, { x: number; z: number }> = {};
  for (const [key, mv] of missionCars) targets[key] = { x: mv.state.x, z: mv.state.z };
  const goal = runner.active ? runner.objective(targets) : null;
  if (goal) {
    const camYaw = Math.atan2(camLook.z - camPos.z, camLook.x - camPos.x);
    const rel = Math.atan2(goal.z - player.z, goal.x - player.x) - camYaw;
    const dist = Math.hypot(goal.x - player.x, goal.z - player.z);
    arrowEl.style.display = "flex";
    (arrowEl.firstElementChild as HTMLElement).style.transform = `rotate(${rel}rad)`;
    (arrowEl.lastElementChild as HTMLElement).textContent = `${Math.round(dist)} м`;
  } else arrowEl.style.display = "none";
  const blink = Math.floor(simTime * 4) % 2 === 0;
  const dots = vehicles.map((x) => ({
    x: x.state.x,
    z: x.state.z,
    color:
      x === v ? "#ffd32a"
      : x.state.wrecked ? "#555"
      : x.state.burning ? "#ff6b3a"
      : x.police && x.police.mode !== "patrol" ? (blink ? "#ff3b3b" : "#3b7bff")
      : x.police ? "#9ab8ff"
      : x.ai ? "#dfe6e9"
      : "#74b9ff",
  }));
  for (const c of cops) dots.push({ x: c.ped.x, z: c.ped.z, color: "#3b7bff" });
  if (heli.active) dots.push({ x: heli.x, z: heli.z, color: blink ? "#ff3b3b" : "#ffffff" });
  const icons: Array<{ x: number; z: number; color: string; label: string; clamp?: boolean }> = [
    { ...PLACES.garage, color: "#7bed9f", label: "Г" },
    { ...PLACES.paint, color: "#48dbfb", label: "П" },
    { ...PLACES.shop, color: "#c56cf0", label: "А" },
  ];
  if (!runner.active) {
    if (nextStory()) icons.push({ ...PLACES.contact, color: "#ffd32a", label: "!", clamp: true });
    icons.push({ ...PLACES.race, color: "#ff9f43", label: "З" });
    icons.push({ ...PLACES.depot, color: "#e1b12c", label: "Д" });
  }
  if (goal) icons.push({ ...goal, color: "#ffd32a", label: "★", clamp: true });
  minimap.draw(player.x, player.z, v ? v.state.heading : player.heading, dots, icons);
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
  if (paused) radio.update(false);
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
    wanted,
    setWanted: (n: number) => wanted.atLeast(n),
    heli,
    cops,
    police: () => vehicles.filter((v) => v.police).map((v) => ({ mode: v.police!.mode, x: Math.round(v.state.x), z: Math.round(v.state.z), d: Math.round(Math.hypot(v.state.x - player.x, v.state.z - player.z)), wrecked: v.state.wrecked })),
    bust: () => bustTimer,
    flags: debugFlags,
    runner,
    setTime: (h: number) => (clock = h),
    setWeather: (k: WeatherKind) => {
      weather.set(k);
    },
    weather,
    radio,
    save: () => save,
    places: PLACES,
    missionCars,
    taxi: () => taxi,
    openShop,
    startMission: (id: string) => {
      const m = [...STORY, RACE].find((x) => x.id === id);
      if (m && !runner.active) startMission(m);
    },
    perf,
    drawCalls: () => renderer.info.render.calls,
    start: () => $("#btn-start").click(),
    started: () => started,
  };
}
