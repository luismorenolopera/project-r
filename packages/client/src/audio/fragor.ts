/**
 * Fragor del combate: convierte lo que pasa en la escena en una intensidad musical de 0 a 1.
 *
 * - `amenaza`: enemigos hostiles cerca del héroe (se fija cada fotograma).
 * - `golpe`: sucesos puntuales (un combo, una muerte, un lanzamiento) que suben la intensidad y se apagan solos
 *   con una semivida de unos segundos.
 * - `vida`: fracción de vida del héroe; por debajo del 40 % la música aprieta.
 *
 * Puro y sin dependencias: lo usan los tres sandboxes y se prueba con Vitest.
 */
export class Fragor {
  private enemigos = 0;
  private acumulado = 0;
  private vidaFraccion = 1;

  /**
   * @param reposo intensidad sin combate (la del tema)
   * @param semivida segundos en los que un golpe pierde la mitad de su efecto
   */
  constructor(
    private readonly reposo: number,
    private readonly semivida = 4,
  ) {}

  amenaza(enemigosCerca: number) {
    this.enemigos = Math.max(0, enemigosCerca);
  }

  golpe(peso: number) {
    this.acumulado = Math.min(0.6, this.acumulado + Math.max(0, peso));
  }

  vida(fraccion: number) {
    this.vidaFraccion = Math.min(1, Math.max(0, fraccion));
  }

  /** Avanza el tiempo (apaga los golpes) y devuelve la intensidad. */
  paso(dt: number): number {
    this.acumulado *= Math.pow(0.5, Math.max(0, dt) / this.semivida);
    return this.valor();
  }

  valor(): number {
    // Cada enemigo suma menos que el anterior: 1 ≈ 0,12 · 3 ≈ 0,30 · 8 ≈ 0,52.
    const amenaza = 0.62 * (1 - Math.exp(-this.enemigos / 4.5));
    const golpes = Math.min(0.35, this.acumulado);
    const apuro = this.vidaFraccion < 0.4 ? 0.15 * (1 - this.vidaFraccion / 0.4) + 0.05 : 0;
    return Math.min(1, Math.max(0, this.reposo + amenaza + golpes + apuro));
  }
}
