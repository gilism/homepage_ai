-- D1 콘솔에 붙여넣는 표 만들기 (한 번만 실행)
CREATE TABLE applicants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  organization TEXT,
  position     TEXT,
  phone        TEXT NOT NULL CHECK (length(trim(phone)) > 0),
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(email)) > 0),
  created_at   TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
