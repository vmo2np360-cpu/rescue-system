// ================================================================
// 總監控平台模組（獨立 JS，與 monitor.html 分離）
// ================================================================

// ----- 地圖專屬變數 -----
let monMapCabins = [];
let monMapRopePts = [];
let monSvg = null;
let monChartInstance = null;
let monGuestRecords = [];
let monRescueRecords = [];
let monAutoRefreshTimer = null;
let monCurrentOffset = 0;  // ★ 儲存當前偏移量，用於檢測變化

// ★ 使用與主地圖相同的偏移量（共用 localStorage）
function monGetGlobalOffset() {
    return parseFloat(localStorage.getItem('mapGlobalOffset')) || 0;
}

// ================================================================
// 1. 地圖初始化
// ================================================================

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

    while (monSvg.firstChild) monSvg.removeChild(monSvg.firstChild);

    // ----- Defs -----
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    const gradMountain = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    gradMountain.setAttribute('id', 'monGradMountain');
    gradMountain.setAttribute('x1','0'); gradMountain.setAttribute('y1','1');
    gradMountain.setAttribute('x2','0'); gradMountain.setAttribute('y2','0');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','#388E3C');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#A5D6A7');
    gradMountain.appendChild(s1); gradMountain.appendChild(s2);
    defs.appendChild(gradMountain);

    const gradBay = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    gradBay.setAttribute('id', 'monGradBay');
    gradBay.setAttribute('x1','0'); gradBay.setAttribute('y1','0');
    gradBay.setAttribute('x2','0'); gradBay.setAttribute('y2','1');
    const s3 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s3.setAttribute('offset','0%'); s3.setAttribute('stop-color','#81D4FA');
    const s4 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s4.setAttribute('offset','100%'); s4.setAttribute('stop-color','#0288D1');
    gradBay.appendChild(s3); gradBay.appendChild(s4);
    defs.appendChild(gradBay);

    const filter = document.createElementNS('http://www.w3.org/2000/svg','filter');
    filter.setAttribute('id', 'monHighlightGlow');
    const shadow = document.createElementNS('http://www.w3.org/2000/svg','feDropShadow');
    shadow.setAttribute('dx','0'); shadow.setAttribute('dy','0');
    shadow.setAttribute('stdDeviation','6'); shadow.setAttribute('flood-color','gold');
    filter.appendChild(shadow);
    defs.appendChild(filter);
    monSvg.appendChild(defs);

    // 背景
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x','0'); bg.setAttribute('y','0');
    bg.setAttribute('width','2800'); bg.setAttribute('height','700');
    bg.setAttribute('fill','#1a2a3a');
    monSvg.appendChild(bg);

    // 地圖元素
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for(let i=0;i<slots.length;i++){ x += slots[i]*unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (x, y, w, h, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('fill', fillColor);
        monSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 100, '#4a4a4a');
    addRect(t2bX, baseY, t3X - t2bX, 100, '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg','path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill','url(#monGradMountain)');
    monSvg.appendChild(mountain);

    let groundPts = [];
    segments.forEach((s,i) => {
        let gx = xCoords[i], gy = baseY;
        if(s==='NLS') gy = topY;
        else if(s==='NP') gy = npY;
        else if(s==='T3' || (i>5 && i<segments.indexOf('NLS'))) gy = baseY - (baseY-topY)*((gx-t3X)/(nlsX-t3X));
        else if(i>segments.indexOf('NLS')) gy = topY + (npY-topY)*((gx-nlsX)/(npX-nlsX));
        groundPts.push([gx, gy]);
        const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
        circle.setAttribute('cx', gx); circle.setAttribute('cy', gy);
        circle.setAttribute('r', '8'); circle.setAttribute('fill', '#fff');
        circle.setAttribute('stroke', '#444'); circle.setAttribute('stroke-width', '2');
        monSvg.appendChild(circle);
        const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.textContent = s;
        txt.setAttribute('x', gx); txt.setAttribute('y', gy+25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '14');
        monSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1]-60]);
    const down = groundPts.map(p => [p[0], p[1]+60]).reverse();
    monMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    rope.setAttribute('points', monMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill','none'); rope.setAttribute('stroke','#666');
    rope.setAttribute('stroke-width','3');
    monSvg.appendChild(rope);

    // 圖例
    const legend = document.createElementNS('http://www.w3.org/2000/svg','g');
    legend.setAttribute('transform', 'translate(1800,420)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rectBg.setAttribute('x','0'); rectBg.setAttribute('y','0');
    rectBg.setAttribute('width','260'); rectBg.setAttribute('height','160');
    rectBg.setAttribute('fill','#2d2d2d'); rectBg.setAttribute('stroke','#555'); rectBg.setAttribute('rx','6');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg','text');
    title.textContent = '車廂狀態';
    title.setAttribute('x','130'); title.setAttribute('y','30');
    title.setAttribute('font-size','24'); title.setAttribute('font-weight','bold');
    title.setAttribute('text-anchor','middle'); title.setAttribute('fill','#fff');
    legend.appendChild(title);
    const items = [
        { color: '#EA4335', label: '等待救援', y: 65 },
        { color: '#FBBC05', label: '救援中', y: 100 },
        { color: '#34A853', label: '已著陸', y: 135 }
    ];
    items.forEach((item) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('transform', `translate(20, ${item.y})`);
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('width','20'); r.setAttribute('height','20');
        r.setAttribute('fill', item.color); r.setAttribute('stroke','#333');
        g.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg','text');
        t.setAttribute('x','30'); t.setAttribute('y','15');
        t.setAttribute('font-size','18'); t.setAttribute('fill','#fff');
        t.textContent = item.label;
        g.appendChild(t);
        legend.appendChild(g);
    });
    monSvg.appendChild(legend);

    // 建立車廂
    monBuildCabins();

    // 監聽車廂資料變化（與主地圖同步）
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

    // 初始載入序號
    realtimeDb.ref('cabins').once('value').then(snap => {
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

    // ★ 監聽主地圖偏移量變化（透過 localStorage 事件，僅跨標籤頁有效）
    window.addEventListener('storage', (e) => {
        if (e.key === 'mapGlobalOffset') {
            console.log('偵測到主地圖偏移量變化（跨標籤頁），同步更新');
            monSyncOffsetAndLayout();
        }
    });

    // Firestore 即時監聽（狀態更新）
    db.collection('guests').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });

    // 記錄初始偏移量
    monCurrentOffset = monGetGlobalOffset();

    console.log('✅ Monitor 地圖初始化完成（唯讀模式，資料與主地圖同步）');
}

// ★ 同步偏移量並重新佈局
function monSyncOffsetAndLayout() {
    const newOffset = monGetGlobalOffset();
    if (newOffset !== monCurrentOffset) {
        monCurrentOffset = newOffset;
        monLayoutCabins();
        console.log('偏移量已同步，新偏移量:', monCurrentOffset);
    }
}

// ----- 構建車廂（使用與主地圖相同的偏移量） -----
function monBuildCabins() {
    if (!monSvg) return;
    monMapCabins.forEach(c => { if(c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    monMapCabins = [];
    const total = 84;
    const size = 20;
    const fontSize = 20;
    const ropeLen = monLengthOf(monMapRopePts);
    const offset = monGetGlobalOffset();
    monCurrentOffset = offset;  // 記錄當前偏移量
    for(let i=0; i<total; i++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('class', 'cabin');
        const pts = [];
        for(let j=0; j<6; j++) {
            const a = Math.PI/3 * j;
            pts.push((size*Math.cos(a)) + ',' + (size*Math.sin(a)));
        }
        const hex = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        hex.setAttribute('points', pts.join(' '));
        hex.setAttribute('fill', '#ffffff');
        hex.setAttribute('stroke', '#333');
        g.appendChild(hex);
        const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
        lbl.setAttribute('class', 'seq-label');
        lbl.setAttribute('y', '5');
        lbl.setAttribute('font-size', fontSize);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('fill', '#111');
        g.appendChild(lbl);
        const cabin = { id: 'cabin-'+i, fields: {}, el: g, shape: hex, label: lbl };
        g.addEventListener('dblclick', () => monOpenCabinReadonly(cabin));
        monMapCabins.push(cabin);
        monSvg.appendChild(g);
    }
    monLayoutCabins();
}

function monLayoutCabins() {
    const ropeLen = monLengthOf(monMapRopePts);
    const offset = monGetGlobalOffset();
    // 更新當前偏移量
    monCurrentOffset = offset;
    monMapCabins.forEach((c, i) => {
        const d = (i * ropeLen / monMapCabins.length + offset) % ropeLen;
        const pos = monPointAt(monMapRopePts, d);
        c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
}

// ... 其他辅助函数（monLengthOf, monPointAt）保持不变 ...

// ----- 更新車廂狀態（與主地圖邏輯完全一致） -----
async function monUpdateFromFirestore() {
    try {
        // 1. 取得求助記錄 (rescue_records)
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

        // 2. 取得被救者記錄 (guests)
        const guestSnap = await db.collection('guests').get();
        const guestRecords = [];
        guestSnap.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        monMapCabins.forEach(cabin => {
            const seq = cabin.fields.sequence;
            cabin.el.classList.remove("status-red", "status-yellow", "status-green");
            cabin.shape.setAttribute('fill', '#ffffff');
            cabin.shape.setAttribute('stroke', '#333');

            if (seq) {
                // 優先判斷：是否有「未處理」的求助記錄 → 紅色 (等待救援)
                const hasUnprocessedRescue = rescueRecords.some(
                    r => r.cabinNumber === seq && r.processed === false
                );

                if (hasUnprocessedRescue) {
                    cabin.el.classList.add("status-red");
                    cabin.shape.setAttribute('fill', '#EA4335');
                    cabin.shape.setAttribute('stroke', '#b91c1c');
                    return;
                }

                // 若無未處理的救助記錄，則根據 guests 判斷狀態
                const matched = guestRecords.filter(g => g.cabinNumber === seq);

                if (matched.length > 0) {
                    let landed = 0, rescuing = 0, waiting = 0;
                    matched.forEach(g => {
                        const status = window.getGroupStatus(g);
                        if (status === 'landed') landed++;
                        else if (status === 'rescuing') rescuing++;
                        else waiting++;
                    });

                    if (landed === matched.length && matched.length > 0) {
                        cabin.el.classList.add("status-green");
                        cabin.shape.setAttribute('fill', '#34A853');
                        cabin.shape.setAttribute('stroke', '#16a34a');
                    } else {
                        cabin.el.classList.add("status-yellow");
                        cabin.shape.setAttribute('fill', '#FBBC05');
                        cabin.shape.setAttribute('stroke', '#ca8a04');
                    }
                } else {
                    cabin.shape.setAttribute('fill', '#666');
                    cabin.shape.setAttribute('stroke', '#888');
                }
            }
        });

        monUpdateSummary();
    } catch(e) {
        console.error('Monitor 地圖更新失敗:', e);
    }
}

function monUpdateSummary() {
    let waiting = 0, rescuing = 0, landed = 0;
    const wc=[], rc=[], lc=[];
    monMapCabins.forEach(c => {
        const seq = c.fields.sequence || '';
        if (c.el.classList.contains('status-red')) { waiting++; if(seq) wc.push(seq); }
        else if (c.el.classList.contains('status-yellow')) { rescuing++; if(seq) rc.push(seq); }
        else if (c.el.classList.contains('status-green')) { landed++; if(seq) lc.push(seq); }
    });
    document.getElementById('monWaiting').textContent = waiting;
    document.getElementById('monRescuing').textContent = rescuing;
    document.getElementById('monLanded').textContent = landed;
    document.getElementById('monWaitingCabins').textContent = wc.join(', ');
    document.getElementById('monRescuingCabins').textContent = rc.join(', ');
    document.getElementById('monLandedCabins').textContent = lc.join(', ');
}

// ================================================================
// 2. 統計數據、圖表、表格
// ================================================================

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

        // ★ 刷新數據後，檢查偏移量是否變化，同步佈局
        monSyncOffsetAndLayout();

    } catch(e) {
        console.error('載入監控數據失敗:', e);
        if (typeof showMessage === 'function') showMessage('monMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

// ★ 手動刷新函數（供按鈕調用）
function monManualRefresh() {
    console.log('🔄 手動刷新監控頁面');
    // 直接調用 monLoadAllData，它會同步偏移量並更新數據
    monLoadAllData();
    // 強制同步偏移量（額外保險）
    setTimeout(() => {
        monSyncOffsetAndLayout();
    }, 100);
}

// ... monUpdateAllDisplays, monUpdateTimeChart, monRenderTable, monFilterRecords, monUpdateTimestamp 保持不變（與之前相同） ...

// ================================================================
// 3. 主要入口（由 auth.js 呼叫）
// ================================================================

function monInit() {
    console.log('🚀 monInit 被呼叫 (來自 monitor.js)');
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

    monInitMap();
    monLoadAllData();

    // 設置 Firestore 即時監聽（數據變更時自動更新）
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

    // 自動更新：每20秒檢查一次，僅在監控頁面活躍時更新
    if (monAutoRefreshTimer) clearInterval(monAutoRefreshTimer);
    monAutoRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-monitor');
        if (section && section.classList.contains('active')) {
            console.log('🔄 監控平台自動更新 (20秒)');
            monLoadAllData();
        }
    }, 20000);
}

// ================================================================
// 4. 暴露全域函式
// ================================================================

window.monInit = monInit;
window.monSearchCabin = monSearchCabin;
window.monLoadAllData = monLoadAllData;
window.monFilterRecords = monFilterRecords;
window.monManualRefresh = monManualRefresh;  // ★ 暴露給 HTML 按鈕

console.log('✅ monitor.js 已載入，等待 monInit 呼叫');
