//! Edit-facing, name-stable, undoable document models. One module per
//! machine kind (`fa`, `mealy`, `moore`; `pda`/`tm` are future additions per D1/D7).

pub mod fa;
pub mod mealy;
pub mod moore;
