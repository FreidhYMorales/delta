# JFLAP (Rust + Tauri)

Editor y simulador de autómatas, pensado como reemplazo de [JFLAP](https://www.jflap.org/)
(Java/Swing) para la cursada. Core en Rust, UI de escritorio con Tauri 2
(frontend en JavaScript vanilla + Vite, sin frameworks).

## Por qué existe

JFLAP 7.1 es lento en máquinas grandes y su UI abruma a quien recién arranca.
En `idea/kflap-v0.1` hay un prototipo previo (Python + PySide6, hecho por un
compañero de cursada) que validó una UX mejor: tres vistas del mismo autómata
siempre sincronizadas (Diagrama, Tabla, Definición formal), más una vista de
verificación de cadenas. Ese prototipo se limitaba a AFD/AFN y dejaba
pendiente cualquier extensión futura (PDA, máquinas de Turing) sin diseño de
base para soportarla.

Este proyecto retoma esa UX y la reconstruye sobre un core en Rust diseñado
desde el principio para soportar autómatas finitos, de pila y máquinas de
Turing sin reescritura — priorizando rendimiento con grandes cantidades de
estados y una UI simple, no una réplica 1:1 de JFLAP.

`idea/JFLAP7.1.jar` se mantiene como referencia de comportamiento (formato
`.jff`, semántica de simulación), no como referencia de arquitectura.

## Alcance actual (v1)

- Autómatas finitos deterministas y no deterministas (AFD/AFN), incluyendo
  transiciones ε.
- Cuatro vistas sincronizadas: Diagrama, Tabla de estados, Definición formal,
  Verificación de cadenas (una cadena con traza paso a paso, o lote).
- Undo/redo transaccional.
- Persistencia nativa en JSON y compatibilidad de importación/exportación con
  el formato `.jff` de JFLAP (con reporte de pérdida cuando corresponde).
- Diálogos nativos de archivo vía Tauri (sin `window.prompt`).
- Conversión AFN→AFD (construcción de subconjuntos), incluyendo ε-transiciones.
- Minimización de AFD (partición de estados / algoritmo de Moore).
- AFD/AFN → gramática regular (lineal por la derecha), y de vuelta.
- AFD/AFN → expresión regular (eliminación de estados sobre GNFA), y de
  vuelta (construcción de Thompson).

Con esto, "Finite Automaton" — el primer editor del menú de JFLAP — está
completo según el alcance del propio JFLAP. Pendiente (no implementado
todavía): PDA, máquinas de Turing, Mealy/Moore, gramáticas
libres de contexto, y el resto del menú.

## Estructura

```
crates/automata-core/   core del dominio (sin UI): modelo, motor de
                         simulación, historial undo/redo, interop .jff
crates/automata-cli/    CLI directa sobre automata-core, sin pasar por
                         Tauri/GUI — ver "CLI de diagnóstico" más abajo
src-tauri/               capa Tauri: comandos IPC sobre automata-core
frontend/                UI (Vite + JS vanilla): registry de comandos,
                          DocStore, vistas (diagram/table/formal/testing)
idea/                     material de referencia (JFLAP7.1.jar, prototipo
                          kflap-v0.1) — no forma parte del build
docs/                     decisiones técnicas no obvias (el "por qué"
                          detrás de partes del código) — ver docs/decisions.md
ejercicios/               autómatas resueltos de enunciados de cursada,
                          generados por crates/automata-cli/examples/
                          exercises.rs — ver ejercicios/README.md
ejercicios/nfa/            enunciados AFN→AFD (unión, cierre de Kleene,
                          adivinanza no determinista) — ver
                          ejercicios/nfa/README.md
ejercicios/teoria-afnd/    diagramas AFND-ε tomados directo del material de
                          teoría — ver ejercicios/teoria-afnd/README.md
ejercicios/minimizacion/   AFD redundantes a propósito + minimizados, en
                          .json y .jff (para comparar contra JFLAP real) —
                          ver ejercicios/minimizacion/README.md
```

## Correr en desarrollo

Requiere Rust estable, Node.js y las dependencias del sistema de Tauri 2
([guía oficial](https://v2.tauri.app/start/prerequisites/)).

```bash
cargo tauri dev
```

Esto levanta el frontend (`npm run dev` en `frontend/`) y la ventana nativa.

## Tests

```bash
cargo test --workspace          # core + capa Tauri
npm test --prefix frontend      # vitest
```

## CLI de diagnóstico (`automata-cli`)

Además de los tests, `crates/automata-cli` da acceso directo a la lógica del
core sin pasar por la GUI — pensada para correr casos más grandes o más
adversariales de los que es práctico armar a mano en el diagrama.

```bash
# Cargar un documento nativo (.json) o JFLAP (.jff) y correrle una cadena
cargo run -p automata-cli -- sim --file archivo.jff --word "a b a" --trace

# Correr un lote de cadenas (una por línea, símbolos separados por espacio)
cargo run -p automata-cli -- sim --file archivo.json --words-file palabras.txt

# Ver estructura: cantidad de estados, alfabeto, clasificación AFD/AFN, etc.
cargo run -p automata-cli -- inspect --file archivo.jff

# Convertir un AFN (con o sin ε) a un AFD equivalente por construcción de subconjuntos
cargo run -p automata-cli -- convert --file archivo.jff --out afd.json

# Minimizar un AFD (falla con un error claro si el archivo no es ya determinista)
cargo run -p automata-cli -- minimize --file afd.json --out afd-minimo.json

# Convertir a gramática regular (lineal por la derecha)
cargo run -p automata-cli -- to-grammar --file archivo.jff

# Convertir a expresión regular (eliminación de estados sobre GNFA)
cargo run -p automata-cli -- to-regex --file archivo.jff

# Sintetizar un autómata de prueba y medir tiempo de compilar/simular
cargo run -q --release -p automata-cli -- stress --topology epsilon-chain --states 10000
```

`stress` soporta tres topologías sintéticas pensadas para estresar partes
específicas del motor — `chain` (caso normal), `epsilon-chain` (clausura-ε en
cadena, ver `docs/decisions.md`) y `dense` (fan-out de transiciones). Correr
siempre en `--release`: en modo debug los tiempos no son representativos.

## Build

```bash
cargo tauri build
```

## Documentación adicional

`docs/decisions.md` registra decisiones de ingeniería no obvias (el *por qué*
detrás de partes del código que no se explican solas leyendo el código) —
útil tanto para quien retome el proyecto como para asistentes de IA que
trabajen sobre este repo en sesiones futuras.
