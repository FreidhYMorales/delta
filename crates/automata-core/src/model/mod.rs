//! Edit-facing, name-stable, undoable document models. One module per
//! machine kind (`fa`, `mealy`, `moore`, `pda`, `tm`).

pub mod fa;
pub mod mealy;
pub mod moore;
pub mod pda;
pub mod tm;
