# Story 03: Turing words without spaces and B as the blank

## Story

03. As a student, I want to type a Turing word without spaces and write B as the blank so that a course machine gets the correct verdict.

Assumptions:

- An uppercase `B` in a transition's read or write always means the blank, as in the workbook, so the letter `B` can no longer be typed as an ordinary tape symbol. Lowercase `b` is unaffected.
- `B` is only read this way in transitions. A word typed in Simular is split with the machine's alphabet like a PDA word; each tape has its own field, and spaces still separate.
- The app keeps showing the blank as `□`. Saved machines are not converted, so one with a literal `B` symbol keeps it.

## Acceptance criteria

- [x] Given a Turing machine, when I type a word without spaces such as `010`, then it gives the same result as `0 1 0`.
- [x] Given a transition, when I write `B ; B , S` in the diagram prompt, the transitions table or the formal definition, then it reads and writes the blank, and workbook machine MT1 entered this way accepts `010` with final tape `101`.
- [x] Given the workbook's 3 machines and 9 words, when I simulate them by final state, then every word is accepted, ending in the workbook's final state and final tape.

## Plan

- The shared text parsing of one tape's read, write and direction turns `B` into the blank, which covers the prompt, the table and the formal definition.
- The Simular tab splits each tape's word with the machine's alphabet, longest match first, reusing the splitting PDA and FA already use.
- Tests pin the workbook's machines and words on the engine, and the text entry through each entry point.

## Out of scope

- Pasting the workbook's own notation, such as `δ(q0, 1) = (q0, 0, R)` and `a|b|c` (story 05). The formal definition keeps its current `δ(q0, 1 ; 0 , R) = q0` line format here.
- The copyable step table and final tape display (story 07).
- Showing `B` instead of `□`.
- Workbook sheet MT3's claim that it accepts the empty word: its δ rejects it, and the app follows the δ.

## Suggestions (your call)

## Size

small
Risk: none

## Log

- L1 request: si
- L2 branch: story/03-turing-words-and-blank, cut from story/13-initial-stack-symbol-with-a-space, not merged. Test list and running the cycles back to back approved by the user ("si").
- L3 commits, red then code: c9a4021 bf43715, 74dbfd2 bf70123. Test-only: a78c170, 219e05e.
- L4 no red run: a78c170 and 219e05e were green on arrival, checked by temporary mutations. Those mutations exposed that comparing only state and tape missed broken L and S moves, so 219e05e also compares the final head position from the workbook; both mutations then fail.
- L5 test output: 29 cargo suites ok with no failures; frontend 1291 tests passed.
- L6 manual: the user entered MT1 with `B` in the running app, rebuilt after restoring the engine. The third transition showed as `□ ; □ , S`, and `010` gave Aceptado with tape `0=1, 1=0, 2=1` and `head@3` ("si").
- L7 no verifier: Risk: none.
- Risk: none
