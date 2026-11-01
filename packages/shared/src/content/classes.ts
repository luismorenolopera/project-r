import { ClassId, Element } from '../constants';

export type Targeting = 'direccion' | 'suelo' | 'propio' | 'aliado' | 'area_aliados';

export interface AbilityDef {
  id: string;
  nombre: string;
  cd: number;
  desc: string;
  objetivo: Targeting;
  /** Alcance máximo en metros para habilidades con punto en el suelo o aliado. */
  alcance?: number;
}

export interface ClassDef {
  id: ClassId;
  codigo: string;
  nombre: string;
  rol: string;
  arma: string;
  hp: number;
  velocidad: number;
  color: number;
  elementoPrincipal: Element;
  /** [básico, movilidad, mitigación, principal, definitiva] */
  habilidades: [AbilityDef, AbilityDef, AbilityDef, AbilityDef, AbilityDef];
}

export const CLASSES: ClassDef[] = [
  {
    id: ClassId.Guerrero,
    codigo: 'guerrero',
    nombre: 'Guerrero',
    rol: 'Vanguardia y control',
    arma: 'Espada larga',
    hp: 220,
    velocidad: 6,
    color: 0x8a3b2a,
    elementoPrincipal: Element.Fisico,
    habilidades: [
      { id: 'tajo', nombre: 'Tajo encadenado', cd: 0.4, objetivo: 'direccion', desc: 'Combo de 3 golpes en arco. El tercero empuja. En el aire mantiene suspendidos a los enemigos.' },
      { id: 'embestida', nombre: 'Embestida', cd: 5, objetivo: 'direccion', desc: 'Carga de 7 m que arrastra a los enemigos. Si chocan contra un muro o pilar quedan aturdidos.' },
      { id: 'bloqueo', nombre: 'Bloqueo', cd: 6, objetivo: 'propio', desc: 'Reduce el daño frontal un 70% durante 1,5 s. Bloquear en los primeros 0,25 s es un desvío perfecto: anula el golpe, aturde al atacante y devuelve proyectiles.' },
      { id: 'torbellino', nombre: 'Torbellino', cd: 8, objetivo: 'propio', desc: 'Gira durante 1 s golpeando 5 veces a todo lo que esté a 3 m.' },
      { id: 'salto_sismico', nombre: 'Salto sísmico', cd: 18, objetivo: 'suelo', alcance: 10, desc: 'Salta al punto apuntado. Al caer daña en 4 m, aturde y lanza a los enemigos al aire.' },
    ],
  },
  {
    id: ClassId.Mago,
    codigo: 'mago',
    nombre: 'Mago',
    rol: 'Soporte táctico y zonas',
    arma: 'Bastón rúnico',
    hp: 150,
    velocidad: 6.2,
    color: 0x3b3f8a,
    elementoPrincipal: Element.Arcano,
    habilidades: [
      { id: 'orbe', nombre: 'Orbe arcano', cd: 0.5, objetivo: 'direccion', desc: 'Proyectil arcano.' },
      { id: 'parpadeo', nombre: 'Parpadeo', cd: 6, objetivo: 'direccion', desc: 'Teletransporte de 8 m en la dirección de movimiento (o apuntada).' },
      { id: 'egida', nombre: 'Égida', cd: 10, objetivo: 'aliado', alcance: 15, desc: 'Escudo de 80 sobre el aliado apuntado. Nunca sobre el propio mago.' },
      { id: 'muro_igneo', nombre: 'Muro ígneo', cd: 12, objetivo: 'suelo', alcance: 14, desc: 'Muro de fuego de 7 m durante 6 s. Quema a los enemigos. Los proyectiles aliados que lo cruzan se vuelven de fuego.' },
      { id: 'furia', nombre: 'Encantamiento de furia', cd: 25, objetivo: 'area_aliados', alcance: 12, desc: '+40% de daño y +20% de velocidad durante 10 s a los aliados cercanos. El mago no lo recibe.' },
    ],
  },
  {
    id: ClassId.Arquero,
    codigo: 'arquero',
    nombre: 'Arquero',
    rol: 'Daño a distancia',
    arma: 'Arco largo',
    hp: 160,
    velocidad: 6.8,
    color: 0x2f6b34,
    elementoPrincipal: Element.Fisico,
    habilidades: [
      { id: 'flecha', nombre: 'Flecha', cd: 0.35, objetivo: 'direccion', desc: 'Flecha física rápida. Se transforma al cruzar zonas aliadas.' },
      { id: 'voltereta', nombre: 'Voltereta', cd: 4, objetivo: 'direccion', desc: 'Salto atrás de 6 m. El siguiente disparo hace el doble de daño.' },
      { id: 'red', nombre: 'Red lastrada', cd: 9, objetivo: 'direccion', desc: 'Inmoviliza 2,5 s al objetivo y a los que estén a 1,5 m.' },
      { id: 'perforante', nombre: 'Disparo perforante', cd: 7, objetivo: 'direccion', desc: 'Flecha pesada que atraviesa a todos y empuja.' },
      { id: 'lluvia', nombre: 'Lluvia de flechas', cd: 18, objetivo: 'suelo', alcance: 18, desc: 'Zona de 4 m que golpea 10 veces en 3 s.' },
    ],
  },
  {
    id: ClassId.Curador,
    codigo: 'curador',
    nombre: 'Curador',
    rol: 'Sanación y protección',
    arma: 'Maza y relicario',
    hp: 190,
    velocidad: 6,
    color: 0xb8a24a,
    elementoPrincipal: Element.Sagrado,
    habilidades: [
      { id: 'golpe_consagrado', nombre: 'Golpe consagrado', cd: 0.5, objetivo: 'direccion', desc: 'Golpe de maza sagrado.' },
      { id: 'paso_sagrado', nombre: 'Paso sagrado', cd: 6, objetivo: 'direccion', desc: 'Avance de 6 m. Cura 30 a los aliados que atraviesa.' },
      { id: 'santuario', nombre: 'Santuario', cd: 14, objetivo: 'suelo', alcance: 10, desc: 'Zona de 3,5 m durante 6 s: cura a los aliados y reduce su daño recibido un 30%. Las flechas que la cruzan se vuelven sagradas.' },
      { id: 'rayo_luz', nombre: 'Rayo de luz', cd: 5, objetivo: 'direccion', desc: 'Rayo sagrado que atraviesa: daña a enemigos y cura 40 a aliados.' },
      { id: 'plegaria', nombre: 'Plegaria', cd: 30, objetivo: 'area_aliados', alcance: 15, desc: 'Cura el 60% de la vida a todos los aliados cercanos (incluido el curador) y limpia estados.' },
    ],
  },
  {
    id: ClassId.Alquimista,
    codigo: 'alquimista',
    nombre: 'Alquimista',
    rol: 'Control de zonas y debilitamiento',
    arma: 'Frascos y bandolera',
    hp: 170,
    velocidad: 6.2,
    color: 0x6b3f7a,
    elementoPrincipal: Element.Veneno,
    habilidades: [
      { id: 'frasco_toxico', nombre: 'Frasco tóxico', cd: 0.6, objetivo: 'suelo', alcance: 14, desc: 'Frasco en parábola: veneno en 1,6 m. Pasa por encima de la cobertura.' },
      { id: 'impulso', nombre: 'Impulso explosivo', cd: 7, objetivo: 'direccion', desc: 'Salto propulsado hacia delante que aparta a los enemigos cercanos.' },
      { id: 'piel_piedra', nombre: 'Piel de piedra', cd: 12, objetivo: 'propio', desc: '50% menos daño e inmunidad a empujes durante 4 s.' },
      { id: 'aceite', nombre: 'Charco de aceite', cd: 8, objetivo: 'suelo', alcance: 14, desc: 'Charco de 3 m que ralentiza. Cualquier fuego lo hace explotar.' },
      { id: 'transmutacion', nombre: 'Gran transmutación', cd: 22, objetivo: 'suelo', alcance: 14, desc: 'Ácido de 5 m durante 6 s: daña y hace que los enemigos reciban un 30% más de daño.' },
    ],
  },
];

export const classById = (id: ClassId): ClassDef => CLASSES[id]!;
