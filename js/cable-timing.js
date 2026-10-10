// ================================================================
// 纜車車距計算 - 整合模組
// - 車廂種類從 Firestore cabin_images 讀取
// - 面前車號 + 站點選擇 → 重新排序索道
// - 動態字體大小，避免文字變形
// ================================================================

let _ctEngine = null;
let _ctInitialized = false;
let _ctMapSvg = null;
let _ctMapCabins = [];
let _ctCurrentOffset = 0;
let _ctCabinMode = 84;
let _ctRopePts = [];
let _ctGroundPts = [];
let _ctStationArcPos = {};
let _ctCabinTypeCache = {};   // ★ 車廂種類快取 { cabinSeq: cabinType }

// 高亮狀態
let _ctHighlightCurrent = null;
let _ctHighlightTarget = null;

// 面前車號與站點
let _ctCurrentCabin = null;
let _ctSelectedStation = null;

// ================================================================
// 車廂種類顏色對照（只影響此頁面）
// ================================================================
const CT_TYPE_COLORS = {
    '標準車廂': { fill: '#22c55e', stroke: '#16a34a', textColor: '#ffffff' },
    '水晶車廂': { fill: '#3b82f6', stroke: '#2563eb', textColor: '#ffffff' },
    '全景車廂': { fill: '#eab308', stroke: '#ca8a04', textColor: '#ffffff' },
    '工程車':   { fill: '#94a3b8', stroke: '#64748b', textColor: '#ffffff' },
    'default':  { fill: '#ffffff', stroke: '#333333', textColor: '#111111' }
};

function ctGetTypeColor(type) {
    if (!type) return CT_TYPE_COLORS.default;
    if (CT_TYPE_COLORS[type]) return CT_TYPE_COLORS[type];
    return CT_TYPE_COLORS.default;
}

// ================================================================
// 初始化
// ================================================================
async function initCableTiming() {
    const section = document.getElementById('section-cable-timing');
    if (!section) {
        console.warn('找不到 #section-cable-timing');
        return;
    }

    if (_ctInitialized) {
        console.log('車距計算已初始化，重新載入資料');
        await ctReloadData();
        return;
    }

    if (!document.getElementById('ct-map')) {
        console.warn('模板尚未載入，300ms 後重試');
        setTimeout(initCableTiming, 300);
        return;
    }

    try {
        _ctCabinMode = await window.getGlobalModeFromFirestore();
    } catch (e) {
        _ctCabinMode = 84;
    }

    try {
        _ctCurrentOffset = await window.getGlobalOffsetFromFirestore();
    } catch (e) {
        _ctCurrentOffset = 0;
    }

    const modeSelect = document.getElementById('ct-inputMode');
    if (modeSelect) modeSelect.value = String(_ctCabinMode);

    _ctMapSvg = document.getElementById('ct-map');
    ctBuildMap();

    // ★ 先載入車廂種類，再載入車廂
    await ctLoadCabinTypes();
    await ctLoadCabins();

    ctBindEvents();

    _ctInitialized = true;
    console.log('✅ 車距計算已初始化');
}

// ================================================================
// ★ 載入車廂種類（從 Firestore cabin_images）
// ================================================================
async function ctLoadCabinTypes() {
    _ctCabinTypeCache = {};
    try {
        const snap = await db.collection('cabin_images').get();
        snap.forEach(doc => {
            const data = doc.data();
            const seq = String(data.cabinSeq || doc.id || '').trim();
            const type = data.cabinType || '';
            if (seq && type) {
                _ctCabinTypeCache[seq] = type;
            }
        });
        console.log('✅ 已載入', Object.keys(_ctCabinTypeCache).length, '筆車廂種類');
    } catch (e) {
        console.warn('載入車廂種類失敗:', e);
    }
}

// ================================================================
// 地圖建立
// ================================================================
function ctBuildMap() {
    if (!_ctMapSvg) return;

    const oldDefs = _ctMapSvg.querySelector('defs');
    while (_ctMapSvg.firstChild) _ctMapSvg.removeChild(_ctMapSvg.firstChild);

    const defs = oldDefs || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '';

    // 面前車濾鏡（藍色）
    const filterCurrent = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filterCurrent.setAttribute('id', 'ctGlowCurrent');
    const shadowCurrent = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadowCurrent.setAttribute('dx', '0');
    shadowCurrent.setAttribute('dy', '0');
    shadowCurrent.setAttribute('stdDeviation', '10');
    shadowCurrent.setAttribute('flood-color', '#00BFFF');
    filterCurrent.appendChild(shadowCurrent);
    defs.appendChild(filterCurrent);

    // 目標車濾鏡（紅色）
    const filterTarget = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filterTarget.setAttribute('id', 'ctGlowTarget');
    const shadowTarget = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadowTarget.setAttribute('dx', '0');
    shadowTarget.setAttribute('dy', '0');
    shadowTarget.setAttribute('stdDeviation', '10');
    shadowTarget.setAttribute('flood-color', '#FF4500');
    filterTarget.appendChild(shadowTarget);
    defs.appendChild(filterTarget);

    _ctMapSvg.appendChild(defs);

    // 地形圖片
      // 地形圖片（向下移動）
    const CT_MAP_Y_OFFSET = 200;   // ★ 向下移動 200（可調整）
    const terrainImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    terrainImg.setAttribute('id', 'ct-terrain-img');
    terrainImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'assets/map-terrain.png');
    terrainImg.setAttribute('href', 'assets/map-terrain.png');
    terrainImg.setAttribute('preserveAspectRatio', 'none');
    terrainImg.setAttribute('x', '0');
    terrainImg.setAttribute('y', String(-500 + CT_MAP_Y_OFFSET));
    terrainImg.setAttribute('width', '2800');
    terrainImg.setAttribute('height', '1334.4');
    _ctMapSvg.appendChild(terrainImg);

    // 站點座標
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    _ctGroundPts = [];

    segments.forEach((s) => {
        const gx = (window.mdStationX && window.mdStationX[s] !== undefined)
            ? window.mdStationX[s] : 0;
        const gy = (window.mdStationY && window.mdStationY[s] !== undefined)
            ? window.mdStationY[s] : 600;
        _ctGroundPts.push([gx, gy]);

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
        _ctMapSvg.appendChild(txt);
    });

    // 纜索
    const up = _ctGroundPts.map(p => [p[0], p[1] - 70]);
    const down = _ctGroundPts.map(p => [p[0], p[1] + 70]).reverse();
    _ctRopePts = [...up, ...down, [up[0][0], up[0][1]]];

    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('id', 'ct-rope');
    rope.setAttribute('points', _ctRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#444');
    rope.setAttribute('stroke-width', '4');
    _ctMapSvg.appendChild(rope);

    ctCalcStationArcPositions();

    if (typeof window.addDirectionMarkers === 'function') {
        window.addDirectionMarkers(_ctMapSvg, _ctGroundPts);
    }
}

// ================================================================
// 計算各站點的弧長位置
// ================================================================
function ctCalcStationArcPositions() {
    _ctStationArcPos = {};
    if (_ctGroundPts.length < 2) return;

    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const upPts = _ctGroundPts.map(p => [p[0], p[1] - 70]);

    let acc = 0;
    for (let i = 0; i < upPts.length; i++) {
        if (i > 0) {
            acc += Math.hypot(upPts[i][0] - upPts[i-1][0], upPts[i][1] - upPts[i-1][1]);
        }
        _ctStationArcPos[segments[i]] = acc;
    }

    console.log('📍 站點弧長位置:', _ctStationArcPos);
}

// ================================================================
// 計算車廂在索道上的弧長位置
// ================================================================
function ctCalcCabinArcPositions() {
    const total = _ctMapCabins.length;
    if (total === 0) return [];

    const ropeLen = ctLengthOf(_ctRopePts);
    const result = [];

    // 找出「面前車」的索引
    let anchorIdx = 0;
    if (_ctCurrentCabin !== null) {
        const found = _ctMapCabins.findIndex(c => c.seqNum === _ctCurrentCabin);
        if (found >= 0) anchorIdx = found;
    }

    // 計算「面前車」應該在索道上的位置
    let anchorArcPos = 0;
    if (_ctSelectedStation && _ctStationArcPos[_ctSelectedStation] !== undefined) {
        anchorArcPos = _ctStationArcPos[_ctSelectedStation];
    } else {
        anchorArcPos = 0;
    }

    const spacing = ropeLen / total;

    for (let i = 0; i < total; i++) {
        const relativeIdx = (i - anchorIdx + total) % total;
        let arcPos = (anchorArcPos + relativeIdx * spacing) % ropeLen;
        if (arcPos < 0) arcPos += ropeLen;
        result.push(arcPos);
    }

    return result;
}

// ================================================================
// 讀取車廂序號，建立車廂
// ================================================================
async function ctLoadCabins() {
    if (!_ctMapSvg) return;

    try {
        const snap = await realtimeDb.ref('cabins').once('value');
        const data = snap.val() || {};

        _ctMapCabins.forEach(c => {
            if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
        });
        _ctMapCabins = [];

        const sequence = [];
        const total = _ctCabinMode;
        const size = _ctCabinMode === 109 ? 20 : 24;
        const baseFontSize = _ctCabinMode === 109 ? 22 : 26;

        for (let i = 0; i < total; i++) {
            const cabinId = 'cabin-' + i;
            const seq = (data[cabinId] && data[cabinId].sequence) ? data[cabinId].sequence : '';
            const seqNum = parseInt(seq, 10);

            // ★ 從快取讀取車廂種類
            const type = _ctCabinTypeCache[seq] || '';

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'ct-cabin');
            g.setAttribute('data-seq', seq);
            g.setAttribute('data-type', type);

            const pts = [];
            for (let j = 0; j < 6; j++) {
                const a = Math.PI / 3 * j;
                pts.push((size * Math.cos(a)) + ',' + (size * Math.sin(a)));
            }
            const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hex.setAttribute('points', pts.join(' '));

            // ★ 依車廂種類上色
            const colorInfo = ctGetTypeColor(type);
            hex.setAttribute('fill', colorInfo.fill);
            hex.setAttribute('stroke', colorInfo.stroke);
            hex.setAttribute('stroke-width', '2.5');
            g.appendChild(hex);

            const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            lbl.setAttribute('class', 'ct-seq-label');
            lbl.setAttribute('y', '5');
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('dominant-baseline', 'middle');

            // ★ 動態字體大小，避免文字變形
            const fontSize = ctCalcFontSize(seq, baseFontSize, size);
            lbl.setAttribute('font-size', fontSize);
            lbl.setAttribute('fill', colorInfo.textColor);
            lbl.textContent = seq;
            g.appendChild(lbl);

            const cabin = { id: cabinId, seq, seqNum, type, el: g, shape: hex, label: lbl };
            _ctMapCabins.push(cabin);
            _ctMapSvg.appendChild(g);

            if (seqNum && !isNaN(seqNum)) {
                sequence.push(seqNum);
            }
        }

        ctLayoutCabins();

        if (sequence.length > 0) {
            if (!_ctEngine) {
                _ctEngine = new CableTimingEngine(sequence);
            } else {
                _ctEngine.updateSequence(sequence);
            }
            console.log('✅ 車距計算引擎已更新，共', sequence.length, '台車廂');
        } else {
            console.warn('⚠️ 序列為空');
        }

    } catch (e) {
        console.error('讀取車廂失敗:', e);
    }
}

// ================================================================
// 依文字長度動態計算字體大小
// ================================================================
function ctCalcFontSize(text, baseFontSize, cabinSize) {
    if (!text) return baseFontSize;

    const maxWidth = cabinSize * 1.7;

    let estimatedWidth = 0;
    for (const ch of text) {
        if (ch >= '0' && ch <= '9') {
            estimatedWidth += baseFontSize * 0.55;
        } else {
            estimatedWidth += baseFontSize * 0.6;
        }
    }

    if (estimatedWidth <= maxWidth) {
        return baseFontSize;
    }

    const scale = maxWidth / estimatedWidth;
    return Math.max(10, Math.floor(baseFontSize * scale));
}

// ================================================================
// 車廂佈局
// ================================================================
function ctLayoutCabins() {
    if (!_ctRopePts || _ctRopePts.length === 0) return;
    const total = _ctMapCabins.length;
    if (total === 0) return;

    const arcPositions = ctCalcCabinArcPositions();

    _ctMapCabins.forEach((c, i) => {
        const arcPos = arcPositions[i];
        const pos = ctPointAt(_ctRopePts, arcPos);
        if (pos) c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
}

function ctLengthOf(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return L;
}

function ctPointAt(pts, d) {
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
// 事件綁定
// ================================================================
function ctBindEvents() {
    const btnCalc = document.getElementById('ct-btnCalculate');
    if (btnCalc && !btnCalc.dataset.bound) {
        btnCalc.dataset.bound = 'true';
        btnCalc.addEventListener('click', ctRunCalculation);
    }

    const btnClear = document.getElementById('ct-btnClearHighlight');
    if (btnClear && !btnClear.dataset.bound) {
        btnClear.dataset.bound = 'true';
        btnClear.addEventListener('click', ctClearHighlight);
    }

    // ★ 面前車號變更 → 重新排序
    const inputCurrent = document.getElementById('ct-inputCurrent');
    if (inputCurrent && !inputCurrent.dataset.bound) {
        inputCurrent.dataset.bound = 'true';
        inputCurrent.addEventListener('change', () => {
            const val = parseInt(inputCurrent.value, 10);
            _ctCurrentCabin = isNaN(val) ? null : val;
            ctLayoutCabins();
            ctApplyHighlight();
        });
        inputCurrent.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') ctRunCalculation();
        });
    }

    const inputTarget = document.getElementById('ct-inputTarget');
    if (inputTarget && !inputTarget.dataset.bound) {
        inputTarget.dataset.bound = 'true';
        inputTarget.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') ctRunCalculation();
        });
    }

    const inputSpeed = document.getElementById('ct-inputSpeed');
    if (inputSpeed && !inputSpeed.dataset.bound) {
        inputSpeed.dataset.bound = 'true';
        inputSpeed.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') ctRunCalculation();
        });
    }

    const modeSelect = document.getElementById('ct-inputMode');
    if (modeSelect && !modeSelect.dataset.bound) {
        modeSelect.dataset.bound = 'true';
        modeSelect.addEventListener('change', async (e) => {
            _ctCabinMode = parseInt(e.target.value, 10);
            await ctLoadCabins();
        });
    }

    // ★ 站點選擇變更 → 重新排序
    const stationSelect = document.getElementById('ct-inputStation');
    if (stationSelect && !stationSelect.dataset.bound) {
        stationSelect.dataset.bound = 'true';
        stationSelect.addEventListener('change', (e) => {
            _ctSelectedStation = e.target.value || null;
            ctLayoutCabins();
            ctApplyHighlight();
        });
    }
}

// ================================================================
// 執行計算
// ================================================================
function ctRunCalculation() {
    if (!_ctEngine) {
        alert('尚未載入車廂序列，請先至「車廂管理」設定車廂號碼');
        return;
    }

    const currentId = parseInt(document.getElementById('ct-inputCurrent').value, 10);
    const targetId = parseInt(document.getElementById('ct-inputTarget').value, 10);
    const speed = parseFloat(document.getElementById('ct-inputSpeed').value);
    const mode = document.getElementById('ct-inputMode').value;

    if (isNaN(currentId) || isNaN(targetId)) {
        alert('請輸入有效的車廂號碼');
        return;
    }

    // ★ 更新面前車號，重新排序
    _ctCurrentCabin = currentId;
    ctLayoutCabins();

    const result = _ctEngine.calculateTravelTime(currentId, targetId, speed, mode);

    if (result.error) {
        alert(result.error);
        return;
    }

    document.getElementById('ct-resGap').textContent = result.gap;
    document.getElementById('ct-resSecPerCar').textContent = result.secPerCar.toFixed(3) + ' s';
    document.getElementById('ct-resTotalSec').textContent = result.totalSeconds.toFixed(1) + ' s';
    document.getElementById('ct-resTravelTime').textContent = `${result.minutes}分 ${result.seconds}秒`;
    document.getElementById('ct-resArrival').textContent = result.arrivalTime;
    document.getElementById('ct-resPosCurrent').textContent = result.posCurrent;
    document.getElementById('ct-resPosTarget').textContent = result.posTarget;

    _ctHighlightCurrent = currentId;
    _ctHighlightTarget = targetId;
    ctApplyHighlight();
}

// ================================================================
// 高亮
// ================================================================
function ctApplyHighlight() {
    _ctMapCabins.forEach(c => {
        const colorInfo = ctGetTypeColor(c.type);
        c.shape.setAttribute('stroke', colorInfo.stroke);
        c.shape.setAttribute('stroke-width', '2.5');
        c.shape.removeAttribute('filter');
    });

    if (_ctHighlightCurrent !== null) {
        const cur = _ctMapCabins.find(c => c.seqNum === _ctHighlightCurrent);
        if (cur) {
            cur.shape.setAttribute('stroke', '#00BFFF');
            cur.shape.setAttribute('stroke-width', '5');
            cur.shape.setAttribute('filter', 'url(#ctGlowCurrent)');
        }
    }

    if (_ctHighlightTarget !== null) {
        const tgt = _ctMapCabins.find(c => c.seqNum === _ctHighlightTarget);
        if (tgt) {
            tgt.shape.setAttribute('stroke', '#FF4500');
            tgt.shape.setAttribute('stroke-width', '5');
            tgt.shape.setAttribute('filter', 'url(#ctGlowTarget)');
        }
    }
}

function ctClearHighlight() {
    _ctHighlightCurrent = null;
    _ctHighlightTarget = null;
    ctApplyHighlight();
}

// ================================================================
// 重新載入資料
// ================================================================
async function ctReloadData() {
    if (!_ctInitialized) return;

    try {
        _ctCabinMode = await window.getGlobalModeFromFirestore();
        _ctCurrentOffset = await window.getGlobalOffsetFromFirestore();

        const modeSelect = document.getElementById('ct-inputMode');
        if (modeSelect) modeSelect.value = String(_ctCabinMode);

        await ctLoadCabinTypes();
        await ctLoadCabins();
    } catch (e) {
        console.warn('重新載入資料失敗:', e);
    }
}

// ================================================================
// 全域暴露
// ================================================================
window.initCableTiming = initCableTiming;
window.ctReloadData = ctReloadData;

console.log('✅ cable-timing.js 已載入');
