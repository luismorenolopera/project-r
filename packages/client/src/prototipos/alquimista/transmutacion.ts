import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { dirToYaw, resolveCircle } from '@mazmorra/shared';
import { triggerAttack } from '../../render/models';
import { psxLambert } from '../../render/psx';
import { ELEMENTOS } from '../mago/grimorio';
import { arena, duros, estado, eventos, mago, mObjeto, rand, scene, temblor, textures, v3, world, type GolpeBase } from '../mago/mundo';
import { anillo, anuncio, arco, mostrarHaz, numero, ocultarHaz, particulas, sector } from '../mago/efectos';
import {
  GRUPO_TROZO, danarObjeto, distanciaObjeto, objetosEnRadio, objetosEnRayo, puntoCercano, quitarTrozo, retirarRompible, rompibleDe,
  rompibles, romper, trozos, type Rompible,
} from '../mago/objetos';
import { centroDe, empujar, enemigos, enemigosEnRadio, enemigosEnRayo, ganchosEnemigos, masCercano, type Enemigo } from '../mago/enemigos';
import { cadenaRayo, crearZona, golpearArea, golpearEnemigo, zonas, type Zona } from '../mago/combate';
import {
  INTERACCIONES, MATERIAL, PIEDRA_SUELO_POR_SEGUNDO, anadir, arma, interaccionPara, inventarioVacio, materiaDe, meterEnCrisol, pagar, puedePagar, receta,
  textoCoste, tiempoDescomponer, type Arma, type Coste, type Crisol, type Elemento, type InteraccionId, type MaterialId, type Receta,
} from './materia';
import { cavar, flujo, sello } from './circulo';

/**
 * Motor del alquimista: descomponer el entorno en materia, lanzar recetas (Q), forjar armas (F),
 * atacar con ellas (clic izquierdo) y transmutar directamente lo que hay bajo el cursor (E).
 *
 * Lo físico de verdad (cannon-es):
 * - Púas y pilares son cuerpos cinemáticos que suben del suelo: empujan lo que tienen encima y quedan
 *   como obstáculos duros (un enemigo despedido contra ellos se aturde, como contra un muro).
 * - Jabalinas, cuchillas y hojas son cuerpos dinámicos: rebotan en objetos, se clavan en los muros y
 *   dañan según la velocidad del impacto. Al pararse quedan como restos que se pueden volver a descomponer.
 * - Los esqueletos sueltan sus armas oxidadas al morir: metal para el alquimista.
 */

const colorElem = (e: Elemento) => ELEMENTOS[e].color;
const colorMat = (m: MaterialId) => MATERIAL[m].color;

/** Grupo de colisión de los enemigos en este sandbox: las piezas lanzadas no chocan con ellos físicamente (el golpe se calcula aparte). */
export const GRUPO_ENEMIGO = 4;
/** El alquimista tiene grupo propio para que sus piezas no choquen con él al salir de sus manos. */
export const GRUPO_ALQUIMISTA = 8;
mago.body.collisionFilterGroup = GRUPO_ALQUIMISTA;
const ALCANCE_MANOS = 8;
const ALCANCE_LANZAR = 14;

// ---------------------------------------------------------------- estado
export const alq = {
  inv: inventarioVacio(),
  crisol: [] as Crisol,
  arma: null as (Arma & { usos: number }) | null,
  armaCd: 0,
  lanzarCd: 0,
  entornoCd: 0,
  /** Recetas lanzadas, armas forjadas e interacciones usadas (para el recetario). */
  lanzadas: new Set<string>(),
  forjadas: new Set<string>(),
  interacciones: new Set<InteraccionId>(),
  materiaInfinita: false,
};

export const ganchosAlq = {
  /** Algo cambió en el inventario, el crisol o el arma (la interfaz se repinta). */
  cambio: () => {},
  descubrir: (_tipo: 'receta' | 'arma' | 'entorno', _clave: string, _nombre: string) => {},
  aviso: (_texto: string) => {},
};

export const estadisticasAlq = { piezas: 0, estructuras: 0, descompuesto: 0, creado: 0 };

function sumar(mat: MaterialId, n: number, donde: THREE.Vector3) {
  const entro = anadir(alq.inv, mat, n);
  estadisticasAlq.descompuesto += entro;
  if (entro >= 0.95) numero(donde, `+${Math.round(entro)} ${MATERIAL[mat].nombre}`, MATERIAL[mat].css);
  ganchosAlq.cambio();
  return entro;
}

function cobrar(coste: Coste): boolean {
  if (alq.materiaInfinita) return true;
  if (!pagar(alq.inv, coste)) {
    ganchosAlq.aviso(`Falta materia: ${textoCoste(coste)}`);
    return false;
  }
  for (const n of Object.values(coste)) estadisticasAlq.creado += n ?? 0;
  ganchosAlq.cambio();
  return true;
}

export function meter(m: MaterialId) {
  alq.crisol = meterEnCrisol(alq.crisol, m);
  ganchosAlq.cambio();
}
export function vaciarCrisol() {
  alq.crisol = [];
  ganchosAlq.cambio();
}

// ---------------------------------------------------------------- utilidades
const despues: { t: number; fn: () => void }[] = [];
function retrasar(t: number, fn: () => void) {
  despues.push({ t, fn });
}

function manos() {
  const p = mago.body.position;
  return new THREE.Vector3(p.x, p.y + 1.1, p.z);
}
function pies() {
  const p = mago.body.position;
  return new THREE.Vector3(p.x, 0, p.z);
}
function dirHacia(objetivo: THREE.Vector3) {
  const d = new THREE.Vector3(objetivo.x - mago.body.position.x, 0, objetivo.z - mago.body.position.z);
  if (d.lengthSq() < 1e-4) d.set(-Math.sin(mago.yaw), 0, -Math.cos(mago.yaw));
  return d.normalize();
}
function limitar(objetivo: THREE.Vector3, max: number) {
  const p = pies();
  const d = objetivo.clone().setY(0).sub(p);
  if (d.length() > max) d.setLength(max);
  return p.add(d);
}
function enArena(p: THREE.Vector3, margen = 0.4) {
  const h = arena.halfSize - margen;
  return Math.abs(p.x) < h && Math.abs(p.z) < h;
}
function rotarY(v: THREE.Vector3, a: number) {
  return v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
}

function enCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number) {
  const cos = Math.cos(angulo / 2);
  const res: Enemigo[] = [];
  for (const e of enemigos) {
    if (e.muerto) continue;
    const dx = e.body.position.x - origen.x;
    const dz = e.body.position.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d - e.radio > radio) continue;
    if (d > 0.6 && (dx * dir.x + dz * dir.z) / d < cos) continue;
    res.push(e);
  }
  return res;
}
function objetosEnCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number) {
  const cos = Math.cos(angulo / 2);
  const res: Rompible[] = [];
  for (const r of rompibles) {
    if (r.roto) continue;
    const p = puntoCercano(r, origen);
    const dx = p.x - origen.x;
    const dz = p.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d > radio) continue;
    if (d > 0.4 && (dx * dir.x + dz * dir.z) / d < cos) continue;
    res.push(r);
  }
  return res;
}
function impulsoCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number, fuerza: number) {
  const cos = Math.cos(angulo / 2);
  for (const t of trozos) {
    const b = t.body;
    const dx = b.position.x - origen.x;
    const dz = b.position.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d > radio || d < 0.05 || (dx * dir.x + dz * dir.z) / d < cos) continue;
    const f = fuerza * (1 - d / radio);
    b.wakeUp();
    b.velocity.x += (dx / d) * f;
    b.velocity.z += (dz / d) * f;
    b.velocity.y += f * 0.3;
  }
}

/** Enemigo bajo el cursor (o muy cerca). */
function enemigoEn(p: THREE.Vector3, holgura = 0.5) {
  let mejor: Enemigo | null = null;
  let md = Infinity;
  for (const e of enemigos) {
    if (e.muerto) continue;
    const d = Math.hypot(e.body.position.x - p.x, e.body.position.z - p.z) - e.radio;
    if (d < holgura && d < md) {
      md = d;
      mejor = e;
    }
  }
  return mejor;
}
/** Objeto intacto bajo el cursor: el de caja envolvente más cercana al punto, a menos de `holgura`. */
export function objetoEn(p: THREE.Vector3, holgura = 0.45) {
  const q = p.clone().setY(0.35);
  let mejor: Rompible | null = null;
  let md = holgura;
  for (const r of rompibles) {
    if (r.roto) continue;
    const d = distanciaObjeto(r, q);
    if (d < md) {
      md = d;
      mejor = r;
    }
  }
  return mejor;
}

/** Lanza por los aires a un enemigo (pilares y púas). */
function lanzarArriba(e: Enemigo, desde: THREE.Vector3, fuerza: number) {
  if (e.masa === 0 || e.muerto) return;
  const d = new THREE.Vector3(e.body.position.x - desde.x, 0, e.body.position.z - desde.z);
  if (d.lengthSq() < 1e-4) d.set(rand(-1, 1), 0, rand(-1, 1));
  d.normalize();
  const k = Math.sqrt(60 / e.masa);
  e.body.wakeUp();
  e.body.velocity.set(d.x * 2.5 * k, fuerza * k, d.z * 2.5 * k);
  e.empujadoT = 1.2;
}

// ---------------------------------------------------------------- estructuras: púas y pilares (cuerpos cinemáticos)
type FaseEstructura = 'subiendo' | 'quieta' | 'bajando';
interface Estructura {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  alto: number;
  t: number;
  vida: number;
  subir: number;
  fase: FaseEstructura;
  /** Material que devuelve si se descompone. */
  mat: MaterialId;
  volumen: number;
}
const estructuras: Estructura[] = [];
const MAX_ESTRUCTURAS = 70;

const matPiedra = psxLambert({ map: textures.wall, color: 0xb8ac98 });
const matPiedraViva = new Map<Elemento, THREE.MeshLambertMaterial>();
function matPua(e: Elemento) {
  if (e === 'fuerza') return matPiedra;
  let m = matPiedraViva.get(e);
  if (!m) {
    const c = new THREE.Color(colorElem(e));
    m = psxLambert({ map: textures.wall, color: new THREE.Color(0xb8ac98).lerp(c, 0.45).getHex(), emissive: c.multiplyScalar(0.35).getHex() });
    matPiedraViva.set(e, m);
  }
  return m;
}
const geoPua = new THREE.ConeGeometry(0.32, 1.5, 6);
const geoPilar = new THREE.CylinderGeometry(0.62, 0.78, 2.6, 8);

function crearEstructura(pos: THREE.Vector3, tipo: 'pua' | 'pilar', vida: number, elemento: Elemento, escala = 1) {
  if (!enArena(pos)) return null;
  const alto = (tipo === 'pua' ? 1.5 : 2.6) * escala;
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: mObjeto });
  if (tipo === 'pua') body.addShape(new CANNON.Cylinder(0.05 * escala, 0.32 * escala, alto, 6));
  else body.addShape(new CANNON.Cylinder(0.62, 0.78, alto, 8));
  body.position.set(pos.x, -alto / 2, pos.z);
  const subir = tipo === 'pua' ? 0.1 : 0.18;
  body.velocity.set(0, alto / subir, 0);
  // Ligera inclinación al azar: las púas brotan torcidas.
  if (tipo === 'pua') body.quaternion.setFromEuler(rand(-0.18, 0.18), rand(0, Math.PI), rand(-0.18, 0.18));
  world.addBody(body);
  duros.add(body);
  const mesh = new THREE.Mesh(tipo === 'pua' ? geoPua : geoPilar, tipo === 'pua' ? matPua(elemento) : matPiedra);
  mesh.scale.setScalar(tipo === 'pua' ? escala : 1);
  scene.add(mesh);
  const est: Estructura = { body, mesh, alto, t: 0, vida, subir, fase: 'subiendo', mat: 'piedra', volumen: tipo === 'pua' ? 0.06 * escala : 0.5 };
  estructuras.push(est);
  sincronizarEstructura(est);
  while (estructuras.length > MAX_ESTRUCTURAS) bajar(estructuras.find((e) => e.fase !== 'bajando') ?? estructuras[0]!);
  particulas(pos.clone().setY(0.2), 0x8a8478, tipo === 'pua' ? 5 : 14, 3, { tam: tipo === 'pua' ? 0.1 : 0.16 });
  return est;
}

function bajar(e: Estructura) {
  if (e.fase === 'bajando') return;
  e.fase = 'bajando';
  e.t = 0;
  e.body.velocity.set(0, -e.alto / 0.45, 0);
}

function quitarEstructura(i: number) {
  const e = estructuras[i]!;
  world.removeBody(e.body);
  duros.delete(e.body);
  e.mesh.removeFromParent();
  estructuras.splice(i, 1);
}

function sincronizarEstructura(e: Estructura) {
  const p = e.body.interpolatedPosition;
  e.mesh.position.set(p.x, p.y, p.z);
  const q = e.body.quaternion;
  e.mesh.quaternion.set(q.x, q.y, q.z, q.w);
}

function actualizarEstructuras(dt: number) {
  for (let i = estructuras.length - 1; i >= 0; i--) {
    const e = estructuras[i]!;
    e.t += dt;
    if (e.fase === 'subiendo' && e.t >= e.subir) {
      e.fase = 'quieta';
      e.body.velocity.setZero();
      e.body.position.y = e.alto / 2;
      e.t = 0;
    } else if (e.fase === 'quieta' && e.t >= e.vida) bajar(e);
    else if (e.fase === 'bajando' && e.body.position.y < -e.alto / 2) quitarEstructura(i);
  }
}

/** Una púa: brota, golpea y lanza a quien esté justo encima. */
function pua(pos: THREE.Vector3, r: Pick<Receta, 'dano' | 'elemento' | 'frio' | 'aturdir' | 'empuje'>, vida = 3.5, escala = 1) {
  const est = crearEstructura(pos, 'pua', vida, r.elemento, escala);
  if (!est) return;
  const centro = pos.clone().setY(0.7);
  for (const { e } of enemigosEnRadio(pos, 0.55 * escala)) {
    golpearEnemigo(e, { dano: 24 * r.dano, elemento: r.elemento, frio: r.frio || undefined, aturdir: r.aturdir || undefined, punto: centroDe(e), dir: new THREE.Vector3(0, 0, 1) });
    if (!e.muerto) lanzarArriba(e, pos, 7.5 * Math.sqrt(r.empuje));
  }
  for (const { r: o } of objetosEnRadio(centro, 0.45 * escala)) danarObjeto(o, { dano: 20 * r.dano, elemento: r.elemento, punto: puntoCercano(o, centro), dir: new THREE.Vector3(0, 1, 0), empuje: 4 });
  if (r.elemento !== 'fuerza') particulas(centro, colorElem(r.elemento), 4, 2, { tam: 0.08, aditivo: true });
}

// ---------------------------------------------------------------- piezas físicas: jabalinas, cuchillas y restos
type TipoPieza = 'jabalina' | 'cuchilla' | 'resto';
interface Pieza {
  tipo: TipoPieza;
  body: CANNON.Body;
  mesh: THREE.Object3D;
  mat: MaterialId;
  volumen: number;
  activa: boolean;
  golpe: { dano: number; elemento: Elemento; empuje: number; frio: number; aturdir: number };
  vel0: number;
  perfora: boolean;
  golpeados: Set<Enemigo>;
  previa: THREE.Vector3;
  t: number;
  clavada: boolean;
}
const piezas: Pieza[] = [];
const MAX_PIEZAS = 90;
const VIDA_RESTO = 16;
const colaChoques: { p: Pieza; otro: CANNON.Body; vel: number }[] = [];

const matMadera = psxLambert({ map: textures.wood, color: 0xd8b080 });
const matMetal = psxLambert({ map: textures.grain, color: 0xb8c0cc, emissive: 0x101418 });
const matOxido = psxLambert({ map: textures.grain, color: 0x8a6a5a });
const matPunta = new Map<Elemento, THREE.MeshLambertMaterial>();
function matDePunta(e: Elemento) {
  let m = matPunta.get(e);
  if (!m) {
    const c = colorElem(e);
    m = psxLambert({ color: e === 'fuerza' ? 0xd8dce4 : c, emissive: e === 'fuerza' ? 0x101010 : new THREE.Color(c).multiplyScalar(0.6).getHex() });
    matPunta.set(e, m);
  }
  return m;
}

function mallaJabalina(e: Elemento) {
  const g = new THREE.Group();
  const asta = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.5), matMadera);
  const punta = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 4), matDePunta(e));
  punta.rotation.x = Math.PI / 2;
  punta.position.z = 0.86;
  g.add(asta, punta);
  return g;
}
const geoCuchilla = new THREE.BoxGeometry(0.42, 0.04, 0.16);
const geoResto = new THREE.BoxGeometry(0.5, 0.06, 0.12);

function crearPieza(tipo: TipoPieza, pos: THREE.Vector3, vel: THREE.Vector3, o: Partial<Pieza> & { mat: MaterialId; mesh: THREE.Object3D; volumen: number }) {
  const body = new CANNON.Body({
    mass: tipo === 'jabalina' ? 3 : tipo === 'cuchilla' ? 0.8 : 1.5,
    material: mObjeto,
    collisionFilterGroup: GRUPO_TROZO,
    collisionFilterMask: ~(GRUPO_TROZO | GRUPO_ENEMIGO | GRUPO_ALQUIMISTA),
  });
  if (tipo === 'jabalina') body.addShape(new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.8)));
  else if (tipo === 'cuchilla') body.addShape(new CANNON.Box(new CANNON.Vec3(0.21, 0.03, 0.08)));
  else body.addShape(new CANNON.Box(new CANNON.Vec3(0.25, 0.04, 0.07)));
  body.position.set(pos.x, pos.y, pos.z);
  body.velocity.set(vel.x, vel.y, vel.z);
  if (tipo === 'jabalina') {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.clone().normalize());
    body.quaternion.set(q.x, q.y, q.z, q.w);
  } else if (tipo === 'cuchilla') {
    body.angularVelocity.set(0, 28, 0);
  } else {
    body.angularVelocity.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
  }
  body.linearDamping = 0.01;
  body.angularDamping = tipo === 'cuchilla' ? 0.02 : 0.2;
  body.sleepSpeedLimit = 0.3;
  body.sleepTimeLimit = 0.5;
  world.addBody(body);
  scene.add(o.mesh);
  const p: Pieza = {
    tipo, body, mesh: o.mesh, mat: o.mat, volumen: o.volumen, activa: tipo !== 'resto',
    golpe: o.golpe ?? { dano: 0, elemento: 'fuerza', empuje: 0, frio: 0, aturdir: 0 },
    vel0: Math.max(1, vel.length()), perfora: o.perfora ?? false, golpeados: new Set(), previa: pos.clone(), t: 0, clavada: false,
  };
  body.addEventListener('collide', (ev: { body: CANNON.Body }) => {
    if (!p.activa) return;
    colaChoques.push({ p, otro: ev.body, vel: Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) });
  });
  piezas.push(p);
  estadisticasAlq.piezas++;
  while (piezas.length > MAX_PIEZAS) quitarPieza(0);
  return p;
}

function quitarPieza(i: number) {
  const p = piezas[i]!;
  world.removeBody(p.body);
  p.mesh.removeFromParent();
  piezas.splice(i, 1);
}

function desactivar(p: Pieza) {
  if (!p.activa) return;
  p.activa = false;
  p.t = 0;
}

function jabalina(origen: THREE.Vector3, dir: THREE.Vector3, r: Receta, vel = 30) {
  const v = dir.clone().multiplyScalar(vel);
  v.y = 1.2;
  crearPieza('jabalina', origen, v, {
    mat: 'madera', mesh: mallaJabalina(r.elemento), volumen: 0.12,
    golpe: { dano: 30 * r.dano, elemento: r.elemento, empuje: 9 * r.empuje, frio: r.frio, aturdir: r.aturdir }, perfora: r.perfora,
  });
}

function cuchilla(origen: THREE.Vector3, dir: THREE.Vector3, g: Pieza['golpe'], perfora: boolean, vel = 24) {
  const v = dir.clone().multiplyScalar(vel);
  v.y = 0.6;
  const mesh = new THREE.Mesh(geoCuchilla, g.elemento === 'fuerza' ? matMetal : matDePunta(g.elemento));
  crearPieza('cuchilla', origen, v, { mat: 'metal', mesh, volumen: 0.04, golpe: g, perfora });
}

/** Arma oxidada que suelta un esqueleto (o un bruto) al caer: metal para descomponer. */
function soltarResto(pos: THREE.Vector3, mat: MaterialId, volumen: number) {
  const mesh = new THREE.Mesh(geoResto, mat === 'metal' ? matOxido : matMadera);
  crearPieza('resto', pos.clone().setY(Math.max(0.6, pos.y)), new THREE.Vector3(rand(-2, 2), rand(3, 5), rand(-2, 2)), { mat, mesh, volumen });
}

ganchosEnemigos.muerte = (e) => {
  const p = v3(e.body.position).setY(1);
  if (e.tipo === 'esqueleto') soltarResto(p, 'metal', 0.18);
  else if (e.tipo === 'bruto') for (let i = 0; i < 3; i++) soltarResto(p, 'metal', 0.25);
};

/** Golpes de las piezas activas contra enemigos (barrido de su recorrido) y choques físicos con objetos y muros. */
function actualizarPiezas(dt: number) {
  for (let i = piezas.length - 1; i >= 0; i--) {
    const p = piezas[i]!;
    p.t += dt;
    const b = p.body;
    const pos = v3(b.position);
    if (p.activa) {
      // En vuelo apenas caen (la gravedad del mundo es alta para que los trozos pesen).
      b.force.y += b.mass * 20 * 0.85;
      const vel = Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
      if (p.tipo === 'jabalina' && vel > 2) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(b.velocity.x, b.velocity.y, b.velocity.z).normalize());
        b.quaternion.set(q.x, q.y, q.z, q.w);
        b.angularVelocity.setZero();
      }
      // Barrido contra enemigos: del punto anterior al actual.
      const radio = p.tipo === 'jabalina' ? 0.18 : 0.24;
      for (const e of enemigos) {
        if (e.muerto || p.golpeados.has(e)) continue;
        if (pos.y > e.alto + 0.3 || pos.y < -0.2) continue;
        if (distSegmento(e.body.position.x, e.body.position.z, p.previa, pos) > e.radio + radio) continue;
        p.golpeados.add(e);
        const dir = new THREE.Vector3(b.velocity.x, 0, b.velocity.z).normalize();
        const k = THREE.MathUtils.clamp(vel / p.vel0, 0.35, 1.2);
        golpearEnemigo(e, {
          dano: p.golpe.dano * k, elemento: p.golpe.elemento, empuje: p.golpe.empuje * k, frio: p.golpe.frio || undefined,
          aturdir: p.golpe.aturdir || undefined, punto: centroDe(e), dir,
        });
        particulas(centroDe(e), p.tipo === 'jabalina' ? 0xd8b080 : 0xd8dce4, 4, 3, { tam: 0.06 });
        if (!p.perfora) {
          b.velocity.x *= -0.15;
          b.velocity.z *= -0.15;
          desactivar(p);
          break;
        }
      }
      if (p.activa && (vel < 4 || p.t > 3 || !enArena(pos, 0))) desactivar(p);
    } else if (p.t > VIDA_RESTO) {
      quitarPieza(i);
      continue;
    }
    p.previa.copy(pos);
  }
}

/** Distancia en XZ de un punto al segmento a-b. */
function distSegmento(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 1e-8 ? THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1) : 0;
  return Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
}

/** Choques físicos de las piezas (tras el paso de física). */
export function procesarChoquesPiezas() {
  for (const c of colaChoques) {
    const p = c.p;
    if (!p.activa) continue;
    const r = rompibleDe.get(c.otro);
    const dir = new THREE.Vector3(p.body.velocity.x, 0, p.body.velocity.z).normalize();
    if (r) {
      const k = THREE.MathUtils.clamp(c.vel / p.vel0, 0.3, 1.2);
      danarObjeto(r, { dano: p.golpe.dano * k, elemento: p.golpe.elemento, punto: v3(p.body.position), dir, empuje: p.golpe.empuje * 0.5 });
      if (!p.perfora) desactivar(p);
      continue;
    }
    if (duros.has(c.otro) || c.otro.mass === 0) {
      // Contra un muro, pilar o púa a buena velocidad, la jabalina se clava y se queda ahí.
      if (p.tipo === 'jabalina' && duros.has(c.otro) && c.vel > 12) {
        p.body.type = CANNON.Body.KINEMATIC;
        p.body.velocity.setZero();
        p.body.angularVelocity.setZero();
        p.clavada = true;
        particulas(v3(p.body.position), 0x8a8478, 5, 2, { tam: 0.07 });
      }
      desactivar(p);
    }
  }
  colaChoques.length = 0;
}

// ---------------------------------------------------------------- proyectiles de luz (cetro y prisma)
interface Rayo {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  golpe: { dano: number; elemento: Elemento; empuje: number; frio: number; aturdir: number };
  perfora: boolean;
  recorrido: number;
  golpeados: Set<Enemigo>;
  mesh: THREE.Mesh;
}
const rayos: Rayo[] = [];
const geoRayo = new THREE.OctahedronGeometry(0.16, 0);
const matRayo = new Map<number, THREE.MeshBasicMaterial>();
function matDeRayo(c: number) {
  let m = matRayo.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    matRayo.set(c, m);
  }
  return m;
}

function dispararRayo(origen: THREE.Vector3, dir: THREE.Vector3, golpe: Rayo['golpe'], alcance: number, perfora: boolean) {
  const mesh = new THREE.Mesh(geoRayo, matDeRayo(colorElem(golpe.elemento)));
  mesh.position.copy(origen);
  scene.add(mesh);
  rayos.push({ pos: origen.clone(), vel: dir.clone().setY(0).normalize().multiplyScalar(26), golpe, perfora, recorrido: alcance, golpeados: new Set(), mesh });
}

function actualizarRayos(dt: number) {
  for (let i = rayos.length - 1; i >= 0; i--) {
    const r = rayos[i]!;
    const antes = r.pos.clone();
    r.pos.addScaledVector(r.vel, dt);
    r.recorrido -= r.vel.length() * dt;
    const dir = r.vel.clone().normalize();
    let fin = r.recorrido <= 0 || resolveCircle(arena, r.pos.x, r.pos.z, 0.1).hit;
    for (const e of enemigos) {
      if (fin || e.muerto || r.golpeados.has(e)) continue;
      if (distSegmento(e.body.position.x, e.body.position.z, antes, r.pos) > e.radio + 0.2) continue;
      r.golpeados.add(e);
      golpearEnemigo(e, { ...r.golpe, frio: r.golpe.frio || undefined, aturdir: r.golpe.aturdir || undefined, punto: centroDe(e), dir });
      if (!r.perfora) fin = true;
    }
    if (!fin) {
      const o = objetosEnRayo(antes, dir, antes.distanceTo(r.pos))[0];
      if (o) {
        danarObjeto(o.r, { dano: r.golpe.dano, elemento: r.golpe.elemento, punto: r.pos.clone(), dir, empuje: r.golpe.empuje });
        fin = true;
      }
    }
    r.mesh.position.copy(r.pos);
    r.mesh.rotation.y += dt * 12;
    if (Math.random() < 0.5) particulas(r.pos, colorElem(r.golpe.elemento), 1, 0.5, { tam: 0.06, aditivo: true, vida: 0.25, gravedad: 0 });
    if (fin) {
      particulas(r.pos, colorElem(r.golpe.elemento), 6, 2.5, { tam: 0.07, aditivo: true });
      r.mesh.removeFromParent();
      rayos.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- prismas
interface Prisma {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  cd: number;
  objetivos: number;
  r: Receta;
}
const prismas: Prisma[] = [];
const geoPrisma = new THREE.OctahedronGeometry(0.42, 0);

function crearPrisma(pos: THREE.Vector3, r: Receta) {
  const c = colorElem(r.elemento);
  const mesh = new THREE.Mesh(geoPrisma, psxLambert({ color: c, emissive: new THREE.Color(c).multiplyScalar(0.7).getHex(), transparent: true, opacity: 0.85 }));
  mesh.scale.set(0.8, 1.5, 0.8);
  scene.add(mesh);
  prismas.push({ pos: pos.clone().setY(1.8), mesh, t: 0, dur: r.gran ? 8 : 5, cd: 0.3, objetivos: r.gran ? 2 : 1, r });
  flujo(manos(), pos.clone().setY(1.8), colorMat('cristal'), 18);
}

function actualizarPrismas(dt: number) {
  for (let i = prismas.length - 1; i >= 0; i--) {
    const p = prismas[i]!;
    p.t += dt;
    p.cd -= dt;
    p.mesh.position.set(p.pos.x, p.pos.y + Math.sin(p.t * 3) * 0.12, p.pos.z);
    p.mesh.rotation.y += dt * 2.5;
    if (p.cd <= 0) {
      p.cd = 0.55;
      const tocados = new Set<Enemigo>();
      for (let k = 0; k < p.objetivos; k++) {
        const e = masCercano(p.pos, 9 * p.r.alcance, tocados);
        if (!e) break;
        tocados.add(e);
        const c = centroDe(e);
        if (p.r.elemento === 'rayo') {
          cadenaRayo(p.mesh.position, e, 2, 12 * p.r.dano);
        } else {
          arco(p.mesh.position.clone(), c, colorElem(p.r.elemento), 0.14, 4);
          golpearEnemigo(e, {
            dano: 12 * p.r.dano, elemento: p.r.elemento, frio: p.r.frio || undefined, aturdir: p.r.aturdir ? 0.3 : undefined,
            empuje: p.r.empuje > 1 ? 5 : 0, punto: c, dir: c.clone().sub(p.pos).setY(0).normalize(),
          });
        }
      }
    }
    if (p.t >= p.dur) {
      particulas(p.mesh.position, colorElem(p.r.elemento), 16, 4, { tam: 0.09, aditivo: true });
      p.mesh.removeFromParent();
      (p.mesh.material as THREE.Material).dispose();
      prismas.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- frascos y charcos de aceite
interface Frasco {
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
  t: number;
  dur: number;
  mesh: THREE.Mesh;
  r: Receta;
}
const frascos: Frasco[] = [];
interface Charco {
  zona: Zona;
  elemento: Elemento;
  radio: number;
  prendido: boolean;
}
const charcos: Charco[] = [];
const geoFrasco = new THREE.OctahedronGeometry(0.16, 0);
const matFrasco = psxLambert({ color: 0xd8a020, emissive: 0x3a2a00 });

function lanzarFrasco(hasta: THREE.Vector3, r: Receta) {
  const mesh = new THREE.Mesh(geoFrasco, matFrasco);
  scene.add(mesh);
  const desde = manos();
  frascos.push({ desde, hasta: hasta.clone().setY(0.1), t: 0, dur: 0.25 + desde.distanceTo(hasta) * 0.035, mesh, r });
}

function actualizarFrascos(dt: number) {
  for (let i = frascos.length - 1; i >= 0; i--) {
    const f = frascos[i]!;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    f.mesh.position.lerpVectors(f.desde, f.hasta, k);
    f.mesh.position.y += Math.sin(k * Math.PI) * (1.5 + f.desde.distanceTo(f.hasta) * 0.12);
    f.mesh.rotation.x += dt * 10;
    if (k >= 1) {
      f.mesh.removeFromParent();
      frascos.splice(i, 1);
      crearCharco(f.hasta, f.r.gran ? 4 : 2.6 * f.r.alcance, f.r.elemento);
    }
  }
}

export function crearCharco(pos: THREE.Vector3, radio: number, elemento: Elemento) {
  particulas(pos.clone().setY(0.3), 0xd8a020, 18, 4, { tam: 0.1, gravedad: -12 });
  const ch: Charco = { zona: null as unknown as Zona, elemento, radio, prendido: false };
  ch.zona = crearZona({
    pos, radio, duracion: 14, color: elemento === 'fuerza' ? 0x5a3a08 : colorElem(elemento), opacidad: 0.5, aditiva: false, intervalo: 0.5,
    alTick: (z) => {
      if (elemento === 'rayo' || elemento === 'hielo' || elemento === 'arcano') {
        golpearArea(z.pos, z.radio, { dano: 3, elemento, frio: elemento === 'hielo' ? 18 : undefined, sinInfusion: true }, { objetos: false, caida: false });
      }
    },
    alQuitar: () => {
      const i = charcos.indexOf(ch);
      if (i >= 0) charcos.splice(i, 1);
    },
  });
  charcos.push(ch);
  if (elemento === 'fuego') retrasar(0.05, () => prenderCharco(ch));
}

/** El aceite prendido estalla y deja el suelo ardiendo. */
function prenderCharco(ch: Charco) {
  if (ch.prendido) return;
  ch.prendido = true;
  const c = ch.zona.pos.clone();
  ch.zona.t = ch.zona.duracion;
  eventos.push({ tipo: 'explosion', centro: c, radio: ch.radio + 1.2, golpe: { dano: 38, elemento: 'fuego', empuje: 10, punto: c, dir: new THREE.Vector3(0, 0, 1) }, combo: 'aceite' });
  crearZona({
    pos: c, radio: ch.radio, duracion: 4, color: 0xff6a1a, opacidad: 0.4, intervalo: 0.4,
    alTick: (z) => {
      golpearArea(z.pos, z.radio, { dano: 6, elemento: 'fuego', sinInfusion: true }, { caida: false });
      particulas(z.pos.clone().add(new THREE.Vector3(rand(-z.radio, z.radio) * 0.7, 0.2, rand(-z.radio, z.radio) * 0.7)), 0xff8a2a, 3, 1.5, { tam: 0.14, gravedad: 3, aditivo: true, vida: 0.6 });
    },
  });
  // Cadena: otros charcos de aceite que toca el fuego.
  for (const o of [...charcos]) if (o !== ch && !o.prendido && o.zona.pos.distanceTo(c) < o.radio + ch.radio + 0.5) retrasar(0.15, () => prenderCharco(o));
}

/** Frena a los enemigos que pisan aceite y busca fuego cerca de cada charco. */
function actualizarCharcos(dt: number) {
  for (const ch of charcos) {
    if (ch.prendido) continue;
    const c = ch.zona.pos;
    for (const { e } of enemigosEnRadio(c, ch.radio)) {
      if (e.empujadoT > 0) continue;
      const f = Math.exp(-7 * dt);
      e.body.velocity.x *= f;
      e.body.velocity.z *= f;
      if (e.est.quemado > 0) {
        prenderCharco(ch);
        break;
      }
    }
    if (ch.prendido) continue;
    for (const r of rompibles) {
      if (!r.roto && r.ardiendo > 0 && distanciaObjeto(r, c) < ch.radio + 0.3) {
        prenderCharco(ch);
        break;
      }
    }
    if (ch.prendido) continue;
    for (const t of trozos) {
      if (t.arde > 0 && Math.hypot(t.body.position.x - c.x, t.body.position.z - c.z) < ch.radio) {
        prenderCharco(ch);
        break;
      }
    }
  }
}

/** Explosiones de fuego en cola (barriles, combos): prenden los charcos que alcanzan. */
export function revisarExplosiones() {
  for (const ev of eventos) {
    if (ev.tipo !== 'explosion' || ev.golpe.elemento !== 'fuego') continue;
    for (const ch of [...charcos]) if (!ch.prendido && ch.zona.pos.distanceTo(ev.centro) < ch.radio + ev.radio) retrasar(0.08, () => prenderCharco(ch));
  }
}

// ---------------------------------------------------------------- lanzar receta (Q)
export interface Resultado {
  ok: boolean;
  motivo?: 'vacio' | 'materia' | 'enfriando' | 'lejos' | 'nada';
  nombre?: string;
}

export function lanzarReceta(objetivo: THREE.Vector3): Resultado {
  const r = receta(alq.crisol);
  if (!r) {
    ganchosAlq.aviso('El crisol está vacío: pulsa 1 a 6 para meter materiales');
    return { ok: false, motivo: 'vacio' };
  }
  if (alq.lanzarCd > 0) return { ok: false, motivo: 'enfriando' };
  if (!cobrar(r.coste)) return { ok: false, motivo: 'materia' };
  alq.lanzarCd = 0.35;
  const dir = dirHacia(objetivo);
  mago.yaw = dirToYaw(dir.x, dir.z);
  const origen = manos().addScaledVector(dir, 0.5);
  const destino = limitar(objetivo, ALCANCE_LANZAR);
  const col = colorMat(r.base);
  sello(pies(), 1.3, col, 0.6, pies);
  triggerAttack(mago.model, r.forma === 'frasco' ? 'throw' : 'cast', 0.3);

  switch (r.forma) {
    case 'puas': {
      if (r.gran) {
        // Muralla: de lado a lado del cursor, perpendicular a la mirada.
        const lado = new THREE.Vector3(-dir.z, 0, dir.x);
        sello(destino, 2.6, col, 0.9);
        for (let i = -4; i <= 4; i++) {
          const p = destino.clone().addScaledVector(lado, i * 0.62);
          retrasar(Math.abs(i) * 0.03, () => pua(p, r, 7, 1.15));
        }
        temblor(0.3, 0.03);
      } else {
        const n = Math.round(5 * r.cantidad);
        const paso = 1.05 * Math.min(r.alcance, 1.15);
        for (let i = 0; i < n; i++) {
          const p = pies().addScaledVector(dir, 1.4 + i * paso);
          retrasar(i * 0.045, () => pua(p, r));
          if (r.mod === 'ramificado' && i > 1 && i % 2 === 0) {
            for (const s of [-1, 1]) {
              const q = p.clone().addScaledVector(rotarY(dir, (s * Math.PI) / 2), 0.9);
              retrasar(i * 0.045 + 0.05, () => pua(q, r, 3.5, 0.85));
            }
          }
        }
        temblor(0.15, 0.02);
      }
      break;
    }
    case 'jabalinas': {
      const n = r.gran ? 6 : Math.round(2 * r.cantidad);
      const abanico = r.gran ? 0.9 : n > 2 ? 0.45 : 0.14;
      for (let i = 0; i < n; i++) {
        const a = n === 1 ? 0 : -abanico / 2 + (abanico * i) / (n - 1);
        const d = rotarY(dir, a);
        retrasar(i * 0.04, () => jabalina(manos().addScaledVector(d, 0.6), d, r, 30 * Math.sqrt(r.alcance)));
      }
      flujo(manos(), manos().addScaledVector(dir, 1), col, 10, { dispersion: 0.6, dur: 0.25 });
      break;
    }
    case 'cuchillas': {
      const g = { dano: 13 * r.dano, elemento: r.elemento, empuje: 4 * r.empuje, frio: r.frio, aturdir: r.aturdir };
      if (r.gran) {
        for (let i = 0; i < 12; i++) {
          const d = rotarY(dir, (i / 12) * Math.PI * 2);
          cuchilla(manos().addScaledVector(d, 0.6), d, g, true, 22);
        }
      } else {
        const n = Math.round(5 * r.cantidad);
        const ab = 0.9 * Math.min(1.4, r.cantidad);
        for (let i = 0; i < n; i++) {
          const d = rotarY(dir, -ab / 2 + (ab * i) / Math.max(1, n - 1));
          cuchilla(origen.clone().addScaledVector(d, 0.2), d, g, r.perfora, 24 * Math.sqrt(r.alcance));
        }
      }
      break;
    }
    case 'prisma':
      sello(destino, 1.4, col, 1);
      crearPrisma(destino, r);
      break;
    case 'chorro': {
      const largo = (r.gran ? 13 : 9) * Math.min(r.alcance, 1.3);
      const ancho = r.gran ? 1.1 : 0.6;
      chorro(origen, dir, largo, ancho, r);
      break;
    }
    case 'frasco':
      sello(destino, r.gran ? 4 : 2.6, col, 0.8);
      lanzarFrasco(destino, r);
      break;
  }
  if (!alq.lanzadas.has(r.clave)) {
    alq.lanzadas.add(r.clave);
    ganchosAlq.descubrir('receta', r.clave, r.nombre);
  }
  ganchosAlq.cambio();
  return { ok: true, nombre: r.nombre };
}

let hazT = 0;
function chorro(origen: THREE.Vector3, dir: THREE.Vector3, largo: number, ancho: number, r: Receta) {
  const color = r.elemento === 'fuerza' ? colorMat('agua') : colorElem(r.elemento);
  // El chorro se corta en el primer muro.
  let libre = largo;
  for (let t = 0; t <= largo; t += 0.25) {
    if (resolveCircle(arena, origen.x + dir.x * t, origen.z + dir.z * t, 0.05).hit) {
      libre = Math.max(0.5, t - 0.2);
      break;
    }
  }
  const fin = origen.clone().addScaledVector(dir, libre);
  mostrarHaz(origen, fin, color, estado.tiempo);
  hazT = 0.22;
  for (let i = 0; i < 24; i++) {
    const p = origen.clone().addScaledVector(dir, Math.random() * libre);
    particulas(p, color, 1, 2, { tam: 0.1, gravedad: -10, vida: 0.5 });
  }
  for (const { e } of enemigosEnRayo(origen, dir, libre, ancho)) {
    e.est.empapado = Math.max(e.est.empapado, 6);
    e.est.quemado = 0;
    golpearEnemigo(e, { dano: 10 * r.dano, elemento: r.elemento, empuje: 17 * r.empuje, frio: r.frio || undefined, aturdir: r.aturdir || undefined, punto: centroDe(e), dir });
  }
  for (const { r: o } of objetosEnRayo(origen, dir, libre)) danarObjeto(o, { dano: 8 * r.dano, elemento: r.elemento, punto: puntoCercano(o, origen), dir, empuje: 14 * r.empuje });
  impulsoCono(origen, dir, libre, 0.35, 12 * r.empuje);
  for (const ch of charcos) if (ch.zona.pos.distanceTo(fin) < 1 && r.elemento === 'fuerza') ch.zona.t = ch.zona.duracion - 0.3;
}

// ---------------------------------------------------------------- forjar arma (F)
export function forjar(): Resultado {
  const a = arma(alq.crisol);
  if (!a) {
    ganchosAlq.aviso('El crisol está vacío: pulsa 1 a 6 para meter materiales');
    return { ok: false, motivo: 'vacio' };
  }
  if (!cobrar(a.coste)) return { ok: false, motivo: 'materia' };
  alq.arma = { ...a, usos: a.usosMax };
  alq.armaCd = 0.2;
  const col = colorMat(alq.crisol[0]!);
  sello(pies(), 1.6, col, 0.9, pies);
  flujo(pies().setY(0.1), manos(), col, 30, { dispersion: 1.2, dur: 0.5, seguir: manos });
  arco(pies().setY(0.2), manos(), colorElem(a.elemento) === 0xffffff ? col : colorElem(a.elemento), 0.2, 6);
  ponerMallaArma(a);
  anuncio(a.nombre, MATERIAL[alq.crisol[0]!].css);
  if (!alq.forjadas.has(a.clave)) {
    alq.forjadas.add(a.clave);
    ganchosAlq.descubrir('arma', a.clave, a.nombre);
  }
  ganchosAlq.cambio();
  return { ok: true, nombre: a.nombre };
}

let mallaArma: THREE.Object3D | null = null;
function ponerMallaArma(a: Arma | null) {
  const brazo = mago.model.parts.armR.mesh;
  if (mallaArma) {
    mallaArma.removeFromParent();
    mallaArma = null;
  }
  // El frasco del modelo se esconde mientras empuña un arma.
  for (const c of brazo.children) c.visible = !a;
  if (!a) return;
  const g = new THREE.Group();
  const mat = a.id === 'mazo' ? matPiedra : a.id === 'lanza' ? matMadera : a.id === 'espada' ? matMetal : null;
  const elem = matDePunta(a.elemento);
  switch (a.id) {
    case 'mazo': {
      const mango = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), matMadera);
      mango.position.y = -0.35;
      const cabeza = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), a.elemento === 'fuerza' ? mat! : matPua(a.elemento));
      cabeza.position.y = -0.82;
      g.add(mango, cabeza);
      break;
    }
    case 'lanza': {
      const asta = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), mat!);
      asta.position.y = -0.4;
      const punta = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.32, 4), elem);
      punta.position.y = -1.5;
      punta.rotation.x = Math.PI;
      g.add(asta, punta);
      break;
    }
    case 'espada': {
      const hoja = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.03), a.elemento === 'fuerza' ? mat! : elem);
      hoja.position.y = -0.7;
      const guarda = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.08), matOxido);
      guarda.position.y = -0.18;
      g.add(hoja, guarda);
      break;
    }
    case 'cetro': {
      const vara = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), matMetal);
      vara.position.y = -0.3;
      const gema = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), elem);
      gema.position.y = -0.78;
      g.add(vara, gema);
      break;
    }
    case 'latigo': {
      for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), a.elemento === 'fuerza' ? matDePunta('hielo') : elem);
        s.position.set(Math.sin(i * 0.8) * 0.06 * i, -0.15 - i * 0.16, 0);
        g.add(s);
      }
      break;
    }
    case 'tea': {
      const palo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), matMadera);
      palo.position.y = -0.2;
      const llama = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), matDePunta(a.elemento === 'fuerza' ? 'fuego' : a.elemento));
      llama.position.y = -0.56;
      g.add(palo, llama);
      break;
    }
  }
  g.rotation.x = Math.PI;
  g.position.y = -0.3;
  brazo.add(g);
  mallaArma = g;
}

function gastarUso() {
  const a = alq.arma;
  if (!a) return;
  a.usos--;
  if (a.usos > 0) return;
  // Se deshace y devuelve algo de materia (una unidad de la base): nada se pierde del todo.
  const base = a.clave.split('+')[0] as MaterialId;
  particulas(manos(), colorMat(base), 14, 3, { tam: 0.08 });
  anuncio(`${a.nombre}: se deshace`, MATERIAL[base].css);
  alq.arma = null;
  ponerMallaArma(null);
  sumar(base, 1, manos());
}

// ---------------------------------------------------------------- atacar (clic izquierdo)
export function atacar(objetivo: THREE.Vector3): Resultado {
  if (alq.armaCd > 0) return { ok: false, motivo: 'enfriando' };
  const dir = dirHacia(objetivo);
  mago.yaw = dirToYaw(dir.x, dir.z);
  const origen = pies();
  const a = alq.arma;
  if (!a) {
    // Sin arma: una onda corta que empuja (solo para no quedarse de brazos cruzados).
    alq.armaCd = 0.5;
    triggerAttack(mago.model, 'cast', 0.25);
    sector(origen, mago.yaw, 2.4, 1.3, 0xd8d0c0, 0.2);
    for (const e of enCono(origen, dir, 2.4, 1.3)) golpearEnemigo(e, { dano: 5, elemento: 'fuerza', empuje: 7, punto: centroDe(e), dir });
    for (const o of objetosEnCono(origen, dir, 2.4, 1.3)) danarObjeto(o, { dano: 4, elemento: 'fuerza', punto: puntoCercano(o, origen), dir, empuje: 6 });
    impulsoCono(origen, dir, 2.6, 1.3, 6);
    return { ok: true, nombre: 'Onda' };
  }
  const s = a.stats;
  alq.armaCd = s.cadencia;
  const golpe = (punto: THREE.Vector3, d: THREE.Vector3): GolpeBase => ({
    dano: s.dano, elemento: a.elemento, empuje: s.atrae ? 0 : s.empuje, frio: s.frio || undefined, aturdir: s.aturdir || undefined, punto, dir: d,
  });
  const color = a.elemento === 'fuerza' ? colorMat(a.clave.split('+')[0] as MaterialId) : colorElem(a.elemento);
  if (s.proyectil) {
    triggerAttack(mago.model, 'shoot', 0.2);
    dispararRayo(manos().addScaledVector(dir, 0.6), dir, { dano: s.dano, elemento: a.elemento, empuje: s.empuje, frio: s.frio, aturdir: s.aturdir }, s.alcance, s.perfora);
    gastarUso();
    return { ok: true, nombre: a.nombre };
  }
  triggerAttack(mago.model, a.id === 'lanza' ? 'shoot' : 'swing', Math.min(0.35, s.cadencia * 0.8));
  const victimas = s.estocada ? enemigosEnRayo(origen, dir, s.alcance, 0.5).map((x) => x.e) : enCono(origen, dir, s.alcance, s.angulo);
  if (s.estocada) {
    mostrarHaz(manos(), manos().addScaledVector(dir, s.alcance), color, estado.tiempo);
    hazT = 0.08;
  } else sector(origen, mago.yaw, s.alcance, s.angulo, color, a.id === 'tea' ? 0.15 : 0.22);
  if (a.id === 'tea') for (let i = 0; i < 5; i++) particulas(manos().addScaledVector(rotarY(dir, rand(-0.4, 0.4)), rand(0.5, s.alcance)), 0xff8a2a, 1, 1.2, { tam: 0.14, gravedad: 3, aditivo: true, vida: 0.4 });
  for (const e of victimas) {
    const c = centroDe(e);
    golpearEnemigo(e, golpe(c, dir));
    if (s.atrae && !e.muerto) {
      e.est.empapado = Math.max(e.est.empapado, 4);
      const hacia = pies().sub(v3(e.body.position)).setY(0);
      const d = hacia.length();
      if (d > 1.4) empujar(e, hacia.normalize(), Math.min(s.empuje, d * 2.2));
    }
  }
  const objetos = s.estocada ? objetosEnRayo(manos(), dir, s.alcance).map((x) => x.r) : objetosEnCono(origen, dir, s.alcance, s.angulo);
  for (const o of objetos) danarObjeto(o, golpe(puntoCercano(o, origen), dir));
  impulsoCono(origen, dir, s.alcance + 0.3, Math.max(0.5, s.angulo), s.empuje * 0.6);
  if (a.id === 'mazo' && (victimas.length || objetos.length)) temblor(0.2, 0.03);
  gastarUso();
  return { ok: true, nombre: a.nombre };
}

// ---------------------------------------------------------------- transmutar el entorno (E)
interface Grillete {
  e: Enemigo;
  mesh: THREE.Mesh;
  t: number;
}
const grilletes: Grillete[] = [];
const geoGrillete = new THREE.CylinderGeometry(0.62, 0.72, 0.6, 7, 1, true);
interface Torre {
  r: Rompible;
  t: number;
  cd: number;
}
const torres: Torre[] = [];
const destilados = new Set<Rompible>();

export function transmutarEntorno(objetivo: THREE.Vector3): Resultado {
  if (alq.entornoCd > 0) return { ok: false, motivo: 'enfriando' };
  const p = objetivo.clone().setY(0);
  if (p.distanceTo(pies()) > ALCANCE_MANOS + 1.5) {
    ganchosAlq.aviso('Demasiado lejos para transmutar');
    return { ok: false, motivo: 'lejos' };
  }
  const e = enemigoEn(p, 0.35);
  const o = e ? null : objetoEn(p);
  const id: InteraccionId = e ? 'grilletes' : o ? interaccionPara(o.tipo) : 'pilar';
  const def = INTERACCIONES[id];
  if (id === 'bomba' && o && destilados.has(o)) return { ok: false, motivo: 'nada' };
  if (!cobrar(def.coste as Coste)) return { ok: false, motivo: 'materia' };
  alq.entornoCd = 0.7;
  triggerAttack(mago.model, 'cast', 0.3);
  const pos = o ? v3(o.body.position).setY(0) : e ? v3(e.body.position).setY(0) : p;
  const matCol = o ? colorMat(materiaDe(o.tipo, 1).mat) : colorMat('piedra');
  sello(pos, id === 'pilar' ? 1.4 : 2.2, matCol, 0.8);
  sello(pies(), 1, matCol, 0.5, pies);
  for (let i = 0; i < 3; i++) {
    const a = rand(0, Math.PI * 2);
    arco(pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0.1, Math.sin(a) * 1.2)), pos.clone().setY(rand(0.4, 1.4)), 0x8adfff, 0.18, 6);
  }

  switch (id) {
    case 'pilar': {
      if (!enArena(pos, 0.8)) return { ok: false, motivo: 'nada' };
      // Lo que esté encima sale volando (también el alquimista, si se lo pone bajo los pies).
      crearEstructura(pos, 'pilar', 7, 'fuerza');
      for (const { e: x } of enemigosEnRadio(pos, 0.9)) {
        golpearEnemigo(x, { dano: 10, elemento: 'fuerza', punto: centroDe(x), dir: new THREE.Vector3(0, 0, 1) });
        lanzarArriba(x, pos, 11);
      }
      const mp = mago.body.position;
      if (Math.hypot(mp.x - pos.x, mp.z - pos.z) < 0.9) mago.body.velocity.y = 12;
      for (const b of [...rompibles.filter((r) => !r.roto).map((r) => r.body), ...trozos.map((t) => t.body), ...piezas.map((x) => x.body)]) {
        if (Math.hypot(b.position.x - pos.x, b.position.z - pos.z) < 0.95) {
          b.wakeUp();
          b.velocity.y += 10;
        }
      }
      temblor(0.2, 0.02);
      break;
    }
    case 'grilletes': {
      const x = e!;
      x.est.aturdido = Math.max(x.est.aturdido, 2.5);
      x.body.velocity.set(0, Math.min(0, x.body.velocity.y), 0);
      const mesh = new THREE.Mesh(geoGrillete, matPiedra);
      mesh.scale.setScalar(x.radio / 0.4);
      scene.add(mesh);
      grilletes.push({ e: x, mesh, t: 0 });
      particulas(v3(x.body.position).setY(0.3), 0x8a8478, 12, 3, { tam: 0.12 });
      numero(centroDe(x), 'INMÓVIL', '#c8bca8');
      break;
    }
    case 'estallido': {
      const r = o!;
      const vol = r.convexo.volumen;
      retirarRompible(r);
      const n = Math.round(6 + vol * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        for (let k = 0; k < 2; k++) {
          const q = pos.clone().addScaledVector(d, 1 + k * 1.1);
          retrasar(k * 0.06, () => pua(q, { dano: 1.2, elemento: 'fuerza', frio: 0, aturdir: 0, empuje: 1.2 }, 3, 1 - k * 0.15));
        }
      }
      golpearArea(pos.clone().setY(0.8), 3.2, { dano: 30, elemento: 'fuerza', empuje: 12 }, { impulso: 10 });
      particulas(pos.clone().setY(0.6), r.tipo.polvo, 24, 6, { tam: 0.14 });
      temblor(0.35, 0.05);
      break;
    }
    case 'zarzas': {
      const r = o!;
      retirarRompible(r);
      zarzal(pos, 2.6);
      break;
    }
    case 'bomba': {
      const r = o!;
      destilados.add(r);
      r.body.wakeUp();
      numero(v3(r.body.position).setY(1.4), 'DESTILANDO', '#ffb84a', true);
      flujo(v3(r.body.position).setY(0.5), v3(r.body.position).setY(0.5), 0xffb84a, 20, { dispersion: 1.4, dur: 0.9 });
      retrasar(1, () => {
        destilados.delete(r);
        if (r.roto) return;
        const c = v3(r.body.position).setY(0);
        retirarRompible(r);
        eventos.push({ tipo: 'explosion', centro: c, radio: 5.2, golpe: { dano: 70, elemento: 'fuego', empuje: 16, punto: c, dir: new THREE.Vector3(0, 0, 1) }, combo: 'aceite' });
        crearCharco(c, 3, 'fuego');
      });
      break;
    }
    case 'congelar': {
      const r = o!;
      retirarRompible(r);
      const c = pos.clone().setY(0.9);
      golpearArea(c, 4, { dano: 12, elemento: 'hielo', frio: 120 }, { caida: false });
      anillo(pos, 0xbfefff, 4.2, 0.6, 0.4);
      particulas(c, 0xc8f0ff, 40, 7, { tam: 0.12, aditivo: true, gravedad: -6 });
      crearZona({ pos, radio: 4, duracion: 5, color: 0xbfefff, opacidad: 0.35, intervalo: 0.5,
        alTick: (z) => golpearArea(z.pos, z.radio, { dano: 0, elemento: 'hielo', frio: 14, sinInfusion: true }, { objetos: false, caida: false }) });
      break;
    }
    case 'pararrayos': {
      torres.push({ r: o!, t: 0, cd: 0 });
      break;
    }
    case 'erizo': {
      const r = o!;
      const c = v3(r.body.position).setY(0.8);
      retirarRompible(r);
      const g = { dano: 18, elemento: 'fuerza' as Elemento, empuje: 5, frio: 0, aturdir: 0 };
      for (let i = 0; i < 14; i++) {
        const d = new THREE.Vector3(Math.cos((i / 14) * Math.PI * 2), 0, Math.sin((i / 14) * Math.PI * 2));
        cuchilla(c.clone().addScaledVector(d, 0.5), d, g, true, 22);
      }
      particulas(c, 0x9aa8b8, 16, 5, { tam: 0.08 });
      temblor(0.2, 0.03);
      break;
    }
  }
  if (!alq.interacciones.has(id)) {
    alq.interacciones.add(id);
    ganchosAlq.descubrir('entorno', id, def.nombre);
  }
  ganchosAlq.cambio();
  return { ok: true, nombre: def.nombre };
}

const geoEspina = new THREE.ConeGeometry(0.07, 0.8, 4);
const matEspina = psxLambert({ map: textures.wood, color: 0x6a8a3a });
function zarzal(pos: THREE.Vector3, radio: number) {
  const grupo = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2);
    const d = Math.sqrt(Math.random()) * radio;
    const m = new THREE.Mesh(geoEspina, matEspina);
    m.position.set(pos.x + Math.cos(a) * d, 0.3, pos.z + Math.sin(a) * d);
    m.rotation.set(rand(-0.6, 0.6), rand(0, 3), rand(-0.6, 0.6));
    m.scale.setScalar(rand(0.7, 1.4));
    grupo.add(m);
  }
  scene.add(grupo);
  particulas(pos.clone().setY(0.4), 0x6a8a3a, 20, 4, { tam: 0.1 });
  crearZona({
    pos, radio, duracion: 7, color: 0x4a6a2a, opacidad: 0.35, aditiva: false, intervalo: 0.3,
    alTick: (z) => {
      for (const { e } of enemigosEnRadio(z.pos, z.radio)) {
        if (e.muerto) continue;
        e.est.aturdido = Math.max(e.est.aturdido, 0.35);
        golpearEnemigo(e, { dano: 3, elemento: 'fuerza', punto: centroDe(e), dir: new THREE.Vector3(0, 0, 1), sinInfusion: true });
      }
    },
    alQuitar: () => grupo.removeFromParent(),
  });
}

function actualizarEntorno(dt: number) {
  for (let i = grilletes.length - 1; i >= 0; i--) {
    const g = grilletes[i]!;
    g.t += dt;
    const e = g.e;
    if (e.muerto || g.t > 2.5 || e.est.aturdido <= 0) {
      particulas(g.mesh.position.clone().setY(0.3), 0x8a8478, 8, 2.5, { tam: 0.1 });
      g.mesh.removeFromParent();
      grilletes.splice(i, 1);
      continue;
    }
    e.body.velocity.x = 0;
    e.body.velocity.z = 0;
    g.mesh.position.set(e.body.position.x, e.body.position.y + 0.3 * Math.min(1, g.t * 8), e.body.position.z);
  }
  for (let i = torres.length - 1; i >= 0; i--) {
    const t = torres[i]!;
    t.t += dt;
    t.cd -= dt;
    if (t.r.roto) {
      torres.splice(i, 1);
      continue;
    }
    const top = v3(t.r.body.position).add(new THREE.Vector3(0, 0.8, 0));
    if (Math.random() < dt * 20) arco(top, top.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.2, 0.8), rand(-0.6, 0.6))), 0xc8b0ff, 0.08, 3);
    if (t.cd <= 0) {
      t.cd = 0.5;
      const e = masCercano(top, 8);
      if (e) cadenaRayo(top, e, 2, 16);
    }
    if (t.t >= 6) {
      torres.splice(i, 1);
      romper(t.r, top, new THREE.Vector3(0, 0, 1), 10);
    }
  }
  for (const r of destilados) {
    if (r.roto) continue;
    if (Math.random() < dt * 30) particulas(v3(r.body.position).setY(1), 0xffb84a, 1, 1.5, { tam: 0.08, aditivo: true, gravedad: 2, vida: 0.4 });
  }
}

// ---------------------------------------------------------------- descomponer (clic derecho mantenido)
export interface EstadoDescomponer {
  que: 'objeto' | 'escombros' | 'suelo' | 'lejos' | 'nada';
  mat?: MaterialId;
  progreso?: number;
  punto: THREE.Vector3;
}
let disolviendo: { r: Rompible; progreso: number; escala: THREE.Vector3 } | null = null;
let flujoT = 0;

function soltarDisolucion() {
  if (disolviendo && !disolviendo.r.roto) disolviendo.r.mesh.scale.copy(disolviendo.escala);
  disolviendo = null;
}

/** Descompone lo que hay en `punto`. Llamar cada paso mientras se mantiene el botón; `null` al soltar. */
export function descomponer(punto: THREE.Vector3 | null, dt: number): EstadoDescomponer | null {
  if (!punto) {
    soltarDisolucion();
    return null;
  }
  const p = punto.clone().setY(0);
  if (p.distanceTo(pies()) > ALCANCE_MANOS) {
    soltarDisolucion();
    return { que: 'lejos', punto: p };
  }
  flujoT -= dt;
  const echarFlujo = flujoT <= 0;
  if (echarFlujo) flujoT = 0.05;

  // 1) Un objeto entero bajo el cursor: se disuelve poco a poco.
  const o = disolviendo && !disolviendo.r.roto && distanciaObjeto(disolviendo.r, p.clone().setY(0.35)) < 0.9 ? disolviendo.r : objetoEn(p);
  if (o) {
    if (!disolviendo || disolviendo.r !== o) {
      soltarDisolucion();
      disolviendo = { r: o, progreso: 0, escala: o.mesh.scale.clone() };
    }
    const vol = o.convexo.volumen;
    const { mat, n } = materiaDe(o.tipo, vol);
    disolviendo.progreso += dt / tiempoDescomponer(vol);
    const k = Math.min(1, disolviendo.progreso);
    o.mesh.scale.copy(disolviendo.escala).multiplyScalar(1 - 0.55 * k);
    o.mesh.position.x += rand(-0.02, 0.02) * k;
    const centro = v3(o.body.position);
    if (echarFlujo) flujo(centro, manos(), colorMat(mat), 3, { dispersion: 0.5, seguir: manos });
    if (k >= 1) {
      retirarRompible(o);
      disolviendo = null;
      sumar(mat, n, centro.clone().setY(1.2));
      flujo(centro, manos(), colorMat(mat), 18, { dispersion: 0.6, seguir: manos });
      particulas(centro, o.tipo.polvo, 10, 2, { tam: 0.1 });
    }
    return { que: 'objeto', mat, progreso: k, punto: p };
  }
  soltarDisolucion();

  // 2) Escombros y restos alrededor del cursor: se absorben de golpe (rinden algo menos).
  let absorbidos = 0;
  let ultimo: MaterialId | undefined;
  for (let i = trozos.length - 1; i >= 0 && absorbidos < 4; i--) {
    const t = trozos[i]!;
    if (Math.hypot(t.body.position.x - p.x, t.body.position.z - p.z) > 1.8 || t.body.position.y > 2.5) continue;
    const { mat, n } = materiaDe(t.tipo, t.volumen, 0.7);
    const pos = v3(t.body.position);
    quitarTrozo(i);
    sumar(mat, n, pos);
    flujo(pos, manos(), colorMat(mat), 4, { dispersion: 0.2, seguir: manos });
    ultimo = mat;
    absorbidos++;
  }
  for (let i = piezas.length - 1; i >= 0 && absorbidos < 6; i--) {
    const x = piezas[i]!;
    if (x.activa || Math.hypot(x.body.position.x - p.x, x.body.position.z - p.z) > 1.8) continue;
    const pos = v3(x.body.position);
    const n = materiaDe({ material: x.mat === 'metal' ? 'metal' : 'madera' }, x.volumen).n;
    quitarPieza(i);
    sumar(x.mat, n, pos);
    flujo(pos, manos(), colorMat(x.mat), 4, { dispersion: 0.2, seguir: manos });
    ultimo = x.mat;
    absorbidos++;
  }
  for (let i = estructuras.length - 1; i >= 0 && absorbidos < 6; i--) {
    const x = estructuras[i]!;
    if (x.fase !== 'quieta' || Math.hypot(x.body.position.x - p.x, x.body.position.z - p.z) > 1.2) continue;
    bajar(x);
    const pos = v3(x.body.position);
    sumar('piedra', x.volumen * 5, pos);
    flujo(pos, manos(), colorMat('piedra'), 4, { dispersion: 0.3, seguir: manos });
    ultimo = 'piedra';
    absorbidos++;
  }
  if (absorbidos) return { que: 'escombros', mat: ultimo, punto: p };

  // 3) Nada encima: se descompone el propio suelo (lento) y queda un hoyo.
  if (!enArena(p, 0.6)) return { que: 'nada', punto: p };
  const n = PIEDRA_SUELO_POR_SEGUNDO * dt;
  const antes = Math.floor(alq.inv.piedra);
  anadir(alq.inv, 'piedra', n);
  estadisticasAlq.descompuesto += n;
  if (Math.floor(alq.inv.piedra) > antes) {
    numero(p.clone().setY(0.8), '+1 Piedra', MATERIAL.piedra.css);
    ganchosAlq.cambio();
  }
  cavar(p, n);
  if (echarFlujo) flujo(p.clone().setY(0.05), manos(), colorMat('piedra'), 2, { dispersion: 0.4, seguir: manos });
  return { que: 'suelo', mat: 'piedra', punto: p };
}

// ---------------------------------------------------------------- ciclo
/** Antes del paso de física: retrasos, piezas en vuelo, estructuras, prismas, frascos, entorno. */
export function actualizarAlquimia(dt: number) {
  alq.armaCd = Math.max(0, alq.armaCd - dt);
  alq.lanzarCd = Math.max(0, alq.lanzarCd - dt);
  alq.entornoCd = Math.max(0, alq.entornoCd - dt);
  for (let i = despues.length - 1; i >= 0; i--) {
    const d = despues[i]!;
    d.t -= dt;
    if (d.t <= 0) {
      despues.splice(i, 1);
      d.fn();
    }
  }
  actualizarEstructuras(dt);
  actualizarPiezas(dt);
  actualizarRayos(dt);
  actualizarPrismas(dt);
  actualizarFrascos(dt);
  actualizarEntorno(dt);
  if (hazT > 0) {
    hazT -= dt;
    if (hazT <= 0) ocultarHaz();
  }
}

/** Después de la IA de los enemigos (y antes de la física): el aceite los frena. */
export function actualizarAlquimiaTrasIA(dt: number) {
  actualizarCharcos(dt);
}

export function sincronizarAlquimia() {
  for (const e of estructuras) sincronizarEstructura(e);
  for (const p of piezas) {
    const q = p.body.interpolatedQuaternion;
    const pos = p.body.interpolatedPosition;
    p.mesh.position.set(pos.x, pos.y, pos.z);
    p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    const fin = p.activa ? 0 : Math.max(0, p.t - (VIDA_RESTO - 1));
    p.mesh.scale.setScalar(Math.max(0.01, 1 - fin));
  }
}

export function limpiarAlquimia() {
  soltarDisolucion();
  despues.length = 0;
  while (estructuras.length) quitarEstructura(estructuras.length - 1);
  while (piezas.length) quitarPieza(piezas.length - 1);
  for (const r of rayos) r.mesh.removeFromParent();
  rayos.length = 0;
  for (const p of prismas) {
    p.mesh.removeFromParent();
    (p.mesh.material as THREE.Material).dispose();
  }
  prismas.length = 0;
  for (const f of frascos) f.mesh.removeFromParent();
  frascos.length = 0;
  charcos.length = 0;
  for (const g of grilletes) g.mesh.removeFromParent();
  grilletes.length = 0;
  torres.length = 0;
  destilados.clear();
  colaChoques.length = 0;
  ocultarHaz();
  hazT = 0;
  alq.arma = null;
  ponerMallaArma(null);
  alq.armaCd = alq.lanzarCd = alq.entornoCd = 0;
  void zonas;
}

export function cuentaAlquimia() {
  return { estructuras: estructuras.length, piezas: piezas.length, activas: piezas.filter((p) => p.activa).length, prismas: prismas.length, charcos: charcos.length };
}

export function puedeLanzar() {
  const r = receta(alq.crisol);
  return !!r && (alq.materiaInfinita || puedePagar(alq.inv, r.coste));
}
export function puedeForjar() {
  const a = arma(alq.crisol);
  return !!a && (alq.materiaInfinita || puedePagar(alq.inv, a.coste));
}
