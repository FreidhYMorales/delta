// Pure (DOM-free) presentation helpers for the "Gramática" tab: the
// formal definition G = {Σ, N, S, P} of the core's parsed grammar, and the
// Chomsky hierarchy reference table from the course
// (`idea/nuevos_agregados/Jerarquía de Chomsky.pdf`). The parsing and the
// classification themselves happen in the core.

/** The course's hierarchy table, type 0 to 3. */
export const CHOMSKY_TABLE = [
  {
    type: 0,
    language: "Recursivamente enumerable (LRE)",
    automaton: "Máquina de Turing",
    productions: "αAβ → δ",
    example: "L = {w | w describe una máquina de Turing}",
  },
  {
    type: 1,
    language: "Dependiente del contexto (LSC)",
    automaton: "Autómata linealmente acotado",
    productions: "αAβ → αγβ",
    example: "L = {aⁿbⁿcⁿ | n > 0}",
  },
  {
    type: 2,
    language: "Independiente del contexto (LLC)",
    automaton: "Autómata con pila",
    productions: "A → γ",
    example: "L = {aⁿbⁿ | n > 0}",
  },
  {
    type: 3,
    language: "Regular (LR)",
    automaton: "Autómata finito",
    productions: "A → a, A → aB",
    example: "L = {aⁿ | n ≥ 0}",
  },
];

const TYPE_NAMES = [
  "Gramática sin restricciones",
  "Gramática dependiente del contexto",
  "Gramática libre de contexto",
  "Gramática regular",
];

/** @param {number} type 0..3 */
export function grammarTypeName(type) {
  return TYPE_NAMES[type];
}

/** One symbol as text: multi-character non-terminals in `<…>`, multi-
 * character terminals in quotes (the same way they are typed). */
function symbolText({ kind, name }) {
  if ([...name].length === 1) return name;
  return kind === "nonterminal" ? `<${name}>` : `'${name}'`;
}

/** A sentential form as text, `ε` when empty. */
export function formText(symbols) {
  return symbols.length ? symbols.map(symbolText).join("") : "ε";
}

/** @param {{terminals:string[], nonterminals:string[], start:string, productions:{lhs:object[], rhs:object[]}[]}} grammar */
export function formalDefinition(grammar) {
  return {
    sigma: `Σ = {${grammar.terminals.join(", ")}}`,
    n: `N = {${grammar.nonterminals.join(", ")}}`,
    s: `S = ${grammar.start}`,
    productions: grammar.productions.map((p) => `${formText(p.lhs)} → ${formText(p.rhs)}`),
  };
}
