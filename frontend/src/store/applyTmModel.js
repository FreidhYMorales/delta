// TM equivalent of `applyPdaModel.js` — syncs the live TM document to a
// label-addressed model through the normal `docStore.apply` undo/redo path.
// Kept separate rather than generalizing PDA's helper, same "isolated, not a
// variant" rationale as `PdaDoc` vs `MealyDoc`/`MooreDoc`/`FaDoc`
// (docs/decisions.md) — `tmFormal/tmFormalLogic.js`'s `planSyncOps` diffs
// transitions by `(from, to, tapes)` tuple value-equality, not PDA's
// `(from, to, input, pop, push)` tuple.

import { planStateDiff, planSyncOps } from "../views/tmFormal/tmFormalLogic.js";

/**
 * @param {import('./TmDocStore.js').TmDocStore} docStore
 * @param {{states:string[], initial:string|null, accepting:string[], transitions:{from:string,to:string,tapes:{read:string,write:string,direction:string}[]}[]}} model
 */
export async function applyTmModel(docStore, model) {
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
