// ============================================================
// MYHAFAZAN MTSD - teacher.js
// Teacher (Murabbi) Logging Module
// ============================================================

let selectedStudent = null;
let myHalaqah = null;
let myStudents = [];

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

    // Today's RPT target
    const { data: rpt } = await supabase
        .from('rpt_targets')
        .select('target_page_total')
        .eq('date', getTodayDate())
        .single();

    const todayTarget = rpt?.target_page_total || null;
    const badge = document.getElementById('todayTargetBadge');
    if (badge) badge.innerHTML = todayTarget
        ? `<i class="fas fa-bullseye"></i> Sasaran Hari Ini: ms. ${todayTarget}`
        : `<i class="fas fa-circle-minus"></i> RPT belum ditetapkan untuk hari ini`;

    const { data: students, error } = await supabase
        .from('students')
        .select('*')
        .eq('halaqah_id', myHalaqah.id)
        .eq('is_active', true)
        .order('full_name');

    if (error) { console.error(error); return; }

    myStudents = (students || []).map(s => ({
        ...s,
        hutang: todayTarget !== null ? todayTarget - s.current_page : null,
    }));

    // FIX: show only the number, the label already says "Pelajar"
    document.getElementById('studentCount').textContent = myStudents.length;
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

    container.innerHTML = filtered.map(student => {
        const hutang = student.hutang;
        let statusClass = 'status-green';
        let statusText = 'Melebihi';
        let statusIcon = 'fa-circle-check';

        if (hutang === null) {
            statusClass = 'status-gray'; statusText = 'Tiada RPT'; statusIcon = 'fa-circle-minus';
        } else if (hutang > 15) {
            statusClass = 'status-red'; statusText = 'Ketinggalan'; statusIcon = 'fa-circle-exclamation';
        } else if (hutang > 0) {
            statusClass = 'status-orange'; statusText = 'Amaran'; statusIcon = 'fa-triangle-exclamation';
        } else if (hutang === 0) {
            statusText = 'Tepat';
        }

        const initials = student.full_name.split(' ').map(w => w[0]).slice(0, 2).join('');
        const juzProgress = Math.min(100, ((student.current_page % 20) / 20) * 100);
        const hutangDisplay = hutang === null ? '–' : hutang > 0 ? `+${hutang}` : `${hutang}`;

        return `
        <div class="student-card" onclick="openLogModal(${student.id})">
          <div class="sc-avatar">
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
            <div class="sc-hutang ${statusClass}">${hutangDisplay}</div>
            <div class="sc-status ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</div>
            <div class="sc-log-btn"><i class="fas fa-pen-to-square"></i> Log</div>
          </div>
        </div>`;
    }).join('');
}

// ============================================================
// MODAL: Open & Close
// ============================================================

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

    loadStudentLogs(studentId);

    const modal = document.getElementById('logModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeLogModal() {
    const modal = document.getElementById('logModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    selectedStudent = null;
    // FIX #9: Reset edit mode on close
    const submitBtn = document.getElementById('submitLogBtn');
    if (submitBtn) {
        delete submitBtn.dataset.editLogId;
        submitBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Simpan Log Tasmik';
    }
}

async function loadStudentLogs(studentId) {
    const { data: logs } = await supabase
        .from('hifz_logs')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(5);

    const container = document.getElementById('studentLogs');
    if (!container) return;

    const typeLabels = { jadid: 'Hifz Jadid', murajaah_u: 'Murajaah Umum', murajaah_q: 'Murajaah Khas', hadir: 'Kehadiran' };
    const typeColors = { jadid: '#6B21A8', murajaah_u: '#16A34A', murajaah_q: '#D97706', hadir: '#2563EB' };

    if (!logs || !logs.length) {
        container.innerHTML = '<p style="font-size:12px;color:#94A3B8;text-align:center;padding:12px;">Tiada log tasmik lagi.</p>';
        return;
    }

    // FIX #9: Each log shows edit & delete buttons
    container.innerHTML = logs.map(log => `
        <div id="log-row-${log.id}" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #F1F5F9;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${typeColors[log.type] || '#94A3B8'};flex-shrink:0;"></span>
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:600;color:#334155;">${typeLabels[log.type] || log.type} – ms. ${log.page_number}</div>
            <div style="font-size:11px;color:#94A3B8;">${formatDateMY(log.session_date)} ${'⭐'.repeat(log.quality_score || 0)}</div>
          </div>
          <button onclick="editLog(${log.id},${log.page_number},'${log.type}',${log.quality_score || 5})" 
            style="background:#F3E8FF;border:none;color:#6B21A8;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">
            <i class="fas fa-pen"></i>
          </button>
          <button onclick="deleteLog(${log.id},${selectedStudent?.id})"
            style="background:#FEE2E2;border:none;color:#DC2626;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">
            <i class="fas fa-trash"></i>
          </button>
        </div>
    `).join('');
}

// FIX #9: Edit log — pre-fill modal with existing log data
function editLog(logId, page, type, quality) {
    document.getElementById('logPage').value = page;
    document.getElementById('logType').value = type;
    document.getElementById('logQuality').value = quality;
    // Switch type button UI
    document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.type === type);
    });
    // Store editing log id
    document.getElementById('submitLogBtn').dataset.editLogId = logId;
    document.getElementById('submitLogBtn').innerHTML = '<i class="fas fa-floppy-disk"></i> Kemaskini Log';
}

// FIX #9: Delete log
async function deleteLog(logId, studentId) {
    if (!confirm('Padam log ini? Tindakan ini tidak boleh dibatalkan.')) return;
    const { error } = await supabase.from('hifz_logs').delete().eq('id', logId);
    if (error) { showTeacherToast('Ralat: ' + error.message, 'error'); return; }
    showTeacherToast('Log dipadam.', 'success');
    if (studentId) loadStudentLogs(studentId);
}

// ============================================================
// SUBMIT LOG
// ============================================================

async function submitLog() {
    if (!selectedStudent) return;

    const submitBtn = document.getElementById('submitLogBtn');
    const editLogId = submitBtn.dataset.editLogId || null;
    const logType = document.getElementById('logType').value;
    const pageNumber = parseInt(document.getElementById('logPage').value);
    const quality = parseInt(document.getElementById('logQuality').value) || null;
    const notes = document.getElementById('logNotes').value.trim();
    const errorEl = document.getElementById('modalError');

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

    try {
        // FIX #9: If editing existing log, use UPDATE not INSERT
        if (editLogId) {
            const { error: updateError } = await supabase.from('hifz_logs').update({
                type: logType,
                page_number: pageNumber || selectedStudent.current_page,
                quality_score: quality,
                notes: notes || null,
            }).eq('id', editLogId);
            if (updateError) throw updateError;
        } else {
            // 1. Insert new log
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

            // 2. Update student page only for Jadid and only if page advances
            if (logType === 'jadid' && pageNumber > selectedStudent.current_page) {
                const newJuz = Math.ceil(pageNumber / 20);
                const { error: studentError } = await supabase
                    .from('students')
                    .update({ current_page: pageNumber, current_juz: newJuz })
                    .eq('id', selectedStudent.id);
                if (studentError) throw studentError;
            }
        }

        // 3. Refresh
        await loadMyStudents();
        renderStudentList(document.getElementById('searchInput')?.value?.toLowerCase() || '');
        closeLogModal();
        showTeacherToast(
            editLogId
                ? `Log dikemaskini untuk ${selectedStudent.full_name}! ✏️`
                : `Log berjaya disimpan untuk ${selectedStudent.full_name}! 🎉`,
            'success'
        );

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

window.openLogModal = openLogModal;
window.closeLogModal = closeLogModal;
window.submitLog = submitLog;
window.editLog = editLog;
window.deleteLog = deleteLog;
