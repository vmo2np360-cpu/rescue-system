// ================================================================
// 認證與導航模組 (含動態載入)
// ================================================================

const ROLE_EMAIL_MAP = {
    admin: 'admin@np360.com.hk',
    gs: 'gs@np360.com.hk',
    ap: 'ap@np360.com.hk',
    occ: 'occ@np360.com.hk',
    re: 're@np360.com.hk',
    gr: 'gr@np360.com.hk'
};

const SECTIONS = [
    { id: 'section-gs', key: 'gs', label: 'Ground Support', icon: 'fa-user-plus', pageKey: 'index_ground_support', template: 'templates/gs.html', init: 'initGroundSupport' },
    { id: 'section-ap', key: 'ap', label: 'Assembly Point', icon: 'fa-qrcode', pageKey: 'index_assembly_point', template: 'templates/ap.html', init: 'initAssemblyPoint' },
    { id: 'section-dashboard', key: 'dashboard', label: '監控面板', icon: 'fa-chart-line', pageKey: 'index_dashboard', template: 'templates/dashboard.html', init: 'initDashboard' },
    { id: 'section-map', key: 'map', label: '救援地圖', icon: 'fa-map-marked-alt', pageKey: 'index_rescue_map', template: 'templates/map.html', init: 'initMap' },
    { id: 'section-occ', key: 'occ', label: 'OCC 求助記錄', icon: 'fa-headset', pageKey: 'recourse', template: 'templates/occ.html', init: 'initOcc' },
    { id: 'section-monitor', key: 'monitor', label: '總監控平台', icon: 'fa-tv', pageKey: 'monitor', template: 'templates/monitor.html', init: 'monInit' },
    { id: 'section-monitor-dashboard', key: 'monitor_dashboard', label: '新版監控', icon: 'fa-tv', pageKey: 'monitor_dashboard', template: 'templates/monitor_dashboard.html', init: 'mdInit' },
    { id: 'section-audit', key: 'audit', label: '操作日誌', icon: 'fa-history', pageKey: 'audit', template: 'templates/audit.html', init: 'initAudit' }
];

const loadedCache = {};

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('loginPassword');
    const icon = document.getElementById('pwdToggleIcon');
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        pwdInput.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function onRoleChange() {
    const role = document.getElementById('roleSelect').value;
    document.getElementById('loginEmail').value = ROLE_EMAIL_MAP[role] || '';
    const hint = document.getElementById('loginHint');
    const names = { admin: '管理員', gs: '地面救援隊', ap: '集合點', occ: 'OCC控制中心', re: '地圖編輯員', gr: '賓客關係' };
    if (role && ROLE_EMAIL_MAP[role]) {
        hint.innerHTML = `🔑 您將以 <strong>${names[role]||role}</strong> 身份登入`;
        hint.style.color = '#2563eb';
    } else {
        hint.innerHTML = '請選擇角色';
        hint.style.color = '#64748b';
    }
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    if (!email) { showMessage('loginMessage', '請先選擇角色', 'error'); return; }
    if (!password) { showMessage('loginMessage', '請輸入密碼', 'error'); return; }
    try {
        showLoader(true);
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        let msg = '登入失敗: ';
        switch(error.code) {
            case 'auth/user-not-found': msg += '使用者不存在，請聯繫管理員'; break;
            case 'auth/wrong-password': msg += '密碼錯誤'; break;
            default: msg += error.message;
        }
        showMessage('loginMessage', msg, 'error');
    } finally {
        showLoader(false);
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
    } catch (e) { alert('登出失敗: ' + e.message); }
}

async function getUserRole(uid) {
    const targetUid = uid || (auth.currentUser && auth.currentUser.uid);
    if (!targetUid) return null;
    try {
        const doc = await db.collection('users').doc(targetUid).get();
        if (doc.exists) return doc.data().role || null;
        return null;
    } catch (e) { return null; }
}

function renderNavigation(role) {
    const menu = document.getElementById('navMenu');
    menu.innerHTML = '';
    SECTIONS.forEach(section => {
        const allowedRoles = window.PERMISSIONS?.pages?.[section.pageKey] || [];
        if (role === 'admin' || allowedRoles.includes(role)) {
            const btn = document.createElement('button');
            btn.className = 'nav-btn';
            btn.dataset.target = section.id;
            btn.innerHTML = `<i class="fas ${section.icon}"></i> ${section.label}`;
            btn.onclick = () => switchSection(section.id);
            menu.appendChild(btn);
        }
    });
    const first = menu.querySelector('.nav-btn');
    if (first && !document.querySelector('.section-container.active')) first.click();
}

async function loadSection(sectionId) {
    const container = document.getElementById(sectionId);
    if (!container) return;
    if (container.dataset.loaded === 'true') {
        return;
    }
    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return;

    try {
        showLoader(true);
        let html = loadedCache[sectionId];
        if (!html) {
            const response = await fetch(section.template);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            html = await response.text();
            loadedCache[sectionId] = html;
        }
        container.innerHTML = html;
        container.dataset.loaded = 'true';

        if (section.init && typeof window[section.init] === 'function') {
            setTimeout(() => {
                window[section.init]();
            }, 150);
        }
    } catch (error) {
        console.error('載入區塊失敗:', error);
        container.innerHTML = `<div class="card"><p style="color:red;">載入失敗: ${error.message}</p></div>`;
    } finally {
        showLoader(false);
    }
}

function switchSection(sectionId) {
    // ★ 若切離新版監控頁且仍在全屏，先退出全屏
    if (sectionId !== 'section-monitor-dashboard') {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        if (isFullscreen) {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    }

    // 隱藏所有區塊
    document.querySelectorAll('.section-container').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    // 顯示目標區塊
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
        // ★ 支援 flex 全屏 section
        const flexSections = ['section-monitor', 'section-monitor-dashboard'];
        target.style.display = flexSections.includes(sectionId) ? 'flex' : 'block';
        loadSection(sectionId);

        // ★ 切到新版監控頁時，主動呼叫 mdInit()
        if (sectionId === 'section-monitor-dashboard') {
            setTimeout(() => {
                if (typeof window.mdInit === 'function') {
                    window._mdInitialized = false;   // 強制讓 mdInit 檢查一次
                    window.mdInit();
                }
            }, 250);
        }
    }

    // 更新導航按鈕樣式
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === sectionId);
    });
}

// 監聽登入狀態
auth.onAuthStateChanged(async (user) => {
    if (user) {
        const role = await getUserRole(user.uid);
        window.currentRole = role;
        document.getElementById('navbar').style.display = 'flex';
        document.getElementById('loginContainer').style.display = 'none';
        const info = document.getElementById('navUserInfo');
        info.innerHTML = `<i class="fas fa-user-circle"></i> ${user.displayName||user.email} ${role ? `<span style="background:rgba(255,255,255,0.2);padding:2px 10px;border-radius:12px;font-size:0.75rem;">${role.toUpperCase()}</span>` : ''}`;
        renderNavigation(role);
        if (!role) showMessage('loginMessage', '⚠️ 您的帳號尚未設定角色，請聯繫管理員', 'error');
        const firstBtn = document.querySelector('.nav-btn');
        if (firstBtn) firstBtn.click();
    } else {
        document.getElementById('navbar').style.display = 'none';
        document.getElementById('loginContainer').style.display = 'block';
        document.querySelectorAll('.section-container').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none';
        });
        document.querySelectorAll('.section-container').forEach(el => el.dataset.loaded = 'false');
        showMessage('loginMessage', '請選擇角色並輸入密碼登入', 'info');
    }
});

window.onRoleChange = onRoleChange;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.switchSection = switchSection;

document.addEventListener('DOMContentLoaded', () => {
    const user = auth.currentUser;
    if (user) auth.onAuthStateChanged(user);
});
