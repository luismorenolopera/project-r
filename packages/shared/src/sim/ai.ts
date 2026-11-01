import { DT, Element, Kind, TeamId } from '../constants';
import { monsterDef } from '../content/enemies';
import { dirToYaw, yawToDir } from '../math';
import { meleeArc, radialHit, DashFx } from './abilities';
import { ProjDef } from './effects';
import { hasLineOfSight } from './geometry';
import type { Sim } from './sim';

export enum AIState {
  Persigue = 0,
  Preparando = 1,
  Recupera = 2,
  PreparaCarga = 3,
  Cargando = 4,
}

/** Tiempos de preparación (telegrafía) de cada ataque, en segundos. */
export const WINDUP = {
  esqueleto: 0.6,
  cultista: 0.8,
  brutoGolpe: 1.0,
  brutoCarga: 1.0,
  espectro: 0.45,
  aliado: 0.4,
} as const;

function nearestEnemy(sim: Sim, e: number, maxDist: number): number {
  const c = sim.c;
  let best = -1;
  let bestD = maxDist;
  for (const t of sim.actors()) {
    if (!sim.isAlive(t) || c.Team.id[t] === c.Team.id[e]) continue;
    if (sim.kind(t) === Kind.Muneco) continue;
    const d = Math.hypot(c.Pos.x[t]! - c.Pos.x[e]!, c.Pos.z[t]! - c.Pos.z[e]!);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function nearestHero(sim: Sim, e: number): number {
  const c = sim.c;
  let best = -1;
  let bestD = Infinity;
  for (const h of sim.heroes()) {
    if (!sim.isAlive(h)) continue;
    const d = Math.hypot(c.Pos.x[h]! - c.Pos.x[e]!, c.Pos.z[h]! - c.Pos.z[e]!);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

function telegraph(sim: Sim, e: number, shape: 0 | 1 | 2, r: number, w: number, t: number, yaw: number) {
  const T = sim.c.Telegraph;
  T.active[e] = 1;
  T.shape[e] = shape;
  T.x[e] = sim.c.Pos.x[e]!;
  T.z[e] = sim.c.Pos.z[e]!;
  T.yaw[e] = yaw;
  T.r[e] = r;
  T.w[e] = w;
  T.t[e] = t;
  T.total[e] = t;
}

function moveToward(sim: Sim, e: number, tx: number, tz: number, speed: number, stopAt = 0) {
  const c = sim.c;
  const dx = tx - c.Pos.x[e]!;
  const dz = tz - c.Pos.z[e]!;
  const d = Math.hypot(dx, dz);
  if (d <= stopAt || d < 1e-4) {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
    return;
  }
  c.Vel.x[e] = (dx / d) * speed;
  c.Vel.z[e] = (dz / d) * speed;
}

function speedOf(sim: Sim, e: number, base: number) {
  const S = sim.c.Status;
  let s = base;
  if (S.slowT[e]! > 0) s *= 1 - S.slow[e]!;
  if (S.spdBuffT[e]! > 0) s *= S.spdBuff[e]!;
  if (S.rootT[e]! > 0) s = 0;
  return s;
}

export function updateAI(sim: Sim, e: number) {
  const c = sim.c;
  const A = c.AI;
  const T = c.Telegraph;
  const S = c.Status;
  const kind = sim.kind(e);
  const def = monsterDef(kind);

  if (A.cd[e]! > 0) A.cd[e] = A.cd[e]! - DT;
  if (A.cd2[e]! > 0) A.cd2[e] = A.cd2[e]! - DT;

  if (S.stunT[e]! > 0) {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
    return;
  }

  const target = kind === Kind.Aliado ? nearestEnemy(sim, e, 9) : nearestEnemy(sim, e, 40);
  A.target[e] = target;
  const ex = c.Pos.x[e]!;
  const ez = c.Pos.z[e]!;
  const tx = target >= 0 ? c.Pos.x[target]! : ex;
  const tz = target >= 0 ? c.Pos.z[target]! : ez;
  const d = target >= 0 ? Math.hypot(tx - ex, tz - ez) : Infinity;
  const yawTo = dirToYaw(tx - ex, tz - ez);
  const speed = speedOf(sim, e, def.velocidad);

  // Estados comunes: preparación (telegrafiada) y recuperación.
  if (A.state[e] === AIState.Preparando || A.state[e] === AIState.PreparaCarga) {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
    A.t[e] = A.t[e]! - DT;
    T.t[e] = A.t[e]!;
    T.x[e] = ex;
    T.z[e] = ez;
    if (A.t[e]! > 0) return;
    T.active[e] = 0;
    strike(sim, e, kind);
    return;
  }
  if (A.state[e] === AIState.Recupera) {
    A.t[e] = A.t[e]! - DT;
    c.Vel.x[e] *= 0.5;
    c.Vel.z[e] *= 0.5;
    if (A.t[e]! <= 0) A.state[e] = AIState.Persigue;
    return;
  }
  if (A.state[e] === AIState.Cargando) {
    // Carga del bruto: golpea a lo que atraviesa.
    const hits = sim.hitSets.get(e) ?? new Set<number>();
    sim.hitSets.set(e, hits);
    const len = Math.hypot(c.Dash.vx[e]!, c.Dash.vz[e]!) || 1;
    for (const t of sim.actors()) {
      if (hits.has(t) || !sim.isAlive(t) || c.Team.id[t] === c.Team.id[e]) continue;
      if (Math.hypot(c.Pos.x[t]! - ex, c.Pos.z[t]! - ez) > c.Body.radius[t]! + c.Body.radius[e]! + 0.4) continue;
      hits.add(t);
      sim.damage(e, t, 25, Element.Fisico, { melee: true, knock: 12, kx: c.Dash.vx[e]! / len, kz: c.Dash.vz[e]! / len });
    }
    if (c.Dash.t[e]! <= 0) {
      sim.hitSets.delete(e);
      if (A.state[e] === AIState.Cargando) {
        A.state[e] = AIState.Recupera;
        A.t[e] = 0.6;
      }
    }
    return;
  }

  if (kind === Kind.Aliado) {
    updateAlly(sim, e, target, d, yawTo, speed);
    return;
  }
  if (target < 0) {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
    return;
  }
  c.Facing.yaw[e] = yawTo;

  switch (kind) {
    case Kind.Esqueleto:
      if (d < 2.3 && A.cd[e]! <= 0) {
        A.state[e] = AIState.Preparando;
        A.t[e] = WINDUP.esqueleto;
        telegraph(sim, e, 1, 2.7, 1.0, WINDUP.esqueleto, yawTo);
      } else moveToward(sim, e, tx, tz, speed, 1.6);
      break;
    case Kind.Espectro:
      if (d < 1.8 && A.cd[e]! <= 0) {
        A.state[e] = AIState.Preparando;
        A.t[e] = WINDUP.espectro;
        telegraph(sim, e, 1, 2.1, 0.8, WINDUP.espectro, yawTo);
      } else moveToward(sim, e, tx, tz, speed, 1.2);
      break;
    case Kind.Cultista: {
      const los = hasLineOfSight(sim.arena, ex, ez, tx, tz);
      if (los && d < 16 && A.cd[e]! <= 0) {
        A.state[e] = AIState.Preparando;
        A.t[e] = WINDUP.cultista;
        A.ax[e] = tx;
        A.az[e] = tz;
        telegraph(sim, e, 2, 16, 0.35, WINDUP.cultista, yawTo);
        break;
      }
      // Mantener distancia y rodear; sin línea de visión, acercarse rodeando.
      const ux = (tx - ex) / (d || 1);
      const uz = (tz - ez) / (d || 1);
      const side = Math.floor(sim.tick / 50 + e) % 2 === 0 ? 1 : -1;
      let mx = -uz * side * 0.8;
      let mz = ux * side * 0.8;
      if (d < 6) { mx -= ux; mz -= uz; }
      else if (d > 11 || !los) { mx += ux; mz += uz; }
      const ml = Math.hypot(mx, mz) || 1;
      c.Vel.x[e] = (mx / ml) * speed;
      c.Vel.z[e] = (mz / ml) * speed;
      break;
    }
    case Kind.Bruto: {
      if (d < 2.9 && A.cd[e]! <= 0) {
        A.state[e] = AIState.Preparando;
        A.t[e] = WINDUP.brutoGolpe;
        telegraph(sim, e, 0, 3.2, 0, WINDUP.brutoGolpe, yawTo);
      } else if (d > 5 && d < 15 && A.cd2[e]! <= 0 && hasLineOfSight(sim.arena, ex, ez, tx, tz, 0.8)) {
        A.state[e] = AIState.PreparaCarga;
        A.t[e] = WINDUP.brutoCarga;
        A.ax[e] = tx;
        A.az[e] = tz;
        telegraph(sim, e, 2, 15, 1.0, WINDUP.brutoCarga, yawTo);
      } else moveToward(sim, e, tx, tz, speed, 2.2);
      break;
    }
  }
}

function strike(sim: Sim, e: number, kind: Kind) {
  const c = sim.c;
  const A = c.AI;
  const T = c.Telegraph;
  const yaw = T.yaw[e]!;
  c.Facing.yaw[e] = yaw;
  const wasCharge = A.state[e] === AIState.PreparaCarga;
  A.state[e] = AIState.Recupera;
  A.t[e] = 0.5;
  switch (kind) {
    case Kind.Esqueleto:
      meleeArc(sim, e, 2.7, 1.0, 15, Element.Fisico, 5, yaw);
      A.cd[e] = 1.4;
      break;
    case Kind.Espectro: {
      const n = meleeArc(sim, e, 2.1, 0.8, 10, Element.Arcano, 0, yaw);
      if (n > 0) sim.heal(e, 10);
      A.cd[e] = 1.2;
      break;
    }
    case Kind.Aliado:
      meleeArc(sim, e, 2.2, 1.0, 12, Element.Fisico, 0, yaw);
      A.cd[e] = 1.0;
      A.t[e] = 0.2;
      break;
    case Kind.Cultista: {
      const d = yawToDir(yaw);
      sim.spawnProjectile(e, ProjDef.BolaFuego, c.Pos.x[e]! + d.x * 0.7, 1.2, c.Pos.z[e]! + d.z * 0.7, d.x * 16, d.z * 16, 12, Element.Fuego, { r: 0.3, life: 1.5 });
      A.cd[e] = 2.6;
      A.t[e] = 0.4;
      break;
    }
    case Kind.Bruto:
      if (wasCharge) {
        const d = yawToDir(yaw);
        c.Dash.vx[e] = d.x * 13;
        c.Dash.vz[e] = d.z * 13;
        c.Dash.t[e] = 1.1;
        c.Dash.effect[e] = DashFx.CargaBruto;
        sim.hitSets.set(e, new Set());
        A.state[e] = AIState.Cargando;
        A.cd2[e] = 7;
      } else {
        sim.emit({ t: 'explosion', x: c.Pos.x[e]!, z: c.Pos.z[e]!, r: 3.2, el: Element.Fisico });
        radialHit(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, 3.2, 30, Element.Fisico, 10);
        A.cd[e] = 2.5;
        A.t[e] = 0.8;
      }
      break;
  }
}

function updateAlly(sim: Sim, e: number, target: number, d: number, yawTo: number, speed: number) {
  const c = sim.c;
  const A = c.AI;
  if (target >= 0) {
    c.Facing.yaw[e] = yawTo;
    if (d < 2.0 && A.cd[e]! <= 0) {
      A.state[e] = AIState.Preparando;
      A.t[e] = WINDUP.aliado;
      c.Telegraph.yaw[e] = yawTo;
      c.Telegraph.active[e] = 0;
      return;
    }
    moveToward(sim, e, c.Pos.x[target]!, c.Pos.z[target]!, speed, 1.4);
    return;
  }
  const h = nearestHero(sim, e);
  if (h < 0 || sim.team(h) !== TeamId.Heroes) {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
    return;
  }
  const hx = c.Pos.x[h]!;
  const hz = c.Pos.z[h]!;
  const dh = Math.hypot(hx - c.Pos.x[e]!, hz - c.Pos.z[e]!);
  if (dh > 3) {
    c.Facing.yaw[e] = dirToYaw(hx - c.Pos.x[e]!, hz - c.Pos.z[e]!);
    moveToward(sim, e, hx, hz, dh > 8 ? speed * 1.4 : speed, 2.5);
  } else {
    c.Vel.x[e] = 0;
    c.Vel.z[e] = 0;
  }
}
