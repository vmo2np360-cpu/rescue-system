// ================================================================
// cabin-photos.js - 車廂照片管理頁面邏輯
// 依賴：common.js, cabin-images.js
// ================================================================

let cpAllPhotos = [];
let cpCabinOrderMode = 84;
let cpInitialized = false;

// ---------- 初始化 ----------
async function cpInit() {
    console.log('🚀 cpInit 初始化車廂照片管理頁');
    if (cpInitialized) {
        // 已初始化過（切回分頁時），只需重新載入資料
        await cpLoadAllPhotos();
        return;
    }
    cpInitialized = true;

    try {
        await cpLoadAllPhotos();
        cpPopulateCabinSeqDatalist();
    } catch (e) {
        console.error('cpInit 載入失敗:', e);
    }
}

// ---------- Tab 切換 ----------
function cpSwitchTab(tab) {
    const photosTab = document.getElementById('cp-tab-photos');
    const orderTab = document.getElementById('cp-tab-order');
    const btns = document.querySelectorAll('.tab-btn');

    if (tab === 'photos') {
        photosTab.style.display = '';
        orderTab.style.display = 'none';
    } else {
        photosTab.style.display = 'none';
        orderTab.style.display = '';
    }

    btns.forEach(b => {
        if (b.dataset.tab === tab) {
            b.classList.add('tab-active');
            b.style.color = '#1e3a5f';
            b.style.borderBottomColor = '#2563eb';
        } else {
            b.classList.remove('tab-active');
            b.style.color = '#64748b';
            b.style.borderBottomColor = 'transparent';
        }
    });

    if (tab === 'order') cpLoadCabinOrder();
}

// ---------- 載入所有圖片 ----------
async function cpLoadAllPhotos() {
    try {
        cpAllPhotos = await window.getAllCabinImages();
        cpRenderPhotoList();
    } catch (e) {
        console.error(e);
        alert('載入失敗: ' + e.message);
    }
}

// ---------- 車廂號碼 datalist ----------
async function cpPopulateCabinSeqDatalist() {
    const dl = document.getElementById('cp-cabin-seq-list');
    if (!dl) return;
    const seqs = new Set();
    cpAllPhotos.forEach(p => p.cabinSeq && seqs.add(p.cabinSeq));

    try {
        const snap = await window.realtimeDb.ref('cabins').once('value');
        const data = snap.val() || {};
        Object.values(data).forEach(c => {
            if (c && c.sequence) seqs.add(c.sequence);
        });
    } catch (e) {
        console.warn('讀取 RTDB cabins 失敗:', e);
    }

    const sorted = Array.from(seqs).sort((a, b) => String(a).localeCompare(String(b), 'zh'));
    dl.innerHTML = sorted.map(s => `<option value="${cpEscape(s)}"></option>`).join('');
}

// ---------- 上傳 ----------
async function cpHandleUpload() {
    const seq = document.getElementById('cp-cabin-seq').value.trim();
    const type = document.getElementById('cp-cabin-type').value;
    const note = document.getElementById('cp-photo-note').value.trim();
    const files = Array.from(document.getElementById('cp-photo-files').files || []);
    const btn = document.getElementById('cp-btn-upload');
    const progressBox = document.getElementById('cp-upload-progress');
    const progressBar = progressBox.querySelector('div');

    if (!seq) return alert('請輸入車廂號碼');
    if (!window.cabinValidateSeq(seq)) return alert('車廂號碼格式不正確（僅限中英數、-_，1~20 字）');
    if (files.length === 0) return alert('請選擇至少一張圖片');

    btn.disabled = true;
    btn.textContent = '處理中...';
    progressBox.style.display = 'block';
    progressBar.style.width = '0%';

    try {
        // 先更新車廂類型
        await window.updateCabinType(seq, type);

        let done = 0;
        for (const file of files) {
            await window.uploadCabinPhoto(seq, type, file, note, ({ percent }) => {
                const overall = ((done + percent / 100) / files.length) * 100;
                progressBar.style.width = overall + '%';
            });
            done++;
        }

        document.getElementById('cp-photo-files').value = '';
        document.getElementById('cp-photo-note').value = '';
        alert(`✅ 已上傳 ${files.length} 張圖片`);
        await cpLoadAllPhotos();
        await cpPopulateCabinSeqDatalist();
    } catch (e) {
        console.error(e);
        alert('上傳失敗: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '⬆️ 上傳';
        progressBox.style.display = 'none';
        progressBar.style.width = '0%';
    }
}

// ---------- 渲染列表 ----------
function cpRenderPhotoList() {
    const container = document.getElementById('cp-photo-list');
    if (!container) return;

    const searchTerm = (document.getElementById('cp-photo-search').value || '').toLowerCase();
    const typeFilter = document.getElementById('cp-photo-type-filter').value || '';

    let all = [];
    cpAllPhotos.forEach(cabin => {
        (cabin.photos || []).forEach(p => {
            all.push({
                ...p,
                cabinSeq: cabin.cabinSeq,
                cabinType: cabin.cabinType || '標準車廂'
            });
        });
    });
    all.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

    if (searchTerm) {
        all = all.filter(p =>
            (p.cabinSeq || '').toLowerCase().includes(searchTerm) ||
            (p.note || '').toLowerCase().includes(searchTerm)
        );
    }
    if (typeFilter) all = all.filter(p => p.cabinType === typeFilter);

    const statsEl = document.getElementById('cp-photo-stats');
    if (statsEl) statsEl.textContent = `共 ${cpAllPhotos.length} 個車廂、${all.length} 張圖片`;

    if (all.length === 0) {
        container.innerHTML = `<div style="grid-column:1/-1; background:white; padding:40px; border-radius:10px; text-align:center; color:#94a3b8;">✨ 沒有符合條件的圖片 ✨</div>`;
        return;
    }

    container.innerHTML = all.map(p => {
        const timeStr = p.uploadedAt
            ? new Date(p.uploadedAt).toLocaleString('zh-TW', { hour12: false })
            : '-';
        return `
            <div style="background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.06); border-left:4px solid #2563eb; overflow:hidden;">
                <img src="${cpEscape(p.url)}"
                     style="width:100%; height:160px; object-fit:cover; cursor:pointer; background:#f1f5f9;"
                     onclick="cpOpenImageModal('${cpEscapeJs(p.url)}', '${cpEscapeJs(p.cabinSeq)}')"
                     onerror="this.style.display='none'">
                <div style="padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
                        <div>
                            <div style="font-weight:700; font-size:1rem;">🚠 ${cpEscape(p.cabinSeq)}</div>
                            <div style="font-size:0.75rem; color:#64748b;">${cpEscape(p.cabinType)}</div>
                        </div>
                        <span style="font-size:0.7rem; background:#dbeafe; color:#1e40af; padding:3px 8px; border-radius:6px; white-space:nowrap;">
                            ${(p.size / 1024).toFixed(0)} KB
                        </span>
                    </div>
                    ${p.note ? `<div style="font-size:0.85rem; color:#334155; margin-bottom:6px; word-break:break-word;">📝 ${cpEscape(p.note)}</div>` : ''}
                    <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:10px;">
                        ${timeStr}<br>${cpEscape(p.uploadedBy || '')}
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="cpOpenNoteEditor('${cpEscapeJs(p.cabinSeq)}', '${cpEscapeJs(p.id)}')"
                                style="flex:1; background:#dbeafe; color:#1e40af; padding:6px; border:none; border-radius:6px; font-size:0.8rem; cursor:pointer; font-weight:500;">
                            ✏️ 編輯備註
                        </button>
                        <button onclick="cpHandleDeletePhoto('${cpEscapeJs(p.cabinSeq)}', '${cpEscapeJs(p.id)}')"
                                style="flex:1; background:#fee2e2; color:#b91c1c; padding:6px; border:none; border-radius:6px; font-size:0.8rem; cursor:pointer; font-weight:500;">
                            🗑️ 刪除
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ---------- 圖片放大 ----------
function cpOpenImageModal(url, title) {
    const modal = document.getElementById('cpImageModal');
    document.getElementById('cpModalImage').src = url;
    document.getElementById('cpModalInfo').textContent = '車廂 ' + title;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function cpCloseImageModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('cpImageModal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

// ESC 關閉
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cpCloseImageModal();
});

// ---------- 編輯備註 ----------
function cpOpenNoteEditor(cabinSeq, photoId) {
    const cabin = cpAllPhotos.find(c => c.cabinSeq === cabinSeq);
    const photo = cabin && (cabin.photos || []).find(p => p.id === photoId);
    const current = photo ? (photo.note || '') : '';
    const note = prompt('請輸入備註：', current);
    if (note === null) return;
    (async () => {
        try {
            await window.updateCabinPhotoNote(cabinSeq, photoId, note);
            await cpLoadAllPhotos();
        } catch (e) {
            alert('修改失敗: ' + e.message);
        }
    })();
}

// ---------- 刪除 ----------
async function cpHandleDeletePhoto(cabinSeq, photoId) {
    if (!confirm(`確定要刪除車廂 ${cabinSeq} 的這張圖片嗎？`)) return;
    try {
        await window.deleteCabinPhoto(cabinSeq, photoId);
        await cpLoadAllPhotos();
    } catch (e) {
        alert('刪除失敗: ' + e.message);
    }
}

// ================================================================
// Tab 2：車廂順序
// ================================================================
async function cpLoadCabinOrder() {
    try {
        const snap = await window.realtimeDb.ref('cabins').once('value');
        const data = snap.val() || {};

        // 從 Firestore 讀模式
        const mode = await window.getGlobalModeFromFirestore();
        cpCabinOrderMode = (mode === 109) ? 109 : 84;

        document.querySelectorAll('input[name="cp-order-mode"]').forEach(r => {
            r.checked = parseInt(r.value) === cpCabinOrderMode;
        });

        cpRenderCabinOrderInputs(data);
    } catch (e) {
        console.error('載入車廂順序失敗:', e);
    }
}

function cpRenderCabinOrderInputs(data) {
    data = data || {};
    const total = cpCabinOrderMode;
    let html = '';
    for (let i = 0; i < total; i++) {
        const id = `cabin-${i}`;
        const seq = (data[id] && data[id].sequence) || '';
        html += `
            <div style="display:flex; align-items:center; gap:8px; background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0;">
                <span style="width:42px; text-align:right; color:#64748b; font-family:monospace; font-size:0.85rem; flex-shrink:0;">${i + 1}.</span>
                <input type="text" data-cabin-index="${i}" value="${cpEscape(seq)}"
                       placeholder="車廂號碼"
                       style="flex:1; padding:6px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:0.9rem; outline:none; min-width:0;"
                       onfocus="this.style.borderColor='#2563eb'"
                       onblur="this.style.borderColor='#e2e8f0'">
            </div>
        `;
    }
    document.getElementById('cp-order-inputs').innerHTML = html;
}

function cpSetOrderMode(mode) {
    cpCabinOrderMode = mode;
    cpLoadCabinOrder();
}
// ---- CSV 解析並填入 ----
function cpParseCsvToInputs() {
    const csvText = (document.getElementById('cp-csv-input').value || '').trim();
    if (!csvText) {
        alert('請先貼上 CSV 資料');
        return;
    }

    // 支援：換行、逗號、Tab、空白、中文逗號
    const seqs = csvText
        .split(/[\r\n,\t，\s]+/)
        .map(s => s.trim())
        .filter(s => s);

    if (seqs.length === 0) {
        alert('沒有解析到有效的車廂號碼');
        return;
    }

    const inputs = document.querySelectorAll('#cp-order-inputs input');
    if (inputs.length === 0) {
        alert('順序輸入框尚未載入，請稍候');
        return;
    }

    if (seqs.length > inputs.length) {
        if (!confirm(`CSV 有 ${seqs.length} 個號碼，但 ${cpCabinOrderMode} 模式下只有 ${inputs.length} 個位置。\n多的會被忽略，要繼續嗎？`)) return;
    }

    // 檢查格式
    const invalid = seqs.slice(0, inputs.length).filter(s => !window.cabinValidateSeq(s));
    if (invalid.length > 0) {
        const preview = invalid.slice(0, 5).join(', ') + (invalid.length > 5 ? ' ...' : '');
        if (!confirm(`⚠️ 有 ${invalid.length} 個號碼格式可能不正確：\n${preview}\n\n仍要填入嗎？（套用時也會再檢查一次）`)) return;
    }

    let filled = 0;
    inputs.forEach((inp, i) => {
        inp.value = seqs[i] || '';
        if (seqs[i]) filled++;
    });

    alert(`✅ 已解析 ${seqs.length} 個號碼，填入 ${filled} 個位置\n\n記得點「✅ 套用到地圖」才會生效`);
}
async function cpClearOrderInputs() {
    const inputs = document.querySelectorAll('#cp-order-inputs input');
    if (inputs.length === 0) return;

    const hasValue = Array.from(inputs).some(inp => inp.value.trim() !== '');
    if (!hasValue) {
        alert('目前沒有資料可清空');
        return;
    }

    if (!confirm(`確定清空這 ${cpCabinOrderMode} 個車廂號碼嗎？\n\n⚠️ 這會同步清空雲端資料，地圖與監控頁的車廂號碼都會立即變空白。`)) return;

    // 1) 清 UI
    inputs.forEach(inp => inp.value = '');

    // 2) 清 Firebase
    try {
        if (typeof showLoader === 'function') showLoader();
        const updates = {};
        for (let i = 0; i < cpCabinOrderMode; i++) {
            updates[`cabin-${i}/sequence`] = '';
        }
        await window.realtimeDb.ref('cabins').update(updates);
        if (typeof showMessage === 'function') {
            showMessage('mapMessage', '✅ 已清空所有車廂號碼（雲端已同步）', 'success');
        }
        alert('✅ 已清空所有車廂號碼（雲端已同步）');
    } catch (e) {
        console.error('清空失敗:', e);
        alert('清空失敗: ' + e.message);
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

async function cpImportOrderFromMap() {
    if (!confirm('從地圖現有順序載入？目前輸入框內容會被覆蓋')) return;
    await cpLoadCabinOrder();
}

async function cpApplyCabinOrder() {
    if (!confirm(`確定要套用這 ${cpCabinOrderMode} 個車廂順序到地圖嗎？`)) return;

    const inputs = document.querySelectorAll('#cp-order-inputs input');
    const updates = {};
    let hasError = false;

    inputs.forEach((inp, i) => {
        const seq = inp.value.trim();
        if (seq && !window.cabinValidateSeq(seq)) {
            alert(`第 ${i + 1} 個車廂號碼格式不正確: ${seq}`);
            hasError = true;
        }
        updates[`cabin-${i}/sequence`] = seq;
    });
    if (hasError) return;

    try {
        if (typeof showLoader === 'function') showLoader();
        await window.realtimeDb.ref('cabins').update(updates);
        await window.setGlobalModeToFirestore(cpCabinOrderMode);
        alert('✅ 車廂順序已套用，地圖將自動同步');
        await cpPopulateCabinSeqDatalist();
    } catch (e) {
        alert('套用失敗: ' + e.message);
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

// ---------- 防 XSS ----------
function cpEscape(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

// 用於 onclick="" 內的字串（URL 通常不需額外處理，但要跳脫單引號）
function cpEscapeJs(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------- 暴露全域（給 HTML onclick 用） ----------
window.cpInit = cpInit;
window.cpSwitchTab = cpSwitchTab;
window.cpHandleUpload = cpHandleUpload;
window.cpRenderPhotoList = cpRenderPhotoList;
window.cpOpenImageModal = cpOpenImageModal;
window.cpCloseImageModal = cpCloseImageModal;
window.cpOpenNoteEditor = cpOpenNoteEditor;
window.cpHandleDeletePhoto = cpHandleDeletePhoto;
window.cpSetOrderMode = cpSetOrderMode;
window.cpClearOrderInputs = cpClearOrderInputs;
window.cpImportOrderFromMap = cpImportOrderFromMap;
window.cpApplyCabinOrder = cpApplyCabinOrder;
window.cpParseCsvToInputs = cpParseCsvToInputs;


console.log('✅ cabin-photos.js 已載入');
