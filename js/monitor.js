// ================================================================
// 總監控平台模組
// ================================================================

let monChartInstance = null;

// ---- 載入數據 ----
async function monLoadData() {
    try {
        showLoader(true);
        const snap1 = await db.collection('rescue_records').get();
        const occRecords = [];
        snap1.forEach(d => occRecords.push({ id: d.id, ...d.data() }));
        const snap2 = await db.collection('guests').get();
        const guestRecords = [];
        snap2.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        // OCC 統計
        const occTotal = occRecords.length;
        const occPending = occRecords.filter(r => !r.processed).length;
        const occProcessed = occRecords.filter(r => r.processed).length;
        document.getElementById('monTotal').textContent = occTotal;
        document.getElementById('monPending').textContent = occPending;
        document.getElementById('monProcessed').textContent = occProcessed;

        // 健康狀況
        let green=0, yellow=0, red=0, black=0;
        occRecords.forEach(r => {
            const h = r.healthStatus || '';
            if(h.includes('綠色')) green++;
            else if(h.includes('黃色')) yellow++;
            else if(h.includes('紅色')) red++;
            else if(h.includes('黑色')) black++;
        });
        document.getElementById('monGreen').textContent = green;
        document.getElementById('monYellow').textContent = yellow;
        document.getElementById('monRed').textContent = red;
        document.getElementById('monBlack').textContent = black;

        monUpdateChart(guestRecords);
        monRenderTable(guestRecords);
    } catch(e) {
        showMessage('monMessage', '載入失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

function monUpdateChart(guestRecords) {
    const ctx = document.getElementById('monTimeChart').getContext('2d');
    if (monChartInstance) monChartInstance.destroy();
    const ranges = [0,0,0,0,0];
    guestRecords.forEach(g => {
        if (g.timeReachedTop && g.timeLanded) {
            const start = g.timeReachedTop.split(':');
            const end = g.timeLanded.split(':');
            if (start.length===2 && end.length===2) {
                let diff = (parseInt(end[0])*60 + parseInt(end[1])) - (parseInt(start[0])*60 + parseInt(start[1]));
                if (diff < 0) diff += 1440;
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
                backgroundColor: ['#22c55e','#2563eb','#eab308','#f97316','#dc2626']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function monRenderTable(guestRecords) {
    const tbody = document.getElementById('monTableBody');
    tbody.innerHTML = '';
    const search = document.getElementById('monSearch').value.toLowerCase();
    let filtered = guestRecords.filter(g => {
        if (search && !(g.cabinNumber||'').toLowerCase().includes(search) && !(g.guestName||'').toLowerCase().includes(search)) return false;
        return true;
    });
    filtered.forEach(g => {
        const tr = document.createElement('tr');
        const status = getGroupStatus(g);
        let statusText = '', badge = '';
        if (status === 'landed') { statusText = '已著陸'; badge = 'status-complete'; }
        else if (status === 'rescuing') { statusText = '救援中'; badge = 'status-pending'; }
        else { statusText = '等待救援'; badge = 'status-waiting'; }
        tr.innerHTML = `
            <td>${g.cabinNumber||'-'}</td>
            <td>${g.groupNumber ? '第'+g.groupNumber+'組' : '-'}</td>
            <td>${g.timeReachedTop || '-'}</td>
            <td>${g.timeLanded || '-'}</td>
            <td><span class="status-badge ${badge}">${statusText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function monFilterRecords() { monLoadData(); }

// ---- 初始化 ----
function initMonitor() {
    console.log('✅ 總監控平台初始化完成');
    monLoadData();
}

// ---- 暴露 ----
window.monLoadData = monLoadData;
window.monFilterRecords = monFilterRecords;
window.initMonitor = initMonitor;