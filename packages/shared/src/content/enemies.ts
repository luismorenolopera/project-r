import { Element, Kind } from '../constants';

export interface MonsterDef {
  kind: Kind;
  nombre: string;
  hp: number;
  velocidad: number;
  radio: number;
  altura: number;
  masa: number;
  flota?: boolean;
  /** Multiplicador de daño recibido por elemento. >1 vulnerable, <1 resistente. */
  afinidad: Partial<Record<Element, number>>;
  descripcion: string;
}

export const MONSTERS: Partial<Record<Kind, MonsterDef>> = {
  [Kind.Muneco]: {
    kind: Kind.Muneco, nombre: 'Muñeco de entrenamiento', hp: 5000, velocidad: 0, radio: 0.5, altura: 1.8, masa: 1000,
    afinidad: {}, descripcion: 'No ataca. Se regenera a los 4 s sin recibir daño. Úsalo para medir el DPS.',
  },
  [Kind.Esqueleto]: {
    kind: Kind.Esqueleto, nombre: 'Esqueleto guardián', hp: 120, velocidad: 3.4, radio: 0.45, altura: 1.8, masa: 1,
    afinidad: { [Element.Sagrado]: 2, [Element.Fisico]: 1.25, [Element.Veneno]: 0.5 },
    descripcion: 'Tajo en cono telegrafiado (0,6 s). Débil a lo sagrado.',
  },
  [Kind.Cultista]: {
    kind: Kind.Cultista, nombre: 'Cultista ígneo', hp: 80, velocidad: 3, radio: 0.45, altura: 1.8, masa: 1,
    afinidad: { [Element.Fisico]: 1.5, [Element.Fuego]: 0.25, [Element.Hielo]: 1.5 },
    descripcion: 'Mantiene la distancia y lanza bolas de fuego en línea (0,8 s). Necesita línea de visión: escóndete tras pilares. Su fuego también enciende el aceite.',
  },
  [Kind.Bruto]: {
    kind: Kind.Bruto, nombre: 'Bruto de la cripta', hp: 420, velocidad: 2.4, radio: 0.9, altura: 2.6, masa: 3,
    afinidad: { [Element.Arcano]: 1.5, [Element.Fisico]: 0.75 },
    descripcion: 'Golpe en área (1 s) y carga en línea (1 s). Si la carga choca contra un muro queda aturdido y recibe +50% de daño. Casi no se le puede empujar.',
  },
  [Kind.Espectro]: {
    kind: Kind.Espectro, nombre: 'Espectro', hp: 90, velocidad: 4, radio: 0.45, altura: 1.8, masa: 0.8, flota: true,
    afinidad: { [Element.Fisico]: 0.25, [Element.Sagrado]: 2, [Element.Arcano]: 1.5 },
    descripcion: 'Rápido. Drena vida con un toque (0,45 s). El daño físico apenas le afecta.',
  },
  [Kind.Aliado]: {
    kind: Kind.Aliado, nombre: 'Compañero de práctica', hp: 300, velocidad: 5.5, radio: 0.45, altura: 1.8, masa: 1,
    afinidad: {}, descripcion: 'Te sigue y ataca a los enemigos cercanos. Sirve para probar habilidades de soporte.',
  },
};

export const monsterDef = (k: Kind): MonsterDef => {
  const d = MONSTERS[k];
  if (!d) throw new Error(`Sin definición de monstruo para ${Kind[k]}`);
  return d;
};
