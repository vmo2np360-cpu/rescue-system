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

// ==================== 權限設定檔 ====================
const PERMISSIONS = {
    pages: {
        'index_ground_support': ['admin', 'gs'],
        'index_assembly_point': ['admin', 'ap'],
        'index_dashboard': ['admin', 'ap', 'occ', 're', 'gr'],
        'index_rescue_map': ['admin', 'occ'],
        'recourse': ['admin', 'occ', 'gr'],
        'monitor': ['admin', 'occ', 're'],
    },
    collections: {
        'guests': {
            create: ['admin', 'gs', 'occ'],
            read: ['admin', 'gs', 'ap', 'occ'],
            update: ['admin', 'gs', 'ap', 'occ'],
            delete: ['admin', 'gs', 'occ'],
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

function getGroupStatus(guest) {
    if (guest.status) {
        if (['landed', 'rescuing', 'waiting'].includes(guest.status)) {
            return guest.status;
        }
        if (guest.status === 'completed') {
            return 'landed';
        }
    }
    if (guest.timeLanded) return 'landed';
    if (guest.exitTime && guest.exitMethod) return 'landed';
    if (guest.timeReachedTop || guest.rescuedBy) return 'rescuing';
    if (guest.ambulance === '需要') return 'rescuing';
    return 'waiting';
}

// ★ 新增：Dashboard 專用狀態判斷（已離開 > 已著陸 > 救援中 > 等待救援）
function getGuestDisplayStatus(guest) {
    // 1. 最高優先：已離開（有 exitTime 或 exitMethod）
    if (guest.exitTime || guest.exitMethod) {
        return 'departed';
    }
    // 2. 已著陸（有 timeLanded）
    if (guest.timeLanded) {
        return 'landed';
    }
    // 3. 救援中（有 timeReachedTop）
    if (guest.timeReachedTop) {
        return 'rescuing';
    }
    // 4. 等待救援（預設）
    return 'waiting';
}

// ★ 新增：取得狀態顯示文字與 CSS 類別
function getStatusDisplayInfo(status) {
    const map = {
        'waiting':   { text: '等待救援', badge: 'status-waiting' },
        'rescuing':  { text: '救援中',   badge: 'status-pending' },
        'landed':    { text: '已著陸',   badge: 'status-complete' },
        'departed':  { text: '已離開',   badge: 'status-departed' }
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
    if (type === 'success') el.classList.add('message-success');
    else if (type === 'error') el.classList.add('message-error');
    else if (type === 'info') el.classList.add('message-info');

    if (duration > 0) {
        setTimeout(() => {
            el.textContent = '';
            el.className = 'message';
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
window.getGuestDisplayStatus = getGuestDisplayStatus;
window.getStatusDisplayInfo = getStatusDisplayInfo;

console.log('✅ common.js 已載入');
