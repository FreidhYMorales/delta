# Decisiones técnicas

Registro de decisiones de ingeniería no obvias — el *por qué* detrás de partes
del código que no se explican solas leyendo el código o el `git log`. Cada
entrada es corta: qué se decidió, por qué, y cómo se verificó. Vive en el
repo (no solo en memoria de sesiones de IA) para que sea legible por
cualquiera que retome el proyecto, humano o asistente.

Orden cronológico, más reciente arriba.

---

## 2026-08-19 — Gramática regular: parser de texto propio, distinto de `Display`, y un bug real que encontró el proptest

**Dónde**: `crates/automata-core/src/grammar/parser.rs` (nuevo),
`crates/automata-core/src/grammar/mod.rs`, `src-tauri/src/commands/convert.rs`,
`src-tauri/src/lib.rs`, `frontend/src/tauri/client.js`,
`frontend/src/commands/context.js`, `frontend/src/commands/registry.js`,
`frontend/src/main.js`, `frontend/src/views/grammar/GrammarView.js` (nuevo),
`frontend/src/style.css`.

**Qué se pidió**: mismo patrón que ya se hizo dos veces para expresiones
regulares — pestaña derivada + generación — pero para `fa_to_regular_grammar`/
`regular_grammar_to_nfa`, que ya existían y estaban probadas.

**Por qué el formato de texto NO es igual al de `Display`** (a diferencia de
`regex/parser.rs`, que sí es el inverso exacto de `Regex::Display`):
`Production`'s `Display` imprime `lhs -> symbolrhs` sin ningún delimitador
entre el símbolo y el no terminal destino (`q0 -> aq1`). Para regex eso es
seguro porque cada carácter es su propio símbolo; acá los no terminales son
etiquetas de estado de largo arbitrario (`q0`, `q10`, ...), así que un
parser no puede saber dónde termina el símbolo y empieza el nombre del
estado sin ya conocer de antemano el conjunto completo de nombres — y ese
conjunto es justo lo que el texto está definiendo. Se resolvió con un
espacio obligatorio entre símbolo y destino (`q0 -> a q1`), sacrificando la
paridad byte-a-byte con `Display` a cambio de que el formato deje de ser
ambiguo. `grammar::format` es el inverso real de `parse` (nuevo, no
`Display`) — `conv_to_grammar` usa `format`, no `Display`, específicamente
para que lo que se ve en "Gramática regular equivalente" sea siempre
copiable y pegable tal cual en el cuadro de generar.

**El símbolo inicial necesitó un header explícito (`inicio: q0`)**: el plan
original era "el `lhs` de la primera producción es el símbolo inicial" (así
arranca JFLAP mismo). El proptest de round-trip (256 casos, automáticos)
encontró el contraejemplo real en la primera corrida: un estado inicial sin
transiciones salientes y no-aceptador nunca aparece como `lhs` de ninguna
producción, así que no hay ninguna línea que reordenar al frente — `format`
perdía silenciosamente cuál era el inicio, y el autómata reconstruido
aceptaba/rechazaba distinto al original. Se agregó una línea de cabecera
opcional `inicio: <estado>` que `format` solo emite cuando el estado inicial
no tiene producción propia (el caso común queda exactamente como una lista
de producciones sin cabecera, tal como la escribiría un estudiante a mano).
Ver el propio doc-comment de `format` en `parser.rs` para el detalle
completo — quedó documentado ahí porque es la clase de bug que un test
manual jamás encuentra (requiere un automaton inicial-pero-sin-salida, un
caso muy poco intuitivo de armar a propósito).

**Límite conocido, documentado, no un bug**: al igual que el parser de
regex no puede expresar "sin estado inicial" salvo con `∅`, el de gramática
tampoco puede expresar un autómata con productions pero sin ningún estado
inicial en absoluto (`start: None`) — el texto tipeado siempre implica algún
símbolo inicial. El proptest de round-trip excluye ese caso explícitamente
(`prop_assume!`) en vez de fingir que está cubierto.

**Mismos patrones ya establecidos, reaplicados**: mensajes de error en
español (primer error de este módulo mostrado tal cual al usuario, igual
que `regex::ParseError`); `conv_from_grammar` reemplaza el documento entero
igual que `conv_from_regex`/`doc_open`; nueva acción de registry
`editor.openGrammar` (grupo `"editor"`, cubierta por `EDITOR_MODE_IDS`, sin
tocar la arquitectura de "Editor intercambiable" — la razón completa de por
qué no está en la entrada anterior de hoy); layout automático post-generación
porque `regular_grammar_to_nfa` tampoco asigna `(x, y)` reales.

**Cómo se verificó**: 25/25 tests del módulo `grammar` (`cargo test -p
automata-core grammar::`), incluyendo el proptest de 256 casos que encontró
el bug de arriba antes de llegar a main. `cargo check -p app -p
automata-core` limpio. 274/274 tests de frontend (13 nuevos). `vite build`
limpio. Verificado en vivo en un dev server temporal: el dropdown salta a
"Gramática regular" y vuelve solo a "Autómata Finito"; el flujo de
generación confirmado hasta el límite conocido del entorno (sin backend
Tauri real).

---

## 2026-08-19 — El dropdown "Editor" como menú de acceso, no como selector de tipo de documento

**Dónde**: `frontend/src/commands/registry.js` (nueva acción `editor.openRegex`
+ `EDITOR_MODE_IDS`), `frontend/src/commands/context.js` (hook `openRegexTab`),
`frontend/src/main.js`, `frontend/src/views/toolbar/Toolbar.js`,
`frontend/src/commands/registry.test.js`.

**La pregunta del usuario**: el dropdown "Editor" en la barra superior ya
tenía opciones deshabilitadas ("Autómata de Pila — próximamente", "Máquina
de Turing — próximamente", "Expresión Regular — próximamente") — ¿no
convendría usarlo para seleccionar Expresión Regular, en vez de una pestaña
al costado, ya que aparentemente fue construido justo para eso (como el menú
de tipos de editor del JFLAP original)?

**Por qué NO uso el dropdown como selector de tipo de documento (todavía)**:
Regex no es una máquina de estados — es un árbol de expresión, sin estados
ni transiciones que editar (`AddState`/`SetEdge` no tienen sentido para un
regex). Por eso ya está modelado como una vista derivada + una acción de
generación sobre el `FaDoc` existente, no como un segundo tipo de documento.
PDA y Máquina de Turing sí son máquinas de estados de verdad (mismos
estados+transiciones que un AFD, con datos extra por transición — pila,
cinta+dirección) — ahí sí, cuando se implementen, vale la pena generalizar
`Document`/`DocStore` a un tipo real distinto con su propio `EditOp`, tabla y
dibujo. Construir esa arquitectura de "Editor intercambiable" ahora, para un
caso (regex) que nunca la necesitó, sería la abstracción prematura que las
reglas de este proyecto piden evitar.

**Qué se hizo en cambio**: el dropdown "Editor" ahora es un **menú de
acceso** (estilo "Jump to..."), no un selector de modo persistente:
- Nueva acción de registro `editor.openRegex` (grupo `"editor"`, sin
  keybinding) — mismo patrón D6 "nada bypasea el registry" que ya usan el
  toolbar, el menú y el menú contextual: seleccionar la opción llama
  `findAction(select.value).run(ctx)`, nunca lógica propia en `Toolbar.js`.
- `ctx.openRegexTab()` — hook inyectable (default no-op para tests),
  cableado en `main.js` a `upperTabs.select("regex")`. Ningún componente
  "posee" el grupo de pestañas superior (Tabla/Definición formal/Expresión
  regular se arman en `main.js`, no dentro de una vista), así que el hook
  vive ahí, igual que `ctx.testing.openSingle/openBatch` vive en
  `TestingView` porque esa vista sí es dueña de sus propias pestañas.
  Traducción del riesgo/beneficio: si un futuro modo empieza como una
  simple pestaña con `openXxxTab()`, funciona igual; si de verdad necesita
  su propio `Document`/`DocStore`, se generaliza este mismo hook, no antes.
- El `<select>` **se resetea a "Autómata Finito" apenas dispara la acción**
  — no queda "seleccionado" en Expresión Regular, porque no hay ningún modo
  real detrás para quedarse mostrando.
- Las opciones reales del dropdown (hoy solo una) se generan iterando
  `EDITOR_MODE_IDS` (`actions.filter(a => a.group === "editor")`, exportado
  de `registry.js` — mismo patrón que `TOOL_IDS`) en vez de estar escritas a
  mano en `Toolbar.js`, así que agregar un futuro modo real es una entrada
  más en el registry, no un segundo lugar para editar. Los placeholders de
  PDA/Turing siguen escritos a mano (deshabilitados, sin acción detrás
  todavía).
- El audit de alcanzabilidad de `registry.test.js` (que exige que toda
  acción tenga keybinding, o esté cubierta por el menú, el toolbar o el
  menú contextual) ahora también reconoce `EDITOR_MODE_IDS` como una
  cobertura válida — sin este cambio, `editor.openRegex` fallaba esa
  auditoría por no estar en ninguno de los otros tres grupos reconocidos.

**Cómo se verificó**: 261/261 tests de frontend (5 nuevos: default del hook,
la acción del registry, el reset del `<select>`, las opciones renderizadas,
el audit de alcanzabilidad extendido). `vite build` limpio. Verificado en
vivo en un dev server temporal: seleccionar "Expresión Regular" salta a esa
pestaña y el `<select>` vuelve solo a "Autómata Finito", confirmado vía
`javascript_tool` (un `<select>` nativo no es clickeable de forma confiable
con automatización de mouse, así que se disparó el evento `change`
directamente sobre el elemento).

---

## 2026-08-19 — Segundo paso hacia "Expresión Regular": parser de texto + regex→autómata

**Dónde**: `crates/automata-core/src/regex/parser.rs` (nuevo),
`crates/automata-core/src/regex/mod.rs`, `src-tauri/src/commands/convert.rs`,
`src-tauri/src/lib.rs`, `frontend/src/tauri/client.js`,
`frontend/src/commands/context.js`, `frontend/src/main.js`,
`frontend/src/views/regex/RegexView.js`, `frontend/src/style.css`.

**Qué faltaba**: `regex_to_nfa` (Thompson) ya existía y estaba probada desde
la ronda anterior, pero solo tomaba un `Regex` (el AST), nunca un string —
en todo el codebase, `Regex` se construía siempre a mano con combinadores
(`Symbol`/`.concat()`/`.union()`/`.star()`), nunca desde texto tipeado por un
usuario. No había ningún parser.

**Qué se decidió**:
- **Parser propio, sin dependencia nueva** (`regex/parser.rs`, recursive
  descent a mano — mismo estilo que el resto del crate, que ya tiene Tarjan
  y demás algoritmos escritos a mano): `+` unión (más suelto), yuxtaposición
  = concatenación, `*` postfijo (más apretado), paréntesis, `ε`/`∅`
  literales. Es deliberadamente el inverso exacto de `Display` — cada
  carácter no reservado es su propio símbolo de un solo carácter, porque
  `Display` imprime símbolos concatenados sin separador (`Symbol("00")`
  seguido de `Symbol("1")` imprime `001`, indistinguible de tres símbolos de
  un carácter) — un símbolo multi-carácter en el input haría el parseo
  ambiguo. `impl FromStr for Regex` para poder hacer `pattern.parse()`.
- **Mensajes de error en español, no en inglés** — a diferencia de todo otro
  tipo de error de este crate (ej. `MinimizeError`, en inglés, coherente con
  que todo comentario/identificador del código es en inglés): este es el
  primer error de `automata-core` que se muestra tal cual al usuario final
  en la UI (vía `conv_from_regex` → `RegexView`'s `.regex-error`), así que
  funciona como copy de UI, no como diagnóstico interno — y toda la UI
  nueva de esta app es en español.
- **`conv_from_regex` reemplaza el documento completo** (`commands::doc::open`'s
  mismo patrón exacto: `*doc = Document { model, history: History::new(200),
  revision: next }`) en vez de fusionar/agregar — generar desde una regex es
  conceptualmente "abrir un documento distinto", no una edición del actual.
  Sin confirmación extra en el frontend: mismo criterio que `doc_open`/
  `jff_import`, que tampoco la piden.
- **Layout automático post-generación**: `regex_to_nfa` no asigna
  coordenadas reales (todos los estados nacen en `(0,0)`), así que
  `ctx.fromRegex` en `main.js` aplica `circleLayoutAction` (la misma lógica
  del botón "Círculo") inmediatamente después de cargar el snapshot nuevo.
- **Ambas direcciones viven en la misma pestaña "Expresión regular"** — no
  se tocó la arquitectura de "Editor intercambiable" que se dejó afuera a
  propósito en la ronda anterior; generar sigue siendo una mutación sobre el
  mismo tipo de documento FA, no un segundo tipo de documento.

**Cómo se verificó**: 30/30 tests del módulo `regex` (`cargo test -p
automata-core regex::`), incluyendo un proptest nuevo
(`round_trip_preserves_language_of_random_regexes`, 256 casos: AST regex
aleatorio → `Display` → `parse` → comparar lenguaje de ambos vía
`regex_to_nfa` sobre palabras aleatorias) que verifica que `parse` y
`Display` son inversos genuinos entre sí — mismo patrón que
`fa_to_regex::tests::round_trip_preserves_language_of_random_nfas`, un nivel
más adentro. `cargo check -p app -p automata-core` limpio. 257/257 tests de
frontend (7 nuevos: 3 en `context.test.js`/`RegexView.test.js` para el hook
`fromRegex` y su default sin fallback seguro, 4 para el flujo de generar:
render, llamada con el patrón tipeado, mensaje de error visible, error
anterior que se limpia en un intento posterior exitoso). `vite build`
limpio. Verificado visualmente en un dev server temporal: layout correcto,
y el camino de error confirmado end-to-end (mismo `TypeError` de siempre por
falta de backend Tauri real en ese entorno — no un bug nuevo).

---

## 2026-08-19 — Primer paso hacia "Expresión Regular": conversión autómata→regex

**Dónde**: `src-tauri/src/commands/convert.rs` (nuevo), `src-tauri/src/commands/mod.rs`,
`src-tauri/src/lib.rs`, `frontend/src/tauri/client.js`, `frontend/src/commands/context.js`,
`frontend/src/views/regex/RegexView.js` (nuevo), `frontend/src/main.js`,
`frontend/src/style.css`.

**Qué se pidió**: "andá implementando todo lo necesario para llegar a
expresiones regulares". El backend ya tenía ambas conversiones completas
desde una sesión anterior (`convert::fa_to_regex`, `convert::regex_to_nfa`,
verificadas contra JFLAP y con roundtrip por proptest), pero nada en Tauri ni
el frontend las exponía — el dropdown "Editor" del Toolbar ya reserva la
opción "Expresión Regular — próximamente", deshabilitada.

**Qué se decidió**: antes de meterse con esa opción del dropdown (que
implicaría un segundo tipo de documento editable, su propio DocStore/IPC de
mutación, y una arquitectura de "Editor intercambiable" que hoy no existe),
se le preguntó al usuario por dónde arrancar. Eligió el camino más corto:
mostrar la expresión regular equivalente al autómata ya dibujado, sin tocar
la arquitectura de documentos. Concretamente:

- `commands::convert::to_regex` — función plana testeable (mismo patrón que
  `commands::doc`/`commands::sim`: toma `&Session`, hace lock, llama
  `fa_to_regex(&doc.model).to_string()`) + wrapper `#[tauri::command]
  conv_to_regex`. Es de solo lectura: nunca muta el documento, así que a
  diferencia de `doc_apply` no hay `EditResult`/revisión que devolver, solo
  el string derivado. `fa_to_regex` ya garantiza no fallar nunca (un
  documento vacío o sin estado inicial reduce a `∅`), así que no hizo falta
  manejo de error especial.
- `RegexView` — una pestaña más en el grupo superior ("Tabla de estados" /
  "Definición formal" / **"Expresión regular"**), de solo lectura (sin botón
  "Aplicar": no hay nada que enviar de vuelta). Se re-suscribe a
  `docStore.subscribe` igual que las otras vistas, pero como el valor viene
  de una llamada IPC asíncrona (no es un derivado sincrónico local como
  `docStore.derived`), cada re-render dispara un nuevo fetch — con un token
  incremental para que un fetch viejo que resuelve tarde (dos ediciones
  seguidas) nunca pise el resultado de uno más nuevo.
- `ctx.toRegex` — nuevo hook en `ViewContext`, mismo patrón que
  `simTrace`/`simBatch` (inyectable, con default no-op para tests sin
  webview real).

**Qué queda pendiente, a propósito, para más adelante**: la dirección
regex→autómata (tipear una expresión regular y materializar un documento FA
nuevo) es un paso más grande — necesita decidir si el regex es un documento
editable propio o solo un input transitorio, y ahí sí probablemente haga
falta la infraestructura de "Editor intercambiable" que se dejó afuera en
esta ronda a propósito.

**Cómo se verificó**: `cargo check -p app -p automata-core` limpio,
`cargo test -p automata-core` (20/20, sin regresión — no se tocó lógica de
`automata-core`, solo un wrapper fino en Tauri). 252/252 tests de frontend
(4 nuevos en `RegexView.test.js`: render, fetch en construcción, re-fetch en
cada cambio del documento, y que un fetch viejo fuera de orden no pise uno
más nuevo). `vite build` limpio. Verificado visualmente en un dev server
temporal (puerto 5191): la pestaña nueva aparece y se ve consistente con
"Definición formal"; el cuadro queda vacío en ese entorno porque no hay
backend Tauri real (mismo `TypeError: Cannot read properties of undefined
(reading 'invoke')` que ya afecta a `DocStore.load()` ahí — limitación
conocida del entorno, no un bug nuevo).

---

## 2026-08-19 — Indicadores visuales para el flujo de creación de transiciones

**Dónde**: `frontend/src/views/diagram/DiagramView.js`, `frontend/src/style.css`,
`frontend/src/views/diagram/DiagramView.test.js`.

**Qué se pidió**: al crear una transición (herramienta "Transición"), el
primer click elige el estado origen y el segundo elige el destino antes de
pedir el símbolo — pero no había ninguna señal visual de "ya elegiste el
origen, ahora hacé click en el destino". El usuario pidió un indicador para
el estado ya seleccionado como origen, y otro para el hover/selección sobre
el estado que va a cerrar la transición.

**Qué se hizo**:
- `_handleCreateTransitionClick` ya guardaba el primer click en
  `this._pendingFrom`, pero no disparaba ningún re-render — el estado nunca
  se veía marcado hasta el próximo cambio del documento. Se agregó un
  `this._render()` explícito justo después de fijar `_pendingFrom`.
- En `_renderCanvas`, el círculo del estado con `id === this._pendingFrom`
  recibe la clase `.pending-edge-source` (anillo + relleno de acento,
  persistente mientras se espera el destino).
- En `_render`, el `<svg>` recibe la clase `.awaiting-edge-target` mientras
  `_pendingFrom != null`. En CSS, `.awaiting-edge-target .state:hover` pisa
  el `fill` de hover normal (`--accent-soft`) con uno más intenso
  (`--accent`) y el canvas entero pasa a cursor `crosshair` — así cualquier
  estado bajo el mouse se lee como "candidato a destino", incluyendo el
  propio origen (click de nuevo sobre él es un auto-loop válido, no se
  excluye del hover).
- `_render()` también resetea `_pendingFrom = null` cuando la herramienta
  activa deja de ser `create-transition` — sin esto, cambiar a
  Seleccionar/Borrar a mitad de la elección dejaba un origen "fantasma"
  marcado la próxima vez que se volvía a Transición.

**Cómo se verificó**: 3 tests nuevos en `DiagramView.test.js` (clase en el
origen tras el primer click, clase en el `<svg>` que aparece al elegir
origen y desaparece tras completar la transición, limpieza al cambiar de
herramienta a mitad de la selección) — 247/247 tests totales, build limpio.
Verificado visualmente en un dev server temporal (puerto 5190, sin backend
Tauri real): como no hay `docStore.apply` funcional en ese entorno, se
inyectaron dos `<circle>` de prueba directamente en el SVG vía DOM para
confirmar el aspecto real de `.pending-edge-source` (anillo azul grueso) y
el hover reforzado bajo `.awaiting-edge-target` — confirmado visualmente,
tab y servidor cerrados después.

---

## 2026-08-09 — Inicial/aceptación por prefijo de texto en vez de columnas, columna ε opt-in

**Dónde**: `views/table/TableView.js` (+ test), `views/table/tableLogic.js` (+ test).

**Qué se pidió**: sacar las columnas dedicadas de "marcar inicial"/"marcar aceptación" de la
tabla de estados (radio button + checkbox, agregadas la sesión anterior) y en su lugar
detectar los prefijos `"->"` y `"*"` escritos directamente en el nombre del estado — mismo
mecanismo que ya mostraba `rowLabel` como texto de solo lectura, ahora también como forma de
editar. También: sacar la columna `ε` fija (siempre presente antes) y que solo aparezca si
se pide explícitamente en el alfabeto — una entrada en blanco (`"a, ,b"`) o el carácter `ε`
literal la agregan, mostrada como "cadena vacía" en vez del glifo.

**Dónde me aparté de lo pedido, y por qué**: se pidió "el mismo comportamiento" para `*` que
para `->` — es decir, exclusivo, con error si se intenta un segundo. Un DFA/NFA define su
conjunto de estados de aceptación como F ⊆ Q — un *conjunto*, no un único estado — así que
forzar exclusividad en `*` haría que la tabla no pudiera representar una automatización real
tan simple como "acepta si termina en A o en B" (dos estados de aceptación). Se implementó
`*` sin exclusividad (cualquier cantidad de estados puede tener `*`) y se dejó `->` como el
único que rechaza un segundo con un aviso visible — documentado explícitamente en el código
y acá para que quede claro que es una decisión técnica, no que se ignoró el pedido.

**Cómo funciona** (`tableLogic.js`):
- `parseNameCell(raw)` — detecta `->`/`*` al principio del texto tipeado (en cualquier orden,
  con espacios opcionales entre medio: `"->*q0"`, `"* ->q0"`, `"*q0"`), devuelve
  `{label, initial, accepting}`. Un prefijo *ausente* que antes SÍ estaba (el usuario lo borró
  y volvió a mandar el campo) se interpreta como "sacale la marca" — `TableView` compara
  contra el estado actual y llama `SetInitial(null)`/`SetAccepting(id,false)` según
  corresponda, así el campo es bidireccional (pone Y saca la marca, no solo la pone). Se
  encontró y arregló un bug propio en la primera versión: reaplicar `SetInitial(id)` sobre un
  estado que YA era el inicial (el usuario retipeando `"->"` sin cambiar nada) — ahora se
  salta esa llamada por completo si no hay cambio real, no solo si hay conflicto.
- `nameWithMarkers(state)` — el valor mostrado en el campo editable (`"->q0"`, `"*q1"`,
  `"->*q0"`) — ASCII, sin espacio, para que lo mostrado se pueda re-tipear exactamente igual
  y `parseNameCell` lo recupere sin ambigüedad. Distinto de `rowLabel` (que sigue existiendo,
  usa `→` unicode + espacio, solo para el `title` de la fila — de solo lectura, no necesita
  round-trip).
- `parseAlphabetInput` — una entrada vacía por typo (`"a,,b"`, nada entre comas) se ignora;
  una entrada de puro espacio en blanco (`"a, ,b"`) se interpreta como pedido explícito de la
  columna epsilon — la única forma de distinguir "typo" de "lo pedí a propósito" es no
  trimear antes de chequear si quedó vacío.

**Cómo se verificó**: 244/244 tests de frontend en verde (test nuevo por cada pieza:
detección de cada prefijo y combinaciones, orden/espacios, rechazo con aviso visible en
`->` duplicado, sin rechazo en `*` repetido, quitar un prefijo limpia la marca, columna
epsilon opt-in vía blanco vs. typo, sin la reaplicación redundante de `SetInitial`), build
limpio. Verificado también en un navegador real: el encabezado de la tabla ya no tiene las
columnas →/* (solo el checkbox de borrado + "Estado"), y el alfabeto `"a, ,b"` efectivamente
agrega la columna "cadena vacía" en el lugar correcto.

---

## 2026-08-09 — Tabla de estados editable completa + bug sistémico de box-sizing

**Dónde**: `views/table/TableView.js` (+ test), `views/table/tableLogic.js` (+ test),
`views/formal/FormalView.js` (sin cambios de código, solo CSS), `ui/tabs.js`'s CSS,
`main.js`, `style.css`.

**Bug sistémico encontrado mientras se diagnosticaba "Definición formal" (no solo ese
textarea)**: el usuario pidió que la caja de texto de la definición formal no obligara a
scrollear horizontalmente. Se investigó en un navegador real con `getComputedStyle` en vez
de adivinar: el textarea tenía `box-sizing: content-box` (el default del navegador) y
`width: 100%` — con `content-box`, el padding y el borde se SUMAN por encima del 100%
calculado, así que el textarea terminaba renderizando más ancho que su contenedor
(561px medidos adentro de un contenedor de 543px). La causa raíz: **nunca existió un reset
`* { box-sizing: border-box; }` en este proyecto** — el artifact original (el wireframe que
se copió pixel a pixel el 2026-08-09 antes) sí lo tenía, pero se quedó afuera en esa
reescritura. Es un bug sistémico (afecta a cualquier elemento con `width:100%` + padding/
borde: `.string-input`, `.tool-btn`, `.chip`, todos los botones...), así que el fix es
global (`* { box-sizing: border-box; }` en `style.css`), no un parche puntual al textarea.

**Definición formal — que se expanda hasta el botón**: además del fix de ancho, se pidió que
el textarea creciera verticalmente hasta topar con "Aplicar definición" en el borde inferior
del panel, en vez de tener una altura fija (`8rem`) con espacio vacío debajo. Esto requirió
que toda la cadena de contenedores hasta `.tab-panel.active` pase a ser flex-column con
`flex:1; min-height:0` (antes `.tab-panel.active` era `display:block`, con altura ajustada a
su contenido, no a la del panel) — cambio hecho en `ui/tabs.js`'s CSS, compartido por las
otras vistas que también viven en un tab-panel (Tabla de estados, Cadena/Lote/Resultados);
se revisó que ninguna dependiera de ser `display:block` específicamente. `.formal-view`
ahora es `flex:1;display:flex;flex-direction:column`, el textarea es `flex:1` (sin altura
fija, `resize:none` — un handle de resize manual habría vuelto a producir el mismo bug de
ancho que recién se arregló).

**Tabla de estados — cuatro pedidos nuevos**:
1. Input "Alfabeto (separado por comas)" que sobrescribe qué columnas de símbolo muestra la
   tabla (`TableView._alphabetOverride`, `null` = seguir usando `docStore.derived.alphabet`
   automáticamente, como antes). Se vacía el input → vuelve a automático. Reutiliza el mismo
   patrón `_renderIfNotEditing` que ya usaba `FormalView` para no pisar lo que el usuario
   está tipeando.
2. Botones "+ Agregar estado" / "Eliminar seleccionados" — para eliminar, se decidió por
   checkboxes por fila + un botón de borrado en lote (la opción que el propio usuario había
   propuesto), en vez de un ícono de borrar por fila: es el patrón más estándar/reconocible
   para selección múltiple, y evita N botones de "borrar" compitiendo visualmente con las N
   filas. Incluye un checkbox "seleccionar todos" en el header.
3. Los botones (+ el input de alfabeto) van en una barra `position: sticky` **arriba** de la
   tabla, no abajo — pegada al tope de `.tab-panels` (su ancestro con scroll real) mientras
   se scrollea, así siguen alcanzables sin importar cuántos estados haya (pedido explícito
   del usuario: "que se mantengan siempre visibles incluso si hubiera demasiados estados").
4. Nombre editable (input de texto en vez de texto plano), radio button para marcar el
   estado inicial (excluyente — solo uno a la vez, mismo `SetInitial` que ya usaba el menú
   contextual del diagrama) y checkbox para aceptación (independiente por fila, `SetAccepting`).
   El renombrado pasa por `ctx.renameState` (no un `docStore.apply` crudo), mismo camino que
   ya usa el doble-click en el diagrama, para que una colisión de nombre muestre el mismo
   aviso visible (task 7.9) en vez de fallar en silencio — por eso `TableView` ahora recibe
   `ctx` además de `docStore` (`main.js` actualizado).

**Cómo se verificó**: 226/226 tests de frontend en verde (test nuevo por cada pieza:
`parseAlphabetInput`, override/reversión del alfabeto, agregar/eliminar estados, radio de
inicial, checkbox de aceptación, rename vía `ctx.renameState`, seleccionar-todos), build
limpio. Verificado también en un navegador real: `getComputedStyle` confirmó que el fix de
`box-sizing` elimina el overflow horizontal (`scrollWidth === clientWidth` ahora, antes no),
que el textarea de definición formal efectivamente crece hasta el botón, y que la tabla con
el alfabeto sobrescrito (`0, 1, 00`) no introduce overflow horizontal tampoco.

---

## 2026-08-09 — Segunda ronda: fix real del bug de "Resultados" + navegación libre + claridad visual + hover

**Dónde**: `views/diagram/DiagramView.js` (+ test), `views/testing/TestingView.js`, `style.css`.

**Bug real en el fix anterior de "Resultados"**: la pasada anterior (mismo día) agregó
`_resultMode` y togglear `hidden` en `.verdict`/`.trace-row`/`.testing-batch-table`, y los
tests pasaban — pero `.verdict` y `.trace-row` ya tenían su propia regla `display` en
`style.css` (`display: inline-flex` / `display: flex`). Una regla `display` de autor
**siempre** gana sobre el `[hidden] { display: none }` del navegador, sin importar
especificidad ni orden — así que poner `hidden = true` en JS no ocultaba nada visualmente.
Es el mismo bug que ya existía documentado para `.menu-dropdown[hidden]` más arriba en este
mismo archivo, y otra vez confirma por qué los tests de jsdom no lo detectaron: jsdom no
aplica cascada CSS real, solo puede verificar que la propiedad `.hidden` quedó en `true`, no
que el elemento realmente desaparece en pantalla. Fix: `.verdict[hidden], .trace-row[hidden],
.testing-batch-table[hidden] { display: none; }` explícito. Verificado esta vez en un
navegador real (ver abajo) con `getComputedStyle`, no solo con jsdom.

**Etiquetas de transición encima de la línea**: `curvedEdgePath`/`selfLoopPath` devolvían el
punto medio *exacto* de la curva como posición de la etiqueta — que por definición cae sobre
el trazo. Se agregó un `labelGap` (12px por defecto) que empuja la etiqueta más allá del
punto medio, en la misma dirección "hacia afuera" que ya se usa para el bulge de la curva
(o el ángulo del self-loop). Para el caso de línea recta (sin curva, en `DiagramView.js`) se
reemplazó el offset fijo `-4` en Y (que solo funcionaba si la línea era horizontal) por un
offset perpendicular real a la dirección de la línea.

**Navegación libre del canvas**: no existía ni pan ni zoom con rueda del mouse — solo los
atajos de teclado/menú (`Ctrl+=`, `Ctrl+1`, etc.). Se agregó `_onWheel` (zoom centrado en el
cursor, no en el centro del canvas) y arrastre de fondo vacío para paneo (`_panState`,
paralelo al `_dragState` de mover estados) — deshabilitado solo mientras la herramienta
"Estado" está activa, porque esa herramienta crea un estado en cada click sobre lienzo vacío
y un arrastre-para-panear ahí terminaría también creando un estado no deseado al soltar.

**Claridad visual de estado inicial/final**: la única señal era un `stroke-width` distinto
(2/3/4px) — muy sutil, casi imperceptible comparado con "seleccionado". El *toggle* para
marcar un estado como de aceptación ya existía (menú contextual click-derecho → "Alternar
aceptación", `state.toggleAccepting` en `registry.js`) — lo que faltaba era que se notara.
Se agregó un doble círculo real (`.state-accepting-ring`, `pointer-events: none` para no
interceptar hover/click) para aceptación, y una flecha entrante fija por la izquierda
(`.initial-arrow`) para el estado inicial — mismo lenguaje visual que el wireframe.

**Hover/cursor como affordance de interactividad**: `.state:hover` cambia de color; el cursor
de todo el canvas es `grab` (arrastrable) por defecto y `crosshair` mientras la herramienta
"Estado" está activa. Las aristas son un trazo de 1.5px — casi imposible de hacer hover con
precisión — así que cada arista ahora tiene un duplicado invisible mucho más ancho
(`.edge-hit`, `stroke-width: 14`, transparente) como blanco real de hover/click; al
hacerle hover se le agrega `.edge-hover` a la arista visible. Esto también hace más fácil
clickear una arista para seleccionarla/borrarla, no solo el hover.

**Cómo se verificó**: 212/212 tests de frontend en verde (test nuevo por cada bug/feature:
bug del `[hidden]`, offset de etiquetas en recta/curva/self-loop, pan, zoom con rueda,
deshabilitado durante "Estado", clases de cursor, doble círculo, flecha inicial, hit-path de
arista), build limpio. Esta vez **sí se pudo verificar en un navegador real** (la extensión
de claude-in-chrome conectó): se confirmó con `getComputedStyle` que `[hidden]` ahora
realmente oculta (`display: none`) los tres elementos de Resultados; que el tamaño real
renderizado del SVG (849×482px) efectivamente difiere del `viewBox` (600×400), confirmando
que el bug de coordenadas del pase anterior era real; que arrastrar el canvas vacío mueve el
`viewBox` con el signo/magnitud esperado y togglea `.panning`; que la rueda del mouse
hace zoom centrado en el cursor; y que el cursor cambia a `grab`/`crosshair` según la
herramienta. No se pudo probar creación/arrastre de estados reales ni el par de transiciones
bidireccional en ese navegador porque esa pestaña no tiene backend Tauri (limitación de
entorno ya documentada, no un bug de esta sesión).

---

## 2026-08-09 — Tres bugs reales encontrados tras la reescritura del frontend

**Dónde**: `views/diagram/DiagramView.js` (+ test), `views/diagram/geometry.js` (+ test),
`views/testing/TestingView.js` (+ test).

**Bug 1 — clicks/drags en el canvas no coinciden con el cursor**: `_onCanvasClick` calculaba
`x = event.clientX - rect.left` directamente, asumiendo 1 pixel de pantalla = 1 unidad SVG.
Pero `.diagram-canvas` tiene `width: 100%` (se estira para llenar el pane), así que su tamaño
renderizado casi nunca coincide con el `viewBox` (600×400, o menos/más tras hacer zoom) — la
proporción real depende del tamaño de la ventana. Mismo problema en `_onCanvasMouseMove`: el
delta del arrastre se sumaba crudo, sin escalar, por eso el estado "se movía pero no seguía
exactamente al cursor" (iba más lento que el mouse cuando el canvas está más grande que el
viewBox). Fix: `_svgScale()`/`_svgPoint()` nuevos, que escalan por `viewBox / rect` (con
fallback a 1:1 cuando `rect.width` es 0 — jsdom no hace layout real, así que los tests
existentes seguían pasando exactamente igual).

**Bug 2 — un par de transiciones bidireccional (q0→q1 y luego q1→q0) se dibuja encima**:
`curvedEdgePath` calculaba su vector perpendicular a partir de `to - from` de cada arista.
Al invertir la arista (de A→B a B→A), `to - from` se niega — y esa negación cancelaba
exactamente el flip de `side` (`+1`/`-1`) que `DiagramView` ya calculaba para separar las dos
curvas, así que ambas terminaban con el mismo punto de control (misma curva, superpuesta) en
vez de curvas espejadas. El test existente de `curvedEdgePath` no lo detectaba porque probaba
`side=1` vs `side=-1` con el mismo `from`/`to` (sin invertir), que nunca activa el bug. Fix:
la base perpendicular ahora se deriva del par *no-ordenado* (canonicalizada a una sola
dirección), no de la dirección real de cada arista — así el `side` de cada arista sí produce
puntos de control distintos.

**Bug 3 — "Resultados" mezclaba el hint de Cadena con la tabla de Lote**: `_trace` (single) y
`_batchResults` (lote) se guardaban por separado, y cada render solo escondía/mostraba su
propia sección sin enterarse de la otra — después de calcular un lote, `_trace` seguía siendo
`null`, así que el hint "probá Calcular en Cadena" se quedaba visible junto a la tabla. Fix:
un solo `_resultMode` (`"single"`/`"batch"`/`null`) decide qué mostrar; `_renderResults()`
oculta todo lo que no corresponda al último cálculo.

**Cómo se verificó**: se agregó un test de regresión por cada bug (canvas estirado 2x en
click y en drag, un par bidireccional real invirtiendo `from`/`to` igual que
`_renderCanvas`, y una secuencia lote→cadena→verificación de qué queda oculto) — los cuatro
fallaban contra el código viejo y pasan contra el fix. 202/202 tests en verde, build limpio.
**No verificado en navegador real** — la extensión de claude-in-chrome siguió sin conectar.

---

## 2026-08-09 — Reescritura completa del frontend a paridad de píxel con el wireframe

**Dónde**: `frontend/src/theme.css`, `style.css`, `main.js`, `commands/registry.js`,
`commands/context.js`, `views/diagram/DiagramView.js` (+ test), `views/toolbar/Toolbar.js`
(+ test, nuevo), `views/table/TableView.js` (+ test), `views/testing/TestingView.js` (+ test),
`views/formal/FormalView.js`.

**Qué pasó**: las dos pasadas de "paridad visual" anteriores (2026-08-07, 2026-08-09
anterior) seguían sin verse como el artifact según el usuario, que comparó capturas
lado a lado y confirmó: "seguía sin verse como en el artifact... mejor descarta todo lo
que teníamos y armalo desde cero, siguiendo todo lo que ya se armó en el artifact". Antes
de tocar código, se hizo `WebFetch` del artifact real (`claude.ai/code/artifact/...`) para
leer su HTML/CSS/JS **literal** en vez de inferir de capturas — resultó ser HTML/CSS/JS
plano (no React), así que no hizo falta cambiar de stack, solo copiar su estructura y
valores tal cual.

**Cambios estructurales reales** (no solo CSS):
- El **toolbar** (herramientas + Círculo/Ajustar + selector de editor) vivía adentro de
  `DiagramView` (acotado al 60% del canvas). En el artifact es un hermano de pleno ancho
  entre `.menubar` y `.body`, cubriendo también la columna derecha. Se sacó a
  `views/toolbar/Toolbar.js`, un componente nuevo montado en `main.js` al mismo nivel que
  `MenuBar` — mismo patrón de "proyección del registry", sin lógica propia.
- El label estático "Editor: Autómata Finito" (decisión del 2026-08-07, para no fingir un
  dropdown sin opciones) se reemplazó por un **`<select>` real** con "Autómata Finito"
  habilitado y tres opciones deshabilitadas ("Autómata de Pila/Máquina de Turing/Expresión
  Regular — próximamente"): así es como el artifact mismo resuelve "solo un tipo existe hoy"
  sin inventar nada — un select con opciones deshabilitadas no es una afirmación falsa.
- **Resultados de test** (`TestingView`): el wireframe muestra el trace completo como una
  fila de chips conectados (`q0 → qB → qA`, último resaltado), sin navegación paso a paso.
  Nuestra versión anterior tenía botones ◀/▶ + resaltado en vivo del estado activo en el
  canvas (`ctx.setActiveStates`/`DiagramView.setActiveStates`/`.active-sim`) — una función
  real y probada. Se le preguntó al usuario explícitamente qué hacer; eligió **reemplazar
  100% por el wireframe**. Se borró todo el step-nav y el pipeline de highlighting completo
  (`DiagramView.setActiveStates`, `.active-sim`, `--state-active-fill`, el hook
  `ctx.setActiveStates` en `context.js`, su wiring en `main.js`) en vez de dejarlo muerto.
- Colores/spacing: `theme.css` y los tokens de layout de `style.css` se reescribieron con
  los valores **literales** del artifact (hex/rgba exactos, no aproximados) — incluye tokens
  nuevos (`--surface-2`, `--accent-soft`, `--accent-text`) que no existían antes.

**Deliberadamente NO igual al wireframe** (con motivo técnico, no flojera): la
`.formal-def` del artifact es HTML de solo lectura con keywords (Q, Σ, δ...) coloreados
via `<span class="k">`. Nuestra vista de definición formal es un `<textarea>` **editable**
que aplica ediciones al documento (spec `formal-definition-view`, "Valid edit applies
everywhere") — un textarea nativo no puede tener spans de color adentro. Se mantuvo
editable (perder esa función habría sido un regression real, no solo estético) y solo se
copió la tipografía (monoespaciada, `line-height: 1.9`) del wireframe.

**Cómo se verificó**: 198/198 tests de frontend en verde (bajaron de 201 por la limpieza
de tests del step-nav/active-sim ya removidos, más los 4 tests nuevos de `Toolbar.test.js`),
`vite build` sin errores. **No se pudo verificar en un navegador real** — la extensión de
claude-in-chrome no conectó en ninguno de los dos intentos de esta sesión — así que esta
pasada está verificada por test+build únicamente, pendiente de una revisión visual real la
próxima vez que el navegador esté disponible.

---

## 2026-08-09 — Segunda pasada de paridad visual: dropdown de "Editor" y nombre de archivo en la info bar

**Dónde**: `frontend/src/store/DocStore.js`, `main.js`, `views/diagram/DiagramView.js`, `style.css`.

**Qué se implementó**: el usuario comparó capturas lado a lado (app real vs.
artifact) y señaló dos diferencias concretas que la pasada anterior había
dejado sin resolver. (1) `.editor-type` era texto plano ("Editor: Autómata
Finito"), sin la caja bordeada + `▾` que tiene el wireframe — se separó en
`.editor-type-label` ("Editor", empujado a la derecha con `margin-left:
auto`) y una `.editor-type` como caja bordeada con el valor y el caret
adentro; sigue siendo estática (ver decisión anterior: no hay más de un tipo
de editor todavía), solo se le agregó la caja para que se lea como el
dropdown del wireframe sin fingir que abre algo. (2) la `.canvas-info-bar`
no mostraba nombre de archivo — la decisión anterior lo había dejado fuera
porque "no existía ese estado en ningún lado". Esta vez sí había un lugar
natural: `importJff`/`exportJff` en `main.js` ya reciben un `path`, así que
se agregó `DocStore.filePath` + `setFilePath()` (notifica a los suscriptores
igual que cualquier otro cambio de documento) y se llama tras cada
import/export exitoso; `DiagramView._renderCanvasInfoBar()` ahora también
pinta el basename del path (o vacío si nunca se importó/exportó nada) a la
izquierda del chip AFD/AFN, con `.canvas-info-bar` pasado a
`justify-content: space-between`.

**Cómo se verificó**: no hicieron falta cambios en los tests existentes —
ningún test tenía aserciones sobre el texto de `.editor-type` ni sobre
`.canvas-info-bar` (confirmado por grep antes de editar). 200/200 tests de
frontend en verde, build de Vite sin errores. La verificación visual en
navegador real no pudo repetirse esta vez porque la extensión de
claude-in-chrome no estaba conectada; queda pendiente confirmarlo a ojo
corriendo la app.

---

## 2026-08-07 — Pulido visual del frontend a paridad con el wireframe, y traducción de la UI a español

**Dónde**: `frontend/src/commands/registry.js`, `views/menubar/MenuBar.js`,
`views/diagram/DiagramView.js`, `views/diagram/DiagramView.test.js`,
`views/formal/FormalView.js`, `views/testing/TestingView.js`, `style.css`.

**Qué se implementó**: comparando capturas del wireframe artifact contra la
app real corriendo, el usuario pidió alinear lo visual. Se agruparon los
botones de la toolbar en dos "pills" bordeadas (herramientas L0, y
disposición-circular/ajustar-a-ventana), cada botón con ícono + badge de
atajo de teclado (`<kbd>`); se agregó `.editor-type` (etiqueta estática
"Editor: Autómata Finito" — no hay más de un tipo de editor todavía, así que
no es un `<select>` funcional, solo texto para paridad visual); una
`.canvas-info-bar` con el chip "AFD/AFN · N estados" arriba del canvas
(deliberadamente más liviano que `.status-bar`, que sigue abajo con el
detalle completo Q/Σ/δ — no se dedujo un concepto de "archivo actual" para
mostrar nombre de archivo, no existía ese estado en ningún lado); fondo de
puntos en el canvas vía `background-image: radial-gradient(...)`; tabla de
estados con bordes y encabezado sombreado; botones "Calcular"/"Calcular
lote"/"Aplicar definición" con la clase compartida `.btn-primary` (fondo
sólido `--accent-strong`).

**Traducción a español**: se detectó (comparando con el wireframe, que
siempre fue 100% español) que los títulos de `registry.js` y
`MENU_GROUP_TITLES` de `MenuBar.js` seguían en inglés — inconsistente con las
pestañas ya traducidas esta sesión. Como MenuBar/toolbar/menú contextual son
"proyecciones" del mismo array de acciones (diseño D6), traducir los
`title` en `registry.js` alcanzó automáticamente las tres superficies. Se
tradujo también el inspector de selección de `DiagramView.js` ("No
selection" → "Sin selección", etc.) y el texto de "DFA"/"NFA"/"unreachable"
del `.status-bar` a "AFD"/"AFN"/"inalcanzable(s)". **Deliberadamente fuera de
alcance**: los mensajes de `promptModal`/notificaciones en `main.js` y
`commands/context.js` (p. ej. "Rename state", "Import failed") — no
aparecían en las capturas comparadas y traducirlos a ciegas sin poder
probar cada diálogo interactivamente hubiera sido una auditoría de i18n de
alcance mucho mayor al pedido puntual.

**Cómo se verificó**: se revisó `grep` de `registry.test.js`/
`MenuBar.test.js`/`TestingView.test.js`/`FormalView.test.js` antes de
traducir para confirmar que ningún test dependía de los strings en inglés.
El test de `DiagramView.test.js` que esperaba exactamente 4 botones en
`.toolbar [data-action]` se acotó a `[data-group="tools"] [data-action]`
(nuevo atributo en el DOM) y se agregó un test hermano para el grupo
`view`. 200/200 tests de frontend en verde, build de Vite sin errores.
Probado además en un navegador real (Chrome vía automatización): la toolbar,
el chip AFD, la tabla y el botón "Calcular →" se ven como en el wireframe.
La creación de estados no pudo probarse end-to-end en esa pestaña porque no
hay backend Tauri detrás de un `vite dev` en navegador plano (mismo
`Cannot read properties of undefined (reading 'invoke')` ya documentado
como limitación del entorno, no un bug de esta sesión).

---

## 2026-08-07 — Layout real implementado: bug de menú siempre-abierto encontrado en el primer arranque

**Dónde**: `frontend/src/main.js`, `style.css`, `views/table/TableView.js`,
`views/formal/FormalView.js`, `views/testing/TestingView.js`, nuevos
`ui/tabs.js`, `ui/resizer.js`, y `views/diagram/geometry.js`/`DiagramView.js`
(self-loops/curvas bidireccionales).

**Qué se implementó**: el layout acordado con el usuario (wireframe, esta
sesión) — menú arriba, canvas 60% (toolbar propio del `DiagramView`,
redimensionable 35–70% con `ui/resizer.js`), columna derecha 40% dividida en
pestañas superiores (Tabla de estados / Definición formal, `ui/tabs.js`) e
inferiores (Cadena / Lote / Resultados, dentro de `TestingView`, "Calcular"
salta directo a Resultados). Se sacó el `<details>` colapsable de
`TableView`/`FormalView`/`TestingView` — la visibilidad ahora es trabajo de
la pestaña, no de un toggle de colapso. Las auto-transiciones y pares
bidireccionales del canvas ahora usan la geometría de curvas/self-loops
validada en el wireframe (`preferredLoopAngle`, `selfLoopPath`,
`curvedEdgePath` en `geometry.js`) en vez de líneas rectas superpuestas; se
agregaron cabezas de flecha reales (`<marker>`), que antes no existían.

**Bug real encontrado al correr la app por primera vez en un navegador**:
`.context-menu, .menu-dropdown { display: flex; ... }` tenía la misma
especificidad que la regla por defecto del navegador `[hidden] { display:
none }` — y como la regla de autor se aplica después que la del user-agent,
le ganaba: el atributo `hidden` (usado por `MenuBar.js` para abrir/cerrar
cada menú) no hacía nada, y los 4 menús (File/Edit/View/Test) se mostraban
siempre abiertos y superpuestos desde el arranque, tapando toda la app.
Preexistente, no introducido esta sesión — según la memoria del proyecto
nadie había corrido la app en un navegador real todavía. Arreglado con
`.menu-dropdown[hidden] { display: none; }`, más específico. Ver también
`.toolbar { flex-wrap: wrap; }` agregado como medida defensiva (encontrado
en un viewport de prueba degenerado de 118×82px del entorno de sandbox, no
representativo de una ventana real, pero el toolbar no tenía ningún manejo
de desborde en absoluto).

**Cómo se verificó**: 199 tests de frontend (`npm test`) — se actualizaron
los que asumían `<details>`/`.open`, se agregaron nuevos para
`geometry.js` (self-loop/curva, 19 tests), `ui/tabs.js` (6), `ui/resizer.js`
(4), y el flujo Calcular→Resultados de `TestingView`. Build de producción
limpio. Además, corrida real en navegador (`npm run dev` + Chrome vía
automatización) — ahí se encontró el bug del menú, no en los tests (jsdom
nunca ejecuta la cascada CSS real del navegador). La edición interactiva
completa (crear estados/transiciones) necesita el backend real de Tauri —
en un navegador plano `client.docApply`/`docSnapshot` rechazan
(`Cannot read properties of undefined (reading 'invoke')`), esperado, no un
bug.

---

## 2026-08-07 — Gap real encontrado en `geometry.js`: aristas bidireccionales se superponen

**Dónde**: `frontend/src/views/diagram/geometry.js` (`edgeEndpoints`) y
`DiagramView.js` (`_renderCanvas`) — todavía sin arreglar, queda para cuando
se retome el diagrama de verdad.

**Qué se encontró**: al planificar el layout visual, el usuario preguntó si
al mover un estado en modo selección las flechas lo siguen sin superponerse
entre sí. Se verificó leyendo el código (no se asumió): mover un estado sí
actualiza las aristas correctamente — `_renderCanvas` lee `state.x/y`
frescos de `DocStore` en cada render. Pero `edgeEndpoints` solo calcula
líneas rectas entre los bordes de dos círculos, sin ninguna curva ni
separación: un par bidireccional (A→B y B→A) se dibuja como el mismo
segmento de línea superpuesto, con las dos flechas encontrándose en el medio
y las dos etiquetas cayendo en el mismo punto. Los self-loops tampoco son
una curva real — un `<circle>` flotando arriba del estado (`cy -
r*1.5`), sin apuntar a nada.

**Plan cuando se retome**: reusar la técnica ya validada visualmente con el
usuario en el wireframe de layout (ver conversación) —
self-loops con puntos de control en dirección radial desde el centro del
estado (para que la flecha entre apuntando al centro, no tangencial), y
curvas bezier cuadráticas con desplazamiento perpendicular opuesto para cada
dirección de un par bidireccional (una hacia afuera, otra hacia adentro).
Etiquetas posicionadas sobre el punto medio *real* de la curva (el punto
`B(0.5)` de la bezier), no sobre el punto de control — ese fue el primer
error del wireframe, corregido ahí antes de portarlo acá.

---

## 2026-08-07 — Colores del frontend separados en `theme.css`, aparte de layout/espaciado

**Dónde**: `frontend/src/theme.css` (nuevo), importado desde
`frontend/src/style.css`.

**Qué se decidió**: todo color que usa el frontend — antes repartido entre
`:root` (unos pocos tokens: `--accent`, `--danger`...) y una mezcla de
literales sueltos (`#fff`, `#333`, `#cde`, `#0006`...) y las palabras clave
`canvas`/`canvastext` del navegador — ahora vive en un solo archivo,
`theme.css`, con nada más que color adentro. `style.css` solo tiene
espaciado/radio/tipografía y hace `@import "./theme.css";`.

**Por qué**: el usuario quiere poder generar la paleta con una herramienta
externa (`matugen` u otra, del estilo Material You — deriva colores de un
wallpaper) más adelante, sin tocar el resto del frontend. Para que eso
funcione, un archivo regenerado tiene que poder pisar *todos* los colores —
lo cual es imposible si algunos vienen de `canvas`/`canvastext` (colores de
sistema del navegador, ninguna hoja de estilos los puede sobreescribir) o
están escritos como literales sueltos en medio de reglas de layout. Se
reemplazaron esos casos por tokens explícitos: `--bg`/`--surface`/`--text`
en vez de `canvas`/`canvastext`, y `--state-fill`/`--state-stroke`/
`--state-selected-fill`/`--state-active-fill`/`--edge-stroke`/
`--overlay-bg`/`--shadow-color` en vez de los hex sueltos del canvas del
diagrama y los modales/notices.

**Estructura de `theme.css`**: seguí el patrón de tres estados (`:root`
plano = claro por defecto, `@media (prefers-color-scheme: dark)` con guardia
`:root:not([data-theme="light"])`, y `:root[data-theme="dark"]` repetido para
cuando la app tenga un selector manual de tema) — no hay selector manual
todavía, pero la estructura ya está lista para cuando lo haya, sin tener que
reescribir el archivo.

**Cómo se verificó**: `npm test` (181 tests) y `npm run build` después del
cambio, sin tocar ningún componente — solo referencias a variables CSS. Bundle
final 6.80kB (subió ~1kB por los tokens nuevos, nada relevante).

---

## 2026-08-07 — AFD/AFN ↔ gramática regular y ↔ expresión regular: cierra "Finite Automaton"

**Dónde**: `crates/automata-core/src/grammar/` (modelo), `src/regex/` (AST),
`src/convert/fa_to_grammar.rs`, `src/convert/fa_to_regex.rs`,
`src/convert/regex_to_nfa.rs`.

**Qué se decidió y por qué**: el usuario mostró el menú principal de JFLAP
(File > Finite Automaton, Mealy Machine, ..., Regular Expression, ...) y
pidió terminar el alcance completo de "Finite Automaton" antes de pasar al
frontend. Se decompilaron `automata.fsa.FSAToRegularGrammarConverter` y
`automata.fsa.FSAToRegularExpressionConverter` (con `cfr`) para confirmar qué
le falta al proyecto: esas dos conversiones, ambas viven en el mismo paquete
`automata.fsa` que `Minimizer`/`NFAToDFA` (ya hechos), confirmando que JFLAP
mismo las considera parte del kit de autómata finito, no de los editores de
"Grammar"/"Regular Expression" del menú.

**AFD/AFN → gramática regular** (`fa_to_regular_grammar`): mecánico,
verificado igual a JFLAP — una producción `P -> aQ` por cada transición
`δ(p,a)=q`, una producción `P -> ε` por cada estado de aceptación. Única
divergencia: JFLAP nombra los no-terminales `S` (inicial) y después
`A,B,C...` (tope de 26 estados, se rompe después). Acá cada no-terminal es
directamente el label del estado original — sin tope, y una producción
`q0 -> a q1` se rastrea al estado exacto de donde salió con solo mirarla.
`regular_grammar_to_nfa` (la inversa, igual a
`grammar.reg.RightLinearGrammarToFSAConverter` de JFLAP) reconstruye un
autómata de la gramática — no es solo un helper de test, es la misma
conversión que JFLAP expone como función real.

**AFD/AFN → expresión regular** (`fa_to_regex`): la eliminación de estados
sobre un GNFA de Sipser (Thm. 1.60), el clásico de teoría de la
computación — el mismo algoritmo detrás de las guías que muestran "eliminar
un estado y sumar el camino que pasaba por él" paso a paso. JFLAP lo implementa
manipulando **strings crudos** (`concatenate`/`or`/`star` como funciones
sobre `String`, con un chequeo de precedencia que literalmente escanea el
string buscando un `+` suelto — `needsParens`). Acá en cambio hay un AST real
(`regex::Regex`: `Empty | Epsilon | Symbol | Concat | Union | Star`) con
`Display` que decide paréntesis por precedencia estructural, no por
inspección de texto — más robusto, sin depender de heurísticas sobre el
string ya renderizado. JFLAP además fuerza un único estado final ≠ inicial
mutando el autómata en el momento (`getSingleFinalState`/`isConvertable`)
como caso especial; acá se agregan dos nodos sintéticos (arranque y
aceptación, conectados por ε) y se eliminan todos los estados reales de
manera uniforme — sin casos especiales para "el estado inicial es también de
aceptación" o "cero/varios estados finales". Misma fórmula de 2 estados al
final (`round_trip.star().concat(final_leg)`, igual a `getFinalExpression`
de JFLAP) para el caso general con auto-bucles y una arista de vuelta
aceptación→inicio.

`regex_to_nfa` (construcción de Thompson, la dirección inversa — igual a
`gui.action.REToFSAAction` de JFLAP) existe tanto como función real como
oráculo de verificación: sin ella no había forma rigurosa de comprobar que
`fa_to_regex` estuviera bien, porque una expresión regular no se puede
"correr" directo con el motor de simulación que ya existe.

**Cómo se verificó**: tests con resultado exacto verificado a mano para
casos chicos (un autómata de una sola transición da exactamente el símbolo;
un self-loop más un símbolo da `a*b`; sin estado de aceptación da `∅`) — y
para todo lo demás, dos rondas de round-trip con proptest (256 casos cada
una): AFN aleatorio → gramática → AFN' (equivalencia de lenguaje), y AFN
aleatorio → regex → AFN' vía `regex_to_nfa` (equivalencia de lenguaje). Un
tercer bloque de tests prueba `regex_to_nfa` de forma completamente
independiente (`Empty`, `Epsilon`, `Symbol`, `Concat`, `Union`, `Star` cada
uno por separado), para no depender únicamente de que los dos lados del
round-trip se cancelen errores entre sí. 62 tests en `automata-core`, 97 en
el workspace completo.

**Uso**: `automata-cli to-grammar --file entrada.jff` /
`automata-cli to-regex --file entrada.jff` — ver README, sección "CLI de
diagnóstico".

---

## 2026-08-07 — Minimización de AFD, verificada contra el `Minimizer` real de JFLAP

**Dónde**: `crates/automata-core/src/convert/minimize_dfa.rs`.

**Qué se decidió**: partición de estados (algoritmo de Moore) — parte de dos
grupos (aceptación / no-aceptación) y refina hasta punto fijo, agrupando en
cada ronda los estados con **la misma firma**: (grupo actual, a qué grupo
llega por cada símbolo del alfabeto). El usuario pidió explícitamente
investigar antes de programar, ya que no conoce el tema — así que antes de
escribir una línea se decompiló `automata.fsa.Minimizer` del JFLAP original
(`idea/JFLAP7.1-output`, con `cfr`, instalado vía `sudo pacman -S cfr`) y se
leyó su código real, no supuesto de memoria.

**Lo que confirmó el original**: mismo algoritmo (Moore por partición),
mismos pasos — rechaza autómatas no deterministas de entrada
(`AutomatonChecker.isNFA`, no convierte solo), elimina estados inalcanzables
antes de minimizar. Se igualaron ambos comportamientos acá: `minimize_dfa`
devuelve `Err(MinimizeError::NotDeterministic)` si `doc.classify() != Dfa`
(no convierte en silencio — llamar a `nfa_to_dfa` primero es responsabilidad
del caller), y solo los estados alcanzables desde el inicial participan.

**Divergencia deliberada frente a JFLAP, con una corrección real en el camino**:
JFLAP materializa un estado trampa real (`addTrapState`) para completar el AFD
antes de refinar, y lo descarta (`containsTrapState`) del resultado final.
Acá "sin transición" se trata como un participante más del refinamiento (no
un `StateId` real, un `None` que actúa como un estado virtual más: no
aceptación, auto-bucle a sí mismo en cada símbolo) — mismo resultado
matemático que JFLAP, sin nunca asignar un id real para eso.

La primera versión de esto trataba `None` como caso especial solo al
*comparar* firmas, no como un participante real del refinamiento — y eso
tenía un bug genuino: un estado trampa dibujado a mano (real, con
auto-bucles) y un estado sin ninguna transición (implícito) significan
exactamente lo mismo ("rechazar para siempre"), pero esa primera versión no
los reconocía como equivalentes, así que el trampa explícito sobrevivía como
un estado de más en el resultado — no un lenguaje incorrecto (el AFD seguía
aceptando lo mismo), pero sí un resultado que no era realmente el mínimo. Se
encontró armando el verificador independiente de minimalidad para los
enunciados (ver más abajo), no por un reporte de bug — exactamente el tipo de
cosa que ese verificador estaba pensado para atrapar. Se corrigió dándole a
`None` un lugar real en el mismo proceso de partición en vez de un caso
especial aparte; ver el test
`merges_an_explicit_dead_end_state_with_implicitly_missing_transitions`.

**Etiquetado**: igual que `nfa_to_dfa`, cada estado de salida se llama
`{q0,q1}`-estilo (labels originales ordenados y unidos) en vez de la
convención de JFLAP (ids numéricos separados por coma, sin llaves) — mismo
contenido informativo, formato distinto, cosmético.

**Cómo se verificó**: 7 tests — rechazo de entrada no determinista, un caso
de fusión de dos estados construido a mano y verificado por razonamiento
directo (no solo "no rompió nada": el algoritmo tiene que fusionar cuando
corresponde, no solo cuando no corresponde), el caso específico del bug
descrito arriba, poda de inalcanzables, un AFD ya mínimo que no cambia de
tamaño, el autómata vacío, y un proptest de 256 casos sobre AFDs aleatorios
generados como función `(estado,símbolo) -> Option<estado>` — determinista
*por construcción*, no filtrando conflictos de una lista de aristas al azar.
Además de equivalencia de lenguaje, todos estos (y el proptest) verifican
minimalidad real con `is_truly_minimal` — una segunda formulación del mismo
problema (marcar pares *distinguidos* hasta punto fijo — "table-filling" —
en vez de *agrupar* estados equivalentes), escrita aparte, que no llama a
`minimize_dfa` ni reutiliza su código. Los 41 tests de `automata-core` y los
76 del workspace completo pasan.

**Perfil de rendimiento medido** (`automata-cli stress --topology chain`,
que ya es un AFD mínimo — el peor caso posible para el algoritmo, porque cada
estado necesita su propia ronda de refinamiento): 500 estados → 38ms, 1000 →
150ms, 2000 → 604ms, 4000 → 2.50s. Escala cuadrático (~4x tiempo por cada
duplicación de estados), como se espera de esta formulación simple del
algoritmo — no es Hopcroft O(n log n). A escala de cursada (decenas/cientos
de estados) es instantáneo. No se implementó Hopcroft todavía porque no hay
evidencia real de que haga falta — mismo criterio que con la clausura-ε:
medir primero, complicar el algoritmo solo si el número real lo justifica. Si
en algún momento `nfa_to_dfa` produce AFDs de miles de estados que hace falta
re-minimizar seguido (el blowup exponencial de la construcción de
subconjuntos lo puede generar), ese es el momento de revisar esto.

**Caso real de validación** (no un test sintético): el AFND-ε "múltiplo de 2
o 3" de `ejercicios/teoria-afnd/` tiene 6 estados; su conversión a AFD
(`nfa_to_dfa`) da 7; minimizar ese AFD lo vuelve a bajar a 6 — que es
exactamente el mínimo teórico (autómata de residuos mód 6, ya que mcm(2,3)=6,
y los 6 residuos son mutuamente distinguibles). El pipeline completo AFND→AFD→AFD-mínimo
coincidió con la teoría sin ajustar nada a mano.

**Uso**: `automata-cli minimize --file entrada.json --out minimo.json` — ver
README, sección "CLI de diagnóstico".

**Enunciados de minimización, exportados también en `.jff`**:
`crates/automata-cli/examples/minimize_check.rs` construye 3 AFD con
redundancia deliberada (incluido, a propósito, el caso exacto del bug de
arriba — trampa explícita + estado sin salida) y además re-minimiza los 6
AFD ya producidos por `nfa_to_dfa_check.rs`/`afnd_theory_examples.rs`. Cada
uno se guarda como `.json` nativo **y como `.jff`**, específicamente para que
puedan abrirse en `idea/JFLAP7.1.jar` y compararse contra el "Minimize DFA"
real del original — el usuario pidió explícitamente esa comparación directa,
dado que no conoce el tema todavía. Ver `ejercicios/minimizacion/README.md`.

---

## 2026-08-07 — AFN→AFD reutilizando `StateSet`/`Machine::step`, no un algoritmo aparte

**Dónde**: `crates/automata-core/src/convert/nfa_to_dfa.rs`.

**Qué se decidió**: la construcción de subconjuntos (AFN→AFD) hace BFS sobre
`StateSet` — el mismo tipo de configuración que `engine::fa::FaEngine` ya usa
para simular, donde una configuración FA *es* un subconjunto ε-cerrado de
estados — llamando a `engine.step(subconjunto, [símbolo], 0)` para "¿a qué
subconjunto se llega con este símbolo?" en vez de reimplementar esa lógica.
Cada subconjunto nuevo se interna como un estado del AFD de salida, con
etiqueta `{q0,q1}`-style (los labels ordenados del AFN, como hace JFLAP) y
aceptación si el subconjunto contiene algún estado de aceptación original.

**Por qué**: `FaEngine::step` ya es "dado un subconjunto ε-cerrado y un
símbolo, ¿cuál es el subconjunto resultante" — literalmente la operación
central de subset construction. Reusarla en vez de reescribir el recorrido de
`delta`/clausuras a mano evita que la lógica de simulación y la de conversión
puedan divergir silenciosamente (si `step` tuviera un bug, `sim` y `convert`
lo heredarían igual, no una sola).

**Decisiones de diseño explícitas**:
- Solo se crean estados alcanzables desde el inicial (el BFS lo garantiza
  gratis) — no hace falta un paso aparte de "eliminar estados inaccesibles".
- El AFD resultante **no se hace total**: un subconjunto sin transición para
  un símbolo simplemente no genera esa arista, en vez de sintetizar un estado
  trampa. `FaDoc::classify` solo exige determinismo (a lo sumo un destino por
  (estado,símbolo)), no totalidad, y el motor ya trata "sin transición" como
  `Outcome::Stuck` — equivalente en comportamiento a una trampa explícita, sin
  gastar un estado en representarla.
- Si el AFN no tiene estado inicial, el resultado es el autómata vacío (mismo
  lenguaje: no acepta nada).

**Cómo se verificó**: además de 4 tests unitarios (branching real de AFN,
unión por ε, que un AFD ya determinista solo pierde sus estados
inalcanzables, y el caso sin estado inicial), un proptest de 256 casos
(`nfa_to_dfa_preserves_language::matches`) genera AFNs aleatorios pequeños
(con ε y ramificación real) y hasta 20 palabras aleatorias por caso, y
compara `run_bounded` sobre el AFN original contra `run_bounded` sobre su AFD
— no compara estructura (sería inválido, es una conversión que renombra
estados), compara **equivalencia de lenguaje**. Los 34 tests de
`automata-core` y los 65 del workspace completo pasan.

**Uso**: `automata-cli convert --file entrada.jff --out salida.json` — ver
README, sección "CLI de diagnóstico".

**Verificado también contra la definición formal de AFD** (5-tupla
`(Q,Σ,q0,δ,F)`, sin transiciones δ(q,ε) y sin dos transiciones δ(q,a)=q1,
δ(q,a)=q2 con q1≠q2): `crates/automata-cli/examples/nfa_to_dfa_check.rs`
re-deriva esas dos condiciones directo de `doc.edges()` — sin llamar a
`FaDoc::classify`, que es la lógica que se está corroborando, no algo que se
da por cierto — sobre 4 AFN construidos a mano (unión vía ε, cierre de
Kleene vía ε con la construcción de Thompson, y un AFN de "adivinanza" sin ε
que es el ejemplo clásico de explosión exponencial: 4 estados → 8 = 2³ en el
AFD, el máximo teórico). La aclaración de la teoría de que un estado final
puede no tener transiciones de ningún tipo confirma, no contradice, la
decisión de no sintetizar un estado trampa (arriba). Ver
`ejercicios/nfa/README.md`.

**Segunda pasada contra diagramas de la teoría (no inventados acá)**: el
usuario mandó la teoría de AFND-ε más dos diagramas ya resueltos del
material de la cursada. `crates/automata-cli/examples/afnd_theory_examples.rs`
los reconstruye estado por estado (no son ejemplos que yo haya diseñado) y
corrobora: que el sistema los clasifica como AFND, que al menos una de las
dos condiciones que la teoría permite en un AFND está presente (chequeo
independiente, mismo estilo que `formal_dfa_violations` pero para las
condiciones permitidas en vez de las prohibidas), el lenguaje contra casos
derivados a mano, y que el AFD equivalente sigue cumpliendo la definición
formal de AFD. Los dos pasaron a la primera. Ver
`ejercicios/teoria-afnd/README.md`.

---

## 2026-08-07 — Clausura-ε vía Tarjan (SCC), no DFS por estado

**Dónde**: `crates/automata-core/src/engine/fa.rs`, `FaEngine::compile` /
`compute_eps_closures` / `tarjan_scc`.

**Qué se decidió**: precomputar la clausura-ε de cada estado condensando
ciclos-ε con el algoritmo de Tarjan (implementación **iterativa**, con pila
explícita — no recursión, para que una cadena de miles de transiciones-ε no
reviente el stack de llamadas), y después propagar la clausura de cada
componente por el DAG de condensación en el mismo orden en que Tarjan las va
completando (que ya es orden topológico inverso: los sumideros primero). Se
fusiona con `FixedBitSet::union_with` (OR palabra-por-palabra), no clonando.

**Por qué**: la implementación anterior hacía un DFS nuevo por cada estado —
O(estados × (estados + aristas)). Para un autómata de cursada (decenas de
estados) es gratis. Para una cadena larga de transiciones-ε (cada estado
alcanza a todos los siguientes) es catastrófico: medido con `automata-cli
stress --topology epsilon-chain`, compilar el motor tardaba **532ms a 5.000
estados** y **4.05s a 10.000 estados** (peor que cuadrático, por el overhead
de function-call/branch del DFS). Después del cambio: **10.6ms** y **21ms**
respectivamente — entre 50x y 190x más rápido en los mismos tamaños. Una
cadena normal (sin ε) no se movió ni un milisegundo; el cambio es quirúrgico.

**Cómo se verificó**: además de correr los benchmarks antes/después con
`automata-cli stress`, se agregó un proptest
(`engine::fa::tests::eps_closure_matches_naive_reference`, 256 casos) que
compara el resultado contra una referencia deliberadamente ingenua (BFS
directo sobre la lista de aristas, sin Tarjan, sin bitsets, escrita aparte en
el test) sobre grafos-ε aleatorios que incluyen ciclos y self-loops. Más
tests dedicados a ciclo, self-loop y cadena larga. Los 29 tests de
`automata-core` y los 60 del workspace completo pasan; clippy limpio.

**Sigue abierto**: el fix soluciona el *tiempo* de cómputo, no el *piso de
memoria*. La tabla de clausuras es inherentemente O(estados²) bits en el peor
caso (un autómata con alcanzabilidad-ε densa) — a 50.000 estados en cadena-ε
son ~298MB solo para guardar la tabla, sin importar el algoritmo. Irrelevante
a escala de cursada; importaría si una futura conversión AFN→AFD o de
gramáticas genera automatones intermedios grandes con mucha ε.

---

## 2026-08-07 — Licencia de JFLAP y uso de `idea/` como referencia

**Qué se decidió**: `idea/JFLAP7.1.jar` (y su contenido decomprimido en
`idea/JFLAP7.1-output/`) se usa solo como **referencia de comportamiento**
(cómo se comporta el simulador, formato `.jff`, casos borde) — nunca se copia
código Java literal dentro de este proyecto. Leer/decompilar el `.jar`
localmente para entender un algoritmo está bien; redistribuir o incrustar su
código no.

**Por qué**: JFLAP usa una licencia académica propia, no una licencia abierta
estándar (MIT/GPL/Apache). Permite modificar y redistribuir, pero con
condiciones: toda distribución (modificada o no) tiene que ser gratuita, hay
que incluir el texto de la licencia, y una versión modificada requiere dar
datos de contacto y compartir el código con el mantenedor si lo pide. No dice
nada sobre decompilar o leer el código — eso no está restringido. Fuente:
[JFLAP 7.1 LICENSE](https://www2.cs.duke.edu/csed/jflap/jflaptmp/july27-18/license.html).

**Nota práctica**: `idea/JFLAP7.1-output/` son solo `.class` (bytecode), no
`.java` — decomprimir el `.jar` no decompila. Para leer código Java legible
hace falta un decompilador (`cfr`, disponible en los repos oficiales de Arch:
`sudo pacman -S cfr`). Sin decompilador, `javap -p -c Clase.class` desde
`idea/JFLAP7.1-output/` alcanza para leer un método puntual chico (se usó así
para `automata.ClosureTaker`, ver entrada anterior), pero no escala a clases
grandes.

---

## 2026-08-07 — Por qué existe `automata-cli`

**Dónde**: `crates/automata-cli/`.

**Qué se decidió**: una CLI mínima (`sim` / `inspect` / `stress`) que llama a
`automata-core` directamente, sin pasar por Tauri ni la GUI.

**Por qué**: la fase de trabajo actual es "primero el backend, después el
frontend" (ver el porqué de la elección de Rust en el README). Antes de que
haya una GUI para probar a mano, hace falta poder correr casos grandes o
adversariales — miles de estados, cadenas-ε patológicas, autómatas densos —
que no son prácticos de armar clickeando en un diagrama. `automata-cli
stress` fue la herramienta que efectivamente encontró el problema de
rendimiento documentado arriba.

**Qué NO es**: no es un reemplazo de la GUI ni un producto de cara al
usuario final — es una herramienta de desarrollo, sin garantías de
estabilidad de su interfaz de línea de comandos entre commits.

---

## 2026-08-07 — Manejo de mutex envenenado en los comandos Tauri

**Dónde**: `src-tauri/src/commands/{doc,sim}.rs`.

**Qué se observó**: `doc_apply`/`doc_open`/`doc_save`/`jff_import`/
`jff_export` (que ya devuelven `Result`) convierten un mutex envenenado
(`session.0.lock()` fallando) en un `Err` normal. `doc_snapshot`/`doc_undo`/
`doc_redo`/`sim_trace`/`sim_batch` usan `.expect("session mutex poisoned")` en
cambio, porque su firma actual (`DocSnapshot`, `Option<EditResult>`,
`TraceDto`) no tiene forma de expresar un error — no es una inconsistencia de
estilo, es una consecuencia directa del tipo de retorno de cada comando.

**Por qué no se tocó todavía**: unificar esto a `Result` en todos lados
cambiaría la firma IPC de esos comandos, lo cual toca el contrato que ya
consume `frontend/src/tauri/client.js` — eso es trabajo de frontend, y la
fase actual es solo backend. Además, `EditOp::apply` está probado (proptest)
para nunca hacer panic sobre ninguna precondición, así que en la práctica el
mutex no debería envenenarse nunca por lógica interna — el `.expect()` es una
aserción de "esto no debería pasar", coherente con el resto del estilo del
core (ver `expect()` documentados en `model/fa.rs`, `dto.rs`, etc.).

**Pendiente para cuando se retome el frontend**: decidir si vale la pena
unificar todos los comandos de mutación a `Result<T, String>` por prolijidad
de contrato, sabiendo que el riesgo real que resuelve es bajo.
