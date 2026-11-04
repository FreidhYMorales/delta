# Story 13: Initial stack symbol written with a space

## Story

13. As a student, I want an initial stack symbol written with a space to read as one symbol so that the formal definition keeps working. Requires: #01

Assumptions:

- Spaces inside the symbol are removed rather than rejected: `Z 0` reads as `Z0`, the symbol the student most likely meant, and no new error message is needed.
- Machines saved with a space in the symbol are not converted; story 01 is unmerged, so none exist outside this branch.

## Acceptance criteria

- [x] Given a PDA, when I enter `Z 0` in the Simular field, then the field shows `Z0` and the machine uses `Z0` as its initial stack symbol.
- [x] Given a PDA whose symbol was entered as `Z 0`, when I press "Aplicar definición" without changing the text, then it applies with no error.
- [x] Given the formal definition, when I write the line `Z0 = Z 0` and apply it, then there is no error and the machine uses `Z0`.

## Plan

- Setting the symbol from the app removes every space from it, as it already removes the outer ones.
- The formal definition's `Z0` line accepts spaces in its value and removes them.
- Tests go through the app commands and the formal definition's text.

## Out of scope

- A file containing an empty `initial_stack_symbol`, older builds reading new files, and the stale docs (story 01's other leftovers).
- Spaces in stack strings, which already separate symbols.
- Turing machines.

## Suggestions (your call)

## Size

small
Risk: none

## Log

- L1 request: si
- L2 branch: story/13-initial-stack-symbol-with-a-space, cut from story/02-stack-strings-and-lambda, not merged. Test list and running the cycles back to back approved by the user ("si").
- L3 commits, red then code: feff3b1 cdf2556, 5592410 abb4028.
- L4 no red run: "reads back the text it generates" in 5592410 was green on arrival; removing the generated Z0 line made it fail. The rest ran red: `"Z 0"` vs `"Z0"`, and the Z0 line rejected.
- L5 test output: 28 cargo suites ok with no failures; frontend 1280 tests passed.
- L6 manual: the user checked in the running app, rebuilt with the fix, that `Z 0` shows as `Z0`, that applying the generated definition gives no error, and that `Z0 = A B` applies and shows `AB` ("si").
- L7 no verifier: Risk: none.
- Risk: none
