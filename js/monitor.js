// ================================================================
// 總監控平台模組（完整版）
// ================================================================

let monMapCabins = [];
let monMapRopePts = [];
let monSvg = null;
let monChartInstance = null;
let monGuestRecords = [];
let monRescueRecords = [];
let monAutoRefreshTimer = null;
let monCurrentOffset = 0;
let _monOffsetUnsubscribe = null;

// ---- 改用 Firestore 讀取偏移量 ----
function monGetGlobalOffset() {
    // 此函數將被非同步取代，保留同步版本僅供相容
    return monCurrentOffset;
}

async function monLoadOffsetFromFirestore() {
    monCurrentOffset = await window.getGlobalOffsetFromFirestore();
    return monCurrentOffset;
}

function monSyncOffsetAndLayout() {
    // 現在由監聽器處理，此函數保留以備手動呼叫
    monLayoutCabins();
}

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
    bg.setAttribute('height', '700');
    bg.setAttribute('fill', '#1a2a3a');
    monSvg.appendChild(bg);

    const segments = ['TC', 'T1', 'T2A', 'AIAS', 'T2B', 'T3', 'T4', 'T5', 'NLS', 'T6', 'T7', 'NP'];
    const slots = [2, 2, 2, 2, 10, 6, 5, 1, 2, 7, 3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
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
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 100, '#4a4a4a');
    addRect(t2bX, baseY, t3X - t2bX, 100, '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
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
        circle.setAttribute('r', '8');
        circle.setAttribute('fill', '#fff');
        circle.setAttribute('stroke', '#444');
        circle.setAttribute('stroke-width', '2');
        monSvg.appendChild(circle);
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = s;
        txt.setAttribute('x', gx);
        txt.setAttribute('y', gy + 25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '14');
        monSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1] - 60]);
    const down = groundPts.map(p => [p[0], p[1] + 60]).reverse();
    monMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('points', monMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#666');
    rope.setAttribute('stroke-width', '3');
    monSvg.appendChild(rope);

    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('transform', 'translate(1800,420)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectBg.setAttribute('x', '0');
    rectBg.setAttribute('y', '0');
    rectBg.setAttribute('width', '280');
    rectBg.setAttribute('height', '200');
    rectBg.setAttribute('fill', '#2d2d2d');
    rectBg.setAttribute('stroke', '#555');
    rectBg.setAttribute('rx', '6');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.textContent = '車廂狀態';
    title.setAttribute('x', '140');
    title.setAttribute('y', '30');
    title.setAttribute('font-size', '24');
    title.setAttribute('font-weight', 'bold');
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('fill', '#fff');
    legend.appendChild(title);

    const legendItems = [
        { color: '#34A853', label: '已著陸', y: 60 },
        { color: '#3b82f6', label: '已離開', y: 95 },
        { color: '#FBBC05', label: '救援中', y: 130 },
        { color: '#EA4335', label: '等待救援', y: 165 }
    ];
    legendItems.forEach((item) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(20, ${item.y})`);
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('width', '20');
        r.setAttribute('height', '20');
        r.setAttribute('fill', item.color);
        r.setAttribute('stroke', '#333');
        g.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', '30');
        t.setAttribute('y', '15');
        t.setAttribute('font-size', '18');
        t.setAttribute('fill', '#fff');
        t.textContent = item.label;
        g.appendChild(t);
        legend.appendChild(g);
    });
    monSvg.appendChild(legend);

    // ★ 讀取 Firestore 偏移量並建立車廂
    monLoadOffsetFromFirestore().then(() => {
        monBuildCabins();
        // 之後再監聽變化
        if (_monOffsetUnsubscribe) _monOffsetUnsubscribe();
        _monOffsetUnsubscribe = window.listenGlobalOffset((newOffset) => {
            if (Math.abs(newOffset - monCurrentOffset) > 0.001) {
                monCurrentOffset = newOffset;
                monLayoutCabins();
                console.log('Monitor 偏移量已同步:', newOffset);
            }
        });
    });

    // 監聽車廂序號變化（原有）
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

    // 不再需要 storage 監聽，因為改用 Firestore onSnapshot

    db.collection('guests').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });

    console.log('✅ Monitor 地圖初始化完成（唯讀模式，資料與主地圖同步）');
}

// ----- 構建車廂 -----
function monBuildCabins() {
    if (!monSvg) return;
    monMapCabins.forEach(c => { if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    monMapCabins = [];
    const total = 84;
    const size = 20;
    const fontSize = 20;
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
        g.appendChild(hex);
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('class', 'seq-label');
        lbl.setAttribute('y', '5');
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

// ---- 其餘函式（monUpdateFromFirestore, monUpdateSummary, monSearchCabin, monOpenCabinReadonly, monLoadAllData, monUpdateAllDisplays, monUpdateTimeChart, monRenderTable, monFilterRecords, monUpdateTimestamp, monManualRefresh, monInit 等保持原樣，僅需修改 monInit 中的 monInitMap 調用，其餘不變） ----
// 因篇幅限制，此處省略，請保留原檔案的其餘函式（它們不需修改）。

// ---- 暴露全域 ----
window.monInit = monInit;
window.monSearchCabin = monSearchCabin;
window.monLoadAllData = monLoadAllData;
window.monFilterRecords = monFilterRecords;
window.monManualRefresh = monManualRefresh;

console.log('✅ monitor.js 已載入，等待 monInit 呼叫');
