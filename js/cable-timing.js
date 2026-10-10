// ================================================================
// 纜車車距計算 - 整合模組
// - 控制面板 + 結果面板
// - 視覺地圖（沿用 monitor-dashboard 樣式）
// - 從 Realtime DB 讀取車廂序號
// ================================================================

let _ctEngine = null;
let _ctInitialized = false;
let _ctMapSvg = null;
let _ctMapCabins = [];
let _ctCurrentOffset = 0;
let _ctCabinMode = 84;
let _ctRopePts = [];

// 高亮狀態
let _ctHighlightCurrent = null;
let _ctHighlightTarget = null;

// ================================================================
// HTML 模板
// ================================================================
const CT_HTML = `
<div class="ct-wrapper">
    <h2 class="ct-title"><i class="fas fa-clock"></i> 纜車車距計算</h2>

    <!-- 控制面板 -->
    <section class="ct-control-panel">
        <div class="ct-control-group">
            <label>面前車號</label>
            <input type="number" id="ct-inputCurrent" value="34" min="1" max="200" />
        </div>
        <div class="ct-control-group">
            <label>目標車號</label>
            <input type="number" id="ct-inputTarget" value="92" min="1" max="200" />
        </div>
        <div class="ct-control-group">
            <label>繩速 (m/s)</label>
            <input type="number" id="ct-inputSpeed" value="5.0" step="0.1" min="0" max="6" />
        </div>
        <div class="ct-control-group">
            <label>模式</label>
            <select id="ct-inputMode">
                <option value="109">109</option>
                <option value="84" selected>84</option>
            </select>
        </div>
        <button class="ct-btn ct-btn-primary" id="ct-btnCalculate">
            <i class="fas fa-calculator"></i> 計算行車時間
        </button>
        <button class="ct-btn ct-btn-secondary" id="ct-btnClearHighlight">
            <i class="fas fa-eraser"></i> 清除高亮
        </button>
    </section>

    <!-- 結果面板 -->
    <section class="ct-result-panel">
        <div class="ct-result-item">
            <span class="label">Gap（車距）</span>
            <span class="value" id="ct-resGap">—</span>
        </div>
        <div class="ct-result-item">
            <span class="label">秒／車廂</span>
            <span class="value" id="ct-resSecPerCar">—</span>
        </div>
        <div class="ct-result-item">
            <span class="label">總秒數</span>
            <span class="value" id="ct-resTotalSec">—</span>
        </div>
        <div class="ct-result-item">
            <span class="label">行車時間</span>
            <span class="value" id="ct-resTravelTime">—</span>
        </div>
        <div class="ct-result-item ct-highlight">
            <span class="label">預計抵達</span>
            <span class="value" id="ct-resArrival">—</span>
        </div>
        <div class="ct-result-item">
            <span class="label">面前位置</span>
            <span class="value" id="ct-resPosCurrent">—</span>
        </div>
        <div class="ct-result-item">
            <span class="label">目標位置</span>
            <span class="value" id="ct-resPosTarget">—</span>
        </div>
    </section>

    <!-- 視覺地圖 -->
    <div class="ct-map-wrapper">
        <svg id="ct-map" viewBox="0 0 2800 1000" preserveAspectRatio="xMidYMid meet">
            <defs></defs>
        </svg>
    </div>

    <!-- 圖例 -->
    <footer class="ct-legend">
        <div class="ct-legend-item"><span class="ct-swatch ct-current"></span> 面前車</div>
        <div class="ct-legend-item"><span class="ct-swatch ct-target"></span> 目標車</div>
        <div class="ct-legend-item"><span class="ct-swatch ct-default"></span> 一般車廂</div>
        <div class="ct-legend-item"><span class="ct-swatch ct-empty"></span> 未設定號碼</div>
    </footer>
</div>
`;

// ================================================================
// 初始化
// ================================================================
async function initCableTiming() {
    const section = document.getElementById('section-cable-timing');
    if (!section) {
        console.warn('找不到 #section-cable-timing');
        return;
    }

    // 若已初始化，跳過 HTML 插入但重新繪製地圖
    if (_ctInitialized) {
        console.log('車距計算已初始化，重新繪製');
        await ctReloadData();
        return;
    }

    // 插入 HTML
    section.innerHTML = CT_HTML;

    // 從 Firestore 讀取模式
    try {
        _ctCabinMode = await window.getGlobalModeFromFirestore();
    } catch (e) {
        _ctCabinMode = 84;
    }

    // 讀取偏移量
    try {
        _ctCurrentOffset = await window.getGlobalOffsetFromFirestore();
    } catch (e) {
        _ctCurrentOffset = 0;
    }

    // 設定模式下拉選單
    const modeSelect = document.getElementById('ct-inputMode');
    if (modeSelect) modeSelect.value = String(_ctCabinMode);

    // 建立地圖
    _ctMapSvg = document.getElementById('ct-map');
    ctBuildMap();

    // 讀取車廂序號
    await ctLoadCabins();

    // 綁定事件
    ctBindEvents();

    _ctInitialized = true;
    console.log('✅ 車距計算已初始化');
}

// ================================================================
// 地圖建立（沿用 monitor-dashboard 樣式）
// ================================================================
function ctBuildMap() {
    if (!_ctMapSvg) return;

    // 清空 SVG
    while (_ctMapSvg.firstChild) _ctMapSvg.removeChild(_ctMapSvg.firstChild);

    // 建立 defs（filter）
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // 高亮濾鏡（金黃色）
    const filterGlow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filterGlow.setAttribute('id', 'ctGlow');
    const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
    shadow.setAttribute('dx', '0');
    shadow.setAttribute('dy', '0');
    shadow.setAttribute('stdDeviation', '8');
    shadow.setAttribute('flood-color', 'gold');
    filterGlow.appendChild(shadow);
    defs.appendChild(filterGlow);

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

    // 地形圖片（與 monitor-dashboard 一致）
    const terrainImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    terrainImg.setAttribute('id', 'ct-terrain-img');
    terrainImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'assets/map-terrain.png');
    terrainImg.setAttribute('href', 'assets/map-terrain.png');
    terrainImg.setAttribute('preserveAspectRatio', 'none');
    terrainImg.setAttribute('x', '0');
    terrainImg.setAttribute('y', '-500');
    terrainImg.setAttribute('width', '2800');
    terrainImg.setAttribute('height', '1334.4');
    _ctMapSvg.appendChild(terrainImg);

    // 站點座標（從 window.mdStationX / mdStationY 讀取）
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const groundPts = [];

    segments.forEach((s) => {
        const gx = (window.mdStationX && window.mdStationX[s] !== undefined)
            ? window.mdStationX[s]
            : 0;
        const gy = (window.mdStationY && window.mdStationY[s] !== undefined)
            ? window.mdStationY[s]
            : 600;
        groundPts.push([gx, gy]);

        // 站點文字
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

    // 纜索（上下兩條線）
    const up = groundPts.map(p => [p[0], p[1] - 70]);
    const down = groundPts.map(p => [p[0], p[1] + 70]).reverse();
    _ctRopePts = [...up, ...down, [up[0][0], up[0][1]]];

    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('id', 'ct-rope');
    rope.setAttribute('points', _ctRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#444');
    rope.setAttribute('stroke-width', '4');
    _ctMapSvg.appendChild(rope);

    // 上下行線標示（共用函式）
    if (typeof window.addDirectionMarkers === 'function') {
        window.addDirectionMarkers(_ctMapSvg, groundPts);
    }
}

// ================================================================
// 讀取車廂序號並建立車廂
// ================================================================
async function ctLoadCabins() {
    if (!_ctMapSvg) return;

    try {
        // 從 Realtime DB 讀取車廂序號
        const snap = await realtimeDb.ref('cabins').once('value');
        const data = snap.val() || {};

        // 清空舊車廂
        _ctMapCabins.forEach(c => {
            if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
        });
        _ctMapCabins = [];

        // 建立序列（用於 CoreEngine）
        const sequence = [];

        const total = _ctCabinMode;
        const size = _ctCabinMode === 109 ? 20 : 24;
        const baseFontSize = _ctCabinMode === 109 ? 22 : 26;
        const ropeLen = ctLengthOf(_ctRopePts);

        for (let i = 0; i < total; i++) {
            const cabinId = 'cabin-' + i;
            const seq = (data[cabinId] && data[cabinId].sequence) ? data[cabinId].sequence : '';
            const seqNum = parseInt(seq, 10);

            // 建立車廂元素
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'ct-cabin');
            g.setAttribute('data-seq', seq);

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
            lbl.setAttribute('class', 'ct-seq-label');
            lbl.setAttribute('y', '5');
            lbl.setAttribute('font-size', baseFontSize);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('dominant-baseline', 'middle');
            lbl.setAttribute('fill', '#111');
            lbl.textContent = seq;
            g.appendChild(lbl);

            // ★ 防止文字溢出
            lbl.setAttribute('textLength', String(size * 1.7));
            lbl.setAttribute('lengthAdjust', 'spacingAndGlyphs');

            const cabin = { id: cabinId, seq, seqNum, el: g, shape: hex, label: lbl };
            _ctMapCabins.push(cabin);
            _ctMapSvg.appendChild(g);

            // 加入序列（若有號碼）
            if (seqNum && !isNaN(seqNum)) {
                sequence.push(seqNum);
            }
        }

        // 佈局車廂
        ctLayoutCabins();

        // 更新 CoreEngine 的序列
        if (sequence.length > 0) {
            if (!_ctEngine) {
                _ctEngine = new CableTimingEngine(sequence);
            } else {
                _ctEngine.updateSequence(sequence);
            }
            console.log('✅ 車距計算引擎已更新序列，共', sequence.length, '台車廂');
        } else {
            console.warn('⚠️ 序列為空，請先設定車廂號碼');
        }

    } catch (e) {
        console.error('讀取車廂序號失敗:', e);
    }
}

// ================================================================
// 車廂佈局
// ================================================================
function ctLayoutCabins() {
    if (!_ctRopePts || _ctRopePts.length === 0) return;
    const ropeLen = ctLengthOf(_ctRopePts);
    const total = _ctMapCabins.length;
    if (total === 0) return;

    _ctMapCabins.forEach((c, i) => {
        const d = ((i * ropeLen / total + _ctCurrentOffset) % ropeLen + ropeLen) % ropeLen;
        const pos = ctPointAt(_ctRopePts, d);
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
    if (btnCalc) {
        btnCalc.addEventListener('click', ctRunCalculation);
    }

    const btnClear = document.getElementById('ct-btnClearHighlight');
    if (btnClear) {
        btnClear.addEventListener('click', ctClearHighlight);
    }

    // 輸入框按 Enter 也能計算
    ['ct-inputCurrent', 'ct-inputTarget', 'ct-inputSpeed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') ctRunCalculation();
            });
        }
    });

    // 模式切換時重新讀取模式
    const modeSelect = document.getElementById('ct-inputMode');
    if (modeSelect) {
        modeSelect.addEventListener('change', async (e) => {
            _ctCabinMode = parseInt(e.target.value, 10);
            // 重新讀取車廂
            await ctLoadCabins();
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

    const result = _ctEngine.calculateTravelTime(currentId, targetId, speed, mode);

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

    // 高亮
    _ctHighlightCurrent = currentId;
    _ctHighlightTarget = targetId;
    ctApplyHighlight();
}

// ================================================================
// 高亮面前車 / 目標車
// ================================================================
function ctApplyHighlight() {
    // 清除所有高亮
    _ctMapCabins.forEach(c => {
        c.shape.setAttribute('stroke', '#333');
        c.shape.setAttribute('stroke-width', '2.5');
        c.shape.removeAttribute('filter');
    });

    // 高亮面前車（藍色）
    if (_ctHighlightCurrent !== null) {
        const cur = _ctMapCabins.find(c => c.seqNum === _ctHighlightCurrent);
        if (cur) {
            cur.shape.setAttribute('stroke', '#00BFFF');
            cur.shape.setAttribute('stroke-width', '5');
            cur.shape.setAttribute('filter', 'url(#ctGlowCurrent)');
        }
    }

    // 高亮目標車（紅色）
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
    _ctMapCabins.forEach(c => {
        c.shape.setAttribute('stroke', '#333');
        c.shape.setAttribute('stroke-width', '2.5');
        c.shape.removeAttribute('filter');
    });
}

// ================================================================
// 重新載入資料（切回頁面時呼叫）
// ================================================================
async function ctReloadData() {
    if (!_ctInitialized) return;

    try {
        _ctCabinMode = await window.getGlobalModeFromFirestore();
        _ctCurrentOffset = await window.getGlobalOffsetFromFirestore();

        const modeSelect = document.getElementById('ct-inputMode');
        if (modeSelect) modeSelect.value = String(_ctCabinMode);

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
