import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ClassId, Kind, createTrainingCrypt, dirToYaw } from '@mazmorra/shared';
import { RetroPostProcess, psxLambert } from '../../render/psx';
import { buildArena, updateBraziers } from '../../render/scene';
import { createTextures } from '../../render/textures';
import { animateModel, buildModel, initModels, type Model } from '../../render/models';
import {
  casco,
  formaCaja,
  formaTorno,
  fracturar,
  geometriaDe,
  mulberry32,
  planosDe,
  type Convexo,
  type Plano,
} from '../../physics/fractura';
import './embestida.css';

/**
 * Prototipo: embestida del guerrero con físicas reales (cannon-es).
 * - Contra un enemigo: lo empuja según su masa. Si sale despedido contra un muro o pilar, queda aturdido.
 * - Contra un objeto rompible: se fractura en trozos convexos que simula el motor de físicas.
 * Aquí las físicas mandan sobre el movimiento; en el juego real la embestida vive en `shared`
 * (determinista) y esto pasaría a ser la capa cosmética del cliente.
 */

// ---------- Ajustes ----------
const PASO = 1 / 120;
const AJ = {
  embestidaDist: 7,
  embestidaTiempo: 0.3,
  embestidaCd: 0.8,
  andar: 6,
  empuje: 17,
  /** Velocidad mínima de un enemigo despedido para aturdirse contra un muro (m/s). */
  aturdirVel: 5,
  /** Velocidad mínima de un enemigo despedido para romper un objeto (m/s). */
  romperVel: 3.5,
  vidaTrozos: 12,
  maxTrozos: 450,
};

// ---------- Render ----------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const post = new RetroPostProcess();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
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

const arena = createTrainingCrypt();
const arenaView = buildArena(scene, arena, textures);
// La cripta está pensada para cámara en tercera persona; desde el picado hace falta algo más de luz.
(scene.fog as THREE.FogExp2).density = 0.018;
scene.add(new THREE.HemisphereLight(0x8a84a8, 0x2a2018, 1.3));
const playerLight = new THREE.PointLight(0xffc890, 40, 18, 1.4);
scene.add(playerLight);

// ---------- Mundo físico ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
(world.solver as CANNON.GSSolver).iterations = 10;

const mEstatico = new CANNON.Material('estatico');
const mPersonaje = new CANNON.Material('personaje');
const mObjeto = new CANNON.Material('objeto');
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mEstatico, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mPersonaje, { friction: 0, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mObjeto, { friction: 0.1, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(mObjeto, mEstatico, { friction: 0.55, restitution: 0.2 }));
world.addContactMaterial(new CANNON.ContactMaterial(mObjeto, mObjeto, { friction: 0.5, restitution: 0.15 }));

const suelo = new CANNON.Body({ mass: 0, material: mEstatico });
suelo.addShape(new CANNON.Plane());
suelo.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(suelo);

/** Muros, pilares y sarcófagos: contra ellos se aturden los enemigos. */
const duros = new Set<CANNON.Body>();
for (const o of arena.obstacles) {
  const body = new CANNON.Body({ mass: 0, material: mEstatico });
  if (o.type === 'box') {
    body.addShape(new CANNON.Box(new CANNON.Vec3((o.maxX - o.minX) / 2, o.h / 2, (o.maxZ - o.minZ) / 2)));
    body.position.set((o.minX + o.maxX) / 2, o.h / 2, (o.minZ + o.maxZ) / 2);
  } else {
    body.addShape(new CANNON.Cylinder(o.r, o.r, o.h, 10));
    body.position.set(o.x, o.h / 2, o.z);
  }
  world.addBody(body);
  duros.add(body);
}

// ---------- Utilidades ----------
let rnd = mulberry32(1234);
const rand = (a: number, b: number) => a + (b - a) * Math.random();
const v3 = (v: CANNON.Vec3) => new THREE.Vector3(v.x, v.y, v.z);

let shake = 0;
let hitStop = 0;
let slowMo = false;
let persiguen = false;
const stats = { rotos: 0, empujones: 0, aturdidos: 0 };

// ---------- Partículas (polvo y astillas, solo visuales) ----------
interface Particula {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  vida: number;
  max: number;
  gravedad: number;
}
const particulas: Particula[] = [];
const geoPart = new THREE.BoxGeometry(1, 1, 1);
function polvo(pos: THREE.Vector3, color: number, n: number, fuerza: number, tam = 0.12, gravedad = -2) {
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
    const mesh = new THREE.Mesh(geoPart, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(tam * rand(0.6, 1.6));
    scene.add(mesh);
    const vel = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(fuerza * rand(0.3, 1));
    const max = rand(0.5, 1.1);
    particulas.push({ mesh, vel, vida: max, max, gravedad });
  }
}
function actualizarParticulas(dt: number) {
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i]!;
    p.vida -= dt;
    if (p.vida <= 0) {
      p.mesh.removeFromParent();
      (p.mesh.material as THREE.Material).dispose();
      particulas.splice(i, 1);
      continue;
    }
    p.vel.y += p.gravedad * dt;
    p.vel.multiplyScalar(Math.exp(-2.5 * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += dt * 4;
    p.mesh.rotation.y += dt * 3;
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (p.vida / p.max);
  }
}

// ---------- Guerrero ----------
const RADIO_G = 0.42;
const guerrero = {
  body: new CANNON.Body({ mass: 90, material: mPersonaje, fixedRotation: true, allowSleep: false }),
  model: buildModel(Kind.Heroe, ClassId.Guerrero),
  yaw: 0,
  dashT: 0,
  dashDir: new THREE.Vector3(0, 0, -1),
  cd: 0,
  golpeados: new Set<object>(),
};
guerrero.body.addShape(new CANNON.Sphere(RADIO_G), new CANNON.Vec3(0, RADIO_G, 0));
guerrero.body.addShape(new CANNON.Sphere(RADIO_G), new CANNON.Vec3(0, 1.3, 0));
world.addBody(guerrero.body);
scene.add(guerrero.model.root);

// Indicadores: dónde apuntas y el recorrido de la embestida.
const marcaApunte = new THREE.Mesh(
  new THREE.RingGeometry(0.25, 0.38, 12),
  new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.8, depthWrite: false }),
);
marcaApunte.rotation.x = -Math.PI / 2;
scene.add(marcaApunte);
const guia = new THREE.Mesh(
  new THREE.PlaneGeometry(0.9, 1),
  new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
);
guia.rotation.x = -Math.PI / 2;
scene.add(guia);

// ---------- Enemigos ----------
type EstadoEnemigo = 'normal' | 'empujado' | 'aturdido';
interface Enemigo {
  body: CANNON.Body;
  model: Model;
  radio: number;
  masa: number;
  estado: EstadoEnemigo;
  t: number;
  yaw: number;
  estrellas: THREE.Group;
  pesado: boolean;
}
const enemigos: Enemigo[] = [];
const enemigoDe = new Map<CANNON.Body, Enemigo>();

function crearEstrellas() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe04a });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), mat);
    const a = (i / 4) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
    g.add(s);
  }
  g.visible = false;
  scene.add(g);
  return g;
}

function crearEnemigo(tipo: 'esqueleto' | 'bruto', x: number, z: number) {
  const pesado = tipo === 'bruto';
  const radio = pesado ? 0.62 : 0.38;
  const alto = pesado ? 2.5 : 1.8;
  const masa = pesado ? 260 : 60;
  const body = new CANNON.Body({ mass: masa, material: mPersonaje, fixedRotation: true });
  body.addShape(new CANNON.Sphere(radio), new CANNON.Vec3(0, radio, 0));
  body.addShape(new CANNON.Sphere(radio), new CANNON.Vec3(0, alto - radio, 0));
  body.position.set(x, 0.02, z);
  body.sleepSpeedLimit = 0.05;
  world.addBody(body);
  const model = buildModel(pesado ? Kind.Bruto : Kind.Esqueleto);
  scene.add(model.root);
  const e: Enemigo = { body, model, radio, masa, estado: 'normal', t: 0, yaw: 0, estrellas: crearEstrellas(), pesado };
  e.yaw = dirToYaw(guerrero.body.position.x - x, guerrero.body.position.z - z);
  enemigos.push(e);
  enemigoDe.set(body, e);

  body.addEventListener('collide', (ev: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    if (e.estado !== 'empujado') return;
    const otro = ev.body;
    const vel = Math.hypot(body.velocity.x, body.velocity.z);
    if (duros.has(otro) && vel > AJ.aturdirVel) eventos.push({ tipo: 'aturdir', e, punto: puntoContacto(ev.contact) });
    const r = rompibleDe.get(otro);
    if (r && vel > AJ.romperVel) {
      eventos.push({ tipo: 'romper', r, punto: puntoContacto(ev.contact), dir: new THREE.Vector3(body.velocity.x, 0, body.velocity.z).normalize(), fuerza: vel });
    }
    const o = enemigoDe.get(otro);
    if (o && o.estado === 'normal' && vel > 3) eventos.push({ tipo: 'contagio', e: o });
  });
}

function puntoContacto(c: CANNON.ContactEquation) {
  return new THREE.Vector3(c.bi.position.x + c.ri.x, c.bi.position.y + c.ri.y, c.bi.position.z + c.ri.z);
}

// ---------- Rompibles ----------
interface TipoRompible {
  nombre: string;
  forma: () => THREE.Vector3[];
  textura: THREE.Texture;
  escalaUV: number;
  exterior: number;
  interior: number;
  densidad: number;
  piezas: number;
  polvo: number;
}
const TIPOS: Record<string, TipoRompible> = {
  caja: { nombre: 'Caja', forma: () => formaCaja(0.9, 0.9, 0.9), textura: textures.wood, escalaUV: 0.9, exterior: 0xd0b090, interior: 0xe8c890, densidad: 35, piezas: 11, polvo: 0x8a6a4a },
  barril: { nombre: 'Barril', forma: () => formaTorno([[-0.55, 0.34], [-0.25, 0.42], [0.25, 0.42], [0.55, 0.34]], 9), textura: textures.wood, escalaUV: 0.7, exterior: 0x9a6a48, interior: 0xd8b080, densidad: 45, piezas: 10, polvo: 0x7a5a3a },
  urna: { nombre: 'Urna', forma: () => formaTorno([[-0.42, 0], [-0.4, 0.17], [-0.12, 0.34], [0.18, 0.28], [0.36, 0.14], [0.42, 0.16]], 8), textura: textures.grain, escalaUV: 0.6, exterior: 0xa0583a, interior: 0x6a3a28, densidad: 40, piezas: 13, polvo: 0x8a5a3a },
  lapida: { nombre: 'Lápida', forma: () => formaTorno([[-0.8, 0.5], [0.55, 0.5], [0.8, 0.28]], 4).map((p) => p.set(p.x * 1.2, p.y, p.z * 0.45)), textura: textures.sarcophagus, escalaUV: 1.4, exterior: 0xf0e8e0, interior: 0x9a9288, densidad: 120, piezas: 16, polvo: 0x9a948a },
};

interface Rompible {
  tipo: TipoRompible;
  body: CANNON.Body;
  mesh: THREE.Mesh;
  convexo: Convexo;
  planos: Plano[];
  material: THREE.MeshLambertMaterial;
  roto: boolean;
}
const rompibles: Rompible[] = [];
const rompibleDe = new Map<CANNON.Body, Rompible>();
const materiales = new Map<TipoRompible, THREE.MeshLambertMaterial>();

function materialDe(t: TipoRompible) {
  let m = materiales.get(t);
  if (!m) {
    m = psxLambert({ map: t.textura, vertexColors: true });
    materiales.set(t, m);
  }
  return m;
}

function shapeDe(c: Convexo, centro: THREE.Vector3) {
  return new CANNON.ConvexPolyhedron({
    vertices: c.verts.map((p) => new CANNON.Vec3(p.x - centro.x, p.y - centro.y, p.z - centro.z)),
    faces: c.faces.map((f) => [...f]),
  });
}

function crearRompible(nombre: keyof typeof TIPOS, x: number, y: number, z: number, rotY = 0) {
  const tipo = TIPOS[nombre]!;
  const pts = tipo.forma();
  // El convexo se guarda centrado en su centro de masas: así coincide con el origen del cuerpo.
  const bruto = casco(pts)!;
  const centro = bruto.centro.clone();
  const local = casco(pts.map((p) => p.clone().sub(centro)))!;
  const planos = planosDe(local);
  const material = materialDe(tipo);
  const geo = geometriaDe(local, new THREE.Vector3(), planos, {
    escalaUV: tipo.escalaUV,
    colorExterior: new THREE.Color(tipo.exterior),
    colorInterior: new THREE.Color(tipo.interior),
  });
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);
  const body = new CANNON.Body({ mass: local.volumen * tipo.densidad * 10, material: mObjeto });
  body.addShape(shapeDe(local, new THREE.Vector3()));
  // Apoya el objeto en el suelo (o en y si se apila).
  let minY = Infinity;
  for (const p of local.verts) minY = Math.min(minY, p.y);
  body.position.set(x, y - minY + 0.001, z);
  body.quaternion.setFromEuler(0, rotY, 0);
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);
  body.sleep();
  const r: Rompible = { tipo, body, mesh, convexo: local, planos, material, roto: false };
  rompibles.push(r);
  rompibleDe.set(body, r);
  return r;
}

// ---------- Trozos ----------
interface Trozo {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  edad: number;
}
const trozos: Trozo[] = [];

function quitarTrozo(i: number) {
  const t = trozos[i]!;
  world.removeBody(t.body);
  t.mesh.removeFromParent();
  t.mesh.geometry.dispose();
  trozos.splice(i, 1);
}

/** Rompe un objeto: fractura su convexo cerca del impacto y lanza los trozos como cuerpos físicos. */
function romper(r: Rompible, puntoMundo: THREE.Vector3, dir: THREE.Vector3, fuerza: number) {
  if (r.roto) return;
  r.roto = true;
  const b = r.body;
  const local = b.pointToLocalFrame(new CANNON.Vec3(puntoMundo.x, puntoMundo.y, puntoMundo.z));
  // El punto de contacto puede caer fuera: se acerca al interior para concentrar ahí los cortes.
  const impacto = new THREE.Vector3(local.x, local.y, local.z).multiplyScalar(0.7);
  const piezas = fracturar(r.convexo, impacto, r.tipo.piezas, rnd);
  const opciones = {
    escalaUV: r.tipo.escalaUV,
    colorExterior: new THREE.Color(r.tipo.exterior),
    colorInterior: new THREE.Color(r.tipo.interior),
  };
  const centroMundo = v3(b.position);
  for (const p of piezas) {
    const geo = geometriaDe(p, p.centro, r.planos, opciones);
    const mesh = new THREE.Mesh(geo, r.material);
    scene.add(mesh);
    const body = new CANNON.Body({ mass: Math.max(0.2, p.volumen * r.tipo.densidad * 10), material: mObjeto });
    body.addShape(shapeDe(p, p.centro));
    const w = b.pointToWorldFrame(new CANNON.Vec3(p.centro.x, p.centro.y, p.centro.z));
    body.position.copy(w);
    body.quaternion.copy(b.quaternion);
    // Velocidad: la del objeto + empuje en la dirección del golpe + estallido radial desde el impacto.
    const radial = new THREE.Vector3(w.x, w.y, w.z).sub(puntoMundo);
    const dist = radial.length();
    radial.normalize();
    const cerca = 1 / (0.4 + dist);
    const k = Math.min(fuerza, 24);
    body.velocity.set(
      b.velocity.x + dir.x * k * rand(0.35, 0.75) + radial.x * k * 0.3 * cerca,
      b.velocity.y + rand(1.5, 4.5) + Math.max(0, radial.y) * 3,
      b.velocity.z + dir.z * k * rand(0.35, 0.75) + radial.z * k * 0.3 * cerca,
    );
    body.angularVelocity.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.6;
    body.linearDamping = 0.05;
    body.angularDamping = 0.15;
    world.addBody(body);
    trozos.push({ body, mesh, edad: 0 });
  }
  while (trozos.length > AJ.maxTrozos) quitarTrozo(0);
  world.removeBody(b);
  r.mesh.removeFromParent();
  r.mesh.geometry.dispose();
  rompibleDe.delete(b);
  polvo(centroMundo, r.tipo.polvo, 18, 5, 0.14);
  polvo(centroMundo, r.tipo.interior, 10, 9, 0.06, -14);
  shake = Math.max(shake, 0.18);
  hitStop = Math.max(hitStop, 0.035);
  stats.rotos++;
}

// ---------- Eventos de colisión (se aplican tras cada paso) ----------
type Evento =
  | { tipo: 'aturdir'; e: Enemigo; punto: THREE.Vector3 }
  | { tipo: 'romper'; r: Rompible; punto: THREE.Vector3; dir: THREE.Vector3; fuerza: number }
  | { tipo: 'contagio'; e: Enemigo };
const eventos: Evento[] = [];

function procesarEventos() {
  for (const ev of eventos) {
    if (ev.tipo === 'aturdir' && ev.e.estado === 'empujado') {
      ev.e.estado = 'aturdido';
      ev.e.t = 2.2;
      ev.e.model.hurtT = 0.3;
      stats.aturdidos++;
      polvo(ev.punto, 0x8a8478, 14, 4, 0.16);
      shake = Math.max(shake, 0.35);
      hitStop = Math.max(hitStop, 0.07);
    } else if (ev.tipo === 'romper') {
      romper(ev.r, ev.punto, ev.dir, ev.fuerza);
    } else if (ev.tipo === 'contagio' && ev.e.estado === 'normal') {
      ev.e.estado = 'empujado';
      ev.e.t = 0.5;
    }
  }
  eventos.length = 0;
}

// ---------- Escena de pruebas ----------
function limpiar() {
  for (const e of enemigos) {
    world.removeBody(e.body);
    e.model.root.removeFromParent();
    e.estrellas.removeFromParent();
  }
  enemigos.length = 0;
  enemigoDe.clear();
  for (const r of rompibles) {
    if (!r.roto) {
      world.removeBody(r.body);
      r.mesh.removeFromParent();
      r.mesh.geometry.dispose();
    }
  }
  rompibles.length = 0;
  rompibleDe.clear();
  while (trozos.length) quitarTrozo(trozos.length - 1);
}

function montarEscena() {
  limpiar();
  rnd = mulberry32(1234);
  guerrero.body.position.set(0, 0.02, 11);
  guerrero.body.velocity.setZero();
  guerrero.yaw = 0;
  guerrero.dashT = 0;
  guerrero.cd = 0;
  stats.rotos = stats.empujones = stats.aturdidos = 0;

  // 1. Justo delante: pirámide de cajas, barriles y una caja suelta.
  const s = 0.92;
  for (let i = 0; i < 3; i++) crearRompible('caja', -4 + (i - 1) * s, 0, 7);
  for (let i = 0; i < 2; i++) crearRompible('caja', -4 + (i - 0.5) * s, s, 7);
  crearRompible('caja', -4, 2 * s, 7, 0.3);
  crearRompible('caja', 0, 0, 7, 0.4);
  crearRompible('barril', 2.2, 0, 7.4);
  crearRompible('barril', 3.1, 0, 6.8);

  // 2. Esqueletos en fila delante del sarcófago central: empújalos contra él para aturdirlos.
  crearEnemigo('esqueleto', -1, 1.8);
  crearEnemigo('esqueleto', 1, 1.8);

  // 3. Esqueleto con cajas detrás: empújalo hacia ellas y las romperá.
  crearEnemigo('esqueleto', -6, 4);
  crearRompible('caja', -6, 0, 1.8);
  crearRompible('caja', -6.6, 0, 1.0, 0.5);
  crearRompible('barril', -5.4, 0, 1.0);

  // 4. Junto al pilar derecho: empújalo de izquierda a derecha contra la columna.
  crearEnemigo('esqueleto', 5.6, 8);

  // 5. Bruto: pesa 4 veces más, apenas se mueve y frena tu carga.
  crearEnemigo('bruto', 7, 2.5);

  // 6. Urnas alrededor del pilar izquierdo.
  for (let i = 0; i < 6; i++) {
    const a = -0.6 + i * 0.42;
    crearRompible('urna', -8 + Math.cos(a) * 2.1, 0, 8 + Math.sin(a) * 2.1);
  }

  // 7. Lápidas al fondo y un grupo de barriles.
  crearRompible('lapida', -4, 0, -6);
  crearRompible('lapida', 0, 0, -6.5);
  crearRompible('lapida', 4, 0, -6);
  for (let i = 0; i < 5; i++) crearRompible('barril', 12 + (i % 3) * 0.95, 0, -6 - Math.floor(i / 3) * 0.95);
  crearEnemigo('esqueleto', 12.9, -3.6);
}

// ---------- Entrada ----------
const keys = new Set<string>();
const pulsado = new Set<string>();
let raton = { x: 0, y: 0, dentro: false };
let ratonClic = false;
window.addEventListener('keydown', (e) => {
  if (!keys.has(e.code)) pulsado.add(e.code);
  keys.add(e.code);
  if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  ocultarInicio();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousemove', (e) => {
  raton = { x: e.clientX, y: e.clientY, dentro: true };
});
canvas.addEventListener('mousedown', (e) => {
  raton = { x: e.clientX, y: e.clientY, dentro: true };
  if (e.button === 0) ratonClic = true;
  ocultarInicio();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const raycaster = new THREE.Raycaster();
const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const apunte = new THREE.Vector3(0, 0, 0);
let apunteFijo = false;
function actualizarApunte() {
  if (apunteFijo) return true;
  if (!raton.dentro) return false;
  const ndc = new THREE.Vector2((raton.x / window.innerWidth) * 2 - 1, -(raton.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(planoSuelo, apunte) !== null;
}

function movimiento() {
  let x = 0;
  let z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const l = Math.hypot(x, z);
  return l > 0 ? { x: x / l, z: z / l } : { x: 0, z: 0 };
}

function iniciarEmbestida() {
  const g = guerrero;
  if (g.cd > 0 || g.dashT > 0) return;
  const p = g.body.position;
  let dx: number;
  let dz: number;
  if (raton.dentro) {
    dx = apunte.x - p.x;
    dz = apunte.z - p.z;
  } else {
    dx = -Math.sin(g.yaw);
    dz = -Math.cos(g.yaw);
  }
  const l = Math.hypot(dx, dz);
  if (l < 0.01) return;
  g.dashDir.set(dx / l, 0, dz / l);
  g.yaw = dirToYaw(g.dashDir.x, g.dashDir.z);
  g.dashT = AJ.embestidaTiempo;
  g.cd = AJ.embestidaCd;
  g.golpeados.clear();
  polvo(new THREE.Vector3(p.x, 0.1, p.z), 0x6a6258, 8, 3, 0.15);
}

// ---------- Simulación de un paso ----------
const _aabbP = new THREE.Vector3();
function paso(dt: number) {
  const g = guerrero;
  const b = g.body;
  g.cd = Math.max(0, g.cd - dt);

  if (g.dashT > 0) {
    const vel = AJ.embestidaDist / AJ.embestidaTiempo;
    b.velocity.x = g.dashDir.x * vel;
    b.velocity.z = g.dashDir.z * vel;
    comprobarImpactosEmbestida();
    g.dashT -= dt;
  } else {
    const m = movimiento();
    const a = 1 - Math.exp(-14 * dt);
    b.velocity.x += (m.x * AJ.andar - b.velocity.x) * a;
    b.velocity.z += (m.z * AJ.andar - b.velocity.z) * a;
  }

  // IA mínima: los enemigos caminan hacia el guerrero; empujados o aturdidos los gobierna la física.
  for (const e of enemigos) {
    const eb = e.body;
    if (e.estado === 'normal') {
      const dx = b.position.x - eb.position.x;
      const dz = b.position.z - eb.position.z;
      const d = Math.hypot(dx, dz);
      const quiere = persiguen && d > 2 && d < 9 ? (e.pesado ? 1.2 : 1.8) : 0;
      const a = 1 - Math.exp(-6 * dt);
      eb.velocity.x += ((d > 0 ? dx / d : 0) * quiere - eb.velocity.x) * a;
      eb.velocity.z += ((d > 0 ? dz / d : 0) * quiere - eb.velocity.z) * a;
      if (quiere > 0) eb.wakeUp();
      if (persiguen || d < 9) e.yaw = dirToYaw(dx, dz);
    } else {
      // Rozamiento al deslizar por el suelo tras el empujón.
      const onGround = eb.position.y < 0.15;
      const f = Math.exp(-(onGround ? 4.5 : 0.6) * dt);
      eb.velocity.x *= f;
      eb.velocity.z *= f;
      e.t -= dt;
      if (e.t <= 0) e.estado = 'normal';
    }
  }

  world.step(dt);
  procesarEventos();

  for (let i = trozos.length - 1; i >= 0; i--) {
    const t = trozos[i]!;
    t.edad += dt;
    if (t.edad > AJ.vidaTrozos + 1) quitarTrozo(i);
  }
}

/** Durante la embestida, mira qué enemigos y objetos alcanza el guerrero en este paso. */
function comprobarImpactosEmbestida() {
  const g = guerrero;
  const p = g.body.position;
  const dir = g.dashDir;
  const vel = AJ.embestidaDist / AJ.embestidaTiempo;
  // Se mira un poco por delante para que el contacto se gestione antes de que lo resuelva el solver.
  const ax = p.x + dir.x * vel * PASO;
  const az = p.z + dir.z * vel * PASO;

  for (const e of enemigos) {
    if (g.golpeados.has(e)) continue;
    const ep = e.body.position;
    const dx = ep.x - ax;
    const dz = ep.z - az;
    const d = Math.hypot(dx, dz);
    if (d > RADIO_G + e.radio + 0.15) continue;
    g.golpeados.add(e);
    empujar(e, dx, dz);
    if (e.pesado) break;
  }

  for (const r of rompibles) {
    if (r.roto || g.golpeados.has(r)) continue;
    r.body.updateAABB();
    const bb = r.body.aabb;
    if (bb.lowerBound.y > 1.9 || bb.upperBound.y < 0.05) continue;
    _aabbP.set(THREE.MathUtils.clamp(ax, bb.lowerBound.x, bb.upperBound.x), 0, THREE.MathUtils.clamp(az, bb.lowerBound.z, bb.upperBound.z));
    const d = Math.hypot(_aabbP.x - ax, _aabbP.z - az);
    if (d > RADIO_G + 0.12) continue;
    g.golpeados.add(r);
    const alto = THREE.MathUtils.clamp(1, bb.lowerBound.y, bb.upperBound.y);
    romper(r, new THREE.Vector3(_aabbP.x, alto, _aabbP.z), dir.clone(), vel);
    // Atravesar madera frena un poco la carga.
    g.dashT -= 0.02;
  }
}

function empujar(e: Enemigo, dx: number, dz: number) {
  const g = guerrero;
  const dir = g.dashDir;
  // Componente lateral: los que reciben el golpe de refilón salen hacia el lado.
  const along = dx * dir.x + dz * dir.z;
  let lx = dx - dir.x * along;
  let lz = dz - dir.z * along;
  const ll = Math.hypot(lx, lz);
  const lado = ll / (RADIO_G + e.radio);
  if (ll > 1e-4) {
    lx /= ll;
    lz /= ll;
  }
  const k = Math.sqrt(60 / e.masa);
  const v = AJ.empuje * k;
  e.body.wakeUp();
  e.body.velocity.set(dir.x * v + lx * v * 0.45 * lado, 3.2 * k, dir.z * v + lz * v * 0.45 * lado);
  e.estado = 'empujado';
  e.t = 0.9;
  e.model.hurtT = 0.25;
  stats.empujones++;
  const pos = v3(e.body.position).add(new THREE.Vector3(0, 1, 0));
  polvo(pos, 0xd8d0c0, 8, 4, 0.08);
  shake = Math.max(shake, e.pesado ? 0.4 : 0.2);
  hitStop = Math.max(hitStop, e.pesado ? 0.09 : 0.05);
  if (e.pesado) {
    // Contra un bruto la carga se detiene en seco y el guerrero rebota.
    g.dashT = 0;
    g.body.velocity.x = -dir.x * 5;
    g.body.velocity.z = -dir.z * 5;
  }
}

// ---------- HUD ----------
const elStats = document.getElementById('stats')!;
const elCd = document.getElementById('cd-fill')!;
const elInicio = document.getElementById('inicio')!;
const btnLento = document.getElementById('btn-lento') as HTMLButtonElement;
const btnPersiguen = document.getElementById('btn-persiguen') as HTMLButtonElement;
btnPersiguen.addEventListener('click', () => alternarPersiguen());
function alternarPersiguen() {
  persiguen = !persiguen;
  btnPersiguen.textContent = `Enemigos persiguen (P): ${persiguen ? 'sí' : 'no'}`;
}
function ocultarInicio() {
  elInicio.classList.add('oculto');
}
document.getElementById('btn-jugar')!.addEventListener('click', ocultarInicio);
document.getElementById('btn-reiniciar')!.addEventListener('click', () => montarEscena());
btnLento.addEventListener('click', () => alternarLento());
function alternarLento() {
  slowMo = !slowMo;
  btnLento.textContent = `Cámara lenta (T): ${slowMo ? 'sí' : 'no'}`;
}
const generar: Record<string, () => void> = {
  Digit1: () => crearRompible('caja', apunte.x, 0, apunte.z, Math.random()),
  Digit2: () => crearRompible('barril', apunte.x, 0, apunte.z),
  Digit3: () => crearRompible('urna', apunte.x, 0, apunte.z),
  Digit4: () => crearRompible('lapida', apunte.x, 0, apunte.z, dirToYaw(guerrero.body.position.x - apunte.x, guerrero.body.position.z - apunte.z)),
  Digit5: () => crearEnemigo('esqueleto', apunte.x, apunte.z),
  Digit6: () => crearEnemigo('bruto', apunte.x, apunte.z),
};
document.querySelectorAll<HTMLButtonElement>('[data-gen]').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (!raton.dentro) apunte.set(guerrero.body.position.x, 0, guerrero.body.position.z - 3);
    generar[btn.dataset.gen!]?.();
  }),
);

// ---------- Bucle ----------
const reloj = new THREE.Timer();
let acum = 0;
let tiempo = 0;
let fps = 60;
const camPos = new THREE.Vector3(0, 10, 18.5);
const camObj = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  reloj.update();
  const real = Math.min(0.05, reloj.getDelta());
  fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;

  const apuntando = actualizarApunte();
  if (pulsado.has('KeyR')) montarEscena();
  if (pulsado.has('KeyT')) alternarLento();
  if (pulsado.has('KeyP')) alternarPersiguen();
  for (const code of Object.keys(generar)) if (pulsado.has(code) && apuntando) generar[code]!();
  if (ratonClic || pulsado.has('Space') || pulsado.has('ShiftLeft') || pulsado.has('ShiftRight')) iniciarEmbestida();
  ratonClic = false;
  pulsado.clear();

  // Hit-stop: congela la simulación unas centésimas para dar peso al impacto.
  let dt = real * (slowMo ? 0.25 : 1);
  if (hitStop > 0) {
    hitStop -= real;
    dt = 0;
  }
  tiempo += dt;
  acum += dt;
  let n = 0;
  while (acum >= PASO && n < 8) {
    paso(PASO);
    acum -= PASO;
    n++;
  }
  if (n === 8) acum = 0;

  // Guerrero
  const g = guerrero;
  const gp = g.body.position;
  if (g.dashT <= 0 && apuntando) {
    const dx = apunte.x - gp.x;
    const dz = apunte.z - gp.z;
    if (Math.hypot(dx, dz) > 0.3) g.yaw = dirToYaw(dx, dz);
  } else if (g.dashT <= 0 && !raton.dentro) {
    const m = movimiento();
    if (m.x || m.z) g.yaw = dirToYaw(m.x, m.z);
  }
  g.model.root.position.set(gp.x, gp.y, gp.z);
  g.model.root.rotation.y = g.yaw;
  g.model.root.rotation.x = g.dashT > 0 ? -0.25 : 0;
  animateModel(g.model, {
    dt,
    speed: Math.hypot(g.body.velocity.x, g.body.velocity.z),
    airborne: false,
    stunned: false,
    windup: 0,
    spinning: false,
    guarding: g.dashT > 0,
    time: tiempo,
  });
  playerLight.position.set(gp.x, 3, gp.z + 1);

  // Enemigos
  for (const e of enemigos) {
    const p = e.body.position;
    e.model.root.position.set(p.x, p.y, p.z);
    if (e.estado === 'normal') e.model.root.rotation.y = e.yaw;
    // Inclinación visual según la velocidad (la física los mantiene de pie).
    const vx = e.body.velocity.x;
    const vz = e.body.velocity.z;
    const tilt = Math.min(0.5, Math.hypot(vx, vz) * 0.04) * (e.estado === 'normal' ? 0 : 1);
    e.model.root.rotation.x = THREE.MathUtils.lerp(e.model.root.rotation.x, -tilt, 0.2);
    animateModel(e.model, {
      dt,
      speed: e.estado === 'normal' ? Math.hypot(vx, vz) : 0,
      airborne: p.y > 0.2,
      stunned: e.estado === 'aturdido',
      windup: 0,
      spinning: false,
      guarding: false,
      time: tiempo,
    });
    e.estrellas.visible = e.estado === 'aturdido';
    if (e.estrellas.visible) {
      e.estrellas.position.set(p.x, p.y + (e.pesado ? 2.8 : 2.05), p.z);
      e.estrellas.rotation.y = tiempo * 5;
    }
  }

  // Objetos y trozos
  for (const r of rompibles) {
    if (r.roto) continue;
    r.mesh.position.copy(r.body.position as unknown as THREE.Vector3);
    r.mesh.quaternion.copy(r.body.quaternion as unknown as THREE.Quaternion);
  }
  for (const t of trozos) {
    t.mesh.position.copy(t.body.position as unknown as THREE.Vector3);
    t.mesh.quaternion.copy(t.body.quaternion as unknown as THREE.Quaternion);
    const fin = t.edad - AJ.vidaTrozos;
    t.mesh.scale.setScalar(fin > 0 ? Math.max(0.01, 1 - fin) : 1);
  }
  actualizarParticulas(dt);

  // Indicadores
  marcaApunte.visible = apuntando;
  marcaApunte.position.set(apunte.x, 0.03, apunte.z);
  const dirVis = new THREE.Vector3(-Math.sin(g.yaw), 0, -Math.cos(g.yaw));
  guia.visible = g.cd <= 0 && g.dashT <= 0;
  guia.scale.y = AJ.embestidaDist;
  guia.position.set(gp.x + dirVis.x * AJ.embestidaDist * 0.5, 0.02, gp.z + dirVis.z * AJ.embestidaDist * 0.5);
  guia.rotation.z = -g.yaw;

  // Cámara: picado fijo que sigue al guerrero, con temblor en los impactos.
  camObj.set(gp.x, 0, gp.z);
  const objetivo = new THREE.Vector3(gp.x, 10, gp.z + 7.5);
  camPos.lerp(objetivo, 1 - Math.exp(-6 * real));
  shake = Math.max(0, shake - real * 1.6);
  const s = shake * shake * 1.2;
  camera.position.set(camPos.x + rand(-s, s), camPos.y + rand(-s, s), camPos.z + rand(-s, s));
  camera.lookAt(camPos.x, 0.6, camPos.z - 7.5);

  updateBraziers(arenaView, tiempo);
  post.render(renderer, scene, camera);

  elCd.style.width = `${(1 - g.cd / AJ.embestidaCd) * 100}%`;
  let despiertos = 0;
  for (const bd of world.bodies) if (bd.mass > 0 && bd.sleepState !== CANNON.Body.SLEEPING) despiertos++;
  elStats.textContent =
    `${fps.toFixed(0)} FPS · objetos rotos ${stats.rotos} · empujones ${stats.empujones} · aturdidos ${stats.aturdidos}\n` +
    `trozos ${trozos.length} · cuerpos ${world.bodies.length} (${despiertos} activos)`;
}

montarEscena();
frame();

// Gancho para pruebas automáticas.
(window as unknown as { __proto: unknown }).__proto = {
  guerrero,
  enemigos,
  rompibles,
  trozos,
  stats,
  apuntarA(x: number, z: number) {
    raton.dentro = true;
    apunteFijo = true;
    apunte.set(x, 0, z);
  },
  embestir: iniciarEmbestida,
  persiguen: () => persiguen,
  colocar(x: number, z: number) {
    guerrero.body.position.set(x, 0.02, z);
    guerrero.body.velocity.setZero();
  },
};
