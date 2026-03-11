-- ============================================================
-- MYHAFAZAN MTSD - Database Schema
-- Supabase PostgreSQL Setup Script
-- v2 — includes Google OAuth fix, student RLS for student role
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'parent', 'student');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE log_type AS ENUM ('jadid', 'murajaah_u', 'murajaah_q');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'parent',
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Halaqahs (Study Circles)
CREATE TABLE IF NOT EXISTS halaqahs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    description TEXT,
    room TEXT,
    session_time TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Students
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    matric_no TEXT UNIQUE,
    halaqah_id INT REFERENCES halaqahs(id) ON DELETE SET NULL,
    parent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    -- student_user_id links a student to a Supabase auth user with role='student'
    student_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    current_page INT DEFAULT 1,
    current_juz INT DEFAULT 1,
    -- FIX #11: form_level is required for RPT auto-calculation per form
    form_level INT CHECK (form_level BETWEEN 1 AND 5),
    photo_url TEXT,
    date_enrolled DATE DEFAULT CURRENT_DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hifz Logs (Daily memorization records)
CREATE TABLE IF NOT EXISTS hifz_logs (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    type log_type NOT NULL,
    page_number INT NOT NULL,
    pages_count INT DEFAULT 1,
    quality_score INT CHECK (quality_score BETWEEN 1 AND 5),
    notes TEXT,
    session_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RPT Targets (Daily syllabus targets)
CREATE TABLE IF NOT EXISTS rpt_targets (
    id SERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    target_page_total INT NOT NULL,
    juz_reference INT,
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    target_role user_role,   -- NULL means show to all roles
    created_by UUID REFERENCES profiles(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_students_halaqah ON students(halaqah_id);
CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
CREATE INDEX IF NOT EXISTS idx_students_user ON students(student_user_id);
-- FIX #11: Index for form_level (used in RPT queries)
CREATE INDEX IF NOT EXISTS idx_students_form ON students(form_level);
CREATE INDEX IF NOT EXISTS idx_hifz_logs_student ON hifz_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_hifz_logs_teacher ON hifz_logs(teacher_id);
CREATE INDEX IF NOT EXISTS idx_hifz_logs_date ON hifz_logs(session_date);
CREATE INDEX IF NOT EXISTS idx_rpt_targets_date ON rpt_targets(date);

-- ============================================================
-- TRIGGERS: Auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop before recreate to make idempotent
DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON profiles;
CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_students_updated_at ON students;
CREATE TRIGGER trigger_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TRIGGER: Auto-create profile on user signup
-- FIX: Handles Google OAuth (sends 'name' not 'full_name')
--      and captures avatar_url from Google profile picture
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, full_name, role, avatar_url)
    VALUES (
        NEW.id,
        -- Google OAuth uses 'name'; email/password uses 'full_name'
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)  -- fallback: email prefix
        ),
        COALESCE(
            (NEW.raw_user_meta_data->>'role')::user_role,
            'parent'  -- Default role for all new signups including Google
        ),
        -- Google provides a profile picture URL
        COALESCE(
            NEW.raw_user_meta_data->>'avatar_url',
            NEW.raw_user_meta_data->>'picture'
        )
    )
    ON CONFLICT (id) DO NOTHING;  -- Safe for retries
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE halaqahs ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE hifz_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_halaqah_id()
RETURNS INT AS $$
    SELECT id FROM halaqahs WHERE teacher_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================
-- RLS POLICIES: profiles
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to profiles" ON profiles;
CREATE POLICY "Admins have full access to profiles"
    ON profiles FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid());

DROP POLICY IF EXISTS "Teachers can view all profiles" ON profiles;
CREATE POLICY "Teachers can view all profiles"
    ON profiles FOR SELECT
    USING (get_my_role() = 'teacher');

-- ============================================================
-- RLS POLICIES: halaqahs
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to halaqahs" ON halaqahs;
CREATE POLICY "Admins have full access to halaqahs"
    ON halaqahs FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can view their own halaqah" ON halaqahs;
CREATE POLICY "Teachers can view their own halaqah"
    ON halaqahs FOR SELECT
    USING (teacher_id = auth.uid() OR get_my_role() = 'teacher');

DROP POLICY IF EXISTS "Parents and students can view halaqahs" ON halaqahs;
CREATE POLICY "Parents and students can view halaqahs"
    ON halaqahs FOR SELECT
    USING (get_my_role() IN ('parent', 'student'));

-- ============================================================
-- RLS POLICIES: students
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to students" ON students;
CREATE POLICY "Admins have full access to students"
    ON students FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can read/write students in their halaqah" ON students;
CREATE POLICY "Teachers can read/write students in their halaqah"
    ON students FOR ALL
    USING (
        halaqah_id = get_my_halaqah_id()
        AND get_my_role() = 'teacher'
    );

DROP POLICY IF EXISTS "Parents can view their own children" ON students;
CREATE POLICY "Parents can view their own children"
    ON students FOR SELECT
    USING (parent_id = auth.uid());

-- FIX: Students with role='student' can view their own record
-- via student_user_id column
DROP POLICY IF EXISTS "Students can view their own record" ON students;
CREATE POLICY "Students can view their own record"
    ON students FOR SELECT
    USING (student_user_id = auth.uid() AND get_my_role() = 'student');

-- ============================================================
-- RLS POLICIES: hifz_logs
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to hifz_logs" ON hifz_logs;
CREATE POLICY "Admins have full access to hifz_logs"
    ON hifz_logs FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Teachers can manage logs for their students" ON hifz_logs;
CREATE POLICY "Teachers can manage logs for their students"
    ON hifz_logs FOR ALL
    USING (
        get_my_role() = 'teacher'
        AND student_id IN (
            SELECT id FROM students WHERE halaqah_id = get_my_halaqah_id()
        )
    );

DROP POLICY IF EXISTS "Parents can view logs for their children" ON hifz_logs;
CREATE POLICY "Parents can view logs for their children"
    ON hifz_logs FOR SELECT
    USING (
        student_id IN (
            SELECT id FROM students WHERE parent_id = auth.uid()
        )
    );

-- FIX: Students can view their own logs
DROP POLICY IF EXISTS "Students can view their own logs" ON hifz_logs;
CREATE POLICY "Students can view their own logs"
    ON hifz_logs FOR SELECT
    USING (
        student_id IN (
            SELECT id FROM students WHERE student_user_id = auth.uid()
        )
        AND get_my_role() = 'student'
    );

-- ============================================================
-- RLS POLICIES: rpt_targets
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to rpt_targets" ON rpt_targets;
CREATE POLICY "Admins have full access to rpt_targets"
    ON rpt_targets FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "All authenticated users can read rpt_targets" ON rpt_targets;
CREATE POLICY "All authenticated users can read rpt_targets"
    ON rpt_targets FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- ============================================================
-- RLS POLICIES: announcements
-- ============================================================

DROP POLICY IF EXISTS "Admins have full access to announcements" ON announcements;
CREATE POLICY "Admins have full access to announcements"
    ON announcements FOR ALL
    USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "All users can read active announcements" ON announcements;
CREATE POLICY "All users can read active announcements"
    ON announcements FOR SELECT
    USING (
        is_active = TRUE
        AND auth.uid() IS NOT NULL
        AND (target_role IS NULL OR target_role = get_my_role())
    );

-- ============================================================
-- SAMPLE DATA (for development/testing)
-- ============================================================

-- In production, create admin via Supabase Auth dashboard, then:
-- UPDATE profiles SET role = 'admin' WHERE id = '<admin-user-uuid>';

-- Sample RPT Targets
INSERT INTO rpt_targets (date, target_page_total, juz_reference, notes) VALUES
    (CURRENT_DATE,     45, 3, 'Target Juzuk 3'),
    (CURRENT_DATE + 1, 47, 3, 'Target Juzuk 3'),
    (CURRENT_DATE + 2, 49, 3, 'Target Juzuk 3'),
    (CURRENT_DATE + 3, 51, 3, 'Target Juzuk 3'),
    (CURRENT_DATE + 4, 53, 3, 'Masuk Juzuk 3 akhir'),
    (CURRENT_DATE + 5, 55, 3, 'Habis Juzuk 3'),
    (CURRENT_DATE + 6, 57, 4, 'Mula Juzuk 4'),
    (CURRENT_DATE + 7, 59, 4, 'Target Juzuk 4')
ON CONFLICT (date) DO NOTHING;

-- Sample announcement
INSERT INTO announcements (title, body, target_role, is_active) VALUES
    ('Selamat Datang ke MyHafazan MTSD', 'Sistem pengurusan hafazan anda kini aktif. Semua log tasmik akan dikemaskini secara masa nyata.', NULL, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- VIEWS
-- ============================================================

-- ============================================================
-- FIX #11: MISSING TABLES (present in backup.sql but absent from original schema.sql)
-- ============================================================

-- RPT Plans (annual syllabus plan per form level)
CREATE TABLE IF NOT EXISTS rpt_plans (
    id SERIAL PRIMARY KEY,
    form_level INT NOT NULL CHECK (form_level BETWEEN 1 AND 5),
    year INT NOT NULL,
    start_page INT NOT NULL,
    end_page INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    juz_start INT,
    juz_end INT,
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT rpt_plans_form_year_key UNIQUE (form_level, year),
    CONSTRAINT rpt_plans_dates_check CHECK (end_date > start_date),
    CONSTRAINT rpt_plans_form_check CHECK (form_level BETWEEN 1 AND 5),
    CONSTRAINT rpt_plans_pages_check CHECK (end_page > start_page)
);

CREATE INDEX IF NOT EXISTS idx_rpt_plans_form_year ON rpt_plans(form_level, year);

-- School Holidays (excluded from RPT day count)
CREATE TABLE IF NOT EXISTS school_holidays (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT NOT NULL,
    holiday_type TEXT NOT NULL DEFAULT 'public_holiday',
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT school_holidays_end_date_check CHECK (end_date >= date),
    CONSTRAINT school_holidays_type_check CHECK (holiday_type IN ('public_holiday', 'school_holiday'))
);

CREATE INDEX IF NOT EXISTS idx_school_holidays_date ON school_holidays(date);

-- ============================================================
-- HELPER FUNCTION: Count school days (weekdays minus holidays)
-- ============================================================

CREATE OR REPLACE FUNCTION count_school_days(p_start DATE, p_end DATE)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM generate_series(p_start, p_end, '1 day'::INTERVAL) d
  WHERE
    EXTRACT(dow FROM d) NOT IN (0, 6)
    AND NOT EXISTS (
      SELECT 1 FROM school_holidays h
      WHERE d::DATE BETWEEN h.date AND h.end_date
    );
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- HELPER FUNCTION: Get RPT target for a given form and date
-- Checks manual override in rpt_targets first, then calculates
-- automatically from rpt_plans using school day proration.
-- ============================================================

CREATE OR REPLACE FUNCTION get_rpt_target(p_form INT, p_date DATE)
RETURNS INTEGER AS $$
DECLARE
  v_override INT;
  v_plan     RECORD;
  v_total_days INT;
  v_elapsed    INT;
BEGIN
  -- 1. Check manual override (exact date + form_level match)
  SELECT target_page_total INTO v_override
  FROM rpt_targets
  WHERE date = p_date
    AND (form_level = p_form OR form_level IS NULL)
  ORDER BY form_level NULLS LAST
  LIMIT 1;
  IF FOUND THEN RETURN v_override; END IF;

  -- 2. Auto-calculate from rpt_plans
  SELECT * INTO v_plan
  FROM rpt_plans
  WHERE form_level = p_form
    AND EXTRACT(YEAR FROM p_date) = year
    AND p_date BETWEEN start_date AND end_date
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total_days := count_school_days(v_plan.start_date, v_plan.end_date);
  IF v_total_days = 0 THEN RETURN v_plan.start_page; END IF;

  v_elapsed := count_school_days(v_plan.start_date, LEAST(p_date, v_plan.end_date));
  RETURN LEAST(
    v_plan.start_page + ROUND(((v_plan.end_page - v_plan.start_page)::NUMERIC / v_total_days) * v_elapsed),
    v_plan.end_page
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_rpt_target(INT, DATE) TO authenticated;

-- ============================================================
-- RLS for new tables
-- ============================================================

ALTER TABLE rpt_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to rpt_plans" ON rpt_plans;
CREATE POLICY "Admins have full access to rpt_plans"
    ON rpt_plans FOR ALL USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "All authenticated users can read rpt_plans" ON rpt_plans;
CREATE POLICY "All authenticated users can read rpt_plans"
    ON rpt_plans FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins have full access to school_holidays" ON school_holidays;
CREATE POLICY "Admins have full access to school_holidays"
    ON school_holidays FOR ALL USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "All authenticated users can read school_holidays" ON school_holidays;
CREATE POLICY "All authenticated users can read school_holidays"
    ON school_holidays FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- FIX #5: student_progress VIEW — RLS workaround
-- PostgreSQL views inherit the definer's permissions, bypassing
-- row-level security on the underlying tables. To enforce RLS
-- on the view, we recreate it with SECURITY INVOKER so it runs
-- as the calling user and respects the RLS policies on students.
-- ============================================================

DROP VIEW IF EXISTS student_progress;

CREATE OR REPLACE VIEW student_progress
WITH (security_invoker = true)   -- FIX #5: Enforce RLS on underlying tables
AS
SELECT
    s.id,
    s.full_name,
    s.current_page,
    s.current_juz,
    s.photo_url,
    s.halaqah_id,
    s.parent_id,
    s.student_user_id,
    s.form_level,          -- FIX #11: expose form_level
    h.name AS halaqah_name,
    p.full_name AS teacher_name,
    par.full_name AS parent_name,
    get_rpt_target(s.form_level, CURRENT_DATE) AS target_page_total,
    (get_rpt_target(s.form_level, CURRENT_DATE) - s.current_page) AS hutang,
    CASE
        WHEN s.form_level IS NULL THEN 'no_form'
        WHEN get_rpt_target(s.form_level, CURRENT_DATE) IS NULL THEN 'no_rpt'
        WHEN (get_rpt_target(s.form_level, CURRENT_DATE) - s.current_page) <= 0 THEN 'ahead'
        WHEN (get_rpt_target(s.form_level, CURRENT_DATE) - s.current_page) <= 5 THEN 'warning'
        ELSE 'behind'
    END AS status
FROM students s
LEFT JOIN halaqahs h ON s.halaqah_id = h.id
LEFT JOIN profiles p ON h.teacher_id = p.id
LEFT JOIN profiles par ON s.parent_id = par.id
WHERE s.is_active = TRUE;

GRANT SELECT ON student_progress TO authenticated;

-- ============================================================
-- NOTES FOR GOOGLE SIGN-IN SETUP
-- ============================================================
-- 1. Supabase Dashboard → Authentication → Providers → Google → Enable
-- 2. Add your Google OAuth Client ID and Secret
-- 3. Set Authorised redirect URI in Google Cloud Console:
--    https://<project-ref>.supabase.co/auth/v1/callback
-- 4. Google users are auto-assigned role='parent' by default
-- 5. To make a Google user an admin, manually run:
--    UPDATE profiles SET role = 'admin' WHERE id = '<user-uuid>';
-- 6. FIX #5: The student_progress view now uses SECURITY INVOKER
--    which requires Supabase PostgreSQL 15+. If on older version,
--    add explicit WHERE filters per role in application code.
-- ============================================================
