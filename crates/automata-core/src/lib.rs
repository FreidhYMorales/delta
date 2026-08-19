//! automata-core: pure automata model, engine, and interop library.
//!
//! No dependency on Tauri or any UI framework — testable standalone via
//! `cargo test -p automata-core` and reusable by a future CLI.

pub mod convert;
pub mod doc;
pub mod dto;
pub mod engine;
pub mod grammar;
pub mod ids;
pub mod interop;
pub mod mealy_doc;
pub mod model;
pub mod moore_doc;
pub mod pda_doc;
pub mod regex;
