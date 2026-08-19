// Syncs the live document to a label-addressed `model`
// (`{states, initial, accepting, transitions}`, `formalLogic.js`'s shape)
// through the normal `docStore.apply` undo/redo path — extracted out of
// `FormalView._onApply` (task 7.5) once the NFA→DFA/minimize convert
// actions (`main.js`'s `ctx.convertToDfa`/`ctx.minimizeDfa`) needed the
// exact same "make the document match this shape" logic for a
// server-computed preview instead of typed text. Two `docStore.apply`
// calls (add/remove states, then everything else) — a new state's id is
// assigned server-side and only known from the first call's patches, so
// `SetEdge`/`SetInitial`/`SetAccepting` referencing it can't be batched
// into the same call.

import { planStateDiff, planSyncOps } from "../views/formal/formalLogic.js";

/**
 * @param {import('./DocStore.js').DocStore} docStore
 * @param {{states:string[], initial:string|null, accepting:string[], transitions:{from:string,symbol:string|null,to:string}[]}} model
 */
export async function applyAutomatonModel(docStore, model) {
  const currentStates = docStore.getStates();
  const { toAddLabels, toRemoveIds } = planStateDiff(model.states, currentStates);
  const resolvedIdOf = new Map(currentStates.map((s) => [s.label, s.id]));

  if (toAddLabels.length) {
    const result = await docStore.apply(
      toAddLabels.map((label, i) => ({
        op: "AddState",
        label,
        x: 80 + i * 60,
        y: 80 + currentStates.length * 40,
      })),
    );
    for (const patch of result.patches) {
      if (patch.patch === "StateAdded") resolvedIdOf.set(patch.label, patch.id);
    }
  }
  if (toRemoveIds.length) {
    await docStore.apply(toRemoveIds.map((id) => ({ op: "RemoveState", id })));
    for (const id of toRemoveIds) {
      for (const [label, mappedId] of resolvedIdOf) {
        if (mappedId === id) resolvedIdOf.delete(label);
      }
    }
  }

  const stateAfterAddRemove = docStore.getStates();
  const edgesAfterAddRemove = docStore.getEdges();
  const ops = planSyncOps(model, resolvedIdOf, stateAfterAddRemove, edgesAfterAddRemove);
  if (ops.length) await docStore.apply(ops);
}
