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
    // ★ 修改：init 改為 'monInit'（與 monitor.html 定義一致）
    { id: 'section-monitor', key: 'monitor', label: '總監控平台', icon: 'fa-tv', pageKey: 'monitor', template: 'templates/monitor.html', init: 'monInit' }
];

// 快取已載入的 HTML
const loadedCache = {};

// 密碼可見性
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
        const allowedRoles = PERMISSIONS.pages[section.pageKey] || [];
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

// 動態載入區塊 HTML
async function loadSection(sectionId) {
    const container = document.getElementById(sectionId);
    if (!container) return;
    // 若已載入則直接顯示
    if (container.dataset.loaded === 'true') {
        return;
    }
    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return;

    try {
        showLoader(true);
        // 從快取或 fetch
        let html = loadedCache[sectionId];
        if (!html) {
            const response = await fetch(section.template);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            html = await response.text();
            loadedCache[sectionId] = html;
        }
        container.innerHTML = html;
        container.dataset.loaded = 'true';

        // ★ 執行該區塊的初始化函數（若存在）
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
    // 1. 移除所有區塊的 active 類別
    document.querySelectorAll('.section-container').forEach(el => {
        el.classList.remove('active');
    });

    // 2. 直接控制地圖顯示（作為 CSS 的備份）
    const mapEl = document.getElementById('map');
    if (mapEl) {
        mapEl.style.display = (sectionId === 'section-map') ? 'block' : 'none';
    }

    // 3. 顯示目標區塊並加上 active
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.add('active');
        loadSection(sectionId);
    }

    // 4. 更新導航按鈕樣式
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
        // 自動載入第一個有權限的區塊
        const firstBtn = document.querySelector('.nav-btn');
        if (firstBtn) firstBtn.click();
    } else {
        document.getElementById('navbar').style.display = 'none';
        document.getElementById('loginContainer').style.display = 'block';
        document.querySelectorAll('.section-container').forEach(el => el.classList.remove('active'));
        // 清空已載入標記，以免下次登入時使用舊內容
        document.querySelectorAll('.section-container').forEach(el => el.dataset.loaded = 'false');
        showMessage('loginMessage', '請選擇角色並輸入密碼登入', 'info');
    }
});

// 暴露給 HTML
window.onRoleChange = onRoleChange;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.switchSection = switchSection;

// 初始檢查
document.addEventListener('DOMContentLoaded', () => {
    const user = auth.currentUser;
    if (user) auth.onAuthStateChanged(user);
});
