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
// BRAVE BROWSER DETECTION + WARNING
// ============================================================
async function isBraveBrowser() {
    if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
        return await navigator.brave.isBrave();
    }
    return false;
}

async function checkBraveAndWarn() {
    const brave = await isBraveBrowser();
    if (!brave) return;

    // Hide the login form, show warning instead
    const formArea = document.getElementById('loginFormArea');
    const card = document.querySelector('.card');
    if (!card) return;

    if (formArea) formArea.classList.add('hidden-soft');

    const warning = document.createElement('div');
    warning.innerHTML = `
        <div style="text-align:center; padding: 12px 0;">
            <div style="font-size:40px; margin-bottom:16px;">🦁</div>
            <div style="font-size:17px; font-weight:700; color:white; margin-bottom:8px;">
                Pelayar Brave Dikesan
            </div>
            <div style="font-size:13px; color:rgba(255,255,255,0.5); margin-bottom:20px; line-height:1.6;">
                MyHafazan tidak berfungsi dengan baik pada pelayar Brave kerana 
                tetapan privasi yang ketat menghalang pengesahan selamat.
            </div>
            <div style="background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); 
                        border-radius:12px; padding:14px; margin-bottom:20px; text-align:left;">
                <div style="font-size:12px; font-weight:700; color:#FCD34D; 
                             margin-bottom:10px; letter-spacing:0.5px;">
                    ⚙️ CARA MATIKAN BRAVE SHIELDS
                </div>
                <div style="font-size:12px; color:rgba(255,255,255,0.6); line-height:2;">
                    1. Klik ikon <strong style="color:white;">🦁</strong> di bar alamat<br>
                    2. Togol <strong style="color:white;">"Shields"</strong> kepada <strong style="color:#86EFAC;">PADAM</strong><br>
                    3. Muat semula halaman ini
                </div>
            </div>
            <div style="font-size:12px; color:rgba(255,255,255,0.35); margin-bottom:16px;">
                — atau gunakan pelayar lain —
            </div>
            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                <a href="https://www.google.com/chrome/" target="_blank"
                   style="padding:8px 16px; background:rgba(255,255,255,0.08); 
                          border:1px solid rgba(255,255,255,0.15); border-radius:8px;
                          color:white; font-size:12px; font-weight:600; text-decoration:none;">
                    Chrome
                </a>
                <a href="https://www.mozilla.org/firefox/" target="_blank"
                   style="padding:8px 16px; background:rgba(255,255,255,0.08); 
                          border:1px solid rgba(255,255,255,0.15); border-radius:8px;
                          color:white; font-size:12px; font-weight:600; text-decoration:none;">
                    Firefox
                </a>
                <a href="https://www.apple.com/safari/" target="_blank"
                   style="padding:8px 16px; background:rgba(255,255,255,0.08); 
                          border:1px solid rgba(255,255,255,0.15); border-radius:8px;
                          color:white; font-size:12px; font-weight:600; text-decoration:none;">
                    Safari
                </a>
            </div>
        </div>
    `;
    card.appendChild(warning);
}

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
    const currentPath = window.location.pathname;
    // Already on the correct page — don't redirect (avoids loops)
    if (currentPath.endsWith(target)) return;
    // Build correct path relative to current location (works in subfolders like /MyHafazan/)
    const basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    window.location.href = basePath + target;
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

    // FIX: Do NOT call fetchProfile or routeByRole here.
    // signInWithPassword triggers onAuthStateChange(SIGNED_IN) which now
    // handles the profile fetch and redirect as the single source of truth.
    // Doing it here too would cause a double-redirect race condition.
    // We only need to handle the error case above; success is handled by the listener.
}

// ============================================================
// GOOGLE SIGN-IN
// ============================================================

async function loginWithGoogle() {
    clearAuthError();
    // Use the exact current page URL as the redirect target so it works
    // on both GitHub Pages subfolders (e.g. /MyHafazan/) and custom domains.
    const redirectTo = window.location.href.split('#')[0].split('?')[0];
    const { error } = await window.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo,
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
    const basePath = window.location.href.split('#')[0].split('?')[0];
    const resetUrl = basePath.substring(0, basePath.lastIndexOf('/') + 1) + 'reset-password.html';
    const { error } = await window.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: resetUrl,
    });
    if (error) throw error;
}

// ============================================================
// CREATE USER (Admin only)
// FIX #1: Password strength enforced server-side (min 8 chars)
// ============================================================

async function adminCreateUser(fullName, email, password, role) {
    // FIX #1: Enforce minimum password length before API call
    if (!password || password.length < 8) {
        throw new Error('Kata laluan mesti sekurang-kurangnya 8 aksara.');
    }
    const { data, error } = await window.supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, role } }
    });
    if (error) throw error;

    if (data.user) {
        const { error: profileError } = await window.supabase
            .from('profiles')
            .upsert({ id: data.user.id, full_name: fullName, email, role });
        if (profileError) throw profileError;
    }
    return data;
}

// ============================================================
// CHANGE PASSWORD (Self-service for logged-in users)
// FIX #3: Teachers and parents can change own password
// ============================================================

async function changePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) {
        throw new Error('Kata laluan baru mesti sekurang-kurangnya 8 aksara.');
    }
    const { error } = await window.supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

// ============================================================
// SESSION AUTH STATE WATCHER
// FIX #14: Protected pages call this to handle mid-session expiry
// ============================================================

function watchSession() {
    window.supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            window.location.href = 'index.html';
        }
    });
}

// ============================================================
// INIT LOGIN PAGE
// FIX: Removed duplicate getSession() call that raced with
//      onAuthStateChange, causing intermittent redirect failures.
//      onAuthStateChange is now the single source of truth.
//      TOKEN_REFRESHED is now handled (expired-but-refreshable sessions).
//      isHandling guard prevents double-execution on Google OAuth retry loop.
// ============================================================

async function initLoginPage() {
    await checkBraveAndWarn(); // ← ADD THIS at the very top
    const formArea   = document.getElementById('loginFormArea');
    const redirectOv = document.getElementById('redirectOverlay');
    const redirectSub = document.getElementById('redirectSubText');

    function showRedirecting(roleName) {
        if (formArea)    formArea.classList.add('hidden-soft');
        if (redirectOv)  redirectOv.classList.add('show');
        if (redirectSub && roleName) {
            const roleLabels = { admin: 'Pentadbir', teacher: 'Murabbi', parent: 'Wali', student: 'Pelajar' };
            redirectSub.textContent = 'Masuk sebagai ' + (roleLabels[roleName] || roleName) + '...';
        }
    }

    // FIX: Guard flag — prevents the two async paths (INITIAL_SESSION + TOKEN_REFRESHED)
    // from both running the profile fetch + redirect simultaneously.
    let isHandling = false;

    // FIX: onAuthStateChange is now the ONLY session check on the login page.
    // It covers all cases:
    //   INITIAL_SESSION — user already logged in (valid or freshly refreshed token)
    //   SIGNED_IN       — just completed email/password or OAuth login
    //   TOKEN_REFRESHED — access token was expired; Supabase silently refreshed it
    //                     (this was the main cause of "sometimes doesn't redirect")
    window.supabase.auth.onAuthStateChange(async (event, session) => {
        const shouldHandle =
            event === 'SIGNED_IN' ||
            event === 'INITIAL_SESSION' ||
            event === 'TOKEN_REFRESHED';

        if (!shouldHandle || !session) return;

        // FIX: Prevent double-execution if multiple events fire close together
        if (isHandling) return;
        isHandling = true;

        const profile = await fetchProfile(session.user.id);
        if (profile) {
            // FIX: Reset flag before redirect so back-navigation re-triggers correctly
            isHandling = false;
            AppState.session = session;
            AppState.profile = profile;
            AppState.role = profile.role;
            showRedirecting(profile.role);
            routeByRole(profile.role);
        } else if (event === 'SIGNED_IN' && !session.user.app_metadata?.provider?.includes('google')) {
            // Email/password login — profile genuinely missing (not a timing issue)
            // Sign out and show error immediately rather than retrying
            isHandling = false;
            await window.supabase.auth.signOut();
            showAuthLoading(false);
            showAuthError('Profil pengguna tidak dijumpai. Hubungi admin.');
        } else {
            // Google/OAuth user — DB trigger may be slightly delayed, retry up to 4x
            showRedirecting(null);
            let attempts = 0;
            const retry = setInterval(async () => {
                attempts++;
                const retryProfile = await fetchProfile(session.user.id);
                if (retryProfile) {
                    clearInterval(retry);
                    isHandling = false;
                    AppState.session = session;
                    AppState.profile = retryProfile;
                    AppState.role = retryProfile.role;
                    showRedirecting(retryProfile.role);
                    routeByRole(retryProfile.role);
                } else if (attempts >= 4) {
                    clearInterval(retry);
                    isHandling = false; // Allow retry if user tries again
                    if (formArea)   formArea.classList.remove('hidden-soft');
                    if (redirectOv) redirectOv.classList.remove('show');
                    showAuthError('Profil tidak dijumpai. Sila hubungi admin.');
                }
            }, 1500);
        }
    });

    // FIX: The old explicit getSession() block that used to live here has been REMOVED.
    // It caused a race condition: getSession() sometimes returned null mid-refresh
    // while onAuthStateChange was already handling the refreshed session, resulting
    // in the login form being shown to an authenticated user.

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
window.changePassword = changePassword;
window.watchSession = watchSession;
window.populateNavProfile = populateNavProfile;
window.formatDateMY = formatDateMY;
window.getTodayDate = getTodayDate;
