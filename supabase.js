// ============================================================
// supabase.js - MyHafazan MTSD Configuration & API Layer
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your values
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── CONFIG ──────────────────────────────────────────────────
export const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
export const SUPABASE_ANON = 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, storageKey: 'myhafazan_session' }
});

// ─── AUTH ─────────────────────────────────────────────────────
export const Auth = {
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async signUp(email, password, meta = {}) {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: meta } });
    if (error) throw error;
    return data;
  },
  async signOut() {
    await supabase.auth.signOut();
    localStorage.removeItem('myhafazan_session');
  },
  async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },
  async getProfile() {
    const user = await Auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('*, schools(*)')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return data;
  },
  onAuthChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
  }
};

// ─── RPT ENGINE ──────────────────────────────────────────────
export const RPT = {
  /**
   * Count school days between two dates (excludes weekends & holidays).
   */
  countSchoolDays(startDate, endDate, holidays = []) {
    const holidaySet = new Set(holidays.map(h =>
      (typeof h === 'string' ? h : h.date)
    ));
    let count = 0;
    const cur = new Date(startDate);
    const end = new Date(endDate);
    cur.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    while (cur <= end) {
      const day = cur.getDay();          // 0=Sun, 6=Sat
      const iso = cur.toISOString().split('T')[0];
      if (day !== 0 && day !== 6 && !holidaySet.has(iso)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  },

  /**
   * Core RPT Formula:
   * Expected_Page = Start_Page + (Total_Pages / Total_School_Days) × Days_Elapsed
   */
  getExpectedPage({ startPage, totalPages, startDate, today, holidays = [] }) {
    const totalSchoolDays = RPT.countSchoolDays(startDate, new Date(new Date().getFullYear(), 11, 31), holidays);
    const daysElapsed     = RPT.countSchoolDays(startDate, today || new Date(), holidays);
    if (totalSchoolDays === 0) return startPage;
    const expected = startPage + (totalPages / totalSchoolDays) * daysElapsed;
    return Math.min(Math.round(expected), startPage + totalPages);
  },

  /**
   * Determine student status vs RPT.
   * Returns: { status, color, label, colorHex }
   */
  getStatus(currentPage, expectedPage, debtCount = 0) {
    if (debtCount > 0) return { status: 'debt',     label: 'Ada Hutang',          color: 'red',    colorHex: '#EF4444', icon: '🔴' };
    if (currentPage > expectedPage) return { status: 'ahead',  label: 'Melebihi Sukatan', color: 'purple', colorHex: '#8B5CF6', icon: '🟣' };
    if (currentPage === expectedPage) return { status: 'on_track', label: 'Mencapai Sukatan', color: 'green',  colorHex: '#22C55E', icon: '🟢' };
    return { status: 'behind',  label: 'Ketinggalan',          color: 'orange', colorHex: '#F97316', icon: '🟠' };
  }
};

// ─── JUZ PAGES MAP ───────────────────────────────────────────
export const JUZ_PAGE_ENDS = [21,41,61,81,101,121,141,161,181,201,221,241,262,282,302,322,342,362,382,402,422,442,462,482,502,522,542,562,582,604];
export const JUZ_PAGE_STARTS = [1, ...JUZ_PAGE_ENDS.slice(0,-1).map(p => p+1)];

export function getJuzFromPage(page) {
  for (let i = 0; i < 30; i++) {
    if (page <= JUZ_PAGE_ENDS[i]) return i + 1;
  }
  return 30;
}

export function getJuzProgress(page) {
  const juz   = getJuzFromPage(page);
  const start = JUZ_PAGE_STARTS[juz - 1];
  const end   = JUZ_PAGE_ENDS[juz - 1];
  const pages = end - start + 1;
  const done  = page - start + 1;
  return { juz, percent: Math.round((done / pages) * 100), currentInJuz: done, totalInJuz: pages };
}

export function getCompletedJuz(page) {
  const result = [];
  for (let i = 0; i < 30; i++) {
    if (page >= JUZ_PAGE_ENDS[i]) result.push(i + 1);
  }
  return result;
}

// ─── STUDENTS API ────────────────────────────────────────────
export const StudentsAPI = {
  async getByHalaqah(halaqahId, options = {}) {
    let q = supabase
      .from('students')
      .select(`*, halaqah(name, level, teacher_id), debts(count), logs(date, pages_covered, score)`)
      .eq('halaqah_id', halaqahId)
      .order('name');
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('students')
      .select(`*, halaqah(name, level, schools(name)), debts(*), logs(*)`)
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async updatePage(id, currentPage) {
    const juz = getJuzFromPage(currentPage);
    const { data, error } = await supabase
      .from('students')
      .update({ current_page: currentPage, current_juz: juz })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async bulkInsert(students) {
    const { data, error } = await supabase.from('students').insert(students).select();
    if (error) throw error;
    return data;
  }
};

// ─── LOGS API ────────────────────────────────────────────────
export const LogsAPI = {
  async create(log) {
    const { data, error } = await supabase.from('logs').insert(log).select().single();
    if (error) throw error;
    return data;
  },

  async getByStudent(studentId, limit = 30) {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getByDateRange(studentId, from, to) {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('student_id', studentId)
      .gte('date', from)
      .lte('date', to)
      .order('date');
    if (error) throw error;
    return data || [];
  }
};

// ─── DEBTS API ───────────────────────────────────────────────
export const DebtsAPI = {
  async create(debt) {
    const { data, error } = await supabase.from('debts').insert(debt).select().single();
    if (error) throw error;
    return data;
  },

  async getPendingByStudent(studentId) {
    const { data, error } = await supabase
      .from('debts')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'pending')
      .order('debt_date');
    if (error) throw error;
    return data || [];
  },

  async clearDebt(debtId) {
    const { data, error } = await supabase
      .from('debts')
      .update({ status: 'cleared', cleared_date: new Date().toISOString().split('T')[0] })
      .eq('id', debtId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getTotalOverdue(studentId) {
    const { data, error } = await supabase
      .from('debts')
      .select('pages_overdue')
      .eq('student_id', studentId)
      .eq('status', 'pending');
    if (error) throw error;
    return (data || []).reduce((sum, d) => sum + d.pages_overdue, 0);
  }
};

// ─── RPT SETTINGS API ────────────────────────────────────────
export const RPTSettingsAPI = {
  async get(schoolId, level, year) {
    let q = supabase.from('rpt_settings').select('*').eq('school_id', schoolId);
    if (level) q = q.eq('level', level);
    if (year)  q = q.eq('academic_year', year);
    const { data, error } = await q.single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  },

  async upsert(settings) {
    const { data, error } = await supabase
      .from('rpt_settings')
      .upsert(settings, { onConflict: 'school_id,level,academic_year' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
};

// ─── HALAQAH API ─────────────────────────────────────────────
export const HalaqahAPI = {
  async getByTeacher(teacherId) {
    const { data, error } = await supabase
      .from('halaqah')
      .select('*, profiles(full_name)')
      .eq('teacher_id', teacherId);
    if (error) throw error;
    return data || [];
  },

  async getBySchool(schoolId) {
    const { data, error } = await supabase
      .from('halaqah')
      .select('*, profiles(full_name)')
      .eq('school_id', schoolId)
      .order('level');
    if (error) throw error;
    return data || [];
  }
};

// ─── HOLIDAYS API ────────────────────────────────────────────
export const HolidaysAPI = {
  async getBySchool(schoolId, year) {
    const from = `${year}-01-01`;
    const to   = `${year}-12-31`;
    const { data, error } = await supabase
      .from('holidays')
      .select('*')
      .eq('school_id', schoolId)
      .gte('date', from)
      .lte('date', to)
      .order('date');
    if (error) throw error;
    return data || [];
  },

  async add(schoolId, date, name) {
    const { data, error } = await supabase
      .from('holidays')
      .insert({ school_id: schoolId, date, name })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id) {
    const { error } = await supabase.from('holidays').delete().eq('id', id);
    if (error) throw error;
  }
};

// ─── REALTIME SUBSCRIPTIONS ──────────────────────────────────
export const Realtime = {
  subscribeToStudents(halaqahId, callback) {
    return supabase
      .channel(`halaqah:${halaqahId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'students',
        filter: `halaqah_id=eq.${halaqahId}`
      }, callback)
      .subscribe();
  },

  subscribeToLogs(studentId, callback) {
    return supabase
      .channel(`logs:${studentId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'logs',
        filter: `student_id=eq.${studentId}`
      }, callback)
      .subscribe();
  },

  unsubscribe(channel) {
    supabase.removeChannel(channel);
  }
};

// ─── CSV PARSER ──────────────────────────────────────────────
export function parseStudentCSV(csvText) {
  const lines  = csvText.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const obj  = {};
    header.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return {
      name:         obj['name'] || obj['nama'] || obj['full_name'] || '',
      halaqah_id:   obj['halaqah_id'] || null,
      current_page: parseInt(obj['current_page'] || obj['page'] || '1', 10),
      current_juz:  parseInt(obj['current_juz']  || obj['juz']  || '1', 10)
    };
  }).filter(s => s.name);
}

export default supabase;