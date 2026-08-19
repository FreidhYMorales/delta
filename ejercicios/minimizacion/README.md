# Ejercicios de minimización

Generados y autoverificados por
`crates/automata-cli/examples/minimize_check.rs`:

```bash
cargo run -p automata-cli --example minimize_check
```

Tres AFD construidos a propósito con redundancia (más estados de los
necesarios), pensados para poder compararse **directamente contra el JFLAP
original**: cada uno se guarda como `.json` (nativo) y también como `.jff`
— el `.jff` se puede abrir tal cual en `idea/JFLAP7.1.jar` y correr su
propio "Minimize DFA" ahí, para comparar la cantidad de estados resultante
contra lo que dio acá.

Cada ejercicio se verifica de cuatro formas: que el AFD original (redundante)
ya acepta el lenguaje correcto, que el resultado minimizado también, que
tiene exactamente la cantidad de estados esperada, y — la más importante —
que **es realmente el mínimo**: un chequeo independiente escrito aparte
("table-filling", marca pares de estados como distinguibles hasta punto
fijo), que no llama a `minimize_dfa` ni reutiliza su código.

| Archivo | Enunciado | Original → mínimo |
|---|---|---|
| `01-longitud-par-redundante` | Cadenas de longitud par, con un ciclo de 4 estados en vez del mínimo de 2 | 4 → 2 |
| `02-multiplo-3-redundante` | Cadenas de longitud múltiplo de 3, con un ciclo de 6 estados (mód 6) en vez del mínimo de 3 (mód 3) | 6 → 3 |
| `03-trampa-explicita-y-final-sin-salida` | Cadenas formadas por una o más `a` y ninguna `b` (a+), con un estado trampa dibujado a mano además de un estado de aceptación sin transición de salida — el caso que encontró un bug real en la primera versión de `minimize_dfa` (ver `docs/decisions.md`) | 3 → 2 |

Además, el script vuelve a minimizar los AFD ya producidos en
`ejercicios/nfa/` y `ejercicios/teoria-afnd/` (de las sesiones de AFN→AFD),
cerrando el círculo completo AFND→AFD→AFD-mínimo:

| AFD de origen | Estados → mínimo |
|---|---|
| `ejercicios/nfa/01-contiene-aa-o-bb` | 8 → 4 |
| `ejercicios/nfa/02-cero-o-mas-ab` | 3 → 2 |
| `ejercicios/nfa/03-antepenultimo-a` | 8 → 8 (ya era mínimo) |
| `ejercicios/nfa/04-inicia-a-o-termina-b` | 5 → 4 |
| `ejercicios/teoria-afnd/01-multiplo-2-o-3` | 7 → 6 |
| `ejercicios/teoria-afnd/02-uno-no-final` | 5 → 3 |

El caso de "antepenúltimo símbolo" (el del blowup exponencial 2³) ya salía
mínimo de la construcción de subconjuntos — consistente con la teoría para
ese tipo de lenguaje.
