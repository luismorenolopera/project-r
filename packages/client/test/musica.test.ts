import { describe, expect, it } from 'vitest';
import {
  ESCALAS, PASOS, PERCUSION, TEMAS, cercana, clasesAcorde, compasesPorVuelta, duracionCompas, escalaLocal, leerAcorde, notasCompas, posicion,
  presencia, voces, type TemaId,
} from '../src/audio/partitura';
import { Fragor } from '../src/audio/fragor';

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const IDS = Object.keys(TEMAS) as TemaId[];

describe('acordes en cifrado romano', () => {
  it('lee raíz, calidad y grado', () => {
    expect(leerAcorde('i')).toMatchObject({ raiz: 0, grado: 0, intervalos: [0, 3, 7] });
    expect(leerAcorde('bVI')).toMatchObject({ raiz: 8, grado: 5, intervalos: [0, 4, 7] });
    expect(leerAcorde('V')).toMatchObject({ raiz: 7, grado: 4, intervalos: [0, 4, 7] });
    expect(leerAcorde('bII')).toMatchObject({ raiz: 1, grado: 1 });
    expect(leerAcorde('iv')).toMatchObject({ raiz: 5, intervalos: [0, 3, 7] });
    expect(leerAcorde('vii°').intervalos).toEqual([0, 3, 6]);
    expect(leerAcorde('IVsus4').intervalos).toEqual([0, 5, 7]);
    expect(leerAcorde('iadd9').intervalos).toEqual([0, 3, 7, 14]);
    expect(leerAcorde('V7').intervalos).toEqual([0, 4, 7, 10]);
    expect(() => leerAcorde('X')).toThrow();
  });

  it('la escala local adopta las notas del acorde (sensible del V, sexta del IV) sin tocar la tónica', () => {
    const v = escalaLocal(ESCALAS.eolico, leerAcorde('V'));
    expect(v).toContain(11);
    expect(v).not.toContain(10);
    expect(v).toContain(0);
    expect(v).toHaveLength(7);
    const iv = escalaLocal(ESCALAS.eolico, leerAcorde('IV'));
    expect(iv).toContain(9);
    expect(iv).not.toContain(8);
    const bvi = escalaLocal(ESCALAS.dorico, leerAcorde('bVI'));
    expect(bvi).toContain(8);
    expect(bvi).not.toContain(9);
  });

  it('reparte las voces cerca del centro', () => {
    for (let centro = 40; centro < 80; centro++) {
      for (let clase = 0; clase < 12; clase++) {
        const m = cercana(50, clase, centro);
        expect(m).toBeGreaterThanOrEqual(centro - 6);
        expect(m).toBeLessThan(centro + 6);
        expect(mod12(m - 50)).toBe(clase);
      }
    }
    const v = voces(52, leerAcorde('bVI'), 60);
    expect(v.map((m) => mod12(m - 52)).sort((a, b) => a - b)).toEqual(clasesAcorde(leerAcorde('bVI')));
  });
});

describe('temas', () => {
  it.each(IDS)('%s: forma, acordes y capas válidos', (id) => {
    const t = TEMAS[id];
    for (const letra of t.forma) expect(t.secciones[letra], `sección ${letra}`).toBeDefined();
    for (const sec of Object.values(t.secciones)) for (const c of sec) expect(() => leerAcorde(c)).not.toThrow();
    const ids = t.capas.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(duracionCompas(t)).toBeCloseTo((60 / t.bpm) * 4);
    // En reposo suenan varias capas; con el combate al máximo, todas.
    expect(t.capas.filter((c) => presencia(t.reposo, c.umbral) > 0.5).length).toBeGreaterThanOrEqual(3);
    expect(t.capas.every((c) => presencia(1, c.umbral) === 1)).toBe(true);
  });

  it.each(IDS)('%s: cada nota cae en la escala del acorde que suena y en un registro razonable', (id) => {
    const t = TEMAS[id];
    const total = compasesPorVuelta(t) * 2;
    let tonales = 0;
    for (let n = 0; n < total; n++) {
      const p = posicion(t, n);
      const escala = escalaLocal(t.escala, p.acorde);
      for (const nota of notasCompas(t, n)) {
        const capa = t.capas.find((c) => c.id === nota.capa)!;
        expect(nota.paso).toBeGreaterThanOrEqual(0);
        expect(nota.paso).toBeLessThan(PASOS);
        expect(nota.dur).toBeGreaterThan(0);
        expect(nota.vel).toBeGreaterThan(0);
        expect(nota.vel).toBeLessThanOrEqual(1);
        if (PERCUSION.has(capa.instrumento)) {
          expect(nota.midi).toBe(0);
          continue;
        }
        tonales++;
        expect(nota.midi).toBeGreaterThanOrEqual(26);
        expect(nota.midi).toBeLessThanOrEqual(96);
        expect(escala, `${capa.id} en el compás ${n} (${p.acorde.cifra})`).toContain(mod12(nota.midi - t.tonica));
      }
    }
    expect(tonales).toBeGreaterThan(total * 4);
  });

  it.each(IDS)('%s: es determinista, la base se repite cada vuelta y la melodía cada dos', (id) => {
    const t = TEMAS[id];
    const vuelta = compasesPorVuelta(t);
    const tipo = (capa: string) => t.capas.find((c) => c.id === capa)!.gen.tipo;
    const fijas = (n: number) => notasCompas(t, n).filter((x) => !['melodia', 'destellos'].includes(tipo(x.capa)));
    let comparadas = 0;
    for (let n = 0; n < vuelta; n++) {
      expect(notasCompas(t, n)).toEqual(notasCompas(t, n));
      expect(fijas(n + vuelta)).toEqual(fijas(n));
      // La melodía puede descansar una frase u otra, pero cuando suena, dos vueltas después es la misma.
      for (const capa of t.capas.filter((c) => c.gen.tipo === 'melodia')) {
        const a = notasCompas(t, n).filter((x) => x.capa === capa.id);
        const b = notasCompas(t, n + 2 * vuelta).filter((x) => x.capa === capa.id);
        if (a.length && b.length) {
          expect(b).toEqual(a);
          comparadas++;
        }
      }
    }
    if (t.capas.some((c) => c.gen.tipo === 'melodia')) expect(comparadas).toBeGreaterThan(4);
  });

  it.each(IDS)('%s: la frase final de cada sección cierra en la raíz del acorde', (id) => {
    const t = TEMAS[id];
    const melodicas = t.capas.filter((c) => c.gen.tipo === 'melodia');
    let cadencias = 0;
    for (let n = 0; n < compasesPorVuelta(t) * 2; n++) {
      const p = posicion(t, n);
      if (p.compas !== t.secciones[p.letra]!.length - 1) continue;
      for (const capa of melodicas) {
        const notas = notasCompas(t, n).filter((x) => x.capa === capa.id);
        if (!notas.length) continue;
        cadencias++;
        expect(mod12(notas.at(-1)!.midi - t.tonica)).toBe(p.acorde.raiz);
      }
    }
    if (melodicas.length) expect(cadencias).toBeGreaterThan(0);
  });

  it('los pads sostienen el acorde entero mientras dura', () => {
    const t = TEMAS.mago;
    const notas = notasCompas(t, 0).filter((x) => x.capa === 'cristal');
    expect(notas.length).toBe(clasesAcorde(leerAcorde('iadd9')).length);
    expect(notas[0]!.dur).toBe(2 * PASOS); // «iadd9» dura dos compases
    expect(notasCompas(t, 1).filter((x) => x.capa === 'cristal')).toHaveLength(0);
  });
});

describe('presencia de las capas', () => {
  it('entra suave alrededor del umbral', () => {
    expect(presencia(0, 0)).toBe(1);
    expect(presencia(0.2, 0.35)).toBe(0);
    expect(presencia(0.5, 0.35)).toBe(1);
    let antes = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      const v = presencia(x, 0.4);
      expect(v).toBeGreaterThanOrEqual(antes);
      antes = v;
    }
  });
});

describe('fragor del combate', () => {
  it('sin nada que pase, se queda en el reposo del tema', () => {
    const f = new Fragor(0.2);
    expect(f.paso(1)).toBeCloseTo(0.2);
  });

  it('más enemigos cerca, más intensidad, sin pasarse de 1', () => {
    const f = new Fragor(0.2);
    let antes = f.valor();
    for (let n = 1; n <= 30; n++) {
      f.amenaza(n);
      const v = f.valor();
      expect(v).toBeGreaterThan(antes);
      expect(v).toBeLessThanOrEqual(1);
      antes = v;
    }
    f.amenaza(3);
    expect(f.valor()).toBeGreaterThan(0.45);
    expect(f.valor()).toBeLessThan(0.55);
  });

  it('los golpes se apagan con su semivida', () => {
    const f = new Fragor(0, 4);
    f.golpe(0.2);
    expect(f.valor()).toBeCloseTo(0.2);
    f.paso(4);
    expect(f.valor()).toBeCloseTo(0.1);
    for (let i = 0; i < 20; i++) f.golpe(0.2);
    expect(f.valor()).toBeCloseTo(0.35); // tope de lo que aportan los golpes
  });

  it('con poca vida la música aprieta', () => {
    const f = new Fragor(0.2);
    f.vida(0.8);
    expect(f.valor()).toBeCloseTo(0.2);
    f.vida(0.1);
    expect(f.valor()).toBeGreaterThan(0.33);
  });
});
