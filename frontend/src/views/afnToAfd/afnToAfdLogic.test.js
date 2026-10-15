import { describe, expect, it } from "vitest";
import { buildConversion } from "./afnToAfdLogic.js";

// The NFA-ε from the reference worksheet: q0 -1-> q2 -0-> q3, then q3
// forks by ε into a (1)* branch (q4, q9<->q10, q6) and a (0)* branch
// (q5, q11<->q12, q7), both joining at the accepting q8.
function worksheetAutomaton() {
  const labels = ["q0", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12"];
  const id = (label) => labels.indexOf(label);
  const states = labels.map((label) => ({
    id: id(label),
    label,
    initial: label === "q0",
    accepting: label === "q8",
  }));
  const e = (from, to, symbol) => ({
    from: id(from),
    to: id(to),
    epsilon: symbol == null,
    symbols: symbol == null ? [] : [symbol],
  });
  const edges = [
    e("q0", "q2", "1"),
    e("q2", "q3", "0"),
    e("q3", "q4"),
    e("q3", "q5"),
    e("q4", "q9"),
    e("q4", "q6"),
    e("q9", "q10", "1"),
    e("q10", "q9"),
    e("q10", "q6"),
    e("q6", "q8"),
    e("q5", "q11"),
    e("q5", "q7"),
    e("q11", "q12", "0"),
    e("q12", "q11"),
    e("q12", "q7"),
    e("q7", "q8"),
  ];
  return { states, edges };
}

describe("buildConversion — step 1: ε-closures", () => {
  it("lists every state as {itself}U{everything reachable by ε}, marking initial and accepting", () => {
    const { states, edges } = worksheetAutomaton();
    const { closures } = buildConversion(states, edges);
    expect(closures.headers).toEqual(["Estados", "Clausuras ε"]);
    expect(closures.rows).toEqual([
      ["→ q0", "{q0}U{}"],
      ["q2", "{q2}U{}"],
      ["q3", "{q3}U{q4,q5,q6,q7,q8,q9,q11}"],
      ["q4", "{q4}U{q6,q8,q9}"],
      ["q5", "{q5}U{q7,q8,q11}"],
      ["q6", "{q6}U{q8}"],
      ["q7", "{q7}U{q8}"],
      ["q8*", "{q8}U{}"],
      ["q9", "{q9}U{}"],
      ["q10", "{q10}U{q6,q8,q9}"],
      ["q11", "{q11}U{}"],
      ["q12", "{q12}U{q7,q8,q11}"],
    ]);
  });
});

describe("buildConversion — step 2: NFA-ε transition table", () => {
  it("has an E column (the closure without the state itself) and one column per symbol with direct moves", () => {
    const { states, edges } = worksheetAutomaton();
    const { nfaTable } = buildConversion(states, edges);
    expect(nfaTable.headers).toEqual(["Estados", "E", "0", "1"]);
    expect(nfaTable.rows).toEqual([
      ["→ q0", "", "", "q2"],
      ["q2", "", "q3", ""],
      ["q3", "q4,q5,q6,q7,q8,q9,q11", "", ""],
      ["q4", "q6,q8,q9", "", ""],
      ["q5", "q7,q8,q11", "", ""],
      ["q6", "q8", "", ""],
      ["q7", "q8", "", ""],
      ["q8*", "", "", ""],
      ["q9", "", "", "q10"],
      ["q10", "q6,q8,q9", "", ""],
      ["q11", "", "q12", ""],
      ["q12", "q7,q8,q11", "", ""],
    ]);
  });
});

describe("buildConversion — step 3: transitions without ε (subset construction)", () => {
  it("writes each cell as {moved}U{added by closure} = qN, naming new sets in discovery order", () => {
    const { states, edges } = worksheetAutomaton();
    const { dfaTable } = buildConversion(states, edges);
    expect(dfaTable.headers).toEqual(["Estados", "0", "1"]);
    expect(dfaTable.rows).toEqual([
      ["→ {q0}U{} = q0", "", "{q2}U{} = q1"],
      ["{q2}U{} = q1", "{q3}U{q4,q5,q6,q7,q8,q9,q11} = q2*", ""],
      ["{q3}U{q4,q5,q6,q7,q8,q9,q11} = q2*", "{q12}U{q7,q8,q11} = q3*", "{q10}U{q6,q8,q9} = q4*"],
      ["{q12}U{q7,q8,q11} = q3*", "{q12}U{q7,q8,q11} = q3*", ""],
      ["{q10}U{q6,q8,q9} = q4*", "", "{q10}U{q6,q8,q9} = q4*"],
    ]);
  });

  it("produces the matching DFA model: same initial, accepting = sets holding an original accepting state", () => {
    const { states, edges } = worksheetAutomaton();
    const { dfa } = buildConversion(states, edges);
    expect(dfa.states).toEqual(["q0", "q1", "q2", "q3", "q4"]);
    expect(dfa.initial).toBe("q0");
    expect(dfa.accepting).toEqual(["q2", "q3", "q4"]);
    expect(dfa.transitions).toEqual([
      { from: "q0", symbol: "1", to: "q1" },
      { from: "q1", symbol: "0", to: "q2" },
      { from: "q2", symbol: "0", to: "q3" },
      { from: "q2", symbol: "1", to: "q4" },
      { from: "q3", symbol: "0", to: "q3" },
      { from: "q4", symbol: "1", to: "q4" },
    ]);
  });

  it("names a set by its full closure, so two different moves reaching the same set share one DFA state", () => {
    // q0 -a-> q1, q0 -b-> q2, q1 -ε-> q2: on a the move is {q1} and on b
    // it is {q2}; their closures differ ({q1,q2} vs {q2}), so two states.
    // Then from {q1,q2}, b -> {q2}... reuses the {q2} set's name.
    const states = [
      { id: 0, label: "q0", initial: true, accepting: false },
      { id: 1, label: "q1", initial: false, accepting: false },
      { id: 2, label: "q2", initial: false, accepting: true },
    ];
    const edges = [
      { from: 0, to: 1, epsilon: false, symbols: ["a"] },
      { from: 0, to: 2, epsilon: false, symbols: ["b"] },
      { from: 1, to: 2, epsilon: true, symbols: [] },
      { from: 2, to: 2, epsilon: false, symbols: ["b"] },
    ];
    const { dfaTable } = buildConversion(states, edges);
    expect(dfaTable.rows).toEqual([
      ["→ {q0}U{} = q0", "{q1}U{q2} = q1*", "{q2}U{} = q2*"],
      ["{q1}U{q2} = q1*", "", "{q2}U{} = q2*"],
      ["{q2}U{} = q2*", "", "{q2}U{} = q2*"],
    ]);
  });

  it("has no step-3 rows and no DFA without an initial state", () => {
    const states = [{ id: 0, label: "q0", initial: false, accepting: false }];
    const { dfaTable, dfa } = buildConversion(states, []);
    expect(dfaTable.rows).toEqual([]);
    expect(dfa).toBeNull();
  });
});
