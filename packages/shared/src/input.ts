/**
 * Intención de input de un jugador para un tick (InputFrame del plan).
 * El cliente nunca envía posiciones ni daño: solo esto.
 */
export interface InputFrame {
  seq: number;
  /** Vector de movimiento en el mundo, longitud <= 1. */
  moveX: number;
  moveZ: number;
  /** Orientación de apuntado (yaw = 0 mira a -Z). */
  aimYaw: number;
  /** Punto apuntado en el suelo (habilidades de área). */
  aimX: number;
  aimZ: number;
  buttons: number;
}

export const emptyInput = (): InputFrame => ({ seq: 0, moveX: 0, moveZ: 0, aimYaw: 0, aimX: 0, aimZ: -5, buttons: 0 });
