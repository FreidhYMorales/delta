# Estado: mejoras a "Organizar" (auto-layout del diagrama)

Rama: `wip/organizar-layout` (commit `8b708cd`) — aislada de `master` a
propósito, sin mergear ni pushear, para no arrastrar un problema sin resolver
(ver más abajo) al resto del proyecto mientras sigue en desarrollo. Este
documento es el mapa de qué está hecho, qué falta y por dónde seguir — el
detalle técnico completo de cada decisión (el porqué, cómo se verificó cada
una) ya está en `docs/decisions.md`, entradas del `2026-09-01`.

## Qué quedó resuelto en este checkpoint

1. **Barycenter sweep** (`layeredLayout`, `frontend/src/views/diagram/geometry.js`):
   las ramas paralelas que comparten columna (por ejemplo, un par de estados
   con ida y vuelta) se alinean entre sí por barrido de barycenter/mediana
   (estilo Sugiyama, igual que Graphviz `dot`), en vez de quedar apiladas en
   el orden en que se crearon.
2. **Ruteo por nodos fantasma**: una arista que salta 2 o más columnas
   (un atajo directo) ya no se dibuja como línea recta sobre lo que haya en
   el medio — se parte en una cadena de waypoints invisibles, uno por
   columna intermedia, que participan del mismo barrido de barycenter que
   los estados reales. Así consigue su propio carril (`edgeSpacing`, 28)
   separado del espaciado entre estados reales (`rowSpacing`, 90).
3. **Curva suave** (spline Catmull-Rom recortado) en vez de quiebres en cada
   waypoint del ruteo, para que lea como una curva continua igual que los
   pares bidireccionales existentes — con un `labelGap` más grande (20, contra
   12 del resto) para la etiqueta de esas aristas específicas.
4. **`fitToWindow`** ahora ajusta el bbox ajustado de los estados al aspect
   ratio real del panel del diagrama antes de fijar el `viewBox` — arreglaba
   un arrastre que se sentía mucho más lento en un eje que en el otro,
   específicamente después de usar Organizar (que produce diagramas anchos y
   bajos).
5. **Arrastrar un estado** ya no reconstruye el SVG entero en cada
   `mousemove` — solo actualiza el estado que se mueve y las aristas que lo
   tocan.

Suite completa de frontend al momento de este checkpoint: **1153/1153**
(91 archivos).

## Por qué se pausó — lo que falta

Las etiquetas de transición (labels) todavía pueden superponerse entre sí en
autómatas más grandes. Separar más las líneas/carriles (aumentar
`edgeSpacing`/`rowSpacing`) **no alcanza por sí solo**: el problema real es
que cada etiqueta se posiciona con un offset fijo respecto a SU PROPIA
arista, sin ningún conocimiento de qué otra etiqueta tiene cerca. Aumentar el
`labelGap` de las aristas ruteadas (ya hecho, punto 3 arriba) ayuda a reducir
la frecuencia, pero no es una solución real — dos etiquetas de aristas
totalmente independientes pueden seguir cayendo en el mismo punto.

## Por dónde seguir

Esto es un problema de layout distinto del ruteo de líneas que ya está
resuelto — la literatura lo llama **label placement** / evitar solapamiento
de etiquetas. Términos para investigar antes de tocar código (no
re-investigar el ruteo de líneas, eso ya está hecho y andando):

- "graph drawing label placement" / "map labeling algorithm"
- "force-directed label overlap removal" — tratar cada etiqueta como un nodo
  más que se repele de las otras etiquetas y de las líneas/estados cercanos,
  en una pasada posterior al layout de líneas (no reemplaza el barycenter
  sweep, se suma después)
- Cómo lo resuelven en la práctica Graphviz (`xlabel`, `decorate`) o D3
  (`d3-labeler`), no solo en el paper — buscar la implementación real, no
  solo la idea

## Cómo retomarlo

```
git checkout wip/organizar-layout
```

La rama arranca desde `79691c7` (`chore(release): bump version to 0.2.3`) en
`master` y es autocontenida — no depende de nada que haya cambiado en
`master` después de ese punto. Antes de mergear, correr la suite completa de
nuevo (`npm test -- --run` en `frontend/`) para confirmar que sigue en verde,
y probar en vivo con un autómata grande para juzgar si el label placement
nuevo (si se llega a implementar) resuelve el problema reportado.
