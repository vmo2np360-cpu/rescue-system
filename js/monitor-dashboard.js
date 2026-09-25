// ================================================================
// Monitor Dashboard V2 - 唯讀大屏監控
// ================================================================

let mdMapCabins = [];
// ================================================================
// 站點 Y 座標（可透過 Console 即時調整）
// ================================================================
window.mdStationY = {
    'TC':   650,
    'T1':   650,
    'T2A':  650,
    'AIAS': 650,
    'T2B':  650,
    'T3':   380,
    'T4':   180,
    'T5':   20,
    'NLS':  10,
    'T6':   20,
    'T7':   220,
    'NP':   200
};

// ================================================================
// 站點 X 座標（可透過 Console 即時調整）
// ================================================================
window.mdStationX = {
    'TC':   50,
    'T1':   178.57,
    'T2A':  307.14,
    'AIAS': 435.71,
    'T2B':  564.29,
    'T3':   1207.14,
    'T4':   1592.86,
    'T5':   1914.29,
    'NLS':  1978.57,
    'T6':   2107.14,
    'T7':   2557.14,
    'NP':   2750
};

// ================================================================
// 站點文字標籤偏移量（僅影響文字，不影響索道 / 車廂）
// ================================================================
// ================================================================
// 站點文字標籤偏移量（僅影響文字，不影響索道 / 車廂）
// ================================================================
window.mdLabelOffset = {
    'TC':   { dx: 40,   dy: -20 },
    'T1':   { dx: 35,   dy: -20 },
    'T2A':  { dx: 80,   dy: 45  },
    'AIAS': { dx: 45,   dy: 45  },
    'T2B':  { dx: -5,   dy: 45  },
    'T3':   { dx: 50,   dy: -10 },
    'T4':   { dx: 50,   dy: -10 },
    'T5':   { dx: -50,  dy: 5   },
    'NLS':  { dx: 20,   dy: 30  },
    'T6':   { dx: 20,   dy: -15 },
    'T7':   { dx: -10,  dy: -15 },
    'NP':   { dx: -120, dy: -5  }
};
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
let _mdCabinsUnsub = null;
let _mdGuestsUnsub = null;
let _mdRescueUnsub = null;
let _mdTimeTimer = null;
let _mdAutoRefreshTimer = null;
let _mdRadarTimer = null;
let _mdWeatherTimer = null;

let _mdInitRetryCount = 0;
const MD_INIT_MAX_RETRIES = 20;   // 20 × 300ms = 6 秒

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

        case 'WTS':     return '12.png';
        case 'WFNTR':   return '13.png';
        case 'WL':      return '14.png';
        case 'WMSGNL':  return '15.png';
        case 'WFROST':  return '16.png';

        case 'WFIRE':
        case 'WFIREY':
        case 'WFIRER':
            if (type.includes('黃') || type.includes('黄') || code === 'WFIREY') return '17.png';
            if (type.includes('紅') || type.includes('红') || code === 'WFIRER') return '18.png';
            return null;

        case 'WCOLD':   return '19.png';
        case 'WHOY':    return '20.png';
        case 'WTMW':    return '21.png';
        default:        return null;
    }
}

function mdWeatherIconUrl(code) {
    const c = String(code).padStart(2, '0');
    return `assets/weather-icons/pic${c}.png`;
}

// ================================================================
// 初始化入口
// ================================================================
async function mdInit() {
    const mapEl = document.getElementById('md-map');

    if (!mapEl) {
        _mdInitRetryCount++;
        if (_mdInitRetryCount > MD_INIT_MAX_RETRIES) {
            console.error('❌ mdInit: 超過最大重試次數，放棄');
            _mdInitRetryCount = 0;
            return;
        }
        console.warn(`mdInit: 尚未載入 #md-map，300ms 後重試 (${_mdInitRetryCount}/${MD_INIT_MAX_RETRIES})`);
        setTimeout(mdInit, 300);
        return;
    }

    _mdInitRetryCount = 0;

    // 若已初始化且 SVG 有內容 → 真正跳過
    if (window._mdInitialized && mapEl.childElementCount > 0) {
        console.log('Monitor Dashboard 已初始化，跳過');
        return;
    }

    // 若標記為已初始化，但 SVG 是空的 → 視為需要重新初始化
    if (window._mdInitialized && mapEl.childElementCount === 0) {
        console.log('⚠️ 偵測到空白地圖，強制重新初始化');
        window._mdInitialized = false;
    }

    window._mdInitialized = true;
    console.log('🚀 Monitor Dashboard 初始化中...');

    try {
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
    } catch (e) {
        console.error('❌ Monitor Dashboard 初始化失敗:', e);
        // 失敗時允許下次重試
        window._mdInitialized = false;
    }
}

// ★ 強制重新初始化（可從 Console 呼叫）
window.mdForceReinit = function () {
    console.log('🔄 強制重新初始化 Monitor Dashboard');
    window._mdInitialized = false;
    _mdInitRetryCount = 0;
    if (typeof mdInit === 'function') mdInit();
};

// ================================================================
// 地圖初始化
// ================================================================
async function mdInitMap() {
    mdMapSvg = document.getElementById('md-map');
    if (!mdMapSvg) return;

    while (mdMapSvg.firstChild) mdMapSvg.removeChild(mdMapSvg.firstChild);

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
    mdMapSvg.appendChild(defs);

       // ★ 舊背景 rect（保留備份，暫不啟用）
    /*
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', '2800'); bg.setAttribute('height', '1000');
    bg.setAttribute('fill', '#f0f4f8');
    mdMapSvg.appendChild(bg);
    */

        // ★ 地形圖片（方案 C：寬度鋪滿 2800，高度 1334.4，Y 偏移 -167）
    const terrainImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    terrainImg.setAttribute('id', 'md-terrain-img');
    // ★ 同時設定 href 與 xlink:href，確保所有瀏覽器都能載入
    terrainImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'assets/map-terrain.png');
    terrainImg.setAttribute('href', 'assets/map-terrain.png');
    terrainImg.setAttribute('preserveAspectRatio', 'none');
    terrainImg.setAttribute('x', '0');
    terrainImg.setAttribute('y', '-500');
    terrainImg.setAttribute('width', '2800');
    terrainImg.setAttribute('height', '1334.4');
    mdMapSvg.appendChild(terrainImg);

    // ★ 監聽圖片載入狀態（診斷用）
    terrainImg.addEventListener('load', () => {
        console.log('✅ 地形圖片載入成功');
    });
    terrainImg.addEventListener('error', () => {
        console.error('❌ 地形圖片載入失敗，請檢查路徑：assets/map-terrain.png');
    });

    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 50, endX = 2750, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for (let i = 0; i < slots.length; i++) { x += slots[i] * unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (rx, ry, rw, rh, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', rx); r.setAttribute('y', ry);
        r.setAttribute('width', rw); r.setAttribute('height', rh);
        r.setAttribute('fill', fillColor);
        mdMapSvg.appendChild(r);
    };
    // ★ 舊城市 / 海灣矩形（保留備份，暫不啟用）
    /*
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 180, '#d4d4d4');
    addRect(t2bX, baseY, t3X - t2bX, 180, '#81D4FA');
    */

     // ★ 舊山體 path（保留備份，暫不啟用）
    /*
    const mountain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},1000 L${t3X},1000 Z`);
    mountain.setAttribute('fill', 'url(#mdGradMountain)');
    mdMapSvg.appendChild(mountain);
    */

     // ★ 站點 X / Y 從 window.mdStationX / mdStationY 讀取（可即時調整）
    const groundPts = [];
    segments.forEach((s, i) => {
        const gx = (window.mdStationX && window.mdStationX[s] !== undefined)
            ? window.mdStationX[s]
            : xCoords[i];
        const gy = (window.mdStationY && window.mdStationY[s] !== undefined)
            ? window.mdStationY[s]
            : baseY;
        groundPts.push([gx, gy]);

             const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = s;
        const offset = (window.mdLabelOffset && window.mdLabelOffset[s]) || { dx: 0, dy: 25 };
        txt.setAttribute('x', gx + (offset.dx || 0));
        txt.setAttribute('y', gy + (offset.dy !== undefined ? offset.dy : 25));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#000');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '22');
         txt.setAttribute('data-station', s);
        mdMapSvg.appendChild(txt);
    });                                              // ★ 補回這一行


    const up = groundPts.map(p => [p[0], p[1] - 70]);
    const down = groundPts.map(p => [p[0], p[1] + 70]).reverse();
    mdMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];

    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('id', 'md-rope');            // ★ 加 id
    rope.setAttribute('points', mdMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#444');
    rope.setAttribute('stroke-width', '4');
    mdMapSvg.appendChild(rope);

    // 圖例
const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('id', 'md-legend');
    legend.setAttribute('transform', 'translate(1800, 350)');
    legend.innerHTML = `
        <rect x="0" y="0" width="400" height="280" fill="white" stroke="#333" rx="8"/>
        <text x="200" y="44" font-size="34" font-weight="bold" text-anchor="middle">車廂狀態</text>
        <g transform="translate(32,84)">
            <rect width="32" height="32" fill="#22c55e" stroke="#333" rx="4"/>
            <text x="48" y="24" font-size="30">已著陸</text>
        </g>
        <g transform="translate(32,136)">
            <rect width="32" height="32" fill="#3b82f6" stroke="#333" rx="4"/>
            <text x="48" y="24" font-size="30">已離開</text>
        </g>
        <g transform="translate(32,188)">
            <rect width="32" height="32" fill="#eab308" stroke="#333" rx="4"/>
            <text x="48" y="24" font-size="30">救援中</text>
        </g>
        <g transform="translate(32,240)">
            <rect width="32" height="32" fill="#dc2626" stroke="#333" rx="4"/>
            <text x="48" y="24" font-size="30">等待救援</text>
        </g>
    `;
    mdMapSvg.appendChild(legend);

    mdCurrentOffset = await window.getGlobalOffsetFromFirestore();
    mdCabinMode = await window.getGlobalModeFromFirestore();
    localStorage.setItem('mapCabinMode', mdCabinMode);

    mdBuildCabins();

    // ★ 防重複註冊偏移量監聽（Firestore onSnapshot 回傳 unsubscribe，可直接呼叫）
    if (_mdOffsetUnsub) _mdOffsetUnsub();
    _mdOffsetUnsub = window.listenGlobalOffset((newOffset) => {
        if (Math.abs(newOffset - mdCurrentOffset) > 0.001) {
            mdCurrentOffset = newOffset;
            mdLayoutCabins();
        }
    });

    // ★ 防重複註冊模式監聽
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

    // ★ 防重複註冊 Realtime DB 車廂監聽
    // 注意：Realtime DB 的 .on() 回傳的是 callback 本身，不是 unsubscribe 函數
    if (_mdCabinsUnsub) {
        try {
            realtimeDb.ref('cabins').off('value', _mdCabinsUnsub);
        } catch (e) {
            console.warn('移除舊 cabins 監聽失敗:', e);
        }
        _mdCabinsUnsub = null;
    }
    _mdCabinsUnsub = realtimeDb.ref('cabins').on('value', (snap) => {
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

    // ★ 防重複註冊 Firestore guests 監聽（onSnapshot 回傳 unsubscribe，可直接呼叫）
    if (_mdGuestsUnsub) _mdGuestsUnsub();
    _mdGuestsUnsub = db.collection('guests').onSnapshot(() => {
        if (mdMapCabins.length > 0) mdUpdateFromFirestore();
    });

    // ★ 防重複註冊 Firestore rescue_records 監聽
    if (_mdRescueUnsub) _mdRescueUnsub();
    _mdRescueUnsub = db.collection('rescue_records').onSnapshot(() => {
        if (mdMapCabins.length > 0) mdUpdateFromFirestore();
    });
}

// ================================================================
// 車廂
// ================================================================
function mdBuildCabins() {
    if (!mdMapSvg) return;
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

        // ★ 雙擊開啟唯讀詳情
        g.style.cursor = 'pointer';
        g.addEventListener('dblclick', () => mdOpenCabinReadonly(cabin));

        mdMapCabins.push(cabin);
        mdMapSvg.appendChild(g);
    }

    mdLayoutCabins();
}
// ================================================================
// ---- 車廂抽屜（唯讀） ----
let _mdDrawerUnsub = null;

function mdOpenCabinReadonly(cabin) {
    const seq = cabin.fields.sequence || '';
    if (!seq) {
        mdShowToast('此車廂尚未設定號碼');
        return;
    }

    mdEnsureDrawer();
    document.getElementById('mdCabinDrawerSeq').textContent = seq;

    // 取消舊監聽
    if (_mdDrawerUnsub) { _mdDrawerUnsub(); _mdDrawerUnsub = null; }

    const img = document.getElementById('mdCabinDrawerImg');
    const placeholder = document.getElementById('mdCabinDrawerPlaceholder');
    const meta = document.getElementById('mdCabinImageMeta');
    const thumbsBox = document.getElementById('mdCabinDrawerThumbs');

    // 監聽圖片（其他裝置上傳時自動更新）
    _mdDrawerUnsub = window.listenCabinImages(seq, (data) => {
        const photos = (data && data.photos) || [];

        if (photos.length === 0) {
            img.style.display = 'none';
            placeholder.style.display = 'block';
            placeholder.textContent = '尚無現場照片';
            meta.style.display = 'none';
            thumbsBox.style.display = 'none';
            return;
        }

        const main = photos[0];
        img.src = main.url;
        img.style.display = 'block';
        placeholder.style.display = 'none';

        const t = main.uploadedAt
            ? new Date(main.uploadedAt).toLocaleString('zh-TW', { hour12: false })
            : '-';
        meta.style.display = 'flex';
        meta.innerHTML = `
            <span>🚠 ${data.cabinType || ''}</span>
            <span>📷 ${photos.length} 張</span>
            <span>🕒 ${t}</span>
        `;

        if (photos.length > 1) {
            thumbsBox.style.display = 'flex';
            thumbsBox.innerHTML = photos.map((p, i) => `
                <img src="${p.url}" data-idx="${i}" class="${i === 0 ? 'active' : ''}"
                     onclick="mdSelectCabinPhoto('${mdEscJs(seq)}', ${i})"
                     title="${p.note ? mdEsc(p.note) : ''}">
            `).join('');
        } else {
            thumbsBox.style.display = 'none';
        }
    });

    // 載入組別狀態
    mdLoadCabinGroupsIntoDrawer(seq);

    // 顯示抽屜
    document.getElementById('mdCabinDrawer').classList.add('open');
    document.getElementById('mdCabinDrawerOverlay').classList.add('open');

    // 30 秒後自動關閉（避免大屏卡住）
    clearTimeout(window._mdDrawerAutoClose);
    window._mdDrawerAutoClose = setTimeout(mdCloseDrawer, 30000);
}

// ---- 動態建立抽屜 DOM（只建一次） ----
function mdEnsureDrawer() {
    if (document.getElementById('mdCabinDrawer')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mdCabinDrawerOverlay';
    overlay.className = 'cabin-drawer-overlay';
    overlay.onclick = mdCloseDrawer;
    document.body.appendChild(overlay);

    const drawer = document.createElement('div');
    drawer.id = 'mdCabinDrawer';
    drawer.className = 'cabin-drawer md-theme';
    drawer.innerHTML = `
        <div class="cabin-drawer-header">
            <h3>🚠 車廂 <span id="mdCabinDrawerSeq">—</span></h3>
            <button onclick="mdCloseDrawer()" title="關閉">✕</button>
        </div>
        <div class="cabin-drawer-body">
            <div class="cabin-drawer-image">
                <div class="placeholder" id="mdCabinDrawerPlaceholder">尚無現場照片</div>
                <img id="mdCabinDrawerImg" style="display:none;" alt="車廂照片"
                     onclick="mdOpenLightbox(this.src)">
            </div>
            <div class="cabin-drawer-thumbs" id="mdCabinDrawerThumbs" style="display:none;"></div>
            <div class="cabin-image-meta" id="mdCabinImageMeta" style="display:none;"></div>

            <h4 style="margin: 14px 0 8px; color: #00d4ff;">📋 組別記錄</h4>
            <div id="mdCabinGroupsList" style="font-size: 0.85rem; color: #c0c0c0;">
                <p style="color:#888;">載入中...</p>
            </div>
        </div>
    `;
    document.body.appendChild(drawer);
}

function mdCloseDrawer() {
    const d = document.getElementById('mdCabinDrawer');
    const o = document.getElementById('mdCabinDrawerOverlay');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
    if (_mdDrawerUnsub) { _mdDrawerUnsub(); _mdDrawerUnsub = null; }
    clearTimeout(window._mdDrawerAutoClose);
}

// ---- 載入組別（唯讀） ----
async function mdLoadCabinGroupsIntoDrawer(seq) {
    const container = document.getElementById('mdCabinGroupsList');
    if (!container) return;

    try {
        const snap = await window.db.collection('guests')
            .where('cabinNumber', '==', seq)
            .get();

        if (snap.empty) {
            container.innerHTML = '<p style="color:#888;">此車廂暫無組別記錄</p>';
            return;
        }

        let html = `
            <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                <tr style="border-bottom:1px solid #444;">
                    <th style="text-align:left; padding:4px; color:#aaa;">組別</th>
                    <th style="text-align:left; padding:4px; color:#aaa;">姓名</th>
                    <th style="text-align:left; padding:4px; color:#aaa;">狀態</th>
                </tr>
        `;
        snap.forEach(doc => {
            const d = doc.data();
            const s = window.getGroupStatus ? window.getGroupStatus(d) : 'waiting';
            const map = {
                departed: '🔵 已離開',
                landed: '✅ 已著陸',
                rescuing: '🔄 救援中',
                waiting: '⏳ 等待'
            };
            html += `
                <tr style="border-bottom:1px solid #3d3d3d;">
                    <td style="padding:4px;">第${d.groupNumber || '?'}組</td>
                    <td style="padding:4px;">${mdEsc(d.guestName || '-')}</td>
                    <td style="padding:4px;">${map[s] || s}</td>
                </tr>
            `;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p style="color:#f88;">載入失敗: ${mdEsc(e.message)}</p>`;
    }
}

// ---- 切換主圖（多張時） ----
function mdSelectCabinPhoto(seq, idx) {
    window.getCabinImages(seq).then(data => {
        if (!data || !data.photos || !data.photos[idx]) return;
        document.getElementById('mdCabinDrawerImg').src = data.photos[idx].url;
        document.querySelectorAll('#mdCabinDrawerThumbs img').forEach((el, i) => {
            el.classList.toggle('active', i === idx);
        });
    });
}

// ---- Lightbox ----
function mdOpenLightbox(src) {
    let lb = document.getElementById('mdCabinLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'mdCabinLightbox';
        lb.className = 'cabin-lightbox';
        lb.onclick = () => lb.style.display = 'none';
        lb.innerHTML = '<img id="mdCabinLightboxImg">';
        document.body.appendChild(lb);
    }
    document.getElementById('mdCabinLightboxImg').src = src;
    lb.style.display = 'flex';
}

// ---- XSS 保護 ----
function mdEsc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}
function mdEscJs(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---- 簡易 toast ----
function mdShowToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed; bottom:40px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:10px 20px; border-radius:6px; z-index:10000; font-size:0.9rem; pointer-events:none;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
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
    const a = document.getElementById('md-awaiting');
    const b = document.getElementById('md-in-progress');
    const c = document.getElementById('md-rescued');
    const d = document.getElementById('md-closed');

    // 元素還沒就緒時不拋錯
    if (!a || !b || !c || !d) return;

    let waiting = 0, rescuing = 0, landed = 0, departed = 0;
    mdMapCabins.forEach(cab => {
        if (cab.el.classList.contains('status-red')) waiting++;
        else if (cab.el.classList.contains('status-yellow')) rescuing++;
        else if (cab.el.classList.contains('status-green')) landed++;
        else if (cab.el.classList.contains('status-departed')) departed++;
    });

    a.textContent = waiting;
    b.textContent = rescuing;
    c.textContent = landed;
    d.textContent = departed;

    // ★ 方案 A：Rescue Progress
    //   分子 = Case Closed (departed)
    //   分母 = Rescue in Progress (rescuing) + Rescued (landed) + Case Closed (departed)
    //   Awaiting (waiting) 為排隊中的個案，不計入分母
    const progressDenominator = rescuing + landed + departed;
    const pct = progressDenominator > 0
        ? Math.round((departed / progressDenominator) * 100)
        : 0;

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
    // ★ Guests Affected = 所有車廂組別數（guests collection 總數）
    if (affectedEl) affectedEl.textContent = mdGuestRecords.length;

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

    if (dateEl) dateEl.textContent = mdFormatIncidentDate(incident.date);
    if (typeEl) typeEl.textContent = incident.type || '—';

    const status = (incident.status || '').toUpperCase();
    if (statusTextEl) statusTextEl.textContent = status || '—';
    if (statusEl) {
        statusEl.classList.remove('md-status-alert', 'md-status-closed');
        if (status === 'ACTIVE') statusEl.classList.add('md-status-alert');
        else statusEl.classList.add('md-status-closed');
    }

    if (incTimeEl) {
        if (incident.incidentTime) {
            incTimeEl.textContent = mdFormatIncidentTime(incident.incidentTime);
        } else {
            incTimeEl.textContent = '—';
        }
    }

    mdUpdateCurrentTime();
}
function mdFormatIncidentTime(input) {
    if (!input) return '—';
    let d;
    if (input.toDate) d = input.toDate();
    else if (input.seconds) d = new Date(input.seconds * 1000);
    else if (typeof input === 'string') d = new Date(input);
    else d = new Date(input);
    if (isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

    // 判斷結束時間
    let endTime = now;
    const status = (mdCurrentIncident.status || '').toUpperCase();
    if (status === 'CLOSED' && mdCurrentIncident.closedTime) {
        const ct = mdCurrentIncident.closedTime;
        let closedDate;
        if (ct.toDate) closedDate = ct.toDate();
        else if (ct.seconds) closedDate = new Date(ct.seconds * 1000);
        else closedDate = new Date(ct);
        if (!isNaN(closedDate.getTime())) endTime = closedDate;
    }

    const diffMs = endTime - incTime;
    if (diffMs < 0) { durEl.textContent = '—'; return; }

    const totalMin = Math.floor(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;

    if (h >= 24) {
        const days = Math.floor(h / 24);
        const remainingH = h % 24;
        durEl.textContent = `${days}d ${remainingH}h ${m}m`;
    } else if (h > 0) {
        durEl.textContent = `${h}h ${m}m`;
    } else {
        durEl.textContent = `${m}m`;
    }
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
    document.querySelectorAll('.md-radar-tabs button').forEach(btn => {
        if (btn.dataset.mdBound === 'true') return;
        btn.dataset.mdBound = 'true';

        btn.addEventListener('click', () => {
            const range = parseInt(btn.dataset.range, 10);
            if (range === mdRadarRange) return;
            mdRadarRange = range;
            document.querySelectorAll('.md-radar-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            mdUpdateRadar();
        });
    });
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
// ★ 診斷函數（可在 Console 呼叫）
window.mdDiagnoseIncident = async function () {
    console.log('=== Monitor Dashboard Incident 診斷 ===');
    try {
        const snap = await db.collection('incidents')
            .orderBy('incidentTime', 'desc')
            .limit(3)
            .get();

        if (snap.empty) {
            console.log('❌ incidents 是空的');
            return;
        }

        snap.forEach(doc => {
            const d = doc.data();
            console.log({
                id: doc.id,
                status: d.status,
                incidentTime: d.incidentTime,
                hasToDate: d.incidentTime && typeof d.incidentTime.toDate === 'function',
                display: d.incidentTime ? mdFormatIncidentTime(d.incidentTime) : '(空)'
            });
        });

        console.log('mdCurrentIncident:', mdCurrentIncident);
        console.log('mdFormatIncidentTime 存在:', typeof mdFormatIncidentTime);
    } catch (e) {
        console.error('診斷失敗:', e);
    }
};
// ================================================================
// 地形圖片即時調整工具
// 用法：
//   mdSetTerrain({ y: -250 })          // 只調 Y
//   mdSetTerrain({ x: 50, width: 2700, height: 1286.7 })  // 縮小
//   mdSetTerrain({ x: -50, width: 2900, height: 1382 })   // 放大
// ================================================================
window.mdSetTerrain = function (opts) {
    const img = document.getElementById('md-terrain-img');
    if (!img) {
        console.warn('找不到地形圖片（#md-terrain-img），請先確認 mdInitMap 已執行');
        return;
    }
    if (opts.x !== undefined) img.setAttribute('x', opts.x);
    if (opts.y !== undefined) img.setAttribute('y', opts.y);
    if (opts.width !== undefined) img.setAttribute('width', opts.width);
    if (opts.height !== undefined) img.setAttribute('height', opts.height);
    console.log('✅ 地形圖片參數已更新:', {
        x: img.getAttribute('x'),
        y: img.getAttribute('y'),
        width: img.getAttribute('width'),
        height: img.getAttribute('height')
    });
};
// ================================================================
// 站點 Y 座標即時調整工具
// ================================================================
window.mdSetStationY = function (station, y) {
    if (!window.mdStationY) window.mdStationY = {};
    window.mdStationY[station] = y;
    mdRebuildRopeAndLayout();
    console.log(`✅ ${station} Y = ${y}`);
};

window.mdSetStationYMultiple = function (obj) {
    if (!window.mdStationY) window.mdStationY = {};
    Object.assign(window.mdStationY, obj);
    mdRebuildRopeAndLayout();
    console.log('✅ 已更新:', obj);
};

window.mdResetStationY = function () {
  window.mdStationY = {
    'TC':   650,
    'T1':   650,
    'T2A':  650,
    'AIAS': 650,
    'T2B':  650,
    'T3':   380,
    'T4':   180,
    'T5':   20,
    'NLS':  10,
    'T6':   20,
    'T7':   220,
    'NP':   200
};
    mdRebuildRopeAndLayout();
    console.log('✅ 已重置為預設值');
};

function mdRebuildRopeAndLayout() {
    if (!mdMapSvg) return;

    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 50, endX = 2750, unit = (endX - startX) / 42;
    let x = startX;
    const xCoords = [x];
    for (let i = 0; i < slots.length; i++) { x += slots[i] * unit; xCoords.push(x); }

    // 重建 groundPts
    const groundPts = segments.map((s, i) => {
        const gx = (window.mdStationX && window.mdStationX[s] !== undefined)
            ? window.mdStationX[s]
            : xCoords[i];
        const gy = (window.mdStationY && window.mdStationY[s] !== undefined)
            ? window.mdStationY[s]
            : 600;
        return [gx, gy];
    });

    // 更新文字標籤
      // 更新文字標籤（含偏移）
    mdMapSvg.querySelectorAll('text[data-station]').forEach(txt => {
        const station = txt.getAttribute('data-station');
        const idx = segments.indexOf(station);
        if (idx >= 0) {
            const pt = groundPts[idx];
            const offset = (window.mdLabelOffset && window.mdLabelOffset[station]) || { dx: 0, dy: 25 };
            txt.setAttribute('x', pt[0] + (offset.dx || 0));
            txt.setAttribute('y', pt[1] + (offset.dy !== undefined ? offset.dy : 25));
        }
    });

    // 更新索道
    const up = groundPts.map(p => [p[0], p[1] - 70]);
    const down = groundPts.map(p => [p[0], p[1] + 70]).reverse();
    mdMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];

    const rope = document.getElementById('md-rope');
    if (rope) {
        rope.setAttribute('points', mdMapRopePts.map(p => p.join(',')).join(' '));
    }

    // 車廂重新佈局
    mdLayoutCabins();

    console.log('✅ 站點、索道、車廂已更新');
}
// ================================================================
// 圖例位置即時調整工具
// ================================================================
window.mdSetLegend = function (x, y) {
    const legend = mdMapSvg ? mdMapSvg.querySelector('g[transform^="translate"]') : null;
    // 更精準：用 id 抓
    const target = document.getElementById('md-legend');
    const el = target || legend;
    if (!el) {
        console.warn('找不到圖例，請確認已呼叫 mdInitMap()');
        return;
    }
    el.setAttribute('transform', `translate(${x}, ${y})`);
    console.log(`✅ 圖例位置: x=${x}, y=${y}`);
};

window.mdSetStationX = function (station, x) {
    if (!window.mdStationX) window.mdStationX = {};
    window.mdStationX[station] = x;
    mdRebuildRopeAndLayout();
    console.log(`✅ ${station} X = ${x}`);
};

window.mdSetStationXMultiple = function (obj) {
    if (!window.mdStationX) window.mdStationX = {};
    Object.assign(window.mdStationX, obj);
    mdRebuildRopeAndLayout();
    console.log('✅ 已更新 X:', obj);
};

window.mdResetStationX = function () {
    window.mdStationX = {
        'TC':   50,
        'T1':   178.57,
        'T2A':  307.14,
        'AIAS': 435.71,
        'T2B':  564.29,
        'T3':   1207.14,
        'T4':   1592.86,
        'T5':   1914.29,
        'NLS':  1978.57,
        'T6':   2107.14,
        'T7':   2557.14,
        'NP':   2750
    };
    mdRebuildRopeAndLayout();
    console.log('✅ 已重置 X 為預設值');
};
    // ================================================================
// 文字標籤偏移調整工具（不影響索道 / 車廂）
// ================================================================
window.mdSetLabelOffset = function (station, dx, dy) {
    if (!window.mdLabelOffset) window.mdLabelOffset = {};
    window.mdLabelOffset[station] = { dx: dx, dy: dy };
    mdRebuildRopeAndLayout();
    console.log(`✅ ${station} 文字偏移: dx=${dx}, dy=${dy}`);
};

window.mdSetLabelOffsetMultiple = function (obj) {
    if (!window.mdLabelOffset) window.mdLabelOffset = {};
    Object.keys(obj).forEach(station => {
        window.mdLabelOffset[station] = obj[station];
    });
    mdRebuildRopeAndLayout();
    console.log('✅ 已更新文字偏移:', obj);
};

window.mdResetLabelOffset = function () {
    window.mdLabelOffset = {
        'TC':   { dx: 40,   dy: -20 },
        'T1':   { dx: 35,   dy: -20 },
        'T2A':  { dx: 80,   dy: 45  },
        'AIAS': { dx: 45,   dy: 45  },
        'T2B':  { dx: -5,   dy: 45  },
        'T3':   { dx: 50,   dy: -10 },
        'T4':   { dx: 50,   dy: -10 },
        'T5':   { dx: -50,  dy: 5   },
        'NLS':  { dx: 20,   dy: 30  },
        'T6':   { dx: 20,   dy: -15 },
        'T7':   { dx: -10,  dy: -15 },
        'NP':   { dx: -120, dy: -5  }
    };
    mdRebuildRopeAndLayout();
    console.log('✅ 已重置文字偏移為預設值');
};
// ================================================================
// 全域暴露
// ================================================================
window.mdInit = mdInit;
window.mdOpenCabinReadonly = mdOpenCabinReadonly;
window.mdLoadAllData = mdLoadAllData;
window.mdUpdateFromFirestore = mdUpdateFromFirestore;
window.mdToggleFullscreen = mdToggleFullscreen;
// ---- 全域暴露 ----
window.mdOpenCabinReadonly = mdOpenCabinReadonly;
window.mdCloseDrawer = mdCloseDrawer;
window.mdSelectCabinPhoto = mdSelectCabinPhoto;
window.mdOpenLightbox = mdOpenLightbox;

console.log('✅ monitor-dashboard.js 已載入');
