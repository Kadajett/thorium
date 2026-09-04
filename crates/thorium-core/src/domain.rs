use core::fmt;
use std::collections::HashSet;

/// Opaque identifier for one game session.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct GameSessionId(u128);

impl GameSessionId {
    pub const fn new(value: u128) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u128 {
        self.0
    }
}

/// Opaque, session-local alias for an authenticated account.
///
/// It is not a credential or stable account identifier. Multiple
/// [`PlayerSlot`] values may intentionally reference the same account session.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct AccountSession(u64);

impl AccountSession {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Logical role of a surface within a game session.
///
/// A role never contains an Android display ID, physical orientation, window
/// handle, or presentation identifier. Platform adapters decide which physical
/// surface fulfills each role.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum SurfaceRole {
    Main = 0,
    Companion = 1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SurfaceBinding {
    role: SurfaceRole,
}

impl SurfaceBinding {
    pub const fn new(role: SurfaceRole) -> Self {
        Self { role }
    }

    pub const fn role(self) -> SurfaceRole {
        self.role
    }
}

/// Stable player identity within one [`GameSession`].
///
/// Player identity is deliberately independent of both account identity and
/// surface role.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PlayerSlot(u8);

impl PlayerSlot {
    pub const fn new(value: u8) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u8 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayerLocality {
    Local,
    Remote,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PlayerBinding {
    slot: PlayerSlot,
    account: Option<AccountSession>,
    locality: PlayerLocality,
}

impl PlayerBinding {
    pub const fn new(
        slot: PlayerSlot,
        account: Option<AccountSession>,
        locality: PlayerLocality,
    ) -> Self {
        Self {
            slot,
            account,
            locality,
        }
    }

    pub const fn local(slot: PlayerSlot, account: AccountSession) -> Self {
        Self::new(slot, Some(account), PlayerLocality::Local)
    }

    pub const fn remote(slot: PlayerSlot) -> Self {
        Self::new(slot, None, PlayerLocality::Remote)
    }

    pub const fn slot(self) -> PlayerSlot {
        self.slot
    }

    pub const fn account(self) -> Option<AccountSession> {
        self.account
    }

    pub const fn locality(self) -> PlayerLocality {
        self.locality
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameSession {
    id: GameSessionId,
    surfaces: Vec<SurfaceBinding>,
    players: Vec<PlayerBinding>,
}

impl GameSession {
    pub fn new(
        id: GameSessionId,
        surfaces: Vec<SurfaceBinding>,
        players: Vec<PlayerBinding>,
    ) -> Result<Self, SessionError> {
        if surfaces.is_empty() {
            return Err(SessionError::NoSurfaces);
        }
        let mut surface_roles = HashSet::with_capacity(surfaces.len());
        if surfaces
            .iter()
            .any(|binding| !surface_roles.insert(binding.role))
        {
            return Err(SessionError::DuplicateSurfaceRole);
        }

        if players.is_empty() {
            return Err(SessionError::NoPlayers);
        }
        let mut player_slots = HashSet::with_capacity(players.len());
        if players
            .iter()
            .any(|binding| !player_slots.insert(binding.slot))
        {
            return Err(SessionError::DuplicatePlayerSlot);
        }

        Ok(Self {
            id,
            surfaces,
            players,
        })
    }

    pub const fn id(&self) -> GameSessionId {
        self.id
    }

    pub fn surfaces(&self) -> &[SurfaceBinding] {
        &self.surfaces
    }

    pub fn players(&self) -> &[PlayerBinding] {
        &self.players
    }

    pub fn has_surface(&self, role: SurfaceRole) -> bool {
        self.surfaces.iter().any(|binding| binding.role == role)
    }

    pub fn has_player(&self, slot: PlayerSlot) -> bool {
        self.players.iter().any(|binding| binding.slot == slot)
    }

    pub fn players_for_account(
        &self,
        account: AccountSession,
    ) -> impl Iterator<Item = PlayerSlot> + '_ {
        self.players
            .iter()
            .filter_map(move |binding| (binding.account == Some(account)).then_some(binding.slot))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionError {
    NoSurfaces,
    DuplicateSurfaceRole,
    NoPlayers,
    DuplicatePlayerSlot,
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NoSurfaces => "a game session needs at least one surface role",
            Self::DuplicateSurfaceRole => "a surface role may be bound only once",
            Self::NoPlayers => "a game session needs at least one player",
            Self::DuplicatePlayerSlot => "a player slot may be bound only once",
        })
    }
}

impl std::error::Error for SessionError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn surfaces() -> Vec<SurfaceBinding> {
        vec![
            SurfaceBinding::new(SurfaceRole::Main),
            SurfaceBinding::new(SurfaceRole::Companion),
        ]
    }

    #[test]
    fn multiple_player_slots_can_share_an_account_session() {
        let account = AccountSession::new(42);
        let session = GameSession::new(
            GameSessionId::new(1),
            surfaces(),
            vec![
                PlayerBinding::local(PlayerSlot::new(0), account),
                PlayerBinding::local(PlayerSlot::new(1), account),
            ],
        )
        .unwrap();

        assert_eq!(
            session.players_for_account(account).collect::<Vec<_>>(),
            vec![PlayerSlot::new(0), PlayerSlot::new(1)]
        );
    }

    #[test]
    fn player_slots_and_surface_roles_are_validated_independently() {
        let account = AccountSession::new(1);
        let duplicate_surface = GameSession::new(
            GameSessionId::new(1),
            vec![
                SurfaceBinding::new(SurfaceRole::Main),
                SurfaceBinding::new(SurfaceRole::Main),
            ],
            vec![PlayerBinding::local(PlayerSlot::new(0), account)],
        );
        assert_eq!(duplicate_surface, Err(SessionError::DuplicateSurfaceRole));

        let duplicate_player = GameSession::new(
            GameSessionId::new(1),
            surfaces(),
            vec![
                PlayerBinding::local(PlayerSlot::new(0), account),
                PlayerBinding::remote(PlayerSlot::new(0)),
            ],
        );
        assert_eq!(duplicate_player, Err(SessionError::DuplicatePlayerSlot));
    }
}
