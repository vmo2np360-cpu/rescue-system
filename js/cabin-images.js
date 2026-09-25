// ================================================================
// cabin-images.js - 車廂圖片共用模組（Firebase Storage + Firestore）
// 依賴：common.js（firebase, db, auth, realtimeDb, getUserRole, logAction）
// ================================================================

const cabinStorage = firebase.storage();

const CABIN_IMG_MAX_DIM = 1600;
const CABIN_IMG_QUALITY = 0.82;
const CABIN_IMG_MAX_UPLOAD = 2 * 1024 * 1024;   // 2MB 硬上限
const CABIN_IMG_MAX_PER_CABIN = 30;

window.CABIN_TYPES = ['標準車廂', '水晶車廂', '全景車廂', '工程車'];

// ---- 壓縮圖片 ----
function cabinCompressImage(file, maxDim = CABIN_IMG_MAX_DIM, quality = CABIN_IMG_QUALITY) {
    if (!file.type.startsWith('image/')) return Promise.reject(new Error('不是圖片檔案'));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                const scale = Math.min(1, maxDim / Math.max(width, height));
                width = Math.round(width * scale);
                height = Math.round(height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('壓縮失敗'));
                    resolve({ blob, width, height, originalSize: file.size });
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('圖片載入失敗'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('讀取檔案失敗'));
        reader.readAsDataURL(file);
    });
}

// ---- 驗證車廂號碼 ----
function cabinValidateSeq(seq) {
    if (!seq || !seq.trim()) return false;
    // 中英數、-、_，1~20 字
    return /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,20}$/.test(seq.trim());
}

// ---- 上傳單張 ----
async function uploadCabinPhoto(cabinSeq, cabinType, file, note = '', onProgress) {
    if (!cabinValidateSeq(cabinSeq)) throw new Error('車廂號碼格式不正確');
    const role = await window.getUserRole();
    if (!['admin', 'occ'].includes(role)) throw new Error('您沒有權限上傳');

    onProgress && onProgress({ phase: 'compress', percent: 0 });
    const { blob, width, height, originalSize } = await cabinCompressImage(file);
    if (blob.size > CABIN_IMG_MAX_UPLOAD) {
        throw new Error(`壓縮後仍超過 ${(CABIN_IMG_MAX_UPLOAD / 1024 / 1024).toFixed(1)}MB`);
    }

    const timestamp = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const photoId = 'p_' + timestamp;
    const storagePath = `cabin-images/${cabinSeq}/${timestamp}.jpg`;
    const ref = cabinStorage.ref(storagePath);

    onProgress && onProgress({ phase: 'upload', percent: 0 });
    const task = ref.put(blob, { contentType: 'image/jpeg' });
    task.on('state_changed', (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress && onProgress({ phase: 'upload', percent: pct });
    });
    await task;
    const url = await ref.getDownloadURL();

    // 更新 Firestore
    const docRef = window.db.collection('cabin_images').doc(cabinSeq);
    const doc = await docRef.get();
    const oldData = doc.exists ? doc.data() : { photos: [] };
    const photos = Array.isArray(oldData.photos) ? oldData.photos.slice() : [];

    if (photos.length >= CABIN_IMG_MAX_PER_CABIN) {
        await ref.delete().catch(() => {});
        throw new Error(`每個車廂最多 ${CABIN_IMG_MAX_PER_CABIN} 張圖片`);
    }

    const newPhoto = {
        id: photoId,
        url, storagePath,
        width, height,
        size: blob.size,
        originalSize,
        note: (note || '').trim(),
        uploadedAt: new Date().toISOString(),
        uploadedBy: (window.auth.currentUser && window.auth.currentUser.email) || 'unknown'
    };
    photos.unshift(newPhoto);

    await docRef.set({
        cabinSeq,
        cabinType: cabinType || oldData.cabinType || '標準車廂',
        photos,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await window.logAction('cabin_images', cabinSeq, 'upload', newPhoto, oldData);
    return newPhoto;
}

// ---- 刪除單張 ----
async function deleteCabinPhoto(cabinSeq, photoId) {
    const role = await window.getUserRole();
    if (!['admin', 'occ'].includes(role)) throw new Error('您沒有權限刪除');

    const docRef = window.db.collection('cabin_images').doc(cabinSeq);
    const doc = await docRef.get();
    if (!doc.exists) throw new Error('找不到此車廂圖片記錄');
    const data = doc.data();
    const removed = (data.photos || []).find(p => p.id === photoId);
    if (!removed) throw new Error('找不到此圖片');

    const photos = (data.photos || []).filter(p => p.id !== photoId);
    await docRef.update({
        photos,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (removed.storagePath) {
        cabinStorage.ref(removed.storagePath).delete().catch(() => {});
    }
    await window.logAction('cabin_images', cabinSeq, 'delete',
        { photoId, storagePath: removed.storagePath }, null);
}

// ---- 修改備註 ----
async function updateCabinPhotoNote(cabinSeq, photoId, newNote) {
    const role = await window.getUserRole();
    if (!['admin', 'occ'].includes(role)) throw new Error('您沒有權限修改');

    const docRef = window.db.collection('cabin_images').doc(cabinSeq);
    const doc = await docRef.get();
    if (!doc.exists) throw new Error('找不到此車廂圖片記錄');
    const photos = (doc.data().photos || []).map(p =>
        p.id === photoId ? { ...p, note: (newNote || '').trim() } : p
    );
    await docRef.update({
        photos,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// ---- 更新車廂類型 ----
async function updateCabinType(cabinSeq, cabinType) {
    const role = await window.getUserRole();
    if (!['admin', 'occ'].includes(role)) throw new Error('您沒有權限修改');
    await window.db.collection('cabin_images').doc(cabinSeq).set({
        cabinSeq,
        cabinType,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

// ---- 取單一車廂資料 ----
async function getCabinImages(cabinSeq) {
    if (!cabinSeq) return null;
    try {
        const doc = await window.db.collection('cabin_images').doc(cabinSeq).get();
        return doc.exists ? doc.data() : null;
    } catch (e) {
        console.warn('讀取車廂圖片失敗:', e);
        return null;
    }
}

// ---- 監聽（給 map / monitor 用） ----
function listenCabinImages(cabinSeq, callback) {
    if (!cabinSeq) { callback(null); return () => {}; }
    return window.db.collection('cabin_images').doc(cabinSeq).onSnapshot(
        (doc) => callback(doc.exists ? doc.data() : null),
        (err) => console.warn('監聽車廂圖片失敗:', err)
    );
}

// ---- 取全部（管理頁用） ----
async function getAllCabinImages() {
    const snap = await window.db.collection('cabin_images').get();
    const list = [];
    snap.forEach(d => list.push({ _id: d.id, ...d.data() }));
    return list;
}

// ---- 暴露全域 ----
window.cabinCompressImage = cabinCompressImage;
window.cabinValidateSeq = cabinValidateSeq;
window.uploadCabinPhoto = uploadCabinPhoto;
window.deleteCabinPhoto = deleteCabinPhoto;
window.updateCabinPhotoNote = updateCabinPhotoNote;
window.updateCabinType = updateCabinType;
window.getCabinImages = getCabinImages;
window.listenCabinImages = listenCabinImages;
window.getAllCabinImages = getAllCabinImages;

console.log('✅ cabin-images.js 已載入');
