import * as THREE from 'three';
import { scene } from '../mago/mundo';

/**
 * Efectos propios del alquimista:
 * - El sello de transmutación: un círculo dibujado en el suelo (diseño propio: doble anillo con marcas,
 *   estrella de ocho puntas, anillo interior con triángulo y un punto central). Se tiñe con el color del material.
 * - El flujo de materia: cubitos que viajan del objeto descompuesto a las manos del alquimista (y al revés al crear).
 * - Los hoyos que deja descomponer el suelo.
 * Nada de esto afecta al juego.
 */

// ---------------------------------------------------------------- textura del sello
function texturaSello() {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const m = N / 2;
  ctx.translate(m, m);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'square';
  const circulo = (r: number, w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  const poligono = (n: number, r: number, giro: number, w: number, salto = 1) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = giro + ((i * salto) / n) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  // Doble anillo exterior con marcas cada 10° y ocho rombos.
  circulo(122, 4);
  circulo(106, 3);
  ctx.lineWidth = 2;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const largo = i % 9 === 0 ? 0 : i % 3 === 0 ? 9 : 5;
    if (!largo) continue;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 107, Math.sin(a) * 107);
    ctx.lineTo(Math.cos(a) * (107 + largo), Math.sin(a) * (107 + largo));
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(114, 0);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  // Estrella de ocho puntas (dos cuadrados girados) inscrita en el anillo.
  poligono(4, 104, 0, 3);
  poligono(4, 104, Math.PI / 4, 3);
  // Anillo interior con un triángulo hacia arriba y otro pequeño invertido.
  circulo(62, 3);
  poligono(3, 60, -Math.PI / 2, 3);
  poligono(3, 30, Math.PI / 2, 2);
  circulo(12, 3);
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  // Pequeños círculos en los vértices de la estrella.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 84, Math.sin(a) * 84, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const TEX_SELLO = texturaSello();
const geoSello = new THREE.PlaneGeometry(2, 2);
geoSello.rotateX(-Math.PI / 2);

interface Sello {
  mesh: THREE.Mesh;
  t: number;
  vida: number;
  radio: number;
  giro: number;
  seguir?: () => THREE.Vector3;
}
const sellos: Sello[] = [];

function materialSello(color: number) {
  return new THREE.MeshBasicMaterial({
    map: TEX_SELLO, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
}

/** Sello que se dibuja en el suelo, gira y se apaga. */
export function sello(pos: THREE.Vector3, radio: number, color: number, vida = 0.7, seguir?: () => THREE.Vector3) {
  const mesh = new THREE.Mesh(geoSello, materialSello(color));
  mesh.position.set(pos.x, 0.05 + sellos.length * 0.001, pos.z);
  mesh.renderOrder = 2;
  scene.add(mesh);
  sellos.push({ mesh, t: 0, vida, radio, giro: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random()), seguir });
}

/** Sello persistente que marca el cursor (lo que se va a transmutar o descomponer). */
export class Mira {
  readonly mesh = new THREE.Mesh(geoSello, materialSello(0xffffff));
  private giro = 0;
  constructor() {
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }
  actualizar(pos: THREE.Vector3 | null, color: number, radio: number, intensidad: number, dt: number, velGiro = 0.8) {
    this.mesh.visible = !!pos;
    if (!pos) return;
    this.giro += dt * velGiro;
    this.mesh.position.set(pos.x, 0.06, pos.z);
    this.mesh.rotation.y = this.giro;
    this.mesh.scale.setScalar(radio);
    const m = this.mesh.material as THREE.MeshBasicMaterial;
    m.color.setHex(color);
    m.opacity = intensidad;
  }
}

// ---------------------------------------------------------------- flujo de materia
const MAX_FLUJO = 400;
const geoCubo = new THREE.BoxGeometry(1, 1, 1);
const matFlujo = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const malla = new THREE.InstancedMesh(geoCubo, matFlujo, MAX_FLUJO);
malla.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
malla.frustumCulled = false;
malla.count = 0;
scene.add(malla);
interface Mota {
  a: THREE.Vector3;
  b: THREE.Vector3;
  arco: THREE.Vector3;
  t: number;
  dur: number;
  tam: number;
  color: THREE.Color;
  seguir?: () => THREE.Vector3;
}
const motas: Mota[] = [];

/**
 * Motas de materia que viajan en arco de `desde` a `hasta` (o hacia un punto que se mueve con `seguir`).
 * Con `n` alto y `dispersion` sirve también para «construir» algo a partir de la materia.
 */
export function flujo(desde: THREE.Vector3, hasta: THREE.Vector3, color: number, n: number, o: { dispersion?: number; dur?: number; tam?: number; seguir?: () => THREE.Vector3 } = {}) {
  const col = new THREE.Color(color);
  for (let i = 0; i < n && motas.length < MAX_FLUJO; i++) {
    const d = o.dispersion ?? 0.3;
    const a = desde.clone().add(new THREE.Vector3((Math.random() - 0.5) * d * 2, (Math.random() - 0.5) * d, (Math.random() - 0.5) * d * 2));
    motas.push({
      a,
      b: hasta.clone(),
      arco: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
      t: -Math.random() * 0.15,
      dur: (o.dur ?? 0.45) * (0.8 + Math.random() * 0.4),
      tam: (o.tam ?? 0.09) * (0.7 + Math.random() * 0.6),
      color: col,
      seguir: o.seguir,
    });
  }
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export function actualizarCirculos(dt: number) {
  for (let i = sellos.length - 1; i >= 0; i--) {
    const s = sellos[i]!;
    s.t += dt;
    const k = s.t / s.vida;
    if (s.seguir) {
      const p = s.seguir();
      s.mesh.position.x = p.x;
      s.mesh.position.z = p.z;
    }
    const abre = Math.min(1, s.t / 0.12);
    s.mesh.scale.setScalar(s.radio * (0.4 + 0.6 * abre * (2 - abre)));
    s.mesh.rotation.y += s.giro * dt;
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s.t * 10) * Math.max(0, 1 - Math.max(0, k - 0.5) * 2);
    if (k >= 1) {
      s.mesh.removeFromParent();
      (s.mesh.material as THREE.Material).dispose();
      sellos.splice(i, 1);
    }
  }

  let n = 0;
  for (let i = motas.length - 1; i >= 0; i--) {
    const m = motas[i]!;
    m.t += dt;
    if (m.t >= m.dur) {
      motas[i] = motas[motas.length - 1]!;
      motas.pop();
      continue;
    }
    if (m.t < 0) continue;
    const k = m.t / m.dur;
    const fin = m.seguir ? m.seguir() : m.b;
    const suave = k * k * (3 - 2 * k);
    _p.lerpVectors(m.a, fin, suave);
    const h = Math.sin(k * Math.PI);
    _p.x += m.arco.x * h * 0.4;
    _p.y += m.arco.y * h * 0.6;
    _p.z += m.arco.z * h * 0.4;
    _q.setFromEuler(_e.set(k * 9, k * 7, 0));
    _s.setScalar(m.tam * (1 - k * 0.5));
    _m.compose(_p, _q, _s);
    malla.setMatrixAt(n, _m);
    malla.setColorAt(n, m.color);
    n++;
  }
  malla.count = n;
  malla.instanceMatrix.needsUpdate = true;
  if (malla.instanceColor) malla.instanceColor.needsUpdate = true;

  actualizarHoyos(dt);
}

// ---------------------------------------------------------------- hoyos en el suelo
interface Hoyo {
  mesh: THREE.Mesh;
  radio: number;
  t: number;
}
const hoyos: Hoyo[] = [];
const geoHoyo = new THREE.CircleGeometry(1, 10);
geoHoyo.rotateX(-Math.PI / 2);
const matHoyo = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
const VIDA_HOYO = 30;

/** Agranda el hoyo más cercano (o abre uno nuevo) donde se ha descompuesto el suelo. */
export function cavar(pos: THREE.Vector3, cuanto: number) {
  let h = hoyos.find((o) => Math.hypot(o.mesh.position.x - pos.x, o.mesh.position.z - pos.z) < Math.max(0.5, o.radio * 0.8));
  if (!h) {
    const mesh = new THREE.Mesh(geoHoyo, matHoyo);
    mesh.position.set(pos.x, 0.03 + (hoyos.length % 10) * 0.0015, pos.z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.scale.setScalar(0.01);
    scene.add(mesh);
    h = { mesh, radio: 0.15, t: 0 };
    hoyos.push(h);
    if (hoyos.length > 40) quitarHoyo(0);
  }
  h.radio = Math.min(1.1, h.radio + cuanto * 0.35);
  h.t = 0;
}

function quitarHoyo(i: number) {
  hoyos[i]!.mesh.removeFromParent();
  hoyos.splice(i, 1);
}

function actualizarHoyos(dt: number) {
  for (let i = hoyos.length - 1; i >= 0; i--) {
    const h = hoyos[i]!;
    h.t += dt;
    const fin = Math.max(0, h.t - (VIDA_HOYO - 2)) / 2;
    const r = h.radio * (1 - fin);
    h.mesh.scale.set(r, 1, r * 0.85);
    if (fin >= 1) quitarHoyo(i);
  }
}

export function limpiarCirculos() {
  for (const s of sellos) {
    s.mesh.removeFromParent();
    (s.mesh.material as THREE.Material).dispose();
  }
  sellos.length = 0;
  motas.length = 0;
  malla.count = 0;
  while (hoyos.length) quitarHoyo(hoyos.length - 1);
}

export function cuentaMotas() {
  return motas.length;
}
