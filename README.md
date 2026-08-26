<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Delta" width="96" height="96">
</p>

<h1 align="center">Delta</h1>

<p align="center">
  Editor y simulador de autómatas de escritorio — de autómatas finitos a
  máquinas de Turing — con core en Rust y UI nativa vía Tauri.
</p>

<p align="center">
  <a href="https://github.com/FreidhYMorales/delta/releases/latest"><img alt="Última versión" src="https://img.shields.io/github/v/release/FreidhYMorales/delta?include_prereleases&label=release"></a>
  <a href="https://github.com/FreidhYMorales/delta/actions/workflows/release.yml"><img alt="Build de instaladores" src="https://github.com/FreidhYMorales/delta/actions/workflows/release.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/github/license/FreidhYMorales/delta"></a>
</p>

Nace como reemplazo de [JFLAP](https://www.jflap.org/) (Java/Swing) para la
cursada, y hoy se comparte también con testers externos. Core en Rust, UI de
escritorio con Tauri 2 (frontend en JavaScript vanilla + Vite, sin
frameworks) — cinco editores (autómatas finitos, Mealy, Moore, pila y
Turing), cada uno con sus propias vistas sincronizadas, y proyectos
multi-pestaña para trabajar varios a la vez.

## Índice

- [Por qué existe](#por-qué-existe)
- [Alcance actual](#alcance-actual)
- [Instalación](#instalación)
- [Estructura](#estructura)
- [Correr en desarrollo](#correr-en-desarrollo)
- [Tests](#tests)
- [CLI de diagnóstico (`automata-cli`)](#cli-de-diagnóstico-automata-cli)
- [Build](#build)
- [Documentación adicional](#documentación-adicional)
- [Licencia](#licencia)
- [Changelog](CHANGELOG.md)

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

## Alcance actual

Cinco editores, cada uno con sus propias vistas sincronizadas (Diagrama,
Tabla de estados, Definición formal, Verificación de cadenas):

- **Autómatas finitos** (AFD/AFN, transiciones ε): conversión AFN→AFD
  (construcción de subconjuntos), minimización de AFD, AFD/AFN ↔ gramática
  regular (lineal por la derecha), AFD/AFN ↔ expresión regular (GNFA /
  construcción de Thompson).
- **Máquinas de Mealy** y **Máquinas de Moore**.
- **Autómatas de pila (PDA)**.
- **Máquinas de Turing** (multi-cinta).

Además:

- **Proyectos multi-pestaña**: varios autómatas abiertos a la vez, de
  cualquier combinación de tipos, en un mismo proyecto guardable/abrible
  como un solo archivo. Confirmación de cambios sin guardar antes de crear
  o abrir otro proyecto.
- Nombres de estado y símbolos de transición/alfabeto reconocen letras
  griegas por su nombre en inglés ("delta" → "δ", "Sigma" → "Σ") — la
  Definición formal también se muestra con esos glifos, no la palabra.
- Undo/redo transaccional por autómata.
- Persistencia nativa en JSON y compatibilidad de importación/exportación
  con el formato `.jff` de JFLAP (con reporte de pérdida cuando corresponde).
- Diálogos nativos de archivo vía Tauri (sin `window.prompt`).

Pendiente (no implementado todavía): gramáticas libres de contexto más allá
de las lineales por la derecha, y el resto del menú de JFLAP no listado
arriba.

## Instalación

Instaladores prearmados para Windows, macOS y Linux están en la [página de
Releases](https://github.com/FreidhYMorales/delta/releases) del repo —
`.msi`/`.exe` (Windows), `.dmg` (macOS), `.deb`/`.rpm`/`.AppImage` (Linux).

### macOS: "Delta está dañado" / "no se puede verificar el desarrollador"

Delta no está firmado con un certificado de Apple Developer (de pago), así
que el `.dmg` descargado no pasa la verificación de Gatekeeper en versiones
recientes de macOS. Dos formas de resolverlo:

**Opción rápida — quitar la cuarentena del .app descargado:**

```bash
xattr -cr /Applications/Delta.app
```

(Después de arrastrarlo a Aplicaciones. Esto quita el atributo de cuarentena
que macOS le pone a todo lo descargado del navegador — es lo que dispara el
bloqueo de Gatekeeper para apps sin firmar, no un problema del build en sí.)

**Opción alternativa — compilar en tu propia máquina:**

Un build hecho localmente nunca queda en cuarentena (esa marca solo la pone
un navegador/gestor de descargas), así que evita el problema por completo.
`scripts/build-macos.sh` instala todo lo necesario (Homebrew debe estar
instalado de antemano) y compila la app:

```bash
./scripts/build-macos.sh
```

Esto instala Node vía Homebrew, Rust vía rustup si falta, el CLI de Tauri, las
dependencias del frontend, y corre `cargo tauri build`. El resultado queda en
`src-tauri/target/release/bundle/macos/Delta.app` (y su `.dmg` en la carpeta
`bundle/dmg/`). La primera vez que lo abras, macOS puede todavía pedir
confirmar con clic derecho → Abrir (una sola vez) — el build tampoco está
firmado, pero al no estar en cuarentena ya no lo bloquea de entrada.

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
scripts/                 scripts de build/instalación (build-macos.sh) —
                          ver "Instalación" más arriba
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

## Licencia

[MIT](LICENSE) © FreidhYMorales. `idea/JFLAP7.1.jar` y el material bajo
`idea/JFLAP7.1-output/` son de [JFLAP](https://www.jflap.org/) (Duke
University), incluidos solo como referencia de comportamiento — no forman
parte del build ni están cubiertos por esta licencia.
