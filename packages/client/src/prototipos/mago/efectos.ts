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
/**
 * Todas las partículas se dibujan con dos InstancedMesh (mezcla normal y aditiva): dos llamadas de
 * dibujo en vez de una por cubo. Antes cada partícula era un THREE.Mesh propio y una explosión en
 * cadena llegaba a 900 mallas (900 llamadas de dibujo y 900 objetos nuevos para el recolector).
 * El estado vive en arrays planos y se reutiliza: al morir una partícula, la última ocupa su hueco.
 */
const MAX_PARTICULAS = 900;
const geoCubo = new THREE.BoxGeometry(1, 1, 1);

class Lote {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  readonly pos = new Float32Array(MAX_PARTICULAS * 3);
  readonly vel = new Float32Array(MAX_PARTICULAS * 3);
  readonly rot = new Float32Array(MAX_PARTICULAS * 2);
  /** vida, max, gravedad, tam, arrastre */
  readonly datos = new Float32Array(MAX_PARTICULAS * 5);
  readonly color = new Float32Array(MAX_PARTICULAS * 3);

  constructor(aditivo: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: aditivo ? 0.9 : 0.75,
      depthWrite: false,
      blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geoCubo, mat, MAX_PARTICULAS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.color, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Las partículas se reparten por toda la escena: la caja de la geometría base no sirve para recortar.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  quitar(i: number) {
    const u = --this.n;
    if (i === u) return;
    this.pos.copyWithin(i * 3, u * 3, u * 3 + 3);
    this.vel.copyWithin(i * 3, u * 3, u * 3 + 3);
    this.rot.copyWithin(i * 2, u * 2, u * 2 + 2);
    this.datos.copyWithin(i * 5, u * 5, u * 5 + 5);
    this.color.copyWithin(i * 3, u * 3, u * 3 + 3);
  }
}
const lotes = [new Lote(false), new Lote(true)] as const;
const _color = new THREE.Color();

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

const _vel = new THREE.Vector3();
export function particulas(pos: THREE.Vector3, color: number, n: number, fuerza: number, o: OpcionesParticulas = {}) {
  const lote = lotes[o.aditivo ? 1 : 0];
  // El color de instancia se multiplica por el del material (blanco); se guarda en espacio lineal
  // como haría `material.color`.
  _color.setHex(color);
  for (let k = 0; k < n; k++) {
    // Lleno: se sustituye la partícula más vieja que quede a mano (la del hueco 0 nació antes que la media).
    const i = lote.n < MAX_PARTICULAS ? lote.n++ : Math.floor(Math.random() * MAX_PARTICULAS);
    let x = pos.x;
    let y = pos.y;
    let z = pos.z;
    if (o.dispersion) {
      x += rand(-1, 1) * o.dispersion;
      y += rand(-0.5, 0.5) * o.dispersion;
      z += rand(-1, 1) * o.dispersion;
    }
    lote.pos[i * 3] = x;
    lote.pos[i * 3 + 1] = y;
    lote.pos[i * 3 + 2] = z;
    _vel.set(rand(-1, 1), rand(0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(fuerza * rand(0.3, 1));
    if (o.dir) _vel.addScaledVector(o.dir, fuerza * rand(0.4, 1));
    lote.vel[i * 3] = _vel.x;
    lote.vel[i * 3 + 1] = _vel.y;
    lote.vel[i * 3 + 2] = _vel.z;
    lote.rot[i * 2] = 0;
    lote.rot[i * 2 + 1] = 0;
    const max = (o.vida ?? 0.8) * rand(0.6, 1.3);
    const d = lote.datos;
    d[i * 5] = max;
    d[i * 5 + 1] = max;
    d[i * 5 + 2] = o.gravedad ?? -3;
    d[i * 5 + 3] = (o.tam ?? 0.12) * rand(0.6, 1.5);
    d[i * 5 + 4] = o.arrastre ?? 2.5;
    lote.color[i * 3] = _color.r;
    lote.color[i * 3 + 1] = _color.g;
    lote.color[i * 3 + 2] = _color.b;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pp = new THREE.Vector3();
const _s = new THREE.Vector3();
function actualizarParticulas(dt: number) {
  for (const lote of lotes) {
    const { pos, vel, rot, datos } = lote;
    for (let i = lote.n - 1; i >= 0; i--) {
      const vida = (datos[i * 5] -= dt);
      if (vida <= 0) lote.quitar(i);
    }
    const arr = Math.exp(-2.5 * dt);
    for (let i = 0; i < lote.n; i++) {
      const vida = datos[i * 5]!;
      const max = datos[i * 5 + 1]!;
      const tam = datos[i * 5 + 3]!;
      const k = datos[i * 5 + 4] === 2.5 ? arr : Math.exp(-datos[i * 5 + 4]! * dt);
      vel[i * 3 + 1] += datos[i * 5 + 2]! * dt;
      vel[i * 3] *= k;
      vel[i * 3 + 1] *= k;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3]! * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1]! * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2]! * dt;
      if (pos[i * 3 + 1]! < 0.03) {
        pos[i * 3 + 1] = 0.03;
        vel[i * 3 + 1] *= -0.3;
      }
      rot[i * 2] += dt * 4;
      rot[i * 2 + 1] += dt * 3;
      _q.setFromEuler(_e.set(rot[i * 2]!, rot[i * 2 + 1]!, 0));
      _s.setScalar(tam * Math.min(1, (vida / max) * 1.6));
      _m.compose(_pp.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!), _q, _s);
      _m.toArray(lote.mesh.instanceMatrix.array, i * 16);
    }
    lote.mesh.count = lote.n;
    if (lote.n > 0) {
      lote.mesh.instanceMatrix.clearUpdateRanges();
      lote.mesh.instanceMatrix.addUpdateRange(0, lote.n * 16);
      lote.mesh.instanceMatrix.needsUpdate = true;
      lote.mesh.instanceColor!.clearUpdateRanges();
      lote.mesh.instanceColor!.addUpdateRange(0, lote.n * 3);
      lote.mesh.instanceColor!.needsUpdate = true;
    }
  }
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
  actualizarParticulas(dt);
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
  for (const l of lotes) {
    l.n = 0;
    l.mesh.count = 0;
  }
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
  return lotes[0].n + lotes[1].n;
}
