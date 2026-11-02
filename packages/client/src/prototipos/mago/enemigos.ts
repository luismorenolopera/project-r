import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Kind, dirToYaw } from '@mazmorra/shared';
import { animateModel, buildModel, disposeModel, triggerAttack, type Model } from '../../render/models';
import { psxLambert } from '../../render/psx';
import { duros, estado, mago, mPersonaje, ragdolls, rand, rnd, scene, temblor, v3, world } from './mundo';
import { arco, numero, particulas } from './efectos';
import { danarObjeto, estallarHielo, rompibleDe } from './objetos';
import { avanzarEstados, estadosNuevos, factorVelocidad, type ComboId, type Estados } from './reacciones';
import type { Elemento } from './grimorio';

/**
 * Enemigos del sandbox del mago: esqueletos, brutos y muñecos de entrenamiento.
 * Las físicas los mueven cuando salen despedidos (como en el prototipo de embestida);
 * el resto del tiempo caminan hacia el mago si la persecución está activada.
 */

export type TipoEnemigo = 'esqueleto' | 'bruto' | 'muneco';

const DEFS: Record<TipoEnemigo, { kind: Kind; radio: number; alto: number; masa: number; hp: number; vel: number; dano: number }> = {
  esqueleto: { kind: Kind.Esqueleto, radio: 0.38, alto: 1.8, masa: 60, hp: 90, vel: 2.4, dano: 10 },
  bruto: { kind: Kind.Bruto, radio: 0.62, alto: 2.5, masa: 260, hp: 380, vel: 1.5, dano: 22 },
  muneco: { kind: Kind.Muneco, radio: 0.42, alto: 1.8, masa: 0, hp: 1e9, vel: 0, dano: 0 },
};

export interface Enemigo {
  tipo: TipoEnemigo;
  body: CANNON.Body;
  model: Model;
  radio: number;
  alto: number;
  masa: number;
  hp: number;
  hpMax: number;
  est: Estados;
  empujadoT: number;
  yaw: number;
  muerto: boolean;
  ataqueT: number;
  ataqueCd: number;
  /** Daño recibido en los últimos segundos (DPS del muñeco). */
  registro: { t: number; dano: number }[];
  vis: {
    barra: THREE.Group;
    relleno: THREE.Sprite;
    hielo: THREE.Mesh;
    frio: THREE.Mesh;
    marca: THREE.Mesh;
    estrellas: THREE.Group;
  };
}

export const enemigos: Enemigo[] = [];
export const enemigoDe = new Map<CANNON.Body, Enemigo>();

/** Ganchos que rellena el módulo de combate. */
export const ganchosEnemigos = {
  combo: (_id: ComboId, _pos: THREE.Vector3) => {},
  muerte: (_e: Enemigo) => {},
};

export const estadisticasEnemigos = { muertos: 0, aturdidos: 0 };

// ---------------------------------------------------------------- visuales compartidos
const geoAnillo = new THREE.RingGeometry(0.75, 1, 20);
const matHielo = psxLambert({ color: 0xa8e8ff, emissive: 0x0a3a5a, transparent: true, opacity: 0.55, depthWrite: false });
const matEstrella = new THREE.MeshBasicMaterial({ color: 0xffe04a });
const texBarra = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
})();

function crearVisuales(radio: number, alto: number) {
  const barra = new THREE.Group();
  const fondo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBarra, color: 0x1a0a0a, depthTest: false }));
  fondo.center.set(0, 0.5);
  fondo.scale.set(1.04, 0.13, 1);
  fondo.position.x = -0.02;
  const relleno = new THREE.Sprite(new THREE.SpriteMaterial({ map: texBarra, color: 0xc8321e, depthTest: false }));
  relleno.center.set(0, 0.5);
  relleno.scale.set(1, 0.09, 1);
  fondo.renderOrder = 10;
  relleno.renderOrder = 11;
  barra.add(fondo, relleno);
  barra.visible = false;
  scene.add(barra);

  const hielo = new THREE.Mesh(new THREE.BoxGeometry(radio * 2.4, alto * 1.06, radio * 2.4), matHielo);
  hielo.visible = false;
  scene.add(hielo);

  const frio = new THREE.Mesh(geoAnillo, new THREE.MeshBasicMaterial({ color: 0x8adfff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  frio.rotation.x = -Math.PI / 2;
  frio.scale.setScalar(radio * 1.6);
  scene.add(frio);

  const marca = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0xa88aff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  marca.rotation.x = -Math.PI / 2;
  marca.scale.setScalar(radio * 2.1);
  marca.visible = false;
  scene.add(marca);

  const estrellas = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), matEstrella);
    const a = (i / 4) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
    estrellas.add(s);
  }
  estrellas.visible = false;
  scene.add(estrellas);
  return { barra, relleno, hielo, frio, marca, estrellas };
}

function quitarVisuales(e: Enemigo) {
  const v = e.vis;
  v.barra.removeFromParent();
  v.hielo.removeFromParent();
  v.hielo.geometry.dispose();
  v.frio.removeFromParent();
  (v.frio.material as THREE.Material).dispose();
  v.marca.removeFromParent();
  v.marca.geometry.dispose();
  (v.marca.material as THREE.Material).dispose();
  v.estrellas.removeFromParent();
}

// ---------------------------------------------------------------- creación
const colisiones: { e: Enemigo; otro: CANNON.Body; punto: THREE.Vector3; vel: number }[] = [];

export function crearEnemigo(tipo: TipoEnemigo, x: number, z: number) {
  const d = DEFS[tipo];
  const estatico = d.masa === 0;
  const body = new CANNON.Body({ mass: d.masa, material: mPersonaje, fixedRotation: true, type: estatico ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC });
  body.addShape(new CANNON.Sphere(d.radio), new CANNON.Vec3(0, d.radio, 0));
  body.addShape(new CANNON.Sphere(d.radio), new CANNON.Vec3(0, d.alto - d.radio, 0));
  body.position.set(x, estatico ? 0 : 0.02, z);
  body.sleepSpeedLimit = 0.05;
  world.addBody(body);
  const model = buildModel(d.kind);
  scene.add(model.root);
  const e: Enemigo = {
    tipo, body, model, radio: d.radio, alto: d.alto, masa: d.masa, hp: d.hp, hpMax: d.hp, est: estadosNuevos(),
    empujadoT: 0, yaw: dirToYaw(mago.body.position.x - x, mago.body.position.z - z), muerto: false, ataqueT: 0, ataqueCd: 0,
    registro: [], vis: crearVisuales(d.radio, d.alto),
  };
  enemigos.push(e);
  enemigoDe.set(body, e);
  body.addEventListener('collide', (ev: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    if (e.empujadoT <= 0 || e.muerto) return;
    const c = ev.contact;
    const punto = new THREE.Vector3(c.bi.position.x + c.ri.x, c.bi.position.y + c.ri.y, c.bi.position.z + c.ri.z);
    colisiones.push({ e, otro: ev.body, punto, vel: Math.hypot(body.velocity.x, body.velocity.z) });
  });
  return e;
}

/** Despide a un enemigo en una dirección. La velocidad final depende de su masa. */
export function empujar(e: Enemigo, dir: THREE.Vector3, v: number) {
  if (e.masa === 0 || e.muerto || v <= 0) return;
  const k = Math.sqrt(60 / e.masa);
  const vel = v * k;
  e.body.wakeUp();
  e.body.velocity.set(dir.x * vel, Math.min(6, 2.5 + vel * 0.12) * k, dir.z * vel);
  e.empujadoT = 0.9;
}

/** Atracción continua hacia un punto (singularidad, vórtice...). */
export function atraer(e: Enemigo, centro: THREE.Vector3, fuerza: number, dt: number) {
  if (e.masa === 0 || e.muerto) return;
  const dx = centro.x - e.body.position.x;
  const dz = centro.z - e.body.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return;
  const k = Math.sqrt(60 / e.masa);
  e.body.wakeUp();
  e.body.velocity.x += (dx / d) * fuerza * k * dt;
  e.body.velocity.z += (dz / d) * fuerza * k * dt;
  e.empujadoT = Math.max(e.empujadoT, 0.15);
}

/**
 * Resta vida. Devuelve true si el golpe lo mata.
 * Un enemigo congelado (o roto por Hacer añicos) estalla en trozos de hielo en vez de caer.
 */
export function herir(e: Enemigo, dano: number, dir: THREE.Vector3, anicos = false): boolean {
  if (e.muerto) return false;
  e.model.hurtT = 0.18;
  e.registro.push({ t: estado.tiempo, dano });
  if (e.tipo === 'muneco') return false;
  e.hp -= dano;
  if (e.hp > 0) return false;
  matar(e, dir, anicos || e.est.congelado > 0);
  return true;
}

function matar(e: Enemigo, dir: THREE.Vector3, hielo: boolean) {
  e.muerto = true;
  estadisticasEnemigos.muertos++;
  const p = v3(e.body.position);
  if (hielo) {
    estallarHielo(p, e.alto, e.radio, dir, 9);
    temblor(0.25, 0.04);
  } else {
    e.model.root.position.copy(p);
    e.model.root.rotation.y = e.yaw;
    ragdolls.spawnRagdoll(e.model, { x: dir.x, z: dir.z }, 6, e.est.quemado > 0 ? 0x3a2a2a : undefined);
  }
  ganchosEnemigos.muerte(e);
  quitar(e);
}

function quitar(e: Enemigo) {
  world.removeBody(e.body);
  enemigoDe.delete(e.body);
  disposeModel(e.model);
  quitarVisuales(e);
  const i = enemigos.indexOf(e);
  if (i >= 0) enemigos.splice(i, 1);
}

export function limpiarEnemigos() {
  while (enemigos.length) quitar(enemigos[enemigos.length - 1]!);
  estadisticasEnemigos.muertos = estadisticasEnemigos.aturdidos = 0;
}

// ---------------------------------------------------------------- consultas
export function vivos() {
  return enemigos.filter((e) => !e.muerto);
}

export function centroDe(e: Enemigo) {
  return new THREE.Vector3(e.body.position.x, e.body.position.y + e.alto * 0.55, e.body.position.z);
}

export function enemigosEnRadio(c: THREE.Vector3, radio: number) {
  const res: { e: Enemigo; d: number }[] = [];
  for (const e of enemigos) {
    if (e.muerto) continue;
    const d = Math.hypot(e.body.position.x - c.x, e.body.position.z - c.z) - e.radio;
    if (d <= radio) res.push({ e, d: Math.max(0, d) });
  }
  return res;
}

export function masCercano(p: THREE.Vector3, max: number, excluir?: Set<Enemigo>) {
  let mejor: Enemigo | null = null;
  let md = max;
  for (const e of enemigos) {
    if (e.muerto || excluir?.has(e)) continue;
    const d = Math.hypot(e.body.position.x - p.x, e.body.position.z - p.z);
    if (d < md) {
      md = d;
      mejor = e;
    }
  }
  return mejor;
}

/** Enemigos que cruza un rayo horizontal, ordenados por distancia. */
export function enemigosEnRayo(o: THREE.Vector3, dir: THREE.Vector3, largo: number, ancho = 0.25) {
  const res: { e: Enemigo; t: number }[] = [];
  for (const e of enemigos) {
    if (e.muerto) continue;
    const dx = e.body.position.x - o.x;
    const dz = e.body.position.z - o.z;
    const t = dx * dir.x + dz * dir.z;
    if (t < 0 || t > largo + e.radio) continue;
    const perp = Math.abs(dx * dir.z - dz * dir.x);
    if (perp < e.radio + ancho) res.push({ e, t: Math.max(0, t - e.radio) });
  }
  return res.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- actualización
export function procesarColisiones() {
  for (const c of colisiones) {
    const e = c.e;
    if (e.muerto || e.empujadoT <= 0) continue;
    if (duros.has(c.otro) && c.vel > 4.5) {
      e.empujadoT = 0;
      e.est.aturdido = Math.max(e.est.aturdido, 2);
      estadisticasEnemigos.aturdidos++;
      particulas(c.punto, 0x8a8478, 12, 4, { tam: 0.15 });
      temblor(0.3, 0.05);
      ganchosEnemigos.combo('impacto_muro', centroDe(e));
      const dano = Math.round(10 + c.vel * 2);
      herir(e, dano, new THREE.Vector3(-e.body.velocity.x, 0, -e.body.velocity.z).normalize());
      numero(centroDe(e), String(dano), '#e8e0d0');
    }
    const r = rompibleDe.get(c.otro);
    if (r && c.vel > 3.2) {
      const dir = new THREE.Vector3(e.body.velocity.x, 0, e.body.velocity.z).normalize();
      danarObjeto(r, { dano: 12 + c.vel * 4, elemento: 'fuerza', punto: c.punto, dir, empuje: c.vel * 0.5 });
    }
    const o = enemigoDe.get(c.otro);
    if (o && o.empujadoT <= 0 && c.vel > 3 && o.masa > 0) {
      const dir = new THREE.Vector3(o.body.position.x - e.body.position.x, 0, o.body.position.z - e.body.position.z).normalize();
      empujar(o, dir, c.vel * 0.7);
    }
  }
  colisiones.length = 0;
}

/** Estados, IA y ataques cuerpo a cuerpo. Devuelve el daño de quemadura de cada enemigo para el combate. */
export function actualizarEnemigos(dt: number, alQuemar: (e: Enemigo, dano: number) => void, alAtacar: (e: Enemigo, dano: number) => void) {
  const mp = mago.body.position;
  for (const e of [...enemigos]) {
    if (e.muerto) continue;
    const q = avanzarEstados(e.est, dt);
    if (q > 0) alQuemar(e, q);
    if (e.muerto) continue;
    const b = e.body;
    if (e.masa === 0) continue;
    if (e.empujadoT > 0) {
      e.empujadoT -= dt;
      const enSuelo = b.position.y < 0.15;
      const f = Math.exp(-(enSuelo ? 4.5 : 0.6) * dt);
      b.velocity.x *= f;
      b.velocity.z *= f;
      continue;
    }
    const lento = factorVelocidad(e.est);
    const dx = mp.x - b.position.x;
    const dz = mp.z - b.position.z;
    const d = Math.hypot(dx, dz);
    const def = DEFS[e.tipo];
    let quiere = 0;
    if (estado.persiguen && mago.muerto <= 0 && lento > 0) {
      if (d > e.radio + 0.9 && e.ataqueT <= 0) quiere = def.vel * lento;
      e.yaw = dirToYaw(dx, dz);
      // Ataque: preparación visible y golpe si el mago sigue cerca.
      e.ataqueCd -= dt;
      if (e.ataqueT > 0) {
        e.ataqueT -= dt * lento;
        if (e.ataqueT <= 0) {
          triggerAttack(e.model, 'swing', 0.3);
          if (d < e.radio + 1.4) alAtacar(e, def.dano);
          e.ataqueCd = 1.2;
        }
      } else if (d < e.radio + 1.1 && e.ataqueCd <= 0) {
        e.ataqueT = e.tipo === 'bruto' ? 0.9 : 0.6;
      }
    } else {
      e.ataqueT = 0;
    }
    const a = 1 - Math.exp(-6 * dt);
    b.velocity.x += ((d > 0 ? dx / d : 0) * quiere - b.velocity.x) * a;
    b.velocity.z += ((d > 0 ? dz / d : 0) * quiere - b.velocity.z) * a;
    if (quiere > 0) b.wakeUp();
  }
}

const _cam = new THREE.Vector3();
export function sincronizarEnemigos(dt: number) {
  const t = estado.tiempo;
  for (const e of enemigos) {
    const p = e.body.position;
    const est = e.est;
    const congelado = est.congelado > 0;
    e.model.root.position.set(p.x, p.y, p.z);
    e.model.root.rotation.y = e.yaw;
    const vx = e.body.velocity.x;
    const vz = e.body.velocity.z;
    const tilt = e.empujadoT > 0 ? Math.min(0.5, Math.hypot(vx, vz) * 0.04) : 0;
    e.model.root.rotation.x = THREE.MathUtils.lerp(e.model.root.rotation.x, -tilt, 0.2);
    animateModel(e.model, {
      dt: congelado ? 0 : dt * (est.frio > 0 ? factorVelocidad(est) : 1),
      speed: e.empujadoT > 0 ? 0 : Math.hypot(vx, vz),
      airborne: p.y > 0.2,
      stunned: est.aturdido > 0,
      windup: e.ataqueT > 0 ? 1 : 0,
      spinning: false,
      guarding: false,
      time: t,
    });

    const v = e.vis;
    const herido = e.tipo !== 'muneco' && e.hp < e.hpMax;
    v.barra.visible = herido;
    if (herido) {
      v.barra.position.set(p.x - 0.5, p.y + e.alto + 0.45, p.z);
      v.relleno.scale.x = Math.max(0.001, e.hp / e.hpMax);
      (v.relleno.material as THREE.SpriteMaterial).color.setHex(est.congelado > 0 ? 0x8adfff : est.quemado > 0 ? 0xff7a1a : 0xc8321e);
    }
    v.hielo.visible = congelado;
    if (congelado) v.hielo.position.set(p.x, p.y + e.alto * 0.52, p.z);
    (v.frio.material as THREE.MeshBasicMaterial).opacity = congelado ? 0.9 : Math.min(0.8, est.frio / 100);
    v.frio.position.set(p.x, 0.05, p.z);
    v.marca.visible = est.marca > 0;
    if (v.marca.visible) {
      v.marca.position.set(p.x, 0.07, p.z);
      v.marca.rotation.z = t * 2;
    }
    v.estrellas.visible = est.aturdido > 0;
    if (v.estrellas.visible) {
      v.estrellas.position.set(p.x, p.y + e.alto + 0.25, p.z);
      v.estrellas.rotation.y = t * 5;
    }

    // Partículas de estado.
    const c = _cam.set(p.x, p.y + e.alto * 0.5, p.z);
    if (est.quemado > 0 && rnd() < dt * 22) particulas(c, rnd() < 0.5 ? 0xff7a1a : 0xffc04a, 1, 1.2, { tam: 0.13, gravedad: 3.5, aditivo: true, dispersion: e.radio, vida: 0.55 });
    if (est.empapado > 0 && rnd() < dt * 10) particulas(c, 0x4a8ad8, 1, 0.4, { tam: 0.07, gravedad: -12, dispersion: e.radio, vida: 0.5 });
    if (est.electrizado > 0 && rnd() < dt * 6) {
      const a = c.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.8, 0.8), rand(-1, 1)).multiplyScalar(e.radio * 1.3));
      const b = c.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.8, 0.8), rand(-1, 1)).multiplyScalar(e.radio * 1.3));
      arco(a, b, 0xfff27a, 0.08, 3);
    }
  }
}

/** DPS del muñeco: daño de los últimos 4 segundos. */
export function dpsDe(e: Enemigo) {
  const desde = estado.tiempo - 4;
  e.registro = e.registro.filter((x) => x.t >= desde);
  if (e.registro.length === 0) return 0;
  const total = e.registro.reduce((s, x) => s + x.dano, 0);
  const span = Math.max(1, estado.tiempo - e.registro[0]!.t);
  return total / span;
}

export type { Elemento };
