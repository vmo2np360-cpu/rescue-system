// ================================================================
// Monitor 專屬地圖（唯讀模式，資料與主地圖同步）
// 複用 map.js 的核心邏輯，但操作 monitorMap SVG
// ================================================================

let monMapCabins = [];
let monMapRopePts = [];
let monSvg = null;
let monGlobalOffset = 0;      // 獨立偏移量，不影響主地圖

function monInitMap() {
    if (monMapCabins.length > 0) {
        console.log('Monitor 地圖已初始化，跳過');
        return;
    }
    monSvg = document.getElementById('monitorMap');
    if (!monSvg) {
        console.warn('找不到 #monitorMap，300ms 後重試');
        setTimeout(monInitMap, 300);
        return;
    }

    // 清空 SVG
    while (monSvg.firstChild) monSvg.removeChild(monSvg.firstChild);

    // ----- 建立 Defs（與主地圖相同） -----
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    const gradMountain = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    gradMountain.setAttribute('id', 'monGradMountain');
    gradMountain.setAttribute('x1','0'); gradMountain.setAttribute('y1','1');
    gradMountain.setAttribute('x2','0'); gradMountain.setAttribute('y2','0');
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s1.setAttribute('offset','0%'); s1.setAttribute('stop-color','#388E3C');
    const s2 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s2.setAttribute('offset','100%'); s2.setAttribute('stop-color','#A5D6A7');
    gradMountain.appendChild(s1); gradMountain.appendChild(s2);
    defs.appendChild(gradMountain);

    const gradBay = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    gradBay.setAttribute('id', 'monGradBay');
    gradBay.setAttribute('x1','0'); gradBay.setAttribute('y1','0');
    gradBay.setAttribute('x2','0'); gradBay.setAttribute('y2','1');
    const s3 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s3.setAttribute('offset','0%'); s3.setAttribute('stop-color','#81D4FA');
    const s4 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s4.setAttribute('offset','100%'); s4.setAttribute('stop-color','#0288D1');
    gradBay.appendChild(s3); gradBay.appendChild(s4);
    defs.appendChild(gradBay);

    // 高亮濾鏡（搜尋用）
    const filter = document.createElementNS('http://www.w3.org/2000/svg','filter');
    filter.setAttribute('id', 'monHighlightGlow');
    const shadow = document.createElementNS('http://www.w3.org/2000/svg','feDropShadow');
    shadow.setAttribute('dx','0'); shadow.setAttribute('dy','0');
    shadow.setAttribute('stdDeviation','6'); shadow.setAttribute('flood-color','gold');
    filter.appendChild(shadow);
    defs.appendChild(filter);
    monSvg.appendChild(defs);

    // 背景
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x','0'); bg.setAttribute('y','0');
    bg.setAttribute('width','2800'); bg.setAttribute('height','700');
    bg.setAttribute('fill','#1a2a3a');
    monSvg.appendChild(bg);

    // ----- 繪製地圖元素（與 map.js 相同） -----
    const segments = ['TC','T1','T2A','AIAS','T2B','T3','T4','T5','NLS','T6','T7','NP'];
    const slots = [2,2,2,2,10,6,5,1,2,7,3];
    const startX = 150, endX = 2650, unit = (endX - startX) / 42;
    const baseY = 600, topY = 300, npY = 340;
    let x = startX;
    const xCoords = [x];
    for(let i=0;i<slots.length;i++){ x += slots[i]*unit; xCoords.push(x); }
    const t2bX = xCoords[4], t3X = xCoords[5], nlsX = xCoords[8], npX = xCoords[11];

    const addRect = (x, y, w, h, fillColor) => {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', w); r.setAttribute('height', h);
        r.setAttribute('fill', fillColor);
        monSvg.appendChild(r);
    };
    addRect(xCoords[0], baseY, t2bX - xCoords[0], 100, '#4a4a4a');
    addRect(t2bX, baseY, t3X - t2bX, 100, '#81D4FA');

    const mountain = document.createElementNS('http://www.w3.org/2000/svg','path');
    mountain.setAttribute('d', `M${t3X},${baseY} L${nlsX},${topY} L${npX},${npY} L${npX},700 L${t3X},700 Z`);
    mountain.setAttribute('fill','url(#monGradMountain)');
    monSvg.appendChild(mountain);

    let groundPts = [];
    segments.forEach((s,i) => {
        let gx = xCoords[i], gy = baseY;
        if(s==='NLS') gy = topY;
        else if(s==='NP') gy = npY;
        else if(s==='T3' || (i>5 && i<segments.indexOf('NLS'))) gy = baseY - (baseY-topY)*((gx-t3X)/(nlsX-t3X));
        else if(i>segments.indexOf('NLS')) gy = topY + (npY-topY)*((gx-nlsX)/(npX-nlsX));
        groundPts.push([gx, gy]);
        const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
        circle.setAttribute('cx', gx); circle.setAttribute('cy', gy);
        circle.setAttribute('r', '8'); circle.setAttribute('fill', '#fff');
        circle.setAttribute('stroke', '#444'); circle.setAttribute('stroke-width', '2');
        monSvg.appendChild(circle);
        const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.textContent = s;
        txt.setAttribute('x', gx); txt.setAttribute('y', gy+25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('font-size', '14');
        monSvg.appendChild(txt);
    });

    const up = groundPts.map(p => [p[0], p[1]-60]);
    const down = groundPts.map(p => [p[0], p[1]+60]).reverse();
    monMapRopePts = [...up, ...down, [up[0][0], up[0][1]]];
    const rope = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    rope.setAttribute('points', monMapRopePts.map(p => p.join(',')).join(' '));
    rope.setAttribute('fill','none'); rope.setAttribute('stroke','#666');
    rope.setAttribute('stroke-width','3');
    monSvg.appendChild(rope);

    // ----- 圖例（深色版） -----
    const legend = document.createElementNS('http://www.w3.org/2000/svg','g');
    legend.setAttribute('transform', 'translate(1800,420)');
    const rectBg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rectBg.setAttribute('x','0'); rectBg.setAttribute('y','0');
    rectBg.setAttribute('width','260'); rectBg.setAttribute('height','160');
    rectBg.setAttribute('fill','#2d2d2d'); rectBg.setAttribute('stroke','#555'); rectBg.setAttribute('rx','6');
    legend.appendChild(rectBg);
    const title = document.createElementNS('http://www.w3.org/2000/svg','text');
    title.textContent = '車廂狀態';
    title.setAttribute('x','130'); title.setAttribute('y','30');
    title.setAttribute('font-size','24'); title.setAttribute('font-weight','bold');
    title.setAttribute('text-anchor','middle'); title.setAttribute('fill','#fff');
    legend.appendChild(title);
    const items = [
        { color: '#EA4335', label: '等待救援', y: 65 },
        { color: '#FBBC05', label: '救援中', y: 100 },
        { color: '#34A853', label: '已著陸', y: 135 }
    ];
    items.forEach((item) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg','g');
        g.setAttribute('transform', `translate(20, ${item.y})`);
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('width','20'); r.setAttribute('height','20');
        r.setAttribute('fill', item.color); r.setAttribute('stroke','#333');
        g.appendChild(r);
        const t = document.createElementNS('http://www.w3.org/2000/svg','text');
        t.setAttribute('x','30'); t.setAttribute('y','15');
        t.setAttribute('font-size','18'); t.setAttribute('fill','#fff');
        t.textContent = item.label;
        g.appendChild(t);
        legend.appendChild(g);
    });
    monSvg.appendChild(legend);

    // ----- 建立車廂（與主地圖相同數量、尺寸） -----
    monBuildCabins();

    // ----- 監聽車廂資料變化（與主地圖同步） -----
    realtimeDb.ref('cabins').on('value', (snap) => {
        const data = snap.val();
        if (!data) return;
        monMapCabins.forEach(c => {
            if (data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            }
        });
        monUpdateFromFirestore();
    });

    // 初始載入序號
    realtimeDb.ref('cabins').once('value').then(snap => {
        const data = snap.val();
        if (!data) return;
        monMapCabins.forEach(c => {
            if (data[c.id]) {
                c.fields = data[c.id];
                c.label.textContent = c.fields.sequence || '';
            }
        });
        monUpdateFromFirestore();
    });

    // Firestore 即時監聽（狀態更新）
    db.collection('guests').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });
    db.collection('rescue_records').onSnapshot(() => {
        if (monMapCabins.length > 0) monUpdateFromFirestore();
    });

    console.log('✅ Monitor 地圖初始化完成（唯讀模式，資料與主地圖同步）');
}

// ----- 構建車廂（與主地圖相同） -----
function monBuildCabins() {
    if (!monSvg) return;
    monMapCabins.forEach(c => { if(c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el); });
    monMapCabins = [];
    const total = 84; // 固定 84 車廂（或可從 localStorage 讀取）
    const size = 20;
    const fontSize = 20;
    const ropeLen = monLengthOf(monMapRopePts);
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
        // 點擊車廂 → 開啟唯讀詳情
        g.addEventListener('dblclick', () => monOpenCabinReadonly(cabin));
        monMapCabins.push(cabin);
        monSvg.appendChild(g);
    }
    monLayoutCabins();
}

function monLayoutCabins() {
    const ropeLen = monLengthOf(monMapRopePts);
    monMapCabins.forEach((c, i) => {
        const d = (i * ropeLen / monMapCabins.length + monGlobalOffset) % ropeLen;
        const pos = monPointAt(monMapRopePts, d);
        c.el.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    });
}

function monLengthOf(pts) {
    let L=0;
    for(let i=0;i<pts.length-1;i++) L += Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]);
    return L;
}

function monPointAt(pts,d) {
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

// ----- 更新車廂狀態（與主地圖邏輯一致） -----
async function monUpdateFromFirestore() {
    try {
        const rescueSnap = await db.collection('rescue_records').get();
        const rescueRecords = [];
        rescueSnap.forEach(d => rescueRecords.push({ id: d.id, ...d.data() }));

        const guestSnap = await db.collection('guests').get();
        const guestRecords = [];
        guestSnap.forEach(d => guestRecords.push({ id: d.id, ...d.data() }));

        monMapCabins.forEach(cabin => {
            const seq = cabin.fields.sequence;
            cabin.el.classList.remove('status-red', 'status-yellow', 'status-green');
            cabin.shape.setAttribute('fill', '#ffffff');
            cabin.shape.setAttribute('stroke', '#333');

            if (seq) {
                const hasRescue = rescueRecords.some(r => r.cabinNumber === seq && r.processed === false);
                if (hasRescue) {
                    cabin.el.classList.add('status-red');
                    cabin.shape.setAttribute('fill', '#EA4335');
                    cabin.shape.setAttribute('stroke', '#b91c1c');
                    return;
                }
                const matched = guestRecords.filter(g => g.cabinNumber === seq);
                if (matched.length > 0) {
                    let landed = 0, rescuing = 0, waiting = 0;
                    matched.forEach(g => {
                        const status = monGetGroupStatus(g);
                        if (status === 'landed') landed++;
                        else if (status === 'rescuing') rescuing++;
                        else waiting++;
                    });
                    if (landed === matched.length && matched.length > 0) {
                        cabin.el.classList.add('status-green');
                        cabin.shape.setAttribute('fill', '#34A853');
                        cabin.shape.setAttribute('stroke', '#16a34a');
                    } else if (waiting === 0 && rescuing > 0) {
                        cabin.el.classList.add('status-yellow');
                        cabin.shape.setAttribute('fill', '#FBBC05');
                        cabin.shape.setAttribute('stroke', '#ca8a04');
                    } else if (waiting > 0) {
                        cabin.el.classList.add('status-red');
                        cabin.shape.setAttribute('fill', '#EA4335');
                        cabin.shape.setAttribute('stroke', '#b91c1c');
                    }
                } else {
                    cabin.shape.setAttribute('fill', '#666');
                    cabin.shape.setAttribute('stroke', '#888');
                }
            }
        });
        monUpdateSummary();
    } catch(e) {
        console.error('Monitor 地圖更新失敗:', e);
    }
}

function monUpdateSummary() {
    let waiting = 0, rescuing = 0, landed = 0;
    const wc=[], rc=[], lc=[];
    monMapCabins.forEach(c => {
        const seq = c.fields.sequence || '';
        if (c.el.classList.contains('status-red')) { waiting++; if(seq) wc.push(seq); }
        else if (c.el.classList.contains('status-yellow')) { rescuing++; if(seq) rc.push(seq); }
        else if (c.el.classList.contains('status-green')) { landed++; if(seq) lc.push(seq); }
    });
    document.getElementById('monWaiting').textContent = waiting;
    document.getElementById('monRescuing').textContent = rescuing;
    document.getElementById('monLanded').textContent = landed;
    document.getElementById('monWaitingCabins').textContent = wc.join(', ');
    document.getElementById('monRescuingCabins').textContent = rc.join(', ');
    document.getElementById('monLandedCabins').textContent = lc.join(', ');
}

function monGetGroupStatus(guest) {
    if (guest.status) {
        if (['landed','rescuing','waiting'].includes(guest.status)) return guest.status;
        if (guest.status === 'completed') return 'landed';
    }
    if (guest.timeLanded) return 'landed';
    if (guest.exitTime && guest.exitMethod) return 'landed';
    if (guest.timeReachedTop || guest.rescuedBy) return 'rescuing';
    if (guest.ambulance === '需要') return 'rescuing';
    return 'waiting';
}

// ----- 搜尋車廂（與主地圖相同） -----
function monSearchCabin() {
    const q = document.getElementById('monSearchBox').value.trim();
    if (!q) return alert('請輸入車廂號碼');
    const cabin = monMapCabins.find(c => c.fields.sequence === q);
    if (!cabin) return alert('找不到車廂: ' + q);

    monMapCabins.forEach(c => {
        c.shape.setAttribute('stroke', '');
        c.shape.setAttribute('stroke-width', '');
        c.shape.removeAttribute('filter');
    });
    cabin.shape.setAttribute('stroke', 'gold');
    cabin.shape.setAttribute('stroke-width', '6');
    cabin.shape.setAttribute('filter', 'url(#monHighlightGlow)');
    setTimeout(() => {
        cabin.shape.setAttribute('stroke', '');
        cabin.shape.setAttribute('stroke-width', '');
        cabin.shape.removeAttribute('filter');
    }, 5000);
}

// ----- 點擊車廂 → 開啟唯讀詳情（無儲存功能） -----
function monOpenCabinReadonly(cabin) {
    const seq = cabin.fields.sequence || '未設定';
    // 從 Firestore 查詢該車廂的組別資料
    db.collection('guests').where('cabinNumber', '==', seq).get().then(snap => {
        let html = `<div style="background:#2d2d2d; padding:16px; border-radius:8px; color:#e0e0e0; max-width:500px; margin:0 auto;">`;
        html += `<h3 style="color:#fff; margin-bottom:12px;">🚠 車廂 ${seq} 詳情</h3>`;
        html += `<p style="color:#aaa; font-size:0.85rem; margin-bottom:12px;">📌 此為唯讀模式，無法編輯</p>`;
        if (snap.empty) {
            html += `<p style="color:#94a3b8;">此車廂暫無組別記錄</p>`;
        } else {
            html += `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">`;
            html += `<tr style="border-bottom:1px solid #444;"><th style="text-align:left; padding:6px 4px; color:#aaa;">組別</th><th style="text-align:left; padding:6px 4px; color:#aaa;">姓名</th><th style="text-align:left; padding:6px 4px; color:#aaa;">狀態</th></tr>`;
            snap.forEach(doc => {
                const data = doc.data();
                const status = monGetGroupStatus(data);
                const statusMap = { 'landed':'✅ 已著陸', 'rescuing':'🔄 救援中', 'waiting':'⏳ 等待救援' };
                html += `<tr style="border-bottom:1px solid #3d3d3d;">`;
                html += `<td style="padding:6px 4px;">第${data.groupNumber||'?'}組</td>`;
                html += `<td style="padding:6px 4px;">${data.guestName||'-'}</td>`;
                html += `<td style="padding:6px 4px;">${statusMap[status]||status}</td>`;
                html += `</tr>`;
            });
            html += `</table>`;
        }
        html += `<div style="margin-top:16px; text-align:center;">`;
        html += `<button onclick="this.closest('.modal-content').parentElement.style.display='none'" style="padding:8px 24px; background:#4285F4; border:none; border-radius:4px; color:#fff; cursor:pointer;">關閉</button>`;
        html += `</div></div>`;

        // 顯示模態框
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:9999;';
        const content = document.createElement('div');
        content.className = 'modal-content';
        content.style.cssText = 'background:#1a1a1a; border-radius:12px; padding:20px; max-width:550px; width:95%; max-height:80vh; overflow-y:auto;';
        content.innerHTML = html;
        modal.appendChild(content);
        document.body.appendChild(modal);
        // 點擊背景關閉
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }).catch(err => {
        alert('載入車廂資料失敗: ' + err.message);
    });
}

// ----- 初始化入口 -----
function monInitMapWrapper() {
    console.log('📍 初始化 Monitor 地圖（唯讀模式）');
    // 等待 DOM 渲染
    if (!document.getElementById('monitorMap')) {
        setTimeout(monInitMapWrapper, 200);
        return;
    }
    monInitMap();
}

// 暴露全域
window.monSearchCabin = monSearchCabin;
window.monInitMapWrapper = monInitMapWrapper;
