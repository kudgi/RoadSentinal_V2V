import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const MAP_URL = "map/Barnim_small.net.xml";
const REPLAY_URL = "data/output.csv";
const SUMO_OFFSET = { x: 395635.35, y: 5826456.24 };
const $ = (id) => document.getElementById(id);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06131f);
scene.fog = new THREE.Fog(0x06131f, 900, 4200);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 0.85));
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
scene.add(new THREE.HemisphereLight(0xb9ddff, 0x16241d, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(-500, 1200, 700);
scene.add(sun);

const roads = new THREE.Group();
const vehiclesGroup = new THREE.Group();
const effects = new THREE.Group();
scene.add(roads, vehiclesGroup, effects);

let frames = [];
let events = [];
let vehicles = new Map();
let simTime = 0;
let playing = false;
let playbackSpeed = 3;
let previousAnimationTime = performance.now();
let eventIndex = 0;
let pulses = [];
let mapCenter = { x: 0, y: 0 };

function parsePointList(shape) {
  return shape.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

function parseSumo(text) {
  const lanePattern = /<lane\b[^>]*\bshape="([^"]+)"[^>]*\/?\s*>/g;
  const lanes = [];
  let match;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  while ((match = lanePattern.exec(text))) {
    const points = parsePointList(match[1]);
    if (points.length < 2) continue;
    lanes.push(points);
    for (const point of points) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
  }
  if (!lanes.length) throw new Error("No SUMO lane shapes found");

  mapCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const positions = [];
  for (const points of lanes) {
    for (let index = 0; index < points.length - 1; index += 1) {
      positions.push(
        points[index].x - mapCenter.x, 0.1, -(points[index].y - mapCenter.y),
        points[index + 1].x - mapCenter.x, 0.1, -(points[index + 1].y - mapCenter.y)
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  roads.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x7b8d97, transparent: true, opacity: 0.78 })));

  const width = maxX - minX;
  const height = maxY - minY;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.25, height * 1.25),
    new THREE.MeshStandardMaterial({ color: 0x20352c, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  roads.add(ground);

  const span = Math.max(width, height);
  camera.position.set(span * 0.28, span * 0.23, span * 0.3);
  controls.target.set(0, 0, 0);
  controls.update();
  return lanes.length;
}

function latLonToUtm(lat, lon) {
  const a = 6378137, e = 0.081819190842622, k = 0.9996, zone = 33;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
  const e2 = e * e, ep2 = e2 / (1 - e2);
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2, c = ep2 * Math.cos(phi) ** 2;
  const alpha = Math.cos(phi) * (lambda - lon0);
  const m = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  return {
    x: k * n * (alpha + (1 - t + c) * alpha ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * alpha ** 5 / 120) + 500000,
    y: k * (m + n * Math.tan(phi) * (alpha ** 2 / 2 + (5 - t + 9 * c + 4 * c * c) * alpha ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * alpha ** 6 / 720))
  };
}

function worldPosition(lat, lon) {
  const utm = latLonToUtm(lat, lon);
  const sumoX = utm.x - SUMO_OFFSET.x;
  const sumoY = utm.y - SUMO_OFFSET.y;
  return { x: sumoX - mapCenter.x, z: -(sumoY - mapCenter.y) };
}

function csvRow(line) {
  return line.split(";").map((value) => value.replace(/^"|"$/g, ""));
}

function parseMosaic(text) {
  const byTime = new Map();
  const ids = new Set();
  events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const values = csvRow(line);
    const type = values[0];
    const time = Number(values[1]);
    if (type === "VEHICLE_UPDATES") {
      const update = { t: time, id: values[2], speed: Number(values[3]), heading: Number(values[4]), lat: Number(values[5]), lon: Number(values[6]) };
      if (!Number.isFinite(update.lat) || !Number.isFinite(update.lon)) continue;
      if (!byTime.has(time)) byTime.set(time, []);
      byTime.get(time).push(update);
      ids.add(update.id);
    } else if (type === "V2X_MESSAGE_TRANSMISSION") {
      events.push({ t: time, type: "tx", id: values[4], lat: Number(values[5]), lon: Number(values[6]), message: values[2] });
    } else if (type === "V2X_MESSAGE_RECEPTION") {
      events.push({ t: time, type: "rx", id: values[4], message: values[2] });
    }
  }
  frames = [...byTime].sort((a, b) => a[0] - b[0]).map(([t, list]) => ({ t, list }));
  events.sort((a, b) => a.t - b.t);
  $("vehicles").textContent = ids.size;
  $("data").textContent = `${frames.length} FRAMES · ${events.length} V2X`;
  if (!frames.length) throw new Error("No MOSAIC vehicle frames found");
}

function makeVehicle(id) {
  const number = Number(id.replace(/\D/g, "")) || 0;
  const vehicle = new THREE.Group();
  const palette = [0xe43f4f, 0xf5f7f8, 0x42aef0, 0xf0b35f, 0x61cea5, 0xbe9eff];
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 4.8), new THREE.MeshStandardMaterial({ color: palette[number % palette.length], roughness: 0.35, metalness: 0.15 }));
  body.position.y = 0.65;
  vehicle.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.55, 2.1), new THREE.MeshStandardMaterial({ color: 0x1d3443, roughness: 0.25 }));
  roof.position.y = 1.25;
  vehicle.add(roof);
  vehiclesGroup.add(vehicle);
  return vehicle;
}

function updateFrame(frame) {
  const seen = new Set();
  for (const data of frame.list) {
    seen.add(data.id);
    let vehicle = vehicles.get(data.id);
    if (!vehicle) {
      vehicle = makeVehicle(data.id);
      vehicles.set(data.id, vehicle);
    }
    const position = worldPosition(data.lat, data.lon);
    vehicle.position.set(position.x, 0, position.z);
    vehicle.rotation.y = -data.heading * Math.PI / 180;
    vehicle.visible = true;
    vehicle.userData.speed = data.speed;
  }
  for (const [id, vehicle] of vehicles) if (!seen.has(id)) vehicle.visible = false;
  $("time").textContent = `${(frame.t / 1e9).toFixed(1)}s`;
}

function pulseAt(x, z, type) {
  const color = type === "tx" ? 0xff4e5c : 0x31c8ff;
  const pulse = new THREE.Mesh(new THREE.RingGeometry(4, 5.4, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.set(x, 0.25, z);
  pulse.userData.age = 0;
  effects.add(pulse);
  pulses.push(pulse);
}

function showEvent(event) {
  let position;
  if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) position = worldPosition(event.lat, event.lon);
  else {
    const vehicle = vehicles.get(event.id);
    if (vehicle) position = { x: vehicle.position.x, z: vehicle.position.z };
  }
  if (!position) return;
  pulseAt(position.x, position.z, event.type);
  $(event.type).textContent = Number($(event.type).textContent) + 1;
  $("alert").classList.add("active");
  $("detail").textContent = `${event.message || "DENM"} ${event.type === "tx" ? "transmitted by" : "received by"} ${event.id}`;
}

function seek(target) {
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (frames[middle].t <= target) low = middle;
    else high = middle - 1;
  }
  simTime = target;
  updateFrame(frames[low]);
  while (eventIndex < events.length && events[eventIndex].t <= target) showEvent(events[eventIndex++]);
}

function reset() {
  playing = false;
  simTime = frames[0]?.t || 0;
  eventIndex = 0;
  $("tx").textContent = "0";
  $("rx").textContent = "0";
  $("alert").classList.remove("active");
  $("detail").textContent = "Waiting for verified MOSAIC DENM records.";
  for (const pulse of pulses) effects.remove(pulse);
  pulses = [];
  if (frames.length) seek(simTime);
}

function animate(now) {
  requestAnimationFrame(animate);
  const elapsed = Math.min(100, now - previousAnimationTime);
  previousAnimationTime = now;
  if (playing && frames.length) {
    const target = simTime + elapsed * 1e6 * playbackSpeed;
    if (target > frames.at(-1).t) reset();
    else seek(target);
  }
  for (let index = pulses.length - 1; index >= 0; index -= 1) {
    const pulse = pulses[index];
    pulse.userData.age += elapsed / 1000;
    pulse.scale.setScalar(1 + pulse.userData.age * 7);
    pulse.material.opacity = Math.max(0, 0.85 - pulse.userData.age * 0.85);
    if (pulse.userData.age > 1) {
      effects.remove(pulse);
      pulses.splice(index, 1);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

$("play").onclick = () => { playing = true; };
$("pause").onclick = () => { playing = false; };
$("reset").onclick = reset;
$("speed").oninput = (event) => {
  playbackSpeed = Number(event.target.value);
  $("speedValue").textContent = `${playbackSpeed}×`;
};
$("quality").onclick = () => {
  const button = $("quality");
  const next = button.textContent === "LOW" ? "MEDIUM" : button.textContent === "MEDIUM" ? "HIGH" : "LOW";
  button.textContent = next;
  renderer.setPixelRatio(Math.min(devicePixelRatio, next === "LOW" ? 0.75 : next === "MEDIUM" ? 1 : 1.3));
};
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

async function load() {
  try {
    const [mapResponse, replayResponse] = await Promise.all([fetch(MAP_URL), fetch(REPLAY_URL)]);
    if (!mapResponse.ok) throw new Error(`Rendering map unavailable (${mapResponse.status})`);
    if (!replayResponse.ok) throw new Error(`MOSAIC replay unavailable (${replayResponse.status})`);
    const laneCount = parseSumo(await mapResponse.text());
    parseMosaic(await replayResponse.text());
    $("map").textContent = `${laneCount} LANES`;
    $("status").textContent = "V2V-SIH MAP + MOSAIC REPLAY READY";
    reset();
  } catch (error) {
    $("status").textContent = `ERROR: ${error.message}`;
    console.error(error);
  }
}

load();
animate(performance.now());
