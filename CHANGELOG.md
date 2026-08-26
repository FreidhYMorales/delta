# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado [semver](https://semver.org/lang/es/).

## [Sin publicar]

## [0.2.1] — 2026-08-26

### Agregado

- CI (`ci.yml`) corriendo `cargo test --workspace` y `npm test` en cada
  push/PR a `master` — antes solo `release.yml`, disparado por tag.
- La confirmación de cambios sin guardar ahora también cubre cerrar una
  pestaña individual (botón `×`, `Ctrl+W`) y salir de la app (cerrar la
  ventana) — antes solo protegía "Nuevo proyecto"/"Abrir proyecto".

### Corregido

- Las acciones de proyecto (Abrir/Guardar/Guardar como/Recientes/Nueva
  pestaña/Renombrar pestaña) ahora muestran un aviso visible cuando fallan
  (archivo borrado, nombre duplicado, etc.) — antes fallaban en silencio,
  sin ningún indicio para el usuario.
- Cambiar de pestaña ahora le da foco al diagrama — antes había que hacer
  clic en el canvas una vez antes de que los atajos de teclado (V/S/T/D,
  Ctrl+Z, etc.) respondieran.

## [0.2.0] — 2026-08-26

### Agregado

- **Proyectos multi-pestaña**: varios autómatas abiertos a la vez, de
  cualquier combinación de los 5 tipos, guardables/abribles como un solo
  archivo de proyecto.
- Reordenar pestañas arrastrándolas; cinta de pestañas con scroll y
  botones de navegación en vez de achicar los nombres cuando hay muchas.
- "Guardar como…" (`Ctrl+Shift+S`), separado de "Guardar" — este último ya
  no pregunta la ruta cada vez, reutiliza la del proyecto actual.
- Confirmación de cambios sin guardar (Guardar/Descartar/Cancelar) antes
  de crear un proyecto nuevo o abrir otro, para no perder trabajo en curso.
- Conversión de nombres griegos a su símbolo: escribir "delta" como nombre
  de estado o símbolo de transición/alfabeto lo convierte a "δ" (y así con
  las 24 letras griegas). La Definición formal también muestra los glifos
  reales (Σ, δ, Δ, λ, Γ, ε) en vez de las palabras en ASCII.
- Script `scripts/build-macos.sh` para compilar Delta localmente en macOS
  cuando el `.dmg` sin firmar queda bloqueado por Gatekeeper.

### Corregido

- Abrir o crear un proyecto nuevo a veces dejaba la primera pestaña vacía
  con el autómata de la pestaña reemplazada — el asignador de ids de
  pestaña se reiniciaba en cada reset, chocando con vistas ya montadas.
- El indicador de "cambios sin guardar" nunca se activaba con ediciones
  reales (agregar un estado, una transición, etc.), solo con crear/cerrar/
  renombrar pestañas — la revisión de cada documento nunca llegaba a
  informarle al proyecto.
- El diagrama y el panel lateral no encajaban en la ventana tras el cambio
  a proyectos multi-pestaña (scroll de página completa en vez de ajustarse
  al alto disponible).

## [0.1.0] — 2026-08-24

Primera versión compartida como "Delta" (antes sin nombre propio, bajo
desarrollo directo sobre el repo). Los 5 editores ya estaban completos en
esta versión:

- Autómatas finitos (AFD/AFN, ε-transiciones), con conversión AFN→AFD,
  minimización de AFD, y conversión hacia/desde gramática regular y
  expresión regular.
- Máquinas de Mealy y de Moore.
- Autómatas de pila (PDA).
- Máquinas de Turing multi-cinta.

Cada uno con sus propias vistas sincronizadas (Diagrama, Tabla de estados,
Definición formal, Verificación de cadenas), undo/redo transaccional,
persistencia en JSON, e interoperabilidad de importación/exportación con
el formato `.jff` de JFLAP.

[0.2.1]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.1
[0.2.0]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.0
[0.1.0]: https://github.com/FreidhYMorales/delta/releases/tag/v0.1.0
