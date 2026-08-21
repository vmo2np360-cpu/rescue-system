// ================================================================
// 救援地圖模組 (完整移植)
// ================================================================

let mapCabins = [];
let mapRopePts = [];
let mapGlobalOffset = 0;
let mapCabinMode = 84;
let mapMoveMode = false;
let mapCurrentCabin = null;

// ---- 初始化地圖 ----
function mapInit() {
    if (mapCabins.length) return;
    const svg = document.getElementById('map');
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for(let i=0;i<slots.length;i++){ x += slots[i]*unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const defs = svg.querySelector('defs');
    svg.innerHTML = '';
    if (defs) svg.appendChild(defs);

    const addRect = (x,y,w,h,cls) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('x',x); r.setAttribute('y',y); r.setAttribute('width',w); r.setAttribute('height',h);
        r.setAttribute('class',cls);
        svg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX-xCoords[0], 100, 'city');
    addRect(t2bX, baseY, t3X-t2bX, 100, 'sea');
    const mountain = document.createElementNS('http://www.w3.org/2000/svg','path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill','url(#gradMountain)');
    svg.appendChild(mountain);

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
        svg.appendChild(use);
        const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.textContent = s;
        txt.setAttribute('x', gx); txt.setAttribute('y', gy+25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('class', 'label');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-weight', 'bold');
        svg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1]-60]);
    const down = groundPts.map(p => [p[0], p[1]+60]).reverse();
    mapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    rope.setAttribute('points', mapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill','none'); rope.setAttribute('stroke','#444'); rope.setAttribute('stroke-width','3');
    svg.appendChild(rope);

    const ropeHit = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    ropeHit.setAttribute('points', rope.getAttribute('points'));
    ropeHit.setAttribute('stroke','transparent');
    ropeHit.setAttribute('stroke-width','30');
    ropeHit.setAttribute('fill','none');
    ropeHit.style.cursor = 'default';
    ropeHit.style.pointerEvents = 'all';
    svg.appendChild(ropeHit);

    mapBuildCabins();
    mapRestoreState();

    // 事件綁定
    document.getElementById('moveToggleBtn').addEventListener('click', function() {
        mapMoveMode = !mapMoveMode;
        this.textContent = mapMoveMode ? '禁用移動' : '啟用移動';
        this.style.background = mapMoveMode ? '#dc2626' : '#e2e8f0';
        this.style.color = mapMoveMode ? 'white' : '#1e293b';
        if (mapMoveMode) {
            let dragging = false, lastX;
            ropeHit.addEventListener('mousedown', e => {
                dragging = true;
                lastX = e.clientX;
                ropeHit.style.cursor = 'grabbing';
            });
            window.addEventListener('mousemove', e => {
                if (dragging) {
                    mapGlobalOffset += (e.clientX - lastX) * 2;
                    lastX = e.clientX;
                    mapLayoutCabins();
                }
            });
            window.addEventListener('mouseup', () => {
                dragging = false;
                ropeHit.style.cursor = 'grab';
            });
        }
    });

    document.getElementById('mapToggleBtn').addEventListener('click', function() {
        mapCabinMode = mapCabinMode === 84 ? 109 : 84;
        this.textContent = '切換到 ' + (mapCabinMode===84?'109':'84') + ' 車廂';
        document.getElementById('modeLabel').textContent = '模式: ' + mapCabinMode + ' 車廂';
        localStorage.setItem('mapCabinMode', mapCabinMode);
        mapBuildCabins();
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

    mapUpdateFromFirestore();
}

function mapBuildCabins() {
    const svg = document.getElementById('map');
    mapCabins.forEach(c => { if(c.el) svg.removeChild(c.el); });
    mapCabins = [];
    const total = mapCabinMode;
    const size = mapCabinMode === 109 ? 20 : 24;
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
        g.appendChild(hex);
        const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
        lbl.setAttribute('class', 'seq-label');
        lbl.setAttribute('y', '5');
        lbl.setAttribute('font-size', mapCabinMode===109 ? '18' : '22');
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
    mapRestoreSequences();
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
    const saved = localStorage.getItem('mapGlobalOffset');
    if (saved) mapGlobalOffset = parseFloat(saved);
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

async function mapUpdateFromFirestore() {
    try {
        const snap = await db.collection('guests').get();
        const guests = [];
        snap.forEach(d => guests.push({ id: d.id, ...d.data() }));
        mapCabins.forEach(cabin => {
            const seq = cabin.fields.sequence;
            cabin.shape.style.fill = '#fff';
            cabin.shape.style.stroke = '#333';
            if(seq) {
                const matched = guests.filter(g => g.cabinNumber === seq);
                if(matched.length) {
                    let landed=0, rescuing=0, waiting=0;
                    matched.forEach(g => {
                        const s = getGroupStatus(g);
                        if(s === 'landed') landed++;
                        else if(s === 'rescuing') rescuing++;
                        else waiting++;
                    });
                    if(landed === matched.length && matched.length > 0) {
                        cabin.shape.style.fill = '#22c55e';
                        cabin.shape.style.stroke = '#16a34a';
                    } else if(waiting === 0 && rescuing > 0) {
                        cabin.shape.style.fill = '#eab308';
                        cabin.shape.style.stroke = '#ca8a04';
                    } else if(waiting > 0) {
                        cabin.shape.style.fill = '#dc2626';
                        cabin.shape.style.stroke = '#b91c1c';
                    }
                }
            }
        });
        mapUpdateSummary();
    } catch(e) { console.error('地圖更新失敗:', e); }
}

function mapUpdateSummary() {
    let waiting=0, rescuing=0, landed=0;
    const wc=[], rc=[], lc=[];
    mapCabins.forEach(c => {
        const color = c.shape.style.fill;
        const seq = c.fields.sequence || '';
        if(color === '#dc2626') { waiting++; if(seq) wc.push(seq); }
        else if(color === '#eab308') { rescuing++; if(seq) rc.push(seq); }
        else if(color === '#22c55e') { landed++; if(seq) lc.push(seq); }
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
    cabin.shape.style.stroke = 'gold';
    cabin.shape.style.strokeWidth = '6';
    setTimeout(() => { cabin.shape.style.stroke = '#333'; cabin.shape.style.strokeWidth = '2'; }, 3000);
    const svg = document.getElementById('map');
    const bbox = cabin.el.getBBox();
    svg.setAttribute('viewBox', `${bbox.x-100} ${bbox.y-100} 200 200`);
    setTimeout(() => svg.setAttribute('viewBox', '0 0 4000 700'), 3000);
}

function mapClearAll() {
    if(!confirm('確定清除所有車廂資料？')) return;
    mapCabins.forEach(c => {
        c.fields = {};
        c.label.textContent = '';
        realtimeDb.ref('cabins/'+c.id).remove();
        c.shape.style.fill = '#fff';
        c.shape.style.stroke = '#333';
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
}

function closeCabinModal() {
    document.getElementById('cabinModal').style.display = 'none';
    mapCurrentCabin = null;
}

// ---- 初始化 ----
function initMap() {
    console.log('✅ 救援地圖初始化完成');
    mapInit();
}

// ---- 暴露 ----
window.mapInit = mapInit;
window.mapUpdateFromFirestore = mapUpdateFromFirestore;
window.mapApplySequences = mapApplySequences;
window.mapSearchCabin = mapSearchCabin;
window.mapClearAll = mapClearAll;
window.mapExportCSV = mapExportCSV;
window.closeCabinModal = closeCabinModal;
window.initMap = initMap;