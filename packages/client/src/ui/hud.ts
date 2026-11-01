import * as THREE from 'three';
import { CLASSES, ELEMENT_NAMES, Element, Kind, MONSTERS, type ClassId, type Sim } from '@mazmorra/shared';
import { ELEMENT_COLORS } from '../render/fx';

const KEYS = ['Clic izq.', 'Shift', 'Q', 'E', 'R'];
const SLOT_LABELS = ['Básico', 'Movilidad', 'Mitigación', 'Principal', 'Definitiva'];
const CD_KEYS = ['cd0', 'cd1', 'cd2', 'cd3', 'cd4'] as const;

export const SPAWNABLE: { kind: Kind; key: string; code: string }[] = [
  { kind: Kind.Esqueleto, key: 'Z', code: 'KeyZ' },
  { kind: Kind.Cultista, key: 'X', code: 'KeyX' },
  { kind: Kind.Bruto, key: 'C', code: 'KeyC' },
  { kind: Kind.Espectro, key: 'V', code: 'KeyV' },
  { kind: Kind.Muneco, key: 'B', code: 'KeyB' },
  { kind: Kind.Aliado, key: 'G', code: 'KeyG' },
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudCallbacks {
  onClass(cls: ClassId): void;
  onSpawn(kind: Kind): void;
  onWave(): void;
  onClear(): void;
  onToggleImmortal(): boolean;
}

interface Floating {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
  max: number;
  vy: number;
}

/** Interfaz HTML superpuesta: vida, combo, habilidades, panel del sandbox, números de daño. */
export class Hud {
  private readonly floating: Floating[] = [];
  private readonly bars = new Map<number, HTMLDivElement>();
  private readonly numbersLayer = $('numbers');
  private readonly barsLayer = $('bars');
  private readonly abilityEls: { root: HTMLDivElement; cd: HTMLSpanElement }[] = [];
  private readonly tmp = new THREE.Vector3();
  private dummyLog: { t: number; amount: number }[] = [];
  private dummyTotal = 0;
  private currentClass = -1;

  constructor(private readonly cb: HudCallbacks) {
    this.buildPanel();
    const ab = $('abilities');
    for (let i = 0; i < 5; i++) {
      const root = document.createElement('div');
      root.className = 'ability';
      root.innerHTML = `<span class="key">${KEYS[i]}</span><span class="name"></span><span class="slot">${SLOT_LABELS[i]}</span><span class="cd"></span>`;
      ab.appendChild(root);
      this.abilityEls.push({ root, cd: root.querySelector('.cd') as HTMLSpanElement });
    }
  }

  private buildPanel() {
    const classes = $('class-buttons');
    CLASSES.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'class-btn';
      b.dataset.cls = String(c.id);
      b.style.setProperty('--c', hex(c.color));
      b.innerHTML = `<b>${i + 1}</b> ${c.nombre}`;
      b.title = `${c.rol} · ${c.arma}`;
      b.onclick = () => this.cb.onClass(c.id);
      classes.appendChild(b);
    });
    const spawns = $('spawn-buttons');
    for (const s of SPAWNABLE) {
      const def = MONSTERS[s.kind]!;
      const b = document.createElement('button');
      b.className = 'spawn-btn';
      const aff = Object.entries(def.afinidad)
        .map(([el, m]) => {
          const name = ELEMENT_NAMES[Number(el) as Element];
          const color = hex(ELEMENT_COLORS[Number(el) as Element]);
          return `<span style="color:${color}">${(m as number) > 1 ? '▲' : '▼'} ${name} ×${m}</span>`;
        })
        .join(' ');
      b.innerHTML = `<div class="row"><b>${s.key}</b> ${def.nombre} <small>${def.hp} PV</small></div><div class="desc">${def.descripcion}</div>${aff ? `<div class="aff">${aff}</div>` : ''}`;
      b.onclick = () => this.cb.onSpawn(s.kind);
      spawns.appendChild(b);
    }
    $('btn-wave').onclick = () => this.cb.onWave();
    $('btn-clear').onclick = () => this.cb.onClear();
    $('btn-immortal').onclick = () => {
      const on = this.cb.onToggleImmortal();
      this.setImmortal(on);
    };
    $('panel-toggle').onclick = () => document.body.classList.toggle('panel-hidden');
  }

  setImmortal(on: boolean) {
    $('btn-immortal').textContent = `Inmortal (I): ${on ? 'sí' : 'no'}`;
    $('btn-immortal').classList.toggle('on', on);
  }

  setClass(cls: ClassId) {
    if (cls === this.currentClass) return;
    this.currentClass = cls;
    const def = CLASSES[cls]!;
    $('class-name').textContent = def.nombre;
    $('class-role').textContent = `${def.rol} · ${def.arma}`;
    document.documentElement.style.setProperty('--class-color', hex(def.color));
    def.habilidades.forEach((h, i) => {
      const a = this.abilityEls[i]!;
      (a.root.querySelector('.name') as HTMLSpanElement).textContent = h.nombre;
      a.root.title = h.desc;
    });
    $('class-abilities').innerHTML = def.habilidades
      .map((h, i) => `<li><span class="k">${KEYS[i]}</span> <b>${h.nombre}</b> <small>${h.cd < 1 ? '' : `${h.cd} s`}</small><br>${h.desc}</li>`)
      .join('');
    document.querySelectorAll<HTMLButtonElement>('.class-btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.cls) === cls));
  }

  updateHero(sim: Sim, hero: number) {
    const c = sim.c;
    this.setClass(c.Hero.cls[hero] as ClassId);
    const hp = Math.max(0, c.Health.hp[hero]!);
    const max = c.Health.max[hero]!;
    const shield = c.Status.shield[hero]!;
    $('hp-fill').style.width = `${(hp / max) * 100}%`;
    $('hp-shield').style.width = `${Math.min(1, shield / max) * 100}%`;
    $('hp-text').textContent = `${Math.ceil(hp)} / ${max}${shield > 0 ? ` (+${Math.ceil(shield)})` : ''}`;
    const combo = c.Combo.count[hero]!;
    const frenzy = c.Combo.frenzy[hero]!;
    const comboEl = $('combo');
    comboEl.classList.toggle('frenzy', !!frenzy);
    comboEl.style.opacity = combo > 0 || frenzy ? '1' : '0.35';
    $('combo-count').textContent = String(combo);
    $('combo-label').textContent = frenzy ? `FRENESÍ ${c.Combo.frenzyT[hero]!.toFixed(1)} s · +40% daño` : `golpes · frenesí a 12`;
    $('combo-timer').style.width = frenzy ? `${(c.Combo.frenzyT[hero]! / 10) * 100}%` : `${(c.Combo.timer[hero]! / 2.5) * 100}%`;

    const defs = CLASSES[c.Hero.cls[hero]!]!.habilidades;
    CD_KEYS.forEach((k, i) => {
      const left = c.Hero[k][hero]!;
      const a = this.abilityEls[i]!;
      const total = defs[i]!.cd;
      a.root.style.setProperty('--p', String(total > 0 ? Math.min(1, left / Math.max(total, 0.6)) : 0));
      a.root.classList.toggle('ready', left <= 0);
      a.cd.textContent = left > 0.05 && total >= 1 ? left.toFixed(left < 3 ? 1 : 0) : '';
    });

    const S = c.Status;
    const tags: string[] = [];
    if (S.guardT[hero]! > 0) tags.push(S.guardAge[hero]! <= 0.25 ? '<span class="t perfect">Desvío perfecto</span>' : '<span class="t">Bloqueando</span>');
    if (S.dmgBuffT[hero]! > 0) tags.push(`<span class="t buff">Furia ${S.dmgBuffT[hero]!.toFixed(0)} s</span>`);
    if (S.drT[hero]! > 0) tags.push(`<span class="t buff">-${Math.round(S.dr[hero]! * 100)}% daño</span>`);
    if (c.Hero.nextShotMult[hero]! > 1) tags.push('<span class="t buff">Disparo de remate ×2</span>');
    if (S.stunT[hero]! > 0) tags.push('<span class="t bad">Aturdido</span>');
    if (S.burnT[hero]! > 0) tags.push('<span class="t bad">Quemándose</span>');
    $('status-tags').innerHTML = tags.join('');

    const dead = c.Health.deadT[hero]!;
    $('death').style.display = dead > 0 ? 'flex' : 'none';
    if (dead > 0) $('death-timer').textContent = `Reapareces en ${dead.toFixed(1)} s`;
  }

  /** Barras de vida sobre los enemigos y aliados. */
  updateBars(sim: Sim, camera: THREE.Camera, positions: Map<number, THREE.Vector3>, hero: number) {
    const seen = new Set<number>();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const [eid, pos] of positions) {
      if (eid === hero || !sim.isAlive(eid)) continue;
      const k = sim.kind(eid);
      this.tmp.copy(pos);
      this.tmp.y += sim.c.Body.height[eid]! * (k === Kind.Bruto ? 1.5 : 1) + 0.45;
      this.tmp.project(camera);
      if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) continue;
      seen.add(eid);
      let bar = this.bars.get(eid);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = `bar ${sim.team(eid) === 0 ? 'ally' : ''}`;
        bar.innerHTML = '<i></i><u></u>';
        this.barsLayer.appendChild(bar);
        this.bars.set(eid, bar);
      }
      const hp = sim.c.Health.hp[eid]! / sim.c.Health.max[eid]!;
      (bar.firstChild as HTMLElement).style.width = `${hp * 100}%`;
      (bar.lastChild as HTMLElement).style.width = `${Math.min(1, sim.c.Status.shield[eid]! / sim.c.Health.max[eid]!) * 100}%`;
      bar.style.transform = `translate(${((this.tmp.x + 1) / 2) * w - 22}px, ${((1 - this.tmp.y) / 2) * h}px)`;
      bar.classList.toggle('stunned', sim.c.Status.stunT[eid]! > 0);
      bar.classList.toggle('vuln', sim.c.Status.vulnT[eid]! > 0);
    }
    for (const [eid, bar] of this.bars) {
      if (!seen.has(eid)) {
        bar.remove();
        this.bars.delete(eid);
      }
    }
  }

  float(pos: THREE.Vector3, text: string, cls: string, color?: string, big = false) {
    if (this.floating.length > 80) {
      const old = this.floating.shift()!;
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `num ${cls}${big ? ' big' : ''}`;
    el.textContent = text;
    if (color) el.style.color = color;
    this.numbersLayer.appendChild(el);
    const life = big ? 1.4 : 0.9;
    this.floating.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), life, max: life, vy: big ? 0.8 : 1.6 });
  }

  updateFloating(dt: number, camera: THREE.Camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.floating.length - 1; i >= 0; i--) {
      const f = this.floating[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        f.el.remove();
        this.floating.splice(i, 1);
        continue;
      }
      f.pos.y += f.vy * dt;
      this.tmp.copy(f.pos).project(camera);
      if (this.tmp.z > 1) {
        f.el.style.display = 'none';
        continue;
      }
      f.el.style.display = '';
      f.el.style.opacity = String(Math.min(1, (f.life / f.max) * 2));
      f.el.style.transform = `translate(-50%, -50%) translate(${((this.tmp.x + 1) / 2) * w}px, ${((1 - this.tmp.y) / 2) * h}px)`;
    }
  }

  feed(msg: string, cls = '') {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = msg;
    const feed = $('feed');
    feed.prepend(el);
    while (feed.children.length > 6) feed.lastChild!.remove();
    setTimeout(() => el.classList.add('fade'), 3500);
    setTimeout(() => el.remove(), 4500);
  }

  logDummyDamage(amount: number, now: number) {
    this.dummyLog.push({ t: now, amount });
    this.dummyTotal += amount;
  }

  updateDps(now: number) {
    this.dummyLog = this.dummyLog.filter((d) => now - d.t < 5);
    const sum = this.dummyLog.reduce((a, d) => a + d.amount, 0);
    const span = this.dummyLog.length ? Math.max(1, now - this.dummyLog[0]!.t) : 1;
    $('dps').textContent = `${Math.round(sum / span)} DPS (5 s) · total ${Math.round(this.dummyTotal)}`;
  }

  resetDps() {
    this.dummyLog = [];
    this.dummyTotal = 0;
  }

  stats(text: string) {
    $('stats').textContent = text;
  }

  setLocked(locked: boolean) {
    $('start').style.display = locked ? 'none' : 'flex';
    document.body.classList.toggle('locked', locked);
  }
}
