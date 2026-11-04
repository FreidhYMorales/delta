# Story 02: Stack strings without separators and λ for ε

## Story

02. As a student, I want to write stack strings like NZ and use λ for ε in PDA transitions so that I can enter them as the course writes them. Requires: #01

Assumptions:

- A stack string is read like a word in Simular: the longest symbol already known in Γ first, otherwise one character per symbol. Spaces and commas still separate.
- Known symbols are those in the machine's Γ, which includes the initial stack symbol; a definition's own `Z0` line counts when applying that definition.
- A new multi-character symbol can no longer be created by typing it: `X1` now reads as `X` and `1`. The only multi-character symbol in the workbooks is `Z0`, which story 01 already lets the student define.
- Saved machines keep their symbols as they are. One that already has an atomic `NZ` keeps it, and `NZ` keeps reading as that symbol there.

## Acceptance criteria

- [x] Given a machine with initial stack symbol `Z`, when I write `NZ` as a push in the diagram prompt, the transitions table or the formal definition, then it is stored as `N` over `Z`, and exercise 1-1 entered this way accepts `aababb`.
- [x] Given a machine with initial stack symbol `Z0`, when I write `AAZ0` as a push, then it is stored as `A`, `A`, `Z0`, and exercise 2-2 entered this way accepts `abb`.
- [x] Given a transition, when I write `λ` or `ε` as its input, pop or push in any of those three places, then that field is empty and no `λ` or `ε` appears in Σ or Γ, and exercise 2-1 entered with `λ` accepts `ab`.

## Plan

- Stack strings are split against the known stack symbols by one shared rule, reusing the longest-match word splitting from story 01.
- The diagram prompt, the transitions table and the formal definition all pass the machine's known stack symbols to that rule.
- `λ` joins `ε` as the empty marker in the shared parsing of input, pop and push.
- Tests enter the workbook's exercises through each entry point's text, using the course's notation.

## Out of scope

- Sets, `f(...)` and `A/B/Z` in the formal definition (story 04).
- Turing machines (stories 03 and 05).
- The open items from story 01: a symbol with an inner space such as `Z 0`, an empty symbol in a file, and the stale docs.
- Converting symbols already saved in existing machines.

## Suggestions (your call)

- Fix `Z 0` from story 01 here, since it is the same kind of symbol parsing: reject it or strip the inner space. It would need its own criterion and would push this story to 4, so it fits better as a separate small story.

## Size

small
Risk: none

## Log

- L1 request: si, dejemoslo para despues
- L2 branch: story/02-stack-strings-and-lambda, cut from story/01-initial-stack-symbol-and-word-input, not merged, on the user's decision. Test list and running the cycles back to back approved by the user ("si").
- L3 commits, red then code: 50ceaa9 1da8181, 847ef37 96dda15, a965412 3479649, e32b66d c92f8ba, 239bd8c ce82fdb, 7c01c74 933968d. Test-only: a13e2bb, 2eff3b5, 08ae698.
- L4 no red run: tests for λ in the formal definition, table and diagram prompts were written before 933968d went green, so they never ran red; the exercises in 08ae698 and the view wiring in a13e2bb were green on arrival. All were checked by temporary mutations that made them fail. Wiring in PdaFormalView.js went into ce82fdb before its test a13e2bb existed, a deviation from strict TDD.
- L5 test output: 28 cargo suites ok with no failures; frontend 102 files, 1277 tests passed.
- L6 manual: the user pasted exercises 1-1, 2-1 and 2-2 into the running app and all three gave Aceptado ("si"). The engine's verdict itself is not asserted from the frontend: 08ae698 ties the parsed transitions to the machines in pda_course_workbook.rs.
- L7 no verifier: Risk: none.
- Risk: none
