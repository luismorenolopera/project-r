# Mazmorra Co-op

Dungeon crawler cooperativo de acción en navegador con estética 3D retro estilo PS1.
Este repositorio sigue el *Plan Maestro de Diseño y Arquitectura* del equipo.

**Estado actual:** sandbox de combate local (sin conexión). Se pueden probar las 5 clases,
sus habilidades, enemigos con ataques telegrafiados, combos y frenesí, empujes contra muros y
sinergias elementales entre clases. La red (Colyseus + Geckos.io) y la persistencia (Supabase)
llegan en los hitos siguientes; ver [`docs/HITOS.md`](docs/HITOS.md).

## Requisitos

- Node.js 22 o superior
- pnpm 10 (`corepack enable` lo instala)

## Instalar

```bash
pnpm install
```

## Ejecutar el sandbox

```bash
pnpm dev          # http://localhost:5173
```

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
| Esc | Soltar el ratón y usar el panel lateral |

## Prototipo: embestida con físicas

```bash
pnpm dev          # http://localhost:5173/prototipo-embestida.html
```

Prueba aislada del guerrero: la embestida (7 m en 0,3 s hacia el cursor) empuja a los enemigos según su masa y rompe
cajas, barriles, urnas y lápidas. Cada objeto es un poliedro convexo que, al romperse, se corta con planos aleatorios
cerca del impacto (`packages/client/src/prototipos/embestida/fractura.ts`); cada trozo es un `ConvexPolyhedron`
de cannon-es. Un enemigo despedido contra un muro, pilar o sarcófago queda aturdido, y si choca con un objeto lo rompe.

| Tecla | Acción |
| --- | --- |
| WASD | Moverse |
| Clic / Espacio / Shift | Embestida hacia el cursor |
| 1 2 3 4 | Caja, barril, urna, lápida en el cursor |
| 5 6 | Esqueleto, bruto en el cursor |
| T · P · R | Cámara lenta · los enemigos persiguen · reiniciar |

## Probar

```bash
pnpm test         # pruebas de la simulación (Vitest)
pnpm typecheck    # comprobación de tipos de todos los paquetes
```

## Compilar y desplegar

```bash
pnpm build        # genera packages/client/dist (estático)
```

El sandbox es un sitio estático: `packages/client/dist` se puede servir desde cualquier hosting
de ficheros estáticos (las rutas son relativas). El despliegue del servidor autoritativo llegará
con el Hito 0 de red.

## Estructura

```
packages/
  shared/   núcleo de simulación compartido cliente/servidor: ECS (bitECS), clases, enemigos,
            colisiones deterministas, sinergias. Sin dependencias de navegador.
  client/   cliente Vite + Three.js (shaders PS1) + cannon-es (ragdolls y cámara).
docs/       DECISIONES.md (decisiones propias y su motivo) y HITOS.md (avance).
```

Variables de entorno: ver [`.env.example`](.env.example). El sandbox no necesita ninguna.
