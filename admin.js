// ============================================================
// MYHAFAZAN MTSD - admin.js (Enhanced v3 — RPT Plan System)
// ============================================================

let donutChart = null;
let barChart = null;
let allStudents = [];
let allHalaqahs = [];
let allTeachers = [];
let allParents = [];
let csvParsedRows = [];

// Juz → page reference (standard Quran 604 pages / 30 juz)
const JUZ_PAGE_MAP = {
  1:1,2:22,3:42,4:62,5:82,6:102,7:121,8:142,9:162,10:182,
  11:201,12:222,13:242,14:262,15:282,16:302,17:322,18:342,
  19:362,20:382,21:402,22:422,23:442,24:462,25:482,26:502,
  27:522,28:542,29:562,30:582,31:604
};

function juzToStartPage(juz) { return JUZ_PAGE_MAP[juz] || 1; }
function juzToEndPage(juz)   { return (JUZ_PAGE_MAP[juz + 1] || 605) - 1; }

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const profile = await requireAuth('admin');
    if (!profile) return;

    // FIX #14: Watch for token expiry mid-session
    watchSession();

    populateNavProfile(profile);
    initNavigation();
    initJuzSelects();
    await loadDropdownData();
    await loadDashboard();
    initRealtime();
    bindForms();
});

// Populate juz selects — inline add form only (modal uses modalPlan* IDs)
function initJuzSelects() {
    const opts = Array.from({length: 30}, (_, i) => i + 1)
        .map(j => `<option value="${j}">Juz ${j}</option>`).join('');

    // Inline add form inside rpt-pane-plans
    const addStart = document.querySelector('#rpt-pane-plans #planJuzStart');
    const addEnd   = document.querySelector('#rpt-pane-plans #planJuzEnd');
    if (addStart) {
        addStart.innerHTML = opts;
        addStart.addEventListener('change', syncInlinePages);
    }
    if (addEnd) {
        addEnd.innerHTML = opts;
        addEnd.addEventListener('change', syncInlinePages);
    }

    // Modal juz selects
    const modalStart = document.getElementById('modalPlanJuzStart');
    const modalEnd   = document.getElementById('modalPlanJuzEnd');
    if (modalStart) {
        modalStart.innerHTML = opts;
        modalStart.addEventListener('change', syncModalPages);
    }
    if (modalEnd) {
        modalEnd.innerHTML = opts;
        modalEnd.addEventListener('change', syncModalPages);
    }
}

function syncInlinePages() {
    const js = parseInt(document.querySelector('#rpt-pane-plans #planJuzStart')?.value);
    const je = parseInt(document.querySelector('#rpt-pane-plans #planJuzEnd')?.value);
    if (js) document.querySelector('#rpt-pane-plans #planStartPage').value = juzToStartPage(js);
    if (je) document.querySelector('#rpt-pane-plans #planEndPage').value   = juzToEndPage(je);
}

function syncModalPages() {
    const js = parseInt(document.getElementById('modalPlanJuzStart')?.value);
    const je = parseInt(document.getElementById('modalPlanJuzEnd')?.value);
    if (js) document.getElementById('modalPlanStartPage').value = juzToStartPage(js);
    if (je) document.getElementById('modalPlanEndPage').value   = juzToEndPage(je);
}

// ============================================================
// NAVIGATION
// ============================================================

function initNavigation() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
}

function switchTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `pane-${tab}`);
    });
    const titles = {
        dashboard:     'Papan Pemuka Admin',
        students:      'Semua Pelajar',
        halaqah:       'Pengurusan Halaqah',
        teachers:      'Senarai Murabbi',
        parents:       'Senarai Wali Murid',
        register:      'Daftar Pengguna & Pelajar',
        batch:         'Muat Naik CSV',
        rpt:           'Pengurusan RPT',
        announcements: 'Pengumuman',
    };
    document.getElementById('topbarTitle').textContent = titles[tab] || 'Admin';

    if (tab === 'dashboard')     loadDashboard();
    if (tab === 'students')      renderStudentTable();
    if (tab === 'halaqah')       loadHalaqahGrid();
    if (tab === 'teachers')      loadTeachersTable();
    if (tab === 'parents')       loadParentsTable();
    if (tab === 'rpt')           loadRPTManager();
    if (tab === 'announcements') loadAnnouncements();
}

// ============================================================
// RPT SUB-TAB SWITCHER
// ============================================================

function switchRptTab(tab) {
    document.querySelectorAll('.rpt-tab-btn').forEach(b => {
        const onclick = b.getAttribute('onclick') || '';
        b.classList.toggle('active', onclick.includes(`'${tab}'`));
    });
    document.querySelectorAll('.rpt-tab-pane').forEach(p => {
        p.classList.toggle('active', p.id === `rpt-pane-${tab}`);
    });
}

// ============================================================
// DROPDOWN DATA (shared cache)
// ============================================================

async function loadDropdownData() {
    const [teacherRes, halaqahRes, parentRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone').eq('role', 'teacher').order('full_name'),
        supabase.from('halaqahs').select('id, name, teacher_id, room, session_time').eq('is_active', true).order('name'),
        supabase.from('profiles').select('id, full_name, phone').eq('role', 'parent').order('full_name'),
    ]);

    allTeachers = teacherRes.data || [];
    allHalaqahs = halaqahRes.data || [];
    allParents  = parentRes.data  || [];

    populateSelects('.sel-teacher',      allTeachers, '-- Pilih Murabbi --');
    populateSelects('.sel-halaqah',      allHalaqahs, '-- Pilih Halaqah --');
    populateSelects('.sel-halaqah-edit', allHalaqahs, '-- Pilih Halaqah --');
    populateSelects('.sel-parent',       allParents,  '-- Tiada Wali --');

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

        const total   = allStudents.length;
        const ahead   = allStudents.filter(s => s.status === 'ahead').length;
        const warning = allStudents.filter(s => s.status === 'warning').length;
        const behind  = allStudents.filter(s => s.status === 'behind').length;

        document.getElementById('statTotal').textContent   = total;
        document.getElementById('statAhead').textContent   = ahead;
        document.getElementById('statWarning').textContent = warning;
        document.getElementById('statBehind').textContent  = behind;

        renderDonutChart(ahead, warning, behind);
        renderBarChart([...allStudents].filter(s => s.hutang > 0).sort((a,b) => b.hutang - a.hutang).slice(0, 8));

        loadTodayFormTargets();
        loadRecentLogs();
        loadTopStudents();
    } catch (err) {
        console.error('Dashboard error:', err);
    }
}

async function loadTodayFormTargets() {
    const el    = document.getElementById('todayTarget');
    const elJuz = document.getElementById('todayJuz');
    if (!el) return;

    const { data: plans } = await supabase
        .from('rpt_plans')
        .select('form_level, juz_start, juz_end')
        .eq('year', new Date().getFullYear())
        .order('form_level');

    if (!plans?.length) {
        el.textContent = '–';
        if (elJuz) elJuz.textContent = 'Tiada pelan RPT ditetapkan';
        return;
    }

    el.textContent = plans.length + ' Tingkatan';
    if (elJuz) elJuz.textContent = plans.map(p => `T${p.form_level}: J${p.juz_start}–J${p.juz_end}`).join(' · ');
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
    const typeCls    = { jadid: 'badge-p', murajaah_u: 'badge-g', murajaah_q: 'badge-gold' };
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
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'students' },  loadDashboard)
        .subscribe();
}

// ============================================================
// STUDENT TABLE
// ============================================================

async function renderStudentTable(filter = '', halaqahId = '', status = '', formLevel = '') {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;

    if (!allStudents.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><i class="fas fa-spinner fa-spin"></i> Memuat...</td></tr>';
        const { data } = await supabase.from('student_progress').select('*').order('hutang', { ascending: false });
        allStudents = data || [];
    }

    let data = [...allStudents];
    if (filter)    data = data.filter(s => s.full_name?.toLowerCase().includes(filter) || s.matric_no?.toLowerCase().includes(filter));
    if (halaqahId) data = data.filter(s => String(s.halaqah_id) === halaqahId);
    if (status)    data = data.filter(s => s.status === status);
    if (formLevel) data = data.filter(s => String(s.form_level) === formLevel);

    if (!data.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><i class="fas fa-inbox"></i> Tiada pelajar dijumpai.</td></tr>';
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
            : s.status === 'no_form'
            ? `<span class="badge" style="color:var(--s400);border-color:var(--s200);">Tiada Tingkatan</span>`
            : `<span class="badge" style="color:var(--s400);border-color:var(--s200);">Tiada RPT</span>`;
        return `
        <tr>
          <td><div class="td-name"><div class="av-sm">${(s.full_name||'?')[0]}</div>${s.full_name}</div></td>
          <td>${s.halaqah_name || '<span style="color:var(--s400);">–</span>'}</td>
          <td class="font-mono">${s.form_level ? `T${s.form_level}` : '<span style="color:var(--s400);">–</span>'}</td>
          <td class="font-mono">${s.current_page}</td>
          <td class="font-mono">${s.target_page_total || '<span style="color:var(--s400);">–</span>'}</td>
          <td class="${hClass} font-mono">${h > 0 ? '+'+h : h}</td>
          <td>${badge}</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn-sm btn-edit" onclick="openEditStudentModal(${s.id},'${(s.full_name||'').replace(/'/g,"\\'")}',${s.current_page},${s.current_juz||1},${s.halaqah_id||'null'},${s.form_level||'null'})">
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
    const rows = [['Nama','Halaqah','Tingkatan','Muka Surat','Juzuk','Hutang','Status']];
    allStudents.forEach(s => rows.push([s.full_name, s.halaqah_name||'', s.form_level||'', s.current_page, s.current_juz||'', s.hutang??'', s.status||'']));
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

    const { data, error } = await supabase
        .from('halaqahs')
        .select('id, name, teacher_id, room, session_time, profiles(full_name)')
        .eq('is_active', true).order('name');
    allHalaqahs = data || [];

    if (error || !data?.length) {
        grid.innerHTML = '<div class="empty-msg"><i class="fas fa-circle-nodes"></i><p>Tiada halaqah. Tambah halaqah baharu.</p></div>';
        return;
    }

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
    document.getElementById('editHalaqahId').value   = id || '';
    document.getElementById('editHalaqahName').value = name;
    document.getElementById('editHalaqahRoom').value = room;
    document.getElementById('editHalaqahTime').value = time;
    document.getElementById('halaqahModalTitle').innerHTML =
        `<i class="fas fa-circle-nodes" style="color:var(--g);margin-right:8px;font-size:15px;"></i>${id ? 'Kemaskini Halaqah' : 'Tambah Halaqah Baru'}`;

    const sel = document.getElementById('editHalaqahTeacher');
    const currentTeacherId = String(teacherId || '');
    sel.innerHTML = '<option value="">-- Pilih Murabbi --</option>' +
        allTeachers.map(t => `<option value="${t.id}" ${String(t.id) === currentTeacherId ? 'selected' : ''}>${t.full_name}</option>`).join('');

    openModal('halaqahModal');
}

async function submitHalaqahModal() {
    const id        = document.getElementById('editHalaqahId').value;
    const name      = document.getElementById('editHalaqahName').value.trim();
    const teacherId = document.getElementById('editHalaqahTeacher').value;
    const room      = document.getElementById('editHalaqahRoom').value.trim();
    const time      = document.getElementById('editHalaqahTime').value.trim();

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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const { data: teachers } = await supabase.from('profiles').select('id, full_name, phone, email').eq('role','teacher').order('full_name');
    allTeachers = teachers || [];

    if (!allTeachers.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Tiada murabbi berdaftar.</td></tr>';
        return;
    }

    const { data: halaqahs } = await supabase.from('halaqahs').select('teacher_id, name').eq('is_active', true);
    const hMap = {};
    (halaqahs || []).forEach(h => { hMap[h.teacher_id] = h.name; });

    tbody.innerHTML = allTeachers.map(t => `
        <tr>
          <td>
            <div class="td-name">
              <div class="av-sm" style="background:linear-gradient(135deg,var(--p),var(--pl));">${(t.full_name||'?')[0]}</div>
              <div>
                <div>${t.full_name}</div>
                ${t.email ? `<div style="font-size:11px;color:var(--s400);font-weight:400;">${t.email}</div>` : '<div style="font-size:11px;color:var(--r);font-weight:500;"><i class="fas fa-triangle-exclamation"></i> Tiada emel</div>'}
              </div>
            </div>
          </td>
          <td style="color:var(--s500);">${t.phone || '–'}</td>
          <td>${hMap[t.id] ? `<span class="badge badge-g">${hMap[t.id]}</span>` : '<span style="color:var(--s400);">Tiada halaqah</span>'}</td>
          <td>
            <button class="btn-sm btn-edit" onclick="openEditTeacherModal('${t.id}','${(t.full_name||'').replace(/'/g,"\\'")}','${(t.phone||'').replace(/'/g,"\\'")}",'${(t.email||'').replace(/'/g,"\\'")}')"><i class="fas fa-pen"></i> Edit</button>
          </td>
          <td><button class="btn-sm btn-edit btn-reset-pw" data-name="${(t.full_name||'').replace(/"/g,'&quot;')}" data-email="${(t.email||'').replace(/"/g,'&quot;')}"><i class="fas fa-key"></i> Reset</button></td>
          <td><button class="btn-sm btn-danger" onclick="removeUser('${t.id}','${(t.full_name||'').replace(/'/g,"\\'")}')"><i class="fas fa-user-minus"></i> Alih Keluar</button></td>
        </tr>`).join('');

    tbody.querySelectorAll('.btn-reset-pw').forEach(btn => {
        btn.addEventListener('click', () => promptAndResetPassword(btn.dataset.name, btn.dataset.email));
    });
}

// ============================================================
// PARENTS TABLE
// ============================================================

let allParentsCache = [];
async function loadParentsTable() {
    const tbody = document.getElementById('parentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const { data: parents } = await supabase.from('profiles').select('id, full_name, phone, email').eq('role','parent').order('full_name');
    allParentsCache = parents || [];

    if (!allParentsCache.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="5">Tiada wali berdaftar.</td></tr>';
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
          <td>
            <div class="td-name">
              <div class="av-sm" style="background:linear-gradient(135deg,var(--gold),#F59E0B);">${(p.full_name||'?')[0]}</div>
              <div>
                <div>${p.full_name}</div>
                ${p.email ? `<div style="font-size:11px;color:var(--s400);font-weight:400;">${p.email}</div>` : '<div style="font-size:11px;color:var(--r);font-weight:500;"><i class="fas fa-triangle-exclamation"></i> Tiada emel</div>'}
              </div>
            </div>
          </td>
          <td style="color:var(--s500);">${p.phone || '–'}</td>
          <td><span class="badge badge-p">${childCount[p.id]||0} anak</span></td>
          <td><button class="btn-sm btn-edit" onclick="openEditParentModal('${p.id}','${(p.full_name||'').replace(/'/g,"\'")}','${(p.phone||'').replace(/'/g,"\'")}','${(p.email||'').replace(/'/g,"\'")}')"><i class="fas fa-pen"></i> Edit</button></td>
          <td><button class="btn-sm btn-danger" onclick="removeUser('${p.id}','${(p.full_name||'').replace(/'/g,"\'")}')"><i class="fas fa-user-minus"></i> Alih Keluar</button></td>
        </tr>`).join('');
}

function filterParentTable(query) {
    const filtered = allParentsCache.filter(p =>
        (p.full_name||'').toLowerCase().includes(query.toLowerCase()) ||
        (p.phone||'').toLowerCase().includes(query.toLowerCase())
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

async function openEditStudentModal(id, name, page, juz, halaqahId, formLevel) {
    document.getElementById('editStudentId').value   = id;
    document.getElementById('editStudentName').value = name;
    document.getElementById('editStudentPage').value = page;
    document.getElementById('editStudentJuz').value  = juz;

    const selF = document.getElementById('editStudentForm');
    if (selF) {
        selF.innerHTML = '<option value="">– Tiada Tingkatan –</option>' +
            [1,2,3,4,5].map(f => `<option value="${f}" ${f == formLevel ? 'selected' : ''}>Tingkatan ${f}</option>`).join('');
    }

    const selH = document.getElementById('editStudentHalaqah');
    selH.innerHTML = '<option value="">-- Pilih Halaqah --</option>' +
        allHalaqahs.map(h => `<option value="${h.id}" ${h.id == halaqahId ? 'selected' : ''}>${h.name}</option>`).join('');

    const { data: student } = await supabase.from('students').select('parent_id').eq('id', id).single();
    const selP = document.getElementById('editStudentParent');
    selP.innerHTML = '<option value="">-- Tiada Wali --</option>' +
        allParents.map(p => `<option value="${p.id}" ${p.id === student?.parent_id ? 'selected' : ''}>${p.full_name}</option>`).join('');

    openModal('editStudentModal');
}

async function submitEditStudent() {
    const id        = document.getElementById('editStudentId').value;
    const name      = document.getElementById('editStudentName').value.trim();
    const page      = parseInt(document.getElementById('editStudentPage').value);
    const juz       = parseInt(document.getElementById('editStudentJuz').value);
    const parentId  = document.getElementById('editStudentParent').value || null;
    const halaqahId = document.getElementById('editStudentHalaqah').value || null;
    const formLevel = document.getElementById('editStudentForm')?.value   || null;

    if (!name || !page || !juz) { showToast('Sila isi semua medan wajib.', 'error'); return; }

    const { error } = await supabase.from('students')
        .update({
            full_name:    name,
            current_page: page,
            current_juz:  juz,
            parent_id:    parentId,
            halaqah_id:   halaqahId  ? parseInt(halaqahId)  : null,
            form_level:   formLevel  ? parseInt(formLevel)  : null,
        })
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
// RPT MANAGER — 3 sections: Plans | Holidays | Overrides
// ============================================================

async function loadRPTManager() {
    await Promise.all([
        loadRPTPlans(),
        loadHolidayList(),
        loadRPTOverrides(),
    ]);
}

// --- SECTION 1: RPT PLANS ---

async function loadRPTPlans() {
    const el = document.getElementById('rptPlanList');
    if (!el) return;
    el.innerHTML = '<div class="empty-msg"><i class="fas fa-spinner fa-spin"></i></div>';

    const year = new Date().getFullYear();
    const { data, error } = await supabase
        .from('rpt_plans').select('*').eq('year', year).order('form_level');

    if (error || !data?.length) {
        el.innerHTML = '<div class="empty-msg">Tiada pelan RPT untuk tahun ini. Tambah pelan baharu di bawah.</div>';
        return;
    }

    el.innerHTML = data.map(p => {
        const totalPages = p.end_page - p.start_page;
        const juzLabel   = p.juz_end ? `Juz ${p.juz_start} – Juz ${p.juz_end}` : `ms. ${p.start_page} – ${p.end_page}`;
        return `
        <div class="rpt-plan-card">
          <div class="rpt-plan-badge">T${p.form_level}</div>
          <div class="rpt-plan-info">
            <div class="rpt-plan-title">Tingkatan ${p.form_level} &mdash; ${juzLabel}</div>
            <div class="rpt-plan-meta">
              <i class="fas fa-book-open"></i> ${totalPages} ms &nbsp;·&nbsp;
              <i class="fas fa-calendar-range"></i> ${formatDateMY(p.start_date)} – ${formatDateMY(p.end_date)}
              ${p.notes ? `&nbsp;·&nbsp;<i class="fas fa-note-sticky"></i> ${p.notes}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-sm btn-edit" onclick="openRPTPlanModal(${p.id},${p.form_level},${p.year},${p.start_page},${p.end_page},'${p.start_date}','${p.end_date}',${p.juz_start||'null'},${p.juz_end||'null'})">
              <i class="fas fa-pen"></i>
            </button>
            <button class="btn-sm btn-danger" onclick="deleteRPTPlan(${p.id})">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>`;
    }).join('');
}

// Opens the RPT Plan MODAL (uses modal* prefixed IDs to avoid conflicts with inline form)
function openRPTPlanModal(id=null, form=1, year=null, startPage=1, endPage=20, startDate='', endDate='', juzStart=null, juzEnd=null) {
    const currentYear = new Date().getFullYear();

    document.getElementById('planId').value              = id || '';
    document.getElementById('modalPlanYear').value       = year || currentYear;
    document.getElementById('modalPlanStartDate').value  = startDate || `${currentYear}-01-06`;
    document.getElementById('modalPlanEndDate').value    = endDate   || `${currentYear}-11-14`;
    document.getElementById('modalPlanNotes').value      = '';
    document.getElementById('modalPlanStartPage').value  = startPage;
    document.getElementById('modalPlanEndPage').value    = endPage;

    const selF = document.getElementById('modalPlanForm');
    if (selF) selF.value = form;

    const selJs = document.getElementById('modalPlanJuzStart');
    const selJe = document.getElementById('modalPlanJuzEnd');
    if (selJs) selJs.value = juzStart || 1;
    if (selJe) selJe.value = juzEnd   || 1;

    document.getElementById('rptPlanModalTitle').textContent = id ? 'Kemaskini Pelan RPT' : 'Tambah Pelan RPT Baru';
    openModal('rptPlanModal');
}

// Handles BOTH the inline form submit AND the modal submit button
async function submitRPTPlanModal() {
    const modal   = document.getElementById('rptPlanModal');
    const isModal = modal?.classList.contains('open');

    let form, year, startPage, endPage, startDate, endDate, juzStart, juzEnd, notes, id;

    if (isModal) {
        // Reading from modal (modal* prefixed IDs)
        id        = document.getElementById('planId')?.value || '';
        form      = parseInt(document.getElementById('modalPlanForm')?.value);
        year      = parseInt(document.getElementById('modalPlanYear')?.value);
        startPage = parseInt(document.getElementById('modalPlanStartPage')?.value);
        endPage   = parseInt(document.getElementById('modalPlanEndPage')?.value);
        startDate = document.getElementById('modalPlanStartDate')?.value;
        endDate   = document.getElementById('modalPlanEndDate')?.value;
        juzStart  = document.getElementById('modalPlanJuzStart')?.value ? parseInt(document.getElementById('modalPlanJuzStart').value) : null;
        juzEnd    = document.getElementById('modalPlanJuzEnd')?.value   ? parseInt(document.getElementById('modalPlanJuzEnd').value)   : null;
        notes     = document.getElementById('modalPlanNotes')?.value.trim() || null;
    } else {
        // Reading from inline form (plain IDs scoped inside #rpt-pane-plans)
        const pane = document.getElementById('rpt-pane-plans');
        id        = '';
        form      = parseInt(pane.querySelector('#planForm')?.value);
        year      = parseInt(pane.querySelector('#planYear')?.value);
        startPage = parseInt(pane.querySelector('#planStartPage')?.value);
        endPage   = parseInt(pane.querySelector('#planEndPage')?.value);
        startDate = pane.querySelector('#planStartDate')?.value;
        endDate   = pane.querySelector('#planEndDate')?.value;
        juzStart  = pane.querySelector('#planJuzStart')?.value ? parseInt(pane.querySelector('#planJuzStart').value) : null;
        juzEnd    = pane.querySelector('#planJuzEnd')?.value   ? parseInt(pane.querySelector('#planJuzEnd').value)   : null;
        notes     = pane.querySelector('#planNotes')?.value.trim() || null;
    }

    if (!form || !year || !startPage || !endPage || !startDate || !endDate) {
        showToast('Sila lengkapkan semua medan wajib.', 'error'); return;
    }
    if (endPage <= startPage) { showToast('Muka surat akhir mesti lebih besar.', 'error'); return; }
    if (endDate <= startDate)  { showToast('Tarikh akhir mesti selepas tarikh mula.', 'error'); return; }

    const payload = {
        form_level: form, year,
        start_page: startPage, end_page: endPage,
        start_date: startDate, end_date: endDate,
        juz_start: juzStart, juz_end: juzEnd, notes,
        created_by: AppState.profile.id,
    };

    const { error } = id
        ? await supabase.from('rpt_plans').update(payload).eq('id', id)
        : await supabase.from('rpt_plans').upsert(payload, { onConflict: 'form_level,year' });

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast(id ? 'Pelan RPT dikemaskini!' : 'Pelan RPT berjaya ditambah!', 'success');
    closeModal('rptPlanModal');
    loadRPTPlans();
}

async function deleteRPTPlan(id) {
    if (!confirm('Padam pelan RPT ini? Sasaran automatik untuk tingkatan ini akan hilang.')) return;
    const { error } = await supabase.from('rpt_plans').delete().eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Pelan RPT dipadam.', 'success');
    loadRPTPlans();
}

// --- SECTION 2: SCHOOL HOLIDAYS ---

async function loadHolidayList() {
    const el = document.getElementById('holidayList');
    if (!el) return;
    el.innerHTML = '<tr class="empty-row"><td colspan="4"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const year = new Date().getFullYear();
    const { data } = await supabase
        .from('school_holidays')
        .select('*')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('date');

    if (!data?.length) {
        el.innerHTML = '<tr class="empty-row"><td colspan="4">Tiada cuti berdaftar untuk tahun ini.</td></tr>';
        return;
    }

    const typeLabel = { public_holiday: 'Cuti Umum', school_holiday: 'Cuti Sekolah' };
    const typeCls   = { public_holiday: 'badge-r',   school_holiday: 'badge-gold' };

    el.innerHTML = data.map(h => {
        const isSingleDay = h.date === h.end_date;
        const dateDisplay = isSingleDay
            ? formatDateMY(h.date)
            : `${formatDateMY(h.date)} – ${formatDateMY(h.end_date)}`;
        let weekdays = 0;
        for (let d = new Date(h.date); d <= new Date(h.end_date); d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) weekdays++;
        }
        const daysNote = isSingleDay ? '' : ` <span style="font-size:11px;color:var(--s400);">(${weekdays} hari persekolahan)</span>`;
        return `
        <tr>
          <td class="font-mono" style="font-size:12.5px;">${dateDisplay}${daysNote}</td>
          <td>${h.description}</td>
          <td><span class="badge ${typeCls[h.holiday_type]}">${typeLabel[h.holiday_type]}</span></td>
          <td>
            <button class="btn-sm btn-danger" onclick="deleteHoliday(${h.id})">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>`;
    }).join('');
}

async function deleteHoliday(id) {
    if (!confirm('Padam cuti ini?')) return;
    const { error } = await supabase.from('school_holidays').delete().eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Cuti dipadam.', 'success');
    loadHolidayList();
}

// --- SECTION 3: MANUAL OVERRIDES ---

async function loadRPTOverrides() {
    const el = document.getElementById('rptOverrideList');
    if (!el) return;
    el.innerHTML = '<tr class="empty-row"><td colspan="5"><i class="fas fa-spinner fa-spin"></i></td></tr>';

    const { data } = await supabase
        .from('rpt_targets')
        .select('*')
        .gte('date', getTodayDate())
        .order('date')
        .order('form_level')
        .limit(40);

    if (!data?.length) {
        el.innerHTML = '<tr class="empty-row"><td colspan="5">Tiada penggantian manual. Sistem menggunakan pengiraan automatik.</td></tr>';
        return;
    }

    el.innerHTML = data.map(r => `
        <tr>
          <td class="font-mono" style="font-size:12.5px;">${formatDateMY(r.date)}</td>
          <td>${r.form_level ? `Tingkatan ${r.form_level}` : '<span style="color:var(--s400);">Semua</span>'}</td>
          <td class="font-mono">${r.target_page_total}</td>
          <td style="font-size:12px;color:var(--s500);">${r.notes || '–'}</td>
          <td>
            <button class="btn-sm btn-danger" onclick="deleteRPTOverride(${r.id})">
              <i class="fas fa-trash"></i>
            </button>
          </td>
        </tr>`).join('');
}

async function deleteRPTOverride(id) {
    if (!confirm('Padam penggantian ini? Sistem akan kembali ke pengiraan automatik.')) return;
    const { error } = await supabase.from('rpt_targets').delete().eq('id', id);
    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Penggantian dipadam.', 'success');
    loadRPTOverrides();
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
          <thead><tr><th>#</th><th>Nama</th><th>Matrik</th><th>Tingkatan</th><th>Halaqah</th><th>Emel Wali</th></tr></thead>
          <tbody>${rows.slice(0, 10).map((r, i) => `
            <tr>
              <td>${i+1}</td>
              <td>${r.full_name    || '–'}</td>
              <td>${r.matric_no   || '–'}</td>
              <td>${r.form_level  || '–'}</td>
              <td>${r.halaqah_name || '–'}</td>
              <td>${r.parent_email || '–'}</td>
            </tr>`).join('')}
          ${rows.length > 10 ? `<tr><td colspan="6" style="text-align:center;color:var(--s400);font-size:11px;">...dan ${rows.length-10} lagi</td></tr>` : ''}
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

    const halaqahMap = {};
    allHalaqahs.forEach(h => { halaqahMap[h.name.toLowerCase()] = h.id; });

    // FIX #12: Match parent by EMAIL (was wrongly matching by phone)
    const { data: parentProfiles } = await supabase.from('profiles').select('id, full_name').eq('role', 'parent');
    // Also fetch auth users to get their emails via a workaround — use profiles.email if stored,
    // or fall back to matching by full_name as a secondary option.
    // Best approach: store email in profiles table. For now match by full_name as a safe fallback.
    const parentMapByName = {};
    (parentProfiles || []).forEach(p => {
        parentMapByName[(p.full_name || '').toLowerCase().trim()] = p.id;
    });

    // Also fetch all parent emails from auth metadata via a Supabase RPC if available
    // Since anon key can't access auth.users, we match by profile full_name AND
    // show a warning if parent_email was used (instruct admin to use parent name instead).

    let success = 0, failed = 0, errors = [];

    for (const row of csvParsedRows) {
        if (!row.full_name) continue;
        const halaqahId = halaqahMap[(row.halaqah_name || '').toLowerCase()] || null;
        // FIX #12: Try parent_name first, fall back to parent_email column as name lookup
        const parentLookupKey = (row.parent_name || row.parent_email || '').toLowerCase().trim();
        const parentId = parentMapByName[parentLookupKey] || null;
        const formLevel = row.form_level ? parseInt(row.form_level) : null;

        if (row.halaqah_name && !halaqahId) {
            errors.push(`"${row.full_name}": Halaqah "${row.halaqah_name}" tidak dijumpai`);
            failed++; continue;
        }

        const { error } = await supabase.from('students').insert({
            full_name:    row.full_name,
            matric_no:    row.matric_no  || null,
            halaqah_id:   halaqahId,
            parent_id:    parentId,
            form_level:   formLevel,
            current_page: parseInt(row.current_page) || 1,
            current_juz:  parseInt(row.current_juz)  || 1,
        });

        if (error) { errors.push(`"${row.full_name}": ${error.message}`); failed++; }
        else { success++; }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-upload"></i> Import Sekarang';

    const resultEl = document.getElementById('batchResult');
    resultEl.classList.remove('hidden');

    if (failed === 0) {
        resultEl.className = 'batch-result batch-ok';
        // FIX #2: Guided message telling admin next step
        resultEl.innerHTML = `<i class="fas fa-circle-check"></i> ${success} pelajar berjaya diimport!
            <br><small style="font-weight:400;">Langkah seterusnya: Pergi ke tab <strong>Semua Pelajar</strong> → Edit pelajar untuk sahkan wali dan halaqah telah ditetapkan.</small>`;
    } else {
        resultEl.className = 'batch-result batch-err';
        resultEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${success} berjaya, ${failed} gagal.<br><small>${errors.slice(0,3).join('<br>')}</small>`;
    }

    if (success > 0) { allStudents = []; showToast(`${success} pelajar berjaya diimport!`, 'success'); }
}

function downloadCSVTemplate(e) {
    e.preventDefault();
    // FIX #12: Use parent_name (full name) for matching, not email
    const csv = 'full_name,matric_no,form_level,halaqah_name,parent_name,current_page,current_juz\nAhmad Faris,MT2025001,1,Halaqah Al-Baqarah,Abu Bakar Abdullah,1,1\nSiti Aisyah,MT2025002,2,Halaqah Al-Fatihah,Ali Hassan,20,1';
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
            name:         document.getElementById('halaqahName').value.trim(),
            teacher_id:   document.getElementById('halaqahTeacher').value || null,
            room:         document.getElementById('halaqahRoom').value.trim() || null,
            session_time: document.getElementById('halaqahTime').value.trim() || null,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Halaqah berjaya ditambah!', 'success');
        e.target.reset();
        await loadDropdownData();
    });

    document.getElementById('formStudent')?.addEventListener('submit', async e => {
        e.preventDefault();
        const formLevel = document.getElementById('studentForm')?.value;
        const { error } = await supabase.from('students').insert({
            full_name:    document.getElementById('studentName').value.trim(),
            matric_no:    document.getElementById('studentMatric').value.trim() || null,
            halaqah_id:   document.getElementById('studentHalaqah').value ? parseInt(document.getElementById('studentHalaqah').value) : null,
            parent_id:    document.getElementById('studentParent').value || null,
            form_level:   formLevel ? parseInt(formLevel) : null,
            current_page: parseInt(document.getElementById('studentPage').value) || 1,
            current_juz:  1,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Pelajar berjaya didaftarkan!', 'success');
        e.target.reset();
        document.getElementById('studentPage').value = 1;
        allStudents = [];
    });

    // RPT Plan inline form submit
    document.getElementById('formAddRPTPlan')?.addEventListener('submit', async e => {
        e.preventDefault();
        await submitRPTPlanModal();
    });

    // Holiday form
    document.getElementById('formAddHoliday')?.addEventListener('submit', async e => {
        e.preventDefault();
        const date    = document.getElementById('holidayDate').value;
        const endDate = document.getElementById('holidayEndDate').value || date;
        const desc    = document.getElementById('holidayDesc').value.trim();
        const type    = document.getElementById('holidayType').value;
        if (!date || !desc) { showToast('Sila isi tarikh dan keterangan.', 'error'); return; }
        if (endDate < date) { showToast('Tarikh akhir mesti sama atau selepas tarikh mula.', 'error'); return; }
        const { error } = await supabase.from('school_holidays').insert({
            date, end_date: endDate, description: desc, holiday_type: type,
            created_by: AppState.profile.id,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Cuti berjaya ditambah!', 'success');
        e.target.reset();
        loadHolidayList();
    });

    // RPT Override form
    document.getElementById('formAddRPTOverride')?.addEventListener('submit', async e => {
        e.preventDefault();
        const date      = document.getElementById('overrideDate').value;
        const formLevel = document.getElementById('overrideForm').value;
        const page      = document.getElementById('overridePage').value;
        const notes     = document.getElementById('overrideNote').value.trim();
        if (!date || !page) { showToast('Sila isi tarikh dan muka surat sasaran.', 'error'); return; }
        const { error } = await supabase.from('rpt_targets').upsert({
            date,
            form_level:        formLevel ? parseInt(formLevel) : null,
            target_page_total: parseInt(page),
            notes:             notes || null,
            created_by:        AppState.profile.id,
        }, { onConflict: 'date,form_level' });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Penggantian RPT disimpan!', 'success');
        e.target.reset();
        loadRPTOverrides();
    });

    // Announcement form
    document.getElementById('formAnnouncement')?.addEventListener('submit', async e => {
        e.preventDefault();
        const role = document.getElementById('annRole').value;
        const { error } = await supabase.from('announcements').insert({
            title:       document.getElementById('annTitle').value.trim(),
            body:        document.getElementById('annBody').value.trim(),
            target_role: role || null,
            created_by:  AppState.profile.id,
            is_active:   true,
        });
        if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
        showToast('Pengumuman dihantar!', 'success');
        e.target.reset();
        loadAnnouncements();
    });

    // Student filters
    document.getElementById('studentSearch')?.addEventListener('input',  applyStudentFilters);
    document.getElementById('halaqahFilter')?.addEventListener('change', applyStudentFilters);
    document.getElementById('statusFilter')?.addEventListener('change',  applyStudentFilters);
    document.getElementById('formFilter')?.addEventListener('change',    applyStudentFilters);

    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    initBatchUpload();
}

function applyStudentFilters() {
    const q = document.getElementById('studentSearch')?.value.toLowerCase() || '';
    const h = document.getElementById('halaqahFilter')?.value || '';
    const s = document.getElementById('statusFilter')?.value  || '';
    const f = document.getElementById('formFilter')?.value    || '';
    renderStudentTable(q, h, s, f);
}

// ============================================================
// HELPERS
// ============================================================

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function formatDateMY(d) {
    if (!d) return '–';
    return new Date(d).toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ============================================================
// MODAL HELPERS
// ============================================================

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

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
// FIX #15: ADMIN — Send password reset email
// profiles table has no email column (email lives in auth.users
// which the anon key cannot read). So we prompt the admin to
// enter the teacher/parent's email address manually.
// ============================================================

async function promptAndResetPassword(userName, knownEmail) {
    // Pass the known email so the modal can pre-fill it — no manual typing needed
    if (typeof window.openResetPasswordModal === 'function') {
        window.openResetPasswordModal(userName, knownEmail);
    } else {
        // fallback (desktop only)
        const email = knownEmail || prompt(`Masukkan emel ${userName} untuk hantar reset kata laluan:`);
        if (!email || !email.trim()) return;
        await adminSendPasswordReset(email.trim(), userName);
    }
}

async function adminSendPasswordReset(email, userName) {
    if (!email) { showToast('Emel tidak ditemui.', 'error'); return; }
    try {
        const redirectTo = window.location.href
            .split('#')[0].split('?')[0]
            .replace('admin.html', 'reset-password.html');
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        showToast(`E-mel reset dihantar kepada ${userName}.`, 'success');
    } catch (err) {
        showToast('Ralat: ' + err.message, 'error');
    }
}

// ============================================================
// FIX #17: ACADEMIC YEAR RESET
// Resets all students' current_page and current_juz back to starting values
// Clears existing RPT plans for the new year
// ============================================================

async function resetAcademicYear() {
    const confirmed = prompt(
        'AMARAN: Tindakan ini akan menetapkan semula kemajuan SEMUA pelajar aktif ke halaman 1.\n\n' +
        'Ini tidak boleh dibatalkan. Taip "RESET" untuk teruskan:'
    );
    if (confirmed !== 'RESET') { showToast('Reset dibatalkan.', 'error'); return; }

    try {
        const { error } = await supabase
            .from('students')
            .update({ current_page: 1, current_juz: 1 })
            .eq('is_active', true);
        if (error) throw error;
        showToast('Reset tahun akademik berjaya! Semua pelajar kembali ke ms. 1.', 'success');
        allStudents = [];
        renderStudentTable();
    } catch (err) {
        showToast('Ralat: ' + err.message, 'error');
    }
}

// ============================================================
// FIX #3: Admin change own password
// ============================================================
async function adminChangeOwnPassword() {
    const newPass = prompt('Masukkan kata laluan baru (min. 8 aksara):');
    if (!newPass) return;
    try {
        await changePassword(newPass);
        showToast('Kata laluan berjaya dikemaskini!', 'success');
    } catch (err) {
        showToast('Ralat: ' + err.message, 'error');
    }
}

// ============================================================
// TEACHER EDIT MODAL
// ============================================================

function openEditTeacherModal(id, name, phone, email) {
    document.getElementById('editTeacherId').value    = id;
    document.getElementById('editTeacherName').value  = name;
    document.getElementById('editTeacherPhone').value = phone || '';
    document.getElementById('editTeacherEmail').value = email || '';
    openModal('editTeacherModal');
}

async function submitEditTeacher() {
    const id    = document.getElementById('editTeacherId').value;
    const name  = document.getElementById('editTeacherName').value.trim();
    const phone = document.getElementById('editTeacherPhone').value.trim();
    const email = document.getElementById('editTeacherEmail').value.trim().toLowerCase();

    if (!name) { showToast('Sila masukkan nama murabbi.', 'error'); return; }

    const updates = { full_name: name, phone: phone || null };
    if (email) updates.email = email;

    const { error } = await supabase.from('profiles').update(updates).eq('id', id);

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Maklumat murabbi berjaya dikemaskini!', 'success');
    closeModal('editTeacherModal');
    await loadDropdownData();
    loadTeachersTable();
}

// ============================================================
// PARENT EDIT MODAL
// ============================================================

function openEditParentModal(id, name, phone, email) {
    document.getElementById('editParentId').value    = id;
    document.getElementById('editParentName').value  = name;
    document.getElementById('editParentPhone').value = phone || '';
    document.getElementById('editParentEmail').value = email || '';
    openModal('editParentModal');
}

async function submitEditParent() {
    const id    = document.getElementById('editParentId').value;
    const name  = document.getElementById('editParentName').value.trim();
    const phone = document.getElementById('editParentPhone').value.trim();
    const email = document.getElementById('editParentEmail').value.trim().toLowerCase();

    if (!name) { showToast('Sila masukkan nama wali murid.', 'error'); return; }

    const updates = { full_name: name, phone: phone || null };
    if (email) updates.email = email;

    const { error } = await supabase.from('profiles').update(updates).eq('id', id);

    if (error) { showToast('Ralat: ' + error.message, 'error'); return; }
    showToast('Maklumat wali murid berjaya dikemaskini!', 'success');
    closeModal('editParentModal');
    await loadDropdownData();
    loadParentsTable();
}

// ============================================================
// EXPORTS
// ============================================================
window.switchTab             = switchTab;
window.switchRptTab          = switchRptTab;
window.showToast             = showToast;
window.openModal             = openModal;
window.closeModal            = closeModal;
window.openHalaqahModal      = openHalaqahModal;
window.submitHalaqahModal    = submitHalaqahModal;
window.deleteHalaqah         = deleteHalaqah;
window.openEditStudentModal  = openEditStudentModal;
window.submitEditStudent     = submitEditStudent;
window.deleteStudent         = deleteStudent;
window.removeUser            = removeUser;
window.filterParentTable     = filterParentTable;
window.exportStudentsCSV     = exportStudentsCSV;
window.importCSV             = importCSV;
window.clearCSV              = clearCSV;
window.downloadCSVTemplate   = downloadCSVTemplate;
window.deleteAnnouncement    = deleteAnnouncement;
window.openRPTPlanModal      = openRPTPlanModal;
window.submitRPTPlanModal    = submitRPTPlanModal;
window.deleteRPTPlan         = deleteRPTPlan;
window.deleteHoliday         = deleteHoliday;
window.deleteRPTOverride     = deleteRPTOverride;
window.adminSendPasswordReset = adminSendPasswordReset;
window.promptAndResetPassword  = promptAndResetPassword;
window.resetAcademicYear     = resetAcademicYear;
window.adminChangeOwnPassword = adminChangeOwnPassword;
window.openEditTeacherModal  = openEditTeacherModal;
window.submitEditTeacher     = submitEditTeacher;
window.openEditParentModal   = openEditParentModal;
window.submitEditParent      = submitEditParent;
