//! Multi-tab project session (design D14 migration seam, PR2 of the
//! `multi-tab-projects` change). `TabId`/`MachineKind`/`TabMeta` are the
//! ordered, kind-tagged per-tab metadata a `ProjectSession` owns; the
//! document content itself stays in each kind's own per-kind `HashMap` in
//! `state.rs`, not here.
//!
//! Not yet wired into any Tauri command (that's PR3's `commands/project.rs`)
//! — this module only needs to exist, allocate unique ids, and support
//! ordered add/remove/reorder for now.

use serde::{Deserialize, Serialize};

/// Opaque per-tab id, allocated by `ProjectSession::new_tab` — same
/// transparent-newtype-over-an-integer shape as `automata_core::ids`'s
/// `StateId`/`SymbolId`, just `u64` since a session's tab count is unbounded
/// over the app's lifetime (unlike a single document's state/symbol arenas).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct TabId(pub u64);

/// Mirrors `automata_core::dto::MachineDoc`'s `#[serde(tag = "kind")]`
/// variant tags (`Fa`/`Mealy`/`Moore`/`Pda`/`Tm`) — plain derived
/// `Serialize`/`Deserialize` on a unit-variant enum already produces the
/// exact same tag strings, so the two stay interchangeable if a later PR
/// ever needs to compare a `TabMeta::kind` against a `MachineDoc`'s tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MachineKind {
    Fa,
    Mealy,
    Moore,
    Pda,
    Tm,
}

/// Ordered per-tab metadata — no document content (that lives in the
/// matching kind's per-kind `HashMap<TabId, XDocument>` in `state.rs`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabMeta {
    pub id: TabId,
    pub kind: MachineKind,
    pub name: String,
}

/// Owns the ordered, kind-tagged tab list and the `TabId` allocator. A new,
/// separate piece of state (not a replacement for any of the 5 existing
/// per-kind sessions in `state.rs`).
pub struct ProjectSession {
    next_tab_id: TabId,
    tabs: Vec<TabMeta>,
}

impl ProjectSession {
    pub fn new() -> Self {
        ProjectSession { next_tab_id: TabId(0), tabs: Vec::new() }
    }

    /// Allocates a fresh, unique `TabId` and appends a new tab of `kind`
    /// named `name` at the end of the ordered list.
    pub fn new_tab(&mut self, kind: MachineKind, name: impl Into<String>) -> TabId {
        let id = self.next_tab_id;
        self.next_tab_id = TabId(id.0 + 1);
        self.tabs.push(TabMeta { id, kind, name: name.into() });
        id
    }

    /// The ordered tab list, front-to-back in display order.
    pub fn tabs(&self) -> &[TabMeta] {
        &self.tabs
    }

    /// Removes the tab with `id`, preserving the relative order of the
    /// rest. Returns `true` if a tab was actually removed.
    pub fn remove_tab(&mut self, id: TabId) -> bool {
        let before = self.tabs.len();
        self.tabs.retain(|t| t.id != id);
        self.tabs.len() != before
    }

    /// Renames the tab with `id` to `name`, preserving its id and position.
    /// Returns `false` (a no-op) if no tab has that id — mirrors
    /// `remove_tab`'s not-found convention.
    pub fn rename_tab(&mut self, id: TabId, name: impl Into<String>) -> bool {
        match self.tabs.iter_mut().find(|t| t.id == id) {
            Some(t) => {
                t.name = name.into();
                true
            }
            None => false,
        }
    }

    /// Moves the tab currently at index `from` to index `to`, shifting the
    /// tabs in between. A no-op if either index is out of bounds.
    pub fn reorder(&mut self, from: usize, to: usize) {
        if from >= self.tabs.len() || to >= self.tabs.len() {
            return;
        }
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
    }

    /// Empties the tab list WITHOUT resetting `next_tab_id` — used by
    /// `project_new`/`project_open` (a full project replace) instead of
    /// `*guard = ProjectSession::new()`, so a freshly created/loaded
    /// project's tabs never reuse an id from the project it replaces.
    /// `TabHost` (frontend) tracks a mounted document view by `TabId`
    /// alone: reusing id 0 for a new project's first tab (every prior
    /// `ProjectSession::new()` reset the allocator back to 0) collided
    /// with whatever view was ALREADY mounted at id 0 — almost always
    /// true, since the very first tab of every app session is id 0 —
    /// leaving that stale, never-reloaded mount on screen instead of the
    /// new project's actual first tab.
    pub fn clear_tabs(&mut self) {
        self.tabs.clear();
    }
}

impl Default for ProjectSession {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_tab_allocates_unique_monotonically_increasing_ids() {
        let mut session = ProjectSession::new();
        let a = session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Fa, "B");
        let c = session.new_tab(MachineKind::Tm, "C");

        assert_ne!(a, b);
        assert_ne!(b, c);
        assert!(a.0 < b.0);
        assert!(b.0 < c.0);
    }

    #[test]
    fn clear_tabs_empties_the_list_but_keeps_allocating_past_the_highest_id_seen() {
        let mut session = ProjectSession::new();
        session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Fa, "B");

        session.clear_tabs();
        assert!(session.tabs().is_empty());

        let c = session.new_tab(MachineKind::Mealy, "C");
        assert!(c.0 > b.0);
    }

    #[test]
    fn new_tab_records_kind_and_name_in_order() {
        let mut session = ProjectSession::new();
        let id = session.new_tab(MachineKind::Pda, "My PDA");

        assert_eq!(session.tabs().len(), 1);
        let meta = &session.tabs()[0];
        assert_eq!(meta.id, id);
        assert_eq!(meta.kind, MachineKind::Pda);
        assert_eq!(meta.name, "My PDA");
    }

    #[test]
    fn removing_a_middle_tab_preserves_order_of_the_rest() {
        let mut session = ProjectSession::new();
        let a = session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Mealy, "B");
        let c = session.new_tab(MachineKind::Tm, "C");

        assert!(session.remove_tab(b));

        let ids: Vec<TabId> = session.tabs().iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![a, c]);
    }

    #[test]
    fn rename_tab_updates_the_name_in_place_preserving_id_and_position() {
        let mut session = ProjectSession::new();
        let a = session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Mealy, "B");

        assert!(session.rename_tab(a, "Renamed A"));

        let ids: Vec<TabId> = session.tabs().iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![a, b]);
        assert_eq!(session.tabs()[0].name, "Renamed A");
    }

    #[test]
    fn rename_tab_on_an_unknown_id_is_a_no_op() {
        let mut session = ProjectSession::new();
        session.new_tab(MachineKind::Fa, "A");

        assert!(!session.rename_tab(TabId(999), "Whatever"));
        assert_eq!(session.tabs()[0].name, "A");
    }

    #[test]
    fn removing_an_unknown_tab_id_is_a_no_op() {
        let mut session = ProjectSession::new();
        session.new_tab(MachineKind::Fa, "A");

        assert!(!session.remove_tab(TabId(999)));
        assert_eq!(session.tabs().len(), 1);
    }

    #[test]
    fn reorder_moves_a_tab_to_a_new_position() {
        let mut session = ProjectSession::new();
        let a = session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Mealy, "B");
        let c = session.new_tab(MachineKind::Tm, "C");

        session.reorder(2, 0); // move C to the front

        let ids: Vec<TabId> = session.tabs().iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![c, a, b]);
    }

    #[test]
    fn reorder_is_a_no_op_when_an_index_is_out_of_bounds() {
        let mut session = ProjectSession::new();
        let a = session.new_tab(MachineKind::Fa, "A");
        let b = session.new_tab(MachineKind::Mealy, "B");

        session.reorder(0, 5);

        let ids: Vec<TabId> = session.tabs().iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![a, b]);
    }
}
