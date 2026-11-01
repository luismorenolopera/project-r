import { MAX_ENTITIES } from '../constants';

const f32 = () => new Float32Array(MAX_ENTITIES);
const u8 = () => new Uint8Array(MAX_ENTITIES);
const i32 = () => new Int32Array(MAX_ENTITIES).fill(-1);

/**
 * Componentes SoA (TypedArrays preasignados, sin basura por tick).
 * Se crean por simulación para poder tener varios mundos aislados (tests, servidor con varias salas).
 */
export function createComponents() {
  return {
    Pos: { x: f32(), y: f32(), z: f32(), px: f32(), py: f32(), pz: f32() },
    Vel: { x: f32(), y: f32(), z: f32() },
    Facing: { yaw: f32(), pyaw: f32() },
    Body: { radius: f32(), height: f32(), mass: f32(), grounded: u8(), floats: u8() },
    Health: { hp: f32(), max: f32(), lastHitTick: new Int32Array(MAX_ENTITIES), deadT: f32() },
    Team: { id: u8() },
    KindC: { k: u8() },
    Hero: {
      cls: u8(),
      cd0: f32(), cd1: f32(), cd2: f32(), cd3: f32(), cd4: f32(),
      basicStep: u8(), basicTimer: f32(),
      /** Multiplicador del siguiente disparo (voltereta del arquero). */
      nextShotMult: f32(),
      buttons: u8(), prevButtons: u8(),
      moveX: f32(), moveZ: f32(), aimX: f32(), aimZ: f32(), aimYaw: f32(),
      /** Animación / acción canalizada (para el cliente). */
      action: u8(), actionT: f32(),
    },
    Combo: { count: f32(), timer: f32(), frenzy: u8(), frenzyT: f32() },
    Status: {
      dmgBuff: f32(), dmgBuffT: f32(),
      spdBuff: f32(), spdBuffT: f32(),
      shield: f32(), shieldT: f32(),
      guardT: f32(), guardAge: f32(),
      dr: f32(), drT: f32(),
      knockImmuneT: f32(),
      vuln: f32(), vulnT: f32(),
      burnDps: f32(), burnT: f32(), burnSrc: i32(),
      poisonDps: f32(), poisonT: f32(), poisonSrc: i32(),
      slow: f32(), slowT: f32(),
      stunT: f32(), rootT: f32(),
      dotTick: f32(),
    },
    Knock: { vx: f32(), vz: f32(), t: f32(), src: i32() },
    Dash: { vx: f32(), vz: f32(), t: f32(), effect: u8() },
    AI: { state: u8(), t: f32(), cd: f32(), cd2: f32(), target: i32(), ax: f32(), az: f32(), followEid: i32(), idleT: f32() },
    /** Indicador de ataque en el suelo (4.1 / 4.2). shape: 0 círculo, 1 cono, 2 línea. */
    Telegraph: { active: u8(), shape: u8(), x: f32(), z: f32(), yaw: f32(), r: f32(), w: f32(), t: f32(), total: f32() },
    Projectile: {
      def: u8(), owner: i32(), team: u8(), el: u8(), dmg: f32(), life: f32(), r: f32(), pierce: u8(),
      heal: f32(), knock: f32(), converted: u8(),
      lob: u8(), sx: f32(), sz: f32(), tx: f32(), tz: f32(), flight: f32(), elapsed: f32(),
    },
    Zone: { def: u8(), owner: i32(), team: u8(), el: u8(), r: f32(), life: f32(), total: f32(), x2: f32(), z2: f32(), shape: u8(), pulse: f32() },
  };
}

export type Components = ReturnType<typeof createComponents>;
