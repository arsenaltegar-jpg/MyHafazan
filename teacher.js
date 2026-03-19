// ============================================================
// MYHAFAZAN MTSD - teacher.js
// Teacher (Murabbi) Logging Module
// ============================================================

let selectedStudent = null;
let myHalaqah = null;
let myStudents = [];
let modalOpenedFromDetail = false; // true when modal is opened via Detail Panel (new log OR edit)

// Pagination
const PAGE_SIZE = 10;
let currentPage = 1;

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const profile = await requireAuth('teacher');
    if (!profile) return;

    // FIX #14: Watch for token expiry mid-session — redirect to login on sign-out
    window.supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') window.location.href = 'index.html';
    });

    populateNavProfile(profile);
    await loadMyHalaqah(profile.id);
    await loadMyStudents();
    renderStudentList();
    bindForms();

    // Set today's date in header
    const dateEl = document.getElementById('topbarDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('ms-MY', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    // Search
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
        currentPage = 1;
        renderStudentList(e.target.value.toLowerCase());
    });
});

// ============================================================
// LOAD HALAQAH
// ============================================================

async function loadMyHalaqah(teacherId) {
    const { data, error } = await supabase
        .from('halaqahs')
        .select('*')
        .eq('teacher_id', teacherId)
        .single();

    if (error || !data) {
        // FIX #4: Clear, actionable no-halaqah state
        document.getElementById('halaqahName').textContent = 'Tiada Halaqah Ditetapkan';
        document.getElementById('halaqahId').textContent = 'Sila hubungi Admin untuk ditugaskan ke halaqah';
        document.getElementById('todayTargetBadge').innerHTML =
            '<i class="fas fa-circle-exclamation" style="color:#D97706;"></i> Hubungi Admin — anda belum ditugaskan ke mana-mana halaqah';
        document.getElementById('studentList').innerHTML =
            `<div class="empty-state">
               <i class="fas fa-circle-exclamation" style="color:var(--gold);font-size:36px;"></i>
               <p style="margin-top:12px;font-weight:700;color:var(--slate-700);">Anda belum ditugaskan ke mana-mana halaqah.</p>
               <p style="margin-top:6px;font-size:13px;">Sila hubungi Admin untuk menetapkan halaqah anda sebelum boleh log tasmik.</p>
             </div>`;
        return;
    }

    myHalaqah = data;
    document.getElementById('halaqahName').textContent = data.name;
    document.getElementById('halaqahId').textContent = `Bilik: ${data.room || '–'} · ${data.session_time || '–'}`;
}

// ============================================================
// LOAD STUDENTS
// ============================================================

async function loadMyStudents() {
    if (!myHalaqah) {
        document.getElementById('studentCount').textContent = '0';
        return;
    }

    // Step 1: get list of active student IDs in this halaqah
    const { data: rawStudents, error: sErr } = await supabase
        .from('students')
        .select('id')
        .eq('halaqah_id', myHalaqah.id)
        .eq('is_active', true);

    if (sErr || !rawStudents?.length) {
        document.getElementById('studentCount').textContent = '0';
        myStudents = [];
        const badge = document.getElementById('todayTargetBadge');
        if (badge) badge.innerHTML = `<i class="fas fa-circle-minus"></i> Tiada pelajar aktif dalam halaqah ini`;
        return;
    }

    const studentIds = rawStudents.map(s => s.id);

    // Step 2: load from student_progress view — same source as parent dashboard.
    // hutang, target_page_total and status are already resolved per-student
    // by form level inside the DB view. No manual RPT calculation needed.
    const { data: progressRows, error: pErr } = await supabase
        .from('student_progress')
        .select('*')
        .in('id', studentIds)
        .order('full_name');

    if (pErr) { console.error(pErr); return; }

    myStudents = progressRows || [];
    document.getElementById('studentCount').textContent = myStudents.length;

    // Badge: students may have different form levels → different RPT targets.
    // Show a summary rather than a single (wrong) global target.
    const badge = document.getElementById('todayTargetBadge');
    if (badge) {
        const withRpt    = myStudents.filter(s => s.status !== 'no_rpt' && s.status !== 'no_form' && s.target_page_total !== null);
        const withoutRpt = myStudents.filter(s => s.status === 'no_rpt' || s.target_page_total === null);
        if (withoutRpt.length === myStudents.length) {
            badge.innerHTML = `<i class="fas fa-circle-minus"></i> RPT belum ditetapkan untuk semua pelajar`;
        } else if (withoutRpt.length > 0) {
            badge.innerHTML = `<i class="fas fa-bullseye"></i> Sasaran RPT aktif: ${withRpt.length} pelajar &nbsp;&middot;&nbsp; <span style="color:#D97706;">${withoutRpt.length} belum ditetapkan</span>`;
        } else {
            const targets = [...new Set(withRpt.map(s => s.target_page_total))].sort((a, b) => a - b);
            badge.innerHTML = targets.length === 1
                ? `<i class="fas fa-bullseye"></i> Sasaran Hari Ini: ms. ${targets[0]}`
                : `<i class="fas fa-bullseye"></i> Sasaran RPT: ms. ${targets[0]} – ${targets[targets.length - 1]} (mengikut tingkatan)`;
        }
    }
}

// ============================================================
// RENDER STUDENT LIST
// ============================================================

function renderStudentList(filter = '') {
    const container = document.getElementById('studentList');
    if (!container) return;

    const filtered = filter
        ? myStudents.filter(s => s.full_name.toLowerCase().includes(filter))
        : myStudents;

    if (!myHalaqah) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-circle-exclamation" style="color:var(--gold);"></i><p>Anda belum ditugaskan ke mana-mana halaqah.<br>Sila hubungi Admin.</p></div>`;
        return;
    }

    if (!filtered.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-users-slash"></i><p>${filter ? 'Tiada pelajar dijumpai untuk carian ini.' : 'Tiada pelajar aktif dalam halaqah ini.'}</p></div>`;
        return;
    }

    // Pagination
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const paged = filtered.slice(start, start + PAGE_SIZE);

    const cardsHtml = paged.map(student => {
        const hutang = student.hutang;
        const status = student.status;
        let statusClass = 'status-green';
        let statusText  = 'Melebihi';
        let statusIcon  = 'fa-circle-check';
        let accentClass = 'accent-green';
        let ringClass   = 'ring-green';
        let pillClass   = 'pill-green';
        let hutangDisplay = hutang === null ? '–' : hutang > 0 ? `+${hutang}` : `${Math.abs(hutang)}`;

        // Mirror parent.js status logic — use the view's status field first
        if (status === 'no_form') {
            statusClass = 'status-gray'; statusText = 'Tingkatan belum ditetapkan'; statusIcon = 'fa-circle-minus';
            accentClass = 'accent-gray'; ringClass = 'ring-gray'; pillClass = 'pill-gray';
            hutangDisplay = '–';
        } else if (status === 'no_rpt') {
            statusClass = 'status-gray'; statusText = 'RPT Belum Ditetapkan'; statusIcon = 'fa-circle-minus';
            accentClass = 'accent-gray'; ringClass = 'ring-gray'; pillClass = 'pill-gray';
            hutangDisplay = '–';
        } else if (hutang === null) {
            statusClass = 'status-gray'; statusText = 'Tiada Data'; statusIcon = 'fa-circle-minus';
            accentClass = 'accent-gray'; ringClass = 'ring-gray'; pillClass = 'pill-gray';
            hutangDisplay = '–';
        } else if (hutang > 15) {
            statusClass = 'status-red'; statusText = 'Ketinggalan'; statusIcon = 'fa-circle-exclamation';
            accentClass = 'accent-red'; ringClass = 'ring-red'; pillClass = 'pill-red';
        } else if (hutang > 0) {
            statusClass = 'status-orange'; statusText = 'Amaran'; statusIcon = 'fa-triangle-exclamation';
            accentClass = 'accent-orange'; ringClass = 'ring-orange'; pillClass = 'pill-orange';
        } else if (hutang === 0) {
            statusText = 'Tepat';
        }
        // hutang < 0 → green (Melebihi), defaults already set

        const initials = student.full_name.split(' ').map(w => w[0]).slice(0, 2).join('');
        const juzProgress = Math.min(100, ((student.current_page % 20) / 20) * 100);

        return `
        <div class="student-card ${accentClass}" data-id="${student.id}" onclick="openStudentDetail(${student.id})">
          <div class="sc-avatar ${ringClass}">
            ${student.photo_url
              ? `<img src="${student.photo_url}" alt="${student.full_name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
              : `<span>${initials}</span>`}
          </div>
          <div class="sc-info">
            <div class="sc-name">${student.full_name}</div>
            <div class="sc-meta">
              <span><i class="fas fa-book-open"></i> ms. ${student.current_page}</span>
              <span><i class="fas fa-layer-group"></i> Juzuk ${student.current_juz}</span>
            </div>
            <div class="sc-progress-bar">
              <div class="sc-progress-fill" style="width:${juzProgress}%"></div>
            </div>
          </div>
          <div class="sc-right">
            <div class="hutang-pill ${pillClass}">${hutangDisplay}</div>
            <div class="sc-status ${statusClass}" style="margin-top:4px;"><i class="fas ${statusIcon}"></i> ${statusText}</div>
            <div class="sc-log-btn" onclick="event.stopPropagation(); openLogModalFromCard(${student.id})"><i class="fas fa-pen-to-square"></i> Log</div>
          </div>
        </div>`;
    }).join('');

    // Pagination controls
    const paginationHtml = totalPages > 1 ? `
        <div class="pagination-bar">
            <button class="pg-btn" onclick="changePage(-1)" ${currentPage <= 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
            <span class="pg-info">${currentPage} / ${totalPages} <span style="color:var(--slate-400);font-weight:400;">(${filtered.length} pelajar)</span></span>
            <button class="pg-btn" onclick="changePage(1)" ${currentPage >= totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>` : '';

    container.innerHTML = cardsHtml + paginationHtml;
}

function changePage(dir) {
    currentPage += dir;
    renderStudentList(document.getElementById('searchInput')?.value?.toLowerCase() || '');
}

// ============================================================
// MODAL: Open & Close
// ============================================================

function openLogModalFromCard(studentId) {
    // Called from student card — modal should return to main page on close
    modalOpenedFromDetail = false;
    openLogModal(studentId);
}

function openLogModal(studentId) {
    selectedStudent = myStudents.find(s => s.id === studentId);
    if (!selectedStudent) return;

    const initials = selectedStudent.full_name.split(' ').map(w => w[0]).slice(0, 2).join('');
    document.getElementById('modalStudentName').textContent = selectedStudent.full_name;
    document.getElementById('modalStudentPage').textContent =
        `Semasa: ms. ${selectedStudent.current_page} | Juzuk ${selectedStudent.current_juz}`;
    document.getElementById('modalAvatar').innerHTML = selectedStudent.photo_url
        ? `<img src="${selectedStudent.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : `<span>${initials}</span>`;

    // Defaults
    document.getElementById('logPage').value = selectedStudent.current_page;
    document.getElementById('logType').value = 'jadid';
    document.getElementById('logNotes').value = '';
    document.getElementById('logQuality').value = '5';
    document.getElementById('modalError').classList.add('hidden');

    // Reset type buttons
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector('.type-btn[data-type="jadid"]')?.classList.add('selected');

    const modal = document.getElementById('logModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeLogModal() {
    const modal = document.getElementById('logModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const submitBtn = document.getElementById('submitLogBtn');

    // Reset edit mode
    if (submitBtn) {
        delete submitBtn.dataset.editLogId;
        submitBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Simpan Log Tasmik';
    }

    // If modal was opened from the Detail Panel (new log OR edit), return to
    // the student profile instead of dropping the teacher on the main page.
    const studentIdToReturn = selectedStudent?.id || null;
    selectedStudent = null;
    const shouldReturnToDetail = modalOpenedFromDetail;
    modalOpenedFromDetail = false;

    if (shouldReturnToDetail && studentIdToReturn) {
        setTimeout(() => openStudentDetail(studentIdToReturn), 50);
    }
}

// ============================================================
// LOAD & RENDER LOGS (Detail Panel only)
// ============================================================

// prefetchedLogs: pass already-fetched logs to avoid a second DB round-trip
// when called from openStudentDetail which already has the data.
// If null, fetches fresh from DB (used by deleteLog / submitLog refresh).
async function loadStudentLogs(studentId, prefetchedLogs = null) {
    let logs = prefetchedLogs;
    if (!logs) {
        const { data } = await supabase
            .from('hifz_logs')
            .select('*')
            .eq('student_id', studentId)
            .order('session_date', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(30);
        logs = data;
    }

    // Render into #detailLogs (Detail Panel only — not the Log Modal)
    const container = document.getElementById('detailLogs');
    if (!container) return;

    const typeLabels = { jadid: 'Hifz Jadid', murajaah_u: 'Murajaah Umum', murajaah_q: 'Murajaah Khas', hadir: 'Kehadiran' };
    const typeColors = { jadid: '#6B21A8', murajaah_u: '#16A34A', murajaah_q: '#D97706', hadir: '#2563EB' };
    const typeBg     = { jadid: '#F3E8FF', murajaah_u: '#DCFCE7', murajaah_q: '#FEF3C7', hadir: '#DBEAFE' };

    if (!logs || !logs.length) {
        container.innerHTML = '<p style="font-size:13px;color:#94A3B8;text-align:center;padding:20px;">Tiada log tasmik lagi.</p>';
        return;
    }

    // BUG FIX 1 (part): pass notes safely into editLog — escape backticks/quotes
    container.innerHTML = logs.map(log => {
        const pageInfo = log.type === 'hadir' ? '' : `· ms. ${log.page_number}`;
        const stars = log.quality_score ? '⭐'.repeat(log.quality_score) : '';
        // Safely encode notes for inline onclick attribute
        const safeNotes = (log.notes || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
        return `
        <div id="log-row-${log.id}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #F1F5F9;">
          <div style="width:34px;height:34px;border-radius:8px;background:${typeBg[log.type]||'#F1F5F9'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="width:8px;height:8px;border-radius:50%;background:${typeColors[log.type]||'#94A3B8'};display:block;"></span>
          </div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;color:#334155;">${typeLabels[log.type] || log.type} ${pageInfo}</div>
            <div style="font-size:11px;color:#94A3B8;margin-top:2px;">${formatDateMY(log.session_date)} ${stars}</div>
            ${log.notes ? `<div style="font-size:12px;color:#64748B;margin-top:4px;font-style:italic;">"${log.notes}"</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button onclick="editLog(${log.id},${log.page_number},'${log.type}',${log.quality_score || 5},'${safeNotes}')"
              style="background:#F3E8FF;border:none;color:#6B21A8;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">
              <i class="fas fa-pen"></i>
            </button>
            <button onclick="deleteLog(${log.id},${studentId})"
              style="background:#FEE2E2;border:none;color:#DC2626;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('');
}

// ============================================================
// EDIT LOG
// BUG FIX 1: Accept and restore notes; open Log Modal from Detail Panel
// ============================================================

function editLog(logId, page, type, quality, notes = '') {
    // selectedStudent is already set from the Detail Panel
    if (!selectedStudent) return;

    // The Detail Panel (z-index 1100) sits above the Log Modal (z-index 1000).
    // Close the panel first, then open the modal after its slide-out animation,
    // the same way openLogFromDetail() works.
    modalOpenedFromDetail = true; // return to Detail Panel if modal is closed
    closeStudentDetail();

    setTimeout(() => {
        // Open modal
        const modal = document.getElementById('logModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Pre-fill fields
        document.getElementById('logPage').value = page;
        document.getElementById('logType').value = type;
        document.getElementById('logQuality').value = quality;
        document.getElementById('logNotes').value = notes;
        document.getElementById('modalError').classList.add('hidden');

        // Update student header in modal
        const initials = selectedStudent.full_name.split(' ').map(w => w[0]).slice(0, 2).join('');
        document.getElementById('modalStudentName').textContent = selectedStudent.full_name;
        document.getElementById('modalStudentPage').textContent =
            `Semasa: ms. ${selectedStudent.current_page} | Juzuk ${selectedStudent.current_juz}`;
        document.getElementById('modalAvatar').innerHTML = selectedStudent.photo_url
            ? `<img src="${selectedStudent.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
            : `<span>${initials}</span>`;

        // Switch type button UI
        document.querySelectorAll('.type-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.type === type);
        });

        // Store editing log id and update button label
        const submitBtn = document.getElementById('submitLogBtn');
        submitBtn.dataset.editLogId = logId;
        submitBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Kemaskini Log';
    }, 320);
}

// ============================================================
// DELETE LOG
// BUG FIX 3: After delete, recalculate student current_page from remaining logs
// ============================================================

async function deleteLog(logId, studentId) {
    if (!confirm('Padam log ini? Tindakan ini tidak boleh dibatalkan.')) return;

    const { error } = await supabase.from('hifz_logs').delete().eq('id', logId);
    if (error) { showTeacherToast('Ralat: ' + error.message, 'error'); return; }

    // BUG FIX 3: Recalculate current_page from the next latest jadid log
    // after deletion so the student card reflects the correct surah/page.
    const { data: latestLog } = await supabase
        .from('hifz_logs')
        .select('page_number')
        .eq('student_id', studentId)
        .eq('type', 'jadid')
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // If no jadid logs remain, fall back to page 1
    const newPage = latestLog?.page_number || 1;
    const newJuz  = Math.ceil(newPage / 20);

    await supabase
        .from('students')
        .update({ current_page: newPage, current_juz: newJuz })
        .eq('id', studentId);

    showTeacherToast('Log dipadam.', 'success');

    // Refresh student list cards
    await loadMyStudents();
    renderStudentList(document.getElementById('searchInput')?.value?.toLowerCase() || '');

    // Refresh detail panel logs if still open
    if (studentId) loadStudentLogs(studentId);

    // Also update the detail panel header to reflect new page/juz
    const updatedStudent = myStudents.find(s => s.id === studentId);
    if (updatedStudent) {
        document.getElementById('detailMeta').textContent =
            `ms. ${updatedStudent.current_page} · Juzuk ${updatedStudent.current_juz} · T${updatedStudent.form_level || '–'}`;
    }
}

// ============================================================
// SUBMIT LOG
// ============================================================

async function submitLog() {
    if (!selectedStudent) return;

    const submitBtn = document.getElementById('submitLogBtn');
    const editLogId = submitBtn.dataset.editLogId || null;
    const logType   = document.getElementById('logType').value;
    const pageNumber = parseInt(document.getElementById('logPage').value);
    const quality   = parseInt(document.getElementById('logQuality').value) || null;
    const notes     = document.getElementById('logNotes').value.trim();
    const errorEl   = document.getElementById('modalError');

    // Attendance log doesn't need page validation
    if (logType !== 'hadir') {
        if (!pageNumber || pageNumber < 1 || pageNumber > 604) {
            errorEl.textContent = 'Sila masukkan nombor muka surat yang sah (1–604).';
            errorEl.classList.remove('hidden');
            return;
        }
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';
    errorEl.classList.add('hidden');

    // Keep track of the student id before modal closes (selectedStudent gets cleared)
    const currentStudentId = selectedStudent.id;

    try {
        if (editLogId) {
            // ── UPDATE existing log ──────────────────────────────────────
            const { error: updateError } = await supabase.from('hifz_logs').update({
                type: logType,
                page_number: pageNumber || selectedStudent.current_page,
                quality_score: logType === 'hadir' ? null : quality,
                notes: notes || null,
            }).eq('id', editLogId);
            if (updateError) throw updateError;

            // BUG FIX 1: After editing any jadid log, recalculate current_page
            // from whichever jadid log is now the latest (by date then created_at).
            // This ensures edited page numbers are always correctly reflected.
            if (logType === 'jadid') {
                const { data: latestJadid } = await supabase
                    .from('hifz_logs')
                    .select('page_number')
                    .eq('student_id', currentStudentId)
                    .eq('type', 'jadid')
                    .order('session_date', { ascending: false })
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (latestJadid) {
                    const newJuz = Math.ceil(latestJadid.page_number / 20);
                    const { error: studentError } = await supabase
                        .from('students')
                        .update({ current_page: latestJadid.page_number, current_juz: newJuz })
                        .eq('id', currentStudentId);
                    if (studentError) throw studentError;
                }
            }

        } else {
            // ── INSERT new log ───────────────────────────────────────────
            const { error: logError } = await supabase.from('hifz_logs').insert({
                student_id: selectedStudent.id,
                teacher_id: AppState.profile.id,
                type: logType,
                page_number: pageNumber || selectedStudent.current_page,
                quality_score: logType === 'hadir' ? null : quality,
                notes: notes || null,
                session_date: getTodayDate(),
            });
            if (logError) throw logError;

            // Update student page only for Jadid and only if page advances
            if (logType === 'jadid' && pageNumber > selectedStudent.current_page) {
                const newJuz = Math.ceil(pageNumber / 20);
                const { error: studentError } = await supabase
                    .from('students')
                    .update({ current_page: pageNumber, current_juz: newJuz })
                    .eq('id', selectedStudent.id);
                if (studentError) throw studentError;
            }
        }

        // Refresh student list
        await loadMyStudents();
        renderStudentList(document.getElementById('searchInput')?.value?.toLowerCase() || '');

        const wasEditing = !!editLogId;
        const studentName = selectedStudent.full_name;
        const snapStudentId = currentStudentId; // already captured above

        // Clear edit state AND detail-return flag BEFORE closeLogModal so it
        // doesn't try to reopen the Detail Panel on its own — submitLog handles that below.
        // Capture before clearing — needed to decide whether to reopen Detail Panel
        const wasFromDetail = modalOpenedFromDetail;

        // Clear BEFORE closeLogModal so closeLogModal doesn't also try to reopen
        const sb = document.getElementById('submitLogBtn');
        if (sb) delete sb.dataset.editLogId;
        modalOpenedFromDetail = false;

        closeLogModal();

        showTeacherToast(
            wasEditing
                ? `Log dikemaskini untuk ${studentName}! ✏️`
                : `Log berjaya disimpan untuk ${studentName}! 🎉`,
            'success'
        );

        // Reopen Detail Panel if the modal was opened from it (new log OR edit).
        // This returns the teacher to the student profile with refreshed data.
        if (wasFromDetail) {
            openStudentDetail(snapStudentId);
        }

    } catch (err) {
        errorEl.textContent = 'Ralat: ' + err.message;
        errorEl.classList.remove('hidden');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Simpan Log Tasmik';
        delete submitBtn.dataset.editLogId;
    }
}

// ============================================================
// BIND FORMS
// ============================================================

function bindForms() {
    document.getElementById('submitLogBtn')?.addEventListener('click', submitLog);
    document.getElementById('closeModalBtn')?.addEventListener('click', closeLogModal);
    document.getElementById('modalBackdrop')?.addEventListener('click', closeLogModal);
}

// ============================================================
// TOAST
// ============================================================

function showTeacherToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show toast-${type}`;
    setTimeout(() => toast.classList.remove('show'), 3500);
}

// ============================================================
// STUDENT DETAIL PANEL
// ============================================================

async function openStudentDetail(studentId) {
    const student = myStudents.find(s => s.id === studentId);
    if (!student) return;
    selectedStudent = student;  // keep track so Log/Edit buttons in detail work

    const panel = document.getElementById('studentDetailPanel');
    if (!panel) return;

    const initials = student.full_name.split(' ').map(w => w[0]).slice(0, 2).join('');
    const hutang = student.hutang;
    const hutangDisplay = hutang === null ? '–' : hutang > 0 ? `+${hutang} ms` : hutang === 0 ? 'Tepat' : `${hutang} ms`;
    let statusClass = hutang === null ? 'status-gray' : hutang > 15 ? 'status-red' : hutang > 0 ? 'status-orange' : 'status-green';
    const juzOverall = Math.min(100, Math.round((student.current_page / 604) * 100));

    // Fill header
    document.getElementById('detailAvatar').innerHTML = student.photo_url
        ? `<img src="${student.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : `<span>${initials}</span>`;
    document.getElementById('detailName').textContent = student.full_name;
    document.getElementById('detailMeta').textContent = `ms. ${student.current_page} · Juzuk ${student.current_juz} · T${student.form_level || '–'}`;
    document.getElementById('detailHutang').textContent = hutangDisplay;
    document.getElementById('detailHutang').className = `detail-big-val ${statusClass}`;
    document.getElementById('detailProgress').style.width = juzOverall + '%';
    document.getElementById('detailProgressLabel').textContent = `${juzOverall}% keseluruhan (ms. ${student.current_page}/604)`;

    // Open panel
    panel.classList.remove('hidden');
    panel.classList.add('open');

    // Show loading state for both sections
    document.getElementById('detailLogs').innerHTML = '<p style="font-size:12px;color:#94A3B8;text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';
    document.getElementById('detailStats').innerHTML = '';

    const { data: logs } = await supabase
        .from('hifz_logs')
        .select('*')
        .eq('student_id', studentId)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30);

    // Stats computation
    const allLogs = logs || [];
    const jadidLogs    = allLogs.filter(l => l.type === 'jadid');
    const hadirLogs    = allLogs.filter(l => l.type === 'hadir');
    const murajaahLogs = allLogs.filter(l => l.type === 'murajaah_u' || l.type === 'murajaah_q');
    const avgQuality   = jadidLogs.length
        ? (jadidLogs.reduce((a, l) => a + (l.quality_score || 0), 0) / jadidLogs.length).toFixed(1)
        : '–';

    document.getElementById('detailStats').innerHTML = `
        <div class="detail-stat-grid">
          <div class="detail-stat-box">
            <div class="detail-stat-val">${jadidLogs.length}</div>
            <div class="detail-stat-lbl"><i class="fas fa-star"></i> Sesi Jadid</div>
          </div>
          <div class="detail-stat-box">
            <div class="detail-stat-val">${murajaahLogs.length}</div>
            <div class="detail-stat-lbl"><i class="fas fa-rotate"></i> Murajaah</div>
          </div>
          <div class="detail-stat-box">
            <div class="detail-stat-val">${hadirLogs.length}</div>
            <div class="detail-stat-lbl"><i class="fas fa-user-check"></i> Hadir</div>
          </div>
          <div class="detail-stat-box">
            <div class="detail-stat-val">${avgQuality}</div>
            <div class="detail-stat-lbl"><i class="fas fa-star-half-stroke"></i> Purata Kualiti</div>
          </div>
        </div>`;

    if (!allLogs.length) {
        document.getElementById('detailLogs').innerHTML = '<p style="font-size:13px;color:#94A3B8;text-align:center;padding:20px;">Tiada log tasmik lagi.</p>';
        return;
    }

    // Pass already-fetched logs — no second DB round-trip needed
    loadStudentLogs(studentId, allLogs);
}

function closeStudentDetail() {
    const panel = document.getElementById('studentDetailPanel');
    panel?.classList.remove('open');
    setTimeout(() => panel?.classList.add('hidden'), 300);
}

function openLogFromDetail() {
    if (!selectedStudent) return;
    modalOpenedFromDetail = true; // return to Detail Panel if modal is closed
    closeStudentDetail();
    setTimeout(() => openLogModal(selectedStudent.id), 320);
}

window.openLogModal        = openLogModal;
window.openLogModalFromCard = openLogModalFromCard;
window.closeLogModal       = closeLogModal;
window.submitLog           = submitLog;
window.editLog             = editLog;
window.deleteLog           = deleteLog;
window.openStudentDetail   = openStudentDetail;
window.closeStudentDetail  = closeStudentDetail;
window.openLogFromDetail   = openLogFromDetail;
window.changePage          = changePage;
