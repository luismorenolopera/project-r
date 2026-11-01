/**
 * Geometría estática del escenario y colisiones cinemáticas deterministas.
 * La usan el servidor autoritativo y la predicción del cliente (DECISIONES: D-03).
 * Cannon.js queda solo para efectos cosméticos (ragdolls, cámara).
 */
export type Obstacle =
  | { type: 'box'; minX: number; maxX: number; minZ: number; maxZ: number; h: number; tag: string }
  | { type: 'circle'; x: number; z: number; r: number; h: number; tag: string };

export interface Arena {
  name: string;
  halfSize: number;
  obstacles: Obstacle[];
  spawn: { x: number; z: number };
}

const wallT = 1;

/** Cripta de entrenamiento: 40 x 40 m, 4 pilares con braseros y 3 sarcófagos como cobertura. */
export function createTrainingCrypt(): Arena {
  const h = 20;
  const obstacles: Obstacle[] = [
    { type: 'box', minX: -h - wallT, maxX: h + wallT, minZ: -h - wallT, maxZ: -h, h: 6, tag: 'muro' },
    { type: 'box', minX: -h - wallT, maxX: h + wallT, minZ: h, maxZ: h + wallT, h: 6, tag: 'muro' },
    { type: 'box', minX: -h - wallT, maxX: -h, minZ: -h, maxZ: h, h: 6, tag: 'muro' },
    { type: 'box', minX: h, maxX: h + wallT, minZ: -h, maxZ: h, h: 6, tag: 'muro' },
    { type: 'circle', x: -8, z: -8, r: 1.2, h: 6, tag: 'pilar' },
    { type: 'circle', x: 8, z: -8, r: 1.2, h: 6, tag: 'pilar' },
    { type: 'circle', x: -8, z: 8, r: 1.2, h: 6, tag: 'pilar' },
    { type: 'circle', x: 8, z: 8, r: 1.2, h: 6, tag: 'pilar' },
    { type: 'box', minX: -2, maxX: 2, minZ: -1.6, maxZ: -0.6, h: 1.3, tag: 'sarcofago' },
    { type: 'box', minX: -15, maxX: -13.6, minZ: -3, maxZ: 3, h: 1.3, tag: 'sarcofago' },
    { type: 'box', minX: 13.6, maxX: 15, minZ: -3, maxZ: 3, h: 1.3, tag: 'sarcofago' },
  ];
  return { name: 'Cripta de entrenamiento', halfSize: h, obstacles, spawn: { x: 0, z: 10 } };
}

export interface CollisionResult {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
}

const result: CollisionResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

/** Empuja un círculo fuera de los obstáculos. Reutiliza el objeto de resultado (sin basura). */
export function resolveCircle(arena: Arena, x: number, z: number, r: number): CollisionResult {
  result.hit = false;
  result.nx = 0;
  result.nz = 0;
  for (let iter = 0; iter < 2; iter++) {
    for (const o of arena.obstacles) {
      if (o.type === 'circle') {
        const dx = x - o.x;
        const dz = z - o.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = o.r + r;
        if (d < min) {
          const nx = d > 1e-6 ? dx / d : 1;
          const nz = d > 1e-6 ? dz / d : 0;
          x = o.x + nx * min;
          z = o.z + nz * min;
          result.hit = true;
          result.nx = nx;
          result.nz = nz;
        }
      } else {
        const cx = Math.max(o.minX, Math.min(x, o.maxX));
        const cz = Math.max(o.minZ, Math.min(z, o.maxZ));
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            dx /= d;
            dz /= d;
            x = cx + dx * r;
            z = cz + dz * r;
            result.nx = dx;
            result.nz = dz;
          } else {
            // Centro dentro de la caja: salir por el eje más corto.
            const left = x - o.minX;
            const right = o.maxX - x;
            const back = z - o.minZ;
            const front = o.maxZ - z;
            const m = Math.min(left, right, back, front);
            if (m === left) { x = o.minX - r; result.nx = -1; result.nz = 0; }
            else if (m === right) { x = o.maxX + r; result.nx = 1; result.nz = 0; }
            else if (m === back) { z = o.minZ - r; result.nx = 0; result.nz = -1; }
            else { z = o.maxZ + r; result.nx = 0; result.nz = 1; }
          }
          result.hit = true;
        }
      }
    }
  }
  result.x = x;
  result.z = z;
  return result;
}

/** ¿El punto (con radio r) está dentro de algún obstáculo más alto que y? */
export function pointBlocked(arena: Arena, x: number, z: number, y: number, r = 0): Obstacle | null {
  for (const o of arena.obstacles) {
    if (y > o.h) continue;
    if (o.type === 'circle') {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + r) * (o.r + r)) return o;
    } else if (x > o.minX - r && x < o.maxX + r && z > o.minZ - r && z < o.maxZ + r) {
      return o;
    }
  }
  return null;
}

/** Línea de visión a la altura y (cobertura ambiental, 2.4). */
export function hasLineOfSight(arena: Arena, x1: number, z1: number, x2: number, z2: number, y = 1.2): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointBlocked(arena, x1 + dx * t, z1 + dz * t, y)) return false;
  }
  return true;
}

/** Recorta un desplazamiento para que no atraviese obstáculos (parpadeo, salto). */
export function clampTravel(arena: Arena, x: number, z: number, tx: number, tz: number, r: number): { x: number; z: number } {
  const dx = tx - x;
  const dz = tz - z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  let lx = x;
  let lz = z;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = x + dx * t;
    const pz = z + dz * t;
    if (pointBlocked(arena, px, pz, 0, r)) break;
    lx = px;
    lz = pz;
  }
  return { x: lx, z: lz };
}
