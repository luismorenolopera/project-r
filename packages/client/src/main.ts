import * as THREE from 'three';
import {
  ClassId, CLASSES, DT, Kind, REACTIONS, Sim, TeamId, dirToYaw, pickAllyTarget, resolveCircle, type InputFrame, type SimEvent,
} from '@mazmorra/shared';
import './style.css';
import { Controls } from './input/controls';
import { ClientPhysics } from './physics/ragdoll';
import { ELEMENT_COLORS, Fx } from './render/fx';
import { animateModel, buildModel, disposeModel, initModels, triggerAttack, type Model } from './render/models';
import { RetroPostProcess } from './render/psx';
import { buildArena, updateBraziers } from './render/scene';
import { createTextures } from './render/textures';
import { Hud, SPAWNABLE } from './ui/hud';

// ---------------------------------------------------------------- render
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 120);
const post = new RetroPostProcess();
const textures = createTextures();
initModels(textures);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- simulación local
const sim = new Sim((Date.now() & 0xffff) + 1);
const arenaView = buildArena(scene, sim.arena, textures);
const physics = new ClientPhysics(scene, sim.arena);
const fx = new Fx(scene);
const controls = new Controls(canvas);

interface ActorView {
  model: Model;
  kind: Kind;
  cls: number;
  status: StatusView;
  telegraphWas: number;
}
const actors = new Map<number, ActorView>();
const positions = new Map<number, THREE.Vector3>();

// Indicadores de estado compartidos.
const additive = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const statusGeo = {
  bubble: new THREE.IcosahedronGeometry(1.05, 1),
  guard: new THREE.CircleGeometry(0.8, 6),
  ring: new THREE.RingGeometry(0.55, 0.75, 14),
  stars: new THREE.TorusGeometry(0.35, 0.05, 3, 6),
  net: new THREE.TorusGeometry(0.6, 0.04, 3, 6),
};
const statusMat = {
  shield: additive(0x6aa8ff, 0.25),
  guard: additive(0xffe08a, 0.35),
  guardPerfect: additive(0xffffff, 0.7),
  frenzy: additive(0xff2a1a, 0.7),
  buff: additive(0xffa02a, 0.6),
  vuln: additive(0xb04aff, 0.7),
  stun: additive(0xffe04a, 0.9),
  net: additive(0xd8c8a0, 0.9),
};

interface StatusView {
  group: THREE.Group;
  shield: THREE.Mesh;
  guard: THREE.Mesh;
  ring: THREE.Mesh;
  stars: THREE.Mesh;
  net: THREE.Mesh;
}

function makeStatus(): StatusView {
  const group = new THREE.Group();
  const shield = new THREE.Mesh(statusGeo.bubble, statusMat.shield);
  shield.position.y = 1;
  const guard = new THREE.Mesh(statusGeo.guard, statusMat.guard);
  guard.position.set(0, 1.1, -0.7);
  const ring = new THREE.Mesh(statusGeo.ring, statusMat.frenzy);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  const stars = new THREE.Mesh(statusGeo.stars, statusMat.stun);
  stars.rotation.x = Math.PI / 2;
  const net = new THREE.Mesh(statusGeo.net, statusMat.net);
  net.rotation.x = Math.PI / 2;
  net.position.y = 0.4;
  group.add(shield, guard, ring, stars, net);
  scene.add(group);
  return { group, shield, guard, ring, stars, net };
}

function addActor(eid: number) {
  const kind = sim.kind(eid);
  const cls = kind === Kind.Heroe ? sim.c.Hero.cls[eid]! : 0;
  const model = buildModel(kind, cls as ClassId);
  scene.add(model.root);
  actors.set(eid, { model, kind, cls, status: makeStatus(), telegraphWas: 0 });
  positions.set(eid, new THREE.Vector3(sim.c.Pos.x[eid]!, 0, sim.c.Pos.z[eid]!));
}

function removeActor(eid: number) {
  const v = actors.get(eid);
  if (!v) return;
  disposeModel(v.model);
  v.status.group.removeFromParent();
  actors.delete(eid);
  positions.delete(eid);
  fx.removeTelegraph(eid);
}

// ---------------------------------------------------------------- héroe y sandbox
let hero = -1;
let aim = { x: 0, z: -6, yaw: 0, valid: false };
let simMs = 0;

const torch = new THREE.PointLight(0xffb070, 16, 14, 1.4);
scene.add(torch);
// Luz de relleno desde la cámara: el héroe se ve de espaldas y sin ella queda en negro.
const fill = new THREE.DirectionalLight(0x8a90b8, 0.9);
scene.add(fill, fill.target);

const ABILITY_ANIM: Record<string, [Model['attackStyle'], number]> = {
  tajo: ['swing', 0.3], embestida: ['swing', 0.3], salto_sismico: ['swing', 0.6],
  orbe: ['cast', 0.25], parpadeo: ['cast', 0.2], egida: ['cast', 0.3], muro_igneo: ['cast', 0.35], furia: ['cast', 0.5],
  flecha: ['shoot', 0.2], red: ['throw', 0.3], perforante: ['shoot', 0.35], lluvia: ['shoot', 0.4],
  golpe_consagrado: ['swing', 0.3], santuario: ['cast', 0.4], rayo_luz: ['cast', 0.3], plegaria: ['cast', 0.6],
  frasco_toxico: ['throw', 0.3], piel_piedra: ['cast', 0.3], aceite: ['throw', 0.3], transmutacion: ['throw', 0.4],
};

function heroPos() {
  return { x: sim.c.Pos.x[hero]!, z: sim.c.Pos.z[hero]! };
}

function spawnPoint(): { x: number; z: number } {
  let x = aim.valid ? aim.x : heroPos().x + Math.sin(controls.camYaw) * -8;
  let z = aim.valid ? aim.z : heroPos().z + Math.cos(controls.camYaw) * -8;
  const lim = sim.arena.halfSize - 1.5;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  const r = resolveCircle(sim.arena, x, z, 1);
  return { x: r.x, z: r.z };
}

function spawn(kind: Kind, at = spawnPoint()) {
  const eid = sim.spawnMonster(kind, at.x, at.z);
  const h = heroPos();
  sim.c.Facing.yaw[eid] = sim.c.Facing.pyaw[eid] = dirToYaw(h.x - at.x, h.z - at.z);
  flushEvents();
  return eid;
}

function wave() {
  const kinds = [Kind.Esqueleto, Kind.Esqueleto, Kind.Esqueleto, Kind.Esqueleto, Kind.Cultista, Kind.Cultista, Kind.Espectro, Kind.Espectro, Kind.Bruto];
  const h = heroPos();
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2;
    const lim = sim.arena.halfSize - 1.5;
    const x = Math.max(-lim, Math.min(lim, h.x + Math.cos(a) * 13));
    const z = Math.max(-lim, Math.min(lim, h.z + Math.sin(a) * 13));
    spawn(k, resolveCircle(sim.arena, x, z, 1));
  });
  hud.feed('¡Oleada! 9 criaturas', 'bad');
}

const hud = new Hud({
  onClass: (cls) => setClass(cls),
  onSpawn: (k) => spawn(k),
  onWave: wave,
  onClear: () => {
    sim.clearMonsters();
    sim.step();
    processEvents(sim.drainEvents());
    hud.resetDps();
  },
  onToggleImmortal: () => (sim.options.inmortal = !sim.options.inmortal),
});

function setClass(cls: ClassId) {
  sim.setHeroClass(hero, cls);
  flushEvents();
  hud.feed(`Clase: ${CLASSES[cls]!.nombre}`);
}

function flushEvents() {
  processEvents(sim.drainEvents());
}

// ---------------------------------------------------------------- eventos de la simulación
const tmp = new THREE.Vector3();
function actorTop(eid: number, extra = 0) {
  const p = positions.get(eid);
  const h = sim.c.Body.height[eid]! * (sim.kind(eid) === Kind.Bruto ? 1.45 : 1);
  return tmp.set(p?.x ?? sim.c.Pos.x[eid]!, (p?.y ?? 0) + h + extra, p?.z ?? sim.c.Pos.z[eid]!);
}
const SYNERGIES = new Set<string>(Object.values(REACTIONS));
const hexColor = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function processEvents(events: SimEvent[]) {
  const now = performance.now() / 1000;
  for (const e of events) {
    switch (e.t) {
      case 'spawn':
        if (e.kind === Kind.Proyectil) fx.addProjectile(e.eid, sim);
        else if (e.kind === Kind.Zona) fx.addZone(e.eid, sim);
        else addActor(e.eid);
        break;
      case 'despawn':
        fx.removeProjectile(e.eid);
        fx.removeZone(e.eid);
        removeActor(e.eid);
        break;
      case 'class': {
        const v = actors.get(e.eid);
        if (v) {
          disposeModel(v.model);
          v.model = buildModel(Kind.Heroe, e.cls as ClassId);
          v.cls = e.cls;
          scene.add(v.model.root);
          fx.burst(sim.c.Pos.x[e.eid]!, 1, sim.c.Pos.z[e.eid]!, CLASSES[e.cls]!.color, 20, 4, 2);
        }
        break;
      }
      case 'hit': {
        if (!sim.exists(e.target) && !actors.has(e.target)) break;
        const v = actors.get(e.target);
        if (v) v.model.hurtT = 0.15;
        const pos = actorTop(e.target);
        const isHero = e.target === hero;
        const cls = [isHero ? 'hurt' : '', e.afinidad > 1 ? 'weak' : e.afinidad < 1 ? 'resist' : '', e.aereo ? 'air' : '', e.frenesi ? 'frenzy' : ''].join(' ');
        const color = isHero ? undefined : e.frenesi ? '#ff5a3a' : hexColor(ELEMENT_COLORS[e.el]);
        if (e.amount > 0 || e.absorbido === 0) hud.float(pos, String(e.amount), cls, color);
        if (e.absorbido > 0) hud.float(pos, `(${e.absorbido})`, 'shield');
        fx.burst(pos.x, pos.y - 0.6, pos.z, ELEMENT_COLORS[e.el], e.amount > 25 ? 10 : 5, 3.5);
        if (sim.kind(e.target) === Kind.Muneco) hud.logDummyDamage(e.amount, now);
        break;
      }
      case 'heal':
        hud.float(actorTop(e.target), `+${e.amount}`, 'heal');
        break;
      case 'shield':
        hud.float(actorTop(e.target, 0.2), `Escudo ${e.amount}`, 'shield');
        break;
      case 'death': {
        const v = actors.get(e.eid);
        if (v) {
          physics.spawnRagdoll(v.model, { x: e.dx, z: e.dz }, Math.min(14, e.force), e.kind === Kind.Espectro ? 0x88aaff : undefined);
          if (e.eid === hero) v.model.root.visible = false;
        }
        if (e.eid === hero) hud.feed('Has caído', 'bad');
        break;
      }
      case 'respawn': {
        const v = actors.get(e.eid);
        if (v) v.model.root.visible = true;
        break;
      }
      case 'cast': {
        const v = actors.get(e.eid);
        const anim = ABILITY_ANIM[e.ability];
        if (v && anim) triggerAttack(v.model, anim[0], anim[1]);
        if (e.ability === 'parpadeo' || e.ability === 'impulso' || e.ability === 'voltereta' || e.ability === 'paso_sagrado') {
          fx.burst(sim.c.Pos.x[e.eid]!, 0.8, sim.c.Pos.z[e.eid]!, CLASSES[sim.c.Hero.cls[e.eid]!]!.color, 10, 3, 1);
        }
        if (e.ability === 'egida' || e.ability === 'furia' || e.ability === 'plegaria') {
          fx.ring(sim.c.Pos.x[e.eid]!, sim.c.Pos.z[e.eid]!, e.ability === 'egida' ? 2 : 10, e.ability === 'furia' ? 0xffa02a : 0xffe27a, 0.6, false);
        }
        break;
      }
      case 'fail':
        hud.feed(e.msg, 'bad');
        break;
      case 'reaction':
        hud.float(new THREE.Vector3(e.x, 2.2, e.z), e.name, 'big', hexColor(ELEMENT_COLORS[e.el]), true);
        fx.burst(e.x, 1.2, e.z, ELEMENT_COLORS[e.el], 14, 5);
        hud.feed(SYNERGIES.has(e.name) ? `Sinergia: ${e.name}` : e.name, 'good');
        break;
      case 'text':
        if (sim.exists(e.eid)) hud.float(actorTop(e.eid, 0.3), e.msg, 'text big', e.msg.includes('perfecto') ? '#ffea4a' : undefined, true);
        break;
      case 'frenzy':
        if (e.eid === hero) hud.feed(e.on ? '¡FRENESÍ! +40% de daño hasta que te golpeen' : 'Frenesí perdido', e.on ? 'good' : 'bad');
        break;
      case 'impact':
        fx.burst(e.x, e.y, e.z, ELEMENT_COLORS[e.el], 6, 3);
        break;
      case 'explosion':
        fx.explosion(e.x, e.z, e.r, e.el);
        break;
      case 'blink':
        fx.burst(e.fx, 1, e.fz, 0xa88aff, 16, 3, 0);
        break;
    }
  }
}

// ---------------------------------------------------------------- inicio
hero = sim.spawnHero(ClassId.Guerrero);
flushEvents();
spawn(Kind.Muneco, { x: 0, z: 2 });
spawn(Kind.Muneco, { x: -4, z: 2 });
spawn(Kind.Aliado, { x: 3, z: 12 });
hud.setClass(ClassId.Guerrero);

const playBtn = document.getElementById('play') as HTMLButtonElement;
playBtn.onclick = () => {
  document.body.classList.add('started');
  playBtn.textContent = 'Clic para volver al juego';
  controls.lock();
};
document.addEventListener('pointerlockchange', () => hud.setLocked(document.pointerLockElement === canvas));
canvas.addEventListener('click', () => {
  if (!controls.locked && document.body.classList.contains('started')) controls.lock();
});

// ---------------------------------------------------------------- apuntado
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function updateAim() {
  raycaster.setFromCamera(center, camera);
  const hits = raycaster.intersectObjects(arenaView.aimTargets, false);
  const p = new THREE.Vector3();
  if (hits.length) p.copy(hits[0]!.point);
  else if (!raycaster.ray.intersectPlane(groundPlane, p)) p.copy(raycaster.ray.at(30, p));
  const h = heroPos();
  const dx = p.x - h.x;
  const dz = p.z - h.z;
  const far = Math.hypot(dx, dz) > 1.5;
  aim = { x: p.x, z: p.z, yaw: far ? dirToYaw(dx, dz) : controls.camYaw, valid: true };
}

let seq = 0;
function buildInput(): InputFrame {
  const m = controls.locked ? controls.move() : { x: 0, z: 0 };
  return { seq: seq++, moveX: m.x, moveZ: m.z, aimYaw: aim.yaw, aimX: aim.x, aimZ: aim.z, buttons: controls.buttons() };
}

function handleHotkeys() {
  if (!controls.locked) {
    controls.clearPressed();
    return;
  }
  for (let i = 0; i < 5; i++) if (controls.consume(`Digit${i + 1}`)) setClass(i as ClassId);
  for (const s of SPAWNABLE) if (controls.consume(s.code)) spawn(s.kind);
  if (controls.consume('KeyO')) wave();
  if (controls.consume('KeyK')) {
    sim.clearMonsters();
    hud.resetDps();
  }
  if (controls.consume('KeyI')) {
    sim.options.inmortal = !sim.options.inmortal;
    hud.setImmortal(sim.options.inmortal);
    hud.feed(`Inmortal: ${sim.options.inmortal ? 'sí' : 'no'}`);
  }
  controls.clearPressed();
}

// ---------------------------------------------------------------- bucle
let acc = 0;
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 60;
const camTarget = new THREE.Vector3();
const camWanted = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function frame(nowMs: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const time = nowMs / 1000;
  handleHotkeys();

  acc += dt;
  while (acc >= DT) {
    sim.setInput(hero, buildInput());
    const t0 = performance.now();
    sim.step();
    simMs = simMs * 0.9 + (performance.now() - t0) * 0.1;
    processEvents(sim.drainEvents());
    acc -= DT;
  }
  const alpha = acc / DT;
  const c = sim.c;

  // Actores interpolados entre los dos últimos ticks (la simulación va a 20 Hz, el render a 60+).
  for (const [eid, v] of actors) {
    if (!sim.exists(eid)) continue;
    const px = c.Pos.px[eid]!;
    const pz = c.Pos.pz[eid]!;
    const jump = Math.hypot(c.Pos.x[eid]! - px, c.Pos.z[eid]! - pz) > 3;
    const a = jump ? 1 : alpha;
    const pos = positions.get(eid)!;
    pos.set(THREE.MathUtils.lerp(px, c.Pos.x[eid]!, a), THREE.MathUtils.lerp(c.Pos.py[eid]!, c.Pos.y[eid]!, a), THREE.MathUtils.lerp(pz, c.Pos.z[eid]!, a));
    v.model.root.position.copy(pos);
    const yaw = eid === hero && c.Health.deadT[eid]! <= 0 ? aim.yaw : lerpAngle(c.Facing.pyaw[eid]!, c.Facing.yaw[eid]!, alpha);
    v.model.root.rotation.y = yaw;
    const speed = Math.hypot(c.Vel.x[eid]!, c.Vel.z[eid]!) + Math.hypot(c.Dash.vx[eid]!, c.Dash.vz[eid]!) * (c.Dash.t[eid]! > 0 ? 1 : 0);
    const tel = c.Telegraph.active[eid]!;
    if (v.telegraphWas && !tel && c.Status.stunT[eid]! <= 0) triggerAttack(v.model, sim.kind(eid) === Kind.Cultista ? 'cast' : 'swing', 0.3);
    if (v.kind === Kind.Aliado && c.AI.state[eid] === 1 && c.AI.t[eid]! <= DT * 1.5) triggerAttack(v.model, 'swing', 0.3);
    v.telegraphWas = tel;
    animateModel(v.model, {
      dt, speed, time,
      airborne: c.Pos.y[eid]! > 0.15,
      stunned: c.Status.stunT[eid]! > 0,
      windup: tel ? 1 : 0,
      spinning: c.Hero.action[eid] === 1 && v.kind === Kind.Heroe,
      guarding: c.Status.guardT[eid]! > 0,
    });
    fx.updateTelegraph(eid, sim);

    // Indicadores de estado.
    const s = v.status;
    s.group.position.copy(pos);
    s.group.rotation.y = yaw;
    const S = c.Status;
    s.shield.visible = S.shield[eid]! > 0;
    s.guard.visible = S.guardT[eid]! > 0;
    s.guard.material = S.guardAge[eid]! <= 0.25 ? statusMat.guardPerfect : statusMat.guard;
    const frenzy = v.kind === Kind.Heroe && c.Combo.frenzy[eid]!;
    s.ring.visible = !!frenzy || S.dmgBuffT[eid]! > 0 || S.vulnT[eid]! > 0;
    s.ring.material = frenzy ? statusMat.frenzy : S.vulnT[eid]! > 0 ? statusMat.vuln : statusMat.buff;
    s.ring.rotation.z = time * 3;
    s.ring.scale.setScalar(1 + Math.sin(time * 10) * 0.08);
    s.stars.visible = S.stunT[eid]! > 0;
    s.stars.position.y = c.Body.height[eid]! * (v.kind === Kind.Bruto ? 1.45 : 1) + 0.3;
    s.stars.rotation.z = time * 6;
    s.net.visible = S.rootT[eid]! > 0;
    if (S.burnT[eid]! > 0 && Math.random() < 0.3) fx.burst(pos.x, pos.y + 1, pos.z, 0xff7a1a, 1, 1.5, -2);
    if (S.poisonT[eid]! > 0 && Math.random() < 0.2) fx.burst(pos.x, pos.y + 1, pos.z, 0x7aff3a, 1, 1, -1);
    if (frenzy && Math.random() < 0.4) fx.burst(pos.x, pos.y + 0.5, pos.z, 0xff2a1a, 1, 1.5, -3);
  }
  for (const p of sim.projectiles()) fx.updateProjectile(p, sim, alpha);
  for (const z of sim.zones()) fx.updateZone(z, sim, time);
  fx.update(dt);
  physics.step(dt);
  updateBraziers(arenaView, time);

  // Cámara en tercera persona sobre el hombro, con colisión contra muros y pilares.
  const hp = positions.get(hero)!;
  camTarget.set(hp.x, hp.y + 1.7, hp.z);
  const yaw = controls.camYaw;
  const pitch = controls.camPitch;
  const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const shoulder = camTarget.clone().addScaledVector(right, 0.7);
  camWanted.copy(shoulder).addScaledVector(back, 6.5);
  const dist = physics.cameraDistance(shoulder, camWanted);
  camera.position.copy(shoulder).addScaledVector(back, dist);
  camera.lookAt(shoulder.clone().addScaledVector(back, -10).add(new THREE.Vector3(0, 1.4, 0)));
  torch.position.set(hp.x, hp.y + 2.4, hp.z);
  fill.position.copy(camera.position);
  fill.target.position.copy(camTarget);
  torch.intensity = 14 + Math.sin(time * 11) * 1.5;

  updateAim();
  fx.reticle.visible = controls.locked;
  fx.reticle.position.set(aim.x, 0.04, aim.z);
  fx.reticle.rotation.z = time;

  // Marcador del aliado que recibirá la Égida.
  const isMage = c.Hero.cls[hero] === ClassId.Mago;
  const target = isMage ? pickAllyTarget(sim, hero, 15) : -1;
  fx.allyMarker.visible = target >= 0;
  if (target >= 0) fx.allyMarker.position.set(positions.get(target)?.x ?? 0, 0.06, positions.get(target)?.z ?? 0);

  hud.updateHero(sim, hero);
  hud.updateBars(sim, camera, positions, hero);
  hud.updateFloating(dt, camera);
  hud.updateDps(time);

  post.render(renderer, scene, camera);

  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
    const ps = physics.stats();
    const enemies = sim.actors().filter((e) => sim.team(e) === TeamId.Monstruos).length;
    hud.stats(`${fps.toFixed(0)} FPS · tick ${simMs.toFixed(2)} ms · ${enemies} enemigos · ${sim.projectiles().length} proyectiles · ragdolls ${ps.ragdolls} (${ps.awake} cuerpos activos, ${ps.sleeping} dormidos) · render ${post.target.width}×${post.target.height}`);
  }
}
requestAnimationFrame(frame);

// Acceso para pruebas automatizadas del navegador (tools/smoke).
(window as unknown as { __sandbox: unknown }).__sandbox = { sim, hero: () => hero, spawn, setClass, wave, controls, fps: () => fps };
