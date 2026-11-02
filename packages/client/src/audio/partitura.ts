/**
 * Partitura procedural de la sala de pruebas.
 *
 * Teoría mínima (escalas, acordes en cifrado romano), los cuatro temas y la generación determinista de las notas
 * de cada compás. No toca Web Audio: el motor (`musica.ts`) pide las notas de un compás y las programa.
 * Así la parte musical se prueba con Vitest y la misma semilla suena siempre igual.
 */

export const PASOS = 16; // semicorcheas por compás (4/4)

export type TemaId = 'menu' | 'combate' | 'embestida' | 'mago';

export type Instrumento =
  | 'pad'
  | 'cristal'
  | 'coro'
  | 'dron'
  | 'cuerdas'
  | 'arpa'
  | 'celesta'
  | 'campana'
  | 'bajo'
  | 'bajo_suave'
  | 'metal'
  | 'taiko'
  | 'marco'
  | 'sonajero';

export const PERCUSION: ReadonlySet<Instrumento> = new Set(['taiko', 'marco', 'sonajero']);

export interface Nota {
  capa: string;
  /** Semicorchea del compás en la que empieza (0 a 15). */
  paso: number;
  /** Duración en semicorcheas (puede pasar del compás: el motor la respeta). */
  dur: number;
  /** Altura MIDI (0 en percusión). */
  midi: number;
  /** Intensidad del golpe, de 0 a 1. */
  vel: number;
}

// ---------------------------------------------------------------- teoría
export const ESCALAS = {
  eolico: [0, 2, 3, 5, 7, 8, 10],
  dorico: [0, 2, 3, 5, 7, 9, 10],
  frigio: [0, 1, 3, 5, 7, 8, 10],
  menorArmonica: [0, 2, 3, 5, 7, 8, 11],
} as const;

export function midiAHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

export interface Acorde {
  cifra: string;
  /** Raíz en semitonos sobre la tónica (0 a 11). */
  raiz: number;
  /** Grado de la escala sobre el que se construye (0 = I ... 6 = VII). */
  grado: number;
  /** Intervalos sobre la raíz, ordenados (pueden pasar de 12, como la novena). */
  intervalos: number[];
}

const NUMERALES = ['vii', 'vi', 'iv', 'v', 'iii', 'ii', 'i']; // de más largo a más corto para leer bien "vii" o "iv"
const GRADO_MAYOR: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };
const INDICE_GRADO: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
/** Qué grado de la escala ocupa cada intervalo del acorde, contado desde su raíz (tercera = 2 grados arriba...). */
const GRADO_DE_INTERVALO: Record<number, number> = { 0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6, 14: 1 };

/**
 * Lee un acorde en cifrado romano relativo a la tónica: mayúscula = mayor, minúscula = menor,
 * `b`/`#` delante altera la raíz (las raíces se miden sobre la escala mayor: en menor, `bVI` es el sexto grado),
 * y detrás admite `°` (disminuido), `+` (aumentado), `7`, `sus2`, `sus4` y `add9`.
 */
export function leerAcorde(cifra: string): Acorde {
  let resto = cifra.trim();
  let alteracion = 0;
  if (resto.startsWith('b')) {
    alteracion = -1;
    resto = resto.slice(1);
  } else if (resto.startsWith('#')) {
    alteracion = 1;
    resto = resto.slice(1);
  }
  const numeral = NUMERALES.find((n) => resto.toLowerCase().startsWith(n));
  if (!numeral) throw new Error(`Acorde no válido: ${cifra}`);
  const escrito = resto.slice(0, numeral.length);
  const sufijo = resto.slice(numeral.length);
  const mayor = escrito === escrito.toUpperCase();
  let intervalos = mayor ? [0, 4, 7] : [0, 3, 7];
  if (sufijo.includes('°')) intervalos = [0, 3, 6];
  if (sufijo.includes('+')) intervalos = [0, 4, 8];
  if (sufijo.includes('sus4')) intervalos = [0, 5, 7];
  if (sufijo.includes('sus2')) intervalos = [0, 2, 7];
  if (/(^|[^d])7/.test(sufijo.replace('add9', ''))) intervalos = [...intervalos, 10];
  if (sufijo.includes('add9')) intervalos = [...intervalos, 14];
  return { cifra, raiz: mod12(GRADO_MAYOR[numeral]! + alteracion), grado: INDICE_GRADO[numeral]!, intervalos };
}

/** Clases de altura (0 a 11, sobre la tónica) del acorde. */
export function clasesAcorde(a: Acorde): number[] {
  return [...new Set(a.intervalos.map((i) => mod12(a.raiz + i)))].sort((x, y) => x - y);
}

/**
 * Escala que manda sobre un acorde: la del tema, con cada grado que el acorde ocupa cambiado por la nota del acorde.
 * Así el V de una tonalidad menor trae su sensible y el IV mayor del dórico su sexta mayor, y la melodía las respeta.
 */
export function escalaLocal(escala: readonly number[], a: Acorde): number[] {
  const res = [...escala];
  for (const iv of a.intervalos) {
    const grado = (a.grado + (GRADO_DE_INTERVALO[iv] ?? 0)) % escala.length;
    res[grado] = mod12(a.raiz + iv);
  }
  return res.sort((x, y) => x - y);
}

/** La nota MIDI de clase `clase` (sobre `tonica`) más cercana a `centro`, dentro de [centro-6, centro+6). */
export function cercana(tonica: number, clase: number, centro: number): number {
  const base = centro - 6;
  return base + mod12(tonica + clase - base);
}

/** Notas MIDI del acorde repartidas alrededor de `centro` (voces cercanas: el enlace entre acordes sale solo). */
export function voces(tonica: number, a: Acorde, centro: number): number[] {
  return clasesAcorde(a)
    .map((c) => cercana(tonica, c, centro))
    .sort((x, y) => x - y);
}

// ---------------------------------------------------------------- temas
export type Generador =
  /** Acorde sostenido mientras dure (pads, coro). */
  | { tipo: 'acorde'; centro: number }
  /** Pedal de tónica (y quinta) cada cuatro compases. */
  | { tipo: 'dron'; centro: number; quinta?: boolean }
  /**
   * Patrón de semicorcheas sobre las notas del acorde. Cifra = índice en las notas del acorde, de grave a agudo
   * desde la raíz más cercana a `centro` (0 raíz, 1 tercera, 2 quinta, 3 octava...). `.` deja sonar la anterior,
   * `_` la corta. Con varios patrones, cada compás usa el siguiente.
   */
  | { tipo: 'patron'; centro: number; patrones: string[] }
  /** Percusión: `X` acento, `x` normal, `o` suave, `.` nada. */
  | { tipo: 'percusion'; patrones: string[] }
  /**
   * Melodía generada en frases de dos compases (A A' B A con cadencia). `ritmos` son células de un compás:
   * `x` ataque, `-` sostiene, `.` silencio. `densidad` es la probabilidad de que suene cada frase.
   */
  | { tipo: 'melodia'; centro: number; densidad: number; ritmos: string[] }
  /** Notas sueltas y agudas del acorde, de vez en cuando (campanas). */
  | { tipo: 'destellos'; centro: number; probabilidad: number };

export interface Capa {
  id: string;
  instrumento: Instrumento;
  /** Intensidad desde la que entra (0 = siempre suena). */
  umbral: number;
  volumen: number;
  pan?: number;
  /** Envío a la reverberación (0 a 1). */
  reverb?: number;
  /** Envío al eco (0 a 1). */
  eco?: number;
  /** Letras de sección en las que suena (por defecto, en todas). */
  soloEn?: string;
  gen: Generador;
}

export interface Tema {
  id: TemaId;
  nombre: string;
  bpm: number;
  /** Tónica en MIDI. */
  tonica: number;
  escala: readonly number[];
  /** Cada sección es una lista de acordes, uno por compás (repetirlo lo sostiene). */
  secciones: Record<string, string[]>;
  /** Orden de las secciones, p. ej. "AABA". */
  forma: string;
  capas: Capa[];
  /** Intensidad de reposo: lo que suena sin combate. */
  reposo: number;
  /** Floritura para los momentos fuertes (combos del mago). */
  acento: { instrumento: Instrumento; centro: number };
  semilla: number;
}

export const TEMAS: Record<TemaId, Tema> = {
  menu: {
    id: 'menu',
    nombre: 'Sala de pruebas',
    bpm: 66,
    tonica: 50, // re
    escala: ESCALAS.eolico,
    secciones: {
      A: ['i', 'i', 'bVI', 'bVI', 'bIII', 'bIII', 'bVII', 'v'],
      B: ['iv', 'iv', 'i', 'i', 'bVI', 'bVII', 'i', 'i'],
    },
    forma: 'AABA',
    reposo: 0.3,
    acento: { instrumento: 'campana', centro: 81 },
    semilla: 11,
    capas: [
      { id: 'dron', instrumento: 'dron', umbral: 0, volumen: 0.45, reverb: 0.3, gen: { tipo: 'dron', centro: 38, quinta: true } },
      { id: 'pad', instrumento: 'pad', umbral: 0, volumen: 0.45, reverb: 0.55, gen: { tipo: 'acorde', centro: 60 } },
      {
        id: 'arpa', instrumento: 'arpa', umbral: 0, volumen: 0.5, pan: 0.3, reverb: 0.5, eco: 0.3,
        gen: { tipo: 'patron', centro: 57, patrones: ['0.1.2.3.4.3.2.1.', '0.2.3.4.5.4.3.2.'] },
      },
      {
        id: 'celesta', instrumento: 'celesta', umbral: 0, volumen: 0.6, pan: -0.25, reverb: 0.6, eco: 0.35, soloEn: 'A',
        gen: { tipo: 'melodia', centro: 74, densidad: 0.7, ritmos: ['x---x---x-------', 'x-------x---x---', 'x---x-x-x-------', 'x-----x-x-------'] },
      },
      { id: 'campana', instrumento: 'campana', umbral: 0, volumen: 0.3, pan: 0.45, reverb: 0.85, gen: { tipo: 'destellos', centro: 81, probabilidad: 0.45 } },
      { id: 'coro', instrumento: 'coro', umbral: 0, volumen: 0.32, reverb: 0.7, soloEn: 'B', gen: { tipo: 'acorde', centro: 64 } },
    ],
  },

  combate: {
    id: 'combate',
    nombre: 'Cripta de los cinco',
    bpm: 100,
    tonica: 52, // mi
    escala: ESCALAS.eolico,
    secciones: {
      A: ['i', 'i', 'bVI', 'bVII', 'i', 'i', 'bVI', 'V'],
      B: ['iv', 'iv', 'bVI', 'bVII', 'iv', 'bVI', 'V', 'V'],
    },
    forma: 'AABA',
    reposo: 0.2,
    acento: { instrumento: 'metal', centro: 64 },
    semilla: 23,
    capas: [
      { id: 'dron', instrumento: 'dron', umbral: 0, volumen: 0.4, reverb: 0.25, gen: { tipo: 'dron', centro: 40, quinta: true } },
      { id: 'pad', instrumento: 'pad', umbral: 0, volumen: 0.4, reverb: 0.5, gen: { tipo: 'acorde', centro: 59 } },
      { id: 'bajo', instrumento: 'bajo', umbral: 0.15, volumen: 0.5, reverb: 0.1, gen: { tipo: 'patron', centro: 40, patrones: ['0..0..0.0..0..2.', '0..0..0.0..0.32.'] } },
      {
        id: 'cuerdas', instrumento: 'cuerdas', umbral: 0.3, volumen: 0.38, pan: -0.3, reverb: 0.35,
        gen: { tipo: 'patron', centro: 55, patrones: ['0232023202320232', '0232023202321232'] },
      },
      {
        id: 'taiko', instrumento: 'taiko', umbral: 0.35, volumen: 0.7, reverb: 0.25,
        gen: { tipo: 'percusion', patrones: ['X..x..x.X...x...', 'X..x..x.X...x.o.', 'X..x..x.X...x...', 'X..x..x.X.x.XxXx'] },
      },
      { id: 'marco', instrumento: 'marco', umbral: 0.5, volumen: 0.65, pan: 0.15, reverb: 0.3, gen: { tipo: 'percusion', patrones: ['....X.......X...', '....X.......X..o'] } },
      { id: 'sonajero', instrumento: 'sonajero', umbral: 0.68, volumen: 0.35, pan: 0.35, reverb: 0.2, gen: { tipo: 'percusion', patrones: ['x.o.x.o.x.o.x.oo'] } },
      {
        id: 'metal', instrumento: 'metal', umbral: 0.55, volumen: 0.5, pan: 0.1, reverb: 0.5,
        gen: { tipo: 'melodia', centro: 64, densidad: 0.8, ritmos: ['x-------x---x---', 'x-----x-x-------', 'x---x---x---x---', 'x-----------x---'] },
      },
      { id: 'coro', instrumento: 'coro', umbral: 0.78, volumen: 0.38, reverb: 0.7, gen: { tipo: 'acorde', centro: 64 } },
    ],
  },

  embestida: {
    id: 'embestida',
    nombre: 'Carga del guerrero',
    bpm: 116,
    tonica: 45, // la
    escala: ESCALAS.frigio,
    secciones: {
      A: ['i', 'i', 'bII', 'i', 'i', 'i', 'bVII', 'bII'],
      B: ['bVI', 'bVII', 'i', 'i', 'bVI', 'bVII', 'V', 'V'],
    },
    forma: 'AABA',
    reposo: 0.3,
    acento: { instrumento: 'metal', centro: 60 },
    semilla: 37,
    capas: [
      { id: 'dron', instrumento: 'dron', umbral: 0, volumen: 0.4, reverb: 0.25, gen: { tipo: 'dron', centro: 45, quinta: true } },
      { id: 'bajo', instrumento: 'bajo', umbral: 0, volumen: 0.5, reverb: 0.1, gen: { tipo: 'patron', centro: 45, patrones: ['0.000.000.000.00', '0.000.000.000.23'] } },
      { id: 'taiko', instrumento: 'taiko', umbral: 0.2, volumen: 0.7, reverb: 0.25, gen: { tipo: 'percusion', patrones: ['X...x...X...x...', 'X...x...X...x...', 'X...x...X...x...', 'X...x...X.x.XxXx'] } },
      {
        id: 'metal', instrumento: 'metal', umbral: 0.35, volumen: 0.5, reverb: 0.45,
        gen: { tipo: 'melodia', centro: 57, densidad: 0.85, ritmos: ['x-------x-------', 'x-----x-x-------', 'x---------------', 'x---x---x-------'] },
      },
      { id: 'marco', instrumento: 'marco', umbral: 0.45, volumen: 0.65, pan: -0.15, reverb: 0.3, gen: { tipo: 'percusion', patrones: ['....X.......X...'] } },
      { id: 'cuerdas', instrumento: 'cuerdas', umbral: 0.55, volumen: 0.38, pan: 0.3, reverb: 0.35, gen: { tipo: 'patron', centro: 57, patrones: ['0.1.2.1.0.1.2.3.'] } },
      { id: 'sonajero', instrumento: 'sonajero', umbral: 0.65, volumen: 0.32, pan: -0.35, reverb: 0.2, gen: { tipo: 'percusion', patrones: ['x.x.x.x.x.x.x.x.'] } },
      { id: 'coro', instrumento: 'coro', umbral: 0.75, volumen: 0.38, reverb: 0.7, gen: { tipo: 'acorde', centro: 62 } },
    ],
  },

  mago: {
    id: 'mago',
    nombre: 'Biblioteca en ruinas',
    bpm: 80,
    tonica: 54, // fa sostenido
    escala: ESCALAS.dorico,
    secciones: {
      A: ['iadd9', 'iadd9', 'IV', 'IV', 'iadd9', 'iadd9', 'bVII', 'IV'],
      B: ['bVI', 'bVI', 'bVII', 'bVII', 'iadd9', 'iadd9', 'IVsus4', 'IV'],
    },
    forma: 'AABA',
    reposo: 0.2,
    acento: { instrumento: 'campana', centro: 79 },
    semilla: 41,
    capas: [
      { id: 'dron', instrumento: 'dron', umbral: 0, volumen: 0.4, reverb: 0.3, gen: { tipo: 'dron', centro: 42, quinta: true } },
      { id: 'cristal', instrumento: 'cristal', umbral: 0, volumen: 0.42, reverb: 0.7, gen: { tipo: 'acorde', centro: 66 } },
      {
        id: 'celesta', instrumento: 'celesta', umbral: 0, volumen: 0.42, pan: 0.35, reverb: 0.5, eco: 0.4,
        gen: { tipo: 'patron', centro: 66, patrones: ['0.1.2.3.4.3.2.1.', '0.2.3.4.5.4.3.1.'] },
      },
      { id: 'campana', instrumento: 'campana', umbral: 0, volumen: 0.3, pan: -0.4, reverb: 0.85, gen: { tipo: 'destellos', centro: 78, probabilidad: 0.55 } },
      { id: 'bajo', instrumento: 'bajo_suave', umbral: 0.25, volumen: 0.55, reverb: 0.15, gen: { tipo: 'patron', centro: 42, patrones: ['0.......0...2...', '0.......0...3.2.'] } },
      { id: 'marco', instrumento: 'marco', umbral: 0.4, volumen: 0.6, reverb: 0.35, gen: { tipo: 'percusion', patrones: ['X.....x.X.......', 'X.....x.X...x.o.'] } },
      {
        id: 'arpa', instrumento: 'arpa', umbral: 0.45, volumen: 0.6, pan: -0.2, reverb: 0.45, eco: 0.3,
        gen: { tipo: 'melodia', centro: 73, densidad: 0.75, ritmos: ['x---x-x-x---x---', 'x-x-x---x-------', 'x-------x-x-x---', 'x---x---x-x-x-x-'] },
      },
      { id: 'sonajero', instrumento: 'sonajero', umbral: 0.55, volumen: 0.3, pan: 0.4, reverb: 0.25, gen: { tipo: 'percusion', patrones: ['..x...x...x...x.', '..x...x...x.x.x.'] } },
      { id: 'coro', instrumento: 'coro', umbral: 0.6, volumen: 0.35, reverb: 0.7, gen: { tipo: 'acorde', centro: 66 } },
      { id: 'taiko', instrumento: 'taiko', umbral: 0.75, volumen: 0.7, reverb: 0.3, gen: { tipo: 'percusion', patrones: ['X.......x.......', 'X.......x...x...'] } },
    ],
  },
};

// ---------------------------------------------------------------- forma y azar
/** Generador pseudoaleatorio pequeño y determinista (mulberry32). */
export function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mezclar(...ns: number[]): number {
  let h = 2166136261;
  for (const n of ns) {
    h ^= n | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Posicion {
  letra: string;
  /** Índice del compás dentro de su sección. */
  compas: number;
  /** Vueltas completas a la forma. */
  vuelta: number;
  acorde: Acorde;
  /** Primer compás de una racha del mismo acorde (dentro de la sección). */
  inicioAcorde: boolean;
  /** Compases que dura esa racha. */
  largoAcorde: number;
}

export function compasesPorVuelta(t: Tema): number {
  return [...t.forma].reduce((s, l) => s + t.secciones[l]!.length, 0);
}

export function posicion(t: Tema, n: number): Posicion {
  const total = compasesPorVuelta(t);
  const vuelta = Math.floor(n / total);
  let resto = ((n % total) + total) % total;
  for (const letra of t.forma) {
    const sec = t.secciones[letra]!;
    if (resto < sec.length) {
      const compas = resto;
      const cifra = sec[compas]!;
      let inicio = compas;
      while (inicio > 0 && sec[inicio - 1] === cifra) inicio--;
      let fin = compas;
      while (fin + 1 < sec.length && sec[fin + 1] === cifra) fin++;
      return { letra, compas, vuelta, acorde: leerAcorde(cifra), inicioAcorde: inicio === compas, largoAcorde: fin - inicio + 1 };
    }
    resto -= sec.length;
  }
  throw new Error('forma vacía');
}

/** Cuánto suena una capa con la intensidad dada (0 a 1): entra suave alrededor de su umbral. */
export function presencia(nivel: number, umbral: number): number {
  if (umbral <= 0) return 1;
  const a = umbral - 0.06;
  const b = umbral + 0.1;
  const x = Math.min(1, Math.max(0, (nivel - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------- generadores
function notasPatron(t: Tema, capa: Capa, patron: string, p: Posicion): Nota[] {
  const clases = clasesAcorde(p.acorde)
    .map((c) => mod12(c - p.acorde.raiz))
    .sort((x, y) => x - y);
  const centro = 'centro' in capa.gen ? capa.gen.centro : 60;
  const raiz = cercana(t.tonica, p.acorde.raiz, centro);
  const altura = (i: number) => raiz + clases[i % clases.length]! + 12 * Math.floor(i / clases.length);
  const notas: Nota[] = [];
  for (let paso = 0; paso < PASOS; paso++) {
    const ch = patron[paso] ?? '.';
    if (ch < '0' || ch > '9') continue;
    let fin = paso + 1;
    while (fin < PASOS && (patron[fin] === '.' || patron[fin] === '-')) fin++;
    const vel = paso % 4 === 0 ? 1 : paso % 2 === 0 ? 0.82 : 0.68;
    notas.push({ capa: capa.id, paso, dur: fin - paso, midi: altura(Number(ch)), vel });
  }
  return notas;
}

function notasPercusion(capa: Capa, patron: string): Nota[] {
  const notas: Nota[] = [];
  for (let paso = 0; paso < PASOS; paso++) {
    const ch = patron[paso];
    const vel = ch === 'X' ? 1 : ch === 'x' ? 0.7 : ch === 'o' ? 0.42 : 0;
    if (vel > 0) notas.push({ capa: capa.id, paso, dur: 1, midi: 0, vel });
  }
  return notas;
}

/** Grado (índice infinito sobre una escala de 7 notas) a MIDI. */
function gradoAMidi(tonica: number, escala: readonly number[], g: number): number {
  const oct = Math.floor(g / escala.length);
  return tonica + 12 * oct + escala[((g % escala.length) + escala.length) % escala.length]!;
}

/** El grado más cercano a `cerca` cuya nota es del acorde. */
function gradoDelAcorde(t: Tema, escala: readonly number[], a: Acorde, cerca: number): number {
  const clases = clasesAcorde(a);
  for (let d = 0; d < 8; d++) {
    for (const g of [cerca - d, cerca + d]) {
      if (clases.includes(mod12(gradoAMidi(0, escala, g)))) return g;
    }
  }
  return cerca;
}

function gradoInicial(t: Tema, escala: readonly number[], centro: number): number {
  // Grado cuya nota queda más cerca del centro de la capa.
  let mejor = 0;
  let dist = Infinity;
  for (let g = -21; g <= 35; g++) {
    const d = Math.abs(gradoAMidi(t.tonica, escala, g) - centro);
    if (d < dist) {
      dist = d;
      mejor = g;
    }
  }
  return mejor;
}

interface Motivo {
  ritmo: string; // 32 caracteres: dos compases
  saltos: number[]; // un salto (en grados) por ataque
}

function crearMotivo(rnd: () => number, ritmos: string[]): Motivo {
  const r1 = ritmos[Math.floor(rnd() * ritmos.length)]!;
  const r2 = ritmos[Math.floor(rnd() * ritmos.length)]!;
  const ritmo = r1 + r2;
  const ataques = [...ritmo].filter((c) => c === 'x').length;
  const PASOS_MELODIA = [-2, -1, -1, 1, 1, 2, -3, 3, 0, 1, -1];
  const saltos = Array.from({ length: ataques }, (_, i) => (i === 0 ? 0 : PASOS_MELODIA[Math.floor(rnd() * PASOS_MELODIA.length)]!));
  return { ritmo, saltos };
}

function notasMelodia(t: Tema, capa: Capa, gen: Extract<Generador, { tipo: 'melodia' }>, n: number, p: Posicion): Nota[] {
  const frase = Math.floor(p.compas / 2);
  const mitad = p.compas % 2;
  const inicioFrase = n - mitad;
  // ¿Suena esta frase? La primera de cada sección siempre; las demás según la densidad.
  const rFrase = azar(mezclar(t.semilla, capa.id.length, inicioFrase, 7))();
  if (frase > 0 && rFrase > gen.densidad) return [];

  const letra = p.letra.charCodeAt(0);
  const esB = frase === 2;
  const motivo = crearMotivo(azar(mezclar(t.semilla, letra, esB ? 2 : 1, p.vuelta % 2, capa.id.charCodeAt(0))), gen.ritmos);
  const pFrase = posicion(t, inicioFrase);
  const escala0 = escalaLocal(t.escala, pFrase.acorde);
  // A' empieza dos grados más arriba (secuencia); el resto parte de una nota del acorde junto al centro.
  let g = gradoDelAcorde(t, escala0, pFrase.acorde, gradoInicial(t, escala0, gen.centro) + (frase === 1 ? 2 : 0));
  const notas: Nota[] = [];
  let ataque = 0;
  const ultimos = [...motivo.ritmo].lastIndexOf('x');
  for (let i = 0; i < motivo.ritmo.length; i++) {
    if (motivo.ritmo[i] !== 'x') continue;
    const compasNota = Math.floor(i / PASOS);
    const pNota = compasNota === 0 ? pFrase : posicion(t, inicioFrase + 1);
    const escala = escalaLocal(t.escala, pNota.acorde);
    g += motivo.saltos[ataque]!;
    ataque++;
    const fuerte = i % 8 === 0;
    if (fuerte) g = gradoDelAcorde(t, escala, pNota.acorde, g);
    // Cadencia: la última nota de la última frase cae en la raíz del acorde.
    if (frase === 3 && i === ultimos) {
      const raiz = cercana(t.tonica, pNota.acorde.raiz, gradoAMidi(t.tonica, escala, g));
      g = gradoInicial(t, escala, raiz);
    }
    let midi = gradoAMidi(t.tonica, escala, g);
    // Mantiene la melodía en su registro (una novena arriba o abajo del centro).
    while (midi > gen.centro + 9) {
      g -= 7;
      midi = gradoAMidi(t.tonica, escala, g);
    }
    while (midi < gen.centro - 9) {
      g += 7;
      midi = gradoAMidi(t.tonica, escala, g);
    }
    if (compasNota !== mitad) continue;
    let fin = i + 1;
    while (fin < motivo.ritmo.length && motivo.ritmo[fin] === '-') fin++;
    notas.push({ capa: capa.id, paso: i % PASOS, dur: fin - i, midi, vel: fuerte ? 0.95 : 0.78 });
  }
  return notas;
}

function notasDestellos(t: Tema, capa: Capa, gen: Extract<Generador, { tipo: 'destellos' }>, n: number, p: Posicion): Nota[] {
  const rnd = azar(mezclar(t.semilla, n, 991, capa.id.length));
  if (rnd() > gen.probabilidad) return [];
  const clases = clasesAcorde(p.acorde);
  const k = 1 + Math.floor(rnd() * 3);
  const notas: Nota[] = [];
  let paso = [0, 2, 4, 6][Math.floor(rnd() * 4)]!;
  for (let i = 0; i < k && paso < PASOS; i++) {
    const c = clases[Math.floor(rnd() * clases.length)]!;
    notas.push({ capa: capa.id, paso, dur: 8, midi: cercana(t.tonica, c, gen.centro), vel: 0.6 + rnd() * 0.35 });
    paso += [2, 4, 6][Math.floor(rnd() * 3)]!;
  }
  return notas;
}

/** Todas las notas del compás `n` (global, empezando en 0) para todas las capas del tema. */
export function notasCompas(t: Tema, n: number): Nota[] {
  const p = posicion(t, n);
  const notas: Nota[] = [];
  for (const capa of t.capas) {
    if (capa.soloEn && !capa.soloEn.includes(p.letra)) continue;
    const gen = capa.gen;
    switch (gen.tipo) {
      case 'acorde':
        if (p.inicioAcorde) {
          for (const midi of voces(t.tonica, p.acorde, gen.centro)) notas.push({ capa: capa.id, paso: 0, dur: p.largoAcorde * PASOS, midi, vel: 0.8 });
        }
        break;
      case 'dron':
        if (n % 4 === 0) {
          const raiz = cercana(t.tonica, 0, gen.centro);
          notas.push({ capa: capa.id, paso: 0, dur: 4 * PASOS, midi: raiz, vel: 0.9 });
          if (gen.quinta) notas.push({ capa: capa.id, paso: 0, dur: 4 * PASOS, midi: raiz + 7, vel: 0.6 });
        }
        break;
      case 'patron':
        notas.push(...notasPatron(t, capa, gen.patrones[n % gen.patrones.length]!, p));
        break;
      case 'percusion':
        notas.push(...notasPercusion(capa, gen.patrones[n % gen.patrones.length]!));
        break;
      case 'melodia':
        notas.push(...notasMelodia(t, capa, gen, n, p));
        break;
      case 'destellos':
        notas.push(...notasDestellos(t, capa, gen, n, p));
        break;
    }
  }
  return notas;
}

/** Duración de un compás en segundos. */
export function duracionCompas(t: Tema): number {
  return (60 / t.bpm) * 4;
}
