// ================================================================
// Monitor Dashboard V2 - 唯讀大屏監控
// ================================================================

let mdMapCabins = [];
let mdMapRopePts = [];
let mdMapSvg = null;
let mdCurrentOffset = 0;
let mdCabinMode = 84;
let mdGuestRecords = [];
let mdRescueRecords = [];
let mdCurrentIncident = null;
let mdGuestsOnline = null;
let mdRadarRange = 64;
let mdRadarCycleOffset = 0;
let mdRadarLoadFailCount = 0;

let _mdOffsetUnsub = null;
let _mdModeUnsub = null;
let _mdIncidentUnsub = null;
let _mdImpactUnsub = null;
let _mdTimeTimer = null;
let _mdAutoRefreshTimer = null;
let _mdRadarTimer = null;
let _mdWeatherTimer = null;

// ---------- 天氣警告圖示映射（請自行下載對應 PNG 到 assets/weather-icons/）----------
// ================================================================
// 香港天文台天氣警告圖示映射
// 檔案：assets/weather-icons/1.png ~ 21.png
// ================================================================
function mdGetWarningIcon(item) {
    const code = (item.code || '').toUpperCase();
    const type = item.type || '';

    switch (code) {
        case 'WTCSGNL':
            if (type.includes('一號') || type.includes('1號')) return '1.png';
            if (type.includes('三號') || type.includes('3號')) return '2.png';
            if (type.includes('東北')) return '3.png';
            if (type.includes('西北')) return '4.png';
            if (type.includes('東南')) return '5.png';
            if (type.includes('西南')) return '6.png';
            if (type.includes('九號') || type.includes('9號')) return '7.png';
            if (type.includes('十號') || type.includes('10號')) return '8.png';
            return null;

        case 'WRAIN':
        case 'WRAINA':
        case 'WRAINR':
        case 'WRAINB':
            if (type.includes('黃') || type.includes('黄')) return '9.png';
            if (type.includes('紅') || type.includes('红')) return '10.png';
            if (type.includes('黑')) return '11.png';
            if (code === 'WRAINA') return '9.png';
            if (code === 'WRAINR') return '10.png';
            if (code === 'WRAINB') return '11.png';
            return null;

        case 'WTS':     return '12.png';  // 雷暴
        case 'WFNTR':   return '13.png';  // 新界北部水浸
        case 'WL':      return '14.png';  // 山泥傾瀉
        case 'WMSGNL':  return '15.png';  // 強烈季候風
        case 'WFROST':  return '16.png';  // 霜凍

        case 'WFIRE':
        case 'WFIREY':
        case 'WFIRER':
            if (type.includes('黃') || type.includes('黄') || code === 'WFIREY') return '17.png';
            if (type.includes('紅') || type.includes('红') || code === 'WFIRER') return '18.png';
            return null;

        case 'WCOLD':   return '19.png';  // 寒冷
        case 'WHOY':    return '20.png';  // 酷熱
        case 'WTMW':    return '21.png';  // 海嘯
        default:        return null;
    }
}

// ---------- 天氣狀況圖示（天文台 forecastIcon 對應）----------
function mdWeatherIconUrl(code) {
    const c = String(code).padStart(2, '0');
    return `assets/weather-icons/pic${c}.png`;
}

// ================================================================
// 初始化入口
// ================================================================
async function mdInit() {
    if (!document.getElementById('md-map')) {
        console.warn('mdInit: 尚未載入 #md-map，300ms 後重試');
        setTimeout(mdInit, 300);
        return;
    }
    if (window._mdInitialized) {
        console.log('Monitor Dashboard 已初始化，跳過');
        return;
    }
    window._mdInitialized = true;

    console.log('🚀 Monitor Dashboard 初始化中...');

    await mdInitMap();
    await mdLoadAllData();

    mdListenIncident();
    mdListenOperationalImpact();
    mdUpdateCurrentTime();

    if (_mdTimeTimer) clearInterval(_mdTimeTimer);
    _mdTimeTimer = setInterval(mdUpdateCurrentTime, 1000);

    if (_mdAutoRefreshTimer) clearInterval(_mdAutoRefreshTimer);
    _mdAutoRefreshTimer = setInterval(() => {
        const sec = document.getElementById('section-monitor-dashboard');
        if (sec && sec.classList.contains('active')) {
            console.log('🔄 Monitor Dashboard 自動更新 (20秒)');
            mdLoadAllData();
        }
    }, 20000);

    // 天氣：每 10 分鐘
    mdFetchWeather();
    mdFetchWarnings();
    if (_mdWeatherTimer) clearInterval(_mdWeatherTimer);
    _mdWeatherTimer = setInterval(() => {
        mdFetchWeather();
        mdFetchWarnings();
    }, 10 * 60 * 1000);

    // 雷達圖：每 5 分鐘
    mdUpdateRadar();
    if (_mdRadarTimer) clearInterval(_mdRadarTimer);
    _mdRadarTimer = setInterval(mdUpdateRadar, 5 * 60 * 1000);

    mdBindRadarControls();

    console.log('✅ Monitor Dashboard 初始化完成');
}

// ================================================================
// 地圖初始化
// ================================================================
async function mdInitMap() {
    mdSvg = mdMapSvg = document.getElementById('md-map');
    if (!mdSvg) return;

    while (mdSvg.firstChild) mdSvg.removeChild(mdSvg.firstChild);

    // defs
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
        <linearGradient id="mdGradMountain" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#388E3C"/>
            <stop offset="100%" stop-color="#A5D6A7"/>
        </linearGradient>
        <linearGradient id="mdGradBay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#81D4FA"/>
            <stop offset="100%" stop-color="#0288D1"/>
        </linearGradient>
        <filter id="mdHighlightGlow">
            <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="gold"/>
        </filter>
        <g id="mdTowerSymbol">
            <line x1="-20" y1="0" x2="0" y2="-100" stroke="#444" stroke-width="6"/>
            <line x1="20" y1="0" x2="0" y2="-100" stroke="#444" stroke-width="6"/>
            <line x1="-15" y1="-30" x2="15" y2="-30" stroke="#444" stroke-width="4"/>
            <line x1="-10" y1="-60" x2="10" y2="-60" stroke="#444" stroke-width="3"/>
            <rect x="-30" y="-110" width="60" height="12" fill="#999" stroke="#222"/>
            <rect x="-25" y="0" width="50" height="10" fill="#555"/>
        </g>
        <g id="mdStationSymbol">
            <rect x="-50" y="-20" width="100" height="20" fill="#9e9e9e" stroke="#333"/>
            <polygon points="-60,-70 60,-70 40,-20 -40,-20" fill="#bdbdbd" stroke="#222"/>
            <rect x="-35" y="-55" width="15" height="20" fill="#eee" stroke="#222"/>
            <rect x="-7" y="-55" width="15" height="20" fill="#eee" stroke="#222"/>
            <rect x="21" y="-55" width="15" height="20" fill="#eee" stroke="#222"/>
            <line x1="0" y1="-70" x2="0" y2="-100" stroke="#757575" stroke-width="3"/>
            <circle cx="0" cy="-100" r="6" fill="#616161" stroke="#222"/>
        </g>
    `;
    mdSvg.appendChild(defs);

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', '2800'); bg.setAttribute('height', '700');
    bg.setAttribute('fill', '#f0f4f8');
    mdSvg.appendChild(bg);

    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 50, endX = 2750, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for (let i = 0; i < slots.length; i++) { x += slots[i] * unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (x, y, w, h, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('fill', fillColor);
        mdSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 100, '#d4d4d4');
    addRect(t2bX, baseY, t3X - t2bX, 100, '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill', 'url(#mdGradMountain)');
    mdSvg.appendChild(mountain);

    const groundPts = [];
    segments.forEach((s, i) => {
        let gx = xCoords[i], gy = baseY;
        if (s === 'NLS') gy = topY;
        else if (s === 'NP') gy = npY;
        else if (s === 'T3' || (i > 5 && i < segments.indexOf('NLS'))) gy = baseY - (baseY - topY) * ((gx - t3X) / (nlsX - t3X));
        else if (i > segments.indexOf('NLS')) gy = topY + (npY - topY) * ((gx - nlsX) / (npX - nlsX));
        groundPts.push([gx, gy]);

        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', ['TC','AIAS','NLS','NP'].includes(s) ? '#mdStationSymbol' : '#mdTowerSymbol');
        use.setAttribute('transform', `translate(${gx},${gy}) scale(0.6)`);
        mdSvg.appendChild(use);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = s;
        txt.setAttribute('x', gx); txt.setAttribute('y', gy + 25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#000');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '22');
        mdSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1] - 70]);
    const down = groundPts.map(p => [p[0], p[1] + 70]).reverse();
    mdMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];

    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('points', mdMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#444');
    rope.setAttribute('stroke-width', '4');
    mdSvg.appendChild(rope);

    // 圖例（左下）
    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('transform', 'translate(1600, 460)');
    legend.innerHTML = `
        <rect x="0" y="0" width="320" height="280" fill="white" stroke="#333" rx="8"/>
        <text x="160" y="40" font-size="30" font-weight="bold" text-anchor="middle">車廂狀態</text>
        <g transform="translate(25,60)">
            <rect width="26" height="26" fill="#22c55e" stroke="#333"/>
            <text x="40" y="19" font-size="24">已著陸</text>
        </g>
        <g transform="translate(25,100)">
            <rect width="26" height="26" fill="#3b82f6" stroke="#333"/>
            <text x="40" y="19" font-size="24">已離開</text>
        </g>
        <g transform="translate(25,140)">
            <rect width="26" height="26" fill="#eab308" stroke="#333"/>
            <text x="40" y="19" font-size="24">救援中</text>
        </g>
        <g transform="translate(25,180)">
            <rect width="26" height="26" fill="#dc2626" stroke="#333"/>
            <text x="40" y="19" font-size="24">等待救援</text>
        </g>
        <g transform="translate(25,220)">
            <rect width="26" height="26" fill="#e2e8f0" stroke="#333"/>
            <text x="40" y="19" font-size="24">無組別記錄</text>
        </g>
    `;
    mdSvg.appendChild(legend);

    // 載入偏移量與模式
    mdCurrentOffset = await window.getGlobalOffsetFromFirestore();
    mdCabinMode = await window.getGlobalModeFromFirestore();
    localStorage.setItem('mapCabinMode', mdCabinMode);

    mdBuildCabins();

    // 註冊監聽
    if (_mdOffsetUnsub) _mdOffsetUnsub();
    _mdOffsetUnsub = window.listenGlobalOffset((newOffset) => {
        if (Math.abs(newOffset - mdCurrentOffset) > 0.001) {
            mdCurrentOffset = newOffset;
            mdLayoutCabins();
        }
    });

    if (_mdModeUnsub) _mdModeUnsub();
    _mdModeUnsub = window.listenGlobalMode((newMode) => {
        if (newMode !== mdCabinMode) {
            mdCabinMode = newMode;
            localStorage.setItem('mapCabinMode', newMode);
            mdBuildCabins();
            mdLayoutCabins();
            mdUpdateFromFirestore();
        }
    });

    // realtime cabins 監聽
    realtimeDb.ref('cabins').on('value', (snap) => {
        const data = snap.val();
        mdMapCabins.forEach(c => {
            if (data && data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            } else {
                c.fields = {};
                c.label.textContent = '';
            }
        });
        mdUpdateFromFirestore();
    });

    // Firestore 監聽
    db.collection('guests').onSnapshot(() => {
        if (mdMapCabins.length > 0) mdUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (mdMapCabins.length > 0) mdUpdateFromFirestore();
    });
}

// ================================================================
// 車廂
// ================================================================
function mdBuildCabins() {
    if (!mdSvg) return;
    mdMapCabins.forEach(c => { if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    mdMapCabins = [];

    const total = mdCabinMode;
    const size = mdCabinMode === 109 ? 20 : 24;
    const fontSize = mdCabinMode === 109 ? 22 : 26;

    for (let i = 0; i < total; i++) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'md-cabin');
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
        lbl.setAttribute('y', '5');
        lbl.setAttribute('font-size', fontSize);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('dominant-baseline', 'middle');
        lbl.setAttribute('fill', '#111');
        g.appendChild(lbl);

        const cabin = { id: 'cabin-' + i, fields: {}, el: g, shape: hex, label: lbl };
        mdMapCabins.push(cabin);
        mdSvg.appendChild(g);
    }

    mdLayoutCabins();
}

function mdLayoutCabins() {
    if (!mdMapRopePts || mdMapRopePts.length === 0) return;
    const ropeLen = mdLengthOf(mdMapRopePts);
    mdMapCabins.forEach((c, i) => {
        const d = ((i * ropeLen / mdMapCabins.length + mdCurrentOffset) % ropeLen + ropeLen) % ropeLen;
        const pos = mdPointAt(mdMapRopePts, d);
        if (pos) c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
}

function mdLengthOf(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return L;
}

function mdPointAt(pts, d) {
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
// 資料更新
// ================================================================
async function mdLoadAllData() {
    try {
        const [guestSnap, rescueSnap] = await Promise.all([
            db.collection('guests').get(),
            db.collection('rescue_records').get()
        ]);
        mdGuestRecords = [];
        guestSnap.forEach(d => { const data = d.data(); data.id = d.id; mdGuestRecords.push(data); });
        mdRescueRecords = [];
        rescueSnap.forEach(d => { const data = d.data(); data.id = d.id; mdRescueRecords.push(data); });

        mdUpdateFromFirestore();
        mdUpdateOperationalImpact();
        mdUpdateLastUpdated();
    } catch (e) {
        console.error('Monitor Dashboard 載入失敗:', e);
    }
}

async function mdUpdateFromFirestore() {
    // 只讀：不寫回 realtimeDb
    mdMapCabins.forEach(cabin => {
        const seq = cabin.fields.sequence;
        cabin.el.classList.remove('status-red', 'status-yellow', 'status-green', 'status-departed', 'status-empty');
        cabin.shape.setAttribute('fill', '#ffffff');
        cabin.shape.setAttribute('stroke', '#333');

        if (!seq) {
            cabin.shape.setAttribute('fill', '#e2e8f0');
            cabin.shape.setAttribute('stroke', '#94a3b8');
            return;
        }

        const matched = mdGuestRecords.filter(g => g.cabinNumber === seq);
        const hasUnprocessedRescue = mdRescueRecords.some(
            r => r.cabinNumber === seq && r.processed === false
        );

        let overallStatus = 'empty';
        if (matched.length === 0) overallStatus = 'empty';
        else overallStatus = window.getCabinOverallStatus ? window.getCabinOverallStatus(matched) : 'waiting';

        let finalStatus = overallStatus;
        if (hasUnprocessedRescue && (overallStatus === 'empty' || overallStatus === 'waiting')) {
            finalStatus = 'waiting';
        }

        switch (finalStatus) {
            case 'landed':
                cabin.el.classList.add('status-green');
                cabin.shape.setAttribute('fill', '#22c55e');
                cabin.shape.setAttribute('stroke', '#16a34a');
                break;
            case 'departed':
                cabin.el.classList.add('status-departed');
                cabin.shape.setAttribute('fill', '#3b82f6');
                cabin.shape.setAttribute('stroke', '#2563eb');
                break;
            case 'rescuing':
                cabin.el.classList.add('status-yellow');
                cabin.shape.setAttribute('fill', '#eab308');
                cabin.shape.setAttribute('stroke', '#ca8a04');
                break;
            case 'waiting':
                cabin.el.classList.add('status-red');
                cabin.shape.setAttribute('fill', '#dc2626');
                cabin.shape.setAttribute('stroke', '#b91c1c');
                break;
            case 'empty':
            default:
                cabin.shape.setAttribute('fill', '#e2e8f0');
                cabin.shape.setAttribute('stroke', '#94a3b8');
                break;
        }
    });

    mdUpdateSummary();
}

function mdUpdateSummary() {
    let waiting = 0, rescuing = 0, landed = 0, departed = 0;
    mdMapCabins.forEach(c => {
        if (c.el.classList.contains('status-red')) waiting++;
        else if (c.el.classList.contains('status-yellow')) rescuing++;
        else if (c.el.classList.contains('status-green')) landed++;
        else if (c.el.classList.contains('status-departed')) departed++;
    });

    const a = document.getElementById('md-awaiting');
    const b = document.getElementById('md-in-progress');
    const c = document.getElementById('md-rescued');
    const d = document.getElementById('md-closed');
    if (a) a.textContent = waiting;
    if (b) b.textContent = rescuing;
    if (c) c.textContent = landed;
    if (d) d.textContent = departed;

    // Rescue Progress = landed / cabins online
    const total = mdCabinMode;
    const pct = total > 0 ? Math.round((landed / total) * 100) : 0;
    const pctEl = document.getElementById('md-progress-pct');
    const fillEl = document.getElementById('md-progress-fill');
    if (pctEl) pctEl.textContent = pct + '%';
    if (fillEl) fillEl.style.width = pct + '%';
}

function mdUpdateOperationalImpact() {
    const cabinsEl = document.getElementById('md-cabins-online');
    const casesEl = document.getElementById('md-cases-received');
    const affectedEl = document.getElementById('md-guests-affected');

    if (cabinsEl) cabinsEl.textContent = mdCabinMode;
    if (casesEl) casesEl.textContent = mdRescueRecords.length;
    if (affectedEl) affectedEl.textContent = mdRescueRecords.length; // 暫定 = OCC 求助記錄

    // Guests online 由 config/operationalImpact 更新，此處只保留接口
    const guestsEl = document.getElementById('md-guests-online');
    if (guestsEl && mdGuestsOnline === null) guestsEl.textContent = '—';
}

function mdUpdateLastUpdated() {
    const el = document.getElementById('md-last-updated');
    if (el) el.textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

// ================================================================
// Incident 監聽
// ================================================================
function mdListenIncident() {
    if (_mdIncidentUnsub) _mdIncidentUnsub();
    _mdIncidentUnsub = db.collection('incidents')
        .orderBy('incidentTime', 'desc')
        .limit(1)
        .onSnapshot((snap) => {
            if (snap.empty) {
                mdCurrentIncident = null;
                mdRenderIncident(null);
                return;
            }
            const doc = snap.docs[0];
            const data = doc.data();
            data.id = doc.id;
            mdCurrentIncident = data;
            mdRenderIncident(data);
        }, (err) => {
            console.warn('監聽 incidents 失敗:', err);
        });
}

function mdRenderIncident(incident) {
    const dateEl = document.getElementById('md-date');
    const statusEl = document.getElementById('md-incident-status');
    const statusTextEl = document.getElementById('md-incident-status-text');
    const typeEl = document.getElementById('md-incident-type');
    const incTimeEl = document.getElementById('md-incident-time');

    if (!incident) {
        if (dateEl) dateEl.textContent = '—';
        if (statusTextEl) statusTextEl.textContent = '—';
        if (typeEl) typeEl.textContent = '—';
        if (incTimeEl) incTimeEl.textContent = '—';
        return;
    }

    // Date: 10 Sept 2026
    if (dateEl) dateEl.textContent = mdFormatIncidentDate(incident.date);
    if (typeEl) typeEl.textContent = incident.type || '—';

    const status = (incident.status || '').toUpperCase();
    if (statusTextEl) statusTextEl.textContent = status || '—';
    if (statusEl) {
        statusEl.classList.remove('md-status-active', 'md-status-closed');
        if (status === 'ACTIVE') statusEl.classList.add('md-status-active');
        else statusEl.classList.add('md-status-closed');
    }

    // Incident Time
    if (incTimeEl) {
        if (incident.incidentTime) {
            incTimeEl.textContent = mdFormatDateTime(incident.incidentTime);
        } else {
            incTimeEl.textContent = '—';
        }
    }

    mdUpdateCurrentTime();
}

function mdFormatIncidentDate(input) {
    if (!input) return '—';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];
    let d;
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input)) {
        d = new Date(input);
    } else if (input.toDate) {
        d = input.toDate();
    } else if (input.seconds) {
        d = new Date(input.seconds * 1000);
    } else {
        d = new Date(input);
    }
    if (isNaN(d.getTime())) return '—';
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function mdFormatDateTime(input) {
    if (!input) return '—';
    let d;
    if (input.toDate) d = input.toDate();
    else if (input.seconds) d = new Date(input.seconds * 1000);
    else if (typeof input === 'string') d = new Date(input);
    else d = new Date(input);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ================================================================
// Current Time / Duration
// ================================================================
function mdUpdateCurrentTime() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const curEl = document.getElementById('md-current-time');
    if (curEl) {
        curEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    const durEl = document.getElementById('md-duration');
    if (!durEl) return;

    if (!mdCurrentIncident || !mdCurrentIncident.incidentTime) {
        durEl.textContent = '—';
        return;
    }

    let incTime;
    const it = mdCurrentIncident.incidentTime;
    if (it.toDate) incTime = it.toDate();
    else if (it.seconds) incTime = new Date(it.seconds * 1000);
    else incTime = new Date(it);
    if (isNaN(incTime.getTime())) { durEl.textContent = '—'; return; }

    const diffMs = now - incTime;
    if (diffMs < 0) { durEl.textContent = '—'; return; }

    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) durEl.textContent = `${h}h ${m}m`;
    else durEl.textContent = `${m}m`;
}

// ================================================================
// 天氣 API
// ================================================================
async function mdFetchWeather() {
    try {
        const url = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc';
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        // 溫度：優先香港天文台
        let temp = null, humidity = null;
        if (data.temperature && Array.isArray(data.temperature.data)) {
            const hk = data.temperature.data.find(d => d.place === '香港天文台')
                    || data.temperature.data.find(d => d.place === '香港')
                    || data.temperature.data[0];
            if (hk) temp = hk.value;
        }
        if (data.humidity && Array.isArray(data.humidity.data)) {
            humidity = data.humidity.data[0]?.value ?? null;
        }

        const tempEl = document.getElementById('md-temp');
        const humEl = document.getElementById('md-humidity');
        if (tempEl) tempEl.textContent = temp ?? '—';
        if (humEl) humEl.textContent = humidity ?? '—';

        // 天氣狀況圖示
        if (Array.isArray(data.icon) && data.icon.length > 0) {
            const iconImg = document.getElementById('md-weather-icon');
            if (iconImg) {
                iconImg.style.display = '';
                iconImg.src = mdWeatherIconUrl(data.icon[0]);
            }
        }
    } catch (e) {
        console.warn('天氣 API 失敗:', e);
    }
}

async function mdFetchWarnings() {
    try {
        const url = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc';
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        const container = document.getElementById('md-warning-icons');
        if (!container) return;
        container.innerHTML = '';

        Object.keys(data).forEach(key => {
            if (key === 'updateTime') return;
            const item = data[key];
            if (!item || typeof item !== 'object') return;

            const iconFile = mdGetWarningIcon(item);
            if (!iconFile) return;

            const img = document.createElement('img');
            img.src = `assets/weather-icons/${iconFile}`;
            img.alt = item.name || key;
            img.title = `${item.name || key}${item.type ? ' - ' + item.type : ''}`;
            img.onerror = () => { img.style.display = 'none'; };
            container.appendChild(img);
        });
    } catch (e) {
        console.warn('天氣警告 API 失敗:', e);
    }
}

// ================================================================
// 雷達圖
// ================================================================
function mdBuildRadarUrl(range, cycleOffset = 0) {
    const interval = range === 64 ? 6 : 12;
    const now = new Date(Date.now() - cycleOffset * interval * 60 * 1000);
    const y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(Math.floor(now.getMinutes() / interval) * interval).padStart(2, '0');
    const rangeStr = String(range).padStart(3, '0');
    return {
        url: `https://www.hko.gov.hk/wxinfo/radars/rad_${rangeStr}_png/2d${rangeStr}nradar_${y}${M}${d}${h}${m}.jpg`,
        time: `${M}/${d} ${h}:${m}`
    };
}

function mdUpdateRadar() {
    mdRadarCycleOffset = 0;
    mdRadarLoadFailCount = 0;
    mdLoadRadarImage();
}

function mdLoadRadarImage() {
    const img = document.getElementById('md-radar-img');
    const timeEl = document.getElementById('md-radar-time');
    const rangeEl = document.getElementById('md-radar-range');
    if (!img) return;

    const { url, time } = mdBuildRadarUrl(mdRadarRange, mdRadarCycleOffset);
    const tester = new Image();
    tester.onload = () => {
        img.src = url;
        if (timeEl) timeEl.textContent = time;
        if (rangeEl) rangeEl.textContent = mdRadarRange + ' km';
    };
    tester.onerror = () => {
        mdRadarLoadFailCount++;
        if (mdRadarLoadFailCount <= 3) {
            mdRadarCycleOffset++;
            mdLoadRadarImage();
        } else {
            console.warn('雷達圖載入失敗，已放棄');
        }
    };
    tester.src = url;
}

function mdBindRadarControls() {
    // 範圍切換
    document.querySelectorAll('.md-radar-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            const range = parseInt(btn.dataset.range, 10);
            if (range === mdRadarRange) return;
            mdRadarRange = range;
            document.querySelectorAll('.md-radar-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            mdUpdateRadar();
        });
    });

    // 收起 / 展開
    const toggleBtn = document.getElementById('md-radar-toggle');
    const radar = document.getElementById('md-radar');
    if (toggleBtn && radar) {
        toggleBtn.addEventListener('click', () => {
            radar.classList.toggle('collapsed');
            const icon = toggleBtn.querySelector('i');
            if (icon) {
                icon.className = radar.classList.contains('collapsed')
                    ? 'fas fa-chevron-up'
                    : 'fas fa-chevron-down';
            }
        });
    }
}

// ================================================================
// 監聽 config/operationalImpact（Guests online 接口）
// ================================================================
function mdListenOperationalImpact() {
    if (_mdImpactUnsub) _mdImpactUnsub();
    _mdImpactUnsub = db.collection('config').doc('operationalImpact')
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                mdGuestsOnline = data.guestsOnline ?? null;
                const el = document.getElementById('md-guests-online');
                if (el) el.textContent = mdGuestsOnline !== null ? mdGuestsOnline : '—';
            } else {
                mdGuestsOnline = null;
                const el = document.getElementById('md-guests-online');
                if (el) el.textContent = '—';
            }
        }, (err) => {
            console.warn('監聽 operationalImpact 失敗:', err);
        });
}
// ================================================================
// 全屏功能
// ================================================================
function mdToggleFullscreen() {
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (isFullscreen) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
}

function mdOnFullscreenChange() {
    const btn = document.getElementById('md-fullscreen-btn');
    const navbar = document.getElementById('navbar');
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;

    if (isFullscreen) {
        if (navbar) navbar.style.display = 'none';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-compress"></i>';
            btn.title = '退出全屏';
        }
    } else {
        if (navbar) navbar.style.display = 'flex';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-expand"></i>';
            btn.title = '全屏';
        }
    }
}

document.addEventListener('fullscreenchange', mdOnFullscreenChange);
document.addEventListener('webkitfullscreenchange', mdOnFullscreenChange);

window.mdToggleFullscreen = mdToggleFullscreen;
// ================================================================
// 全域暴露
// ================================================================
window.mdInit = mdInit;
window.mdLoadAllData = mdLoadAllData;
window.mdUpdateFromFirestore = mdUpdateFromFirestore;

console.log('✅ monitor-dashboard.js 已載入');
