-- Banque de questions : jamais exposée telle quelle. options[0] est la bonne réponse.
CREATE TABLE questions (
  id          INTEGER PRIMARY KEY,
  theme       TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('knowledge', 'situation')),
  procedures  TEXT    NOT NULL,             -- ex. ",cr,csp,nat,"
  text        TEXT    NOT NULL,
  options     TEXT    NOT NULL,             -- JSON array de 4 chaînes
  explanation TEXT    NOT NULL,
  source      TEXT
);
CREATE INDEX idx_questions_kind ON questions (kind);

-- Une partie de quiz. items = [{ "q": id, "p": [permutation] }], answers = [index affiché | null]
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  procedure  TEXT    NOT NULL,
  mode       TEXT    NOT NULL CHECK (mode IN ('instant', 'final')),
  exam       INTEGER NOT NULL,
  items      TEXT    NOT NULL,
  answers    TEXT    NOT NULL,
  finished   INTEGER NOT NULL DEFAULT 0,
  last_at    INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Compteurs de limitation de débit (clé = portée + empreinte d'IP + fenêtre)
CREATE TABLE rate_limits (
  k   TEXT    PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_exp ON rate_limits (exp);
