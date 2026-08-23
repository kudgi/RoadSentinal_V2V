import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CONFIG } from "./config.js";
import { enrichReceptionEvents } from "./risk.js";
import { buildVehicleTracks, sampleTrack } from "./tracks.js";
import { MosaicLiveClient } from "./live.js";

const $ = (id) => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bb6c5);
scene.fog = new THREE.FogExp2(0xb7c9d1, 0.00016);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.2, 14000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .47;
scene.add(new THREE.HemisphereLight(0xdbeeff, 0x506048, 2.2));
const sun = new THREE.DirectionalLight(0xfff4df, 2.5); sun.position.set(-900, 1500, 700); sun.castShadow = true; scene.add(sun);

const world = new THREE.Group(), vehicleLayer = new THREE.Group(), effectLayer = new THREE.Group(); scene.add(world, vehicleLayer, effectLayer);
const state = { frames: [], events: [], vehicles: new Map(), playing: false, speed: 3, time: 0, eventIndex: 0, lastNow: performance.now(), center: new THREE.Vector2(), autoCamera: true, cinematicUntil: 0, hazard: null, pulses: [], packets: [], lastTx: new Map(), source: "REPLAY", tracks: new Map(), eventPoints: [], overviewUntil: 0, freezeEffects: false, livePrevious: new Map(), liveClient: null, registered: new Set() };

function points(shape) { return shape.trim().split(/\s+/).map(v => { const [x, y] = v.split(",").map(Number); return new THREE.Vector2(x, -y); }); }
function ribbon(list, width, y, positions, colors, color) {
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i].clone().sub(state.center), b = list[i + 1].clone().sub(state.center), d = b.clone().sub(a).normalize(), n = new THREE.Vector2(-d.y, d.x).multiplyScalar(width / 2);
    const p = [a.clone().add(n), a.clone().sub(n), b.clone().add(n), b.clone().add(n), a.clone().sub(n), b.clone().sub(n)];
    for (const v of p) { positions.push(v.x, y, v.y); colors.push(color.r, color.g, color.b); }
  }
}
function meshFrom(positions, colors, roughness = 1) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: THREE.DoubleSide }));
}
function seeded(index) { const x = Math.sin(index * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function buildWorld(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml"); const laneNodes = [...doc.querySelectorAll("lane[shape]")];
  const lanes = laneNodes.map(n => ({ id: n.id, width: Number(n.getAttribute("width")) || 3.2, pts: points(n.getAttribute("shape")), internal: n.parentElement?.getAttribute("function") === "internal" }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const lane of lanes) for (const p of lane.pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  state.center.set((minX + maxX) / 2, (minY + maxY) / 2);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry((maxX-minX)*1.35,(maxY-minY)*1.35), new THREE.MeshStandardMaterial({color:0x54714f,roughness:1})); terrain.rotation.x=-Math.PI/2; terrain.position.y=-.18; terrain.receiveShadow=true; world.add(terrain);
  const shoulderP=[], shoulderC=[], roadP=[], roadC=[], markP=[], markC=[]; const asphalt=new THREE.Color(0x333a3d), shoulder=new THREE.Color(0x6e7472), marking=new THREE.Color(0xe7e4cf);
  for (const lane of lanes) { ribbon(lane.pts,lane.width+1.1,.01,shoulderP,shoulderC,shoulder); ribbon(lane.pts,lane.width,.045,roadP,roadC,asphalt); if(!lane.internal) ribbon(lane.pts,.10,.065,markP,markC,marking); }
  const shoulders=meshFrom(shoulderP,shoulderC); shoulders.receiveShadow=true; world.add(shoulders); const roads=meshFrom(roadP,roadC,.92); roads.receiveShadow=true; world.add(roads); world.add(meshFrom(markP,markC,.8));
  const junctionP=[],junctionC=[]; for(const j of doc.querySelectorAll("junction[shape]")){const ps=points(j.getAttribute("shape")||"");if(ps.length<3)continue;const c=ps.reduce((a,p)=>a.add(p),new THREE.Vector2()).multiplyScalar(1/ps.length).sub(state.center);for(let i=0;i<ps.length;i++){const a=ps[i].clone().sub(state.center),b=ps[(i+1)%ps.length].clone().sub(state.center);for(const v of [c,a,b]){junctionP.push(v.x,.055,v.y);junctionC.push(asphalt.r,asphalt.g,asphalt.b)}}} world.add(meshFrom(junctionP,junctionC,.92));
  buildEnvironment(lanes, doc);
  const span=Math.max(maxX-minX,maxY-minY); camera.position.set(span*.12,span*.10,span*.13); controls.target.set(0,0,0); controls.update();
  $("map").textContent=`${lanes.length} LANES`;
}

function buildEnvironment(lanes, doc) {
  const samples=[]; for(let i=0;i<lanes.length;i+=Math.max(1,Math.floor(lanes.length/260))){const lane=lanes[i];if(lane.internal||lane.pts.length<2)continue;const a=lane.pts[0],b=lane.pts[1],d=b.clone().sub(a).normalize(),n=new THREE.Vector2(-d.y,d.x),m=a.clone().lerp(b,.5).sub(state.center);samples.push({m,n,i});}
  const buildingGeo=new THREE.BoxGeometry(1,1,1), buildingMat=new THREE.MeshStandardMaterial({color:0xadb1ae,roughness:.88}); const buildings=new THREE.InstancedMesh(buildingGeo,buildingMat,samples.length); buildings.castShadow=true; buildings.receiveShadow=true;
  const trunkGeo=new THREE.CylinderGeometry(.25,.35,3,6), trunkMat=new THREE.MeshStandardMaterial({color:0x604733}); const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,samples.length);
  const crownGeo=new THREE.IcosahedronGeometry(1.8,1), crownMat=new THREE.MeshStandardMaterial({color:0x345f35,roughness:1}); const crowns=new THREE.InstancedMesh(crownGeo,crownMat,samples.length);
  const poleGeo=new THREE.CylinderGeometry(.07,.1,5,6),poleMat=new THREE.MeshStandardMaterial({color:0x596064,metalness:.5,roughness:.5});const poles=new THREE.InstancedMesh(poleGeo,poleMat,samples.length);
  const dummy=new THREE.Object3D(); let bi=0,ti=0,li=0; for(const s of samples){const side=seeded(s.i)>.5?1:-1, offset=13+seeded(s.i+3)*24, p=s.m.clone().add(s.n.clone().multiplyScalar(offset*side)); if(seeded(s.i+9)>.38){const w=8+seeded(s.i+4)*18,h=7+seeded(s.i+5)*28,d=8+seeded(s.i+6)*16;dummy.position.set(p.x,h/2,p.y);dummy.scale.set(w,h,d);dummy.rotation.y=seeded(s.i+7)*Math.PI;dummy.updateMatrix();buildings.setMatrixAt(bi++,dummy.matrix)}else{dummy.scale.set(1,1,1);dummy.rotation.set(0,0,0);dummy.position.set(p.x,1.5,p.y);dummy.updateMatrix();trunks.setMatrixAt(ti,dummy.matrix);dummy.position.y=4.5;dummy.scale.setScalar(.8+seeded(s.i+2)*.8);dummy.updateMatrix();crowns.setMatrixAt(ti++,dummy.matrix)}if(s.i%3===0){const lp=s.m.clone().add(s.n.clone().multiplyScalar(5.5*side));dummy.scale.set(1,1,1);dummy.rotation.set(0,0,0);dummy.position.set(lp.x,2.5,lp.y);dummy.updateMatrix();poles.setMatrixAt(li++,dummy.matrix)}}
  buildings.count=bi;trunks.count=ti;crowns.count=ti;poles.count=li;world.add(buildings,trunks,crowns,poles);
  const signalGeo=new THREE.BoxGeometry(.45,1.2,.35),red=new THREE.MeshStandardMaterial({color:0x20282a,emissive:0x551111}); for(const j of doc.querySelectorAll('junction[type="traffic_light"]')){const x=Number(j.getAttribute("x"))-state.center.x,z=-(Number(j.getAttribute("y"))) - state.center.y;if(!Number.isFinite(x+z))continue;const signal=new THREE.Mesh(signalGeo,red);signal.position.set(x,3,z);world.add(signal)}
}

function geoToWorld(lat,lon){const a=6378137,e=.081819190842622,k=.9996,lon0=15*Math.PI/180,p=lat*Math.PI/180,l=lon*Math.PI/180,e2=e*e,ep=e2/(1-e2),N=a/Math.sqrt(1-e2*Math.sin(p)**2),T=Math.tan(p)**2,C=ep*Math.cos(p)**2,A=Math.cos(p)*(l-lon0),M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*p-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*p)+(15*e2**2/256+45*e2**3/1024)*Math.sin(4*p)-(35*e2**3/3072)*Math.sin(6*p)),x=k*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120)+500000,y=k*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720));return new THREE.Vector3(x-CONFIG.sumoOffset.x-state.center.x,0,-(y-CONFIG.sumoOffset.y)-state.center.y)}
function row(line){return line.split(";").map(v=>v.replace(/^"|"$/g,""))}
function parseReplay(text){const times=new Map(),ids=new Set();state.events=[];for(const line of text.split(/\r?\n/)){if(!line)continue;const a=row(line),t=Number(a[1]);if(a[0]==="VEHICLE_UPDATES"){const v={t,id:a[2],speed:+a[3],heading:+a[4],lat:+a[5],lon:+a[6],accel:+a[8],braking:a.at(-1)==="true"};if(!Number.isFinite(v.lat+v.lon))continue;if(!times.has(t))times.set(t,[]);times.get(t).push(v);ids.add(v.id)}else if(a[0]==="V2X_MESSAGE_TRANSMISSION")state.events.push({t,type:"tx",message:a[3],name:a[2],id:a[4],lat:+a[5],lon:+a[6]});else if(a[0]==="V2X_MESSAGE_RECEPTION")state.events.push({t,type:"rx",message:a[3],name:a[2],id:a[4]})}state.frames=[...times].sort((a,b)=>a[0]-b[0]).map(([t,list])=>({t,list}));state.events.sort((a,b)=>a.t-b.t);state.tracks=buildVehicleTracks(state.frames);if(!state.frames.length)throw Error("No MOSAIC vehicle updates found");$("vehicles").textContent=ids.size;$("data").textContent=`${state.frames.length} FRAMES · ${state.events.length} V2X`}

const carShared={body:new THREE.BoxGeometry(2.05,.55,4.45),hood:new THREE.BoxGeometry(1.95,.32,1.15),cabin:new THREE.BoxGeometry(1.65,.62,2.05),bumper:new THREE.BoxGeometry(2.08,.24,.18),wheel:new THREE.CylinderGeometry(.38,.38,.24,12),glass:new THREE.MeshStandardMaterial({color:0x172b35,metalness:.25,roughness:.15}),tire:new THREE.MeshStandardMaterial({color:0x111315,roughness:.9}),brake:new THREE.MeshStandardMaterial({color:0x400000,emissive:0x220000})};
function makeCar(id){const n=+id.replace(/\D/g,"")||0,palette=[0xd92f42,0xe5eaec,0x258dd0,0xd8a338,0x42a878,0x885cc7],paint=new THREE.MeshStandardMaterial({color:palette[n%palette.length],metalness:.35,roughness:.28}),g=new THREE.Group();const body=new THREE.Mesh(carShared.body,paint);body.position.y=.63;body.castShadow=true;g.add(body);const hood=new THREE.Mesh(carShared.hood,paint);hood.position.set(0,.96,-1.42);g.add(hood);const cabin=new THREE.Mesh(carShared.cabin,carShared.glass);cabin.position.set(0,1.15,.15);g.add(cabin);for(const x of [-1.02,1.02])for(const z of [-1.35,1.35]){const w=new THREE.Mesh(carShared.wheel,carShared.tire);w.rotation.z=Math.PI/2;w.position.set(x,.42,z);g.add(w)}const lights=[];for(const x of [-.68,.68]){const l=new THREE.Mesh(carShared.bumper,carShared.brake.clone());l.scale.x=.24;l.position.set(x,.72,2.27);g.add(l);lights.push(l)}const halo=new THREE.Mesh(new THREE.RingGeometry(2.6,2.85,36),new THREE.MeshBasicMaterial({color:0xff364e,transparent:true,opacity:0,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.y=.08;g.add(halo);g.userData={id,lights,halo,speed:0,accel:0,warningUntil:0};vehicleLayer.add(g);return g}
function updateCars(target){for(const [id,track] of state.tracks){const sample=sampleTrack(track,target);let car=state.vehicles.get(id);if(!sample){if(car)car.visible=false;continue}if(!car){car=makeCar(id);state.vehicles.set(id,car)}const d=sample.current,q=sample.next,mix=sample.mix,p1=geoToWorld(d.lat,d.lon),p2=geoToWorld(q.lat,q.lon);car.position.lerpVectors(p1,p2,mix);let delta=((q.heading-d.heading+540)%360)-180;car.rotation.y=-(d.heading+delta*mix)*Math.PI/180;car.visible=sample.age<5000000000;car.userData.speed=THREE.MathUtils.lerp(d.speed,q.speed,mix);car.userData.accel=THREE.MathUtils.lerp(d.accel,q.accel,mix);const braking=d.braking||car.userData.accel<-1;for(const l of car.userData.lights){l.material.emissive.setHex(braking?0xff0710:0x220000);l.material.color.setHex(braking?0xff2634:0x400000)}car.userData.halo.material.opacity=(performance.now()<car.userData.warningUntil)?.12:0}$("time").textContent=`${(target/1e9).toFixed(1)}s`}

const ringTextures=new Map();function ringTexture(color){if(ringTextures.has(color))return ringTextures.get(color);const canvas=document.createElement("canvas");canvas.width=canvas.height=128;const context=canvas.getContext("2d");context.strokeStyle=`#${color.toString(16).padStart(6,"0")}`;context.lineWidth=10;context.shadowColor=context.strokeStyle;context.shadowBlur=14;context.beginPath();context.arc(64,64,48,0,Math.PI*2);context.stroke();const texture=new THREE.CanvasTexture(canvas);ringTextures.set(color,texture);return texture}function ring(position,type,radius=14,duration=8){const color=type==="tx"?0xff334d:0x22c8ff,billboard=radius<100;let marker;if(billboard){marker=new THREE.Sprite(new THREE.SpriteMaterial({map:ringTexture(color),transparent:true,opacity:.95,depthTest:false,depthWrite:false}));marker.scale.set(42,42,1);marker.position.copy(position).setY(12)}else{marker=new THREE.Mesh(new THREE.TorusGeometry(radius,Math.max(1.5,Math.min(4.5,radius*.12)),8,72),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false,depthTest:false}));marker.rotation.x=-Math.PI/2;marker.position.copy(position).setY(.18)}marker.renderOrder=999;marker.userData={born:performance.now(),duration,billboard};effectLayer.add(marker);state.pulses.push(marker)}
function packet(from,to){const dot=new THREE.Mesh(new THREE.SphereGeometry(.65,10,8),new THREE.MeshBasicMaterial({color:0x66e5ff}));dot.userData={from:from.clone(),to:to.clone(),born:performance.now(),duration:3500};effectLayer.add(dot);state.packets.push(dot)}
function showEvent(e){const car=state.vehicles.get(e.id);let p=Number.isFinite(e.lat+e.lon)?geoToWorld(e.lat,e.lon):car?.position.clone();if(!p)return;if(e.t<=CONFIG.incidentTimeNs+1200000000){state.eventPoints.push(p.clone());state.overviewUntil=performance.now()+5000}if(e.type==="tx"){ring(p,"tx");ring(p,"tx",CONFIG.communicationRangeMeters,8);state.lastTx.set(e.message,p.clone());if(e.id===CONFIG.incidentVehicleId&&car){state.hazard=car;if(state.autoCamera)state.cinematicUntil=performance.now()+6500}}else{ring(p,"rx");const origin=state.lastTx.get(e.message);if(origin)packet(origin,p);if(car){car.userData.warningUntil=performance.now()+4000;car.userData.halo.material.color.setHex(0x22c8ff)}}$(e.type).textContent=+$(e.type).textContent+1;$("alert").classList.add("active");$("alertTitle").textContent=e.type==="tx"?"HARD BRAKING BROADCAST":"HAZARD WARNING RECEIVED";$("detail").textContent=`${e.name||"DENM"} ${e.type==="tx"?"transmitted by":"received by"} ${e.id}`;const risk=e.risk||"DENM ALERT";$("riskBadge").textContent=risk;$("riskBadge").className=e.risk?.toLowerCase()==="critical"?"critical":"warning";$("ttc").textContent=Number.isFinite(e.ttc)?`${e.ttc.toFixed(1)} s`:e.ttc===Infinity?"∞ / SAFE":"AWAITING MOSAIC FIELD"}
function seek(target){state.time=target;updateCars(target);while(state.eventIndex<state.events.length&&state.events[state.eventIndex].t<=target)showEvent(state.events[state.eventIndex++])}
function reset(){state.playing=false;state.time=state.frames[0]?.t||0;state.eventIndex=0;state.lastTx.clear();state.cinematicUntil=0;state.overviewUntil=0;state.eventPoints=[];state.hazard=null;$("tx").textContent="0";$("rx").textContent="0";$("alert").classList.remove("active");$("alertTitle").textContent="ROAD NETWORK NOMINAL";$("detail").textContent="Monitoring verified MOSAIC telemetry.";$("riskBadge").textContent="MONITORING";$("riskBadge").className="";$("ttc").textContent="—";for(const x of [...state.pulses,...state.packets])effectLayer.remove(x);state.pulses=[];state.packets=[];if(state.frames.length){seek(state.time);const lead=state.vehicles.get(CONFIG.incidentVehicleId)||[...state.vehicles.values()].find(v=>v.visible);if(lead){const target=lead.position.clone();camera.position.copy(target).add(new THREE.Vector3(42,34,48));controls.target.copy(target);controls.update()}}}
function updateEffects(now){if(state.freezeEffects)return;for(let i=state.pulses.length-1;i>=0;i--){const x=state.pulses[i],a=(now-x.userData.born)/(x.userData.duration*1000);if(x.userData.billboard){const scale=42*(1+a*.7);x.scale.set(scale,scale,1)}else x.scale.setScalar(1+a*.7);x.material.opacity=Math.max(0,.8-a*.8);if(a>=1){effectLayer.remove(x);state.pulses.splice(i,1)}}for(let i=state.packets.length-1;i>=0;i--){const x=state.packets[i],a=(now-x.userData.born)/x.userData.duration;if(a>=1){effectLayer.remove(x);state.packets.splice(i,1);continue}x.position.lerpVectors(x.userData.from,x.userData.to,a);x.position.y=2+Math.sin(a*Math.PI)*18}}
function updateCamera(now){if(now<state.overviewUntil&&state.eventPoints.length>1){const box=new THREE.Box3().setFromPoints(state.eventPoints),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(120,size.x,size.z);const desired=center.clone().add(new THREE.Vector3(span*.10,span*.90,span*.12));camera.position.lerp(desired,.055);controls.target.lerp(center,.08);return}if(now<state.cinematicUntil&&state.hazard){const h=state.hazard.position.clone(),forward=new THREE.Vector3(0,0,-1).applyQuaternion(state.hazard.quaternion),right=new THREE.Vector3(1,0,0).applyQuaternion(state.hazard.quaternion),desired=h.clone().add(forward.multiplyScalar(-18)).add(right.multiplyScalar(11)).add(new THREE.Vector3(0,9,0));camera.position.lerp(desired,.045);controls.target.lerp(h.clone().add(new THREE.Vector3(0,1,0)),.08)}}
function animate(now){requestAnimationFrame(animate);const dt=Math.min(100,now-state.lastNow);state.lastNow=now;if(state.playing&&state.frames.length){const target=state.time+dt*1e6*state.speed;if(target>state.frames.at(-1).t)reset();else seek(target)}updateEffects(now);updateCamera(now);controls.update();renderer.render(scene,camera)}

function applyLiveVehicles(updates,payload){
  const now=Number(payload.time)||0;
  state.playing=false; state.source="LIVE"; state.time=Math.max(state.time,now);
  for(const v of updates){
    const id=v.name; const projected=v.projectedPosition;
    if(!id||!projected||!Number.isFinite(+projected.x + +projected.y))continue;
    let car=state.vehicles.get(id); if(!car){car=makeCar(id);state.vehicles.set(id,car)}
    const position=new THREE.Vector3(+projected.x-state.center.x,0,-(+projected.y-state.center.y));
    const previous=state.livePrevious.get(id);
    if(previous){
      const dt=(now-previous.time)/1e9,dx=position.x-previous.position.x,dz=position.z-previous.position.z,distance=Math.hypot(dx,dz);
      if(distance>.02)car.rotation.y=Math.atan2(-dx,-dz);
      const speed=dt>0?distance/dt:car.userData.speed,accel=dt>0?(speed-car.userData.speed)/dt:0;
      car.userData.speed=speed; car.userData.accel=accel;
      const braking=v.vehicleStopMode==="STOP"||accel<-1;
      for(const light of car.userData.lights){light.material.emissive.setHex(braking?0xff0710:0x220000);light.material.color.setHex(braking?0xff2634:0x400000)}
    }
    car.position.copy(position); car.visible=true; state.livePrevious.set(id,{time:now,position:position.clone()});
  }
  $("vehicles").textContent=state.vehicles.size; $("time").textContent=`${(state.time/1e9).toFixed(1)}s`; $("data").textContent=`LIVE · ${updates.length} UPDATES`;
}
async function connectLive(){
  const client=new MosaicLiveClient(CONFIG.websocketUrl,{
    vehicles:applyLiveVehicles,
    registration:p=>{const id=p.vehicleMapping?.name;if(id)state.registered.add(id);$("vehicles").textContent=Math.max(state.registered.size,state.vehicles.size)},
    transmission:p=>showEvent({t:+p.time,type:"tx",message:String(p.messageId),name:"DENM",id:p.sourceName}),
    reception:p=>showEvent({t:+p.time,type:"rx",message:String(p.messageId),name:"DENM",id:p.receiverName}),
    remove:p=>{for(const id of p.units||p.names||[]){const car=state.vehicles.get(id);if(car)car.visible=false}},
    status:s=>{if(s==="connected"){$("source").textContent="MOSAIC WEBSOCKET LIVE";$("status").textContent="LIVE MOSAIC DIGITAL TWIN"}else if(state.source==="LIVE"){$("status").textContent="LIVE DISCONNECTED · REPLAY AVAILABLE"}}
  });
  if(await client.connect(CONFIG.websocketTimeoutMs)){state.liveClient=client;return true}return false;
}
function bindControls(){
  $("play").addEventListener("click",()=>{
    if(!state.frames.length)return;
    if(state.time>=state.frames.at(-1).t)reset();
    state.freezeEffects=false;state.lastNow=performance.now();state.playing=true;
    $("status").textContent=state.source==="LIVE"?"LIVE MOSAIC DIGITAL TWIN":"MOSAIC REPLAY PLAYING";
  });
  $("pause").addEventListener("click",()=>{state.playing=false;$("status").textContent="SIMULATION PAUSED"});
  $("reset").addEventListener("click",()=>{state.freezeEffects=false;reset();$("status").textContent="SIMULATION RESET"});
  $("speed").addEventListener("input",event=>{state.speed=Number(event.target.value)||1;$("speedValue").textContent=`${state.speed}×`});
  $("cameraMode").addEventListener("click",()=>{state.autoCamera=!state.autoCamera;$("cameraMode").textContent=state.autoCamera?"◉ AUTO CAMERA":"◎ FREE CAMERA"});
  const levels=[{name:"LOW",ratio:.65},{name:"BALANCED",ratio:1},{name:"HIGH",ratio:1.5}];let qualityIndex=1;
  $("quality").addEventListener("click",()=>{qualityIndex=(qualityIndex+1)%levels.length;const level=levels[qualityIndex];renderer.setPixelRatio(Math.min(devicePixelRatio,level.ratio));renderer.setSize(innerWidth,innerHeight);$("quality").textContent=level.name});
  addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
}
async function load(){try{
  const [map,csv,risk]=await Promise.all([fetch(CONFIG.mapUrl),fetch(CONFIG.replayUrl),fetch(CONFIG.riskUrl).catch(()=>null)]);
  if(!map.ok||!csv.ok)throw Error("Map or MOSAIC replay unavailable");
  buildWorld(await map.text());parseReplay(await csv.text());
  if(risk?.ok){const matched=enrichReceptionEvents(state.events,await risk.text());if(matched)$("data").textContent+=` · ${matched} TTC`}
  reset();
  const params=new URLSearchParams(location.search);
  if(params.has("speed")){state.speed=+params.get("speed");$("speed").value=state.speed;$("speedValue").textContent=`${state.speed}×`}
  if(params.has("time")){state.freezeEffects=true;const requested=+params.get("time")*1e9;if(Number.isFinite(requested)){seek(Math.max(state.frames[0].t,Math.min(requested,state.frames.at(-1).t)));const focus=state.vehicles.get(CONFIG.incidentVehicleId);if(focus&&params.get("overview")!=="1"){state.cinematicUntil=0;state.overviewUntil=0;camera.position.copy(focus.position).add(new THREE.Vector3(28,20,32));controls.target.copy(focus.position);controls.update()}else if(params.get("overview")==="1"&&state.eventPoints.length>1){const box=new THREE.Box3().setFromPoints(state.eventPoints),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(120,size.x,size.z);state.cinematicUntil=0;state.overviewUntil=0;camera.position.copy(center).add(new THREE.Vector3(span*.10,span*.90,span*.12));controls.target.copy(center);controls.update()}}}
  const live=params.has("time")?false:await connectLive();
  if(!live){$("source").textContent="MOSAIC CSV REPLAY";$("status").textContent="V2V-SIH DIGITAL TWIN READY"}
  if(params.get("autoplay")==="1")state.playing=true;
}catch(e){$("status").textContent=`ERROR: ${e.message}`;console.error(e)}}

bindControls();load();animate(performance.now());
