import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ClassId, Kind, dirToYaw } from '@mazmorra/shared';
import { animateModel, buildModel, disposeModel } from '../../render/models';
import { updateBraziers } from '../../render/scene';
import './alquimista.css';
import {
  PASO, ajustarTamano, arena, camera, canvas, estado, luzMago, mago, post, ragdolls, rand, reiniciarAzar, renderer, scene, vistaArena, world,
} from '../mago/mundo';
import { actualizarEfectos, actualizarNumeros, cuentaParticulas, limpiarEfectos, numero } from '../mago/efectos';
import { actualizarObjetos, crearMuroLadrillos, crearRompible, estadisticasObjetos, limpiarObjetos, rompibles, sincronizarObjetos, trozos } from '../mago/objetos';
import {
  actualizarEnemigos, centroDe, crearEnemigo, dpsDe, enemigos, estadisticasEnemigos, herir, limpiarEnemigos, procesarColisiones, sincronizarEnemigos,
  type Enemigo, type TipoEnemigo,
} from '../mago/enemigos';
import { actualizarZonas, contadorCombos, danarMago, ganchosCombate, procesarEventos, reiniciarCombate } from '../mago/combate';
import { iniciarMusica } from '../../audio/musica';
import { Fragor } from '../../audio/fragor';
import { interpolarCuerpos } from '../../physics/interpolacion';
import { IDS_MATERIAL, MATERIAL, MAX_MATERIA, interaccionPara, receta, type MaterialId } from './materia';
import {
  GRUPO_ENEMIGO, actualizarAlquimia, actualizarAlquimiaTrasIA, alq, atacar, cuentaAlquimia, descomponer, estadisticasAlq, forjar, ganchosAlq, lanzarReceta,
  limpiarAlquimia, meter, objetoEn, procesarChoquesPiezas, revisarExplosiones, sincronizarAlquimia, transmutarEntorno, vaciarCrisol, type EstadoDescomponer,
} from './transmutacion';
import { Mira, actualizarCirculos, cuentaMotas, limpiarCirculos } from './circulo';
import { HudAlq } from './hud';
import { COMBOS } from '../mago/reacciones';
import { anuncio } from '../mago/efectos';

/**
 * Demo técnica del alquimista: descompone el entorno en materia y la transmuta en ataques y armas.
 * Reutiliza el mundo del sandbox del mago (biblioteca en ruinas, objetos destructibles, enemigos,
 * combos elementales); lo propio está en materia.ts (reglas), transmutacion.ts (motor) y circulo.ts (efectos).
 */

window.addEventListener('resize', ajustarTamano);
ajustarTamano();

// ---------------------------------------------------------------- el alquimista ocupa el cuerpo del mago
scene.remove(mago.model.root);
disposeModel(mago.model);
mago.model = buildModel(Kind.Heroe, ClassId.Alquimista);
scene.add(mago.model.root);
luzMago.color.setHex(0xffd8a0);
mago.hpMax = mago.hp = 220;

// ---------------------------------------------------------------- música
const musica = iniciarMusica('mago');
const fragor = new Fragor(musica.tema.reposo);
const visto = { muertos: 0, rotos: 0 };
function medirFragor(dt: number) {
  const p = mago.body.position;
  let cerca = 0;
  for (const e of enemigos) {
    if (e.muerto || e.tipo === 'muneco') continue;
    if (Math.hypot(e.body.position.x - p.x, e.body.position.z - p.z) < 16) cerca += (e.tipo === 'bruto' ? 2 : 1) * (estado.persiguen ? 1 : 0.5);
  }
  fragor.amenaza(cerca);
  fragor.vida(mago.hp / mago.hpMax);
  fragor.golpe(Math.max(0, estadisticasEnemigos.muertos - visto.muertos) * 0.07 + Math.max(0, estadisticasObjetos.rotos - visto.rotos) * 0.015);
  visto.muertos = estadisticasEnemigos.muertos;
  visto.rotos = estadisticasObjetos.rotos;
  musica.intensidad(fragor.paso(dt));
}

// ---------------------------------------------------------------- interfaz
const hud = new HudAlq();
ganchosAlq.cambio = () => hud.marcarSucio();
ganchosAlq.aviso = (t) => hud.aviso(t);
ganchosAlq.descubrir = (tipo, clave, nombre) => {
  hud.descubrir(tipo, clave);
  if (tipo !== 'arma') anuncio(nombre, tipo === 'entorno' ? '#8adfff' : '#e8c890');
  fragor.golpe(0.05);
};
ganchosCombate.alCombo = (id) => {
  hud.aviso(`Combo: ${COMBOS[id].nombre}`);
  fragor.golpe(0.12);
  musica.acento();
};
const mira = new Mira();

// ---------------------------------------------------------------- entrada
const teclas = new Set<string>();
const pulsadas = new Set<string>();
const raton = { x: 0, y: 0, dentro: false, b0: false, b2: false };
let apunteFijo = false;

function limpiarEntrada() {
  teclas.clear();
  raton.b0 = raton.b2 = false;
}
const elInicio = document.getElementById('inicio')!;
function ocultarInicio() {
  elInicio.classList.add('oculto');
}
document.getElementById('btn-jugar')!.addEventListener('click', ocultarInicio);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (!teclas.has(e.code)) pulsadas.add(e.code);
  teclas.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  ocultarInicio();
});
window.addEventListener('keyup', (e) => teclas.delete(e.code));
window.addEventListener('blur', limpiarEntrada);
canvas.addEventListener('mousemove', (e) => {
  raton.x = e.clientX;
  raton.y = e.clientY;
  raton.dentro = true;
});
canvas.addEventListener('mouseleave', () => {
  raton.b0 = raton.b2 = false;
});
canvas.addEventListener('mousedown', (e) => {
  raton.x = e.clientX;
  raton.y = e.clientY;
  raton.dentro = true;
  if (e.button === 0) raton.b0 = true;
  if (e.button === 2) raton.b2 = true;
  ocultarInicio();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) raton.b0 = false;
  if (e.button === 2) raton.b2 = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const raycaster = new THREE.Raycaster();
const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const apunte = new THREE.Vector3(0, 0, 0);
function actualizarApunte() {
  if (apunteFijo) return true;
  if (!raton.dentro) return false;
  const ndc = new THREE.Vector2((raton.x / window.innerWidth) * 2 - 1, -(raton.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(planoSuelo, apunte) !== null;
}
function puntoGeneracion() {
  if (raton.dentro || apunteFijo) return apunte.clone();
  return new THREE.Vector3(mago.body.position.x, 0, mago.body.position.z - 4);
}
function movimiento() {
  let x = 0;
  let z = 0;
  if (teclas.has('KeyW') || teclas.has('ArrowUp')) z -= 1;
  if (teclas.has('KeyS') || teclas.has('ArrowDown')) z += 1;
  if (teclas.has('KeyA') || teclas.has('ArrowLeft')) x -= 1;
  if (teclas.has('KeyD') || teclas.has('ArrowRight')) x += 1;
  const l = Math.hypot(x, z);
  return l > 0 ? { x: x / l, z: z / l } : { x: 0, z: 0 };
}

// ---------------------------------------------------------------- generar
function enemigo(tipo: TipoEnemigo, x: number, z: number) {
  const e = crearEnemigo(tipo, x, z);
  // Las piezas lanzadas atraviesan a los enemigos en la física (el golpe se calcula aparte, por barrido).
  e.body.collisionFilterGroup = GRUPO_ENEMIGO;
  return e;
}
const GENERAR: Record<string, (p: THREE.Vector3) => void> = {
  esqueleto: (p) => enemigo('esqueleto', p.x, p.z),
  bruto: (p) => enemigo('bruto', p.x, p.z),
  muneco: (p) => enemigo('muneco', p.x, p.z),
  caja: (p) => crearRompible('caja', p.x, 0, p.z, Math.random()),
  barril: (p) => crearRompible('barril', p.x, 0, p.z),
  aceite: (p) => crearRompible('aceite', p.x, 0, p.z),
  tinaja: (p) => crearRompible('tinaja', p.x, 0, p.z),
  cristal: (p) => crearRompible('cristal', p.x, 0, p.z, Math.random()),
  chatarra: (p) => crearRompible('chatarra', p.x, 0, p.z, Math.random()),
  urna: (p) => crearRompible('urna', p.x, 0, p.z),
  obelisco: (p) => crearRompible('obelisco', p.x, 0, p.z, Math.random()),
  columna: (p) => crearRompible('columna', p.x, 0, p.z, Math.random()),
  muro: (p) => {
    const dx = p.x - mago.body.position.x;
    const dz = p.z - mago.body.position.z;
    crearMuroLadrillos(p.x, p.z, 7, 5, Math.atan2(-dx, -dz) + Math.PI / 2);
  },
};
const TECLAS_GENERAR: Record<string, string> = { KeyZ: 'esqueleto', KeyC: 'muneco', KeyV: 'caja', KeyB: 'aceite', KeyN: 'tinaja', KeyM: 'cristal', KeyG: 'chatarra', KeyL: 'obelisco' };
document.querySelectorAll<HTMLButtonElement>('[data-gen]').forEach((btn) =>
  btn.addEventListener('click', () => {
    GENERAR[btn.dataset.gen!]?.(puntoGeneracion());
    ocultarInicio();
  }),
);
function oleada() {
  const c = new THREE.Vector3(mago.body.position.x, 0, mago.body.position.z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand(-0.2, 0.2);
    const r = rand(7, 9);
    enemigo('esqueleto', THREE.MathUtils.clamp(c.x + Math.cos(a) * r, -18, 18), THREE.MathUtils.clamp(c.z + Math.sin(a) * r, -18, 18));
  }
  enemigo('bruto', THREE.MathUtils.clamp(c.x, -16, 16), THREE.MathUtils.clamp(c.z - 10, -18, 18));
}

// ---------------------------------------------------------------- botones de escena
const btnPersiguen = document.getElementById('btn-persiguen') as HTMLButtonElement;
const btnInmortal = document.getElementById('btn-inmortal') as HTMLButtonElement;
const btnLento = document.getElementById('btn-lento') as HTMLButtonElement;
const btnInfinita = document.getElementById('btn-infinita') as HTMLButtonElement;
const si = (b: boolean) => (b ? 'sí' : 'no');
function alternarPersiguen() {
  estado.persiguen = !estado.persiguen;
  btnPersiguen.textContent = `Enemigos atacan (P): ${si(estado.persiguen)}`;
}
function alternarInmortal() {
  estado.inmortal = !estado.inmortal;
  btnInmortal.textContent = `Inmortal (I): ${si(estado.inmortal)}`;
}
function alternarLento() {
  estado.lento = !estado.lento;
  btnLento.textContent = `Cámara lenta (T): ${si(estado.lento)}`;
}
function alternarInfinita() {
  alq.materiaInfinita = !alq.materiaInfinita;
  btnInfinita.textContent = `Materia infinita (Y): ${si(alq.materiaInfinita)}`;
  hud.marcarSucio();
}
btnPersiguen.addEventListener('click', alternarPersiguen);
btnInmortal.addEventListener('click', alternarInmortal);
btnLento.addEventListener('click', alternarLento);
btnInfinita.addEventListener('click', alternarInfinita);
document.getElementById('btn-oleada')!.addEventListener('click', oleada);
document.getElementById('btn-reiniciar')!.addEventListener('click', () => montarEscena());
document.getElementById('btn-paneles')!.addEventListener('click', () => document.body.classList.add('sin-paneles'));

// ---------------------------------------------------------------- escena de pruebas: un taller con cada material a mano
function montarEscena() {
  limpiarAlquimia();
  limpiarCirculos();
  reiniciarCombate();
  limpiarEnemigos();
  limpiarObjetos();
  limpiarEfectos();
  reiniciarAzar(2025);
  for (const id of IDS_MATERIAL) alq.inv[id] = 0;
  alq.inv.piedra = 6;
  alq.crisol = ['piedra'];
  alq.lanzadas.clear();
  alq.forjadas.clear();
  alq.interacciones.clear();
  hud.reiniciar();
  mago.body.position.set(arena.spawn.x, 0.02, arena.spawn.z);
  mago.body.velocity.setZero();
  mago.hp = mago.hpMax;
  mago.muerto = 0;
  mago.yaw = 0;

  // Centro: muñecos de entrenamiento.
  for (const x of [-3, 0, 3]) enemigo('muneco', x, 3);

  // Izquierda delante: almacén de madera y aceite.
  const s = 0.92;
  for (let i = 0; i < 3; i++) crearRompible('caja', -13 + (i - 1) * s, 0, 11);
  for (let i = 0; i < 2; i++) crearRompible('caja', -13 + (i - 0.5) * s, s, 11);
  crearRompible('barril', -10.6, 0, 11.4);
  crearRompible('aceite', -11.6, 0, 9.6);
  crearRompible('aceite', -12.5, 0, 9.2);
  crearRompible('aceite', -14.6, 0, 9.4);
  crearRompible('caja', -15, 0, 11.2, 0.5);
  enemigo('esqueleto', -12, 6.6);

  // Derecha delante: chatarrería con tinajas al lado.
  crearRompible('chatarra', 11, 0, 11, 0.3);
  crearRompible('chatarra', 12.4, 0, 10.4, 1.2);
  crearRompible('chatarra', 13.4, 0, 11.8, 2.1);
  crearRompible('tinaja', 9.6, 0, 9.4);
  crearRompible('tinaja', 10.4, 0, 8.4);
  crearRompible('tinaja', 14.6, 0, 9.4);

  // Derecha: muro de ladrillos con esqueletos y un bruto detrás.
  crearMuroLadrillos(12, 2, 8, 5);
  enemigo('esqueleto', 10.5, -0.5);
  enemigo('esqueleto', 13.5, -0.8);
  enemigo('bruto', 12, -3);

  // Izquierda: patio de piedra (obeliscos, lápidas, urnas) con esqueletos.
  crearRompible('obelisco', -13, 0, -1, 0.2);
  crearRompible('lapida', -10.5, 0, 1.5, 0.2);
  crearRompible('lapida', -15, 0, 2.5, -0.3);
  for (let i = 0; i < 4; i++) crearRompible('urna', -9.5 - i * 1.3, 0, -3.8);
  enemigo('esqueleto', -12, -6);
  enemigo('esqueleto', -14.5, -5);

  // Fondo: cristales de maná junto al altar y columnas.
  crearRompible('cristal', -3.6, 0, -12.2);
  crearRompible('cristal', 3.6, 0, -12.2, 0.6);
  crearRompible('cristal', 0, 0, -11.4, 1.1);
  crearRompible('columna', -14, 0, -13);
  crearRompible('columna', 14, 0, -13);
  for (const x of [-2, 0, 2]) enemigo('esqueleto', x, -7.5);
}

// ---------------------------------------------------------------- simulación
const quemaduras = new Map<Enemigo, number>();
function alQuemar(e: Enemigo, dano: number) {
  herir(e, dano, new THREE.Vector3(0, 0, 1));
  const acum = (quemaduras.get(e) ?? 0) + dano;
  if (acum >= 4 || e.muerto) {
    numero(centroDe(e), String(Math.round(acum)), '#ff8a2a');
    quemaduras.delete(e);
  } else quemaduras.set(e, acum);
}
function alAtacar(e: Enemigo, dano: number) {
  danarMago(dano, new THREE.Vector3(e.body.position.x, 0, e.body.position.z));
}

/** Entradas que se resuelven en cada paso de simulación (las que se mantienen pulsadas). */
interface Entrada {
  atacar: boolean;
  descomponer: boolean;
}
let ultimoDescomponer: EstadoDescomponer | null = null;

function paso(dt: number, ent: Entrada) {
  const b = mago.body;
  if (mago.muerto > 0) {
    mago.muerto -= dt;
    b.velocity.x *= 0.8;
    b.velocity.z *= 0.8;
    if (mago.muerto <= 0) {
      mago.muerto = 0;
      mago.hp = mago.hpMax;
      b.position.set(arena.spawn.x, 0.02, arena.spawn.z);
      b.velocity.setZero();
    }
  } else {
    const m = movimiento();
    const vel = ent.descomponer ? 3.4 : 6.2;
    const a = 1 - Math.exp(-14 * dt);
    b.velocity.x += (m.x * vel - b.velocity.x) * a;
    b.velocity.z += (m.z * vel - b.velocity.z) * a;
    mago.hp = Math.min(mago.hpMax, mago.hp + 4 * dt);
    if (ent.atacar) atacar(apunte);
  }
  ultimoDescomponer = descomponer(ent.descomponer && mago.muerto <= 0 ? apunte : null, dt);

  actualizarAlquimia(dt);
  actualizarZonas(dt);
  actualizarEnemigos(dt, alQuemar, alAtacar);
  actualizarAlquimiaTrasIA(dt);
  world.step(dt);
  procesarColisiones();
  procesarChoquesPiezas();
  revisarExplosiones();
  procesarEventos();
  actualizarObjetos(dt);
}

/** Avanza la simulación de forma síncrona (pruebas automáticas). */
function avanzar(segundos: number, ent: Partial<Entrada> = {}) {
  const e: Entrada = { atacar: false, descomponer: false, ...ent };
  const n = Math.round(segundos / PASO);
  for (let i = 0; i < n; i++) {
    paso(PASO, e);
    estado.tiempo += PASO;
  }
  if (!e.descomponer) descomponer(null, 0);
  ragdolls.step(segundos);
  interpolarCuerpos(world, 1);
  sincronizarTodo(segundos);
  actualizarCirculos(segundos);
  hud.actualizar(segundos);
}

function sincronizarTodo(dt: number) {
  sincronizarObjetos();
  sincronizarEnemigos(dt);
  sincronizarAlquimia();
}

// ---------------------------------------------------------------- acciones de un toque
const TECLA_MATERIAL: Record<string, MaterialId> = Object.fromEntries(IDS_MATERIAL.map((m, i) => [`Digit${i + 1}`, m]));

function accionesDeTeclado(apuntando: boolean) {
  if (pulsadas.has('KeyR')) montarEscena();
  if (pulsadas.has('KeyT')) alternarLento();
  if (pulsadas.has('KeyP')) alternarPersiguen();
  if (pulsadas.has('KeyI')) alternarInmortal();
  if (pulsadas.has('KeyY')) alternarInfinita();
  if (pulsadas.has('KeyO')) oleada();
  if (pulsadas.has('KeyH')) document.body.classList.toggle('sin-paneles');
  if (pulsadas.has('KeyX')) vaciarCrisol();
  for (const [code, m] of Object.entries(TECLA_MATERIAL)) if (pulsadas.has(code)) meter(m);
  for (const [code, id] of Object.entries(TECLAS_GENERAR)) if (pulsadas.has(code)) GENERAR[id]!(puntoGeneracion());
  if (mago.muerto > 0 || estado.pausa) return;
  if (apuntando && pulsadas.has('KeyQ')) lanzarReceta(apunte);
  if (pulsadas.has('KeyF')) forjar();
  if (apuntando && pulsadas.has('KeyE')) transmutarEntorno(apunte);
}

// ---------------------------------------------------------------- bucle
const reloj = new THREE.Timer();
let acum = 0;
let fps = 60;
const camPos = new THREE.Vector3(0, 15, 24);
let zoom = 1;
canvas.addEventListener(
  'wheel',
  (e) => {
    zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.6, 1.6);
    e.preventDefault();
  },
  { passive: false },
);

function frame() {
  requestAnimationFrame(frame);
  reloj.update();
  const real = Math.min(0.05, reloj.getDelta());
  fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;
  const apuntando = actualizarApunte();
  accionesDeTeclado(apuntando);
  pulsadas.clear();

  const ent: Entrada = { atacar: apuntando && raton.b0, descomponer: apuntando && raton.b2 };
  medirFragor(real);
  let dt = estado.pausa ? 0 : real * (estado.lento ? 0.25 : 1);
  if (estado.hitStop > 0 && dt > 0) {
    estado.hitStop -= real;
    dt = 0;
  }
  estado.tiempo += dt;
  acum += dt;
  let n = 0;
  while (acum >= PASO && n < 6) {
    paso(PASO, ent);
    acum -= PASO;
    n++;
  }
  if (n === 6) acum = 0;
  if (!ent.descomponer) ultimoDescomponer = descomponer(null, 0);
  ragdolls.step(dt);
  interpolarCuerpos(world, acum / PASO);

  // Pose interpolada entre los dos últimos pasos de física (ver physics/interpolacion.ts).
  const mp = mago.body.interpolatedPosition;
  if (apuntando) {
    const dx = apunte.x - mp.x;
    const dz = apunte.z - mp.z;
    if (Math.hypot(dx, dz) > 0.3 && !raton.b0) mago.yaw = dirToYaw(dx, dz);
  }
  mago.model.root.position.set(mp.x, mp.y, mp.z);
  mago.model.root.rotation.y = mago.yaw;
  mago.model.root.visible = mago.muerto <= 0;
  animateModel(mago.model, {
    dt, speed: Math.hypot(mago.body.velocity.x, mago.body.velocity.z), airborne: mp.y > 0.3, stunned: false, windup: 0, spinning: false, guarding: false, time: estado.tiempo,
  });
  luzMago.position.set(mp.x, 3, mp.z + 1);

  sincronizarTodo(dt);
  actualizarEfectos(dt);
  actualizarNumeros(real);
  actualizarCirculos(dt);
  pintarMira(apuntando, real);

  const objetivo = new THREE.Vector3(mp.x, 15 * zoom, mp.z + 10.5 * zoom);
  camPos.lerp(objetivo, 1 - Math.exp(-6 * real));
  estado.shake = Math.max(0, estado.shake - real * 1.6);
  const s = estado.shake * estado.shake * 1.2;
  camera.position.set(camPos.x + rand(-s, s), camPos.y + rand(-s, s), camPos.z + rand(-s, s));
  camera.lookAt(camPos.x, 0.6, camPos.z - 10.5 * zoom);

  updateBraziers(vistaArena, estado.tiempo);
  renderer.info.reset();
  post.render(renderer, scene, camera);
  dibujos = renderer.info.render.calls;
  hud.actualizar(real);
  pintarStats();
}

/** El sello del cursor dice qué va a pasar: color del material bajo el cursor o del crisol. */
function pintarMira(apuntando: boolean, dt: number) {
  if (!apuntando) {
    mira.actualizar(null, 0, 0, 0, dt);
    return;
  }
  const d = ultimoDescomponer;
  if (d && d.que !== 'nada') {
    const col = d.que === 'lejos' ? 0xff5a4a : MATERIAL[d.mat ?? 'piedra'].color;
    mira.actualizar(d.punto, col, d.que === 'objeto' ? 1.2 : 0.9, d.que === 'lejos' ? 0.35 : 0.9, dt, -4);
    return;
  }
  const o = objetoEn(apunte);
  if (o) {
    mira.actualizar(apunte, 0x8adfff, 0.8, 0.55, dt, 1.5);
    hud.pista(`E: ${nombreInteraccion(o)} · clic der.: descomponer ${o.tipo.nombre.toLowerCase()}`);
    return;
  }
  const r = receta(alq.crisol);
  mira.actualizar(apunte, r ? MATERIAL[r.base].color : 0x8a8478, 0.55, 0.4, dt);
  hud.pista('');
}
function nombreInteraccion(o: { tipo: { material: string; explosivo?: boolean; agua?: boolean } }) {
  const id = interaccionPara(o.tipo);
  return { pilar: 'pilar', grilletes: 'grilletes', estallido: 'estallido de púas', zarzas: 'zarzas', bomba: 'destilar', congelar: 'escarcha', pararrayos: 'pararrayos', erizo: 'erizo de hojas' }[id];
}

renderer.info.autoReset = false;
let dibujos = 0;
const elStats = document.getElementById('stats')!;
let statsT = 0;
function pintarStats() {
  statsT -= 1 / 60;
  if (statsT > 0) return;
  statsT = 0.2;
  let despiertos = 0;
  for (const bd of world.bodies) if (bd.mass > 0 && bd.sleepState !== CANNON.Body.SLEEPING) despiertos++;
  const munecos = enemigos.filter((e) => e.tipo === 'muneco');
  const dps = munecos.reduce((m, e) => Math.max(m, dpsDe(e)), 0);
  const combos = Object.values(contadorCombos).reduce((a, b) => a + b, 0);
  const c = cuentaAlquimia();
  elStats.textContent =
    `${fps.toFixed(0)} FPS · DPS muñeco ${dps.toFixed(0)}\n` +
    `enemigos ${enemigos.filter((e) => e.tipo !== 'muneco').length} · caídos ${estadisticasEnemigos.muertos} · combos ${combos}\n` +
    `materia descompuesta ${estadisticasAlq.descompuesto.toFixed(0)} · gastada ${estadisticasAlq.creado.toFixed(0)}\n` +
    `púas y pilares ${c.estructuras} · piezas ${c.piezas} (${c.activas} en vuelo)\n` +
    `objetos ${rompibles.length} · trozos ${trozos.length} · cuerpos ${world.bodies.length} (${despiertos} activos)\n` +
    `partículas ${cuentaParticulas()} · motas ${cuentaMotas()} · dibujos ${dibujos}`;
}

montarEscena();
frame();

// ---------------------------------------------------------------- gancho para pruebas automáticas
(window as unknown as { __alq: unknown }).__alq = {
  alq,
  mago,
  estado,
  enemigos,
  rompibles,
  trozos,
  contadorCombos,
  cuenta: cuentaAlquimia,
  dibujos: () => dibujos,
  apuntarA(x: number, z: number) {
    apunteFijo = true;
    apunte.set(x, 0, z);
  },
  colocar(x: number, z: number) {
    mago.body.position.set(x, 0.02, z);
    mago.body.velocity.setZero();
  },
  /** Llena el inventario (o pone una cantidad) para probar recetas. */
  materia(n = MAX_MATERIA) {
    for (const id of IDS_MATERIAL) alq.inv[id] = n;
    hud.marcarSucio();
  },
  crisol(...m: MaterialId[]) {
    alq.crisol = m;
    hud.marcarSucio();
  },
  lanzar() {
    alq.lanzarCd = 0;
    return lanzarReceta(apunte);
  },
  forjar,
  atacar() {
    alq.armaCd = 0;
    return atacar(apunte);
  },
  entorno() {
    alq.entornoCd = 0;
    return transmutarEntorno(apunte);
  },
  avanzar,
  crear(tipo: string, x: number, z: number) {
    GENERAR[tipo]?.(new THREE.Vector3(x, 0, z));
  },
  reiniciar: montarEscena,
  ocultarInicio,
};
