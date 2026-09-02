// ================================================================
// 總監控平台模組（完整版）- 三欄深色 + 橢圓地圖
// ================================================================

let monMapCabins = [];
let monSvg = null;
let monChartInstance = null;
let monGuestRecords = [];
let monRescueRecords = [];
let monAutoRefreshTimer = null;
let monCurrentOffset = 0;
let _monOffsetUnsubscribe = null;

// ---- 輔助：從 Firestore 載入偏移量（保留，但橢圓布局不使用偏移） ----
async function monLoadOffsetFromFirestore() {
    monCurrentOffset = await window.getGlobalOffsetFromFirestore();
    return monCurrentOffset;
}

// ---- 初始化地圖（只執行一次） ----
function monInitMap() {
    if (monMapCabins.length > 0) {
        console.log('Monitor 地圖已初始化，跳過');
        return;
    }
    monSvg = document.getElementById('monitorMap');
    if (!monSvg) {
        console.warn('找不到 #monitorMap，300ms 後重試');
        setTimeout(monInitMap, 300);
        return;
    }

    // 清空 SVG，只保留 defs 等（由 JS 重建）
    while (monSvg.firstChild) monSvg.removeChild(monSvg.firstChild);

    // ---- 繪製背景（簡化版，保留山、海、纜車線等，但車廂將以橢圓排列） ----
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    // 漸層
    const gradMountain = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradMountain.setAttribute('id', 'monGradMountain');
    gradMountain.setAttribute('x1', '0'); gradMountain.setAttribute('y1', '1'); gradMountain.setAttribute('x2', '0'); gradMountain.setAttribute('y2', '0');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#388E3C');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#A5D6A7');
    gradMountain.appendChild(s1); gradMountain.appendChild(s2);
    defs.appendChild(gradMountain);

    const gradBay = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradBay.setAttribute('id', 'monGradBay');
    gradBay.setAttribute('x1', '0'); gradBay.setAttribute('y1', '0'); gradBay.setAttribute('x2', '0'); gradBay.setAttribute('y2', '1');
    const s3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s3.setAttribute('offset', '0%'); s3.setAttribute('stop-color', '#81D4FA');
    const s4 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s4.setAttribute('offset', '100%'); s4.setAttribute('stop-color', '#0288D1');
    gradBay.appendChild(s3); gradBay.appendChild(s4);
    defs.appendChild(gradBay);

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'monHighlightGlow');
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadow.setAttribute('dx', '0'); shadow.setAttribute('dy', '0'); shadow.setAttribute('stdDeviation', '6');
    shadow.setAttribute('flood-color', 'gold');
    filter.appendChild(shadow);
    defs.appendChild(filter);
    monSvg.appendChild(defs);

    // 背景矩形
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', '2800'); bg.setAttribute('height', '700');
    bg.setAttribute('fill', '#1a2a3a');
    monSvg.appendChild(bg);

    // 簡化：畫一條纜車路線（折線）作為背景
    const pts = [
        [150, 600], [400, 600], [800, 400], [1200, 300], [1600, 300],
        [2000, 400], [2400, 500], [2650, 550]
    ];
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#3a5a7a');
    poly.setAttribute('stroke-width', '3');
    poly.setAttribute('stroke-dasharray', '8,6');
    monSvg.appendChild(poly);

    // 畫一些站點標記（可選）
    pts.forEach((p, i) => {
        const cir = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        cir.setAttribute('cx', p[0]); cir.setAttribute('cy', p[1]);
        cir.setAttribute('r', '6'); cir.setAttribute('fill', '#5f7a9a');
        monSvg.appendChild(cir);
        if (i % 2 === 0) {
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.textContent = 'T' + i;
            txt.setAttribute('x', p[0]); txt.setAttribute('y', p[1] + 20);
            txt.setAttribute('fill', '#8899bb'); txt.setAttribute('font-size', '12');
            txt.setAttribute('text-anchor', 'middle');
            monSvg.appendChild(txt);
        }
    });

    // ---- 建立車廂（84 個） ----
    monBuildCabins();

    // ---- 監聽 Firestore 變化（原有） ----
    // 監聽車廂序號（若需要）
    realtimeDb.ref('cabins').on('value', (snap) => {
        const data = snap.val();
        if (!data) return;
        monMapCabins.forEach(c => {
            if (data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            }
        });
        monUpdateFromFirestore();
    });

    // 監聽 guests / rescue_records
    db.collection('guests').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });

    console.log('✅ Monitor 地圖初始化完成（橢圓排列）');
}

// ----- 構建車廂（只建立 SVG 元素） -----
function monBuildCabins() {
    if (!monSvg) return;
    // 清除舊車廂（保留背景）
    monMapCabins.forEach(c => { if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    monMapCabins = [];

    const total = 84;
    const size = 20;
    const fontSize = 20;

    for (let i = 0; i < total; i++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'cabin');
        // 六邊形
        const pts = [];
        for (let j = 0; j < 6; j++) {
            const a = Math.PI / 3 * j;
            pts.push((size * Math.cos(a)) + ',' + (size * Math.sin(a)));
        }
        const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        hex.setAttribute('points', pts.join(' '));
        hex.setAttribute('fill', '#ffffff');
        hex.setAttribute('stroke', '#333');
        hex.setAttribute('stroke-width', '1.5');
        g.appendChild(hex);

        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('class', 'seq-label');
        lbl.setAttribute('y', '5');
        lbl.setAttribute('font-size', fontSize);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('fill', '#111');
        lbl.setAttribute('font-weight', 'bold');
        g.appendChild(lbl);

        const cabin = { id: 'cabin-' + i, fields: {}, el: g, shape: hex, label: lbl };
        g.addEventListener('dblclick', () => monOpenCabinReadonly(cabin));
        monMapCabins.push(cabin);
        monSvg.appendChild(g);
    }

    // 初始佈局（橢圓）
    monLayoutCabins();
}

// ----- 橢圓佈局（取代原有索道佈局） -----
function monLayoutCabins() {
    const total = monMapCabins.length;
    if (total === 0) return;

    // 橢圓參數（根據 viewBox 2800x700）
    const cx = 1400, cy = 350;
    const rx = 1000, ry = 200;

    // 若需要加上偏移量（可選），但我們不使用偏移，固定均勻分佈
    for (let i = 0; i < total; i++) {
        const angle = (i / total) * 2 * Math.PI - Math.PI / 2; // 從頂部開始
        const x = cx + rx * Math.cos(angle);
        const y = cy + ry * Math.sin(angle);
        monMapCabins[i].el.setAttribute('transform', `translate(${x},${y})`);
    }
}

// ---- 更新車廂狀態（與原邏輯一致） ----
async function monUpdateFromFirestore() {
    try {
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

        const guestSnap = await db.collection('guests').get();
        const guestRecords = [];
        guestSnap.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        const updates = {};

        monMapCabins.forEach(cabin => {
            const seq = cabin.fields.sequence;
            cabin.el.classList.remove("status-red", "status-yellow", "status-green", "status-departed", "status-empty");
            cabin.shape.setAttribute('fill', '#ffffff');
            cabin.shape.setAttribute('stroke', '#333');

            if (!seq) {
                cabin.shape.setAttribute('fill', '#666');
                cabin.shape.setAttribute('stroke', '#888');
                return;
            }

            const matched = guestRecords.filter(g => g.cabinNumber === seq);
            const hasUnprocessedRescue = rescueRecords.some(
                r => r.cabinNumber === seq && r.processed === false
            );

            let overallStatus = 'empty';
            if (matched.length === 0) {
                overallStatus = 'empty';
            } else {
                overallStatus = window.getCabinOverallStatus ? window.getCabinOverallStatus(matched) : 'waiting';
            }

            let finalStatus = overallStatus;
            if (hasUnprocessedRescue && (overallStatus === 'empty' || overallStatus === 'waiting')) {
                finalStatus = 'waiting';
            }

            switch(finalStatus) {
                case 'landed':
                    cabin.el.classList.add("status-green");
                    cabin.shape.setAttribute('fill', '#34A853');
                    cabin.shape.setAttribute('stroke', '#16a34a');
                    break;
                case 'departed':
                    cabin.el.classList.add("status-departed");
                    cabin.shape.setAttribute('fill', '#3b82f6');
                    cabin.shape.setAttribute('stroke', '#2563eb');
                    break;
                case 'rescuing':
                    cabin.el.classList.add("status-yellow");
                    cabin.shape.setAttribute('fill', '#FBBC05');
                    cabin.shape.setAttribute('stroke', '#ca8a04');
                    break;
                case 'waiting':
                    cabin.el.classList.add("status-red");
                    cabin.shape.setAttribute('fill', '#EA4335');
                    cabin.shape.setAttribute('stroke', '#b91c1c');
                    break;
                case 'empty':
                default:
                    cabin.shape.setAttribute('fill', '#666');
                    cabin.shape.setAttribute('stroke', '#888');
                    break;
            }

            // 計算綜合時間（與主地圖一致）
            let overallStart = null;
            let overallEnd = null;
            if (matched.length > 0) {
                const startTimes = matched.map(g => g.timeReachedTop).filter(t => t);
                if (startTimes.length > 0) {
                    overallStart = startTimes.reduce((a, b) => {
                        const da = new Date(a), db = new Date(b);
                        return da < db ? a : b;
                    });
                    if (overallStart) overallStart = new Date(overallStart).toISOString();
                }
                const allCompleted = matched.every(g => {
                    const status = window.getGroupStatus ? window.getGroupStatus(g) : 'waiting';
                    return status === 'landed' || status === 'departed';
                });
                if (allCompleted) {
                    const endTimes = matched.map(g => g.timeLanded).filter(t => t);
                    if (endTimes.length > 0) {
                        overallEnd = endTimes.reduce((a, b) => {
                            const da = new Date(a), db = new Date(b);
                            return da > db ? a : b;
                        });
                        if (overallEnd) overallEnd = new Date(overallEnd).toISOString();
                    }
                }
            }
            cabin.fields.overallTimeReachedTop = overallStart;
            cabin.fields.overallTimeLanded = overallEnd;
            updates[`cabins/${cabin.id}/overallTimeReachedTop`] = overallStart || null;
            updates[`cabins/${cabin.id}/overallTimeLanded`] = overallEnd || null;
        });

        if (Object.keys(updates).length > 0) {
            await realtimeDb.ref().update(updates);
        }

        monUpdateSummary();
    } catch(e) {
        console.error('Monitor 地圖更新失敗:', e);
    }
}

// ---- 更新摘要統計（地圖下方的計數） ----
function monUpdateSummary() {
    let waiting = 0, rescuing = 0, landed = 0, departed = 0;
    const wc = [], rc = [], lc = [], dc = [];
    monMapCabins.forEach(c => {
        const seq = c.fields.sequence || '';
        if (c.el.classList.contains('status-red')) { waiting++; if (seq) wc.push(seq); }
        else if (c.el.classList.contains('status-yellow')) { rescuing++; if (seq) rc.push(seq); }
        else if (c.el.classList.contains('status-green')) { landed++; if (seq) lc.push(seq); }
        else if (c.el.classList.contains('status-departed')) { departed++; if (seq) dc.push(seq); }
    });
    // 這些 id 在舊版 summary-enhanced 中有，但新版已移除，但我們保留函數供其他呼叫
    // 若需要更新舊元素，可忽略或保留
}

// ---- 點擊車廂 → 開啟唯讀詳情（與原邏輯相同） ----
function monOpenCabinReadonly(cabin) {
    const seq = cabin.fields.sequence || '未設定';
    db.collection('guests').where('cabinNumber', '==', seq).get().then(snap => {
        const overallStart = cabin.fields.overallTimeReachedTop;
        const overallEnd = cabin.fields.overallTimeLanded;
        let html = `<div style="background:#2d2d2d; padding:16px; border-radius:8px; color:#e0e0e0; max-width:650px; margin:0 auto;">`;
        html += `<h3 style="color:#fff; margin-bottom:12px;">🚠 車廂 ${seq} 詳情</h3>`;
        html += `<p style="color:#aaa; font-size:0.85rem; margin-bottom:12px;">📌 此為唯讀模式，無法編輯</p>`;
        html += `<div style="background:#1a3a5f; padding:10px 14px; border-radius:6px; margin-bottom:12px; border:1px solid #2a5a8f;">`;
        html += `<div style="display:flex; flex-wrap:wrap; gap:16px; color:#cde;">`;
        html += `<div><strong>📊 綜合開始救援：</strong> ${overallStart ? (window.formatTimestamp ? window.formatTimestamp(overallStart) : overallStart) : '—'}</div>`;
        if (overallEnd) {
            html += `<div><strong>📊 綜合完成救援：</strong> ${window.formatTimestamp ? window.formatTimestamp(overallEnd) : overallEnd}</div>`;
        } else if (overallStart) {
            html += `<div><strong>📊 綜合完成救援：</strong> ⏳ 進行中</div>`;
        } else {
            html += `<div><strong>📊 綜合完成救援：</strong> —</div>`;
        }
        html += `</div><div style="font-size:0.7rem; color:#8ab; margin-top:4px;">💡 自動計算，僅供參考</div></div>`;

        if (snap.empty) {
            html += `<p style="color:#94a3b8;">此車廂暫無組別記錄</p>`;
        } else {
            html += `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">`;
            html += `<tr style="border-bottom:1px solid #444;">
                <th style="text-align:left; padding:6px 4px; color:#aaa;">組別</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">姓名</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">開始救援</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">完成救援</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">救護車車牌</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">醫院名稱</th>
                <th style="text-align:left; padding:6px 4px; color:#aaa;">狀態</th>
            </tr>`;
            snap.forEach(doc => {
                const data = doc.data();
                const status = window.getGroupStatus ? window.getGroupStatus(data) : 'waiting';
                const statusMap = { 'departed': '🔵 已離開', 'landed': '✅ 已著陸', 'rescuing': '🔄 救援中', 'waiting': '⏳ 等待救援' };
                const startTime = window.extractDateTime ? window.extractDateTime(data.timeReachedTop) : data.timeReachedTop || '-';
                const endTime = window.extractDateTime ? window.extractDateTime(data.timeLanded) : data.timeLanded || '-';
                const plate = data.ambulancePlate || '-';
                const hospital = data.hospital || '-';
                html += `<tr style="border-bottom:1px solid #3d3d3d;">`;
                html += `<td style="padding:6px 4px;">第${data.groupNumber||'?'}組</td>`;
                html += `<td style="padding:6px 4px;">${data.guestName||'-'}</td>`;
                html += `<td style="padding:6px 4px;">${startTime}</td>`;
                html += `<td style="padding:6px 4px;">${endTime}</td>`;
                html += `<td style="padding:6px 4px;">${plate}</td>`;
                html += `<td style="padding:6px 4px;">${hospital}</td>`;
                html += `<td style="padding:6px 4px;">${statusMap[status]||status}</td>`;
                html += `</tr>`;
            });
            html += `</table>`;
        }
        html += `<div style="margin-top:16px; text-align:center;">`;
        html += `<button onclick="this.closest('.modal-content').parentElement.style.display='none'" style="padding:8px 24px; background:#4285F4; border:none; border-radius:4px; color:#fff; cursor:pointer;">關閉</button>`;
        html += `</div></div>`;

        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:9999;';
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.style.cssText = 'background:#1a1a1a; border-radius:12px; padding:20px; max-width:700px; width:95%; max-height:80vh; overflow-y:auto;';
        content.innerHTML = html;
        modal.appendChild(content);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }).catch(err => {
        alert('載入車廂資料失敗: ' + err.message);
    });
}

// ---- 搜尋車廂（高亮） ----
function monSearchCabin() {
    const q = document.getElementById('monSearchBox')?.value.trim();
    if (!q) return alert('請輸入車廂號碼');
    const cabin = monMapCabins.find(c => c.fields.sequence === q);
    if (!cabin) return alert('找不到車廂: ' + q);

    monMapCabins.forEach(c => {
        c.shape.setAttribute('stroke', '');
        c.shape.setAttribute('stroke-width', '');
        c.shape.removeAttribute('filter');
    });
    cabin.shape.setAttribute('stroke', 'gold');
    cabin.shape.setAttribute('stroke-width', '6');
    cabin.shape.setAttribute('filter', 'url(#monHighlightGlow)');
    setTimeout(() => {
        cabin.shape.setAttribute('stroke', '');
        cabin.shape.setAttribute('stroke-width', '');
        cabin.shape.removeAttribute('filter');
    }, 5000);
}

// ---- 載入所有數據（統計、圖表、表格、最新訊息、組別進度） ----
async function monLoadAllData() {
    try {
        if (typeof showLoader === 'function') showLoader(true);
        const [guestSnap, rescueSnap] = await Promise.all([
            db.collection('guests').get(),
            db.collection('rescue_records').get()
        ]);
        monGuestRecords = [];
        guestSnap.forEach(d => { const data = d.data(); data.id = d.id; monGuestRecords.push(data); });
        monRescueRecords = [];
        rescueSnap.forEach(d => { const data = d.data(); data.id = d.id; monRescueRecords.push(data); });
        console.log(`監控載入：${monGuestRecords.length} 筆賓客，${monRescueRecords.length} 筆求助`);
        monUpdateAllDisplays();
        monUpdateTimestamp();
        // 更新地圖車廂（若已初始化）
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    } catch (e) {
        console.error('載入監控數據失敗:', e);
        if (typeof showMessage === 'function') showMessage('monMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

// ---- 更新所有顯示（統計卡片、圖表、表格、組別進度、最新訊息） ----
function monUpdateAllDisplays() {
    // 1. OCC 求助統計
    const total = monRescueRecords.length;
    const pending = monRescueRecords.filter(r => !r.processed).length;
    const processed = monRescueRecords.filter(r => r.processed).length;
    document.getElementById('occ-total').textContent = total;
    document.getElementById('occ-pending').textContent = pending;
    document.getElementById('occ-processed').textContent = processed;

    let g = 0, y = 0, r = 0, b = 0;
    monRescueRecords.forEach(rec => {
        const h = rec.healthStatus || '';
        if (h.includes('綠色')) g++;
        else if (h.includes('黃色')) y++;
        else if (h.includes('紅色')) r++;
        else if (h.includes('黑色')) b++;
    });
    document.getElementById('occ-green-count').textContent = g;
    document.getElementById('occ-yellow-count').textContent = y;
    document.getElementById('occ-red-count').textContent = r;
    document.getElementById('occ-black-count').textContent = b;

    // 2. 救援記錄統計 + 賓客健康
    const totalG = monGuestRecords.length;
    const completed = monGuestRecords.filter(rec => rec.status === 'completed' || rec.timeLanded).length;
    const pendingG = totalG - completed;
    const ambNeeded = monGuestRecords.filter(rec => rec.ambulance === '需要').length;
    document.getElementById('totalRecords').textContent = totalG;
    document.getElementById('completedRecords').textContent = completed;
    document.getElementById('pendingRecords').textContent = pendingG;
    document.getElementById('ambulanceNeeded').textContent = ambNeeded;

    let g2 = 0, y2 = 0, r2 = 0, b2 = 0;
    monGuestRecords.forEach(rec => {
        const h = rec.healthStatus || '';
        if (h.includes('綠色')) g2++;
        else if (h.includes('黃色')) y2++;
        else if (h.includes('紅色')) r2++;
        else if (h.includes('黑色')) b2++;
    });
    document.getElementById('green-count').textContent = g2;
    document.getElementById('yellow-count').textContent = y2;
    document.getElementById('red-count').textContent = r2;
    document.getElementById('black-count').textContent = b2;

    // 3. 圖表（救援時間分佈） - 保留原有
    monUpdateTimeChart();

    // 4. 表格（右欄）
    monRenderTable();

    // 5. 組別進度（左欄）
    monRenderGroupProgress();

    // 6. 最新救援訊息
    monUpdateLatestMessage();

    // 7. 地圖更新由 monUpdateFromFirestore 負責（在外部呼叫）
}

// ---- 更新救援時間分佈圖表 ----
function monUpdateTimeChart() {
    const ctx = document.getElementById('timeChart');
    if (!ctx) return;
    const canvas = ctx.getContext('2d');
    if (monChartInstance) monChartInstance.destroy();
    const ranges = [0, 0, 0, 0, 0];
    monGuestRecords.forEach(rec => {
        if (rec.timeReachedTop && rec.timeLanded) {
            const start = rec.timeReachedTop.split(':');
            const end = rec.timeLanded.split(':');
            if (start.length === 2 && end.length === 2) {
                let diff = (parseInt(end[0]) * 60 + parseInt(end[1])) - (parseInt(start[0]) * 60 + parseInt(start[1]));
                if (diff < 0) diff += 1440;
                if (diff <= 15) ranges[0]++;
                else if (diff <= 30) ranges[1]++;
                else if (diff <= 45) ranges[2]++;
                else if (diff <= 60) ranges[3]++;
                else ranges[4]++;
            }
        }
    });
    monChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: ['0-15分', '15-30分', '30-45分', '45-60分', '60分以上'],
            datasets: [{
                label: '救援時間分佈',
                data: ranges,
                backgroundColor: ['rgba(52,168,83,0.7)', 'rgba(66,133,244,0.7)', 'rgba(251,188,5,0.7)', 'rgba(255,152,0,0.7)', 'rgba(234,67,53,0.7)'],
                borderColor: ['#34A853', '#4285F4', '#FBBC05', '#FF9800', '#EA4335'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { color: '#c8d6e5', precision: 0 }, grid: { color: 'rgba(255,255,255,0.08)' } },
                x: { ticks: { color: '#c8d6e5' }, grid: { color: 'rgba(255,255,255,0.08)' } }
            },
            plugins: { legend: { labels: { color: '#c8d6e5' } } }
        }
    });
}

// ---- 渲染記錄表格（右欄，只顯示車廂、姓名、狀態，最多20筆） ----
function monRenderTable() {
    const tbody = document.getElementById('monitor-records-list');
    if (!tbody) return;
    tbody.innerHTML = '';
    const search = document.getElementById('searchInput');
    const searchValue = search ? search.value.toLowerCase() : '';
    let filtered = monGuestRecords;
    if (searchValue) {
        filtered = monGuestRecords.filter(rec => {
            const cabin = (rec.cabinNumber || '').toLowerCase();
            const group = (rec.groupNumber || '');
            const name = (rec.guestName || '').toLowerCase();
            return cabin.includes(searchValue) || group.includes(searchValue) || name.includes(searchValue);
        });
    }
    // 按車廂排序，取前20
    filtered.sort((a, b) => (a.cabinNumber || '').localeCompare((b.cabinNumber || ''), undefined, { numeric: true }));
    const display = filtered.slice(0, 20);
    display.forEach(rec => {
        const status = window.getGroupStatus ? window.getGroupStatus(rec) : 'waiting';
        let statusText = '', color = '';
        switch (status) {
            case 'departed': statusText = '已離開'; color = '#3b82f6'; break;
            case 'landed': statusText = '已著陸'; color = '#34a853'; break;
            case 'rescuing': statusText = '救援中'; color = '#f1c40f'; break;
            default: statusText = '等待救援'; color = '#e74c3c';
        }
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rec.cabinNumber || '-'}</td>
            <td>${rec.guestName || '-'}</td>
            <td><span class="status-dot" style="background:${color};"></span>${statusText}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---- 組別救援狀態進度條（左欄） ----
function monRenderGroupProgress() {
    const container = document.getElementById('groupProgressContainer');
    if (!container) return;
    const groups = {};
    monGuestRecords.forEach(r => {
        const g = r.groupNumber || '未分配';
        if (!groups[g]) groups[g] = { total: 0, completed: 0 };
        groups[g].total++;
        if (r.exitTime || r.status === 'completed' || r.status === 'landed') groups[g].completed++;
    });
    let html = '';
    // 按組號排序
    const sortedKeys = Object.keys(groups).sort((a,b) => {
        if (a === '未分配') return 1;
        if (b === '未分配') return -1;
        return parseInt(a) - parseInt(b);
    });
    sortedKeys.forEach(g => {
        const data = groups[g];
        const pct = data.total ? Math.round((data.completed/data.total)*100) : 0;
        html += `
            <div class="group-progress-item">
                <span class="gp-label">第${g}組</span>
                <div class="gp-bar">
                    <div class="gp-fill" style="width:${pct}%;"></div>
                    <div class="gp-empty" style="width:${100-pct}%;"></div>
                </div>
                <span class="gp-count">${data.completed}/${data.total}</span>
            </div>
        `;
    });
    container.innerHTML = html || '<div style="color:#8899bb; text-align:center; padding:20px;">暫無組別數據</div>';
}

// ---- 最新救援訊息 ----
function monUpdateLatestMessage() {
    const msgSpan = document.getElementById('latestMsgContent');
    if (!msgSpan) return;
    // 找最近 status 為 rescuing 或 timeReachedTop 最近的記錄
    const rescuing = monGuestRecords.filter(r => r.status === 'rescuing' || r.timeReachedTop);
    if (rescuing.length) {
        const latest = rescuing.sort((a,b) => {
            const ta = a.timeReachedTop ? a.timeReachedTop.toDate?.() : new Date(0);
            const tb = b.timeReachedTop ? b.timeReachedTop.toDate?.() : new Date(0);
            return tb - ta;
        })[0];
        msgSpan.textContent = `🚑 ${latest.cabinNumber || '?'} 號車廂第 ${latest.groupNumber || '?'} 組開始救援`;
    } else {
        msgSpan.textContent = '目前無救援進行中';
    }
}

// ---- 過濾表格（外部呼叫） ----
function monFilterRecords() {
    monRenderTable();
}

// ---- 手動刷新 ----
function monManualRefresh() {
    console.log('🔄 手動刷新監控頁面');
    monLoadAllData();
    setTimeout(() => { monLayoutCabins(); }, 100);
}

// ---- 匯出 CSV（簡易） ----
function monExportCSV() {
    if (!monGuestRecords.length) {
        alert('無資料可匯出');
        return;
    }
    const BOM = '\uFEFF';
    let csv = BOM + '車廂,姓名,組別,健康狀況,狀態\n';
    monGuestRecords.forEach(r => {
        const status = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
        const statusMap = { 'departed':'已離開','landed':'已著陸','rescuing':'救援中','waiting':'等待救援' };
        csv += `${r.cabinNumber||''},${r.guestName||''},${r.groupNumber||''},${r.healthStatus||''},${statusMap[status]||status}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `救援記錄_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ---- 更新時間戳 ----
function monUpdateTimestamp() {
    const now = new Date().toLocaleTimeString('zh-TW');
    ['last-map-update', 'last-data-update', 'last-chart-update', 'last-monitor-update'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = now;
    });
}

// ---- 初始化 ----
function monInit() {
    console.log('🚀 monInit 被呼叫');
    if (typeof db === 'undefined' || typeof realtimeDb === 'undefined') {
        console.warn('Firebase 尚未初始化，500ms 後重試');
        setTimeout(monInit, 500);
        return;
    }
    if (!document.getElementById('monitorMap')) {
        console.warn('#monitorMap 尚未存在，500ms 後重試');
        setTimeout(monInit, 500);
        return;
    }
    if (window._monInitialized) {
        console.log('Monitor 已初始化，跳過');
        return;
    }
    window._monInitialized = true;

    // 1. 初始化地圖（包含車廂建立）
    monInitMap();

    // 2. 載入數據
    monLoadAllData();

    // 3. 監聽即時更新（僅在頁面 active 時更新）
    db.collection('guests').onSnapshot(() => {
        if (document.getElementById('section-monitor')?.classList.contains('active')) {
            monLoadAllData();
        }
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (document.getElementById('section-monitor')?.classList.contains('active')) {
            monLoadAllData();
        }
    });

    // 4. 自動刷新（20秒）
    if (monAutoRefreshTimer) clearInterval(monAutoRefreshTimer);
    monAutoRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-monitor');
        if (section && section.classList.contains('active')) {
            console.log('🔄 監控平台自動更新 (20秒)');
            monLoadAllData();
        }
    }, 20000);

    // 5. 若搜尋框存在，綁定事件（已用 oninput）
    console.log('✅ 監控平台初始化完成（三欄橢圓版）');
}

// ---- 暴露全域 ----
window.monInit = monInit;
window.monSearchCabin = monSearchCabin;
window.monLoadAllData = monLoadAllData;
window.monFilterRecords = monFilterRecords;
window.monManualRefresh = monManualRefresh;
window.monExportCSV = monExportCSV;

console.log('✅ monitor.js 已載入（橢圓地圖版）');
