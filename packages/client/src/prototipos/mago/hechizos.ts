import * as THREE from 'three';
import { resolveCircle } from '@mazmorra/shared';
import { triggerAttack } from '../../render/models';
import { psxLambert } from '../../render/psx';
import { ELEMENTOS, RANURAS, hechizo, type Build, type Elemento, type Hechizo } from './grimorio';
import { arena, estado, mago, RADIO_MAGO, rand, scene, temblor, textures, type GolpeBase } from './mundo';
import { anillo, arco, aviso, destello, mostrarHaz, numero, ocultarHaz, particulas, sector } from './efectos';
import { atraerCuerpos, distanciaObjeto, objetosEnRayo, puntoCercano, rompibles, trozos, type Rompible } from './objetos';
import { atraer, centroDe, empujar, enemigos, enemigosEnRadio, enemigosEnRayo, masCercano, type Enemigo } from './enemigos';
import { cadenaRayo, crearZona, golpearArea, golpearEnemigo, golpearObjeto, type Zona } from './combate';

/**
 * Lanzamiento de hechizos: cada hechizo con su runa se traduce aquí en proyectiles, conos, zonas,
 * invocaciones o efectos retardados. Las cifras están en grimorio.ts (textos) y aquí (efecto real).
 */

const color = (e: Elemento) => ELEMENTOS[e].color;

// ---------------------------------------------------------------- utilidades
interface Lanzamiento {
  h: Hechizo;
  runa: string | null;
  /** Punto de salida (la mano del mago). */
  origen: THREE.Vector3;
  /** Dirección horizontal hacia el cursor. */
  dir: THREE.Vector3;
  /** Punto apuntado en el suelo, limitado al alcance si el hechizo lo tiene. */
  objetivo: THREE.Vector3;
}

const retrasos: { t: number; fn: () => void }[] = [];
function despues(t: number, fn: () => void) {
  retrasos.push({ t, fn });
}

function rotarY(v: THREE.Vector3, ang: number) {
  return v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
}

function enCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number) {
  const cos = Math.cos(angulo / 2);
  const res: { e: Enemigo; d: number }[] = [];
  for (const e of enemigos) {
    if (e.muerto) continue;
    const dx = e.body.position.x - origen.x;
    const dz = e.body.position.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d - e.radio > radio) continue;
    if (d > 0.6 && (dx * dir.x + dz * dir.z) / d < cos) continue;
    res.push({ e, d });
  }
  return res.sort((a, b) => a.d - b.d);
}

function objetosEnCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number) {
  const cos = Math.cos(angulo / 2);
  const res: { r: Rompible; d: number }[] = [];
  for (const r of rompibles) {
    if (r.roto) continue;
    const p = puntoCercano(r, origen);
    const dx = p.x - origen.x;
    const dz = p.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d > radio) continue;
    if (d > 0.4 && (dx * dir.x + dz * dir.z) / d < cos) continue;
    res.push({ r, d });
  }
  return res.sort((a, b) => a.d - b.d);
}

/** Empuje (o atracción) en cono a objetos intactos y escombros. */
function impulsoCono(origen: THREE.Vector3, dir: THREE.Vector3, radio: number, angulo: number, fuerza: number, atraerHacia = false) {
  const cos = Math.cos(angulo / 2);
  const cuerpos = [...rompibles.filter((r) => !r.roto).map((r) => r.body), ...trozos.map((t) => t.body)];
  for (const b of cuerpos) {
    const dx = b.position.x - origen.x;
    const dz = b.position.z - origen.z;
    const d = Math.hypot(dx, dz);
    if (d > radio || d < 0.05 || (dx * dir.x + dz * dir.z) / d < cos) continue;
    const f = 1 - d / radio;
    const k = Math.min(1, Math.max(0.15, 40 / Math.max(1, b.mass)));
    const s = atraerHacia ? -1 : 1;
    b.wakeUp();
    b.velocity.x += (s * dx) / d * fuerza * f * k;
    b.velocity.z += (s * dz) / d * fuerza * f * k;
    b.velocity.y += fuerza * f * k * 0.35;
  }
}

/** Distancia libre en línea recta antes de chocar con un muro, pilar o bloque. */
function distanciaLibre(o: THREE.Vector3, dir: THREE.Vector3, max: number, radio = 0.05) {
  for (let t = 0; t <= max; t += 0.2) {
    if (resolveCircle(arena, o.x + dir.x * t, o.z + dir.z * t, radio).hit) return Math.max(0, t - 0.2);
  }
  return max;
}

// ---------------------------------------------------------------- proyectiles
interface Proyectil {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  golpe: Omit<GolpeBase, 'punto' | 'dir'>;
  radio: number;
  recorrido: number;
  rebotes: number;
  perfora: boolean;
  teledirigido: Enemigo | null;
  explota?: { radio: number; dano: number; empuje: number; frio?: number };
  alImpactar?: (punto: THREE.Vector3, e: Enemigo | null, r: Rompible | null, dir: THREE.Vector3) => void;
  alExpirar?: (punto: THREE.Vector3) => void;
  golpeados: Set<object>;
  mesh: THREE.Mesh;
  estela: number;
}
const proyectiles: Proyectil[] = [];
const geoProyectil = new THREE.IcosahedronGeometry(1, 0);
const matProyectil = new Map<number, THREE.MeshBasicMaterial>();
function matDe(c: number) {
  let m = matProyectil.get(c);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    matProyectil.set(c, m);
  }
  return m;
}

interface OpcionesProyectil {
  vel: number;
  dano: number;
  elemento: Elemento;
  radio?: number;
  alcance?: number;
  rebotes?: number;
  perfora?: boolean;
  teledirigido?: Enemigo | null;
  empuje?: number;
  frio?: number;
  explota?: Proyectil['explota'];
  tam?: number;
  alImpactar?: Proyectil['alImpactar'];
  alExpirar?: Proyectil['alExpirar'];
  ignorar?: object[];
}

function disparar(origen: THREE.Vector3, dir: THREE.Vector3, o: OpcionesProyectil) {
  const mesh = new THREE.Mesh(geoProyectil, matDe(color(o.elemento)));
  mesh.scale.setScalar(o.tam ?? 0.18);
  mesh.position.copy(origen);
  scene.add(mesh);
  const p: Proyectil = {
    pos: origen.clone(),
    vel: dir.clone().setY(0).normalize().multiplyScalar(o.vel),
    golpe: { dano: o.dano, elemento: o.elemento, empuje: o.empuje, frio: o.frio },
    radio: o.radio ?? 0.25,
    recorrido: o.alcance ?? 22,
    rebotes: o.rebotes ?? 0,
    perfora: o.perfora ?? false,
    teledirigido: o.teledirigido ?? null,
    explota: o.explota,
    alImpactar: o.alImpactar,
    alExpirar: o.alExpirar,
    golpeados: new Set(o.ignorar ?? []),
    mesh,
    estela: 0,
  };
  proyectiles.push(p);
  return p;
}

function quitarProyectil(i: number) {
  proyectiles[i]!.mesh.removeFromParent();
  proyectiles.splice(i, 1);
}

function explotar(p: Proyectil, punto: THREE.Vector3) {
  const ex = p.explota!;
  const c = color(p.golpe.elemento);
  destello(punto, c, ex.radio, 0.35, 30 + ex.radio * 12);
  anillo(punto, c, ex.radio, 0.3);
  particulas(punto, c, 8 + Math.round(ex.radio * 5), 3 + ex.radio * 2, { tam: 0.1, aditivo: true });
  golpearArea(punto, ex.radio, { dano: ex.dano, elemento: p.golpe.elemento, empuje: ex.empuje, frio: ex.frio ?? p.golpe.frio });
  if (ex.radio >= 2.5) temblor(0.25, 0.03);
}

function moverProyectiles(dt: number) {
  for (let i = proyectiles.length - 1; i >= 0; i--) {
    const p = proyectiles[i]!;
    const obj = p.teledirigido;
    if (obj && !obj.muerto) {
      const quiero = centroDe(obj).sub(p.pos).setY(0).normalize().multiplyScalar(p.vel.length());
      p.vel.lerp(quiero, 1 - Math.exp(-9 * dt));
    }
    const avance = p.vel.length() * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.recorrido -= avance;
    const dir = p.vel.clone().setY(0).normalize();
    let fin = false;

    // Enemigos
    for (const e of [...enemigos]) {
      if (e.muerto || p.golpeados.has(e)) continue;
      const d = Math.hypot(e.body.position.x - p.pos.x, e.body.position.z - p.pos.z);
      if (d > e.radio + p.radio || p.pos.y > e.body.position.y + e.alto + 0.3) continue;
      p.golpeados.add(e);
      const punto = centroDe(e);
      golpearEnemigo(e, { ...p.golpe, punto, dir });
      p.alImpactar?.(punto, e, null, dir);
      if (p.explota && !p.perfora) explotar(p, punto);
      if (!p.perfora) {
        fin = true;
        break;
      }
    }
    // Objetos
    if (!fin) {
      for (const r of rompibles) {
        if (r.roto || p.golpeados.has(r)) continue;
        if (distanciaObjeto(r, p.pos) > p.radio) continue;
        p.golpeados.add(r);
        const punto = puntoCercano(r, p.pos);
        golpearObjeto(r, { ...p.golpe, punto, dir });
        p.alImpactar?.(punto, null, r, dir);
        if (p.rebotes > 0) {
          const n = p.pos.clone().sub(new THREE.Vector3(r.body.position.x, p.pos.y, r.body.position.z)).setY(0).normalize();
          p.vel.reflect(n);
          p.rebotes--;
          p.golpeados.clear();
          p.golpeados.add(r);
          break;
        }
        if (p.explota) explotar(p, punto);
        if (!p.perfora) fin = true;
        break;
      }
    }
    // Muros y pilares
    if (!fin) {
      const res = resolveCircle(arena, p.pos.x, p.pos.z, p.radio);
      if (res.hit) {
        if (p.rebotes > 0) {
          p.pos.x = res.x;
          p.pos.z = res.z;
          p.vel.reflect(new THREE.Vector3(res.nx, 0, res.nz));
          p.rebotes--;
          p.golpeados.clear();
          particulas(p.pos, color(p.golpe.elemento), 4, 2, { tam: 0.08, aditivo: true });
        } else {
          p.alImpactar?.(p.pos.clone(), null, null, dir);
          if (p.explota) explotar(p, p.pos.clone());
          else particulas(p.pos, color(p.golpe.elemento), 5, 2.5, { tam: 0.08, aditivo: true });
          fin = true;
        }
      }
    }
    if (!fin && p.recorrido <= 0) {
      p.alExpirar?.(p.pos.clone());
      if (p.explota) explotar(p, p.pos.clone());
      fin = true;
    }
    if (fin) {
      quitarProyectil(i);
      continue;
    }
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.x += dt * 9;
    p.mesh.rotation.y += dt * 7;
    p.estela -= dt;
    if (p.estela <= 0) {
      p.estela = 0.03;
      particulas(p.pos, color(p.golpe.elemento), 1, 0.4, { tam: p.mesh.scale.x * 0.6, gravedad: 0, aditivo: true, vida: 0.3 });
    }
  }
}

// ---------------------------------------------------------------- caídas (meteoritos)
interface Caida {
  mesh: THREE.Mesh;
  desde: THREE.Vector3;
  hasta: THREE.Vector3;
  t: number;
  max: number;
  alLlegar: () => void;
}
const caidas: Caida[] = [];
const matRoca = psxLambert({ map: textures.wall, color: 0x6a4a3a, emissive: 0x5a1a00 });
const matHieloMeteoro = psxLambert({ map: textures.grain, color: 0xa8e8ff, emissive: 0x0a3a6a });

function caer(hasta: THREE.Vector3, retardo: number, tam: number, mat: THREE.Material, alLlegar: () => void) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(tam, 0), mat);
  const desde = hasta.clone().add(new THREE.Vector3(-3, 16, -4));
  mesh.position.copy(desde);
  scene.add(mesh);
  caidas.push({ mesh, desde, hasta: hasta.clone(), t: 0, max: retardo, alLlegar });
}

// ---------------------------------------------------------------- centinelas
interface Centinela {
  pos: THREE.Vector3;
  grupo: THREE.Group;
  gema: THREE.Mesh;
  t: number;
  acum: number;
  cadencia: number;
  runa: string | null;
}
const centinelas: Centinela[] = [];
const matPiedraCentinela = psxLambert({ map: textures.wall, color: 0x9a90a8 });

function crearCentinela(pos: THREE.Vector3, runa: string | null, vida: number) {
  const grupo = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 1.3, 5), matPiedraCentinela);
  base.position.y = 0.65;
  const elem: Elemento = runa === 'igneo' ? 'fuego' : runa === 'gelido' ? 'hielo' : runa === 'tormenta' ? 'rayo' : 'arcano';
  const gema = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), matDe(color(elem)));
  gema.position.y = 1.8;
  grupo.add(base, gema);
  grupo.position.set(pos.x, 0, pos.z);
  scene.add(grupo);
  anillo(pos, color(elem), 1.6, 0.4);
  centinelas.push({ pos: pos.clone().setY(1.8), grupo, gema, t: vida, acum: 0, cadencia: runa === 'tormenta' ? 0.8 : 0.5, runa });
  while (centinelas.length > 3) quitarCentinela(0);
}

function quitarCentinela(i: number) {
  const c = centinelas[i]!;
  c.grupo.removeFromParent();
  c.grupo.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  particulas(c.pos, 0xa88aff, 10, 3, { tam: 0.1, aditivo: true });
  centinelas.splice(i, 1);
}

function actualizarCentinelas(dt: number) {
  for (let i = centinelas.length - 1; i >= 0; i--) {
    const c = centinelas[i]!;
    c.t -= dt;
    c.gema.rotation.y += dt * 3;
    c.gema.position.y = 1.8 + Math.sin(estado.tiempo * 3 + i) * 0.1;
    if (c.t <= 0) {
      quitarCentinela(i);
      continue;
    }
    c.acum += dt;
    if (c.acum < c.cadencia) continue;
    const obj = masCercano(c.pos, 12);
    if (!obj) continue;
    c.acum = 0;
    const destino = centroDe(obj);
    const dir = destino.clone().sub(c.pos).setY(0).normalize();
    switch (c.runa) {
      case 'igneo':
        disparar(c.pos, dir, { vel: 18, dano: 8, elemento: 'fuego', explota: { radio: 1.2, dano: 6, empuje: 1 } });
        break;
      case 'gelido':
        disparar(c.pos, dir, { vel: 22, dano: 8, elemento: 'hielo', frio: 25 });
        break;
      case 'tormenta':
        cadenaRayo(c.pos, obj, 3, 10);
        break;
      default:
        disparar(c.pos, dir, { vel: 24, dano: 10, elemento: 'arcano', teledirigido: obj });
    }
  }
}

// ---------------------------------------------------------------- rayo canalizado
const canal = { activo: false, tick: 0, n: 0 };
const TICK_RAYO = 0.1;

function pasoRayo(runa: string | null, dt: number, origen: THREE.Vector3, dir: THREE.Vector3) {
  const elem: Elemento = runa === 'prisma' ? 'fuego' : runa === 'glacial' ? 'hielo' : runa === 'tormenta' ? 'rayo' : 'arcano';
  const libre = distanciaLibre(origen, dir, 13);
  const objE = enemigosEnRayo(origen, dir, libre, 0.2);
  const objO = objetosEnRayo(origen, dir, libre);
  const impactos: ({ t: number; e: Enemigo } | { t: number; r: Rompible })[] = [...objE, ...objO].sort((a, b) => a.t - b.t);
  const taladro = runa === 'taladro';
  const alcanzados = taladro ? impactos : impactos.slice(0, 1);
  const largo = !taladro && alcanzados[0] ? alcanzados[0].t + 0.3 : libre;
  const fin = origen.clone().addScaledVector(dir, largo);
  mostrarHaz(origen, fin, color(elem), estado.tiempo);
  if (Math.random() < dt * 30) particulas(fin, color(elem), 1, 3, { tam: 0.09, aditivo: true, vida: 0.3 });

  canal.tick -= dt;
  if (canal.tick > 0) return;
  canal.tick += TICK_RAYO;
  canal.n++;
  for (const a of alcanzados) {
    if ('e' in a) {
      const punto = centroDe(a.e);
      golpearEnemigo(a.e, { dano: 5, elemento: elem, frio: elem === 'hielo' ? 9 : undefined, punto, dir });
      if (runa === 'tormenta' && canal.n % 3 === 0) cadenaRayo(punto, masCercano(punto, 6, new Set([a.e])), 1, 6);
    } else {
      golpearObjeto(a.r, { dano: 5, elemento: elem, punto: origen.clone().addScaledVector(dir, a.t), dir });
    }
  }
}

// ---------------------------------------------------------------- hechizos
type Implementacion = (l: Lanzamiento) => void;

function proyectilBasico(l: Lanzamiento, o: OpcionesProyectil, abanico = 0, n = 1) {
  for (let k = 0; k < n; k++) {
    const ang = n === 1 ? 0 : -abanico / 2 + (abanico * k) / (n - 1);
    disparar(l.origen, rotarY(l.dir, ang), o);
  }
}

const IMPL: Record<string, Implementacion> = {
  dardo(l) {
    switch (l.runa) {
      case 'tridente':
        return proyectilBasico(l, { vel: 26, dano: 10, elemento: 'arcano' }, 0.5, 3);
      case 'escarcha':
        return proyectilBasico(l, { vel: 26, dano: 12, elemento: 'hielo', frio: 35 });
      case 'buscador':
        return proyectilBasico(l, { vel: 20, dano: 16, elemento: 'arcano', teledirigido: masCercano(l.objetivo, 6), alcance: 30 });
      case 'chispa':
        return proyectilBasico(l, {
          vel: 28, dano: 12, elemento: 'rayo',
          alImpactar: (p, e) => {
            if (e) cadenaRayo(p, masCercano(p, 6, new Set([e])), 1, 9);
          },
        });
      default:
        return proyectilBasico(l, { vel: 26, dano: 14, elemento: 'arcano' });
    }
  },

  ascua(l) {
    const base: OpcionesProyectil = { vel: 20, dano: 12, elemento: 'fuego', explota: { radio: 1.4, dano: 8, empuje: 2 }, tam: 0.2 };
    switch (l.runa) {
      case 'rebote':
        return proyectilBasico(l, { ...base, rebotes: 3, alcance: 34, explota: undefined, radio: 0.22 });
      case 'magma':
        return proyectilBasico(l, {
          ...base,
          alImpactar: (p) => charcoFuego(p, 1.6, 3),
          alExpirar: (p) => charcoFuego(p, 1.6, 3),
        });
      case 'granizo':
        return proyectilBasico(l, {
          vel: 22, dano: 10, elemento: 'hielo', frio: 25, tam: 0.22,
          alImpactar: (p, e, r, d) => {
            for (let k = 0; k < 5; k++) {
              const dd = rotarY(d, -0.9 + (1.8 * k) / 4);
              disparar(p.clone().addScaledVector(dd, 0.3), dd, { vel: 16, dano: 6, elemento: 'hielo', frio: 15, alcance: 4, tam: 0.1, radio: 0.18, ignorar: [e ?? {}, r ?? {}] });
            }
          },
        });
      case 'pesada':
        return proyectilBasico(l, { vel: 13, dano: 16, elemento: 'fuego', empuje: 9, radio: 0.35, tam: 0.3, explota: { radio: 1.6, dano: 18, empuje: 9 } });
      default:
        return proyectilBasico(l, base);
    }
  },

  chispazo(l) {
    const yaw = Math.atan2(-l.dir.x, -l.dir.z);
    const conTarget = (radio: number, angulo: number) => enCono(l.origen, l.dir, radio, angulo);
    switch (l.runa) {
      case 'cadena': {
        const primero = conTarget(8, 0.9)[0]?.e ?? null;
        if (primero) cadenaRayo(l.origen, primero, 4, 10);
        else arco(l.origen, l.origen.clone().addScaledVector(l.dir, 5), 0xfff27a, 0.12);
        return;
      }
      case 'latigo': {
        sector(l.origen, yaw, 7, 1.1, color('fuego'), 0.3);
        for (let k = 0; k < 10; k++) particulas(l.origen.clone().addScaledVector(rotarY(l.dir, rand(-0.5, 0.5)), rand(1, 6.5)), 0xff8a2a, 1, 1.2, { tam: 0.16, aditivo: true, gravedad: 3, vida: 0.4 });
        for (const { e } of conTarget(7, 1.1).slice(0, 5)) golpearEnemigo(e, { dano: 8, elemento: 'fuego', punto: centroDe(e), dir: l.dir });
        for (const { r } of objetosEnCono(l.origen, l.dir, 7, 1.1).slice(0, 4)) golpearObjeto(r, { dano: 8, elemento: 'fuego', punto: puntoCercano(r, l.origen), dir: l.dir });
        return;
      }
      case 'descarga': {
        const e = conTarget(8, 0.45)[0]?.e;
        if (e) {
          arco(l.origen, centroDe(e), 0xffffff, 0.2, 10);
          arco(l.origen, centroDe(e), 0xfff27a, 0.25, 10);
          golpearEnemigo(e, { dano: 22, elemento: 'rayo', empuje: 7, punto: centroDe(e), dir: l.dir });
        } else {
          const r = objetosEnCono(l.origen, l.dir, 8, 0.45)[0]?.r;
          const fin = r ? puntoCercano(r, l.origen) : l.origen.clone().addScaledVector(l.dir, 6);
          arco(l.origen, fin, 0xfff27a, 0.2, 10);
          if (r) golpearObjeto(r, { dano: 22, elemento: 'rayo', empuje: 7, punto: fin, dir: l.dir });
        }
        return;
      }
      default: {
        const gelido = l.runa === 'gelido';
        const elem: Elemento = gelido ? 'hielo' : 'rayo';
        sector(l.origen, yaw, 7, 1.05, color(elem), 0.2);
        const objetivos = conTarget(7, 1.05).slice(0, 3);
        for (const { e } of objetivos) {
          arco(l.origen, centroDe(e), color(elem), 0.15);
          golpearEnemigo(e, { dano: gelido ? 7 : 9, elemento: elem, frio: gelido ? 35 : undefined, punto: centroDe(e), dir: l.dir });
        }
        for (const { r } of objetosEnCono(l.origen, l.dir, 7, 1.05).slice(0, 3 - Math.min(3, objetivos.length) + 1)) {
          const p = puntoCercano(r, l.origen);
          arco(l.origen, p, color(elem), 0.15);
          golpearObjeto(r, { dano: 9, elemento: elem, punto: p, dir: l.dir });
        }
        if (!objetivos.length) arco(l.origen, l.origen.clone().addScaledVector(rotarY(l.dir, rand(-0.4, 0.4)), 5), color(elem), 0.1);
        return;
      }
    }
  },

  // El rayo desintegrador es canalizado: se gestiona en `canalizar`.
  desintegrador() {},

  esfera(l) {
    const base: OpcionesProyectil = { vel: 13, dano: 20, elemento: 'fuego', radio: 0.45, tam: 0.42, explota: { radio: 3.2, dano: 40, empuje: 12 } };
    switch (l.runa) {
      case 'cometa':
        return proyectilBasico(l, { ...base, elemento: 'hielo', frio: 110, explota: { radio: 3.2, dano: 30, empuje: 6, frio: 110 } });
      case 'racimo':
        return proyectilBasico(l, {
          ...base,
          alImpactar: (p) => racimo(p),
          alExpirar: (p) => racimo(p),
        });
      case 'implosion':
        return proyectilBasico(l, {
          ...base, elemento: 'arcano', explota: undefined,
          alImpactar: (p) => implosion(p),
          alExpirar: (p) => implosion(p),
        });
      case 'plasma':
        return proyectilBasico(l, {
          ...base, elemento: 'rayo', explota: { radio: 3, dano: 34, empuje: 8 },
          alImpactar: (p) => plasma(p),
          alExpirar: (p) => plasma(p),
        });
      default:
        return proyectilBasico(l, base);
    }
  },

  lanza(l) {
    const base: OpcionesProyectil = { vel: 34, dano: 24, elemento: 'hielo', frio: 50, perfora: true, radio: 0.3, tam: 0.24, alcance: 20 };
    switch (l.runa) {
      case 'esquirlas':
        return proyectilBasico(l, {
          ...base, perfora: false,
          alImpactar: (p, e, r, d) => {
            for (let k = 0; k < 6; k++) {
              const dd = rotarY(d, -1 + (2 * k) / 5);
              disparar(p.clone().addScaledVector(dd, 0.3), dd, { vel: 20, dano: 8, elemento: 'hielo', frio: 20, alcance: 6, tam: 0.11, radio: 0.2, ignorar: [e ?? {}, r ?? {}] });
            }
          },
        });
      case 'caramba':
        return proyectilBasico(l, { ...base, elemento: 'fuerza', frio: undefined, empuje: 9, dano: 30, tam: 0.32, radio: 0.35 });
      case 'ignea':
        return proyectilBasico(l, { ...base, elemento: 'fuego', frio: undefined });
      case 'trueno':
        return proyectilBasico(l, {
          ...base, elemento: 'rayo', frio: undefined,
          alImpactar: (p, e) => {
            if (e) cadenaRayo(p, masCercano(p, 6, new Set([e])), 0, 10);
          },
        });
      default:
        return proyectilBasico(l, base);
    }
  },

  nova(l) {
    const c = mago.body.position;
    const centro = new THREE.Vector3(c.x, 0.9, c.z);
    const R = 5.5;
    const ver = (elem: Elemento) => {
      anillo(centro, color(elem), R, 0.45, 0.35);
      particulas(centro, color(elem), 30, 9, { tam: 0.12, aditivo: true, gravedad: 0 });
    };
    switch (l.runa) {
      case 'ignea':
        ver('fuego');
        golpearArea(centro, R, { dano: 25, elemento: 'fuego', empuje: 9 });
        return;
      case 'estatica':
        ver('rayo');
        for (const { e } of enemigosEnRadio(centro, R)) arco(centro, centroDe(e), 0xfff27a, 0.2);
        golpearArea(centro, R, { dano: 10, elemento: 'rayo', aturdir: 0.8 });
        return;
      case 'choque':
        ver('fuerza');
        golpearArea(centro, R, { dano: 20, elemento: 'fuerza', empuje: 18 }, { impulso: 18 });
        temblor(0.4, 0.05);
        return;
      case 'perpetua':
        ver('hielo');
        golpearArea(centro, R, { dano: 8, elemento: 'hielo', frio: 60 });
        crearZona({
          pos: centro, radio: 5, duracion: 6, color: 0x6ac8ff, opacidad: 0.22, intervalo: 0.25,
          alTick: (z) => {
            for (const { e } of enemigosEnRadio(z.pos, z.radio)) golpearEnemigo(e, { dano: 2, elemento: 'hielo', frio: 8, punto: centroDe(e), dir: new THREE.Vector3(0, 0, 1), sinInfusion: true });
          },
          alPaso: (z) => {
            if (Math.random() < 0.3) particulas(z.pos.clone().add(new THREE.Vector3(rand(-4, 4), 0.1, rand(-4, 4))), 0xc8f0ff, 1, 0.5, { tam: 0.08, gravedad: 0.5, aditivo: true, vida: 0.8 });
          },
        });
        return;
      default:
        ver('hielo');
        golpearArea(centro, R, { dano: 8, elemento: 'hielo', frio: 110 });
        return;
    }
  },

  parpadeo(l) {
    const p0 = new THREE.Vector3(mago.body.position.x, 0, mago.body.position.z);
    const quiero = Math.min(l.h.alcance ?? 9, p0.distanceTo(l.objetivo.clone().setY(0)));
    const dir = l.dir.clone();
    const libre = distanciaLibre(p0, dir, quiero, RADIO_MAGO);
    const destino = p0.clone().addScaledVector(dir, libre);
    const res = resolveCircle(arena, destino.x, destino.z, RADIO_MAGO);
    destino.set(res.x, 0, res.z);
    particulas(p0.clone().setY(1), 0xa88aff, 18, 4, { tam: 0.1, aditivo: true });
    mago.body.position.set(destino.x, 0.02, destino.z);
    mago.body.velocity.setZero();
    particulas(destino.clone().setY(1), 0xa88aff, 18, 4, { tam: 0.1, aditivo: true });
    anillo(destino, 0xa88aff, 1.5, 0.3);
    switch (l.runa) {
      case 'estela': {
        const pasos = Math.max(1, Math.round(libre / 1.3));
        for (let k = 0; k <= pasos; k++) charcoFuego(p0.clone().lerp(destino, k / pasos), 1, 3);
        return;
      }
      case 'gelida':
        anillo(p0, color('hielo'), 3, 0.4);
        particulas(p0.clone().setY(0.8), 0xc8f0ff, 20, 5, { tam: 0.1, aditivo: true });
        golpearArea(p0.clone().setY(0.9), 3, { dano: 6, elemento: 'hielo', frio: 110 });
        return;
      case 'sismica':
        anillo(destino, color('fuerza'), 3.5, 0.4, 0.4);
        particulas(destino.clone().setY(0.3), 0x8a8478, 20, 5, { tam: 0.16 });
        golpearArea(destino.clone().setY(0.9), 3.5, { dano: 15, elemento: 'fuerza', empuje: 12 }, { impulso: 12 });
        temblor(0.3, 0.04);
        return;
      default:
        return;
    }
  },

  onda(l) {
    const elem: Elemento = l.runa === 'ignea' ? 'fuego' : l.runa === 'glacial' ? 'hielo' : 'fuerza';
    const ejecutar = () => {
      const origen = new THREE.Vector3(mago.body.position.x, 0.9, mago.body.position.z);
      const dir = l.dir;
      const yaw = Math.atan2(-dir.x, -dir.z);
      const A = 1.75;
      const R = 7;
      sector(origen, yaw, R, A, color(elem), 0.3);
      for (let k = 0; k < 14; k++) {
        particulas(origen.clone().addScaledVector(rotarY(dir, rand(-A / 2, A / 2)), rand(1, 6)).setY(0.3), elem === 'fuerza' ? 0x8a8478 : color(elem), 1, 2, { tam: 0.15, dir, vida: 0.5 });
      }
      if (l.runa === 'atraccion') {
        for (const { e } of enCono(origen, dir, R, A)) {
          const hacia = origen.clone().sub(e.body.position as unknown as THREE.Vector3).setY(0).normalize();
          golpearEnemigo(e, { dano: 10, elemento: 'fuerza', punto: centroDe(e), dir: hacia });
          empujar(e, hacia, 10);
        }
        impulsoCono(origen, dir, R, A, 12, true);
        return;
      }
      const dano = elem === 'fuerza' ? 18 : elem === 'fuego' ? 16 : 12;
      const empuje = elem === 'fuerza' ? 15 : elem === 'fuego' ? 12 : 8;
      for (const { e } of enCono(origen, dir, R, A)) {
        const d = new THREE.Vector3(e.body.position.x - origen.x, 0, e.body.position.z - origen.z).normalize();
        golpearEnemigo(e, { dano, elemento: elem, empuje, frio: elem === 'hielo' ? 60 : undefined, punto: centroDe(e), dir: d.lerp(dir, 0.5).normalize() });
      }
      for (const { r } of objetosEnCono(origen, dir, R, A)) {
        golpearObjeto(r, { dano: dano + 6, elemento: elem, empuje, punto: puntoCercano(r, origen), dir });
      }
      impulsoCono(origen, dir, R, A, empuje);
      temblor(0.2, 0.02);
    };
    ejecutar();
    if (l.runa === 'eco') despues(0.45, ejecutar);
  },

  meteorito(l) {
    const p = l.objetivo.clone().setY(0);
    switch (l.runa) {
      case 'cometa':
        aviso(p, 3.5, color('hielo'), 0.9);
        caer(p, 0.9, 0.9, matHieloMeteoro, () => impactoMeteorito(p, 3.5, { dano: 50, elemento: 'hielo', empuje: 10, frio: 120 }, false));
        return;
      case 'lluvia':
        for (let k = 0; k < 4; k++) {
          const q = p.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
          const t = 0.6 + k * 0.25;
          aviso(q, 2, color('fuego'), t);
          caer(q, t, 0.45, matRoca, () => impactoMeteorito(q, 2, { dano: 25, elemento: 'fuego', empuje: 8 }, true, 1.2));
        }
        return;
      case 'trueno':
        aviso(p, 3.5, color('rayo'), 0.3);
        despues(0.3, () => {
          arco(p.clone().add(new THREE.Vector3(0, 14, 0)), p.clone().setY(0.2), 0xffffff, 0.3, 12);
          arco(p.clone().add(new THREE.Vector3(1, 14, -1)), p.clone().setY(0.2), 0xfff27a, 0.3, 12);
          impactoMeteorito(p, 3.5, { dano: 60, elemento: 'rayo', empuje: 10 }, false);
          cadenaRayo(p.clone().setY(1), null, 3, 15);
        });
        return;
      case 'gravedad':
        aviso(p, 6, color('arcano'), 0.9);
        crearZona({
          pos: p, radio: 6, duracion: 0.9, color: 0x6a4aff, opacidad: 0.15,
          alPaso: (z, dt) => tirar(z.pos, z.radio, 26, dt),
        });
        caer(p, 0.9, 0.9, matRoca, () => impactoMeteorito(p, 3.5, { dano: 70, elemento: 'fuego', empuje: 14 }, true));
        return;
      default:
        aviso(p, 3.5, color('fuego'), 0.9);
        caer(p, 0.9, 0.9, matRoca, () => impactoMeteorito(p, 3.5, { dano: 70, elemento: 'fuego', empuje: 14 }, true));
        return;
    }
  },

  centinela(l) {
    if (l.runa === 'gemelos') {
      const lado = new THREE.Vector3(-l.dir.z, 0, l.dir.x);
      crearCentinela(l.objetivo.clone().addScaledVector(lado, 1.2), null, 6);
      crearCentinela(l.objetivo.clone().addScaledVector(lado, -1.2), null, 6);
      return;
    }
    crearCentinela(l.objetivo, l.runa, 10);
  },

  ventisca(l) {
    const p = l.objetivo.clone().setY(0);
    const R = 4;
    switch (l.runa) {
      case 'electrica':
        crearZona({
          pos: p, radio: R, duracion: 5, color: 0x8a8a3a, opacidad: 0.2, intervalo: 0.25,
          alTick: (z) => {
            const dentro = enemigosEnRadio(z.pos, z.radio);
            const elegido = dentro[Math.floor(Math.random() * dentro.length)];
            const destino = elegido ? centroDe(elegido.e) : z.pos.clone().add(new THREE.Vector3(rand(-R, R) * 0.7, 0.1, rand(-R, R) * 0.7));
            arco(destino.clone().add(new THREE.Vector3(rand(-1, 1), 12, rand(-1, 1))), destino, 0xfff27a, 0.15, 10);
            if (elegido) golpearEnemigo(elegido.e, { dano: 18, elemento: 'rayo', punto: destino, dir: new THREE.Vector3(0, 0, 1) });
            else golpearArea(destino, 0.8, { dano: 10, elemento: 'rayo' });
          },
        });
        return;
      case 'ascuas':
        crearZona({
          pos: p, radio: R, duracion: 5, color: 0xff5a1a, opacidad: 0.22, intervalo: 0.3,
          alTick: (z) => golpearArea(z.pos, z.radio, { dano: 5, elemento: 'fuego' }, { caida: false }),
          alPaso: (z) => lluviaVisual(z, 0xff8a2a, 2),
        });
        return;
      case 'vortice':
        crearZona({
          pos: p, radio: R, duracion: 5, color: 0x6ac8ff, opacidad: 0.22, intervalo: 0.3,
          alTick: (z) => golpearArea(z.pos, z.radio, { dano: 5, elemento: 'hielo', frio: 12 }, { caida: false }),
          alPaso: (z, dt) => {
            lluviaVisual(z, 0xc8f0ff, 3);
            tirar(z.pos, z.radio + 1, 16, dt);
          },
        });
        return;
      case 'granizo':
        crearZona({
          pos: p, radio: R, duracion: 5, color: 0x9a9aa8, opacidad: 0.18, intervalo: 0.3,
          alTick: (z) => {
            const q = z.pos.clone().add(new THREE.Vector3(rand(-1, 1) * R * 0.75, 0.6, rand(-1, 1) * R * 0.75));
            particulas(q.clone().setY(3), 0xd8e8f0, 3, 1, { tam: 0.22, gravedad: -40, vida: 0.4 });
            despues(0.12, () => {
              particulas(q, 0xd8e8f0, 6, 3, { tam: 0.1 });
              golpearArea(q, 1.3, { dano: 12, elemento: 'fuerza', empuje: 5 }, { impulso: 5 });
            });
          },
        });
        return;
      default:
        crearZona({
          pos: p, radio: R, duracion: 5, color: 0x6ac8ff, opacidad: 0.22, intervalo: 0.3,
          alTick: (z) => golpearArea(z.pos, z.radio, { dano: 6, elemento: 'hielo', frio: 14 }, { caida: false }),
          alPaso: (z) => lluviaVisual(z, 0xc8f0ff, 3),
        });
        return;
    }
  },

  singularidad(l) {
    const p = l.objetivo.clone().setY(0);
    const R = 6;
    const elem: Elemento = l.runa === 'horizonte' ? 'hielo' : l.runa === 'estrella' ? 'fuego' : l.runa === 'estatica' ? 'rayo' : 'arcano';
    const nucleo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color: 0x08040f }));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 4, 20), matDe(color(elem)));
    nucleo.position.set(p.x, 1.4, p.z);
    halo.position.copy(nucleo.position);
    scene.add(nucleo, halo);
    crearZona({
      pos: p, radio: R, duracion: 3, color: elem === 'arcano' ? 0x4a2a8a : color(elem), opacidad: 0.2, intervalo: 0.25,
      alPaso: (z, dt) => {
        tirar(z.pos, z.radio, 22, dt, 30, 7);
        halo.rotation.x = estado.tiempo * 3;
        halo.rotation.y = estado.tiempo * 2;
        if (Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          particulas(p.clone().add(new THREE.Vector3(Math.cos(a) * R, 0.5, Math.sin(a) * R)), color(elem), 1, 0, {
            tam: 0.1, gravedad: 0, aditivo: true, vida: 0.6, dir: new THREE.Vector3(-Math.cos(a), 0.2, -Math.sin(a)).multiplyScalar(9),
          });
        }
      },
      alTick: (z) => {
        golpearArea(nucleo.position, 2.5, { dano: elem === 'fuego' ? 6 : elem === 'rayo' ? 4 : 5, elemento: elem, frio: elem === 'hielo' ? 12 : undefined }, { caida: false });
        if (elem === 'rayo' && Math.round(z.t * 4) % 2 === 0) {
          const dentro = enemigosEnRadio(z.pos, 3).map((x) => x.e);
          for (let k = 0; k + 1 < dentro.length && k < 4; k++) {
            arco(centroDe(dentro[k]!), centroDe(dentro[k + 1]!), 0xfff27a, 0.15);
            golpearEnemigo(dentro[k + 1]!, { dano: 6, elemento: 'rayo', punto: centroDe(dentro[k + 1]!), dir: new THREE.Vector3(0, 0, 1), soloEstado: true });
          }
        }
      },
      alQuitar: () => {
        nucleo.removeFromParent();
        halo.removeFromParent();
        nucleo.geometry.dispose();
        (nucleo.material as THREE.Material).dispose();
        halo.geometry.dispose();
      },
      alTerminar: () => {
        const c = p.clone().setY(1);
        if (l.runa === 'supernova') {
          destello(c, 0xffffff, R, 0.5, 90);
          anillo(c, 0xe8e0d0, R * 1.2, 0.5, 0.4);
          golpearArea(c, R, { dano: 40, elemento: 'fuerza', empuje: 20 }, { impulso: 20 });
          temblor(0.6, 0.08);
        } else if (l.runa === 'horizonte') {
          anillo(c, color('hielo'), R, 0.4);
          golpearArea(c, R, { dano: 10, elemento: 'hielo', frio: 120 });
        } else {
          destello(c, color(elem), 1.5, 0.3, 30);
        }
      },
    });
  },

  infusion(l) {
    const inf = mago.infusion;
    inf.t = 8;
    inf.prisma = l.runa === 'prisma';
    inf.elemento = l.runa === 'ignea' ? 'fuego' : l.runa === 'gelida' ? 'hielo' : l.runa === 'estatica' ? 'rayo' : 'arcano';
    inf.indice = 0;
    const c = new THREE.Vector3(mago.body.position.x, 1, mago.body.position.z);
    const col = inf.prisma ? 0xffffff : color(inf.elemento);
    anillo(c, col, 2.2, 0.5, 0.4);
    particulas(c, col, 26, 4, { tam: 0.1, aditivo: true, gravedad: 4 });
  },
};

// ---------------------------------------------------------------- piezas compartidas
function charcoFuego(p: THREE.Vector3, radio: number, duracion: number) {
  crearZona({
    pos: p.clone().setY(0), radio, duracion, color: 0xff5a1a, opacidad: 0.35, intervalo: 0.3,
    alTick: (z) => golpearArea(z.pos.clone().setY(0.6), z.radio, { dano: 4, elemento: 'fuego', sinInfusion: true }, { caida: false }),
    alPaso: (z) => {
      if (Math.random() < 0.4) particulas(z.pos.clone().add(new THREE.Vector3(rand(-1, 1) * z.radio * 0.7, 0.1, rand(-1, 1) * z.radio * 0.7)), 0xff8a2a, 1, 1, { tam: 0.12, gravedad: 3, aditivo: true, vida: 0.5 });
    },
  });
}

function lluviaVisual(z: Zona, col: number, n: number) {
  for (let k = 0; k < n; k++) {
    if (Math.random() > 0.5) continue;
    const q = z.pos.clone().add(new THREE.Vector3(rand(-1, 1) * z.radio * 0.8, 4, rand(-1, 1) * z.radio * 0.8));
    particulas(q, col, 1, 0, { tam: 0.1, gravedad: -30, aditivo: true, vida: 0.4, dir: new THREE.Vector3(1, -1, 0.5) });
  }
}

/** Atracción continua de enemigos, objetos y escombros. */
function tirar(centro: THREE.Vector3, radio: number, fuerza: number, dt: number, fuerzaCuerpos = fuerza, elevar = 0) {
  for (const { e } of enemigosEnRadio(centro, radio)) atraer(e, centro, fuerza, dt);
  atraerCuerpos(centro, radio, fuerzaCuerpos, dt, elevar);
}

function racimo(p: THREE.Vector3) {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    disparar(p.clone().setY(1).addScaledVector(d, 0.6), d, { vel: 8, dano: 6, elemento: 'fuego', alcance: rand(2, 3.5), tam: 0.15, explota: { radio: 1.5, dano: 15, empuje: 4 } });
  }
}

function implosion(p: THREE.Vector3) {
  const c = p.clone().setY(1);
  anillo(c, color('arcano'), 4.5, 1, 0.15);
  crearZona({
    pos: c, radio: 4.5, duracion: 1, color: 0x4a2a8a, opacidad: 0.25,
    alPaso: (z, dt) => tirar(z.pos, z.radio, 30, dt, 40, 3),
    alTerminar: () => {
      destello(c, color('arcano'), 3.2, 0.4, 60);
      golpearArea(c, 3.2, { dano: 40, elemento: 'arcano', empuje: 8 });
      temblor(0.35, 0.05);
    },
  });
}

function plasma(p: THREE.Vector3) {
  const c = p.clone().setY(1);
  const tocados = new Set<Enemigo>();
  for (let k = 0; k < 3; k++) {
    const e = masCercano(c, 7, tocados);
    if (!e) break;
    tocados.add(e);
    arco(c, centroDe(e), 0xfff27a, 0.25, 10);
    golpearEnemigo(e, { dano: 14, elemento: 'rayo', punto: centroDe(e), dir: centroDe(e).sub(c).setY(0).normalize() });
  }
}

function impactoMeteorito(p: THREE.Vector3, radio: number, g: Omit<GolpeBase, 'punto' | 'dir'>, charco: boolean, charcoRadio = 2.5) {
  const c = p.clone().setY(0.8);
  const col = color(g.elemento);
  destello(c, col, radio, 0.5, 80);
  anillo(p, col, radio * 1.2, 0.5, 0.4);
  particulas(c, col, 24, 9, { tam: 0.14, aditivo: true });
  particulas(c, 0x5a4a40, 18, 7, { tam: 0.2, gravedad: -14 });
  golpearArea(c, radio, g, { impulso: g.empuje });
  temblor(0.5, 0.06);
  if (charco) charcoFuego(p, charcoRadio, 3);
}

// ---------------------------------------------------------------- interfaz pública
export interface ResultadoLanzar {
  ok: boolean;
  motivo?: 'cd' | 'mana' | 'muerto';
}

/** Lanza el hechizo de una ranura hacia un punto del suelo. */
export function lanzar(build: Build, ranura: number, objetivo: THREE.Vector3): ResultadoLanzar {
  const slot = build[ranura];
  if (!slot || !RANURAS[ranura]) return { ok: false };
  if (mago.muerto > 0) return { ok: false, motivo: 'muerto' };
  const h = hechizo(slot.hechizo);
  if (h.canalizado) return { ok: false };
  const dobles = h.id === 'parpadeo' && slot.runa === 'doble';
  if (dobles) {
    if (mago.cargas <= 0 || (mago.cd.get(h.id) ?? 0) > 0) return { ok: false, motivo: 'cd' };
  } else if ((mago.cd.get(h.id) ?? 0) > 0) return { ok: false, motivo: 'cd' };
  if (h.coste > 0 && mago.mana < h.coste) return { ok: false, motivo: 'mana' };

  const p = mago.body.position;
  const dir = new THREE.Vector3(objetivo.x - p.x, 0, objetivo.z - p.z);
  if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(mago.yaw), 0, -Math.cos(mago.yaw));
  dir.normalize();
  const origen = new THREE.Vector3(p.x, 1.15, p.z).addScaledVector(dir, 0.55);
  let obj = objetivo.clone().setY(0);
  if (h.alcance) {
    const d = Math.hypot(obj.x - p.x, obj.z - p.z);
    if (d > h.alcance) obj = new THREE.Vector3(p.x, 0, p.z).addScaledVector(dir, h.alcance);
  }

  if (h.coste > 0) mago.mana -= h.coste;
  else mago.mana = Math.min(mago.manaMax, mago.mana - h.coste);
  if (dobles) {
    mago.cargas--;
    if (mago.recargaCarga <= 0) mago.recargaCarga = h.cd;
    mago.cd.set(h.id, 0.35);
  } else mago.cd.set(h.id, h.cd);
  mago.yaw = Math.atan2(-dir.x, -dir.z);
  triggerAttack(mago.model, 'cast', 0.28);
  IMPL[h.id]!({ h, runa: slot.runa, origen, dir, objetivo: obj });
  // El prisma de la Infusión cambia de elemento con cada hechizo lanzado.
  if (mago.infusion.t > 0 && mago.infusion.prisma && h.id !== 'infusion') mago.infusion.indice++;
  return { ok: true };
}

/** Mantiene (o corta) el rayo desintegrador de una ranura. */
export function canalizar(build: Build, ranura: number | null, objetivo: THREE.Vector3, dt: number) {
  const slot = ranura === null ? null : build[ranura];
  const h = slot ? hechizo(slot.hechizo) : null;
  if (!slot || !h?.canalizado || mago.muerto > 0 || mago.mana <= 0) {
    if (canal.activo) {
      canal.activo = false;
      ocultarHaz();
    }
    return;
  }
  if (!canal.activo) {
    canal.activo = true;
    canal.tick = 0;
    if (mago.mana < 5) {
      canal.activo = false;
      return;
    }
  }
  mago.mana = Math.max(0, mago.mana - h.coste * dt);
  const p = mago.body.position;
  const dir = new THREE.Vector3(objetivo.x - p.x, 0, objetivo.z - p.z);
  if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(mago.yaw), 0, -Math.cos(mago.yaw));
  dir.normalize();
  mago.yaw = Math.atan2(-dir.x, -dir.z);
  mago.model.attackStyle = 'cast';
  mago.model.attackDur = 0.3;
  mago.model.attackT = 0.15;
  const origen = new THREE.Vector3(p.x, 1.15, p.z).addScaledVector(dir, 0.55);
  pasoRayo(slot.runa, dt, origen, dir);
}

export function canalizando() {
  return canal.activo;
}

export function actualizarHechizos(dt: number) {
  for (const [id, t] of mago.cd) mago.cd.set(id, Math.max(0, t - dt));
  if (mago.recargaCarga > 0) {
    mago.recargaCarga -= dt;
    if (mago.recargaCarga <= 0) {
      mago.cargas = Math.min(2, mago.cargas + 1);
      if (mago.cargas < 2) mago.recargaCarga = hechizo('parpadeo').cd;
    }
  }
  if (mago.infusion.t > 0) mago.infusion.t = Math.max(0, mago.infusion.t - dt);
  if (!canal.activo) mago.mana = Math.min(mago.manaMax, mago.mana + 8 * dt);

  for (let i = retrasos.length - 1; i >= 0; i--) {
    const r = retrasos[i]!;
    r.t -= dt;
    if (r.t <= 0) {
      retrasos.splice(i, 1);
      r.fn();
    }
  }
  for (let i = caidas.length - 1; i >= 0; i--) {
    const c = caidas[i]!;
    c.t += dt;
    const k = Math.min(1, c.t / c.max);
    c.mesh.position.lerpVectors(c.desde, c.hasta, k * k);
    c.mesh.rotation.x += dt * 5;
    c.mesh.rotation.z += dt * 3;
    if (Math.random() < 0.6) particulas(c.mesh.position, 0xff8a2a, 1, 0.5, { tam: 0.25, gravedad: 0, aditivo: true, vida: 0.4 });
    if (k >= 1) {
      c.mesh.removeFromParent();
      c.mesh.geometry.dispose();
      caidas.splice(i, 1);
      c.alLlegar();
    }
  }
  moverProyectiles(dt);
  actualizarCentinelas(dt);
}

export function limpiarHechizos() {
  while (proyectiles.length) quitarProyectil(proyectiles.length - 1);
  while (centinelas.length) quitarCentinela(centinelas.length - 1);
  for (const c of caidas) {
    c.mesh.removeFromParent();
    c.mesh.geometry.dispose();
  }
  caidas.length = 0;
  retrasos.length = 0;
  canal.activo = false;
  ocultarHaz();
  mago.cd.clear();
  mago.cargas = 2;
  mago.recargaCarga = 0;
  mago.infusion.t = 0;
}

export function cuentaHechizos() {
  return { proyectiles: proyectiles.length, centinelas: centinelas.length };
}

/** Para mostrar números al fallar un lanzamiento (sin maná...). */
export function avisoFallo(motivo: ResultadoLanzar['motivo']) {
  if (motivo !== 'mana') return;
  const p = new THREE.Vector3(mago.body.position.x, 1.2, mago.body.position.z);
  numero(p, 'Sin maná', '#7aa8ff');
}

