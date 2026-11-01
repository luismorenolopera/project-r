import { Btn } from '@mazmorra/shared';

/**
 * Teclado y ratón -> intención de input. Con el puntero bloqueado el ratón gira la cámara.
 */
export class Controls {
  camYaw = 0;
  camPitch = 0.35;
  locked = false;
  private readonly keys = new Set<string>();
  private mouseButtons = 0;
  private readonly pressedOnce = new Set<string>();
  sensitivity = 0.0024;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressedOnce.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ShiftLeft', 'KeyQ', 'KeyE', 'KeyR'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons |= 1 << e.button;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.mouseButtons = 0;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.camYaw -= e.movementX * this.sensitivity;
      this.camPitch = Math.max(-0.25, Math.min(1.2, this.camPitch + e.movementY * this.sensitivity));
    });
  }

  lock() {
    void this.canvas.requestPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }

  /** Devuelve true una sola vez por pulsación. */
  consume(code: string) {
    const had = this.pressedOnce.has(code);
    this.pressedOnce.delete(code);
    return had;
  }

  clearPressed() {
    this.pressedOnce.clear();
  }

  /** Vector de movimiento relativo a la cámara, en el mundo. */
  move(): { x: number; z: number } {
    let f = 0;
    let s = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) f += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) f -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) s += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) s -= 1;
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    let x = fx * f + rx * s;
    let z = fz * f + rz * s;
    const l = Math.hypot(x, z);
    if (l > 1) {
      x /= l;
      z /= l;
    }
    return { x, z };
  }

  buttons(): number {
    if (!this.locked) return 0;
    let b = 0;
    if (this.mouseButtons & 1) b |= Btn.Ataque;
    if (this.down('Space')) b |= Btn.Salto;
    if (this.down('ShiftLeft') || this.down('ShiftRight')) b |= Btn.Movilidad;
    if (this.down('KeyQ') || this.mouseButtons & 4) b |= Btn.Mitigacion;
    if (this.down('KeyE')) b |= Btn.Principal;
    if (this.down('KeyR')) b |= Btn.Definitiva;
    return b;
  }
}
