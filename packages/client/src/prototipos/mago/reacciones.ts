import type { Elemento } from './grimorio';

/**
 * Estados elementales de un enemigo y combos que provocan al combinarse.
 * Módulo puro (sin Three.js) para poder probar las reglas con Vitest.
 *
 * Reglas (el elemento entrante reacciona con lo que ya tiene el objetivo):
 *  Fuego  + congelado            → Choque térmico (estallido de vapor, +35 de daño, descongela)
 *  Hielo  + quemado              → Choque térmico (apaga la quemadura)
 *  Fuerza + congelado            → Hacer añicos (×2,5, esquirlas a los vecinos)
 *  Rayo   + frío o congelado     → Superconductor (salta a todos los enfriados cercanos)
 *  Rayo   + quemado              → Sobrecarga (explosión que empuja)
 *  Fuego  + electrizado          → Sobrecarga
 *  Rayo   + empapado             → Electrocución (×1,6, aturde y salta a los empapados)
 *  Hielo  + empapado             → Congelación (congelado al instante)
 *  Fuego  + empapado             → Evaporación (×1,5)
 *  Arcano + 2 o más estados      → Resonancia (detona todos los estados: +14 por estado)
 */

export type ComboId =
  | 'choque_termico'
  | 'anicos'
  | 'superconductor'
  | 'sobrecarga'
  | 'electrocucion'
  | 'congelacion'
  | 'evaporacion'
  | 'resonancia'
  // Combos del entorno (no dependen de estados del enemigo).
  | 'aceite'
  | 'cristal'
  | 'impacto_muro'
  | 'incendio';

export const COMBOS: Record<ComboId, { nombre: string; receta: string; color: string }> = {
  choque_termico: { nombre: 'Choque térmico', receta: 'Fuego sobre congelado, o hielo sobre quemado', color: '#ffd0a0' },
  anicos: { nombre: 'Hacer añicos', receta: 'Fuerza (onda, nova de choque, carámbano) sobre congelado', color: '#bfefff' },
  superconductor: { nombre: 'Superconductor', receta: 'Rayo sobre enfriado o congelado', color: '#c8f4ff' },
  sobrecarga: { nombre: 'Sobrecarga', receta: 'Rayo sobre quemado, o fuego sobre electrizado', color: '#ffb84a' },
  electrocucion: { nombre: 'Electrocución', receta: 'Rayo sobre empapado (rompe una tinaja)', color: '#fff27a' },
  congelacion: { nombre: 'Congelación', receta: 'Hielo sobre empapado', color: '#8adfff' },
  evaporacion: { nombre: 'Evaporación', receta: 'Fuego sobre empapado', color: '#e8e8e8' },
  resonancia: { nombre: 'Resonancia', receta: 'Arcano sobre un enemigo con 2 o más estados', color: '#c8b0ff' },
  aceite: { nombre: 'Explosión de aceite', receta: 'Fuego o explosión sobre un barril de aceite', color: '#ff7a1a' },
  cristal: { nombre: 'Detonación de cristal', receta: 'Romper un cristal de maná (recupera maná)', color: '#a88aff' },
  impacto_muro: { nombre: 'Contra el muro', receta: 'Empujar a un enemigo contra un muro o pilar: aturdido', color: '#e8e0d0' },
  incendio: { nombre: 'Incendio', receta: 'El fuego salta de un objeto de madera a otro', color: '#ff9a3a' },
};

export interface Estados {
  /** Segundos de quemadura restantes. */
  quemado: number;
  /** Frío acumulado (0-100). Al llegar a 100, congela. */
  frio: number;
  congelado: number;
  electrizado: number;
  empapado: number;
  marca: number;
  aturdido: number;
  /** Tiempo de espera por combo y objetivo: evita que un rayo continuo dispare 10 combos por segundo. */
  icd: Partial<Record<ComboId, number>>;
}

export const DURACION = {
  quemado: 4,
  congelado: 2.5,
  congelacionInstantanea: 3,
  electrizado: 4,
  empapado: 6,
  marca: 4,
  aturdidoElectrocucion: 1.5,
  /** Frío que se pierde por segundo. */
  frioPorSegundo: 14,
  /** Daño de quemadura por segundo. */
  quemaduraDps: 7,
  icd: 0.45,
};

export function estadosNuevos(): Estados {
  return { quemado: 0, frio: 0, congelado: 0, electrizado: 0, empapado: 0, marca: 0, aturdido: 0, icd: {} };
}

/** Cuenta los estados elementales activos (los que detona la Resonancia). */
export function contarEstados(e: Estados): number {
  let n = 0;
  if (e.quemado > 0) n++;
  if (e.frio >= 25 || e.congelado > 0) n++;
  if (e.electrizado > 0) n++;
  if (e.empapado > 0) n++;
  return n;
}

/** Avanza los temporizadores. Devuelve el daño de quemadura de este intervalo. */
export function avanzarEstados(e: Estados, dt: number): number {
  let dano = 0;
  if (e.quemado > 0) {
    const t = Math.min(dt, e.quemado);
    dano = t * DURACION.quemaduraDps;
    e.quemado -= dt;
  }
  if (e.congelado <= 0) e.frio = Math.max(0, e.frio - DURACION.frioPorSegundo * dt);
  e.congelado = Math.max(0, e.congelado - dt);
  e.quemado = Math.max(0, e.quemado);
  e.electrizado = Math.max(0, e.electrizado - dt);
  e.empapado = Math.max(0, e.empapado - dt);
  e.marca = Math.max(0, e.marca - dt);
  e.aturdido = Math.max(0, e.aturdido - dt);
  for (const k of Object.keys(e.icd) as ComboId[]) {
    const v = (e.icd[k] ?? 0) - dt;
    if (v <= 0) delete e.icd[k];
    else e.icd[k] = v;
  }
  return dano;
}

/** Factor de velocidad por frío: 1 sin frío, 0,35 casi congelado, 0 congelado o aturdido. */
export function factorVelocidad(e: Estados): number {
  if (e.congelado > 0 || e.aturdido > 0) return 0;
  return 1 - (e.frio / 100) * 0.65;
}

export interface Reaccion {
  combos: ComboId[];
  /** Multiplicador del daño del golpe que provocó la reacción. */
  mult: number;
  /** Daño plano añadido al objetivo. */
  extra: number;
  /** Número de estados detonados (Resonancia). */
  detonados: number;
  /** El golpe acaba de congelar al objetivo (por frío acumulado o Congelación). */
  congelo: boolean;
}

function disponible(e: Estados, c: ComboId) {
  return !(e.icd[c]! > 0);
}

/**
 * Aplica un elemento sobre los estados de un objetivo y resuelve los combos.
 * Modifica `e`. `frio` es el frío que aporta el golpe si es de hielo.
 * Con `soloEstado` se aplican estados sin provocar combos (golpes secundarios de un combo).
 */
export function reaccionar(e: Estados, elem: Elemento, frio = 25, soloEstado = false): Reaccion {
  const res: Reaccion = { combos: [], mult: 1, extra: 0, detonados: 0, congelo: false };
  const combo = (c: ComboId) => {
    if (soloEstado || !disponible(e, c)) return false;
    e.icd[c] = DURACION.icd;
    res.combos.push(c);
    return true;
  };
  const congelar = (t: number) => {
    if (e.congelado <= 0) res.congelo = true;
    e.congelado = Math.max(e.congelado, t);
    e.frio = 0;
  };

  switch (elem) {
    case 'fuego': {
      if (e.congelado > 0 && combo('choque_termico')) {
        e.congelado = 0;
        e.frio = 0;
        res.extra += 35;
      }
      if (e.electrizado > 0 && combo('sobrecarga')) e.electrizado = 0;
      if (e.empapado > 0) {
        if (combo('evaporacion')) res.mult *= 1.5;
        e.empapado = 0;
      }
      e.frio = Math.max(0, e.frio - 30);
      e.quemado = DURACION.quemado;
      break;
    }
    case 'hielo': {
      if (e.quemado > 0 && combo('choque_termico')) {
        e.quemado = 0;
        res.extra += 35;
        break;
      }
      if (e.empapado > 0) {
        e.empapado = 0;
        if (combo('congelacion')) congelar(DURACION.congelacionInstantanea);
        else congelar(DURACION.congelado);
        break;
      }
      if (e.congelado > 0) {
        e.congelado = Math.max(e.congelado, Math.min(DURACION.congelado, e.congelado + frio / 100));
        break;
      }
      e.frio += frio;
      if (e.frio >= 100) congelar(DURACION.congelado);
      break;
    }
    case 'rayo': {
      if (e.empapado > 0 && combo('electrocucion')) {
        e.empapado = 0;
        res.mult *= 1.6;
        e.aturdido = Math.max(e.aturdido, DURACION.aturdidoElectrocucion);
      }
      if ((e.frio > 0 || e.congelado > 0) && combo('superconductor')) res.mult *= 1.2;
      if (e.quemado > 0 && combo('sobrecarga')) e.quemado = 0;
      e.electrizado = DURACION.electrizado;
      break;
    }
    case 'fuerza': {
      if (e.congelado > 0 && combo('anicos')) {
        e.congelado = 0;
        e.frio = 0;
        res.mult *= 2.5;
      }
      break;
    }
    case 'arcano': {
      const n = contarEstados(e);
      if (n >= 2 && combo('resonancia')) {
        res.detonados = n;
        res.extra += 14 * n;
        e.quemado = 0;
        e.frio = 0;
        e.congelado = 0;
        e.electrizado = 0;
        e.empapado = 0;
      }
      e.marca = DURACION.marca;
      break;
    }
  }
  return res;
}

/** Multiplicador por marca arcana: el objetivo marcado recibe un 15% más de daño de cualquier fuente. */
export function multiplicadorMarca(e: Estados): number {
  return e.marca > 0 ? 1.15 : 1;
}
