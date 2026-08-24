// ================================================================
// 總監控平台模組 (整合版 - 使用 monitor.html UI + monitor.js 邏輯)
// ================================================================

let monChartInstance = null;
let monAllRecords = [];
let monRescueRecords = [];
let monGuestRecords = [];

// ---- 初始化 ----
function initMonitor() {
    console.log('✅ 總監控平台初始化完成');
    
    // 載入數據
    monLoadAllData();
    
    // 設置實時監聽器
    monSetupRealtimeListeners();
    
    // 設置自動刷新（每60秒）
    if (window._monAutoRefresh) clearInterval(window._monAutoRefresh);
    window._monAutoRefresh = setInterval(() => {
        console.log("自動刷新監控數據...");
        monLoadAllData();
    }, 60000);
}

// ---- 載入所有數據 ----
async function monLoadAllData() {
    try {
        showLoader(true);
        
        // 平行載入兩個集合
        const [guestSnap, rescueSnap] = await Promise.all([
            db.collection('guests').get(),
            db.collection('rescue_records').get()
        ]);
        
        // 處理賓客記錄
        monGuestRecords = [];
        guestSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            monGuestRecords.push(data);
        });
        
        // 處理求助記錄
        monRescueRecords = [];
        rescueSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            monRescueRecords.push(data);
        });
        
        console.log(`載入 ${monGuestRecords.length} 筆賓客記錄，${monRescueRecords.length} 筆求助記錄`);
        
        // 更新所有顯示
        monUpdateAllDisplays();
        
        // 更新最後更新時間
        monUpdateTimestamp();
        
    } catch (e) {
        console.error('載入數據失敗:', e);
        showMessage('monMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// ---- 更新所有顯示 ----
function monUpdateAllDisplays() {
    monUpdateRescueRecordsStats();   // OCC求助記錄統計
    monUpdateHealthStats();          // 健康狀況統計
    monUpdateRescueStats();          // 救援記錄統計
    monUpdateStatusDistribution();   // 救援狀態分佈
    monUpdateTimeChart();            // 救援時間圖表
    monRenderTable();               // 監控表格
}

// ---- 1. OCC求助記錄統計 ----
function monUpdateRescueRecordsStats() {
    const total = monRescueRecords.length;
    const pending = monRescueRecords.filter(r => !r.processed).length;
    const processed = monRescueRecords.filter(r => r.processed).length;
    
    document.getElementById('occ-total').textContent = total;
    document.getElementById('occ-pending').textContent = pending;
    document.getElementById('occ-processed').textContent = processed;
    
    // OCC求助記錄健康狀況統計
    let green = 0, yellow = 0, red = 0, black = 0;
    monRescueRecords.forEach(r => {
        const h = r.healthStatus || '';
        if (h.includes('綠色')) green++;
        else if (h.includes('黃色')) yellow++;
        else if (h.includes('紅色')) red++;
        else if (h.includes('黑色')) black++;
    });
    
    document.getElementById('occ-green-count').textContent = green;
    document.getElementById('occ-yellow-count').textContent = yellow;
    document.getElementById('occ-red-count').textContent = red;
    document.getElementById('occ-black-count').textContent = black;
}

// ---- 2. 救援記錄統計 ----
function monUpdateRescueStats() {
    const total = monGuestRecords.length;
    const completed = monGuestRecords.filter(r => r.status === 'completed' || r.timeLanded).length;
    const pending = monGuestRecords.filter(r => r.status !== 'completed' && !r.timeLanded).length;
    const ambulanceNeeded = monGuestRecords.filter(r => r.ambulance === '需要').length;
    
    document.getElementById('totalRecords').textContent = total;
    document.getElementById('completedRecords').textContent = completed;
    document.getElementById('pendingRecords').textContent = pending;
    document.getElementById('ambulanceNeeded').textContent = ambulanceNeeded;
}

// ---- 3. 健康狀況統計 ----
function monUpdateHealthStats() {
    let green = 0, yellow = 0, red = 0, black = 0;
    monGuestRecords.forEach(r => {
        const h = r.healthStatus || '';
        if (h.includes('綠色')) green++;
        else if (h.includes('黃色')) yellow++;
        else if (h.includes('紅色')) red++;
        else if (h.includes('黑色')) black++;
    });
    
    document.getElementById('green-count').textContent = green;
    document.getElementById('yellow-count').textContent = yellow;
    document.getElementById('red-count').textContent = red;
    document.getElementById('black-count').textContent = black;
}

// ---- 4. 救援狀態分佈 ----
function monUpdateStatusDistribution() {
    let waiting = 0, rescuing = 0, landed = 0;
    
    monGuestRecords.forEach(r => {
        const status = monGetGroupStatus(r);
        if (status === 'waiting') waiting++;
        else if (status === 'rescuing') rescuing++;
        else if (status === 'landed') landed++;
    });
    
    document.getElementById('waiting-groups').textContent = waiting;
    document.getElementById('rescuing-groups').textContent = rescuing;
    document.getElementById('landed-groups').textContent = landed;
    document.getElementById('total-groups').textContent = monGuestRecords.length;
}

// ---- 5. 救援時間圖表 ----
function monUpdateTimeChart() {
    const ctx = document.getElementById('timeChart').getContext('2d');
    if (monChartInstance) monChartInstance.destroy();
    
    const ranges = [0, 0, 0, 0, 0]; // 0-15, 15-30, 30-45, 45-60, 60+
    
    monGuestRecords.forEach(g => {
        if (g.timeReachedTop && g.timeLanded) {
            const start = g.timeReachedTop.split(':');
            const end = g.timeLanded.split(':');
            if (start.length === 2 && end.length === 2) {
                let diff = (parseInt(end[0]) * 60 + parseInt(end[1])) - 
                           (parseInt(start[0]) * 60 + parseInt(start[1]));
                if (diff < 0) diff += 1440; // 跨日處理
                if (diff <= 15) ranges[0]++;
                else if (diff <= 30) ranges[1]++;
                else if (diff <= 45) ranges[2]++;
                else if (diff <= 60) ranges[3]++;
                else ranges[4]++;
            }
        }
    });
    
    monChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['0-15分', '15-30分', '30-45分', '45-60分', '60分以上'],
            datasets: [{
                label: '救援時間分佈',
                data: ranges,
                backgroundColor: [
                    'rgba(52, 168, 83, 0.7)',
                    'rgba(66, 133, 244, 0.7)',
                    'rgba(251, 188, 5, 0.7)',
                    'rgba(255, 152, 0, 0.7)',
                    'rgba(234, 67, 53, 0.7)'
                ],
                borderColor: [
                    'rgba(52, 168, 83, 1)',
                    'rgba(66, 133, 244, 1)',
                    'rgba(251, 188, 5, 1)',
                    'rgba(255, 152, 0, 1)',
                    'rgba(234, 67, 53, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#e0e0e0',
                        precision: 0
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: '#e0e0e0'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#e0e0e0'
                    }
                }
            }
        }
    });
}

// ---- 6. 監控表格 ----
function monRenderTable() {
    const tbody = document.getElementById('monitor-records-list');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const search = document.getElementById('searchInput');
    const searchValue = search ? search.value.toLowerCase() : '';
    
    let filtered = monGuestRecords;
    if (searchValue) {
        filtered = monGuestRecords.filter(g => {
            const cabin = (g.cabinNumber || '').toLowerCase();
            const group = (g.groupNumber || '');
            const name = (g.guestName || '').toLowerCase();
            return cabin.includes(searchValue) || 
                   group.includes(searchValue) || 
                   name.includes(searchValue);
        });
    }
    
    // 按車廂排序
    filtered.sort((a, b) => {
        const cabinA = a.cabinNumber || '';
        const cabinB = b.cabinNumber || '';
        return cabinA.localeCompare(cabinB, undefined, {numeric: true});
    });
    
    filtered.forEach(g => {
        const tr = document.createElement('tr');
        const status = monGetGroupStatus(g);
        let statusText = '', badgeClass = '';
        
        if (status === 'landed') {
            statusText = '已著陸';
            badgeClass = 'status-complete';
        } else if (status === 'rescuing') {
            statusText = '救援中';
            badgeClass = 'status-pending';
        } else {
            statusText = '等待救援';
            badgeClass = 'status-waiting';
        }
        
        tr.innerHTML = `
            <td>${g.cabinNumber || '-'}</td>
            <td>${g.groupNumber ? '第' + g.groupNumber + '組' : '-'}</td>
            <td>${g.timeReachedTop || '-'}</td>
            <td>${g.timeLanded || '-'}</td>
            <td><span class="status-badge ${badgeClass}">${statusText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 輔助函數：組別狀態判斷 ----
function monGetGroupStatus(guest) {
    if (guest.status) {
        if (['landed', 'rescuing', 'waiting'].includes(guest.status)) {
            return guest.status;
        }
        if (guest.status === 'completed') return 'landed';
    }
    if (guest.timeLanded) return 'landed';
    if (guest.exitTime && guest.exitMethod) return 'landed';
    if (guest.timeReachedTop || guest.rescuedBy) return 'rescuing';
    if (guest.ambulance === '需要') return 'rescuing';
    return 'waiting';
}

// ---- 實時監聽器 ----
function monSetupRealtimeListeners() {
    console.log("設置監控平台實時監聽器...");
    
    // 監聽賓客記錄變化
    db.collection('guests').onSnapshot(() => {
        console.log('賓客記錄更新，重新載入數據');
        monLoadAllData();
    }, error => {
        console.error('賓客記錄監聽錯誤:', error);
    });
    
    // 監聽求助記錄變化
    db.collection('rescue_records').onSnapshot(() => {
        console.log('求助記錄更新，重新載入數據');
        monLoadAllData();
    }, error => {
        console.error('求助記錄監聽錯誤:', error);
    });
}

// ---- 更新時間戳 ----
function monUpdateTimestamp() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-TW');
    
    ['last-map-update', 'last-data-update', 'last-chart-update', 'last-monitor-update'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = timeString;
    });
}

// ---- 手動刷新 ----
function monManualRefresh() {
    console.log("手動刷新監控數據...");
    const buttons = document.querySelectorAll('.refresh-btn');
    buttons.forEach(btn => {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 更新中';
        btn.disabled = true;
    });
    
    monLoadAllData().then(() => {
        setTimeout(() => {
            buttons.forEach(btn => {
                btn.innerHTML = '<i class="fas fa-sync-alt"></i> 手動更新';
                btn.disabled = false;
            });
        }, 500);
    });
}

// ---- 過濾監控記錄 ----
function monFilterRecords() {
    monRenderTable();
}

// ---- 暴露全域 ----
window.initMonitor = initMonitor;
window.monLoadAllData = monLoadAllData;
window.monFilterRecords = monFilterRecords;
window.monManualRefresh = monManualRefresh;

console.log('✅ monitor.js 整合版已載入');
