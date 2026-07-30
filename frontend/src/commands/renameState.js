// Pure helper backing `ViewContext`'s default `renameState` hook (task 7.9,
// spec `diagram-editor` > "State Identifier Conflicts Are Never Silent").
//
// `doc_apply` does NOT reject a colliding `RenameState` op with an `Err` —
// `Document::apply` always increments `revision` and returns `Ok`, but the
// model layer's `rename_state` silently contributes zero patches for that
// op when the name is already taken (`crates/automata-core/src/doc/mod.rs`:
// `Err(_) => vec![]`). So "was this rename actually blocked?" can only be
// answered by checking whether a `StateRenamed` patch for `id` came back —
// there is no error to catch.

/**
 * @param {object[]} patches `EditResult.patches` from `docStore.apply`
 * @param {number} id the state id the rename was attempted on
 * @returns {boolean} true if a `StateRenamed` patch for `id` is present
 */
export function wasRenamed(patches, id) {
  return patches.some((p) => p.patch === "StateRenamed" && p.id === id);
}
