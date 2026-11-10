import { describe, expect, it } from 'vitest';
import {
  Btn, ClassId, CLASSES, Element, FRENZY_COMBO, FRENZY_MULT, Kind, Sim, Slot, ZoneDef, REACTIONS, WINDUP,
  dirToYaw, emptyInput, type InputFrame, type SimEvent,
} from '../src';

/** Crea un input que apunta del héroe hacia (tx, tz). */
function aimAt(sim: Sim, hero: number, tx: number, tz: number, buttons = 0, move = { x: 0, z: 0 }): InputFrame {
  const x = sim.c.Pos.x[hero]!;
  const z = sim.c.Pos.z[hero]!;
  return { ...emptyInput(), aimYaw: dirToYaw(tx - x, tz - z), aimX: tx, aimZ: tz, buttons, moveX: move.x, moveZ: move.z };
}

function run(sim: Sim, ticks: number, onTick?: (events: SimEvent[]) => void) {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    const ev = sim.drainEvents();
    onTick?.(ev);
  }
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  run(sim, ticks, (ev) => all.push(...ev));
  return all;
}

/** Pulsa un botón un tick y lo suelta. */
function press(sim: Sim, hero: number, btn: number, tx: number, tz: number) {
  sim.setInput(hero, aimAt(sim, hero, tx, tz, btn));
  sim.step();
  const ev = sim.drainEvents();
  sim.setInput(hero, aimAt(sim, hero, tx, tz, 0));
  return ev;
}

describe('clases', () => {
  it('hay 5 clases con 5 habilidades (básico + 4 ranuras)', () => {
    expect(CLASSES.map((c) => c.codigo)).toEqual(['guerrero', 'mago', 'arquero', 'curador', 'alquimista']);
    for (const c of CLASSES) expect(c.habilidades).toHaveLength(5);
  });

  it.each(CLASSES.map((c) => [c.nombre, c.id] as const))('el ataque básico de %s daña al muñeco', (_n, cls) => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(cls, 0, 10);
    const dummy = sim.spawnMonster(Kind.Muneco, 0, 8);
    sim.setInput(hero, aimAt(sim, hero, 0, 8, Btn.Ataque));
    run(sim, 30);
    expect(sim.c.Health.hp[dummy]).toBeLessThan(sim.c.Health.max[dummy]!);
  });

  it('cambiar de clase conserva los tiempos de reutilización de cada clase', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    press(sim, hero, Btn.Mitigacion, 0, 0);
    expect(sim.c.Hero.cd2[hero]).toBeGreaterThan(5);
    sim.setHeroClass(hero, ClassId.Mago);
    expect(sim.c.Hero.cd2[hero]).toBe(0);
    sim.setHeroClass(hero, ClassId.Guerrero);
    expect(sim.c.Hero.cd2[hero]).toBeGreaterThan(5);
  });
});

describe('soporte del mago (1.3): nunca sobre el lanzador', () => {
  it('Égida falla sin aliados y no consume el tiempo de reutilización', () => {
    const sim = new Sim(1);
    const mago = sim.spawnHero(ClassId.Mago, 0, 10);
    const ev = press(sim, mago, Btn.Mitigacion, 0, 10);
    expect(ev.some((e) => e.t === 'fail')).toBe(true);
    expect(sim.c.Status.shield[mago]).toBe(0);
    expect(sim.c.Hero.cd2[mago]).toBe(0);
  });

  it('Égida protege al aliado apuntado', () => {
    const sim = new Sim(1);
    const mago = sim.spawnHero(ClassId.Mago, 0, 10);
    const ally = sim.spawnMonster(Kind.Aliado, 4, 10);
    press(sim, mago, Btn.Mitigacion, 4, 10);
    expect(sim.c.Status.shield[ally]).toBe(80);
    expect(sim.c.Status.shield[mago]).toBe(0);
  });

  it('Encantamiento de furia potencia a los aliados pero no al mago', () => {
    const sim = new Sim(1);
    const mago = sim.spawnHero(ClassId.Mago, 0, 10);
    const ally = sim.spawnMonster(Kind.Aliado, 3, 10);
    press(sim, mago, Btn.Definitiva, 3, 10);
    expect(sim.c.Status.dmgBuffT[ally]).toBeGreaterThan(0);
    expect(sim.c.Status.dmgBuffT[mago]).toBe(0);
  });
});

describe('combos y frenesí (2.1)', () => {
  it(`al llegar a ${FRENZY_COMBO} golpes entra en frenesí y el daño sube`, () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Arquero, 0, 10);
    const dummy = sim.spawnMonster(Kind.Muneco, 0, 4);
    sim.setInput(hero, aimAt(sim, hero, 0, 4, Btn.Ataque));
    const hits: number[] = [];
    let frenzyAt = -1;
    run(sim, 200, (ev) => {
      for (const e of ev) {
        if (e.t === 'hit' && e.target === dummy) hits.push(e.amount);
        if (e.t === 'frenzy' && e.on && frenzyAt < 0) frenzyAt = hits.length;
      }
    });
    expect(frenzyAt).toBe(FRENZY_COMBO);
    expect(hits[hits.length - 1]).toBe(Math.round(14 * FRENZY_MULT));
    expect(hits[0]).toBe(14);
  });

  it('recibir un golpe rompe el frenesí', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Arquero, 0, 10);
    sim.addCombo(hero, FRENZY_COMBO);
    expect(sim.c.Combo.frenzy[hero]).toBe(1);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 9);
    sim.damage(skel, hero, 5, Element.Fisico, { melee: true });
    expect(sim.c.Combo.frenzy[hero]).toBe(0);
    expect(sim.c.Combo.count[hero]).toBe(0);
  });

  it('los golpes a enemigos en el aire cuentan doble y hacen +20%', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 8);
    sim.c.Pos.y[skel] = 2;
    const dealt = sim.damage(hero, skel, 10, Element.Fisico, { melee: true });
    expect(dealt).toBeCloseTo(10 * 1.25 * 1.2);
    expect(sim.c.Combo.count[hero]).toBe(2);
  });
});

describe('interacción física y cobertura (2.4)', () => {
  it('empujar a un enemigo contra un pilar lo aturde y le hace daño', () => {
    const sim = new Sim(1);
    // Pilar en (8, -8) con radio 1,2. El esqueleto queda entre el guerrero y el pilar.
    const hero = sim.spawnHero(ClassId.Guerrero, 8, -2);
    const skel = sim.spawnMonster(Kind.Esqueleto, 8, -5);
    sim.c.AI.cd[skel] = 99;
    const ev = [...press(sim, hero, Btn.Movilidad, 8, -8), ...collect(sim, 15)];
    expect(ev.some((e) => e.t === 'reaction' && e.name === '¡Contra el muro!')).toBe(true);
    expect(sim.c.Status.stunT[skel]).toBeGreaterThan(0);
  });

  it('un pilar bloquea la bola de fuego del cultista', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 8, -12);
    const cult = sim.spawnMonster(Kind.Cultista, 8, -4);
    // Forzar el disparo hacia el héroe, con el pilar (8,-8) en medio.
    sim.spawnProjectile(cult, 8, 8, 1.2, -5, 0, -16, 12, Element.Fuego);
    run(sim, 30);
    expect(sim.c.Health.hp[hero]).toBe(sim.c.Health.max[hero]);
  });

  it('el cultista no inicia el ataque sin línea de visión', () => {
    const sim = new Sim(1);
    sim.spawnHero(ClassId.Guerrero, 8, -10.5);
    const cult = sim.spawnMonster(Kind.Cultista, 8, -5.5);
    sim.c.AI.cd[cult] = 0;
    sim.step();
    sim.drainEvents();
    expect(sim.c.Telegraph.active[cult]).toBe(0);
  });
});

describe('sinergias elementales cruzadas (2.5)', () => {
  it('una flecha que cruza el Muro ígneo se vuelve de fuego y hace +50%', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Mago, 0, 12);
    const dummy = sim.spawnMonster(Kind.Muneco, 0, 0);
    press(sim, hero, Btn.Principal, 0, 6); // muro en z=6
    sim.setHeroClass(hero, ClassId.Arquero);
    const ev = press(sim, hero, Btn.Ataque, 0, 0);
    ev.push(...collect(sim, 20));
    expect(ev.some((e) => e.t === 'reaction' && e.name === REACTIONS.proyectilIgneo)).toBe(true);
    const hit = ev.find((e) => e.t === 'hit' && e.target === dummy && !('dot' in e));
    expect(hit && hit.t === 'hit' && hit.el).toBe(Element.Fuego);
    expect(hit && hit.t === 'hit' && hit.amount).toBe(21);
  });

  it('una flecha que cruza el Santuario se vuelve sagrada (x2 contra esqueletos)', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Curador, 0, 12);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 0);
    sim.c.AI.cd[skel] = 99;
    sim.c.Body.mass[skel] = 1000;
    press(sim, hero, Btn.Mitigacion, 0, 8);
    sim.setHeroClass(hero, ClassId.Arquero);
    const ev = [...press(sim, hero, Btn.Ataque, 0, 0), ...collect(sim, 10)];
    expect(ev.some((e) => e.t === 'reaction' && e.name === REACTIONS.flechaBendita)).toBe(true);
    const hit = ev.find((e) => e.t === 'hit' && e.target === skel);
    expect(hit && hit.t === 'hit' && hit.el).toBe(Element.Sagrado);
  });

  it('el aceite del alquimista explota con el muro ígneo del mago', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Alquimista, 0, 12);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 5);
    sim.c.AI.cd[skel] = 99;
    press(sim, hero, Btn.Principal, 0, 5);
    run(sim, 20);
    expect(sim.zones().some((z) => sim.c.Zone.def[z] === ZoneDef.Aceite)).toBe(true);
    sim.setHeroClass(hero, ClassId.Mago);
    const ev = [...press(sim, hero, Btn.Principal, 0, 5), ...collect(sim, 5)];
    expect(ev.some((e) => e.t === 'reaction' && e.name === REACTIONS.explosionAceite)).toBe(true);
    expect(sim.c.Health.max[skel]! - sim.c.Health.hp[skel]!).toBeGreaterThanOrEqual(50);
  });

  it('el fuego enemigo también enciende el aceite', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Alquimista, 0, 12);
    const cult = sim.spawnMonster(Kind.Cultista, 0, 0);
    sim.spawnZone(hero, ZoneDef.Aceite, 0, 6, 3, 10, Element.Aceite);
    sim.spawnProjectile(cult, 8, 0, 1.2, 1, 0, 16, 12, Element.Fuego);
    const ev = collect(sim, 10);
    expect(ev.some((e) => e.t === 'reaction' && e.name === REACTIONS.explosionAceite)).toBe(true);
  });
});

describe('monstruos legibles (4.1)', () => {
  it('el esqueleto telegrafía antes de golpear', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 8.5);
    sim.c.AI.cd[skel] = 0;
    sim.step();
    expect(sim.c.Telegraph.active[skel]).toBe(1);
    const windupTicks = Math.round(WINDUP.esqueleto * 20);
    run(sim, windupTicks - 2);
    expect(sim.c.Health.hp[hero]).toBe(sim.c.Health.max[hero]);
    run(sim, 3);
    expect(sim.c.Health.hp[hero]).toBeLessThan(sim.c.Health.max[hero]!);
  });

  it('aturdir durante la preparación interrumpe el ataque', () => {
    const sim = new Sim(1);
    sim.spawnHero(ClassId.Guerrero, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 8.5);
    sim.c.AI.cd[skel] = 0;
    sim.step();
    expect(sim.c.Telegraph.active[skel]).toBe(1);
    sim.stun(skel, 1);
    expect(sim.c.Telegraph.active[skel]).toBe(0);
  });

  it('las afinidades elementales se aplican (espectro casi inmune a lo físico)', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const ghost = sim.spawnMonster(Kind.Espectro, 0, 5);
    expect(sim.damage(hero, ghost, 20, Element.Fisico)).toBeCloseTo(5);
    expect(sim.damage(hero, ghost, 20, Element.Sagrado)).toBeCloseTo(40);
  });

  it('la carga del bruto contra un muro lo aturde y lo deja vulnerable', () => {
    const sim = new Sim(1);
    // Héroe al lado del muro norte; el bruto carga hacia él y se estrella.
    const hero = sim.spawnHero(ClassId.Guerrero, 0, -18.5);
    const bruto = sim.spawnMonster(Kind.Bruto, 0, -8);
    sim.c.AI.cd2[bruto] = 0;
    sim.options.inmortal = true;
    const ev = collect(sim, 60);
    expect(ev.some((e) => e.t === 'reaction' && e.name === '¡El bruto se estrella!')).toBe(true);
    void hero;
  });
});

describe('bloqueo del guerrero', () => {
  it('el desvío perfecto anula el daño y aturde al atacante', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 8.5);
    press(sim, hero, Btn.Mitigacion, 0, 8.5);
    expect(sim.damage(skel, hero, 15, Element.Fisico, { melee: true })).toBe(-1);
    expect(sim.c.Status.stunT[skel]).toBeGreaterThan(0);
  });

  it('fuera de la ventana perfecta reduce el daño frontal un 70%', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 8.5);
    press(sim, hero, Btn.Mitigacion, 0, 8.5);
    run(sim, 8);
    expect(sim.damage(skel, hero, 10, Element.Fisico, { melee: true })).toBeCloseTo(3);
  });
});

describe('determinismo', () => {
  it('dos simulaciones con la misma semilla e inputs producen el mismo estado', () => {
    const play = () => {
      const sim = new Sim(42);
      const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
      sim.spawnMonster(Kind.Esqueleto, -3, 0);
      sim.spawnMonster(Kind.Cultista, 5, -5);
      sim.spawnMonster(Kind.Bruto, 0, -10);
      sim.options.inmortal = true;
      for (let i = 0; i < 400; i++) {
        const btn = (i % 7 === 0 ? Btn.Ataque : 0) | (i % 53 === 0 ? Btn.Movilidad : 0) | (i % 97 === 0 ? Btn.Principal : 0);
        sim.setInput(hero, { ...aimAt(sim, hero, Math.sin(i / 20) * 10, 0, btn), moveX: Math.cos(i / 30), moveZ: Math.sin(i / 25) });
        sim.step();
      }
      return sim.actors().map((e) => [e, sim.c.Pos.x[e], sim.c.Pos.z[e], sim.c.Health.hp[e]]);
    };
    expect(play()).toEqual(play());
  });

  it('el héroe muerto reaparece a los 3 s', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Mago, 0, 10);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 0);
    sim.damage(skel, hero, 999, Element.Fisico);
    expect(sim.c.Health.deadT[hero]).toBeGreaterThan(0);
    const ev = collect(sim, 61);
    expect(ev.some((e) => e.t === 'respawn')).toBe(true);
    expect(sim.c.Health.hp[hero]).toBe(sim.c.Health.max[hero]);
  });
});

describe('regresiones de la auditoría', () => {
  it('el veneno aplica la afinidad una sola vez', () => {
    const sim = new Sim(1);
    const skel = sim.spawnMonster(Kind.Esqueleto, 0, 0);
    sim.applyPoison(skel, -1, 6, 4);
    run(sim, 100);
    // 6/s durante 4 s son 24; el esqueleto resiste el veneno a la mitad.
    expect(sim.c.Health.max[skel]! - sim.c.Health.hp[skel]!).toBeCloseTo(12, 3);
  });

  it('la quemadura aplica la afinidad una sola vez', () => {
    const sim = new Sim(1);
    const cult = sim.spawnMonster(Kind.Cultista, 0, 0);
    sim.applyBurn(cult, -1, 8, 4);
    run(sim, 100);
    // 8/s durante 4 s son 32; el cultista recibe un 25% del fuego.
    expect(sim.c.Health.max[cult]! - sim.c.Health.hp[cult]!).toBeCloseTo(8, 3);
  });

  it('el Torbellino golpea 5 veces', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const dummy = sim.spawnMonster(Kind.Muneco, 0, 8.5);
    const ev = press(sim, hero, Btn.Principal, 0, 8.5);
    ev.push(...collect(sim, 40));
    expect(ev.filter((e) => e.t === 'hit' && e.target === dummy)).toHaveLength(5);
  });

  it('morir en mitad de un Salto sísmico cancela el salto', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, -8, 10);
    const skel = sim.spawnMonster(Kind.Muneco, -8, 16);
    press(sim, hero, Btn.Definitiva, 0, 10);
    run(sim, 3);
    expect(sim.c.Dash.t[hero]).toBeGreaterThan(0);
    sim.damage(skel, hero, 9999, Element.Fisico);
    expect(sim.c.Dash.t[hero]).toBe(0);
    const ev = collect(sim, 80);
    expect(ev.some((e) => e.t === 'respawn')).toBe(true);
    expect(ev.some((e) => e.t === 'explosion')).toBe(false);
    expect(sim.c.Pos.x[hero]).toBeCloseTo(sim.arena.spawn.x, 3);
    expect(sim.c.Pos.z[hero]).toBeCloseTo(sim.arena.spawn.z, 3);
  });

  it('morir en mitad de un Torbellino lo detiene', () => {
    const sim = new Sim(1);
    const hero = sim.spawnHero(ClassId.Guerrero, 0, 10);
    const dummy = sim.spawnMonster(Kind.Muneco, 0, 8.5);
    press(sim, hero, Btn.Principal, 0, 8.5);
    sim.damage(dummy, hero, 9999, Element.Fisico);
    expect(sim.c.Hero.action[hero]).toBe(0);
    const ev = collect(sim, 80);
    expect(ev.filter((e) => e.t === 'hit' && e.target === dummy)).toHaveLength(0);
  });

  it('dos enemigos en el mismo punto se separan', () => {
    const sim = new Sim(1);
    const a = sim.spawnMonster(Kind.Esqueleto, 3, 3);
    const b = sim.spawnMonster(Kind.Esqueleto, 3, 3);
    run(sim, 5);
    const d = Math.hypot(sim.c.Pos.x[a]! - sim.c.Pos.x[b]!, sim.c.Pos.z[a]! - sim.c.Pos.z[b]!);
    expect(d).toBeGreaterThanOrEqual(sim.c.Body.radius[a]! + sim.c.Body.radius[b]! - 1e-3);
  });
});

void Slot;
