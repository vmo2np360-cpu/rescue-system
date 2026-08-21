// ================================================================
// OCC 求助記錄模組
// ================================================================

let allRescueRecords = [];

// ---- 來源切換 ----
function occToggleOtherSource() {
    const v = document.getElementById('occSource').value;
    document.getElementById('occOtherSourceContainer').style.display = v === '其他' ? 'block' : 'none';
}

// ---- 儲存 ----
async function occSaveRecord() {
    const cabin = document.getElementById('occCabinNumber').value.trim();
    const name = document.getElementById('occGuestName').value.trim();
    const contact = document.getElementById('occContactNumber').value.trim();
    const health = document.getElementById('occHealthStatus').value;
    let source = document.getElementById('occSource').value;
    if (source === '其他') source = document.getElementById('occOtherSourceInput').value.trim();
    if (!source) { showMessage('occMessage', '請選擇資料來源', 'error'); return; }
    if (!cabin && !name) { showMessage('occMessage', '請至少填寫車廂或姓名', 'error'); return; }
    try {
        showLoader(true);
        await db.collection('rescue_records').add({
            cabinNumber: cabin,
            guestName: name,
            contactNumber: contact || '未提供',
            gender: document.getElementById('occGender').value,
            ageRange: document.getElementById('occAgeRange').value,
            healthStatus: health,
            source: source,
            notes: document.getElementById('occNotes').value,
            createdAt: new Date(),
            processed: false
        });
        showMessage('occMessage', '求助記錄儲存成功！', 'success');
        document.getElementById('occCabinNumber').value = '';
        document.getElementById('occGuestName').value = '';
        document.getElementById('occContactNumber').value = '';
        document.getElementById('occNotes').value = '';
        occLoadRecords();
    } catch(e) {
        showMessage('occMessage', '儲存失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

// ---- 載入 ----
async function occLoadRecords() {
    try {
        showLoader(true);
        const snap = await db.collection('rescue_records').orderBy('createdAt', 'desc').get();
        allRescueRecords = [];
        snap.forEach(d => allRescueRecords.push({ id: d.id, ...d.data() }));
        occRenderTable(allRescueRecords);
    } catch(e) {
        showMessage('occMessage', '載入失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

function occRenderTable(records) {
    const tbody = document.getElementById('occTableBody');
    tbody.innerHTML = '';
    const search = document.getElementById('occSearch').value.toLowerCase();
    const src = document.getElementById('occFilterSource').value;
    const stat = document.getElementById('occFilterStatus').value;
    let filtered = records.filter(r => {
        if (search && !(r.cabinNumber||'').toLowerCase().includes(search) && !(r.guestName||'').toLowerCase().includes(search)) return false;
        if (src && r.source !== src) return false;
        if (stat === 'pending' && r.processed) return false;
        if (stat === 'processed' && !r.processed) return false;
        return true;
    });
    let idx = filtered.length;
    const canEdit = window.currentRole === 'admin' || window.currentRole === 'occ' || window.currentRole === 'gr';
    filtered.forEach(r => {
        const tr = document.createElement('tr');
        const statusText = r.processed ? '已處理' : '待處理';
        const badge = r.processed ? 'status-processed' : 'status-pending';
        tr.innerHTML = `
            <td>${idx--}</td>
            <td>${r.cabinNumber||'-'}</td>
            <td>${r.guestName||'-'}</td>
            <td>${r.contactNumber||'-'}</td>
            <td>${r.healthStatus||'-'}</td>
            <td>${r.source||'-'}</td>
            <td><span class="status-badge ${badge}">${statusText}</span></td>
            <td>
                ${canEdit && !r.processed ? `<button class="btn btn-success" style="padding:4px 10px;font-size:0.8rem;" onclick="occMarkProcessed('${r.id}')">標記已處理</button>` : ''}
                <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.8rem;" onclick="occCompareRecord('${r.id}')"><i class="fas fa-search"></i> 對比</button>
                ${window.currentRole === 'admin' ? `<button class="btn btn-danger" style="padding:4px 10px;font-size:0.8rem;" onclick="occDeleteRecord('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function occFilterRecords() { occRenderTable(allRescueRecords); }

async function occMarkProcessed(id) {
    if (!confirm('標記此求助為已處理？')) return;
    try {
        await db.collection('rescue_records').doc(id).update({ processed: true, processedAt: new Date() });
        occLoadRecords();
    } catch(e) { alert('失敗: ' + e.message); }
}

async function occDeleteRecord(id) {
    if (!confirm('確定刪除？')) return;
    try {
        await db.collection('rescue_records').doc(id).delete();
        occLoadRecords();
    } catch(e) { alert('刪除失敗: ' + e.message); }
}

// ---- 比對功能 ----
async function occCompareRecord(recordId) {
    const record = allRescueRecords.find(r => r.id === recordId);
    if (!record) { showMessage('occMessage', '找不到記錄', 'error'); return; }
    try {
        showLoader(true);
        const snap = await db.collection('guests').get();
        let results = [];
        snap.forEach(doc => {
            const data = doc.data();
            let match = false;
            if (record.cabinNumber && data.cabinNumber === record.cabinNumber) match = true;
            if (record.guestName && data.guestName === record.guestName) match = true;
            if (record.contactNumber && data.contactNumber === record.contactNumber) match = true;
            if (record.gender && data.gender === record.gender) match = true;
            if (record.ageRange && data.ageRange === record.ageRange) match = true;
            if (record.healthStatus && data.healthStatus === record.healthStatus) match = true;
            if (match) {
                const score = occCalcMatchScore(data, record);
                results.push({ id: doc.id, ...data, matchScore: score });
            }
        });
        results.sort((a,b) => b.matchScore - a.matchScore);
        results = results.filter(r => r.matchScore >= 50);
        occDisplayComparison(results, record);
    } catch(e) {
        showMessage('occMessage', '比對失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

function occCalcMatchScore(guest, record) {
    let score = 0, total = 0;
    const fields = ['cabinNumber','guestName','contactNumber','gender','ageRange','healthStatus'];
    fields.forEach(f => {
        if (record[f]) {
            total++;
            if (guest[f] && guest[f].toLowerCase().trim() === record[f].toLowerCase().trim()) score++;
        }
    });
    return total ? Math.round((score/total)*100) : 0;
}

function occDisplayComparison(results, record) {
    let container = document.getElementById('occComparisonResult');
    if (!container) {
        container = document.createElement('div');
        container.id = 'occComparisonResult';
        container.className = 'card';
        container.style.marginTop = '16px';
        document.getElementById('section-occ').appendChild(container);
    }
    if (!results.length) {
        container.innerHTML = '<div class="message message-info">未找到匹配度50%以上的記錄</div>';
        return;
    }
    let html = `<h4 style="color:#1e3a5f;">比對結果 (找到 ${results.length} 條匹配)</h4>`;
    results.forEach(g => {
        const level = g.matchScore >= 80 ? '高' : (g.matchScore >= 50 ? '中' : '低');
        html += `
            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin:8px 0;">
                <div><strong>${g.guestName||'未提供'}</strong> (車廂 ${g.cabinNumber||'-'}) 匹配度: ${g.matchScore}% (${level})</div>
                <div style="font-size:0.85rem; color:#475569;">
                    聯絡: ${g.contactNumber||'-'} ｜ 健康: ${g.healthStatus||'-'} ｜ 組別: ${g.groupNumber ? '第'+g.groupNumber+'組' : '-'}
                </div>
                <button class="btn btn-success" style="padding:4px 12px;font-size:0.8rem;margin-top:6px;" onclick="occMarkGuestRescued('${g.id}')">
                    <i class="fas fa-check"></i> 求助個案已救援
                </button>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function occMarkGuestRescued(guestId) {
    if (!confirm('標記此被救者為已救援？')) return;
    try {
        await db.collection('guests').doc(guestId).update({ status: 'completed', updatedAt: new Date() });
        showMessage('occMessage', '已標記為已救援', 'success');
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();
    } catch(e) {
        showMessage('occMessage', '操作失敗: ' + e.message, 'error');
    }
}

// ---- 初始化 ----
function initOcc() {
    console.log('✅ OCC 求助記錄初始化完成');
    occLoadRecords();
}

// ---- 暴露 ----
window.occToggleOtherSource = occToggleOtherSource;
window.occSaveRecord = occSaveRecord;
window.occLoadRecords = occLoadRecords;
window.occFilterRecords = occFilterRecords;
window.occMarkProcessed = occMarkProcessed;
window.occDeleteRecord = occDeleteRecord;
window.occCompareRecord = occCompareRecord;
window.occMarkGuestRescued = occMarkGuestRescued;
window.initOcc = initOcc;