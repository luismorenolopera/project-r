/**
 * Grimorio del mago: catálogo de hechizos, runas y reglas de la barra de habilidades.
 *
 * El sistema se inspira en el de los ARPG de acción clásicos:
 * - 6 ranuras (clic izquierdo, clic derecho, 1, 2, 3, 4), cada una ligada a una categoría.
 * - En cada ranura se elige un hechizo de su categoría y, para ese hechizo, una runa (o ninguna).
 * - Cada runa cambia el elemento o la forma del hechizo. Cambiar el elemento es lo que abre combos.
 * - El "modo libre" quita la restricción de categoría: cualquier hechizo en cualquier ranura,
 *   sin repetir. Si eliges uno que ya está en otra ranura, se intercambian.
 *
 * Este módulo es puro (sin Three.js ni DOM) para poder probarlo con Vitest.
 */

export type Elemento = 'arcano' | 'fuego' | 'hielo' | 'rayo' | 'fuerza';

export const ELEMENTOS: Record<Elemento, { nombre: string; color: number; css: string }> = {
  arcano: { nombre: 'Arcano', color: 0xa88aff, css: '#a88aff' },
  fuego: { nombre: 'Fuego', color: 0xff7a1a, css: '#ff8a2a' },
  hielo: { nombre: 'Hielo', color: 0x8adfff, css: '#8adfff' },
  rayo: { nombre: 'Rayo', color: 0xfff27a, css: '#f2e45a' },
  fuerza: { nombre: 'Fuerza', color: 0xe8e0d0, css: '#e8e0d0' },
};

export type Categoria = 'principal' | 'secundaria' | 'defensa' | 'fuerza' | 'conjuro' | 'dominio';

export const CATEGORIAS: { id: Categoria; nombre: string; desc: string }[] = [
  { id: 'principal', nombre: 'Principal', desc: 'Ataques sin coste que generan maná.' },
  { id: 'secundaria', nombre: 'Secundaria', desc: 'Hechizos potentes que gastan maná.' },
  { id: 'defensa', nombre: 'Defensa', desc: 'Control de masas y escape.' },
  { id: 'fuerza', nombre: 'Fuerza', desc: 'Empujes e impactos que rompen el entorno.' },
  { id: 'conjuro', nombre: 'Conjuro', desc: 'Invocaciones y zonas persistentes.' },
  { id: 'dominio', nombre: 'Dominio', desc: 'Manipulación del espacio y potenciadores.' },
];

export interface RanuraDef {
  /** Código de entrada: 'raton0', 'raton2' o el código de tecla. */
  entrada: string;
  etiqueta: string;
  categoria: Categoria;
}

export const RANURAS: RanuraDef[] = [
  { entrada: 'raton0', etiqueta: 'Izq', categoria: 'principal' },
  { entrada: 'raton2', etiqueta: 'Der', categoria: 'secundaria' },
  { entrada: 'Digit1', etiqueta: '1', categoria: 'defensa' },
  { entrada: 'Digit2', etiqueta: '2', categoria: 'fuerza' },
  { entrada: 'Digit3', etiqueta: '3', categoria: 'conjuro' },
  { entrada: 'Digit4', etiqueta: '4', categoria: 'dominio' },
];

export interface Runa {
  id: string;
  nombre: string;
  elemento: Elemento;
  desc: string;
}

export type Objetivo = 'direccion' | 'suelo' | 'propio';

export interface Hechizo {
  id: string;
  nombre: string;
  categoria: Categoria;
  elemento: Elemento;
  /** Símbolo del icono (texto, no emoji). */
  glifo: string;
  /** Maná por lanzamiento (o por segundo si es canalizado). Negativo: genera maná. */
  coste: number;
  /** Tiempo de reutilización en segundos (en los principales, cadencia de disparo). */
  cd: number;
  objetivo: Objetivo;
  canalizado?: boolean;
  /** Alcance máximo para hechizos con objetivo en el suelo. */
  alcance?: number;
  desc: string;
  runas: Runa[];
}

const r = (id: string, nombre: string, elemento: Elemento, desc: string): Runa => ({ id, nombre, elemento, desc });

export const HECHIZOS: Hechizo[] = [
  // ---------------------------------------------------------------- principal
  {
    id: 'dardo', nombre: 'Dardo arcano', categoria: 'principal', elemento: 'arcano', glifo: '✧', coste: -4, cd: 0.28, objetivo: 'direccion',
    desc: 'Proyectil rápido de 14 de daño. Deja una marca arcana.',
    runas: [
      r('tridente', 'Tridente', 'arcano', 'Tres dardos en abanico de 10 de daño.'),
      r('escarcha', 'Dardo de escarcha', 'hielo', 'Enfría mucho al objetivo (frío +35).'),
      r('buscador', 'Buscador', 'arcano', 'Persigue al enemigo más cercano al cursor.'),
      r('chispa', 'Dardo de chispa', 'rayo', 'Al impactar salta a 2 enemigos cercanos.'),
    ],
  },
  {
    id: 'ascua', nombre: 'Ascua', categoria: 'principal', elemento: 'fuego', glifo: '✹', coste: -4, cd: 0.4, objetivo: 'direccion',
    desc: 'Bola pequeña que estalla en 1,4 m y quema.',
    runas: [
      r('rebote', 'Rebote', 'fuego', 'Rebota hasta 3 veces en muros, pilares y objetos.'),
      r('magma', 'Magma', 'fuego', 'Deja un charco ardiente de 1,6 m durante 3 s.'),
      r('granizo', 'Granizo', 'hielo', 'Piedra de hielo que estalla en 5 esquirlas.'),
      r('pesada', 'Ascua pesada', 'fuego', 'Más lenta, empuja a los enemigos y revienta objetos.'),
    ],
  },
  {
    id: 'chispazo', nombre: 'Chispazo', categoria: 'principal', elemento: 'rayo', glifo: 'ϟ', coste: -4, cd: 0.45, objetivo: 'direccion',
    desc: 'Arco instantáneo en un cono de 7 m: golpea hasta 3 enemigos.',
    runas: [
      r('cadena', 'Arco en cadena', 'rayo', 'Golpea a uno y salta 4 veces entre enemigos.'),
      r('latigo', 'Látigo de fuego', 'fuego', 'El cono es de llamas y quema.'),
      r('gelido', 'Arco gélido', 'hielo', 'Enfría mucho a los alcanzados.'),
      r('descarga', 'Descarga', 'rayo', 'Un solo objetivo, daño ×2,5 y empuje.'),
    ],
  },
  // ---------------------------------------------------------------- secundaria
  {
    id: 'desintegrador', nombre: 'Rayo desintegrador', categoria: 'secundaria', elemento: 'arcano', glifo: '═', coste: 18, cd: 0, objetivo: 'direccion', canalizado: true,
    desc: 'Mantén pulsado: rayo continuo de 13 m (50 de daño por segundo). Gasta 18 de maná por segundo.',
    runas: [
      r('prisma', 'Prisma ígneo', 'fuego', 'El rayo quema.'),
      r('glacial', 'Glacial', 'hielo', 'El rayo congela en poco más de un segundo.'),
      r('tormenta', 'Rayo de tormenta', 'rayo', 'Desde el objetivo salta a 2 enemigos más.'),
      r('taladro', 'Taladro', 'arcano', 'Atraviesa a todos los enemigos y objetos de la línea.'),
    ],
  },
  {
    id: 'esfera', nombre: 'Esfera ígnea', categoria: 'secundaria', elemento: 'fuego', glifo: '◉', coste: 25, cd: 0.6, objetivo: 'direccion',
    desc: 'Bola lenta que explota en 3,2 m: 40 de daño, quema y empuja.',
    runas: [
      r('cometa', 'Cometa helado', 'hielo', 'La explosión congela todo lo que alcanza.'),
      r('racimo', 'Racimo', 'fuego', 'Al explotar suelta 5 bolitas que también estallan.'),
      r('implosion', 'Implosión', 'arcano', 'Atrae enemigos y objetos durante 1 s y luego estalla.'),
      r('plasma', 'Plasma', 'rayo', 'Electriza y lanza 3 arcos a enemigos cercanos.'),
    ],
  },
  {
    id: 'lanza', nombre: 'Lanza de escarcha', categoria: 'secundaria', elemento: 'hielo', glifo: '➹', coste: 20, cd: 0.5, objetivo: 'direccion',
    desc: 'Atraviesa a todos los enemigos: 24 de daño y frío +50.',
    runas: [
      r('esquirlas', 'Esquirlas', 'hielo', 'Al tocar al primero estalla en 6 esquirlas en abanico.'),
      r('caramba', 'Carámbano pesado', 'fuerza', 'Empuja a los que atraviesa y revienta objetos.'),
      r('ignea', 'Lanza ígnea', 'fuego', 'Atraviesa y quema.'),
      r('trueno', 'Lanza de trueno', 'rayo', 'Electriza; cada enemigo atravesado suelta un arco.'),
    ],
  },
  // ---------------------------------------------------------------- defensa
  {
    id: 'nova', nombre: 'Nova de escarcha', categoria: 'defensa', elemento: 'hielo', glifo: '❅', coste: 15, cd: 7, objetivo: 'propio',
    desc: 'Anillo de 5,5 m a tu alrededor que congela a los enemigos.',
    runas: [
      r('ignea', 'Nova ígnea', 'fuego', '25 de daño, quema y empuja.'),
      r('estatica', 'Nova estática', 'rayo', 'Electriza y aturde 0,8 s.'),
      r('choque', 'Nova de choque', 'fuerza', 'Empuje enorme: despide enemigos y revienta objetos.'),
      r('perpetua', 'Escarcha perpetua', 'hielo', 'Deja un campo helado de 6 s que enfría sin parar.'),
    ],
  },
  {
    id: 'parpadeo', nombre: 'Parpadeo', categoria: 'defensa', elemento: 'arcano', glifo: '⤳', coste: 10, cd: 3, objetivo: 'suelo', alcance: 9,
    desc: 'Teletransporte de hasta 9 m hacia el cursor.',
    runas: [
      r('estela', 'Estela ígnea', 'fuego', 'Deja un rastro de fuego en el camino durante 3 s.'),
      r('gelida', 'Salida gélida', 'hielo', 'Congela a los enemigos junto al punto de salida.'),
      r('sismica', 'Llegada sísmica', 'fuerza', 'Al llegar, una onda despide enemigos y rompe objetos.'),
      r('doble', 'Doble salto', 'arcano', 'Dos cargas.'),
    ],
  },
  // ---------------------------------------------------------------- fuerza
  {
    id: 'onda', nombre: 'Onda de choque', categoria: 'fuerza', elemento: 'fuerza', glifo: '◠', coste: 20, cd: 2.5, objetivo: 'direccion',
    desc: 'Cono de 7 m: 18 de daño y empuje fuerte. Hace añicos a los congelados.',
    runas: [
      r('ignea', 'Onda ígnea', 'fuego', 'La onda quema.'),
      r('glacial', 'Onda glacial', 'hielo', 'La onda enfría mucho (frío +60).'),
      r('atraccion', 'Atracción', 'fuerza', 'Tira de enemigos y objetos hacia ti.'),
      r('eco', 'Eco', 'fuerza', 'Se repite 0,45 s después.'),
    ],
  },
  {
    id: 'meteorito', nombre: 'Meteorito', categoria: 'fuerza', elemento: 'fuego', glifo: '☄', coste: 40, cd: 4, objetivo: 'suelo', alcance: 16,
    desc: 'Cae a los 0,9 s: 70 de daño en 3,5 m, empuje y charco ardiente.',
    runas: [
      r('cometa', 'Cometa', 'hielo', 'Un bloque de hielo que congela al caer.'),
      r('lluvia', 'Lluvia', 'fuego', 'Cuatro meteoritos pequeños alrededor del punto.'),
      r('trueno', 'Meteoro de trueno', 'rayo', 'Cae casi al instante y electriza.'),
      r('gravedad', 'Gravedad', 'fuerza', 'Atrae enemigos y objetos al punto antes del impacto.'),
    ],
  },
  // ---------------------------------------------------------------- conjuro
  {
    id: 'centinela', nombre: 'Centinela rúnico', categoria: 'conjuro', elemento: 'arcano', glifo: '♜', coste: 30, cd: 6, objetivo: 'suelo', alcance: 14,
    desc: 'Torre en el cursor que dispara dardos arcanos durante 10 s (máximo 3).',
    runas: [
      r('igneo', 'Centinela ígneo', 'fuego', 'Dispara ascuas que queman.'),
      r('gelido', 'Centinela gélido', 'hielo', 'Sus dardos enfrían.'),
      r('tormenta', 'Centinela de tormenta', 'rayo', 'Lanza arcos que saltan 3 veces.'),
      r('gemelos', 'Gemelos', 'arcano', 'Invoca dos centinelas de 6 s.'),
    ],
  },
  {
    id: 'ventisca', nombre: 'Ventisca', categoria: 'conjuro', elemento: 'hielo', glifo: '❆', coste: 35, cd: 5, objetivo: 'suelo', alcance: 16,
    desc: 'Zona de 4 m durante 5 s: daño continuo y frío.',
    runas: [
      r('electrica', 'Tormenta eléctrica', 'rayo', 'Caen rayos sobre los enemigos de la zona.'),
      r('ascuas', 'Lluvia de ascuas', 'fuego', 'La zona quema.'),
      r('vortice', 'Vórtice', 'hielo', 'Arrastra a los enemigos hacia el centro.'),
      r('granizo', 'Granizo pesado', 'fuerza', 'Piedras que golpean, empujan y rompen objetos.'),
    ],
  },
  // ---------------------------------------------------------------- dominio
  {
    id: 'singularidad', nombre: 'Singularidad', categoria: 'dominio', elemento: 'arcano', glifo: '◎', coste: 40, cd: 8, objetivo: 'suelo', alcance: 15,
    desc: 'Durante 3 s atrae enemigos, objetos y escombros en 6 m.',
    runas: [
      r('supernova', 'Supernova', 'fuerza', 'Al terminar explota y lo despide todo.'),
      r('horizonte', 'Horizonte helado', 'hielo', 'Enfría a los atrapados y los congela al terminar.'),
      r('estrella', 'Estrella ígnea', 'fuego', 'Quema a los atrapados.'),
      r('estatica', 'Estática', 'rayo', 'Electriza y salta arcos entre los atrapados.'),
    ],
  },
  {
    id: 'infusion', nombre: 'Infusión', categoria: 'dominio', elemento: 'arcano', glifo: '✚', coste: 25, cd: 10, objetivo: 'propio',
    desc: 'Durante 8 s cada golpe añade además una marca arcana.',
    runas: [
      r('ignea', 'Infusión ígnea', 'fuego', 'Cada golpe añade además fuego.'),
      r('gelida', 'Infusión gélida', 'hielo', 'Cada golpe añade además frío.'),
      r('estatica', 'Infusión estática', 'rayo', 'Cada golpe añade además electricidad.'),
      r('prisma', 'Prisma', 'arcano', 'Cada hechizo que lances añade un elemento distinto: fuego, hielo, rayo, arcano.'),
    ],
  },
];

const POR_ID = new Map(HECHIZOS.map((h) => [h.id, h]));

export function hechizo(id: string): Hechizo {
  const h = POR_ID.get(id);
  if (!h) throw new Error(`Hechizo desconocido: ${id}`);
  return h;
}

export function runaDe(h: Hechizo, runaId: string | null): Runa | null {
  if (!runaId) return null;
  return h.runas.find((x) => x.id === runaId) ?? null;
}

/** Elemento con el que golpea un hechizo según su runa. */
export function elementoEfectivo(h: Hechizo, runaId: string | null): Elemento {
  return runaDe(h, runaId)?.elemento ?? h.elemento;
}

export interface Ranura {
  hechizo: string;
  runa: string | null;
}

export type Build = Ranura[];

export function hechizosDeCategoria(c: Categoria): Hechizo[] {
  return HECHIZOS.filter((h) => h.categoria === c);
}

export function puedeAsignar(ranura: number, hechizoId: string, modoLibre: boolean): boolean {
  const def = RANURAS[ranura];
  const h = POR_ID.get(hechizoId);
  if (!def || !h) return false;
  return modoLibre || h.categoria === def.categoria;
}

/**
 * Pone un hechizo en una ranura. Conserva la runa si el hechizo no cambia.
 * Si el hechizo ya estaba en otra ranura, se intercambian (solo puede pasar en modo libre).
 * Devuelve una build nueva; la original no se modifica.
 */
export function asignar(build: Build, ranura: number, hechizoId: string, modoLibre: boolean): Build {
  if (!puedeAsignar(ranura, hechizoId, modoLibre)) return build;
  const nueva = build.map((x) => ({ ...x }));
  const actual = nueva[ranura]!;
  if (actual.hechizo === hechizoId) return nueva;
  const otra = nueva.findIndex((x, i) => i !== ranura && x.hechizo === hechizoId);
  if (otra >= 0) {
    if (!puedeAsignar(otra, actual.hechizo, modoLibre)) return build;
    nueva[otra] = { ...actual };
    nueva[ranura] = { ...build[otra]! };
    return nueva;
  }
  nueva[ranura] = { hechizo: hechizoId, runa: null };
  return nueva;
}

export function ponerRuna(build: Build, ranura: number, runaId: string | null): Build {
  const actual = build[ranura];
  if (!actual) return build;
  const h = hechizo(actual.hechizo);
  if (runaId !== null && !h.runas.some((x) => x.id === runaId)) return build;
  return build.map((x, i) => (i === ranura ? { ...x, runa: runaId } : { ...x }));
}

/** Al salir del modo libre, las ranuras con hechizos de otra categoría vuelven al primero de la suya. */
export function normalizar(build: Build, modoLibre: boolean): Build {
  const usados = new Set<string>();
  return RANURAS.map((def, i) => {
    const x = build[i];
    const valida = !!x && POR_ID.has(x.hechizo) && (modoLibre || hechizo(x.hechizo).categoria === def.categoria) && !usados.has(x.hechizo);
    let res: Ranura;
    if (valida) {
      const h = hechizo(x.hechizo);
      res = { hechizo: x.hechizo, runa: x.runa && h.runas.some((y) => y.id === x.runa) ? x.runa : null };
    } else {
      const libre = hechizosDeCategoria(def.categoria).find((h) => !usados.has(h.id)) ?? HECHIZOS.find((h) => !usados.has(h.id))!;
      res = { hechizo: libre.id, runa: null };
    }
    usados.add(res.hechizo);
    return res;
  });
}

export const BUILD_INICIAL: Build = [
  { hechizo: 'dardo', runa: null },
  { hechizo: 'esfera', runa: null },
  { hechizo: 'nova', runa: null },
  { hechizo: 'onda', runa: null },
  { hechizo: 'ventisca', runa: 'electrica' },
  { hechizo: 'singularidad', runa: null },
];

export interface BuildSugerida {
  nombre: string;
  idea: string;
  modoLibre: boolean;
  build: Build;
}

export const BUILDS_SUGERIDAS: BuildSugerida[] = [
  {
    nombre: 'Escarcha y añicos',
    idea: 'Congela con Nova o Cometa y remata con Onda de choque: Hacer añicos. El rayo sobre congelados provoca Superconductor.',
    modoLibre: false,
    build: [
      { hechizo: 'dardo', runa: 'escarcha' },
      { hechizo: 'esfera', runa: 'cometa' },
      { hechizo: 'nova', runa: null },
      { hechizo: 'onda', runa: null },
      { hechizo: 'ventisca', runa: 'electrica' },
      { hechizo: 'singularidad', runa: 'horizonte' },
    ],
  },
  {
    nombre: 'Tormenta y agua',
    idea: 'Rompe tinajas para empapar a los enemigos y descarga rayos: Electrocución en cadena. El hielo sobre empapados congela al instante.',
    modoLibre: false,
    build: [
      { hechizo: 'chispazo', runa: 'cadena' },
      { hechizo: 'lanza', runa: 'trueno' },
      { hechizo: 'parpadeo', runa: 'gelida' },
      { hechizo: 'onda', runa: 'eco' },
      { hechizo: 'centinela', runa: 'tormenta' },
      { hechizo: 'infusion', runa: 'estatica' },
    ],
  },
  {
    nombre: 'Piromante',
    idea: 'Quema madera y barriles de aceite para provocar incendios y explosiones en cadena. Fuego sobre electrizados: Sobrecarga.',
    modoLibre: false,
    build: [
      { hechizo: 'ascua', runa: 'rebote' },
      { hechizo: 'desintegrador', runa: 'prisma' },
      { hechizo: 'nova', runa: 'ignea' },
      { hechizo: 'meteorito', runa: 'lluvia' },
      { hechizo: 'centinela', runa: 'igneo' },
      { hechizo: 'infusion', runa: 'estatica' },
    ],
  },
  {
    nombre: 'Prisma resonante',
    idea: 'Acumula estados distintos con Infusión: Prisma y detónalos todos con un golpe arcano: Resonancia.',
    modoLibre: true,
    build: [
      { hechizo: 'dardo', runa: 'tridente' },
      { hechizo: 'desintegrador', runa: 'taladro' },
      { hechizo: 'infusion', runa: 'prisma' },
      { hechizo: 'ventisca', runa: 'ascuas' },
      { hechizo: 'meteorito', runa: 'trueno' },
      { hechizo: 'singularidad', runa: 'supernova' },
    ],
  },
];

/** Lee una build guardada; si algo no cuadra, la corrige en vez de fallar. */
export function leerBuild(texto: string | null): { build: Build; modoLibre: boolean } | null {
  if (!texto) return null;
  try {
    const datos = JSON.parse(texto) as { build?: unknown; modoLibre?: unknown };
    if (!Array.isArray(datos.build)) return null;
    const modoLibre = datos.modoLibre === true;
    const build = datos.build.map((x) => {
      const o = (x ?? {}) as { hechizo?: unknown; runa?: unknown };
      return { hechizo: typeof o.hechizo === 'string' ? o.hechizo : '', runa: typeof o.runa === 'string' ? o.runa : null };
    });
    return { build: normalizar(build, modoLibre), modoLibre };
  } catch {
    return null;
  }
}

export function escribirBuild(build: Build, modoLibre: boolean): string {
  return JSON.stringify({ build, modoLibre });
}
