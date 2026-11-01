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
