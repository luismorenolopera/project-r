import * as THREE from 'three';
import { ClassId, Kind } from '@mazmorra/shared';
import { psxLambert } from './psx';
import type { Textures } from './textures';

/**
 * Modelos low-poly procedurales (marcadores de posición hasta que haya arte, D-07).
 * Todos comparten un esqueleto humanoide de 6 partes que también usa el ragdoll.
 */
export type PartName = 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR';

export interface ModelPart {
  name: PartName;
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
  size: [number, number, number];
}

export interface Model {
  root: THREE.Group;
  body: THREE.Group;
  parts: Record<PartName, ModelPart>;
  scale: number;
  floats: boolean;
  walkPhase: number;
  attackT: number;
  attackDur: number;
  attackStyle: 'swing' | 'cast' | 'throw' | 'shoot' | 'spin' | 'none';
  hurtT: number;
  windup: number;
  /** Elementos extra del modelo que cambian con estados. */
  emissiveMats: THREE.MeshLambertMaterial[];
}

let textures: Textures;
const matCache = new Map<string, THREE.MeshLambertMaterial>();

export function initModels(t: Textures) {
  textures = t;
}

function mat(color: number, opts: { emissive?: number; map?: THREE.Texture | null; transparent?: boolean; opacity?: number; unique?: boolean } = {}) {
  const key = `${color}-${opts.emissive ?? 0}-${opts.map === null ? 'n' : 'g'}-${opts.opacity ?? 1}`;
  if (!opts.unique) {
    const hit = matCache.get(key);
    if (hit) return hit;
  }
  const m = psxLambert({
    color,
    emissive: opts.emissive ?? 0x000000,
    map: opts.map === null ? null : (opts.map ?? textures.grain),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: !opts.transparent,
  });
  if (!opts.unique) matCache.set(key, m);
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

interface HumanoidOpts {
  skin: number;
  torso: number;
  arms?: number;
  legs: number;
  torsoSize?: [number, number, number];
  headSize?: [number, number, number];
  limbW?: number;
  scale?: number;
  transparent?: boolean;
  emissive?: number;
}

function humanoid(o: HumanoidOpts): Model {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = o.scale ?? 1;
  body.scale.setScalar(s);
  const lw = o.limbW ?? 0.18;
  const tSize = o.torsoSize ?? [0.5, 0.7, 0.3];
  const hSize = o.headSize ?? [0.3, 0.3, 0.3];
  const mo = { transparent: o.transparent, opacity: o.transparent ? 0.55 : 1, emissive: o.emissive };

  const mk = (name: PartName, size: [number, number, number], color: number, pivotPos: [number, number, number], meshOffsetY: number): ModelPart => {
    const pivot = new THREE.Group();
    pivot.position.set(...pivotPos);
    const mesh = new THREE.Mesh(box(...size), mat(color, mo));
    mesh.position.y = meshOffsetY;
    pivot.add(mesh);
    body.add(pivot);
    return { name, pivot, mesh, size };
  };

  const hipY = 0.9;
  const parts: Record<PartName, ModelPart> = {
    torso: mk('torso', tSize, o.torso, [0, hipY, 0], tSize[1] / 2),
    head: mk('head', hSize, o.skin, [0, hipY + tSize[1], 0], hSize[1] / 2 + 0.02),
    armL: mk('armL', [lw, 0.68, lw], o.arms ?? o.torso, [-(tSize[0] / 2 + lw / 2 + 0.01), hipY + tSize[1] - 0.06, 0], -0.34),
    armR: mk('armR', [lw, 0.68, lw], o.arms ?? o.torso, [tSize[0] / 2 + lw / 2 + 0.01, hipY + tSize[1] - 0.06, 0], -0.34),
    legL: mk('legL', [lw + 0.02, hipY, lw + 0.02], o.legs, [-0.12, hipY, 0], -hipY / 2),
    legR: mk('legR', [lw + 0.02, hipY, lw + 0.02], o.legs, [0.12, hipY, 0], -hipY / 2),
  };
  return {
    root, body, parts, scale: s, floats: false, walkPhase: Math.random() * 6, attackT: 0, attackDur: 0.3,
    attackStyle: 'none', hurtT: 0, windup: 0, emissiveMats: [],
  };
}

/** Añade un objeto a la mano derecha (o izquierda). */
function inHand(m: Model, obj: THREE.Object3D, left = false) {
  const arm = left ? m.parts.armL.mesh : m.parts.armR.mesh;
  obj.position.y += -0.34;
  arm.add(obj);
}

function onHead(m: Model, obj: THREE.Object3D) {
  m.parts.head.mesh.add(obj);
}

function eyes(m: Model, color: number) {
  const e = mat(color, { emissive: color, map: null });
  for (const x of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(box(0.06, 0.04, 0.02), e);
    eye.position.set(x, 0.02, -0.16);
    m.parts.head.mesh.add(eye);
  }
}

function sword(color = 0xb0b4bc, len = 0.9) {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(box(0.06, len, 0.02), mat(color, { emissive: 0x111111 }));
  blade.position.set(0, -len / 2 - 0.08, -0.05);
  const guard = new THREE.Mesh(box(0.22, 0.04, 0.06), mat(0x7a5a2a));
  guard.position.set(0, -0.06, -0.05);
  g.add(blade, guard);
  g.rotation.x = -Math.PI / 2.2;
  return g;
}

function buildHero(cls: ClassId): Model {
  switch (cls) {
    case ClassId.Guerrero: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0x8a3b2a, arms: 0x6a6e78, legs: 0x3a3a44, torsoSize: [0.58, 0.72, 0.34] });
      inHand(m, sword());
      const helm = new THREE.Mesh(box(0.34, 0.2, 0.34), mat(0x6a6e78, { emissive: 0x050505 }));
      helm.position.y = 0.08;
      onHead(m, helm);
      for (const side of [-1, 1]) {
        const pad = new THREE.Mesh(box(0.24, 0.12, 0.3), mat(0x6a6e78));
        pad.position.set(side * 0.31, 0.32, 0);
        m.parts.torso.mesh.add(pad);
      }
      const shield = new THREE.Mesh(box(0.06, 0.5, 0.4), mat(0x5a2a1e));
      shield.position.set(-0.08, -0.4, 0);
      m.parts.armL.mesh.add(shield);
      return m;
    }
    case ClassId.Mago: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0x2c2f6a, arms: 0x2c2f6a, legs: 0x22244a, torsoSize: [0.46, 0.74, 0.3] });
      const staff = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), mat(0x5a3a22, { map: textures.wood }));
      pole.position.y = -0.2;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), mat(0x8a7cff, { emissive: 0x5a4cff, map: null }));
      gem.position.y = 0.66;
      staff.add(pole, gem);
      inHand(m, staff);
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 6), mat(0x22244a));
      hat.position.y = 0.36;
      onHead(m, hat);
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.6, 6), mat(0x2c2f6a));
      robe.position.y = -0.55;
      m.parts.torso.mesh.add(robe);
      return m;
    }
    case ClassId.Arquero: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0x2f6b34, arms: 0x4a3a28, legs: 0x3a2e22, torsoSize: [0.48, 0.7, 0.3] });
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 3, 8, Math.PI), mat(0x6a4a2a, { map: textures.wood }));
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      bow.position.set(0, -0.3, 0);
      inHand(m, bow, true);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.36, 5), mat(0x234f28));
      hood.position.y = 0.16;
      onHead(m, hood);
      const quiver = new THREE.Mesh(box(0.14, 0.5, 0.14), mat(0x4a3a28));
      quiver.position.set(0.12, 0.1, 0.2);
      quiver.rotation.z = 0.3;
      m.parts.torso.mesh.add(quiver);
      return m;
    }
    case ClassId.Curador: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0xd8d0b8, arms: 0xb8a24a, legs: 0x6a5a3a, torsoSize: [0.5, 0.72, 0.32] });
      const mace = new THREE.Group();
      const handle = new THREE.Mesh(box(0.05, 0.5, 0.05), mat(0x5a3a22, { map: textures.wood }));
      handle.position.y = -0.2;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(0xd8b84a, { emissive: 0x3a2a00 }));
      head.position.y = -0.46;
      mace.add(handle, head);
      mace.rotation.x = -Math.PI / 2.4;
      inHand(m, mace);
      const relic = new THREE.Mesh(box(0.12, 0.16, 0.12), mat(0xffe08a, { emissive: 0xffc040, map: null }));
      relic.position.set(0, -0.42, 0);
      m.parts.armL.mesh.add(relic);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 3, 10), mat(0xffe08a, { emissive: 0xffc040, map: null }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.3;
      onHead(m, halo);
      const tabard = new THREE.Mesh(box(0.3, 0.5, 0.02), mat(0xb8a24a));
      tabard.position.set(0, -0.1, -0.17);
      m.parts.torso.mesh.add(tabard);
      return m;
    }
    case ClassId.Alquimista: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0x5a3a2a, arms: 0x6b3f7a, legs: 0x2e2a2a, torsoSize: [0.5, 0.7, 0.32] });
      const colors = [0x6aff4a, 0xff8a2a, 0xb04aff];
      colors.forEach((col, i) => {
        const vial = new THREE.Mesh(box(0.08, 0.14, 0.08), mat(col, { emissive: col, map: null }));
        vial.position.set(-0.16 + i * 0.16, -0.28, -0.18);
        m.parts.torso.mesh.add(vial);
      });
      const flask = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), mat(0x6aff4a, { emissive: 0x2a8a1a, map: null }));
      flask.position.y = -0.4;
      inHand(m, flask);
      const goggles = new THREE.Mesh(box(0.32, 0.08, 0.04), mat(0xffb040, { emissive: 0x8a5a10, map: null }));
      goggles.position.set(0, 0.04, -0.16);
      onHead(m, goggles);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.14, 6), mat(0x3a2a2a));
      hat.position.y = 0.2;
      onHead(m, hat);
      return m;
    }
  }
}

function buildMonster(kind: Kind): Model {
  switch (kind) {
    case Kind.Esqueleto: {
      const m = humanoid({ skin: 0xd8d2c0, torso: 0xc8c2b0, legs: 0xc8c2b0, limbW: 0.1, torsoSize: [0.4, 0.66, 0.2] });
      eyes(m, 0xff3a2a);
      inHand(m, sword(0x6a5a4a, 0.75));
      for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(box(0.44, 0.04, 0.24), mat(0xb8b2a0));
        rib.position.y = 0.15 - i * 0.12;
        m.parts.torso.mesh.add(rib);
      }
      return m;
    }
    case Kind.Cultista: {
      const m = humanoid({ skin: 0x8a6a5a, torso: 0x6a1a1a, arms: 0x5a1414, legs: 0x3a0e0e });
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 5), mat(0x4a0e0e));
      hood.position.y = 0.2;
      onHead(m, hood);
      eyes(m, 0xffaa2a);
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.4, 0.7, 6), mat(0x5a1414));
      robe.position.y = -0.6;
      m.parts.torso.mesh.add(robe);
      for (const arm of [m.parts.armL.mesh, m.parts.armR.mesh]) {
        const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), mat(0xff7a1a, { emissive: 0xff5a0a, map: null }));
        flame.position.y = -0.4;
        arm.add(flame);
      }
      return m;
    }
    case Kind.Bruto: {
      const m = humanoid({ skin: 0x6a7a5a, torso: 0x5a6a4a, arms: 0x6a7a5a, legs: 0x3a3226, torsoSize: [0.7, 0.7, 0.5], headSize: [0.32, 0.28, 0.32], limbW: 0.26, scale: 1.45 });
      eyes(m, 0xffe02a);
      const club = new THREE.Mesh(box(0.16, 0.8, 0.16), mat(0x4a3220, { map: textures.wood }));
      club.position.y = -0.5;
      inHand(m, club);
      const spikes = new THREE.Mesh(box(0.22, 0.24, 0.22), mat(0x5a5a5a));
      spikes.position.y = -0.85;
      m.parts.armR.mesh.add(spikes);
      club.position.y = -0.55;
      m.body.rotation.x = 0.15;
      return m;
    }
    case Kind.Espectro: {
      const m = humanoid({ skin: 0x9ac8ff, torso: 0x6a9ad8, legs: 0x4a6a9a, transparent: true, emissive: 0x1a3a6a, limbW: 0.14 });
      eyes(m, 0xaaffff);
      m.parts.legL.mesh.visible = false;
      m.parts.legR.mesh.visible = false;
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 5), mat(0x6a9ad8, { transparent: true, opacity: 0.45, emissive: 0x1a3a6a }));
      tail.rotation.x = Math.PI;
      tail.position.y = -0.5;
      m.parts.torso.mesh.add(tail);
      m.floats = true;
      return m;
    }
    case Kind.Muneco: {
      const root = new THREE.Group();
      const m = humanoid({ skin: 0xc8a870, torso: 0x9a7a4a, legs: 0x6a4a2a, limbW: 0.14 });
      m.parts.legL.mesh.visible = false;
      m.parts.legR.mesh.visible = false;
      const post = new THREE.Mesh(box(0.14, 0.95, 0.14), mat(0x6a4a2a, { map: textures.wood }));
      post.position.y = -0.47;
      m.parts.torso.mesh.add(post);
      m.parts.armL.pivot.rotation.z = -Math.PI / 2;
      m.parts.armR.pivot.rotation.z = Math.PI / 2;
      const target = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), mat(0xaa2a1a, { map: null }));
      target.position.set(0, 0.05, -0.16);
      target.rotation.y = Math.PI;
      m.parts.torso.mesh.add(target);
      void root;
      return m;
    }
    case Kind.Aliado: {
      const m = humanoid({ skin: 0xc49a7a, torso: 0x2a4a7a, arms: 0x8a8e98, legs: 0x4a4a54, torsoSize: [0.56, 0.72, 0.34] });
      const helm = new THREE.Mesh(box(0.34, 0.34, 0.34), mat(0x8a8e98, { emissive: 0x050505 }));
      helm.position.y = 0.03;
      onHead(m, helm);
      const plume = new THREE.Mesh(box(0.06, 0.2, 0.3), mat(0x3a6aff, { emissive: 0x0a1a5a }));
      plume.position.y = 0.25;
      onHead(m, plume);
      inHand(m, sword(0xc0c4cc, 0.8));
      return m;
    }
    default:
      return humanoid({ skin: 0xff00ff, torso: 0xff00ff, legs: 0xff00ff });
  }
}

export function buildModel(kind: Kind, cls: ClassId = ClassId.Guerrero): Model {
  const m = kind === Kind.Heroe ? buildHero(cls) : buildMonster(kind);
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return m;
}

export interface AnimInput {
  dt: number;
  speed: number;
  airborne: boolean;
  stunned: boolean;
  windup: number;
  spinning: boolean;
  guarding: boolean;
  time: number;
}

/** Animación procedural: caminar, atacar, preparar golpe, aturdido, flotar. */
export function animateModel(m: Model, a: AnimInput) {
  const p = m.parts;
  if (a.speed > 0.3 && !a.airborne) m.walkPhase += a.dt * (4 + a.speed * 1.4);
  const swing = a.airborne ? 0.5 : Math.min(1, a.speed / 5) * 0.8;
  const w = Math.sin(m.walkPhase) * swing;
  p.legL.pivot.rotation.x = a.airborne ? -0.6 : w;
  p.legR.pivot.rotation.x = a.airborne ? 0.3 : -w;
  let armL = -w * 0.8;
  let armR = w * 0.8;
  let armRz = 0;
  let armLz = 0;
  let torsoY = 0;

  if (m.attackT > 0) {
    m.attackT = Math.max(0, m.attackT - a.dt);
    const t = 1 - m.attackT / m.attackDur;
    switch (m.attackStyle) {
      case 'swing':
        armR = -2.4 + t * 3.2;
        armRz = 0.3;
        torsoY = (t - 0.5) * 0.8;
        break;
      case 'cast':
        armR = -1.5;
        armL = -1.2 * (1 - t);
        break;
      case 'shoot':
        armL = -1.55;
        armR = -1.4 + t * 0.4;
        armRz = -0.5;
        break;
      case 'throw':
        armR = -2.8 + t * 2.6;
        break;
      case 'spin':
        break;
    }
  }
  if (a.windup > 0) {
    armR = -2.6;
    armL = -2.2;
    torsoY = -0.2;
  }
  if (a.guarding) {
    armL = -1.4;
    armLz = 0.6;
  }
  if (a.stunned) {
    armL = 0.3;
    armR = 0.3;
    armLz = -0.4;
    armRz = 0.4;
  }
  p.armL.pivot.rotation.x = armL;
  p.armR.pivot.rotation.x = armR;
  p.armR.pivot.rotation.z = armRz;
  p.armL.pivot.rotation.z = armLz;
  p.torso.pivot.rotation.y = torsoY;
  if (a.spinning) m.body.rotation.y += a.dt * 22;
  else m.body.rotation.y = 0;
  p.head.pivot.rotation.z = a.stunned ? Math.sin(a.time * 8) * 0.3 : 0;

  if (m.floats) m.body.position.y = 0.45 + Math.sin(a.time * 2.5 + m.walkPhase) * 0.12;
  else m.body.position.y = a.speed > 0.3 && !a.airborne ? Math.abs(Math.sin(m.walkPhase)) * 0.05 : 0;

  if (m.hurtT > 0) {
    m.hurtT = Math.max(0, m.hurtT - a.dt);
    m.body.position.x = Math.sin(m.hurtT * 80) * 0.05;
  } else m.body.position.x = 0;
}

export function triggerAttack(m: Model, style: Model['attackStyle'], dur = 0.3) {
  m.attackStyle = style;
  m.attackDur = dur;
  m.attackT = dur;
}

export function disposeModel(m: Model) {
  m.root.removeFromParent();
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
