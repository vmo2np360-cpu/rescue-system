// ================================================================
// 救援地圖模組 (最終放大版 + 動態圖例)
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

// ---- 初始化地圖 ----
function mapInit() {
    if (mapCabins.length) return;
    mapSvg = document.getElementById('map');
    
    // 設定 viewBox 放大內容
    mapSvg.setAttribute('viewBox', '0 0 2800 700');
    
    mapGlobalOffset = 0;
    localStorage.removeItem('mapGlobalOffset');
    
    // ----- 建立地圖場景 (保留原有代碼) -----
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for(let i=0;i<slots.length;i++){ x += slots[i]*unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const defs = mapSvg.querySelector('defs');
    mapSvg.innerHTML = '';
    if (defs) mapSvg.appendChild(defs);

    const addRect = (x,y,w,h,cls) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('x',x); r.setAttribute('y',y); r.setAttribute('width',w); r.setAttribute('height',h);
        r.setAttribute('class',cls);
        mapSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX-xCoords[0], 100, 'city');
    addRect(t2bX, baseY, t3X-t2bX, 100, 'sea');
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

    const ropeHit = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    ropeHit.setAttribute('points', rope.getAttribute('points'));
    ropeHit.setAttribute('stroke','transparent');
    ropeHit.setAttribute('stroke-width','30');
    ropeHit.setAttribute('fill','none');
    ropeHit.style.cursor = 'default';
    ropeHit.style.pointerEvents = 'all';
    mapSvg.appendChild(ropeHit);

    // ----- 動態建立圖例 (legend) -----
    const legend = document.createElementNS('http://www.w3.org/2000/svg','g');
    legend.setAttribute('id', 'legend');
    legend.setAttribute('transform', 'translate(1950, 480)');
    // 背景框
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width', '280'); rect.setAttribute('height', '170');
    rect.setAttribute('fill', 'white'); rect.setAttribute('stroke', '#333'); rect.setAttribute('rx', '8');
    legend.appendChild(rect);
    // 標題
    const title = document.createElementNS('http://www.w3.org/2000/svg','text');
    title.setAttribute('x', '140'); title.setAttribute('y', '35');
    title.setAttribute('font-size', '28'); title.setAttribute('font-weight', 'bold');
    title.setAttribute('text-anchor', 'middle'); title.textContent = '車廂狀態';
    legend.appendChild(title);
    // 等待救援 (紅色)
    const g1 = document.createElementNS('http://www.w3.org/2000/svg','g');
    g1.setAttribute('transform', 'translate(20, 60)');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r1.setAttribute('width', '24'); r1.setAttribute('height', '24'); r1.setAttribute('fill', '#dc2626'); r1.setAttribute('stroke', '#333');
    g1.appendChild(r1);
    const t1 = document.createElementNS('http://www.w3.org/2000/svg','text');
    t1.setAttribute('x', '36'); t1.setAttribute('y', '18'); t1.setAttribute('font-size', '24'); t1.textContent = '等待救援 (求助記錄)';
    g1.appendChild(t1);
    legend.appendChild(g1);
    // 無記錄 (白色)
    const g2 = document.createElementNS('http://www.w3.org/2000/svg','g');
    g2.setAttribute('transform', 'translate(20, 95)');
    const r2 = document.createElementNS('http://www.w3.org/2000/svg','rect');
    r2.setAttribute('width', '24'); r2.setAttribute('height', '24'); r2.setAttribute('fill', '#ffffff'); r2.setAttribute('stroke', '#333');
    g2.appendChild(r2);
    const t2 = document.createElementNS('http://www.w3.org/2000/svg','text');
    t2.setAttribute('x', '36'); t2.setAttribute('y', '18'); t2.setAttribute('font-size', '24'); t2.textContent = '無求助記錄';
    g2.appendChild(t2);
    legend.appendChild(g2);

    mapSvg.appendChild(legend);

    // 構建車廂
    mapBuildCabins();
    mapLayoutCabins();

    // 移動模式設定
    setupMoveMode();

    // 事件綁定 (按鈕等)
    document.getElementById('mapToggleBtn').addEventListener('click', function() {
        mapCabinMode = mapCabinMode === 84 ? 109 : 84;
        this.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
        document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
        localStorage.setItem('mapCabinMode', mapCabinMode);
        mapBuildCabins();
        mapLayoutCabins();
        mapUpdateFromFirestore();
    });

    document.getElementById('exportCsvBtn').addEventListener('click', mapExportCSV);
    document.getElementById('seqInput').addEventListener('keypress', e => { if(e.key==='Enter') mapApplySequences(); });
    document.getElementById('mapSearchBox').addEventListener('keypress', e => { if(e.key==='Enter') mapSearchCabin(); });

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

    // 綁定 groupForm 提交事件
    const groupForm = document.getElementById('groupForm');
    if (groupForm) {
        groupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveGroupRecord();
        });
    }

    mapRestoreSequences();
}

// ---- 構建車廂 (放大) ----
function mapBuildCabins() {
    const svg = mapSvg || document.getElementById('map');
    mapCabins.forEach(c => { if(c.el) svg.removeChild(c.el); });
    mapCabins = [];
    const total = mapCabinMode;
    const size = mapCabinMode === 109 ? 18 : 22;
    const fontSize = mapCabinMode === 109 ? 20 : 24;
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
        const d = (i * ropeLen / mapCabins.length + mapGlobalOffset) % ropeLen;
        const pos = mapPointAt(mapRopePts, d);
        c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
    localStorage.setItem('mapGlobalOffset', mapGlobalOffset);
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

// ---- 移動模式控制 ----
function setupMoveMode() {
    const ropeHit = document.querySelector('#map polyline[stroke="transparent"]');
    if (!ropeHit) return;
    // 移除舊事件，透過重新建立節點避免重複綁定
    const newRopeHit = ropeHit.cloneNode(true);
    ropeHit.parentNode.replaceChild(newRopeHit, ropeHit);

    newRopeHit.addEventListener('mousedown', (e) => {
        if (!mapMoveMode) return;
        isDragging = true;
        dragStartX = e.clientX;
        newRopeHit.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const delta = e.clientX - dragStartX;
        mapGlobalOffset += delta * 2;
        dragStartX = e.clientX;
        mapLayoutCabins();
    });

    window.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            newRopeHit.style.cursor = 'grab';
            localStorage.setItem('mapGlobalOffset', mapGlobalOffset);
        }
    });
}

// ---- 移動按鈕 (在 DOM 載入後綁定) ----
document.addEventListener('DOMContentLoaded', function() {
    const moveBtn = document.getElementById('moveToggleBtn');
    if (moveBtn) {
        moveBtn.addEventListener('click', function() {
            mapMoveMode = !mapMoveMode;
            this.textContent = mapMoveMode ? '禁用移動' : '啟用移動';
            this.style.background = mapMoveMode ? '#dc2626' : '#e2e8f0';
            this.style.color = mapMoveMode ? 'white' : '#1e293b';
        });
    }
});

// ---- 從 Firestore 更新 (依據求助記錄) ----
async function mapUpdateFromFirestore() {
    try {
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

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
                }
            }
        });
        mapUpdateSummary();
    } catch(e) {
        console.error('地圖更新失敗:', e);
    }
}

function mapUpdateSummary() {
    let waiting = 0, rescuing = 0, landed = 0;
    const wc = [], rc = [], lc = [];

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

    document.getElementById('mapWaiting').textContent = waiting;
    document.getElementById('mapRescuing').textContent = rescuing;
    document.getElementById('mapLanded').textContent = landed;
    document.getElementById('mapWaitingCabins').textContent = wc.join(', ');
    document.getElementById('mapRescuingCabins').textContent = rc.join(', ');
    document.getElementById('mapLandedCabins').textContent = lc.join(', ');
    document.getElementById('waitingText').textContent = '等待: ' + waiting;
    document.getElementById('landedText').textContent = '已著陸: ' + landed;
}

// ---- 以下為其他功能函數 (已修正儲存) ----
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

function mapSearchCabin() {
    const q = document.getElementById('mapSearchBox').value.trim();
    if(!q) return alert('請輸入車廂號碼');
    const cabin = mapCabins.find(c => c.fields.sequence === q);
    if(!cabin) return alert('找不到車廂: ' + q);
    cabin.shape.setAttribute('stroke', 'gold');
    cabin.shape.setAttribute('stroke-width', '6');
    setTimeout(() => { cabin.shape.setAttribute('stroke', ''); cabin.shape.setAttribute('stroke-width', ''); }, 3000);
    const svg = document.getElementById('map');
    const bbox = cabin.el.getBBox();
    svg.setAttribute('viewBox', `${bbox.x-100} ${bbox.y-100} 200 200`);
    setTimeout(() => svg.setAttribute('viewBox', '0 0 2800 700'), 3000);
}

function mapClearAll() {
    if(!confirm('確定清除所有車廂資料？')) return;
    mapCabins.forEach(c => {
        c.fields = {};
        c.label.textContent = '';
        realtimeDb.ref('cabins/'+c.id).remove();
        c.shape.setAttribute('fill', '#ffffff');
        c.shape.setAttribute('stroke', '#333');
        c.el.classList.remove("status-red", "status-yellow", "status-green");
    });
    document.getElementById('seqInput').value = '';
    mapUpdateSummary();
}

function mapExportCSV() {
    db.collection('guests').get().then(snap => {
        const records = [];
        snap.forEach(d => records.push(d.data()));
        if(!records.length) { alert('無資料'); return; }
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
    // ... (保持原樣)
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
    // ... (填入資料)
    modal.style.display = 'flex';
}

// ---- 儲存組別記錄 (防止頁面刷新) ----
async function saveGroupRecord() {
    const docId = document.getElementById('groupDocId').value;
    // ... (收集資料並更新)
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
    // ... (刪除邏輯)
}

// ---- 初始化 ----
function initMap() {
    console.log('✅ 救援地圖初始化完成');
    mapInit();
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
