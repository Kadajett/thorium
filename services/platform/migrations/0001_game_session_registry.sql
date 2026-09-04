CREATE TABLE thorium_game_session_accounts (
  account_id text PRIMARY KEY,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  CHECK (char_length(account_id) BETWEEN 1 AND 128)
);

CREATE TABLE thorium_game_sessions (
  game_session_id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES thorium_game_session_accounts(account_id),
  generation bigint NOT NULL CHECK (generation > 0),
  request_id text NOT NULL,
  request_fingerprint character(64) NOT NULL
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  package_id text NOT NULL,
  package_version text NOT NULL,
  package_digest character(64) NOT NULL
    CHECK (package_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL
    CHECK (status IN ('active', 'finished', 'superseded')),
  finish_reason text
    CHECK (finish_reason IS NULL OR finish_reason IN ('completed', 'abandoned', 'room-failed')),
  supersedes_game_session_id uuid REFERENCES thorium_game_sessions(game_session_id),
  room_instance_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE (account_id, request_id),
  UNIQUE (account_id, generation),
  CHECK (char_length(request_id) BETWEEN 1 AND 128),
  CHECK (char_length(package_id) BETWEEN 1 AND 128),
  CHECK (char_length(package_version) BETWEEN 1 AND 64),
  CHECK (room_instance_id IS NULL OR char_length(room_instance_id) BETWEEN 1 AND 128),
  CHECK (
    (status = 'active' AND finished_at IS NULL AND finish_reason IS NULL)
    OR (status = 'superseded' AND finished_at IS NOT NULL AND finish_reason IS NULL)
    OR (status = 'finished' AND finished_at IS NOT NULL AND finish_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX thorium_one_active_game_session_per_account
  ON thorium_game_sessions (account_id)
  WHERE status = 'active';

CREATE INDEX thorium_game_sessions_release_lookup
  ON thorium_game_sessions (package_id, package_version, package_digest);

CREATE TABLE thorium_game_session_surfaces (
  game_session_id uuid NOT NULL
    REFERENCES thorium_game_sessions(game_session_id) ON DELETE CASCADE,
  capability_id uuid NOT NULL UNIQUE,
  surface_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('main', 'companion')),
  admitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_session_id, surface_id),
  UNIQUE (game_session_id, role),
  CHECK (char_length(surface_id) BETWEEN 1 AND 64)
);

CREATE TABLE thorium_game_session_player_slots (
  game_session_id uuid NOT NULL,
  surface_id text NOT NULL,
  player_slot smallint NOT NULL CHECK (player_slot BETWEEN 0 AND 15),
  PRIMARY KEY (game_session_id, player_slot),
  FOREIGN KEY (game_session_id, surface_id)
    REFERENCES thorium_game_session_surfaces(game_session_id, surface_id)
    ON DELETE CASCADE
);
