// ================================================================
// 救援地圖模組 (精簡防錯版)
// ================================================================

let mapCabins = [];
let mapRopePts = [];
let mapGlobalOffset = 0;
let mapCabinMode = 84;
let mapMoveMode = false;
let mapCurrentCabin = null;
let mapSvg = null;
let isDragging = false;
let dragStartX = 0;

// ---- 初始化鎖定 ----
let _initialized = false;
let _initializing = false;

// ---- 初始化地圖 ----
function mapInit() {
    // 如果已初始化或正在初始化，直接返回
    if (_initialized || _initializing) {
        console.log('地圖已初始化或正在初始化，跳過');
        return;
    }
    _initializing = true;

    mapSvg = document.getElementById('map');
    if (!mapSvg) {
        console.error('找不到 #map 元素');
        _initializing = false;
        return;
    }

    // 清空地圖（保留 defs）
    const defs = mapSvg.querySelector('defs');
    mapSvg.innerHTML = '';
    if (defs) mapSvg.appendChild(defs);

    // 設定 viewBox
    mapSvg.setAttribute('viewBox', '0 0 2800 700');
    mapGlobalOffset = 0;
    localStorage.removeItem('mapGlobalOffset');

    // 白色背景
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '2800');
    bgRect.setAttribute('height', '700');
    bgRect.setAttribute('fill', '#f0f4f8');
    mapSvg.appendChild(bgRect);

    // ----- 地圖元素 -----
    const segments = ['TC', 'T1', 'T2A', 'AIAS', 'T2B', 'T3', 'T4', 'T5', 'NLS', 'T6', 'T7', 'NP'];
    const slots = [2, 2, 2, 2, 10, 6, 5, 1, 2, 7, 3];
    const startX = 150,
        endX = 2650,
        unit = (endX - startX) / 42;
    const baseY = 600,
        topY = 300,
        npY = 340;
    let x = startX;
    const xCoords = [x];
    for (let i = 0; i < slots.length; i++) {
        x += slots[i] * unit;
        xCoords.push(x);
    }
    const t2bX = xCoords[4],
        t3X = xCoords[5],
        nlsX = xCoords[8],
        npX = xCoords[11];

    const addRect = (x, y, w, h, cls, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', y);
        r.setAttribute('width', w);
        r.setAttribute('height', h);
        r.setAttribute('class', cls);
        if (fillColor) r.setAttribute('fill', fillColor);
        mapSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 100, 'city', '#d4d4d4');
    addRect(t2bX, baseY, t3X - t2bX, 100, 'sea', '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill', 'url(#gradMountain)');
    mapSvg.appendChild(mountain);

    let groundPts = [];
    segments.forEach((s, i) => {
        let gx = xCoords[i],
            gy = baseY;
        if (s === 'NLS') gy = topY;
        else if (s === 'NP') gy = npY;
        else if (s === 'T3' || (i > 5 && i < segments.indexOf('NLS'))) gy = baseY - (baseY - topY) * ((gx - t3X) / (nlsX - t3X));
        else if (i > segments.indexOf('NLS')) gy = topY + (npY - topY) * ((gx - nlsX) / (npX - nlsX));
        groundPts.push([gx, gy]);
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', ['TC', 'AIAS', 'NLS', 'NP'].includes(s) ? '#stationSymbol' : '#towerSymbol');
        use.setAttribute('transform', `translate(${gx},${gy}) scale(0.6)`);
        mapSvg.appendChild(use);
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = s;
        txt.setAttribute('x', gx);
        txt.setAttribute('y', gy + 25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'label');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-weight', 'bold');
        mapSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1] - 60]);
    const down = groundPts.map(p => [p[0], p[1] + 60]).reverse();
    mapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    rope.setAttribute('points', mapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill', 'none');
    rope.setAttribute('stroke', '#444');
    rope.setAttribute('stroke-width', '4');
    mapSvg.appendChild(rope);

    const ropeHit = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    ropeHit.setAttribute('points', rope.getAttribute('points'));
    ropeHit.setAttribute('stroke', 'transparent');
    ropeHit.setAttribute('stroke-width', '30');
    ropeHit.setAttribute('fill', 'none');
    ropeHit.setAttribute('id', 'ropeHit');
    ropeHit.style.cursor = 'default';
    ropeHit.style.pointerEvents = 'all';
    mapSvg.appendChild(ropeHit);

    // ----- 圖例 -----
    const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    legend.setAttribute('id', 'legend');
    legend.setAttribute('transform', 'translate(1900, 480)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectBg.setAttribute('x', '0');
    rectBg.setAttribute('y', '0');
    rectBg.setAttribute('width', '340');
    rectBg.setAttribute('height', '250');
    rectBg.setAttribute('fill', 'white');
    rectBg.setAttribute('stroke', '#333');
    rectBg.setAttribute('rx', '8');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', '170');
    title.setAttribute('y', '35');
    title.setAttribute('font-size', '28');
    title.setAttribute('font-weight', 'bold');
    title.setAttribute('text-anchor', 'middle');
    title.textContent = '車廂狀態';
    legend.appendChild(title);

    // 狀態圖示（精簡，只列出必要狀態）
    const states = [
        { color: '#dc2626', label: '等待救援 (求助記錄)', y: 65 },
        { color: '#eab308', label: '救援中 (已有人員)', y: 105 },
        { color: '#22c55e', label: '已著陸 (所有組別)', y: 145 },
        { color: '#e2e8f0', label: '無組別記錄', y: 185 }
    ];
    states.forEach(s => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(20, ${s.y})`);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', '24');
        rect.setAttribute('height', '24');
        rect.setAttribute('fill', s.color);
        rect.setAttribute('stroke', '#333');
        g.appendChild(rect);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', '36');
        text.setAttribute('y', '18');
        text.setAttribute('font-size', '22');
        text.textContent = s.label;
        g.appendChild(text);
        legend.appendChild(g);
    });
    mapSvg.appendChild(legend);

    // ----- 摘要區域（動態建立，確保存在）-----
    createSummaryElements();

    // 構建車廂
    mapBuildCabins();
    mapLayoutCabins();

    // 移動模式設定
    setupMoveMode();

    // 事件綁定（僅綁定一次）
    bindEvents();

    // 載入車廂號碼（不觸發遞迴）
    loadCabinSequences();

    // 標記完成
    _initializing = false;
    _initialized = true;
    console.log('✅ 地圖初始化完成');
}

// ---- 建立摘要元素 ----
function createSummaryElements() {
    // 統計卡片（HTML）
    let summaryContainer = document.querySelector('.summary-enhanced');
    if (!summaryContainer) {
        const mapSection = document.getElementById('section-map');
        if (mapSection) {
            summaryContainer = document.createElement('div');
            summaryContainer.className = 'summary-enhanced';
            summaryContainer.innerHTML = `
                <div class="status-counter waiting">
                    <div class="counter-number" id="mapWaiting">0</div>
                    <div class="counter-label"><span class="status-indicator" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#dc2626;"></span>等待救援</div>
                    <div class="cabin-numbers" id="mapWaitingCabins"></div>
                </div>
                <div class="status-counter rescuing">
                    <div class="counter-number" id="mapRescuing">0</div>
                    <div class="counter-label"><span class="status-indicator" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#eab308;"></span>救援中</div>
                    <div class="cabin-numbers" id="mapRescuingCabins"></div>
                </div>
                <div class="status-counter landed">
                    <div class="counter-number" id="mapLanded">0</div>
                    <div class="counter-label"><span class="status-indicator" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22c55e;"></span>已著陸</div>
                    <div class="cabin-numbers" id="mapLandedCabins"></div>
                </div>
            `;
            const mapElement = document.getElementById('map');
            if (mapElement) {
                mapSection.insertBefore(summaryContainer, mapElement);
            } else {
                mapSection.prepend(summaryContainer);
            }
        }
    }

    // SVG 內的摘要文字
    let svgSummary = document.getElementById('svgSummary');
    if (!svgSummary) {
        svgSummary = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svgSummary.setAttribute('id', 'svgSummary');
        svgSummary.setAttribute('transform', 'translate(700,0)');
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', '0');
        rect.setAttribute('width', '600');
        rect.setAttribute('height', '90');
        rect.setAttribute('rx', '12');
        rect.setAttribute('fill', 'white');
        rect.setAttribute('stroke', '#333');
        svgSummary.appendChild(rect);
        const waitText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        waitText.setAttribute('id', 'waitingText');
        waitText.setAttribute('x', '200');
        waitText.setAttribute('y', '45');
        waitText.setAttribute('font-size', '34');
        waitText.setAttribute('font-weight', 'bold');
        waitText.setAttribute('text-anchor', 'middle');
        waitText.textContent = '等待: 0';
        svgSummary.appendChild(waitText);
        const landText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        landText.setAttribute('id', 'landedText');
        landText.setAttribute('x', '420');
        landText.setAttribute('y', '45');
        landText.setAttribute('font-size', '34');
        landText.setAttribute('font-weight', 'bold');
        landText.setAttribute('text-anchor', 'middle');
        landText.textContent = '已著陸: 0';
        svgSummary.appendChild(landText);
        mapSvg.appendChild(svgSummary);
    }
}

// ---- 綁定事件（僅一次） ----
function bindEvents() {
    // 切換車廂模式
    const toggleBtn = document.getElementById('mapToggleBtn');
    if (toggleBtn && !toggleBtn._bound) {
        toggleBtn.addEventListener('click', function() {
            mapCabinMode = mapCabinMode === 84 ? 109 : 84;
            this.textContent = '切換到 ' + (mapCabinMode === 84 ? '109' : '84') + ' 車廂';
            document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
            localStorage.setItem('mapCabinMode', mapCabinMode);
            mapBuildCabins();
            mapLayoutCabins();
            mapUpdateFromFirestore();
        });
        toggleBtn._bound = true;
    }

    // 匯出 CSV
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn && !exportBtn._bound) {
        exportBtn.addEventListener('click', mapExportCSV);
        exportBtn._bound = true;
    }

    // 套用車廂號碼
    const seqInput = document.getElementById('seqInput');
    if (seqInput && !seqInput._bound) {
        seqInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') mapApplySequences();
        });
        seqInput._bound = true;
    }

    // 搜尋車廂
    const searchBox = document.getElementById('mapSearchBox');
    if (searchBox && !searchBox._bound) {
        searchBox.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') mapSearchCabin();
        });
        searchBox._bound = true;
    }

    // 車廂表單
    const cabinForm = document.getElementById('cabinForm');
    if (cabinForm && !cabinForm._bound) {
        cabinForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (!mapCurrentCabin) return;
            const data = {
                sequence: document.getElementById('cabinSeq').value.trim(),
                timeReachedTop: document.getElementById('cabinTimeReachedTop').value,
                timeLanded: document.getElementById('cabinTimeLanded').value,
                remarks: document.getElementById('cabinRemarks').value
            };
            mapCurrentCabin.fields = data;
            mapCurrentCabin.label.textContent = data.sequence;
            realtimeDb.ref('cabins/' + mapCurrentCabin.id).set(data);
            closeCabinModal();
            mapUpdateFromFirestore();
        });
        cabinForm._bound = true;
    }

    // 組別表單
    const groupForm = document.getElementById('groupForm');
    if (groupForm && !groupForm._bound) {
        groupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveGroupRecord();
        });
        groupForm._bound = true;
    }

    // 移動按鈕
    const moveBtn = document.getElementById('moveToggleBtn');
    if (moveBtn && !moveBtn._bound) {
        moveBtn.addEventListener('click', function() {
            mapMoveMode = !mapMoveMode;
            this.textContent = mapMoveMode ? '禁用移動' : '啟用移動';
            this.style.background = mapMoveMode ? '#dc2626' : '#e2e8f0';
            this.style.color = mapMoveMode ? 'white' : '#1e293b';
            const rh = document.getElementById('ropeHit');
            if (rh) rh.style.cursor = mapMoveMode ? 'grab' : 'default';
        });
        moveBtn._bound = true;
    }
}

// ---- 載入車廂號碼（單次，不觸發遞迴） ----
function loadCabinSequences() {
    realtimeDb.ref('cabins').once('value')
        .then(snap => {
            const data = snap.val();
            if (!data) {
                // 若無數據，仍更新地圖
                mapUpdateFromFirestore();
                return;
            }
            mapCabins.forEach(c => {
                if (data[c.id]) {
                    c.fields = data[c.id];
                    c.label.textContent = c.fields.sequence || '';
                }
            });
            mapUpdateFromFirestore();
        })
        .catch(err => {
            console.warn('無法讀取車廂號碼:', err);
            mapUpdateFromFirestore();
        });
}

// ---- 構建車廂 ----
function mapBuildCabins() {
    const svg = mapSvg || document.getElementById('map');
    if (!svg) return;
    mapCabins.forEach(c => { if (c.el) svg.removeChild(c.el); });
    mapCabins = [];
    const total = mapCabinMode;
    const size = mapCabinMode === 109 ? 20 : 24;
    const fontSize = mapCabinMode === 109 ? 22 : 26;
    const ropeLen = mapLengthOf(mapRopePts);
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
        g.addEventListener('dblclick', () => mapOpenCabin(cabin));
        mapCabins.push(cabin);
        svg.appendChild(g);
        const d = (i * ropeLen / mapCabins.length + mapGlobalOffset) % ropeLen;
        const pos = mapPointAt(mapRopePts, d);
        g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    }
}

function mapLayoutCabins() {
    const ropeLen = mapLengthOf(mapRopePts);
    mapCabins.forEach((c, i) => {
        const d = (i * ropeLen / mapCabins.length + mapGlobalOffset) % ropeLen;
        const pos = mapPointAt(mapRopePts, d);
        c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
    localStorage.setItem('mapGlobalOffset', mapGlobalOffset);
}

function mapLengthOf(pts) {
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return L;
}

function mapPointAt(pts, d) {
    let sum = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i],
            [x2, y2] = pts[i + 1];
        const seg = Math.hypot(x2 - x1, y2 - y1);
        if (sum + seg >= d) {
            const t = (d - sum) / seg;
            return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
        }
        sum += seg;
    }
    return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
}

// ---- 移動模式控制 ----
function setupMoveMode() {
    const ropeHit = document.getElementById('ropeHit');
    if (!ropeHit) return;
    // 避免重複綁定
    if (ropeHit._moveBound) return;
    ropeHit._moveBound = true;

    ropeHit.addEventListener('mousedown', (e) => {
        if (!mapMoveMode) return;
        isDragging = true;
        dragStartX = e.clientX;
        ropeHit.style.cursor = 'grabbing';
    });

    // 使用命名函數以便移除
    const moveHandler = (e) => {
        if (!isDragging) return;
        const delta = e.clientX - dragStartX;
        mapGlobalOffset += delta * 2;
        dragStartX = e.clientX;
        mapLayoutCabins();
    };
    const upHandler = () => {
        if (isDragging) {
            isDragging = false;
            const rh = document.getElementById('ropeHit');
            if (rh) rh.style.cursor = mapMoveMode ? 'grab' : 'default';
            localStorage.setItem('mapGlobalOffset', mapGlobalOffset);
        }
    };
    // 先移除舊監聽（避免累積）
    window.removeEventListener('mousemove', moveHandler);
    window.removeEventListener('mouseup', upHandler);
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    // 儲存參考以便後續清理
    window._moveHandler = moveHandler;
    window._upHandler = upHandler;
}

// ---- 更新地圖 ----
async function mapUpdateFromFirestore() {
    try {
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

        const guestSnap = await db.collection('guests').get();
        const guestRecords = [];
        guestSnap.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        mapCabins.forEach(cabin => {
            const seq = cabin.fields.sequence;
            cabin.el.classList.remove("status-red", "status-yellow", "status-green");
            cabin.shape.setAttribute('fill', '#ffffff');
            cabin.shape.setAttribute('stroke', '#333');

            if (seq) {
                const hasRescue = rescueRecords.some(r => r.cabinNumber === seq && r.processed === false);
                if (hasRescue) {
                    cabin.el.classList.add("status-red");
                    cabin.shape.setAttribute('fill', '#dc2626');
                    cabin.shape.setAttribute('stroke', '#b91c1c');
                    return;
                }

                const matched = guestRecords.filter(g => g.cabinNumber === seq);
                if (matched.length > 0) {
                    let landed = 0,
                        rescuing = 0,
                        waiting = 0;
                    matched.forEach(g => {
                        const status = getGroupStatus(g);
                        if (status === 'landed') landed++;
                        else if (status === 'rescuing') rescuing++;
                        else waiting++;
                    });

                    if (landed === matched.length && matched.length > 0) {
                        cabin.el.classList.add("status-green");
                        cabin.shape.setAttribute('fill', '#22c55e');
                        cabin.shape.setAttribute('stroke', '#16a34a');
                    } else if (waiting === 0 && rescuing > 0) {
                        cabin.el.classList.add("status-yellow");
                        cabin.shape.setAttribute('fill', '#eab308');
                        cabin.shape.setAttribute('stroke', '#ca8a04');
                    } else if (waiting > 0) {
                        cabin.el.classList.add("status-red");
                        cabin.shape.setAttribute('fill', '#dc2626');
                        cabin.shape.setAttribute('stroke', '#b91c1c');
                    }
                } else {
                    cabin.shape.setAttribute('fill', '#e2e8f0');
                    cabin.shape.setAttribute('stroke', '#94a3b8');
                }
            }
        });
        mapUpdateSummary();
    } catch (e) {
        console.error('地圖更新失敗:', e);
    }
}

// ---- 更新摘要統計 ----
function mapUpdateSummary() {
    let waiting = 0,
        rescuing = 0,
        landed = 0;
    const wc = [],
        rc = [],
        lc = [];

    mapCabins.forEach(c => {
        const seq = c.fields.sequence || '';
        if (c.el.classList.contains("status-red")) {
            waiting++;
            if (seq) wc.push(seq);
        } else if (c.el.classList.contains("status-yellow")) {
            rescuing++;
            if (seq) rc.push(seq);
        } else if (c.el.classList.contains("status-green")) {
            landed++;
            if (seq) lc.push(seq);
        }
    });

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('mapWaiting', waiting);
    setText('mapRescuing', rescuing);
    setText('mapLanded', landed);
    setText('mapWaitingCabins', wc.join(', '));
    setText('mapRescuingCabins', rc.join(', '));
    setText('mapLandedCabins', lc.join(', '));

    const waitingText = document.getElementById('waitingText');
    const landedText = document.getElementById('landedText');
    if (waitingText) waitingText.textContent = '等待: ' + waiting;
    if (landedText) landedText.textContent = '已著陸: ' + landed;
}

// ---- 套用車廂號碼 ----
function mapApplySequences() {
    const seqs = document.getElementById('seqInput').value.split(/[\s,]+/).filter(s => s);
    if (!seqs.length) return;
    mapCabins.forEach((c, i) => {
        const seq = i < seqs.length ? seqs[i] : '';
        c.fields.sequence = seq;
        c.label.textContent = seq;
        realtimeDb.ref('cabins/' + c.id).set(c.fields);
    });
    mapUpdateFromFirestore();
}

// ---- 搜尋車廂 ----
function mapSearchCabin() {
    const q = document.getElementById('mapSearchBox').value.trim();
    if (!q) return alert('請輸入車廂號碼');
    const cabin = mapCabins.find(c => c.fields.sequence === q);
    if (!cabin) return alert('找不到車廂: ' + q);

    // 清除之前高亮
    if (window._highlightTimer) {
        clearInterval(window._highlightTimer);
        window._highlightTimer = null;
        mapCabins.forEach(c => {
            c.shape.style.stroke = '';
            c.shape.style.strokeWidth = '';
            c.shape.style.filter = '';
        });
    }

    let toggle = true;
    const originalStroke = cabin.shape.style.stroke || '#333';
    const originalWidth = cabin.shape.style.strokeWidth || '2';
    window._highlightTimer = setInterval(() => {
        if (toggle) {
            cabin.shape.style.stroke = '#FFD700';
            cabin.shape.style.strokeWidth = '6';
            cabin.shape.style.filter = 'drop-shadow(0 0 10px gold)';
        } else {
            cabin.shape.style.stroke = originalStroke;
            cabin.shape.style.strokeWidth = originalWidth;
            cabin.shape.style.filter = '';
        }
        toggle = !toggle;
    }, 500);

    setTimeout(() => {
        if (window._highlightTimer) {
            clearInterval(window._highlightTimer);
            window._highlightTimer = null;
            cabin.shape.style.stroke = originalStroke;
            cabin.shape.style.strokeWidth = originalWidth;
            cabin.shape.style.filter = '';
        }
    }, 5000);

    // 滾動到車廂
    const svgRect = mapSvg.getBoundingClientRect();
    const bbox = cabin.el.getBBox();
    const scaleX = svgRect.width / 2800;
    const scaleY = svgRect.height / 700;
    const centerX = svgRect.left + (bbox.x + bbox.width / 2) * scaleX;
    const centerY = svgRect.top + (bbox.y + bbox.height / 2) * scaleY;
    window.scrollTo({
        left: centerX - window.innerWidth / 2,
        top: centerY - window.innerHeight / 2,
        behavior: 'smooth'
    });

    alert('已找到車廂 ' + q + '，請查看閃爍高亮標示');
}

// ---- 清除所有 ----
function mapClearAll() {
    if (!confirm('確定清除所有車廂資料？')) return;
    mapCabins.forEach(c => {
        c.fields = {};
        c.label.textContent = '';
        realtimeDb.ref('cabins/' + c.id).remove();
        c.shape.setAttribute('fill', '#ffffff');
        c.shape.setAttribute('stroke', '#333');
        c.el.classList.remove("status-red", "status-yellow", "status-green");
    });
    document.getElementById('seqInput').value = '';
    mapUpdateSummary();
}

// ---- 匯出 CSV ----
function mapExportCSV() {
    db.collection('guests').get().then(snap => {
        const records = [];
        snap.forEach(d => records.push(d.data()));
        if (!records.length) { alert('無資料'); return; }
        const BOM = '\uFEFF';
        let csv = BOM + '車廂,組別,姓名,健康狀況,狀態\n';
        records.forEach(r => {
            const s = getGroupStatus(r);
            const status = s === 'landed' ? '已著陸' : s === 'rescuing' ? '救援中' : '等待救援';
            csv += `${r.cabinNumber||''},${r.groupNumber||''},${r.guestName||''},${r.healthStatus||''},${status}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `地圖資料_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    });
}

// ---- 開啟車廂模態框 ----
function mapOpenCabin(cabin) {
    mapCurrentCabin = cabin;
    document.getElementById('cabinSeq').value = cabin.fields.sequence || '';
    document.getElementById('cabinTimeReachedTop').value = cabin.fields.timeReachedTop || '';
    document.getElementById('cabinTimeLanded').value = cabin.fields.timeLanded || '';
    document.getElementById('cabinRemarks').value = cabin.fields.remarks || '';
    document.getElementById('cabinModal').style.display = 'flex';
    loadCabinGroupStatus(cabin);
}

function closeCabinModal() {
    document.getElementById('cabinModal').style.display = 'none';
    mapCurrentCabin = null;
}

// ---- 載入車廂組別狀態 ----
async function loadCabinGroupStatus(cabin) {
    let container = document.getElementById('cabinGroupStatus');
    if (!container) {
        const form = document.getElementById('cabinForm');
        const div = document.createElement('div');
        div.id = 'cabinGroupStatus';
        div.style.marginTop = '16px';
        div.style.borderTop = '1px solid #e2e8f0';
        div.style.paddingTop = '12px';
        div.innerHTML = `
            <h4 style="margin-bottom:8px; color:#1e3a5f;">組別狀態 (點擊可編輯)</h4>
            <div id="cabinGroupList" style="max-height:200px; overflow-y:auto;"></div>
        `;
        form.appendChild(div);
        container = div;
    }
    const statusList = document.getElementById('cabinGroupList');
    statusList.innerHTML = '<p style="color:#64748b;">載入中...</p>';

    const cabinNumber = cabin.fields.sequence;
    if (!cabinNumber) {
        statusList.innerHTML = '<p style="color:#64748b;">此車廂尚未設定號碼</p>';
        return;
    }

    try {
        const snapshot = await db.collection('guests')
            .where('cabinNumber', '==', cabinNumber)
            .get();

        if (snapshot.empty) {
            statusList.innerHTML = '<p style="color:#64748b;">此車廂暫無組別記錄</p>';
            return;
        }

        let html = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const group = data.groupNumber || '?';
            const status = getGroupStatus(data);
            let statusText = '',
                badgeClass = '';
            if (status === 'landed') {
                statusText = '已著陸';
                badgeClass = 'status-complete';
            } else if (status === 'rescuing') {
                statusText = '救援中';
                badgeClass = 'status-pending';
            } else {
                statusText = '等待救援';
                badgeClass = 'status-waiting';
            }
            html += `
                <div class="group-item-clickable" data-docid="${doc.id}" style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <span>第 ${group} 組 - ${data.guestName || '未提供姓名'}</span>
                    <span class="status-badge ${badgeClass}">${statusText}</span>
                </div>
            `;
        });
        statusList.innerHTML = html;

        statusList.querySelectorAll('.group-item-clickable').forEach(el => {
            el.addEventListener('click', function() {
                const docId = this.dataset.docid;
                if (typeof window.editGroup === 'function') {
                    window.editGroup(docId);
                } else {
                    alert('編輯功能尚未載入，請確認 js/map.js 已正確暴露 editGroup。');
                }
            });
        });

    } catch (e) {
        statusList.innerHTML = `<p style="color:red;">載入失敗: ${e.message}</p>`;
    }
}

// ---- 組別編輯函數 ----
function editGroup(docId) {
    loadGroupDetail(docId);
}

async function loadGroupDetail(docId) {
    try {
        showLoader(true);
        const doc = await db.collection('guests').doc(docId).get();
        if (doc.exists) {
            const guestData = doc.data();
            guestData.docId = docId;
            openGroupModal(guestData);
        } else {
            alert('找不到組別記錄');
            if (mapCurrentCabin) loadCabinGroupStatus(mapCurrentCabin);
        }
    } catch (e) {
        alert('載入失敗: ' + e.message);
    } finally {
        hideLoader();
    }
}

function openGroupModal(guestData) {
    const modal = document.getElementById('groupModal');
    if (!modal) { alert('groupModal 不存在'); return; }
    document.getElementById('groupDocId').value = guestData.docId || '';
    document.getElementById('groupCabinNumber').value = guestData.cabinNumber || '';
    document.getElementById('groupGroupNumber').value = guestData.groupNumber || '';
    document.getElementById('groupGuestName').value = guestData.guestName || '';
    document.getElementById('groupContactNumber').value = guestData.contactNumber || '';
    document.getElementById('groupGender').value = guestData.gender || '';
    document.getElementById('groupAgeRange').value = guestData.ageRange || '';
    document.getElementById('groupHealthStatus').value = guestData.healthStatus || '';
    document.getElementById('groupAmbulance').value = guestData.ambulance || '';
    document.getElementById('groupAmbulancePlate').value = guestData.ambulancePlate || '';
    document.getElementById('groupHospital').value = guestData.hospital || '';
    document.getElementById('groupExitMethod').value = guestData.exitMethod || '';
    document.getElementById('groupOtherExitInput').value = '';
    if (guestData.exitTime) {
        try {
            const d = guestData.exitTime.toDate ? guestData.exitTime.toDate() : new Date(guestData.exitTime);
            document.getElementById('groupExitTime').value = d.toISOString().slice(0, 16);
        } catch (e) {}
    }
    document.getElementById('groupRescuedBy').value = guestData.rescuedBy || '';
    document.getElementById('groupOtherRescuerInput').value = '';
    document.getElementById('groupTimeReachedTop').value = guestData.timeReachedTop || '';
    document.getElementById('groupTimeLanded').value = guestData.timeLanded || '';
    document.getElementById('groupRemarks').value = guestData.remarks || '';

    if (typeof toggleGroupAmbulanceFields === 'function') toggleGroupAmbulanceFields();
    if (typeof toggleGroupOtherExit === 'function') toggleGroupOtherExit();
    if (typeof toggleGroupOtherRescuer === 'function') toggleGroupOtherRescuer();

    modal.style.display = 'flex';
}

// ---- 儲存組別記錄 ----
async function saveGroupRecord() {
    const docId = document.getElementById('groupDocId').value;
    if (!docId) { alert('無效記錄'); return; }

    const updateData = {
        cabinNumber: document.getElementById('groupCabinNumber').value,
        groupNumber: document.getElementById('groupGroupNumber').value,
        guestName: document.getElementById('groupGuestName').value,
        contactNumber: document.getElementById('groupContactNumber').value,
        gender: document.getElementById('groupGender').value,
        ageRange: document.getElementById('groupAgeRange').value,
        healthStatus: document.getElementById('groupHealthStatus').value,
        ambulance: document.getElementById('groupAmbulance').value,
        exitMethod: document.getElementById('groupExitMethod').value,
        rescuedBy: document.getElementById('groupRescuedBy').value,
        timeReachedTop: document.getElementById('groupTimeReachedTop').value,
        timeLanded: document.getElementById('groupTimeLanded').value,
        remarks: document.getElementById('groupRemarks').value,
        updatedAt: new Date()
    };
    if (updateData.exitMethod === '其他') {
        const other = document.getElementById('groupOtherExitInput').value.trim();
        if (other) updateData.exitMethod = other;
    }
    if (updateData.rescuedBy === '其他') {
        const other = document.getElementById('groupOtherRescuerInput').value.trim();
        if (other) updateData.rescuedBy = other;
    }
    if (updateData.ambulance === '需要') {
        updateData.ambulancePlate = document.getElementById('groupAmbulancePlate').value;
        updateData.hospital = document.getElementById('groupHospital').value;
    } else {
        updateData.ambulancePlate = '';
        updateData.hospital = '';
    }
    const exitTime = document.getElementById('groupExitTime').value;
    if (exitTime) {
        updateData.exitTime = new Date(exitTime);
        updateData.status = 'completed';
    } else {
        updateData.exitTime = null;
        updateData.status = 'pending';
    }
    if (!updateData.groupNumber) {
        alert('請選擇組別');
        return;
    }
    try {
        showLoader(true);
        await db.collection('guests').doc(docId).update(updateData);
        alert('組別記錄已更新');
        closeGroupModal();
        mapUpdateFromFirestore();
        if (mapCurrentCabin) loadCabinGroupStatus(mapCurrentCabin);
    } catch (e) {
        alert('儲存失敗: ' + e.message);
    } finally {
        hideLoader();
    }
}

function closeGroupModal() {
    document.getElementById('groupModal').style.display = 'none';
}

async function deleteGroupRecord() {
    const docId = document.getElementById('groupDocId').value;
    if (!docId) return;
    if (!confirm('確定刪除？')) return;
    try {
        showLoader(true);
        await db.collection('guests').doc(docId).delete();
        alert('已刪除');
        closeGroupModal();
        mapUpdateFromFirestore();
        if (mapCurrentCabin) loadCabinGroupStatus(mapCurrentCabin);
    } catch (e) {
        alert('刪除失敗: ' + e.message);
    } finally {
        hideLoader();
    }
}

// ---- 初始化包裝 ----
function initMap() {
    console.log('✅ 救援地圖初始化開始');
    mapInit();
}

// ---- 暴露全域 ----
window.mapInit = initMap;
window.mapUpdateFromFirestore = mapUpdateFromFirestore;
window.mapApplySequences = mapApplySequences;
window.mapSearchCabin = mapSearchCabin;
window.mapClearAll = mapClearAll;
window.mapExportCSV = mapExportCSV;
window.closeCabinModal = closeCabinModal;
window.initMap = initMap;
window.mapOpenCabin = mapOpenCabin;
window.editGroup = editGroup;
window.loadGroupDetail = loadGroupDetail;
window.closeGroupModal = closeGroupModal;
window.deleteGroupRecord = deleteGroupRecord;
window.saveGroupRecord = saveGroupRecord;

// ---- 自動初始化 ----
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('map') && !_initialized) {
        initMap();
    }
});
