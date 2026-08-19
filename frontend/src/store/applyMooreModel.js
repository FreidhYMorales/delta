// Moore equivalent of `applyMealyModel.js` — syncs the live Moore document
// to a label-addressed model through the normal `docStore.apply` undo/redo
// path. Kept separate rather than generalizing the Mealy helper: the model
// shape differs (edges carry no output, states carry `output` instead), so
// is the sync plan (`mooreFormal/mooreFormalLogic.js`'s `planSyncOps` emits
// `SetOutput` per state on top of `SetTransitions`/`SetInitial`).

import { planStateDiff, planSyncOps } from "../views/mooreFormal/mooreFormalLogic.js";

/**
 * @param {import('./MooreDocStore.js').MooreDocStore} docStore
 * @param {{states:string[], initial:string|null, transitions:{from:string,input:string,to:string}[], outputs:{state:string,output:string}[]}} model
 */
export async function applyMooreModel(docStore, model) {
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
