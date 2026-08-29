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
        'audit': ['admin', 'occ'],
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

console.log('✅ common.js 已載入');
