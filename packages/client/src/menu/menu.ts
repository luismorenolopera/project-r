/**
 * Sala de pruebas: menú para elegir sandbox.
 * - Teclas 1 a 4 para entrar en cada sandbox.
 * - Fondo: ascuas y polvo a baja resolución (estilo PS1), quieto si se pide menos movimiento.
 * - Música del tema «Sala de pruebas» desde el primer clic o tecla (botón abajo a la izquierda, tecla U).
 */

import { iniciarMusica } from '../audio/musica';

iniciarMusica('menu');

const sellos = [...document.querySelectorAll<HTMLAnchorElement>('a.sello[data-tecla]')];
window.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const destino = sellos.find((s) => s.dataset.tecla === e.key);
  if (destino) window.location.href = destino.href;
});

const canvas = document.getElementById('ambiente') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Ascua {
  x: number;
  y: number;
  vy: number;
  fase: number;
  color: string;
}
const COLORES = ['#e8a24a', '#c8321e', '#9d8aff', '#e2d8c6'];
let ascuas: Ascua[] = [];
let ancho = 0;
let alto = 0;

function ajustar() {
  // Resolución interna baja: cada píxel del lienzo se ve como un bloque.
  alto = 180;
  ancho = Math.round((window.innerWidth / Math.max(1, window.innerHeight)) * alto);
  canvas.width = ancho;
  canvas.height = alto;
  const n = Math.round(ancho * 0.25);
  ascuas = Array.from({ length: n }, () => nueva(true));
}

function nueva(cualquierAltura: boolean): Ascua {
  return {
    x: Math.random() * ancho,
    y: cualquierAltura ? Math.random() * alto : alto + 2,
    vy: 4 + Math.random() * 10,
    fase: Math.random() * Math.PI * 2,
    color: COLORES[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * COLORES.length)]!,
  };
}

let anterior = performance.now();
function dibujar(ahora: number) {
  if (!ctx) return;
  const dt = Math.min(0.05, (ahora - anterior) / 1000);
  anterior = ahora;
  ctx.fillStyle = '#0d0b10';
  ctx.fillRect(0, 0, ancho, alto);
  // Resplandor de brasero al pie de la pantalla.
  const g = ctx.createLinearGradient(0, alto, 0, alto * 0.45);
  g.addColorStop(0, 'rgba(200, 80, 30, 0.35)');
  g.addColorStop(1, 'rgba(200, 80, 30, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ancho, alto);
  for (const a of ascuas) {
    if (!quieto) {
      a.y -= a.vy * dt;
      a.fase += dt * 2;
      a.x += Math.sin(a.fase) * dt * 4;
      if (a.y < -2) Object.assign(a, nueva(false));
    }
    const vida = Math.max(0, Math.min(1, a.y / alto));
    ctx.globalAlpha = 0.25 + vida * 0.75;
    ctx.fillStyle = a.color;
    ctx.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
  }
  ctx.globalAlpha = 1;
  if (!quieto) requestAnimationFrame(dibujar);
}

window.addEventListener('resize', () => {
  ajustar();
  if (quieto) dibujar(performance.now());
});
ajustar();
requestAnimationFrame(dibujar);
