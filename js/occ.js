// ================================================================
// OCC 求助記錄模組 (僅管理求助記錄，不影響 guests)
// ================================================================

let allRescueRecords = [];
let _occComparisonTimer = null;   // ★ 新增：比對結果自動關閉計時器

// ★ 防重複提交鎖（策略 C）
const _occLocks = {};

// ================================================================
// ★ 時間格式化輔助（今天顯示 HH:MM，跨日顯示 MM/DD HH:MM）
// ================================================================
function occFmtTime(t) {
    if (!t) return '-';
    let d;
    try {
        if (t.toDate) d = t.toDate();
        else if (t.seconds) d = new Date(t.seconds * 1000);
        else if (typeof t === 'string') d = new Date(t);
        else if (t instanceof Date) d = t;
        else return '-';
        if (isNaN(d.getTime())) return '-';
    } catch { return '-'; }

    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
                 && d.getMonth() === now.getMonth()
                 && d.getDate() === now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return sameDay ? hhmm : `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${hhmm}`;
}

// ---- 來源切換 ----
function occToggleOtherSource() {
    const v = document.getElementById('occSource').value;
    document.getElementById('occOtherSourceContainer').style.display = v === '其他' ? 'block' : 'none';
}

// ---- 儲存求助記錄 ----
async function occSaveRecord() {
    console.log('occSaveRecord called');
    const cabin = document.getElementById('occCabinNumber').value.trim();
    const name = document.getElementById('occGuestName').value.trim();
    const contact = document.getElementById('occContactNumber').value.trim();
    const health = document.getElementById('occHealthStatus').value;
    let source = document.getElementById('occSource').value;
    if (source === '其他') source = document.getElementById('occOtherSourceInput').value.trim();
    if (!source) { showMessage('occMessage', '請選擇資料來源', 'error'); return; }
    if (!cabin && !name) { showMessage('occMessage', '請至少填寫車廂或姓名', 'error'); return; }

    // ★ 新增：求助人數 + 類型
    const totalPeople = parseInt(document.getElementById('occTotalPeople').value) || 1;
    const elderlyCount = document.getElementById('occElderlyCount').value || '-';
    const adultCount = document.getElementById('occAdultCount').value || '-';
    const childCount = document.getElementById('occChildCount').value || '-';

    try {
        showLoader();
        await db.collection('rescue_records').add({
            cabinNumber: cabin,
            guestName: name,
            contactNumber: contact || '未提供',
            gender: document.getElementById('occGender').value,
            ageRange: document.getElementById('occAgeRange').value,
            healthStatus: health,
            source: source,
            notes: document.getElementById('occNotes').value,
            totalPeople: totalPeople,           // ★ 新增
            elderlyCount: elderlyCount,         // ★ 新增
            adultCount: adultCount,             // ★ 新增
            childCount: childCount,             // ★ 新增
            createdAt: new Date(),
            processed: false
        });
        showMessage('occMessage', '求助記錄儲存成功！', 'success');
        // 清空表單
        document.getElementById('occCabinNumber').value = '';
        document.getElementById('occGuestName').value = '';
        document.getElementById('occContactNumber').value = '';
        document.getElementById('occNotes').value = '';
        document.getElementById('occTotalPeople').value = '1';
        document.getElementById('occElderlyCount').value = '-';
        document.getElementById('occAdultCount').value = '-';
        document.getElementById('occChildCount').value = '-';
        occLoadRecords();
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    } catch(e) {
        console.error('儲存失敗:', e);
        showMessage('occMessage', '儲存失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ---- 載入求助記錄 ----
async function occLoadRecords() {
    console.log('occLoadRecords called');
    try {
        showLoader();
        const snap = await db.collection('rescue_records').orderBy('createdAt', 'desc').get();
        allRescueRecords = [];
        snap.forEach(d => allRescueRecords.push({ id: d.id, ...d.data() }));
        occRenderTable(allRescueRecords);
    } catch(e) {
        console.error('載入失敗:', e);
        showMessage('occMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ---- 渲染表格 (使用 data-id 與事件委派) ----
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
    const canEdit = ['admin', 'occ', 'gr'].includes(window.currentRole);
    const canDelete = ['admin', 'occ', 'gr'].includes(window.currentRole);
    filtered.forEach(r => {
        const tr = document.createElement('tr');
        const statusText = r.processed ? '已處理' : '待處理';
        const badge = r.processed ? 'status-processed' : 'status-pending';
        // ★ 新增：求助時間 & 求助人數
        const createdTime = occFmtTime(r.createdAt);
        const totalPeopleDisplay = r.totalPeople || '-';
        tr.innerHTML = `
            <td>${idx--}</td>
            <td>${r.cabinNumber||'-'}</td>
            <td>${r.guestName||'-'}</td>
            <td>${r.contactNumber||'-'}</td>
            <td>${r.healthStatus||'-'}</td>
            <td>${r.source||'-'}</td>
            <td>${createdTime}</td>
            <td>${totalPeopleDisplay}</td>
            <td><span class="status-badge ${badge}">${statusText}</span></td>
            <td>
                ${canEdit && !r.processed ? `<button class="btn btn-success btn-sm" data-action="markProcessed" data-id="${r.id}">標記已處理</button>` : ''}
                ${canEdit ? `<button class="btn btn-primary btn-sm" data-action="edit" data-id="${r.id}"><i class="fas fa-edit"></i></button>` : ''}
                <button class="btn btn-secondary btn-sm" data-action="compare" data-id="${r.id}"><i class="fas fa-search"></i> 對比</button>
                ${canDelete ? `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${r.id}"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // ★ 事件委派（取代 inline onclick）
    tbody.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const action = this.dataset.action;
            const id = this.dataset.id;
            if (action === 'compare') occCompareRecord(id);
            else if (action === 'markProcessed') occMarkProcessed(id);
            else if (action === 'delete') occDeleteRecord(id);
            else if (action === 'edit') occEditRecord(id);
        });
    });
}

function occFilterRecords() { occRenderTable(allRescueRecords); }

// ---- ★ 僅更新 rescue_records，完全不動 guests ----
async function occMarkProcessed(id) {
    console.log('occMarkProcessed called with id:', id);
    if (!confirm('標記此求助為已處理？')) return;
    try {
        showLoader();
        const update = { processed: true, processedAt: new Date() };
        await db.collection('rescue_records').doc(id).update(update);
        await logAction('rescue_records', id, 'update', update, null);
        showMessage('occMessage', '✅ 求助記錄已標記為已處理', 'success');
        occLoadRecords();
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    } catch(e) {
        console.error('標記失敗:', e);
        showMessage('occMessage', '操作失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

async function occDeleteRecord(id) {
    console.log('occDeleteRecord called with id:', id);
    if (!confirm('確定刪除？')) return;
    try {
        showLoader();
        await db.collection('rescue_records').doc(id).delete();
        const index = allRescueRecords.findIndex(r => r.id === id);
        if (index !== -1) allRescueRecords.splice(index, 1);
        occRenderTable(allRescueRecords);
        showMessage('occMessage', '✅ 已刪除', 'success');
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    } catch(e) {
        console.error('刪除失敗:', e);
        showMessage('occMessage', '刪除失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ================================================================
// 比對功能（僅供查看，不修改 guests）
// ================================================================

async function occCompareRecord(recordId) {
    console.log('occCompareRecord called with recordId:', recordId);
    const record = allRescueRecords.find(r => r.id === recordId);
    if (!record) {
        showMessage('occMessage', '找不到記錄', 'error');
        return;
    }

    try {
        showLoader();
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
        console.error('比對失敗:', e);
        showMessage('occMessage', '比對失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
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

// ★ 顯示比對結果（強化插入邏輯 + 修正無結果顯示）
function occDisplayComparison(results, record) {
    console.log('occDisplayComparison called, results count:', results.length);

    // ★ 清除舊計時器
    if (_occComparisonTimer) {
        clearTimeout(_occComparisonTimer);
        _occComparisonTimer = null;
    }

    // 移除舊容器
    let container = document.getElementById('occComparisonResult');
    if (container) container.remove();

    // 建立新容器
    container = document.createElement('div');
    container.id = 'occComparisonResult';
    container.className = 'card';
    container.style.marginTop = '16px';
    container.style.marginBottom = '16px';
    container.style.borderLeft = '4px solid #2563eb';
    container.style.backgroundColor = '#f8fafc';
    container.style.display = 'block';

    // ★ 直接插入到 #section-occ 內
    const section = document.getElementById('section-occ');
    if (section) {
        section.appendChild(container);
        console.log('✅ 容器已插入 #section-occ');
    } else {
        console.error('❌ 找不到 #section-occ，容器未插入');
        return;
    }

    // ★ 無結果時顯示可見的自訂提示
    if (!results.length) {
        container.innerHTML = `
            <div style="padding: 16px; background: #dbeafe; border-radius: 8px; color: #1e40af; font-weight: 500;">
                <i class="fas fa-info-circle"></i> 未找到匹配度 50% 以上的記錄
            </div>
        `;
        showMessage('occMessage', 'ℹ️ 未找到匹配度 50% 以上的記錄', 'info', 4000);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });

        _occComparisonTimer = setTimeout(() => {
            console.log('⏱️ 比對結果自動關閉（10 秒無操作）');
            occCloseComparison();
        }, 10000);
        return;
    }

    // 有結果時顯示列表
    let html = `<h4 style="color:#1e3a5f;">🔍 比對結果 (找到 ${results.length} 條匹配)</h4>
                <p style="font-size:0.85rem; color:#64748b;">💡 點擊下方按鈕可將此求助記錄標記為「已處理」，不會影響被救者記錄 (guests)。</p>`;
    results.forEach(g => {
        const level = g.matchScore >= 80 ? '高' : (g.matchScore >= 50 ? '中' : '低');
        html += `
            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin:8px 0; background:white;">
                <div><strong>${g.guestName||'未提供'}</strong> (車廂 ${g.cabinNumber||'-'}) 匹配度: ${g.matchScore}% (${level})</div>
                <div style="font-size:0.85rem; color:#475569;">
                    聯絡: ${g.contactNumber||'-'} ｜ 健康: ${g.healthStatus||'-'} ｜ 組別: ${g.groupNumber ? '第'+g.groupNumber+'組' : '-'}
                </div>
                <button class="btn btn-success" style="padding:4px 12px;font-size:0.8rem;margin-top:6px;" 
                        onclick="occMarkProcessed('${record.id}')">
                    <i class="fas fa-check"></i> 求助個案已處理
                </button>
            </div>
        `;
    });
    html += `
        <div style="text-align:center; margin-top:12px;">
            <button class="btn btn-secondary" onclick="occCloseComparison()" style="padding:6px 20px;">
                <i class="fas fa-times"></i> 關閉比對結果
            </button>
        </div>
    `;
    container.innerHTML = html;

    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showMessage('occMessage', `✅ 比對完成，找到 ${results.length} 筆匹配記錄`, 'success', 3000);

    _occComparisonTimer = setTimeout(() => {
        console.log('⏱️ 比對結果自動關閉（10 秒無操作）');
        occCloseComparison();
    }, 10000);

    container.addEventListener('mouseenter', () => {
        if (_occComparisonTimer) {
            clearTimeout(_occComparisonTimer);
            _occComparisonTimer = null;
        }
    });

    container.addEventListener('mouseleave', () => {
        if (!_occComparisonTimer) {
            _occComparisonTimer = setTimeout(() => {
                console.log('⏱️ 比對結果自動關閉（10 秒無操作）');
                occCloseComparison();
            }, 10000);
        }
    });
}

function occCloseComparison() {
    if (_occComparisonTimer) {
        clearTimeout(_occComparisonTimer);
        _occComparisonTimer = null;
    }
    const container = document.getElementById('occComparisonResult');
    if (container) container.remove();
}

// ---- 初始化 ----
function initOcc() {
    console.log('✅ OCC 求助記錄初始化完成');
    occLoadRecords();
}

// ================================================================
// ★ 編輯求助記錄
// ================================================================
async function occEditRecord(id) {
    const record = allRescueRecords.find(r => r.id === id);
    if (!record) {
        showMessage('occMessage', '找不到記錄', 'error');
        return;
    }

    // 動態建立 Modal（若不存在）
    let modal = document.getElementById('occEditModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'occEditModal';
        modal.className = 'modal';
        modal.innerHTML = `<!-- 見 h2 ... i.txt 中的 occEditModal，若動態建立則需完整複製 -->`;
        document.body.appendChild(modal);
    }

    // 填入資料
    document.getElementById('occEditId').value = id;
    document.getElementById('occEditCabin').value = record.cabinNumber || '';
    document.getElementById('occEditName').value = record.guestName || '';
    document.getElementById('occEditContact').value = record.contactNumber || '';
    document.getElementById('occEditGender').value = record.gender || '';
    document.getElementById('occEditAge').value = record.ageRange || '';
    document.getElementById('occEditHealth').value = record.healthStatus || '';
    document.getElementById('occEditSource').value = record.source || '';
    document.getElementById('occEditNotes').value = record.notes || '';
    document.getElementById('occEditProcessed').value = record.processed ? 'true' : 'false';

    // ★ 新增：求助人數 + 類型（舊資料 fallback）
    document.getElementById('occEditTotalPeople').value = record.totalPeople || 1;
    document.getElementById('occEditElderly').value = record.elderlyCount || '-';
    document.getElementById('occEditAdult').value = record.adultCount || '-';
    document.getElementById('occEditChild').value = record.childCount || '-';

    modal.style.display = 'flex';
}

function occCloseEditModal() {
    const modal = document.getElementById('occEditModal');
    if (modal) modal.style.display = 'none';
}

async function occSaveEdit() {
    const id = document.getElementById('occEditId').value;
    if (!id) return;

    const updateData = {
        cabinNumber: document.getElementById('occEditCabin').value.trim(),
        guestName: document.getElementById('occEditName').value.trim(),
        contactNumber: document.getElementById('occEditContact').value.trim(),
        gender: document.getElementById('occEditGender').value,
        ageRange: document.getElementById('occEditAge').value,
        healthStatus: document.getElementById('occEditHealth').value,
        source: document.getElementById('occEditSource').value,
        notes: document.getElementById('occEditNotes').value.trim(),
        processed: document.getElementById('occEditProcessed').value === 'true',
        // ★ 新增：求助人數 + 類型
        totalPeople: parseInt(document.getElementById('occEditTotalPeople').value) || 1,
        elderlyCount: document.getElementById('occEditElderly').value || '-',
        adultCount: document.getElementById('occEditAdult').value || '-',
        childCount: document.getElementById('occEditChild').value || '-',
        updatedAt: new Date()
    };

    if (!updateData.cabinNumber && !updateData.guestName) {
        showMessage('occMessage', '車廂或姓名至少填一個', 'error');
        return;
    }

    try {
        showLoader();
        const existingDoc = await db.collection('rescue_records').doc(id).get();
        const previousData = existingDoc.exists ? existingDoc.data() : null;

        await db.collection('rescue_records').doc(id).update(updateData);
        await logAction('rescue_records', id, 'update', updateData, previousData);

        showMessage('occMessage', '✅ 求助記錄已更新', 'success');
        occCloseEditModal();
        occLoadRecords();
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    } catch (e) {
        console.error('更新失敗:', e);
        showMessage('occMessage', '更新失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ================================================================
// ★ 匯出 CSV
// ================================================================
function occExportCSV() {
    if (!allRescueRecords || allRescueRecords.length === 0) {
        alert('無資料可匯出');
        return;
    }

    // ★ 檢查當前篩選條件
    const search = (document.getElementById('occSearch')?.value || '').trim();
    const src = document.getElementById('occFilterSource')?.value || '';
    const stat = document.getElementById('occFilterStatus')?.value || '';
    const hasFilter = !!(search || src || stat);

    let records = allRescueRecords;

    if (hasFilter) {
        const filterDesc = [];
        if (search) filterDesc.push(`搜尋：${search}`);
        if (src) filterDesc.push(`來源：${src}`);
        if (stat) filterDesc.push(`狀態：${stat === 'pending' ? '待處理' : '已處理'}`);

        const useFilter = confirm(
            `當前有篩選條件：\n` +
            filterDesc.map(d => `  • ${d}`).join('\n') +
            `\n\n按「確定」→ 匯出【當前篩選結果】\n按「取消」→ 匯出【全部資料】`
        );

        if (useFilter) {
            records = allRescueRecords.filter(r => {
                if (search) {
                    const s = search.toLowerCase();
                    const cabin = (r.cabinNumber || '').toLowerCase();
                    const name = (r.guestName || '').toLowerCase();
                    if (!cabin.includes(s) && !name.includes(s)) return false;
                }
                if (src && r.source !== src) return false;
                if (stat === 'pending' && r.processed) return false;
                if (stat === 'processed' && !r.processed) return false;
                return true;
            });
        }
    }

    if (records.length === 0) {
        alert('篩選結果為空，無資料可匯出');
        return;
    }

    // ★ 組裝 CSV（加 BOM 讓 Excel 正確顯示中文）
    const BOM = '\uFEFF';
    const headers = [
        '車廂', '姓名', '聯絡方式', '性別', '年齡',
        '健康狀況', '資料來源',
        '求助人數', '長者人數', '成人人數', '兒童人數',   // ★ 新增
        '狀態', '備註', '建立時間', '處理時間'
    ];
    let csv = BOM + headers.map(occCsvEscape).join(',') + '\n';

    records.forEach(r => {
        const status = r.processed ? '已處理' : '待處理';
        const createdAt = r.createdAt
            ? (window.formatTimestamp ? window.formatTimestamp(r.createdAt) : '')
            : '-';
        const processedAt = r.processedAt
            ? (window.formatTimestamp ? window.formatTimestamp(r.processedAt) : '')
            : '-';

        const row = [
            r.cabinNumber || '',
            r.guestName || '',
            r.contactNumber || '',
            r.gender || '',
            r.ageRange || '',
            r.healthStatus || '',
            r.source || '',
            r.totalPeople || '',        // ★ 新增
            r.elderlyCount || '-',       // ★ 新增
            r.adultCount || '-',         // ★ 新增
            r.childCount || '-',         // ★ 新增
            status,
            r.notes || '',
            createdAt,
            processedAt
        ].map(occCsvEscape).join(',');

        csv += row + '\n';
    });

    // ★ 觸發下載
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `OCC求助記錄_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`✅ OCC 匯出 CSV：${records.length} 筆`);
    showMessage('occMessage', `✅ 已匯出 ${records.length} 筆求助記錄`, 'success', 3000);
}

// ★ CSV 欄位轉義（處理逗號、雙引號、換行）
function occCsvEscape(value) {
    const str = String(value === null || value === undefined ? '' : value);
    if (/[",\n\r]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

window.occToggleOtherSource = occToggleOtherSource;
// ★ 加鎖（策略 C）
window.occSaveRecord     = withLock(_occLocks, 'occSaveRecord', occSaveRecord);
window.occLoadRecords    = occLoadRecords;
window.occFilterRecords  = occFilterRecords;
window.occMarkProcessed  = withLock(_occLocks, 'occMarkProcessed', occMarkProcessed);
window.occDeleteRecord   = withLock(_occLocks, 'occDeleteRecord', occDeleteRecord);
window.occCompareRecord  = occCompareRecord;
window.occCloseComparison = occCloseComparison;
window.initOcc = initOcc;
// ★ 新增
window.occEditRecord = occEditRecord;
window.occCloseEditModal = occCloseEditModal;
window.occSaveEdit = withLock(_occLocks, 'occSaveEdit', occSaveEdit);
// ★ 新增：CSV 匯出
window.occExportCSV = occExportCSV;
