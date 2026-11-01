import * as THREE from 'three';
import type { Arena } from '@mazmorra/shared';
import { psxLambert } from './psx';
import type { Textures } from './textures';

export interface ArenaView {
  /** Mallas contra las que se apunta (suelo y obstáculos). */
  aimTargets: THREE.Object3D[];
  braziers: { light: THREE.PointLight; flame: THREE.Mesh; base: number }[];
}

/** Construye la cripta: suelo, muros, pilares con braseros, sarcófagos, niebla y luces frías. */
export function buildArena(scene: THREE.Scene, arena: Arena, tex: Textures): ArenaView {
  scene.background = new THREE.Color(0x07060a);
  scene.fog = new THREE.FogExp2(0x0a0810, 0.035);
  scene.add(new THREE.AmbientLight(0x4a4460, 1.4));
  const moon = new THREE.DirectionalLight(0x6a78b0, 0.9);
  moon.position.set(-10, 20, 6);
  scene.add(moon);
  const hemi = new THREE.HemisphereLight(0x4a4a6a, 0x1a120c, 0.6);
  scene.add(hemi);

  const aimTargets: THREE.Object3D[] = [];
  const size = arena.halfSize * 2;
  const floorTex = tex.floor.clone();
  floorTex.repeat.set(size / 2, size / 2);
  floorTex.needsUpdate = true;
  // Suelo subdividido: limita la deformación del mapeado afín, como en la PS1.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 20, 20), psxLambert({ map: floorTex, color: 0xffffff }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  aimTargets.push(floor);

  const braziers: ArenaView['braziers'] = [];
  for (const o of arena.obstacles) {
    if (o.type === 'box') {
      const w = o.maxX - o.minX;
      const d = o.maxZ - o.minZ;
      const isWall = o.tag === 'muro';
      const t = (isWall ? tex.wall : tex.sarcophagus).clone();
      t.repeat.set(isWall ? Math.max(w, d) / 3 : 1, isWall ? o.h / 3 : 1);
      t.needsUpdate = true;
      const segs = isWall ? Math.ceil(Math.max(w, d) / 4) : 1;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, o.h, d, w > d ? segs : 1, 2, d >= w ? segs : 1),
        psxLambert({ map: t, color: isWall ? 0xb0a8b8 : 0xc8c0b0 }),
      );
      mesh.position.set((o.minX + o.maxX) / 2, o.h / 2, (o.minZ + o.maxZ) / 2);
      scene.add(mesh);
      aimTargets.push(mesh);
      if (o.tag === 'sarcofago') {
        const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.15, 0.15, d + 0.15), psxLambert({ map: tex.sarcophagus, color: 0x9a9288 }));
        lid.position.set(mesh.position.x, o.h + 0.07, mesh.position.z);
        scene.add(lid);
      }
    } else {
      const t = tex.wall.clone();
      t.repeat.set(2, 2);
      t.needsUpdate = true;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, o.h, 8, 3), psxLambert({ map: t, color: 0xa8a0b0 }));
      pillar.position.set(o.x, o.h / 2, o.z);
      scene.add(pillar);
      aimTargets.push(pillar);
      // Brasero a media altura con luz cálida parpadeante.
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.25, 0.3, 6), psxLambert({ color: 0x3a3030 }));
      const dir = Math.atan2(-o.x, -o.z);
      const bx = o.x + Math.sin(dir) * (o.r + 0.35);
      const bz = o.z + Math.cos(dir) * (o.r + 0.35);
      bowl.position.set(bx, 2.4, bz);
      scene.add(bowl);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.7, 5),
        new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      flame.position.set(bx, 2.85, bz);
      scene.add(flame);
      const light = new THREE.PointLight(0xff8a3a, 22, 16, 1.6);
      light.position.set(bx, 3, bz);
      scene.add(light);
      braziers.push({ light, flame, base: 22 });
    }
  }

  // Cadenas y estandartes rotos en los muros para dar escala.
  const bannerMat = psxLambert({ color: 0x4a1418 });
  for (let i = -2; i <= 2; i++) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3, 1, 3), bannerMat);
    banner.position.set(i * 7, 3.6, -arena.halfSize + 0.05);
    scene.add(banner);
  }
  return { aimTargets, braziers };
}

export function updateBraziers(view: ArenaView, time: number) {
  view.braziers.forEach((b, i) => {
    const f = 0.85 + Math.sin(time * 9 + i * 1.7) * 0.08 + Math.sin(time * 23 + i) * 0.05;
    b.light.intensity = b.base * f;
    b.flame.scale.set(1, f, 1);
  });
}
