# Backlog: pda-tm-course-conformance

## Context

- What: Make PDA and Turing tabs match the course's workbooks and the FA views, so a student enters an exercise, adjusts little, gets a precise result, copies its tables and prints the automaton. Plan: none.
- Stack: existing Tauri, Rust and vanilla JS app
- Expensive decisions: none
- Test command: cargo test --workspace && npm test --prefix frontend
- Single test: cargo test <name> | cd frontend && npx vitest run <file>

## Backlog

01. [x] 817215c As a student, I want to set a PDA's initial stack symbol and type a word without spaces so that a course exercise gets the correct verdict.
02. [x] 933968d As a student, I want to write stack strings like NZ and use λ for ε in PDA transitions so that I can enter them as the course writes them. Requires: #01
13. [x] abb4028 As a student, I want an initial stack symbol written with a space to read as one symbol so that the formal definition keeps working. Requires: #01
03. [x] bf70123 As a student, I want to type a Turing word without spaces and write B as the blank so that a course machine gets the correct verdict.
04. [ ] As a student, I want to paste a PDA definition in course notation, including sets, f(...) and A/B/Z, so that I don't retype each transition. Requires: #02
05. [ ] As a student, I want to paste a Turing definition in course notation, including δ(q0, 1) = (q0, 0, R) and a|b|c, so that I don't retype each transition. Requires: #03
06. [x] 44a682e As a student, I want a copyable PDA step table with step, state, remaining input, stack, next state, new stack and result so that I can paste it into my worksheet. Requires: #01
07. [ ] As a student, I want a copyable Turing step table with tape, head, state and final tape so that I can paste it into my worksheet. Requires: #03
08. [ ] As a student, I want to test several words at once on PDA and Turing tabs so that I can check an exercise as quickly as on FA. Requires: #01, #03
09. [ ] As a student, I want PDA and Turing simulation panels laid out and collapsible like FA's so that every machine works the same way. Requires: #06, #07, #08
10. [ ] As a student, I want Organize, Fit and the View menu with zoom on PDA and Turing tabs so that I can arrange a diagram as on FA.
11. [ ] As a student, I want PDA and Turing transitions drawn with FA's edge geometry so that the diagram stays readable.
12. [ ] As a student, I want to print the automaton so that I can hand it in with my worksheet.
