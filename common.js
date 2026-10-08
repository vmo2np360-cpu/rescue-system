// ==================== Firebase 初始化 ====================
const firebaseConfig = {
    apiKey: "AIzaSyCgSaPKhaaX9cP1tY-ThykJvo_sJtVyyDcfunction showNavbar(duration = 10000) {
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
// 可透過 Console 即時調整：
//   mdSetStationX('NP', 2800)
//   mdSetStationY('NP', 300)
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
        'monitor_dashboard': ['admin', 'occ', 're'],   // ★ 新增這行
        'audit': ['admin', 'occ'],
        'index_cabin_photos': ['admin', 'occ'],

    },
    collections: {
      'guests': {
    create: ['admin', 'gs', 'occ'],
    read:   ['admin', 'gs', 'ap', 'occ'],
    update: ['admin', 'gs', 'ap', 'occ'],
    delete: ['admin', 'gs', 'occ', 'ap'],   // ★ 加入 ap
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
// ★ 日誌記錄模組（方案 A + 抽象層）
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
// ★ 全域車廂模式同步（Firestore）【新增】
// ================================================================

const MAP_MODE_DOC = 'config/mapMode';

async function getGlobalModeFromFirestore() {
    try {
        const doc = await db.collection('config').doc('mapMode').get();
        if (doc.exists && doc.data().mode !== undefined) {
            return doc.data().mode;
        }
        return 84; // 預設值
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
// ★ 新增模式同步函數匯出
window.getGlobalModeFromFirestore = getGlobalModeFromFirestore;
window.setGlobalModeToFirestore = setGlobalModeToFirestore;
window.listenGlobalMode = listenGlobalMode;

// ================================================================
// ★ 跨域協調系統：連線狀態 + 最後同步時間
// ================================================================

let _connectionState = 'unknown'; // 'online' | 'offline' | 'reconnecting'

/**
 * 監聽 Firebase Realtime DB 連線狀態
 * .info/connected 是 Firebase 內建的特殊路徑，會即時反映連線狀態
 */
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
            // 恢復連線時，立即更新一次同步時間
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

    // Firestore 也有連線監聽（作為補充）
    try {
        db.enableNetwork().catch(() => {});
    } catch (e) {
        // 忽略
    }
}

/**
 * 更新「最後同步時間」顯示
 * 每當 Firestore / Realtime DB 有資料更新時呼叫
 */
function updateLastSyncTime() {
    const el = document.getElementById('last-sync-time');
    if (!el) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // 圖示旋轉動畫
    const icon = document.getElementById('sync-icon');
    if (icon) {
        icon.classList.add('sync-spinning');
        setTimeout(() => icon.classList.remove('sync-spinning'), 600);
    }
}

/**
 * 取得目前連線狀態
 */
function getConnectionState() {
    return _connectionState;
}

// 頁面載入後啟動連線監聽
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConnectionMonitor);
} else {
    // DOM 已就緒（動態載入時可能已經過了 DOMContentLoaded）
    setTimeout(initConnectionMonitor, 100);
}

// 每 30 秒檢查一次，若超過 60 秒沒同步就顯示警告
setInterval(() => {
    const el = document.getElementById('last-sync-time');
    if (!el || _connectionState !== 'online') return;

    const text = el.textContent;
    if (!text || text === '--:--:--') return;

    // 解析 HH:MM:SS
    const [h, m, s] = text.split(':').map(Number);
    const syncTime = new Date();
    syncTime.setHours(h, m, s, 0);

    // 若同步時間大於現在，代表是跨日或剛跨過午夜，忽略
    if (syncTime > new Date()) return;

    const diffSec = (Date.now() - syncTime.getTime()) / 1000;

    if (diffSec > 60) {
        // 超過 60 秒沒同步 → 顯示警告色
        el.style.color = '#eab308';
        el.title = `已 ${Math.round(diffSec)} 秒未收到更新`;
    } else {
        el.style.color = '';
        el.title = '';
    }
}, 30000);

// ★ 暴露全域
window.updateLastSyncTime = updateLastSyncTime;
window.getConnectionState = getConnectionState;
window.initConnectionMonitor = initConnectionMonitor;

// ★ 通用 XSS 轉義（統一版本）
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
// ★ 手機版 Navbar：10 秒自動隱藏 + 觸控喚出
// ================================================================

let _navbarHideTimer = null;
let _navbarTouchStartY = 0;
let _navbarTouchActive = false;

/**
 * 判斷是否為手機版
 */
function isMobileNavbar() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/**
 * 顯示 Navbar 並啟動 10 秒倒數自動隱藏
 * @param {number} duration - 顯示持續時間（毫秒），預設 10000
 */
function showNavbar(duration = 6000) {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    // 顯示
    navbar.classList.remove('mobile-hidden');

    // 清除舊的計時器
    if (_navbarHideTimer) clearTimeout(_navbarHideTimer);

    // 時間到自動隱藏
    _navbarHideTimer = setTimeout(() => {
        hideNavbar();
    }, duration);
}

function hideNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.classList.add('mobile-hidden');

    if (_navbarHideTimer) {
        clearTimeout(_navbarHideTimer);
        _navbarHideTimer = null;
    }

    // 顯示提示 3 秒
    const hint = document.getElementById('navbar-touch-hint');
    if (hint) {
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 3000);
    }
}

    // 顯示
    navbar.classList.remove('mobile-hidden');

    // 清除舊的計時器
    if (_navbarHideTimer) clearTimeout(_navbarHideTimer);

    // 10 秒後自動隱藏
    _navbarHideTimer = setTimeout(() => {
        hideNavbar();
    }, duration);
}

/**
 * 隱藏 Navbar（手機版才有效）
 */
function hideNavbar() {
    if (!isMobileNavbar()) return;

    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.classList.add('mobile-hidden');

    if (_navbarHideTimer) {
        clearTimeout(_navbarHideTimer);
        _navbarHideTimer = null;
    }

    // 顯示提示 3 秒（告知使用者如何喚出）
    const hint = document.getElementById('navbar-touch-hint');
    if (hint) {
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 3000);
    }
}

/**
 * 初始化手機版 Navbar 觸控監聽
 */
let _navbarInitialized = false;

function initMobileNavbar() {
    // ★ 移除「桌面版略過」判斷，讓桌機也初始化

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
        // ★ 桌機：滑鼠移到頂部就喚出
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
        // ★ 桌機：滑鼠在 Navbar 上時，不隱藏
        navbar.addEventListener('mouseenter', () => {
            if (_navbarHideTimer) {
                clearTimeout(_navbarHideTimer);
                _navbarHideTimer = null;
            }
        });

        // ★ 桌機：滑鼠離開 Navbar 後，3 秒後隱藏
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

    // ---- 切換頁面時，重新顯示 10 秒 ----
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

    console.log('✅ Navbar 已啟動（桌機 + 手機通用，10 秒自動隱藏）');
}
    // ★ 若已初始化，不重複註冊事件
    if (_navbarInitialized) {
        console.log('📱 手機版 Navbar 已初始化，跳過');
        // 但還是要啟動計時器（若 navbar 已顯示）
        const navbar = document.getElementById('navbar');
        if (navbar && navbar.style.display === 'flex' && !navbar.classList.contains('mobile-hidden')) {
            showNavbar();
        }
        return;
    }
    _navbarInitialized = true;

    console.log('📱 手機版 Navbar 初始化');

    // ---- 觸控區點擊喚出 ----
    const touchZone = document.getElementById('navbar-touch-zone');
    if (touchZone) {
        touchZone.addEventListener('click', () => {
            showNavbar();
        });
        touchZone.addEventListener('touchstart', (e) => {
            // 阻止瀏覽器原生下拉刷新（避免衝突）
            e.stopPropagation();
            showNavbar();
        }, { passive: true });
    }

    // ---- 從頂部向下滑動喚出 ----
    document.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        // 只有在螢幕頂部 50px 內才啟動
        if (touch.clientY < 50) {
            _navbarTouchStartY = touch.clientY;
            _navbarTouchActive = true;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!_navbarTouchActive) return;
        const touch = e.touches[0];
        const deltaY = touch.clientY - _navbarTouchStartY;

        // 向下滑動超過 30px 就喚出
        if (deltaY > 30) {
            showNavbar();
            _navbarTouchActive = false;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        _navbarTouchActive = false;
    }, { passive: true });

    // ---- 點擊 Navbar 內的按鈕時重置計時器 ----
    const navbar = document.getElementById('navbar');
    if (navbar) {
        navbar.addEventListener('click', (e) => {
            // 若點到導航按鈕，重置 10 秒
            if (e.target.closest('.nav-btn') || e.target.closest('.logout-btn')) {
                showNavbar();
            }
        });
    }

    // ---- 初次顯示：頁面載入後 10 秒自動隱藏 ----
    // 等 navbar 顯示（登入後會從 display:none → flex）再啟動計時
     // ---- 初次顯示：輪詢偵測 Navbar 從 display:none 變成 flex ----
    // ---- 初次顯示：輪詢偵測 Navbar 從 display:none 變成 flex ----
    let _lastNavbarDisplay = '';
    let _navbarCheckInterval = setInterval(() => {   // ★ const → let
        const nav = document.getElementById('navbar');
        if (!nav) return;

        const currentDisplay = nav.style.display;

        // 偵測到 Navbar 從非 flex 變成 flex（登入成功）
        if (currentDisplay === 'flex' && _lastNavbarDisplay !== 'flex') {
            console.log('👁️ 偵測到 Navbar 顯示，啟動 10 秒倒數');
            showNavbar();
            clearInterval(_navbarCheckInterval);
        }

        _lastNavbarDisplay = currentDisplay;
    }, 500);

    // 保險：30 秒後仍未偵測到 navbar，強制停止輪詢
    setTimeout(() => {
        if (_navbarCheckInterval) {
            clearInterval(_navbarCheckInterval);
            _navbarCheckInterval = null;   // ✅ let 可以重新賦值
        }
    }, 30000);

    // 立即檢查一次（處理已登入狀態）
    if (navbar && navbar.style.display === 'flex') {
        console.log('👁️ Navbar 已顯示，立即啟動 10 秒倒數');
        showNavbar();
        clearInterval(_navbarCheckInterval);
    }

    // ---- 切換頁面時，重新顯示 10 秒 ----
    // 攔截 switchSection
    const originalSwitchSection = window.switchSection;
    if (typeof originalSwitchSection === 'function') {
        window.switchSection = function (sectionId) {
            originalSwitchSection(sectionId);
            // 切換頁面後重新顯示
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

            if (isMobileNavbar()) {
                // 從桌面切到手機：啟動自動隱藏
                if (!navbar.classList.contains('mobile-hidden')) {
                    showNavbar();
                }
            } else {
                // 從手機切到桌面：移除隱藏狀態
                navbar.classList.remove('mobile-hidden');
                if (_navbarHideTimer) {
                    clearTimeout(_navbarHideTimer);
                    _navbarHideTimer = null;
                }
            }
        }, 200);
    });

    console.log('✅ 手機版 Navbar 已啟動（10 秒自動隱藏）');
}

// 頁面載入後啟動
// 頁面載入後啟動
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initMobileNavbar, 500);
    });
} else {
    setTimeout(initMobileNavbar, 500);
}

// ★ 修復：視窗大小改變時（例如 DevTools 切換手機模式），重新初始化
let _navbarResizeTimer = null;
window.addEventListener('resize', () => {
    if (_navbarResizeTimer) clearTimeout(_navbarResizeTimer);
    _navbarResizeTimer = setTimeout(() => {
        console.log('🔄 視窗大小改變，重新檢查手機 Navbar');
        initMobileNavbar();
    }, 300);
});

// ★ 暴露全域
window.showNavbar = showNavbar;
window.hideNavbar = hideNavbar;
window.initMobileNavbar = initMobileNavbar;

console.log('✅ common.js 已載入（含連線監控 + 手機 Navbar）');
