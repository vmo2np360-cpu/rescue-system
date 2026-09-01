// ================================================================
// 救援地圖模組 (完整版 - 放大SVG + 多狀態)
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
let mapRopeElement = null;
let _mapOffsetUnsubscribe = null;

// ---- 初始化地圖 (加入重試機制，限制次數) ----
let _mapInitRetryCount = 0;
const MAP_INIT_MAX_RETRIES = 10;

async function mapInit() {
    if (mapCabins.length > 0 && document.querySelector('#map polyline[stroke="transparent"]')) {
        console.log('地圖已初始化，跳過');
        _mapInitRetryCount = 0;
        return;
    }

    mapSvg = document.getElementById('map');
    if (!mapSvg) {
        _mapInitRetryCount++;
        const section = document.getElementById('section-map');
        const isActive = section && section.classList.contains('active');
        if (_mapInitRetryCount >= MAP_INIT_MAX_RETRIES || !isActive) {
            if (_mapInitRetryCount >= MAP_INIT_MAX_RETRIES) {
                console.error('❌ 地圖初始化失敗：超過最大重試次數，請檢查 #map 元素是否存在');
            } else {
                console.log('📍 地圖頁面未激活，停止重試');
            }
            _mapInitRetryCount = 0;
            return;
        }
        console.warn(`找不到 #map 元素，300ms 後重試 (${_mapInitRetryCount}/${MAP_INIT_MAX_RETRIES})...`);
        setTimeout(mapInit, 300);
        return;
    }

    _mapInitRetryCount = 0;

    // 清空 SVG（保留 defs）
    const defs = mapSvg.querySelector('defs');
    while (mapSvg.firstChild) {
        mapSvg.removeChild(mapSvg.firstChild);
    }
    if (defs) mapSvg.appendChild(defs);

    // 設定 viewBox（固定）
    mapSvg.setAttribute('viewBox', '0 0 2800 700');

    // ★ 從 Firestore 讀取偏移量
    mapGlobalOffset = await window.getGlobalOffsetFromFirestore();

    // ----- 建立白色背景 -----
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '2800'); bgRect.setAttribute('height', '700');
    bgRect.setAttribute('fill', '#f0f4f8');
    mapSvg.appendChild(bgRect);

    // 確保 defs 中包含 highlightGlow 濾鏡 (加強亮度)
    if (defs) {
        let glowFilter = defs.querySelector('#highlightGlow');
        if (!glowFilter) {
            glowFilter = document.createElementNS('http://www.w3.org/2000/svg','filter');
            glowFilter.setAttribute('id', 'highlightGlow');
            const shadow = document.createElementNS('http://www.w3.org/2000/svg','feDropShadow');
            shadow.setAttribute('dx', '0');
            shadow.setAttribute('dy', '0');
            shadow.setAttribute('stdDeviation', '8');
            shadow.setAttribute('flood-color', '#00BFFF');
            shadow.setAttribute('flood-opacity', '0.9');
            glowFilter.appendChild(shadow);
            const blur = document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
            blur.setAttribute('in', 'SourceGraphic');
            blur.setAttribute('stdDeviation', '4');
            const merge = document.createElementNS('http://www.w3.org/2000/svg','feMerge');
            const mergeNode1 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode');
            mergeNode1.setAttribute('in', blur);
            const mergeNode2 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode');
            mergeNode2.setAttribute('in', 'SourceGraphic');
            merge.appendChild(mergeNode1);
            merge.appendChild(mergeNode2);
            glowFilter.appendChild(blur);
            glowFilter.appendChild(merge);
            defs.appendChild(glowFilter);
        }
    }

    // ----- 建立地圖元素 (城市、海洋、山脈、纜繩等) -----
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for(let i=0;i<slots.length;i++){ x += slots[i]*unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (x, y, w, h, cls, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
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
    const mountain = document.createElementNS('http://www.w3.org/2000/svg','path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill','url(#gradMountain)');
    mapSvg.appendChild(mountain);

    let groundPts = [];
    segments.forEach((s,i) => {
        let gx = xCoords[i], gy = baseY;
        if(s==='NLS') gy = topY;
        else if(s==='NP') gy = npY;
        else if(s==='T3' || (i>5 && i<segments.indexOf('NLS'))) gy = baseY - (baseY-topY)*((gx-t3X)/(nlsX-t3X));
        else if(i>segments.indexOf('NLS')) gy = topY + (npY-topY)*((gx-nlsX)/(npX-nlsX));
        groundPts.push([gx, gy]);
        const use = document.createElementNS('http://www.w3.org/2000/svg','use');
        use.setAttribute('href', ['TC','AIAS','NLS','NP'].includes(s) ? '#stationSymbol' : '#towerSymbol');
        use.setAttribute('transform', `translate(${gx},${gy}) scale(0.6)`);
        mapSvg.appendChild(use);
        const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.textContent = s;
        txt.setAttribute('x', gx); txt.setAttribute('y', gy+25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'label');
        txt.setAttribute('fill', '#000');
        txt.setAttribute('font-weight', 'bold');
        mapSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1]-60]);
    const down = groundPts.map(p => [p[0], p[1]+60]).reverse();
    mapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    rope.setAttribute('points', mapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill','none'); rope.setAttribute('stroke','#444'); rope.setAttribute('stroke-width','4');
    mapSvg.appendChild(rope);

    // 透明纜繩 (用於拖曳)
    const ropeHit = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    ropeHit.setAttribute('points', rope.getAttribute('points'));
    ropeHit.setAttribute('stroke','transparent');
    ropeHit.setAttribute('stroke-width','30');
    ropeHit.setAttribute('fill','none');
    ropeHit.style.cursor = 'grab';
    ropeHit.style.pointerEvents = 'all';
    mapSvg.appendChild(ropeHit);
    mapRopeElement = ropeHit;

    // ----- 建立圖例 (完整狀態) -----
    const legend = document.createElementNS('http://www.w3.org/2000/svg','g');
    legend.setAttribute('id', 'legend');
    legend.setAttribute('transform', 'translate(1900, 480)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rectBg.setAttribute('x', '0'); rectBg.setAttribute('y', '0');
    rectBg.setAttribute('width', '340'); rectBg.setAttribute('height', '280');
    rectBg.setAttribute('fill', 'white'); rectBg.setAttribute('stroke', '#333'); rectBg.setAttribute('rx', '8');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg','text');
    title.setAttribute('x', '170'); title.setAttribute('y', '35');
    title.setAttribute('font-size', '28'); title.setAttribute('font-weight', 'bold');
    title.setAttribute('text-anchor', 'middle'); title.textContent = '車廂狀態';
    legend.appendChild(title);

    const statuses = [
        { color: '#22c55e', label: '已著陸 (所有組別)', y: 65 },
        { color: '#3b82f6', label: '已離開 (全部離開)', y: 105 },
        { color: '#eab308', label: '救援中 (已有人員)', y: 145 },
        { color: '#dc2626', label: '等待救援 (求助記錄)', y: 185 },
        { color: '#e2e8f0', label: '無組別記錄', y: 225 }
    ];
    statuses.forEach((s) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('transform', `translate(20, ${s.y})`);
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('width', '24'); r.setAttribute('height', '24');
        r.setAttribute('fill', s.color); r.setAttribute('stroke', '#333');
        g.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg','text');
        t.setAttribute('x', '36'); t.setAttribute('y', '18');
        t.setAttribute('font-size', '22'); t.textContent = s.label;
        g.appendChild(t);
        legend.appendChild(g);
    });
    mapSvg.appendChild(legend);

  // ----- 建立摘要區塊 (svgSummary) 供 mapUpdateSummary 使用 -----
const summaryGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
summaryGroup.setAttribute('id', 'svgSummary');
summaryGroup.setAttribute('transform', 'translate(700,0)');
const rectSum = document.createElementNS('http://www.w3.org/2000/svg','rect');
rectSum.setAttribute('x', '0'); rectSum.setAttribute('y', '0');
rectSum.setAttribute('width', '600'); rectSum.setAttribute('height', '90');
rectSum.setAttribute('rx', '12'); rectSum.setAttribute('fill', 'white');
rectSum.setAttribute('stroke', '#ccc');
summaryGroup.appendChild(rectSum);

// 等待救援
const gWait = document.createElementNS('http://www.w3.org/2000/svg','g');
gWait.setAttribute('transform', 'translate(30, 20)');
const rectWait = document.createElementNS('http://www.w3.org/2000/svg','rect');
rectWait.setAttribute('x', '0'); rectWait.setAttribute('y', '0');
rectWait.setAttribute('width', '24'); rectWait.setAttribute('height', '24');
rectWait.setAttribute('fill', '#dc2626'); rectWait.setAttribute('rx', '4');
gWait.appendChild(rectWait);
const txtWait = document.createElementNS('http://www.w3.org/2000/svg','text');
txtWait.setAttribute('x', '32'); txtWait.setAttribute('y', '18');
txtWait.setAttribute('font-size', '20'); txtWait.setAttribute('fill', '#333');
txtWait.textContent = '等待救援';
gWait.appendChild(txtWait);
const numWait = document.createElementNS('http://www.w3.org/2000/svg','text');
numWait.setAttribute('id', 'mapWaitingSvg');
numWait.setAttribute('x', '140'); numWait.setAttribute('y', '18');
numWait.setAttribute('font-size', '20'); numWait.setAttribute('font-weight', 'bold');
numWait.setAttribute('fill', '#dc2626'); numWait.textContent = '0';
gWait.appendChild(numWait);
summaryGroup.appendChild(gWait);

// 救援中
const gResc = document.createElementNS('http://www.w3.org/2000/svg','g');
gResc.setAttribute('transform', 'translate(230, 20)');
const rectResc = document.createElementNS('http://www.w3.org/2000/svg','rect');
rectResc.setAttribute('x', '0'); rectResc.setAttribute('y', '0');
rectResc.setAttribute('width', '24'); rectResc.setAttribute('height', '24');
rectResc.setAttribute('fill', '#eab308'); rectResc.setAttribute('rx', '4');
gResc.appendChild(rectResc);
const txtResc = document.createElementNS('http://www.w3.org/2000/svg','text');
txtResc.setAttribute('x', '32'); txtResc.setAttribute('y', '18');
txtResc.setAttribute('font-size', '20'); txtResc.setAttribute('fill', '#333');
txtResc.textContent = '救援中';
gResc.appendChild(txtResc);
const numResc = document.createElementNS('http://www.w3.org/2000/svg','text');
numResc.setAttribute('id', 'mapRescuingSvg');
numResc.setAttribute('x', '120'); numResc.setAttribute('y', '18');
numResc.setAttribute('font-size', '20'); numResc.setAttribute('font-weight', 'bold');
numResc.setAttribute('fill', '#eab308'); numResc.textContent = '0';
gResc.appendChild(numResc);
summaryGroup.appendChild(gResc);

// 已著陸
const gLand = document.createElementNS('http://www.w3.org/2000/svg','g');
gLand.setAttribute('transform', 'translate(430, 20)');
const rectLand = document.createElementNS('http://www.w3.org/2000/svg','rect');
rectLand.setAttribute('x', '0'); rectLand.setAttribute('y', '0');
rectLand.setAttribute('width', '24'); rectLand.setAttribute('height', '24');
rectLand.setAttribute('fill', '#22c55e'); rectLand.setAttribute('rx', '4');
gLand.appendChild(rectLand);
const txtLand = document.createElementNS('http://www.w3.org/2000/svg','text');
txtLand.setAttribute('x', '32'); txtLand.setAttribute('y', '18');
txtLand.setAttribute('font-size', '20'); txtLand.setAttribute('fill', '#333');
txtLand.textContent = '已著陸';
gLand.appendChild(txtLand);
const numLand = document.createElementNS('http://www.w3.org/2000/svg','text');
numLand.setAttribute('id', 'mapLandedSvg');
numLand.setAttribute('x', '120'); numLand.setAttribute('y', '18');
numLand.setAttribute('font-size', '20'); numLand.setAttribute('font-weight', 'bold');
numLand.setAttribute('fill', '#22c55e'); numLand.textContent = '0';
gLand.appendChild(numLand);
summaryGroup.appendChild(gLand);

mapSvg.appendChild(summaryGroup);

    // ----- 建立車廂 -----
    mapBuildCabins();
    mapLayoutCabins();

    // ----- 設定移動模式 -----
    setupMoveMode();

    // ----- 事件綁定 (使用 cloneNode 避免重複監聽) -----
    const toggleBtn = document.getElementById('mapToggleBtn');
    if (toggleBtn) {
        const newBtn = toggleBtn.cloneNode(true);
        toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);
        newBtn.addEventListener('click', function() {
            mapCabinMode = mapCabinMode === 84 ? 109 : 84;
            this.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
            document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
            localStorage.setItem('mapCabinMode', mapCabinMode);
            mapBuildCabins();
            mapLayoutCabins();
            mapUpdateFromFirestore();
        });
    }

    // 移動按鈕 (重新綁定並加入游標控制)
    const moveBtn = document.getElementById('moveToggleBtn');
    if (moveBtn) {
        const newMoveBtn = moveBtn.cloneNode(true);
        moveBtn.parentNode.replaceChild(newMoveBtn, moveBtn);
        newMoveBtn.addEventListener('click', async function() {
            mapMoveMode = !mapMoveMode;
            this.textContent = mapMoveMode ? '禁用移動' : '啟用移動';
            this.style.background = mapMoveMode ? '#dc2626' : '#e2e8f0';
            this.style.color = mapMoveMode ? 'white' : '#1e293b';
            if (mapRopeElement) {
                mapRopeElement.style.cursor = mapMoveMode ? 'grab' : 'default';
            }
            if (mapMoveMode) {
                const role = await window.getUserRole();
                if (!['admin', 'occ'].includes(role)) {
                    alert('您沒有權限移動地圖 (僅 admin/occ 可操作)');
                    mapMoveMode = false;
                    this.textContent = '啟用移動';
                    this.style.background = '#e2e8f0';
                    this.style.color = '#1e293b';
                    if (mapRopeElement) {
                        mapRopeElement.style.cursor = 'default';
                    }
                }
            }
        });
    }

    // 其他事件 (匯出、搜尋、清除等)
    document.getElementById('exportCsvBtn').addEventListener('click', mapExportCSV);
    document.getElementById('seqInput').addEventListener('keypress', e => { if(e.key==='Enter') mapApplySequences(); });
    document.getElementById('mapSearchBox').addEventListener('keypress', e => { if(e.key==='Enter') mapSearchCabin(); });

    // 車廂表單
    document.getElementById('cabinForm').addEventListener('submit', function(e) {
        e.preventDefault();
        if(!mapCurrentCabin) return;
        const data = {
            sequence: document.getElementById('cabinSeq').value.trim(),
            timeReachedTop: document.getElementById('cabinTimeReachedTop').value,
            timeLanded: document.getElementById('cabinTimeLanded').value,
            remarks: document.getElementById('cabinRemarks').value
        };
        mapCurrentCabin.fields = data;
        mapCurrentCabin.label.textContent = data.sequence;
        realtimeDb.ref('cabins/'+mapCurrentCabin.id).set(data);
        closeCabinModal();
        mapUpdateFromFirestore();
    });

    const groupForm = document.getElementById('groupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveGroupRecord();
        });
    }

    mapRestoreSequences();

    // ★ 定期刷新（作為監聽器的備援）
    if (window._mapRefreshTimer) clearInterval(window._mapRefreshTimer);
    window._mapRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-map');
        if (section && section.classList.contains('active')) {
            console.log('🔄 定時刷新地圖 (30秒)');
            mapUpdateFromFirestore();
        }
    }, 30000);

    // ★ 監聽雲端偏移量變化
    if (_mapOffsetUnsubscribe) _mapOffsetUnsubscribe();
    _mapOffsetUnsubscribe = window.listenGlobalOffset((newOffset) => {
        if (Math.abs(newOffset - mapGlobalOffset) > 0.001) {
            mapGlobalOffset = newOffset;
            mapLayoutCabins();
            console.log('偏移量已同步（來自雲端）:', newOffset);
        }
    });

    console.log('✅ 地圖初始化完成');
}

// ---- 構建車廂 (放大) ----
function mapBuildCabins() {
    const svg = mapSvg || document.getElementById('map');
    mapCabins.forEach(c => { if(c.el) svg.removeChild(c.el); });
    mapCabins = [];
    const total = mapCabinMode;
    const size = mapCabinMode === 109 ? 20 : 24;
    const fontSize = mapCabinMode === 109 ? 22 : 26;
    const ropeLen = mapLengthOf(mapRopePts);
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
        const d = ((i * ropeLen / mapCabins.length + mapGlobalOffset) % ropeLen + ropeLen) % ropeLen;
        const pos = mapPointAt(mapRopePts, d);
        c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
}

function mapLengthOf(pts) {
    let L=0;
    for(let i=0;i<pts.length-1;i++) L += Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]);
    return L;
}

function mapPointAt(pts,d) {
    let sum=0;
    for(let i=0;i<pts.length-1;i++){
        const [x1,y1]=pts[i],[x2,y2]=pts[i+1];
        const seg=Math.hypot(x2-x1, y2-y1);
        if(sum+seg >= d) {
            const t=(d-sum)/seg;
            return {x:x1+(x2-x1)*t, y:y1+(y2-y1)*t};
        }
        sum += seg;
    }
    return {x:pts[pts.length-1][0], y:pts[pts.length-1][1]};
}

function mapRestoreState() {
    const savedMode = localStorage.getItem('mapCabinMode');
    if (savedMode) {
        mapCabinMode = parseInt(savedMode);
        document.getElementById('mapToggleBtn').textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
        document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
    }
}

function mapRestoreSequences() {
    realtimeDb.ref('cabins').once('value').then(snap => {
        const data = snap.val();
        if(!data) return;
        mapCabins.forEach(c => {
            if(data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            }
        });
        mapUpdateFromFirestore();
    });
}

// ---- 移動模式設定 (修復游標與拖曳) ----
function setupMoveMode() {
    if (!mapSvg || !mapRopeElement) {
        console.error('mapSvg 或 rope 未就緒');
        return;
    }
    const ropeHit = mapRopeElement;
    ropeHit.style.pointerEvents = 'all';
    ropeHit.style.cursor = mapMoveMode ? 'grab' : 'default';

    const newRope = ropeHit.cloneNode(true);
    ropeHit.parentNode.replaceChild(newRope, ropeHit);
    mapRopeElement = newRope;

    newRope.addEventListener('mousedown', (e) => {
        if (!mapMoveMode) return;
        isDragging = true;
        dragStartX = e.clientX;
        newRope.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const delta = e.clientX - dragStartX;
        mapGlobalOffset += delta * 2;
        dragStartX = e.clientX;
        mapLayoutCabins();
    });

    window.addEventListener('mouseup', async () => {
        if (isDragging) {
            isDragging = false;
            newRope.style.cursor = mapMoveMode ? 'grab' : 'default';
            const role = await window.getUserRole();
            if (['admin', 'occ'].includes(role)) {
                await window.setGlobalOffsetToFirestore(mapGlobalOffset);
            } else {
                console.warn('無權限寫入偏移量');
            }
        }
    });
}

// ================================================================
// ★ 更新地圖 + 計算車廂綜合時間
// ================================================================
async function mapUpdateFromFirestore() {
    try {
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

        const guestSnap = await db.collection('guests').get();
        const guestRecords = [];
        guestSnap.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        const updates = {};

        mapCabins.forEach(cabin => {
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
                    cabin.shape.setAttribute('fill', '#22c55e');
                    cabin.shape.setAttribute('stroke', '#16a34a');
                    break;
                case 'departed':
                    cabin.el.classList.add("status-departed");
                    cabin.shape.setAttribute('fill', '#3b82f6');
                    cabin.shape.setAttribute('stroke', '#2563eb');
                    break;
                case 'rescuing':
                    cabin.el.classList.add("status-yellow");
                    cabin.shape.setAttribute('fill', '#eab308');
                    cabin.shape.setAttribute('stroke', '#ca8a04');
                    break;
                case 'waiting':
                    cabin.el.classList.add("status-red");
                    cabin.shape.setAttribute('fill', '#dc2626');
                    cabin.shape.setAttribute('stroke', '#b91c1c');
                    break;
                case 'empty':
                default:
                    cabin.shape.setAttribute('fill', '#e2e8f0');
                    cabin.shape.setAttribute('stroke', '#94a3b8');
                    break;
            }

            // ★ 計算車廂綜合時間
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

        mapUpdateSummary();
    } catch(e) {
        console.error('地圖更新失敗:', e);
    }
}

// ---- 更新地圖摘要 (包含已離開) ----
function mapUpdateSummary() {
    // 內部SVG元素（新）
    const waitingSvg = document.getElementById('mapWaitingSvg');
    const rescuingSvg = document.getElementById('mapRescuingSvg');
    const landedSvg = document.getElementById('mapLandedSvg');

    // 統計數據
    let waiting = 0, rescuing = 0, landed = 0, departed = 0;
    const wc = [], rc = [], lc = [], dc = [];

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
        } else if (c.el.classList.contains("status-departed")) {
            departed++;
            if (seq) dc.push(seq);
        }
    });

    // 更新外部 summary-enhanced 的數量與車廂號碼列表
    const extWaiting = document.getElementById('mapWaiting');
    const extRescuing = document.getElementById('mapRescuing');
    const extLanded = document.getElementById('mapLanded');
    if (extWaiting) extWaiting.textContent = waiting;
    if (extRescuing) extRescuing.textContent = rescuing;
    if (extLanded) extLanded.textContent = landed;

    const waitingCabins = document.getElementById('mapWaitingCabins');
    const rescuingCabins = document.getElementById('mapRescuingCabins');
    const landedCabins = document.getElementById('mapLandedCabins');
    if (waitingCabins) waitingCabins.textContent = wc.join(', ');
    if (rescuingCabins) rescuingCabins.textContent = rc.join(', ');
    if (landedCabins) landedCabins.textContent = lc.join(', ');

    // 更新內部 SVG 三個數字
    if (waitingSvg) waitingSvg.textContent = waiting;
    if (rescuingSvg) rescuingSvg.textContent = rescuing;
    if (landedSvg) landedSvg.textContent = landed;

    // 向後相容：舊版 ID 若存在仍更新（可選）
    const waitingEl = document.getElementById('waitingText');
    const landedEl = document.getElementById('landedText');
    if (waitingEl) waitingEl.textContent = '等待: ' + waiting;
    if (landedEl) landedEl.textContent = '已著陸: ' + landed;
}

// ---- 套用車廂序號 ----
function mapApplySequences() {
    const seqs = document.getElementById('seqInput').value.split(/[\s,]+/).filter(s => s);
    if(!seqs.length) return;
    mapCabins.forEach((c,i) => {
        const seq = i < seqs.length ? seqs[i] : '';
        c.fields.sequence = seq;
        c.label.textContent = seq;
        realtimeDb.ref('cabins/'+c.id).set(c.fields);
    });
    mapUpdateFromFirestore();
}

// ---- 搜尋車廂 ----
function mapSearchCabin() {
    const q = document.getElementById('mapSearchBox').value.trim();
    if (!q) return alert('請輸入車廂號碼');
    const cabin = mapCabins.find(c => c.fields.sequence === q);
    if (!cabin) return alert('找不到車廂: ' + q);

    mapCabins.forEach(c => {
        c.shape.setAttribute('stroke', '');
        c.shape.setAttribute('stroke-width', '');
        c.shape.removeAttribute('filter');
        const existingRing = c.el.querySelector('.search-ring');
        if (existingRing) c.el.removeChild(existingRing);
    });

    cabin.shape.setAttribute('stroke', '#00BFFF');
    cabin.shape.setAttribute('stroke-width', '6');
    cabin.shape.setAttribute('filter', 'url(#highlightGlow)');

    const ring = document.createElementNS('http://www.w3.org/2000/svg','circle');
    ring.setAttribute('class', 'search-ring');
    ring.setAttribute('cx', '0');
    ring.setAttribute('cy', '0');
    ring.setAttribute('r', '30');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#00BFFF');
    ring.setAttribute('stroke-width', '4');
    ring.setAttribute('stroke-dasharray', '8 8');
    ring.setAttribute('opacity', '0.8');
    const anim = document.createElementNS('http://www.w3.org/2000/svg','animate');
    anim.setAttribute('attributeName', 'r');
    anim.setAttribute('from', '28');
    anim.setAttribute('to', '40');
    anim.setAttribute('dur', '0.8s');
    anim.setAttribute('repeatCount', 'indefinite');
    anim.setAttribute('values', '28;40;28');
    ring.appendChild(anim);
    cabin.el.appendChild(ring);

    if (window._searchTimeout) clearTimeout(window._searchTimeout);
    window._searchTimeout = setTimeout(() => {
        cabin.shape.setAttribute('stroke', '');
        cabin.shape.setAttribute('stroke-width', '');
        cabin.shape.removeAttribute('filter');
        const r = cabin.el.querySelector('.search-ring');
        if (r) cabin.el.removeChild(r);
    }, 5000);
}

// ---- 清除所有資料 ----
function mapClearAll() {
    if(!confirm('確定清除所有車廂資料？')) return;
    mapCabins.forEach(c => {
        c.fields = {};
        c.label.textContent = '';
        realtimeDb.ref('cabins/'+c.id).remove();
        c.shape.setAttribute('fill', '#ffffff');
        c.shape.setAttribute('stroke', '#333');
        c.el.classList.remove("status-red", "status-yellow", "status-green", "status-departed");
    });
    document.getElementById('seqInput').value = '';
    mapUpdateSummary();
}

// ---- 匯出 CSV ----
function mapExportCSV() {
    db.collection('guests').get().then(snap => {
        const records = [];
        snap.forEach(d => records.push(d.data()));
        if(!records.length) { alert('無資料'); return; }
        const BOM = '\uFEFF';
        let csv = BOM + '車廂,組別,姓名,健康狀況,狀態\n';
        records.forEach(r => {
            const s = window.getGroupStatus ? window.getGroupStatus(r) : 'waiting';
            const statusMap = { 'departed':'已離開', 'landed':'已著陸', 'rescuing':'救援中', 'waiting':'等待救援' };
            const status = statusMap[s] || '未知';
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

// ---- 開啟車廂資訊 (顯示綜合時間，修正插入位置) ----
function mapOpenCabin(cabin) {
    mapCurrentCabin = cabin;
    document.getElementById('cabinSeq').value = cabin.fields.sequence || '';
    document.getElementById('cabinTimeReachedTop').value = window.extractDateTime ? window.extractDateTime(cabin.fields.timeReachedTop) : '';
    document.getElementById('cabinTimeLanded').value = window.extractDateTime ? window.extractDateTime(cabin.fields.timeLanded) : '';
    document.getElementById('cabinRemarks').value = cabin.fields.remarks || '';

    const overallStart = cabin.fields.overallTimeReachedTop;
    const overallEnd = cabin.fields.overallTimeLanded;
    console.log('綜合時間資料:', { overallStart, overallEnd });

    let overallContainer = document.getElementById('cabinOverallTimeContainer');
    if (!overallContainer) {
        const remarksGroup = document.getElementById('cabinRemarks')?.closest('.form-group');
        if (remarksGroup) {
            overallContainer = document.createElement('div');
            overallContainer.id = 'cabinOverallTimeContainer';
            overallContainer.className = 'form-group';
            overallContainer.style.marginBottom = '12px';
            overallContainer.style.padding = '10px 14px';
            overallContainer.style.background = '#f0f7ff';
            overallContainer.style.borderRadius = '6px';
            overallContainer.style.border = '1px solid #dbeafe';
            overallContainer.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:16px;">
                    <div><strong>📊 綜合開始救援：</strong> <span id="cabinOverallStartDisplay">—</span></div>
                    <div><strong>📊 綜合完成救援：</strong> <span id="cabinOverallEndDisplay">—</span></div>
                </div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">💡 此為車廂所有組別的自動計算時間，僅供參考</div>
            `;
            remarksGroup.parentNode.insertBefore(overallContainer, remarksGroup);
        } else {
            const form = document.getElementById('cabinForm');
            if (form) {
                overallContainer = document.createElement('div');
                overallContainer.id = 'cabinOverallTimeContainer';
                overallContainer.className = 'form-group';
                overallContainer.style.marginTop = '12px';
                overallContainer.style.padding = '10px 14px';
                overallContainer.style.background = '#f0f7ff';
                overallContainer.style.borderRadius = '6px';
                overallContainer.style.border = '1px solid #dbeafe';
                overallContainer.innerHTML = `
                    <div style="display:flex; flex-wrap:wrap; gap:16px;">
                        <div><strong>📊 綜合開始救援：</strong> <span id="cabinOverallStartDisplay">—</span></div>
                        <div><strong>📊 綜合完成救援：</strong> <span id="cabinOverallEndDisplay">—</span></div>
                    </div>
                    <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">💡 此為車廂所有組別的自動計算時間，僅供參考</div>
                `;
                form.appendChild(overallContainer);
            }
        }
    }

    if (overallContainer) {
        const startDisplay = document.getElementById('cabinOverallStartDisplay');
        const endDisplay = document.getElementById('cabinOverallEndDisplay');
        if (startDisplay) {
            startDisplay.textContent = overallStart ? (window.formatTimestamp ? window.formatTimestamp(overallStart) : overallStart) : '—';
        }
        if (endDisplay) {
            if (overallEnd) {
                endDisplay.textContent = window.formatTimestamp ? window.formatTimestamp(overallEnd) : overallEnd;
            } else if (overallStart) {
                endDisplay.textContent = '⏳ 進行中';
            } else {
                endDisplay.textContent = '—';
            }
        }
    }

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
            const status = window.getGroupStatus ? window.getGroupStatus(data) : 'waiting';
            let statusText = '', badgeClass = '';
            switch(status) {
                case 'departed': statusText = '已離開'; badgeClass = 'status-departed'; break;
                case 'landed': statusText = '已著陸'; badgeClass = 'status-complete'; break;
                case 'rescuing': statusText = '救援中'; badgeClass = 'status-pending'; break;
                default: statusText = '等待救援'; badgeClass = 'status-waiting';
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
function editGroup(docId) { loadGroupDetail(docId); }

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
        } catch(e) {}
    }
    document.getElementById('groupRescuedBy').value = guestData.rescuedBy || '';
    document.getElementById('groupOtherRescuerInput').value = '';
    document.getElementById('groupTimeReachedTop').value = window.extractDateTime ? window.extractDateTime(guestData.timeReachedTop) : '';
    document.getElementById('groupTimeLanded').value = window.extractDateTime ? window.extractDateTime(guestData.timeLanded) : '';
    document.getElementById('groupRemarks').value = guestData.remarks || '';

    const ambulanceVal = document.getElementById('groupAmbulance').value;
    document.getElementById('groupAmbulanceFields').style.display = (ambulanceVal === '需要') ? 'block' : 'none';

    const exitMethodVal = document.getElementById('groupExitMethod').value;
    document.getElementById('groupOtherExitContainer').style.display = (exitMethodVal === '其他') ? 'block' : 'none';

    const rescuedByVal = document.getElementById('groupRescuedBy').value;
    document.getElementById('groupOtherRescuerContainer').style.display = (rescuedByVal === '其他') ? 'block' : 'none';

    modal.style.display = 'flex';
}

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
        const existingDoc = await db.collection('guests').doc(docId).get();
        const previousData = existingDoc.exists ? existingDoc.data() : null;
        await db.collection('guests').doc(docId).update(updateData);
        await logAction('guests', docId, 'update', updateData, previousData);
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
    if (!confirm('確定刪除此組別記錄？')) return;
    try {
        showLoader(true);
        await db.collection('guests').doc(docId).delete();
        closeGroupModal();

        // ★ 立即從 Dashboard 表格中移除該行（如果 Dashboard 正在顯示）
        const dashSection = document.getElementById('section-dashboard');
        if (dashSection && dashSection.classList.contains('active')) {
            // 查找包含該 docId 的表格行
            const rows = document.querySelectorAll('#dbTableBody tr');
            rows.forEach(row => {
                // 判斷按鈕的 onclick 是否包含該 docId
                const btn = row.querySelector('button[onclick*="dbDeleteRecord(\'' + docId + '\')"]');
                if (btn) {
                    row.remove();
                    // 更新總記錄數（先減 1）
                    const totalEl = document.getElementById('dbTotal');
                    if (totalEl) {
                        let total = parseInt(totalEl.textContent) || 0;
                        totalEl.textContent = Math.max(0, total - 1);
                    }
                    // 已完成/處理中統計無法準確更新，後台刷新會修正
                }
            });
        }

        // 背景更新地圖與監控（確保顏色、綜合時間同步）
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
        // 後台刷新 Dashboard 表格（確保統計數字與 Firestore 完全一致）
        if (typeof dbLoadRecords === 'function') dbLoadRecords();

        showMessage('dbMessage', '組別已刪除', 'success');
    } catch (e) {
        alert('刪除失敗: ' + e.message);
    } finally {
        hideLoader();
    }
}
// ---- 初始化入口 (含重試) ----
function initMap() {
    console.log('🚀 初始化救援地圖');
    const mapEl = document.getElementById('map');
    if (!mapEl) {
        console.warn('等待 #map 元素...');
        setTimeout(initMap, 300);
        return;
    }
    mapInit();
}

// ---- 手動刷新地圖（僅限地圖頁面） ----
function mapManualRefresh() {
    console.log('🔄 手動刷新地圖');
    const section = document.getElementById('section-map');
    if (section && section.classList.contains('active')) {
        mapUpdateFromFirestore();
        const btn = document.querySelector('#section-map .map-toolbar button[onclick="mapManualRefresh()"]');
        if (btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 更新中';
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }, 1500);
        }
    } else {
        console.warn('地圖頁面未啟用，跳過刷新');
    }
}

// ---- 暴露全域 ----
window.mapInit = mapInit;
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
window.mapManualRefresh = mapManualRefresh;

console.log('✅ map.js 已載入');
