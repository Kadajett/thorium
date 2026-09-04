//! Platform-neutral domain and semantic input types for Thorium.
//!
//! This crate deliberately knows nothing about Android-specific identifiers,
//! presentation frameworks, networking transports, or game execution formats.

mod domain;
mod input;

pub use domain::{
    AccountSession, GameSession, GameSessionId, PlayerBinding, PlayerLocality, PlayerSlot,
    SessionError, SurfaceBinding, SurfaceRole,
};
pub use input::{
    ActionId, AxisRange, ButtonPhase, ControlId, InputBinding, InputError, InputMap,
    InputNormalizer, NormalizedAxis, NormalizedCoordinate, PlayerInput, PointerPhase, RawInput,
    SemanticControl, SurfacePoint,
};
