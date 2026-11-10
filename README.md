# Mazmorra Co-op

Dungeon crawler cooperativo de acción en navegador con estética 3D retro estilo PS1.
Este repositorio sigue el *Plan Maestro de Diseño y Arquitectura* del equipo.

**Estado actual:** sala de pruebas local (sin conexión) con cuatro sandboxes jugables: el combate de las 5 clases,
la embestida del guerrero con físicas, el grimorio del mago (hechizos con runas, combos elementales y entorno
destructible) y el taller del alquimista (descompone el entorno en materia y la transmuta en ataques y armas). Cada página tiene su música, generada en el navegador y que se intensifica con el combate. La red (Colyseus + Geckos.io) y la persistencia (Supabase) llegan en los hitos siguientes;
ver [`docs/HITOS.md`](docs/HITOS.md).

**Jugar en línea:** <https://luismorenolopera.github.io/project-r/> (se publica con GitHub Pages en cada push a `main`).

## Requisitos

- Node.js 22 o superior
- pnpm 10 (`corepack enable` lo instala)

## Instalar

```bash
pnpm install
```

## Sala de pruebas

```bash
pnpm dev          # http://localhost:5173 → menú para elegir sandbox (teclas 1 a 4)
```

| Sandbox | Página | Qué prueba |
| --- | --- | --- |
| Sandbox de combate | `sandbox-combate.html` | Las 5 clases, enemigos telegrafiados, frenesí y sinergias entre clases |
| Embestida con físicas | `prototipo-embestida.html` | Carga del guerrero, empuje por masa, fractura de objetos |
| Grimorio del mago | `sandbox-mago.html` | Hechizos intercambiables con runas, combos elementales, destrucción procedural |
| Taller del alquimista | `sandbox-alquimista.html` | Materia del entorno, recetas de dos materiales, armas forjadas, púas y jabalinas con física |

Cada sandbox tiene un enlace «← Sala de pruebas» para volver al menú.

### Música

Cada página tiene su tema, compuesto y sintetizado en el navegador con Web Audio (sin ficheros de audio):

| Página | Tema | Carácter |
| --- | --- | --- |
| Menú | «Sala de pruebas» | Re menor, lento: arpa, pads, celesta y campanas |
| Sandbox de combate | «Cripta de los cinco» | Mi menor, 100 bpm: bajo, ostinato de cuerdas, taikos, metales y coro |
| Embestida con físicas | «Carga del guerrero» | La frigio, 116 bpm: bajo al galope y tambores de guerra |
| Grimorio del mago | «Biblioteca en ruinas» | Fa sostenido dórico: cristal, celesta, campanas y arpa |
| Taller del alquimista | «Biblioteca en ruinas» | El mismo tema que el mago (aún no tiene uno propio) |

La música sube con el combate: con enemigos cerca, golpes y muertes entran tambores, metales y coro, y se retiran despacio
cuando todo se calma. Cada combo del mago suena con una floritura y, con el grimorio abierto, la música se oye apagada.
Empieza con el primer clic o tecla (los navegadores no dejan sonar antes). El control de abajo a la izquierda (o la tecla
**U**) la silencia y ajusta el volumen; ambas cosas se guardan en el navegador.

### Sandbox de combate

Haz clic en «Haz clic para jugar». Controles:

| Tecla | Acción |
| --- | --- |
| WASD / ratón | Moverse / cámara y apuntar |
| Clic izquierdo (mantener) | Ataque básico |
| Shift · Q (o clic derecho) · E · R | Movilidad · Mitigación · Principal · Definitiva |
| Espacio | Saltar |
| 1 a 5 | Guerrero, Mago, Arquero, Curador, Alquimista |
| Z X C V B G | Esqueleto, Cultista, Bruto, Espectro, Muñeco, Compañero (en el punto apuntado) |
| O · K · I | Oleada · Limpiar · Inmortal |
| U | Silenciar o activar la música |
| Esc | Soltar el ratón y usar el panel lateral |

### Embestida con físicas

Prueba aislada del guerrero: la embestida (7 m en 0,3 s hacia el cursor) empuja a los enemigos según su masa y rompe
cajas, barriles, urnas y lápidas. Cada objeto es un poliedro convexo que, al romperse, se corta con planos aleatorios
cerca del impacto (`packages/client/src/physics/fractura.ts`); cada trozo es un `ConvexPolyhedron`
de cannon-es. Un enemigo despedido contra un muro, pilar o sarcófago queda aturdido, y si choca con un objeto lo rompe.

| Tecla | Acción |
| --- | --- |
| WASD | Moverse |
| Clic / Espacio / Shift | Embestida hacia el cursor |
| 1 2 3 4 | Caja, barril, urna, lápida en el cursor |
| 5 6 | Esqueleto, bruto en el cursor |
| T · P · R | Cámara lenta · los enemigos persiguen · reiniciar |
| U | Silenciar o activar la música |

### Grimorio del mago

Barra de **6 ranuras**, cada una ligada a una categoría: Principal (clic izquierdo), Secundaria (clic derecho),
Defensa (1), Fuerza (2), Conjuro (3) y Dominio (4). En cada ranura eliges uno de los **14 hechizos** de su categoría
y, para ese hechizo, una de sus **4 runas** (o ninguna). Las runas cambian el elemento (fuego, hielo, rayo, arcano,
fuerza) o la forma del hechizo: el Dardo arcano puede ser un tridente, un dardo de escarcha, un buscador o una chispa
que salta entre enemigos. El **modo libre** quita la restricción de categoría (cualquier hechizo en cualquier ranura,
sin repetir; si eliges uno que ya está en otra ranura, se intercambian). La build se guarda en el navegador.

| Tecla | Acción |
| --- | --- |
| WASD · ratón | Moverse · apuntar |
| Clic izquierdo · derecho (mantener) | Ranuras 1 y 2 (el Rayo desintegrador se canaliza mientras mantienes) |
| 1 2 3 4 | Ranuras 3 a 6 |
| K | Grimorio: cambiar hechizos y runas (pausa el juego) |
| Z X C | Esqueleto, bruto, muñeco en el cursor |
| V B N M | Caja, barril de aceite, tinaja de agua, cristal de maná en el cursor |
| O · P · I · T · R | Oleada · enemigos atacan · inmortal · cámara lenta · reiniciar |
| Rueda · H | Zoom · ocultar paneles |
| U | Silenciar o activar la música |

**Combos elementales.** Cada golpe deja un estado (quemado, frío/congelado, electrizado, empapado, marca arcana) y el
siguiente elemento reacciona con él:

| Combo | Cómo |
| --- | --- |
| Choque térmico | Fuego sobre congelado, o hielo sobre quemado |
| Hacer añicos | Fuerza sobre congelado (×2,5; el enemigo estalla en trozos de hielo si muere) |
| Superconductor | Rayo sobre enfriado o congelado: salta a todos los enfriados cercanos |
| Sobrecarga | Rayo sobre quemado, o fuego sobre electrizado: explosión que empuja |
| Electrocución | Rayo sobre empapado: aturde y salta a los empapados |
| Congelación | Hielo sobre empapado: congela al instante |
| Evaporación | Fuego sobre empapado (×1,5) |
| Resonancia | Arcano sobre un enemigo con 2 o más estados: los detona todos |

Y del entorno: explosión de aceite, detonación de cristal (devuelve maná), incendio que salta entre objetos de
madera e impacto contra el muro. El libro de combos de la derecha cuenta los que provocas.

**Entorno destructible.** Cajas, barriles, barriles de aceite, urnas, tinajas, cristales de maná, obeliscos, columnas,
lápidas y muros de ladrillo. Todo se fractura por cortes planos cerca del impacto; la madera se raja a lo largo de la
veta, arde y propaga el fuego; el hielo vuelve quebradizo cualquier objeto. La piedra se **astilla poco a poco**: cada
golpe fuerte arranca una lasca por el lado del impacto y el resto sigue en pie con su nueva forma, hasta que se derrumba.

### Taller del alquimista

El alquimista no lleva munición: la saca del entorno. Su regla es la **ley del equilibrio**: nada se crea de la nada,
todo lo que transmuta sale de la materia que antes ha descompuesto. Hay seis materiales y cada uno sale de un sitio:

| Material | Tecla | De dónde sale | Como base (forma) | Como catalizador |
| --- | --- | --- | --- | --- |
| Piedra | 1 | Suelo, muros, obeliscos, columnas, lápidas, urnas | Púas que brotan del suelo · Mazo | Pesado: más empuje, aturde |
| Madera | 2 | Cajas y barriles | Jabalinas con física · Lanza | Ramificado: más piezas y alcance |
| Metal | 3 | Chatarra y armas de los esqueletos caídos | Abanico de cuchillas · Espada | Afilado: daño ×1,5 y atraviesa |
| Cristal | 4 | Cristales de maná | Prisma que dispara haces · Cetro | Cargado: rayo |
| Agua | 5 | Tinajas (y hielo) | Chorro a presión · Látigo | Gélido: hielo |
| Aceite | 6 | Barriles de aceite | Frasco que deja un charco inflamable · Tea | Ígneo: fuego |

El **crisol** tiene dos huecos: el primer material da la forma y el segundo la cambia (Púas ígneas, Jabalinas cargadas,
Prisma gélido...). El mismo material dos veces da la versión grande (Muralla de púas, Corona de cuchillas, Torrente...).
Son 42 recetas, y cada una se puede **lanzar** (Q, cuesta 2 de la base más 1 del catalizador) o **forjar** como arma
(F, cuesta más pero dura varios golpes). Al gastarse, el arma se deshace y devuelve una unidad. Los elementos son los del
mago, así que los combos elementales funcionan igual (empapar con el Chorro y rematar con Cuchillas cargadas electrocuta).

**Transmutar el entorno (E)** usa el propio objeto como materia: el suelo levanta un pilar que lanza por los aires lo que
tiene encima; un enemigo queda inmóvil con grilletes de piedra; la piedra estalla en púas; la madera se vuelve un zarzal;
el aceite se destila en una bomba; el agua se congela de golpe; el cristal suelta rayos en cadena y la chatarra sale
disparada en hojas.

**Física:** las púas y los pilares son cuerpos cinemáticos de cannon-es que suben del suelo, empujan lo que tienen encima
y quedan como obstáculos duros (un enemigo despedido contra ellos se aturde, como contra un muro). Jabalinas y cuchillas son
cuerpos dinámicos: dañan según la velocidad del impacto, rebotan en los objetos, las jabalinas se clavan en los muros y,
cuando se paran, quedan como restos que se pueden volver a descomponer. Descomponer un objeto entero rinde más que
recoger sus escombros.

| Tecla | Acción |
| --- | --- |
| WASD · ratón | Moverse · apuntar |
| Clic derecho (mantener) | Descomponer lo que hay bajo el cursor: objeto, escombros o el suelo (deja un hoyo) |
| 1 a 6 · X | Meter un material en el crisol · vaciarlo |
| Q · F | Lanzar la receta · forjar el arma |
| Clic izquierdo | Atacar con el arma (sin arma: una onda corta que empuja) |
| E | Transmutar lo que hay bajo el cursor |
| Z C · V B N M G L | Esqueleto, muñeco · caja, aceite, tinaja, cristal, chatarra, obelisco en el cursor |
| O · P · I · Y · T · R | Oleada · enemigos atacan · inmortal · materia infinita · cámara lenta · reiniciar |
| Rueda · H | Zoom · ocultar paneles |

El recetario de la derecha marca las recetas lanzadas y forjadas; un clic en una casilla la carga en el crisol.

## Probar

```bash
pnpm test         # pruebas de la simulación, la fractura, el grimorio, el alquimista y la música (Vitest)
pnpm typecheck    # comprobación de tipos de todos los paquetes
```

## Compilar y desplegar

```bash
pnpm build        # genera packages/client/dist (estático, una página por sandbox más el menú)
```

`packages/client/dist` se puede servir desde cualquier hosting de ficheros estáticos (las rutas son relativas).
El flujo `.github/workflows/pages.yml` lo publica en GitHub Pages en cada push a `main`. El despliegue del servidor
autoritativo llegará con el Hito 0 de red.

## Estructura

```
packages/
  shared/   núcleo de simulación compartido cliente/servidor: ECS (bitECS), clases, enemigos,
            colisiones deterministas, sinergias. Sin dependencias de navegador.
  client/   cliente Vite + Three.js (shaders PS1) + cannon-es (ragdolls, fractura y cámara).
    index.html                 sala de pruebas (menú)
    src/audio/                 música procedural: partitura y temas (puro, con pruebas), instrumentos, motor y control
    src/physics/fractura.ts    fractura convexa y astillado, compartidos por los prototipos
    src/prototipos/embestida/  prototipo de la embestida del guerrero
    src/prototipos/mago/       grimorio del mago (grimorio.ts y reacciones.ts son puros y tienen pruebas)
    src/prototipos/alquimista/ taller del alquimista: materia.ts (reglas puras, con pruebas), transmutacion.ts (motor),
                               circulo.ts (sello y flujo de materia); reutiliza el mundo del mago
docs/       DECISIONES.md (decisiones propias y su motivo) y HITOS.md (avance).
```

Variables de entorno: ver [`.env.example`](.env.example). Los sandboxes no necesitan ninguna.
