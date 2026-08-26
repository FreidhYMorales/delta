// The 5 machine kinds a project tab can be, in JFLAP's own "New" menu order
// (gui.action.NewAction, decompiled — docs/decisions.md: Finite Automaton,
// Mealy, Moore, Pushdown, Turing).
//
// `id` mirrors the exact `MachineKind` serde tag from the Rust side
// (`src-tauri/src/tabs.rs`, itself documented there as matching
// `automata_core::dto::MachineDoc`'s `#[serde(tag = "kind")]` variant tags)
// byte for byte — a `ProjectManifest.tabs[].kind`/`MachineDoc`'s tag string
// can be looked up here directly, with no separate translation table.

/** @typedef {{id: "Fa"|"Mealy"|"Moore"|"Pda"|"Tm", label: string}} MachineKindMeta */

/** @type {MachineKindMeta[]} */
export const MACHINE_KINDS = [
  { id: "Fa", label: "Autómata Finito" },
  { id: "Mealy", label: "Máquina de Mealy" },
  { id: "Moore", label: "Máquina de Moore" },
  { id: "Pda", label: "Autómata de Pila" },
  { id: "Tm", label: "Máquina de Turing" },
];

const labelById = new Map(MACHINE_KINDS.map((k) => [k.id, k.label]));

/** @param {string} id @returns {string|undefined} the Spanish display label for `id`, or
 * `undefined` if `id` isn't one of the 5 known `MachineKind` tags. */
export function machineKindLabel(id) {
  return labelById.get(id);
}
