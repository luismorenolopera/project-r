import * as CANNON from 'cannon-es';

/**
 * Interpolación de render para mundos de cannon-es que se avanzan con paso fijo propio.
 *
 * Los prototipos simulan a 120 Hz pero el monitor puede ir a 60, 75, 144 o 165 Hz: sin interpolar,
 * unos fotogramas avanzan un paso y otros dos (o ninguno) y el movimiento tiembla. Tras los pasos de
 * física de cada fotograma se llama a `interpolarCuerpos(world, acumulado / PASO)` y el render lee
 * `body.interpolatedPosition` y `body.interpolatedQuaternion`. La lógica sigue usando `position`.
 *
 * cannon-es guarda la pose anterior en `previousPosition` al integrar cada cuerpo. Si un cuerpo se
 * ha teletransportado (o se acaba de crear y aún no ha pasado por un paso), la distancia entre ambas
 * poses es enorme y se dibuja directamente en la pose actual en vez de cruzar la escena.
 */
const SALTO2 = 1; // 1 m en un paso de 1/120 s serían 120 m/s: solo puede ser un teletransporte.

export function interpolarCuerpos(world: CANNON.World, alpha: number) {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  for (const b of world.bodies) {
    if (b.type === CANNON.Body.STATIC) continue;
    const p = b.position;
    const q = b.previousPosition;
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const dz = p.z - q.z;
    if (a === 1 || dx * dx + dy * dy + dz * dz > SALTO2) {
      b.interpolatedPosition.copy(p);
      b.interpolatedQuaternion.copy(b.quaternion);
      continue;
    }
    q.lerp(p, a, b.interpolatedPosition);
    b.previousQuaternion.slerp(b.quaternion, a, b.interpolatedQuaternion);
    b.interpolatedQuaternion.normalize();
  }
}
