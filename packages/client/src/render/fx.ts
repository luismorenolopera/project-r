import * as THREE from 'three';
import { Element, ProjDef, ZoneDef, type Sim } from '@mazmorra/shared';

export const ELEMENT_COLORS: Record<Element, number> = {
  [Element.Fisico]: 0xe8e0d0,
  [Element.Fuego]: 0xff7a1a,
  [Element.Hielo]: 0x8adfff,
  [Element.Veneno]: 0x7aff3a,
  [Element.Sagrado]: 0xffe27a,
  [Element.Arcano]: 0xa88aff,
  [Element.Aceite]: 0x6a4a1a,
};

const additive = (color: number, opacity = 0.8) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
}

interface Flash {
  obj: THREE.Object3D;
  life: number;
  max: number;
  grow: number;
  light?: THREE.PointLight;
}

/**
 * Reserva fija de luces puntuales. Añadir o quitar luces obliga a Three.js a recompilar
 * los shaders (tirones), así que las luces de efectos se reutilizan siempre.
 */
class LightPool {
  private readonly free: THREE.PointLight[] = [];
  constructor(scene: THREE.Scene, n: number) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.5);
      scene.add(l);
      this.free.push(l);
    }
  }
  acquire(color: number, intensity: number, distance: number): THREE.PointLight | undefined {
    const l = this.free.pop();
    if (!l) return undefined;
    l.color.setHex(color);
    l.intensity = intensity;
    l.distance = distance;
    return l;
  }
  release(l: THREE.PointLight | undefined) {
    if (!l) return;
    l.intensity = 0;
    this.free.push(l);
  }
}

/** Efectos visuales: proyectiles, zonas, indicadores de ataque en el suelo, partículas y explosiones. */
export class Fx {
  private readonly projectiles = new Map<number, { obj: THREE.Object3D; el: number }>();
  private readonly zones = new Map<number, { obj: THREE.Group; def: ZoneDef; light?: THREE.PointLight; parts: THREE.Mesh[] }>();
  private readonly telegraphs = new Map<number, { group: THREE.Group; outline: THREE.Mesh; fill: THREE.Mesh; shape: number }>();
  private readonly particles: Particle[] = [];
  private readonly flashes: Flash[] = [];
  private readonly particleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
  private readonly particleMats = new Map<number, THREE.MeshBasicMaterial>();
  readonly reticle: THREE.Mesh;
  readonly allyMarker: THREE.Mesh;
  private readonly lights: LightPool;

  constructor(private readonly scene: THREE.Scene) {
    this.lights = new LightPool(scene, 8);
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 12), additive(0xffffff, 0.35));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.position.y = 0.03;
    scene.add(this.reticle);
    this.allyMarker = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 12), additive(0x6aa8ff, 0.7));
    this.allyMarker.rotation.x = -Math.PI / 2;
    this.allyMarker.visible = false;
    scene.add(this.allyMarker);
  }

  private particleMat(color: number) {
    let m = this.particleMats.get(color);
    if (!m) {
      m = additive(color, 1);
      this.particleMats.set(color, m);
    }
    return m;
  }

  burst(x: number, y: number, z: number, color: number, n = 8, speed = 4, gravity = 9) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 400) break;
      const mesh = new THREE.Mesh(this.particleGeo, this.particleMat(color));
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      const life = 0.3 + Math.random() * 0.4;
      this.particles.push({ mesh, vel: v, life, max: life, gravity });
    }
  }

  ring(x: number, z: number, r: number, color: number, life = 0.45, light = true) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 20), additive(color, 0.9));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    const f: Flash = { obj: mesh, life, max: life, grow: r };
    if (light) {
      f.light = this.lights.acquire(color, 40, r * 4);
      f.light?.position.set(x, 1.2, z);
    }
    this.flashes.push(f);
  }

  explosion(x: number, z: number, r: number, el: Element) {
    const color = ELEMENT_COLORS[el];
    this.ring(x, z, r, color, 0.5, true);
    this.burst(x, 0.5, z, color, 26, 9, 12);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), additive(color, 0.7));
    ball.position.set(x, 0.6, z);
    ball.scale.setScalar(0.2);
    this.scene.add(ball);
    this.flashes.push({ obj: ball, life: 0.35, max: 0.35, grow: r * 0.7 });
  }

  // ---------------- proyectiles ----------------
  addProjectile(eid: number, sim: Sim) {
    const P = sim.c.Projectile;
    const def = P.def[eid] as ProjDef;
    const el = P.el[eid] as Element;
    const color = ELEMENT_COLORS[el];
    let obj: THREE.Object3D;
    switch (def) {
      case ProjDef.Flecha:
      case ProjDef.Perforante: {
        const g = new THREE.Group();
        const len = def === ProjDef.Perforante ? 1.1 : 0.8;
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), additive(color, 1));
        const trail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len * 1.8), additive(color, 0.35));
        trail.position.z = len * 0.9;
        g.add(shaft, trail);
        obj = g;
        break;
      }
      case ProjDef.Red: {
        obj = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 3, 8), additive(0xd8c8a0, 0.9));
        break;
      }
      case ProjDef.RayoLuz: {
        obj = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.6), additive(color, 0.9));
        break;
      }
      case ProjDef.FrascoToxico:
      case ProjDef.FrascoAceite:
      case ProjDef.FrascoAcido: {
        const c = def === ProjDef.FrascoAceite ? 0xb08a3a : def === ProjDef.FrascoAcido ? 0xb04aff : 0x7aff3a;
        obj = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), additive(c, 1));
        break;
      }
      default: {
        obj = new THREE.Mesh(new THREE.IcosahedronGeometry(def === ProjDef.BolaFuego ? 0.28 : 0.22, 0), additive(color, 1));
        const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), additive(color, 0.25));
        obj.add(halo);
      }
    }
    this.scene.add(obj);
    this.projectiles.set(eid, { obj, el });
  }

  updateProjectile(eid: number, sim: Sim, alpha: number) {
    const v = this.projectiles.get(eid);
    if (!v) return;
    const c = sim.c;
    const x = THREE.MathUtils.lerp(c.Pos.px[eid]!, c.Pos.x[eid]!, alpha);
    const y = THREE.MathUtils.lerp(c.Pos.py[eid]!, c.Pos.y[eid]!, alpha);
    const z = THREE.MathUtils.lerp(c.Pos.pz[eid]!, c.Pos.z[eid]!, alpha);
    v.obj.position.set(x, y, z);
    const vx = c.Vel.x[eid]!;
    const vz = c.Vel.z[eid]!;
    if (vx || vz) v.obj.rotation.y = Math.atan2(vx, vz);
    else v.obj.rotation.x += 0.3;
    const el = c.Projectile.el[eid]!;
    if (el !== v.el) {
      // Sinergia: el proyectil cambió de elemento al cruzar una zona aliada.
      v.el = el;
      v.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.MeshBasicMaterial).color.setHex(ELEMENT_COLORS[el as Element]);
      });
      this.burst(x, y, z, ELEMENT_COLORS[el as Element], 10, 3, 2);
    }
    if (Math.random() < 0.35) this.burst(x, y, z, ELEMENT_COLORS[el as Element], 1, 0.5, 0);
  }

  removeProjectile(eid: number) {
    const v = this.projectiles.get(eid);
    if (!v) return;
    v.obj.removeFromParent();
    disposeTree(v.obj);
    this.projectiles.delete(eid);
  }

  hasProjectile(eid: number) {
    return this.projectiles.has(eid);
  }

  // ---------------- zonas ----------------
  addZone(eid: number, sim: Sim) {
    const c = sim.c;
    const def = c.Zone.def[eid] as ZoneDef;
    const group = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    let light: THREE.PointLight | undefined;
    const x = c.Pos.x[eid]!;
    const z = c.Pos.z[eid]!;
    const r = c.Zone.r[eid]!;
    if (def === ZoneDef.MuroIgneo) {
      const x2 = c.Zone.x2[eid]!;
      const z2 = c.Zone.z2[eid]!;
      const len = Math.hypot(x2 - x, z2 - z);
      const n = Math.ceil(len / 0.6);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 4), additive(i % 2 ? 0xff5a0a : 0xffa02a, 0.85));
        flame.position.set(x + (x2 - x) * t, 0.8, z + (z2 - z) * t);
        flame.userData.phase = Math.random() * 6;
        group.add(flame);
        parts.push(flame);
      }
      const base = new THREE.Mesh(new THREE.PlaneGeometry(len, r * 2), additive(0xff3a0a, 0.35));
      base.rotation.x = -Math.PI / 2;
      base.rotation.z = -Math.atan2(z2 - z, x2 - x);
      base.position.set((x + x2) / 2, 0.04, (z + z2) / 2);
      group.add(base);
      light = this.lights.acquire(0xff6a1a, 30, 12);
      light?.position.set((x + x2) / 2, 1.5, (z + z2) / 2);
    } else {
      const color =
        def === ZoneDef.Santuario ? 0xffe27a : def === ZoneDef.Aceite ? 0x3a2a10 : def === ZoneDef.Acido ? 0x8a3aff : 0xd8d0c0;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(r, 16),
        def === ZoneDef.Aceite
          ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
          : additive(color, def === ZoneDef.Lluvia ? 0.12 : 0.3),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.04, z);
      group.add(disc);
      const edge = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, 20), additive(def === ZoneDef.Aceite ? 0xb08a3a : color, 0.8));
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x, 0.05, z);
      group.add(edge);
      parts.push(edge);
      if (def === ZoneDef.Santuario) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 16, 1, true), additive(color, 0.05));
        pillar.position.set(x, 1.5, z);
        group.add(pillar);
        light = this.lights.acquire(0xffd27a, 18, r * 3);
        light?.position.set(x, 2, z);
      }
      if (def === ZoneDef.Acido) {
        light = this.lights.acquire(0x8a3aff, 14, r * 3);
        light?.position.set(x, 1, z);
      }
    }
    this.scene.add(group);
    this.zones.set(eid, { obj: group, def, light, parts });
  }

  updateZone(eid: number, sim: Sim, time: number) {
    const v = this.zones.get(eid);
    if (!v) return;
    const c = sim.c;
    const life = c.Zone.life[eid]!;
    const fade = Math.min(1, life / 0.6);
    if (v.def === ZoneDef.MuroIgneo) {
      for (const f of v.parts) {
        const ph = f.userData.phase as number;
        const s = (0.75 + Math.sin(time * 14 + ph) * 0.25) * fade;
        f.scale.set(1, s, 1);
        f.position.y = 0.8 * s;
      }
    } else {
      for (const p of v.parts) p.rotation.z = time * 0.6;
    }
    if (v.light) v.light.intensity = (v.def === ZoneDef.MuroIgneo ? 30 + Math.sin(time * 20) * 6 : 16) * fade;
    if (v.def === ZoneDef.Lluvia && Math.random() < 0.8) {
      const r = c.Zone.r[eid]!;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const px = c.Pos.x[eid]! + Math.cos(a) * d;
      const pz = c.Pos.z[eid]! + Math.sin(a) * d;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), this.particleMat(0xe8e0d0));
      p.position.set(px, 7, pz);
      this.scene.add(p);
      this.particles.push({ mesh: p, vel: new THREE.Vector3(0, -22, 0), life: 0.3, max: 0.3, gravity: 0 });
    }
    if (v.def === ZoneDef.Acido && Math.random() < 0.5) {
      const r = c.Zone.r[eid]!;
      this.burst(c.Pos.x[eid]! + (Math.random() - 0.5) * r * 1.4, 0.1, c.Pos.z[eid]! + (Math.random() - 0.5) * r * 1.4, 0xb04aff, 1, 1.5, -1);
    }
  }

  removeZone(eid: number) {
    const v = this.zones.get(eid);
    if (!v) return;
    v.obj.removeFromParent();
    disposeTree(v.obj);
    this.lights.release(v.light);
    this.zones.delete(eid);
  }

  // ---------------- indicadores telegrafiados (4.1 / 4.2) ----------------
  updateTelegraph(eid: number, sim: Sim) {
    const T = sim.c.Telegraph;
    let v = this.telegraphs.get(eid);
    if (!T.active[eid]) {
      if (v) v.group.visible = false;
      return;
    }
    const shape = T.shape[eid]!;
    if (!v || v.shape !== shape) {
      if (v) {
        v.group.removeFromParent();
        disposeTree(v.group);
      }
      const r = T.r[eid]!;
      const w = T.w[eid]!;
      let geo: THREE.BufferGeometry;
      if (shape === 0) geo = new THREE.CircleGeometry(r, 20);
      else if (shape === 1) geo = new THREE.CircleGeometry(r, 12, Math.PI / 2 - w, w * 2);
      else {
        geo = new THREE.PlaneGeometry(w * 2, r);
        geo.translate(0, r / 2, 0);
      }
      const outline = new THREE.Mesh(geo, additive(0xff2a1a, 0.18));
      const fill = new THREE.Mesh(geo, additive(0xff3a1a, 0.45));
      const group = new THREE.Group();
      outline.rotation.x = fill.rotation.x = -Math.PI / 2;
      outline.position.y = 0.05;
      fill.position.y = 0.06;
      group.add(outline, fill);
      this.scene.add(group);
      v = { group, outline, fill, shape };
      this.telegraphs.set(eid, v);
    }
    v.group.visible = true;
    v.group.position.set(T.x[eid]!, 0, T.z[eid]!);
    // La geometría apunta a +Y local (=-Z en el mundo tras rotar), igual que yaw = 0.
    v.group.rotation.y = T.yaw[eid]!;
    const progress = 1 - T.t[eid]! / (T.total[eid]! || 1);
    if (shape === 2) v.fill.scale.set(1, Math.max(0.01, progress), 1);
    else v.fill.scale.setScalar(Math.max(0.01, progress));
  }

  removeTelegraph(eid: number) {
    const v = this.telegraphs.get(eid);
    if (!v) return;
    v.group.removeFromParent();
    disposeTree(v.group);
    this.telegraphs.delete(eid);
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        if (p.mesh.geometry !== this.particleGeo) p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.life / p.max);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      const t = 1 - f.life / f.max;
      f.obj.scale.setScalar(0.1 + t * f.grow);
      const m = (f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m) m.opacity = Math.max(0, 1 - t) * 0.9;
      if (f.light) f.light.intensity = Math.max(0, 1 - t) * 40;
      if (f.life <= 0) {
        f.obj.removeFromParent();
        disposeTree(f.obj);
        this.lights.release(f.light);
        this.flashes.splice(i, 1);
      }
    }
  }
}

export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat.dispose();
    }
  });
}
