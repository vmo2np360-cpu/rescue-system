// ================================================================
// cable-timing.js - 纜車車距計算頁面邏輯
// 依賴：common.js, CableTimingEngine.js
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
let _ctCabinTypeCache = {};

// 高亮狀態
let _ctHighlightCurrent = null;
let _ctHighlightTarget = null;

// 面前車與站點（站點只用於視覺定位）
// ★ 問題 4：預設選中 TCT，與 HTML ct-inputStation 的第一個 option 一致
let _ctCurrentCabin = null;
let _ctSelectedStation = 'TCT';

// ================================================================
// 車廂種類顏色
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
    return CT_TYPE_COLORS[type] || CT_TYPE_COLORS.default;
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

    // ★ 問題 2：加入最大重試計數，避免無限重試
    if (!initCableTiming._retryCount) initCableTiming._retryCount = 0;
    const MAX_RETRY = 10;

    // ★ 修復：頁面未激活時不初始化（避免背景建立地圖）
    if (!section.classList.contains('active')) {
        console.log('📍 車距計算頁面未激活，跳過初始化');
        return;
    }

    if (_ctInitialized) {
        console.log('車距計算已初始化，重新載入資料');
        await ctReloadData();
        return;
    }

    if (!document.getElementById('ct-map')) {
        initCableTiming._retryCount++;
        if (initCableTiming._retryCount > MAX_RETRY) {
            console.error('❌ initCableTiming: 超過最大重試次數（#ct-map 不存在）');
            initCableTiming._retryCount = 0;
            return;
        }
        console.warn(`模板尚未載入，300ms 後重試 (${initCableTiming._retryCount}/${MAX_RETRY})`);
        setTimeout(initCableTiming, 300);
        return;
    }

    // 成功找到 #ct-map，重置重試計數
    initCableTiming._retryCount = 0;

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

    // ★ 問題 4：同步站點下拉選單的初始值
    const stationSelect = document.getElementById('ct-inputStation');
    if (stationSelect) stationSelect.value = _ctSelectedStation;

    _ctMapSvg = document.getElementById('ct-map');
    ctBuildMap();

    await ctLoadCabinTypes();
    await ctLoadCabins();

    ctBindEvents();

    _ctInitialized = true;
    console.log('✅ 車距計算已初始化');
}

// ================================================================
// 載入車廂種類（從 Firestore cabin_images）
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

        // 成功時移除舊的錯誤提示
        const oldNotice = document.getElementById('ct-type-notice');
        if (oldNotice) oldNotice.remove();

    } catch (e) {
        console.warn('載入車廂種類失敗:', e);

        // ★ 問題 5：顯示使用者可見的提示 + 重試按鈕
        const panel = document.querySelector('.ct-control-panel');
        if (panel) {
            let notice = document.getElementById('ct-type-notice');
            if (!notice) {
                notice = document.createElement('div');
                notice.id = 'ct-type-notice';
                notice.style.cssText = 'background:#fef3c7; color:#92400e; padding:8px 14px; border-radius:6px; font-size:0.85rem; margin-top:8px; width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;';
                panel.appendChild(notice);
            }
            notice.innerHTML = `
                <span>⚠️ 車廂種類載入失敗，所有車廂將以預設顏色顯示。</span>
                <button onclick="ctRetryLoadTypes()" style="padding:4px 14px; background:#92400e; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:500;">重試</button>
            `;
        }
    }
}

// ★ 問題 5：重試載入車廂種類（供提示按鈕呼叫）
async function ctRetryLoadTypes() {
    const notice = document.getElementById('ct-type-notice');
    if (notice) {
        notice.innerHTML = '<span>⏳ 重新載入中...</span>';
    }
    await ctLoadCabinTypes();
    await ctLoadCabins();
}

window.ctRetryLoadTypes = ctRetryLoadTypes;

// ================================================================
// 地圖建立
// ================================================================
function ctBuildMap() {
    if (!_ctMapSvg) return;

    const oldDefs = _ctMapSvg.querySelector('defs');
    while (_ctMapSvg.firstChild) _ctMapSvg.removeChild(_ctMapSvg.firstChild);

    const defs = oldDefs || document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '';

    const filterCurrent = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filterCurrent.setAttribute('id', 'ctGlowCurrent');
    const shadowCurrent = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadowCurrent.setAttribute('dx', '0');
    shadowCurrent.setAttribute('dy', '0');
    shadowCurrent.setAttribute('stdDeviation', '10');
    shadowCurrent.setAttribute('flood-color', '#00BFFF');
    filterCurrent.appendChild(shadowCurrent);
    defs.appendChild(filterCurrent);

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

    const CT_MAP_Y_OFFSET = 200;
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

    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    _ctGroundPts = [];

    segments.forEach((s) => {
        const gx = (window.mdStationX && window.mdStationX[s] !== undefined) ? window.mdStationX[s] : 0;
        const gyBase = (window.mdStationY && window.mdStationY[s] !== undefined) ? window.mdStationY[s] : 600;
        const gy = gyBase + CT_MAP_Y_OFFSET;
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

    // ★ 問題 4：同步站點下拉選單的 UI 值
    const stationSelect = document.getElementById('ct-inputStation');
    if (stationSelect && _ctSelectedStation) {
        stationSelect.value = _ctSelectedStation;
    }
}

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
}

// ================================================================
// 車廂弧長位置（視覺用，與計算無關）
// ================================================================
function ctCalcCabinArcPositions() {
    const total = _ctMapCabins.length;
    if (total === 0) return [];

    const ropeLen = ctLengthOf(_ctRopePts);
    const result = [];

    let anchorIdx = 0;
    if (_ctCurrentCabin !== null) {
        const found = _ctMapCabins.findIndex(c => String(c.seq) === String(_ctCurrentCabin));
        if (found >= 0) anchorIdx = found;
    }

    let anchorArcPos = 0;
    if (_ctSelectedStation && _ctStationArcPos[_ctSelectedStation] !== undefined) {
        anchorArcPos = _ctStationArcPos[_ctSelectedStation];
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
// 讀取車廂序列，建立引擎
// ================================================================
async function ctLoadCabins() {
    if (!_ctMapSvg) {
        console.warn('ctLoadCabins: _ctMapSvg 不存在，跳過');
        return;
    }

    try {
        const snap = await realtimeDb.ref('cabins').once('value');
        // ★ 問題：snap.val() 可能為 null，加雙重防護
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
            // ★ 問題：data[cabinId] 可能為 undefined，用 optional chaining 風格防護
            const seqRaw = (data && data[cabinId] && data[cabinId].sequence)
                ? String(data[cabinId].sequence).trim()
                : '';
            const seq = seqRaw;
            const type = seq ? (_ctCabinTypeCache[seq] || '') : '';
            const colorInfo = ctGetTypeColor(type);

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
            hex.setAttribute('fill', colorInfo.fill);
            hex.setAttribute('stroke', colorInfo.stroke);
            hex.setAttribute('stroke-width', '2.5');
            g.appendChild(hex);

            const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            lbl.setAttribute('class', 'ct-seq-label');
            lbl.setAttribute('y', '5');
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('dominant-baseline', 'middle');
            lbl.setAttribute('font-size', ctCalcFontSize(seq, baseFontSize, size));
            lbl.setAttribute('fill', colorInfo.textColor);
            lbl.textContent = seq;
            g.appendChild(lbl);

            const cabin = { id: cabinId, seq, type, el: g, shape: hex, label: lbl };
            _ctMapCabins.push(cabin);
            _ctMapSvg.appendChild(g);

            if (seq) sequence.push(seq);
        }

        ctLayoutCabins();

        // ★ 問題 3 + 13：重建引擎，並在序列為空時顯示提示
        if (sequence.length > 0) {
            try {
                _ctEngine = new CableTimingEngine(sequence, String(_ctCabinMode));
                console.log(`✅ 引擎已建立：序列 ${sequence.length} 台，模式 ${_ctCabinMode}`);
            } catch (e) {
                console.error('❌ 建立引擎失敗:', e);
                _ctEngine = null;
            }
        } else {
            console.warn('⚠️ 序列為空，無法建立引擎');
            _ctEngine = null;

            // ★ 在圖例上方顯示提示
            let emptyNotice = document.getElementById('ct-empty-notice');
            if (!emptyNotice) {
                const wrapper = document.querySelector('.ct-map-wrapper');
                if (wrapper) {
                    emptyNotice = document.createElement('div');
                    emptyNotice.id = 'ct-empty-notice';
                    emptyNotice.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(255,255,255,0.95); padding:16px 24px; border-radius:10px; box-shadow:0 4px 12px rgba(0,0,0,0.15); text-align:center; color:#64748b; font-size:0.9rem; z-index:10;';
                    emptyNotice.innerHTML = '⚠️ 尚未設定車廂號碼<br><span style="font-size:0.8rem;">請先至「車廂管理」→「車廂順序設定」套用車廂號碼</span>';
                    wrapper.style.position = 'relative';
                    wrapper.appendChild(emptyNotice);
                }
            }
        }

        // 成功載入時移除空提示
        if (sequence.length > 0) {
            const emptyNotice = document.getElementById('ct-empty-notice');
            if (emptyNotice) emptyNotice.remove();
        }

    } catch (e) {
        console.error('讀取車廂失敗:', e);
        _ctEngine = null;
    }
}

function ctCalcFontSize(text, baseFontSize, cabinSize) {
    if (!text) return baseFontSize;
    const maxWidth = cabinSize * 1.7;
    let estimatedWidth = 0;
    for (const ch of text) {
        estimatedWidth += (ch >= '0' && ch <= '9') ? baseFontSize * 0.55 : baseFontSize * 0.6;
    }
    if (estimatedWidth <= maxWidth) return baseFontSize;
    return Math.max(10, Math.floor(baseFontSize * (maxWidth / estimatedWidth)));
}

function ctLayoutCabins() {
    if (!_ctRopePts || _ctRopePts.length === 0) return;
    const total = _ctMapCabins.length;
    if (total === 0) return;

    const arcPositions = ctCalcCabinArcPositions();
    _ctMapCabins.forEach((c, i) => {
        const pos = ctPointAt(_ctRopePts, arcPositions[i]);
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

    const inputCurrent = document.getElementById('ct-inputCurrent');
    if (inputCurrent && !inputCurrent.dataset.bound) {
        inputCurrent.dataset.bound = 'true';
        inputCurrent.addEventListener('change', () => {
            const val = inputCurrent.value.trim();
            _ctCurrentCabin = val || null;
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

    // ★ 問題 3：模式切換後完整重建（引擎 + 高亮 + 弧長）
    const modeSelect = document.getElementById('ct-inputMode');
    if (modeSelect && !modeSelect.dataset.bound) {
        modeSelect.dataset.bound = 'true';
        modeSelect.addEventListener('change', async (e) => {
            const newMode = parseInt(e.target.value, 10);
            console.log(`🔄 切換模式: ${_ctCabinMode} → ${newMode}`);

            _ctCabinMode = newMode;

            // 清除舊引擎與高亮狀態
            _ctEngine = null;
            _ctHighlightCurrent = null;
            _ctHighlightTarget = null;

            // 重建車廂（內部會重建引擎）
            await ctLoadCabins();

            // 重新計算站點弧長（保險）
            ctCalcStationArcPositions();

            // 重新佈局 + 清除高亮
            ctLayoutCabins();
            ctApplyHighlight();

            // 清空結果面板（避免顯示舊模式的計算結果）
            const resultIds = [
                'ct-resGap', 'ct-resSecPerCar', 'ct-resTotalSec',
                'ct-resTravelTime', 'ct-resArrival', 'ct-resPosCurrent', 'ct-resPosTarget'
            ];
            resultIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '—';
            });
            ['TCT', 'AIAS-U', 'NLS-U', 'NPT', 'NLS-D', 'AIAS-D'].forEach(st => {
                const el = document.getElementById(`ct-res-station-${st}`);
                if (el) el.textContent = '—';
            });

            console.log(`✅ 模式切換完成：${_ctCabinMode}，車廂數 ${_ctMapCabins.length}`);
        });
    }

    const stationSelect = document.getElementById('ct-inputStation');
    if (stationSelect && !stationSelect.dataset.bound) {
        stationSelect.dataset.bound = 'true';
        stationSelect.addEventListener('change', (e) => {
            _ctSelectedStation = e.target.value || 'TCT';
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

    const currentId = document.getElementById('ct-inputCurrent').value.trim();
    const targetId = document.getElementById('ct-inputTarget').value.trim();
    const speed = parseFloat(document.getElementById('ct-inputSpeed').value);
    const stationSelect = document.getElementById('ct-inputStation');
    const currentStation = (stationSelect && stationSelect.value) ? stationSelect.value : 'TCT';

    if (!currentId || !targetId) {
        alert('請輸入車廂號碼');
        return;
    }

    // ★ speed=0 防護（繩速為 0 時無法推算）
     // ★ speed 驗證（> 0 且 <= 6）
    if (!(speed > 0)) {
        alert('繩速必須大於 0');
        return;
    }
    if (speed > 6) {
        alert('繩速不可超過 6 m/s');
        return;
    }

    // 更新面前車，重新排序視覺
    _ctCurrentCabin = currentId;
    ctLayoutCabins();

    // ★ 核心計算
    const result = _ctEngine.calculateTravelTime(currentId, targetId, speed, currentStation);

    if (result.error) {
        alert(result.error);
        return;
    }

    // 更新結果面板
    document.getElementById('ct-resGap').textContent = result.gap;
    document.getElementById('ct-resSecPerCar').textContent = result.secPerCar.toFixed(3) + ' s';
    document.getElementById('ct-resTotalSec').textContent = result.totalSeconds.toFixed(1) + ' s';
    document.getElementById('ct-resTravelTime').textContent = `${result.minutes}分 ${result.seconds}秒`;
    document.getElementById('ct-resArrival').textContent = result.arrivalTime;
    document.getElementById('ct-resPosCurrent').textContent = result.posCurrent;
    document.getElementById('ct-resPosTarget').textContent = result.posTarget;

    // 到各站時間
    const stations = ['TCT', 'AIAS-U', 'NLS-U', 'NPT', 'NLS-D', 'AIAS-D'];
    stations.forEach(st => {
        const el = document.getElementById(`ct-res-station-${st}`);
        if (!el) return;
        const eta = result.stationETAs[st];
        if (eta) {
            el.textContent = `${eta.minutes}分${eta.seconds}秒（${eta.gap}架）`;
        } else {
            el.textContent = '—';
        }
    });

    // 高亮
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
        const cur = _ctMapCabins.find(c => String(c.seq) === String(_ctHighlightCurrent));
        if (cur) {
            cur.shape.setAttribute('stroke', '#00BFFF');
            cur.shape.setAttribute('stroke-width', '5');
            cur.shape.setAttribute('filter', 'url(#ctGlowCurrent)');
        }
    }

    if (_ctHighlightTarget !== null) {
        const tgt = _ctMapCabins.find(c => String(c.seq) === String(_ctHighlightTarget));
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
// ================================================================
// 全域暴露
// ================================================================
window.initCableTiming = initCableTiming;
window.ctReloadData = ctReloadData;
window.ctRetryLoadTypes = ctRetryLoadTypes;   // ★ 問題 5 重試按鈕用

console.log('✅ cable-timing.js 已載入（含問題 1-5 修復）');
