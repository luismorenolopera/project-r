# Decisiones de implementación

Cada decisión tomada por el equipo de implementación sin estar fijada en el Plan Maestro, con su motivo.
Las propuestas del plan de ejecución (contradicciones y preguntas abiertas) se registrarán aquí cuando se confirmen.

## D-01 · Empezar por un sandbox de combate local (2026-11-01)
**Decisión:** antes del Hito 0 de red, construir un sandbox jugable sin conexión con las 5 clases y enemigos de prueba.
**Motivo:** lo pidió Luis para poder ver y probar las clases y el combate cuanto antes. Adelanta parte del Hito 1
(combos, cobertura, sinergias) y del Hito 2 (monstruos legibles) sin red. El núcleo de simulación ya es el que usará
el servidor autoritativo, así que no es trabajo desechable.

## D-02 · Monorepo pnpm con `shared` y `client`
**Decisión:** pnpm workspaces; `packages/shared` contiene toda la lógica de juego y no depende del navegador.
**Motivo:** el plan exige compartir el mismo código ECS entre cliente y servidor. El paquete `server` se añadirá en el Hito 0 de red.

## D-03 · Colisiones cinemáticas deterministas en `shared`; Cannon.js solo cosmético
**Decisión:** movimiento, empujes, choques contra muros y cobertura se resuelven con geometría simple (círculos y cajas en XZ)
dentro de la simulación compartida. cannon-es se usa solo para ragdolls y para la colisión de la cámara.
**Motivo:** el servidor es autoritativo y no ejecuta Cannon; si el cliente predijera con otra física, aparecería rubberbanding
(contradicción 3 del plan de ejecución).

## D-04 · Simulación a 20 Hz fijos con interpolación a la tasa de refresco
**Decisión:** la simulación avanza en pasos de 50 ms (igual que el servidor previsto); el render interpola entre los dos últimos ticks.
**Motivo:** mismo comportamiento offline y online; movimiento fluido a 60 FPS o más.

## D-05 · Componentes por mundo y RNG propio
**Decisión:** los componentes SoA se crean por instancia de `Sim` y el azar usa `mulberry32` con semilla.
**Motivo:** varias salas por proceso en el servidor, pruebas aisladas y determinismo (verificado por test).

## D-06 · Tope duro de poder ×3
**Decisión:** el multiplicador total de daño (buffs, frenesí, vulnerabilidad, aéreo, afinidad) nunca supera ×3.
**Motivo:** mitigación del riesgo de explosión combinatoria de balance descrita en el plan.

## D-07 · Modelos y texturas procedurales como marcadores de posición
**Decisión:** personajes low-poly construidos con primitivas y texturas de 32-64 px generadas en canvas.
**Motivo:** todavía no hay arte. Mantiene la carga inicial mínima (≈195 KB gzip) y respeta la estética PS1.
El pipeline gltfpack sustituirá estos modelos cuando existan.

## D-08 · Kit de las 5 clases
**Decisión:** cada clase tiene un ataque básico más las 4 ranuras estandarizadas (movilidad, mitigación, principal, definitiva).
Las habilidades de soporte del mago (Égida, Encantamiento de furia) nunca afectan al propio mago y fallan sin consumir
tiempo de reutilización si no hay aliados.
**Motivo:** cumple 1.1, 1.3 y 2.2 con una carga cognitiva manejable. Los números son iniciales y se ajustarán con pruebas.

## D-09 · Sinergias elementales iniciales
**Decisión:** tres reacciones cruzadas: proyectil físico o arcano que cruza un Muro ígneo pasa a fuego (+50%); proyectil
físico que cruza un Santuario pasa a sagrado (+30%); cualquier fuego (también enemigo) que toca Aceite lo hace explotar.
**Motivo:** cubre el ejemplo del plan («flechas a través de un muro ígneo aliado») y muestra el sistema con pocas reglas legibles.

## D-10 · Frenesí
**Decisión:** 12 golpes encadenados (ventana de 2,5 s; los golpes a enemigos en el aire cuentan doble) activan el frenesí:
+40% de daño durante 10 s o hasta recibir un golpe.
**Motivo:** interpretación directa de 2.1 («daño amplificado mientras no se reciba impacto»).

## D-11 · El sandbox permite cambiar de clase en caliente
**Decisión:** en el sandbox se cambia de clase con 1-5, conservando la vida proporcional y los tiempos de reutilización de cada clase.
Las zonas creadas siguen activas.
**Motivo:** permite probar sinergias entre clases con un solo jugador. En partida real la clase se elige antes de entrar.

## D-12 · Objetos rompibles: fractura convexa precalculada en el momento del golpe
**Decisión:** los rompibles son poliedros convexos. Al romperse se cortan con 10-16 planos aleatorios sesgados hacia el
punto de impacto; cada trozo es convexo y entra tal cual en cannon-es como `ConvexPolyhedron`. Las caras nuevas del corte
se tiñen con el color del interior (madera clara, barro). Los trozos duermen al parar y desaparecen a los 12 s (tope de 450).
**Motivo:** cannon-es solo colisiona bien con convexos; cortar con planos garantiza convexidad sin Voronoi ni
descomposición convexa, y basta para el estilo PS1. En el juego real la rotura será un evento del servidor con semilla
(mismo troceado en todos los clientes) y los trozos serán cosméticos, como los ragdolls (D-03).
**Estado:** prototipo aislado (`prototipo-embestida.html`); en él las físicas sí mueven a guerrero y enemigos para probar
la sensación. Pendiente de confirmar antes de llevarlo a la simulación compartida.

## D-13 · La página principal es una sala de pruebas (2026-11-02)
**Decisión:** `index.html` pasa a ser un menú con los sandboxes; el sandbox de combate se mueve a `sandbox-combate.html`.
Cada sandbox es una página propia de Vite con un enlace de vuelta al menú, y el conjunto se publica en GitHub Pages.
**Motivo:** lo pidió Luis al subir el código a `project-r`. Páginas separadas mantienen cada prototipo aislado (sin estado
compartido ni carga extra) y permiten enlazar directamente a uno.

## D-14 · Hechizos del mago con ranuras por categoría y runas
**Decisión:** 6 ranuras ligadas a categorías (Principal, Secundaria, Defensa, Fuerza, Conjuro, Dominio), 14 hechizos y
4 runas por hechizo. Una runa por hechizo; la mayoría cambia el elemento, otras la forma (abanico, rebote, cadena,
cargas...). Un "modo libre" quita la restricción de categoría y no deja repetir hechizos (intercambia ranuras).
El catálogo y las reglas de la barra viven en `grimorio.ts`, sin Three.js ni DOM, con pruebas.
**Motivo:** lo pidió Luis tomando como referencia el sistema de habilidades y runas de los ARPG clásicos. Los nombres y
efectos son propios. Cambiar el elemento con la runa es lo que hace que cada build abra combos distintos.
**Estado:** prototipo en el cliente (`sandbox-mago.html`); los números son iniciales. En el juego real la build se elegiría
en el Hub o entre salas, y el lanzamiento pasaría a la simulación compartida.

## D-15 · Combos elementales por estados
**Decisión:** cada golpe aplica un estado (quemado, frío acumulado hasta congelar, electrizado, empapado, marca arcana) y
el elemento siguiente reacciona con lo que ya tiene el objetivo (tabla en `reacciones.ts` y en el README). Cada combo
tiene una espera de 0,45 s por objetivo y los golpes que nacen de un combo aplican estados sin provocar combos nuevos.
**Motivo:** reglas pocas y legibles que premian combinar runas. La espera evita que un rayo continuo dispare diez combos
por segundo y la regla de los golpes derivados corta las cadenas infinitas.

## D-16 · Astillado progresivo y convexos válidos para cannon-es
**Decisión:** los objetos de piedra pierden una lasca por golpe fuerte (corte plano orientado al impacto, a una profundidad
que crece con el daño) y el resto sigue en pie con su forma nueva hasta quedarse por debajo del 35% del volumen.
Las formas se guardan en las coordenadas del objeto original para que la textura no salte al astillar.
`casco()` quita los vértices que pertenecen a menos de 3 caras y rota cada cara para que sus tres primeros vértices den una
normal fiable; `validoParaCannon()` lo comprueba y, si algún trozo no cumple, colisiona como una caja.
**Motivo:** cannon-es supone que cada cara de n lados tiene n caras vecinas y calcula la normal con los tres primeros
vértices; tras muchos cortes aparecían caras que lo incumplían y el solver se rompía (detectado al probar la Implosión
contra los cristales). Hay una prueba con más de 3000 trozos.

## D-17 · Música procedural con Web Audio, sin ficheros
**Decisión:** la música se compone y sintetiza en el navegador (`packages/client/src/audio/`). Cada página tiene su tema
(«Sala de pruebas», «Cripta de los cinco», «Carga del guerrero», «Biblioteca en ruinas»): una progresión de acordes en forma
AABA y capas (dron, pads, bajo, ostinatos, percusión, melodía generada en frases A A' B A con cadencia, campanas, coro).
`partitura.ts` es puro y determinista; `instrumentos.ts` sintetiza cada voz con osciladores, filtros y ruido; `musica.ts`
programa compases enteros por adelantado, con reverberación de cripta, eco y un paso bajo final que da el sonido apagado
de las consolas de los 90. Cada capa tiene un umbral de intensidad y `Fragor` traduce el combate (enemigos cerca, golpes,
muertes, combos, vida baja) a esa intensidad: con el combate entran tambores, metales y coro, y se van despacio al acabar.
El grimorio abierto amortigua la música y cada combo del mago suena con una floritura. Botón abajo a la izquierda y tecla
U para silenciar; volumen y silencio se guardan en el navegador. Empieza con el primer clic o tecla (los navegadores no dejan
sonar antes) y se suspende con la pestaña oculta.
**Motivo:** lo pidió Luis. Sin ficheros no hay licencias que revisar ni descargas (unos 10 kB comprimidos), encaja con la
estética PS1 y la música puede reaccionar al combate capa a capa, cosa difícil con pistas grabadas.
**Estado:** primera versión. La mezcla se equilibró midiendo cada capa renderizada sin altavoces (picos entre -7 y -11 dBFS,
sin recortes, con el volumen por defecto). Si más adelante se quieren pistas grabadas, el control y `Fragor` sirven igual.

