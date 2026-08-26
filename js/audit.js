// ================================================================
// 日誌審計模組（Audit Log）
// ================================================================

let allLogs = [];
let auditAutoRefreshTimer = null;

// ---- 載入日誌 ----
async function auditLoadLogs() {
    try {
        showLoader(true);
        const snap = await db.collection('audit_log')
            .orderBy('timestamp', 'desc')
            .limit(500)
            .get();
        
        allLogs = [];
        snap.forEach(d => {
            const data = d.data();
            let timestamp = data.timestamp;
            if (timestamp && timestamp.toDate) {
                timestamp = timestamp.toDate();
            }
            allLogs.push({
                id: d.id,
                ...data,
                timestamp: timestamp
            });
        });
        auditRenderTable(allLogs);
        auditUpdateStats(allLogs);
    } catch (e) {
        showMessage('auditMessage', '載入日誌失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// ---- 統計 ----
function auditUpdateStats(logs) {
    const total = logs.length;
    const creates = logs.filter(l => l.operation === 'create').length;
    const updates = logs.filter(l => l.operation === 'update').length;
    const deletes = logs.filter(l => l.operation === 'delete').length;
    
    document.getElementById('auditTotal').textContent = total;
    document.getElementById('auditCreates').textContent = creates;
    document.getElementById('auditUpdates').textContent = updates;
    document.getElementById('auditDeletes').textContent = deletes;
}

// ---- 渲染表格 ----
function auditRenderTable(logs) {
    const tbody = document.getElementById('auditTableBody');
    tbody.innerHTML = '';
    
    const search = document.getElementById('auditSearch').value.toLowerCase();
    const filterOperation = document.getElementById('auditFilterOperation').value;
    const filterCollection = document.getElementById('auditFilterCollection').value;
    
    let filtered = logs.filter(l => {
        if (search) {
            const searchable = [
                l.user || '',
                l.docId || '',
                l.collection || '',
                JSON.stringify(l.data || ''),
                JSON.stringify(l.previousData || '')
            ].join(' ').toLowerCase();
            if (!searchable.includes(search)) return false;
        }
        if (filterOperation && l.operation !== filterOperation) return false;
        if (filterCollection && l.collection !== filterCollection) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">暫無日誌記錄</td></tr>';
        return;
    }
    
    filtered.forEach(l => {
        const tr = document.createElement('tr');
        
        let operationLabel = '', badgeClass = '';
        switch(l.operation) {
            case 'create': operationLabel = '新增'; badgeClass = 'status-complete'; break;
            case 'update': operationLabel = '更新'; badgeClass = 'status-pending'; break;
            case 'delete': operationLabel = '刪除'; badgeClass = 'status-waiting'; break;
            default: operationLabel = l.operation || '未知'; badgeClass = 'status-unknown';
        }
        
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString('zh-TW') : '-';
        
        let dataPreview = '-';
        if (l.data) {
            try {
                const keys = Object.keys(l.data);
                const preview = keys.slice(0, 3).map(k => `${k}: ${l.data[k]}`).join(', ');
                dataPreview = keys.length > 3 ? preview + ' ...' : preview;
            } catch(e) {}
        }
        
        tr.innerHTML = `
            <td>${timeStr}</td>
            <td>${l.user || 'unknown'}</td>
            <td><span class="status-badge ${badgeClass}">${operationLabel}</span></td>
            <td>${l.collection || '-'}</td>
            <td><code style="font-size:0.75rem; word-break:break-all;">${l.docId || '-'}</code></td>
            <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${dataPreview}">${dataPreview}</td>
            <td>
                <button class="btn btn-secondary" style="padding:2px 8px;font-size:0.7rem;" onclick="auditViewDetail('${l.id}')">
                    <i class="fas fa-eye"></i> 詳情
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 查看詳情 ----
async function auditViewDetail(logId) {
    try {
        const doc = await db.collection('audit_log').doc(logId).get();
        if (!doc.exists) {
            showMessage('auditMessage', '日誌不存在', 'error');
            return;
        }
        const data = doc.data();
        const modal = document.getElementById('auditDetailModal');
        const content = document.getElementById('auditDetailContent');
        
        let timestamp = data.timestamp;
        if (timestamp && timestamp.toDate) {
            timestamp = timestamp.toDate().toLocaleString('zh-TW');
        } else {
            timestamp = '-';
        }
        
        const operationMap = { create: '新增', update: '更新', delete: '刪除' };
        
        content.innerHTML = `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div><strong>時間：</strong> ${timestamp}</div>
                <div><strong>操作者：</strong> ${data.user || 'unknown'}</div>
                <div><strong>操作類型：</strong> ${operationMap[data.operation] || data.operation}</div>
                <div><strong>集合：</strong> ${data.collection || '-'}</div>
                <div style="grid-column: span 2;"><strong>文件 ID：</strong> <code>${data.docId || '-'}</code></div>
                <div style="grid-column: span 2;">
                    <strong>變更後資料：</strong>
                    <pre style="background:#f1f5f9; padding:8px; border-radius:4px; max-height:200px; overflow:auto; font-size:0.8rem;">${data.data ? JSON.stringify(data.data, null, 2) : '無'}</pre>
                </div>
                <div style="grid-column: span 2;">
                    <strong>變更前資料：</strong>
                    <pre style="background:#fef3c7; padding:8px; border-radius:4px; max-height:200px; overflow:auto; font-size:0.8rem;">${data.previousData ? JSON.stringify(data.previousData, null, 2) : '無（新增或未記錄）'}</pre>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
    } catch (e) {
        showMessage('auditMessage', '載入詳情失敗: ' + e.message, 'error');
    }
}

function auditCloseDetail() {
    document.getElementById('auditDetailModal').style.display = 'none';
}

// ---- 篩選 ----
function auditFilterLogs() {
    auditRenderTable(allLogs);
}

// ---- 匯出 CSV ----
function auditExportCSV() {
    const logs = allLogs;
    if (!logs.length) {
        alert('無資料可匯出');
        return;
    }
    const BOM = '\uFEFF';
    let csv = BOM + '時間,操作者,操作類型,集合,文件ID,資料\n';
    logs.forEach(l => {
        const timeStr = l.timestamp ? new Date(l.timestamp).toLocaleString('zh-TW') : '-';
        const operationMap = { create: '新增', update: '更新', delete: '刪除' };
        const op = operationMap[l.operation] || l.operation;
        const dataStr = l.data ? JSON.stringify(l.data).replace(/,/g, ';') : '-';
        csv += `${timeStr},${l.user||'unknown'},${op},${l.collection||'-'},${l.docId||'-'},${dataStr}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `日誌_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---- 初始化 ----
function initAudit() {
    console.log('✅ 日誌審計模組初始化完成');
    auditLoadLogs();
    
    if (auditAutoRefreshTimer) clearInterval(auditAutoRefreshTimer);
    auditAutoRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-audit');
        if (section && section.classList.contains('active')) {
            console.log('🔄 日誌自動更新 (30秒)');
            auditLoadLogs();
        }
    }, 30000);
}

// ---- 暴露全域 ----
window.auditLoadLogs = auditLoadLogs;
window.auditFilterLogs = auditFilterLogs;
window.auditViewDetail = auditViewDetail;
window.auditCloseDetail = auditCloseDetail;
window.auditExportCSV = auditExportCSV;
window.initAudit = initAudit;

console.log('✅ audit.js 已載入');