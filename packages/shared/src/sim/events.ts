import type { Element, Kind } from '../constants';

/** Eventos discretos emitidos por tick. El cliente los usa para efectos, números de daño y ragdolls. */
export type SimEvent =
  | { t: 'spawn'; eid: number; kind: Kind }
  | { t: 'despawn'; eid: number }
  | { t: 'hit'; src: number; target: number; amount: number; el: Element; afinidad: number; aereo: boolean; frenesi: boolean; absorbido: number }
  | { t: 'heal'; target: number; amount: number }
  | { t: 'shield'; target: number; amount: number }
  | { t: 'death'; eid: number; kind: Kind; dx: number; dz: number; force: number }
  | { t: 'respawn'; eid: number }
  | { t: 'cast'; eid: number; ability: string; slot: number }
  | { t: 'fail'; eid: number; msg: string }
  | { t: 'reaction'; name: string; x: number; z: number; el: Element }
  | { t: 'text'; eid: number; msg: string }
  | { t: 'frenzy'; eid: number; on: boolean }
  | { t: 'class'; eid: number; cls: number }
  | { t: 'impact'; x: number; y: number; z: number; el: Element }
  | { t: 'explosion'; x: number; z: number; r: number; el: Element }
  | { t: 'blink'; eid: number; fx: number; fz: number };
