// PDA equivalent of `applyMooreModel.js` — syncs the live PDA document to a
// label-addressed model through the normal `docStore.apply` undo/redo path.
// Kept separate rather than generalizing Moore's helper: PDA's sync plan
// (`pdaFormal/pdaFormalLogic.js`'s `planSyncOps`) diffs transitions by full
// tuple value-equality (no stable per-transition key in parsed text),
// genuinely different from Moore's `(from,to)`-keyed edge diffing.

import { planStateDiff, planSyncOps } from "../views/pdaFormal/pdaFormalLogic.js";

/**
 * @param {import('./PdaDocStore.js').PdaDocStore} docStore
 * @param {{states:string[], initial:string|null, accepting:string[], transitions:{from:string,input:string|null,pop:string[],to:string,push:string[]}[]}} model
 */
export async function applyPdaModel(docStore, model) {
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

  const statesAfterAddRemove = docStore.getStates();
  const transitionsAfterAddRemove = docStore.getTransitions();
  const ops = planSyncOps(model, resolvedIdOf, statesAfterAddRemove, transitionsAfterAddRemove);
  if (ops.length) await docStore.apply(ops);
}
