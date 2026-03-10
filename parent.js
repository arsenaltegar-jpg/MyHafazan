// ============================================================
// MYHAFAZAN MTSD - parent.js
// Parent / Student Progress Dashboard
// ============================================================

let myChildren = [];

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = 'index.html'; return; }

    const profile = await fetchProfile(session.user.id);
    if (!profile || !['parent', 'student', 'admin'].includes(profile.role)) {
        window.location.href = 'index.html'; return;
    }

    window.AppState.session = session;
    window.AppState.profile = profile;
    window.AppState.role = profile.role;

    populateNavProfile(profile);

    // Load data in parallel
    await Promise.all([
        loadChildren(profile.id),
        loadAnnouncements(profile.role),
    ]);

    document.getElementById('logoutBtn')?.addEventListener('click', logout);
});

// ============================================================
// LOAD ANNOUNCEMENTS
// ============================================================

async function loadAnnouncements(role) {
    const { data: announcements } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .or(`target_role.is.null,target_role.eq.${role}`)
        .order('created_at', { ascending: false })
        .limit(5);

    const container = document.getElementById('announcementsContainer');
    if (!container || !announcements || !announcements.length) return;

    container.innerHTML = `
        <div class="announcement-card">
          <div class="announcement-header">
            <i class="fas fa-bullhorn" style="color:white;font-size:13px;"></i>
            <span>Pengumuman</span>
          </div>
          ${announcements.map(a => `
            <div class="announcement-item">
              <div class="announcement-title">${a.title}</div>
              <div class="announcement-body">${a.body}</div>
              <div class="announcement-date"><i class="fas fa-clock"></i> ${formatDateMY(a.created_at)}</div>
            </div>
          `).join('')}
        </div>`;
}

// ============================================================
// LOAD CHILDREN
// ============================================================

async function loadChildren(parentId) {
    const { data: students, error } = await supabase
        .from('students')
        .select(`*, halaqahs(name, teacher_id, teacher:profiles!halaqahs_teacher_id_fkey(full_name))`)
        .eq('parent_id', parentId)
        .eq('is_active', true);

console.log('RAW students data:', JSON.stringify(students, null, 2)); // ADD THIS

    if (error) { console.error(error); return; }

    // Today's RPT target
    const { data: rpt } = await supabase
        .from('rpt_targets')
        .select('target_page_total, juz_reference')
        .eq('date', getTodayDate())
        .single();

    const todayTarget = rpt?.target_page_total || null;

    myChildren = (students || []).map(s => ({
        ...s,
        hutang: todayTarget !== null ? todayTarget - s.current_page : null,
        todayTarget,
        todayJuz: rpt?.juz_reference || null,
    }));

    renderChildren();
}

// ============================================================
// RENDER CHILDREN CARDS
// ============================================================

function renderChildren() {
    const container = document.getElementById('childrenContainer');
    if (!container) return;

    if (!myChildren.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-child-reaching"></i>
                <h3>Tiada Profil Pelajar</h3>
                <p>Profil anak anda belum dikaitkan dengan akaun ini.<br>Sila hubungi pentadbir sekolah untuk mendaftarkan anak anda.</p>
            </div>`;
        return;
    }

    container.innerHTML = myChildren.map(child => renderChildCard(child)).join('');

    // Load logs for each child
    myChildren.forEach(child => loadChildLogs(child.id));
}

function renderChildCard(child) {
    const hutang = child.hutang;
    const todayTarget = child.todayTarget;

    // Status logic
    let statusClass = 'status-green';
    let statusText = 'Melebihi / Mencapai';
    let statusIcon = 'fa-circle-check';
    let hutangDisplay = '';

    if (hutang === null) {
        statusClass = 'status-gray';
        statusText = 'Sasaran RPT Belum Ditetapkan';
        statusIcon = 'fa-circle-minus';
        hutangDisplay = '–';
    } else if (hutang > 0) {
        statusClass = hutang > 15 ? 'status-red' : 'status-orange';
        statusText = `Ketinggalan ${hutang} Muka Surat`;
        statusIcon = hutang > 15 ? 'fa-circle-exclamation' : 'fa-triangle-exclamation';
        hutangDisplay = `+${hutang}`;
    } else if (hutang === 0) {
        hutangDisplay = '0';
        statusText = 'Tepat Mencapai Sasaran';
    } else {
        hutangDisplay = Math.abs(hutang).toString();
        statusText = `Melebihi ${Math.abs(hutang)} Muka Surat`;
    }

    // Juz progress (20 pages per juz)
    const juzStart = (child.current_juz - 1) * 20 + 1;
    const juzEnd = child.current_juz * 20;
    const juzProgress = Math.min(100, Math.max(0, ((child.current_page - juzStart) / 20) * 100));
    const totalProgress = Math.min(100, (child.current_page / 604) * 100);

    const initials = child.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const teacherName = child.halaqahs?.teacher?.full_name || 'Tiada Murabbi';
    const halaqahName = child.halaqahs?.name || 'Tiada Halaqah';

    return `
    <div class="child-card">
      <!-- HEADER -->
      <div class="cc-header ${statusClass}-bg">
        <div class="cc-avatar">
          ${child.photo_url
            ? `<img src="${child.photo_url}" alt="${child.full_name}" />`
            : `<span>${initials}</span>`}
          <div class="cc-status-dot ${statusClass}-dot"></div>
        </div>
        <div class="cc-header-info">
          <div class="cc-name">${child.full_name}</div>
          <div class="cc-halaqah"><i class="fas fa-circle-nodes"></i> ${halaqahName}</div>
          <div class="cc-teacher"><i class="fas fa-chalkboard-user"></i> ${teacherName}</div>
        </div>
        <div class="cc-header-right">
          <div class="cc-juz-badge">Juzuk ${child.current_juz}</div>
        </div>
      </div>

      <!-- HUTANG DISPLAY -->
      <div class="cc-hutang-section">
        <div class="cc-hutang-label">Hutang Muka Surat</div>
        <div class="cc-hutang-number ${statusClass}">${hutangDisplay}</div>
        <div class="cc-status-text ${statusClass}">
          <i class="fas ${statusIcon}"></i> ${statusText}
        </div>
      </div>

      <!-- STATS ROW -->
      <div class="cc-stats">
        <div class="cc-stat">
          <div class="cc-stat-label">Muka Semasa</div>
          <div class="cc-stat-value">${child.current_page}</div>
        </div>
        <div class="cc-stat-divider"></div>
        <div class="cc-stat">
          <div class="cc-stat-label">Sasaran RPT</div>
          <div class="cc-stat-value">${todayTarget !== null ? todayTarget : '–'}</div>
        </div>
        <div class="cc-stat-divider"></div>
        <div class="cc-stat">
          <div class="cc-stat-label">Jumlah Hafaz</div>
          <div class="cc-stat-value">${child.current_page}<span style="font-size:12px;font-weight:500;color:var(--slate-500);"> ms.</span></div>
        </div>
      </div>

      <!-- JUZ PROGRESS -->
      <div class="cc-progress-section">
        <div class="cc-progress-header">
          <span class="cc-progress-label"><i class="fas fa-layer-group"></i> Kemajuan Juzuk ${child.current_juz}</span>
          <span class="cc-progress-pct">${Math.round(juzProgress)}%</span>
        </div>
        <div class="cc-progress-track">
          <div class="cc-progress-fill ${statusClass}-fill" style="width:${juzProgress}%"></div>
        </div>
        <div class="cc-progress-meta">ms. ${juzStart} – ${juzEnd} · Semasa: ms. ${child.current_page}</div>
      </div>

      <!-- TOTAL PROGRESS -->
      <div class="cc-progress-section" style="margin-top:8px;">
        <div class="cc-progress-header">
          <span class="cc-progress-label"><i class="fas fa-quran"></i> Kemajuan Keseluruhan Al-Quran</span>
          <span class="cc-progress-pct">${totalProgress.toFixed(1)}%</span>
        </div>
        <div class="cc-progress-track">
          <div class="cc-progress-fill purple-fill" style="width:${totalProgress}%"></div>
        </div>
        <div class="cc-progress-meta">${child.current_page} / 604 muka surat</div>
      </div>

      <!-- LOGS -->
      <div class="cc-logs-section">
        <div class="cc-logs-title"><i class="fas fa-clipboard-list"></i> Log Tasmik Terkini</div>
        <div id="logs-${child.id}" class="cc-logs-list">
          <div class="log-loading"><i class="fas fa-spinner fa-spin"></i> Memuat...</div>
        </div>
      </div>
    </div>`;
}

// ============================================================
// LOAD LOGS FOR CHILD
// ============================================================

async function loadChildLogs(studentId) {
    const { data: logs } = await supabase
        .from('hifz_logs')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(5);

    const container = document.getElementById(`logs-${studentId}`);
    if (!container) return;

    const typeLabels = { jadid: 'Hifz Jadid', murajaah_u: 'Murajaah Umum', murajaah_q: 'Murajaah Khas' };
    const typeColors = { jadid: '#6B21A8', murajaah_u: '#16A34A', murajaah_q: '#D97706' };
    const typeBg = { jadid: '#F3E8FF', murajaah_u: '#DCFCE7', murajaah_q: '#FEF3C7' };

    if (!logs || !logs.length) {
        container.innerHTML = '<p class="no-logs"><i class="fas fa-inbox"></i> Belum ada log tasmik.</p>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="log-item">
          <div class="log-type-badge" style="background:${typeBg[log.type]};color:${typeColors[log.type]};">
            ${typeLabels[log.type]}
          </div>
          <div class="log-info">
            <span class="log-page">ms. ${log.page_number}</span>
            <span class="log-date">${formatDateMY(log.session_date)}</span>
          </div>
          <div class="log-stars">${'⭐'.repeat(log.quality_score || 0)}</div>
        </div>
    `).join('');
}

window.loadChildren = loadChildren;
