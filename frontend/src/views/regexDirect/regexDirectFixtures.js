// Test fixtures for the "ER → AFD" tab (not a test file itself, so both
// the logic and the view tests can import it).

// `conv_regex_to_dfa_direct` result for "a?b" (augmented: (a?b)#).
export function aOptionalB() {
  const leaf = (kind, label, position) => ({
    kind,
    label,
    position,
    children: [],
    nullable: false,
    firstpos: [position],
    lastpos: [position],
  });
  return {
    nodes: [
      leaf("symbol", "a", 1),
      { kind: "optional", label: "?", position: null, children: [0], nullable: true, firstpos: [1], lastpos: [1] },
      leaf("symbol", "b", 2),
      { kind: "concat", label: "·", position: null, children: [1, 2], nullable: false, firstpos: [1, 2], lastpos: [2] },
      leaf("end", "#", 3),
      { kind: "concat", label: "·", position: null, children: [3, 4], nullable: false, firstpos: [1, 2], lastpos: [3] },
    ],
    root: 5,
    positions: [
      { position: 1, symbol: "a", followpos: [2] },
      { position: 2, symbol: "b", followpos: [3] },
      { position: 3, symbol: "#", followpos: [] },
    ],
    end_position: 3,
    alphabet: ["a", "b"],
    states: [
      { name: "A", positions: [1, 2], initial: true, accepting: false },
      { name: "B", positions: [2], initial: false, accepting: false },
      { name: "C", positions: [3], initial: false, accepting: true },
    ],
    transitions: [
      { from: "A", symbol: "a", to: "B" },
      { from: "A", symbol: "b", to: "C" },
      { from: "B", symbol: "b", to: "C" },
    ],
  };
}
