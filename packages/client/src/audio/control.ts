import type { Musica } from './musica';

/**
 * Control de la música: botón para silenciar (o tecla U), volumen y el nombre del tema al empezar.
 * Se inyecta solo (HTML y estilos) en la esquina inferior izquierda de cualquier página.
 */

const ESTILOS = `
.musica {
  position: fixed;
  left: max(12px, env(safe-area-inset-left, 0px));
  bottom: max(12px, env(safe-area-inset-bottom, 0px));
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  background: rgba(13, 11, 16, 0.84);
  border: 1px solid #3a3036;
  color: #e2d8c6;
  font: 12px/1.2 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace;
  user-select: none;
}
.musica button {
  all: unset;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  cursor: pointer;
}
.musica button:focus-visible { outline: 1px solid #e8a24a; outline-offset: 1px; }
.musica button:hover .musica-texto { color: #fff; }
.musica-icono {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: #e8a24a;
  font-size: 15px;
}
.musica[data-estado='silencio'] .musica-icono { color: #6d6258; }
.musica[data-estado='silencio'] .musica-icono::after {
  content: '';
  position: absolute;
  left: 1px;
  right: 1px;
  top: 50%;
  border-top: 2px solid #c8321e;
  transform: rotate(-40deg);
}
.musica[data-estado='sonando'] .musica-icono { animation: musica-latido 1.6s ease-in-out infinite; }
@keyframes musica-latido { 50% { transform: translateY(-1px); text-shadow: 0 0 8px rgba(232, 162, 74, 0.7); } }
@media (prefers-reduced-motion: reduce) { .musica[data-estado='sonando'] .musica-icono { animation: none; } }
.musica kbd {
  font: inherit;
  font-size: 10px;
  color: #9a8f80;
  border: 1px solid #3a3036;
  padding: 0 4px;
}
.musica input[type='range'] { width: 78px; margin: 0; accent-color: #e8a24a; cursor: pointer; }
.musica-tema {
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: #9a8f80;
  opacity: 0;
  transition: max-width 0.6s ease, opacity 0.6s ease;
}
.musica.anuncia .musica-tema { max-width: 240px; opacity: 1; }
/* En pantallas estrechas, solo el icono y en el borde derecho: abajo están las barras de cada sandbox. */
@media (max-width: 720px) {
  .musica {
    left: auto;
    right: max(8px, env(safe-area-inset-right, 0px));
    bottom: auto;
    top: 50%;
    transform: translateY(-50%);
    padding: 2px;
  }
  .musica input[type='range'], .musica kbd, .musica-texto, .musica-tema { display: none; }
}
`;

function inyectarEstilos() {
  if (document.getElementById('musica-estilos')) return;
  const s = document.createElement('style');
  s.id = 'musica-estilos';
  s.textContent = ESTILOS;
  document.head.appendChild(s);
}

export function montarControl(m: Musica): HTMLElement {
  inyectarEstilos();
  const raiz = document.createElement('div');
  raiz.className = 'musica';
  raiz.innerHTML = `
    <button type="button" class="musica-boton">
      <span class="musica-icono" aria-hidden="true">♪</span>
      <span class="musica-texto">Música</span>
      <kbd>U</kbd>
    </button>
    <input type="range" min="0" max="100" step="1" aria-label="Volumen de la música" />
    <span class="musica-tema" aria-live="polite"></span>`;
  document.body.appendChild(raiz);

  const boton = raiz.querySelector('button')!;
  const texto = raiz.querySelector<HTMLElement>('.musica-texto')!;
  const volumen = raiz.querySelector<HTMLInputElement>('input')!;
  const tema = raiz.querySelector<HTMLElement>('.musica-tema')!;
  tema.textContent = `«${m.tema.nombre}»`;

  let anunciado = false;
  let anuncio: number | null = null;
  const pintar = () => {
    const e = m.estado;
    raiz.dataset.estado = e;
    boton.setAttribute('aria-pressed', String(e !== 'silencio'));
    if (e === 'sin-audio') {
      texto.textContent = 'Sin audio';
      boton.disabled = true;
    } else if (e === 'silencio') {
      texto.textContent = 'Música: no';
      boton.title = 'Activar la música (U)';
    } else if (e === 'esperando') {
      texto.textContent = 'Música';
      boton.title = 'Suena al primer clic o tecla. Silenciar (U)';
    } else {
      texto.textContent = 'Música';
      boton.title = 'Silenciar la música (U)';
    }
    volumen.value = String(Math.round(m.volumen * 100));
    // El nombre del tema aparece unos segundos la primera vez que suena.
    if (e === 'sonando' && !anunciado) {
      anunciado = true;
      raiz.classList.add('anuncia');
      anuncio = window.setTimeout(() => raiz.classList.remove('anuncia'), 5000);
    }
  };
  m.suscribir(pintar);
  pintar();

  boton.addEventListener('click', () => {
    // Antes del primer gesto la música está pedida pero no suena: el clic la arranca en vez de silenciarla.
    if (m.estado === 'esperando') m.arrancar();
    else m.alternarSilencio();
    // Sin foco: si no, Espacio (saltar, embestir) volvería a pulsar el botón.
    boton.blur();
  });
  volumen.addEventListener('input', () => m.fijarVolumen(Number(volumen.value) / 100));
  volumen.addEventListener('change', () => volumen.blur());
  raiz.addEventListener('mouseenter', () => {
    if (anuncio !== null) window.clearTimeout(anuncio);
    if (m.estado === 'sonando') raiz.classList.add('anuncia');
  });
  raiz.addEventListener('mouseleave', () => raiz.classList.remove('anuncia'));

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyU' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const objetivo = e.target as HTMLElement | null;
    if (objetivo instanceof HTMLInputElement && objetivo.type === 'text') return;
    if (objetivo instanceof HTMLTextAreaElement) return;
    m.alternarSilencio();
  });
  return raiz;
}
