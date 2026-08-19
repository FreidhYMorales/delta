# Ejercicios

Autómatas resueltos a partir de enunciados de cursada, generados y
autoverificados por `crates/automata-cli/examples/exercises.rs` — correr
`cargo run -p automata-cli --example exercises` desde la raíz del repo
regenera estos `.json` y corre todos los casos de prueba de nuevo.

Son documentos nativos (mismo formato que abre/guarda la app): se pueden
inspeccionar o simular directamente con `automata-cli` sin la GUI, por ejemplo:

```bash
cargo run -p automata-cli -- inspect --file ejercicios/07-inicia0-termina1-contiene010.json
cargo run -p automata-cli -- sim --file ejercicios/07-inicia0-termina1-contiene010.json --word "0 0 1 0 1" --trace
```

| Archivo | Enunciado |
|---|---|
| `01-inicia0-termina1.json` | Cadenas que inicien con 0 y finalicen con 1 |
| `02-termina-11.json` | Cadenas que finalicen en 11 |
| `03-contiene-10.json` | Cadenas que contengan la subcadena 10 |
| `04-prefijo-01.json` | Cadenas con prefijo 01 |
| `05-longitud-par.json` | Cadenas con longitud par |
| `06-longitud-multiplo4.json` | Cadenas con longitud múltiplo de 4 |
| `07-inicia0-termina1-contiene010.json` | Inicien con 0, finalicen con 1 y contengan la subcadena 010 |
| `08-termina-000.json` | Cadenas que finalicen en tres ceros |
| `09-contiene101-inicia1.json` | Contengan la subcadena 101 e inicien con 1 |
| `10-prefijo01-sufijo10.json` | Cadenas con prefijo 01 y sufijo 10 |
| `11-longitud-impar.json` | Cadenas con longitud impar |
| `12-longitud-multiplo3.json` | Cadenas con longitud múltiplo de tres |

Todos son DFA (no hace falta no-determinismo para ninguno de estos
enunciados); tamaño priorizado por claridad de la construcción, no
minimizado a mano — ver `docs/decisions.md` si más adelante se agrega
minimización automática de AFD.
