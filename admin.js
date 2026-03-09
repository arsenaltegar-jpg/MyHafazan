// ============================================================
// MYHAFAZAN MTSD - admin.js (Enhanced v2)
// ============================================================

let donutChart = null;
let barChart = null;
let allStudents = [];
let allHalaqahs = [];
let allTeachers = [];
let allParents = [];
let csvParsedRows = [];

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const profile = await requireAuth('admin');
    if (!profile) return;

    populateNavProfile(profile);
    initNavigation();
    await loadDropdownData();
    await loadDashboard();
    initRealtime();
    bindForms();

    document.getElementById('rptDate')?.setAttribute('value', getTodayDate());
});

// ============================================================
// NAVIGATION
// ============================================================

function initNavigation() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
            // close sidebar on mobile
            if (window.innerWidth <= 900) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });
}

function switchTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `pane-${tab}`);
    });
    const titles = {
        dashboard: 'Papan Pemuka Admin',
        students: 'Semua Pelajar',
        halaqah: 'Pengurusan Halaqah',
        teachers: 'Senarai Murabbi',
        parents: 'Senarai Wali Murid',
        register: 'Daftar Pengguna & Pelajar',
        batch: 'Muat Naik CSV',
        rpt: 'Editor RPT',
        announcements: 'Pengumuman',
    };
    document.getElementById('topbarTitle').textContent = titles[tab] || 'Admin';

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'students') renderStudentTable();
    if (tab === 'halaqah') loadHalaqahGrid();
    if (tab === 'teachers') loadTeachersTable();
    if (tab === 'parents') loadParentsTable();
    if (tab === 'rpt') loadRPTEditor();
    if (tab === 'announcements') loadAnnouncements();
}

// ============================================================
// DROPDOWN DATA (shared cache)
// ============================================================

async function loadDropdownData() {
    const [teacherRes, halaqahRes, parentRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email').eq('role', 'teacher').order('full_name'),
        supabase.from('halaqahs').select('id, name, teacher_id, room, session_time').eq('is_active', true).order('name'),
        supabase.from('profiles').select('id, full_name, email').eq('role', 'parent').order('full_name'),
    ]);

    allTeachers = teacherRes.data || [];
    allHalaqahs = halaqahRes.data || [];
    allParents = parentRes.data || [];

    populateSelects('.sel-teacher', allTeachers, '-- Pilih Murabbi --');
    populateSelects('.sel-halaqah', allHalaqahs, '-- Pilih Halaqah --');
    populateSelects('.sel-halaqah-edit', allHalaqahs, '-- Pilih Halaqah --');
    populateSelects('.sel-parent', allParents, '-- Tiada Wali --');

    // Halaqah filter in students tab
    const hf = document.getElementById('halaqahFilter');
    if (hf) {
        hf.innerHTML = '<option value="">Semua Halaqah</option>' +
            allHalaqahs.map(h => `<option value="${h.id}">${h.name}</option>`).join('');
    }
}

function populateSelects(selector, data, placeholder) {
    document.querySelectorAll(selector).forEach(sel => {
        sel.innerHTML = `<option value="">${placeholder}</option>` +
            data.map(d => `<option value="${d.id}">${d.full_name || d.name}</option>`).join('');
    });
}

// ============================================================
// DASHBOARD
// ============================================================

async function loadDashboard() {
    try {
        const { data: students } = await supabase.from('student_progress').select('*');
        allStudents = students || [];

        const total = allStudents.length;
        const ahead = allStudents.filter(s => s.status === 'ahead').length;
        const warning = allStudents.filter(s => s.status === 'warning').length;
        const behind = allStudents.filter(s => s.status === 'behind').length;

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statAhead').textContent = ahead;
        document.getElementById('statWarning').textContent = warning;
        document.getElementById('statBehind').textContent = behind;

        renderDonutChart(ahead, warning, behind);
        renderBarChart([...allStudents].filter(s => s.hutang > 0).sort((a,b) => b.hutang - a.hutang).slice(0, 8));

        const { data: rpt } = await supabase.from('rpt_targets').select('target_page_total,juz_reference').eq('date', getTodayDate()).single();
        document.getElementById('todayTarget').textContent = rpt?.target_page_total ?? '–';
        document.getElementById('todayJuz').textContent = rpt ? `Juzuk ${rpt.juz_reference || '–'}` : 'Tiada sasaran RPT hari ini';

        loadRecentLogs();
        loadTopStudents();
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
            datasets: [{ data: [ahead, warning, behind], backgroundColor: ['#16A34A','#D97706','#DC2626'], borderColor: 'transparent', hoverOffset: 8 }]
        },
        options: {
            responsive: true, cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#64748B', font: { size: 11, family: 'DM Sans' }, padding: 14 } },
                tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} pelajar` } }
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
                backgroundColor: debtors.map(s => s.hutang > 15 ? '#DC2626' : s.hutang > 5 ? '#D97706' : '#16A34A'),
                borderRadius: 7,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` Hutang: ${c.raw} ms.` } } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(100,116,139,.12)' }, ticks: { color: '#94A3B8' } },
                x: { grid: { display: false }, ticks: { color: '#94A3B8', maxRotation: 30 } }
            }
        }
    });
}

async function loadRecentLogs() {
    const { data: logs } = await supabase.from('hifz_logs').select('*, students(full_name), profiles(full_name)').order('created_at', { ascending: false }).limit(8);
    const el = document.getElementById('recentLogs');
    if (!el) return;
    const typeLabels = { jadid: 'Hifz Jadid', murajaah_u: 'Murajaah Umum', murajaah_q: 'Murajaah Khas' };
    const typeCls = { jadid: 'badge-p', murajaah_u: 'badge-g', murajaah_q: 'badge-gold' };
    if (!logs?.length) { el.innerHTML = '<div class="empty-msg">Tiada log lagi.</div>'; return; }
    el.innerHTML = logs.map(l => `
        <div class="log-item">
          <div class="log-av">${(l.students?.full_name || '?')[0]}</div>
          <div class="log-info">
            <div class="log-name">${l.students?.full_name || '–'}</div>
            <div class="log-meta"><span class="badge ${typeCls[l.type]}">${typeLabels[l.type]}</span> ms. ${l.page_number}</div>
          </div>
          <div class="log-time">${timeAgo(l.created_at)}</div>
        </div>`).join('');
}

async function loadTopStudents() {
    const top = [...allStudents].filter(s => s.hutang !== null && s.hutang <= 0).sort((a,b) => a.hutang - b.hutang).slice(0, 8);
    const el = document.getElementById('topStudents');
    if (!el) return;
    if (!top.length) { el.innerHTML = '<div class="empty-msg">Tiada data cemerlang.</div>'; return; }
    el.innerHTML = top.map((s, i) => `
        <div class="log-item">
          <div class="log-av" style="background:${i < 3 ? 'linear-gradient(135deg,#D97706,#F59E0B)' : 'linear-gradient(135deg,var(--p),var(--pl))'};">${i+1}</div>
          <div class="log-info">
            <div class="log-name">${s.full_name}</div>
            <div class="log-meta"><i class="fas fa-layer-group"></i> ${s.halaqah_name || '–'} · ms. ${s.current_page}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--g);">${s.hutang <= 0 ? `+${Math.abs(s.hutang)} ms` : '='}</div>
        </div>`).join('');
}

function timeAgo(d) {
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return 'Baru sahaja';
    if (s < 3600) return `${Math.floor(s/60)} min lalu`;
    if (s < 86400) return `${Math.floor(s/3600)} jam lalu`;
    return new Date(d).toLocaleDateString('ms-MY');
}

// ============================================================
// REALTIME
// ============================================================

function initRealtime() {
    supabase.channel('admin-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hifz_logs' }, loadDashboard)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' }, loadDashboard)
        .subscribe();
}

// ============================================================
// STUDENT TABLE
// ============================================================

async function renderStudentTable(filter = '', halaqahId = '', status = '') {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;

    if (!allStudents.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
        const { data } = await supabase.from('student_progress').select('*').order('hutang', { ascending: false });
        allStudents = data || [];
    }

    let data = [...allStudents];
    if (filter) data = data.filter(s => s.full_name?.toLowerCase().includes(filter) || s.matric_no?.toLowerCase().includes(filter));
    if (halaqahId) data = data.filter(s => String(s.halaqah_id) === halaqahId);
    if (status) data = data.filter(s => s.status === status);

    if (!data.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><i class="fas fa-inbox"></i> Tiada pelajar dijumpai.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(s => {
        const h = s.hutang ?? 0;
        const hClass = h > 15 ? 'text-red fw-bold' : h > 5 ? 'text-orange fw-bold' : 'text-green fw-bold';
        const badge = s.status === 'ahead'
            ? `<span class="badge badge-g"><i class="fas fa-check"></i> Melebihi</span>`
            : s.status === 'warning'
            ? `<span class="badge badge-gold"><i class="fas fa-triangle-exclamation"></i> Amaran</span>`
            : s.status === 'behind'
            ? `<span class="badge badge-r"><i class="fas fa-circle-exclamation"></i> Ketinggalan</span>`
            : `<span class="badge" style="color:var(--s400);border-color:var(--s200);">Tiada RPT</span>`;
        return `
        <tr>
          <td><div class="td-name"><div class="av-sm">${(s.full_name||'?')[0]}</div>${s.full_name}</div></td>
          <td>${s.halaqah_name || '<span style="color:var(--s400);">–</span>'}</td>
          <td class="font-mono">${s.current_page}</td>
          <td class="font-mono">${s.target_page_total || '<span style="color:var(--s400);">–</span>'}</td>
          <td class="${hClass} font-mono">${h > 0 ? '+'+h : h}</td>
          <td>${badge}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-edit" onclick="openEditStudentModal(${s.id},'${(s.full_name||'').replace(/'/g,"\\'")}',${s.current_page},${s.current_juz||1},${s.halaqah_id||'null'})">
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

function exportStudentsCSV() {
    const rows = [['Nama','Halaqah','Muka Surat','Juzuk','Hutang','Status']];
    allStudents.forEach(s => rows.push([s.full_name, s.halaqah_name||'', s.current_page, s.current_juz||'', s.hutang??'', s.status||'']));
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `pelajar-myhafazan-${getTodayDate()}.csv`;
    a.click();
}

// ============================================================
// HALAQAH GRID
// ============================================================

async function loadHalaqahGrid() {
    const grid = document.getElementById('halaqahGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="empty-msg"><i class="fas fa-spinner fa-spin"></i></div>';

    const { data, error } = await supabase.from('halaqahs').select('id, name, teacher_id, room, session_time, profiles(full_name)').eq('is_active', true).order('name');
    allHalaqahs = data || [];

    if (error || !data?.length) {
        grid.innerHTML = '<div class="empty-msg"><i class="fas fa-circle-nodes"></i><p>Tiada halaqah. Tambah halaqah baharu.</p></div>';
        return;
    }

    // Get student counts
    const { data: counts } = await supabase.from('students').select('halaqah_id').eq('is_active', true);
    const countMap = {};
    (counts || []).forEach(r => { countMap[r.halaqah_id] = (countMap[r.halaqah_id] || 0) + 1; });

    grid.innerHTML = data.map(h => `
        <div class="halaqah-card">
          <div class="hq-icon"><i class="fas fa-circle-nodes"></i></div>
          <div class="hq-info">
            <div class="hq-name">${h.name}</div>
            <div class="hq-teacher"><i class="fas fa-chalkboard-user"></i> ${h.profiles?.full_name || 'Tiada Murabbi'}</div>
            <div class="hq-stats">
              ${h.room ? `<i class="fas fa-door-open"></i> ${h.room} ·` : ''}
              <i class="fas fa-user-graduate"></i> ${countMap[h.id] || 0} pelajar
            </div>
          </div>
          <div class="hq-actions">
            <button class="btn-sm btn-edit" onclick="openHalaqahModal(${h.id},'${(h.name||'').replace(/'/g,"\\'")}','${h.teacher_id||''}','${(h.room||'').replace(/'/g,"\\'")}','${(h.session_time||'').replace(/'/g,"\\'")}')">
              <i class="fas fa-pen"></i>
            </button>
            <button class="btn-sm btn-danger" onclick="deleteHalaqah(${h.id})">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`).join('');
}

function openHalaqahModal(id = null, name = '', teacherId = '', room = '', time = '') {
    document.getElementById('editHalaqahId').value = id || '';
    document.getElementById('editHalaqahName').value = name;
    document.getElementById('editHalaqahRoom').value = room;
    document.getElementById('editHalaqahTime').value = time;
    document.getElementById('halaqahModalTitle').innerHTML =
        `<i class="fas fa-circle-nodes" style="color:var(--g);margin-right:8px;font-size:15px;"></i>${id ? 'Kemaskini Halaqah' : 'Tambah Halaqah Baru'}`;

    // Pre-select teacher
    const sel = document.getElementById('editHalaqahTeacher');
    const currentTeacherId = String(teacherId || '');
    sel.innerHTML = '<option value="">-- Pilih Murabbi --</option>' +
        allTeachers.map(t => `<option value="${t.id}" ${String(t.id) === currentTeacherId ? 'selected' : ''}>${t.full_name}</option>`).join('');

    openModal('halaqahModal');
}

async function submitHalaqahModal() {
    const id = document.getElementById('editHalaqahId').value;
    const name = document.getElementById('editHalaqahName').value.trim();
    const teacherId = document.getElementById('editHalaqahTeacher').value;
    const room = document.getElementById('editHalaqahRoom').value.trim();
    const time = document.getElementById('editHalaqahTime').value.trim();

    if (!name) { showToast('Sila masukkan nama halaqah.', 'error'); return; }

    const payload = { name, teacher_id: teacherId || null, room: room || null, session_time: time || null };

    const { error } = id
        ? await supabase.from('halaqahs').update(payload).eq('id', id)
        : await supabase.from('halaqahs').insert(payload);

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast(id ? 'Halaqah dikemaskini!' : 'Halaqah berjaya ditambah!', 'success');
    closeModal('halaqahModal');
    await loadDropdownData();
    loadHalaqahGrid();
}

async function deleteHalaqah(id) {
    if (!confirm('Nyahaktifkan halaqah ini?')) return;
    const { error } = await supabase.from('halaqahs').update({ is_active: false }).eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Halaqah dinyahaktifkan.', 'success');
    await loadDropdownData();
    loadHalaqahGrid();
}

// ============================================================
// TEACHERS TABLE
// ============================================================

async function loadTeachersTable() {
    const tbody = document.getElementById('teacherTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const { data: teachers } = await supabase.from('profiles').select('id,full_name,email').eq('role','teacher').order('full_name');
    allTeachers = teachers || [];

    if (!allTeachers.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Tiada murabbi berdaftar.</td></tr>';
        return;
    }

    // Get halaqah assignments
    const { data: halaqahs } = await supabase.from('halaqahs').select('teacher_id, name').eq('is_active', true);
    const hMap = {};
    (halaqahs || []).forEach(h => { hMap[h.teacher_id] = h.name; });

    tbody.innerHTML = allTeachers.map(t => `
        <tr>
          <td><div class="td-name"><div class="av-sm" style="background:linear-gradient(135deg,var(--p),var(--pl));">${(t.full_name||'?')[0]}</div>${t.full_name}</div></td>
          <td style="color:var(--s500);">${t.email || '–'}</td>
          <td>${hMap[t.id] ? `<span class="badge badge-g">${hMap[t.id]}</span>` : '<span style="color:var(--s400);">Tiada halaqah</span>'}</td>
          <td><button class="btn-sm btn-danger" onclick="removeUser('${t.id}','${(t.full_name||'').replace(/'/g,"\\'")}')"><i class="fas fa-user-minus"></i> Alih Keluar</button></td>
        </tr>`).join('');
}

// ============================================================
// PARENTS TABLE
// ============================================================

let allParentsCache = [];
async function loadParentsTable() {
    const tbody = document.getElementById('parentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const { data: parents } = await supabase.from('profiles').select('id,full_name,email').eq('role','parent').order('full_name');
    allParentsCache = parents || [];

    if (!allParentsCache.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Tiada wali berdaftar.</td></tr>';
        return;
    }

    const { data: students } = await supabase.from('students').select('parent_id').eq('is_active', true);
    const childCount = {};
    (students || []).forEach(s => { if (s.parent_id) childCount[s.parent_id] = (childCount[s.parent_id]||0)+1; });

    renderParentRows(allParentsCache, childCount);
    window._parentChildCount = childCount;
}

function renderParentRows(parents, childCount) {
    const tbody = document.getElementById('parentTableBody');
    if (!tbody) return;
    tbody.innerHTML = parents.map(p => `
        <tr>
          <td><div class="td-name"><div class="av-sm" style="background:linear-gradient(135deg,var(--gold),#F59E0B);">${(p.full_name||'?')[0]}</div>${p.full_name}</div></td>
          <td style="color:var(--s500);">${p.email || '–'}</td>
          <td><span class="badge badge-p">${childCount[p.id]||0} anak</span></td>
          <td><button class="btn-sm btn-danger" onclick="removeUser('${p.id}','${(p.full_name||'').replace(/'/g,"\\'")}')"><i class="fas fa-user-minus"></i> Alih Keluar</button></td>
        </tr>`).join('');
}

function filterParentTable(query) {
    const filtered = allParentsCache.filter(p =>
        (p.full_name||'').toLowerCase().includes(query.toLowerCase()) ||
        (p.email||'').toLowerCase().includes(query.toLowerCase())
    );
    renderParentRows(filtered, window._parentChildCount || {});
}

async function removeUser(id, name) {
    if (!confirm(`Alih keluar ${name} dari sistem? Tindakan ini tidak boleh dibatalkan.`)) return;
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast(`${name} berjaya dialih keluar.`, 'success');
    await loadDropdownData();
    loadTeachersTable();
    loadParentsTable();
}

// ============================================================
// STUDENT EDIT MODAL
// ============================================================

async function openEditStudentModal(id, name, page, juz, halaqahId) {
    document.getElementById('editStudentId').value = id;
    document.getElementById('editStudentName').value = name;
    document.getElementById('editStudentPage').value = page;
    document.getElementById('editStudentJuz').value = juz;

    // Halaqah dropdown
    const selH = document.getElementById('editStudentHalaqah');
    selH.innerHTML = '<option value="">-- Pilih Halaqah --</option>' +
        allHalaqahs.map(h => `<option value="${h.id}" ${h.id == halaqahId ? 'selected' : ''}>${h.name}</option>`).join('');

    // Parent dropdown with pre-selection
    const { data: student } = await supabase.from('students').select('parent_id').eq('id', id).single();
    const selP = document.getElementById('editStudentParent');
    selP.innerHTML = '<option value="">-- Tiada Wali --</option>' +
        allParents.map(p => `<option value="${p.id}" ${p.id === student?.parent_id ? 'selected' : ''}>${p.full_name}</option>`).join('');

    openModal('editStudentModal');
}

async function submitEditStudent() {
    const id = document.getElementById('editStudentId').value;
    const name = document.getElementById('editStudentName').value.trim();
    const page = parseInt(document.getElementById('editStudentPage').value);
    const juz = parseInt(document.getElementById('editStudentJuz').value);
    const parentId = document.getElementById('editStudentParent').value || null;
    const halaqahId = document.getElementById('editStudentHalaqah').value || null;

    if (!name || !page || !juz) { showToast('Sila isi semua medan wajib.', 'error'); return; }

    const { error } = await supabase.from('students')
        .update({ full_name: name, current_page: page, current_juz: juz, parent_id: parentId, halaqah_id: halaqahId ? parseInt(halaqahId) : null })
        .eq('id', id);

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pelajar berjaya dikemaskini!', 'success');
    closeModal('editStudentModal');
    allStudents = [];
    renderStudentTable();
}

async function deleteStudent(id) {
    if (!confirm('Nyahaktifkan pelajar ini?')) return;
    const { error } = await supabase.from('students').update({ is_active: false }).eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pelajar dinyahaktifkan.', 'success');
    allStudents = [];
    renderStudentTable();
}

// ============================================================
// RPT EDITOR
// ============================================================

async function loadRPTEditor() {
    const { data } = await supabase.from('rpt_targets').select('*').gte('date', getTodayDate()).order('date').limit(60);
    const tbody = document.getElementById('rptTableBody');
    if (!tbody) return;

    if (!data?.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Tiada rekod. Tambah sasaran baharu.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(r => `
        <tr>
          <td class="font-mono" style="font-size:12.5px;">${formatDateMY(r.date)}</td>
          <td><input type="number" class="rpt-input" data-id="${r.id}" value="${r.target_page_total}" min="1" max="604" /></td>
          <td><input type="number" class="rpt-input" data-id="${r.id}-juz" value="${r.juz_reference||''}" min="1" max="30" placeholder="–" style="width:60px;" /></td>
          <td style="font-size:12px;color:var(--s500);">${r.notes||'–'}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-success btn-save-rpt" data-id="${r.id}"><i class="fas fa-floppy-disk"></i></button>
              <button class="btn-sm btn-danger btn-del-rpt" data-id="${r.id}"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>`).join('');

    tbody.querySelectorAll('.btn-save-rpt').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const page = tbody.querySelector(`.rpt-input[data-id="${id}"]`).value;
            const juz = tbody.querySelector(`.rpt-input[data-id="${id}-juz"]`).value;
            const { error } = await supabase.from('rpt_targets').update({ target_page_total: parseInt(page), juz_reference: juz ? parseInt(juz) : null }).eq('id', id);
            if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
            showToast('RPT dikemaskini!', 'success');
        });
    });

    tbody.querySelectorAll('.btn-del-rpt').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Padam sasaran RPT ini?')) return;
            const { error } = await supabase.from('rpt_targets').delete().eq('id', btn.dataset.id);
            if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
            showToast('RPT dipadam.', 'success');
            loadRPTEditor();
        });
    });
}

// ============================================================
// ANNOUNCEMENTS
// ============================================================

async function loadAnnouncements() {
    const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(20);
    const el = document.getElementById('announcementList');
    if (!el) return;

    if (!data?.length) { el.innerHTML = '<div class="empty-msg">Tiada pengumuman lagi.</div>'; return; }

    const roleLabels = { teacher: 'Murabbi', parent: 'Wali', student: 'Pelajar' };
    el.innerHTML = data.map(a => `
        <div style="padding:14px 0;border-bottom:1px solid var(--s100);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
            <div style="flex:1;">
              <div style="font-size:14px;font-weight:700;color:var(--s800);margin-bottom:4px;">${a.title}</div>
              <div style="font-size:13px;color:var(--s600);line-height:1.5;">${a.body}</div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <span class="tag">${a.target_role ? roleLabels[a.target_role] : 'Semua'}</span>
                <span style="font-size:11px;color:var(--s400);">${formatDateMY(a.created_at)}</span>
                ${a.is_active ? '<span class="badge badge-g"><i class="fas fa-circle" style="font-size:7px;"></i> Aktif</span>' : '<span class="badge badge-r">Tidak aktif</span>'}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button class="btn-sm btn-danger" onclick="deleteAnnouncement(${a.id})"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>`).join('');
}

async function deleteAnnouncement(id) {
    if (!confirm('Padam pengumuman ini?')) return;
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pengumuman dipadam.', 'success');
    loadAnnouncements();
}

// ============================================================
// BATCH CSV UPLOAD
// ============================================================

function initBatchUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('csvFile');

    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleCSVFile(file);
    });
    fileInput?.addEventListener('change', e => {
        if (e.target.files[0]) handleCSVFile(e.target.files[0]);
    });
}

function handleCSVFile(file) {
    if (!file.name.endsWith('.csv')) { showToast('Sila pilih fail .csv sahaja.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = e => parseCSV(e.target.result);
    reader.readAsText(file, 'UTF-8');
}

function parseCSV(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) { showToast('Fail CSV kosong atau tiada data.', 'error'); return; }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const obj = {};
        headers.forEach((h, idx) => obj[h] = cols[idx] || '');
        if (obj.full_name) rows.push(obj);
    }

    csvParsedRows = rows;
    document.getElementById('csvRowCount').textContent = `${rows.length} pelajar dijumpai dalam fail`;
    document.getElementById('csvPreview').classList.remove('hidden');
    document.getElementById('batchResult').classList.add('hidden');

    const wrap = document.getElementById('previewTableWrap');
    wrap.innerHTML = `
        <table>
          <thead><tr><th>#</th><th>Nama</th><th>Matrik</th><th>Halaqah</th><th>Emel Wali</th></tr></thead>
          <tbody>${rows.slice(0, 10).map((r, i) => `
            <tr>
              <td>${i+1}</td>
              <td>${r.full_name || '–'}</td>
              <td>${r.matric_no || '–'}</td>
              <td>${r.halaqah_name || '–'}</td>
              <td>${r.parent_email || '–'}</td>
            </tr>`).join('')}
          ${rows.length > 10 ? `<tr><td colspan="5" style="text-align:center;color:var(--s400);font-size:11px;">...dan ${rows.length-10} lagi</td></tr>` : ''}
          </tbody>
        </table>`;
}

function clearCSV() {
    csvParsedRows = [];
    document.getElementById('csvPreview').classList.add('hidden');
    document.getElementById('batchResult').classList.add('hidden');
    document.getElementById('csvFile').value = '';
}

async function importCSV() {
    if (!csvParsedRows.length) return;
    const btn = document.getElementById('importBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengimport...';

    // Build lookup maps
    const halaqahMap = {};
    allHalaqahs.forEach(h => { halaqahMap[h.name.toLowerCase()] = h.id; });

    const { data: parentProfiles } = await supabase.from('profiles').select('id, email').eq('role', 'parent');
    const parentMap = {};
    (parentProfiles || []).forEach(p => { if (p.email) parentMap[p.email.toLowerCase()] = p.id; });

    let success = 0, failed = 0, errors = [];

    for (const row of csvParsedRows) {
        if (!row.full_name) continue;
        const halaqahId = halaqahMap[(row.halaqah_name||'').toLowerCase()] || null;
        const parentId = parentMap[(row.parent_email||'').toLowerCase()] || null;

        if (row.halaqah_name && !halaqahId) {
            errors.push(`"${row.full_name}": Halaqah "${row.halaqah_name}" tidak dijumpai`);
            failed++; continue;
        }

        const { error } = await supabase.from('students').insert({
            full_name: row.full_name,
            matric_no: row.matric_no || null,
            halaqah_id: halaqahId,
            parent_id: parentId,
            current_page: parseInt(row.current_page) || 1,
            current_juz: parseInt(row.current_juz) || 1,
        });

        if (error) {
            errors.push(`"${row.full_name}": ${error.message}`);
            failed++;
        } else {
            success++;
        }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-upload"></i> Import Sekarang';

    const resultEl = document.getElementById('batchResult');
    resultEl.classList.remove('hidden');

    if (failed === 0) {
        resultEl.className = 'batch-result batch-ok';
        resultEl.innerHTML = `<i class="fas fa-circle-check"></i> ${success} pelajar berjaya diimport!`;
    } else {
        resultEl.className = 'batch-result batch-err';
        resultEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${success} berjaya, ${failed} gagal.<br><small>${errors.slice(0,3).join('<br>')}</small>`;
    }

    if (success > 0) {
        allStudents = [];
        showToast(`${success} pelajar berjaya diimport!`, 'success');
    }
}

function downloadCSVTemplate(e) {
    e.preventDefault();
    const csv = 'full_name,matric_no,halaqah_name,parent_email,current_page,current_juz\nAhmad Faris,MT2025001,Halaqah Al-Baqarah,abu@email.com,1,1\nSiti Aisyah,MT2025002,Halaqah Al-Fatihah,ali@email.com,20,1';
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'template-pelajar.csv';
    a.click();
}

// ============================================================
// FORMS
// ============================================================

function bindForms() {
    document.getElementById('formTeacher')?.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            await adminCreateUser(
                document.getElementById('teacherName').value.trim(),
                document.getElementById('teacherEmail').value.trim(),
                document.getElementById('teacherPass').value, 'teacher');
            showToast('Murabbi berjaya didaftarkan!', 'success');
            e.target.reset();
            await loadDropdownData();
        } catch (err) { showToast('Ralat: ' + err.message, 'error'); }
        finally { btn.disabled = false; }
    });

    document.getElementById('formParent')?.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            await adminCreateUser(
                document.getElementById('parentName').value.trim(),
                document.getElementById('parentEmail').value.trim(),
                document.getElementById('parentPass').value, 'parent');
            showToast('Wali berjaya didaftarkan!', 'success');
            e.target.reset();
            await loadDropdownData();
        } catch (err) { showToast('Ralat: ' + err.message, 'error'); }
        finally { btn.disabled = false; }
    });

    document.getElementById('formHalaqah')?.addEventListener('submit', async e => {
        e.preventDefault();
        const { error } = await supabase.from('halaqahs').insert({
            name: document.getElementById('halaqahName').value.trim(),
            teacher_id: document.getElementById('halaqahTeacher').value || null,
            room: document.getElementById('halaqahRoom').value.trim() || null,
            session_time: document.getElementById('halaqahTime').value.trim() || null,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Halaqah berjaya ditambah!', 'success');
        e.target.reset();
        await loadDropdownData();
    });

    document.getElementById('formStudent')?.addEventListener('submit', async e => {
        e.preventDefault();
        const { error } = await supabase.from('students').insert({
            full_name: document.getElementById('studentName').value.trim(),
            matric_no: document.getElementById('studentMatric').value.trim() || null,
            halaqah_id: document.getElementById('studentHalaqah').value ? parseInt(document.getElementById('studentHalaqah').value) : null,
            parent_id: document.getElementById('studentParent').value || null,
            current_page: parseInt(document.getElementById('studentPage').value) || 1,
            current_juz: 1,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Pelajar berjaya didaftarkan!', 'success');
        e.target.reset();
        document.getElementById('studentPage').value = 1;
        allStudents = [];
    });

    document.getElementById('formAddRPT')?.addEventListener('submit', async e => {
        e.preventDefault();
        const { error } = await supabase.from('rpt_targets').upsert({
            date: document.getElementById('rptDate').value,
            target_page_total: parseInt(document.getElementById('rptPage').value),
            juz_reference: document.getElementById('rptJuz').value ? parseInt(document.getElementById('rptJuz').value) : null,
            notes: document.getElementById('rptNote').value.trim() || null,
            created_by: AppState.profile.id,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Sasaran RPT disimpan!', 'success');
        e.target.reset();
        document.getElementById('rptDate').value = getTodayDate();
        loadRPTEditor();
    });

    document.getElementById('formAnnouncement')?.addEventListener('submit', async e => {
        e.preventDefault();
        const role = document.getElementById('annRole').value;
        const { error } = await supabase.from('announcements').insert({
            title: document.getElementById('annTitle').value.trim(),
            body: document.getElementById('annBody').value.trim(),
            target_role: role || null,
            created_by: AppState.profile.id,
            is_active: true,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Pengumuman dihantar!', 'success');
        e.target.reset();
        loadAnnouncements();
    });

    // Search & filter for students table
    document.getElementById('studentSearch')?.addEventListener('input', applyStudentFilters);
    document.getElementById('halaqahFilter')?.addEventListener('change', applyStudentFilters);
    document.getElementById('statusFilter')?.addEventListener('change', applyStudentFilters);

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    // Init CSV upload
    initBatchUpload();
}

function applyStudentFilters() {
    const q = document.getElementById('studentSearch')?.value.toLowerCase() || '';
    const h = document.getElementById('halaqahFilter')?.value || '';
    const s = document.getElementById('statusFilter')?.value || '';
    renderStudentTable(q, h, s);
}

// ============================================================
// MODAL HELPERS
// ============================================================

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// Close modals on backdrop click
document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-ov')) closeModal(e.target.id);
});

// ============================================================
// TOAST
// ============================================================

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = `<i class="fas ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${msg}`;
    t.className = `toast show toast-${type}`;
    setTimeout(() => t.classList.remove('show'), 3500);
}

// ============================================================
// EXPORTS
// ============================================================
window.switchTab = switchTab;
window.showToast = showToast;
window.openModal = openModal;
window.closeModal = closeModal;
window.openHalaqahModal = openHalaqahModal;
window.submitHalaqahModal = submitHalaqahModal;
window.deleteHalaqah = deleteHalaqah;
window.openEditStudentModal = openEditStudentModal;
window.submitEditStudent = submitEditStudent;
window.deleteStudent = deleteStudent;
window.removeUser = removeUser;
window.filterParentTable = filterParentTable;
window.exportStudentsCSV = exportStudentsCSV;
window.importCSV = importCSV;
window.clearCSV = clearCSV;
window.downloadCSVTemplate = downloadCSVTemplate;
window.deleteAnnouncement = deleteAnnouncement;
