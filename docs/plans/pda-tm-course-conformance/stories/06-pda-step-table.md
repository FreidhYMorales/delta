# Story 06: Copyable PDA step table

## Story

06. As a student, I want a copyable PDA step table with step, state, remaining input, stack, next state, new stack and result so that I can paste it into my worksheet. Requires: #01

Assumptions:

- The columns and wording follow the workbook: Paso, Estado Actual, Cadena Restante, Cima de Pila, Siguiente Estado, Nueva Pila, then a "Resultado Final" row with CADENA ACEPTADA or CADENA NO ACEPTADA.
- As in the workbook, "Cima de Pila" and "Nueva Pila" hold the whole stack, top on the left and without separators (`BNNZ`, `AAZ0`). An empty stack or an empty remaining input shows as `ε`.
- An accepted word shows the shortest accepting path for the chosen "Aceptar por".
- A word that is not accepted shows the path that consumed the most input, and the longest of those if several tie, which is the path the workbook shows. It ends with a `BLOQUEO` row unless the stack is already empty, because then there is no top to read; the workbook does the same.
- The same word on the same machine always gives the same table.
- The current per-step list of every live branch stays below the table, so no existing test changes. Story 09 decides the panel's final layout.
- If the run is truncated there is no path to show: the verdict says so and the table is empty.

## Acceptance criteria

- [x] Given exercise 2-2, when I simulate `abb` by final state, then the table shows the workbook's 5 rows with state names and CADENA ACEPTADA.
- [x] Given exercise 1-2, when I simulate `aaabbab`, then the table shows the workbook's 7 rows ending in `BLOQUEO` and CADENA NO ACEPTADA; and all 8 workbook words give the workbook's rows, using "Pila vacía" for exercise 1-1 and "Estado final" for the rest.
- [x] Given a step table on screen, when I press the copy button and paste into a spreadsheet, then each row and column lands in its own cell, including the header and the result row.

## Plan

- The engine gains a path search over the same transitions as the simulation, which keeps each configuration's input position and where it came from, in a stable order.
- The simulation command returns those rows with state and symbol names, next to the existing trace.
- The Simular tab draws them as a table with the existing copy button.
- Tests compare the rows of all 8 workbook words with the workbook's values.

## Out of scope

- The Turing table (story 07), and testing several words at once (story 08).
- Moving or restyling the simulation panel, or removing the per-step list (story 09).
- Pasting the workbook's notation (story 04).
- Highlighting the path on the diagram.

## Suggestions (your call)

## Size

normal
Risk: none

## Log

- L1 request: si
- L2 branch: story/06-pda-step-table, cut from story/03-turing-words-and-blank, not merged. Test list approved by the user, step by step ("si").
- L3 commits, red then code: a55a7f7 b0428e0, 97b461d 51a1922, 19ac78f 2173643, cb4f5db c22235d, f39f154 ba648d8, 7b76a70 03b0bd8, 1e835fa 8814e6b, bd94d87 a04bf73, bd81c10 2218596, eec35e8 44a682e. Test-only: 7c47834.
- L4 no red run: 7c47834 (remaining workbook tables) was green on arrival; temporary mutations of stack order, accept mode and remaining input made it fail.
- L5 beyond the test list: 1e835fa covers a bug found while building test 7: with a small `max_configs` the simulation accepted while the table search stopped short and showed a blocked path. c22235d also makes the existing trace's order stable, since transitions now run in creation order.
- L6 test output: 31 cargo suites ok with no failures; frontend 1298 tests passed.
- L7 manual: the user ran exercise 2-2 in the app (`abb` with 5 rows and CADENA ACEPTADA; `b` with CADENA NO ACEPTADA), copied the table into a spreadsheet with each value in its cell, and found the table's look acceptable ("si").
- L8 no verifier: Risk: none.
- Risk: none
