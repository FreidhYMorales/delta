# Ejercicios AFN→AFD

Enunciados elegidos a propósito porque necesitan un AFN de verdad (unión vía
ε, cierre de Kleene vía ε, o ramificación no determinista real) — a
diferencia de `ejercicios/` (los 12 originales), que eran todos construibles
directo como AFD. Generados y autoverificados por
`crates/automata-cli/examples/nfa_to_dfa_check.rs`:

```bash
cargo run -p automata-cli --example nfa_to_dfa_check
```

Cada ejercicio se verifica dos veces:

1. **Equivalencia de lenguaje**: el AFD acepta exactamente las mismas
   palabras que el AFN original.
2. **Definición formal de AFD**: re-derivada directo de `doc.edges()`, sin
   pasar por `FaDoc::classify` (que es justamente la lógica que se quiere
   corroborar) — que no exista ninguna transición δ(q,ε), y que no existan
   dos transiciones δ(q,a)=q1, δ(q,a)=q2 con q1≠q2.

| Archivo | Enunciado | AFN → AFD |
|---|---|---|
| `01-contiene-aa-o-bb` | Cadenas que contengan la subcadena `aa` o `bb` (unión vía ε de dos detectores) | 7 → 8 estados |
| `02-cero-o-mas-ab` | `(ab)*` — cero o más repeticiones de `ab` (cierre de Kleene, construcción de Thompson con ε) | 6 → 3 estados |
| `03-antepenultimo-a` | El símbolo antepenúltimo (tercero desde el final) es `a` — adivinanza no determinista real, sin ε | 4 → 8 estados |
| `04-inicia-a-o-termina-b` | Cadenas que inicien con `a` o finalicen con `b` (unión vía ε) | 6 → 5 estados |

El ejercicio 3 es el más ilustrativo: es el ejemplo clásico de teoría de
autómatas que produce explosión exponencial en la construcción de
subconjuntos — un AFN de 4 estados con adivinanza sobre "el símbolo en la
posición k-ésima desde el final" necesita en el peor caso 2^k estados en el
AFD equivalente. Acá da exactamente 2³=8, el máximo teórico, no una
coincidencia.

Los `.json` de cada par (`*-nfa.json` / `*-dfa.json`) son documentos nativos,
inspeccionables con `automata-cli inspect`/`sim` igual que los de
`ejercicios/`.
