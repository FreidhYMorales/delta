//! JFLAP `.jff` finite-automaton interop (spec domain `jflap-interop`).
//!
//! `schema.rs` is the pinned XML shape (see its module doc for provenance).
//! `reader.rs` is XML bytes -> `schema::JffFile` -> `FaDoc`. `writer.rs` is
//! the reverse. `report.rs` is the shared, always-returned loss/mapping
//! report (spec "Visible Loss Report on Lossy Conversion").

pub mod reader;
pub mod report;
pub mod schema;
pub mod writer;

pub use report::{Direction, InteropReport, LossCode, LossItem, Severity, Subject};

/// Errors that abort an import/export entirely — as opposed to `LossItem`s,
/// which are non-fatal notes attached to an otherwise-successful
/// `InteropReport`. Never leave a partial `FaDoc` behind (spec "Reject
/// non-FA .jff content", "Malformed file").
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum JffError {
    #[error("`.jff` file is not well-formed XML: {0}")]
    NotWellFormed(String),
    #[error("unsupported structure type {found:?}: only \"fa\" (finite automata) is supported, not PDA/Turing-machine/grammar files")]
    UnsupportedType { found: String },
    #[error("malformed `.jff` file: {0}")]
    Malformed(String),
}
