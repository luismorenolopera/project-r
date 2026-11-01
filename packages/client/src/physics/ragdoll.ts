import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { Arena } from '@mazmorra/shared';
import type { Model, PartName } from '../render/models';

const GROUP_STATIC = 1;
const GROUP_RAGDOLL = 2;

interface Ragdoll {
  bodies: CANNON.Body[];
  meshes: THREE.Object3D[];
  constraints: CANNON.Constraint[];
  age: number;
  group: THREE.Group;
}

/**
 * Físicas cosméticas en el cliente con cannon-es (7.3):
 * ragdolls al morir y colisión de la cámara. Nada de esto afecta a la simulación de juego.
 * Los cuerpos se duermen al quedar en reposo para no gastar CPU (riesgo vigilado en el Hito 0).
 */
export class ClientPhysics {
  readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  private readonly ragdolls: Ragdoll[] = [];
  private readonly ray = new CANNON.RaycastResult();
  maxRagdolls = 24;
  lifetime = 14;

  constructor(private readonly scene: THREE.Scene, arena: Arena) {
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 8;
    const defaultMat = new CANNON.Material('default');
    this.world.defaultContactMaterial.friction = 0.6;
    this.world.defaultContactMaterial.restitution = 0.15;

    const ground = new CANNON.Body({ mass: 0, material: defaultMat, collisionFilterGroup: GROUP_STATIC });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    for (const o of arena.obstacles) {
      const body = new CANNON.Body({ mass: 0, collisionFilterGroup: GROUP_STATIC });
      if (o.type === 'box') {
        body.addShape(new CANNON.Box(new CANNON.Vec3((o.maxX - o.minX) / 2, o.h / 2, (o.maxZ - o.minZ) / 2)));
        body.position.set((o.minX + o.maxX) / 2, o.h / 2, (o.minZ + o.maxZ) / 2);
      } else {
        body.addShape(new CANNON.Cylinder(o.r, o.r, o.h, 8));
        body.position.set(o.x, o.h / 2, o.z);
      }
      this.world.addBody(body);
    }
  }

  /** Convierte un modelo en ragdoll en su pose actual y le aplica un impulso. */
  spawnRagdoll(model: Model, dir: { x: number; z: number }, force: number, tint?: number) {
    model.root.updateMatrixWorld(true);
    const group = new THREE.Group();
    this.scene.add(group);
    const bodies: CANNON.Body[] = [];
    const meshes: THREE.Object3D[] = [];
    const byName = new Map<PartName, CANNON.Body>();
    const s = model.scale;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    for (const part of Object.values(model.parts)) {
      if (!part.mesh.visible && part.name !== 'torso') continue;
      part.mesh.getWorldPosition(wp);
      part.mesh.getWorldQuaternion(wq);
      const [w, h, d] = part.size;
      const mass = part.name === 'torso' ? 3 : part.name === 'head' ? 1 : 0.8;
      const body = new CANNON.Body({
        mass,
        position: new CANNON.Vec3(wp.x, wp.y, wp.z),
        quaternion: new CANNON.Quaternion(wq.x, wq.y, wq.z, wq.w),
        linearDamping: 0.15,
        angularDamping: 0.3,
        collisionFilterGroup: GROUP_RAGDOLL,
        collisionFilterMask: GROUP_STATIC,
        allowSleep: true,
        sleepSpeedLimit: 0.35,
        sleepTimeLimit: 0.6,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3((w * s) / 2, (h * s) / 2, (d * s) / 2)));
      const up = 3 + Math.random() * 2;
      const spread = part.name === 'torso' ? 1 : 1.3;
      body.velocity.set(dir.x * force * spread + (Math.random() - 0.5), up + force * 0.25, dir.z * force * spread + (Math.random() - 0.5));
      body.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      this.world.addBody(body);
      bodies.push(body);
      byName.set(part.name, body);

      const mesh = part.mesh.clone(true);
      mesh.scale.setScalar(s);
      // Geometría propia: el ragdoll vive más que el modelo original y se libera por separado.
      mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry = m.geometry.clone();
      });
      if (tint !== undefined) {
        mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material && 'color' in m.material) {
            const mat = (m.material as THREE.MeshLambertMaterial).clone();
            mat.color.multiply(new THREE.Color(tint));
            m.material = mat;
          }
        });
      }
      group.add(mesh);
      meshes.push(mesh);
    }

    const constraints: CANNON.Constraint[] = [];
    const torso = byName.get('torso');
    if (torso) {
      for (const name of ['head', 'armL', 'armR', 'legL', 'legR'] as PartName[]) {
        const b = byName.get(name);
        if (!b) continue;
        const joint = new THREE.Vector3();
        model.parts[name].pivot.getWorldPosition(joint);
        const pivotA = torso.pointToLocalFrame(new CANNON.Vec3(joint.x, joint.y, joint.z));
        const pivotB = b.pointToLocalFrame(new CANNON.Vec3(joint.x, joint.y, joint.z));
        const c = new CANNON.ConeTwistConstraint(torso, b, {
          pivotA,
          pivotB,
          axisA: new CANNON.Vec3(0, 1, 0),
          axisB: new CANNON.Vec3(0, 1, 0),
          angle: name === 'head' ? Math.PI / 4 : Math.PI / 2.2,
          twistAngle: Math.PI / 4,
          collideConnected: false,
        });
        this.world.addConstraint(c);
        constraints.push(c);
      }
    }

    this.ragdolls.push({ bodies, meshes, constraints, age: 0, group });
    while (this.ragdolls.length > this.maxRagdolls) this.removeRagdoll(this.ragdolls[0]!);
  }

  private removeRagdoll(r: Ragdoll) {
    for (const c of r.constraints) this.world.removeConstraint(c);
    for (const b of r.bodies) this.world.removeBody(b);
    r.group.removeFromParent();
    r.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.ragdolls.splice(this.ragdolls.indexOf(r), 1);
  }

  step(dt: number) {
    if (this.ragdolls.length === 0) return;
    this.world.step(1 / 60, dt, 3);
    for (const r of [...this.ragdolls]) {
      r.age += dt;
      for (let i = 0; i < r.bodies.length; i++) {
        const b = r.bodies[i]!;
        const m = r.meshes[i]!;
        m.position.set(b.position.x, b.position.y, b.position.z);
        m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      }
      // Al final de su vida el cadáver se hunde en el suelo y desaparece.
      if (r.age > this.lifetime - 1.5) {
        for (const b of r.bodies) b.sleep();
        r.group.position.y -= dt * 0.6;
      }
      if (r.age > this.lifetime) this.removeRagdoll(r);
    }
  }

  stats() {
    let awake = 0;
    let sleeping = 0;
    for (const r of this.ragdolls) for (const b of r.bodies) b.sleepState === CANNON.Body.SLEEPING ? sleeping++ : awake++;
    return { ragdolls: this.ragdolls.length, awake, sleeping };
  }

  /** Acorta la distancia de la cámara si un muro o pilar se interpone. */
  cameraDistance(from: THREE.Vector3, to: THREE.Vector3): number {
    const full = from.distanceTo(to);
    this.ray.reset();
    const hit = this.world.raycastClosest(
      new CANNON.Vec3(from.x, from.y, from.z),
      new CANNON.Vec3(to.x, to.y, to.z),
      { collisionFilterMask: GROUP_STATIC, skipBackfaces: true },
      this.ray,
    );
    if (!hit) return full;
    return Math.max(1.2, this.ray.distance - 0.3);
  }
}
