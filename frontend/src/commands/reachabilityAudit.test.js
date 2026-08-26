import { describe, expect, it } from "vitest";
import { MACHINE_KINDS } from "../project/machineKinds.js";
import { actions as faActions, TOOL_IDS as FA_TOOL_IDS } from "./registry.js";
import { mealyActions, MEALY_TOOL_IDS } from "./mealyRegistry.js";
import { mooreActions, MOORE_TOOL_IDS } from "./mooreRegistry.js";
import { pdaActions, PDA_TOOL_IDS } from "./pdaRegistry.js";
import { tmActions, TM_TOOL_IDS } from "./tmRegistry.js";
import { MENU_GROUP_TITLES } from "../views/menubar/MenuBar.js";
import { projectActions, PROJECT_MENU_GROUP_TITLES } from "./projectRegistry.js";

// Extends `registry.test.js`'s own Fa-only "reachability audit" (UI/UX audit
// pass) into a table-driven check over every `MACHINE_KINDS` entry, PLUS the
// new `project.*` actions (design D8/D9, PR10). Same structural guarantee as
// the original: an action with no keybinding, no menu-bar coverage, no
// toolbar id and no context-menu id is 100%-unreachable — a real bug this
// suite exists to make impossible to reintroduce silently, for every kind
// now, not only Fa.
//
// Each kind's `contextMenuIds` is a hardcoded, NOT-imported id list —
// exactly like `registry.test.js`'s own `CONTEXT_MENU_IDS` — because it
// mirrors what that kind's own `*DiagramView.js`'s `_onCanvasContextMenu`
// hardcodes when calling `_showContextMenu`. `menuGroupTitles` is empty for
// every non-Fa kind: none of Mealy/Moore/Pda/Tm has a menu bar wired yet
// (no view/convert/test/interop groups exist for them — see each registry's
// own header comment), so every one of their actions must already be
// reachable via a keybinding, the toolbar, or the context menu alone.
const REGISTRIES = {
  Fa: {
    actions: faActions,
    toolIds: new Set(FA_TOOL_IDS),
    contextMenuIds: new Set([
      "state.rename",
      "state.markInitial",
      "state.toggleAccepting",
      "edit.deleteSelection",
    ]),
    menuGroupTitles: MENU_GROUP_TITLES,
    ownGroups: new Set(["tools", "state", "edit", "view", "convert", "test", "interop"]),
  },
  Mealy: {
    actions: mealyActions,
    toolIds: new Set(MEALY_TOOL_IDS),
    contextMenuIds: new Set(["state.rename", "state.markInitial", "edit.deleteSelection"]),
    menuGroupTitles: {},
    ownGroups: new Set(["tools", "state", "edit"]),
  },
  Moore: {
    actions: mooreActions,
    toolIds: new Set(MOORE_TOOL_IDS),
    contextMenuIds: new Set([
      "state.rename",
      "state.markInitial",
      "state.setOutput",
      "edit.deleteSelection",
    ]),
    menuGroupTitles: {},
    ownGroups: new Set(["tools", "state", "edit"]),
  },
  Pda: {
    actions: pdaActions,
    toolIds: new Set(PDA_TOOL_IDS),
    contextMenuIds: new Set([
      "state.rename",
      "state.markInitial",
      "state.toggleAccepting",
      "edit.deleteSelection",
      "transition.edit",
    ]),
    menuGroupTitles: {},
    ownGroups: new Set(["tools", "state", "transition", "edit"]),
  },
  Tm: {
    actions: tmActions,
    toolIds: new Set(TM_TOOL_IDS),
    contextMenuIds: new Set([
      "state.rename",
      "state.markInitial",
      "state.toggleAccepting",
      "edit.deleteSelection",
      "transition.edit",
    ]),
    menuGroupTitles: {},
    ownGroups: new Set(["tools", "state", "transition", "edit"]),
  },
};

describe("reachability audit — table-driven over MACHINE_KINDS (extends registry.test.js's Fa-only audit)", () => {
  it("the test fixture covers exactly the 5 MACHINE_KINDS entries — no kind added/removed silently", () => {
    expect(new Set(Object.keys(REGISTRIES))).toEqual(new Set(MACHINE_KINDS.map((k) => k.id)));
  });

  for (const kind of MACHINE_KINDS) {
    const registry = REGISTRIES[kind.id];

    describe(`${kind.id} (${kind.label})`, () => {
      it("every action has a real, discoverable trigger: a keybinding, a menu-bar entry, a toolbar button, or a context-menu item", () => {
        for (const action of registry.actions) {
          const reachable =
            action.keybinding != null ||
            Object.prototype.hasOwnProperty.call(registry.menuGroupTitles, action.group) ||
            registry.toolIds.has(action.id) ||
            registry.contextMenuIds.has(action.id);
          expect(
            reachable,
            `${kind.id} action "${action.id}" (group "${action.group}") has no keybinding and is not ` +
              `covered by a menu, the toolbar, or the context menu`,
          ).toBe(true);
        }
      });

      it("only ever uses this kind's own declared groups — contributes no other kind's group", () => {
        for (const action of registry.actions) {
          expect(
            registry.ownGroups.has(action.group),
            `${kind.id} action "${action.id}" unexpectedly uses group "${action.group}"`,
          ).toBe(true);
        }
      });
    });
  }
});

describe("project actions reachability (design D8/D9 — Archivo menu, no FA leakage)", () => {
  it("PROJECT_MENU_GROUP_TITLES collides into the same 'Archivo' title as Fa's own `interop` group (design D9)", () => {
    expect(MENU_GROUP_TITLES.interop).toBe("Archivo");
    expect(PROJECT_MENU_GROUP_TITLES.file).toBe("Archivo");
    expect(PROJECT_MENU_GROUP_TITLES.tabs).toBe("Archivo");
  });

  it("every project action has a keybinding or is covered by PROJECT_MENU_GROUP_TITLES", () => {
    for (const action of projectActions) {
      const reachable =
        action.keybinding != null ||
        Object.prototype.hasOwnProperty.call(PROJECT_MENU_GROUP_TITLES, action.group);
      expect(
        reachable,
        `project action "${action.id}" (group "${action.group}") has no keybinding and isn't ` +
          `covered by PROJECT_MENU_GROUP_TITLES`,
      ).toBe(true);
    }
  });

  it("one project.newTab.<kind> action exists per MACHINE_KINDS and is reachable", () => {
    for (const kind of MACHINE_KINDS) {
      const action = projectActions.find((a) => a.id === `project.newTab.${kind.id}`);
      expect(action).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(PROJECT_MENU_GROUP_TITLES, action.group),
      ).toBe(true);
    }
  });

  it("stays a registry fully separate from Fa's own `actions` (design D8: never folded together)", () => {
    expect(projectActions).not.toBe(faActions);
    const faIds = new Set(faActions.map((a) => a.id));
    for (const action of projectActions) {
      expect(faIds.has(action.id), `project action "${action.id}" collides with an Fa action id`).toBe(false);
    }
  });
});
