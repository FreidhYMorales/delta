// The kinds a project tab can be: the 5 machines in JFLAP's own "New" menu
// order (gui.action.NewAction, decompiled — docs/decisions.md: Finite
// Automaton, Mealy, Moore, Pushdown, Turing), then the general grammar tab
// (not a machine, but a project document all the same).
//
// `id` mirrors the exact `MachineKind` serde tag from the Rust side
// (`src-tauri/src/tabs.rs`, itself documented there as matching
// `automata_core::dto::MachineDoc`'s `#[serde(tag = "kind")]` variant tags)
// byte for byte — a `ProjectManifest.tabs[].kind`/`MachineDoc`'s tag string
// can be looked up here directly, with no separate translation table.

/** @typedef {{id: "Fa"|"Mealy"|"Moore"|"Pda"|"Tm"|"Grammar", label: string}} MachineKindMeta */

/** @type {MachineKindMeta[]} */
export const MACHINE_KINDS = [
  { id: "Fa", label: "Autómata Finito" },
  { id: "Mealy", label: "Máquina de Mealy" },
  { id: "Moore", label: "Máquina de Moore" },
  { id: "Pda", label: "Autómata de Pila" },
  { id: "Tm", label: "Máquina de Turing" },
  { id: "Grammar", label: "Gramática" },
];

const labelById = new Map(MACHINE_KINDS.map((k) => [k.id, k.label]));

/** @param {string} id @returns {string|undefined} the Spanish display label for `id`, or
 * `undefined` if `id` isn't one of the known `MachineKind` tags. */
export function machineKindLabel(id) {
  return labelById.get(id);
}
