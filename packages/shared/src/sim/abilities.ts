import { ClassId, DT, Element, Kind, Slot, TeamId } from '../constants';
import { classById } from '../content/classes';
import { yawToDir } from '../math';
import { clampTravel } from './geometry';
import type { Sim } from './sim';
import { ProjDef, ZoneDef } from './effects';

export enum DashFx {
  Ninguno = 0,
  Embestida = 1,
  SaltoSismico = 2,
  PasoSagrado = 3,
  CargaBruto = 4,
}

export enum HeroAction {
  Ninguna = 0,
  Torbellino = 1,
}

/** Golpe en cono frente a la entidad. Devuelve cuántos objetivos alcanzó. */
export function meleeArc(sim: Sim, e: number, range: number, halfAngle: number, dmg: number, el: Element, knock = 0, yaw?: number): number {
  const c = sim.c;
  const ex = c.Pos.x[e]!;
  const ez = c.Pos.z[e]!;
  const f = yawToDir(yaw ?? c.Facing.yaw[e]!);
  const team = c.Team.id[e];
  let n = 0;
  for (const t of sim.actors()) {
    if (t === e || !sim.isAlive(t) || c.Team.id[t] === team) continue;
    const dx = c.Pos.x[t]! - ex;
    const dz = c.Pos.z[t]! - ez;
    const dy = Math.abs(c.Pos.y[t]! - c.Pos.y[e]!);
    const d = Math.hypot(dx, dz);
    const reach = range + c.Body.radius[t]!;
    if (d > reach || dy > 2.2) continue;
    if (d > 0.3) {
      const cos = (dx * f.x + dz * f.z) / d;
      if (cos < Math.cos(halfAngle)) continue;
    }
    sim.damage(e, t, dmg, el, { melee: true, knock, kx: knock ? f.x : undefined, kz: knock ? f.z : undefined });
    n++;
  }
  return n;
}

/** Golpe circular alrededor de un punto. */
export function radialHit(sim: Sim, e: number, x: number, z: number, r: number, dmg: number, el: Element, knock = 0, each?: (t: number) => void): number {
  const c = sim.c;
  const team = c.Team.id[e];
  let n = 0;
  for (const t of sim.actors()) {
    if (t === e || !sim.isAlive(t) || c.Team.id[t] === team) continue;
    const dx = c.Pos.x[t]! - x;
    const dz = c.Pos.z[t]! - z;
    const rr = r + c.Body.radius[t]!;
    if (dx * dx + dz * dz > rr * rr) continue;
    sim.damage(e, t, dmg, el, { melee: true, knock, fromX: x, fromZ: z });
    each?.(t);
    n++;
  }
  return n;
}

/** Aliados del mismo bando dentro del radio. */
export function alliesInRadius(sim: Sim, e: number, x: number, z: number, r: number, includeSelf: boolean): number[] {
  const c = sim.c;
  const out: number[] = [];
  for (const t of sim.actors()) {
    if (!sim.isAlive(t) || c.Team.id[t] !== c.Team.id[e]) continue;
    if (t === e && !includeSelf) continue;
    if (sim.kind(t) === Kind.Muneco) continue;
    const dx = c.Pos.x[t]! - x;
    const dz = c.Pos.z[t]! - z;
    if (dx * dx + dz * dz <= r * r) out.push(t);
  }
  return out;
}

/**
 * Elige el aliado apuntado para hechizos de soporte (1.3). Excluye siempre al lanzador.
 * Prioriza el aliado más cercano al punto apuntado dentro del alcance.
 */
export function pickAllyTarget(sim: Sim, e: number, range: number): number {
  const c = sim.c;
  const allies = alliesInRadius(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, range, false);
  let best = -1;
  let bestD = Infinity;
  for (const a of allies) {
    const d = Math.hypot(c.Pos.x[a]! - c.Hero.aimX[e]!, c.Pos.z[a]! - c.Hero.aimZ[e]!);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function groundTarget(sim: Sim, e: number, maxRange: number) {
  const c = sim.c;
  const ex = c.Pos.x[e]!;
  const ez = c.Pos.z[e]!;
  let tx = c.Hero.aimX[e]!;
  let tz = c.Hero.aimZ[e]!;
  const dx = tx - ex;
  const dz = tz - ez;
  const d = Math.hypot(dx, dz);
  if (d > maxRange) {
    tx = ex + (dx / d) * maxRange;
    tz = ez + (dz / d) * maxRange;
  }
  const lim = sim.arena.halfSize - 0.6;
  tx = Math.max(-lim, Math.min(lim, tx));
  tz = Math.max(-lim, Math.min(lim, tz));
  return { x: tx, z: tz, d: Math.min(d, maxRange) };
}

function startDash(sim: Sim, e: number, dirX: number, dirZ: number, dist: number, time: number, fx: DashFx) {
  const c = sim.c;
  c.Dash.vx[e] = (dirX * dist) / time;
  c.Dash.vz[e] = (dirZ * dist) / time;
  c.Dash.t[e] = time;
  c.Dash.effect[e] = fx;
  sim.hitSets.set(e, new Set());
}

function fire(sim: Sim, e: number, def: ProjDef, speed: number, dmg: number, el: Element, opts: Parameters<Sim['spawnProjectile']>[9] = {}) {
  const c = sim.c;
  const d = sim.aimDir(e);
  const x = c.Pos.x[e]! + d.x * 0.7;
  const z = c.Pos.z[e]! + d.z * 0.7;
  return sim.spawnProjectile(e, def, x, c.Pos.y[e]! + 1.2, z, d.x * speed, d.z * speed, dmg, el, opts);
}

/**
 * Ejecuta la habilidad de la ranura. Devuelve false si no se pudo lanzar (no consume tiempo de reutilización),
 * true para usar el tiempo de reutilización de la definición, o un número para sobrescribirlo.
 */
export function castAbility(sim: Sim, e: number, slot: Slot): boolean | number {
  const c = sim.c;
  const H = c.Hero;
  const S = c.Status;
  const cls = H.cls[e] as ClassId;
  const def = classById(cls).habilidades[slot]!;
  const dir = sim.aimDir(e);
  const moveLen = Math.hypot(H.moveX[e]!, H.moveZ[e]!);
  const moveDir = moveLen > 0.1 ? { x: H.moveX[e]! / moveLen, z: H.moveZ[e]! / moveLen } : dir;

  switch (def.id) {
    // ---------------- Guerrero ----------------
    case 'tajo': {
      const step = H.basicTimer[e]! > 0 ? (H.basicStep[e]! + 1) % 3 : 0;
      H.basicStep[e] = step;
      H.basicTimer[e] = 0.9;
      const dmg = [18, 18, 30][step]!;
      const knock = step === 2 ? 8 : 0;
      meleeArc(sim, e, 2.6, 1.05, dmg, Element.Fisico, knock);
      return step === 2 ? 0.6 : def.cd;
    }
    case 'embestida':
      startDash(sim, e, dir.x, dir.z, 7, 0.3, DashFx.Embestida);
      return true;
    case 'bloqueo':
      S.guardT[e] = 1.5;
      S.guardAge[e] = 0;
      return true;
    case 'torbellino':
      H.action[e] = HeroAction.Torbellino;
      H.actionT[e] = 1.0;
      return true;
    case 'salto_sismico': {
      const t = groundTarget(sim, e, def.alcance ?? 10);
      const dest = clampTravel(sim.arena, c.Pos.x[e]!, c.Pos.z[e]!, t.x, t.z, c.Body.radius[e]!);
      const dx = dest.x - c.Pos.x[e]!;
      const dz = dest.z - c.Pos.z[e]!;
      const d = Math.hypot(dx, dz);
      const time = 0.6;
      startDash(sim, e, d > 0.01 ? dx / d : 0, d > 0.01 ? dz / d : 0, d, time, DashFx.SaltoSismico);
      c.Vel.y[e] = (22 * time) / 2;
      c.Body.grounded[e] = 0;
      return true;
    }

    // ---------------- Mago ----------------
    case 'orbe':
      fire(sim, e, ProjDef.Orbe, 20, 16, Element.Arcano, { r: 0.3, life: 1.5 });
      return true;
    case 'parpadeo': {
      const fx = c.Pos.x[e]!;
      const fz = c.Pos.z[e]!;
      const dest = clampTravel(sim.arena, fx, fz, fx + moveDir.x * 8, fz + moveDir.z * 8, c.Body.radius[e]!);
      c.Pos.x[e] = c.Pos.px[e] = dest.x;
      c.Pos.z[e] = c.Pos.pz[e] = dest.z;
      sim.emit({ t: 'blink', eid: e, fx, fz });
      return true;
    }
    case 'egida': {
      const ally = pickAllyTarget(sim, e, def.alcance ?? 15);
      if (ally < 0) {
        sim.emit({ t: 'fail', eid: e, msg: 'Égida necesita un aliado al alcance (no se puede lanzar sobre ti)' });
        return false;
      }
      sim.addShield(ally, 80, 6);
      return true;
    }
    case 'muro_igneo': {
      const t = groundTarget(sim, e, def.alcance ?? 14);
      // Perpendicular a la dirección de apuntado.
      const px = -dir.z;
      const pz = dir.x;
      const half = 3.5;
      sim.spawnZone(e, ZoneDef.MuroIgneo, t.x - px * half, t.z - pz * half, 0.7, 6, Element.Fuego, { x2: t.x + px * half, z2: t.z + pz * half });
      return true;
    }
    case 'furia': {
      const allies = alliesInRadius(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, def.alcance ?? 12, false);
      if (allies.length === 0) {
        sim.emit({ t: 'fail', eid: e, msg: 'Encantamiento de furia necesita aliados cerca (no afecta al mago)' });
        return false;
      }
      for (const a of allies) {
        S.dmgBuff[a] = 1.4;
        S.dmgBuffT[a] = 10;
        S.spdBuff[a] = 1.2;
        S.spdBuffT[a] = 10;
        sim.emit({ t: 'text', eid: a, msg: '¡Furia!' });
      }
      return true;
    }

    // ---------------- Arquero ----------------
    case 'flecha': {
      const m = H.nextShotMult[e]! || 1;
      H.nextShotMult[e] = 1;
      fire(sim, e, ProjDef.Flecha, 32, 14 * m, Element.Fisico, { r: 0.2, life: 1.2 });
      return true;
    }
    case 'voltereta':
      startDash(sim, e, -dir.x, -dir.z, 6, 0.25, DashFx.Ninguno);
      c.Vel.y[e] = 3;
      H.nextShotMult[e] = 2;
      return true;
    case 'red':
      fire(sim, e, ProjDef.Red, 22, 5, Element.Fisico, { r: 0.4, life: 1 });
      return true;
    case 'perforante': {
      const m = H.nextShotMult[e]! || 1;
      H.nextShotMult[e] = 1;
      fire(sim, e, ProjDef.Perforante, 36, 45 * m, Element.Fisico, { r: 0.3, life: 1.2, pierce: true, knock: 9 });
      return true;
    }
    case 'lluvia': {
      const t = groundTarget(sim, e, def.alcance ?? 18);
      sim.spawnZone(e, ZoneDef.Lluvia, t.x, t.z, 4, 3, Element.Fisico);
      return true;
    }

    // ---------------- Curador ----------------
    case 'golpe_consagrado':
      meleeArc(sim, e, 2.4, 1.0, 14, Element.Sagrado);
      return true;
    case 'paso_sagrado':
      startDash(sim, e, moveDir.x, moveDir.z, 6, 0.25, DashFx.PasoSagrado);
      return true;
    case 'santuario': {
      const t = groundTarget(sim, e, def.alcance ?? 10);
      sim.spawnZone(e, ZoneDef.Santuario, t.x, t.z, 3.5, 6, Element.Sagrado);
      return true;
    }
    case 'rayo_luz':
      fire(sim, e, ProjDef.RayoLuz, 30, 30, Element.Sagrado, { r: 0.35, life: 0.8, pierce: true, heal: 40 });
      return true;
    case 'plegaria': {
      const allies = alliesInRadius(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, def.alcance ?? 15, true);
      for (const a of allies) {
        sim.heal(a, c.Health.max[a]! * 0.6);
        S.burnT[a] = 0; S.poisonT[a] = 0; S.slowT[a] = 0; S.stunT[a] = 0; S.rootT[a] = 0;
      }
      sim.emit({ t: 'reaction', name: 'Plegaria', x: c.Pos.x[e]!, z: c.Pos.z[e]!, el: Element.Sagrado });
      return true;
    }

    // ---------------- Alquimista ----------------
    case 'frasco_toxico': {
      const t = groundTarget(sim, e, def.alcance ?? 14);
      sim.spawnLob(e, ProjDef.FrascoToxico, t.x, t.z, Element.Veneno);
      return true;
    }
    case 'impulso': {
      radialHit(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, 2.5, 8, Element.Fuego, 10);
      startDash(sim, e, moveDir.x, moveDir.z, 6, 0.6, DashFx.Ninguno);
      c.Vel.y[e] = 8;
      c.Body.grounded[e] = 0;
      sim.emit({ t: 'explosion', x: c.Pos.x[e]!, z: c.Pos.z[e]!, r: 2.5, el: Element.Fuego });
      return true;
    }
    case 'piel_piedra':
      S.dr[e] = Math.max(S.dr[e]!, 0.5);
      S.drT[e] = 4;
      S.knockImmuneT[e] = 4;
      return true;
    case 'aceite': {
      const t = groundTarget(sim, e, def.alcance ?? 14);
      sim.spawnLob(e, ProjDef.FrascoAceite, t.x, t.z, Element.Aceite);
      return true;
    }
    case 'transmutacion': {
      const t = groundTarget(sim, e, def.alcance ?? 14);
      sim.spawnLob(e, ProjDef.FrascoAcido, t.x, t.z, Element.Veneno);
      return true;
    }
  }
  return false;
}

/** Efectos continuos de acciones canalizadas y cargas de los héroes. */
export function updateHeroAction(sim: Sim, e: number) {
  const c = sim.c;
  const H = c.Hero;
  if (H.action[e] === HeroAction.Torbellino) {
    const before = H.actionT[e]!;
    H.actionT[e] = before - DT;
    // 5 golpes en 1 s: uno cada 0,2 s, empezando en el primer tick. Se cuenta en ticks para no depender del redondeo.
    const tick = Math.round((1 - before) / DT);
    if (tick % Math.round(0.2 / DT) === 0) {
      radialHit(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, 3, 12, Element.Fisico, 0);
    }
    if (H.actionT[e]! <= 0) H.action[e] = HeroAction.Ninguna;
  }
  if (c.Dash.t[e]! > 0) {
    const fx = c.Dash.effect[e] as DashFx;
    const hits = sim.hitSets.get(e) ?? new Set<number>();
    sim.hitSets.set(e, hits);
    if (fx === DashFx.Embestida) {
      const len = Math.hypot(c.Dash.vx[e]!, c.Dash.vz[e]!) || 1;
      const ux = c.Dash.vx[e]! / len;
      const uz = c.Dash.vz[e]! / len;
      for (const t of sim.actors()) {
        if (hits.has(t) || !sim.isAlive(t) || c.Team.id[t] === c.Team.id[e]) continue;
        const d = Math.hypot(c.Pos.x[t]! - c.Pos.x[e]!, c.Pos.z[t]! - c.Pos.z[e]!);
        if (d > c.Body.radius[t]! + 1.1) continue;
        hits.add(t);
        sim.damage(e, t, 15, Element.Fisico, { melee: true, knock: 16, kx: ux, kz: uz });
      }
    } else if (fx === DashFx.PasoSagrado) {
      for (const a of alliesInRadius(sim, e, c.Pos.x[e]!, c.Pos.z[e]!, 1.6, false)) {
        if (hits.has(a)) continue;
        hits.add(a);
        sim.heal(a, 30);
      }
    }
  }
}

/** Fin de una carga (por tiempo o por choque). */
export function onDashEnd(sim: Sim, e: number, collided: boolean) {
  const c = sim.c;
  const fx = c.Dash.effect[e] as DashFx;
  c.Dash.t[e] = 0;
  c.Dash.effect[e] = DashFx.Ninguno;
  if (fx === DashFx.SaltoSismico) {
    const x = c.Pos.x[e]!;
    const z = c.Pos.z[e]!;
    sim.emit({ t: 'explosion', x, z, r: 4, el: Element.Fisico });
    radialHit(sim, e, x, z, 4, 60, Element.Fisico, 0, (t) => {
      sim.stun(t, 1);
      if (c.Body.mass[t]! < 2 && !c.Body.floats[t]) {
        c.Vel.y[t] = 9;
        c.Body.grounded[t] = 0;
      }
    });
  } else if (fx === DashFx.CargaBruto && collided) {
    sim.emit({ t: 'reaction', name: '¡El bruto se estrella!', x: c.Pos.x[e]!, z: c.Pos.z[e]!, el: Element.Fisico });
    c.Telegraph.active[e] = 0;
    c.AI.state[e] = 0;
    c.Status.stunT[e] = 2.5;
    c.Status.vuln[e] = 0.5;
    c.Status.vulnT[e] = 2.5;
  }
  if (sim.team(e) === TeamId.Heroes) sim.hitSets.delete(e);
}
