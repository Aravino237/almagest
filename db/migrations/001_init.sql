CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  user_id     INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL DEFAULT 12.82 CHECK (lat BETWEEN -90 AND 90),
  lon         DOUBLE PRECISION NOT NULL DEFAULT 80.04 CHECK (lon BETWEEN -180 AND 180),
  location_name TEXT NOT NULL DEFAULT 'Kattankulathur, India',
  bortle      INT NOT NULL DEFAULT 6 CHECK (bortle BETWEEN 1 AND 9),
  aperture_mm INT NOT NULL DEFAULT 0 CHECK (aperture_mm BETWEEN 0 AND 2000),
  experience  TEXT NOT NULL DEFAULT 'beginner' CHECK (experience IN ('beginner','intermediate','advanced')),
  min_alt     INT NOT NULL DEFAULT 15 CHECK (min_alt BETWEEN 0 AND 60),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE objects (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  catalog_id    TEXT,
  type          TEXT NOT NULL CHECK (type IN ('galaxy','nebula','globular_cluster','open_cluster','planetary_nebula','double_star','planet')),
  ra_hours      DOUBLE PRECISION,           -- J2000; NULL for planets (computed live)
  dec_deg       DOUBLE PRECISION,
  magnitude     DOUBLE PRECISION,           -- NULL for planets (computed live)
  size_arcmin   DOUBLE PRECISION NOT NULL,
  constellation TEXT,
  description   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE observations (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id    INT REFERENCES objects(id) ON DELETE SET NULL,
  target_name  TEXT NOT NULL CHECK (char_length(target_name) BETWEEN 1 AND 120),
  observed_at  TIMESTAMPTZ NOT NULL,
  lat          DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon          DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  seeing       INT NOT NULL CHECK (seeing BETWEEN 1 AND 5),
  transparency INT NOT NULL CHECK (transparency BETWEEN 1 AND 5),
  rating       INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  equipment    TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX observations_user_idx ON observations(user_id, observed_at DESC);

-- Every labelled example the recommender has learned from (keeps training reproducible).
CREATE TABLE feedback (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id   INT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  label       REAL NOT NULL CHECK (label BETWEEN 0 AND 1),
  source      TEXT NOT NULL CHECK (source IN ('thumbs','log')),
  observation_id INT REFERENCES observations(id) ON DELETE CASCADE,
  features    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feedback_user_idx ON feedback(user_id, created_at);

CREATE TABLE user_models (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delta      JSONB NOT NULL,             -- personal offset from the global weights
  n_updates  INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE global_model (
  id         INT PRIMARY KEY CHECK (id = 1),
  weights    JSONB NOT NULL,
  n_updates  INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE community_events (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description   TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  starts_at     TIMESTAMPTZ NOT NULL,
  location_name TEXT NOT NULL CHECK (char_length(location_name) BETWEEN 1 AND 120),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX community_events_start_idx ON community_events(starts_at);

CREATE TABLE event_rsvps (
  event_id INT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
