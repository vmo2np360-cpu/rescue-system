// ================================================================
// Ground Support 模組 (支援 Upsert 邏輯：新增/更新)
// ================================================================

let gsCurrentDocId = null;
let gsPendingData = null;
let gsDuplicateDocId = null;        // ★ 儲存重複記錄的 docId

// ---- 聯絡方式輔助 ----
function setGsContact(type) {
    document.getElementById('gsContactNumber').value = type;
    document.getElementById('gsOtherContactContainer').style.display = 'none';
}

function toggleGsOtherContact() {
    const c = document.getElementById('gsOtherContactContainer');
    c.style.display = c.style.display === 'block' ? 'none' : 'block';
    if (c.style.display === 'block') {
        document.getElementById('gsContactNumber').disabled = true;
    } else {
        document.getElementById('gsContactNumber').disabled = false;
        document.getElementById('gsOtherContactInput').value = '';
    }
}

function toggleGsSmsSuffix() {
    const inp = document.getElementById('gsContactNumber');
    if (document.getElementById('gsSmsOnly').checked) {
        if (inp.value && !inp.value.includes('(只能接收短信)')) inp.value += ' (只能接收短信)';
    } else {
        inp.value = inp.value.replace(' (只能接收短信)', '');
    }
}

// ---- 建立記錄 (檢查重複) ----
async function gsCreateRecord() {
    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;
    const name = document.getElementById('gsGuestName').value.trim();
    const health = document.getElementById('gsHealthStatus').value;
    const timeLanded = document.getElementById('gsTimeLanded').value;

    // 基本驗證
    if (!cabin || !group || !name || !health) {
        showMessage('gsMessage', '請填寫車廂、組別、姓名和健康狀況', 'error');
        return;
    }

    // 聯絡方式
    let contact = document.getElementById('gsContactNumber').value.trim();
    const other = document.getElementById('gsOtherContactInput').value.trim();
    if (other) contact = other;
    if (!contact) contact = '未提供';

    // 準備資料
    const data = {
        cabinNumber: cabin,
        groupNumber: group,
        guestName: name,
        contactNumber: contact,
        gender: document.getElementById('gsGender').value,
        ageRange: document.getElementById('gsAgeRange').value,
        healthStatus: health,
        status: 'rescuing',
        updatedAt: new Date()
    };

    // ★ 如果有填寫完成救援時間，則加入
    if (timeLanded) {
        data.timeLanded = timeLanded;
        data.status = 'landed';  // 若有完成時間，狀態改為已著陸
    }

    gsPendingData = data;

    try {
        // 檢查是否已有相同車廂+組別的記錄
        const dup = await db.collection('guests')
            .where('cabinNumber', '==', cabin)
            .where('groupNumber', '==', group)
            .get();

        if (!dup.empty) {
            // ★ 儲存重複文件的 ID
            gsDuplicateDocId = dup.docs[0].id;
            
            const list = document.getElementById('gsDuplicateList');
            list.innerHTML = '';
            dup.forEach(doc => {
                const existing = doc.data();
                const div = document.createElement('div');
                div.style.padding = '8px 0';
                div.style.borderBottom = '1px solid #e2e8f0';
                
                // ★ 顯示既有記錄的詳細資訊（包含時間）
                const reachedTop = existing.timeReachedTop || '未記錄';
                const landed = existing.timeLanded || '未記錄';
                
                div.innerHTML = `
                    <div><strong>姓名：</strong>${existing.guestName || '未提供'}</div>
                    <div><strong>聯絡方式：</strong>${existing.contactNumber || '-'}</div>
                    <div><strong>健康狀況：</strong>${existing.healthStatus || '-'}</div>
                    <div><strong>開始救援時間：</strong>${reachedTop}</div>
                    <div><strong>完成救援時間：</strong>${landed}</div>
                    <div style="font-size:0.8rem; color:#eab308; margin-top:4px;">
                        ⚠️ 此記錄已存在，將執行「更新」而非新增
                    </div>
                `;
                list.appendChild(div);
            });
            
            // 更新重複警告標題
            document.querySelector('#gsDuplicateWarning .gs-duplicate-title').textContent = '⚠️ 發現已存在的記錄 (將執行更新)';
            
            document.getElementById('gsDuplicateWarning').style.display = 'block';
            document.getElementById('gsDuplicateWarning').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        // 無重複，直接新增
        gsDuplicateDocId = null;
        await gsSaveOrUpdateRecord(data, null);

    } catch (e) {
        showMessage('gsMessage', '檢查重複失敗: ' + e.message, 'error');
    }
}

function gsCancelDuplicate() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    gsPendingData = null;
    gsDuplicateDocId = null;
}

// ★ 強制建立/更新（當使用者確認重複時）
async function gsCreateAnyway() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    if (!gsPendingData) return;
    
    // ★ 傳入重複文件的 ID（若有）或 null（無重複）
    await gsSaveOrUpdateRecord(gsPendingData, gsDuplicateDocId);
    gsPendingData = null;
    gsDuplicateDocId = null;
}

// ★ 核心函式：新增或更新記錄
async function gsSaveOrUpdateRecord(data, docId) {
    try {
        showLoader(true);

        // 決定是新增還是更新
        let ref;
        let isUpdate = false;

        if (docId) {
            // 🔄 更新既有記錄
            isUpdate = true;
            
            // ★ 檢查是否有 timeLanded，若有則更新 status
            const updateData = { ...data };
            
            // 如果是更新，不要覆蓋原有的 timeReachedTop
            // 先取得既有記錄的 timeReachedTop
            const existingDoc = await db.collection('guests').doc(docId).get();
            if (existingDoc.exists) {
                const existingData = existingDoc.data();
                // 保留原有的 timeReachedTop（開始救援時間）
                if (existingData.timeReachedTop) {
                    updateData.timeReachedTop = existingData.timeReachedTop;
                }
                // 如果沒有 timeReachedTop（舊資料），則補上
                if (!updateData.timeReachedTop) {
                    updateData.timeReachedTop = new Date().toISOString();
                }
            }

            // 更新時間戳
            updateData.updatedAt = new Date();

            await db.collection('guests').doc(docId).update(updateData);
            ref = { id: docId };
            gsCurrentDocId = docId;

            showMessage('gsMessage', '✅ 記錄更新成功！', 'success');

        } else {
            // ➕ 新增記錄（自動填入開始救援時間）
            isUpdate = false;
            
            // ★ 自動生成開始救援時間
            data.timeReachedTop = new Date().toISOString();
            data.createdAt = new Date();
            data.status = data.timeLanded ? 'landed' : 'rescuing';

            const newRef = await db.collection('guests').add(data);
            ref = newRef;
            gsCurrentDocId = newRef.id;

            showMessage('gsMessage', '✅ 記錄建立成功！', 'success');
        }

        // 生成 QR 碼
        const healthStatus = data.healthStatus || '未分類';
        gsGenerateQR(gsCurrentDocId, healthStatus);
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = data.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${data.groupNumber}組`;

        // 清空表單（僅在新增成功時清空，更新時保留？依需求而定）
        // 此處統一清空，使用者可重新輸入
        document.getElementById('gsCabinNumber').value = '';
        document.getElementById('gsGroupNumber').value = '';
        document.getElementById('gsGuestName').value = '';
        document.getElementById('gsContactNumber').value = '';
        document.getElementById('gsGender').value = '';
        document.getElementById('gsAgeRange').value = '';
        document.getElementById('gsHealthStatus').value = '綠色(第三優先)';
        document.getElementById('gsTimeLanded').value = '';
        document.getElementById('gsSmsOnly').checked = false;

        // 更新地圖和記錄列表
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();

    } catch (e) {
        const action = docId ? '更新' : '建立';
        showMessage('gsMessage', `${action}失敗: ` + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// ---- QR 碼生成 ----
function gsGenerateQR(docId, health) {
    const container = document.getElementById('gsQrCode');
    container.innerHTML = '';
    const color = window.getQRCodeColor ? window.getQRCodeColor(health) : '#4267B2';
    const qr = new QRCodeStyling({
        width: 250, height: 250,
        data: JSON.stringify({ docId, type: 'guestRecord' }),
        dotsOptions: { color, type: 'rounded' },
        backgroundOptions: { color: '#ffffff' }
    });
    qr.append(container);
    window.gsQrInstance = qr;
}

function gsSavePDF() {
    if (!window.gsQrInstance) return alert('請先建立 QR 碼');
    const canvas = document.getElementById('gsQrCode').querySelector('canvas');
    if (!canvas) return alert('無法取得 QR 碼');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    pdf.setFontSize(24); pdf.text('Guest QR Code Certificate', pw/2, 25, { align: 'center' });
    const img = canvas.toDataURL('image/png');
    pdf.addImage(img, 'PNG', (pw-100)/2, 40, 100, 100);
    const cabin = document.getElementById('gsPrintCabin').textContent;
    const group = document.getElementById('gsPrintGroup').textContent;
    pdf.setFontSize(14);
    pdf.text(`Cabin: ${cabin}`, 30, 160);
    pdf.text(`Group: ${group}`, 30, 175);
    pdf.save(`QR_${cabin}_${group.replace('第','').replace('組','')}.pdf`);
}

// ---- 初始化函數 ----
function initGroundSupport() {
    console.log('✅ Ground Support 初始化完成');
    document.getElementById('gsMessage').className = 'message';
    document.getElementById('gsQrResult').style.display = 'none';
    document.getElementById('gsDuplicateWarning').style.display = 'none';
}

// ---- 暴露給全域 ----
window.setGsContact = setGsContact;
window.toggleGsOtherContact = toggleGsOtherContact;
window.toggleGsSmsSuffix = toggleGsSmsSuffix;
window.gsCreateRecord = gsCreateRecord;
window.gsCancelDuplicate = gsCancelDuplicate;
window.gsCreateAnyway = gsCreateAnyway;
window.gsSavePDF = gsSavePDF;
window.initGroundSupport = initGroundSupport;

console.log('✅ gs.js 已載入 (支援新增/更新邏輯)');
