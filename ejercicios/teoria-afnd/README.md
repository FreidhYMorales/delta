# Diagramas de la teoría (AFND-ε)

A diferencia de `ejercicios/nfa/` (enunciados que yo diseñé), estos dos
autómatas son una reconstrucción exacta de los dos diagramas provistos en el
material de teoría sobre AFND — mismos estados, mismas transiciones. Sirven
para corroborar que el sistema interpreta y ejecuta correctamente ejemplos
que no salieron de este proyecto. Generados y autoverificados por
`crates/automata-cli/examples/afnd_theory_examples.rs`:

```bash
cargo run -p automata-cli --example afnd_theory_examples
```

Cada uno se verifica de cuatro formas:

1. **Clasificación**: el sistema debe reconocerlos como AFND (`classify() ==
   Nfa`), nunca como AFD.
2. **Evidencia formal independiente**: re-derivada de `doc.edges()` sin
   pasar por `FaDoc::classify` — al menos una de las dos condiciones que la
   teoría dice que un AFND *puede* tener (δ(q,a)=q1 y δ(q,a)=q2 con q1≠q2, o
   δ(q,ε)) tiene que estar presente.
3. **Lenguaje**: casos de prueba derivados a mano del diagrama.
4. **Conversión a AFD**: se pasan por `nfa_to_dfa` (ver
   `docs/decisions.md`) y se vuelve a chequear equivalencia de lenguaje más
   la definición formal de AFD sobre el resultado — cierra el círculo con
   `ejercicios/nfa/`.

| Archivo | Diagrama | Lenguaje |
|---|---|---|
| `01-multiplo-2-o-3` | Estados 0-5, unión vía ε de un ciclo de período 3 (1→2→3→1) y uno de período 2 (4↔5) | Cadenas de `a` cuya longitud es múltiplo de 2 o de 3 |
| `02-uno-no-final` | Estados q1-q4, con δ(q1,1) ramificando a dos destinos y δ(q2,ε)=q3 | Cadenas sobre {0,1} que contienen un `1` que no es el último símbolo |

Los `.json` (`*-afnd.json` / `*-afd.json`) son documentos nativos,
inspeccionables con `automata-cli inspect`/`sim`.
