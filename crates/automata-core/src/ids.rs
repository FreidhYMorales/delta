//! Generic id + label arena shared by states and symbols.
//!
//! `StateId`/`SymbolId` are opaque newtypes over `u32`. Both are allocated
//! from the same generic [`Arena`], which assigns monotonically increasing
//! ids, recycles freed slots via a free-list, and maintains a label -> id
//! index for name-based lookup (used by the table/formal-definition views,
//! which address states and symbols by name, not by raw id).

use std::collections::HashMap;
use std::hash::Hash;

/// A type that can be used as an arena-allocated id.
pub trait ArenaId: Copy + Eq + Hash + Ord + std::fmt::Debug {
    fn from_index(index: u32) -> Self;
    fn index(self) -> u32;
}

macro_rules! define_arena_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u32);

        impl ArenaId for $name {
            fn from_index(index: u32) -> Self {
                $name(index)
            }
            fn index(self) -> u32 {
                self.0
            }
        }
    };
}

define_arena_id!(StateId);
define_arena_id!(SymbolId);

/// Error returned when a label operation would create a duplicate identifier.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ArenaError {
    #[error("label {0:?} is already in use")]
    DuplicateLabel(Box<str>),
    #[error("id {0:?} does not exist")]
    UnknownId(Box<str>),
}

/// Generic id/label arena: allocates ids, recycles freed ones, and keeps a
/// label -> id index for lookup and collision detection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Arena<Id: ArenaId> {
    /// `None` means the slot is tombstoned (freed).
    labels: Vec<Option<Box<str>>>,
    free: Vec<Id>,
    label_index: HashMap<Box<str>, Id>,
}

impl<Id: ArenaId> Default for Arena<Id> {
    fn default() -> Self {
        Self::new()
    }
}

impl<Id: ArenaId> Arena<Id> {
    pub fn new() -> Self {
        Arena {
            labels: Vec::new(),
            free: Vec::new(),
            label_index: HashMap::new(),
        }
    }

    /// Number of slots ever allocated (including tombstoned ones). Bounds the
    /// dense-index space used by e.g. compiled bitsets.
    pub fn capacity(&self) -> usize {
        self.labels.len()
    }

    /// Allocate a new id with the given label. The label must not already be
    /// in use by a live id.
    pub fn alloc(&mut self, label: impl Into<Box<str>>) -> Result<Id, ArenaError> {
        let label: Box<str> = label.into();
        if self.label_index.contains_key(&label) {
            return Err(ArenaError::DuplicateLabel(label));
        }
        let id = if let Some(id) = self.free.pop() {
            self.labels[id.index() as usize] = Some(label.clone());
            id
        } else {
            let id = Id::from_index(self.labels.len() as u32);
            self.labels.push(Some(label.clone()));
            id
        };
        self.label_index.insert(label, id);
        Ok(id)
    }

    /// Allocate a *specific* id, bypassing the normal free-list order. Used
    /// to reconstruct a previously-freed id exactly during undo (design D4);
    /// correct only under strict LIFO undo/redo discipline, which guarantees
    /// the id is free again by the time this is called. Fails if `id` is
    /// currently alive, or if `label` is in use by a different live id.
    pub fn alloc_at(&mut self, id: Id, label: impl Into<Box<str>>) -> Result<(), ArenaError> {
        let label: Box<str> = label.into();
        if self.is_alive(id) {
            return Err(ArenaError::DuplicateLabel(label));
        }
        if let Some(existing) = self.label_index.get(&label) {
            if *existing != id {
                return Err(ArenaError::DuplicateLabel(label));
            }
        }
        let idx = id.index() as usize;
        if idx >= self.labels.len() {
            self.labels.resize(idx + 1, None);
        } else {
            self.free.retain(|&f| f != id);
        }
        self.labels[idx] = Some(label.clone());
        self.label_index.insert(label, id);
        Ok(())
    }

    /// Free a live id, tombstoning its slot for future reuse.
    pub fn free(&mut self, id: Id) {
        if let Some(slot) = self.labels.get_mut(id.index() as usize) {
            if let Some(label) = slot.take() {
                self.label_index.remove(&label);
                self.free.push(id);
            }
        }
    }

    pub fn is_alive(&self, id: Id) -> bool {
        matches!(self.labels.get(id.index() as usize), Some(Some(_)))
    }

    pub fn label(&self, id: Id) -> Option<&str> {
        self.labels
            .get(id.index() as usize)
            .and_then(|s| s.as_deref())
    }

    pub fn id_for_label(&self, label: &str) -> Option<Id> {
        self.label_index.get(label).copied()
    }

    /// Rename a live id. Fails if the new label is already in use by a
    /// *different* live id (renaming to the same label is a no-op success).
    pub fn rename(&mut self, id: Id, new_label: impl Into<Box<str>>) -> Result<(), ArenaError> {
        let new_label: Box<str> = new_label.into();
        if !self.is_alive(id) {
            return Err(ArenaError::UnknownId(new_label));
        }
        if let Some(existing) = self.label_index.get(&new_label) {
            if *existing != id {
                return Err(ArenaError::DuplicateLabel(new_label));
            }
            return Ok(());
        }
        let old_label = self.labels[id.index() as usize].take().unwrap();
        self.label_index.remove(&old_label);
        self.labels[id.index() as usize] = Some(new_label.clone());
        self.label_index.insert(new_label, id);
        Ok(())
    }

    /// Iterate all currently-alive ids, in ascending id order.
    pub fn iter_alive(&self) -> impl Iterator<Item = Id> + '_ {
        self.labels.iter().enumerate().filter_map(|(idx, slot)| {
            slot.as_ref().map(|_| Id::from_index(idx as u32))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alloc_assigns_increasing_ids_and_indexes_labels() {
        let mut arena: Arena<StateId> = Arena::new();
        let q0 = arena.alloc("q0").unwrap();
        let q1 = arena.alloc("q1").unwrap();
        assert_eq!(q0, StateId(0));
        assert_eq!(q1, StateId(1));
        assert_eq!(arena.label(q0), Some("q0"));
        assert_eq!(arena.id_for_label("q1"), Some(q1));
        assert!(arena.is_alive(q0));
    }

    #[test]
    fn alloc_rejects_duplicate_label() {
        let mut arena: Arena<StateId> = Arena::new();
        arena.alloc("q0").unwrap();
        let err = arena.alloc("q0").unwrap_err();
        assert_eq!(err, ArenaError::DuplicateLabel("q0".into()));
    }

    #[test]
    fn free_tombstones_and_alloc_recycles_the_slot() {
        let mut arena: Arena<StateId> = Arena::new();
        let q0 = arena.alloc("q0").unwrap();
        let q1 = arena.alloc("q1").unwrap();
        arena.free(q0);
        assert!(!arena.is_alive(q0));
        assert_eq!(arena.label(q0), None);
        assert_eq!(arena.id_for_label("q0"), None);
        // freeing q0 lets its label be reused by a fresh alloc
        let q0_reused = arena.alloc("q0").unwrap();
        assert_eq!(q0_reused, q0); // slot recycled
        assert!(arena.is_alive(q0_reused));
        assert!(arena.is_alive(q1));
    }

    #[test]
    fn rename_updates_label_index_and_blocks_collisions() {
        let mut arena: Arena<StateId> = Arena::new();
        let a = arena.alloc("A").unwrap();
        let b = arena.alloc("B").unwrap();
        arena.rename(a, "C").unwrap();
        assert_eq!(arena.label(a), Some("C"));
        assert_eq!(arena.id_for_label("A"), None);
        assert_eq!(arena.id_for_label("C"), Some(a));

        let err = arena.rename(b, "C").unwrap_err();
        assert_eq!(err, ArenaError::DuplicateLabel("C".into()));
        assert_eq!(arena.label(b), Some("B"));
    }

    #[test]
    fn iter_alive_skips_freed_slots() {
        let mut arena: Arena<StateId> = Arena::new();
        let q0 = arena.alloc("q0").unwrap();
        let _q1 = arena.alloc("q1").unwrap();
        arena.free(q0);
        let alive: Vec<_> = arena.iter_alive().collect();
        assert_eq!(alive, vec![StateId(1)]);
    }

    #[test]
    fn alloc_at_reconstructs_a_freed_id_exactly() {
        let mut arena: Arena<StateId> = Arena::new();
        let q0 = arena.alloc("q0").unwrap();
        let _q1 = arena.alloc("q1").unwrap();
        arena.free(q0);
        arena.alloc_at(q0, "q0").unwrap();
        assert!(arena.is_alive(q0));
        assert_eq!(arena.label(q0), Some("q0"));
        // slot is no longer in the free list, so a normal alloc won't recycle it again
        let fresh = arena.alloc("q2").unwrap();
        assert_ne!(fresh, q0);
    }

    #[test]
    fn alloc_at_rejects_when_id_already_alive() {
        let mut arena: Arena<StateId> = Arena::new();
        let q0 = arena.alloc("q0").unwrap();
        let err = arena.alloc_at(q0, "other").unwrap_err();
        assert_eq!(err, ArenaError::DuplicateLabel("other".into()));
    }

    #[test]
    fn symbol_id_arena_works_identically() {
        let mut arena: Arena<SymbolId> = Arena::new();
        let a = arena.alloc("a").unwrap();
        let b = arena.alloc("b").unwrap();
        assert_ne!(a, b);
        assert_eq!(arena.id_for_label("a"), Some(a));
    }
}
