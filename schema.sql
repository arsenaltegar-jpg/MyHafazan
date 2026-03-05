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

CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'parent', 'student');
CREATE TYPE log_type AS ENUM ('jadid', 'murajaah_u', 'murajaah_q');

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

CREATE INDEX idx_students_halaqah ON students(halaqah_id);
CREATE INDEX idx_students_parent ON students(parent_id);
CREATE INDEX idx_students_user ON students(student_user_id);
CREATE INDEX idx_hifz_logs_student ON hifz_logs(student_id);
CREATE INDEX idx_hifz_logs_teacher ON hifz_logs(teacher_id);
CREATE INDEX idx_hifz_logs_date ON hifz_logs(session_date);
CREATE INDEX idx_rpt_targets_date ON rpt_targets(date);

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

CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

CREATE POLICY "Admins have full access to profiles"
    ON profiles FOR ALL
    USING (get_my_role() = 'admin');

CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (id = auth.uid());

CREATE POLICY "Teachers can view all profiles"
    ON profiles FOR SELECT
    USING (get_my_role() = 'teacher');

-- ============================================================
-- RLS POLICIES: halaqahs
-- ============================================================

CREATE POLICY "Admins have full access to halaqahs"
    ON halaqahs FOR ALL
    USING (get_my_role() = 'admin');

CREATE POLICY "Teachers can view their own halaqah"
    ON halaqahs FOR SELECT
    USING (teacher_id = auth.uid() OR get_my_role() = 'teacher');

CREATE POLICY "Parents and students can view halaqahs"
    ON halaqahs FOR SELECT
    USING (get_my_role() IN ('parent', 'student'));

-- ============================================================
-- RLS POLICIES: students
-- ============================================================

CREATE POLICY "Admins have full access to students"
    ON students FOR ALL
    USING (get_my_role() = 'admin');

CREATE POLICY "Teachers can read/write students in their halaqah"
    ON students FOR ALL
    USING (
        halaqah_id = get_my_halaqah_id()
        AND get_my_role() = 'teacher'
    );

CREATE POLICY "Parents can view their own children"
    ON students FOR SELECT
    USING (parent_id = auth.uid());

-- FIX: Students with role='student' can view their own record
-- via student_user_id column
CREATE POLICY "Students can view their own record"
    ON students FOR SELECT
    USING (student_user_id = auth.uid() AND get_my_role() = 'student');

-- ============================================================
-- RLS POLICIES: hifz_logs
-- ============================================================

CREATE POLICY "Admins have full access to hifz_logs"
    ON hifz_logs FOR ALL
    USING (get_my_role() = 'admin');

CREATE POLICY "Teachers can manage logs for their students"
    ON hifz_logs FOR ALL
    USING (
        get_my_role() = 'teacher'
        AND student_id IN (
            SELECT id FROM students WHERE halaqah_id = get_my_halaqah_id()
        )
    );

CREATE POLICY "Parents can view logs for their children"
    ON hifz_logs FOR SELECT
    USING (
        student_id IN (
            SELECT id FROM students WHERE parent_id = auth.uid()
        )
    );

-- FIX: Students can view their own logs
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

CREATE POLICY "Admins have full access to rpt_targets"
    ON rpt_targets FOR ALL
    USING (get_my_role() = 'admin');

CREATE POLICY "All authenticated users can read rpt_targets"
    ON rpt_targets FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- ============================================================
-- RLS POLICIES: announcements
-- ============================================================

CREATE POLICY "Admins have full access to announcements"
    ON announcements FOR ALL
    USING (get_my_role() = 'admin');

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

CREATE OR REPLACE VIEW student_progress AS
SELECT
    s.id,
    s.full_name,
    s.current_page,
    s.current_juz,
    s.photo_url,
    s.halaqah_id,
    s.parent_id,
    s.student_user_id,
    h.name AS halaqah_name,
    p.full_name AS teacher_name,
    par.full_name AS parent_name,
    r.target_page_total,
    (r.target_page_total - s.current_page) AS hutang,
    CASE
        WHEN r.target_page_total IS NULL THEN 'no_rpt'
        WHEN (r.target_page_total - s.current_page) <= 0 THEN 'ahead'
        WHEN (r.target_page_total - s.current_page) <= 5 THEN 'warning'
        ELSE 'behind'
    END AS status
FROM students s
LEFT JOIN halaqahs h ON s.halaqah_id = h.id
LEFT JOIN profiles p ON h.teacher_id = p.id
LEFT JOIN profiles par ON s.parent_id = par.id
LEFT JOIN rpt_targets r ON r.date = CURRENT_DATE
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
-- ============================================================
