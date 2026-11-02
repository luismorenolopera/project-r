import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { dirToYaw } from '@mazmorra/shared';
import { animateModel } from '../../render/models';
import { updateBraziers } from '../../render/scene';
import './mago.css';
import {
  PASO, ajustarTamano, arena, camera, canvas, estado, luzMago, mago, post, ragdolls, rand, reiniciarAzar, renderer, scene, vistaArena, world,
} from './mundo';
import { actualizarEfectos, actualizarNumeros, cuentaParticulas, limpiarEfectos, numero } from './efectos';
import { actualizarObjetos, crearMuroLadrillos, crearRompible, estadisticasObjetos, limpiarObjetos, rompibles, sincronizarObjetos, trozos } from './objetos';
import {
  actualizarEnemigos, centroDe, crearEnemigo, dpsDe, enemigos, estadisticasEnemigos, herir, limpiarEnemigos, procesarColisiones, sincronizarEnemigos,
  type Enemigo, type TipoEnemigo,
} from './enemigos';
import { actualizarZonas, contadorCombos, danarMago, ganchosCombate, procesarEventos, reiniciarCombate } from './combate';
import { actualizarHechizos, avisoFallo, canalizar, canalizando, cuentaHechizos, lanzar, limpiarHechizos } from './hechizos';
import { Hud } from './hud';
import { HECHIZOS, RANURAS, hechizo, type Build } from './grimorio';

/**
 * Sandbox del mago: barra de hechizos con runas, combos elementales y un entorno destructible.
 * Las físicas (cannon-es) mueven a los enemigos despedidos, los objetos y sus trozos.
 */

window.addEventListener('resize', ajustarTamano);
ajustarTamano();

// ---------------------------------------------------------------- interfaz
const hud = new Hud(() => {
  estado.pausa = hud.abierto;
  if (hud.abierto) limpiarEntrada();
});
ganchosCombate.alCombo = (id) => hud.marcarCombo(id, contadorCombos[id]);

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
  if (e.code === 'KeyK') {
    hud.alternar();
    ocultarInicio();
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape' && hud.abierto) {
    hud.cerrar();
    return;
  }
  if (hud.abierto) return;
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

/** Ranuras cuyo botón o tecla está pulsado ahora mismo. */
function ranurasPulsadas(): number[] {
  const res: number[] = [];
  RANURAS.forEach((def, i) => {
    const on = def.entrada === 'raton0' ? raton.b0 : def.entrada === 'raton2' ? raton.b2 : teclas.has(def.entrada);
    if (on) res.push(i);
  });
  return res;
}

// ---------------------------------------------------------------- generar
const GENERAR: Record<string, (p: THREE.Vector3) => void> = {
  esqueleto: (p) => crearEnemigo('esqueleto', p.x, p.z),
  bruto: (p) => crearEnemigo('bruto', p.x, p.z),
  muneco: (p) => crearEnemigo('muneco', p.x, p.z),
  caja: (p) => crearRompible('caja', p.x, 0, p.z, Math.random()),
  barril: (p) => crearRompible('barril', p.x, 0, p.z),
  aceite: (p) => crearRompible('aceite', p.x, 0, p.z),
  tinaja: (p) => crearRompible('tinaja', p.x, 0, p.z),
  cristal: (p) => crearRompible('cristal', p.x, 0, p.z, Math.random()),
  urna: (p) => crearRompible('urna', p.x, 0, p.z),
  obelisco: (p) => crearRompible('obelisco', p.x, 0, p.z, Math.random()),
  columna: (p) => crearRompible('columna', p.x, 0, p.z, Math.random()),
  muro: (p) => {
    const dx = p.x - mago.body.position.x;
    const dz = p.z - mago.body.position.z;
    crearMuroLadrillos(p.x, p.z, 7, 5, Math.atan2(-dx, -dz) + Math.PI / 2);
  },
};
const TECLAS_GENERAR: Record<string, string> = { KeyZ: 'esqueleto', KeyX: 'bruto', KeyC: 'muneco', KeyV: 'caja', KeyB: 'aceite', KeyN: 'tinaja', KeyM: 'cristal' };
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
    const x = THREE.MathUtils.clamp(c.x + Math.cos(a) * r, -18, 18);
    const z = THREE.MathUtils.clamp(c.z + Math.sin(a) * r, -18, 18);
    crearEnemigo('esqueleto', x, z);
  }
  crearEnemigo('bruto', THREE.MathUtils.clamp(c.x, -16, 16), THREE.MathUtils.clamp(c.z - 10, -18, 18));
}

// ---------------------------------------------------------------- botones de escena
const btnPersiguen = document.getElementById('btn-persiguen') as HTMLButtonElement;
const btnInmortal = document.getElementById('btn-inmortal') as HTMLButtonElement;
const btnLento = document.getElementById('btn-lento') as HTMLButtonElement;
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
btnPersiguen.addEventListener('click', alternarPersiguen);
btnInmortal.addEventListener('click', alternarInmortal);
btnLento.addEventListener('click', alternarLento);
document.getElementById('btn-oleada')!.addEventListener('click', oleada);
document.getElementById('btn-reiniciar')!.addEventListener('click', () => montarEscena());
document.getElementById('btn-paneles')!.addEventListener('click', () => document.body.classList.add('sin-paneles'));

// ---------------------------------------------------------------- escena de pruebas
function montarEscena() {
  limpiarHechizos();
  reiniciarCombate();
  limpiarEnemigos();
  limpiarObjetos();
  limpiarEfectos();
  hud.reiniciarCombos();
  reiniciarAzar(2024);
  mago.body.position.set(arena.spawn.x, 0.02, arena.spawn.z);
  mago.body.velocity.setZero();
  mago.hp = mago.hpMax;
  mago.mana = mago.manaMax;
  mago.muerto = 0;
  mago.yaw = 0;

  // Centro: muñecos de entrenamiento con tinajas de agua al lado (Electrocución, Congelación).
  for (const x of [-3, 0, 3]) crearEnemigo('muneco', x, 3);
  crearRompible('tinaja', -1.5, 0, 3.6);
  crearRompible('tinaja', 1.5, 0, 3.6);

  // Izquierda: almacén de madera con barriles de aceite (incendios y explosiones en cadena).
  const s = 0.92;
  for (let i = 0; i < 3; i++) crearRompible('caja', -13 + (i - 1) * s, 0, 11);
  for (let i = 0; i < 2; i++) crearRompible('caja', -13 + (i - 0.5) * s, s, 11);
  crearRompible('caja', -13, 2 * s, 11, 0.3);
  crearRompible('barril', -10.6, 0, 11.4);
  crearRompible('aceite', -11.6, 0, 9.6);
  crearRompible('aceite', -12.5, 0, 9.2);
  crearRompible('barril', -13.6, 0, 9.3);
  crearRompible('caja', -15, 0, 10, 0.5);
  crearRompible('caja', -15.2, 0, 11.4, 0.2);
  crearRompible('barril', -14.8, 0, 12.8);
  crearEnemigo('esqueleto', -12, 7.4);
  crearEnemigo('esqueleto', -14.4, 7.8);

  // Derecha: muro de ladrillos con esqueletos y un bruto detrás.
  crearMuroLadrillos(12, 2, 8, 6);
  crearEnemigo('esqueleto', 10.5, -0.5);
  crearEnemigo('esqueleto', 13.5, -0.8);
  crearEnemigo('bruto', 12, -3);

  // Fondo: obeliscos y columnas que se astillan, cristales de maná junto al altar.
  crearRompible('obelisco', -6, 0, -11, 0.2);
  crearRompible('obelisco', 6, 0, -11, -0.3);
  crearRompible('columna', -14, 0, -13);
  crearRompible('columna', 14, 0, -13);
  crearRompible('cristal', -3.6, 0, -12.2);
  crearRompible('cristal', 3.6, 0, -12.2, 0.6);
  crearRompible('cristal', 0, 0, -11.4, 1.1);
  for (const x of [-2, 0, 2]) crearEnemigo('esqueleto', x, -7);

  // Urnas alrededor de los pilares delanteros y lápidas sueltas.
  for (let i = 0; i < 5; i++) {
    const a = -0.4 + i * 0.5;
    crearRompible('urna', -9 + Math.cos(a) * 2, 0, 7 + Math.sin(a) * 2);
    crearRompible('urna', 9 - Math.cos(a) * 2, 0, 7 + Math.sin(a) * 2);
  }
  crearRompible('lapida', -5, 0, -3, 0.2);
  crearRompible('lapida', 5, 0, -3, -0.2);
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

function paso(dt: number, pulsadasAhora: number[]) {
  const b = mago.body;
  if (mago.muerto > 0) {
    mago.muerto -= dt;
    b.velocity.x *= 0.8;
    b.velocity.z *= 0.8;
    if (mago.muerto <= 0) {
      mago.muerto = 0;
      mago.hp = mago.hpMax;
      mago.mana = mago.manaMax;
      b.position.set(arena.spawn.x, 0.02, arena.spawn.z);
      b.velocity.setZero();
    }
  } else {
    const m = movimiento();
    const vel = canalizando() ? 3.2 : 6.2;
    const a = 1 - Math.exp(-14 * dt);
    b.velocity.x += (m.x * vel - b.velocity.x) * a;
    b.velocity.z += (m.z * vel - b.velocity.z) * a;
    mago.hp = Math.min(mago.hpMax, mago.hp + 4 * dt);
  }
  const canal = pulsadasAhora.find((i) => hechizo(hud.build[i]!.hechizo).canalizado) ?? null;
  canalizar(hud.build, canal, apunte, dt);

  actualizarHechizos(dt);
  actualizarZonas(dt);
  actualizarEnemigos(dt, alQuemar, alAtacar);
  world.step(dt);
  procesarColisiones();
  procesarEventos();
  actualizarObjetos(dt);
}

/** Avanza la simulación de forma síncrona (pruebas automáticas). */
function avanzar(segundos: number, ranuras: number[] = []) {
  const n = Math.round(segundos / PASO);
  for (let i = 0; i < n; i++) {
    paso(PASO, ranuras);
    estado.tiempo += PASO;
  }
  ragdolls.step(segundos);
  sincronizarTodo(segundos);
}

function sincronizarTodo(dt: number) {
  sincronizarObjetos();
  sincronizarEnemigos(dt);
}

// ---------------------------------------------------------------- bucle
const reloj = new THREE.Timer();
let acum = 0;
let fps = 60;
const camPos = new THREE.Vector3(0, 15, 24);
/** Zoom de la cámara con la rueda del ratón (1 = distancia normal). */
let zoom = 1;
canvas.addEventListener(
  'wheel',
  (e) => {
    zoom = THREE.MathUtils.clamp(zoom * (e.deltaY > 0 ? 1.1 : 1 / 1.1), 0.6, 1.6);
    e.preventDefault();
  },
  { passive: false },
);
let ultimoFallo = 0;

function frame() {
  requestAnimationFrame(frame);
  reloj.update();
  const real = Math.min(0.05, reloj.getDelta());
  fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;
  const apuntando = actualizarApunte();

  if (!hud.abierto) {
    if (pulsadas.has('KeyR')) montarEscena();
    if (pulsadas.has('KeyT')) alternarLento();
    if (pulsadas.has('KeyP')) alternarPersiguen();
    if (pulsadas.has('KeyI')) alternarInmortal();
    if (pulsadas.has('KeyO')) oleada();
    if (pulsadas.has('KeyH')) document.body.classList.toggle('sin-paneles');
    for (const [code, id] of Object.entries(TECLAS_GENERAR)) if (pulsadas.has(code)) GENERAR[id]!(puntoGeneracion());
  }
  pulsadas.clear();

  const activas = hud.abierto || !apuntando ? [] : ranurasPulsadas();
  if (!estado.pausa) {
    for (const i of activas) {
      if (hechizo(hud.build[i]!.hechizo).canalizado) continue;
      const r = lanzar(hud.build, i, apunte);
      if (!r.ok && r.motivo === 'mana' && estado.tiempo - ultimoFallo > 0.8) {
        ultimoFallo = estado.tiempo;
        avisoFallo(r.motivo);
      }
    }
  }

  let dt = estado.pausa ? 0 : real * (estado.lento ? 0.25 : 1);
  if (estado.hitStop > 0 && dt > 0) {
    estado.hitStop -= real;
    dt = 0;
  }
  estado.tiempo += dt;
  acum += dt;
  let n = 0;
  while (acum >= PASO && n < 6) {
    paso(PASO, activas);
    acum -= PASO;
    n++;
  }
  if (n === 6) acum = 0;
  if (dt === 0 && !estado.pausa) canalizar(hud.build, null, apunte, 0);
  if (estado.pausa) canalizar(hud.build, null, apunte, 0);
  ragdolls.step(dt);

  // Mago
  const mp = mago.body.position;
  if (apuntando && !canalizando()) {
    const dx = apunte.x - mp.x;
    const dz = apunte.z - mp.z;
    if (Math.hypot(dx, dz) > 0.3) mago.yaw = dirToYaw(dx, dz);
  }
  mago.model.root.position.set(mp.x, mp.y, mp.z);
  mago.model.root.rotation.y = mago.yaw;
  mago.model.root.visible = mago.muerto <= 0;
  animateModel(mago.model, {
    dt, speed: Math.hypot(mago.body.velocity.x, mago.body.velocity.z), airborne: false, stunned: false, windup: 0, spinning: false, guarding: false, time: estado.tiempo,
  });
  luzMago.position.set(mp.x, 3, mp.z + 1);

  sincronizarTodo(dt);
  actualizarEfectos(dt);
  actualizarNumeros(real);

  // Cámara en picado que sigue al mago, con temblor en los impactos.
  const objetivo = new THREE.Vector3(mp.x, 15 * zoom, mp.z + 10.5 * zoom);
  camPos.lerp(objetivo, 1 - Math.exp(-6 * real));
  estado.shake = Math.max(0, estado.shake - real * 1.6);
  const s = estado.shake * estado.shake * 1.2;
  camera.position.set(camPos.x + rand(-s, s), camPos.y + rand(-s, s), camPos.z + rand(-s, s));
  camera.lookAt(camPos.x, 0.6, camPos.z - 10.5 * zoom);

  updateBraziers(vistaArena, estado.tiempo);
  post.render(renderer, scene, camera);
  hud.actualizar();
  pintarStats();
}

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
  const h = cuentaHechizos();
  elStats.textContent =
    `${fps.toFixed(0)} FPS · DPS muñeco ${dps.toFixed(0)}\n` +
    `enemigos ${enemigos.filter((e) => e.tipo !== 'muneco').length} · caídos ${estadisticasEnemigos.muertos} · combos ${combos}\n` +
    `objetos ${rompibles.length} · rotos ${estadisticasObjetos.rotos} · lascas ${estadisticasObjetos.lascas}\n` +
    `trozos ${trozos.length} · cuerpos ${world.bodies.length} (${despiertos} activos)\n` +
    `proyectiles ${h.proyectiles} · partículas ${cuentaParticulas()}`;
}

montarEscena();
frame();

// ---------------------------------------------------------------- gancho para pruebas automáticas
(window as unknown as { __mago: unknown }).__mago = {
  hud,
  mago,
  estado,
  enemigos,
  rompibles,
  trozos,
  contadorCombos,
  estadisticasObjetos,
  hechizos: HECHIZOS.map((h) => ({ id: h.id, categoria: h.categoria, runas: h.runas.map((r) => r.id) })),
  apuntarA(x: number, z: number) {
    apunteFijo = true;
    apunte.set(x, 0, z);
  },
  colocar(x: number, z: number) {
    mago.body.position.set(x, 0.02, z);
    mago.body.velocity.setZero();
  },
  equipar(build: Build, libre = true) {
    hud.equipar(build, libre);
  },
  lanzar(ranura: number) {
    mago.cd.clear();
    mago.mana = mago.manaMax;
    mago.cargas = 2;
    return lanzar(hud.build, ranura, apunte);
  },
  avanzar,
  crear(tipo: string, x: number, z: number) {
    if (['esqueleto', 'bruto', 'muneco'].includes(tipo)) crearEnemigo(tipo as TipoEnemigo, x, z);
    else GENERAR[tipo]?.(new THREE.Vector3(x, 0, z));
  },
  reiniciar: montarEscena,
  ocultarInicio,
};
