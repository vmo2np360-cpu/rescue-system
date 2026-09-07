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
let _mapModeUnsubscribe = null;  // ★ 新增

// ★ 表格資料變數
let mapRescueRecords = [];
let mapOccRecords = [];

// ★ 自動比對變數
let lastMatchResults = [];
let matchNotifiedIds = new Set();

// ---- 初始化地圖 ----
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
                console.error('❌ 地圖初始化失敗：超過最大重試次數');
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
    mapSvg.setAttribute('viewBox', '0 200 2800 500');

    // ★ 從 Firestore 讀取偏移量
    mapGlobalOffset = await window.getGlobalOffsetFromFirestore();

    // ★ 從 Firestore 讀取模式
    mapCabinMode = await window.getGlobalModeFromFirestore();
    const modeLabel = document.getElementById('modeLabel');
    if (modeLabel) modeLabel.textContent = '模式: ' + mapCabinMode + ' 車廂';
    const mapToggleBtn = document.getElementById('mapToggleBtn');
    if (mapToggleBtn) mapToggleBtn.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
    localStorage.setItem('mapCabinMode', mapCabinMode);

    // ----- 建立白色背景 -----
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', '2800'); bgRect.setAttribute('height', '700');
    bgRect.setAttribute('fill', '#f0f4f8');
    mapSvg.appendChild(bgRect);

    // 確保 defs 中包含 highlightGlow 濾鏡
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
    legend.setAttribute('transform', 'translate(1900, 420)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rectBg.setAttribute('x', '0'); rectBg.setAttribute('y', '0');
    rectBg.setAttribute('width', '340'); rectBg.setAttribute('height', '260');
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

    // ★★★★★ 摘要區塊 (四個狀態) ★★★★★
    const summaryGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
    summaryGroup.setAttribute('id', 'svgSummary');
    summaryGroup.setAttribute('transform', 'translate(20, 200)');

    function createStatusCard(x, y, color, label, idNum, idCabins) {
        const g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('transform', `translate(${x}, ${y})`);
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
        bgRect.setAttribute('width', '320'); bgRect.setAttribute('height', '120');
        bgRect.setAttribute('fill', '#ffffff');
        bgRect.setAttribute('stroke', color);
        bgRect.setAttribute('stroke-width', '3');
        bgRect.setAttribute('rx', '10');
        g.appendChild(bgRect);
        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', '14'); rect.setAttribute('y', '14');
        rect.setAttribute('width', '28'); rect.setAttribute('height', '28');
        rect.setAttribute('fill', color); rect.setAttribute('rx', '5');
        g.appendChild(rect);
        const labelText = document.createElementNS('http://www.w3.org/2000/svg','text');
        labelText.setAttribute('x', '50'); labelText.setAttribute('y', '34');
        labelText.setAttribute('font-size', '24');
        labelText.setAttribute('fill', '#1e293b');
        labelText.setAttribute('font-weight', 'bold');
        labelText.textContent = label;
        g.appendChild(labelText);
        const numText = document.createElementNS('http://www.w3.org/2000/svg','text');
        numText.setAttribute('id', idNum);
        numText.setAttribute('x', '14'); numText.setAttribute('y', '82');
        numText.setAttribute('font-size', '48');
        numText.setAttribute('font-weight', 'bold');
        numText.setAttribute('fill', color);
        numText.textContent = '0';
        g.appendChild(numText);
        const cabinText = document.createElementNS('http://www.w3.org/2000/svg','text');
        cabinText.setAttribute('id', idCabins);
        cabinText.setAttribute('x', '110');
        cabinText.setAttribute('y', '82');
        cabinText.setAttribute('font-size', '20');
        cabinText.setAttribute('fill', '#1e293b');
        cabinText.setAttribute('font-weight', '500');
        cabinText.setAttribute('style', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;');
        cabinText.textContent = '';
        cabinText.setAttribute('title', '');
        g.appendChild(cabinText);
        return g;
    }

    summaryGroup.appendChild(createStatusCard(10, 12, '#dc2626', '等待救援', 'mapWaitingSvg', 'mapWaitingSvgCabins'));
    summaryGroup.appendChild(createStatusCard(360, 12, '#eab308', '救援中', 'mapRescuingSvg', 'mapRescuingSvgCabins'));
    summaryGroup.appendChild(createStatusCard(10, 135, '#22c55e', '已著陸', 'mapLandedSvg', 'mapLandedSvgCabins'));
    summaryGroup.appendChild(createStatusCard(360, 135, '#3b82f6', '已離開', 'mapDepartedSvg', 'mapDepartedSvgCabins'));

    mapSvg.appendChild(summaryGroup);
    
    // ★★★★★ 摘要區塊結束 ★★★★★

    // ----- 建立車廂 -----
    mapBuildCabins();
    mapLayoutCabins();

    // ----- 設定移動模式 -----
    setupMoveMode();

    // ----- 事件綁定 (使用 cloneNode 避免重複監聽) -----
    // ★ 車廂模式切換按鈕（避免變數名衝突）
    const mapToggleBtnElement = document.getElementById('mapToggleBtn');
    if (mapToggleBtnElement) {
        const newBtn = mapToggleBtnElement.cloneNode(true);
        mapToggleBtnElement.parentNode.replaceChild(newBtn, mapToggleBtnElement);
        newBtn.addEventListener('click', async function() {
            const newMode = mapCabinMode === 84 ? 109 : 84;
            await window.setGlobalModeToFirestore(newMode);
            mapCabinMode = newMode;
            this.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
            document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
            localStorage.setItem('mapCabinMode', mapCabinMode);
            mapBuildCabins();
            mapLayoutCabins();
            mapUpdateFromFirestore();
        });
    }

    // 移動按鈕
    const moveBtnElement = document.getElementById('moveToggleBtn');
    if (moveBtnElement) {
        const newMoveBtn = moveBtnElement.cloneNode(true);
        moveBtnElement.parentNode.replaceChild(newMoveBtn, moveBtnElement);
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
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true);
        exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', mapExportCSV);
    }
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

    // ★ 載入表格
    mapLoadTables();

    // ★ 定期刷新（作為監聽器的備援）
    if (window._mapRefreshTimer) clearInterval(window._mapRefreshTimer);
    window._mapRefreshTimer = setInterval(() => {
        const section = document.getElementById('section-map');
        if (section && section.classList.contains('active')) {
            console.log('🔄 定時刷新地圖 (30秒)');
            mapUpdateFromFirestore();
            mapLoadTables();
            performAutoMatch();
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

    // ★ 監聽雲端模式變化
    if (_mapModeUnsubscribe) _mapModeUnsubscribe();
    _mapModeUnsubscribe = window.listenGlobalMode((newMode) => {
        if (newMode !== mapCabinMode) {
            mapCabinMode = newMode;
            console.log('模式已同步（來自雲端）:', newMode);
            const modeLabel = document.getElementById('modeLabel');
            if (modeLabel) modeLabel.textContent = '模式: ' + mapCabinMode + ' 車廂';
            const mapToggleBtn = document.getElementById('mapToggleBtn');
            if (mapToggleBtn) mapToggleBtn.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
            localStorage.setItem('mapCabinMode', mapCabinMode);
            mapBuildCabins();
            mapLayoutCabins();
            mapUpdateFromFirestore();
        }
    });

    // ★ 監聽 guests 和 rescue_records 變更
    db.collection('guests').onSnapshot(() => {
        if (document.getElementById('section-map')?.classList.contains('active')) {
            mapLoadTables();
        }
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (document.getElementById('section-map')?.classList.contains('active')) {
            mapLoadTables();
        }
    });

    console.log('✅ 地圖初始化完成');
}

// ---- 其餘函數（保持原樣，無需修改） ----
// 由於篇幅限制，此處省略了所有其他函數（mapBuildCabins, mapLayoutCabins, ...）
// 請確認您的 map.js 中包含所有原始函數，上述修改僅替換了 mapInit 函數及變數名。

// 但為了方便，以下是完整 map.js 中應保留的其他函數（僅列出名稱）：
// mapBuildCabins, mapLayoutCabins, mapLengthOf, mapPointAt, mapRestoreState,
// mapRestoreSequences, setupMoveMode, mapUpdateFromFirestore, mapUpdateSummary,
// mapApplySequences, mapSearchCabin, mapClearAll, mapExportCSV, mapOpenCabin,
// closeCabinModal, loadCabinGroupStatus, editGroup, loadGroupDetail, openGroupModal,
// saveGroupRecord, closeGroupModal, deleteGroupRecord, mapLoadTables, mapLoadRescueTable,
// mapRenderRescueTable, mapLoadOccTable, mapRenderOccTable, mapFilterRescueTable,
// mapFilterOccTable, mapRefreshTables, calcMatchScore, performAutoMatch, showMatchAlert,
// hideMatchAlert, quickHandleMatch, dismissMatch, mapManualRefresh, initMap,
// 以及最後的 window 暴露等。

// 但由於這些函數在您的原始 map.js 中已經存在，且未修改，所以不需要重新提供。
