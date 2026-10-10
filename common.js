// ==================== Firebase 初始化 ====================
const firebaseConfig = {
    apiKey: "AIzaSyCgSaPKhaaX9cP1tY-ThykJvo_sJtVyyDc",
    authDomain: "qrcodesystem-bceda.firebaseapp.com",
    databaseURL: "https://qrcodesystem-bceda-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "qrcodesystem-bceda",
    storageBucket: "qrcodesystem-bceda.firebasestorage.app",
    messagingSenderId: "253231467455",
    appId: "1:253231467455:web:5eb19df93b8b621ec6af0a"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();
const realtimeDb = firebase.database();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(err => console.warn('Persistence setting failed:', err));

// ================================================================
// ★ 全域站點座標（map / monitor / monitor-dashboard 統一使用）
// ================================================================
window.mdStationX = window.mdStationX || {
    'TC':   50,
    'T1':   178.57,
    'T2A':  307.14,
    'AIAS': 435.71,
    'T2B':  564.29,
    'T3':   1207.14,
    'T4':   1592.86,
    'T5':   1914.29,
    'NLS':  1978.57,
    'T6':   2107.14,
    'T7':   2557.14,
    'NP':   2750
};

window.mdStationY = window.mdStationY || {
    'TC':   650,
    'T1':   650,
    'T2A':  650,
    'AIAS': 650,
    'T2B':  650,
    'T3':   380,
    'T4':   180,
    'T5':   20,
    'NLS':  10,
    'T6':   20,
    'T7':   220,
    'NP':   200
};

window.mdLabelOffset = window.mdLabelOffset || {
    'TC':   { dx: 40,   dy: -20 },
    'T1':   { dx: 35,   dy: -20 },
    'T2A':  { dx: 80,   dy: 45  },
    'AIAS': { dx: 45,   dy: 45  },
    'T2B':  { dx: -5,   dy: 45  },
    'T3':   { dx: 50,   dy: -10 },
    'T4':   { dx: 50,   dy: -10 },
    'T5':   { dx: -50,  dy: 5   },
    'NLS':  { dx: 20,   dy: 30  },
    'T6':   { dx: 20,   dy: -15 },
    'T7':   { dx: -10,  dy: -15 },
    'NP':   { dx: -120, dy: -5  }
};

// ==================== 權限設定檔 ====================
const PERMISSIONS = {
    pages: {
        'index_ground_support': ['admin', 'gs'],
        'index_assembly_point': ['admin', 'ap'],
        'index_dashboard': ['admin', 'ap', 'occ', 're', 'gr'],
        'index_rescue_map': ['admin', 'occ'],
        'recourse': ['admin', 'occ', 'gr'],
        'monitor': ['admin', 'occ', 're'],
        'monitor_dashboard': ['admin', 'occ', 're'],
        'audit': ['admin', 'occ'],
        'index_cabin_photos': ['admin', 'occ'],
    },
    collections: {
        'guests': {
            create: ['admin', 'gs', 'occ'],
            read:   ['admin', 'gs', 'ap', 'occ'],
            update: ['admin', 'gs', 'ap', 'occ'],
            delete: ['admin', 'gs', 'occ', 'ap'],
        },
        'rescue_records': {
            create: ['admin', 'occ', 'gr'],
            read: ['admin', 'occ', 'gr'],
            update: ['admin', 'occ', 'gr'],
            delete: ['admin', 'occ', 'gr'],
        },
        'rescue_map_actions': {
            edit: ['admin', 'occ', 're'],
            export: ['admin', 'occ', 're'],
            clear: ['admin', 'occ'],
        }
    }
};

// ==================== 權限檢查函數 ====================
async function getUserRole(uid) {
    const targetUid = uid || (auth.currentUser && auth.currentUser.uid);
    if (!targetUid) return null;
    try {
        const doc = await db.collection('users').doc(targetUid).get();
        if (doc.exists) {
            return doc.data().role || null;
        }
        return null;
    } catch (error) {
        console.error('取得使用者角色失敗:', error);
        return null;
    }
}

async function canAccessPage(pageKey) {
    const role = await getUserRole();
    if (!role) return false;
    if (role === 'admin') return true;
    const allowedRoles = PERMISSIONS.pages[pageKey] || [];
    return allowedRoles.includes(role);
}

async function canPerformAction(collection, action) {
    const role = await getUserRole();
    if (!role) return false;
    if (role === 'admin') return true;
    const allowedRoles = PERMISSIONS.collections[collection]?.[action] || [];
    return allowedRoles.includes(role);
}

async function isAdmin() {
    const role = await getUserRole();
    return role === 'admin';
}

// ==================== 通用工具函數 ====================

function extractDateTime(datetimeInput) {
    if (!datetimeInput) return '';
    if (typeof datetimeInput === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetimeInput)) {
        return datetimeInput;
    }
    let date;
    try {
        if (datetimeInput.toDate && typeof datetimeInput.toDate === 'function') {
            date = datetimeInput.toDate();
        } else if (datetimeInput instanceof Date) {
            date = datetimeInput;
        } else if (typeof datetimeInput === 'string') {
            date = new Date(datetimeInput);
        } else if (typeof datetimeInput === 'number') {
            date = new Date(datetimeInput);
        } else if (datetimeInput.seconds !== undefined) {
            date = new Date(datetimeInput.seconds * 1000);
        }
        if (date && !isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    } catch (e) {}
    if (typeof datetimeInput === 'string') {
        const match = datetimeInput.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
        if (match) return match[1];
    }
    return '';
}

function getGroupStatus(guest) {
    if (guest.exitTime || guest.exitMethod) {
        return 'departed';
    }
    if (guest.timeLanded) {
        return 'landed';
    }
    if (guest.timeReachedTop || guest.rescuedBy) {
        return 'rescuing';
    }
    return 'waiting';
}

function getCabinOverallStatus(guests) {
    if (!guests || guests.length === 0) {
        return 'empty';
    }
    let hasRescuing = false;
    let hasLanded = false;
    let hasDeparted = false;
    let allDeparted = true;
    guests.forEach(g => {
        const status = getGroupStatus(g);
        if (status === 'rescuing') hasRescuing = true;
        if (status === 'landed') hasLanded = true;
        if (status === 'departed') hasDeparted = true;
        if (status !== 'departed') allDeparted = false;
    });
    if (hasRescuing) {
        return 'rescuing';
    }
    if (hasLanded) {
        return 'landed';
    }
    if (allDeparted && hasDeparted) {
        return 'departed';
    }
    return 'waiting';
}

function getGuestDisplayStatus(guest) {
    return getGroupStatus(guest);
}

function getStatusDisplayInfo(status) {
    const map = {
        'waiting':   { text: '等待救援', badge: 'status-waiting' },
        'rescuing':  { text: '救援中',   badge: 'status-pending' },
        'landed':    { text: '已著陸',   badge: 'status-complete' },
        'departed':  { text: '已離開',   badge: 'status-departed' },
        'empty':     { text: '無記錄',   badge: 'status-empty' }
    };
    return map[status] || { text: '未知', badge: 'status-unknown' };
}

function formatTimestamp(timestamp, locale = 'zh-TW') {
    if (!timestamp) return '-';
    try {
        let date;
        if (timestamp.toDate && typeof timestamp.toDate === 'function') {
            date = timestamp.toDate();
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else if (typeof timestamp === 'string') {
            date = new Date(timestamp);
        } else if (typeof timestamp === 'number') {
            date = new Date(timestamp);
        } else if (timestamp.seconds) {
            date = new Date(timestamp.seconds * 1000);
        } else {
            return '-';
        }
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleString(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\//g, '/');
    } catch (e) {
        return '-';
    }
}

function formatTimeOnly(timeStr) {
    if (!timeStr) return '-';
    if (typeof timeStr === 'string' && /^\d{1,2}:\d{2}$/.test(timeStr)) {
        return timeStr;
    }
    try {
        let date;
        if (timeStr.toDate && typeof timeStr.toDate === 'function') {
            date = timeStr.toDate();
        } else if (timeStr instanceof Date) {
            date = timeStr;
        } else {
            date = new Date(timeStr);
        }
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch (e) {
        return '-';
    }
}

function getGroupRescueStatus(guestData) {
    if (guestData.timeLanded) return 'landed';
    if (guestData.exitTime && guestData.exitMethod) return 'landed';
    if (guestData.timeReachedTop || guestData.rescuedBy) return 'rescuing';
    if (guestData.ambulance === '需要') return 'rescuing';
    return 'waiting';
}

function getQRCodeColor(healthStatus) {
    if (!healthStatus) return '#4267B2';
    if (healthStatus.includes('綠色')) return '#34A853';
    if (healthStatus.includes('黃色')) return '#FBBC05';
    if (healthStatus.includes('紅色')) return '#EA4335';
    if (healthStatus.includes('黑色')) return '#5f6368';
    return '#4267B2';
}

function showMessage(elementId, message, type = 'info', duration = 5000) {
    const el = document.getElementById(elementId);
    if (!el) {
        console.warn(`找不到元素 #${elementId}，訊息: ${message}`);
        return;
    }
    el.textContent = message;
    el.className = 'message';
    el.classList.add('show');
    if (type === 'success') el.classList.add('message-success');
    else if (type === 'error') el.classList.add('message-error');
    else if (type === 'info') el.classList.add('message-info');

    if (duration > 0) {
        setTimeout(() => {
            el.textContent = '';
            el.className = 'message';
            el.classList.remove('show');
        }, duration);
    }
}

function showLoader() {
    if (document.getElementById('global-loader')) return;
    const loader = document.createElement('div');
    loader.id = 'global-loader';
    loader.innerHTML = `
        <div class="loader-content">
            <div class="fa-3x"><i class="fas fa-spinner fa-pulse"></i></div>
            <p style="margin-top:15px;">處理中...</p>
        </div>
    `;
    document.body.appendChild(loader);
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.remove();
}

// ================================================================
// ★ 日誌記錄模組
// ================================================================

let _logActionImpl = null;

function setLogImplementation(impl) {
    _logActionImpl = impl;
}

async function logAction(collection, docId, operation, data, previousData) {
    if (typeof _logActionImpl === 'function') {
        try {
            await _logActionImpl(collection, docId, operation, data, previousData);
        } catch (e) {
            console.warn('日誌記錄失敗（非關鍵錯誤）:', e);
        }
    } else {
        console.log('[日誌]', { collection, docId, operation, data, previousData });
    }
}

function createDefaultLogImplementation() {
    return async function(collection, docId, operation, data, previousData) {
        try {
            const user = auth.currentUser ? auth.currentUser.email : 'unknown';
            await db.collection('audit_log').add({
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                user: user,
                userUid: auth.currentUser ? auth.currentUser.uid : null,
                collection: collection,
                docId: docId,
                operation: operation,
                data: data || null,
                previousData: previousData || null,
                collectionGroup: collection,
                operationType: operation
            });
        } catch (e) {
            console.warn('日誌寫入 Firestore 失敗（非關鍵錯誤）:', e);
        }
    };
}

setLogImplementation(createDefaultLogImplementation());

// ================================================================
// ★ 全域偏移量同步（Firestore）
// ================================================================

const MAP_OFFSET_DOC = 'config/mapOffset';

async function getGlobalOffsetFromFirestore() {
    try {
        const doc = await db.collection('config').doc('mapOffset').get();
        if (doc.exists && doc.data().offset !== undefined) {
            return doc.data().offset;
        }
        return 0;
    } catch (e) {
        console.warn('讀取偏移量失敗，使用 0:', e);
        return 0;
    }
}

async function setGlobalOffsetToFirestore(offset) {
    try {
        const role = await getUserRole();
        if (!['admin', 'occ'].includes(role)) {
            console.warn('無權限寫入偏移量');
            return;
        }
        await db.collection('config').doc('mapOffset').set({ offset }, { merge: true });
        console.log('偏移量已同步至雲端:', offset);
    } catch (e) {
        console.warn('寫入偏移量失敗:', e);
    }
}

function listenGlobalOffset(callback) {
    return db.collection('config').doc('mapOffset').onSnapshot((doc) => {
        if (doc.exists) {
            const offset = doc.data().offset || 0;
            callback(offset);
        } else {
            callback(0);
        }
    }, (error) => {
        console.warn('監聽偏移量失敗:', error);
    });
}

// ================================================================
// ★ 全域車廂模式同步（Firestore）
// ================================================================

const MAP_MODE_DOC = 'config/mapMode';

async function getGlobalModeFromFirestore() {
    try {
        const doc = await db.collection('config').doc('mapMode').get();
        if (doc.exists && doc.data().mode !== undefined) {
            return doc.data().mode;
        }
        return 84;
    } catch (e) {
        console.warn('讀取模式失敗，使用 84:', e);
        return 84;
    }
}

async function setGlobalModeToFirestore(mode) {
    try {
        const role = await getUserRole();
        if (!['admin', 'occ'].includes(role)) {
            console.warn('無權限寫入模式');
            return;
        }
        await db.collection('config').doc('mapMode').set({ mode }, { merge: true });
        console.log('模式已同步至雲端:', mode);
    } catch (e) {
        console.warn('寫入模式失敗:', e);
    }
}

function listenGlobalMode(callback) {
    return db.collection('config').doc('mapMode').onSnapshot((doc) => {
        if (doc.exists) {
            const mode = doc.data().mode || 84;
            callback(mode);
        } else {
            callback(84);
        }
    }, (error) => {
        console.warn('監聽模式失敗:', error);
    });
}

// ==================== 認證函數 ====================
async function login(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        return userCredential.user;
    } catch (error) {
        throw error;
    }
}

async function logout() {
    await auth.signOut();
}

function getCurrentUser() {
    return auth.currentUser;
}

function onAuthStateChanged(callback) {
    return auth.onAuthStateChanged(callback);
}

// ==================== 匯出至全域 ====================
window.db = db;
window.auth = auth;
window.realtimeDb = realtimeDb;
window.PERMISSIONS = PERMISSIONS;
window.getUserRole = getUserRole;
window.canAccessPage = canAccessPage;
window.canPerformAction = canPerformAction;
window.isAdmin = isAdmin;
window.extractDateTime = extractDateTime;
window.formatTimestamp = formatTimestamp;
window.formatTimeOnly = formatTimeOnly;
window.getGroupRescueStatus = getGroupRescueStatus;
window.getQRCodeColor = getQRCodeColor;
window.showMessage = showMessage;
window.showLoader = showLoader;
window.hideLoader = hideLoader;
window.login = login;
window.logout = logout;
window.getCurrentUser = getCurrentUser;
window.onAuthStateChanged = onAuthStateChanged;
window.getGroupStatus = getGroupStatus;
window.getCabinOverallStatus = getCabinOverallStatus;
window.getGuestDisplayStatus = getGuestDisplayStatus;
window.getStatusDisplayInfo = getStatusDisplayInfo;
window.setLogImplementation = setLogImplementation;
window.logAction = logAction;
window.getGlobalOffsetFromFirestore = getGlobalOffsetFromFirestore;
window.setGlobalOffsetToFirestore = setGlobalOffsetToFirestore;
window.listenGlobalOffset = listenGlobalOffset;
window.getGlobalModeFromFirestore = getGlobalModeFromFirestore;
window.setGlobalModeToFirestore = setGlobalModeToFirestore;
window.listenGlobalMode = listenGlobalMode;

// ================================================================
// ★ 跨域協調系統：連線狀態 + 最後同步時間
// ================================================================

let _connectionState = 'unknown';

function initConnectionMonitor() {
    const connectedRef = firebase.database().ref('.info/connected');

    connectedRef.on('value', (snap) => {
        const isConnected = snap.val() === true;
        const el = document.getElementById('connection-status');
        const textEl = document.getElementById('connection-text');

        if (!el || !textEl) return;

        if (isConnected) {
            _connectionState = 'online';
            el.classList.remove('offline', 'reconnecting');
            textEl.textContent = '已連線';
            updateLastSyncTime();
            console.log('🟢 已連線到 Firebase');
        } else {
            _connectionState = 'offline';
            el.classList.remove('reconnecting');
            el.classList.add('offline');
            textEl.textContent = '離線中';
            console.warn('🔴 已離線');
        }
    });

    try {
        db.enableNetwork().catch(() => {});
    } catch (e) {
        // 忽略
    }
}

function updateLastSyncTime() {
    const el = document.getElementById('last-sync-time');
    if (!el) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const icon = document.getElementById('sync-icon');
    if (icon) {
        icon.classList.add('sync-spinning');
        setTimeout(() => icon.classList.remove('sync-spinning'), 600);
    }
}

function getConnectionState() {
    return _connectionState;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConnectionMonitor);
} else {
    setTimeout(initConnectionMonitor, 100);
}

setInterval(() => {
    const el = document.getElementById('last-sync-time');
    if (!el || _connectionState !== 'online') return;

    const text = el.textContent;
    if (!text || text === '--:--:--') return;

    const [h, m, s] = text.split(':').map(Number);
    const syncTime = new Date();
    syncTime.setHours(h, m, s, 0);

    if (syncTime > new Date()) return;

    const diffSec = (Date.now() - syncTime.getTime()) / 1000;

    if (diffSec > 60) {
        el.style.color = '#eab308';
        el.title = `已 ${Math.round(diffSec)} 秒未收到更新`;
    } else {
        el.style.color = '';
        el.title = '';
    }
}, 30000);

window.updateLastSyncTime = updateLastSyncTime;
window.getConnectionState = getConnectionState;
window.initConnectionMonitor = initConnectionMonitor;

// ★ 通用 XSS 轉義
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

function escapeJs(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

window.escapeHtml = escapeHtml;
window.escapeJs = escapeJs;

// ================================================================
// ★ Navbar 自動隱藏（桌機 + 手機通用）
// ================================================================

let _navbarHideTimer = null;
let _navbarTouchStartY = 0;
let _navbarTouchActive = false;
let _navbarInitialized = false;

/**
 * 判斷是否為手機版
 */
function isMobileNavbar() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/**
 * 顯示 Navbar 並啟動倒數自動隱藏
 * @param {number} duration - 顯示持續時間（毫秒），預設 6000
 */
function showNavbar(duration = 6000) {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.classList.remove('mobile-hidden');

    if (_navbarHideTimer) clearTimeout(_navbarHideTimer);

    _navbarHideTimer = setTimeout(() => {
        hideNavbar();
    }, duration);
}

/**
 * 隱藏 Navbar（桌機 + 手機通用）
 */
function hideNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.classList.add('mobile-hidden');

    if (_navbarHideTimer) {
        clearTimeout(_navbarHideTimer);
        _navbarHideTimer = null;
    }

    const hint = document.getElementById('navbar-touch-hint');
    if (hint) {
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 3000);
    }
}

/**
 * 初始化 Navbar（桌機 + 手機通用）
 */
function initMobileNavbar() {
    if (_navbarInitialized) {
        console.log('📱 Navbar 已初始化，跳過');
        const navbar = document.getElementById('navbar');
        if (navbar && navbar.style.display === 'flex' && !navbar.classList.contains('mobile-hidden')) {
            showNavbar();
        }
        return;
    }
    _navbarInitialized = true;

    console.log('📱 Navbar 初始化（桌機 + 手機通用）');

    // ---- 觸發區：點擊 / 觸控 / 滑鼠移入 ----
    const touchZone = document.getElementById('navbar-touch-zone');
    if (touchZone) {
        touchZone.addEventListener('click', () => showNavbar());
        touchZone.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            showNavbar();
        }, { passive: true });
        touchZone.addEventListener('mouseenter', () => showNavbar());
    }

    // ---- 手機：從頂部向下滑動喚出 ----
    document.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        if (touch.clientY < 50) {
            _navbarTouchStartY = touch.clientY;
            _navbarTouchActive = true;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!_navbarTouchActive) return;
        const touch = e.touches[0];
        const deltaY = touch.clientY - _navbarTouchStartY;
        if (deltaY > 30) {
            showNavbar();
            _navbarTouchActive = false;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        _navbarTouchActive = false;
    }, { passive: true });

    // ---- Navbar 本身：滑鼠進入取消計時，離開重新倒數 ----
    const navbar = document.getElementById('navbar');
    if (navbar) {
        navbar.addEventListener('mouseenter', () => {
            if (_navbarHideTimer) {
                clearTimeout(_navbarHideTimer);
                _navbarHideTimer = null;
            }
        });

        navbar.addEventListener('mouseleave', () => {
            showNavbar(3000);
        });

        navbar.addEventListener('click', (e) => {
            if (e.target.closest('.nav-btn') || e.target.closest('.logout-btn')) {
                showNavbar();
            }
        });
    }

    // ---- 初次顯示：輪詢偵測 Navbar 從 display:none → flex ----
    let _lastNavbarDisplay = '';
    let _navbarCheckInterval = setInterval(() => {
        const nav = document.getElementById('navbar');
        if (!nav) return;
        const currentDisplay = nav.style.display;
        if (currentDisplay === 'flex' && _lastNavbarDisplay !== 'flex') {
            console.log('👁️ 偵測到 Navbar 顯示，啟動倒數');
            showNavbar();
            clearInterval(_navbarCheckInterval);
        }
        _lastNavbarDisplay = currentDisplay;
    }, 500);

    setTimeout(() => {
        if (_navbarCheckInterval) {
            clearInterval(_navbarCheckInterval);
            _navbarCheckInterval = null;
        }
    }, 30000);

    if (navbar && navbar.style.display === 'flex') {
        showNavbar();
        clearInterval(_navbarCheckInterval);
    }

    // ---- 切換頁面時，重新顯示 6 秒 ----
    const originalSwitchSection = window.switchSection;
    if (typeof originalSwitchSection === 'function') {
        window.switchSection = function (sectionId) {
            originalSwitchSection(sectionId);
            setTimeout(() => showNavbar(), 100);
        };
    }

    // ---- 視窗大小改變時，重新評估 ----
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const navbar = document.getElementById('navbar');
            if (!navbar) return;
            if (!navbar.classList.contains('mobile-hidden')) {
                showNavbar();
            }
        }, 200);
    });

    console.log('✅ Navbar 已啟動（桌機 + 手機通用）');
}

// 頁面載入後啟動
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initMobileNavbar, 500);
    });
} else {
    setTimeout(initMobileNavbar, 500);
}

// ★ 視窗大小改變時，重新初始化
let _navbarResizeTimer = null;
window.addEventListener('resize', () => {
    if (_navbarResizeTimer) clearTimeout(_navbarResizeTimer);
    _navbarResizeTimer = setTimeout(() => {
        console.log('🔄 視窗大小改變，重新檢查 Navbar');
        initMobileNavbar();
    }, 300);
});
// ================================================================
// ★ 上下行線標示：共用函式（map / monitor / monitor-dashboard 共用）
// 用法：addDirectionMarkers(svgElement, groundPts);
// 上方線（y - 70）= 下行線（NP → TC，箭頭向左，藍色）
// 下方線（y + 70）= 上行線（TC → NP，箭頭向右，黃色）
// ================================================================
function addDirectionMarkers(svg, groundPts) {
    if (!svg || !groundPts || groundPts.length === 0) return;

    // 先移除舊的標示
    svg.querySelectorAll('.direction-marker').forEach(el => el.remove());

    const topLinePts = groundPts.map(p => [p[0], p[1] - 70]);
    const bottomLinePts = groundPts.map(p => [p[0], p[1] + 70]);

    // ===== 下行線文字標籤（右側） =====
    const downLabel = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    downLabel.setAttribute('class', 'direction-marker direction-label-down');
    downLabel.setAttribute('transform',
        `translate(${topLinePts[topLinePts.length - 1][0] - 40}, ${topLinePts[topLinePts.length - 1][1] - 60})`);
    const downText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    downText.setAttribute('class', 'direction-text direction-text-down');
    downText.setAttribute('text-anchor', 'end');
    downText.textContent = '⬅ 下行線';
    downLabel.appendChild(downText);
    svg.appendChild(downLabel);

    // ===== 上行線文字標籤（左側） =====
    const upLabel = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    upLabel.setAttribute('class', 'direction-marker direction-label-up');
    upLabel.setAttribute('transform',
        `translate(${bottomLinePts[0][0] + 40}, ${bottomLinePts[0][1] + 70})`);
    const upText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    upText.setAttribute('class', 'direction-text direction-text-up');
    upText.setAttribute('text-anchor', 'start');
    upText.textContent = '上行線 ➡';
    upLabel.appendChild(upText);
    svg.appendChild(upLabel);

    // ===== 下行線流動虛線 =====
    const downFlow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    downFlow.setAttribute('class', 'direction-marker direction-flow-line direction-flow-down');
    downFlow.setAttribute('points', topLinePts.map(p => p.join(',')).join(' '));
    svg.appendChild(downFlow);

    // ===== 上行線流動虛線 =====
    const upFlow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    upFlow.setAttribute('class', 'direction-marker direction-flow-line direction-flow-up');
    upFlow.setAttribute('points', bottomLinePts.map(p => p.join(',')).join(' '));
    svg.appendChild(upFlow);

    // ===== 下行線箭頭（藍色，向左） =====
      // ===== 下行線箭頭（藍色，向左）=====
    // ★ 往外移：上方線的箭頭再往上偏 40px
    for (let i = 0; i < topLinePts.length - 1; i++) {
        const [x1, y1] = topLinePts[i];
        const [x2, y2] = topLinePts[i + 1];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - 40;   // ★ 往上移 40px（遠離索道）
        const angle = Math.atan2(y1 - y2, x1 - x2) * 180 / Math.PI;

        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrow.setAttribute('class', 'direction-marker direction-arrow direction-arrow-down');
        arrow.setAttribute('points', '0,-16 32,0 0,16');
        arrow.setAttribute('transform', `translate(${mx},${my}) rotate(${angle})`);
        arrow.style.setProperty('--anim-delay', `${i * 0.15}s`);
        svg.appendChild(arrow);
    }

    // ===== 上行線箭頭（黃色，向右）=====
    // ★ 往外移：下方線的箭頭再往下偏 40px
    for (let i = 0; i < bottomLinePts.length - 1; i++) {
        const [x1, y1] = bottomLinePts[i];
        const [x2, y2] = bottomLinePts[i + 1];
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 + 40;   // ★ 往下移 40px（遠離索道）
        const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrow.setAttribute('class', 'direction-marker direction-arrow direction-arrow-up');
        arrow.setAttribute('points', '0,-16 32,0 0,16');
        arrow.setAttribute('transform', `translate(${mx},${my}) rotate(${angle})`);
        arrow.style.setProperty('--anim-delay', `${i * 0.15}s`);
        svg.appendChild(arrow);
    }
}

// ★ 暴露全域
window.addDirectionMarkers = addDirectionMarkers;
// ★ 暴露全域
window.showNavbar = showNavbar;
window.hideNavbar = hideNavbar;
window.initMobileNavbar = initMobileNavbar;

console.log('✅ common.js 已載入（含連線監控 + Navbar 自動隱藏）');
