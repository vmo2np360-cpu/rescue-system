// ================================================================
// 監控面板模組（Dashboard）
// ================================================================

let allGuests = [];
window._dbAutoRefreshTimer = null;

// ★ 防重複提交鎖（策略 C）
const _dbLocks = {};

// ---- 載入與統計 ----
async function dbLoadRecords() {
    // ★ 修復：Dashboard 頁面未載入時，直接跳過
    if (!document.getElementById('dbTableBody')) {
        return;
    }

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
    const total = records.length;

    // ===== Layer 1：4 個狀態（用 getGroupStatus 保證與 map/monitor 一致）=====
    let waiting = 0, rescuing = 0, landed = 0, departed = 0;
    records.forEach(r => {
        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        if (status === 'departed') departed++;
        else if (status === 'landed') landed++;
        else if (status === 'rescuing') rescuing++;
        else waiting++;
    });

    const pct = (n) => total > 0 ? Math.round(n / total * 100) + '%' : '0%';

    document.getElementById('dbKpiTotal').textContent = total;
    document.getElementById('dbKpiWaiting').textContent = waiting;
    document.getElementById('dbKpiWaitingPct').textContent = pct(waiting);
    document.getElementById('dbKpiRescuing').textContent = rescuing;
    document.getElementById('dbKpiRescuingPct').textContent = pct(rescuing);
    document.getElementById('dbKpiLanded').textContent = landed;
    document.getElementById('dbKpiLandedPct').textContent = pct(landed);
    document.getElementById('dbKpiDeparted').textContent = departed;
    document.getElementById('dbKpiDepartedPct').textContent = pct(departed);

    // ===== Layer 2：健康分佈 =====
    let red = 0, yellow = 0, green = 0, black = 0;
    records.forEach(r => {
        const h = r.healthStatus || '';
        if (h.includes('紅色')) red++;
        else if (h.includes('黃色')) yellow++;
        else if (h.includes('綠色')) green++;
        else if (h.includes('黑色')) black++;
    });
    const unknown = Math.max(0, total - red - yellow - green - black);

    const pctF = (n) => total > 0 ? (n / total * 100) : 0;
    const segData = [
        { id: 'dbSegRed',     label: 'dbSegRedLabel',     count: red,     pct: pctF(red) },
        { id: 'dbSegYellow',  label: 'dbSegYellowLabel',  count: yellow,  pct: pctF(yellow) },
        { id: 'dbSegGreen',   label: 'dbSegGreenLabel',   count: green,   pct: pctF(green) },
        { id: 'dbSegBlack',   label: 'dbSegBlackLabel',   count: black,   pct: pctF(black) },
        { id: 'dbSegUnknown', label: 'dbSegUnknownLabel', count: unknown, pct: pctF(unknown) }
    ];
    segData.forEach(s => {
        const el = document.getElementById(s.id);
        const lbl = document.getElementById(s.label);
        if (!el) return;
        el.style.width = s.pct + '%';
        if (lbl) {
            lbl.textContent = s.pct >= 8 ? s.count : '';
            lbl.style.opacity = s.pct >= 8 ? '1' : '0';
        }
        el.title = `${s.count} 人 (${s.pct.toFixed(1)}%)`;
    });

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setTxt('dbHealthTotal', total + ' 人');
    setTxt('dbLegRed', red);
    setTxt('dbLegYellow', yellow);
    setTxt('dbLegGreen', green);
    setTxt('dbLegBlack', black);
    setTxt('dbLegUnknown', unknown);

    // ===== Layer 3：輔助指標 =====
    const ambulanceNeeded = records.filter(r => r.ambulance === '需要').length;
    setTxt('dbAuxAmbulance', ambulanceNeeded);

    // 最久等待（分鐘）
    let longestWait = 0;
    records.forEach(r => {
        if (!r.timeReachedTop && !r.timeLanded && r.createdAt) {
            let d;
            if (r.createdAt.toDate) d = r.createdAt.toDate();
            else if (r.createdAt.seconds) d = new Date(r.createdAt.seconds * 1000);
            else d = new Date(r.createdAt);
            if (!isNaN(d.getTime())) {
                const mins = (Date.now() - d.getTime()) / 60000;
                if (mins > longestWait) longestWait = mins;
            }
        }
    });
    setTxt('dbAuxLongestWait', longestWait > 0 ? Math.round(longestWait) : '—');

    // 平均救援時長（只算已完成救援）
    let totalDuration = 0, countDuration = 0;
    records.forEach(r => {
        if (!r.timeReachedTop || !r.timeLanded) return;
        const toMs = (t) => {
            if (t.toDate) return t.toDate().getTime();
            if (t.seconds) return t.seconds * 1000;
            const d = new Date(t);
            return isNaN(d.getTime()) ? null : d.getTime();
        };
        const s = toMs(r.timeReachedTop);
        const e = toMs(r.timeLanded);
        if (s !== null && e !== null && e > s) {
            totalDuration += (e - s) / 60000;
            countDuration++;
        }
    });
    setTxt('dbAuxAvgRescue', countDuration > 0 ? Math.round(totalDuration / countDuration) : '—');

    // 今日完成（只算 timeLanded 是今天）
    const today = new Date();
    const isToday = (t) => {
        if (!t) return false;
        let d;
        if (t.toDate) d = t.toDate();
        else if (t.seconds) d = new Date(t.seconds * 1000);
        else d = new Date(t);
        if (isNaN(d.getTime())) return false;
        return d.getFullYear() === today.getFullYear()
            && d.getMonth() === today.getMonth()
            && d.getDate() === today.getDate();
    };
    const todayDone = records.filter(r => isToday(r.timeLanded)).length;
    setTxt('dbAuxTodayDone', todayDone);
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
       const canEdit = ['admin', 'occ', 'ap'].includes(window.currentRole);
    const canDelete = ['admin', 'occ', 'ap'].includes(window.currentRole);

    filtered.forEach(r => {
        const tr = document.createElement('tr');

        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        const statusInfo = window.getStatusDisplayInfo ? window.getStatusDisplayInfo(status) : { text: '未知', badge: 'status-unknown' };

        // ★ 離開時間
        let exitTimeStr = '-';
        if (r.exitTime) {
            exitTimeStr = window.formatTimestamp ? window.formatTimestamp(r.exitTime) : '-';
        }

        // ★ 救援開始時間
        const startTimeStr = r.timeReachedTop
            ? (window.formatTimestamp ? window.formatTimestamp(r.timeReachedTop) : r.timeReachedTop)
            : '-';

        // ★ 救援完成時間
        let endTimeStr;
        if (r.timeLanded) {
            endTimeStr = window.formatTimestamp ? window.formatTimestamp(r.timeLanded) : r.timeLanded;
        } else if (r.timeReachedTop) {
            endTimeStr = '⏳ 進行中';
        } else {
            endTimeStr = '-';
        }

        tr.innerHTML = `
            <td>${idx--}</td>
            <td>${r.cabinNumber || '-'}</td>
            <td>${r.guestName || '-'}</td>
            <td>${r.contactNumber || '-'}</td>
            <td>${r.groupNumber ? '第' + r.groupNumber + '組' : '-'}</td>
            <td>${r.healthStatus || '-'}</td>
            <td>${startTimeStr}</td>
            <td>${endTimeStr}</td>
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

    // ★ 手動控制救護車相關欄位顯示
    const ambulanceVal = document.getElementById('groupAmbulance').value;
    document.getElementById('groupAmbulanceFields').style.display = (ambulanceVal === '需要') ? 'block' : 'none';

    // ★ 手動控制「其他」後續處理顯示
    const exitMethodVal = document.getElementById('groupExitMethod').value;
    document.getElementById('groupOtherExitContainer').style.display = (exitMethodVal === '其他') ? 'block' : 'none';

    // ★ 手動控制「其他」救援人員顯示
    const rescuedByVal = document.getElementById('groupRescuedBy').value;
    document.getElementById('groupOtherRescuerContainer').style.display = (rescuedByVal === '其他') ? 'block' : 'none';

    document.getElementById('groupModal').style.display = 'flex';

    const form = document.getElementById('groupForm');
    form.onsubmit = async function (e) {
        e.preventDefault();
        // ★ 加鎖（策略 C）——避免快速連點「儲存」按鈕
        if (_dbLocks['dbUpdateGuestFromGroupModal']) {
            console.warn('⏳ [dbUpdateGuestFromGroupModal] 上一個操作仍在進行中，忽略此次點擊');
            return;
        }
        _dbLocks['dbUpdateGuestFromGroupModal'] = true;
        try {
            await dbUpdateGuestFromGroupModal(id);
        } finally {
            _dbLocks['dbUpdateGuestFromGroupModal'] = false;
        }
    };
}

// ★ 更新前驗證，避免誤更新其他組別
async function dbUpdateGuestFromGroupModal(docId) {
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
        const existingDoc = await db.collection('guests').doc(docId).get();
        const previousData = existingDoc.exists ? existingDoc.data() : null;

        await db.collection('guests').doc(docId).update(updateData);
        // 日誌記錄（若 common.js 中有 logAction 定義，會自動處理；若無，則忽略）
        if (typeof logAction === 'function') {
            await logAction('guests', docId, 'update', updateData, previousData);
        }
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

    // ★ CSV 欄位轉義（處理逗號、雙引號、換行）
    const csvEscape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (/[",\n\r]/.test(s)) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    };

    // ★ 時間戳格式化
    const fmtTs = (t) => {
        if (!t) return '';
        return window.formatTimestamp ? window.formatTimestamp(t) : '';
    };

    const BOM = '\uFEFF';
    // ★ 完整 guests 表單欄位（19 列）
    const headers = [
        '車廂', '組別', '姓名', '聯絡方式', '性別', '年齡',
        '健康狀況', '救護車需求', '救護車車牌', '醫院名稱',
        '救援人員', '救援開始時間', '救援完成時間',
        '後續處理', '離開時間', '備註',
        '狀態', '建立時間', '更新時間'
    ];
    let csv = BOM + headers.map(csvEscape).join(',') + '\n';

    records.forEach(r => {
        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        const statusInfo = window.getStatusDisplayInfo ? window.getStatusDisplayInfo(status) : { text: status };

        const row = [
            r.cabinNumber || '',
            r.groupNumber || '',
            r.guestName || '',
            r.contactNumber || '',
            r.gender || '',
            r.ageRange || '',
            r.healthStatus || '',
            r.ambulance || '',
            r.ambulancePlate || '',
            r.hospital || '',
            r.rescuedBy || '',
            fmtTs(r.timeReachedTop),
            fmtTs(r.timeLanded),
            r.exitMethod || '',
            fmtTs(r.exitTime),
            r.remarks || '',
            statusInfo.text,
            fmtTs(r.createdAt),
            fmtTs(r.updatedAt)
        ];
        csv += row.map(csvEscape).join(',') + '\n';
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

    // ★ 事件驅動：監聽 guests 集合變化
    if (window._dbGuestsUnsub) {
        try { window._dbGuestsUnsub(); } catch (e) {}
    }
    window._dbGuestsUnsub = db.collection('guests').onSnapshot(
        (snap) => {
            if (window.updateLastSyncTime) window.updateLastSyncTime();

            // ★ 離線優化：若來自快取且資料有變動，仍更新（因為是同一裝置寫入）
            // 這裡判斷 fromCache 是為了避免切頁時大量重複觸發
            const fromCache = snap.metadata && snap.metadata.fromCache;
            if (fromCache && !window._dbFirstLoadDone) {
                // 首次載入且來自快取，還是渲染（讓 UI 快顯示）
                console.log('📦 Dashboard 首次載入來自快取');
            }

            // 更新本地資料
            allGuests = [];
            snap.forEach(d => allGuests.push({ id: d.id, ...d.data() }));

            // 只在頁面 active 時渲染
            const section = document.getElementById('section-dashboard');
            if (section && section.classList.contains('active')) {
                dbRenderTable(allGuests);
                dbUpdateStats(allGuests);
            }

            window._dbFirstLoadDone = true;
        },
        (err) => {
            if (err && err.code === 'permission-denied') return;
            console.warn('Dashboard 監聽失敗:', err);
        }
    );

    // ★ 移除定時器
    if (window._dbAutoRefreshTimer) {
        clearInterval(window._dbAutoRefreshTimer);
        window._dbAutoRefreshTimer = null;
    }

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
// ★ 加鎖（策略 C）
window.dbDeleteRecord = withLock(_dbLocks, 'dbDeleteRecord', dbDeleteRecord);
window.dbExportCSV = dbExportCSV;
window.initDashboard = initDashboard;

console.log('✅ dashboard.js 已載入');
