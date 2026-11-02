import * as THREE from 'three';
import { ELEMENTOS, type Elemento } from './grimorio';
import { estado, eventos, mago, rand, scene, temblor, type GolpeBase } from './mundo';
import { anillo, anuncio, arco, destello, numero, particulas } from './efectos';
import { apagar, danarObjeto, ganchos, impulsarCuerpos, objetosEnRadio, puntoCercano, type Rompible } from './objetos';
import { centroDe, empujar, enemigos, enemigosEnRadio, ganchosEnemigos, herir, masCercano, type Enemigo } from './enemigos';
import { COMBOS, multiplicadorMarca, reaccionar, type ComboId } from './reacciones';

/**
 * Combate del sandbox del mago: aplica golpes, resuelve los combos elementales y sus efectos,
 * arcos en cadena, zonas persistentes y los eventos del entorno (explosiones, agua, maná).
 */

export const contadorCombos = Object.fromEntries(Object.keys(COMBOS).map((k) => [k, 0])) as Record<ComboId, number>;
export const ganchosCombate = {
  alCombo: (_id: ComboId) => {},
};
export const estadisticasCombate = { dano: 0, golpes: 0 };

const color = (e: Elemento) => ELEMENTOS[e].css;

export function registrarCombo(id: ComboId, pos: THREE.Vector3) {
  contadorCombos[id]++;
  const c = COMBOS[id];
  anuncio(c.nombre, c.color);
  numero(pos, c.nombre.toUpperCase(), c.color, true);
  ganchosCombate.alCombo(id);
}
ganchos.combo = registrarCombo;
ganchosEnemigos.combo = registrarCombo;

// ---------------------------------------------------------------- infusión
const PRISMA: Elemento[] = ['fuego', 'hielo', 'rayo', 'arcano'];
export function elementoInfusion(): Elemento | null {
  const inf = mago.infusion;
  if (inf.t <= 0) return null;
  return inf.prisma ? PRISMA[inf.indice % PRISMA.length]! : inf.elemento;
}

// ---------------------------------------------------------------- golpes
export function golpearEnemigo(e: Enemigo, g: GolpeBase): number {
  if (e.muerto) return 0;
  const pos = centroDe(e);
  let dano = g.dano * multiplicadorMarca(e.est);
  const r = reaccionar(e.est, g.elemento, g.frio ?? 25, g.soloEstado ?? false);
  dano = dano * r.mult + r.extra;
  let congelo = r.congelo;
  const combos = [...r.combos];
  const extra = elementoInfusion();
  if (extra && !g.sinInfusion && !g.soloEstado && extra !== g.elemento) {
    const r2 = reaccionar(e.est, extra, 15);
    dano = dano * r2.mult + r2.extra;
    congelo ||= r2.congelo;
    combos.push(...r2.combos);
  }
  if (g.aturdir) e.est.aturdido = Math.max(e.est.aturdido, g.aturdir);
  dano = Math.max(0, dano);
  estadisticasCombate.dano += dano;
  estadisticasCombate.golpes++;
  if (dano >= 0.5) numero(pos, String(Math.round(dano)), combos.length ? '#ffffff' : color(g.elemento), dano >= 60);
  const anicos = combos.includes('anicos');
  const murio = herir(e, dano, g.dir, anicos);
  if (!murio && g.empuje) empujar(e, g.dir, g.empuje);
  if (congelo) {
    particulas(pos, 0xc8f0ff, 10, 3, { tam: 0.1, aditivo: true });
    anillo(pos, 0x8adfff, e.radio * 3, 0.35);
  }
  for (const c of combos) efectoCombo(c, e, pos, g);
  return dano;
}

export function golpearObjeto(r: Rompible, g: GolpeBase) {
  return danarObjeto(r, g);
}

export interface OpcionesArea {
  excluir?: Enemigo | null;
  objetos?: boolean;
  /** Sin caída, el daño es igual en todo el radio. */
  caida?: boolean;
  /** Impulso a escombros y objetos aunque el golpe no empuje enemigos. */
  impulso?: number;
}

/** Golpe en área: enemigos, objetos y escombros. */
export function golpearArea(centro: THREE.Vector3, radio: number, g: Omit<GolpeBase, 'punto' | 'dir'>, o: OpcionesArea = {}) {
  let total = 0;
  for (const { e, d } of enemigosEnRadio(centro, radio)) {
    if (e === o.excluir) continue;
    const f = o.caida === false ? 1 : 1 - 0.5 * (d / radio);
    const dir = new THREE.Vector3(e.body.position.x - centro.x, 0, e.body.position.z - centro.z);
    if (dir.lengthSq() < 1e-6) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    total += golpearEnemigo(e, { ...g, dano: g.dano * f, empuje: g.empuje ? g.empuje * f : 0, punto: centroDe(e), dir });
  }
  if (o.objetos !== false) {
    for (const { r, d } of objetosEnRadio(centro, radio)) {
      const f = o.caida === false ? 1 : 1 - 0.5 * (d / radio);
      const punto = puntoCercano(r, centro);
      const dir = new THREE.Vector3(r.body.position.x - centro.x, 0, r.body.position.z - centro.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      danarObjeto(r, { ...g, dano: g.dano * f, empuje: g.empuje ? g.empuje * f : 0, punto, dir });
    }
  }
  const imp = o.impulso ?? g.empuje ?? 0;
  if (imp > 0) impulsarCuerpos(centro, radio * 1.3, imp);
  return total;
}

/** Arco eléctrico que salta de enemigo en enemigo. */
export function cadenaRayo(desde: THREE.Vector3, primero: Enemigo | null, saltos: number, dano: number, radioSalto = 7, extra: Partial<GolpeBase> = {}) {
  const tocados = new Set<Enemigo>();
  let origen = desde.clone();
  let actual = primero ?? masCercano(desde, radioSalto);
  for (let i = 0; i <= saltos && actual; i++) {
    tocados.add(actual);
    const destino = centroDe(actual);
    arco(origen, destino, 0xfff27a, 0.18);
    const dir = destino.clone().sub(origen).setY(0).normalize();
    golpearEnemigo(actual, { dano: dano * Math.pow(0.85, i), elemento: 'rayo', punto: destino, dir, ...extra });
    origen = destino;
    actual = masCercano(destino, radioSalto, tocados);
  }
  return tocados;
}

// ---------------------------------------------------------------- efectos de los combos
function efectoCombo(id: ComboId, e: Enemigo, pos: THREE.Vector3, g: GolpeBase) {
  registrarCombo(id, pos);
  switch (id) {
    case 'choque_termico':
      destello(pos, 0xffe8d0, 2.2, 0.4, 30);
      particulas(pos, 0xe8e8f0, 22, 4, { tam: 0.3, gravedad: 2, vida: 1.1 });
      golpearArea(pos, 2.4, { dano: 14, elemento: 'fuerza', empuje: 5, soloEstado: true, sinInfusion: true }, { excluir: e });
      temblor(0.2, 0.03);
      break;
    case 'anicos':
      particulas(pos, 0xc8f0ff, 26, 9, { tam: 0.12, aditivo: true, gravedad: -10 });
      anillo(pos, 0xbfefff, 3.2, 0.3);
      golpearArea(pos, 3, { dano: 16, elemento: 'hielo', frio: 30, soloEstado: true, sinInfusion: true }, { excluir: e, impulso: 6 });
      temblor(0.3, 0.05);
      break;
    case 'superconductor': {
      for (const o of [...enemigos]) {
        if (o === e || o.muerto) continue;
        if (!(o.est.frio > 0 || o.est.congelado > 0)) continue;
        const c = centroDe(o);
        if (c.distanceTo(pos) > 10) continue;
        arco(pos, c, 0xc8f4ff, 0.22, 10);
        golpearEnemigo(o, { dano: 18, elemento: 'rayo', punto: c, dir: c.clone().sub(pos).setY(0).normalize(), soloEstado: true, sinInfusion: true });
      }
      destello(pos, 0xc8f4ff, 1.2, 0.25, 20);
      break;
    }
    case 'sobrecarga':
      destello(pos, 0xffb84a, 2.8, 0.4, 60);
      particulas(pos, 0xffd070, 20, 8, { tam: 0.1, aditivo: true });
      golpearArea(pos, 2.8, { dano: 28, elemento: 'fuego', empuje: 11, soloEstado: true, sinInfusion: true }, { excluir: e });
      temblor(0.35, 0.05);
      break;
    case 'electrocucion': {
      for (const o of [...enemigos]) {
        if (o === e || o.muerto || o.est.empapado <= 0) continue;
        const c = centroDe(o);
        if (c.distanceTo(pos) > 8) continue;
        o.est.empapado = 0;
        arco(pos, c, 0xffffff, 0.25, 10);
        golpearEnemigo(o, { dano: 20, elemento: 'rayo', punto: c, dir: c.clone().sub(pos).setY(0).normalize(), aturdir: 1.2, soloEstado: true, sinInfusion: true });
      }
      destello(pos, 0xfff27a, 1.4, 0.3, 30);
      break;
    }
    case 'congelacion':
      anillo(pos, 0x8adfff, 2, 0.4);
      particulas(pos, 0xc8f0ff, 14, 3, { tam: 0.12, aditivo: true });
      break;
    case 'evaporacion':
      particulas(pos, 0xe8e8f0, 16, 3, { tam: 0.32, gravedad: 2.5, vida: 1.2 });
      break;
    case 'resonancia':
      anillo(pos, 0xc8b0ff, 3, 0.45, 0.4);
      destello(pos, 0xa88aff, 1.6, 0.35, 40);
      golpearArea(pos, 2.6, { dano: 12, elemento: 'arcano', soloEstado: true, sinInfusion: true }, { excluir: e });
      break;
    default:
      break;
  }
  void g;
}

// ---------------------------------------------------------------- zonas persistentes
export interface Zona {
  pos: THREE.Vector3;
  radio: number;
  t: number;
  duracion: number;
  intervalo: number;
  acum: number;
  mesh: THREE.Mesh;
  opacidad: number;
  alTick?: (z: Zona) => void;
  alPaso?: (z: Zona, dt: number) => void;
  alTerminar?: (z: Zona) => void;
  /** Limpia los visuales propios de la zona (se llama al terminar y al reiniciar la escena). */
  alQuitar?: (z: Zona) => void;
}
export const zonas: Zona[] = [];

export function crearZona(o: {
  pos: THREE.Vector3;
  radio: number;
  duracion: number;
  color: number;
  intervalo?: number;
  opacidad?: number;
  aditiva?: boolean;
  alTick?: (z: Zona) => void;
  alPaso?: (z: Zona, dt: number) => void;
  alTerminar?: (z: Zona) => void;
  alQuitar?: (z: Zona) => void;
}): Zona {
  const opacidad = o.opacidad ?? 0.3;
  const mat = new THREE.MeshBasicMaterial({
    color: o.color, transparent: true, opacity: opacidad, depthWrite: false,
    blending: o.aditiva === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(o.pos.x, 0.04 + zonas.length * 0.002, o.pos.z);
  mesh.scale.setScalar(o.radio);
  scene.add(mesh);
  const z: Zona = {
    pos: o.pos.clone().setY(0), radio: o.radio, t: 0, duracion: o.duracion, intervalo: o.intervalo ?? 0.25, acum: 0, mesh, opacidad,
    alTick: o.alTick, alPaso: o.alPaso, alTerminar: o.alTerminar, alQuitar: o.alQuitar,
  };
  zonas.push(z);
  return z;
}

export function actualizarZonas(dt: number) {
  for (let i = zonas.length - 1; i >= 0; i--) {
    const z = zonas[i]!;
    z.t += dt;
    z.acum += dt;
    z.alPaso?.(z, dt);
    while (z.acum >= z.intervalo) {
      z.acum -= z.intervalo;
      z.alTick?.(z);
    }
    const resto = z.duracion - z.t;
    (z.mesh.material as THREE.MeshBasicMaterial).opacity = z.opacidad * Math.min(1, resto * 2, z.t * 6) * (0.85 + Math.sin(estado.tiempo * 6 + i) * 0.15);
    if (z.t >= z.duracion) {
      z.alTerminar?.(z);
      z.alQuitar?.(z);
      z.mesh.removeFromParent();
      z.mesh.geometry.dispose();
      (z.mesh.material as THREE.Material).dispose();
      zonas.splice(i, 1);
    }
  }
}

export function limpiarZonas() {
  for (const z of zonas) {
    z.alQuitar?.(z);
    z.mesh.removeFromParent();
    z.mesh.geometry.dispose();
    (z.mesh.material as THREE.Material).dispose();
  }
  zonas.length = 0;
}

/** Charco de agua: empapa a quien lo pisa y apaga el fuego. */
export function crearCharcoAgua(pos: THREE.Vector3, radio: number) {
  mojar(pos, radio);
  crearZona({
    pos, radio, duracion: 7, color: 0x3a6aa8, opacidad: 0.45, aditiva: false, intervalo: 0.3,
    alTick: (z) => {
      for (const { e } of enemigosEnRadio(z.pos, z.radio)) {
        e.est.empapado = Math.max(e.est.empapado, 2.5);
        e.est.quemado = 0;
      }
      apagar(z.pos, z.radio);
    },
  });
}

function mojar(pos: THREE.Vector3, radio: number) {
  particulas(pos.clone().setY(0.4), 0x6aa8e8, 28, 6, { tam: 0.12, gravedad: -14 });
  for (const { e } of enemigosEnRadio(pos, radio)) {
    e.est.empapado = 6;
    e.est.quemado = 0;
    numero(centroDe(e), 'EMPAPADO', '#6aa8e8');
  }
  apagar(pos, radio);
}

// ---------------------------------------------------------------- daño al mago
export function danarMago(dano: number, desde: THREE.Vector3) {
  if (mago.muerto > 0) return;
  const p = new THREE.Vector3(mago.body.position.x, mago.body.position.y + 0.9, mago.body.position.z);
  mago.hp -= dano;
  if (estado.inmortal) mago.hp = Math.max(1, mago.hp);
  mago.golpeT = 0.25;
  mago.model.hurtT = 0.2;
  numero(p, `-${Math.round(dano)}`, '#ff5a4a');
  const dir = p.clone().sub(desde).setY(0).normalize();
  mago.body.velocity.x += dir.x * 4;
  mago.body.velocity.z += dir.z * 4;
  temblor(0.15, 0.02);
  if (mago.hp <= 0) {
    mago.hp = 0;
    mago.muerto = 2.5;
    anuncio('Has caído', '#ff5a4a');
  }
}

// ---------------------------------------------------------------- eventos del entorno
export function procesarEventos() {
  // Los eventos pueden generar otros (un barril revienta a otro): se procesan por tandas, con tope.
  for (let tanda = 0; tanda < 6 && eventos.length; tanda++) {
    const lista = eventos.splice(0, eventos.length);
    for (const ev of lista) {
      if (ev.tipo === 'explosion') {
        if (ev.combo) registrarCombo(ev.combo, ev.centro.clone().setY(1));
        const col = ELEMENTOS[ev.golpe.elemento].color;
        destello(ev.centro.clone().setY(0.8), col, ev.radio, 0.45, 70);
        particulas(ev.centro.clone().setY(0.6), col, 24, 9, { tam: 0.14, aditivo: true });
        if (ev.golpe.elemento === 'fuego') particulas(ev.centro.clone().setY(0.8), 0x6a5a54, 10, 3, { tam: 0.22, gravedad: 1.5, vida: 1.2 });
        anillo(ev.centro, col, ev.radio * 1.1, 0.4);
        const { punto: _p, dir: _d, ...g } = ev.golpe;
        golpearArea(ev.centro, ev.radio, g);
        temblor(0.45, 0.06);
      } else if (ev.tipo === 'agua') {
        crearCharcoAgua(ev.centro, ev.radio);
      } else if (ev.tipo === 'mana') {
        mago.mana = Math.min(mago.manaMax, mago.mana + ev.cantidad);
        numero(ev.punto, `+${ev.cantidad} maná`, '#7aa8ff', true);
      }
    }
  }
  eventos.length = 0;
}

export function reiniciarCombate() {
  for (const k of Object.keys(contadorCombos) as ComboId[]) contadorCombos[k] = 0;
  estadisticasCombate.dano = estadisticasCombate.golpes = 0;
  limpiarZonas();
}

