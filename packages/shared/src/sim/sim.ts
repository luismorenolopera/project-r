import { addComponent, addEntity, createWorld, entityExists, query, removeEntity, type World } from 'bitecs';
import { Btn, ClassId, DT, Element, GRAVITY, Kind, Slot, TeamId } from '../constants';
import { createComponents, type Components } from '../ecs/components';
import { classById } from '../content/classes';
import { monsterDef } from '../content/enemies';
import { mulberry32, yawToDir, distPointSegment } from '../math';
import type { InputFrame } from '../input';
import type { SimEvent } from './events';
import { createTrainingCrypt, pointBlocked, resolveCircle, type Arena, type CollisionResult } from './geometry';
import { castAbility, updateHeroAction, onDashEnd, DashFx, HeroAction } from './abilities';
import { updateAI } from './ai';
import { updateProjectiles, updateZones, ZoneDef } from './effects';

/** Tope duro del multiplicador de daño total (presupuesto de poder, riesgo de balance del plan). */
export const POWER_CAP = 3;
export const FRENZY_COMBO = 12;
export const FRENZY_MULT = 1.4;
export const FRENZY_DURATION = 10;
export const COMBO_WINDOW = 2.5;
export const WALL_SLAM_SPEED = 6;
export const PERFECT_GUARD_WINDOW = 0.25;
/** Avance máximo de un actor por subpaso de colisión (metros). */
export const MAX_MOVE_STEP = 0.3;

const moveResult: CollisionResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };

export interface DamageOpts {
  knock?: number;
  /** Dirección del empuje (si no, desde el origen hacia el objetivo). */
  kx?: number;
  kz?: number;
  dot?: boolean;
  melee?: boolean;
  /** Posición desde la que llega el golpe (para el bloqueo frontal). */
  fromX?: number;
  fromZ?: number;
}

export interface SimOptions {
  inmortal: boolean;
}

const CD_KEYS = ['cd0', 'cd1', 'cd2', 'cd3', 'cd4'] as const;

export class Sim {
  readonly world: World = createWorld();
  readonly c: Components = createComponents();
  readonly arena: Arena;
  readonly rng: () => number;
  tick = 0;
  events: SimEvent[] = [];
  options: SimOptions = { inmortal: false };
  /** Entidades golpeadas por una carga o proyectil perforante (para no repetir). */
  readonly hitSets = new Map<number, Set<number>>();
  private readonly classCds = new Map<string, number[]>();
  private readonly pendingRemove = new Set<number>();
  private readonly inputs = new Map<number, InputFrame>();

  constructor(seed = 1, arena: Arena = createTrainingCrypt()) {
    this.arena = arena;
    this.rng = mulberry32(seed);
    // Registro de todos los componentes para que las consultas existan desde el principio.
    for (const comp of Object.values(this.c)) {
      const e = addEntity(this.world);
      addComponent(this.world, e, comp);
      removeEntity(this.world, e);
    }
  }

  // ---------- consultas ----------
  heroes(): number[] { return Array.from(query(this.world, [this.c.Hero])); }
  actors(): number[] { return Array.from(query(this.world, [this.c.Health])); }
  projectiles(): number[] { return Array.from(query(this.world, [this.c.Projectile])); }
  zones(): number[] { return Array.from(query(this.world, [this.c.Zone])); }
  ais(): number[] { return Array.from(query(this.world, [this.c.AI])); }
  exists(eid: number): boolean { return eid >= 0 && entityExists(this.world, eid) && !this.pendingRemove.has(eid); }
  isAlive(eid: number): boolean {
    return this.exists(eid) && this.c.Health.max[eid]! > 0 && this.c.Health.hp[eid]! > 0 && this.c.Health.deadT[eid]! <= 0;
  }
  kind(eid: number): Kind { return this.c.KindC.k[eid] as Kind; }
  team(eid: number): TeamId { return this.c.Team.id[eid] as TeamId; }
  emit(e: SimEvent) { this.events.push(e); }
  /** Devuelve y vacía los eventos pendientes (incluidos los emitidos fuera de step()). */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------- creación ----------
  private reset(eid: number) {
    for (const comp of Object.values(this.c)) {
      for (const arr of Object.values(comp) as (Float32Array | Uint8Array | Int32Array)[]) {
        arr[eid] = arr instanceof Int32Array ? -1 : 0;
      }
    }
  }

  private baseActor(kind: Kind, team: TeamId, x: number, z: number, hp: number, radius: number, height: number, mass: number): number {
    const w = this.world;
    const c = this.c;
    const eid = addEntity(w);
    this.pendingRemove.delete(eid);
    this.reset(eid);
    for (const comp of [c.Pos, c.Vel, c.Facing, c.Body, c.Health, c.Team, c.KindC, c.Status, c.Knock, c.Dash]) addComponent(w, eid, comp);
    c.Pos.x[eid] = c.Pos.px[eid] = x;
    c.Pos.z[eid] = c.Pos.pz[eid] = z;
    c.Body.radius[eid] = radius;
    c.Body.height[eid] = height;
    c.Body.mass[eid] = mass;
    c.Body.grounded[eid] = 1;
    c.Health.hp[eid] = hp;
    c.Health.max[eid] = hp;
    c.Team.id[eid] = team;
    c.KindC.k[eid] = kind;
    this.emit({ t: 'spawn', eid, kind });
    return eid;
  }

  spawnHero(cls: ClassId, x = this.arena.spawn.x, z = this.arena.spawn.z): number {
    const def = classById(cls);
    const eid = this.baseActor(Kind.Heroe, TeamId.Heroes, x, z, def.hp, 0.45, 1.8, 1);
    for (const comp of [this.c.Hero, this.c.Combo]) addComponent(this.world, eid, comp);
    this.c.Hero.cls[eid] = cls;
    this.c.Hero.nextShotMult[eid] = 1;
    return eid;
  }

  /** Cambio de clase en el sandbox. Conserva los tiempos de reutilización de cada clase. */
  setHeroClass(eid: number, cls: ClassId) {
    const H = this.c.Hero;
    const prev = H.cls[eid] as ClassId;
    if (prev === cls) return;
    this.classCds.set(`${eid}:${prev}`, CD_KEYS.map((k) => H[k][eid]!));
    const saved = this.classCds.get(`${eid}:${cls}`) ?? [0, 0, 0, 0, 0];
    CD_KEYS.forEach((k, i) => (H[k][eid] = saved[i]!));
    const ratio = this.c.Health.hp[eid]! / this.c.Health.max[eid]!;
    const def = classById(cls);
    H.cls[eid] = cls;
    H.basicStep[eid] = 0;
    H.action[eid] = 0;
    H.nextShotMult[eid] = 1;
    this.c.Health.max[eid] = def.hp;
    if (this.c.Health.deadT[eid]! <= 0) this.c.Health.hp[eid] = Math.max(1, Math.round(def.hp * ratio));
    this.c.Status.guardT[eid] = 0;
    this.emit({ t: 'class', eid, cls });
  }

  spawnMonster(kind: Kind, x: number, z: number): number {
    const def = monsterDef(kind);
    const team = kind === Kind.Aliado ? TeamId.Heroes : TeamId.Monstruos;
    const p = resolveCircle(this.arena, x, z, def.radio);
    const eid = this.baseActor(kind, team, p.x, p.z, def.hp, def.radio, def.altura, def.masa);
    if (def.flota) this.c.Body.floats[eid] = 1;
    if (kind !== Kind.Muneco) {
      addComponent(this.world, eid, this.c.AI);
      addComponent(this.world, eid, this.c.Telegraph);
      this.c.AI.cd[eid] = 0.5 + this.rng() * 0.5;
      this.c.AI.cd2[eid] = 2;
    }
    return eid;
  }

  spawnProjectile(owner: number, def: number, x: number, y: number, z: number, vx: number, vz: number, dmg: number, el: Element, opts: { r?: number; life?: number; pierce?: boolean; heal?: number; knock?: number } = {}): number {
    const w = this.world;
    const c = this.c;
    const eid = addEntity(w);
    this.pendingRemove.delete(eid);
    this.reset(eid);
    for (const comp of [c.Pos, c.Vel, c.KindC, c.Projectile, c.Team]) addComponent(w, eid, comp);
    c.Pos.x[eid] = c.Pos.px[eid] = x;
    c.Pos.y[eid] = c.Pos.py[eid] = y;
    c.Pos.z[eid] = c.Pos.pz[eid] = z;
    c.Vel.x[eid] = vx;
    c.Vel.z[eid] = vz;
    c.KindC.k[eid] = Kind.Proyectil;
    const P = c.Projectile;
    P.def[eid] = def;
    P.owner[eid] = owner;
    P.team[eid] = c.Team.id[owner]!;
    c.Team.id[eid] = c.Team.id[owner]!;
    P.el[eid] = el;
    P.dmg[eid] = dmg;
    P.r[eid] = opts.r ?? 0.25;
    P.life[eid] = opts.life ?? 1.5;
    P.pierce[eid] = opts.pierce ? 1 : 0;
    P.heal[eid] = opts.heal ?? 0;
    P.knock[eid] = opts.knock ?? 0;
    this.emit({ t: 'spawn', eid, kind: Kind.Proyectil });
    return eid;
  }

  /** Proyectil en parábola hacia un punto del suelo (frascos). Ignora la cobertura en vuelo. */
  spawnLob(owner: number, def: number, tx: number, tz: number, el: Element): number {
    const c = this.c;
    const sx = c.Pos.x[owner]!;
    const sz = c.Pos.z[owner]!;
    const eid = this.spawnProjectile(owner, def, sx, 1.5, sz, 0, 0, 0, el, { life: 5 });
    const P = c.Projectile;
    P.lob[eid] = 1;
    P.sx[eid] = sx;
    P.sz[eid] = sz;
    P.tx[eid] = tx;
    P.tz[eid] = tz;
    const d = Math.hypot(tx - sx, tz - sz);
    P.flight[eid] = 0.35 + d / 28;
    return eid;
  }

  spawnZone(owner: number, def: ZoneDef, x: number, z: number, r: number, life: number, el: Element, seg?: { x2: number; z2: number }): number {
    const w = this.world;
    const c = this.c;
    const eid = addEntity(w);
    this.pendingRemove.delete(eid);
    this.reset(eid);
    for (const comp of [c.Pos, c.KindC, c.Zone, c.Team]) addComponent(w, eid, comp);
    c.Pos.x[eid] = c.Pos.px[eid] = x;
    c.Pos.z[eid] = c.Pos.pz[eid] = z;
    c.KindC.k[eid] = Kind.Zona;
    const Z = c.Zone;
    Z.def[eid] = def;
    Z.owner[eid] = owner;
    Z.team[eid] = c.Team.id[owner]!;
    c.Team.id[eid] = c.Team.id[owner]!;
    Z.el[eid] = el;
    Z.r[eid] = r;
    Z.life[eid] = life;
    Z.total[eid] = life;
    if (seg) {
      Z.shape[eid] = 1;
      Z.x2[eid] = seg.x2;
      Z.z2[eid] = seg.z2;
    } else {
      Z.x2[eid] = x;
      Z.z2[eid] = z;
    }
    this.emit({ t: 'spawn', eid, kind: Kind.Zona });
    return eid;
  }

  /** ¿El punto (x,z) con margen extra está dentro de la zona? */
  zoneContains(zone: number, x: number, z: number, extra = 0): boolean {
    const c = this.c;
    const r = c.Zone.r[zone]! + extra;
    if (c.Zone.shape[zone] === 1) {
      return distPointSegment(x, z, c.Pos.x[zone]!, c.Pos.z[zone]!, c.Zone.x2[zone]!, c.Zone.z2[zone]!) < r;
    }
    const dx = x - c.Pos.x[zone]!;
    const dz = z - c.Pos.z[zone]!;
    return dx * dx + dz * dz < r * r;
  }

  remove(eid: number) {
    if (!this.exists(eid)) return;
    this.pendingRemove.add(eid);
  }

  clearMonsters() {
    for (const e of this.actors()) if (this.kind(e) !== Kind.Heroe) this.remove(e);
    for (const e of this.projectiles()) this.remove(e);
    for (const e of this.zones()) this.remove(e);
  }

  setInput(eid: number, input: InputFrame) {
    this.inputs.set(eid, input);
  }

  // ---------- combate ----------
  heal(target: number, amount: number) {
    if (!this.isAlive(target)) return;
    const H = this.c.Health;
    const before = H.hp[target]!;
    H.hp[target] = Math.min(H.max[target]!, before + amount);
    const real = H.hp[target]! - before;
    if (real > 0) this.emit({ t: 'heal', target, amount: Math.round(real) });
  }

  addShield(target: number, amount: number, duration: number) {
    const S = this.c.Status;
    S.shield[target] = Math.max(S.shield[target]!, amount);
    S.shieldT[target] = duration;
    this.emit({ t: 'shield', target, amount });
  }

  stun(target: number, t: number) {
    const c = this.c;
    if (!this.isAlive(target) || this.kind(target) === Kind.Muneco) return;
    c.Status.stunT[target] = Math.max(c.Status.stunT[target]!, t);
    if (c.AI.state[target] !== 0 && c.Telegraph.active[target]) {
      // Interrupción (4.1): aturdir cancela el ataque telegrafiado.
      c.Telegraph.active[target] = 0;
      c.AI.state[target] = 0;
      c.Dash.t[target] = 0;
      this.emit({ t: 'text', eid: target, msg: '¡Interrumpido!' });
    }
  }

  affinity(target: number, el: Element): number {
    const k = this.kind(target);
    if (k === Kind.Heroe || k === Kind.Aliado) return 1;
    return monsterDef(k).afinidad[el] ?? 1;
  }

  isAirborne(eid: number): boolean {
    return this.c.Pos.y[eid]! > 0.35 && !this.c.Body.floats[eid];
  }

  /**
   * Aplica daño con todas las reglas: afinidad elemental, buffs, frenesí, vulnerabilidad,
   * bloqueo/desvío perfecto, reducción, escudo y tope de poder.
   * Devuelve el daño aplicado, o -1 si fue un desvío perfecto.
   */
  damage(src: number, target: number, base: number, el: Element, opts: DamageOpts = {}): number {
    const c = this.c;
    if (!this.isAlive(target)) return 0;
    if (src >= 0 && this.exists(src) && c.Team.id[src] === c.Team.id[target]) return 0;
    const S = c.Status;
    const srcValid = src >= 0 && this.exists(src);
    const fromX = opts.fromX ?? (srcValid ? c.Pos.x[src]! : c.Pos.x[target]!);
    const fromZ = opts.fromZ ?? (srcValid ? c.Pos.z[src]! : c.Pos.z[target]!);

    // Bloqueo frontal del guerrero.
    let guardMult = 1;
    if (!opts.dot && S.guardT[target]! > 0) {
      const toSrcYaw = Math.atan2(-(fromX - c.Pos.x[target]!), -(fromZ - c.Pos.z[target]!));
      let d = Math.abs(toSrcYaw - c.Facing.yaw[target]!) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 1.4) {
        if (S.guardAge[target]! <= PERFECT_GUARD_WINDOW) {
          this.emit({ t: 'text', eid: target, msg: '¡Desvío perfecto!' });
          if (opts.melee && srcValid) this.stun(src, 1.5);
          return -1;
        }
        guardMult = 0.3;
      }
    }

    const aff = this.affinity(target, el);
    let mult = aff * guardMult;
    let frenzy = false;
    if (srcValid && !opts.dot) {
      if (S.dmgBuffT[src]! > 0) mult *= S.dmgBuff[src]!;
      if (c.Combo.frenzy[src]) {
        mult *= FRENZY_MULT;
        frenzy = true;
      }
    }
    const aereo = !opts.dot && this.isAirborne(target);
    if (aereo) mult *= 1.2;
    if (S.vulnT[target]! > 0) mult *= 1 + S.vuln[target]!;
    if (S.drT[target]! > 0) mult *= 1 - S.dr[target]!;
    mult = Math.min(mult, POWER_CAP);

    let amount = base * mult;
    let absorbed = 0;
    if (S.shield[target]! > 0) {
      absorbed = Math.min(S.shield[target]!, amount);
      S.shield[target] = S.shield[target]! - absorbed;
      amount -= absorbed;
    }
    const H = c.Health;
    H.hp[target] = H.hp[target]! - amount;
    H.lastHitTick[target] = this.tick;
    this.emit({ t: 'hit', src, target, amount: Math.round(amount), el, afinidad: aff, aereo, frenesi: frenzy, absorbido: Math.round(absorbed) });

    // Combo y frenesí (2.1).
    if (srcValid && !opts.dot && this.kind(src) === Kind.Heroe && c.Team.id[target] === TeamId.Monstruos) {
      this.addCombo(src, aereo ? 2 : 1);
    }
    if (!opts.dot && this.kind(target) === Kind.Heroe) this.breakCombo(target);

    // Malabares aéreos: el golpe cuerpo a cuerpo mantiene suspendido al enemigo.
    if (aereo && opts.melee) c.Vel.y[target] = Math.max(c.Vel.y[target]!, 3.5);

    if (opts.knock && S.knockImmuneT[target]! <= 0 && this.kind(target) !== Kind.Muneco) {
      let kx = opts.kx;
      let kz = opts.kz;
      if (kx === undefined || kz === undefined) {
        kx = c.Pos.x[target]! - fromX;
        kz = c.Pos.z[target]! - fromZ;
      }
      const l = Math.hypot(kx, kz) || 1;
      const speed = opts.knock / c.Body.mass[target]!;
      c.Knock.vx[target] = (kx / l) * speed;
      c.Knock.vz[target] = (kz / l) * speed;
      c.Knock.t[target] = 0.3;
      c.Knock.src[target] = srcValid ? src : -1;
    }

    if (H.hp[target]! <= 0) this.onLethal(target, fromX, fromZ, opts.knock ?? 4);
    return amount;
  }

  private onLethal(target: number, fromX: number, fromZ: number, force: number) {
    const c = this.c;
    const k = this.kind(target);
    if (k === Kind.Muneco) {
      c.Health.hp[target] = c.Health.max[target]!;
      this.emit({ t: 'text', eid: target, msg: 'Reiniciado' });
      return;
    }
    if (k === Kind.Heroe && this.options.inmortal) {
      c.Health.hp[target] = 1;
      return;
    }
    c.Health.hp[target] = 0;
    const dx = c.Pos.x[target]! - fromX;
    const dz = c.Pos.z[target]! - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.emit({ t: 'death', eid: target, kind: k, dx: dx / l, dz: dz / l, force: Math.max(3, force) });
    if (k === Kind.Heroe) {
      c.Health.deadT[target] = 3;
      this.breakCombo(target);
      this.clearHeroMotion(target);
    } else {
      this.remove(target);
    }
  }

  addCombo(hero: number, n: number) {
    const C = this.c.Combo;
    C.count[hero] = C.count[hero]! + n;
    C.timer[hero] = COMBO_WINDOW;
    if (!C.frenzy[hero] && C.count[hero]! >= FRENZY_COMBO) {
      C.frenzy[hero] = 1;
      C.frenzyT[hero] = FRENZY_DURATION;
      this.emit({ t: 'frenzy', eid: hero, on: true });
    }
  }

  breakCombo(hero: number) {
    const C = this.c.Combo;
    const had = C.frenzy[hero];
    C.count[hero] = 0;
    C.timer[hero] = 0;
    C.frenzy[hero] = 0;
    C.frenzyT[hero] = 0;
    if (had) this.emit({ t: 'frenzy', eid: hero, on: false });
  }

  /** Explosión (reacción aceite + fuego). Daña al bando contrario al dueño. */
  explode(owner: number, team: TeamId, x: number, z: number, r: number, dmg: number) {
    const c = this.c;
    this.emit({ t: 'explosion', x, z, r, el: Element.Fuego });
    for (const e of this.actors()) {
      if (!this.isAlive(e) || c.Team.id[e] === team) continue;
      const dx = c.Pos.x[e]! - x;
      const dz = c.Pos.z[e]! - z;
      if (dx * dx + dz * dz > r * r) continue;
      const src = this.exists(owner) ? owner : -1;
      this.damage(src, e, dmg, Element.Fuego, { knock: 13, fromX: x, fromZ: z });
      this.applyBurn(e, src, 8, 4);
    }
  }

  applyBurn(target: number, src: number, dps: number, t: number) {
    const S = this.c.Status;
    if (!this.isAlive(target)) return;
    // La afinidad se aplica en `damage` en cada pulso; aquí se guarda el daño base.
    S.burnDps[target] = Math.max(S.burnDps[target]!, dps);
    S.burnT[target] = Math.max(S.burnT[target]!, t);
    S.burnSrc[target] = src;
  }

  applyPoison(target: number, src: number, dps: number, t: number) {
    const S = this.c.Status;
    if (!this.isAlive(target)) return;
    S.poisonDps[target] = Math.max(S.poisonDps[target]!, dps);
    S.poisonT[target] = Math.max(S.poisonT[target]!, t);
    S.poisonSrc[target] = src;
  }

  // ---------- bucle ----------
  step() {
    const c = this.c;

    for (const e of this.actors()) {
      c.Pos.px[e] = c.Pos.x[e]!;
      c.Pos.py[e] = c.Pos.y[e]!;
      c.Pos.pz[e] = c.Pos.z[e]!;
      c.Facing.pyaw[e] = c.Facing.yaw[e]!;
    }
    for (const e of this.projectiles()) {
      c.Pos.px[e] = c.Pos.x[e]!;
      c.Pos.py[e] = c.Pos.y[e]!;
      c.Pos.pz[e] = c.Pos.z[e]!;
    }

    this.updateTimers();
    for (const h of this.heroes()) this.updateHero(h);
    for (const e of this.ais()) if (this.isAlive(e)) updateAI(this, e);
    this.integrate();
    this.separate();
    updateProjectiles(this);
    updateZones(this);
    this.updateDots();
    this.flushRemovals();
    this.tick++;
  }

  private updateTimers() {
    const c = this.c;
    const S = c.Status;
    const H = c.Hero;
    for (const e of this.actors()) {
      const dec = (arr: Float32Array) => {
        if (arr[e]! > 0) arr[e] = Math.max(0, arr[e]! - DT);
      };
      dec(S.dmgBuffT); dec(S.spdBuffT); dec(S.shieldT); dec(S.guardT); dec(S.drT); dec(S.knockImmuneT);
      dec(S.vulnT); dec(S.slowT); dec(S.stunT); dec(S.rootT);
      S.guardAge[e] = S.guardAge[e]! + DT;
      if (S.shieldT[e]! <= 0) S.shield[e] = 0;
      if (S.drT[e]! <= 0) S.dr[e] = 0;
      if (S.vulnT[e]! <= 0) S.vuln[e] = 0;

      const k = this.kind(e);
      if (k === Kind.Muneco && this.tick - c.Health.lastHitTick[e]! > 80 && c.Health.hp[e]! < c.Health.max[e]!) {
        c.Health.hp[e] = c.Health.max[e]!;
      }
      if (k === Kind.Heroe) {
        for (const key of CD_KEYS) dec(H[key]);
        dec(H.basicTimer);
        const C = c.Combo;
        if (C.timer[e]! > 0) {
          C.timer[e] = C.timer[e]! - DT;
          if (C.timer[e]! <= 0 && !C.frenzy[e]) C.count[e] = 0;
        }
        if (C.frenzy[e]) {
          C.frenzyT[e] = C.frenzyT[e]! - DT;
          if (C.frenzyT[e]! <= 0) this.breakCombo(e);
        }
        if (c.Health.deadT[e]! > 0) {
          c.Health.deadT[e] = c.Health.deadT[e]! - DT;
          if (c.Health.deadT[e]! <= 0) this.respawnHero(e);
        }
      }
    }
  }

  private respawnHero(e: number) {
    const c = this.c;
    c.Health.deadT[e] = 0;
    c.Health.hp[e] = c.Health.max[e]!;
    c.Pos.x[e] = c.Pos.px[e] = this.arena.spawn.x;
    c.Pos.z[e] = c.Pos.pz[e] = this.arena.spawn.z;
    c.Pos.y[e] = c.Pos.py[e] = 0;
    for (const arr of Object.values(c.Status)) arr[e] = arr instanceof Int32Array ? -1 : 0;
    this.clearHeroMotion(e);
    this.emit({ t: 'respawn', eid: e });
  }

  /** Corta la acción, la carga y el empujón en curso (al morir y al reaparecer). */
  private clearHeroMotion(e: number) {
    const c = this.c;
    c.Hero.action[e] = HeroAction.Ninguna;
    c.Hero.actionT[e] = 0;
    c.Dash.t[e] = 0;
    c.Dash.vx[e] = 0;
    c.Dash.vz[e] = 0;
    c.Dash.effect[e] = DashFx.Ninguno;
    c.Knock.t[e] = 0;
    c.Knock.vx[e] = 0;
    c.Knock.vz[e] = 0;
    c.Vel.x[e] = 0;
    c.Vel.y[e] = 0;
    c.Vel.z[e] = 0;
    this.hitSets.delete(e);
  }

  private updateHero(e: number) {
    const c = this.c;
    const H = c.Hero;
    const input = this.inputs.get(e);
    if (c.Health.deadT[e]! > 0) {
      c.Vel.x[e] = 0;
      c.Vel.z[e] = 0;
      return;
    }
    if (input) {
      H.prevButtons[e] = H.buttons[e]!;
      H.buttons[e] = input.buttons;
      const ml = Math.hypot(input.moveX, input.moveZ);
      H.moveX[e] = ml > 1 ? input.moveX / ml : input.moveX;
      H.moveZ[e] = ml > 1 ? input.moveZ / ml : input.moveZ;
      H.aimYaw[e] = input.aimYaw;
      H.aimX[e] = input.aimX;
      H.aimZ[e] = input.aimZ;
    }
    const S = c.Status;
    const stunned = S.stunT[e]! > 0;
    c.Facing.yaw[e] = H.aimYaw[e]!;

    updateHeroAction(this, e);

    if (!stunned && c.Dash.t[e]! <= 0) {
      const def = classById(H.cls[e] as ClassId);
      let speed = def.velocidad;
      if (S.spdBuffT[e]! > 0) speed *= S.spdBuff[e]!;
      if (S.slowT[e]! > 0) speed *= 1 - S.slow[e]!;
      if (S.guardT[e]! > 0) speed *= 0.5;
      if (H.action[e] === 1) speed *= 0.6;
      if (S.rootT[e]! > 0) speed = 0;
      c.Vel.x[e] = H.moveX[e]! * speed;
      c.Vel.z[e] = H.moveZ[e]! * speed;
      const btn = H.buttons[e]!;
      const pressed = btn & ~H.prevButtons[e]!;
      if (btn & Btn.Salto && c.Body.grounded[e] && S.rootT[e]! <= 0) {
        c.Vel.y[e] = 7.5;
        c.Body.grounded[e] = 0;
      }
      if (H.action[e] === 0) {
        if (btn & Btn.Ataque && H.cd0[e]! <= 0) this.tryCast(e, Slot.Basico);
        if (pressed & Btn.Movilidad) this.tryCast(e, Slot.Movilidad);
        if (pressed & Btn.Mitigacion) this.tryCast(e, Slot.Mitigacion);
        if (pressed & Btn.Principal) this.tryCast(e, Slot.Principal);
        if (pressed & Btn.Definitiva) this.tryCast(e, Slot.Definitiva);
      }
    } else if (stunned) {
      c.Vel.x[e] = 0;
      c.Vel.z[e] = 0;
    }
  }

  tryCast(e: number, slot: Slot): boolean {
    const H = this.c.Hero;
    const key = CD_KEYS[slot]!;
    if (H[key][e]! > 0) return false;
    const def = classById(H.cls[e] as ClassId).habilidades[slot]!;
    const cd = castAbility(this, e, slot);
    if (cd === false) return false;
    H[key][e] = typeof cd === 'number' ? cd : def.cd;
    this.emit({ t: 'cast', eid: e, ability: def.id, slot });
    return true;
  }

  private integrate() {
    const c = this.c;
    for (const e of this.actors()) {
      if (c.Health.deadT[e]! > 0) continue;
      let vx = c.Vel.x[e]!;
      let vz = c.Vel.z[e]!;
      const knocking = c.Knock.t[e]! > 0;
      if (knocking) {
        vx += c.Knock.vx[e]!;
        vz += c.Knock.vz[e]!;
        c.Knock.t[e] = c.Knock.t[e]! - DT;
      }
      const dashing = c.Dash.t[e]! > 0;
      if (dashing) {
        vx = c.Dash.vx[e]!;
        vz = c.Dash.vz[e]!;
      }
      if (c.Status.stunT[e]! > 0 && !knocking) {
        vx = 0;
        vz = 0;
      }
      const res = this.moveActor(e, vx, vz, knocking || dashing);

      if (res.hit) {
        const ks = Math.hypot(c.Knock.vx[e]!, c.Knock.vz[e]!);
        // Interacción física (2.4): estrellar a un enemigo contra muros o pilares.
        if (knocking && ks > WALL_SLAM_SPEED) {
          const src = c.Knock.src[e]!;
          c.Knock.t[e] = 0;
          c.Knock.vx[e] = 0;
          c.Knock.vz[e] = 0;
          this.emit({ t: 'reaction', name: '¡Contra el muro!', x: res.x, z: res.z, el: Element.Fisico });
          this.damage(this.exists(src) ? src : -1, e, 20, Element.Fisico, { fromX: res.x + res.nx, fromZ: res.z + res.nz });
          this.stun(e, 1.5);
        }
        if (dashing) onDashEnd(this, e, true);
      }
      if (dashing) {
        c.Dash.t[e] = c.Dash.t[e]! - DT;
        if (c.Dash.t[e]! <= 0 && c.Dash.effect[e]) onDashEnd(this, e, false);
      }
      if (c.Knock.t[e]! <= 0) {
        c.Knock.vx[e] = 0;
        c.Knock.vz[e] = 0;
      }

      if (!c.Body.floats[e]) {
        c.Vel.y[e] = c.Vel.y[e]! - GRAVITY * DT;
        let y = c.Pos.y[e]! + c.Vel.y[e]! * DT;
        if (y <= 0) {
          y = 0;
          c.Vel.y[e] = 0;
          c.Body.grounded[e] = 1;
        } else {
          c.Body.grounded[e] = 0;
        }
        // Encima de un sarcófago bajo: aterrizar sobre él.
        c.Pos.y[e] = y;
      }
    }
  }

  /**
   * Mueve un actor en subpasos de como mucho MAX_MOVE_STEP metros para que una carga o un empujón
   * rápido no atraviese obstáculos finos (a 20 Hz la Embestida avanza 1,2 m por tick y cruzaba los
   * sarcófagos). Si `stopOnHit`, el movimiento se corta en el primer choque (cargas y empujones).
   */
  private moveActor(e: number, vx: number, vz: number, stopOnHit: boolean): CollisionResult {
    const c = this.c;
    const r = c.Body.radius[e]!;
    const dist = Math.hypot(vx, vz) * DT;
    const steps = Math.max(1, Math.ceil(dist / Math.min(MAX_MOVE_STEP, r)));
    const sx = (vx * DT) / steps;
    const sz = (vz * DT) / steps;
    const out = moveResult;
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    let x = c.Pos.x[e]!;
    let z = c.Pos.z[e]!;
    for (let i = 0; i < steps; i++) {
      const res = resolveCircle(this.arena, x + sx, z + sz, r);
      x = res.x;
      z = res.z;
      if (res.hit) {
        out.hit = true;
        out.nx = res.nx;
        out.nz = res.nz;
        if (stopOnHit) break;
      }
    }
    c.Pos.x[e] = out.x = x;
    c.Pos.z[e] = out.z = z;
    return out;
  }

  private separate() {
    const c = this.c;
    const list = this.actors();
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (!this.isAlive(a)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (!this.isAlive(b)) continue;
        const dx = c.Pos.x[b]! - c.Pos.x[a]!;
        const dz = c.Pos.z[b]! - c.Pos.z[a]!;
        const min = c.Body.radius[a]! + c.Body.radius[b]!;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const push = min - d;
        const ma = c.Body.mass[a]!;
        const mb = c.Body.mass[b]!;
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        // En el mismo punto no hay dirección: se usa una fija para que siga siendo determinista.
        const same = d < 1e-4;
        const ux = same ? 1 : dx / d;
        const uz = same ? 0 : dz / d;
        c.Pos.x[a] = c.Pos.x[a]! - ux * push * wa;
        c.Pos.z[a] = c.Pos.z[a]! - uz * push * wa;
        c.Pos.x[b] = c.Pos.x[b]! + ux * push * wb;
        c.Pos.z[b] = c.Pos.z[b]! + uz * push * wb;
      }
    }
    for (const e of list) {
      const r = resolveCircle(this.arena, c.Pos.x[e]!, c.Pos.z[e]!, c.Body.radius[e]!);
      c.Pos.x[e] = r.x;
      c.Pos.z[e] = r.z;
    }
  }

  private updateDots() {
    const c = this.c;
    const S = c.Status;
    for (const e of this.actors()) {
      if (!this.isAlive(e)) continue;
      if (S.burnT[e]! <= 0 && S.poisonT[e]! <= 0) continue;
      S.dotTick[e] = S.dotTick[e]! + DT;
      const fire = S.dotTick[e]! >= 0.5;
      if (fire) S.dotTick[e] = 0;
      if (S.burnT[e]! > 0) {
        S.burnT[e] = S.burnT[e]! - DT;
        if (fire) this.damage(S.burnSrc[e]!, e, S.burnDps[e]! * 0.5, Element.Fuego, { dot: true });
      }
      if (S.poisonT[e]! > 0 && this.isAlive(e)) {
        S.poisonT[e] = S.poisonT[e]! - DT;
        if (fire) this.damage(S.poisonSrc[e]!, e, S.poisonDps[e]! * 0.5, Element.Veneno, { dot: true });
      }
    }
  }

  private flushRemovals() {
    for (const e of this.pendingRemove) {
      this.hitSets.delete(e);
      this.inputs.delete(e);
      if (entityExists(this.world, e)) removeEntity(this.world, e);
      this.emit({ t: 'despawn', eid: e });
    }
    this.pendingRemove.clear();
  }

  /** Dirección de apuntado del héroe. */
  aimDir(e: number) {
    return yawToDir(this.c.Hero.aimYaw[e]!);
  }

  /** ¿Hay obstáculo en el punto (para spawns)? */
  blocked(x: number, z: number, r: number) {
    return pointBlocked(this.arena, x, z, 0, r) !== null;
  }
}
