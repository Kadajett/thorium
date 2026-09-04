use core::fmt;
use std::collections::HashSet;

use crate::{GameSession, PlayerSlot, SurfaceRole};

/// Adapter-defined physical control identifier.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ControlId(u16);

impl ControlId {
    pub const fn new(value: u16) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}

/// Game-defined semantic action identifier such as `jump` or `move_x`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct ActionId(u16);

impl ActionId {
    pub const fn new(value: u16) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}

/// A raw axis calibration supplied by the platform adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AxisRange {
    minimum: i32,
    center: i32,
    maximum: i32,
}

impl AxisRange {
    pub fn new(minimum: i32, center: i32, maximum: i32) -> Result<Self, InputError> {
        if minimum >= center || center >= maximum {
            return Err(InputError::InvalidAxisRange);
        }
        Ok(Self {
            minimum,
            center,
            maximum,
        })
    }
}

/// Signed semantic axis value in the inclusive range `-32767..=32767`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalizedAxis(i16);

impl NormalizedAxis {
    pub const MIN: Self = Self(-32_767);
    pub const CENTER: Self = Self(0);
    pub const MAX: Self = Self(32_767);

    pub const fn get(self) -> i16 {
        self.0
    }
}

/// Surface coordinate in the inclusive range `0..=65535`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalizedCoordinate(u16);

impl NormalizedCoordinate {
    pub const MIN: Self = Self(0);
    pub const MAX: Self = Self(u16::MAX);

    pub const fn get(self) -> u16 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SurfacePoint {
    pub x: NormalizedCoordinate,
    pub y: NormalizedCoordinate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ButtonPhase {
    Pressed,
    Released,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PointerPhase {
    Down,
    Move,
    Up,
    Cancel,
}

/// Platform-neutral input before semantic action mapping and normalization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RawInput {
    Button {
        control: ControlId,
        pressed: bool,
    },
    Axis {
        control: ControlId,
        value: i32,
        range: AxisRange,
    },
    Pointer {
        surface: SurfaceRole,
        pointer: u8,
        phase: PointerPhase,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputBinding {
    Button {
        control: ControlId,
        action: ActionId,
    },
    Axis {
        control: ControlId,
        action: ActionId,
        dead_zone: u16,
        inverted: bool,
    },
}

impl InputBinding {
    const fn control(self) -> ControlId {
        match self {
            Self::Button { control, .. } | Self::Axis { control, .. } => control,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InputMap {
    bindings: Vec<InputBinding>,
}

impl InputMap {
    pub fn new(bindings: Vec<InputBinding>) -> Result<Self, InputError> {
        let mut controls = HashSet::with_capacity(bindings.len());
        for binding in &bindings {
            if !controls.insert(binding.control()) {
                return Err(InputError::DuplicateControl(binding.control()));
            }
            if let InputBinding::Axis { dead_zone, .. } = binding
                && *dead_zone >= 32_767
            {
                return Err(InputError::InvalidDeadZone(*dead_zone));
            }
        }
        Ok(Self { bindings })
    }

    pub fn bindings(&self) -> &[InputBinding] {
        &self.bindings
    }

    fn binding(&self, control: ControlId) -> Option<InputBinding> {
        self.bindings
            .iter()
            .copied()
            .find(|binding| binding.control() == control)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SemanticControl {
    Button {
        action: ActionId,
        phase: ButtonPhase,
    },
    Axis {
        action: ActionId,
        value: NormalizedAxis,
    },
    Pointer {
        surface: SurfaceRole,
        pointer: u8,
        phase: PointerPhase,
        position: SurfacePoint,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlayerInput {
    pub sequence: u64,
    pub player: PlayerSlot,
    pub control: SemanticControl,
}

/// Maps adapter-neutral physical controls to stable, semantic game input.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InputNormalizer {
    map: InputMap,
}

impl InputNormalizer {
    pub const fn new(map: InputMap) -> Self {
        Self { map }
    }

    pub const fn map(&self) -> &InputMap {
        &self.map
    }

    /// Returns `Ok(None)` for unmapped physical controls so adapters may pass
    /// through all device events without first filtering them.
    pub fn normalize(
        &self,
        session: &GameSession,
        player: PlayerSlot,
        sequence: u64,
        raw: RawInput,
    ) -> Result<Option<PlayerInput>, InputError> {
        if !session.has_player(player) {
            return Err(InputError::UnknownPlayer(player));
        }

        let control = match raw {
            RawInput::Button { control, pressed } => {
                let Some(binding) = self.map.binding(control) else {
                    return Ok(None);
                };
                let InputBinding::Button { action, .. } = binding else {
                    return Err(InputError::BindingKindMismatch(control));
                };
                SemanticControl::Button {
                    action,
                    phase: if pressed {
                        ButtonPhase::Pressed
                    } else {
                        ButtonPhase::Released
                    },
                }
            }
            RawInput::Axis {
                control,
                value,
                range,
            } => {
                let Some(binding) = self.map.binding(control) else {
                    return Ok(None);
                };
                let InputBinding::Axis {
                    action,
                    dead_zone,
                    inverted,
                    ..
                } = binding
                else {
                    return Err(InputError::BindingKindMismatch(control));
                };
                let mut value = normalize_axis(value, range, dead_zone);
                if inverted {
                    value = NormalizedAxis(-value.0);
                }
                SemanticControl::Axis { action, value }
            }
            RawInput::Pointer {
                surface,
                pointer,
                phase,
                x,
                y,
                width,
                height,
            } => {
                if !session.has_surface(surface) {
                    return Err(InputError::UnknownSurface(surface));
                }
                if width == 0 || height == 0 {
                    return Err(InputError::EmptyPointerExtent);
                }
                SemanticControl::Pointer {
                    surface,
                    pointer,
                    phase,
                    position: SurfacePoint {
                        x: normalize_coordinate(x, width),
                        y: normalize_coordinate(y, height),
                    },
                }
            }
        };

        Ok(Some(PlayerInput {
            sequence,
            player,
            control,
        }))
    }
}

fn normalize_axis(value: i32, range: AxisRange, dead_zone: u16) -> NormalizedAxis {
    let value = value.clamp(range.minimum, range.maximum);
    let normalized = if value >= range.center {
        let numerator = (i64::from(value) - i64::from(range.center)) * 32_767;
        numerator / (i64::from(range.maximum) - i64::from(range.center))
    } else {
        let numerator = (i64::from(range.center) - i64::from(value)) * 32_767;
        -(numerator / (i64::from(range.center) - i64::from(range.minimum)))
    };

    let sign = normalized.signum();
    let magnitude = normalized.unsigned_abs();
    let dead_zone = u64::from(dead_zone);
    if magnitude <= dead_zone {
        return NormalizedAxis::CENTER;
    }
    let rescaled = ((magnitude - dead_zone) * 32_767) / (32_767 - dead_zone);
    NormalizedAxis((sign * rescaled as i64) as i16)
}

fn normalize_coordinate(value: i32, extent: u32) -> NormalizedCoordinate {
    if extent == 1 {
        return NormalizedCoordinate::MIN;
    }
    let maximum = i64::from(extent - 1);
    let clamped = i64::from(value).clamp(0, maximum);
    NormalizedCoordinate(((clamped * i64::from(u16::MAX)) / maximum) as u16)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputError {
    InvalidAxisRange,
    InvalidDeadZone(u16),
    DuplicateControl(ControlId),
    UnknownPlayer(PlayerSlot),
    UnknownSurface(SurfaceRole),
    BindingKindMismatch(ControlId),
    EmptyPointerExtent,
}

impl fmt::Display for InputError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for InputError {}

#[cfg(test)]
mod tests {
    use crate::{AccountSession, GameSessionId, PlayerBinding, SurfaceBinding};

    use super::*;

    const MOVE_X: ActionId = ActionId::new(1);
    const JUMP: ActionId = ActionId::new(2);
    const STICK_X: ControlId = ControlId::new(10);
    const BUTTON_A: ControlId = ControlId::new(11);

    fn session() -> GameSession {
        let account = AccountSession::new(1);
        GameSession::new(
            GameSessionId::new(1),
            vec![
                SurfaceBinding::new(SurfaceRole::Main),
                SurfaceBinding::new(SurfaceRole::Companion),
            ],
            vec![
                PlayerBinding::local(PlayerSlot::new(0), account),
                PlayerBinding::local(PlayerSlot::new(1), account),
            ],
        )
        .unwrap()
    }

    fn normalizer() -> InputNormalizer {
        InputNormalizer::new(
            InputMap::new(vec![
                InputBinding::Axis {
                    control: STICK_X,
                    action: MOVE_X,
                    dead_zone: 3_000,
                    inverted: false,
                },
                InputBinding::Button {
                    control: BUTTON_A,
                    action: JUMP,
                },
            ])
            .unwrap(),
        )
    }

    #[test]
    fn maps_buttons_to_semantic_actions() {
        let input = normalizer()
            .normalize(
                &session(),
                PlayerSlot::new(1),
                7,
                RawInput::Button {
                    control: BUTTON_A,
                    pressed: true,
                },
            )
            .unwrap()
            .unwrap();

        assert_eq!(input.player, PlayerSlot::new(1));
        assert_eq!(input.sequence, 7);
        assert_eq!(
            input.control,
            SemanticControl::Button {
                action: JUMP,
                phase: ButtonPhase::Pressed,
            }
        );
    }

    #[test]
    fn normalizes_asymmetric_axes_and_applies_dead_zone() {
        let range = AxisRange::new(-100, 20, 220).unwrap();
        let center = normalizer()
            .normalize(
                &session(),
                PlayerSlot::new(0),
                1,
                RawInput::Axis {
                    control: STICK_X,
                    value: 20,
                    range,
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            center.control,
            SemanticControl::Axis {
                action: MOVE_X,
                value: NormalizedAxis::CENTER,
            }
        );

        let maximum = normalizer()
            .normalize(
                &session(),
                PlayerSlot::new(0),
                2,
                RawInput::Axis {
                    control: STICK_X,
                    value: 999,
                    range,
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            maximum.control,
            SemanticControl::Axis {
                action: MOVE_X,
                value: NormalizedAxis::MAX,
            }
        );
    }

    #[test]
    fn normalizes_pointer_coordinates_for_a_surface_role() {
        let input = normalizer()
            .normalize(
                &session(),
                PlayerSlot::new(0),
                8,
                RawInput::Pointer {
                    surface: SurfaceRole::Companion,
                    pointer: 3,
                    phase: PointerPhase::Move,
                    x: 50,
                    y: 25,
                    width: 101,
                    height: 51,
                },
            )
            .unwrap()
            .unwrap();

        assert_eq!(
            input.control,
            SemanticControl::Pointer {
                surface: SurfaceRole::Companion,
                pointer: 3,
                phase: PointerPhase::Move,
                position: SurfacePoint {
                    x: NormalizedCoordinate(32_767),
                    y: NormalizedCoordinate(32_767),
                },
            }
        );
    }

    #[test]
    fn rejects_unknown_players_and_surfaces() {
        assert_eq!(
            normalizer().normalize(
                &session(),
                PlayerSlot::new(99),
                0,
                RawInput::Button {
                    control: BUTTON_A,
                    pressed: true,
                },
            ),
            Err(InputError::UnknownPlayer(PlayerSlot::new(99)))
        );

        let main_only = GameSession::new(
            GameSessionId::new(2),
            vec![SurfaceBinding::new(SurfaceRole::Main)],
            vec![PlayerBinding::local(
                PlayerSlot::new(0),
                AccountSession::new(1),
            )],
        )
        .unwrap();
        assert_eq!(
            normalizer().normalize(
                &main_only,
                PlayerSlot::new(0),
                0,
                RawInput::Pointer {
                    surface: SurfaceRole::Companion,
                    pointer: 0,
                    phase: PointerPhase::Down,
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                },
            ),
            Err(InputError::UnknownSurface(SurfaceRole::Companion))
        );
    }

    #[test]
    fn full_i32_axis_ranges_do_not_overflow() {
        let range = AxisRange::new(i32::MIN, 0, i32::MAX).unwrap();
        assert_eq!(normalize_axis(i32::MIN, range, 0), NormalizedAxis::MIN);
        assert_eq!(normalize_axis(i32::MAX, range, 0), NormalizedAxis::MAX);
    }

    #[test]
    fn rejects_duplicate_control_bindings() {
        assert_eq!(
            InputMap::new(vec![
                InputBinding::Button {
                    control: BUTTON_A,
                    action: JUMP,
                },
                InputBinding::Axis {
                    control: BUTTON_A,
                    action: MOVE_X,
                    dead_zone: 0,
                    inverted: false,
                },
            ]),
            Err(InputError::DuplicateControl(BUTTON_A))
        );
    }
}
