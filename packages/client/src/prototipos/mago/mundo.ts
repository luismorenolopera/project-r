import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ClassId, Kind, type Arena, type Obstacle } from '@mazmorra/shared';
import { RetroPostProcess } from '../../render/psx';
import { buildArena } from '../../render/scene';
import { createTextures } from '../../render/textures';
import { buildModel, initModels } from '../../render/models';
import { ClientPhysics } from '../../physics/ragdoll';
import { mulberry32 } from '../../physics/fractura';
import type { Elemento } from './grimorio';

/**
 * Estado compartido del sandbox del mago: render, mundo físico, arena, el propio mago
 * y la cola de eventos que se resuelve tras cada paso de física.
 */

export const PASO = 1 / 120;

// ---------------------------------------------------------------- render
export const canvas = document.getElementById('game') as HTMLCanvasElement;
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
export const post = new RetroPostProcess();
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 140);
export const textures = createTextures();
initModels(textures);

export function ajustarTamano() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}

// ---------------------------------------------------------------- arena: biblioteca en ruinas
function crearRuinas(): Arena {
  const h = 20;
  const t = 1.5;
  const obstacles: Obstacle[] = [
    { type: 'box', minX: -h - t, maxX: h + t, minZ: -h - t, maxZ: -h, h: 6, tag: 'muro' },
    { type: 'box', minX: -h - t, maxX: h + t, minZ: h, maxZ: h + t, h: 6, tag: 'muro' },
    { type: 'box', minX: -h - t, maxX: -h, minZ: -h, maxZ: h, h: 6, tag: 'muro' },
    { type: 'box', minX: h, maxX: h + t, minZ: -h, maxZ: h, h: 6, tag: 'muro' },
    { type: 'circle', x: -9, z: -8, r: 1.1, h: 6, tag: 'pilar' },
    { type: 'circle', x: 9, z: -8, r: 1.1, h: 6, tag: 'pilar' },
    { type: 'circle', x: -9, z: 7, r: 1.1, h: 6, tag: 'pilar' },
    { type: 'circle', x: 9, z: 7, r: 1.1, h: 6, tag: 'pilar' },
    // Altar al fondo y atriles a los lados (bloques bajos de piedra).
    { type: 'box', minX: -2.2, maxX: 2.2, minZ: -15.2, maxZ: -13.8, h: 1.2, tag: 'sarcofago' },
    { type: 'box', minX: -18.6, maxX: -17.4, minZ: -5, maxZ: 1, h: 1.2, tag: 'sarcofago' },
    { type: 'box', minX: 17.4, maxX: 18.6, minZ: -5, maxZ: 1, h: 1.2, tag: 'sarcofago' },
  ];
  return { name: 'Biblioteca en ruinas', halfSize: h, obstacles, spawn: { x: 0, z: 13 } };
}

export const arena = crearRuinas();
export const vistaArena = buildArena(scene, arena, textures);
(scene.fog as THREE.FogExp2).density = 0.014;
scene.add(new THREE.HemisphereLight(0x8a84b8, 0x2a2018, 1.55));
export const luzMago = new THREE.PointLight(0xb0a0ff, 34, 16, 1.4);
scene.add(luzMago);

// ---------------------------------------------------------------- física
export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
(world.solver as CANNON.GSSolver).iterations = 10;

export const mEstatico = new CANNON.Material('estatico');
export const mPersonaje = new CANNON.Material('personaje');
export const mObjeto = new CANNON.Material('objeto');
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mEstatico, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mPersonaje, { friction: 0, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(mPersonaje, mObjeto, { friction: 0.1, restitution: 0.1 }));
world.addContactMaterial(new CANNON.ContactMaterial(mObjeto, mEstatico, { friction: 0.55, restitution: 0.2 }));
world.addContactMaterial(new CANNON.ContactMaterial(mObjeto, mObjeto, { friction: 0.5, restitution: 0.12 }));

const suelo = new CANNON.Body({ mass: 0, material: mEstatico });
suelo.addShape(new CANNON.Plane());
suelo.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(suelo);

/** Muros, pilares y bloques: contra ellos se aturden los enemigos empujados. */
export const duros = new Set<CANNON.Body>();
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

/** Ragdolls cosméticos de los enemigos que mueren (mundo físico aparte, como en el sandbox de combate). */
export const ragdolls = new ClientPhysics(scene, arena);

// ---------------------------------------------------------------- estado global
export const estado = {
  tiempo: 0,
  shake: 0,
  hitStop: 0,
  lento: false,
  persiguen: false,
  inmortal: true,
  pausa: false,
};

export let rnd = mulberry32(2024);
export function reiniciarAzar(semilla: number) {
  rnd = mulberry32(semilla);
}
export const rand = (a: number, b: number) => a + (b - a) * Math.random();
export const v3 = (v: CANNON.Vec3) => new THREE.Vector3(v.x, v.y, v.z);

export function temblor(fuerza: number, pausa = 0) {
  estado.shake = Math.max(estado.shake, fuerza);
  estado.hitStop = Math.max(estado.hitStop, pausa);
}

// ---------------------------------------------------------------- el mago
export const RADIO_MAGO = 0.4;
export const mago = {
  body: new CANNON.Body({ mass: 80, material: mPersonaje, fixedRotation: true, allowSleep: false }),
  model: buildModel(Kind.Heroe, ClassId.Mago),
  yaw: 0,
  hp: 200,
  hpMax: 200,
  mana: 100,
  manaMax: 100,
  /** Reutilización restante por hechizo (por id). */
  cd: new Map<string, number>(),
  /** Cargas del Parpadeo con la runa Doble salto. */
  cargas: 2,
  recargaCarga: 0,
  infusion: { t: 0, elemento: 'arcano' as Elemento, prisma: false, indice: 0 },
  muerto: 0,
  golpeT: 0,
};
mago.body.addShape(new CANNON.Sphere(RADIO_MAGO), new CANNON.Vec3(0, RADIO_MAGO, 0));
mago.body.addShape(new CANNON.Sphere(RADIO_MAGO), new CANNON.Vec3(0, 1.3, 0));
world.addBody(mago.body);
scene.add(mago.model.root);

// ---------------------------------------------------------------- cola de eventos
export interface GolpeBase {
  dano: number;
  elemento: Elemento;
  /** Punto del impacto en el mundo. */
  punto: THREE.Vector3;
  /** Dirección horizontal del golpe (normalizada). */
  dir: THREE.Vector3;
  /** Velocidad de empuje en m/s (0 = no empuja). */
  empuje?: number;
  /** Frío que aporta si es de hielo. */
  frio?: number;
  /** Aplica estados sin provocar combos (golpes que nacen de un combo). */
  soloEstado?: boolean;
  aturdir?: number;
  /** No aplica la Infusión (golpes del entorno, quemaduras...). */
  sinInfusion?: boolean;
}

export type EventoMundo =
  | { tipo: 'explosion'; centro: THREE.Vector3; radio: number; golpe: GolpeBase; combo?: 'aceite' | 'cristal' }
  | { tipo: 'agua'; centro: THREE.Vector3; radio: number }
  | { tipo: 'mana'; cantidad: number; punto: THREE.Vector3 };

export const eventos: EventoMundo[] = [];
