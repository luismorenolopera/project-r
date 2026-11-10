import { describe, expect, it } from 'vitest';
import {
  IDS_MATERIAL,
  INTERACCIONES,
  MAX_MATERIA,
  anadir,
  arma,
  interaccionPara,
  inventarioVacio,
  materiaDe,
  materialDe,
  meterEnCrisol,
  pagar,
  puedePagar,
  receta,
  textoCoste,
  tiempoDescomponer,
  todasLasRecetas,
  unidades,
} from '../src/prototipos/alquimista/materia';

describe('materia del alquimista', () => {
  it('cada objeto del entorno da el material que le corresponde', () => {
    expect(materialDe({ material: 'madera' })).toBe('madera');
    expect(materialDe({ material: 'madera', explosivo: true })).toBe('aceite');
    expect(materialDe({ material: 'barro', agua: true })).toBe('agua');
    expect(materialDe({ material: 'barro' })).toBe('piedra');
    expect(materialDe({ material: 'piedra' })).toBe('piedra');
    expect(materialDe({ material: 'cristal' })).toBe('cristal');
    expect(materialDe({ material: 'hielo' })).toBe('agua');
    expect(materialDe({ material: 'metal' })).toBe('metal');
  });

  it('la materia crece con el volumen y un escombro rinde menos que el objeto entero', () => {
    const entero = materiaDe({ material: 'piedra' }, 1);
    const escombro = materiaDe({ material: 'piedra' }, 1, 0.7);
    expect(entero.n).toBeCloseTo(5);
    expect(escombro.n).toBeLessThan(entero.n);
    expect(materiaDe({ material: 'piedra' }, 0.001).n).toBeGreaterThan(0);
    expect(materiaDe({ material: 'piedra' }, 100).n).toBeLessThanOrEqual(10);
    expect(tiempoDescomponer(0.1)).toBeLessThan(tiempoDescomponer(1.5));
    expect(tiempoDescomponer(50)).toBeLessThanOrEqual(1.6);
  });

  it('el inventario admite fracciones, tiene tope y solo gasta unidades enteras', () => {
    const inv = inventarioVacio();
    anadir(inv, 'piedra', 1.6);
    expect(unidades(inv, 'piedra')).toBe(1);
    expect(puedePagar(inv, { piedra: 2 })).toBe(false);
    expect(pagar(inv, { piedra: 2 })).toBe(false);
    expect(inv.piedra).toBeCloseTo(1.6);
    anadir(inv, 'piedra', 0.5);
    expect(pagar(inv, { piedra: 2 })).toBe(true);
    expect(inv.piedra).toBeCloseTo(0.1);
    expect(anadir(inv, 'metal', 999)).toBe(MAX_MATERIA);
    expect(inv.metal).toBe(MAX_MATERIA);
    expect(anadir(inv, 'agua', -5)).toBe(0);
  });

  it('el crisol guarda base y catalizador y empieza de nuevo al llenarse', () => {
    let c = meterEnCrisol([], 'piedra');
    expect(c).toEqual(['piedra']);
    c = meterEnCrisol(c, 'aceite');
    expect(c).toEqual(['piedra', 'aceite']);
    c = meterEnCrisol(c, 'agua');
    expect(c).toEqual(['agua']);
  });
});

describe('recetas', () => {
  it('hay 42 recetas (6 bases × sin catalizador + 6) con nombres y claves únicos', () => {
    const todas = todasLasRecetas();
    expect(todas).toHaveLength(42);
    expect(new Set(todas.map((r) => r.clave)).size).toBe(42);
    expect(new Set(todas.map((r) => r.nombre)).size).toBe(42);
    expect(receta([])).toBeNull();
    expect(arma([])).toBeNull();
  });

  it('la base da la forma y el catalizador el elemento, con concordancia de género', () => {
    expect(receta(['piedra'])!.nombre).toBe('Púas');
    expect(receta(['piedra', 'aceite'])!.nombre).toBe('Púas ígneas');
    expect(receta(['piedra', 'aceite'])!.elemento).toBe('fuego');
    expect(receta(['cristal', 'agua'])!.nombre).toBe('Prisma gélido');
    expect(receta(['cristal', 'agua'])!.elemento).toBe('hielo');
    expect(receta(['metal', 'cristal'])!.elemento).toBe('rayo');
    expect(receta(['agua', 'piedra'])!.nombre).toBe('Chorro pesado');
    expect(arma(['madera', 'metal'])!.nombre).toBe('Lanza afilada');
    expect(arma(['piedra', 'aceite'])!.nombre).toBe('Mazo ígneo');
    expect(arma(['agua', 'agua'])!.nombre).toBe('Gran látigo');
  });

  it('el mismo material dos veces da la versión gran, que cuesta 4 de ese material', () => {
    const r = receta(['piedra', 'piedra'])!;
    expect(r.gran).toBe(true);
    expect(r.nombre).toBe('Muralla de púas');
    expect(r.coste).toEqual({ piedra: 4 });
    expect(r.dano).toBeGreaterThan(receta(['piedra'])!.dano);
  });

  it('los costes son base 2 (+1 de catalizador); forjar cuesta más que lanzar', () => {
    expect(receta(['madera'])!.coste).toEqual({ madera: 2 });
    expect(receta(['madera', 'agua'])!.coste).toEqual({ madera: 2, agua: 1 });
    for (const r of todasLasRecetas()) {
      const a = arma(r.clave.split('+') as never)!;
      const total = (c: object) => Object.values(c).reduce((x: number, y) => x + (y as number), 0);
      expect(total(a.coste)).toBeGreaterThan(total(r.coste));
    }
    expect(textoCoste({ piedra: 2, aceite: 1 })).toBe('2 Piedra + 1 Aceite');
  });

  it('cada catalizador cambia algo medible', () => {
    const base = receta(['metal'])!;
    expect(receta(['metal', 'piedra'])!.empuje).toBeGreaterThan(base.empuje);
    expect(receta(['metal', 'piedra'])!.aturdir).toBeGreaterThan(0);
    expect(receta(['metal', 'madera'])!.cantidad).toBeGreaterThan(base.cantidad);
    expect(receta(['piedra', 'metal'])!.perfora).toBe(true);
    expect(receta(['piedra', 'metal'])!.dano).toBeGreaterThan(receta(['piedra'])!.dano);
    expect(receta(['piedra', 'agua'])!.frio).toBeGreaterThan(0);
    const lanza = arma(['madera'])!;
    expect(arma(['madera', 'madera'])!.usosMax).toBeGreaterThan(lanza.usosMax);
    expect(arma(['madera', 'metal'])!.stats.dano).toBeGreaterThan(lanza.stats.dano);
    expect(arma(['piedra', 'piedra'])!.stats.alcance).toBeGreaterThan(arma(['piedra'])!.stats.alcance);
    expect(arma(['cristal', 'metal'])!.stats.perfora).toBe(true);
    for (const m of IDS_MATERIAL) expect(arma([m])!.stats.usos).toBeGreaterThan(0);
  });
});

describe('transmutar el entorno', () => {
  it('cada material del entorno tiene su interacción y todas están descritas', () => {
    expect(interaccionPara('suelo')).toBe('pilar');
    expect(interaccionPara('enemigo')).toBe('grilletes');
    expect(interaccionPara({ material: 'piedra' })).toBe('estallido');
    expect(interaccionPara({ material: 'barro' })).toBe('estallido');
    expect(interaccionPara({ material: 'madera' })).toBe('zarzas');
    expect(interaccionPara({ material: 'madera', explosivo: true })).toBe('bomba');
    expect(interaccionPara({ material: 'barro', agua: true })).toBe('congelar');
    expect(interaccionPara({ material: 'cristal' })).toBe('pararrayos');
    expect(interaccionPara({ material: 'metal' })).toBe('erizo');
    expect(Object.keys(INTERACCIONES)).toHaveLength(8);
    for (const d of Object.values(INTERACCIONES)) expect(d.desc.length).toBeGreaterThan(10);
  });
});
