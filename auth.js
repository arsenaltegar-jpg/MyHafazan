// ============================================================
// MYHAFAZAN MTSD - auth.js
// Authentication, Session Management & Role-based Routing
// ============================================================

const SUPABASE_URL = 'https://fuhdialwabzedinesxye.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KW6_cE5LFjk7g4BAKGhupA_tFzO8DxD';

// Create the Supabase client and immediately overwrite window.supabase
// so all other scripts (admin.js, teacher.js, parent.js) can use window.supabase
// as the ready-to-use client — not the raw CDN library object.
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Global App State ----
const AppState = {
    session: null,
    profile: null,
    role: null,
};

// ============================================================
// ROLE-BASED ROUTING
// ============================================================

function routeByRole(role) {
    const routes = {
        admin: 'admin.html',
        teacher: 'teacher.html',
        parent: 'parent.html',
        student: 'parent.html',
    };
    const target = routes[role] || 'index.html';
    if (!window.location.href.includes(target)) {
        window.location.href = target;
    }
}

// ============================================================
// FETCH PROFILE
// ============================================================

async function fetchProfile(userId) {
    const { data, error } = await window.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching profile:', error);
        return null;
    }
    return data;
}

// ============================================================
// LOGIN (Email / Password)
// ============================================================

async function login(email, password) {
    showAuthLoading(true);
    clearAuthError();

    const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showAuthError(error.message || 'Log masuk gagal. Sila cuba lagi.');
        showAuthLoading(false);
        return;
    }

    const profile = await fetchProfile(data.user.id);
    if (!profile) {
        showAuthError('Profil pengguna tidak dijumpai. Hubungi admin.');
        await window.supabase.auth.signOut();
        showAuthLoading(false);
        return;
    }

    AppState.session = data.session;
    AppState.profile = profile;
    AppState.role = profile.role;

    routeByRole(profile.role);
}

// ============================================================
// GOOGLE SIGN-IN
// ============================================================

async function loginWithGoogle() {
    clearAuthError();
    const { error } = await window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${window.location.origin}/index.html`,
        },
    });
    if (error) {
        showAuthError(error.message || 'Log masuk Google gagal. Sila cuba lagi.');
    }
}

// ============================================================
// LOGOUT
// ============================================================

async function logout() {
    await window.supabase.auth.signOut();
    AppState.session = null;
    AppState.profile = null;
    AppState.role = null;
    window.location.href = 'index.html';
}

// ============================================================
// SESSION GUARD
// ============================================================

async function requireAuth(expectedRole = null) {
    const { data: { session } } = await window.supabase.auth.getSession();

    if (!session) {
        window.location.href = 'index.html';
        return null;
    }

    const profile = await fetchProfile(session.user.id);
    if (!profile) {
        await window.supabase.auth.signOut();
        window.location.href = 'index.html';
        return null;
    }

    AppState.session = session;
    AppState.profile = profile;
    AppState.role = profile.role;

    // Admin can access any page
    if (expectedRole && profile.role !== expectedRole && profile.role !== 'admin') {
        window.location.href = 'index.html';
        return null;
    }

    return profile;
}

// ============================================================
// UI HELPERS
// ============================================================

function showAuthLoading(show) {
    const btn = document.getElementById('loginBtn');
    const spinner = document.getElementById('loginSpinner');
    if (btn) btn.disabled = show;
    if (spinner) spinner.classList.toggle('hidden', !show);
}

function showAuthError(msg) {
    const el = document.getElementById('authError');
    if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
    }
}

function clearAuthError() {
    const el = document.getElementById('authError');
    if (el) {
        el.textContent = '';
        el.classList.add('hidden');
    }
}

function populateNavProfile(profile) {
    const nameEl = document.getElementById('navUserName');
    const roleEl = document.getElementById('navUserRole');
    const avatarEl = document.getElementById('navAvatar');

    const roleLabels = {
        admin: 'Pentadbir',
        teacher: 'Murabbi',
        parent: 'Wali',
        student: 'Pelajar',
    };

    if (nameEl) nameEl.textContent = profile.full_name;
    if (roleEl) roleEl.textContent = roleLabels[profile.role] || profile.role;
    if (avatarEl) {
        if (profile.avatar_url) {
            if (avatarEl.tagName === 'IMG') {
                avatarEl.src = profile.avatar_url;
            } else {
                avatarEl.style.backgroundImage = `url(${profile.avatar_url})`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
            }
        } else {
            avatarEl.textContent = (profile.full_name || 'A')[0].toUpperCase();
        }
    }
}

// ============================================================
// PASSWORD RESET
// ============================================================

async function sendPasswordReset(email) {
    const { error } = await window.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password.html`,
    });
    if (error) throw error;
}

// ============================================================
// CREATE USER (Admin only)
// ============================================================

async function adminCreateUser(fullName, email, password, role) {
    const { data, error } = await window.supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;

    if (data.user) {
        const { error: profileError } = await window.supabase
            .from('profiles')
            .upsert({ id: data.user.id, full_name: fullName, role });
        if (profileError) throw profileError;
    }
    return data;
}

// ============================================================
// INIT LOGIN PAGE
// ============================================================

async function initLoginPage() {
    // Handle OAuth redirect callback + existing sessions
    window.supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            const profile = await fetchProfile(session.user.id);
            if (profile) {
                routeByRole(profile.role);
            } else {
                // New Google user — trigger may be slightly delayed
                setTimeout(async () => {
                    const retryProfile = await fetchProfile(session.user.id);
                    if (retryProfile) {
                        routeByRole(retryProfile.role);
                    } else {
                        showAuthError('Profil tidak dijumpai. Hubungi admin.');
                    }
                }, 1500);
            }
        }
    });

    // Check if already logged in
    const { data: { session } } = await window.supabase.auth.getSession();
    if (session) {
        const profile = await fetchProfile(session.user.id);
        if (profile) routeByRole(profile.role);
    }

    // Bind login form
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('emailInput').value.trim();
            const password = document.getElementById('passwordInput').value;
            await login(email, password);
        });
    }

    // Bind Google sign-in button
    document.getElementById('googleSignInBtn')?.addEventListener('click', loginWithGoogle);

    // Bind forgot password
    document.getElementById('forgotPasswordBtn')?.addEventListener('click', async () => {
        const email = document.getElementById('emailInput').value.trim();
        if (!email) { showAuthError('Sila masukkan emel anda terlebih dahulu.'); return; }
        try {
            await sendPasswordReset(email);
            showAuthError('E-mel reset kata laluan telah dihantar!');
        } catch (err) {
            showAuthError(err.message);
        }
    });
}

// ============================================================
// UTILITY
// ============================================================

function formatDateMY(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' });
}

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

// ============================================================
// EXPORTS
// ============================================================
window.AppState = AppState;
// window.supabase is already the client (set at top of file)
window.login = login;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.requireAuth = requireAuth;
window.adminCreateUser = adminCreateUser;
window.populateNavProfile = populateNavProfile;
window.formatDateMY = formatDateMY;
window.getTodayDate = getTodayDate;
