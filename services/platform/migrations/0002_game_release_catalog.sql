CREATE TABLE thorium_game_releases (
  package_id text NOT NULL,
  package_version text NOT NULL,
  content_digest character(64) NOT NULL UNIQUE
    CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  bundle_file_name text NOT NULL,
  bundle_sha256 character(64) NOT NULL
    CHECK (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  bundle_size_bytes bigint NOT NULL CHECK (bundle_size_bytes BETWEEN 1 AND 134217728),
  published_at timestamptz NOT NULL,
  release_json jsonb NOT NULL,
  PRIMARY KEY (package_id, package_version),
  CHECK (package_id ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'),
  CHECK (char_length(package_id) <= 128),
  CHECK (package_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  CHECK (char_length(package_version) <= 64),
  CHECK (bundle_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$'),
  CHECK (char_length(bundle_file_name) <= 256),
  CHECK (release_json ->> 'packageId' = package_id),
  CHECK (release_json ->> 'version' = package_version),
  CHECK (release_json ->> 'contentDigest' = content_digest),
  CHECK (release_json #>> '{bundle,fileName}' = bundle_file_name),
  CHECK (release_json #>> '{bundle,sha256}' = bundle_sha256),
  CHECK ((release_json #>> '{bundle,sizeBytes}')::bigint = bundle_size_bytes)
);

CREATE INDEX thorium_game_releases_catalog_order
  ON thorium_game_releases (package_id, published_at DESC, package_version DESC);
