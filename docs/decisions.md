# Decisiones técnicas

Registro de decisiones de ingeniería no obvias — el *por qué* detrás de partes
del código que no se explican solas leyendo el código o el `git log`. Cada
entrada es corta: qué se decidió, por qué, y cómo se verificó. Vive en el
repo (no solo en memoria de sesiones de IA) para que sea legible por
cualquiera que retome el proyecto, humano o asistente.

Orden cronológico, más reciente arriba.

---

## 2026-08-23 — Autómata de Pila: capa de IPC de Tauri, transiciones direccionables individualmente vía patches por `TransitionId`

**Dónde**: `src-tauri/src/pda_ipc.rs`, `src-tauri/src/commands/pda.rs`
(nuevos); `state.rs` (`PdaSession`); `lib.rs`/`commands/mod.rs` (registro);
`src-tauri/tests/pda_ipc.rs` (7 tests), `pda_resync_invariant.rs` (2 tests).

**La única diferencia estructural real frente a `moore_ipc.rs`**: los edges
de Moore son un solo payload por par `(from,to)` (`EdgeInputsSet`), pero las
transiciones de PDA son direccionables individualmente — pueden coexistir
varias entre el mismo par de estados con distinto `(input,pop,push)`. En vez
de un patch "reemplazá todo el payload de este edge", hay tres patches por
`TransitionId`: `TransitionAdded`/`TransitionRemoved`/`TransitionEdited`.
Esto en la práctica simplifica el diffing de transiciones respecto al de
Moore: el `TransitionId` solo (estable, nunca se reusa — ver el doc comment
de `model::pda`) identifica una transición entre snapshots sin necesitar una
clave compuesta `(from,to)`.

`PdaEditOpDto` excluye `RestoreState`/`RestoreTransition` (undo-only, nunca
cruzan el borde IPC), mismo criterio que `MooreEditOpDto`.

`pda_sim` difiere de `moore_sim`: la simulación de PDA es genuinamente no
determinista (`run_pda` devuelve un `Trace` con ramificación completa, no
una secuencia de salida determinista), y necesita un parámetro `accept_by`
(`AcceptByDto::{Final,Empty}`, nombrado para calzar con el flag
`--accept-by` ya existente en `automata-cli`) porque el modo de aceptación
es una elección de cada corrida, nunca estado del documento.
`PdaConfigView.stack` se sirve en orden tope-primero (invertido respecto a
la representación interna de `PdaConfig`, donde el último elemento es el
tope) — el orden de lectura natural para una UI.

**Verificado**: leí el diff completo de `state.rs`/`lib.rs`/`commands/mod.rs`
(puramente aditivo) y el contenido de `pda_ipc.rs`/`commands/pda.rs` antes de
commitear. `cargo build --manifest-path src-tauri/Cargo.toml` compila limpio
(los macros `#[tauri::command]` a veces esconden errores de tipos que
`cargo check` sobre la lib no detecta). `cargo test --workspace` 100% verde:
`automata-core` se mantiene en 185 (esta ronda no toca el backend), suma de
`pda_ipc`/`pda_resync_invariant` +9 tests, reproducido de forma
independiente yo mismo, no solo confiado del reporte del agente. Un test
dedicado cubre el caso genuinamente nuevo de PDA: dos transiciones
compartiendo `(from,to)` sobreviviendo edit/undo/redo/diffing de forma
individual sin interferirse.

---

## 2026-08-19 — Autómata de Pila: backend vía el `Machine` trait genérico, primer uso real de `run_bounded`

**Dónde**: `crates/automata-core/src/model/pda.rs`, `pda_doc.rs`,
`engine/pda.rs` (nuevos); `engine/mod.rs` (fix real, ver abajo); `dto.rs`
(variante `Pda`); `automata-cli` (`pda-inspect`/`pda-sim --accept-by`).

**Verificado contra JFLAP real antes de diseñar nada** (decompilado con
`cfr`: `automata/pda/{PDATransition,PushdownAutomaton,PDAConfiguration,
PDAStepByStateSimulator,PDAStepWithClosureSimulator,CharacterStack}.class`):
PDA sí tiene estados de aceptación (`PushdownAutomaton extends Automaton`
directo). Cada transición es `(input, pop, push)` independiente — puede
haber varias entre el mismo par de estados, así que a diferencia de FA/
Mealy/Moore (un solo "paquete" por par `(from,to)`), acá las transiciones
son una lista plana direccionable por id propio. El modo de aceptación
(pila vacía vs. estado final) es una elección de cada corrida de
simulación, JFLAP la pregunta por diálogo — **no se guarda en el
autómata**. La pila arranca siempre con un símbolo `"Z"` empujado antes de
correr cualquier entrada, convención fija de JFLAP.

**Primer uso real del trait `Machine`/`run_bounded`** (`engine/mod.rs`) que
ya estaba pensado para esto desde su propio comentario de diseño ("for a
future PDA, `(StateId, Stack)`") — a diferencia de Mealy/Moore, que
necesitaban semántica determinista de transductor y por eso NO podían usar
ese motor genérico (tienen su propio stepper de un solo estado vivo).
`PdaEngine` implementa `Machine` con `Config = (StateId, Vec<SymbolId>)`
(último elemento = tope de pila), y reusa `run_bounded`/`Outcome`/`Trace`
tal cual, sin inventar equivalentes propios.

**Bug real encontrado y arreglado en código compartido** (`run_bounded`):
al agotar el input, la función marcaba `any_exhausted=true` y hacía
`continue`, saltándose el `step()` de esa configuración por completo — para
una máquina cuyo `step` puede consumir cero símbolos (movimientos-ε; PDA
vaciando pila sin más entrada que leer, o una futura MT), eso descartaba en
silencio cualquier progreso-ε útil después de que el input se agotara —
justo lo que un PDA necesita todo el tiempo para aceptar por pila vacía.
JFLAP real sigue explorando esos casos. Arreglado llamando siempre a
`step()`, sin `continue`, y rastreando `any_exhausted` aparte. **Cero
cambio de comportamiento para AFD/AFN**: confirmado leyendo
`FaEngine::step` — ya se autoguarda con `if at >= input.len() { return
SmallVec::new(); }`, así que el fix solo agrega una llamada que ya
devolvía vacío. `cargo test --workspace` sigue 100% verde (185 tests de
`automata-core`, reproducido de forma independiente).

**Cómo se verificó**: PDA de `{a^n b^n}` construido a mano (empuja `A` por
cada `a`, un movimiento-ε adivina el cambio de fase, saca `A` por cada `b`,
otro movimiento-ε saca la `Z` del fondo una vez expuesta) — corroborado con
`automata-cli pda-sim` para ambos modos de aceptación, reproducido de forma
independiente con un fixture JSON propio, no solo confiando el reporte:
`""`, `"a b"`, `"a a b b"` → aceptado en ambos modos; `"a a b"`
(desbalanceado) → **aceptado por estado final, rechazado por pila vacía**
— el caso que prueba que los dos modos corren lógica genuinamente distinta,
no una bandera sin efecto; `"a b b"` → atascado en ambos modos.

**Hallazgo pendiente de decidir, no bloqueante**: al escribir el proptest
de undo/redo de PDA se notó que los de Mealy y Moore (`mealy_doc.rs`/
`moore_doc.rs`, ya commiteados) declaran un `Vec<StateId>` para rastrear
ids creados pero nunca insertan en él tras un `AddState` exitoso — sus 256
casos de proptest en la práctica solo ejercitan `AddState`, nunca
`RemoveState`/`MoveState`/`RenameState`/`SetInitial`/edición de aristas,
aunque ambos proptests siguen pasando (no hay ningún bug real detrás, solo
cobertura más débil de lo que aparenta). El de PDA se escribió leyendo
`doc.states()`/`doc.transitions()` en vivo en vez de un vector aparte,
evitando el mismo problema. Pendiente decidir si vale la pena portar el
arreglo a Mealy/Moore.

## 2026-08-19 — Moore queda completo: Tabla de estados y Definición formal, δ y λ como funciones separadas

**Dónde**: `frontend/src/views/mooreTable/{MooreTableView,mooreTableLogic}.js`,
`.../mooreFormal/{MooreFormalView,mooreFormalLogic}.js`,
`.../store/applyMooreModel.js` (nuevos), `main.js`.

**Cierra Moore Machine de punta a punta** — backend, IPC, diagrama, tabla,
definición formal, simulación, atajos/menú contextual/importar-exportar —
al mismo nivel que quedó Mealy.

**La tabla suma una columna "Salida"** que Mealy no tiene (justo después de
"Estado", antes de las columnas de alfabeto) — editable, vacío limpia la
salida (`SetOutput{state, output:null}`). Cada celda de alfabeto muestra
solo el estado destino, sin el par `destino/salida` de la tabla de Mealy,
porque la salida de Moore no es por-transición.

**La definición formal separa δ y λ en dos líneas distintas** (`δ(desde,
entrada) = hasta` por transición, `λ(estado) = salida` por cada estado con
salida no nula) — a diferencia de la línea combinada `δ(desde,entrada)=
hasta/salida` de Mealy. No es una elección de estilo: en Moore δ y λ son
funciones genuinamente separadas (δ: Q×Σ→Q, λ: Q→Δ), mientras que en Mealy
una sola función δ: Q×Σ→Q×Δ ya combina ambas — la notación de cada vista
refleja la diferencia real, no busca uniformidad forzada entre las dos.

**Cómo se verificó**: 543/543 tests de frontend (55 nuevos). `vite build`
limpio. No se levantó un dev server para esta ronda — montar dos vistas
nuevas en pestañas ya construidas y vacías (`mooreUpperTabs`, creadas en la
ronda anterior específicamente para esto) es de bajo riesgo estructural, y
`main.js` confirmado con solo 2 imports + 2 llamadas de montaje, sin
cambios de estructura.

## 2026-08-19 — Frontend de Moore (editor completo desde el arranque) y `switchMode` generalizado a N modos

**Dónde**: `frontend/src/store/MooreDocStore.js`, `.../commands/{MooreContext,
mooreRegistry}.js`, `.../views/mooreDiagram/{MooreDiagramView,MooreToolbar,
MooreSimView,mooreLogic}.js`, `.../views/toolbar/EditorModeSelect.js`,
`.../tauri/client.js`, `main.js`, `style.css`.

**A diferencia de la primera ronda de Mealy, esta ronda de Moore nace con
paridad completa** (registry propio + atajos de teclado + menú contextual +
importar/exportar) en vez de dejarlo para una ronda de pulido posterior —
ya se conocía el patrón completo de haberlo construido una vez para Mealy,
así que no tenía sentido repetir el mismo camino de "v1 recortada, pulido
después".

**`switchMode`/`EditorModeSelect` dejaron de estar hardcodeados a dos
modos**: con Moore como tercer modo real y Pila/Turing todavía pendientes
en la hoja de ruta, mantener un toggle booleano (`showMealy = mode ===
"mealy"`) habría significado reescribirlo de nuevo en cada máquina nueva.
Ahora `main.js` arma un registro `modes = { finite, mealy, moore } ->
{label, appBody, toolbar}`, `switchMode` itera ese registro (oculta todas
las toolbars salvo la del modo destino, reemplaza el `app-body` actual por
el del modo destino solo si cambió), y `menuBar.root.hidden = mode !==
"finite"` en vez del `showMealy` de antes. `EditorModeSelect` recibe la
lista de modos reales por parámetro (`hooks.modes`, con default de los tres
actuales) en vez de tener `FINITE_VALUE`/`MEALY_VALUE` fijos en el módulo —
listo para que Pila/Turing solo necesiten agregar una entrada más el día
que tengan editor propio.

**Diferencias reales de Moore frente a Mealy en el editor, todas
consecuencia directa de que la salida vive en el estado, no en la arista**
(ver la entrada de backend de Moore, más abajo): las aristas del canvas
muestran solo el símbolo de entrada (sin el par entrada/salida de Mealy);
cada círculo de estado tiene una segunda línea de texto más chica debajo
mostrando su salida (`.state-output-label`, nuevo, sin equivalente en
Mealy/AFD-AFN); el menú contextual y la toolbar suman una acción nueva sin
equivalente en Mealy, `state.setOutput` ("Fijar salida"), con botón propio
en la toolbar además de estar en el menú contextual.

**`MooreContext` suma `promptInput`/`promptOutput`** como hooks separados
(no una reutilización forzada de `promptLabel`/`promptTransition` de
Mealy) porque tienen sitios de uso y semántica genuinamente distintos —
símbolo de entrada de una arista vs. salida de un estado.

**Cómo se verificó**: 488/488 tests de frontend (83 nuevos). `vite build`
limpio. Verificado en vivo en un dev server temporal (cerrado después): el
ciclo de tres modos (AFD/AFN → Moore → Mealy → AFD/AFN) confirmado correcto
a nivel DOM (toolbar oculta por modo, `menu-bar` alternando `display:flex`/
`none`, canvas correcto montado en cada paso) y capturado en pantalla el
editor de Moore completo (toolbar V/S/T/D + Marcar inicial + Fijar salida,
Abrir/Guardar, pestañas Tabla de estados/Definición formal/Simular). No se
verificó interacción de canvas en vivo (crear estado, ver la sub-etiqueta
de salida) — mismo límite ya documentado de sesiones anteriores: sin
backend Tauri real, `docStore.apply` no funciona en el dev server suelto, y
inyectar el DOM a mano para simularlo ya demostró ser poco confiable en una
ronda anterior (ver la entrada de pulido de Mealy sobre el menú contextual)
— cubierto en su lugar por un test dedicado de vitest para esa ruta de
render.

**Pendiente**: Tabla de estados y Definición formal de Moore (las pestañas
ya existen, vacías, montadas en `mooreUpperTabs` — decisión deliberada para
no tener que retocar `main.js` de nuevo la próxima ronda).

## 2026-08-19 — Capa IPC de Moore: `MooreSession` propia, espejo de `mealy_ipc.rs` con `StateOutputSet`

**Dónde**: `src-tauri/src/moore_ipc.rs`, `commands/moore.rs` (nuevos),
`state.rs` (`MooreSession`), `lib.rs`/`commands/mod.rs` (registro).

**Espejo casi exacto de `mealy_ipc.rs`**, con una diferencia estructural
real: `MooreEdgeView`/`MooreDocPatch` no tienen nada parecido a los pares
`(input, output)` de Mealy — una arista de Moore solo lleva símbolos de
entrada (`inputs: Vec<String>`), porque la salida vive en el estado. Eso
agrega una variante nueva sin equivalente en Mealy: `MooreDocPatch::
StateOutputSet { id, output: Option<String> }`, espejo IPC de
`MooreEditOp::SetOutput` — se emite tanto en un `SetOutput` directo como
junto a `StateAdded` cuando un estado recién creado ya trae salida seteada
(mismo patrón que ya usa `StateInitialSet` al agregar un estado inicial).

**Cómo se verificó**: `cargo test --workspace` 100% verde — reproducido de
forma independiente, no solo confiado del reporte — incluyendo los 6 tests
nuevos de `moore_ipc.rs` y los 2 de `moore_resync_invariant.rs` (prueba de
que `MooreDocMirror` reproduce el snapshot real vía replay de patches).

**Pendiente**: frontend de Moore (siguiente ronda) — mismo orden que Mealy.

## 2026-08-19 — Máquina de Moore: backend aislado (`MooreDoc`), salida en el estado no en la arista

**Dónde**: `crates/automata-core/src/model/moore.rs`, `moore_doc.rs`,
`engine/moore.rs` (nuevos); `dto.rs` (variante `Moore`), `automata-cli`
(`moore-inspect`/`moore-sim`).

**Verificado contra JFLAP real antes de diseñar nada**: se decompiló
`automata/mealy/{MooreMachine,MooreTransition,MooreStepByStateSimulator}.class`
con `cfr` (misma técnica que para Mealy). Confirmado: `MooreMachine` guarda
la salida en un `Map<State, String>` — la salida es del ESTADO, no de la
transición. `MooreTransition extends MealyTransition` pero sobrescribe
`getOutput()`/`setOutput()` para delegar al estado destino; una transición
de Moore en sí no lleva salida propia, solo un símbolo de entrada.
`MooreStepByStateSimulator` emite la salida del estado inicial ANTES de
consumir ningún símbolo — para una entrada de n símbolos, la secuencia de
salida tiene longitud n+1 (Mealy tiene longitud n).

**Por qué `MooreDoc` es un modelo aislado, no una generalización de
`MealyDoc`**: mismo principio que la decisión "opción B" de Mealy (ver esa
entrada más abajo) — acá la forma de los datos es genuinamente distinta
(salida en el estado vs. salida por-símbolo-por-arista), así que
generalizar habría significado que ambos modelos carguen con un campo que
al otro no le sirve. `MooreStateMeta.output: Option<SymbolId>` (estado),
aristas `HashMap<(StateId,StateId), BTreeSet<SymbolId>>` de solo símbolos
de entrada (sin salida por símbolo, a diferencia de Mealy). Sin estados de
aceptación (misma razón que Mealy) y sin transiciones-ε (mismo criterio
simplificador ya aplicado a Mealy, para mantener el modelo mental uniforme
entre los dos tipos de transductor del proyecto).

**Cómo se verificó**: `cargo test --workspace` 100% verde (153 tests de
`automata-core` incluyendo los nuevos de Moore, más 256 casos de proptest
de round-trip undo/redo). Autómata de paridad de 'a' construido a mano
(q0="even", q1="odd", 'a' alterna, 'b' hace self-loop) y corroborado con
`automata-cli moore-sim` sobre un fixture JSON escrito a mano — reproducido
de forma independiente, no solo confiado del resultado reportado:
`moore-inspect` → 2 estados, 4 transiciones, determinista=true;
`moore-sim --input ""` → `"even"`; `moore-sim --input "a b a a"` →
`"even odd odd even odd"`; `moore-sim --input "b b b"` →
`"even even even even"` — los tres coinciden con el cálculo a mano.

**Pendiente**: capa de IPC de Tauri y frontend (siguiente ronda), mismo
orden que se siguió para Mealy.

## 2026-08-19 — Mealy: Tabla de estados y Definición formal, MenuBar oculto fuera de modo AFD/AFN

**Dónde**: `frontend/src/views/mealyTable/{MealyTableView,mealyTableLogic}.js`
(nuevos), `frontend/src/views/mealyFormal/{MealyFormalView,mealyFormalLogic}.js`
(nuevos), `frontend/src/store/applyMealyModel.js` (nuevo, equivalente Mealy de
`applyAutomatonModel.js`), `main.js`, `style.css`.

**Qué cerraba esto**: los dos últimos ítems que quedaban explícitamente
pendientes de Mealy — Tabla de estados y Definición formal equivalentes, y
que `MenuBar` (Archivo/Editar/Ver/Convertir/Test, todo específico de AFD/AFN)
quedara visible sin sentido en modo Mealy.

**Tabla y Definición formal, adaptadas a la ausencia de estados de
aceptación**: el prefijo `"->"` en el nombre de estado sigue marcando
inicial, pero no existe el `"*"` de aceptación (Mealy no tiene `F`). Cada
celda de la tabla combina destino y salida (`estado/salida`) en vez de solo
el estado destino, porque una transición de Mealy produce una salida por
cada símbolo de entrada leído, no solo un estado siguiente — la misma
convención `input/output` ya usada en el diagrama y ahora también en la
tabla y en la definición formal (una sola línea `δ(desde, entrada) =
hasta/salida` en vez de separar δ y λ), para no introducir una cuarta
notación distinta entre los tres editores de Mealy. La 6-tupla usa `Δ` para
el alfabeto de salida (`M=(Q,Σ,Δ,δ,λ,q0)`, notación estándar de libro de
texto) — no se encontró la notación formal propia de JFLAP para Mealy en
`idea/`, así que no está verificada contra el original, es una elección
razonable pero no confirmada.

**`MealyDoc::set_initial` reemplaza en silencio, sin aviso de colisión** (a
diferencia de la tabla de AFD/AFN, que sí muestra un aviso al chocar
nombres): confirmado leyendo `model/mealy.rs` — es un único slot
`Option<StateId>`, no hay nada que rechazar. La tabla de Mealy no necesita
esa lógica de aviso porque no hay forma de que la operación falle.

**`MenuBar` se oculta con el mismo patrón que ya usan las dos toolbars**:
`menuBar.root.hidden` se togglea en `switchMode` exactamente igual que
`faToolbar.root.hidden`/`mealyToolbar.root.hidden`. Iba a ocurrir el mismo
bug de cascada CSS de siempre (`.menu-bar { display: flex }` de autor le
gana al `[hidden]` default del navegador) — esta vez se anticipó y se agregó
`.menu-bar[hidden] { display: none; }` directamente, sin tener que
encontrarlo en vivo primero (ya es la 4ª vez que aparece esta clase de bug
en el proyecto: `.toolbar`, `.menu-dropdown`, `.verdict`/`.trace-row`/
`.testing-batch-table`, y ahora `.menu-bar`).

**`MealySimView` pasó a vivir dentro de un tab** (`mealyUpperTabs`, mismo
mecanismo `createTabs` que ya usa el lado de AFD/AFN) en vez de montarse
directo en `mealyPanelUpper` — necesario para que conviva con las dos
pestañas nuevas ("Tabla de estados", "Definición formal", "Simular").

**Cómo se verificó**: 405/405 tests de frontend (44 nuevos). `vite build`
limpio. Verificado en vivo en un dev server temporal (cerrado después): el
`display` de `.menu-bar` alterna `flex`/`none` correctamente en ambas
direcciones al cambiar de modo, y las tres pestañas de Mealy renderizan y
cambian bien, incluyendo la definición formal mostrando la 6-tupla vacía sin
línea de `F`.

---

## 2026-08-19 — Mealy: pulido final — registry propio, atajos/menú contextual, importar/exportar por UI

**Dónde**: `frontend/src/commands/{mealyRegistry,mealyRegistry.test}.js` (nuevo),
`.../commands/MealyContext.js` (hooks `openFile`/`saveFile`),
`.../views/mealyDiagram/{MealyDiagramView,MealyToolbar}.js` y sus `.test.js`,
`.../ui/nativeDialog.js` (`pickOpenJsonPath`/`pickSaveJsonPath`), `main.js`,
`style.css`.

**Qué cerraba esto**: la ronda anterior había dejado explícitamente afuera
"menú contextual/atajos de teclado (sin registry propio para Mealy)" e
"importación/exportación de archivo por UI". Ambos se resuelven acá.

**`mealyRegistry.js` es un array separado de `commands/registry.js`, no una
generalización**: mismo shape (`id`/`group`/`keybinding`/`when`/`run`), pero
`run(ctx)` recibe un `MealyContext`, no un `ViewContext` — mantenerlos
separados hace estructuralmente imposible mezclar el context equivocado.
`keybindingOf` sí se reexporta tal cual desde el registry de AFD/AFN (es pura,
normaliza un `KeyboardEvent`, nada específico de FA). El viejo método ad-hoc
`MealyDiagramView.markInitial()` se eliminó: tanto el botón de la toolbar
como el ítem del menú contextual ahora llaman a la misma acción del registry
(`state.markInitial`), eliminando la duplicación de lógica que tenía antes.

**Menú contextual sin `state.toggleAccepting`**: Mealy no tiene estados de
aceptación (ver la entrada de backend de esta misma fecha, más abajo, sobre
por qué `MealyDoc` no tiene flag `accepting`), así que el menú de clic derecho
solo ofrece `state.rename` / `state.markInitial` / `edit.deleteSelection`.

**Importar/exportar es JSON nativo únicamente, sin `.jff`** — decisión
explícita de alcance acotado: Mealy no tiene una representación `.jff`
razonable como transductor de un solo símbolo por transición, y no hay
necesidad de interoperar con JFLAP real acá. Botones "Abrir"/"Guardar" nuevos
en la barra de info del canvas (`.canvas-toolbar-right`, agregado para que
`justify-content: space-between` siga funcionando con el nombre de archivo a
la izquierda).

**Cómo se verificó**: 361/361 tests de frontend (32 nuevos: `mealyRegistry`,
`MealyContext` — primer archivo de tests dedicado para esa clase —, más los
ajustes de `MealyDiagramView`/`MealyToolbar` tras el refactor a registry).
`vite build` limpio. Verificado en vivo en un dev server temporal: cambio de
modo, badges de atajos (V/S/T/D) y activación de herramienta por teclado
confirmados visualmente. El menú contextual en sí se verificó por lectura de
código + los dos tests dedicados (`_onCanvasContextMenu` corta antes de
`preventDefault()` si el click no cae exactamente sobre
`event.target.dataset.stateId`, igual que `DiagramView` de AFD/AFN —
confirmado que es el mismo comportamiento ya probado, no una regresión; un
`<circle>` inyectado a mano en el DOM del dev server resultó poco fiable para
acertar el pixel exacto vía automatización de browser, así que no vale la
pena forzar esa verificación en vivo cuando la lógica ya está cubierta por
tests + lectura de código).

**Pendiente todavía para Mealy** (no bloqueante, para una ronda futura):
Tabla de estados y Definición formal equivalentes; `MenuBar.js` sigue siendo
solo de AFD/AFN y queda visible sin cambios en modo Mealy (con menús tipo
"Convertir" que no aplican) — no evaluado todavía si eso confunde.

---

## 2026-08-19 — Frontend de Mealy: editor de canvas real, "Editor" pasa a ser un cambio de modo de verdad

**Dónde**: `frontend/src/store/MealyDocStore.js`, `.../commands/MealyContext.js`,
`.../views/mealyDiagram/{MealyDiagramView,MealyToolbar,MealySimView,mealyLogic}.js`,
`.../views/toolbar/EditorModeSelect.js` (nuevo, extraído de `Toolbar.js`),
`.../main.js`, `.../style.css`.

**Alcance de esta ronda (v1, explícitamente recortado)**: canvas arrastrable
completo (crear/mover/seleccionar/borrar estados y transiciones, pan/zoom,
undo/redo real vía `mealy_apply`), "Marcar inicial" por botón, y un panel
"Simular" (una entrada, un resultado — sin lote ni traza paso a paso).
**Deliberadamente afuera todavía**: Tabla de estados/Definición formal
equivalentes para Mealy, importación/exportación de archivo por UI (el
comando `mealy_open`/`mealy_save` ya existe, falta el botón), menú
contextual/atajos de teclado (sin registry propio para Mealy). Se puede
sumar en una ronda futura sin tocar lo que ya está.

**Reuso real, no solo declarado**: `views/diagram/geometry.js` (`circleLayout`,
`edgeEndpoints`, `preferredLoopAngle`, `selfLoopPath`, `curvedEdgePath`,
`nextStateLabel`) se importa tal cual en `MealyDiagramView.js` — nada de esa
matemática de curvas es específica de AFD/AFN, así que no hubo que
reescribirla. `MealyContext.renameState` reusa `renameState.js`'s
`wasRenamed` (también genérico).

**El dropdown "Editor" ahora SÍ es un cambio de modo real** para "Máquina
de Mealy" (no un salto tipo menú como Regex/Gramática) — al elegirlo queda
seleccionado, no vuelve solo a "Autómata Finito". Esto obligó a sacar el
`<select>` de `Toolbar.js` (`EditorModeSelect.js`, nuevo componente): la
selección tiene que seguir visible y funcional sin importar cuál de las dos
toolbars de herramientas (`Toolbar` de AFD/AFN, `MealyToolbar`) esté
mostrándose en un momento dado — antes vivían juntos en un solo `.toolbar`.
`main.js` arma dos `app-body` completos (uno por documento) y hace
`replaceWith` entre ellos al cambiar de modo; las dos toolbars de
herramientas se ocultan/muestran vía `.root.hidden`.

**Bug real encontrado en vivo, mismo patrón que ya pasó dos veces antes**:
`.toolbar[hidden]` no ocultaba nada — `.toolbar { display: flex; ... }` (regla
de autor) le sigue ganando a la regla default `[hidden] { display: none }`
del navegador (user-agent), sin importar especificidad ni orden — exactamente
el mismo bug que ya afectó a `.menu-dropdown[hidden]` y a
`.verdict`/`.trace-row`/`.testing-batch-table[hidden]` en rondas anteriores.
Encontrado navegando la app real (jsdom no aplica cascada CSS de verdad, así
que ningún test unitario lo iba a agarrar) — arreglado con
`.toolbar[hidden] { display: none; }` explícito.

**Cómo se verificó**: 329/329 tests de frontend (52 nuevos: `MealyDocStore`,
`MealyContext`/`MealyDiagramView`/`MealyToolbar`/`MealySimView`/`mealyLogic`,
`EditorModeSelect`, más el ajuste de `Toolbar.test.js` tras sacarle el
`<select>`). `vite build` limpio. Verificado en vivo en un dev server
temporal: cambio de modo bidireccional (AFD/AFN ↔ Mealy) con la toolbar y el
canvas correctos en ambas direcciones, y el flujo completo de creación de
estado confirmado hasta el límite conocido del entorno (mismo `TypeError`
de `invoke` de siempre, sin backend Tauri real ahí — no un bug nuevo).

---

## 2026-08-19 — Capa IPC de Mealy: `MealySession` propia, espejo completo de `ipc.rs`, sin tocar la de AFD/AFN

**Dónde**: `src-tauri/src/state.rs` (`MealySession`), `.../mealy_ipc.rs`
(nuevo, ~330 líneas), `.../commands/mealy.rs` (nuevo), `.../lib.rs`,
`src-tauri/tests/mealy_ipc.rs` (nuevo), `.../mealy_resync_invariant.rs`
(nuevo).

**El alcance real, dicho antes de tocar código**: se le mostró al usuario
que "conectar Mealy" no es agregar comandos — `ipc.rs` (la capa de diffing
FA↔frontend) tiene 443 líneas, y del lado frontend hace falta un
`DocStore`/`DiagramView` en paralelo. El usuario, ya sabiendo eso, eligió
paridad completa con AFD/AFN en vez de una versión simplificada. Esta
entrada cubre solo la mitad backend (Tauri); el frontend queda para la
siguiente ronda.

**`MealySession` separada, no una variante de `Session`**: mismo criterio
"aislar, no generalizar" que ya se usó para `MealyDoc` vs `FaDoc`. Tauri
gestiona (`.manage(...)`) ambas sesiones siempre, indistintamente de qué
modo esté mostrando el frontend en un momento dado — solo importa cuál
conjunto de comandos IPC se está llamando.

**`mealy_ipc.rs` espeja `ipc.rs` pieza por pieza**, con las mismas
diferencias ya documentadas para `MealyDoc` propagadas hacia el DTO: sin
`accepting` en `StateView`; `EdgeView.transitions: Vec<(String,String)>` en
vez de `epsilon`+`symbols`; `Derived` con `input_alphabet`/
`output_alphabet` separados y `deterministic: bool` en vez de
`classification: "Dfa"|"Nfa"`; `DocPatch::StateInitialSet` en vez de
`StateFlagsSet` (un solo flag por estado, no dos).

**Hallazgo real durante esta ronda**: se había asumido que `src-tauri` no
tenía tests en absoluto (`rg "cfg(test)" src-tauri/src/` no encuentra
nada) — pero `src-tauri/tests/` sí los tiene, como archivos de integración
separados (`doc_apply.rs`, `jff_interop.rs`, `resync_invariant.rs`,
`sim_trace.rs`), incluyendo un `DocMirror` que prueba estructuralmente el
invariante de resync (reproducir los patches sobre un espejo local debe
dar exactamente el mismo resultado que un `doc_snapshot` fresco). Los
tests para Mealy se habían escrito primero como un `#[cfg(test)] mod
tests` inline dentro de `commands/mealy.rs` — se movieron a
`src-tauri/tests/mealy_ipc.rs` (mismo patrón que `doc_apply.rs`) y se
agregó `MealyDocMirror` + `tests/mealy_resync_invariant.rs` espejando
`resync_invariant.rs`, para no dejar esta capa nueva con menos cobertura
que la que ya existía para AFD/AFN.

**Cómo se verificó**: 8 tests nuevos de integración contra una
`MealySession` real (`mealy_ipc.rs`: apply/snapshot/undo/redo/save-open/sim;
`mealy_resync_invariant.rs`: replay de patches idéntico a un snapshot
fresco, cubriendo cada variante de `MealyDocPatch`) — los 8 pasan, y los 15
tests preexistentes de la capa AFD/AFN siguen pasando sin cambios.
`cargo clippy -p app --all-targets -- -D warnings` limpio. `cargo test
--workspace` completo (todas las cajas) sin errores.

---

## 2026-08-19 — Máquina de Mealy: backend completo, aislado de `FaDoc` (opción B)

**Dónde**: `crates/automata-core/src/model/mealy.rs` (nuevo), `.../mealy_doc.rs`
(nuevo), `.../engine/mealy.rs` (nuevo), `.../dto.rs` (nuevo variante
`MachineDoc::Mealy` + funciones `mealy_*`), `crates/automata-cli/src/main.rs`
(`mealy-inspect`/`mealy-sim`).

**El orden recomendado y por qué Mealy es primero**: se comparó el orden
real del menú "New" de JFLAP (decompilado con `cfr` desde
`gui/action/NewAction.class`): Finite Automaton → **Mealy Machine → Moore
Machine** → Pushdown Automaton → Turing Machine → ... — Mealy/Moore van
antes que PDA en JFLAP real, no después como se asumió al principio.

**Por qué NO se extendió `FaDoc`/`SymbolSet` (opción A descartada)**: en
JFLAP, `MealyTransition extends Transition` agregando un campo (`myOutput`)
se ve "gratis" por herencia Java. En Rust no hay ese polimorfismo:
`SymbolSet` (`model/fa.rs`) agrupa varios símbolos por arista compartiendo
un solo flag `epsilon`, sin lugar para que cada símbolo tenga su propia
salida — que es justo lo que necesita Mealy (mismo origen→destino, distinta
salida según qué símbolo se lea). Generalizar `SymbolSet` habría sido el
primer cambio invasivo al modelo central en toda la sesión, arriesgando
regresiones en todo lo ya probado (jff interop, AFN→AFD, minimizar, regex,
gramática — todo lee `edge.symbols` directo). Se optó por la **opción B**:
`MealyDoc` genuinamente separado, con su propio `EditOp`/`Document`/
`History` (`mealy_doc.rs`) — duplica el mecanismo de undo/redo, pero deja
`FaDoc` intocado y arranca (antes de lo esperado) la arquitectura de
"Editor intercambiable" que sabíamos que iba a hacer falta.

**Qué SÍ se reutilizó, sin duplicar**: `ids::Arena<Id>` ya era genérico
(`StateId`/`SymbolId` son newtypes vía macro) — `MealyDoc` usa dos arenas
(`input_symbols`/`output_symbols`) del mismo tipo genérico, sin inventar
nada nuevo ahí. El enum `dto::MachineDoc` ya estaba diseñado para esto
(comentario propio: "v1 ships only `Fa`; unknown future kinds ... fail with
a message, never panic") — agregar `Mealy(MealyDto)` fue la extensión que
ese diseño anticipaba, no una sorpresa.

**Diferencias deliberadas de `FaDoc`** (documentadas en el doc-comment de
`model/mealy.rs`): sin flag `accepting` (verificado con `javap` sobre
`automata.mealy.MealyMachine`/`MealyStepByStateSimulator`: JFLAP lo hereda
de `Automaton` pero nunca lo lee para la semántica de Mealy — cargar un
campo que nada usa sería copiar sobras de herencia OOP, no una necesidad
real); sin transiciones ε (una transición Mealy lee exactamente un símbolo
y produce exactamente uno; una épsilon no tendría con qué emparejar una
salida).

**Motor de simulación separado del trait `Machine`**: `Machine`/
`run_bounded` (`engine/mod.rs`) están pensados para resultados
aceptar/rechazar sobre un *conjunto* de configuraciones que branchea —
Mealy no encaja ahí: lo que importa es el string de salida, y un Mealy
tiene que ser determinista para tener sentido como transductor síncrono. En
vez de branchear y "explorar" el no-determinismo, `run_mealy`
(`engine/mealy.rs`) avanza un solo estado vivo a la vez y **reporta** la
ambigüedad como resultado atascado (`MealyOutcome::Ambiguous`) en vez de
elegir una rama en silencio.

**Verificación por CLI con ejemplos calculados a mano** (pedido explícito
del usuario): se armó el Mealy de complemento a 2 en binario (LSB primero;
`q0` copia hasta el primer 1 inclusive, `q1` complementa el resto) como
fixture JSON nueva, y se corrió por `automata-cli mealy-sim` contra 4
entradas calculadas a mano por fuera del código:
- `1 0 1 1` → `1 1 0 0` (1101 → complemento a 2 = 1100, LSB primero)
- `0 0 0` → `0 0 0` (nunca aparece un 1, nunca complementa)
- `1 1 1 1` → `1 0 0 0`
- `0 1 0` → `0 1 1`

Las cuatro coincidieron exactamente. También se verificaron los tres casos
de error por CLI (`mealy-sim`/`mealy-inspect`): sin estado inicial, símbolo
sin transición, y una máquina a propósito no determinista (`mealy-inspect`
reportó `deterministic: false` correctamente).

**Cómo se verificó además**: 125 tests unitarios en `automata-core` (antes:
~113) — incluye dos proptests nuevos de 256 casos cada uno: round-trip
aplicar→deshacer sobre `MealyDocument` (mismo patrón que
`doc::history::apply_then_undo_round_trip`, sin encontrar ningún bug esta
vez) y round-trip guardar→cargar JSON de `MealyDto` (mismo patrón que el de
`FaDto`). `cargo check -p app` limpio — la capa Tauri no se tocó en
absoluto este round, a propósito: esto fue backend puro, verificado por
CLI; la conexión Tauri/frontend queda para la próxima ronda.

---

## 2026-08-19 — AFN→AFD / Minimizar AFD: transformación in-place, no reemplazo de documento

**Dónde**: `src-tauri/src/commands/convert.rs`, `src-tauri/src/lib.rs`,
`frontend/src/tauri/client.js`, `frontend/src/commands/context.js`,
`frontend/src/commands/registry.js`, `frontend/src/views/menubar/MenuBar.js`
(nuevo grupo "Convertir"), `frontend/src/main.js`,
`frontend/src/views/formal/formalLogic.js` (nuevo `docSnapshotToModel`),
`frontend/src/store/applyAutomatonModel.js` (nuevo, extraído de
`FormalView`).

**Por qué esto NO usa el patrón "reemplazo de documento completo" de
regex/gramática**: `nfa_to_dfa`/`minimize_dfa` son FA→FA, no FA→otra
representación — transforman el autómata que el usuario ya viene
construyendo, no cargan uno independiente. Con el patrón de
`conv_from_regex`/`conv_from_grammar` (`*doc = Document { model, history:
History::new(200), ... }`) se pierde el historial de undo — Ctrl+Z después
de "Convertir a AFD" no tendría nada que deshacer. Para una herramienta
donde deshacer es funcionalidad central en todos lados, eso es una
regresión real, no un detalle menor.

**Qué se hizo en cambio**: los comandos Tauri (`conv_nfa_to_dfa`/
`conv_minimize_dfa`) son de solo lectura — devuelven una *preview* (un
`DocSnapshot` armado sobre un `Document` descartable, nunca tocan la sesión
real) — y el frontend sincroniza el documento vivo contra esa preview a
través del camino normal de `docStore.apply`, reusando literalmente la
lógica que `FormalView` ya tenía para aplicar la definición formal editada:
`planStateDiff`/`planSyncOps` (`formalLogic.js`) no son específicas de la
vista de texto, son el primitivo general "hacé que el documento coincida
con este modelo con estados por etiqueta" — se extrajo la orquestación
(`docStore.apply` en dos tandas: agregar/quitar estados, resolver ids
recién asignados, después sincronizar transiciones/flags) a
`store/applyAutomatonModel.js`, y `FormalView._onApply` ahora es un
llamado de tres líneas a esa función en vez de duplicar la lógica. Un nuevo
`docSnapshotToModel` (pura, `formalLogic.js`) adapta un `DocSnapshot`
(id-addressed) a la misma forma que ya produce `parseFormalText` desde
texto — mismo consumidor, dos fuentes distintas. Resultado: Ctrl+Z deshace
una conversión exactamente igual que cualquier otra edición.

**Minimizar se deshabilita, no falla**: `minimize_dfa` rechaza un autómata
no determinista (`MinimizeError::NotDeterministic`, mensaje en inglés — a
diferencia de los parsers de regex/gramática, este NO es texto nuevo de
cara al usuario, es el mismo mensaje que ya imprime `automata-cli`). En vez
de dejar que el click falle con un aviso de error para el caso común
(todavía editando un AFN), la acción `convert.minimizeDfa` se gatea con
`when(ctx) => ctx.docStore.derived.classification === "Dfa"` — el ítem del
menú aparece visiblemente deshabilitado en vez de ofrecer un click que
sabemos de antemano que va a fallar.

**Nuevo grupo de menú "Convertir"**: ninguna de las dos acciones tiene un
lugar natural en el toolbar (no hay un ícono para "convertir"), así que
siguen el mismo criterio ya establecido para `edit`/`view`/`test`: si no
hay otra superficie visible, va al menú. `MENU_GROUP_TITLES` (`MenuBar.js`)
ya itera grupos genéricamente, así que agregar la entrada `convert:
"Convertir"` fue el único cambio necesario ahí — nada de lógica nueva de
renderizado.

**Cómo se verificó**: `cargo check -p app -p automata-core` limpio (no se
tocó lógica de `automata-core`, `nfa_to_dfa`/`minimize_dfa` ya estaban
probadas). 283/283 tests de frontend (18 nuevos, incluyendo 3 para
`applyAutomatonModel.js` de forma aislada — agregar+resolver id,
quitar-en-cascada, y el caso "ya coincide, cero llamadas a apply" — y el
gating habilitado/deshabilitado de `convert.minimizeDfa`). Refactor de
`FormalView` verificado sin regresión: sus 20 tests existentes siguen
pasando exactamente igual apuntando a la función extraída. `vite build`
limpio. Verificado en vivo: el menú "Convertir" aparece con sus dos
opciones.

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
