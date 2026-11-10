import { ELEMENTOS } from '../mago/grimorio';
import { mago } from '../mago/mundo';
import {
  ARMAS, FORMAS, IDS_MATERIAL, INTERACCIONES, MATERIAL, MAX_MATERIA, MODS, arma, receta, textoCoste, todasLasRecetas, unidades,
  type InteraccionId, type MaterialId,
} from './materia';
import { alq, meter, puedeForjar, puedeLanzar, vaciarCrisol } from './transmutacion';

/**
 * Interfaz del alquimista: vida, los seis materiales (teclas 1 a 6), el crisol con la receta que sale,
 * el arma en mano con sus usos y el recetario con todas las combinaciones descubiertas.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TECLAS = ['1', '2', '3', '4', '5', '6'];

/** Coste compacto con los glifos de colores: «2▲ 1◉». */
function costeCorto(c: Partial<Record<MaterialId, number>>) {
  return (Object.entries(c) as [MaterialId, number][]).map(([m, n]) => `${n}<span style="color:${MATERIAL[m].css}">${MATERIAL[m].glifo}</span>`).join(' ');
}

export class HudAlq {
  private readonly celdas = new Map<MaterialId, { raiz: HTMLButtonElement; n: HTMLElement; lleno: HTMLElement }>();
  private readonly elCrisol = $('crisol');
  private readonly elArma = $('arma');
  private readonly elVida = $('vida-lleno');
  private readonly elVidaTxt = $('vida-texto');
  private readonly elAviso = $('aviso');
  private readonly elCuenta = $('recetario-cuenta');
  private readonly celdasRecetario = new Map<string, HTMLElement>();
  private readonly filasEntorno = new Map<InteraccionId, HTMLElement>();
  private avisoT = 0;
  private sucio = true;

  constructor() {
    this.montarMateria();
    this.montarRecetario();
    this.elCrisol.addEventListener('click', () => vaciarCrisol());
  }

  // ---------------------------------------------------------------- materiales
  private montarMateria() {
    const cont = $('materia');
    IDS_MATERIAL.forEach((id, i) => {
      const m = MATERIAL[id];
      const raiz = document.createElement('button');
      raiz.type = 'button';
      raiz.className = 'mat';
      raiz.style.setProperty('--c', m.css);
      raiz.title = `${m.nombre} (${TECLAS[i]}): meterlo en el crisol. Se saca de: ${m.fuente}.`;
      raiz.innerHTML = `<span class="tecla">${TECLAS[i]}</span><span class="glifo">${m.glifo}</span><span class="n">0</span><span class="nombre">${m.nombre}</span><span class="barra"><span class="lleno"></span></span>`;
      raiz.addEventListener('click', () => meter(id));
      cont.appendChild(raiz);
      this.celdas.set(id, { raiz, n: raiz.querySelector('.n')!, lleno: raiz.querySelector('.lleno')! });
    });
  }

  // ---------------------------------------------------------------- recetario
  private montarRecetario() {
    const tabla = $('recetario-tabla');
    const cab = document.createElement('div');
    cab.className = 'fila cab';
    cab.innerHTML = `<span></span><span title="Sin catalizador">—</span>${IDS_MATERIAL.map((m) => `<span title="Catalizador: ${MATERIAL[m].nombre} (${MODS[m].desc})" style="color:${MATERIAL[m].css}">${MATERIAL[m].glifo}</span>`).join('')}`;
    tabla.appendChild(cab);
    for (const b of IDS_MATERIAL) {
      const fila = document.createElement('div');
      fila.className = 'fila';
      const nombre = document.createElement('span');
      nombre.className = 'base';
      nombre.style.color = MATERIAL[b].css;
      nombre.textContent = `${MATERIAL[b].glifo} ${FORMAS[b].nombre}`;
      nombre.title = `Base ${MATERIAL[b].nombre}: lanza ${FORMAS[b].nombre.toLowerCase()} (Q) o forja ${ARMAS[b].nombre.toLowerCase()} (F).`;
      fila.appendChild(nombre);
      for (const c of [null, ...IDS_MATERIAL]) {
        const crisol = c ? [b, c] : [b];
        const r = receta(crisol)!;
        const a = arma(crisol)!;
        const celda = document.createElement('button');
        celda.type = 'button';
        celda.className = 'celda';
        celda.style.setProperty('--c', ELEMENTOS[r.elemento].css);
        celda.title = `${r.nombre} (Q: ${textoCoste(r.coste)})\n${r.desc}\nForjada: ${a.nombre} (F: ${textoCoste(a.coste)})`;
        celda.addEventListener('click', () => {
          alq.crisol = crisol;
          this.sucio = true;
        });
        fila.appendChild(celda);
        this.celdasRecetario.set(r.clave, celda);
      }
      tabla.appendChild(fila);
    }
    const lista = $('entorno-lista');
    for (const def of Object.values(INTERACCIONES)) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${def.nombre}</b> <span class="sobre">${def.sobre}</span><small>${def.desc}</small>`;
      lista.appendChild(li);
      this.filasEntorno.set(def.id, li);
    }
  }

  /** Repinta lo que cambia por acciones (no cada fotograma). */
  marcarSucio() {
    this.sucio = true;
  }

  descubrir(tipo: 'receta' | 'arma' | 'entorno', clave: string) {
    if (tipo === 'entorno') {
      const li = this.filasEntorno.get(clave as InteraccionId);
      li?.classList.add('hecho', 'destello');
      setTimeout(() => li?.classList.remove('destello'), 900);
    } else {
      const c = this.celdasRecetario.get(clave);
      c?.classList.add(tipo === 'receta' ? 'lanzada' : 'forjada', 'destello');
      setTimeout(() => c?.classList.remove('destello'), 900);
    }
    this.sucio = true;
  }

  private readonly elPista = $('pista');
  /** Línea fija con lo que hay bajo el cursor. */
  pista(texto: string) {
    if (this.elPista.textContent !== texto) this.elPista.textContent = texto;
  }

  aviso(texto: string) {
    this.elAviso.textContent = texto;
    this.elAviso.hidden = false;
    this.avisoT = 2;
  }

  reiniciar() {
    for (const c of this.celdasRecetario.values()) c.classList.remove('lanzada', 'forjada');
    for (const li of this.filasEntorno.values()) li.classList.remove('hecho');
    this.sucio = true;
  }

  private pintar() {
    for (const id of IDS_MATERIAL) {
      const c = this.celdas.get(id)!;
      const v = alq.materiaInfinita ? MAX_MATERIA : alq.inv[id];
      c.n.textContent = alq.materiaInfinita ? '∞' : String(unidades(alq.inv, id));
      c.lleno.style.width = `${(v / MAX_MATERIA) * 100}%`;
      c.raiz.classList.toggle('vacio', v < 1);
      const pos = alq.crisol.indexOf(id);
      c.raiz.classList.toggle('base', alq.crisol[0] === id);
      c.raiz.classList.toggle('cat', pos === 1 || (alq.crisol[1] === id && alq.crisol[0] === id));
    }
    const r = receta(alq.crisol);
    const a = arma(alq.crisol);
    const hueco = (m: MaterialId | undefined, rol: string) =>
      m ? `<span class="hueco" style="--c:${MATERIAL[m].css}" title="${rol}">${MATERIAL[m].glifo}</span>` : `<span class="hueco vacio" title="${rol}">·</span>`;
    if (!r || !a) {
      this.elCrisol.innerHTML = `<div class="huecos">${hueco(undefined, 'Base')}<i>+</i>${hueco(undefined, 'Catalizador')}</div><div class="receta"><b>Crisol vacío</b><small>Pulsa 1 a 6: el primer material da la forma y el segundo la cambia.</small></div>`;
    } else {
      const okQ = puedeLanzar();
      const okF = puedeForjar();
      this.elCrisol.innerHTML =
        `<div class="huecos">${hueco(alq.crisol[0], 'Base')}<i>+</i>${hueco(alq.crisol[1], 'Catalizador')}</div>` +
        `<div class="receta"><b style="color:${ELEMENTOS[r.elemento].css}">${r.nombre}</b>` +
        `<small class="${okQ ? '' : 'falta'}"><kbd>Q</kbd> lanzar · ${costeCorto(r.coste)}</small>` +
        `<small class="${okF ? '' : 'falta'}"><kbd>F</kbd> ${a.nombre} · ${costeCorto(a.coste)}</small></div>`;
      this.elCrisol.title = `${r.desc}\nClic para vaciar el crisol (X).`;
    }
    let lanzadas = 0;
    let forjadas = 0;
    for (const k of this.celdasRecetario.keys()) {
      if (alq.lanzadas.has(k)) lanzadas++;
      if (alq.forjadas.has(k)) forjadas++;
    }
    const total = todasLasRecetas().length;
    this.elCuenta.textContent = `${lanzadas}/${total} lanzadas · ${forjadas}/${total} forjadas · ${alq.interacciones.size}/${Object.keys(INTERACCIONES).length} del entorno`;
    for (const [k, c] of this.celdasRecetario) c.classList.toggle('actual', k === alq.crisol.join('+'));
  }

  /** Cada fotograma: vida, arma y avisos. */
  actualizar(dt: number) {
    if (this.sucio) {
      this.sucio = false;
      this.pintar();
    }
    this.elVida.style.height = `${(mago.hp / mago.hpMax) * 100}%`;
    this.elVidaTxt.textContent = String(Math.round(mago.hp));
    const a = alq.arma;
    if (a) {
      this.elArma.hidden = false;
      this.elArma.style.setProperty('--c', ELEMENTOS[a.elemento].css);
      const html = `<b>${a.nombre}</b><span class="usos"><span style="width:${(a.usos / a.usosMax) * 100}%"></span></span><small>${a.usos} usos · clic izq.</small>`;
      if (this.elArma.dataset.html !== html) {
        this.elArma.innerHTML = html;
        this.elArma.dataset.html = html;
      }
    } else if (!this.elArma.hidden) {
      this.elArma.hidden = true;
      this.elArma.dataset.html = '';
    }
    if (this.avisoT > 0) {
      this.avisoT -= dt;
      if (this.avisoT <= 0) this.elAviso.hidden = true;
    }
  }
}
