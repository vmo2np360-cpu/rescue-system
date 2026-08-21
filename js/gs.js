// ================================================================
// Ground Support 模組
// ================================================================

let gsCurrentDocId = null;
let gsPendingData = null;

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

// ---- 建立記錄 ----
async function gsCreateRecord() {
    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;
    const name = document.getElementById('gsGuestName').value.trim();
    const health = document.getElementById('gsHealthStatus').value;
    if (!cabin || !group || !name || !health) {
        showMessage('gsMessage', '請填寫車廂、組別、姓名和健康狀況', 'error');
        return;
    }
    let contact = document.getElementById('gsContactNumber').value.trim();
    const other = document.getElementById('gsOtherContactInput').value.trim();
    if (other) contact = other;
    if (!contact) contact = '未提供';
    const data = {
        cabinNumber: cabin,
        groupNumber: group,
        guestName: name,
        contactNumber: contact,
        gender: document.getElementById('gsGender').value,
        ageRange: document.getElementById('gsAgeRange').value,
        healthStatus: health,
        createdAt: new Date(),
        status: 'pending'
    };
    gsPendingData = data;

    try {
        const dup = await db.collection('guests').where('cabinNumber','==',cabin).where('groupNumber','==',group).get();
        if (!dup.empty) {
            const list = document.getElementById('gsDuplicateList');
            list.innerHTML = '';
            dup.forEach(doc => {
                const existing = doc.data();
                const div = document.createElement('div');
                div.style.padding = '4px 0';
                div.innerHTML = `<strong>${existing.guestName||'未提供姓名'}</strong> (聯絡: ${existing.contactNumber||'-'}) 健康: ${existing.healthStatus||'-'}`;
                list.appendChild(div);
            });
            document.getElementById('gsDuplicateWarning').style.display = 'block';
            document.getElementById('gsDuplicateWarning').scrollIntoView({ behavior: 'smooth' });
            return;
        }
        await gsSaveNewRecord(data);
    } catch (e) {
        showMessage('gsMessage', '檢查重複失敗: ' + e.message, 'error');
    }
}

function gsCancelDuplicate() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    gsPendingData = null;
}

async function gsCreateAnyway() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    if (!gsPendingData) return;
    await gsSaveNewRecord(gsPendingData);
    gsPendingData = null;
}

async function gsSaveNewRecord(data) {
    try {
        showLoader(true);
        const ref = await db.collection('guests').add(data);
        gsCurrentDocId = ref.id;
        showMessage('gsMessage', '記錄建立成功！', 'success');
        gsGenerateQR(gsCurrentDocId, data.healthStatus);
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = data.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${data.groupNumber}組`;
        document.getElementById('gsCabinNumber').value = '';
        document.getElementById('gsGroupNumber').value = '';
        document.getElementById('gsGuestName').value = '';
        document.getElementById('gsContactNumber').value = '';
        document.getElementById('gsGender').value = '';
        document.getElementById('gsAgeRange').value = '';
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();
    } catch (e) {
        showMessage('gsMessage', '建立失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

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
    // 可在此處做其他初始化，例如重置表單或訊息
    document.getElementById('gsMessage').className = 'message';
    document.getElementById('gsQrResult').style.display = 'none';
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