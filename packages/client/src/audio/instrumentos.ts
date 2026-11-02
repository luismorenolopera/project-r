import type { Instrumento } from './partitura';

/**
 * Instrumentos sintetizados con Web Audio: osciladores, filtros y ruido, sin muestras.
 * Cada voz crea sus nodos, programa sus envolventes en el tiempo exacto y se para sola; nada persistente queda
 * conectado a ella, así que el recolector se la lleva al terminar.
 */

export interface Contexto {
  ctx: BaseAudioContext;
  /** Un segundo de ruido blanco compartido por la percusión. */
  ruido: AudioBuffer;
}

/** Programa una nota: empieza en `t` (segundos del contexto), suena `dur` segundos y sale por `destino`. */
export type Voz = (c: Contexto, destino: AudioNode, t: number, f: number, dur: number, vel: number) => void;

function osc(ctx: BaseAudioContext, tipo: OscillatorType, f: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = tipo;
  o.frequency.value = f;
  o.detune.value = detune;
  return o;
}

function filtro(ctx: BaseAudioContext, tipo: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = tipo;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function ganancia(ctx: BaseAudioContext, v = 0): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function ruido(c: Contexto, t: number, dur: number): AudioBufferSourceNode {
  const s = c.ctx.createBufferSource();
  s.buffer = c.ruido;
  s.loop = true;
  s.start(t, Math.random() * 0.9);
  s.stop(t + dur);
  return s;
}

/** Envolvente lenta (ataque lineal, sostiene, se apaga exponencialmente al soltar). */
function envolventeLenta(g: AudioParam, t: number, dur: number, pico: number, ataque: number, suelta: number) {
  const a = Math.min(ataque, dur * 0.5);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(pico, t + a);
  g.setValueAtTime(pico, t + dur);
  g.setTargetAtTime(0, t + dur, suelta / 4);
}

/** Capa de cuerdas sostenidas: sierras desafinadas detrás de un paso bajo que se abre despacio. */
function sostenido(tipos: OscillatorType[], desafine: number[], brillo: number, pico: number, ataque: number, suelta: number): Voz {
  return (c, destino, t, f, dur, vel) => {
    const { ctx } = c;
    const g = ganancia(ctx);
    const lp = filtro(ctx, 'lowpass', brillo * 0.7, 0.6);
    lp.frequency.setValueAtTime(brillo * 0.7, t);
    lp.frequency.linearRampToValueAtTime(brillo * (1 + 0.3 * vel), t + Math.max(0.1, dur * 0.6));
    lp.frequency.linearRampToValueAtTime(brillo * 0.8, t + dur + suelta);
    envolventeLenta(g.gain, t, dur, pico * vel, ataque, suelta);
    const fin = t + dur + suelta * 1.2;
    desafine.forEach((d, i) => {
      const o = osc(ctx, tipos[i % tipos.length]!, f, d);
      o.connect(lp);
      o.start(t);
      o.stop(fin);
    });
    lp.connect(g).connect(destino);
  };
}

const pad = sostenido(['sawtooth'], [-9, 0, 8], 950, 0.08, 1.4, 1.8);
const cristal = sostenido(['triangle', 'sine', 'triangle'], [-6, 1200, 7], 3200, 0.075, 1.6, 2.2);
const dron = sostenido(['triangle', 'sawtooth'], [0, 5], 320, 0.16, 2.2, 2.5);

/** Coro: sierras con vibrato por dos formantes de vocal oscura («oh»). */
const coro: Voz = (c, destino, t, f, dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const entrada = ganancia(ctx, 1);
  const f1 = filtro(ctx, 'bandpass', 520, 5);
  const f2 = filtro(ctx, 'bandpass', 880, 6);
  const g2 = ganancia(ctx, 0.6);
  const lp = filtro(ctx, 'lowpass', 2800);
  const fin = t + dur + 2.4;
  const lfo = osc(ctx, 'sine', 5.1);
  const prof = ganancia(ctx, 0);
  prof.gain.setValueAtTime(0, t);
  prof.gain.linearRampToValueAtTime(f * 0.005, t + 0.8);
  lfo.connect(prof);
  for (const d of [-7, 6]) {
    const o = osc(ctx, 'sawtooth', f, d);
    prof.connect(o.frequency);
    o.connect(entrada);
    o.start(t);
    o.stop(fin);
  }
  lfo.start(t);
  lfo.stop(fin);
  entrada.connect(f1).connect(lp);
  entrada.connect(f2).connect(g2).connect(lp);
  envolventeLenta(g.gain, t, dur, 0.28 * vel, 0.9, 2);
  lp.connect(g).connect(destino);
};

/** Cuerdas en staccato para los ostinatos. */
const cuerdas: Voz = (c, destino, t, f, dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const lp = filtro(ctx, 'lowpass', 2300, 0.9);
  const pico = 0.16 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.012);
  g.gain.setTargetAtTime(pico * 0.55, t + 0.012, 0.08);
  g.gain.setTargetAtTime(0, t + Math.max(0.05, dur), 0.05);
  const fin = t + dur + 0.4;
  for (const d of [-7, 7]) {
    const o = osc(ctx, 'sawtooth', f, d);
    o.connect(lp);
    o.start(t);
    o.stop(fin);
  }
  lp.connect(g).connect(destino);
};

/** Arpa: triángulo con armónicos y un filtro que se cierra tras la pulsación. */
const arpa: Voz = (c, destino, t, f, _dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const lp = filtro(ctx, 'lowpass', 5000, 0.8);
  lp.frequency.setValueAtTime(5200, t);
  lp.frequency.setTargetAtTime(900, t, 0.18);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3 * vel, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, 0.45);
  const fin = t + 2.6;
  const a = osc(ctx, 'triangle', f);
  const b = osc(ctx, 'sine', f * 2);
  const bg = ganancia(ctx, 0.25);
  a.connect(lp);
  b.connect(bg).connect(lp);
  for (const o of [a, b]) {
    o.start(t);
    o.stop(fin);
  }
  lp.connect(g).connect(destino);
};

/** Celesta / caja de música: senoidal con un armónico agudo que muere antes. */
const celesta: Voz = (c, destino, t, f, _dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const gb = ganancia(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.24 * vel, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, 0.38);
  gb.gain.setValueAtTime(0, t);
  gb.gain.linearRampToValueAtTime(0.075 * vel, t + 0.002);
  gb.gain.setTargetAtTime(0, t + 0.002, 0.09);
  const a = osc(ctx, 'sine', f);
  const b = osc(ctx, 'sine', f * 4.01);
  a.connect(g).connect(destino);
  b.connect(gb).connect(destino);
  for (const o of [a, b]) {
    o.start(t);
    o.stop(t + 2.2);
  }
};

/** Campana por modulación de frecuencia (razón 1:3,5, inarmónica) con una cola larga. */
const campana: Voz = (c, destino, t, f, _dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const portadora = osc(ctx, 'sine', f);
  const moduladora = osc(ctx, 'sine', f * 3.5);
  const indice = ganancia(ctx);
  indice.gain.setValueAtTime(f * 2.4, t);
  indice.gain.setTargetAtTime(f * 0.15, t, 0.7);
  moduladora.connect(indice).connect(portadora.frequency);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, 1.1);
  portadora.connect(g).connect(destino);
  const fin = t + 5.5;
  for (const o of [portadora, moduladora]) {
    o.start(t);
    o.stop(fin);
  }
};

/** Bajo sintético con golpe de filtro y subgrave. */
const bajo: Voz = (c, destino, t, f, dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const lp = filtro(ctx, 'lowpass', 1300, 4.5);
  lp.frequency.setValueAtTime(1300 + 500 * vel, t);
  lp.frequency.setTargetAtTime(240, t, 0.07);
  const pico = 0.26 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.005);
  g.gain.setTargetAtTime(pico * 0.65, t + 0.005, 0.18);
  g.gain.setTargetAtTime(0, t + Math.max(0.06, dur * 0.92), 0.035);
  const fin = t + dur + 0.35;
  const a = osc(ctx, 'sawtooth', f);
  const sub = osc(ctx, 'sine', f);
  const gs = ganancia(ctx, 0.9);
  a.connect(lp);
  sub.connect(gs).connect(g);
  lp.connect(g).connect(destino);
  for (const o of [a, sub]) {
    o.start(t);
    o.stop(fin);
  }
};

/** Bajo redondo (triángulo y senoidal) para el tema del mago. */
const bajoSuave: Voz = (c, destino, t, f, dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const lp = filtro(ctx, 'lowpass', 700, 0.8);
  const pico = 0.3 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.02);
  g.gain.setTargetAtTime(pico * 0.6, t + 0.02, 0.4);
  g.gain.setTargetAtTime(0, t + Math.max(0.1, dur * 0.95), 0.12);
  const fin = t + dur + 0.8;
  const a = osc(ctx, 'triangle', f);
  const b = osc(ctx, 'sine', f / 2);
  const gb = ganancia(ctx, 0.5);
  a.connect(lp);
  b.connect(gb).connect(lp);
  lp.connect(g).connect(destino);
  for (const o of [a, b]) {
    o.start(t);
    o.stop(fin);
  }
};

/** Metales graves: sierras con un filtro que se abre en el ataque y vibrato tardío. */
const metal: Voz = (c, destino, t, f, dur, vel) => {
  const { ctx } = c;
  const g = ganancia(ctx);
  const lp = filtro(ctx, 'lowpass', 300, 1.3);
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.linearRampToValueAtTime(400 + 2100 * vel, t + 0.07);
  lp.frequency.setTargetAtTime(900 + 500 * vel, t + 0.07, 0.3);
  const pico = 0.2 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(pico, t + 0.06);
  g.gain.setValueAtTime(pico, t + Math.max(0.08, dur));
  g.gain.setTargetAtTime(0, t + Math.max(0.08, dur), 0.12);
  const fin = t + dur + 0.8;
  const lfo = osc(ctx, 'sine', 5.3);
  const prof = ganancia(ctx, 0);
  prof.gain.setValueAtTime(0, t);
  prof.gain.linearRampToValueAtTime(0, t + 0.25);
  prof.gain.linearRampToValueAtTime(f * 0.006, t + 0.6);
  lfo.connect(prof);
  for (const d of [-5, 5]) {
    const o = osc(ctx, 'sawtooth', f, d);
    prof.connect(o.frequency);
    o.connect(lp);
    o.start(t);
    o.stop(fin);
  }
  lfo.start(t);
  lfo.stop(fin);
  lp.connect(g).connect(destino);
};

/** Taiko: senoidal que cae de tono y el chasquido del mazo. */
const taiko: Voz = (c, destino, t, _f, _dur, vel) => {
  const { ctx } = c;
  const cuerpo = osc(ctx, 'sine', 130);
  cuerpo.frequency.setValueAtTime(125 + 15 * vel, t);
  cuerpo.frequency.exponentialRampToValueAtTime(46, t + 0.32);
  const g = ganancia(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.75 * vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.004, 0.17);
  cuerpo.connect(g).connect(destino);
  cuerpo.start(t);
  cuerpo.stop(t + 1.2);
  const mazo = ruido(c, t, 0.25);
  const lp = filtro(ctx, 'lowpass', 750, 0.7);
  const gm = ganancia(ctx);
  gm.gain.setValueAtTime(0.32 * vel, t);
  gm.gain.setTargetAtTime(0, t, 0.025);
  mazo.connect(lp).connect(gm).connect(destino);
};

/** Pandero de marco: ruido en banda media y un golpe de tono corto. */
const marco: Voz = (c, destino, t, _f, _dur, vel) => {
  const { ctx } = c;
  const n = ruido(c, t, 0.3);
  const bp = filtro(ctx, 'bandpass', 1700, 0.9);
  const gn = ganancia(ctx);
  gn.gain.setValueAtTime(0.5 * vel, t);
  gn.gain.setTargetAtTime(0, t, 0.045);
  n.connect(bp).connect(gn).connect(destino);
  const o = osc(ctx, 'sine', 210);
  o.frequency.setValueAtTime(215, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
  const go = ganancia(ctx);
  go.gain.setValueAtTime(0.4 * vel, t);
  go.gain.setTargetAtTime(0, t, 0.045);
  o.connect(go).connect(destino);
  o.start(t);
  o.stop(t + 0.35);
};

/** Sonajero: ruido agudo y muy corto. */
const sonajero: Voz = (c, destino, t, _f, _dur, vel) => {
  const { ctx } = c;
  const n = ruido(c, t, 0.15);
  const hp = filtro(ctx, 'highpass', 6500, 0.7);
  const g = ganancia(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.45 * vel, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, 0.022);
  n.connect(hp).connect(g).connect(destino);
};

export const VOCES: Record<Instrumento, Voz> = {
  pad,
  cristal,
  coro,
  dron,
  cuerdas,
  arpa,
  celesta,
  campana,
  bajo,
  bajo_suave: bajoSuave,
  metal,
  taiko,
  marco,
  sonajero,
};

/** Un segundo de ruido blanco. */
export function crearRuido(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/**
 * Respuesta al impulso de una sala de piedra: ruido estéreo que decae (unos 3,5 s hasta -60 dB)
 * y se oscurece con el tiempo, como una cripta.
 */
export function crearSala(ctx: BaseAudioContext, segundos = 3.6): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * segundos);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let canal = 0; canal < 2; canal++) {
    const d = b.getChannelData(canal);
    let lento = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const caida = Math.pow(1 - x, 2.2) * Math.exp(-x * 3.2);
      const blanco = Math.random() * 2 - 1;
      // Paso bajo de un polo que se cierra con el tiempo: la cola pierde los agudos.
      const k = 0.55 - 0.45 * x;
      lento += (blanco - lento) * k;
      // Las primeras reflexiones, algo más fuertes, dan la sensación de muros cercanos.
      const temprana = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2 : 0;
      d[i] = (lento + temprana) * caida;
    }
  }
  return b;
}
