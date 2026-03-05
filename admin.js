// ============================================================
// MYHAFAZAN MTSD - admin.js
// Admin Management, Analytics & Real-time Dashboard
// ============================================================

// Chart instances
let donutChart = null;
let barChart = null;

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const profile = await requireAuth('admin');
    if (!profile) return;

    populateNavProfile(profile);
    initNavigation();
    await loadDashboard();
    initRealtime();
    bindForms();
    await loadManagementData();

    // Set today's date
    document.getElementById('rptDate')?.setAttribute('value', getTodayDate());
});

// ============================================================
// NAVIGATION (SPA tabs)
// ============================================================

function initNavigation() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    switchTab('dashboard');
}

function switchTab(tab) {
    // Update nav items
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    // Update tab panels
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('hidden', el.dataset.panel !== tab);
    });

    // Update topbar title
    const titles = {
        dashboard: 'Papan Pemuka Admin',
        students: 'Semua Pelajar',
        setup: 'Pengurusan Pengguna & Halaqah',
        halaqah: 'Senarai Halaqah',
        rpt: 'Editor RPT',
    };
    const titleEl = document.querySelector('.topbar-title');
    if (titleEl) titleEl.textContent = titles[tab] || 'Admin';

    // Load data for tab
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'rpt') loadRPTEditor();
    if (tab === 'students') loadStudentTable();
    if (tab === 'halaqah') loadHalaqahList();
    if (tab === 'setup') loadManagementData(); // FIX: refresh dropdowns on every visit
}

// ============================================================
// DASHBOARD: Analytics
// ============================================================

async function loadDashboard() {
    try {
        const { data: students, error } = await supabase
            .from('student_progress')
            .select('*');

        if (error) throw error;

        const total = students.length;
        const ahead = students.filter(s => s.status === 'ahead').length;
        const warning = students.filter(s => s.status === 'warning').length;
        const behind = students.filter(s => s.status === 'behind').length;

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statAhead').textContent = ahead;
        document.getElementById('statBehind').textContent = behind;
        document.getElementById('statWarning').textContent = warning;

        renderDonutChart(ahead, warning, behind);

        const debtors = [...students]
            .filter(s => s.hutang > 0)
            .sort((a, b) => b.hutang - a.hutang)
            .slice(0, 8);
        renderBarChart(debtors);

        // Today's target
        const { data: rpt } = await supabase
            .from('rpt_targets')
            .select('target_page_total, juz_reference')
            .eq('date', getTodayDate())
            .single();

        if (rpt) {
            document.getElementById('todayTarget').textContent = rpt.target_page_total;
            document.getElementById('todayJuz').textContent = `Juzuk ${rpt.juz_reference || '-'}`;
        } else {
            document.getElementById('todayTarget').textContent = '–';
            document.getElementById('todayJuz').textContent = 'Tiada sasaran RPT hari ini';
        }

        loadRecentLogs();

    } catch (err) {
        console.error('Dashboard error:', err);
    }
}

function renderDonutChart(ahead, warning, behind) {
    const ctx = document.getElementById('donutChart');
    if (!ctx) return;
    if (donutChart) donutChart.destroy();

    donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Melebihi/Mencapai', 'Amaran', 'Ketinggalan'],
            datasets: [{
                data: [ahead, warning, behind],
                backgroundColor: ['#16A34A', '#D97706', '#DC2626'],
                borderColor: 'transparent',
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#CBD5E1', font: { size: 12, family: 'Plus Jakarta Sans' }, padding: 16 }
                },
                tooltip: {
                    callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} pelajar` }
                }
            }
        }
    });
}

function renderBarChart(debtors) {
    const ctx = document.getElementById('barChart');
    if (!ctx) return;
    if (barChart) barChart.destroy();

    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: debtors.map(s => s.full_name.split(' ')[0]),
            datasets: [{
                label: 'Hutang Muka Surat',
                data: debtors.map(s => s.hutang),
                backgroundColor: debtors.map(s =>
                    s.hutang > 15 ? '#DC2626' : s.hutang > 5 ? '#D97706' : '#16A34A'
                ),
                borderRadius: 8,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => ` Hutang: ${ctx.raw} muka surat` }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(100,116,139,0.15)' },
                    ticks: { color: '#94A3B8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94A3B8', maxRotation: 30 }
                }
            }
        }
    });
}

async function loadRecentLogs() {
    const { data: logs } = await supabase
        .from('hifz_logs')
        .select('*, students(full_name), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(8);

    const container = document.getElementById('recentLogs');
    if (!container || !logs) return;

    const typeLabels = { jadid: 'Hifz Jadid', murajaah_u: 'Murajaah Umum', murajaah_q: 'Murajaah Khas' };
    const typeColors = { jadid: 'badge-purple', murajaah_u: 'badge-green', murajaah_q: 'badge-gold' };

    if (!logs.length) {
        container.innerHTML = '<p class="empty-msg">Tiada log lagi.</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="log-item">
          <div class="log-avatar">${(log.students?.full_name || '?')[0]}</div>
          <div class="log-info">
            <div class="log-name">${log.students?.full_name || '-'}</div>
            <div class="log-meta">
              <span class="badge ${typeColors[log.type]}">${typeLabels[log.type]}</span>
              ms. ${log.page_number}
            </div>
          </div>
          <div class="log-time">${timeAgo(log.created_at)}</div>
        </div>
    `).join('');
}

function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr)) / 1000;
    if (diff < 60) return 'Baru sahaja';
    if (diff < 3600) return `${Math.floor(diff / 60)} min lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return new Date(dateStr).toLocaleDateString('ms-MY');
}

// ============================================================
// REAL-TIME
// ============================================================

function initRealtime() {
    supabase
        .channel('hifz_logs_changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hifz_logs' }, () => {
            loadDashboard();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' }, () => {
            loadDashboard();
        })
        .subscribe();
}

// ============================================================
// MANAGEMENT DROPDOWNS
// ============================================================

async function loadManagementData() {
    await Promise.all([
        loadTeachersDropdown(),
        loadHalaqahDropdown(),
        loadParentsDropdown(),
    ]);
}

async function loadTeachersDropdown() {
    const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'teacher')
        .order('full_name');

    const selects = document.querySelectorAll('.select-teacher');
    selects.forEach(sel => {
        sel.innerHTML = '<option value="">-- Pilih Murabbi --</option>' +
            (data || []).map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');
    });
}

async function loadHalaqahDropdown() {
    const { data } = await supabase
        .from('halaqahs')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

    const selects = document.querySelectorAll('.select-halaqah');
    selects.forEach(sel => {
        sel.innerHTML = '<option value="">-- Pilih Halaqah --</option>' +
            (data || []).map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    });
}

async function loadParentsDropdown() {
    const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'parent')
        .order('full_name');

    const selects = document.querySelectorAll('.select-parent');
    selects.forEach(sel => {
        sel.innerHTML = '<option value="">-- Pilih Wali --</option>' +
            (data || []).map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');
    });
}

// ============================================================
// HALAQAH LIST
// ============================================================

async function loadHalaqahList() {
    const container = document.getElementById('halaqahList');
    if (!container) return;
    container.innerHTML = '<p class="empty-msg"><i class="fas fa-spinner fa-spin"></i> Memuat...</p>';

    const { data, error } = await supabase
        .from('halaqahs')
        .select('*, profiles(full_name)')
        .eq('is_active', true)
        .order('name');

    if (error || !data) {
        container.innerHTML = '<p class="empty-msg">Ralat memuatkan halaqah.</p>';
        return;
    }

    if (!data.length) {
        container.innerHTML = '<p class="empty-msg">Tiada halaqah ditemui. Tambah halaqah baharu di tab Pengurusan.</p>';
        return;
    }

    container.innerHTML = data.map(h => `
        <div class="item-card">
          <div class="item-icon"><i class="fas fa-circle-nodes"></i></div>
          <div class="item-info">
            <div class="item-name">${h.name}</div>
            <div class="item-sub"><i class="fas fa-chalkboard-user"></i> ${h.profiles?.full_name || 'Tiada Murabbi'}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn-sm btn-edit" onclick="editHalaqah(${h.id}, '${h.name.replace(/'/g, "\\'")}', '${h.teacher_id || ''}')">
              <i class="fas fa-pen"></i>
            </button>
            <button class="btn-sm btn-danger" onclick="deleteHalaqah(${h.id})">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
    `).join('');
}

async function deleteHalaqah(id) {
    if (!confirm('Nyahaktifkan halaqah ini? Pelajar dalam halaqah ini akan tidak berkumpulan.')) return;
    const { error } = await supabase.from('halaqahs').update({ is_active: false }).eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Halaqah berjaya dinyahaktifkan.', 'success');
    loadHalaqahList();
    loadHalaqahDropdown();
}

async function editHalaqah(id, currentName, currentTeacherId) {
    const newName = prompt('Nama halaqah baharu:', currentName);
    if (!newName || !newName.trim()) return;
    const { error } = await supabase.from('halaqahs').update({ name: newName.trim() }).eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Halaqah berjaya dikemaskini.', 'success');
    loadHalaqahList();
    loadHalaqahDropdown();
}

// ============================================================
// STUDENT TABLE
// ============================================================

async function loadStudentTable() {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg"><i class="fas fa-spinner fa-spin"></i> Memuat data...</td></tr>';

    const { data, error } = await supabase
        .from('student_progress')
        .select('*')
        .order('hutang', { ascending: false });

    if (error || !data) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Ralat memuatkan data pelajar.</td></tr>';
        return;
    }

    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">Tiada pelajar berdaftar.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(s => {
        const hutang = s.hutang ?? 0;
        const hutangClass = hutang > 15 ? 'text-red fw-bold' : hutang > 5 ? 'text-orange fw-bold' : 'text-green fw-bold';
        const statusBadge = s.status === 'ahead'
            ? `<span class="badge badge-green"><i class="fas fa-check"></i> Melebihi</span>`
            : s.status === 'warning'
                ? `<span class="badge badge-gold"><i class="fas fa-triangle-exclamation"></i> Amaran</span>`
                : `<span class="badge badge-red"><i class="fas fa-circle-exclamation"></i> Ketinggalan</span>`;

        return `
        <tr>
          <td>
            <div class="student-name-cell">
              <div class="avatar-sm">${(s.full_name || '?')[0]}</div>
              ${s.full_name}
            </div>
          </td>
          <td>${s.halaqah_name || '<span style="color:var(--slate-400);">–</span>'}</td>
          <td>${s.current_page}</td>
          <td>${s.target_page_total || '<span style="color:var(--slate-400);">–</span>'}</td>
          <td class="${hutangClass}">${hutang > 0 ? '+' + hutang : hutang}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-edit" onclick="openEditStudentModal(${s.id}, '${(s.full_name || '').replace(/'/g, "\\'")}', ${s.current_page}, ${s.current_juz || 1})">
                <i class="fas fa-pen"></i>
              </button>
              <button class="btn-sm btn-danger" onclick="deleteStudent(${s.id})">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
}

async function deleteStudent(id) {
    if (!confirm('Nyahaktifkan pelajar ini? Data log mereka akan dikekalkan.')) return;
    const { error } = await supabase.from('students').update({ is_active: false }).eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pelajar berjaya dinyahaktifkan.', 'success');
    loadStudentTable();
}

function openEditStudentModal(id, name, page, juz) {
    document.getElementById('editStudentId').value = id;
    document.getElementById('editStudentName').value = name;
    document.getElementById('editStudentPage').value = page;
    document.getElementById('editStudentJuz').value = juz;

    // Reload parents into the reassign dropdown
    loadEditStudentParent(id);

    document.getElementById('editStudentModal').classList.remove('hidden');
    document.getElementById('editStudentModal').classList.add('flex');
}

// Load parent dropdown inside edit modal and pre-select current parent
async function loadEditStudentParent(studentId) {
    const { data: parents } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'parent')
        .order('full_name');

    const { data: student } = await supabase
        .from('students')
        .select('parent_id')
        .eq('id', studentId)
        .single();

    const sel = document.getElementById('editStudentParent');
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Tiada Wali --</option>' +
        (parents || []).map(p =>
            `<option value="${p.id}" ${student?.parent_id === p.id ? 'selected' : ''}>${p.full_name}</option>`
        ).join('');
}

function closeEditStudentModal() {
    document.getElementById('editStudentModal').classList.add('hidden');
    document.getElementById('editStudentModal').classList.remove('flex');
}

async function submitEditStudent() {
    const id = document.getElementById('editStudentId').value;
    const name = document.getElementById('editStudentName').value.trim();
    const page = parseInt(document.getElementById('editStudentPage').value);
    const juz = parseInt(document.getElementById('editStudentJuz').value);
    const parentId = document.getElementById('editStudentParent').value || null;

    if (!name || !page || !juz) { showToast('Sila isi semua medan.', 'error'); return; }
    if (page < 1 || page > 604) { showToast('Muka surat mesti antara 1–604.', 'error'); return; }
    if (juz < 1 || juz > 30) { showToast('Juzuk mesti antara 1–30.', 'error'); return; }

    const { error } = await supabase.from('students')
        .update({ full_name: name, current_page: page, current_juz: juz, parent_id: parentId })
        .eq('id', id);

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pelajar berjaya dikemaskini!', 'success');
    closeEditStudentModal();
    loadStudentTable();
}

// ============================================================
// RPT EDITOR
// ============================================================

async function loadRPTEditor() {
    const { data } = await supabase
        .from('rpt_targets')
        .select('*')
        .gte('date', getTodayDate())
        .order('date')
        .limit(31);

    const tbody = document.getElementById('rptTableBody');
    if (!tbody) return;

    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">Tiada sasaran RPT. Tambah sasaran baharu.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(r => `
        <tr>
          <td>${formatDateMY(r.date)}</td>
          <td><input type="number" class="rpt-input" data-id="${r.id}" value="${r.target_page_total}" min="1" max="604" /></td>
          <td><input type="number" class="rpt-input-juz" data-id="${r.id}" value="${r.juz_reference || ''}" min="1" max="30" placeholder="–" /></td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-edit btn-save-rpt" data-id="${r.id}"><i class="fas fa-floppy-disk"></i></button>
              <button class="btn-sm btn-danger btn-del-rpt" data-id="${r.id}"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.btn-save-rpt').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const page = tbody.querySelector(`.rpt-input[data-id="${id}"]`).value;
            const juz = tbody.querySelector(`.rpt-input-juz[data-id="${id}"]`).value;
            const { error } = await supabase.from('rpt_targets').update({
                target_page_total: parseInt(page),
                juz_reference: juz ? parseInt(juz) : null,
            }).eq('id', id);
            if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
            showToast('RPT dikemaskini!', 'success');
        });
    });

    tbody.querySelectorAll('.btn-del-rpt').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Padam sasaran RPT ini?')) return;
            const id = btn.dataset.id;
            const { error } = await supabase.from('rpt_targets').delete().eq('id', id);
            if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
            showToast('RPT berjaya dipadam.', 'success');
            loadRPTEditor();
        });
    });
}

// ============================================================
// FORMS
// ============================================================

function bindForms() {
    // Teacher form
    document.getElementById('formTeacher')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('teacherName').value.trim();
        const email = document.getElementById('teacherEmail').value.trim();
        const pass = document.getElementById('teacherPass').value;
        try {
            await adminCreateUser(name, email, pass, 'teacher');
            showToast('Murabbi berjaya didaftarkan!', 'success');
            e.target.reset();
            await loadTeachersDropdown();
        } catch (err) {
            showToast('Ralat: ' + err.message, 'error');
        }
    });

    // Parent form
    document.getElementById('formParent')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('parentName').value.trim();
        const email = document.getElementById('parentEmail').value.trim();
        const pass = document.getElementById('parentPass').value;
        try {
            await adminCreateUser(name, email, pass, 'parent');
            showToast('Wali berjaya didaftarkan!', 'success');
            e.target.reset();
            await loadParentsDropdown();
        } catch (err) {
            showToast('Ralat: ' + err.message, 'error');
        }
    });

    // Halaqah form
    document.getElementById('formHalaqah')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('halaqahName').value.trim();
        const teacherId = document.getElementById('halaqahTeacher').value;
        const { error } = await supabase.from('halaqahs').insert({
            name,
            teacher_id: teacherId || null,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Halaqah berjaya ditambah!', 'success');
        e.target.reset();
        await loadHalaqahDropdown();
    });

    // Student form
    document.getElementById('formStudent')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('studentName').value.trim();
        const matricNo = document.getElementById('studentMatric').value.trim();
        const halaqahId = document.getElementById('studentHalaqah').value;
        const parentId = document.getElementById('studentParent').value;

        const { error } = await supabase.from('students').insert({
            full_name: fullName,
            matric_no: matricNo || null,
            halaqah_id: halaqahId ? parseInt(halaqahId) : null,
            parent_id: parentId || null,
            current_page: 1,
            current_juz: 1,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Pelajar berjaya didaftarkan!', 'success');
        e.target.reset();
    });

    // RPT Add form
    document.getElementById('formAddRPT')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('rptDate').value;
        const page = document.getElementById('rptPage').value;
        const juz = document.getElementById('rptJuz').value;
        const { error } = await supabase.from('rpt_targets').upsert({
            date,
            target_page_total: parseInt(page),
            juz_reference: juz ? parseInt(juz) : null,
            created_by: AppState.profile.id,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Sasaran RPT ditambah!', 'success');
        e.target.reset();
        document.getElementById('rptDate').value = getTodayDate();
        loadRPTEditor();
    });

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show toast-${type}`;
    setTimeout(() => toast.classList.remove('show'), 3500);
}

// Expose globals
window.loadDashboard = loadDashboard;
window.loadStudentTable = loadStudentTable;
window.loadRPTEditor = loadRPTEditor;
window.loadHalaqahList = loadHalaqahList;
window.showToast = showToast;
window.deleteHalaqah = deleteHalaqah;
window.editHalaqah = editHalaqah;
window.deleteStudent = deleteStudent;
window.openEditStudentModal = openEditStudentModal;
window.closeEditStudentModal = closeEditStudentModal;
window.submitEditStudent = submitEditStudent;
