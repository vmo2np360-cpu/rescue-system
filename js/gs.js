// ================================================================
// Ground Support 模組
// - 保留原有 gsCreateRecord() 流程（完整表單模式）
// - 新增「開始救援 / 完成救援 / 修改內容 / 完全重新記錄」
// ================================================================

let gsCurrentDocId = null;
let gsPendingData = null;
let gsDuplicateDocId = null;

let gsCurrentMode = 'start';
let gsModifyMode = false;
let gsModifyDocId = null;
let gsOverwritePendingDocId = null;
let _gsOngoingUnsub = null;

// ================================================================
// 聯絡方式輔助
// ================================================================
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

function toggleGsOtherRescuer() {
    const v = document.getElementById('gsRescuedBy').value;
    const c = document.getElementById('gsOtherRescuerContainer');
    c.style.display = (v === '其他') ? 'block' : 'none';
    if (v !== '其他') {
        document.getElementById('gsOtherRescuerInput').value = '';
    }
}

// ================================================================
// 原有：gsCreateRecord()（完整表單模式，保留原邏輯）
// ================================================================
async function gsCreateRecord() {
    gsDuplicateDocId = null;

    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;
    const name = document.getElementById('gsGuestName').value.trim();
    const health = document.getElementById('gsHealthStatus').value;
    const timeLanded = document.getElementById('gsTimeLanded').value;

    if (!cabin || !group) {
        showMessage('gsMessage', '請填寫車廂和組別（必填）', 'error');
        return;
    }

    let contact = document.getElementById('gsContactNumber').value.trim();
    const other = document.getElementById('gsOtherContactInput').value.trim();
    if (other) contact = other;
    if (!contact) contact = '未提供';

    let rescuedBy = document.getElementById('gsRescuedBy').value;
    if (rescuedBy === '其他') {
        rescuedBy = document.getElementById('gsOtherRescuerInput').value.trim();
    }
    if (!rescuedBy) rescuedBy = '';

    const data = {
        cabinNumber: cabin,
        groupNumber: group,
        guestName: name,
        contactNumber: contact,
        gender: document.getElementById('gsGender').value,
        ageRange: document.getElementById('gsAgeRange').value,
        healthStatus: health,
        rescuedBy: rescuedBy,
        remarks: document.getElementById('gsRemarks').value.trim(),
        status: 'rescuing',
        updatedAt: new Date()
    };

    if (timeLanded) {
        data.timeLanded = timeLanded;
        data.status = 'landed';
    }

    gsPendingData = data;

    try {
        const dup = await db.collection('guests')
            .where('cabinNumber', '==', cabin)
            .where('groupNumber', '==', group)
            .get();

        if (!dup.empty) {
            gsDuplicateDocId = dup.docs[0].id;
            const list = document.getElementById('gsDuplicateList');
            list.innerHTML = '';
            dup.forEach(doc => {
                const existing = doc.data();
                const div = document.createElement('div');
                div.style.padding = '8px 0';
                div.style.borderBottom = '1px solid #e2e8f0';
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
            document.querySelector('#gsDuplicateWarning .gs-duplicate-title').textContent = '⚠️ 發現已存在的記錄 (將執行更新)';
            document.getElementById('gsDuplicateWarning').style.display = 'block';
            document.getElementById('gsDuplicateWarning').scrollIntoView({ behavior: 'smooth' });
            return;
        }

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

async function gsCreateAnyway() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    if (!gsPendingData) return;

    if (gsDuplicateDocId) {
        try {
            const doc = await db.collection('guests').doc(gsDuplicateDocId).get();
            if (doc.exists) {
                const existing = doc.data();
                if (existing.cabinNumber !== gsPendingData.cabinNumber ||
                    existing.groupNumber !== gsPendingData.groupNumber) {
                    gsDuplicateDocId = null;
                }
            } else {
                gsDuplicateDocId = null;
            }
        } catch (e) {
            gsDuplicateDocId = null;
        }
    }

    await gsSaveOrUpdateRecord(gsPendingData, gsDuplicateDocId);
    gsPendingData = null;
    gsDuplicateDocId = null;
}

async function gsSaveOrUpdateRecord(data, docId) {
    try {
        showLoader(true);

        let ref;
        let previousData = null;

        if (docId) {
            const existingDoc = await db.collection('guests').doc(docId).get();
            if (existingDoc.exists) {
                previousData = existingDoc.data();
            }

            const updateData = { ...data };
            if (existingDoc.exists && existingDoc.data().timeReachedTop) {
                updateData.timeReachedTop = existingDoc.data().timeReachedTop;
            } else {
                updateData.timeReachedTop = new Date().toISOString();
            }

            updateData.updatedAt = new Date();
            await db.collection('guests').doc(docId).update(updateData);
            await logAction('guests', docId, 'update', updateData, previousData);

            ref = { id: docId };
            gsCurrentDocId = docId;
            showMessage('gsMessage', '✅ 記錄更新成功！', 'success');

        } else {
            data.timeReachedTop = new Date().toISOString();
            data.createdAt = new Date();
            data.status = data.timeLanded ? 'landed' : 'rescuing';

            const newRef = await db.collection('guests').add(data);
            await logAction('guests', newRef.id, 'create', data, null);

            ref = newRef;
            gsCurrentDocId = newRef.id;
            showMessage('gsMessage', '✅ 記錄建立成功！', 'success');
        }

        const healthStatus = data.healthStatus || '未分類';
        gsGenerateQR(gsCurrentDocId, healthStatus);
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = data.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${data.groupNumber}組`;

        gsClearForm();

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();

    } catch (e) {
        const action = docId ? '更新' : '建立';
        showMessage('gsMessage', `${action}失敗: ` + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ================================================================
// QR / PDF（原有）
// ================================================================
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

async function gsSavePDF() {
    if (!window.gsQrInstance) return alert('請先建立 QR 碼');
    const canvas = document.getElementById('gsQrCode').querySelector('canvas');
    if (!canvas) return alert('無法取得 QR 碼');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();

    pdf.setFontSize(24);
    pdf.text('Guest QR Code Certificate', pw / 2, 25, { align: 'center' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pw - 100) / 2, 40, 100, 100);

    const cabin = document.getElementById('gsPrintCabin').textContent;
    const groupRaw = document.getElementById('gsPrintGroup').textContent || '';
    const group = groupRaw.replace(/第|組|\{|\}/g, '').trim();

    pdf.setFontSize(14);
    pdf.text(`Cabin: ${cabin}`, 30, 160);
    pdf.text(`Group: ${group}`, 30, 175);

    const blob = pdf.output('blob');
    const fileName = `QR_${cabin}_${group}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    const canShareFiles = navigator.canShare && navigator.canShare({ files: [file] });
    if (canShareFiles) {
        try {
            await navigator.share({
                files: [file],
                title: 'Guest QR Code',
                text: `Cabin ${cabin} / Group ${group}`
            });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.warn('分享失敗，改為下載：', err);
        }
    }
    pdf.save(fileName);
}

// ================================================================
// ★ 模式切換
// ================================================================
function gsSwitchMode(mode) {
    if (gsModifyMode && mode !== 'complete') return;

    gsCurrentMode = mode;

    // ★ 切換模式時清空 QR 結果
    const qrEl = document.getElementById('gsQrResult');
    if (qrEl) qrEl.style.display = 'none';
    const qrCodeEl = document.getElementById('gsQrCode');
    if (qrCodeEl) qrCodeEl.innerHTML = '';
    window.gsQrInstance = null;

    document.querySelectorAll('.gs-mode-btn').forEach(btn => btn.classList.remove('active'));
    const btnId = { start: 'gsModeStart', complete: 'gsModeComplete', full: 'gsModeFull' }[mode];
    document.getElementById(btnId)?.classList.add('active');

    const completeFields = document.querySelectorAll('.gs-complete-only');
    const submitBtn = document.getElementById('gsSubmitBtn');
    const banner = document.getElementById('gsModifyBanner');

    if (mode === 'start') {
        completeFields.forEach(el => el.style.display = 'none');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-plus-circle"></i> 開始救援';
        if (banner) banner.style.display = 'none';
        const t = document.getElementById('gsTimeLanded');
        if (t) t.value = '';
    } else if (mode === 'complete') {
        completeFields.forEach(el => el.style.display = 'block');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-flag-checkered"></i> 完成救援';
        if (banner && gsModifyMode) banner.style.display = 'flex';
    } else {
        completeFields.forEach(el => el.style.display = 'block');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> 建立/更新記錄';
        if (banner) banner.style.display = 'none';
    }

    const startBtn = document.getElementById('gsModeStart');
    const fullBtn = document.getElementById('gsModeFull');
    if (startBtn) startBtn.disabled = gsModifyMode;
    if (fullBtn) fullBtn.disabled = gsModifyMode;
}

function gsSubmit() {
    if (gsModifyMode) return gsApplyModify();
    if (gsCurrentMode === 'start') return gsStartRescue();
    if (gsCurrentMode === 'complete') return gsCompleteRescue();
    return gsCreateRecord();
}

// ================================================================
// ★ 開始救援
// ================================================================
async function gsStartRescue() {
    // ★ 清空上一次的 QR
    const qrEl = document.getElementById('gsQrResult');
    if (qrEl) qrEl.style.display = 'none';
    const qrCodeEl = document.getElementById('gsQrCode');
    if (qrCodeEl) qrCodeEl.innerHTML = '';
    window.gsQrInstance = null;

    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;

    if (!cabin || !group) {
        showMessage('gsMessage', '請填寫車廂和組別', 'error');
        return;
    }

    try {
        showLoader(true);
        const dup = await db.collection('guests')
            .where('cabinNumber', '==', cabin)
            .where('groupNumber', '==', group)
            .get();

        if (dup.empty) {
            await gsSaveStartRescue(cabin, group, null);
            return;
        }

        const doc = dup.docs[0];
        const existing = doc.data();
        const hasReached = !!existing.timeReachedTop;
        const hasLanded = !!existing.timeLanded;

        if (hasReached && hasLanded) {
            gsPendingData = { cabin, group, docId: doc.id };
            gsOverwritePendingDocId = doc.id;
            showGsOverwriteModal(doc.id, existing);
            return;
        }

        if (hasReached && !hasLanded) {
            gsPendingData = { cabin, group, docId: doc.id };
            gsOverwritePendingDocId = doc.id;
            showGsOngoingModal(doc.id, existing);
            return;
        }

        if (!hasReached && hasLanded) {
            gsPendingData = { cabin, group, docId: doc.id };
            showGsManualTimeModal('missing_start');
            return;
        }

        await gsSaveStartRescue(cabin, group, null);

    } catch (e) {
        showMessage('gsMessage', '開始救援失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

async function gsSaveStartRescue(cabin, group, docId) {
    const now = new Date();
    const nowISO = now.toISOString();

    if (docId) {
        const existingDoc = await db.collection('guests').doc(docId).get();
        const existing = existingDoc.exists ? existingDoc.data() : {};

        const updateData = {
            ...existing,
            timeReachedTop: nowISO,
            timeLanded: null,
            exitTime: null,
            exitMethod: null,
            rescuedBy: '',
            status: 'rescuing',
            updatedAt: now
        };

        await db.collection('guests').doc(docId).update(updateData);
        await logAction('guests', docId, 'update', updateData, existing);
        showMessage('gsMessage', '✅ 已覆蓋並開始新救援', 'success');
    } else {
        const data = {
            cabinNumber: cabin,
            groupNumber: group,
            timeReachedTop: nowISO,
            timeLanded: null,
            rescuedBy: '',
            remarks: '',
            status: 'rescuing',
            createdAt: now,
            updatedAt: now
        };
        const ref = await db.collection('guests').add(data);
        await logAction('guests', ref.id, 'create', data, null);
        showMessage('gsMessage', '✅ 已開始救援', 'success');
    }

    if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    if (typeof dbLoadRecords === 'function') dbLoadRecords();

    document.getElementById('gsCabinNumber').value = '';
    document.getElementById('gsGroupNumber').value = '';
}

// ================================================================
// ★ 完成救援
// ================================================================
async function gsCompleteRescue() {
    // ★ 清空上一次的 QR
    const qrEl = document.getElementById('gsQrResult');
    if (qrEl) qrEl.style.display = 'none';
    const qrCodeEl = document.getElementById('gsQrCode');
    if (qrCodeEl) qrCodeEl.innerHTML = '';
    window.gsQrInstance = null;

    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;
    const timeLanded = document.getElementById('gsTimeLanded').value;

    if (!cabin || !group) {
        showMessage('gsMessage', '請填寫車廂和組別', 'error');
        return;
    }
    if (!timeLanded) {
        showMessage('gsMessage', '請填寫完成救援時間', 'error');
        return;
    }

    try {
        showLoader(true);
        const dup = await db.collection('guests')
            .where('cabinNumber', '==', cabin)
            .where('groupNumber', '==', group)
            .get();

        if (dup.empty) {
            gsPendingData = {
                cabin, group, timeLanded,
                formData: gsCollectCompleteFields()
            };
            showGsManualTimeModal('no_record');
            return;
        }

        const doc = dup.docs[0];
        const existing = doc.data();
        const hasReached = !!existing.timeReachedTop;
        const hasLanded = !!existing.timeLanded;

        // ★★★ 優先判斷：進行中（status === 'rescuing'）直接更新
        if (existing.status === 'rescuing') {
            await gsSaveCompleteRescue(doc.id, cabin, group, timeLanded, existing);
            return;
        }

        // 已有完整記錄（且非進行中）→ 2 選項
        if (hasReached && hasLanded) {
            gsPendingData = {
                cabin, group, timeLanded,
                formData: gsCollectCompleteFields(),
                docId: doc.id
            };
            gsOverwritePendingDocId = doc.id;
            showGsOverwriteModal(doc.id, existing);
            return;
        }

        // 有開始、無完成 → 正常更新
        if (hasReached && !hasLanded) {
            await gsSaveCompleteRescue(doc.id, cabin, group, timeLanded, existing);
            return;
        }

        // 有完成、無開始 → 手動補填開始時間
        if (!hasReached && hasLanded) {
            gsPendingData = {
                cabin, group, timeLanded,
                formData: gsCollectCompleteFields(),
                docId: doc.id
            };
            showGsManualTimeModal('missing_start');
            return;
        }

        // 理論上不會到這
        await gsSaveCompleteRescue(doc.id, cabin, group, timeLanded, existing);

    } catch (e) {
        showMessage('gsMessage', '完成救援失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

function gsCollectCompleteFields() {
    let contact = document.getElementById('gsContactNumber').value.trim();
    const other = document.getElementById('gsOtherContactInput')?.value.trim();
    if (other) contact = other;
    if (!contact) contact = '未提供';

    let rescuedBy = document.getElementById('gsRescuedBy').value;
    if (rescuedBy === '其他') {
        rescuedBy = document.getElementById('gsOtherRescuerInput').value.trim();
    }

    return {
        guestName: document.getElementById('gsGuestName').value.trim(),
        contactNumber: contact,
        gender: document.getElementById('gsGender').value,
        ageRange: document.getElementById('gsAgeRange').value,
        healthStatus: document.getElementById('gsHealthStatus').value,
        rescuedBy: rescuedBy || '',
        remarks: document.getElementById('gsRemarks').value.trim()
    };
}
function gsClearQrResult() {
    const qrEl = document.getElementById('gsQrResult');
    if (qrEl) qrEl.style.display = 'none';
    const qrCodeEl = document.getElementById('gsQrCode');
    if (qrCodeEl) qrCodeEl.innerHTML = '';
    window.gsQrInstance = null;
}
async function gsSaveCompleteRescue(docId, cabin, group, timeLanded, existing, manualTimeReachedTop) {
    const now = new Date();
    const formData = gsCollectCompleteFields();

    const updateData = {
        cabinNumber: cabin,
        groupNumber: group,
        ...formData,
        timeLanded: timeLanded,
        status: 'landed',
        updatedAt: now
    };

    if (manualTimeReachedTop) {
        updateData.timeReachedTop = manualTimeReachedTop;
    }

    await db.collection('guests').doc(docId).update(updateData);
    await logAction('guests', docId, 'update', updateData, existing || null);

    gsGenerateQR(docId, formData.healthStatus || '未分類');
    document.getElementById('gsQrResult').style.display = 'block';
    document.getElementById('gsPrintCabin').textContent = cabin;
    document.getElementById('gsPrintGroup').textContent = `第${group}組`;

    showMessage('gsMessage', '✅ 已完成救援', 'success');

    if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    if (typeof dbLoadRecords === 'function') dbLoadRecords();

    gsClearForm();
}

function gsClearForm() {
    document.getElementById('gsCabinNumber').value = '';
    document.getElementById('gsGroupNumber').value = '';
    const elName = document.getElementById('gsGuestName');
    if (elName) elName.value = '';
    const elContact = document.getElementById('gsContactNumber');
    if (elContact) elContact.value = '';
    const elGender = document.getElementById('gsGender');
    if (elGender) elGender.value = '';
    const elAge = document.getElementById('gsAgeRange');
    if (elAge) elAge.value = '';
    const elHealth = document.getElementById('gsHealthStatus');
    if (elHealth) elHealth.value = '未能分類';
    const elLanded = document.getElementById('gsTimeLanded');
    if (elLanded) elLanded.value = '';
    const elSms = document.getElementById('gsSmsOnly');
    if (elSms) elSms.checked = false;
    const elRescued = document.getElementById('gsRescuedBy');
    if (elRescued) elRescued.value = '';
    const elOtherRescuer = document.getElementById('gsOtherRescuerInput');
    if (elOtherRescuer) elOtherRescuer.value = '';
    const elOtherRescuerContainer = document.getElementById('gsOtherRescuerContainer');
    if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'none';
    const elRemarks = document.getElementById('gsRemarks');
    if (elRemarks) elRemarks.value = '';
}

// ================================================================
// ★ Modal 顯示
// ================================================================
function showGsOverwriteModal(docId, existing) {
    const infoEl = document.getElementById('gsOverwriteInfo');
    const reached = existing.timeReachedTop
        ? new Date(existing.timeReachedTop).toLocaleString('zh-TW')
        : '—';
    const landed = existing.timeLanded
        ? new Date(existing.timeLanded).toLocaleString('zh-TW')
        : '—';

    infoEl.innerHTML = `
        <div>車廂：${existing.cabinNumber || '-'}</div>
        <div>組別：第 ${existing.groupNumber || '-'} 組</div>
        <div>開始時間：${reached}</div>
        <div>完成時間：${landed}</div>
    `;
    document.getElementById('gsOverwriteModal').style.display = 'flex';
}

function showGsOngoingModal(docId, existing) {
    const infoEl = document.getElementById('gsOngoingInfo');
    const reached = existing.timeReachedTop
        ? new Date(existing.timeReachedTop).toLocaleString('zh-TW')
        : '—';

    infoEl.innerHTML = `
        <div>車廂：${existing.cabinNumber || '-'}</div>
        <div>組別：第 ${existing.groupNumber || '-'} 組</div>
        <div>開始時間：${reached}</div>
    `;
    document.getElementById('gsOngoingModal').style.display = 'flex';
}

function showGsManualTimeModal(scenario) {
    const titleEl = document.getElementById('gsManualTimeTitle');
    const msgEl = document.getElementById('gsManualTimeMessage');

    if (scenario === 'missing_start') {
        titleEl.textContent = '⚠️ 缺少開始救援時間';
        msgEl.textContent = '此記錄有完成時間但沒有開始時間，請補填開始救援時間：';
    } else if (scenario === 'no_record') {
        titleEl.textContent = '找不到對應記錄';
        msgEl.textContent = '找不到此車廂 + 組別的記錄，請手動輸入開始救援時間：';
    } else if (scenario === 'fullrestart') {
        titleEl.textContent = '完全重新記錄';
        msgEl.textContent = '請輸入新的開始救援時間（會完全覆蓋舊記錄）：';
    }

    document.getElementById('gsManualTimeReachedTop').value = '';
    document.getElementById('gsManualTimeModal').style.display = 'flex';
}

function gsCancelOverwrite() {
    document.getElementById('gsOverwriteModal').style.display = 'none';
    document.getElementById('gsOngoingModal').style.display = 'none';
    gsOverwritePendingDocId = null;
    gsPendingData = null;
}

// ================================================================
// ★ 修改內容 / 完全重新記錄
// ================================================================
async function gsChooseModify() {
    document.getElementById('gsOverwriteModal').style.display = 'none';
    if (!gsOverwritePendingDocId) return;

    const docId = gsOverwritePendingDocId;
    try {
        showLoader(true);
        const doc = await db.collection('guests').doc(docId).get();
        if (!doc.exists) {
            showMessage('gsMessage', '找不到記錄', 'error');
            return;
        }
        gsEnterModifyMode(docId, doc.data());
    } catch (e) {
        showMessage('gsMessage', '進入修改模式失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
        gsOverwritePendingDocId = null;
        gsPendingData = null;
    }
}

function gsEnterModifyMode(docId, data) {
    gsModifyMode = true;
    gsModifyDocId = docId;

    gsSwitchMode('complete');

    document.getElementById('gsCabinNumber').value = data.cabinNumber || '';
    document.getElementById('gsGroupNumber').value = data.groupNumber || '';
    const elName = document.getElementById('gsGuestName');
    if (elName) elName.value = data.guestName || '';
    const elContact = document.getElementById('gsContactNumber');
    if (elContact) elContact.value = data.contactNumber || '';
    const elGender = document.getElementById('gsGender');
    if (elGender) elGender.value = data.gender || '';
    const elAge = document.getElementById('gsAgeRange');
    if (elAge) elAge.value = data.ageRange || '';
    const elHealth = document.getElementById('gsHealthStatus');
    if (elHealth) elHealth.value = data.healthStatus || '未能分類';

    const elRescued = document.getElementById('gsRescuedBy');
    const elOtherRescuer = document.getElementById('gsOtherRescuerInput');
    const elOtherRescuerContainer = document.getElementById('gsOtherRescuerContainer');
    const knownRescuers = ['消防員', '民安隊', '警察', 'NP360職員'];
    if (elRescued) {
        if (data.rescuedBy && knownRescuers.includes(data.rescuedBy)) {
            elRescued.value = data.rescuedBy;
            if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'none';
        } else if (data.rescuedBy) {
            elRescued.value = '其他';
            if (elOtherRescuer) elOtherRescuer.value = data.rescuedBy;
            if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'block';
        } else {
            elRescued.value = '';
            if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'none';
        }
    }

    const elRemarks = document.getElementById('gsRemarks');
    if (elRemarks) elRemarks.value = data.remarks || '';

    const elLanded = document.getElementById('gsTimeLanded');
    if (elLanded && data.timeLanded) {
        try {
            const d = data.timeLanded.toDate ? data.timeLanded.toDate() : new Date(data.timeLanded);
            const pad = (n) => String(n).padStart(2, '0');
            elLanded.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (e) {
            elLanded.value = '';
        }
    }

    const banner = document.getElementById('gsModifyBanner');
    if (banner) {
        banner.style.display = 'flex';
        banner.querySelector('.gs-modify-text').textContent =
            `✏️ 正在修改記錄（車廂 ${data.cabinNumber} 第 ${data.groupNumber} 組）`;
    }

    const startBtn = document.getElementById('gsModeStart');
    const fullBtn = document.getElementById('gsModeFull');
    if (startBtn) startBtn.disabled = true;
    if (fullBtn) fullBtn.disabled = true;

    document.getElementById('gsSubmitBtn').innerHTML = '<i class="fas fa-save"></i> 儲存修改';
}

function gsExitModifyMode() {
    gsModifyMode = false;
    gsModifyDocId = null;

    const banner = document.getElementById('gsModifyBanner');
    if (banner) banner.style.display = 'none';

    const startBtn = document.getElementById('gsModeStart');
    const fullBtn = document.getElementById('gsModeFull');
    if (startBtn) startBtn.disabled = false;
    if (fullBtn) fullBtn.disabled = false;

    gsClearForm();
    gsSwitchMode('start');
}

async function gsApplyModify() {
    if (!gsModifyMode || !gsModifyDocId) return;

    const timeLanded = document.getElementById('gsTimeLanded').value;
    if (!timeLanded) {
        showMessage('gsMessage', '請填寫完成救援時間', 'error');
        return;
    }

    try {
        showLoader(true);
        const existing = (await db.collection('guests').doc(gsModifyDocId).get()).data();
        const formData = gsCollectCompleteFields();

        const updateData = {
            cabinNumber: document.getElementById('gsCabinNumber').value.trim(),
            groupNumber: document.getElementById('gsGroupNumber').value,
            ...formData,
            timeLanded,
            status: 'landed',
            updatedAt: new Date()
        };

        // 修改模式：沒填 rescuedBy / remarks → 保留舊值
        if (!updateData.rescuedBy && existing.rescuedBy) {
            updateData.rescuedBy = existing.rescuedBy;
        }
        if (!updateData.remarks && existing.remarks) {
            updateData.remarks = existing.remarks;
        }

        await db.collection('guests').doc(gsModifyDocId).update(updateData);
        await logAction('guests', gsModifyDocId, 'update', updateData, existing);

        gsGenerateQR(gsModifyDocId, formData.healthStatus || '未分類');
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = updateData.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${updateData.groupNumber}組`;

        showMessage('gsMessage', '✅ 已儲存修改', 'success');

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();

        gsExitModifyMode();

    } catch (e) {
        showMessage('gsMessage', '修改失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

async function gsChooseFullRestart() {
    document.getElementById('gsOverwriteModal').style.display = 'none';
    if (!gsPendingData || !gsOverwritePendingDocId) return;
    gsPendingData.mode = 'fullrestart';
    showGsManualTimeModal('fullrestart');
}

async function gsConfirmOngoingOverwrite() {
    document.getElementById('gsOngoingModal').style.display = 'none';
    if (!gsPendingData || !gsOverwritePendingDocId) return;

    const docId = gsOverwritePendingDocId;
    const { cabin, group } = gsPendingData;

    try {
        showLoader(true);
        await gsSaveStartRescue(cabin, group, docId);
    } catch (e) {
        showMessage('gsMessage', '覆蓋失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
        gsOverwritePendingDocId = null;
        gsPendingData = null;
    }
}

function gsCancelManualTime() {
    document.getElementById('gsManualTimeModal').style.display = 'none';
    gsPendingData = null;
}

async function gsConfirmManualTime() {
    const manualTime = document.getElementById('gsManualTimeReachedTop').value;
    if (!manualTime) {
        alert('請輸入開始救援時間');
        return;
    }

    if (!gsPendingData) return;

    const { cabin, group, timeLanded, docId, formData, mode } = gsPendingData;
    document.getElementById('gsManualTimeModal').style.display = 'none';

    try {
        showLoader(true);

        if (mode === 'fullrestart') {
            const existing = (await db.collection('guests').doc(docId).get()).data();
            const currentFormData = gsCollectCompleteFields();
            const currentTimeLanded = document.getElementById('gsTimeLanded').value;

            const updateData = {
                cabinNumber: cabin,
                groupNumber: group,
                timeReachedTop: manualTime,
                timeLanded: currentTimeLanded || null,
                ...currentFormData,
                status: currentTimeLanded ? 'landed' : 'rescuing',
                updatedAt: new Date()
            };

            await db.collection('guests').doc(docId).update(updateData);
            await logAction('guests', docId, 'update', updateData, existing);

            if (currentTimeLanded) {
                gsGenerateQR(docId, updateData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
            }

            showMessage('gsMessage', '✅ 已完全重新記錄', 'success');

        } else if (docId) {
            const existing = (await db.collection('guests').doc(docId).get()).data();
            const updateData = {
                ...existing,
                timeReachedTop: manualTime,
                ...(formData || {}),
                ...(timeLanded ? { timeLanded } : {}),
                status: timeLanded ? 'landed' : (existing.status || 'rescuing'),
                updatedAt: new Date()
            };
            await db.collection('guests').doc(docId).update(updateData);
            await logAction('guests', docId, 'update', updateData, existing);

            if (timeLanded) {
                gsGenerateQR(docId, updateData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
            }

            showMessage('gsMessage', '✅ 已補填開始時間', 'success');

        } else {
            const newData = {
                cabinNumber: cabin,
                groupNumber: group,
                timeReachedTop: manualTime,
                timeLanded: timeLanded || null,
                status: timeLanded ? 'landed' : 'rescuing',
                createdAt: new Date(),
                updatedAt: new Date(),
                ...(formData || {})
            };
            const ref = await db.collection('guests').add(newData);
            await logAction('guests', ref.id, 'create', newData, null);

            if (timeLanded) {
                gsGenerateQR(ref.id, newData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
            }

            showMessage('gsMessage', '✅ 已建立記錄', 'success');
        }

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();

        gsClearForm();

    } catch (e) {
        showMessage('gsMessage', '失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
        gsPendingData = null;
    }
}

// ================================================================
// ★ Banner：進行中救援
// ================================================================
function gsInitOngoingListener() {
    if (_gsOngoingUnsub) _gsOngoingUnsub();
    _gsOngoingUnsub = db.collection('guests')
        .where('status', '==', 'rescuing')
        .onSnapshot(snap => {
            const list = [];
            snap.forEach(d => {
                const data = d.data();
                // ★ 過濾：有完成救援時間的不顯示
                if (!data.timeLanded) {
                    list.push({ id: d.id, ...data });
                }
            });
            gsRenderOngoingBanner(list);
        }, err => console.warn('banner 監聽失敗:', err));
}

function gsRenderOngoingBanner(list) {
    const banner = document.getElementById('gsOngoingBanner');
    const listEl = document.getElementById('gsOngoingList');
    const countEl = document.getElementById('gsOngoingCount');
    if (!banner || !listEl || !countEl) return;

    if (list.length === 0) {
        banner.style.display = 'none';
        return;
    }

    banner.style.display = 'block';
    countEl.textContent = list.length;

    list.sort((a, b) => new Date(a.timeReachedTop) - new Date(b.timeReachedTop));

    listEl.innerHTML = '';
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'gs-ongoing-item';
        const startTime = item.timeReachedTop
            ? new Date(item.timeReachedTop).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
            : '—';
        div.innerHTML = `
            <span>🚠 車廂 ${item.cabinNumber} 第 ${item.groupNumber} 組（開始於 ${startTime}）</span>
            <button onclick="gsOpenCompleteFromBanner('${item.id}')">完成</button>
        `;
        listEl.appendChild(div);
    });
}

function gsOpenCompleteFromBanner(docId) {
    db.collection('guests').doc(docId).get().then(doc => {
        if (!doc.exists) return;
        const data = doc.data();

        // ★ 清空上一次的 QR 結果
        const qrEl = document.getElementById('gsQrResult');
        if (qrEl) qrEl.style.display = 'none';
        const qrCodeEl = document.getElementById('gsQrCode');
        if (qrCodeEl) qrCodeEl.innerHTML = '';
        window.gsQrInstance = null;

        gsSwitchMode('complete');

        const elCabin = document.getElementById('gsCabinNumber');
        const elGroup = document.getElementById('gsGroupNumber');
        if (elCabin) elCabin.value = data.cabinNumber || '';
        if (elGroup) elGroup.value = data.groupNumber || '';

        const elName = document.getElementById('gsGuestName');
        if (elName) elName.value = data.guestName || '';
        const elContact = document.getElementById('gsContactNumber');
        if (elContact) elContact.value = data.contactNumber || '';
        const elGender = document.getElementById('gsGender');
        if (elGender) elGender.value = data.gender || '';
        const elAge = document.getElementById('gsAgeRange');
        if (elAge) elAge.value = data.ageRange || '';
        const elHealth = document.getElementById('gsHealthStatus');
        if (elHealth) elHealth.value = data.healthStatus || '未能分類';

        const elRescued = document.getElementById('gsRescuedBy');
        const elOtherRescuer = document.getElementById('gsOtherRescuerInput');
        const elOtherRescuerContainer = document.getElementById('gsOtherRescuerContainer');
        const knownRescuers = ['消防員', '民安隊', '警察', 'NP360職員'];
        if (elRescued) {
            if (data.rescuedBy && knownRescuers.includes(data.rescuedBy)) {
                elRescued.value = data.rescuedBy;
                if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'none';
            } else if (data.rescuedBy) {
                elRescued.value = '其他';
                if (elOtherRescuer) elOtherRescuer.value = data.rescuedBy;
                if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'block';
            } else {
                elRescued.value = '';
                if (elOtherRescuerContainer) elOtherRescuerContainer.style.display = 'none';
            }
        }

        const elRemarks = document.getElementById('gsRemarks');
        if (elRemarks) elRemarks.value = data.remarks || '';

        // ★ 若舊記錄有 timeLanded，帶入表單
        const elLanded = document.getElementById('gsTimeLanded');
        if (elLanded) {
            if (data.timeLanded) {
                try {
                    const d = data.timeLanded.toDate ? data.timeLanded.toDate() : new Date(data.timeLanded);
                    const pad = (n) => String(n).padStart(2, '0');
                    elLanded.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                } catch (e) {
                    elLanded.value = '';
                }
            } else {
                elLanded.value = '';
            }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ================================================================
// 初始化
// ================================================================
function initGroundSupport() {
    console.log('✅ Ground Support 初始化完成');
    const msgEl = document.getElementById('gsMessage');
    if (msgEl) msgEl.className = 'message';
    const qrEl = document.getElementById('gsQrResult');
    if (qrEl) qrEl.style.display = 'none';
    const dupEl = document.getElementById('gsDuplicateWarning');
    if (dupEl) dupEl.style.display = 'none';

    gsModifyMode = false;
    gsModifyDocId = null;
    gsSwitchMode('start');
    gsInitOngoingListener();
}

// ================================================================
// 全域暴露
// ================================================================
window.setGsContact = setGsContact;
window.toggleGsOtherContact = toggleGsOtherContact;
window.toggleGsSmsSuffix = toggleGsSmsSuffix;
window.toggleGsOtherRescuer = toggleGsOtherRescuer;
window.gsCreateRecord = gsCreateRecord;
window.gsCancelDuplicate = gsCancelDuplicate;
window.gsCreateAnyway = gsCreateAnyway;
window.gsSavePDF = gsSavePDF;
window.initGroundSupport = initGroundSupport;

window.gsSwitchMode = gsSwitchMode;
window.gsSubmit = gsSubmit;
window.gsStartRescue = gsStartRescue;
window.gsCompleteRescue = gsCompleteRescue;
window.gsCancelOverwrite = gsCancelOverwrite;
window.gsChooseModify = gsChooseModify;
window.gsChooseFullRestart = gsChooseFullRestart;
window.gsConfirmOngoingOverwrite = gsConfirmOngoingOverwrite;
window.gsCancelManualTime = gsCancelManualTime;
window.gsConfirmManualTime = gsConfirmManualTime;
window.gsOpenCompleteFromBanner = gsOpenCompleteFromBanner;
window.gsExitModifyMode = gsExitModifyMode;

console.log('✅ gs.js 已載入 (含新模式)');
