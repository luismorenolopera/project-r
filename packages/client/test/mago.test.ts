import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BUILD_INICIAL,
  BUILDS_SUGERIDAS,
  CATEGORIAS,
  HECHIZOS,
  RANURAS,
  asignar,
  elementoEfectivo,
  escribirBuild,
  hechizo,
  leerBuild,
  normalizar,
  ponerRuna,
  puedeAsignar,
} from '../src/prototipos/mago/grimorio';
import { avanzarEstados, contarEstados, estadosNuevos, factorVelocidad, reaccionar } from '../src/prototipos/mago/reacciones';
import { astillar, casco, formaTorno, mulberry32, planosDe } from '../src/physics/fractura';

describe('grimorio', () => {
  it('cada categoría tiene al menos dos hechizos y cada hechizo exactamente 4 runas con ids únicos', () => {
    for (const c of CATEGORIAS) expect(HECHIZOS.filter((h) => h.categoria === c.id).length).toBeGreaterThanOrEqual(2);
    for (const h of HECHIZOS) {
      expect(h.runas).toHaveLength(4);
      expect(new Set(h.runas.map((r) => r.id)).size).toBe(4);
    }
    expect(new Set(HECHIZOS.map((h) => h.id)).size).toBe(HECHIZOS.length);
  });

  it('cada ranura está ligada a una categoría distinta', () => {
    expect(new Set(RANURAS.map((r) => r.categoria)).size).toBe(6);
  });

  it('sin modo libre solo se aceptan hechizos de la categoría de la ranura', () => {
    expect(puedeAsignar(0, 'ascua', false)).toBe(true);
    expect(puedeAsignar(0, 'meteorito', false)).toBe(false);
    expect(asignar(BUILD_INICIAL, 0, 'meteorito', false)).toBe(BUILD_INICIAL);
    expect(asignar(BUILD_INICIAL, 0, 'ascua', false)[0]).toEqual({ hechizo: 'ascua', runa: null });
  });

  it('en modo libre, elegir un hechizo que ya está en otra ranura los intercambia con sus runas', () => {
    const b = ponerRuna(BUILD_INICIAL, 3, 'eco');
    const c = asignar(b, 0, 'onda', true);
    expect(c[0]).toEqual({ hechizo: 'onda', runa: 'eco' });
    expect(c[3]).toEqual({ hechizo: 'dardo', runa: null });
    // La build original no cambia.
    expect(b[0]!.hechizo).toBe('dardo');
  });

  it('cambiar de hechizo quita la runa; mantener el mismo la conserva', () => {
    const b = ponerRuna(BUILD_INICIAL, 0, 'tridente');
    expect(asignar(b, 0, 'dardo', false)[0]!.runa).toBe('tridente');
    expect(asignar(b, 0, 'chispazo', false)[0]!.runa).toBeNull();
  });

  it('no acepta runas de otro hechizo', () => {
    expect(ponerRuna(BUILD_INICIAL, 0, 'cometa')).toBe(BUILD_INICIAL);
  });

  it('la runa cambia el elemento efectivo', () => {
    const esfera = hechizo('esfera');
    expect(elementoEfectivo(esfera, null)).toBe('fuego');
    expect(elementoEfectivo(esfera, 'cometa')).toBe('hielo');
    expect(elementoEfectivo(esfera, 'plasma')).toBe('rayo');
  });

  it('al salir del modo libre, las ranuras inválidas vuelven a su categoría sin repetir hechizos', () => {
    const libre = asignar(BUILD_INICIAL, 0, 'meteorito', true);
    const n = normalizar(libre, false);
    n.forEach((slot, i) => expect(hechizo(slot.hechizo).categoria).toBe(RANURAS[i]!.categoria));
    expect(new Set(n.map((x) => x.hechizo)).size).toBe(6);
  });

  it('las builds sugeridas son válidas tal cual', () => {
    for (const s of BUILDS_SUGERIDAS) expect(normalizar(s.build, s.modoLibre)).toEqual(s.build);
  });

  it('guardar y leer una build es reversible y tolera basura', () => {
    const b = ponerRuna(BUILD_INICIAL, 1, 'racimo');
    expect(leerBuild(escribirBuild(b, false))).toEqual({ build: b, modoLibre: false });
    expect(leerBuild('no es json')).toBeNull();
    const rota = leerBuild(JSON.stringify({ build: [{ hechizo: 'nada' }, null, 3], modoLibre: false }));
    expect(rota!.build).toHaveLength(6);
    rota!.build.forEach((slot, i) => expect(hechizo(slot.hechizo).categoria).toBe(RANURAS[i]!.categoria));
  });
});

describe('reacciones elementales', () => {
  it('el frío acumulado congela al llegar a 100 y ralentiza antes', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 60);
    expect(e.congelado).toBe(0);
    expect(factorVelocidad(e)).toBeLessThan(1);
    const r = reaccionar(e, 'hielo', 60);
    expect(r.congelo).toBe(true);
    expect(e.congelado).toBeGreaterThan(0);
    expect(factorVelocidad(e)).toBe(0);
  });

  it('fuego sobre congelado: Choque térmico, descongela y suma daño', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 120);
    const r = reaccionar(e, 'fuego');
    expect(r.combos).toContain('choque_termico');
    expect(r.extra).toBe(35);
    expect(e.congelado).toBe(0);
  });

  it('fuerza sobre congelado: Hacer añicos ×2,5', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 120);
    const r = reaccionar(e, 'fuerza');
    expect(r.combos).toEqual(['anicos']);
    expect(r.mult).toBe(2.5);
  });

  it('rayo sobre empapado: Electrocución con aturdimiento; hielo sobre empapado congela al instante', () => {
    const a = estadosNuevos();
    a.empapado = 5;
    const ra = reaccionar(a, 'rayo');
    expect(ra.combos).toContain('electrocucion');
    expect(a.aturdido).toBeGreaterThan(0);
    const b = estadosNuevos();
    b.empapado = 5;
    const rb = reaccionar(b, 'hielo', 10);
    expect(rb.combos).toEqual(['congelacion']);
    expect(rb.congelo).toBe(true);
  });

  it('rayo sobre enfriado: Superconductor; rayo sobre quemado: Sobrecarga', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 30);
    expect(reaccionar(e, 'rayo').combos).toContain('superconductor');
    const q = estadosNuevos();
    reaccionar(q, 'fuego');
    expect(reaccionar(q, 'rayo').combos).toContain('sobrecarga');
  });

  it('arcano detona dos o más estados (Resonancia) y los limpia', () => {
    const e = estadosNuevos();
    reaccionar(e, 'fuego');
    reaccionar(e, 'rayo', 0, true);
    expect(contarEstados(e)).toBe(2);
    const r = reaccionar(e, 'arcano');
    expect(r.combos).toEqual(['resonancia']);
    expect(r.extra).toBe(28);
    expect(contarEstados(e)).toBe(0);
    expect(e.marca).toBeGreaterThan(0);
  });

  it('los golpes secundarios (soloEstado) no provocan combos', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 120);
    expect(reaccionar(e, 'fuerza', 0, true).combos).toEqual([]);
    expect(e.congelado).toBeGreaterThan(0);
  });

  it('el mismo combo no se repite sobre el mismo objetivo antes de su espera', () => {
    const e = estadosNuevos();
    reaccionar(e, 'hielo', 40);
    expect(reaccionar(e, 'rayo').combos).toContain('superconductor');
    expect(reaccionar(e, 'rayo').combos).not.toContain('superconductor');
    avanzarEstados(e, 0.5);
    e.frio = 40;
    expect(reaccionar(e, 'rayo').combos).toContain('superconductor');
  });

  it('la quemadura hace daño mientras dura y luego se apaga', () => {
    const e = estadosNuevos();
    reaccionar(e, 'fuego');
    let total = 0;
    for (let i = 0; i < 100; i++) total += avanzarEstados(e, 0.1);
    expect(total).toBeCloseTo(28, 5);
    expect(e.quemado).toBe(0);
  });
});

describe('astillado progresivo', () => {
  const columna = casco(formaTorno([[-1.25, 0.5], [-1.0, 0.42], [0.9, 0.4], [1.25, 0.3]], 8))!;

  it('la lasca y el resto suman el volumen original y siguen siendo convexos', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = mulberry32(seed);
      const punto = new THREE.Vector3(0.5, (rnd() - 0.5) * 2, 0.1);
      const res = astillar(columna, punto, 0.15, rnd);
      if (!res) continue;
      const suma = res.resto.volumen + res.lasca.volumen;
      expect(Math.abs(suma - columna.volumen) / columna.volumen).toBeLessThan(1e-3);
      expect(res.lasca.volumen).toBeLessThan(res.resto.volumen);
      for (const t of [res.resto, res.lasca]) {
        for (const pl of planosDe(t)) for (const v of t.verts) expect(pl.n.dot(v) - pl.d).toBeLessThan(1e-4);
      }
    }
  });

  it('la lasca sale del lado del impacto', () => {
    let validos = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const res = astillar(columna, new THREE.Vector3(0.6, 0, 0), 0.12, mulberry32(seed));
      if (!res) continue;
      validos++;
      expect(res.lasca.centro.x).toBeGreaterThan(0.1);
    }
    expect(validos).toBeGreaterThan(10);
  });

  it('astillar repetidamente va mermando el objeto hasta negarse a dejar un resto diminuto', () => {
    let c = columna;
    const rnd = mulberry32(7);
    let lascas = 0;
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2;
      const res = astillar(c, new THREE.Vector3(Math.cos(a), (rnd() - 0.5) * 2, Math.sin(a)), 0.25, rnd, 0.2);
      if (!res) continue;
      c = res.resto;
      lascas++;
    }
    expect(lascas).toBeGreaterThan(5);
    expect(c.volumen).toBeLessThan(columna.volumen);
    expect(c.volumen).toBeGreaterThan(0);
  });
});
