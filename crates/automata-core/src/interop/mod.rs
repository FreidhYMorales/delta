//! File-format adapters over the `model`/`dto` layers. Never depends on
//! `engine` (design D5) — `.jff` and the native JSON format stay mutually
//! independent.

pub mod jff;
