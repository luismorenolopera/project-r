import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { casco, fracturar, formaCaja, formaTorno, mulberry32, planosDe } from '../src/prototipos/embestida/fractura';

const formas = {
  caja: formaCaja(1, 1, 1),
  barril: formaTorno([[-0.5, 0.36], [0, 0.45], [0.5, 0.36]], 8),
  urna: formaTorno([[-0.4, 0], [-0.38, 0.18], [-0.1, 0.36], [0.2, 0.3], [0.38, 0.14], [0.4, 0.15]], 7),
};

describe('fractura convexa', () => {
  it('el casco de una caja tiene 6 caras cuadradas y volumen correcto', () => {
    const c = casco(formaCaja(2, 1, 0.5))!;
    expect(c.faces.length).toBe(6);
    expect(c.faces.every((f) => f.length === 4)).toBe(true);
    expect(c.volumen).toBeCloseTo(1, 6);
  });

  for (const [nombre, pts] of Object.entries(formas)) {
    it(`${nombre}: los trozos conservan el volumen, son convexos y miran hacia fuera`, () => {
      const original = casco(pts)!;
      for (let seed = 1; seed <= 20; seed++) {
        const trozos = fracturar(original, new THREE.Vector3(0.3, 0.1, -0.2), 10, mulberry32(seed));
        expect(trozos.length).toBeGreaterThanOrEqual(6);
        const suma = trozos.reduce((s, t) => s + t.volumen, 0);
        expect(Math.abs(suma - original.volumen) / original.volumen).toBeLessThan(1e-3);
        for (const t of trozos) {
          expect(t.volumen).toBeGreaterThan(0);
          // Convexidad + orientación: todos los vértices quedan detrás de cada cara.
          for (const pl of planosDe(t)) {
            for (const v of t.verts) expect(pl.n.dot(v) - pl.d).toBeLessThan(1e-4);
            expect(pl.n.dot(t.centro) - pl.d).toBeLessThan(0);
          }
        }
      }
    });
  }
});
