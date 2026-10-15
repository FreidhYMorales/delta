# Plan: nuevos agregados (ER → AFD, gramáticas, Chomsky, BNF/EBNF)

Fuente: los PDFs de `idea/nuevos_agregados/` — `ER a AFD.pdf`,
`GRAMÁTICAS.pdf`, `Jerarquía de Chomsky.pdf` y
`notacion_bnf_mr_110-112.pdf`. Este documento es el mapa de qué se va a
implementar, en qué orden y con qué decisiones ya tomadas.

## Decisiones tomadas

1. **Sintaxis de expresiones regulares: la notación de los PDFs, en toda la
   app.** `|` es unión, `+` es cerradura positiva (una o más), `?` es
   opcional, `*` es la estrella de Kleene y la yuxtaposición concatena.
   Antes `+` significaba unión: una regex escrita como `a+b` ahora se lee
   "una o más `a`, luego `b`".
2. **Las gramáticas generales tienen su propio tipo de pestaña,
   "Gramática"**, junto a Autómata Finito, Mealy, Moore, Pila y Turing: se
   crea desde "Nueva pestaña" y se guarda en el proyecto. La pestaña
   "Gramática regular" del editor de AF (FA ↔ gramática lineal por la
   derecha) se mantiene.
3. **Los algoritmos viven en el core (Rust, `crates/automata-core`)**, igual
   que Thompson, subconjuntos y minimización; el frontend solo dibuja.
   Así hay un único parser de regex como fuente de verdad, y las búsquedas de
   derivaciones (que pueden crecer exponencialmente) corren rápido y con
   presupuesto acotado.
4. **Cada unidad se hace con TDD**, usando los ejemplos y ejercicios de los
   PDFs como casos de prueba, y cierra con la suite completa y el build en
   verde antes de pasar a la siguiente.

## Unidades

### Unidad 0: migrar la sintaxis de regex a la notación de los PDFs

- Core: parser y `Display` de `Regex` con `|` (unión), `+` (una o más),
  `?` (opcional), `*` y yuxtaposición. `Regex` gana las variantes `Plus` y
  `Optional`; Thompson (`convert/regex_to_nfa.rs`) les da su construcción
  (la misma forma que las piezas `r+` del constructor de Thompson).
- `fa_to_regex` sigue produciendo regex válidas en la sintaxis nueva.
- Frontend: textos de ayuda de la pestaña "Expresión regular".
- Criterio de cierre: los tests de ida y vuelta (regex → AF → regex) y
  toda la suite siguen en verde.

### Unidad 1: ER → AFD por el método directo

Pasos del PDF `ER a AFD.pdf`:

1. Árbol de la expresión regular aumentado con el marcador final `#`.
2. Hojas numeradas, con anulable por nodo.
3. PrimeraPos y ÚltimaPos por nodo (tablas del PDF para `·`, `|`, `*`,
   `+`, `?`).
4. SiguientePos por posición (reglas de concatenación y de estrella).
5. Tabla de estados D: se empieza por PrimeraPos(raíz) y cada conjunto se
   renombra (A, B, C…).
6. Tabla de transiciones D (`Transición(A, símbolo)`).
7. Estado inicial = PrimeraPos(raíz); de aceptación = los estados que
   contienen la posición de `#`.

- Core: `convert/regex_to_dfa_direct.rs` devuelve el árbol con sus
  atributos por nodo, la tabla de SiguientePos, los estados D, las
  transiciones y el AFD resultante.
- Frontend: pestaña "ER → AFD" en el panel derecho del editor de AF (el
  mismo molde que "AFN → AFD"): campo para la regex, árbol dibujado en
  SVG, una tabla por paso con su botón Copiar y "Crear AFD en nueva
  pestaña".

### Unidad 2: pestaña "Gramática" + Jerarquía de Chomsky

- Core: modelo de gramática general G = {Σ, N, S, P}, donde el lado
  izquierdo de una producción puede ser cualquier cadena (admite
  `aaA → aaBB`). Parser que acepta `->`, `→`, `|`, `ε`/`λ`/`∈` y no
  terminales `<nombre>`. Clasificador de Chomsky (tipo 0, 1, 2 o 3) que
  explica qué producción baja la gramática de nivel.
- Rust/Tauri: nuevo `MachineKind::Grammar` (sesión, DTO del proyecto,
  carga/guardado, comandos), siguiendo el camino que ya recorrió Turing.
- Frontend: `mountGrammarTab` con el editor de G y el panel de
  clasificación, incluida la tabla de la jerarquía (lenguaje, autómata,
  forma de las producciones, ejemplo).

### Unidad 3: derivaciones + árbol de derivación

- Core: búsqueda acotada de derivaciones (por la izquierda por defecto;
  por la derecha como opción). En tipos 2 y 3 se poda por longitud; en
  tipos 0 y 1 la pertenencia es indecidible en general, así que la búsqueda
  tiene presupuesto y, si se agota, responde "no encontrada dentro del
  límite" en lugar de afirmar que la cadena no pertenece.
- Frontend: lista de cadenas (como en los ejercicios), derivación paso a
  paso (`S ⇒ ASB ⇒ …`), árbol de derivación en SVG (en tipos 0 y 1 agrupa
  los símbolos que reescribe cada regla) y Copiar.

### Unidad 4: BNF / EBNF

- Core: parser de las reglas con `::=`, `|`, `( )`, `[ ]`, `{ }`,
  `'xyz'` y `.`; conversión EBNF → BNF que expande `[ ]` y `{ }` en no
  terminales nuevos.
- Frontend: modo de entrada BNF/EBNF en la pestaña Gramática, que muestra
  la conversión y verifica cadenas con las derivaciones de la unidad 3.

## Estado

- [x] Unidad 0: sintaxis de regex
- [x] Unidad 1: ER → AFD (método directo)
- [x] Unidad 2: pestaña Gramática + Chomsky
- [x] Unidad 3: derivaciones + árbol (prueba individual y en lote)
- [x] Unidad 4: BNF / EBNF
