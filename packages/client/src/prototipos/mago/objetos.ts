import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { psxLambert } from '../../render/psx';
import {
  astillar,
  casco,
  formaCaja,
  formaTorno,
  fracturar,
  geometriaDe,
  mulberry32,
  normalLibre,
  normalVeta,
  planosDe,
  type Convexo,
  type OpcionesMalla,
  type Plano,
  validoParaCannon,
} from '../../physics/fractura';
import { eventos, mObjeto, rand, rnd, scene, temblor, textures, v3, world, type GolpeBase } from './mundo';
import { particulas } from './efectos';
import type { ComboId } from './reacciones';

/**
 * Objetos destructibles del entorno del mago.
 *
 * - Cada objeto es un poliedro convexo con vida. Al llegar a 0 se fractura por cortes planos
 *   cerca del impacto (D-12) y cada trozo pasa a ser un cuerpo de cannon-es.
 * - Los de piedra (obeliscos, columnas, lápidas) se astillan poco a poco: cada golpe fuerte arranca
 *   una lasca por el lado del impacto y el resto sigue en pie con su nueva forma (D-15).
 * - La madera arde y el fuego salta a la madera cercana; se raja a lo largo de la veta.
 * - El hielo vuelve quebradizo cualquier objeto (daño ×2, más trozos).
 * - Barriles de aceite que explotan, tinajas que empapan el suelo y cristales de maná que detonan.
 */

export type MaterialObjeto = 'madera' | 'barro' | 'piedra' | 'cristal' | 'hielo';

export interface TipoObjeto {
  id: string;
  nombre: string;
  forma: () => THREE.Vector3[];
  /** Si el objeto intacto es una caja, se usa CANNON.Box (más estable al apilar). */
  caja?: [number, number, number];
  textura: THREE.Texture;
  escalaUV: number;
  exterior: number;
  interior: number;
  densidad: number;
  piezas: number;
  polvo: number;
  hp: number;
  material: MaterialObjeto;
  inflamable?: boolean;
  astillable?: boolean;
  explosivo?: boolean;
  agua?: boolean;
  mana?: boolean;
  emisivo?: number;
}

const torno = formaTorno;
export const TIPOS: Record<string, TipoObjeto> = {
  caja: {
    id: 'caja', nombre: 'Caja', forma: () => formaCaja(0.9, 0.9, 0.9), caja: [0.9, 0.9, 0.9], textura: textures.wood, escalaUV: 0.9,
    exterior: 0xd0b090, interior: 0xe8c890, densidad: 30, piezas: 9, polvo: 0x8a6a4a, hp: 30, material: 'madera', inflamable: true,
  },
  barril: {
    id: 'barril', nombre: 'Barril', forma: () => torno([[-0.55, 0.34], [-0.25, 0.42], [0.25, 0.42], [0.55, 0.34]], 9), textura: textures.wood, escalaUV: 0.7,
    exterior: 0x9a6a48, interior: 0xd8b080, densidad: 40, piezas: 9, polvo: 0x7a5a3a, hp: 40, material: 'madera', inflamable: true,
  },
  aceite: {
    id: 'aceite', nombre: 'Barril de aceite', forma: () => torno([[-0.55, 0.34], [-0.25, 0.42], [0.25, 0.42], [0.55, 0.34]], 9), textura: textures.wood, escalaUV: 0.7,
    exterior: 0xb04a2a, interior: 0x3a2412, densidad: 45, piezas: 11, polvo: 0x2a1a10, hp: 25, material: 'madera', inflamable: true, explosivo: true, emisivo: 0x2a0800,
  },
  urna: {
    id: 'urna', nombre: 'Urna', forma: () => torno([[-0.42, 0], [-0.4, 0.17], [-0.12, 0.34], [0.18, 0.28], [0.36, 0.14], [0.42, 0.16]], 8), textura: textures.grain, escalaUV: 0.6,
    exterior: 0xa0583a, interior: 0x6a3a28, densidad: 40, piezas: 12, polvo: 0x8a5a3a, hp: 15, material: 'barro',
  },
  tinaja: {
    id: 'tinaja', nombre: 'Tinaja de agua', forma: () => torno([[-0.5, 0.2], [-0.42, 0.36], [0, 0.46], [0.38, 0.36], [0.5, 0.22]], 9), textura: textures.grain, escalaUV: 0.6,
    exterior: 0x6a8aa8, interior: 0x3a5a7a, densidad: 40, piezas: 12, polvo: 0x4a7ab8, hp: 15, material: 'barro', agua: true,
  },
  cristal: {
    id: 'cristal', nombre: 'Cristal de maná', forma: () => torno([[-0.7, 0], [-0.25, 0.3], [0.45, 0.24], [0.9, 0]], 6), textura: textures.grain, escalaUV: 0.5,
    exterior: 0xb8a0ff, interior: 0xffffff, densidad: 50, piezas: 14, polvo: 0xa88aff, hp: 25, material: 'cristal', mana: true, emisivo: 0x3a2a8a,
  },
  obelisco: {
    id: 'obelisco', nombre: 'Obelisco', forma: () => torno([[-1.5, 0.55], [1.2, 0.36], [1.55, 0]], 4).map((p) => p.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)),
    textura: textures.sarcophagus, escalaUV: 1.1, exterior: 0xd8d0c8, interior: 0x8a8278, densidad: 110, piezas: 14, polvo: 0x9a948a, hp: 170, material: 'piedra', astillable: true,
  },
  columna: {
    id: 'columna', nombre: 'Columna rota', forma: () => torno([[-1.25, 0.5], [-1.0, 0.42], [0.9, 0.4], [1.25, 0.3]], 8), textura: textures.wall, escalaUV: 1.2,
    exterior: 0xc0b8c8, interior: 0x8a8090, densidad: 110, piezas: 14, polvo: 0x8a848a, hp: 220, material: 'piedra', astillable: true,
  },
  lapida: {
    id: 'lapida', nombre: 'Lápida', forma: () => torno([[-0.8, 0.5], [0.55, 0.5], [0.8, 0.28]], 4).map((p) => p.set(p.x * 1.2, p.y, p.z * 0.45)),
    textura: textures.sarcophagus, escalaUV: 1.4, exterior: 0xf0e8e0, interior: 0x9a9288, densidad: 120, piezas: 12, polvo: 0x9a948a, hp: 70, material: 'piedra', astillable: true,
  },
  ladrillo: {
    id: 'ladrillo', nombre: 'Ladrillo', forma: () => formaCaja(0.7, 0.35, 0.4), caja: [0.7, 0.35, 0.4], textura: textures.wall, escalaUV: 1.6,
    exterior: 0xb0a0a8, interior: 0x7a6a70, densidad: 70, piezas: 4, polvo: 0x7a7078, hp: 14, material: 'piedra',
  },
};

/** Hielo de un enemigo congelado que se hace añicos (no se puede generar desde el panel). */
const TIPO_HIELO: TipoObjeto = {
  id: 'hielo', nombre: 'Hielo', forma: () => [], textura: textures.grain, escalaUV: 0.8, exterior: 0xa8e8ff, interior: 0xf0ffff,
  densidad: 30, piezas: 10, polvo: 0xc8f0ff, hp: 1, material: 'hielo', emisivo: 0x0a3a5a,
};

// ---------------------------------------------------------------- materiales
type Variante = 'normal' | 'ardiendo' | 'helado' | 'carbon';
const materiales = new Map<string, THREE.MeshLambertMaterial>();
function materialDe(t: TipoObjeto, v: Variante) {
  const k = `${t.id}-${v}`;
  let m = materiales.get(k);
  if (!m) {
    const color = v === 'ardiendo' ? 0xffc0a0 : v === 'helado' ? 0x9ad8ff : v === 'carbon' ? 0x5a4c46 : 0xffffff;
    const emisivo = v === 'ardiendo' ? 0x5a1a00 : v === 'helado' ? 0x0a2a4a : (t.emisivo ?? 0);
    m = psxLambert({ map: t.textura, vertexColors: true, color, emissive: emisivo, transparent: t.material === 'hielo', opacity: t.material === 'hielo' ? 0.85 : 1 });
    materiales.set(k, m);
  }
  return m;
}

function opcionesMalla(t: TipoObjeto): OpcionesMalla {
  return { escalaUV: t.escalaUV, colorExterior: new THREE.Color(t.exterior), colorInterior: new THREE.Color(t.interior) };
}

export const estadisticasFormas = { aproximadas: 0 };

/**
 * Forma de colisión de un convexo, relativa a `centro`. Si el convexo no cumple lo que espera
 * cannon-es (caso raro tras muchos cortes), se aproxima por su caja para no romper el solver.
 */
const validez = new WeakMap<Convexo, boolean>();
function anadirForma(body: CANNON.Body, c: Convexo, centro: THREE.Vector3) {
  let ok = validez.get(c);
  if (ok === undefined) {
    ok = validoParaCannon(c);
    validez.set(c, ok);
  }
  if (ok) {
    body.addShape(
      new CANNON.ConvexPolyhedron({
        vertices: c.verts.map((p) => new CANNON.Vec3(p.x - centro.x, p.y - centro.y, p.z - centro.z)),
        faces: c.faces.map((f) => [...f]),
      }),
    );
    return;
  }
  estadisticasFormas.aproximadas++;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of c.verts) {
    min.min(p);
    max.max(p);
  }
  const medio = min.clone().add(max).multiplyScalar(0.5).sub(centro);
  const mitad = max.clone().sub(min).multiplyScalar(0.5).max(new THREE.Vector3(0.01, 0.01, 0.01));
  body.addShape(new CANNON.Box(new CANNON.Vec3(mitad.x, mitad.y, mitad.z)), new CANNON.Vec3(medio.x, medio.y, medio.z));
}

// ---------------------------------------------------------------- rompibles
export interface Rompible {
  tipo: TipoObjeto;
  body: CANNON.Body;
  mesh: THREE.Mesh;
  /** Forma actual, en coordenadas del objeto original (así la textura sigue en su sitio al astillar). */
  convexo: Convexo;
  /** Centro de masas de la forma actual, en esas mismas coordenadas: coincide con el origen del cuerpo. */
  centro: THREE.Vector3;
  planos: Plano[];
  volumen0: number;
  hp: number;
  hpMax: number;
  /** Segundos ardiendo (0 = no arde). En los barriles de aceite es la mecha. */
  ardiendo: number;
  helado: number;
  variante: Variante;
  roto: boolean;
  propagarT: number;
  lascas: number;
}

export const rompibles: Rompible[] = [];
export const rompibleDe = new Map<CANNON.Body, Rompible>();

/** Ganchos que rellena el módulo de combate (evita dependencias circulares). */
export const ganchos = {
  combo: (_id: ComboId, _pos: THREE.Vector3) => {},
  roto: (_r: Rompible) => {},
};

export const estadisticasObjetos = { rotos: 0, lascas: 0 };

function masaDe(volumen: number, t: TipoObjeto) {
  return Math.max(0.2, volumen * t.densidad * 10);
}

export function crearRompible(id: string, x: number, y: number, z: number, rotY = 0) {
  const tipo = TIPOS[id];
  if (!tipo) throw new Error(`Objeto desconocido: ${id}`);
  const pts = tipo.forma();
  const bruto = casco(pts)!;
  const c0 = bruto.centro.clone();
  const local = casco(pts.map((p) => p.clone().sub(c0)))!;
  const planos = planosDe(local);
  const centro = local.centro.clone();
  const mesh = new THREE.Mesh(geometriaDe(local, centro, planos, opcionesMalla(tipo)), materialDe(tipo, 'normal'));
  scene.add(mesh);
  const body = new CANNON.Body({ mass: masaDe(local.volumen, tipo), material: mObjeto });
  if (tipo.caja) body.addShape(new CANNON.Box(new CANNON.Vec3(tipo.caja[0] / 2, tipo.caja[1] / 2, tipo.caja[2] / 2)));
  else anadirForma(body, local, centro);
  let minY = Infinity;
  for (const p of local.verts) minY = Math.min(minY, p.y - centro.y);
  body.position.set(x, y - minY + 0.002, z);
  body.quaternion.setFromEuler(0, rotY, 0);
  body.sleepSpeedLimit = 0.15;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);
  body.sleep();
  const r: Rompible = {
    tipo, body, mesh, convexo: local, centro, planos, volumen0: local.volumen, hp: tipo.hp, hpMax: tipo.hp,
    ardiendo: 0, helado: 0, variante: 'normal', roto: false, propagarT: 0, lascas: 0,
  };
  rompibles.push(r);
  rompibleDe.set(body, r);
  sincronizar(r);
  precalcularPatrones(tipo, local, planos);
  return r;
}

/** Muro de ladrillos a soga, centrado en (x, z). */
export function crearMuroLadrillos(x: number, z: number, columnas: number, filas: number, rotY = 0) {
  const [w, h] = TIPOS.ladrillo!.caja!;
  const dir = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
  for (let f = 0; f < filas; f++) {
    const desfase = f % 2 === 0 ? 0 : w / 2;
    const n = f % 2 === 0 ? columnas : columnas - 1;
    for (let c = 0; c < n; c++) {
      const u = (c - (columnas - 1) / 2) * (w + 0.004) + desfase;
      crearRompible('ladrillo', x + dir.x * u, f * (h + 0.003), z + dir.z * u, rotY);
    }
  }
}

function sincronizar(r: Rompible) {
  r.mesh.position.set(r.body.position.x, r.body.position.y, r.body.position.z);
  r.mesh.quaternion.set(r.body.quaternion.x, r.body.quaternion.y, r.body.quaternion.z, r.body.quaternion.w);
}

function ponerVariante(r: Rompible, v: Variante) {
  if (r.variante === v) return;
  r.variante = v;
  r.mesh.material = materialDe(r.tipo, v);
}

function encender(r: Rompible) {
  if (!r.tipo.inflamable || r.ardiendo > 0 || r.roto) return false;
  r.helado = 0;
  r.ardiendo = r.tipo.explosivo ? 0.7 : 0.01;
  r.propagarT = 1.2;
  ponerVariante(r, 'ardiendo');
  r.body.wakeUp();
  return true;
}

/** Aplica un golpe a un objeto. Devuelve el daño efectivo. */
export function danarObjeto(r: Rompible, g: GolpeBase): number {
  if (r.roto) return 0;
  let dano = g.dano;
  if (r.helado > 0) dano *= 2;
  if (g.elemento === 'fuerza' && r.tipo.material === 'piedra') dano *= 1.3;
  if (g.elemento === 'rayo' && r.tipo.material === 'cristal') dano *= 2;
  if (g.elemento === 'fuego') encender(r);
  if (g.elemento === 'hielo') {
    if (r.ardiendo > 0 && !r.tipo.explosivo) {
      r.ardiendo = 0;
      particulas(v3(r.body.position).add(new THREE.Vector3(0, 0.5, 0)), 0xe8e8f0, 10, 2, { tam: 0.2, gravedad: 1.5 });
    }
    if (r.ardiendo <= 0) {
      r.helado = 6;
      ponerVariante(r, 'helado');
    }
  }
  r.hp -= dano;
  if (r.hp <= 0) {
    romper(r, g.punto, g.dir, 6 + (g.empuje ?? 0) * 0.8);
    return dano;
  }
  if (r.tipo.astillable && dano >= 6) astillarObjeto(r, g.punto, g.dir, dano);
  if (g.empuje) empujarCuerpo(r.body, g.dir, g.empuje * 0.6);
  particulas(g.punto, r.tipo.polvo, 3, 2.5, { tam: 0.07 });
  return dano;
}

function empujarCuerpo(b: CANNON.Body, dir: THREE.Vector3, v: number) {
  const k = Math.min(1, Math.max(0.12, 40 / Math.max(1, b.mass)));
  b.wakeUp();
  b.velocity.x += dir.x * v * k;
  b.velocity.z += dir.z * v * k;
  b.velocity.y += v * 0.25 * k;
}

// ---------------------------------------------------------------- trozos
interface Trozo {
  body: CANNON.Body;
  mesh: THREE.Mesh;
  /** La geometría viene de la caché de fracturas y la comparten varios trozos: no se libera. */
  compartida: boolean;
  edad: number;
  arde: number;
}
export const trozos: Trozo[] = [];
const MAX_TROZOS = 300;
/**
 * Grupos de colisión. Los trozos chocan con el suelo, los muros, los objetos intactos y los personajes,
 * pero no entre sí: los pares trozo-trozo son convexo contra convexo (SAT + recorte), crecen con el
 * cuadrado de los trozos y eran casi todo el coste de una explosión en cadena.
 */
export const GRUPO_ESCENA = 1;
export const GRUPO_TROZO = 2;
const VIDA_TROZOS = 11;

function quitarTrozo(i: number) {
  const t = trozos[i]!;
  world.removeBody(t.body);
  t.mesh.removeFromParent();
  if (!t.compartida) t.mesh.geometry.dispose();
  trozos.splice(i, 1);
}

interface Lanzamiento {
  tipo: TipoObjeto;
  planos: Plano[];
  variante: Variante;
  /** Cuerpo de referencia: posición y giro del objeto original (su origen = `centro`). */
  ref: { position: CANNON.Vec3; quaternion: CANNON.Quaternion; velocity: CANNON.Vec3 };
  centro: THREE.Vector3;
  puntoMundo: THREE.Vector3;
  dir: THREE.Vector3;
  fuerza: number;
  arde?: boolean;
}

const _q = new CANNON.Quaternion();
function lanzarPiezas(piezas: Convexo[], o: Lanzamiento, geometrias?: THREE.BufferGeometry[]) {
  const mat = materialDe(o.tipo, o.variante);
  const opts = opcionesMalla(o.tipo);
  for (let ip = 0; ip < piezas.length; ip++) {
    const p = piezas[ip]!;
    const geo = geometrias?.[ip] ?? geometriaDe(p, p.centro, o.planos, opts);
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    const body = new CANNON.Body({
      mass: masaDe(p.volumen, o.tipo), material: mObjeto, collisionFilterGroup: GRUPO_TROZO, collisionFilterMask: ~GRUPO_TROZO,
    });
    anadirForma(body, p, p.centro);
    const rel = new CANNON.Vec3(p.centro.x - o.centro.x, p.centro.y - o.centro.y, p.centro.z - o.centro.z);
    const w = o.ref.quaternion.vmult(rel).vadd(o.ref.position);
    body.position.copy(w);
    body.quaternion.copy(o.ref.quaternion);
    const radial = new THREE.Vector3(w.x, w.y, w.z).sub(o.puntoMundo);
    const dist = radial.length();
    radial.normalize();
    const cerca = 1 / (0.4 + dist);
    const k = Math.min(o.fuerza, 24);
    body.velocity.set(
      o.ref.velocity.x + o.dir.x * k * rand(0.3, 0.7) + radial.x * k * 0.35 * cerca,
      o.ref.velocity.y + rand(1.5, 4.5) + Math.max(0, radial.y) * 3,
      o.ref.velocity.z + o.dir.z * k * rand(0.3, 0.7) + radial.z * k * 0.35 * cerca,
    );
    body.angularVelocity.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
    body.sleepSpeedLimit = 0.25;
    body.sleepTimeLimit = 0.6;
    body.linearDamping = 0.05;
    body.angularDamping = 0.15;
    world.addBody(body);
    mesh.position.set(w.x, w.y, w.z);
    mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    trozos.push({ body, mesh, compartida: !!geometrias, edad: 0, arde: o.arde && rnd() < 0.5 ? rand(1, 3) : 0 });
  }
  while (trozos.length > MAX_TROZOS) quitarTrozo(0);
}

// ---------------------------------------------------------------- caché de fracturas
/**
 * Fracturar un objeto cuesta varios milisegundos (un casco convexo por corte) y una explosión en
 * cadena rompe decenas a la vez en el mismo paso. Los objetos intactos de un tipo tienen siempre la
 * misma forma, así que su rotura se precalcula: unos cuantos patrones por tipo, cada uno con el
 * impacto en una dirección distinta, y al romper se usa el patrón cuya dirección se parece más a la
 * del golpe. La geometría de cada trozo también se comparte entre todos los usos del patrón.
 * Se generan con su propia semilla (no consumen el azar de la partida) en ratos libres del
 * navegador; si aún no está hecho cuando hace falta, se calcula en el momento y se guarda.
 */
interface Patron {
  dir: THREE.Vector3;
  piezas: Convexo[];
  geometrias: THREE.BufferGeometry[];
}
const DIRECCIONES_PATRON: THREE.Vector3[] = [
  ...Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i / 8) * Math.PI * 2), 0.15, Math.sin((i / 8) * Math.PI * 2)).normalize()),
  new THREE.Vector3(0.2, 1, 0).normalize(),
  new THREE.Vector3(-0.2, -1, 0.1).normalize(),
];
const patrones = new Map<string, (Patron | undefined)[]>();
export const estadisticasPatrones = { calculados: 0, usados: 0 };

function patron(t: TipoObjeto, base: Convexo, planos: Plano[], helado: boolean, i: number): Patron {
  const k = `${t.id}-${helado ? 'h' : 'n'}`;
  let lista = patrones.get(k);
  if (!lista) {
    lista = new Array(DIRECCIONES_PATRON.length);
    patrones.set(k, lista);
  }
  let p = lista[i];
  if (p) return p;
  const dir = DIRECCIONES_PATRON[i]!;
  let soporte = 0;
  for (const v of base.verts) soporte = Math.max(soporte, dir.dot(v.clone().sub(base.centro)));
  const impacto = base.centro.clone().addScaledVector(dir, soporte * 0.7);
  const n = Math.max(2, Math.round(t.piezas * (helado ? 1.4 : 1)));
  let semilla = 0;
  for (const ch of k) semilla = (semilla * 31 + ch.charCodeAt(0)) >>> 0;
  const piezas = fracturar(base, impacto, n, mulberry32(semilla + i * 7919), t.material === 'madera' ? normalVeta : normalLibre);
  const opts = opcionesMalla(t);
  for (const pz of piezas) validez.set(pz, validoParaCannon(pz));
  p = { dir, piezas, geometrias: piezas.map((pz) => geometriaDe(pz, pz.centro, planos, opts)) };
  lista[i] = p;
  estadisticasPatrones.calculados++;
  return p;
}

function fracturaCacheada(t: TipoObjeto, base: Convexo, planos: Plano[], impacto: THREE.Vector3, helado: boolean): Patron {
  const d = impacto.clone().sub(base.centro);
  if (d.lengthSq() < 1e-8) d.set(0, 1, 0);
  d.normalize();
  let mejor = 0;
  let mejorDot = -Infinity;
  DIRECCIONES_PATRON.forEach((dp, i) => {
    const x = dp.dot(d);
    if (x > mejorDot) {
      mejorDot = x;
      mejor = i;
    }
  });
  estadisticasPatrones.usados++;
  return patron(t, base, planos, helado, mejor);
}

/** Cola de patrones por precalcular en ratos libres (uno por llamada para no dar tirones). */
const colaPatrones: (() => void)[] = [];
const tiposPrecalculados = new Set<string>();
let precalculando = false;
const enRatoLibre: (cb: () => void) => void =
  typeof requestIdleCallback === 'function' ? (cb) => requestIdleCallback(cb, { timeout: 500 }) : (cb) => setTimeout(cb, 16);
function precalcularPatrones(t: TipoObjeto, base: Convexo, planos: Plano[]) {
  if (tiposPrecalculados.has(t.id)) return;
  tiposPrecalculados.add(t.id);
  for (const helado of [false, true]) {
    for (let i = 0; i < DIRECCIONES_PATRON.length; i++) colaPatrones.push(() => patron(t, base, planos, helado, i));
  }
  if (precalculando) return;
  precalculando = true;
  const siguiente = () => {
    const tarea = colaPatrones.shift();
    if (!tarea) {
      precalculando = false;
      return;
    }
    tarea();
    enRatoLibre(siguiente);
  };
  enRatoLibre(siguiente);
}

/** Rompe un objeto entero: lo fractura cerca del impacto y lanza los trozos. */
export function romper(r: Rompible, puntoMundo: THREE.Vector3, dir: THREE.Vector3, fuerza: number) {
  if (r.roto) return;
  r.roto = true;
  const b = r.body;
  const l = b.pointToLocalFrame(new CANNON.Vec3(puntoMundo.x, puntoMundo.y, puntoMundo.z));
  // El punto de contacto puede caer fuera: se acerca al interior para concentrar ahí los cortes.
  const impacto = new THREE.Vector3(l.x, l.y, l.z).multiplyScalar(0.7).add(r.centro);
  const helado = r.helado > 0;
  let piezas: Convexo[];
  let geometrias: THREE.BufferGeometry[] | undefined;
  if (r.lascas === 0) {
    // Objeto intacto: patrón de rotura precalculado (ver fracturaCacheada).
    const f = fracturaCacheada(r.tipo, r.convexo, r.planos, impacto, helado);
    piezas = f.piezas;
    geometrias = f.geometrias;
  } else {
    const n = Math.round(r.tipo.piezas * (helado ? 1.4 : 1) * THREE.MathUtils.clamp(r.convexo.volumen / r.volumen0, 0.5, 1));
    piezas = fracturar(r.convexo, impacto, Math.max(2, n), rnd, r.tipo.material === 'madera' ? normalVeta : normalLibre);
  }
  lanzarPiezas(piezas, {
    tipo: r.tipo,
    planos: r.planos,
    variante: r.ardiendo > 0 ? 'carbon' : helado ? 'helado' : 'normal',
    ref: b,
    centro: r.centro,
    puntoMundo,
    dir,
    fuerza,
    arde: r.ardiendo > 0,
  }, geometrias);
  world.removeBody(b);
  r.mesh.removeFromParent();
  r.mesh.geometry.dispose();
  rompibleDe.delete(b);
  const c = v3(b.position);
  particulas(c, r.tipo.polvo, 16, 5, { tam: 0.14 });
  particulas(c, r.tipo.interior, 8, 9, { tam: 0.06, gravedad: -14 });
  temblor(0.16, 0.02);
  estadisticasObjetos.rotos++;
  ganchos.roto(r);

  if (r.tipo.explosivo) {
    eventos.push({
      tipo: 'explosion', centro: c, radio: 3.6, combo: 'aceite',
      golpe: { dano: 45, elemento: 'fuego', punto: c, dir, empuje: 15, sinInfusion: true },
    });
  }
  if (r.tipo.agua) eventos.push({ tipo: 'agua', centro: c, radio: 2.8 });
  if (r.tipo.mana) {
    eventos.push({
      tipo: 'explosion', centro: c, radio: 3, combo: 'cristal',
      golpe: { dano: 25, elemento: 'arcano', punto: c, dir, empuje: 8, sinInfusion: true },
    });
    eventos.push({ tipo: 'mana', cantidad: 25, punto: c });
  }
}

/** Arranca una lasca del objeto por el lado del impacto; el resto sigue siendo el mismo objeto. */
function astillarObjeto(r: Rompible, puntoMundo: THREE.Vector3, dir: THREE.Vector3, dano: number) {
  const b = r.body;
  const l = b.pointToLocalFrame(new CANNON.Vec3(puntoMundo.x, puntoMundo.y, puntoMundo.z));
  const local = new THREE.Vector3(l.x, l.y, l.z).add(r.centro);
  const escala = Math.cbrt(r.volumen0);
  const profundidad = THREE.MathUtils.clamp(0.05 + dano * 0.004, 0.06, 0.3) * escala;
  const res = astillar(r.convexo, local, profundidad, rnd, 0.22);
  if (!res) return;
  // La lasca sale en 1-3 trozos despedidos hacia fuera del objeto.
  const lascas = res.lasca.volumen > r.volumen0 * 0.03 ? fracturar(res.lasca, res.lasca.centro, 2 + Math.floor(rnd() * 2), rnd) : [res.lasca];
  const salida = v3(b.position).sub(puntoMundo).multiplyScalar(-1).setY(0);
  if (salida.lengthSq() < 1e-6) salida.copy(dir).multiplyScalar(-1);
  salida.normalize().lerp(dir.clone().multiplyScalar(-0.3), 0.3).normalize();
  lanzarPiezas(lascas, {
    tipo: r.tipo, planos: r.planos, variante: r.variante === 'ardiendo' ? 'carbon' : r.variante, ref: b, centro: r.centro,
    puntoMundo, dir: salida, fuerza: 5 + dano * 0.1,
  });

  // El resto: nuevo cuerpo con la forma recortada, en la misma posición del mundo.
  const resto = res.resto;
  const nuevo = new CANNON.Body({ mass: masaDe(resto.volumen, r.tipo), material: mObjeto });
  anadirForma(nuevo, resto, resto.centro);
  const rel = new CANNON.Vec3(resto.centro.x - r.centro.x, resto.centro.y - r.centro.y, resto.centro.z - r.centro.z);
  nuevo.position.copy(b.quaternion.vmult(rel).vadd(b.position));
  nuevo.quaternion.copy(b.quaternion);
  nuevo.velocity.copy(b.velocity);
  nuevo.angularVelocity.copy(b.angularVelocity);
  nuevo.sleepSpeedLimit = 0.15;
  nuevo.sleepTimeLimit = 0.4;
  world.removeBody(b);
  rompibleDe.delete(b);
  world.addBody(nuevo);
  rompibleDe.set(nuevo, r);
  r.body = nuevo;
  r.convexo = resto;
  r.centro = resto.centro.clone();
  r.mesh.geometry.dispose();
  r.mesh.geometry = geometriaDe(resto, r.centro, r.planos, opcionesMalla(r.tipo));
  sincronizar(r);
  r.lascas++;
  estadisticasObjetos.lascas++;
  particulas(puntoMundo, r.tipo.polvo, 8, 3.5, { tam: 0.1 });
  // Muy mermado: el siguiente golpe lo derriba.
  if (resto.volumen < r.volumen0 * 0.35) r.hp = Math.min(r.hp, 12);
}

// ---------------------------------------------------------------- consultas
/** Caja envolvente al día: solo se recalcula si el cuerpo se ha movido desde la última vez. */
function cajaDe(r: Rompible) {
  if (r.body.aabbNeedsUpdate) r.body.updateAABB();
  return r.body.aabb;
}

const _c = new THREE.Vector3();
/** Distancia del punto a la caja envolvente del objeto (0 si está dentro). */
export function distanciaObjeto(r: Rompible, p: THREE.Vector3) {
  const bb = cajaDe(r);
  _c.set(
    THREE.MathUtils.clamp(p.x, bb.lowerBound.x, bb.upperBound.x),
    THREE.MathUtils.clamp(p.y, bb.lowerBound.y, bb.upperBound.y),
    THREE.MathUtils.clamp(p.z, bb.lowerBound.z, bb.upperBound.z),
  );
  return _c.distanceTo(p);
}

/** Punto de la caja envolvente más cercano a p (para colocar el impacto). */
export function puntoCercano(r: Rompible, p: THREE.Vector3) {
  distanciaObjeto(r, p);
  return _c.clone();
}

export function objetosEnRadio(centro: THREE.Vector3, radio: number) {
  const res: { r: Rompible; d: number }[] = [];
  for (const r of rompibles) {
    if (r.roto) continue;
    const d = distanciaObjeto(r, centro);
    if (d <= radio) res.push({ r, d });
  }
  return res;
}

/**
 * Objetos que cruza un rayo horizontal (a la altura `y`), ordenados por distancia.
 * Prueba de losas contra la caja envolvente en XZ.
 */
export function objetosEnRayo(o: THREE.Vector3, dir: THREE.Vector3, largo: number) {
  const res: { r: Rompible; t: number }[] = [];
  for (const r of rompibles) {
    if (r.roto) continue;
    const bb = cajaDe(r);
    if (bb.upperBound.y < o.y - 0.9 || bb.lowerBound.y > o.y + 0.4) continue;
    let t0 = 0;
    let t1 = largo;
    let ok = true;
    for (const [oc, dc, lo, hi] of [
      [o.x, dir.x, bb.lowerBound.x, bb.upperBound.x],
      [o.z, dir.z, bb.lowerBound.z, bb.upperBound.z],
    ] as const) {
      if (Math.abs(dc) < 1e-8) {
        if (oc < lo || oc > hi) ok = false;
        continue;
      }
      let a = (lo - oc) / dc;
      let b = (hi - oc) / dc;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) ok = false;
    }
    if (ok) res.push({ r, t: t0 });
  }
  return res.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- fuerzas sobre objetos y escombros
/** Empujón radial (o hacia el centro si `atraer`) a objetos intactos y trozos. */
export function impulsarCuerpos(centro: THREE.Vector3, radio: number, fuerza: number, atraer = false) {
  const aplicar = (b: CANNON.Body) => {
    const dx = b.position.x - centro.x;
    const dz = b.position.z - centro.z;
    const d = Math.hypot(dx, dz);
    if (d > radio) return;
    const f = 1 - d / radio;
    const s = atraer ? -1 : 1;
    const nx = d > 1e-3 ? dx / d : 0;
    const nz = d > 1e-3 ? dz / d : 0;
    const k = Math.min(1, Math.max(0.15, 40 / Math.max(1, b.mass)));
    b.wakeUp();
    b.velocity.x += s * nx * fuerza * f * k;
    b.velocity.z += s * nz * fuerza * f * k;
    b.velocity.y += fuerza * f * k * (atraer ? 0.15 : 0.45);
    b.angularVelocity.x += rand(-4, 4) * f;
    b.angularVelocity.z += rand(-4, 4) * f;
  };
  for (const r of rompibles) if (!r.roto) aplicar(r.body);
  for (const t of trozos) aplicar(t.body);
}

/** Atracción continua (singularidad, implosión, vórtice): se llama en cada paso. */
export function atraerCuerpos(centro: THREE.Vector3, radio: number, fuerza: number, dt: number, elevar = 0) {
  const aplicar = (b: CANNON.Body, ligero: boolean) => {
    const dx = centro.x - b.position.x;
    const dz = centro.z - b.position.z;
    const d = Math.hypot(dx, dz);
    if (d > radio || d < 0.2) return;
    const k = ligero ? 1 : Math.min(1, Math.max(0.1, 60 / Math.max(1, b.mass)));
    b.wakeUp();
    b.velocity.x += (dx / d) * fuerza * k * dt;
    b.velocity.z += (dz / d) * fuerza * k * dt;
    if (elevar && b.position.y < 2.2) b.velocity.y += elevar * k * dt;
    b.velocity.x *= Math.exp(-1.2 * dt);
    b.velocity.z *= Math.exp(-1.2 * dt);
  };
  for (const r of rompibles) if (!r.roto) aplicar(r.body, false);
  for (const t of trozos) aplicar(t.body, true);
}

// ---------------------------------------------------------------- añicos de hielo (enemigos congelados)
const PLANOS_HIELO = new Map<string, { convexo: Convexo; planos: Plano[] }>();
/** Revienta un bloque de hielo con la silueta de un enemigo congelado. */
export function estallarHielo(pos: THREE.Vector3, alto: number, radio: number, dir: THREE.Vector3, fuerza: number) {
  const k = `${alto.toFixed(2)}-${radio.toFixed(2)}`;
  let base = PLANOS_HIELO.get(k);
  if (!base) {
    const pts = formaTorno([[0, radio * 0.75], [alto * 0.3, radio * 1.05], [alto * 0.75, radio], [alto, radio * 0.55]], 7);
    const bruto = casco(pts)!;
    const c = bruto.centro.clone();
    const convexo = casco(pts.map((p) => p.clone().sub(c)))!;
    base = { convexo, planos: planosDe(convexo) };
    PLANOS_HIELO.set(k, base);
  }
  const centroMundo = pos.clone().add(new THREE.Vector3(0, -base.convexo.verts.reduce((m, p) => Math.min(m, p.y), Infinity), 0));
  const piezas = fracturar(base.convexo, new THREE.Vector3(-dir.x * radio, 0, -dir.z * radio), TIPO_HIELO.piezas, rnd);
  lanzarPiezas(piezas, {
    tipo: TIPO_HIELO, planos: base.planos, variante: 'normal',
    ref: { position: new CANNON.Vec3(centroMundo.x, centroMundo.y, centroMundo.z), quaternion: _q.set(0, 0, 0, 1), velocity: new CANNON.Vec3() },
    centro: base.convexo.centro, puntoMundo: centroMundo.clone().addScaledVector(dir, -radio), dir, fuerza,
  });
  particulas(centroMundo, 0xc8f0ff, 18, 6, { tam: 0.1, aditivo: true });
}

// ---------------------------------------------------------------- actualización
export function actualizarObjetos(dt: number) {
  for (const r of rompibles) {
    if (r.roto) continue;
    if (r.helado > 0) {
      r.helado -= dt;
      if (r.helado <= 0 && r.ardiendo <= 0) ponerVariante(r, 'normal');
    }
    if (r.ardiendo > 0) {
      r.ardiendo += dt;
      const p = v3(r.body.position);
      if (rnd() < dt * 18) particulas(p.clone().add(new THREE.Vector3(0, 0.3, 0)), rnd() < 0.5 ? 0xff7a1a : 0xffc04a, 1, 1.4, { tam: 0.14, gravedad: 3.5, aditivo: true, dispersion: 0.3, vida: 0.6 });
      if (r.tipo.explosivo) {
        // La mecha del aceite: tras 0,7 s, revienta.
        if (r.ardiendo > 0.7) {
          r.hp = 0;
          romper(r, p, new THREE.Vector3(0, 0, 1), 14);
        }
        continue;
      }
      r.hp -= 6 * dt;
      if (r.hp <= 0) {
        romper(r, p, new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), 3);
        continue;
      }
      r.propagarT -= dt;
      if (r.propagarT <= 0) {
        r.propagarT = 0.6;
        for (const o of rompibles) {
          if (o === r || o.roto || !o.tipo.inflamable || o.ardiendo > 0) continue;
          if (distanciaObjeto(o, p) < 1.25 && rnd() < 0.45) {
            if (encender(o)) ganchos.combo('incendio', v3(o.body.position));
          }
        }
      }
    }
  }
  // Limpia de la lista los rotos (se conservan mientras dura el paso para no invalidar índices).
  for (let i = rompibles.length - 1; i >= 0; i--) if (rompibles[i]!.roto) rompibles.splice(i, 1);

  for (let i = trozos.length - 1; i >= 0; i--) {
    const t = trozos[i]!;
    t.edad += dt;
    if (t.arde > 0) {
      t.arde -= dt;
      if (rnd() < dt * 8) particulas(v3(t.body.position), 0xff8a2a, 1, 1, { tam: 0.08, gravedad: 3, aditivo: true, vida: 0.5 });
    }
    if (t.edad > VIDA_TROZOS + 1) quitarTrozo(i);
  }
}

export function sincronizarObjetos() {
  for (const r of rompibles) if (!r.roto) sincronizar(r);
  for (const t of trozos) {
    t.mesh.position.set(t.body.position.x, t.body.position.y, t.body.position.z);
    t.mesh.quaternion.set(t.body.quaternion.x, t.body.quaternion.y, t.body.quaternion.z, t.body.quaternion.w);
    const fin = t.edad - VIDA_TROZOS;
    t.mesh.scale.setScalar(fin > 0 ? Math.max(0.01, 1 - fin) : 1);
  }
}

/** Apaga el fuego de los objetos en un radio (al romperse una tinaja). */
export function apagar(centro: THREE.Vector3, radio: number) {
  for (const { r } of objetosEnRadio(centro, radio)) {
    if (r.ardiendo > 0 && !r.tipo.explosivo) {
      r.ardiendo = 0;
      ponerVariante(r, 'normal');
    }
  }
}

export function limpiarObjetos() {
  for (const r of rompibles) {
    if (r.roto) continue;
    world.removeBody(r.body);
    r.mesh.removeFromParent();
    r.mesh.geometry.dispose();
  }
  rompibles.length = 0;
  rompibleDe.clear();
  while (trozos.length) quitarTrozo(trozos.length - 1);
  estadisticasObjetos.rotos = estadisticasObjetos.lascas = 0;
}
