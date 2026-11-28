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

-- 회원 표 (카카오·네이버·구글 소셜 로그인 회원)
CREATE TABLE IF NOT EXISTS members (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL CHECK (provider IN ('kakao', 'naver', 'google')),
  provider_user_id  TEXT NOT NULL CHECK (length(trim(provider_user_id)) > 0),
  nickname          TEXT UNIQUE COLLATE NOCASE CHECK (nickname IS NULL OR length(trim(nickname)) > 0),
  email             TEXT,
  signup_token      TEXT UNIQUE,
  signup_token_at   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  last_login_at     TEXT,
  UNIQUE (provider, provider_user_id)
);
