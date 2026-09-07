// ================================================================
// 總監控平台模組（完整版，支援 84/109 車廂同步）
// ================================================================

let monMapCabins = [];
let monMapRopePts = [];
let monSvg = null;
let monGuestRecords = [];
let monRescueRecords = [];
let monAutoRefreshTimer = null;
let monCurrentOffset = 0;
let _monOffsetUnsubscribe = null;
let monCabinMode = 84;
let _monModeUnsubscribe = null;

// ★ 救援建議相關變數（預設展開）－修正拼寫錯誤
let monUrgencyData = [];
let monSuggestionExpanded = false;

// ---- 輔助：從 Firestore 載入偏移量 ----
async function monLoadOffsetFromFirestore() {
    monCurrentOffset = await window.getGlobalOffsetFromFirestore();
    return monCurrentOffset;
}

function monSyncOffsetAndLayout() {
    monLayoutCabins();
}

// ---- 檢查車廂模式 ----
function monCheckModeChange(forceRebuild = false) {
    window.getGlobalModeFromFirestore().then(newMode => {
        if (newMode !== monCabinMode || forceRebuild) {
            if (newMode !== monCabinMode) {
                console.log(`🔄 Monitor 車廂模式變更為 ${newMode}`);
            } else {
                console.log('🔄 強制重新構建車廂（模式相同）');
            }
            monCabinMode = newMode;
            localStorage.setItem('mapCabinMode', newMode);
            monBuildCabins();
            monLayoutCabins();
            monUpdateFromFirestore();
            const totalEl = document.getElementById('monTotalCabins');
            if (totalEl) totalEl.textContent = monMapCabins.length;
            monUpdateSummary();
        }
    });
}

// ★ 改為 async，以確保內部非同步流程完成
async function monInitMap() {
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

    monSvg.setAttribute('viewBox', '0 0 2800 1000');

    while (monSvg.firstChild) monSvg.removeChild(monSvg.firstChild);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradMountain = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradMountain.setAttribute('id', 'monGradMountain');
    gradMountain.setAttribute('x1', '0');
    gradMountain.setAttribute('y1', '1');
    gradMountain.setAttribute('x2', '0');
    gradMountain.setAttribute('y2', '0');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', '0%');
    s1.setAttribute('stop-color', '#388E3C');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s2.setAttribute('offset', '100%');
    s2.setAttribute('stop-color', '#A5D6A7');
    gradMountain.appendChild(s1);
    gradMountain.appendChild(s2);
    defs.appendChild(gradMountain);

    const gradBay = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradBay.setAttribute('id', 'monGradBay');
    gradBay.setAttribute('x1', '0');
    gradBay.setAttribute('y1', '0');
    gradBay.setAttribute('x2', '0');
    gradBay.setAttribute('y2', '1');
    const s3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s3.setAttribute('offset', '0%');
    s3.setAttribute('stop-color', '#81D4FA');
    const s4 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s4.setAttribute('offset', '100%');
    s4.setAttribute('stop-color', '#0288D1');
    gradBay.appendChild(s3);
    gradBay.appendChild(s4);
    defs.appendChild(gradBay);

    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'monHighlightGlow');
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadow.setAttribute('dx', '0');
    shadow.setAttribute('dy', '0');
    shadow.setAttribute('stdDeviation', '6');
    shadow.setAttribute('flood-color', 'gold');
    filter.appendChild(shadow);
    defs.appendChild(filter);
    monSvg.appendChild(defs);

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', '2800');
    bg.setAttribute('height', '1000');
    bg.setAttribute('fill', '#1a2a3a');
    monSvg.appendChild(bg);

    const segments = ['TC', 'T1', 'T2A', 'AIAS', 'T2B', 'T3', 'T4', 'T5', 'NLS', 'T6', 'T7', 'NP'];
    const slots = [2, 2, 2, 2, 10, 6, 5, 1, 2, 7, 3];
    const startX = 50, endX = 2750;
    const unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for (let i = 0; i < slots.length; i++) {
        x += slots[i] * unit;
        xCoords.push(x);
    }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (x, y, w, h, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', y);
        r.setAttribute('width', w);
        r.setAttribute('height', h);
        r.setAttribute('fill', fillColor);
        monSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 180, '#4a4a4a');
    addRect(t2bX, baseY, t3X - t2bX, 180, '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},1000 L${t3X},1000 Z`);
    mountain.setAttribute('fill', 'url(#monGradMountain)');
    monSvg.appendChild(mountain);

    let groundPts = [];
    segments.forEach((s, i) => {
        let gx = xCoords[i], gy = baseY;
        if (s === 'NLS') gy = topY;
        else if (s === 'NP') gy = npY;
        else if (s === 'T3' || (i > 5 && i < segments.indexOf('NLS'))) gy = baseY - (baseY - topY) * ((gx - t3X) / (nlsX - t3X));
        else if (i > segments.indexOf('NLS')) gy = topY + (npY - topY) * ((gx - nlsX) / (npX - nlsX));
        groundPts.push([gx, gy]);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', gx);
        circle.setAttribute('cy', gy);
        circle.setAttribute('r', '14');
        circle.setAttribute('fill', '#fff');
        circle.setAttribute('stroke', '#444');
        circle.setAttribute('stroke-width', '3');
        monSvg.appendChild(circle);
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = s;
        txt.setAttribute('x', gx);
        txt.setAttribute('y', gy + 40);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#f20c0c');
        txt.setAttribute('stroke', '#f20c0c');
        txt.setAttribute('stroke-width', '2');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '25');
        monSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1] - 70]);
    const down = groundPts.map(p => [p[0], p[1] + 70]).reverse();
    monMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('points', monMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#aaaaaa');
    rope.setAttribute('stroke-width', '7');
    monSvg.appendChild(rope);

    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('transform', 'translate(1720, 700)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectBg.setAttribute('x', '0');
    rectBg.setAttribute('y', '0');
    rectBg.setAttribute('width', '400');
    rectBg.setAttribute('height', '280');
    rectBg.setAttribute('fill', '#2d2d2d');
    rectBg.setAttribute('stroke', '#555');
    rectBg.setAttribute('rx', '12');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.textContent = '車廂狀態';
    title.setAttribute('x', '200');
    title.setAttribute('y', '44');
    title.setAttribute('font-size', '34');
    title.setAttribute('font-weight', 'bold');
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('fill', '#fff');
    legend.appendChild(title);

    const legendItems = [
        { color: '#34A853', label: '已著陸', y: 84 },
        { color: '#3b82f6', label: '已離開', y: 136 },
        { color: '#FBBC05', label: '救援中', y: 188 },
        { color: '#EA4335', label: '等待救援', y: 240 }
    ];
    legendItems.forEach((item) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(32, ${item.y})`);
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('width', '32');
        r.setAttribute('height', '32');
        r.setAttribute('fill', item.color);
        r.setAttribute('stroke', '#333');
        r.setAttribute('rx', '4');
        g.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', '48');
        t.setAttribute('y', '24');
        t.setAttribute('font-size', '24');
        t.setAttribute('fill', '#fff');
        t.textContent = item.label;
        g.appendChild(t);
        legend.appendChild(g);
    });
    monSvg.appendChild(legend);

    // ★ 使用 await 確保偏移量與模式讀取完成
    await monLoadOffsetFromFirestore();
    monCabinMode = await window.getGlobalModeFromFirestore();
    localStorage.setItem('mapCabinMode', monCabinMode);

    // ★ 構建車廂
    monBuildCabins();

    // ★ 註冊偏移量監聽
    if (_monOffsetUnsubscribe) _monOffsetUnsubscribe();
    _monOffsetUnsubscribe = window.listenGlobalOffset((newOffset) => {
        if (Math.abs(newOffset - monCurrentOffset) > 0.001) {
            monCurrentOffset = newOffset;
            monLayoutCabins();
            console.log('Monitor 偏移量已同步:', newOffset);
        }
    });

    // ★ 註冊模式監聽
    if (_monModeUnsubscribe) _monModeUnsubscribe();
    _monModeUnsubscribe = window.listenGlobalMode((newMode) => {
        if (newMode !== monCabinMode) {
            monCabinMode = newMode;
            console.log('Monitor 模式已同步（來自雲端）:', newMode);
            localStorage.setItem('mapCabinMode', newMode);
            monBuildCabins();
            monLayoutCabins();
            monUpdateFromFirestore();
            const totalEl = document.getElementById('monTotalCabins');
            if (totalEl) totalEl.textContent = monMapCabins.length;
            monUpdateSummary();
        }
    });

    // ★ 監聽車廂序號變化（即時同步）
    realtimeDb.ref('cabins').on('value', (snap) => {
        const data = snap.val();
        if (!data) {
            monMapCabins.forEach(c => {
                c.fields = {};
                c.label.textContent = '';
            });
            monUpdateFromFirestore();
            return;
        }
        monMapCabins.forEach(c => {
            if (data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            } else {
                c.fields = {};
                c.label.textContent = '';
            }
        });
        monUpdateFromFirestore();
    });

    // ★ 立即讀取一次車廂序號，填充標籤
    const snap = await realtimeDb.ref('cabins').once('value');
    const data = snap.val();
    if (data) {
        monMapCabins.forEach(c => {
            if (data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            } else {
                c.fields = {};
                c.label.textContent = '';
            }
        });
    } else {
        monMapCabins.forEach(c => {
            c.fields = {};
            c.label.textContent = '';
        });
    }

    // ★ 監聽 guests 與 rescue_records
    db.collection('guests').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });

    // ★ 初次更新車廂狀態（此時 monMapCabins 已完整）
    await monUpdateFromFirestore();
    monUpdateSummary();

    console.log('✅ Monitor 地圖初始化完成（唯讀模式，資料與主地圖同步）');
}

// ----- 構建車廂 -----
function monBuildCabins() {
    if (!monSvg) return;
    monMapCabins.forEach(c => { if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    monMapCabins = [];
    const total = monCabinMode;
    const size = 26;
    const fontSize = 26;
    const ropeLen = monLengthOf(monMapRopePts);
    const offset = monCurrentOffset;
    for (let i = 0; i < total; i++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'cabin');
        const pts = [];
        for (let j = 0; j < 6; j++) {
            const a = Math.PI / 3 * j;
            pts.push((size * Math.cos(a)) + ',' + (size * Math.sin(a)));
        }
        const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        hex.setAttribute('points', pts.join(' '));
        hex.setAttribute('fill', '#ffffff');
        hex.setAttribute('stroke', '#333');
        hex.setAttribute('stroke-width', '2.5');
        g.appendChild(hex);
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('class', 'seq-label');
        lbl.setAttribute('y', '6');
        lbl.setAttribute('font-size', fontSize);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('fill', '#111');
        g.appendChild(lbl);
        const cabin = { id: 'cabin-' + i, fields: {}, el: g, shape: hex, label: lbl };
        g.addEventListener('dblclick', () => monOpenCabinReadonly(cabin));
        monMapCabins.push(cabin);
        monSvg.appendChild(g);
    }
    monLayoutCabins();
}

function monLayoutCabins() {
    if (!monMapRopePts || monMapRopePts.length === 0) {
        console.warn('monMapRopePts 尚未初始化，跳過佈局');
        return;
    }
    const ropeLen = monLengthOf(monMapRopePts);
    const offset = monCurrentOffset;
    monMapCabins.forEach((c, i) => {
        const d = ((i * ropeLen / monMapCabins.length + offset) % ropeLen + ropeLen) % ropeLen;
        const pos = monPointAt(monMapRopePts, d);
        if (pos) {
            c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
        }
    });
}

function monLengthOf(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return L;
}

function monPointAt(pts, d) {
    let sum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const seg = Math.hypot(x2 - x1, y2 - y1);
        if (sum + seg >= d) {
            const t = (d - sum) / seg;
            return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
        }
        sum += seg;
    }
    return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
}

// ================================================================
// 2. 更新車廂狀態
// ================================================================

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
                cabin.shape.setAttribute('fill', '#ffffff');
                cabin.shape.setAttribute('stroke', '#333');
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

    document.getElementById('monWaiting').textContent = waiting;
    document.getElementById('monRescuing').textContent = rescuing;
    document.getElementById('monLanded').textContent = landed;
    document.getElementById('monDeparted').textContent = departed;
    document.getElementById('monTotalCabins').textContent = monMapCabins.length;

    document.getElementById('monWaitingCabins').textContent = wc.join(', ');
    document.getElementById('monRescuingCabins').textContent = rc.join(', ');
    document.getElementById('monLandedCabins').textContent = lc.join(', ');
    document.getElementById('monDepartedCabins').textContent = dc.join(', ');
}

// ----- 搜尋車廂 -----
function monSearchCabin() {
    const q = document.getElementById('monSearchBox').value.trim();
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

// ----- 點擊車廂 → 開啟唯讀詳情 -----
function monOpenCabinReadonly(cabin) {
    const seq = cabin.fields.sequence || '未設定';
    db.collection('guests').where('cabinNumber', '==', seq).get().then(snap => {
        const overallStart = cabin.fields.overallTimeReachedTop;
        const overallEnd = cabin.fields.overallTimeLanded;
        console.log('Monitor 綜合時間:', { overallStart, overallEnd });

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

// ================================================================
// 3. 統計數據、表格
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
        monSyncOffsetAndLayout();
        monCheckModeChange(false);
    } catch (e) {
        console.error('載入監控數據失敗:', e);
        if (typeof showMessage === 'function') showMessage('monMessage', '載入失敗: ' + e.message, 'error');
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

// ★ 手動重新讀取車廂序號（用於刷新）
function monRefreshCabinsSequences() {
    realtimeDb.ref('cabins').once('value').then(snap => {
        const data = snap.val();
        monMapCabins.forEach(c => {
            if (data && data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            } else {
                c.fields = {};
                c.label.textContent = '';
            }
        });
        monUpdateSummary();
        console.log('✅ Monitor 車廂序號已重新讀取');
    }).catch(err => console.warn('讀取車廂序號失敗:', err));
}

function monUpdateAllDisplays() {
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

    // ★ 更新最新救援訊息
    updateLatestRescueMsg();

    // ★ 更新救援建議（緊急指數）
    updateRescueSuggestion();

    // ★ 確保救援建議預設展開
    const content = document.getElementById('suggestionContent');
    const btn = document.getElementById('suggestionToggleBtn');
    if (content && btn) {
        if (monSuggestionExpanded) {
            content.classList.add('open');
            btn.textContent = '▲ 收起';
        } else {
            content.classList.remove('open');
            btn.textContent = '▼ 展開';
        }
    }

    // ★ 更新延遲警報
    updateDelayAlert();

    monRenderTable();
    if (monMapCabins.length > 0) monUpdateFromFirestore();
}

// ★ 更新 Header 最新救援訊息
function updateLatestRescueMsg() {
    const el = document.getElementById('latestRescueMsg');
    if (!el) return;

    const rescuingRecords = monGuestRecords
        .filter(rec => {
            const status = window.getGroupStatus ? window.getGroupStatus(rec) : 'waiting';
            return status === 'rescuing';
        })
        .sort((a, b) => {
            const timeA = a.timeReachedTop || a.createdAt || '';
            const timeB = b.timeReachedTop || b.createdAt || '';
            return new Date(timeB) - new Date(timeA);
        });

    if (rescuingRecords.length > 0) {
        const latest = rescuingRecords[0];
        const cabinNumber = latest.cabinNumber || '未知車廂';
        const groupNumber = latest.groupNumber ? `第${latest.groupNumber}組` : '';
        const guestName = latest.guestName || '';

        el.textContent = `🚨 車廂 ${cabinNumber} ${groupNumber} ${guestName} 開始救援`;
        el.classList.add('highlight');

        clearTimeout(el._highlightTimer);
        el._highlightTimer = setTimeout(() => {
            el.classList.remove('highlight');
        }, 3000);
    } else {
        const waitingRecords = monGuestRecords.filter(rec => {
            const status = window.getGroupStatus ? window.getGroupStatus(rec) : 'waiting';
            return status === 'waiting';
        });

        if (waitingRecords.length > 0) {
            el.textContent = `⏳ 有 ${waitingRecords.length} 組等待救援中...`;
            el.classList.remove('highlight');
        } else {
            const completedRecords = monGuestRecords.filter(rec => {
                const status = window.getGroupStatus ? window.getGroupStatus(rec) : 'waiting';
                return status === 'landed' || status === 'departed';
            });

            if (completedRecords.length > 0) {
                el.textContent = `✅ 已有 ${completedRecords.length} 組完成救援`;
                el.classList.remove('highlight');
            } else {
                el.textContent = '等待第一筆救援...';
                el.classList.remove('highlight');
            }
        }
    }
}

// ================================================================
// ★ 救援建議功能（緊急指數）
// ================================================================

function calculateUrgencyScore(record, allRescueRecords) {
    const healthMap = { '紅色': 100, '黑色': 100, '黃色': 66, '綠色': 33 };
    const healthScore = healthMap[record.healthStatus] || 0;

    let waitMinutes = 0;
    if (record.createdAt) {
        let createdDate = null;
        if (typeof record.createdAt === 'object' && record.createdAt.toDate) {
            createdDate = record.createdAt.toDate();
        } else if (typeof record.createdAt === 'string') {
            createdDate = new Date(record.createdAt);
        } else if (record.createdAt.seconds !== undefined) {
            createdDate = new Date(record.createdAt.seconds * 1000);
        }
        if (createdDate && !isNaN(createdDate.getTime())) {
            waitMinutes = (Date.now() - createdDate.getTime()) / 60000;
        }
    }
    const timeScore = Math.min(waitMinutes / 60 * 100, 100);

    const cabinKey = (record.cabinNumber || '').trim();
    const sameCabinCount = allRescueRecords.filter(r => (r.cabinNumber || '').trim() === cabinKey).length;
    const groupScore = Math.min(sameCabinCount / 5 * 100, 100);

    const hasUnprocessed = allRescueRecords.some(r => 
        (r.cabinNumber || '').trim() === cabinKey && r.processed === false
    );
    const rescueScore = hasUnprocessed ? 100 : 0;

    return Math.round((healthScore * 0.4) + (timeScore * 0.3) + (groupScore * 0.15) + (rescueScore * 0.15));
}

function updateRescueSuggestion() {
    const container = document.getElementById('suggestionBody');
    if (!container) return;

    // ★ 只取「未處理」的求助記錄
    const validRecords = monRescueRecords.filter(r => 
        r.cabinNumber && 
        r.cabinNumber.trim() !== '' && 
        r.processed === false
    );

    if (validRecords.length === 0) {
        container.innerHTML = `
            <div class="top-priority-cabin">
                <div class="no-data">✅ 目前無待處理求助</div>
            </div>
        `;
        return;
    }

    const cabinMap = {};
    validRecords.forEach(record => {
        const cabin = record.cabinNumber.trim();
        if (!cabinMap[cabin]) {
            cabinMap[cabin] = [];
        }
        cabinMap[cabin].push(record);
    });

    const urgencyList = [];
    Object.keys(cabinMap).forEach(cabin => {
        const records = cabinMap[cabin];
        let bestRecord = null;
        let bestScore = -1;
        records.forEach(r => {
            const score = calculateUrgencyScore(r, validRecords);
            if (score > bestScore) {
                bestScore = score;
                bestRecord = r;
            }
        });
        if (bestRecord) {
            urgencyList.push({
                cabin: cabin,
                record: bestRecord,
                score: Math.round(bestScore),
                healthStatus: bestRecord.healthStatus || '未知'
            });
        }
    });

    urgencyList.sort((a, b) => b.score - a.score);

    if (urgencyList.length === 0) {
        container.innerHTML = `
            <div class="top-priority-cabin">
                <div class="no-data">暫無可評估的車廂</div>
            </div>
        `;
        return;
    }

    const top = urgencyList[0];
    const others = urgencyList.slice(1);

    let waitMinutes = 0;
    if (top.record.createdAt) {
        let createdDate = null;
        if (typeof top.record.createdAt === 'object' && top.record.createdAt.toDate) {
            createdDate = top.record.createdAt.toDate();
        } else if (typeof top.record.createdAt === 'string') {
            createdDate = new Date(top.record.createdAt);
        } else if (top.record.createdAt.seconds !== undefined) {
            createdDate = new Date(top.record.createdAt.seconds * 1000);
        }
        if (createdDate && !isNaN(createdDate.getTime())) {
            waitMinutes = Math.round((Date.now() - createdDate.getTime()) / 60000);
        }
    }

    const healthClass = top.healthStatus === '紅色' || top.healthStatus === '黑色' ? 'red' :
                        top.healthStatus === '黃色' ? 'yellow' :
                        top.healthStatus === '綠色' ? 'green' : '';

    let html = `
        <div class="top-priority-cabin">
            <div class="cabin-info">
                <span class="cabin-number">🚠 車廂 ${top.cabin}</span>
                <span class="health-badge ${healthClass}">${top.healthStatus}</span>
                <span class="wait-time">⏱ 等待 ${waitMinutes} 分鐘</span>
            </div>
            <span class="urgency-score">指數 ${top.score}</span>
        </div>
    `;

    if (others.length > 0) {
        html += `<div class="other-cabins-list">`;
        others.forEach(item => {
            let wm = 0;
            if (item.record.createdAt) {
                let createdDate = null;
                if (typeof item.record.createdAt === 'object' && item.record.createdAt.toDate) {
                    createdDate = item.record.createdAt.toDate();
                } else if (typeof item.record.createdAt === 'string') {
                    createdDate = new Date(item.record.createdAt);
                } else if (item.record.createdAt.seconds !== undefined) {
                    createdDate = new Date(item.record.createdAt.seconds * 1000);
                }
                if (createdDate && !isNaN(createdDate.getTime())) {
                    wm = Math.round((Date.now() - createdDate.getTime()) / 60000);
                }
            }
            const cls = item.healthStatus === '紅色' || item.healthStatus === '黑色' ? 'red' :
                        item.healthStatus === '黃色' ? 'yellow' : 'green';
            html += `
                <div class="other-item">
                    <span class="cabin-num">🚠 車廂 ${item.cabin}</span>
                    <span class="health-badge-sm ${cls}">${item.healthStatus}</span>
                    <span style="color:#94a3b8; font-size:0.7rem;">⏱ ${wm}分</span>
                    <span class="score-sm">指數 ${item.score}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

// ---- 切換救援建議展開/收起 ----
function toggleRescueSuggestion() {
    const content = document.getElementById('suggestionContent');
    const btn = document.getElementById('suggestionToggleBtn');
    if (!content || !btn) return;

    monSuggestionExpanded = !monSuggestionExpanded;
    content.classList.toggle('open', monSuggestionExpanded);
    btn.textContent = monSuggestionExpanded ? '▲ 收起' : '▼ 展開';
}

// ================================================================
// ★ 延遲警報功能
// ================================================================

function updateDelayAlert() {
    const container = document.getElementById('delayAlertContainer');
    const textEl = document.getElementById('delayAlertText');
    if (!container || !textEl) return;

    const pendingRecords = monRescueRecords.filter(r => 
        r.cabinNumber && r.cabinNumber.trim() !== '' && r.processed === false
    );

    if (pendingRecords.length === 0) {
        container.classList.remove('show', 'warning', 'danger');
        return;
    }

    const delayList = [];
    pendingRecords.forEach(record => {
        let waitMinutes = 0;
        if (record.createdAt) {
            let createdDate = null;
            if (typeof record.createdAt === 'object' && record.createdAt.toDate) {
                createdDate = record.createdAt.toDate();
            } else if (typeof record.createdAt === 'string') {
                createdDate = new Date(record.createdAt);
            } else if (record.createdAt.seconds !== undefined) {
                createdDate = new Date(record.createdAt.seconds * 1000);
            }
            if (createdDate && !isNaN(createdDate.getTime())) {
                waitMinutes = Math.round((Date.now() - createdDate.getTime()) / 60000);
            }
        }
        delayList.push({
            cabin: record.cabinNumber.trim(),
            waitMinutes: waitMinutes,
            record: record
        });
    });

    delayList.sort((a, b) => b.waitMinutes - a.waitMinutes);
    const worst = delayList[0];

    if (worst.waitMinutes < 15) {
        container.classList.remove('show', 'warning', 'danger');
        return;
    }

    let level = 'warning';
    let emoji = '⚠️';
    if (worst.waitMinutes >= 45) {
        level = 'danger';
        emoji = '🔴';
    } else if (worst.waitMinutes >= 30) {
        level = 'danger';
        emoji = '🔶';
    } else {
        emoji = '🟡';
    }

    container.className = `show ${level}`;
    textEl.textContent = `${emoji} 車廂 ${worst.cabin} 已等待 ${worst.waitMinutes} 分鐘`;
}

// ================================================================
// 表格渲染與過濾
// ================================================================

function monRenderTable() {
    const tbody = document.getElementById('monitor-records-list');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchInput = document.getElementById('searchInput');
    const cabinSearchInput = document.getElementById('cabinSearchInput');
    const searchValue = searchInput ? searchInput.value.toLowerCase() : '';
    const cabinSearchValue = cabinSearchInput ? cabinSearchInput.value.trim() : '';
    
    let filtered = monGuestRecords;
    
    if (searchValue) {
        filtered = filtered.filter(rec => {
            const cabin = (rec.cabinNumber || '').toLowerCase();
            const group = (rec.groupNumber || '');
            const name = (rec.guestName || '').toLowerCase();
            return cabin.includes(searchValue) || group.includes(searchValue) || name.includes(searchValue);
        });
    }
    
    if (cabinSearchValue) {
        filtered = filtered.filter(rec => {
            const cabin = (rec.cabinNumber || '').trim();
            return cabin === cabinSearchValue;
        });
    }
    
    filtered.sort((a, b) => {
        const timeA = a.timeReachedTop || a.createdAt || '';
        const timeB = b.timeReachedTop || b.createdAt || '';
        return new Date(timeB) - new Date(timeA);
    });
    
    filtered.forEach(rec => {
        const tr = document.createElement('tr');
        const status = window.getGroupStatus ? window.getGroupStatus(rec) : 'waiting';
        let statusText = '', badgeClass = '';
        switch (status) {
            case 'departed': statusText = '已離開'; badgeClass = 'status-departed'; break;
            case 'landed': statusText = '已著陸'; badgeClass = 'status-complete'; break;
            case 'rescuing': statusText = '救援中'; badgeClass = 'status-pending'; break;
            default: statusText = '等待救援'; badgeClass = 'status-waiting';
        }
        const startTime = window.formatTimestamp ? window.formatTimestamp(rec.timeReachedTop) : rec.timeReachedTop || '-';
        const endTime = window.formatTimestamp ? window.formatTimestamp(rec.timeLanded) : rec.timeLanded || '-';
        tr.innerHTML = `
            <td>${rec.cabinNumber || '-'}</td>
            <td>${rec.groupNumber ? '第' + rec.groupNumber + '組' : '-'}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td><span class="status-badge ${badgeClass}">${statusText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function monFilterRecords() { 
    monRenderTable(); 
}

function monUpdateTimestamp() {
    const now = new Date().toLocaleTimeString('zh-TW');
    ['last-map-update', 'last-data-update', 'last-monitor-update', 'last-cabin-stats'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = now;
    });
}

function monManualRefresh() {
    console.log('🔄 手動刷新監控頁面');
    // ★ 按鈕回饋
    const btn = document.querySelector('#section-monitor .map-toolbar button[onclick="monManualRefresh()"]');
    if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 更新中';
        btn.disabled = true;
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }, 1500);
    }

    monCheckModeChange(true);
    // ★ 重新讀取車廂序號
    monRefreshCabinsSequences();
    monLoadAllData();
    setTimeout(() => { 
        monSyncOffsetAndLayout(); 
        const totalEl = document.getElementById('monTotalCabins');
        if (totalEl) totalEl.textContent = monMapCabins.length;
    }, 100);
}

// ---- 初始化 ----
async function monInit() {
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

    // ★ 等待地圖初始化完成（包含車廂構建與標籤載入）
    await monInitMap();

    // ★ 再載入所有數據（表格、統計等）
    await monLoadAllData();

    // ★ 監聽 guests / rescue_records 變更（已在 monInitMap 內註冊，此處可省略，但保留備用）
    // 啟動自動刷新計時器
    if (monAutoRefreshTimer) clearInterval(monAutoRefreshTimer);
    monAutoRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-monitor');
        if (section && section.classList.contains('active')) {
            console.log('🔄 監控平台自動更新 (20秒)');
            monLoadAllData();
            monCheckModeChange(false);
        }
    }, 20000);
}

// ================================================================
// ★ 全屏模式控制
// ================================================================

function toggleFullscreen() {
    const btn = document.getElementById('fullscreenBtn');
    const navbar = document.getElementById('navbar');
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

    if (isFullscreen) {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        if (navbar) navbar.style.display = 'flex';
        btn.innerHTML = '<i class="fas fa-expand"></i> 全屏';
        btn.style.borderColor = 'rgba(0, 243, 255, 0.3)';
    } else {
        const element = document.documentElement;
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        }
        if (navbar) navbar.style.display = 'none';
        btn.innerHTML = '<i class="fas fa-compress"></i> 退出全屏';
        btn.style.borderColor = '#ffd700';
    }
}

function onFullscreenChange() {
    const btn = document.getElementById('fullscreenBtn');
    const navbar = document.getElementById('navbar');
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

    if (!btn) return;

    if (isFullscreen) {
        btn.innerHTML = '<i class="fas fa-compress"></i> 退出全屏';
        btn.style.borderColor = '#ffd700';
        if (navbar) navbar.style.display = 'none';
    } else {
        btn.innerHTML = '<i class="fas fa-expand"></i> 全屏';
        btn.style.borderColor = 'rgba(0, 243, 255, 0.3)';
        if (navbar) navbar.style.display = 'flex';
    }
}

document.addEventListener('fullscreenchange', onFullscreenChange);
document.addEventListener('webkitfullscreenchange', onFullscreenChange);

// ---- 暴露全域 ----
window.toggleFullscreen = toggleFullscreen;
window.monInit = monInit;
window.monSearchCabin = monSearchCabin;
window.monLoadAllData = monLoadAllData;
window.monFilterRecords = monFilterRecords;
window.monManualRefresh = monManualRefresh;
window.toggleRescueSuggestion = toggleRescueSuggestion;
window.monRefreshCabinsSequences = monRefreshCabinsSequences;

console.log('✅ monitor.js 已載入，等待 monInit 呼叫');
