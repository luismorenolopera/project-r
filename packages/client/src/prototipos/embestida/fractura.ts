import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

/**
 * Fractura de sólidos convexos por cortes planos sucesivos.
 *
 * Un objeto rompible es un poliedro convexo. Al romperse se corta con planos aleatorios
 * cerca del punto de impacto; cada trozo sigue siendo convexo, así que sirve tal cual
 * como `ConvexPolyhedron` en cannon-es y como malla en Three.js.
 *
 * Truco del corte: la intersección de la envolvente convexa de un conjunto de puntos con
 * un semiespacio es la envolvente de (puntos de ese lado) ∪ (cortes de todos los segmentos
 * que cruzan el plano). No hace falta conocer las aristas: basta con todos los pares.
 */

export interface Convexo {
  /** Vértices del casco (sin duplicados). */
  verts: THREE.Vector3[];
  /** Caras como polígonos convexos de índices, en sentido antihorario visto desde fuera. */
  faces: number[][];
  volumen: number;
  centro: THREE.Vector3;
}

export interface Plano {
  n: THREE.Vector3;
  d: number;
}

const EPS = 1e-6;

function dedup(points: THREE.Vector3[]): THREE.Vector3[] {
  const seen = new Set<string>();
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    const k = `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Envolvente convexa con caras coplanares fusionadas. Devuelve null si es degenerada. */
export function casco(input: THREE.Vector3[]): Convexo | null {
  const points = dedup(input);
  if (points.length < 4) return null;
  let hull: ConvexHull;
  try {
    hull = new ConvexHull().setFromPoints(points);
  } catch {
    return null;
  }
  if (hull.faces.length < 4) return null;

  const verts: THREE.Vector3[] = [];
  const index = new Map<THREE.Vector3, number>();
  const idx = (p: THREE.Vector3) => {
    let i = index.get(p);
    if (i === undefined) {
      i = verts.length;
      verts.push(p.clone());
      index.set(p, i);
    }
    return i;
  };

  // Agrupa los triángulos del casco por plano para obtener polígonos (menos ejes en el SAT de cannon).
  const groups: { n: THREE.Vector3; d: number; ids: Set<number> }[] = [];
  for (const f of hull.faces) {
    const n = f.normal.clone();
    const ids: number[] = [];
    let e = f.edge;
    do {
      ids.push(idx(e.head().point));
      e = e.next;
    } while (e !== f.edge);
    const d = n.dot(verts[ids[0]!]!);
    let g = groups.find((g) => g.n.dot(n) > 1 - 1e-5 && Math.abs(g.d - d) < 1e-4);
    if (!g) {
      g = { n, d, ids: new Set() };
      groups.push(g);
    }
    for (const i of ids) g.ids.add(i);
  }
  if (groups.length < 4) return null;

  const faces: number[][] = [];
  const c = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (const g of groups) {
    const ids = [...g.ids];
    if (ids.length < 3) continue;
    c.set(0, 0, 0);
    for (const i of ids) c.add(verts[i]!);
    c.divideScalar(ids.length);
    // Base ortonormal del plano para ordenar por ángulo (antihorario respecto a la normal).
    u.copy(verts[ids[0]!]!).sub(c).normalize();
    v.crossVectors(g.n, u);
    // Casco 2D del polígono (cadena monótona): quita puntos interiores o alineados.
    const pts2 = ids.map((i) => {
      tmp.copy(verts[i]!).sub(c);
      return { i, x: tmp.dot(u), y: tmp.dot(v) };
    });
    pts2.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: typeof pts2 = [];
    for (const q of pts2) {
      while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 1e-9) lower.pop();
      lower.push(q);
    }
    const upper: typeof pts2 = [];
    for (let k = pts2.length - 1; k >= 0; k--) {
      const q = pts2[k]!;
      while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 1e-9) upper.pop();
      upper.push(q);
    }
    const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (ring.length < 3) continue;
    ids.length = 0;
    for (const q of ring) ids.push(q.i);
    // Descarta caras espurias de triángulos casi degenerados: un plano válido deja todo detrás.
    const fn = normalCara(verts, ids, tmp);
    const fd = fn.dot(verts[ids[0]!]!);
    if (verts.some((p) => fn.dot(p) - fd > 1e-5)) continue;
    faces.push(ids);
  }

  // Elimina vértices que no quedaron en ninguna cara y reindexa.
  const used = new Map<number, number>();
  const finalVerts: THREE.Vector3[] = [];
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const old = f[k]!;
      let ni = used.get(old);
      if (ni === undefined) {
        ni = finalVerts.length;
        finalVerts.push(verts[old]!);
        used.set(old, ni);
      }
      f[k] = ni;
    }
  }

  const { volumen, centro } = volumenYCentro(finalVerts, faces);
  if (volumen < 1e-7) return null;
  return { verts: finalVerts, faces, volumen, centro };
}

export function volumenYCentro(verts: THREE.Vector3[], faces: number[][]) {
  const o = new THREE.Vector3();
  for (const p of verts) o.add(p);
  o.divideScalar(verts.length);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cr = new THREE.Vector3();
  let vol = 0;
  const centro = new THREE.Vector3();
  for (const f of faces) {
    const p0 = verts[f[0]!]!;
    for (let k = 1; k < f.length - 1; k++) {
      const p1 = verts[f[k]!]!;
      const p2 = verts[f[k + 1]!]!;
      a.subVectors(p1, p0);
      b.subVectors(p2, p0);
      cr.crossVectors(a, b);
      // Tetraedro (o, p0, p1, p2): volumen con signo.
      const tv = cr.dot(tmpSub(p0, o)) / 6;
      vol += tv;
      centro.x += (tv * (o.x + p0.x + p1.x + p2.x)) / 4;
      centro.y += (tv * (o.y + p0.y + p1.y + p2.y)) / 4;
      centro.z += (tv * (o.z + p0.z + p1.z + p2.z)) / 4;
    }
  }
  if (Math.abs(vol) > EPS) centro.divideScalar(vol);
  else centro.copy(o);
  return { volumen: vol, centro };
}

const _s = new THREE.Vector3();
function tmpSub(p: THREE.Vector3, o: THREE.Vector3) {
  return _s.subVectors(p, o);
}

/** Corta una nube de puntos convexa con el plano n·p = d. Devuelve [delante, detrás]. */
export function cortar(points: THREE.Vector3[], n: THREE.Vector3, d: number): [THREE.Vector3[], THREE.Vector3[]] {
  const dist = points.map((p) => n.dot(p) - d);
  const front: THREE.Vector3[] = [];
  const back: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    if (dist[i]! >= 0) front.push(points[i]!);
    else back.push(points[i]!);
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const di = dist[i]!;
      const dj = dist[j]!;
      if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
        const t = di / (di - dj);
        const q = points[i]!.clone().lerp(points[j]!, t);
        front.push(q);
        back.push(q.clone());
      }
    }
  }
  return [front, back];
}

export type Rnd = () => number;

/** Generador pseudoaleatorio reproducible (mulberry32). */
export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rnd: Rnd, out = new THREE.Vector3()) {
  const z = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

/**
 * Parte un convexo en `piezas` trozos convexos. Los cortes se concentran cerca del impacto,
 * de modo que esa zona queda hecha añicos y el lado opuesto en trozos grandes.
 */
export function fracturar(original: Convexo, impacto: THREE.Vector3, piezas: number, rnd: Rnd): Convexo[] {
  let trozos: Convexo[] = [original];
  const minVol = original.volumen * 0.012;
  let intentos = 0;
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  while (trozos.length < piezas && intentos < piezas * 12) {
    intentos++;
    // Elige un trozo: los grandes y los cercanos al impacto tienen más papeletas.
    let total = 0;
    const pesos = trozos.map((t) => {
      const w = t.volumen / (0.15 + t.centro.distanceTo(impacto));
      total += w;
      return w;
    });
    let r = rnd() * total;
    let k = 0;
    while (k < trozos.length - 1 && r > pesos[k]!) r -= pesos[k++]!;
    const t = trozos[k]!;

    // Plano por un punto entre el centro del trozo y el impacto, con orientación aleatoria.
    const radio = Math.cbrt(t.volumen);
    p.copy(t.centro).lerp(impacto, 0.25 * rnd());
    p.x += (rnd() - 0.5) * radio * 0.4;
    p.y += (rnd() - 0.5) * radio * 0.4;
    p.z += (rnd() - 0.5) * radio * 0.4;
    randomUnit(rnd, n);
    const [a, b] = cortar(t.verts, n, n.dot(p));
    const ca = casco(a);
    const cb = casco(b);
    if (!ca || !cb || ca.volumen < minVol || cb.volumen < minVol) continue;
    trozos = trozos.filter((x) => x !== t);
    trozos.push(ca, cb);
  }
  return trozos;
}

/** Planos de las caras del convexo original, para distinguir superficie exterior de interior. */
/** Normal de un polígono por el método de Newell (robusto ante vértices casi alineados). */
export function normalCara(verts: THREE.Vector3[], f: number[], out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  for (let k = 0; k < f.length; k++) {
    const a = verts[f[k]!]!;
    const b = verts[f[(k + 1) % f.length]!]!;
    out.x += (a.y - b.y) * (a.z + b.z);
    out.y += (a.z - b.z) * (a.x + b.x);
    out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out.normalize();
}

export function planosDe(c: Convexo): Plano[] {
  return c.faces.map((f) => {
    const n = normalCara(c.verts, f);
    return { n, d: n.dot(c.verts[f[0]!]!) };
  });
}

export interface OpcionesMalla {
  /** Metros por repetición de textura. */
  escalaUV: number;
  colorExterior: THREE.Color;
  colorInterior: THREE.Color;
}

/**
 * Geometría plana (sin índices) de un trozo, centrada en `centro`.
 * Las UV se proyectan en coordenadas del objeto original, así la textura continúa entre trozos.
 * Las caras nuevas del corte se tiñen con `colorInterior` (madera clara, barro cocido...).
 */
export function geometriaDe(c: Convexo, centro: THREE.Vector3, planos: Plano[], o: OpcionesMalla): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const n = new THREE.Vector3();
  const fc = new THREE.Vector3();
  for (const f of c.faces) {
    const a = c.verts[f[0]!]!;
    normalCara(c.verts, f, n);
    fc.set(0, 0, 0);
    for (const i of f) fc.add(c.verts[i]!);
    fc.divideScalar(f.length);
    const exterior = planos.some((pl) => pl.n.dot(n) > 0.995 && Math.abs(pl.n.dot(fc) - pl.d) < 2e-3);
    const color = exterior ? o.colorExterior : o.colorInterior;
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const push = (p: THREE.Vector3) => {
      pos.push(p.x - centro.x, p.y - centro.y, p.z - centro.z);
      nor.push(n.x, n.y, n.z);
      let s: number;
      let t: number;
      if (ax >= ay && ax >= az) {
        s = p.z;
        t = p.y;
      } else if (ay >= az) {
        s = p.x;
        t = p.z;
      } else {
        s = p.x;
        t = p.y;
      }
      uv.push(s / o.escalaUV + 0.5, t / o.escalaUV + 0.5);
      col.push(color.r, color.g, color.b);
    };
    for (let k = 1; k < f.length - 1; k++) {
      push(a);
      push(c.verts[f[k]!]!);
      push(c.verts[f[k + 1]!]!);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---------- Formas base de los rompibles ----------

export function formaCaja(w: number, h: number, d: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) for (const z of [-d / 2, d / 2]) pts.push(new THREE.Vector3(x, y, z));
  return pts;
}

/** Sólido de revolución low-poly a partir de anillos [y, radio]. */
export function formaTorno(anillos: [number, number][], lados: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const [y, r] of anillos) {
    if (r <= 0) {
      pts.push(new THREE.Vector3(0, y, 0));
      continue;
    }
    for (let i = 0; i < lados; i++) {
      const a = ((i + 0.5) / lados) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
  }
  return pts;
}
