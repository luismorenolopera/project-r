/** Frecuencia fija de simulación (igual que el servidor autoritativo del plan). */
export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;
/** 1 unidad de mundo = 1 metro. */
export const GRAVITY = 22;
export const MAX_ENTITIES = 2048;

export enum Element {
  Fisico = 0,
  Fuego = 1,
  Hielo = 2,
  Veneno = 3,
  Sagrado = 4,
  Arcano = 5,
  Aceite = 6,
}

export const ELEMENT_NAMES: Record<Element, string> = {
  [Element.Fisico]: 'Físico',
  [Element.Fuego]: 'Fuego',
  [Element.Hielo]: 'Hielo',
  [Element.Veneno]: 'Veneno',
  [Element.Sagrado]: 'Sagrado',
  [Element.Arcano]: 'Arcano',
  [Element.Aceite]: 'Aceite',
};

export enum TeamId {
  Heroes = 0,
  Monstruos = 1,
}

/** Ranuras estandarizadas (2.2) más el ataque básico. */
export enum Slot {
  Basico = 0,
  Movilidad = 1,
  Mitigacion = 2,
  Principal = 3,
  Definitiva = 4,
}

export const Btn = {
  Ataque: 1,
  Salto: 2,
  Movilidad: 4,
  Mitigacion: 8,
  Principal: 16,
  Definitiva: 32,
} as const;

export enum Kind {
  Heroe = 0,
  Aliado = 1,
  Muneco = 2,
  Esqueleto = 3,
  Cultista = 4,
  Bruto = 5,
  Espectro = 6,
  Proyectil = 7,
  Zona = 8,
}

export enum ClassId {
  Guerrero = 0,
  Mago = 1,
  Arquero = 2,
  Curador = 3,
  Alquimista = 4,
}
