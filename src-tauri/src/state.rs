//! Tauri-managed application state (design D3): each of the 5 machine kinds
//! is backed by a `Mutex<HashMap<TabId, XDocument>>`, guarded by a mutex,
//! shared across every IPC command via `tauri::State<'_, Session>` (and its
//! `MealySession`/`MooreSession`/`PdaSession`/`TmSession` siblings).
//!
//! `MealySession`/`MooreSession`/`PdaSession`/`TmSession` are each a
//! genuinely separate piece of managed state, not a variant of `Session` —
//! same "isolated, not a generalization" choice as `MealyDoc`/`MooreDoc`/
//! `PdaDoc` vs `FaDoc` (docs/decisions.md). All five are always managed
//! (`.manage(...)` in `lib.rs`) regardless of which editor mode the frontend
//! currently shows; only one is *addressed* by IPC calls at a time, decided
//! by which set of commands the frontend calls.
//!
//! Design D14 migration seam: each kind's map is seeded with exactly one
//! document at `SEEDED_TAB_ID` on construction, so every existing IPC
//! command — none of which take a `tab_id` yet (that is PR4-PR8's job, one
//! kind at a time) — keeps compiling and behaving exactly as before by
//! transparently targeting that one seeded tab through the `with`/
//! `with_mut`/`try_with`/`try_with_mut` helpers below. `insert`/`remove` are
//! for later PRs to build on once real per-tab document lifecycle exists.
//!
//! Live undo/redo `History` stays per-tab (each map entry carries its own),
//! never serialized on tab switch.

use std::collections::HashMap;
use std::sync::Mutex;

use automata_core::doc::Document;
use automata_core::mealy_doc::MealyDocument;
use automata_core::moore_doc::MooreDocument;
use automata_core::pda_doc::PdaDocument;
use automata_core::tm_doc::TmDocument;

use crate::tabs::TabId;

/// The single tab every pre-multi-tab-project command transparently
/// addresses until PR4-PR8 thread a real `tab_id` through each kind's
/// commands one at a time.
pub const SEEDED_TAB_ID: TabId = TabId(0);

/// Defines a per-kind session type wrapping `Mutex<HashMap<TabId, $doc>>`,
/// seeded with one `$doc::new()` at `SEEDED_TAB_ID`, plus the `with`/
/// `with_mut`/`try_with`/`try_with_mut`/`insert`/`remove` helpers every
/// kind needs identically (mirrors `automata_core::ids`'s
/// `define_arena_id!` convention for repeated per-kind boilerplate).
macro_rules! define_session {
    ($name:ident, $doc:ty) => {
        pub struct $name(pub Mutex<HashMap<TabId, $doc>>);

        impl $name {
            pub fn new() -> Self {
                let mut docs = HashMap::new();
                docs.insert(SEEDED_TAB_ID, <$doc>::new());
                $name(Mutex::new(docs))
            }

            /// Locks the session and runs `f` against `id`'s document.
            /// Panics if the mutex is poisoned (mirrors every existing call
            /// site's previous `.expect("session mutex poisoned")`) or if
            /// `id` has no document — unreachable today since every command
            /// only ever addresses `SEEDED_TAB_ID`.
            pub fn with<R>(&self, id: TabId, f: impl FnOnce(&$doc) -> R) -> R {
                let docs = self.0.lock().expect("session mutex poisoned");
                let doc = docs.get(&id).expect("unknown tab id");
                f(doc)
            }

            /// Mutable counterpart of `with`.
            pub fn with_mut<R>(&self, id: TabId, f: impl FnOnce(&mut $doc) -> R) -> R {
                let mut docs = self.0.lock().expect("session mutex poisoned");
                let doc = docs.get_mut(&id).expect("unknown tab id");
                f(doc)
            }

            /// Fallible counterpart of `with`: propagates both a poisoned
            /// mutex and an unknown `id` as a `String` error via `?` instead
            /// of panicking (PR4 needs this: once a real `tab_id` is threaded
            /// through IPC commands, a forged/unallocated id is caller input,
            /// not an invariant violation, so it must never panic).
            pub fn try_with<R>(&self, id: TabId, f: impl FnOnce(&$doc) -> R) -> Result<R, String> {
                let docs = self.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
                let doc = docs.get(&id).ok_or_else(|| format!("unknown tab id {}", id.0))?;
                Ok(f(doc))
            }

            /// Fallible counterpart of `with_mut`. See `try_with`'s doc
            /// comment for why an unknown `id` is an `Err` here too.
            pub fn try_with_mut<R>(&self, id: TabId, f: impl FnOnce(&mut $doc) -> R) -> Result<R, String> {
                let mut docs = self.0.lock().map_err(|_| "session mutex poisoned".to_string())?;
                let doc = docs.get_mut(&id).ok_or_else(|| format!("unknown tab id {}", id.0))?;
                Ok(f(doc))
            }

            /// Inserts (or replaces) `id`'s document. For later PRs: opening
            /// a new tab, or a project-load populating every tab at once.
            pub fn insert(&self, id: TabId, doc: $doc) {
                self.0.lock().expect("session mutex poisoned").insert(id, doc);
            }

            /// Removes and returns `id`'s document, if any. For later PRs:
            /// closing a tab.
            pub fn remove(&self, id: TabId) -> Option<$doc> {
                self.0.lock().expect("session mutex poisoned").remove(&id)
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}

define_session!(Session, Document);
define_session!(MealySession, MealyDocument);
define_session!(MooreSession, MooreDocument);
define_session!(PdaSession, PdaDocument);
define_session!(TmSession, TmDocument);

#[cfg(test)]
mod tests {
    use super::*;
    use automata_core::doc::EditOp;

    #[test]
    fn new_seeds_exactly_one_document_at_the_seeded_tab_id() {
        let session = Session::new();
        session.with(SEEDED_TAB_ID, |doc| {
            assert_eq!(doc.revision, 0);
            assert_eq!(doc.model.states().count(), 0);
        });
    }

    #[test]
    fn editing_a_second_inserted_tab_does_not_affect_the_seeded_tabs_document() {
        let session = Session::new();
        let second = TabId(1);
        session.insert(second, Document::new());

        session.with_mut(second, |doc| {
            doc.apply(vec![EditOp::AddState { label: "q0".into(), x: 0.0, y: 0.0 }]);
        });

        session.with(SEEDED_TAB_ID, |doc| {
            assert_eq!(doc.revision, 0);
            assert_eq!(doc.model.states().count(), 0);
        });
        session.with(second, |doc| {
            assert_eq!(doc.revision, 1);
            assert_eq!(doc.model.states().count(), 1);
        });
    }

    #[test]
    fn try_with_on_an_unknown_tab_id_is_an_err_not_a_panic() {
        let session = Session::new();
        let result = session.try_with(TabId(999), |doc| doc.revision);
        assert!(result.is_err());
    }

    #[test]
    fn try_with_mut_on_an_unknown_tab_id_is_an_err_not_a_panic() {
        let session = Session::new();
        let result = session.try_with_mut(TabId(999), |doc| doc.revision);
        assert!(result.is_err());
    }

    #[test]
    fn remove_drops_a_tabs_document_and_returns_it() {
        let session = Session::new();
        let second = TabId(1);
        session.insert(second, Document::new());

        assert!(session.remove(second).is_some());
        assert!(session.remove(second).is_none());
    }
}
