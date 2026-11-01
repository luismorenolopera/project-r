import { DT, Element, Kind, TeamId } from '../constants';
import { distPointSegment } from '../math';
import { pointBlocked } from './geometry';
import type { Sim } from './sim';

export enum ProjDef {
  Orbe = 0,
  Flecha = 1,
  Perforante = 2,
  Red = 3,
  RayoLuz = 4,
  FrascoToxico = 5,
  FrascoAceite = 6,
  FrascoAcido = 7,
  BolaFuego = 8,
}

export enum ZoneDef {
  MuroIgneo = 0,
  Santuario = 1,
  Aceite = 2,
  Acido = 3,
  Lluvia = 4,
}

/** Nombres de las reacciones elementales cruzadas (2.5). */
export const REACTIONS = {
  proyectilIgneo: 'Proyectil ígneo',
  flechaBendita: 'Flecha bendita',
  explosionAceite: 'Explosión de aceite',
} as const;

const SUBSTEP = 0.3;

/**
 * Sinergias al atravesar zonas (2.5):
 * - Proyectil aliado físico o arcano que cruza un Muro ígneo -> fuego, +50% de daño y quemadura.
 * - Proyectil aliado físico que cruza un Santuario -> sagrado, +30% de daño.
 * - Cualquier proyectil de fuego (también enemigo) que toca Aceite -> explosión.
 */
function projectileZoneReactions(sim: Sim, p: number, x: number, z: number) {
  const c = sim.c;
  const P = c.Projectile;
  for (const zone of sim.zones()) {
    if (!sim.exists(zone)) continue;
    const zd = c.Zone.def[zone] as ZoneDef;
    if (!sim.zoneContains(zone, x, z, P.r[p]!)) continue;
    const sameTeam = c.Zone.team[zone] === P.team[p];
    if (zd === ZoneDef.MuroIgneo && sameTeam && !P.converted[p] && (P.el[p] === Element.Fisico || P.el[p] === Element.Arcano)) {
      P.el[p] = Element.Fuego;
      P.dmg[p] = P.dmg[p]! * 1.5;
      P.converted[p] = 1;
      sim.emit({ t: 'reaction', name: REACTIONS.proyectilIgneo, x, z, el: Element.Fuego });
    } else if (zd === ZoneDef.Santuario && sameTeam && !P.converted[p] && P.el[p] === Element.Fisico) {
      P.el[p] = Element.Sagrado;
      P.dmg[p] = P.dmg[p]! * 1.3;
      P.converted[p] = 1;
      sim.emit({ t: 'reaction', name: REACTIONS.flechaBendita, x, z, el: Element.Sagrado });
    } else if (zd === ZoneDef.Aceite && P.el[p] === Element.Fuego) {
      igniteOil(sim, zone);
    }
  }
}

export function igniteOil(sim: Sim, zone: number) {
  const c = sim.c;
  if (!sim.exists(zone)) return;
  const x = c.Pos.x[zone]!;
  const z = c.Pos.z[zone]!;
  sim.remove(zone);
  sim.emit({ t: 'reaction', name: REACTIONS.explosionAceite, x, z, el: Element.Fuego });
  sim.explode(c.Zone.owner[zone]!, c.Zone.team[zone] as TeamId, x, z, 3.8, 50);
}

function onProjectileHit(sim: Sim, p: number, target: number): 'stop' | 'pass' | 'reflect' {
  const c = sim.c;
  const P = c.Projectile;
  const owner = P.owner[p]!;
  const src = sim.exists(owner) ? owner : -1;
  const def = P.def[p] as ProjDef;
  const el = P.el[p] as Element;
  const sameTeam = c.Team.id[target] === P.team[p];

  if (sameTeam) {
    // Solo el rayo de luz interactúa con aliados (cura al atravesarlos).
    if (def === ProjDef.RayoLuz && target !== owner) sim.heal(target, P.heal[p]!);
    return 'pass';
  }
  const vx = c.Vel.x[p]!;
  const vz = c.Vel.z[p]!;
  const dealt = sim.damage(src, target, P.dmg[p]!, el, {
    knock: P.knock[p]!,
    kx: P.knock[p] ? vx : undefined,
    kz: P.knock[p] ? vz : undefined,
    fromX: c.Pos.x[p]! - vx * 0.05,
    fromZ: c.Pos.z[p]! - vz * 0.05,
  });
  if (dealt === -1) return 'reflect';
  if (el === Element.Fuego) sim.applyBurn(target, src, 6, 3);
  if (def === ProjDef.Red) {
    for (const t of sim.actors()) {
      if (!sim.isAlive(t) || c.Team.id[t] === P.team[p] || sim.kind(t) === Kind.Muneco) continue;
      if (Math.hypot(c.Pos.x[t]! - c.Pos.x[target]!, c.Pos.z[t]! - c.Pos.z[target]!) <= 1.5 + c.Body.radius[t]!) {
        c.Status.rootT[t] = 2.5;
        sim.emit({ t: 'text', eid: t, msg: 'Inmovilizado' });
      }
    }
  }
  return P.pierce[p] ? 'pass' : 'stop';
}

function onLobLand(sim: Sim, p: number) {
  const c = sim.c;
  const P = c.Projectile;
  const x = P.tx[p]!;
  const z = P.tz[p]!;
  const owner = P.owner[p]!;
  const src = sim.exists(owner) ? owner : -1;
  const def = P.def[p] as ProjDef;
  if (def === ProjDef.FrascoToxico) {
    sim.emit({ t: 'impact', x, y: 0.1, z, el: Element.Veneno });
    for (const t of sim.actors()) {
      if (!sim.isAlive(t) || c.Team.id[t] === P.team[p]) continue;
      const rr = 1.6 + c.Body.radius[t]!;
      const dx = c.Pos.x[t]! - x;
      const dz = c.Pos.z[t]! - z;
      if (dx * dx + dz * dz > rr * rr) continue;
      sim.damage(src, t, 10, Element.Veneno, { fromX: x, fromZ: z });
      sim.applyPoison(t, src, 6, 4);
    }
  } else if (def === ProjDef.FrascoAceite && src >= 0) {
    sim.spawnZone(src, ZoneDef.Aceite, x, z, 3, 10, Element.Aceite);
  } else if (def === ProjDef.FrascoAcido && src >= 0) {
    sim.spawnZone(src, ZoneDef.Acido, x, z, 5, 6, Element.Veneno);
  }
}

export function updateProjectiles(sim: Sim) {
  const c = sim.c;
  const P = c.Projectile;
  for (const p of sim.projectiles()) {
    if (!sim.exists(p)) continue;
    P.life[p] = P.life[p]! - DT;

    if (P.lob[p]) {
      P.elapsed[p] = P.elapsed[p]! + DT;
      const t = Math.min(1, P.elapsed[p]! / P.flight[p]!);
      c.Pos.x[p] = P.sx[p]! + (P.tx[p]! - P.sx[p]!) * t;
      c.Pos.z[p] = P.sz[p]! + (P.tz[p]! - P.sz[p]!) * t;
      c.Pos.y[p] = 1.5 * (1 - t) + 5 * t * (1 - t);
      if (t >= 1) {
        onLobLand(sim, p);
        sim.remove(p);
      }
      continue;
    }

    if (P.life[p]! <= 0) {
      sim.remove(p);
      continue;
    }

    const vx = c.Vel.x[p]!;
    const vz = c.Vel.z[p]!;
    const dist = Math.hypot(vx, vz) * DT;
    const steps = Math.max(1, Math.ceil(dist / SUBSTEP));
    let hits = sim.hitSets.get(p);
    for (let s = 0; s < steps; s++) {
      const x = c.Pos.x[p]! + (vx * DT) / steps;
      const z = c.Pos.z[p]! + (vz * DT) / steps;
      const y = c.Pos.y[p]!;
      c.Pos.x[p] = x;
      c.Pos.z[p] = z;

      projectileZoneReactions(sim, p, x, z);

      // Cobertura ambiental: muros, pilares y sarcófagos bloquean proyectiles (2.4).
      if (pointBlocked(sim.arena, x, z, y)) {
        sim.emit({ t: 'impact', x, y, z, el: P.el[p] as Element });
        sim.remove(p);
        break;
      }

      let stopped = false;
      for (const t of sim.actors()) {
        if (!sim.isAlive(t) || t === P.owner[p]) continue;
        if (hits?.has(t)) continue;
        const dx = c.Pos.x[t]! - x;
        const dz = c.Pos.z[t]! - z;
        const rr = c.Body.radius[t]! + P.r[p]!;
        if (dx * dx + dz * dz > rr * rr) continue;
        const ty = c.Pos.y[t]!;
        if (y < ty - 0.3 || y > ty + c.Body.height[t]! + 0.4) continue;
        const res = onProjectileHit(sim, p, t);
        if (res === 'reflect') {
          // Desvío perfecto: el proyectil vuelve contra su lanzador.
          c.Vel.x[p] = -vx;
          c.Vel.z[p] = -vz;
          P.owner[p] = t;
          P.team[p] = c.Team.id[t]!;
          c.Team.id[p] = c.Team.id[t]!;
          P.life[p] = 1.5;
          stopped = true;
          break;
        }
        if (!hits) {
          hits = new Set();
          sim.hitSets.set(p, hits);
        }
        hits.add(t);
        if (res === 'stop') {
          sim.emit({ t: 'impact', x, y, z, el: P.el[p] as Element });
          sim.remove(p);
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  }
}

export function updateZones(sim: Sim) {
  const c = sim.c;
  const Z = c.Zone;
  const S = c.Status;
  const zones = sim.zones();
  for (const zone of zones) {
    if (!sim.exists(zone)) continue;
    Z.life[zone] = Z.life[zone]! - DT;
    if (Z.life[zone]! <= 0) {
      sim.remove(zone);
      continue;
    }
    const def = Z.def[zone] as ZoneDef;
    const owner = Z.owner[zone]!;
    const src = sim.exists(owner) ? owner : -1;
    const period = def === ZoneDef.Lluvia ? 0.3 : 0.5;
    Z.pulse[zone] = Z.pulse[zone]! + DT;
    const pulse = Z.pulse[zone]! >= period;
    if (pulse) Z.pulse[zone] = 0;

    // Muro ígneo que toca un charco de aceite: explosión.
    if (def === ZoneDef.Aceite) {
      for (const other of zones) {
        if (other === zone || !sim.exists(other) || Z.def[other] !== ZoneDef.MuroIgneo) continue;
        const d = distPointSegment(c.Pos.x[zone]!, c.Pos.z[zone]!, c.Pos.x[other]!, c.Pos.z[other]!, Z.x2[other]!, Z.z2[other]!);
        if (d < Z.r[zone]! + Z.r[other]!) {
          igniteOil(sim, zone);
          break;
        }
      }
      if (!sim.exists(zone)) continue;
    }

    for (const t of sim.actors()) {
      if (!sim.isAlive(t)) continue;
      if (!sim.zoneContains(zone, c.Pos.x[t]!, c.Pos.z[t]!, c.Body.radius[t]!)) continue;
      const ally = c.Team.id[t] === Z.team[zone];
      switch (def) {
        case ZoneDef.MuroIgneo:
          if (!ally && pulse) {
            sim.damage(src, t, 10, Element.Fuego, { dot: true });
            sim.applyBurn(t, src, 5, 3);
          }
          break;
        case ZoneDef.Santuario:
          if (ally) {
            S.dr[t] = Math.max(S.dr[t]!, 0.3);
            S.drT[t] = Math.max(S.drT[t]!, 0.15);
            if (pulse && sim.kind(t) !== Kind.Muneco) sim.heal(t, 6);
          }
          break;
        case ZoneDef.Aceite:
          if (!ally) {
            S.slow[t] = 0.4;
            S.slowT[t] = Math.max(S.slowT[t]!, 0.2);
            if (S.burnT[t]! > 0) igniteOil(sim, zone);
          }
          break;
        case ZoneDef.Acido:
          if (!ally) {
            S.vuln[t] = Math.max(S.vuln[t]!, 0.3);
            S.vulnT[t] = Math.max(S.vulnT[t]!, 0.6);
            if (pulse) sim.damage(src, t, 4, Element.Veneno, { dot: true });
          }
          break;
        case ZoneDef.Lluvia:
          if (!ally && pulse) sim.damage(src, t, 10, Element.Fisico, { fromX: c.Pos.x[t]!, fromZ: c.Pos.z[t]! });
          break;
      }
      if (!sim.exists(zone)) break;
    }
  }
}
