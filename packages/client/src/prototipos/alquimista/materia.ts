/**
 * Reglas puras del alquimista (sin three.js ni física): materiales, el crisol de dos huecos,
 * las recetas que salen de combinar materiales, sus costes y las armas forjadas.
 *
 * Idea central, la «ley del equilibrio»: nada se crea de la nada. Todo lo que el alquimista
 * transmuta sale de la materia que antes ha descompuesto del entorno (objetos, escombros,
 * restos de enemigos o el propio suelo).
 *
 * Una receta tiene dos partes:
 * - La BASE (primer material) decide la forma: púas, jabalinas, cuchillas, prisma, chorro o frasco
 *   si se lanza, y mazo, lanza, espada, cetro, látigo o tea si se forja como arma.
 * - El CATALIZADOR (segundo material, opcional) cambia el elemento o las propiedades: la piedra da peso,
 *   la madera ramifica, el metal afila, el cristal carga de rayo, el agua hiela y el aceite prende.
 * - El mismo material dos veces da la versión «gran»: más grande y con forma propia.
 */

export type Elemento = 'arcano' | 'fuego' | 'hielo' | 'rayo' | 'fuerza';

export type MaterialId = 'piedra' | 'madera' | 'metal' | 'cristal' | 'agua' | 'aceite';

export interface MaterialDef {
  id: MaterialId;
  nombre: string;
  glifo: string;
  /** Color en el mundo (partículas, sello) y en la interfaz. */
  color: number;
  css: string;
  /** De dónde se saca, para la interfaz. */
  fuente: string;
}

export const MATERIALES: MaterialDef[] = [
  { id: 'piedra', nombre: 'Piedra', glifo: '▲', color: 0xc8bca8, css: '#c8bca8', fuente: 'Suelo, muros, obeliscos, columnas, lápidas y urnas' },
  { id: 'madera', nombre: 'Madera', glifo: '♣', color: 0xc8904a, css: '#c8904a', fuente: 'Cajas y barriles' },
  { id: 'metal', nombre: 'Metal', glifo: '◆', color: 0x9aa8b8, css: '#9aa8b8', fuente: 'Chatarra y armas de los esqueletos caídos' },
  { id: 'cristal', nombre: 'Cristal', glifo: '✦', color: 0xb8a0ff, css: '#b8a0ff', fuente: 'Cristales de maná' },
  { id: 'agua', nombre: 'Agua', glifo: '●', color: 0x5a9ae8, css: '#5a9ae8', fuente: 'Tinajas y hielo' },
  { id: 'aceite', nombre: 'Aceite', glifo: '◉', color: 0xd8a020, css: '#d8a020', fuente: 'Barriles de aceite' },
];

export const MATERIAL: Record<MaterialId, MaterialDef> = Object.fromEntries(MATERIALES.map((m) => [m.id, m])) as Record<MaterialId, MaterialDef>;
export const IDS_MATERIAL: MaterialId[] = MATERIALES.map((m) => m.id);

/** Tope de unidades de cada material. */
export const MAX_MATERIA = 20;

// ---------------------------------------------------------------- inventario
export type Inventario = Record<MaterialId, number>;
export type Coste = Partial<Record<MaterialId, number>>;

export function inventarioVacio(): Inventario {
  return { piedra: 0, madera: 0, metal: 0, cristal: 0, agua: 0, aceite: 0 };
}

/** Añade materia (admite fracciones: los escombros pequeños dan menos de una unidad). Devuelve lo que entró. */
export function anadir(inv: Inventario, mat: MaterialId, n: number): number {
  const antes = inv[mat];
  inv[mat] = Math.min(MAX_MATERIA, antes + Math.max(0, n));
  return inv[mat] - antes;
}

/** Unidades enteras disponibles (las que se pueden gastar). */
export function unidades(inv: Inventario, mat: MaterialId) {
  return Math.floor(inv[mat] + 1e-6);
}

export function puedePagar(inv: Inventario, coste: Coste): boolean {
  return (Object.entries(coste) as [MaterialId, number][]).every(([m, n]) => unidades(inv, m) >= n);
}

/** Paga el coste si se puede. Devuelve si lo pagó. */
export function pagar(inv: Inventario, coste: Coste): boolean {
  if (!puedePagar(inv, coste)) return false;
  for (const [m, n] of Object.entries(coste) as [MaterialId, number][]) inv[m] = Math.max(0, inv[m] - n);
  return true;
}

// ---------------------------------------------------------------- materia del entorno
/** Lo que el alquimista sabe de un objeto del entorno para descomponerlo. */
export interface OrigenMateria {
  /** Material del objeto según el motor de objetos: madera, barro, piedra, cristal, hielo o metal. */
  material: string;
  explosivo?: boolean;
  agua?: boolean;
}

/** Unidades por metro cúbico de cada material. */
export const RENDIMIENTO: Record<MaterialId, number> = { piedra: 5, madera: 5, metal: 10, cristal: 8, agua: 5, aceite: 5 };

/** Qué material da un objeto. Las urnas de barro cuentan como piedra; el hielo, como agua. */
export function materialDe(o: OrigenMateria): MaterialId {
  if (o.explosivo) return 'aceite';
  if (o.agua) return 'agua';
  switch (o.material) {
    case 'madera':
      return 'madera';
    case 'cristal':
      return 'cristal';
    case 'hielo':
      return 'agua';
    case 'metal':
      return 'metal';
    default:
      return 'piedra';
  }
}

/**
 * Materia que da descomponer un objeto entero (factor 1) o un escombro suelto (factor < 1: algo se pierde
 * al romperlo, así que compensa descomponer los objetos antes de destrozarlos).
 */
export function materiaDe(o: OrigenMateria, volumen: number, factor = 1): { mat: MaterialId; n: number } {
  const mat = materialDe(o);
  const n = Math.max(0.1, volumen * RENDIMIENTO[mat] * factor);
  return { mat, n: Math.min(10, n) };
}

/** Segundos que se tarda en descomponer un objeto entero según su volumen. */
export function tiempoDescomponer(volumen: number) {
  return Math.min(1.6, 0.25 + volumen * 0.45);
}

/** Piedra que da el suelo por segundo al descomponerlo (lento a propósito: los objetos rinden más). */
export const PIEDRA_SUELO_POR_SEGUNDO = 2.2;

// ---------------------------------------------------------------- crisol
/** Hasta dos materiales: base y catalizador. */
export type Crisol = MaterialId[];

/** Mete un material. Si el crisol ya estaba lleno, empieza de nuevo con ese material. */
export function meterEnCrisol(c: Crisol, m: MaterialId): Crisol {
  if (c.length >= 2) return [m];
  return [...c, m];
}

// ---------------------------------------------------------------- formas
export type FormaId = 'puas' | 'jabalinas' | 'cuchillas' | 'prisma' | 'chorro' | 'frasco';
export type ArmaId = 'mazo' | 'lanza' | 'espada' | 'cetro' | 'latigo' | 'tea';

type Genero = 'ms' | 'fs' | 'mp' | 'fp';

interface FormaDef {
  id: FormaId;
  nombre: string;
  genero: Genero;
  /** Versión con el mismo material dos veces. */
  gran: string;
  granGenero: Genero;
  elemento: Elemento;
  desc: string;
  granDesc: string;
}

interface ArmaDef {
  id: ArmaId;
  nombre: string;
  genero: Genero;
  elemento: Elemento;
  desc: string;
  stats: StatsArma;
}

export interface StatsArma {
  /** Cuerpo a cuerpo: alcance en metros y ángulo del barrido en radianes. A distancia: alcance del proyectil. */
  alcance: number;
  angulo: number;
  dano: number;
  empuje: number;
  /** Segundos entre ataques. */
  cadencia: number;
  /** Ataques antes de deshacerse. */
  usos: number;
  aturdir: number;
  frio: number;
  /** Atrae en vez de empujar (látigo). */
  atrae: boolean;
  /** Dispara un proyectil en vez de barrer (cetro). */
  proyectil: boolean;
  /** Golpea a todos los que alcanza en línea (lanza) en vez de a los del arco. */
  estocada: boolean;
  /** El proyectil del cetro atraviesa enemigos. */
  perfora: boolean;
}

const statsBase = (s: Partial<StatsArma>): StatsArma => ({
  alcance: 2.4, angulo: 2, dano: 15, empuje: 4, cadencia: 0.4, usos: 12, aturdir: 0, frio: 0, atrae: false, proyectil: false, estocada: false, perfora: false, ...s,
});

/** La base decide la forma: una por material. */
export const FORMAS: Record<MaterialId, FormaDef> = {
  piedra: {
    id: 'puas', nombre: 'Púas', genero: 'fp', gran: 'Muralla de púas', granGenero: 'fs', elemento: 'fuerza',
    desc: 'Una hilera de púas brota del suelo hacia el cursor y lanza por los aires a quien pilla. Quedan como cobertura unos segundos.',
    granDesc: 'Un muro de púas se levanta en el cursor, de lado a lado: bloquea el paso y lanza a los que están encima.',
  },
  madera: {
    id: 'jabalinas', nombre: 'Jabalinas', genero: 'fp', gran: 'Lluvia de jabalinas', granGenero: 'fs', elemento: 'fuerza',
    desc: 'Jabalinas con física real: dañan según la velocidad del impacto y se clavan en los muros. Se recuperan descomponiéndolas.',
    granDesc: 'Seis jabalinas en abanico.',
  },
  metal: {
    id: 'cuchillas', nombre: 'Cuchillas', genero: 'fp', gran: 'Corona de cuchillas', granGenero: 'fs', elemento: 'fuerza',
    desc: 'Un abanico de cuchillas físicas, rápidas y ligeras. Rebotan en los objetos y quedan como chatarra.',
    granDesc: 'Doce cuchillas en todas direcciones alrededor del alquimista.',
  },
  cristal: {
    id: 'prisma', nombre: 'Prisma', genero: 'ms', gran: 'Gran prisma', granGenero: 'ms', elemento: 'arcano',
    desc: 'Un prisma flotante en el cursor dispara haces al enemigo más cercano durante 5 s.',
    granDesc: 'Dura 8 s y dispara a dos enemigos a la vez.',
  },
  agua: {
    id: 'chorro', nombre: 'Chorro', genero: 'ms', gran: 'Torrente', granGenero: 'ms', elemento: 'fuerza',
    desc: 'Chorro a presión de 9 m que empapa y empuja muy fuerte: estampa enemigos contra los muros.',
    granDesc: 'Más largo y ancho: arrastra todo lo que hay delante.',
  },
  aceite: {
    id: 'frasco', nombre: 'Frasco', genero: 'ms', gran: 'Gran frasco', granGenero: 'ms', elemento: 'fuerza',
    desc: 'Frasco en parábola: deja un charco de aceite que frena a los enemigos. Cualquier fuego lo hace estallar.',
    granDesc: 'Un charco mucho más grande.',
  },
};

/** Las mismas bases forjadas como arma: cambian el clic izquierdo hasta que se gastan. */
export const ARMAS: Record<MaterialId, ArmaDef> = {
  piedra: { id: 'mazo', nombre: 'Mazo', genero: 'ms', elemento: 'fuerza', desc: 'Lento y pesado: barrido amplio que despide lejos.', stats: statsBase({ alcance: 2.6, angulo: 2.2, dano: 34, empuje: 13, cadencia: 0.8, usos: 10, aturdir: 0.4 }) },
  madera: { id: 'lanza', nombre: 'Lanza', genero: 'fs', elemento: 'fuerza', desc: 'Estocada larga que atraviesa a todos los que están en línea.', stats: statsBase({ alcance: 3.6, angulo: 0.5, dano: 22, empuje: 7, cadencia: 0.45, usos: 14, estocada: true }) },
  metal: { id: 'espada', nombre: 'Espada', genero: 'fs', elemento: 'fuerza', desc: 'Rápida y fiable; la que más dura.', stats: statsBase({ alcance: 2.3, angulo: 2.6, dano: 17, empuje: 4, cadencia: 0.28, usos: 24 }) },
  cristal: { id: 'cetro', nombre: 'Cetro', genero: 'ms', elemento: 'arcano', desc: 'Dispara proyectiles de luz a distancia.', stats: statsBase({ alcance: 16, angulo: 0, dano: 14, empuje: 2, cadencia: 0.35, usos: 18, proyectil: true }) },
  agua: { id: 'latigo', nombre: 'Látigo', genero: 'ms', elemento: 'fuerza', desc: 'Mucho alcance; atrae a los enemigos hacia ti y los empapa.', stats: statsBase({ alcance: 4.4, angulo: 1.3, dano: 12, empuje: 7, cadencia: 0.45, usos: 16, atrae: true }) },
  aceite: { id: 'tea', nombre: 'Tea', genero: 'fs', elemento: 'fuego', desc: 'Cono corto de llamas, muy rápido. Prende la madera.', stats: statsBase({ alcance: 2.8, angulo: 1, dano: 8, empuje: 1, cadencia: 0.16, usos: 36 }) },
};

// ---------------------------------------------------------------- catalizadores
export type ModId = 'pesado' | 'ramificado' | 'afilado' | 'cargado' | 'gelido' | 'igneo';

interface ModDef {
  id: ModId;
  /** Adjetivo en sus cuatro formas: masculino y femenino, singular y plural. */
  adj: Record<Genero, string>;
  /** Elemento que impone (si no, se queda el de la base). */
  elemento?: Elemento;
  desc: string;
}

export const MODS: Record<MaterialId, ModDef> = {
  piedra: { id: 'pesado', adj: { ms: 'pesado', fs: 'pesada', mp: 'pesados', fp: 'pesadas' }, elemento: 'fuerza', desc: 'Más empuje y aturde.' },
  madera: { id: 'ramificado', adj: { ms: 'ramificado', fs: 'ramificada', mp: 'ramificados', fp: 'ramificadas' }, desc: 'Más piezas y más alcance.' },
  metal: { id: 'afilado', adj: { ms: 'afilado', fs: 'afilada', mp: 'afilados', fp: 'afiladas' }, desc: 'Daño ×1,5 y atraviesa.' },
  cristal: { id: 'cargado', adj: { ms: 'cargado', fs: 'cargada', mp: 'cargados', fp: 'cargadas' }, elemento: 'rayo', desc: 'Elemento rayo.' },
  agua: { id: 'gelido', adj: { ms: 'gélido', fs: 'gélida', mp: 'gélidos', fp: 'gélidas' }, elemento: 'hielo', desc: 'Elemento hielo: enfría hasta congelar.' },
  aceite: { id: 'igneo', adj: { ms: 'ígneo', fs: 'ígnea', mp: 'ígneos', fp: 'ígneas' }, elemento: 'fuego', desc: 'Elemento fuego: quema y prende la madera.' },
};

// ---------------------------------------------------------------- recetas
export interface Receta {
  /** «piedra+aceite», «madera», «metal+metal»... */
  clave: string;
  base: MaterialId;
  catalizador: MaterialId | null;
  gran: boolean;
  forma: FormaId;
  nombre: string;
  desc: string;
  elemento: Elemento;
  mod: ModId | null;
  /** Coste de lanzarla (Q). */
  coste: Coste;
  /** Multiplicadores que el motor aplica a la forma. */
  dano: number;
  empuje: number;
  cantidad: number;
  alcance: number;
  aturdir: number;
  frio: number;
  perfora: boolean;
}

function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function claveDe(c: Crisol) {
  return c.join('+');
}

/** Resuelve el contenido del crisol en una receta (null si está vacío). */
export function receta(c: Crisol): Receta | null {
  const base = c[0];
  if (!base) return null;
  const cat = c[1] ?? null;
  const gran = cat === base;
  const f = FORMAS[base];
  const mod = cat && !gran ? MODS[cat] : null;
  const coste: Coste = gran ? { [base]: 4 } : cat ? { [base]: 2, [cat]: 1 } : { [base]: 2 };
  const r: Receta = {
    clave: claveDe(c),
    base,
    catalizador: cat,
    gran,
    forma: f.id,
    nombre: gran ? f.gran : mod ? `${f.nombre} ${mod.adj[f.genero]}` : f.nombre,
    desc: gran ? f.granDesc : mod ? `${f.desc} ${mod.desc}` : f.desc,
    elemento: mod?.elemento ?? f.elemento,
    mod: mod?.id ?? null,
    coste,
    dano: 1,
    empuje: 1,
    cantidad: 1,
    alcance: 1,
    aturdir: 0,
    frio: 0,
    perfora: false,
  };
  aplicarMod(r, mod?.id ?? null);
  if (gran) {
    r.dano *= 1.35;
    r.alcance *= 1.25;
  }
  return r;
}

function aplicarMod(r: { dano: number; empuje: number; cantidad: number; alcance: number; aturdir: number; frio: number; perfora: boolean }, mod: ModId | null) {
  switch (mod) {
    case 'pesado':
      r.empuje *= 1.7;
      r.dano *= 1.1;
      r.aturdir = 0.8;
      break;
    case 'ramificado':
      r.cantidad *= 1.6;
      r.alcance *= 1.3;
      break;
    case 'afilado':
      r.dano *= 1.5;
      r.perfora = true;
      break;
    case 'gelido':
      r.frio = 55;
      break;
    case 'cargado':
      r.dano *= 1.1;
      break;
    case 'igneo':
    case null:
      break;
  }
}

/** Todas las combinaciones posibles: 6 bases × (sin catalizador + 6 catalizadores) = 42. */
export function todasLasRecetas(): Receta[] {
  const res: Receta[] = [];
  for (const b of IDS_MATERIAL) {
    res.push(receta([b])!);
    for (const c of IDS_MATERIAL) res.push(receta([b, c])!);
  }
  return res;
}

// ---------------------------------------------------------------- armas forjadas
export interface Arma {
  clave: string;
  id: ArmaId;
  nombre: string;
  elemento: Elemento;
  stats: StatsArma;
  usosMax: number;
  /** Coste de forjarla (F). */
  coste: Coste;
}

/** El arma que sale de forjar el contenido del crisol (null si está vacío). */
export function arma(c: Crisol): Arma | null {
  const base = c[0];
  if (!base) return null;
  const cat = c[1] ?? null;
  const gran = cat === base;
  const a = ARMAS[base];
  const mod = cat && !gran ? MODS[cat] : null;
  const s: StatsArma = { ...a.stats };
  const m = { dano: 1, empuje: 1, cantidad: 1, alcance: 1, aturdir: 0, frio: 0, perfora: false };
  aplicarMod(m, mod?.id ?? null);
  s.dano *= m.dano;
  s.empuje *= m.empuje;
  s.alcance *= mod?.id === 'ramificado' ? 1.25 : 1;
  s.usos = Math.round(s.usos * (mod?.id === 'ramificado' ? 1.5 : 1));
  s.aturdir = Math.max(s.aturdir, m.aturdir);
  s.frio = m.frio;
  if (mod?.id === 'pesado') s.cadencia *= 1.2;
  s.perfora = m.perfora;
  if (gran) {
    s.dano *= 1.3;
    s.alcance *= 1.15;
    s.usos = Math.round(s.usos * 1.5);
  }
  const nombre = gran ? `Gran ${a.nombre.toLowerCase()}` : mod ? `${a.nombre} ${mod.adj[a.genero]}` : a.nombre;
  return {
    clave: claveDe(c),
    id: a.id,
    nombre: capitalizar(nombre),
    elemento: mod?.elemento ?? a.elemento,
    stats: s,
    usosMax: s.usos,
    coste: gran ? { [base]: 6 } : cat ? { [base]: 3, [cat]: 2 } : { [base]: 3 },
  };
}

/** Texto corto de un coste: «2 Piedra + 1 Aceite». */
export function textoCoste(c: Coste) {
  return (Object.entries(c) as [MaterialId, number][]).map(([m, n]) => `${n} ${MATERIAL[m].nombre}`).join(' + ');
}

// ---------------------------------------------------------------- transmutar el entorno (E)
export type InteraccionId = 'pilar' | 'grilletes' | 'estallido' | 'zarzas' | 'bomba' | 'congelar' | 'pararrayos' | 'erizo';

export interface InteraccionDef {
  id: InteraccionId;
  nombre: string;
  sobre: string;
  desc: string;
  coste: Coste;
}

/** Qué hace la transmutación directa (E) según lo que hay bajo el cursor. El propio objeto es la materia. */
export const INTERACCIONES: Record<InteraccionId, InteraccionDef> = {
  pilar: { id: 'pilar', nombre: 'Pilar', sobre: 'Suelo', desc: 'Levanta un pilar de piedra que lanza por los aires lo que tiene encima y sirve de cobertura.', coste: {} },
  grilletes: { id: 'grilletes', nombre: 'Grilletes', sobre: 'Enemigo', desc: 'Encierra los pies del enemigo en piedra: inmóvil 2,5 s.', coste: { piedra: 1 } },
  estallido: { id: 'estallido', nombre: 'Estallido de púas', sobre: 'Objeto de piedra', desc: 'El objeto revienta en púas hacia todos lados.', coste: {} },
  zarzas: { id: 'zarzas', nombre: 'Zarzas', sobre: 'Caja o barril', desc: 'La madera se vuelve un zarzal que atrapa y hiere a quien lo cruza.', coste: {} },
  bomba: { id: 'bomba', nombre: 'Destilar', sobre: 'Barril de aceite', desc: 'Concentra el aceite: estalla al segundo con el doble de radio.', coste: {} },
  congelar: { id: 'congelar', nombre: 'Escarcha', sobre: 'Tinaja de agua', desc: 'El agua se congela de golpe en un radio de 4 m.', coste: {} },
  pararrayos: { id: 'pararrayos', nombre: 'Pararrayos', sobre: 'Cristal de maná', desc: 'El cristal suelta rayos en cadena durante 6 s y luego se rompe.', coste: {} },
  erizo: { id: 'erizo', nombre: 'Erizo de hojas', sobre: 'Chatarra', desc: 'La chatarra sale disparada en hojas afiladas en todas direcciones.', coste: {} },
};

/** La interacción que corresponde a un objeto (por su materia) o al suelo. */
export function interaccionPara(o: OrigenMateria | 'suelo' | 'enemigo'): InteraccionId {
  if (o === 'suelo') return 'pilar';
  if (o === 'enemigo') return 'grilletes';
  switch (materialDe(o)) {
    case 'piedra':
      return 'estallido';
    case 'madera':
      return 'zarzas';
    case 'aceite':
      return 'bomba';
    case 'agua':
      return 'congelar';
    case 'cristal':
      return 'pararrayos';
    case 'metal':
      return 'erizo';
  }
}
