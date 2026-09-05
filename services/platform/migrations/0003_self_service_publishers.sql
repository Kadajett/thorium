CREATE TABLE thorium_publishers (
  publisher_id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_scheme text NOT NULL CHECK (password_scheme = 'scrypt-v1'),
  password_salt bytea NOT NULL CHECK (octet_length(password_salt) = 16),
  password_hash bytea NOT NULL CHECK (octet_length(password_hash) = 32),
  publish_token_digest bytea NOT NULL UNIQUE
    CHECK (octet_length(publish_token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  token_rotated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (username ~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$')
);

CREATE TABLE thorium_game_package_owners (
  package_id text PRIMARY KEY,
  publisher_id uuid REFERENCES thorium_publishers(publisher_id),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (package_id ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'),
  CHECK (char_length(package_id) <= 128)
);

CREATE TABLE thorium_self_service_release_reservations (
  package_id text NOT NULL,
  package_version text NOT NULL,
  content_digest character(64) NOT NULL
    CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  bundle_size_bytes bigint NOT NULL CHECK (bundle_size_bytes BETWEEN 1 AND 134217728),
  publisher_id uuid NOT NULL REFERENCES thorium_publishers(publisher_id),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (package_id, package_version),
  FOREIGN KEY (package_id) REFERENCES thorium_game_package_owners(package_id),
  CHECK (package_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  CHECK (char_length(package_version) <= 64)
);

CREATE INDEX thorium_self_service_release_reservations_publisher
  ON thorium_self_service_release_reservations (publisher_id);

-- Existing operator-published package IDs are reserved and cannot be claimed
-- through the public publisher API. A NULL owner remains operator-only.
INSERT INTO thorium_game_package_owners (package_id, publisher_id)
SELECT DISTINCT package_id, NULL::uuid
  FROM thorium_game_releases
ON CONFLICT (package_id) DO NOTHING;
