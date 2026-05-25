-- ============================================================
--  ASSON VOTING SYSTEM — PostgreSQL Schema
--  Run this in the Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ELECTIONS
--    Each "voting section" (e.g. "2024 Departmental Awards")
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elections (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  price_per_vote numeric(10,2) NOT NULL DEFAULT 100.00,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. POSITIONS
--    A category within an election (e.g. "Best Dressed")
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid  NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  title       text  NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. CANDIDATES
--    Tied to a position; includes name + photo URL
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid  NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  name        text  NOT NULL,
  photo_url   text  NOT NULL DEFAULT 'https://placehold.co/200x200/008751/ffffff?text=Candidate',
  bio         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 4. VOTES
--    number_of_votes  — bulk purchases from the cart
--    payment_reference — Paystack transaction reference
--    NO unique constraint on (voter_id, candidate_id) so the
--    same student can vote multiple times / in multiple batches
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id       uuid    NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  voter_id           uuid    REFERENCES auth.users(id) ON DELETE SET NULL,
  matric_number      text,                    -- denormalised for quick reporting
  number_of_votes    integer NOT NULL DEFAULT 1 CHECK (number_of_votes > 0),
  amount_paid        numeric(10,2) NOT NULL,
  payment_reference  text    NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- INDEXES — improve dashboard query performance
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_votes_candidate  ON votes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at);
CREATE INDEX IF NOT EXISTS idx_candidates_pos   ON candidates(position_id);
CREATE INDEX IF NOT EXISTS idx_positions_elec   ON positions(election_id);

-- ────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
ALTER TABLE elections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes      ENABLE ROW LEVEL SECURITY;

-- Public read: active elections, their positions & candidates
CREATE POLICY "Public read active elections"
  ON elections FOR SELECT
  USING (is_active = true);

CREATE POLICY "Public read positions"
  ON positions FOR SELECT
  USING (true);

CREATE POLICY "Public read candidates"
  ON candidates FOR SELECT
  USING (true);

-- Authenticated users can insert their own votes
CREATE POLICY "Auth users insert votes"
  ON votes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = voter_id);

-- Authenticated users can read their own votes
CREATE POLICY "Auth users read own votes"
  ON votes FOR SELECT
  TO authenticated
  USING (auth.uid() = voter_id);

-- ────────────────────────────────────────────────────────────
-- ADMIN HELPER VIEW — aggregated leaderboard
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vote_leaderboard AS
SELECT
  c.id            AS candidate_id,
  c.name          AS candidate_name,
  c.photo_url,
  p.title         AS position_title,
  e.title         AS election_title,
  COALESCE(SUM(v.number_of_votes), 0)  AS total_votes,
  COALESCE(SUM(v.amount_paid),     0)  AS total_revenue
FROM candidates c
JOIN positions  p ON p.id = c.position_id
JOIN elections  e ON e.id = p.election_id
LEFT JOIN votes v ON v.candidate_id = c.id
GROUP BY c.id, c.name, c.photo_url, p.title, e.title
ORDER BY total_votes DESC;

-- ────────────────────────────────────────────────────────────
-- SEED DATA  (optional — delete before production)
-- ────────────────────────────────────────────────────────────
INSERT INTO elections (title, description, price_per_vote, is_active) VALUES
  ('2024 ASSON Departmental Awards', 'Annual departmental awards night', 100.00, true),
  ('2024 Best Graduating Student', 'Vote for the best graduating student', 200.00, false);

INSERT INTO positions (election_id, title, description)
SELECT id, 'Best Dressed (Male)',   'Most stylishly dressed male student'   FROM elections WHERE title LIKE '2024 ASSON%' LIMIT 1;

INSERT INTO positions (election_id, title, description)
SELECT id, 'Best Dressed (Female)', 'Most stylishly dressed female student' FROM elections WHERE title LIKE '2024 ASSON%' LIMIT 1;

INSERT INTO positions (election_id, title, description)
SELECT id, 'Most Intelligent',      'Academically outstanding student'      FROM elections WHERE title LIKE '2024 ASSON%' LIMIT 1;

-- Sample candidates (positions inserted above)
INSERT INTO candidates (position_id, name, photo_url)
SELECT p.id,
       'Adewale Johnson',
       'https://placehold.co/200x200/008751/ffffff?text=AJ'
FROM positions p WHERE p.title = 'Best Dressed (Male)' LIMIT 1;

INSERT INTO candidates (position_id, name, photo_url)
SELECT p.id,
       'Emeka Okafor',
       'https://placehold.co/200x200/005c38/ffffff?text=EO'
FROM positions p WHERE p.title = 'Best Dressed (Male)' LIMIT 1;

INSERT INTO candidates (position_id, name, photo_url)
SELECT p.id,
       'Ngozi Adeleke',
       'https://placehold.co/200x200/008751/ffffff?text=NA'
FROM positions p WHERE p.title = 'Best Dressed (Female)' LIMIT 1;

INSERT INTO candidates (position_id, name, photo_url)
SELECT p.id,
       'Fatima Bello',
       'https://placehold.co/200x200/005c38/ffffff?text=FB'
FROM positions p WHERE p.title = 'Best Dressed (Female)' LIMIT 1;
