# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado [semver](https://semver.org/lang/es/).

## [0.3.0] — 2026-11-04

### Agregado

- Pestaña "Gramática" para gramáticas generales G = {Σ, N, S, P}, con
  clasificación de Chomsky, notación BNF/EBNF, derivaciones paso a paso y
  árbol de derivación, y búsqueda de cadenas por lote. La pestaña
  "Gramática regular" del editor de autómata finito se mantiene.
- Conversión "ER → AFD" por el método directo (árbol aumentado, anulables,
  primeros/últimos, siguientes y tabla de estados), paso a paso y con
  creación del AFD en una pestaña nueva.
- Conversión "AFN-ε → AFD" paso a paso, y piezas de Thompson prearmadas
  para insertar en el diagrama.
- PDA: símbolo inicial de pila editable (Z0), cadenas de pila sin
  separadores, λ/ε como vacío, palabras sin espacios y tabla de pasos
  copiable con su fila de resultado.
- Máquinas de Turing: palabras sin espacios usando el alfabeto y B como
  blanco.
- "Organizar" ahora alinea las ramas paralelas entre sí (un par que se
  bifurca y vuelve a juntarse, un ciclo con vuelta atrás) en vez de
  apilarlas en el orden en que se crearon — se ven más parejas, más
  parecidas a como se dibuja un autómata a mano.
- Las transiciones que "saltan" varias columnas (un atajo directo) ahora
  se dibujan por su propio carril, como una curva suave, en vez de una
  línea recta con quiebres que puede pasar por encima de otros estados y
  transiciones — en autómatas grandes esto evitaba distinguir cuál línea
  era cuál cuando varias se superponían.

### Cambiado

- Las expresiones regulares usan la notación de la cátedra: `|` es unión,
  `+` es cerradura positiva (una o más), `?` es opcional, `*` es la
  estrella de Kleene y la yuxtaposición concatena. Antes `+` significaba
  unión, así que una regex guardada como `a+b` ahora se lee "una o más
  `a`, luego `b`".

### Corregido

- Arrastrar un estado con la herramienta de selección se sentía trabado en
  autómatas con varios estados/transiciones — cada movimiento del mouse
  redibujaba el diagrama entero en vez de solo el estado que se estaba
  moviendo.
- Después de "Organizar", arrastrar un estado en vertical se sentía mucho
  más lento que en horizontal — el ajuste automático de zoom no
  respetaba la proporción real del panel del diagrama, dejando un margen
  invisible en un eje que el arrastre no tenía en cuenta.

## [0.2.3] — 2026-08-31

### Corregido

- Los atajos de teclado a nivel de proyecto (Ctrl+N/O/S/Shift+S/W) no
  disparaban nada — solo funcionaban al hacer clic en el menú Archivo. El
  despachador de teclado del diagrama solo miraba el registro de acciones
  de herramienta/estado, nunca el de proyecto.
- Cerrar una pestaña o la ventana tras elegir "Descartar" en el diálogo de
  cambios sin guardar no cerraba nada — faltaba el permiso
  `core:window:allow-destroy` en las capabilities de Tauri, y el rechazo
  de la promesa solo se veía en la consola de WebKitGTK, nunca en la
  terminal de `tauri dev`.

## [0.2.2] — 2026-08-27

### Agregado

- Auto-actualización (`tauri-plugin-updater` + `tauri-plugin-process`): al
  arrancar, la app chequea en silencio si hay una release nueva publicada en
  GitHub y, si la hay, pregunta antes de descargar, instalar y reiniciar.
  Los builds de `release.yml` ahora se firman con una clave dedicada
  (secrets `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD`) y ya no se marcan como
  "Pre-release" — el updater necesita que GitHub reconozca una release como
  "Latest" para poder resolverla.
- "Organizar" ahora acomoda los estados en fila horizontal, de izquierda a
  derecha según su distancia al estado inicial, en vez de un layout de
  resorte que terminaba en un amontonamiento cruzado — un ciclo se detecta
  y se excluye solo del cálculo de columnas, sin afectar cómo se dibuja.

### Corregido

- Dejar el campo de símbolo en blanco (o escribir "epsilon"/"ε") al crear
  una transición ahora sí genera una transición épsilon real — antes se
  perdía el pedido (se trataba como un prompt cancelado) o quedaba
  interpretado como un símbolo literal "ε" del alfabeto, produciendo una
  transición que se veía bien pero nunca disparaba en la simulación.
- "Nuevo proyecto" ya abre una pestaña — antes dejaba la pantalla en
  blanco y sin pestañas, dando la sensación de que la acción no hacía
  nada.

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

[0.3.0]: https://github.com/FreidhYMorales/delta/releases/tag/v0.3.0
[0.2.3]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.3
[0.2.2]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.2
[0.2.1]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.1
[0.2.0]: https://github.com/FreidhYMorales/delta/releases/tag/v0.2.0
[0.1.0]: https://github.com/FreidhYMorales/delta/releases/tag/v0.1.0
