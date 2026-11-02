import { PASOS, TEMAS, duracionCompas, midiAHz, notasCompas, posicion, presencia, voces, type Capa, type Tema, type TemaId } from './partitura';
import { VOCES, crearRuido, crearSala, type Contexto } from './instrumentos';
import { montarControl } from './control';

/**
 * Motor de música procedural.
 *
 * `Mezclador` monta el grafo de Web Audio de un tema (un bus por capa con su paneo, reverberación de cripta, eco,
 * compresor y un paso bajo que da el sonido apagado de las consolas de los 90) y programa compases enteros.
 * Funciona con cualquier `BaseAudioContext`, así que también se puede renderizar sin altavoces para medir niveles.
 *
 * `Musica` es la parte viva: crea el `AudioContext` con el primer gesto del jugador (los navegadores no dejan
 * sonar antes), programa por adelantado, sigue la intensidad que le marca el sandbox, se calla con la pestaña oculta
 * y guarda volumen y silencio en el navegador.
 */

const PASO_BAJO_ABIERTO = 10500;
const PASO_BAJO_AMORTIGUADO = 750;

/** Ganancia final para un volumen de la interfaz (0 a 1): curva cuadrática, más natural al oído. */
export function gananciaDeVolumen(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return 1.6 * x * x;
}

interface Bus {
  capa: Capa;
  gain: GainNode;
  objetivo: number;
}

export class Mezclador implements Contexto {
  readonly ruido: AudioBuffer;
  private readonly salida: GainNode;
  private readonly tono: BiquadFilterNode;
  private readonly buses = new Map<string, Bus>();
  private readonly busAcento: GainNode;
  private readonly linea: { t0: number; n: number }[] = [];
  private readonly compas: number;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly tema: Tema,
  ) {
    this.compas = duracionCompas(tema);
    this.ruido = crearRuido(ctx);
    const mezcla = ctx.createGain();

    const sala = ctx.createConvolver();
    sala.buffer = crearSala(ctx);
    const retornoSala = ctx.createGain();
    retornoSala.gain.value = 0.5;
    sala.connect(retornoSala).connect(mezcla);

    // Eco a corchea con puntillo, cada vez más oscuro.
    const eco = ctx.createDelay(2);
    eco.delayTime.value = (60 / tema.bpm) * 0.75;
    const realimentacion = ctx.createGain();
    realimentacion.gain.value = 0.34;
    const oscurecer = ctx.createBiquadFilter();
    oscurecer.type = 'lowpass';
    oscurecer.frequency.value = 2400;
    const retornoEco = ctx.createGain();
    retornoEco.gain.value = 0.42;
    eco.connect(oscurecer).connect(realimentacion).connect(eco);
    oscurecer.connect(retornoEco).connect(mezcla);

    this.tono = ctx.createBiquadFilter();
    this.tono.type = 'lowpass';
    this.tono.frequency.value = PASO_BAJO_ABIERTO;
    this.tono.Q.value = 0.5;
    const compresor = ctx.createDynamicsCompressor();
    compresor.threshold.value = -16;
    compresor.knee.value = 8;
    compresor.ratio.value = 3.5;
    compresor.attack.value = 0.006;
    compresor.release.value = 0.3;
    this.salida = ctx.createGain();
    this.salida.gain.value = 0;
    mezcla.connect(this.tono).connect(compresor).connect(this.salida).connect(ctx.destination);

    const crearBus = (pan: number, reverb: number, ecoEnvio: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(mezcla);
      if (reverb > 0) {
        const s = ctx.createGain();
        s.gain.value = reverb;
        p.connect(s).connect(sala);
      }
      if (ecoEnvio > 0) {
        const s = ctx.createGain();
        s.gain.value = ecoEnvio;
        p.connect(s).connect(eco);
      }
      return g;
    };
    for (const capa of tema.capas) {
      this.buses.set(capa.id, { capa, gain: crearBus(capa.pan ?? 0, capa.reverb ?? 0, capa.eco ?? 0), objetivo: -1 });
    }
    this.busAcento = crearBus(0.15, 0.7, 0.45);
    this.busAcento.gain.value = 0.5;
  }

  /** Abre o cierra cada capa según la intensidad. `ya` salta la transición (para empezar o medir). */
  fijarNivel(nivel: number, ahora: number, ya = false) {
    for (const bus of this.buses.values()) {
      const objetivo = bus.capa.volumen * presencia(nivel, bus.capa.umbral);
      if (Math.abs(objetivo - bus.objetivo) < 0.004 && !ya) continue;
      bus.objetivo = objetivo;
      if (ya) bus.gain.gain.setValueAtTime(objetivo, ahora);
      else bus.gain.gain.setTargetAtTime(objetivo, ahora, 0.7);
    }
  }

  volumen(ganancia: number, ahora: number, ya = false) {
    if (ya) this.salida.gain.setValueAtTime(ganancia, ahora);
    else this.salida.gain.setTargetAtTime(ganancia, ahora, 0.35);
  }

  amortiguar(si: boolean, ahora: number) {
    this.tono.frequency.setTargetAtTime(si ? PASO_BAJO_AMORTIGUADO : PASO_BAJO_ABIERTO, ahora, 0.18);
  }

  /** Programa todas las notas del compás `n` empezando en `t0`. Las capas que no llegan a sonar ni se generan. */
  programarCompas(n: number, t0: number, nivel: number): number {
    const paso = this.compas / PASOS;
    let programadas = 0;
    for (const nota of notasCompas(this.tema, n)) {
      const bus = this.buses.get(nota.capa);
      if (!bus || presencia(nivel, bus.capa.umbral) < 0.02) continue;
      const percusion = nota.midi === 0;
      // Un poco de humanidad: ni todos los golpes a la vez ni todos igual de fuertes.
      const t = t0 + nota.paso * paso + Math.random() * (percusion ? 0.004 : 0.012);
      const vel = nota.vel * (0.9 + Math.random() * 0.16);
      VOCES[bus.capa.instrumento](this, bus.gain, t, percusion ? 0 : midiAHz(nota.midi), nota.dur * paso, vel);
      programadas++;
    }
    this.linea.push({ t0, n });
    if (this.linea.length > 6) this.linea.shift();
    return programadas;
  }

  /** Floritura de tres notas del acorde que suena, en la siguiente corchea. */
  acento(ahora: number) {
    const corchea = (this.compas / PASOS) * 2;
    const desde = ahora + 0.03;
    const c = [...this.linea].reverse().find((l) => l.t0 <= desde);
    if (!c) return;
    const t = c.t0 + Math.ceil((desde - c.t0) / corchea) * corchea;
    const n = c.n + Math.floor((t - c.t0) / this.compas);
    const acorde = posicion(this.tema, n).acorde;
    const { instrumento, centro } = this.tema.acento;
    const notas = voces(this.tema.tonica, acorde, centro);
    const voz = VOCES[instrumento];
    notas.slice(0, 3).forEach((midi, i) => voz(this, this.busAcento, t + i * (corchea / 2), midiAHz(midi), corchea * 1.5, 0.85 - i * 0.1));
  }
}

// ---------------------------------------------------------------- preferencias
const CLAVE = 'mazmorra.musica';
interface Preferencias {
  volumen: number;
  silencio: boolean;
}

function leerPreferencias(): Preferencias {
  const def = { volumen: 0.6, silencio: false };
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return def;
    const p = JSON.parse(crudo) as Partial<Preferencias>;
    return {
      volumen: typeof p.volumen === 'number' && p.volumen >= 0 && p.volumen <= 1 ? p.volumen : def.volumen,
      silencio: typeof p.silencio === 'boolean' ? p.silencio : def.silencio,
    };
  } catch {
    return def;
  }
}

function guardarPreferencias(p: Preferencias) {
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(p));
  } catch {
    // Sin almacenamiento (ventana privada, vista previa): se recuerda solo en esta página.
  }
}

// ---------------------------------------------------------------- música viva
export type EstadoMusica = 'esperando' | 'sonando' | 'silencio' | 'sin-audio';

export class Musica {
  readonly tema: Tema;
  private ctx: AudioContext | null = null;
  private mez: Mezclador | null = null;
  private compas = 0;
  private tSiguiente = 0;
  private objetivo: number;
  private nivel: number;
  private amortiguado = false;
  private oculto = document.hidden;
  private prefs = leerPreferencias();
  private suspension: number | null = null;
  private ultimoAcento = -Infinity;
  private readonly oyentes = new Set<() => void>();

  constructor(id: TemaId) {
    this.tema = TEMAS[id];
    this.objetivo = this.nivel = this.tema.reposo;
    const gesto = (e: Event) => {
      // El propio control decide qué hacer con sus clics (empezar, silenciar, volumen).
      if (e.target instanceof Element && e.target.closest('.musica')) return;
      if (this.prefs.silencio) return;
      if (!this.ctx || this.ctx.state === 'suspended') this.arrancar();
    };
    window.addEventListener('pointerdown', gesto, true);
    window.addEventListener('keydown', gesto, true);
    document.addEventListener('visibilitychange', () => {
      this.oculto = document.hidden;
      this.aplicarSalida();
    });
  }

  get estado(): EstadoMusica {
    if (!('AudioContext' in window)) return 'sin-audio';
    if (this.prefs.silencio) return 'silencio';
    return this.ctx?.state === 'running' ? 'sonando' : 'esperando';
  }

  get volumen() {
    return this.prefs.volumen;
  }

  get intensidadActual() {
    return this.nivel;
  }

  /** Avisa a `fn` cada vez que cambia el estado o el volumen. Devuelve la función para dejar de escuchar. */
  suscribir(fn: () => void): () => void {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  private avisar() {
    for (const fn of this.oyentes) fn();
  }

  /** Crea el contexto (hace falta un gesto del jugador) y empieza a programar. */
  arrancar() {
    if (!this.ctx) {
      if (!('AudioContext' in window)) return;
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.mez = new Mezclador(this.ctx, this.tema);
      this.mez.fijarNivel(this.nivel, this.ctx.currentTime, true);
      this.tSiguiente = this.ctx.currentTime + 0.15;
      this.ctx.onstatechange = () => this.avisar();
      window.setInterval(() => this.tic(), 50);
    }
    this.aplicarSalida();
  }

  private tic() {
    const { ctx, mez } = this;
    if (!ctx || !mez || ctx.state !== 'running') return;
    const ahora = ctx.currentTime;
    // Sube en un par de segundos y baja despacio, para que no oscile con cada enemigo que cae.
    const tau = this.objetivo > this.nivel ? 1.2 : 5;
    this.nivel += (this.objetivo - this.nivel) * (1 - Math.exp(-0.05 / tau));
    mez.fijarNivel(this.nivel, ahora);
    if (this.tSiguiente < ahora - 0.05) this.tSiguiente = ahora + 0.05;
    while (this.tSiguiente < ahora + 0.3) {
      mez.programarCompas(this.compas, this.tSiguiente, Math.max(this.nivel, this.objetivo));
      this.compas++;
      this.tSiguiente += duracionCompas(this.tema);
    }
  }

  private aplicarSalida() {
    const { ctx, mez } = this;
    if (!ctx || !mez) return this.avisar();
    const v = this.prefs.silencio || this.oculto ? 0 : this.prefs.volumen;
    if (this.suspension !== null) {
      window.clearTimeout(this.suspension);
      this.suspension = null;
    }
    if (v > 0) {
      if (ctx.state === 'suspended') {
        void ctx.resume().then(() => {
          if (this.tSiguiente < ctx.currentTime) this.tSiguiente = ctx.currentTime + 0.05;
          mez.volumen(gananciaDeVolumen(this.prefs.volumen), ctx.currentTime);
          this.avisar();
        });
      }
      mez.volumen(gananciaDeVolumen(v), ctx.currentTime);
    } else {
      mez.volumen(0, ctx.currentTime);
      // Con la música callada, el contexto se suspende y deja de gastar CPU.
      this.suspension = window.setTimeout(() => {
        this.suspension = null;
        if (ctx.state === 'running') void ctx.suspend().then(() => this.avisar());
      }, 1200);
    }
    this.avisar();
  }

  /** Intensidad del combate (0 a 1); el motor la suaviza. */
  intensidad(v: number) {
    this.objetivo = Math.min(1, Math.max(0, v));
  }

  /** Floritura para un momento fuerte (como mucho una cada medio segundo). */
  acento() {
    const { ctx, mez } = this;
    if (!ctx || !mez || ctx.state !== 'running') return;
    if (ctx.currentTime - this.ultimoAcento < 0.5) return;
    this.ultimoAcento = ctx.currentTime;
    mez.acento(ctx.currentTime);
  }

  /** Apaga los agudos (menús que pausan el juego). */
  amortiguar(si: boolean) {
    if (si === this.amortiguado) return;
    this.amortiguado = si;
    if (this.ctx && this.mez) this.mez.amortiguar(si, this.ctx.currentTime);
  }

  alternarSilencio() {
    this.prefs.silencio = !this.prefs.silencio;
    guardarPreferencias(this.prefs);
    if (!this.prefs.silencio && !this.ctx) this.arrancar();
    else this.aplicarSalida();
  }

  fijarVolumen(v: number) {
    this.prefs.volumen = Math.min(1, Math.max(0, v));
    if (this.prefs.volumen > 0 && this.prefs.silencio) this.prefs.silencio = false;
    guardarPreferencias(this.prefs);
    if (!this.ctx && !this.prefs.silencio) this.arrancar();
    else this.aplicarSalida();
  }
}

// ---------------------------------------------------------------- medición sin altavoces
export interface Medicion {
  segundos: number;
  /** Pico absoluto de la mezcla (1 = 0 dBFS). */
  pico: number;
  /** Valor eficaz de toda la pieza. */
  rms: number;
  /** Valor eficaz del medio segundo más fuerte. */
  rmsMax: number;
  /** Muestras por encima de 0,99. */
  recortes: number;
  /** Mayor salto entre dos muestras seguidas (los chasquidos dan saltos grandes). */
  salto: number;
  notas: number;
}

/** Renderiza `compases` del tema con una intensidad fija y mide la mezcla (para pruebas en el navegador). */
export async function medirTema(id: TemaId, compases: number, nivel: number, volumen = 0.6): Promise<Medicion> {
  const tema = TEMAS[id];
  const sr = 44100;
  const segundos = compases * duracionCompas(tema) + 3;
  const off = new OfflineAudioContext(2, Math.ceil(sr * segundos), sr);
  const mez = new Mezclador(off, tema);
  mez.fijarNivel(nivel, 0, true);
  mez.volumen(gananciaDeVolumen(volumen), 0, true);
  let notas = 0;
  for (let n = 0; n < compases; n++) notas += mez.programarCompas(n, 0.05 + n * duracionCompas(tema), nivel);
  const buf = await off.startRendering();
  let pico = 0;
  let suma = 0;
  let recortes = 0;
  let salto = 0;
  let rmsMax = 0;
  const ventana = Math.floor(sr / 2);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  let sumaVentana = 0;
  for (let i = 0; i < l.length; i++) {
    for (const x of [l[i]!, r[i]!]) {
      const a = Math.abs(x);
      if (a > pico) pico = a;
      if (a > 0.99) recortes++;
      suma += x * x;
      sumaVentana += x * x;
    }
    if (i > 0) salto = Math.max(salto, Math.abs(l[i]! - l[i - 1]!), Math.abs(r[i]! - r[i - 1]!));
    if (i % ventana === ventana - 1) {
      rmsMax = Math.max(rmsMax, Math.sqrt(sumaVentana / (2 * ventana)));
      sumaVentana = 0;
    }
  }
  return { segundos, pico, rms: Math.sqrt(suma / (2 * l.length)), rmsMax, recortes, salto, notas };
}

// ---------------------------------------------------------------- arranque desde cada página
/** Crea la música de la página y su control (botón, volumen y tecla U). */
export function iniciarMusica(id: TemaId): Musica {
  const musica = new Musica(id);
  montarControl(musica);
  (window as unknown as { __musica: unknown }).__musica = { musica, medirTema, TEMAS };
  return musica;
}
