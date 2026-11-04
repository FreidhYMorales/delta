# Story 01: Initial stack symbol and words without spaces

## Story

01. As a student, I want to set a PDA's initial stack symbol and type a word without spaces so that a course exercise gets the correct verdict.

Assumptions:

- The initial stack symbol belongs to the machine and is saved with it, like the workbook's definition, and is not a per-run choice.
- The symbol is a single stack symbol and may have several characters, like `Z0`; leaving the field blank restores `Z`.
- The symbol appears in Γ in the formal definition even when no transition uses it.

## Acceptance criteria

- [x] Given a PDA whose transitions use `A` or `Z0` as the bottom of the stack, when I set that symbol as the initial stack symbol and simulate `ab` (exercise 2-1) or `abb` (exercise 2-2), then the result is Aceptado and the steps show that symbol at the bottom of the stack.
- [x] Given a PDA from the course workbook, when I type a word without spaces such as `aababb`, then it gives the same result as `a a b a b b`, and all 8 workbook words match the workbook's verdict.
- [x] Given a PDA with a custom initial stack symbol, when I save and reopen it as a file or a project, then the symbol is still set; and given a PDA saved before this change, when I open it, then it uses `Z` and gives the same results as before.

## Plan

- The machine document stores its initial stack symbol, with `Z` as the default, and the simulation starts from it.
- PDA files and projects save the symbol as an optional field, so older files still open.
- The student sets it in a field on the Simular tab, with undo like any other edit, and the formal definition shows it as a real `Z0 = ...` line that can also be edited.
- The word typed in Simular is split using the machine's input alphabet, longest match first, the same way FA does; spaces are still accepted.
- Tests use the workbook's 4 PDA machines and 8 words, with stack strings written with separators until story 02.

## Out of scope

- Stack strings without separators such as `NZ`, and `λ` as ε (story 02).
- Sets, `f(...)` and `A/B/Z` in the formal definition (story 04).
- The copyable step table, state names in the steps, and the simulation panel layout (stories 06 and 09).
- Turing machines (stories 03, 05 and 07).

## Suggestions (your call)

- Reuse `tokenizeInput` from `views/testing/testingLogic.js` for the word: FA already handles multi-character symbols with it, and story 03 needs the same behaviour.

## Size

normal
Risk: item 3 (PDA file and project format gains a field)

## Log

- L1 request: si, guardalo y seguimos con la historia 01
- L2 base branch: cut from wip/organizar-layout on the user's decision ("si, sacala, y deja esta rama como pausada"), since that branch is 12 commits ahead of master.
- L3 test list: approved by the user, including the change to pdaFormalLogic.test.js:21 ("apruebo la lista y el cambio").
- L4 commits: 6c29e04, 6161acf, 9ab501f, c0885c2, 4c11696, 5ba9bab, 3764ef9, 983847c, 5be27ba, 8603a58, 0610f99, 274233d, 101d317, 63b7cc4, 33b6ad9, 0b24dbd, 9fdc47f, df65491, 57e8e0f, f5e43d1, dfb64a3, 817215c, ca7c377. Test-only and green on arrival, checked by temporary mutations: 9ab501f, df65491, ca7c377.
- L5 manual: the user checked the Simular field in the running app ("si, se va bien").
- L6 verifier round 1: FAIL. All three criteria passed, and it compared the workbook machines and verdicts line by line with `Hoja de trabajo 10 -2.xlsx` in the user's Downloads folder. Failures: mock call counts in applyPdaModel.test.js and an unpinned `|| "Z"` in applyPdaModel.js.
- L7 correction: the user approved rewriting the committed assertions ("si"). Test-only commits 8b7cfe6 and 8921867, checked by temporary mutations. Test command output: all cargo suites ok, frontend 1259 passed.
- L8 verifier round 2: FAIL. All three criteria passed; banned-pattern scan clean. Failures: `?? "Z"` in PdaSimView.js and returning the trimmed symbol in pda_ipc.rs are pinned by no test. It could not find the workbook because the path was not in its prompt, so it did not confirm machines 1-2, 2-1, 2-2 or the 8 verdicts.
- L9 status: stopped at NEEDS DECISION after two FAIL rounds.
- L10 decision: the user chose to add the two missing tests and close without a third verifier round ("si"). Closed by the user's decision, with no verifier PASS.
- L11 final tests: eb70676, test-only, checked by temporary mutations (field fallback not Z fails with '' vs 'Z'; untrimmed symbol fails with " A " vs "A"). Test command output: 28 cargo suites ok with no failures; frontend 102 files, 1260 tests passed.
- L12 left open, by the user's decision to review after merge: a symbol with an inner space such as `Z 0` makes the formal definition reject its own line; a file with an empty `initial_stack_symbol` is not normalised to Z; older builds silently use Z on a new file; docs/decisions.md:435-436 and the PdaDerived typedef are stale.
- Risk: item 3 (PDA file and project format gains a field)
