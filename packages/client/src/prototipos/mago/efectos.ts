import * as THREE from 'three';
import { camera, rand, scene } from './mundo';

/**
 * Efectos visuales del sandbox del mago: partículas, anillos, conos, destellos con luz,
 * arcos eléctricos, el haz del rayo canalizado y los números de daño.
 * Nada de esto afecta al juego.
 */

// ---------------------------------------------------------------- luces reutilizables
// Añadir o quitar luces obliga a recompilar shaders (tirones): se usa una reserva fija.
const luces: THREE.PointLight[] = [];
for (let i = 0; i < 10; i++) {
  const l = new THREE.PointLight(0xffffff, 0, 10, 1.5);
  scene.add(l);
  luces.push(l);
}
function pedirLuz(color: number, intensidad: number, distancia: number) {
  const l = luces.pop();
  if (!l) return undefined;
  l.color.setHex(color);
  l.intensity = intensidad;
  l.distance = distancia;
  return l;
}
function soltarLuz(l: THREE.PointLight | undefined) {
  if (!l) return;
  l.intensity = 0;
  luces.push(l);
}

// ---------------------------------------------------------------- partículas
interface Particula {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  vida: number;
  max: number;
  gravedad: number;
  tam: number;
  arrastre: number;
}
const vivas: Particula[] = [];
const MAX_PARTICULAS = 900;
const geoCubo = new THREE.BoxGeometry(1, 1, 1);
const matParticula = new Map<string, THREE.MeshBasicMaterial>();
function materialParticula(color: number, aditivo: boolean) {
  const k = `${color}-${aditivo}`;
  let m = matParticula.get(k);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: aditivo ? 0.9 : 0.75,
      depthWrite: false,
      blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    matParticula.set(k, m);
  }
  return m;
}

export interface OpcionesParticulas {
  tam?: number;
  gravedad?: number;
  aditivo?: boolean;
  vida?: number;
  /** Dirección preferente (se suma a la aleatoria). */
  dir?: THREE.Vector3;
  arrastre?: number;
  /** Dispersión del punto de salida. */
  dispersion?: number;
}

export function particulas(pos: THREE.Vector3, color: number, n: number, fuerza: number, o: OpcionesParticulas = {}) {
  const mat = materialParticula(color, o.aditivo ?? false);
  for (let i = 0; i < n; i++) {
    if (vivas.length >= MAX_PARTICULAS) quitarParticula(0);
    const mesh = new THREE.Mesh(geoCubo, mat);
    mesh.position.copy(pos);
    if (o.dispersion) mesh.position.add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1)).multiplyScalar(o.dispersion));
    const tam = (o.tam ?? 0.12) * rand(0.6, 1.5);
    mesh.scale.setScalar(tam);
    scene.add(mesh);
    const vel = new THREE.Vector3(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(fuerza * rand(0.3, 1));
    if (o.dir) vel.addScaledVector(o.dir, fuerza * rand(0.4, 1));
    const max = (o.vida ?? 0.8) * rand(0.6, 1.3);
    vivas.push({ mesh, vel, vida: max, max, gravedad: o.gravedad ?? -3, tam, arrastre: o.arrastre ?? 2.5 });
  }
}

function quitarParticula(i: number) {
  vivas[i]!.mesh.removeFromParent();
  vivas.splice(i, 1);
}

// ---------------------------------------------------------------- anillos, conos y destellos
interface Efimero {
  obj: THREE.Object3D;
  mat: THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
  vida: number;
  max: number;
  crecer: number;
  opacidad: number;
  luz?: THREE.PointLight;
  luzBase?: number;
  alActualizar?: (t: number) => void;
}
const efimeros: Efimero[] = [];

const aditivo = (color: number, opacity = 0.8) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

/** Anillo plano que se expande sobre el suelo. */
export function anillo(pos: THREE.Vector3, color: number, radio: number, vida = 0.45, grosor = 0.25) {
  const mat = aditivo(color, 0.85);
  const mesh = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, 1 - grosor), 1, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.06, pos.z);
  mesh.scale.setScalar(radio * 0.2);
  scene.add(mesh);
  efimeros.push({
    obj: mesh, mat, vida, max: vida, crecer: 0, opacidad: 0.85,
    alActualizar: (t) => mesh.scale.setScalar(radio * (0.2 + 0.8 * Math.sqrt(t))),
  });
}

/** Cono plano (sector) en el suelo, para ondas y chispazos. */
export function sector(pos: THREE.Vector3, yaw: number, radio: number, angulo: number, color: number, vida = 0.25) {
  const mat = aditivo(color, 0.55);
  // El sector se abre alrededor de -Z (el "delante" de dirToYaw) y se gira con el yaw.
  const geo = new THREE.RingGeometry(0.3, 1, 24, 1, Math.PI / 2 - angulo / 2, angulo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(-Math.PI / 2, 0, yaw);
  mesh.position.set(pos.x, 0.08, pos.z);
  mesh.scale.setScalar(radio * 0.4);
  scene.add(mesh);
  efimeros.push({
    obj: mesh, mat, vida, max: vida, crecer: 0, opacidad: 0.55,
    alActualizar: (t) => mesh.scale.setScalar(radio * (0.4 + 0.6 * Math.sqrt(t))),
  });
}

/** Esfera brillante que crece y se apaga, con luz. */
export function destello(pos: THREE.Vector3, color: number, radio: number, vida = 0.35, luz = 40) {
  const mat = aditivo(color, 0.75);
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat);
  mesh.position.copy(pos);
  mesh.scale.setScalar(radio * 0.3);
  scene.add(mesh);
  const l = pedirLuz(color, luz, radio * 4 + 4);
  if (l) l.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
  efimeros.push({
    obj: mesh, mat, vida, max: vida, crecer: 0, opacidad: 0.75, luz: l, luzBase: luz,
    alActualizar: (t) => mesh.scale.setScalar(radio * (0.3 + 0.7 * Math.pow(t, 0.4))),
  });
}

/** Rayo quebrado entre dos puntos que parpadea unas centésimas. */
export function arco(a: THREE.Vector3, b: THREE.Vector3, color = 0xfff27a, vida = 0.16, segmentos = 8) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segmentos; i++) pts.push(new THREE.Vector3());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const linea = new THREE.Line(geo, mat);
  scene.add(linea);
  const largo = a.distanceTo(b);
  const quebrar = () => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= segmentos; i++) {
      const t = i / segmentos;
      const j = i === 0 || i === segmentos ? 0 : largo * 0.12;
      pos.setXYZ(i, a.x + (b.x - a.x) * t + rand(-j, j), a.y + (b.y - a.y) * t + rand(-j, j), a.z + (b.z - a.z) * t + rand(-j, j));
    }
    pos.needsUpdate = true;
  };
  quebrar();
  const l = pedirLuz(color, 14, 6);
  if (l) l.position.copy(b);
  efimeros.push({ obj: linea, mat, vida, max: vida, crecer: 0, opacidad: 1, luz: l, luzBase: 14, alActualizar: quebrar });
}

/** Marca de aviso en el suelo (meteoritos): un anillo que se cierra hasta el impacto. */
export function aviso(pos: THREE.Vector3, radio: number, color: number, vida: number) {
  const mat = aditivo(color, 0.5);
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.05, pos.z);
  mesh.scale.setScalar(radio);
  scene.add(mesh);
  const centro = new THREE.Mesh(new THREE.CircleGeometry(1, 24), aditivo(color, 0.18));
  centro.rotation.x = -Math.PI / 2;
  centro.position.set(pos.x, 0.04, pos.z);
  centro.scale.setScalar(0.01);
  scene.add(centro);
  efimeros.push({
    obj: mesh, mat, vida, max: vida, crecer: 0, opacidad: 0.5,
    alActualizar: (t) => {
      centro.scale.setScalar(Math.max(0.01, radio * t));
      if (t >= 0.999) {
        centro.removeFromParent();
        centro.geometry.dispose();
        (centro.material as THREE.Material).dispose();
      }
    },
  });
}

// ---------------------------------------------------------------- haz del rayo canalizado
const matHaz = aditivo(0xffffff, 0.85);
const haz = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matHaz);
const matNucleo = aditivo(0xffffff, 1);
const nucleo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matNucleo);
haz.visible = nucleo.visible = false;
scene.add(haz, nucleo);
let luzHaz: THREE.PointLight | undefined;

export function mostrarHaz(desde: THREE.Vector3, hasta: THREE.Vector3, color: number, tiempo: number) {
  const largo = desde.distanceTo(hasta);
  const medio = desde.clone().add(hasta).multiplyScalar(0.5);
  const yaw = Math.atan2(hasta.x - desde.x, hasta.z - desde.z);
  const ancho = 0.32 + Math.sin(tiempo * 60) * 0.06;
  for (const [m, a] of [[haz, ancho], [nucleo, ancho * 0.35]] as const) {
    m.visible = true;
    m.position.copy(medio);
    m.rotation.set(0, yaw, 0);
    m.scale.set(a, a, largo);
  }
  matHaz.color.setHex(color);
  if (!luzHaz) luzHaz = pedirLuz(color, 30, 9);
  if (luzHaz) {
    luzHaz.color.setHex(color);
    luzHaz.position.copy(hasta);
  }
}

export function ocultarHaz() {
  haz.visible = nucleo.visible = false;
  soltarLuz(luzHaz);
  luzHaz = undefined;
}

// ---------------------------------------------------------------- números de daño y anuncios
const capaNumeros = document.getElementById('numeros')!;
interface Numero {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  vida: number;
  max: number;
}
const numeros: Numero[] = [];
const MAX_NUMEROS = 70;

export function numero(pos: THREE.Vector3, texto: string, color: string, grande = false) {
  if (numeros.length >= MAX_NUMEROS) {
    numeros[0]!.el.remove();
    numeros.shift();
  }
  const el = document.createElement('div');
  el.className = grande ? 'num grande' : 'num';
  el.textContent = texto;
  el.style.color = color;
  capaNumeros.appendChild(el);
  const max = grande ? 1.3 : 0.8;
  numeros.push({ el, pos: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))), vida: max, max });
}

const capaAnuncios = document.getElementById('anuncios')!;
/** Nombre de combo en grande en el centro de la pantalla. */
export function anuncio(texto: string, color: string) {
  const el = document.createElement('div');
  el.className = 'anuncio';
  el.textContent = texto;
  el.style.color = color;
  capaAnuncios.prepend(el);
  while (capaAnuncios.children.length > 3) capaAnuncios.lastElementChild!.remove();
  setTimeout(() => el.remove(), 1500);
}

// ---------------------------------------------------------------- actualización
const _p = new THREE.Vector3();
export function actualizarEfectos(dt: number) {
  for (let i = vivas.length - 1; i >= 0; i--) {
    const p = vivas[i]!;
    p.vida -= dt;
    if (p.vida <= 0) {
      quitarParticula(i);
      continue;
    }
    p.vel.y += p.gravedad * dt;
    p.vel.multiplyScalar(Math.exp(-p.arrastre * dt));
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.03) {
      p.mesh.position.y = 0.03;
      p.vel.y *= -0.3;
    }
    p.mesh.rotation.x += dt * 4;
    p.mesh.rotation.y += dt * 3;
    p.mesh.scale.setScalar(p.tam * Math.min(1, (p.vida / p.max) * 1.6));
  }
  for (let i = efimeros.length - 1; i >= 0; i--) {
    const e = efimeros[i]!;
    e.vida -= dt;
    const t = 1 - Math.max(0, e.vida) / e.max;
    e.alActualizar?.(t);
    e.mat.opacity = e.opacidad * (1 - t * t);
    if (e.luz) e.luz.intensity = (e.luzBase ?? 20) * (1 - t);
    if (e.vida <= 0) {
      e.obj.removeFromParent();
      (e.obj as THREE.Mesh).geometry?.dispose();
      e.mat.dispose();
      soltarLuz(e.luz);
      efimeros.splice(i, 1);
    }
  }
}

/** Coloca los números de daño en pantalla (se llama cada fotograma, también en pausa). */
export function actualizarNumeros(dt: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = numeros.length - 1; i >= 0; i--) {
    const n = numeros[i]!;
    n.vida -= dt;
    if (n.vida <= 0) {
      n.el.remove();
      numeros.splice(i, 1);
      continue;
    }
    const t = 1 - n.vida / n.max;
    _p.copy(n.pos);
    _p.y += 1.9 + t * 1.2;
    _p.project(camera);
    if (_p.z > 1) {
      n.el.style.display = 'none';
      continue;
    }
    n.el.style.display = '';
    n.el.style.transform = `translate(${((_p.x + 1) / 2) * w}px, ${((1 - _p.y) / 2) * h}px) translate(-50%, -50%)`;
    n.el.style.opacity = String(Math.min(1, (n.vida / n.max) * 2.5));
  }
}

export function limpiarEfectos() {
  while (vivas.length) quitarParticula(vivas.length - 1);
  for (const e of efimeros) {
    e.alActualizar?.(1);
    e.obj.removeFromParent();
    (e.obj as THREE.Mesh).geometry?.dispose();
    e.mat.dispose();
    soltarLuz(e.luz);
  }
  efimeros.length = 0;
  for (const n of numeros) n.el.remove();
  numeros.length = 0;
  ocultarHaz();
}

export function cuentaParticulas() {
  return vivas.length;
}
