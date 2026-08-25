// ================================================================
// 監控面板模組（Dashboard）
// ================================================================

let allGuests = [];
let dbAutoRefreshTimer = null;

// ---- 載入與統計 ----
async function dbLoadRecords() {
    try {
        showLoader(true);
        const snap = await db.collection('guests').orderBy('createdAt', 'desc').get();
        allGuests = [];
        snap.forEach(d => allGuests.push({ id: d.id, ...d.data() }));
        dbRenderTable(allGuests);
        dbUpdateStats(allGuests);
    } catch (e) {
        showMessage('dbMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

function dbUpdateStats(records) {
    let total = records.length, completed = 0, pending = 0;
    let green = 0, yellow = 0, red = 0, black = 0;

    records.forEach(r => {
        if (r.status === 'completed' || r.timeLanded) {
            completed++;
        } else {
            pending++;
        }

        const h = r.healthStatus || '';
        if (h.includes('綠色')) green++;
        else if (h.includes('黃色')) yellow++;
        else if (h.includes('紅色')) red++;
        else if (h.includes('黑色')) black++;
    });

    document.getElementById('dbTotal').textContent = total;
    document.getElementById('dbCompleted').textContent = completed;
    document.getElementById('dbPending').textContent = pending;
    document.getElementById('dbGreen').textContent = green;
    document.getElementById('dbYellow').textContent = yellow;
    document.getElementById('dbRed').textContent = red;
    document.getElementById('dbBlack').textContent = black;
}

function dbRenderTable(records) {
    const tbody = document.getElementById('dbTableBody');
    tbody.innerHTML = '';

    const search = document.getElementById('dbSearch').value.toLowerCase();
    const filterExit = document.getElementById('dbFilterExit').value;
    const filterHealth = document.getElementById('dbFilterHealth').value;
    const filterStatus = document.getElementById('dbFilterStatus').value;

    let filtered = records.filter(r => {
        if (search && !(r.cabinNumber || '').toLowerCase().includes(search) &&
            !(r.guestName || '').toLowerCase().includes(search)) {
            return false;
        }
        if (filterExit && r.exitMethod !== filterExit) return false;
        if (filterHealth && r.healthStatus !== filterHealth) return false;

        if (filterStatus) {
            const displayStatus = window.getGuestDisplayStatus ? window.getGuestDisplayStatus(r) : 'waiting';
            if (displayStatus !== filterStatus) return false;
        }
        return true;
    });

    let idx = filtered.length;
    const canEdit = window.currentRole === 'admin' || window.currentRole === 'occ';
    const canDelete = window.currentRole === 'admin';

    filtered.forEach(r => {
        const tr = document.createElement('tr');

        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        const statusInfo = window.getStatusDisplayInfo ? window.getStatusDisplayInfo(status) : { text: '未知', badge: 'status-unknown' };

        let exitTimeStr = '-';
        if (r.exitTime) {
            exitTimeStr = window.formatTimestamp ? window.formatTimestamp(r.exitTime) : '-';
        }

        tr.innerHTML = `
            <td>${idx--}</td>
            <td>${r.cabinNumber || '-'}</td>
            <td>${r.guestName || '-'}</td>
            <td>${r.contactNumber || '-'}</td>
            <td>${r.groupNumber ? '第' + r.groupNumber + '組' : '-'}</td>
            <td>${r.healthStatus || '-'}</td>
            <td>${exitTimeStr}</td>
            <td>${r.exitMethod || '-'}</td>
            <td><span class="status-badge ${statusInfo.badge}">${statusInfo.text}</span></td>
            <td>
                ${canEdit ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:0.8rem;" onclick="dbEditRecordWithModal('${r.id}')"><i class="fas fa-edit"></i></button>` : ''}
                ${canDelete ? `<button class="btn btn-danger" style="padding:4px 10px;font-size:0.8rem;" onclick="dbDeleteRecord('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function dbFilterRecords() {
    dbRenderTable(allGuests);
}

// ---- 編輯與刪除 ----
async function dbEditRecordWithModal(id) {
    const record = allGuests.find(r => r.id === id);
    if (!record) return;

    document.getElementById('groupDocId').value = id;
    document.getElementById('groupCabinNumber').value = record.cabinNumber || '';
    document.getElementById('groupGroupNumber').value = record.groupNumber || '';
    document.getElementById('groupGuestName').value = record.guestName || '';
    document.getElementById('groupContactNumber').value = record.contactNumber || '';
    document.getElementById('groupGender').value = record.gender || '';
    document.getElementById('groupAgeRange').value = record.ageRange || '';
    document.getElementById('groupHealthStatus').value = record.healthStatus || '';
    document.getElementById('groupAmbulance').value = record.ambulance || '';
    document.getElementById('groupAmbulancePlate').value = record.ambulancePlate || '';
    document.getElementById('groupHospital').value = record.hospital || '';
    document.getElementById('groupExitMethod').value = record.exitMethod || '';
    document.getElementById('groupOtherExitInput').value = '';

    if (record.exitTime) {
        try {
            const d = record.exitTime.toDate ? record.exitTime.toDate() : new Date(record.exitTime);
            document.getElementById('groupExitTime').value = d.toISOString().slice(0, 16);
        } catch (e) {}
    }

    document.getElementById('groupRescuedBy').value = record.rescuedBy || '';
    document.getElementById('groupOtherRescuerInput').value = '';
    document.getElementById('groupTimeReachedTop').value = window.extractDateTime ? window.extractDateTime(record.timeReachedTop) : '';
    document.getElementById('groupTimeLanded').value = window.extractDateTime ? window.extractDateTime(record.timeLanded) : '';
    document.getElementById('groupRemarks').value = record.remarks || '';

    document.getElementById('groupModal').style.display = 'flex';

    const form = document.getElementById('groupForm');
    form.onsubmit = async function (e) {
        e.preventDefault();
        await dbUpdateGuestFromGroupModal(id);
    };

    if (typeof toggleGroupAmbulanceFields === 'function') toggleGroupAmbulanceFields();
    if (typeof toggleGroupOtherExit === 'function') toggleGroupOtherExit();
    if (typeof toggleGroupOtherRescuer === 'function') toggleGroupOtherRescuer();
}

// ★ 更新前驗證，避免誤更新其他組別
async function dbUpdateGuestFromGroupModal(docId) {
    // ★ 驗證：確保該文件確實對應表單中的車廂+組別
    try {
        const docSnap = await db.collection('guests').doc(docId).get();
        if (!docSnap.exists) {
            showMessage('dbMessage', '記錄不存在，請重新整理', 'error');
            return;
        }
        const existing = docSnap.data();
        const formCabin = document.getElementById('groupCabinNumber').value.trim();
        const formGroup = document.getElementById('groupGroupNumber').value;
        if (existing.cabinNumber !== formCabin || existing.groupNumber !== formGroup) {
            showMessage('dbMessage',
                `⚠️ 錯誤：您正在修改 ${existing.cabinNumber} 號車廂第 ${existing.groupNumber} 組，但表單顯示為 ${formCabin} 號車廂第 ${formGroup} 組。請重新操作。`,
                'error'
            );
            return;
        }
    } catch (e) {
        showMessage('dbMessage', '驗證記錄失敗: ' + e.message, 'error');
        return;
    }

    // 原有更新邏輯
    const form = document.getElementById('groupForm');
    const formData = new FormData(form);
    const updateData = {};
    for (const [key, value] of formData.entries()) {
        if (key !== 'docId' && key !== 'cabinNumber') updateData[key] = value;
    }
    updateData.cabinNumber = document.getElementById('groupCabinNumber').value;

    if (updateData.exitMethod === '其他') {
        const other = document.getElementById('groupOtherExitInput').value.trim();
        if (other) updateData.exitMethod = other;
    }
    if (updateData.rescuedBy === '其他') {
        const other = document.getElementById('groupOtherRescuerInput').value.trim();
        if (other) updateData.rescuedBy = other;
    }
    if (updateData.ambulance === '需要') {
        updateData.ambulancePlate = document.getElementById('groupAmbulancePlate').value;
        updateData.hospital = document.getElementById('groupHospital').value;
    } else {
        updateData.ambulancePlate = '';
        updateData.hospital = '';
    }

    const exitTime = document.getElementById('groupExitTime').value;
    if (exitTime) {
        updateData.exitTime = new Date(exitTime);
        updateData.status = 'completed';
    } else {
        updateData.exitTime = null;
        updateData.status = 'pending';
    }

    updateData.updatedAt = new Date();

    try {
        showLoader(true);
        await db.collection('guests').doc(docId).update(updateData);
        showMessage('dbMessage', '記錄更新成功！', 'success');
        closeGroupModal();
        dbLoadRecords();
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
    } catch (e) {
        showMessage('dbMessage', '更新失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

async function dbDeleteRecord(id) {
    if (!confirm('確定要刪除此記錄嗎？')) return;
    try {
        showLoader(true);
        await db.collection('guests').doc(id).delete();
        showMessage('dbMessage', '記錄已刪除', 'success');
        dbLoadRecords();
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
    } catch (e) {
        showMessage('dbMessage', '刪除失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

function dbExportCSV() {
    const records = allGuests;
    if (!records.length) {
        alert('無資料可匯出');
        return;
    }
    const BOM = '\uFEFF';
    let csv = BOM + '車廂,姓名,聯絡方式,組別,健康狀況,離開時間,後續處理,狀態\n';
    records.forEach(r => {
        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        const statusInfo = window.getStatusDisplayInfo ? window.getStatusDisplayInfo(status) : { text: status };
        const exitTimeStr = r.exitTime ? (window.formatTimestamp ? window.formatTimestamp(r.exitTime) : '-') : '-';
        const row = [
            r.cabinNumber || '',
            r.guestName || '',
            r.contactNumber || '',
            r.groupNumber ? '第' + r.groupNumber + '組' : '',
            r.healthStatus || '',
            exitTimeStr,
            r.exitMethod || '',
            statusInfo.text
        ];
        csv += row.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `救援記錄_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---- 初始化 ----
function initDashboard() {
    console.log('✅ 監控面板初始化完成');
    dbLoadRecords();

    if (dbAutoRefreshTimer) clearInterval(dbAutoRefreshTimer);
    dbAutoRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-dashboard');
        if (section && section.classList.contains('active')) {
            console.log('🔄 監控面板自動更新 (20秒)');
            dbLoadRecords();
        }
    }, 20000);

    const refreshBtn = document.getElementById('dbRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function (e) {
            e.preventDefault();
            console.log('🔄 手動刷新監控面板');
            dbLoadRecords();
        });
    }
}

// ---- 暴露全域 ----
window.dbLoadRecords = dbLoadRecords;
window.dbFilterRecords = dbFilterRecords;
window.dbEditRecordWithModal = dbEditRecordWithModal;
window.dbDeleteRecord = dbDeleteRecord;
window.dbExportCSV = dbExportCSV;
window.initDashboard = initDashboard;

console.log('✅ dashboard.js 已載入');
