import { describe, expect, it } from 'vitest';
import { Btn, ClassId, Element, Kind, Sim, dirToYaw, emptyInput } from '../src';

/**
 * Colisiones cinemáticas de la simulación compartida (20 Hz).
 * El sarcófago central de la cripta ocupa z ∈ [-1,6, -0,6] y x ∈ [-2, 2]: 1 m de grosor.
 */
describe('física de la simulación compartida', () => {
  it('la Embestida no atraviesa un sarcófago aunque se lance pegado a él', () => {
    for (const z0 of [0, 0.05, 0.2, 0.5]) {
      const sim = new Sim(1);
      const h = sim.spawnHero(ClassId.Guerrero, 0, z0);
      const input = { ...emptyInput(), aimYaw: dirToYaw(0, -1), aimX: 0, aimZ: -10 };
      sim.setInput(h, { ...input, buttons: Btn.Movilidad });
      sim.step();
      sim.setInput(h, input);
      for (let i = 0; i < 20; i++) sim.step();
      // Se queda delante de la cara del sarcófago (z = -0,6 + radio 0,45).
      expect(sim.c.Pos.z[h]!).toBeGreaterThan(-0.6);
    }
  });

  it('un empujón muy fuerte estrella al enemigo contra el sarcófago en vez de cruzarlo', () => {
    const sim = new Sim(1);
    const h = sim.spawnHero(ClassId.Guerrero, 0, 4);
    const e = sim.spawnMonster(Kind.Espectro, 0, 0);
    sim.damage(h, e, 1, Element.Fisico, { knock: 30, kx: 0, kz: -1 });
    const ev: string[] = [];
    for (let i = 0; i < 6; i++) {
      sim.step();
      for (const x of sim.drainEvents()) if (x.t === 'reaction') ev.push(x.name);
    }
    expect(sim.c.Pos.z[e]!).toBeGreaterThan(-0.6);
    expect(ev).toContain('¡Contra el muro!');
  });
});
