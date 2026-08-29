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

    // ★ 找到元素，重置計數
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
        txt.setAttribute('fill', '#fff');
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
    summaryGroup.setAttribute('transform', 'translate(700,0)');
    const rectSum = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rectSum.setAttribute('x', '0'); rectSum.setAttribute('y', '0');
    rectSum.setAttribute('width', '600'); rectSum.setAttribute('height', '90');
    rectSum.setAttribute('rx', '12'); rectSum.setAttribute('fill', 'white');
    rectSum.setAttribute('stroke', '#ccc');
    summaryGroup.appendChild(rectSum);
    const waitingText = document.createElementNS('http://www.w3.org/2000/svg','text');
    waitingText.setAttribute('id', 'waitingText');
    waitingText.setAttribute('x', '200'); waitingText.setAttribute('y', '45');
    waitingText.setAttribute('font-size', '34'); waitingText.setAttribute('font-weight', 'bold');
    waitingText.setAttribute('text-anchor', 'middle'); waitingText.textContent = '等待: 0';
    summaryGroup.appendChild(waitingText);
    const landedText = document.createElementNS('http://www.w3.org/2000/svg','text');
    landedText.setAttribute('id', 'landedText');
    landedText.setAttribute('x', '420'); landedText.setAttribute('y', '45');
    landedText.setAttribute('font-size', '34'); landedText.setAttribute('font-weight', 'bold');
    landedText.setAttribute('text-anchor', 'middle'); landedText.textContent = '已著陸: 0';
    summaryGroup.appendChild(landedText);
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
            // ★ 若啟用移動，檢查權限
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
        // ★ 修正：確保 d 為正數
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
            // ★ 寫入 Firestore（僅當有權限）
            const role = await window.getUserRole();
            if (['admin', 'occ'].includes(role)) {
                await window.setGlobalOffsetToFirestore(mapGlobalOffset);
            } else {
                // 理論上不應發生，因為移動模式已檢查權限
                console.warn('無權限寫入偏移量');
            }
        }
    });
}

// ---- 其餘函式（mapUpdateFromFirestore, mapUpdateSummary, mapApplySequences, mapSearchCabin, mapClearAll, mapExportCSV, mapOpenCabin, closeCabinModal, loadCabinGroupStatus, editGroup, loadGroupDetail, openGroupModal, saveGroupRecord, closeGroupModal, deleteGroupRecord, initMap, mapManualRefresh 等與原檔案相同，僅保留不變） ----
// 因篇幅限制，此處省略，請保留原檔案的其餘函式（它們不需修改）。

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
