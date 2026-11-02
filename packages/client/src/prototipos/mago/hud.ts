import {
  BUILD_INICIAL,
  BUILDS_SUGERIDAS,
  CATEGORIAS,
  ELEMENTOS,
  RANURAS,
  asignar,
  elementoEfectivo,
  escribirBuild,
  hechizo,
  hechizosDeCategoria,
  leerBuild,
  normalizar,
  ponerRuna,
  runaDe,
  type Build,
  type Categoria,
} from './grimorio';
import { COMBOS, type ComboId } from './reacciones';
import { mago } from './mundo';

/**
 * Interfaz del sandbox del mago: barra de 6 ranuras con globos de vida y maná,
 * el grimorio para cambiar hechizos y runas, y el libro de combos.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CLAVE = 'mazmorra.mago.build';

function guardarLocal(texto: string) {
  try {
    localStorage.setItem(CLAVE, texto);
  } catch {
    /* almacenamiento no disponible: la build solo vive en esta sesión */
  }
}
function leerLocal(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

export class Hud {
  build: Build = BUILD_INICIAL.map((x) => ({ ...x }));
  modoLibre = false;
  abierto = false;
  private ranuraSel = 0;
  private pestana: Categoria = 'principal';
  private readonly barra = $('ranuras');
  private readonly celdas: { raiz: HTMLElement; cd: HTMLElement; icono: HTMLElement; nombre: HTMLElement; runa: HTMLElement; coste: HTMLElement }[] = [];
  private readonly filasCombo = new Map<ComboId, { fila: HTMLElement; n: HTMLElement }>();

  constructor(private readonly alCambiar: () => void) {
    const guardada = leerBuild(leerLocal());
    if (guardada) {
      this.build = guardada.build;
      this.modoLibre = guardada.modoLibre;
    }
    this.montarBarra();
    this.montarCombos();
    this.montarGrimorio();
    this.pintarBarra();
  }

  // ---------------------------------------------------------------- barra
  private montarBarra() {
    RANURAS.forEach((def, i) => {
      const raiz = document.createElement('button');
      raiz.className = 'ranura';
      raiz.type = 'button';
      raiz.innerHTML = `<span class="icono"></span><span class="cd"></span><span class="tecla">${def.etiqueta}</span><span class="runa-punto"></span><span class="coste"></span><span class="nombre"></span>`;
      raiz.addEventListener('click', () => this.abrir(i));
      this.barra.appendChild(raiz);
      this.celdas.push({
        raiz,
        cd: raiz.querySelector('.cd')!,
        icono: raiz.querySelector('.icono')!,
        nombre: raiz.querySelector('.nombre')!,
        runa: raiz.querySelector('.runa-punto')!,
        coste: raiz.querySelector('.coste')!,
      });
    });
  }

  private pintarBarra() {
    this.build.forEach((slot, i) => {
      const h = hechizo(slot.hechizo);
      const runa = runaDe(h, slot.runa);
      const elem = elementoEfectivo(h, slot.runa);
      const c = this.celdas[i]!;
      c.icono.textContent = `${h.glifo}︎`;
      c.raiz.style.setProperty('--elem', ELEMENTOS[elem].css);
      c.nombre.textContent = runa ? runa.nombre : h.nombre;
      c.runa.hidden = !runa;
      c.coste.textContent = h.coste > 0 ? (h.canalizado ? `${h.coste}/s` : String(h.coste)) : '';
      c.raiz.title = `${h.nombre}${runa ? ` · ${runa.nombre}` : ''} (${RANURAS[i]!.etiqueta}). Clic para cambiarlo.`;
    });
  }

  /** Se llama cada fotograma: tiempos de reutilización, maná, vida y potenciador. */
  actualizar() {
    this.aplicarDestellos();
    this.build.forEach((slot, i) => {
      const h = hechizo(slot.hechizo);
      const c = this.celdas[i]!;
      let resto = mago.cd.get(h.id) ?? 0;
      let total = h.cd;
      if (h.id === 'parpadeo' && slot.runa === 'doble') {
        if (mago.cargas > 0) resto = mago.cd.get(h.id) ?? 0;
        else {
          resto = mago.recargaCarga;
        }
        total = mago.cargas > 0 ? 0.35 : h.cd;
        c.coste.textContent = `×${mago.cargas}`;
      }
      const frac = total > 0.5 ? Math.min(1, resto / total) : 0;
      c.cd.style.background = frac > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${frac * 360}deg, transparent 0)` : 'transparent';
      c.raiz.classList.toggle('sin-mana', h.coste > 0 && mago.mana < (h.canalizado ? 5 : h.coste));
    });
    const vida = $('vida-lleno');
    vida.style.height = `${(mago.hp / mago.hpMax) * 100}%`;
    $('vida-texto').textContent = String(Math.ceil(mago.hp));
    $('mana-lleno').style.height = `${(mago.mana / mago.manaMax) * 100}%`;
    $('mana-texto').textContent = String(Math.floor(mago.mana));
    const buff = $('buff');
    const inf = mago.infusion;
    if (inf.t > 0) {
      buff.hidden = false;
      const nombre = inf.prisma ? 'Prisma' : `Infusión · ${ELEMENTOS[inf.elemento].nombre}`;
      buff.textContent = `${nombre} ${inf.t.toFixed(1)} s`;
      buff.style.color = inf.prisma ? '#ffffff' : ELEMENTOS[inf.elemento].css;
    } else buff.hidden = true;
  }

  // ---------------------------------------------------------------- combos
  private montarCombos() {
    const lista = $('lista-combos');
    for (const [id, c] of Object.entries(COMBOS) as [ComboId, (typeof COMBOS)[ComboId]][]) {
      const fila = document.createElement('li');
      fila.innerHTML = `<b style="color:${c.color}">${c.nombre}</b><span class="n">0</span><small>${c.receta}</small>`;
      lista.appendChild(fila);
      this.filasCombo.set(id, { fila, n: fila.querySelector('.n')! });
    }
    $('combos-toggle').addEventListener('click', () => document.body.classList.toggle('combos-ocultos'));
  }

  marcarCombo(id: ComboId, total: number) {
    const f = this.filasCombo.get(id);
    if (!f) return;
    f.n.textContent = String(total);
    f.fila.classList.add('hecho');
    f.fila.classList.remove('destello');
    // El destello se reinicia una vez por fotograma (en actualizar): forzar el reflujo en cada combo
    // de una explosión en cadena costaba decenas de recálculos de estilo en un solo paso.
    this.destellosPendientes.add(f.fila);
  }

  private readonly destellosPendientes = new Set<HTMLElement>();
  private aplicarDestellos() {
    if (this.destellosPendientes.size === 0) return;
    void document.body.offsetWidth;
    for (const fila of this.destellosPendientes) fila.classList.add('destello');
    this.destellosPendientes.clear();
  }

  reiniciarCombos() {
    for (const f of this.filasCombo.values()) {
      f.n.textContent = '0';
      f.fila.classList.remove('hecho', 'destello');
    }
    this.destellosPendientes.clear();
  }

  // ---------------------------------------------------------------- grimorio
  private montarGrimorio() {
    $('g-cerrar').addEventListener('click', () => this.cerrar());
    $('grimorio').addEventListener('mousedown', (e) => {
      if (e.target === $('grimorio')) this.cerrar();
    });
    const libre = $<HTMLInputElement>('modo-libre');
    libre.checked = this.modoLibre;
    libre.addEventListener('change', () => {
      this.modoLibre = libre.checked;
      this.build = normalizar(this.build, this.modoLibre);
      this.pestana = RANURAS[this.ranuraSel]!.categoria;
      this.cambio();
    });
    const builds = $('g-builds');
    for (const b of BUILDS_SUGERIDAS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'g-build';
      btn.innerHTML = `<b>${b.nombre}</b><small>${b.idea}</small>`;
      btn.addEventListener('click', () => {
        this.modoLibre = b.modoLibre;
        libre.checked = b.modoLibre;
        this.build = normalizar(b.build, b.modoLibre);
        this.cambio();
        this.mensaje(`Build «${b.nombre}» equipada.`);
      });
      builds.appendChild(btn);
    }
    $('g-restablecer').addEventListener('click', () => {
      this.modoLibre = false;
      libre.checked = false;
      this.build = BUILD_INICIAL.map((x) => ({ ...x }));
      this.cambio();
      this.mensaje('Build inicial restablecida.');
    });
  }

  private mensaje(t: string) {
    $('g-msg').textContent = t;
  }

  private cambio() {
    guardarLocal(escribirBuild(this.build, this.modoLibre));
    this.pintarBarra();
    if (this.abierto) this.pintarGrimorio();
    this.alCambiar();
  }

  /** Equipa una build desde fuera (pruebas automáticas). */
  equipar(build: Build, modoLibre = this.modoLibre) {
    this.modoLibre = modoLibre;
    $<HTMLInputElement>('modo-libre').checked = modoLibre;
    this.build = normalizar(build, modoLibre);
    this.cambio();
  }

  abrir(ranura = this.ranuraSel) {
    this.ranuraSel = ranura;
    this.pestana = RANURAS[ranura]!.categoria;
    this.abierto = true;
    $('grimorio').hidden = false;
    this.mensaje('');
    this.pintarGrimorio();
    this.alCambiar();
  }

  cerrar() {
    this.abierto = false;
    $('grimorio').hidden = true;
    this.alCambiar();
  }

  alternar() {
    if (this.abierto) this.cerrar();
    else this.abrir();
  }

  private pintarGrimorio() {
    // Ranuras
    const cont = $('g-ranuras');
    cont.replaceChildren();
    this.build.forEach((slot, i) => {
      const h = hechizo(slot.hechizo);
      const runa = runaDe(h, slot.runa);
      const elem = elementoEfectivo(h, slot.runa);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `g-ranura${i === this.ranuraSel ? ' sel' : ''}`;
      b.style.setProperty('--elem', ELEMENTOS[elem].css);
      const cat = CATEGORIAS.find((c) => c.id === RANURAS[i]!.categoria)!;
      b.innerHTML = `<span class="g-tecla">${RANURAS[i]!.etiqueta}</span><span class="g-glifo">${h.glifo}︎</span><span class="g-txt"><b>${h.nombre}</b><small>${runa ? runa.nombre : 'Sin runa'}</small><em>${this.modoLibre ? 'Libre' : cat.nombre}</em></span>`;
      b.addEventListener('click', () => {
        this.ranuraSel = i;
        this.pestana = RANURAS[i]!.categoria;
        this.pintarGrimorio();
      });
      cont.appendChild(b);
    });

    // Pestañas de categoría (solo en modo libre)
    const tabs = $('g-tabs');
    tabs.replaceChildren();
    tabs.hidden = !this.modoLibre;
    if (this.modoLibre) {
      for (const c of CATEGORIAS) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = `g-tab${c.id === this.pestana ? ' sel' : ''}`;
        t.textContent = c.nombre;
        t.addEventListener('click', () => {
          this.pestana = c.id;
          this.pintarGrimorio();
        });
        tabs.appendChild(t);
      }
    }
    const categoria = this.modoLibre ? this.pestana : RANURAS[this.ranuraSel]!.categoria;
    const catDef = CATEGORIAS.find((c) => c.id === categoria)!;
    $('g-titulo-hechizos').textContent = `Hechizos · ${catDef.nombre}`;
    $('g-desc-cat').textContent = catDef.desc;

    // Hechizos
    const lista = $('g-hechizos');
    lista.replaceChildren();
    const actual = this.build[this.ranuraSel]!;
    for (const h of hechizosDeCategoria(categoria)) {
      const enOtra = this.build.findIndex((x, i) => i !== this.ranuraSel && x.hechizo === h.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `g-hechizo${h.id === actual.hechizo ? ' sel' : ''}`;
      b.style.setProperty('--elem', ELEMENTOS[h.elemento].css);
      const coste = h.coste > 0 ? `${h.coste}${h.canalizado ? '/s' : ''} maná` : h.coste < 0 ? `+${-h.coste} maná` : 'sin coste';
      const cd = h.cd >= 1 ? ` · ${h.cd} s` : '';
      b.innerHTML = `<span class="g-glifo">${h.glifo}︎</span><span class="g-txt"><b>${h.nombre}</b><small>${coste}${cd}${enOtra >= 0 ? ` · en ranura ${RANURAS[enOtra]!.etiqueta} (se intercambian)` : ''}</small><span>${h.desc}</span></span>`;
      b.addEventListener('click', () => {
        this.build = asignar(this.build, this.ranuraSel, h.id, this.modoLibre);
        this.cambio();
      });
      lista.appendChild(b);
    }

    // Runas del hechizo de la ranura seleccionada
    const h = hechizo(actual.hechizo);
    $('g-titulo-runas').textContent = `Runas · ${h.nombre}`;
    const runas = $('g-runas');
    runas.replaceChildren();
    const opciones: { id: string | null; nombre: string; elem: keyof typeof ELEMENTOS; desc: string }[] = [
      { id: null, nombre: 'Sin runa', elem: h.elemento, desc: h.desc },
      ...h.runas.map((r) => ({ id: r.id, nombre: r.nombre, elem: r.elemento, desc: r.desc })),
    ];
    for (const o of opciones) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `g-runa${o.id === actual.runa ? ' sel' : ''}`;
      b.style.setProperty('--elem', ELEMENTOS[o.elem].css);
      b.innerHTML = `<span class="g-gema"></span><span class="g-txt"><b>${o.nombre}</b><em>${ELEMENTOS[o.elem].nombre}</em><span>${o.desc}</span></span>`;
      b.addEventListener('click', () => {
        this.build = ponerRuna(this.build, this.ranuraSel, o.id);
        this.cambio();
      });
      runas.appendChild(b);
    }
  }
}
