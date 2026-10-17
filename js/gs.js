// ================================================================
// Ground Support 模組（完整版）
// - 三模式：開始救援 / 完成救援 / 修改記錄
// - 第一層：前端鎖 _gsSubmitting
// - 第二層：固定 ID guest_{車廂}_{組別}
// - 離線優化：withTimeout + set(merge)
// ================================================================

let gsCurrentDocId = null;
let gsPendingData = null;
let gsDuplicateDocId = null;

let gsCurrentMode = 'start';
let gsModifyMode = false;
let gsModifyDocId = null;
let gsOverwritePendingDocId = null;

let _gsAutoLookupTimer = null;
let _gsSubmitting = false;

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
// 修改模式：自動查詢
// ================================================================
function gsOnCabinOrGroupChange() {
    if (!gsModifyMode) return;
    if (_gsAutoLookupTimer) clearTimeout(_gsAutoLookupTimer);
    _gsAutoLookupTimer = setTimeout(() => {
        _gsAutoLookupTimer = null;
        gsAutoLookupRecord();
    }, 500);
}

async function gsAutoLookupRecord() {
    if (!gsModifyMode) return;

    const cabin = document.getElementById('gsCabinNumber').value.trim();
    const group = document.getElementById('gsGroupNumber').value;
    if (!cabin || !group) return;

    try {
        // ★ 優先固定 ID
        let doc = null;
        const fixedId = window.makeGuestDocId(cabin, group);
        if (fixedId) {
            const fixedSnap = await withTimeout(
                db.collection('guests').doc(fixedId).get({ source: 'default' }),
                2000,
                null
            );
            if (fixedSnap && fixedSnap.exists) doc = fixedSnap;
        }

        // 回退查詢
        if (!doc) {
            const snap = await withTimeout(
                db.collection('guests')
                    .where('cabinNumber', '==', cabin)
                    .where('groupNumber', '==', group)
                    .get({ source: 'default' }),
                2000,
                null
            );
            if (!snap) return;
            if (snap.empty) {
                console.log('🔍 修改模式查詢：找不到', cabin, '第', group, '組');
                return;
            }
            doc = snap.docs[0];
        }

        const data = doc.data();
        gsModifyDocId = doc.id;
        gsFillFormFromRecord(data, { keepCabinGroup: true });

        const banner = document.getElementById('gsModifyBanner');
        if (banner) {
            banner.querySelector('.gs-modify-text').textContent =
                `✏️ 正在修改記錄（車廂 ${data.cabinNumber} 第 ${data.groupNumber} 組）`;
        }
        console.log('✅ 修改模式：已載入記錄', doc.id);
    } catch (e) {
        console.warn('自動查詢失敗:', e);
    }
}

function gsFillFormFromRecord(data, options = {}) {
    const keepCabinGroup = options.keepCabinGroup === true;

    if (!keepCabinGroup) {
        document.getElementById('gsCabinNumber').value = data.cabinNumber || '';
        document.getElementById('gsGroupNumber').value = data.groupNumber || '';
    }

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
            if (elOtherRescuer) elOtherRescuer.value = '';
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
}

function gsClearFormForModify() {
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
// 完整表單模式：gsCreateRecord
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
        // ★ 優先固定 ID
        const fixedId = window.makeGuestDocId(cabin, group);
        if (fixedId) {
            const fixedSnap = await withTimeout(
                db.collection('guests').doc(fixedId).get({ source: 'default' }),
                2000,
                null
            );
            if (fixedSnap && fixedSnap.exists) {
                gsDuplicateDocId = fixedId;
                gsShowDuplicateWarning([fixedSnap]);
                return;
            }
        }

        // 回退查詢
        const dup = await withTimeout(
            db.collection('guests')
                .where('cabinNumber', '==', cabin)
                .where('groupNumber', '==', group)
                .get({ source: 'default' }),
            2000,
            null
        );

        if (!dup || dup.empty) {
            gsDuplicateDocId = null;
            await gsSaveOrUpdateRecord(data, null);
            return;
        }

        gsDuplicateDocId = dup.docs[0].id;
        gsShowDuplicateWarning(dup.docs);

    } catch (e) {
        showMessage('gsMessage', '檢查重複失敗: ' + e.message, 'error');
    }
}

function gsShowDuplicateWarning(docs) {
    const list = document.getElementById('gsDuplicateList');
    list.innerHTML = '';
    docs.forEach(doc => {
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
}

function gsScrollToQr() {
    setTimeout(() => {
        const qrEl = document.getElementById('gsQrResult');
        if (qrEl && qrEl.style.display !== 'none') {
            qrEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 200);
}

function gsCancelDuplicate() {
    document.getElementById('gsDuplicateWarning').style.display = 'none';
    gsPendingData = null;
    gsDuplicateDocId = null;
}

async function gsCreateAnyway() {
    if (_gsSubmitting) return;
    _gsSubmitting = true;
    try {
        document.getElementById('gsDuplicateWarning').style.display = 'none';
        if (!gsPendingData) return;
        await gsSaveOrUpdateRecord(gsPendingData, gsDuplicateDocId);
        gsPendingData = null;
        gsDuplicateDocId = null;
    } finally {
        _gsSubmitting = false;
    }
}

async function gsSaveOrUpdateRecord(data, docId) {
    try {
        showLoader(true);

        // 若無 docId，嘗試用固定 ID
        if (!docId) {
            const fixedId = window.makeGuestDocId(data.cabinNumber, data.groupNumber);
            if (fixedId) {
                const fixedSnap = await withTimeout(
                    db.collection('guests').doc(fixedId).get({ source: 'default' }),
                    2000,
                    null
                );
                if (fixedSnap && fixedSnap.exists) {
                    docId = fixedId;
                    console.log('🔁 固定 ID 已存在，改用更新:', fixedId);
                }
            }
        }

        let previousData = null;

        if (docId) {
            // 讀取舊資料（加超時）
            const existingSnap = await withTimeout(
                db.collection('guests').doc(docId).get({ source: 'default' }),
                2000,
                null
            );

            const updateData = { ...data };
            if (existingSnap && existingSnap.exists) {
                previousData = existingSnap.data();
                updateData.timeReachedTop = previousData.timeReachedTop || new Date().toISOString();
            } else {
                updateData.timeReachedTop = new Date().toISOString();
            }

            updateData.updatedAt = new Date();
            await db.collection('guests').doc(docId).set(updateData, { merge: true });
            await logAction('guests', docId, 'update', updateData, previousData);

            gsCurrentDocId = docId;
            showMessage('gsMessage', '✅ 記錄更新成功！', 'success');

        } else {
            data.timeReachedTop = new Date().toISOString();
            data.createdAt = new Date();
            data.status = data.timeLanded ? 'landed' : 'rescuing';

            const fixedId = window.makeGuestDocId(data.cabinNumber, data.groupNumber);
            if (!fixedId) throw new Error('無法產生文件 ID（車廂或組別為空）');

            await db.collection('guests').doc(fixedId).set(data);
            await logAction('guests', fixedId, 'create', data, null);

            gsCurrentDocId = fixedId;
            showMessage('gsMessage', '✅ 記錄建立成功！', 'success');
        }

        const healthStatus = data.healthStatus || '未分類';
        gsGenerateQR(gsCurrentDocId, healthStatus);
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = data.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${data.groupNumber}組`;
        gsScrollToQr();

        gsClearForm();

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function' && document.getElementById('dbTableBody')) {
            dbLoadRecords();
        }

    } catch (e) {
        showMessage('gsMessage', (docId ? '更新' : '建立') + '失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// ================================================================
// QR / PDF
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
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();

    const cabin = document.getElementById('gsPrintCabin').textContent;
    const groupRaw = document.getElementById('gsPrintGroup').textContent || '';
    const group = groupRaw.replace(/第|組|\{|\}/g, '').trim();

    const qrSize = 195;
    const qrX = (pw - qrSize) / 2;
    const qrY = 5;

    pdf.setFontSize(9);
    pdf.text('Guest QR Code Certificate', pw / 2, 3.5, { align: 'center' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', qrX, qrY, qrSize, qrSize);
    pdf.setFontSize(10);
    pdf.text(`Cabin: ${cabin}    Group: ${group}`, pw / 2, 205, { align: 'center' });

    const blob = pdf.output('blob');
    const fileName = `QR_${cabin}_${group}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    const canShareFiles = navigator.canShare && navigator.canShare({ files: [file] });
    if (canShareFiles) {
        try {
            await navigator.share({ files: [file], title: 'Guest QR Code', text: `Cabin ${cabin} / Group ${group}` });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            console.warn('分享失敗，改為下載：', err);
        }
    }
    pdf.save(fileName);
}

// ================================================================
// 模式切換
// ================================================================
function gsSwitchMode(mode) {
    if (gsModifyMode && mode !== 'complete' && mode !== 'full') return;

    gsCurrentMode = mode;

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

        gsModifyMode = true;
        gsModifyDocId = null;

        if (banner) {
            banner.style.display = 'flex';
            banner.querySelector('.gs-modify-text').textContent = '✏️ 請輸入車廂 + 組別以載入記錄';
        }
        gsClearFormForModify();
    }

    const startBtn = document.getElementById('gsModeStart');
    const fullBtn = document.getElementById('gsModeFull');
    if (startBtn) startBtn.disabled = gsModifyMode;
    if (fullBtn) fullBtn.disabled = gsModifyMode;
}

function gsSubmit() {
    if (_gsSubmitting) {
        console.warn('⏳ 上一個操作仍在進行中，忽略此次點擊');
        return;
    }

    const run = async () => {
        _gsSubmitting = true;
        const btn = document.getElementById('gsSubmitBtn');
        const originalHtml = btn ? btn.innerHTML : null;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 處理中...';
        }

        // ★★★ 安全超時：10 秒後強制解鎖，防止任何卡住 ★★★
        const safetyTimer = setTimeout(() => {
            console.warn('🚨 [安全機制] 操作超過 10 秒，強制解鎖按鈕（可能離線中）');
            _gsSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
            try { hideLoader(); } catch (e) {}
        }, 10000);

        try {
            if (gsModifyMode) return await gsApplyModify();
            if (gsCurrentMode === 'start') return await gsStartRescue();
            if (gsCurrentMode === 'complete') return await gsCompleteRescue();
            return await gsCreateRecord();
        } finally {
            clearTimeout(safetyTimer);
            _gsSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    };

    run();
}

// ================================================================
// 開始救援
// ================================================================
async function gsStartRescue() {
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
        console.log('🔍 [gsStartRescue] 開始，車廂:', cabin, '組別:', group);

        // 優先固定 ID
        const fixedId = window.makeGuestDocId(cabin, group);
        console.log('🔍 [gsStartRescue] fixedId:', fixedId);
        if (fixedId) {
            console.log('🔍 [gsStartRescue] 讀取固定 ID（最多等 2 秒）...');
            const fixedSnap = await withTimeout(
                db.collection('guests').doc(fixedId).get({ source: 'default' }),
                2000,
                null
            );
            console.log('🔍 [gsStartRescue] 固定 ID 讀取完成:', fixedSnap ? 'found' : 'timeout');
            if (fixedSnap && fixedSnap.exists) {
                const existing = fixedSnap.data();
                const hasReached = !!existing.timeReachedTop;
                const hasLanded = !!existing.timeLanded;

                if (hasReached && hasLanded) {
                    gsPendingData = { cabin, group, docId: fixedId };
                    gsOverwritePendingDocId = fixedId;
                    showGsOverwriteModal(fixedId, existing);
                    return;
                }
                if (hasReached && !hasLanded) {
                    gsPendingData = { cabin, group, docId: fixedId };
                    gsOverwritePendingDocId = fixedId;
                    showGsOngoingModal(fixedId, existing);
                    return;
                }
                if (!hasReached && hasLanded) {
                    gsPendingData = { cabin, group, docId: fixedId };
                    showGsManualTimeModal('missing_start');
                    return;
                }
            }
        }

        // 回退查詢
        // 回退查詢
        console.log('🔍 [gsStartRescue] 回退查詢（最多等 2 秒）...');
        const dup = await withTimeout(
            db.collection('guests')
                .where('cabinNumber', '==', cabin)
                .where('groupNumber', '==', group)
                .get({ source: 'default' }),
            2000,
            null
        );
        console.log('🔍 [gsStartRescue] 回退查詢完成:', dup ? 'found' : 'timeout');

        if (!dup || dup.empty) {
            console.log('🔍 [gsStartRescue] 呼叫 gsSaveStartRescue');
            await gsSaveStartRescue(cabin, group, null);
            console.log('🔍 [gsStartRescue] gsSaveStartRescue 返回');
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

    if (!docId) {
        const fixedId = window.makeGuestDocId(cabin, group);
        if (fixedId) {
            const fixedSnap = await withTimeout(
                db.collection('guests').doc(fixedId).get({ source: 'default' }),
                2000,
                null
            );
            if (fixedSnap && fixedSnap.exists) docId = fixedId;
        }
    }
async function gsSaveStartRescue(cabin, group, docId) {
    console.log('🔍 [gsSaveStartRescue] 進入，cabin:', cabin, 'group:', group, 'docId:', docId);
    const now = new Date();
    const nowISO = now.toISOString();
    if (docId) {
        let existing = {};
        const existingSnap = await withTimeout(
            db.collection('guests').doc(docId).get({ source: 'default' }),
            2000,
            null
        );
        if (existingSnap && existingSnap.exists) existing = existingSnap.data();

        const updateData = {
            ...existing,
            cabinNumber: cabin,
            groupNumber: group,
            timeReachedTop: nowISO,
            timeLanded: null,
            exitTime: null,
            exitMethod: null,
            rescuedBy: '',
            status: 'rescuing',
            updatedAt: now
        };

        await db.collection('guests').doc(docId).set(updateData, { merge: true });
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
        const fixedId = window.makeGuestDocId(cabin, group);
        if (!fixedId) throw new Error('無法產生文件 ID');

        console.log('🔍 [gsSaveStartRescue] 執行 set()...');
        await db.collection('guests').doc(fixedId).set(data);
        console.log('🔍 [gsSaveStartRescue] set() 完成');

        console.log('🔍 [gsSaveStartRescue] 執行 logAction...');
        await logAction('guests', fixedId, 'create', data, null);
        console.log('🔍 [gsSaveStartRescue] logAction 完成');

        showMessage('gsMessage', '✅ 已開始救援', 'success');
    }

    if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    if (typeof dbLoadRecords === 'function' && document.getElementById('dbTableBody')) {
        dbLoadRecords();
    }

    document.getElementById('gsCabinNumber').value = '';
    document.getElementById('gsGroupNumber').value = '';

     console.log('🔍 [gsSaveStartRescue] 準備刷新 Banner（不阻塞）');
    if (typeof gsRefreshOngoingBanner === 'function') {
        gsRefreshOngoingBanner().catch(e => console.warn('Banner 刷新失敗:', e.message));
    }
    console.log('🔍 [gsSaveStartRescue] 函式結束');
}

// ================================================================
// 完成救援
// ================================================================
async function gsCompleteRescue() {
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

        // 優先固定 ID
        const fixedId = window.makeGuestDocId(cabin, group);
        if (fixedId) {
            const fixedSnap = await withTimeout(
                db.collection('guests').doc(fixedId).get({ source: 'default' }),
                2000,
                null
            );
            if (fixedSnap && fixedSnap.exists) {
                const existing = fixedSnap.data();
                if (existing.status === 'rescuing' || (!!existing.timeReachedTop && !existing.timeLanded)) {
                    await gsSaveCompleteRescue(fixedId, cabin, group, timeLanded, existing);
                    return;
                }
                if (existing.timeReachedTop && existing.timeLanded) {
                    gsPendingData = { cabin, group, timeLanded, formData: gsCollectCompleteFields(), docId: fixedId };
                    gsOverwritePendingDocId = fixedId;
                    showGsOverwriteModal(fixedId, existing);
                    return;
                }
            }
        }

        // 回退查詢
        const dup = await withTimeout(
            db.collection('guests')
                .where('cabinNumber', '==', cabin)
                .where('groupNumber', '==', group)
                .get({ source: 'default' }),
            2000,
            null
        );

        if (!dup || dup.empty) {
            gsPendingData = { cabin, group, timeLanded, formData: gsCollectCompleteFields() };
            showGsManualTimeModal('no_record');
            return;
        }

        const doc = dup.docs[0];
        const existing = doc.data();
        const hasReached = !!existing.timeReachedTop;
        const hasLanded = !!existing.timeLanded;

        if (existing.status === 'rescuing') {
            await gsSaveCompleteRescue(doc.id, cabin, group, timeLanded, existing);
            return;
        }

        if (hasReached && hasLanded) {
            gsPendingData = { cabin, group, timeLanded, formData: gsCollectCompleteFields(), docId: doc.id };
            gsOverwritePendingDocId = doc.id;
            showGsOverwriteModal(doc.id, existing);
            return;
        }
        if (hasReached && !hasLanded) {
            await gsSaveCompleteRescue(doc.id, cabin, group, timeLanded, existing);
            return;
        }
        if (!hasReached && hasLanded) {
            gsPendingData = { cabin, group, timeLanded, formData: gsCollectCompleteFields(), docId: doc.id };
            showGsManualTimeModal('missing_start');
            return;
        }

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

    await db.collection('guests').doc(docId).set(updateData, { merge: true });
    await logAction('guests', docId, 'update', updateData, existing || null);

    gsGenerateQR(docId, formData.healthStatus || '未分類');
    document.getElementById('gsQrResult').style.display = 'block';
    document.getElementById('gsPrintCabin').textContent = cabin;
    document.getElementById('gsPrintGroup').textContent = `第${group}組`;
    gsScrollToQr();

    showMessage('gsMessage', '✅ 已完成救援', 'success');

    if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
    if (typeof dbLoadRecords === 'function' && document.getElementById('dbTableBody')) {
        dbLoadRecords();
    }

    if (typeof gsRefreshOngoingBanner === 'function') {
        gsRefreshOngoingBanner().catch(e => console.warn('Banner 刷新失敗:', e.message));
    }

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
// Modal 顯示
// ================================================================
function showGsOverwriteModal(docId, existing) {
    const infoEl = document.getElementById('gsOverwriteInfo');
    const reached = existing.timeReachedTop ? new Date(existing.timeReachedTop).toLocaleString('zh-TW') : '—';
    const landed = existing.timeLanded ? new Date(existing.timeLanded).toLocaleString('zh-TW') : '—';

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
    const reached = existing.timeReachedTop ? new Date(existing.timeReachedTop).toLocaleString('zh-TW') : '—';

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
// 修改內容 / 完全重新記錄
// ================================================================
async function gsChooseModify() {
    if (_gsSubmitting) return;
    _gsSubmitting = true;
    try {
        document.getElementById('gsOverwriteModal').style.display = 'none';
        if (!gsOverwritePendingDocId) return;

        const docId = gsOverwritePendingDocId;
        try {
            showLoader(true);
            const doc = await withTimeout(
                db.collection('guests').doc(docId).get({ source: 'default' }),
                2000,
                null
            );
            if (!doc || !doc.exists) {
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
    } finally {
        _gsSubmitting = false;
    }
}

function gsEnterModifyMode(docId, data) {
    gsModifyMode = true;
    gsModifyDocId = docId;

    gsSwitchMode('complete');
    gsFillFormFromRecord(data, { keepCabinGroup: false });

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
    if (!gsModifyMode || !gsModifyDocId) {
        showMessage('gsMessage', '請先輸入車廂 + 組別以載入記錄', 'error');
        return;
    }

    const timeLanded = document.getElementById('gsTimeLanded').value;
    if (!timeLanded) {
        showMessage('gsMessage', '請填寫完成救援時間', 'error');
        return;
    }

    try {
        showLoader(true);

        let existing = {};
        const snap = await withTimeout(
            db.collection('guests').doc(gsModifyDocId).get({ source: 'default' }),
            2000,
            null
        );
        if (snap && snap.exists) existing = snap.data();

        const formData = gsCollectCompleteFields();

        const updateData = {
            cabinNumber: document.getElementById('gsCabinNumber').value.trim(),
            groupNumber: document.getElementById('gsGroupNumber').value,
            ...formData,
            timeLanded,
            status: 'landed',
            updatedAt: new Date()
        };

        if (!updateData.rescuedBy && existing.rescuedBy) updateData.rescuedBy = existing.rescuedBy;
        if (!updateData.remarks && existing.remarks) updateData.remarks = existing.remarks;

        await db.collection('guests').doc(gsModifyDocId).set(updateData, { merge: true });
        await logAction('guests', gsModifyDocId, 'update', updateData, existing);

        gsGenerateQR(gsModifyDocId, formData.healthStatus || '未分類');
        document.getElementById('gsQrResult').style.display = 'block';
        document.getElementById('gsPrintCabin').textContent = updateData.cabinNumber;
        document.getElementById('gsPrintGroup').textContent = `第${updateData.groupNumber}組`;
        gsScrollToQr();

        showMessage('gsMessage', '✅ 已儲存修改', 'success');

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function' && document.getElementById('dbTableBody')) {
            dbLoadRecords();
        }

        gsExitModifyMode();

    } catch (e) {
        showMessage('gsMessage', '修改失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
    }
}

async function gsChooseFullRestart() {
    if (_gsSubmitting) return;
    document.getElementById('gsOverwriteModal').style.display = 'none';
    if (!gsPendingData || !gsOverwritePendingDocId) return;
    gsPendingData.mode = 'fullrestart';
    showGsManualTimeModal('fullrestart');
}

async function gsConfirmOngoingOverwrite() {
    if (_gsSubmitting) return;
    _gsSubmitting = true;
    try {
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
    } finally {
        _gsSubmitting = false;
    }
}

function gsCancelManualTime() {
    document.getElementById('gsManualTimeModal').style.display = 'none';
    gsPendingData = null;
}

async function gsConfirmManualTime() {
    if (_gsSubmitting) return;

    const manualTime = document.getElementById('gsManualTimeReachedTop').value;
    if (!manualTime) {
        alert('請輸入開始救援時間');
        return;
    }
    if (!gsPendingData) return;

    _gsSubmitting = true;

    const { cabin, group, timeLanded, docId, formData, mode } = gsPendingData;
    document.getElementById('gsManualTimeModal').style.display = 'none';

    try {
        showLoader(true);

        if (mode === 'fullrestart') {
            let existing = {};
            const snap = await withTimeout(
                db.collection('guests').doc(docId).get({ source: 'default' }),
                2000,
                null
            );
            if (snap && snap.exists) existing = snap.data();

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

            await db.collection('guests').doc(docId).set(updateData, { merge: true });
            await logAction('guests', docId, 'update', updateData, existing);

            if (currentTimeLanded) {
                gsGenerateQR(docId, updateData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
                gsScrollToQr();
            }

            showMessage('gsMessage', '✅ 已完全重新記錄', 'success');

        } else if (docId) {
            let existing = {};
            const snap = await withTimeout(
                db.collection('guests').doc(docId).get({ source: 'default' }),
                2000,
                null
            );
            if (snap && snap.exists) existing = snap.data();

            const updateData = {
                ...existing,
                timeReachedTop: manualTime,
                ...(formData || {}),
                ...(timeLanded ? { timeLanded } : {}),
                status: timeLanded ? 'landed' : (existing.status || 'rescuing'),
                updatedAt: new Date()
            };

            await db.collection('guests').doc(docId).set(updateData, { merge: true });
            await logAction('guests', docId, 'update', updateData, existing);

            if (timeLanded) {
                gsGenerateQR(docId, updateData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
                gsScrollToQr();
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

            const fixedId = window.makeGuestDocId(cabin, group);
            if (!fixedId) throw new Error('無法產生文件 ID');

            await db.collection('guests').doc(fixedId).set(newData);
            await logAction('guests', fixedId, 'create', newData, null);

            if (timeLanded) {
                gsGenerateQR(fixedId, newData.healthStatus || '未分類');
                document.getElementById('gsQrResult').style.display = 'block';
                document.getElementById('gsPrintCabin').textContent = cabin;
                document.getElementById('gsPrintGroup').textContent = `第${group}組`;
                gsScrollToQr();
            }

            showMessage('gsMessage', '✅ 已建立記錄', 'success');
        }

        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function' && document.getElementById('dbTableBody')) {
            dbLoadRecords();
        }

        gsClearForm();

    } catch (e) {
        showMessage('gsMessage', '失敗: ' + e.message, 'error');
    } finally {
        hideLoader();
        gsPendingData = null;
        _gsSubmitting = false;
    }
}

// ================================================================
// Banner：進行中救援
// ================================================================
function gsInitOngoingListener() {
    if (window._gsOngoingUnsub) window._gsOngoingUnsub();

    window._gsOngoingUnsub = db.collection('guests')
        .where('status', '==', 'rescuing')
        .onSnapshot(
            { includeMetadataChanges: true },
            (snap, metadata) => {
                const fromCache = metadata && metadata.fromCache;
                if (fromCache) {
                    console.log('📦 收到快取資料，跳過（等待伺服器資料）');
                    return;
                }
                const list = [];
                snap.forEach(d => {
                    const data = d.data();
                    if (!data.timeLanded) {
                        list.push({ id: d.id, ...data });
                    }
                });
                console.log('🔔 監聽器觸發（伺服器資料），進行中救援:', list.length, '筆');
                gsRenderOngoingBanner(list);
            },
            err => {
                if (err && err.code === 'permission-denied') return;
                console.warn('banner 監聽失敗:', err);
            }
        );

    // 保險：立即查詢一次（加超時）
    setTimeout(async () => {
        try {
            const snap = await withTimeout(
                db.collection('guests')
                    .where('status', '==', 'rescuing')
                    .get({ source: 'server' }),
                3000,
                null
            );
            if (!snap) {
                console.warn('⏱️ 初始查詢逾時，改用快取');
                const cacheSnap = await withTimeout(
                    db.collection('guests').where('status', '==', 'rescuing').get({ source: 'cache' }),
                    2000,
                    null
                );
                if (cacheSnap) gsRenderOngoingBannerFromSnap(cacheSnap);
                return;
            }
            gsRenderOngoingBannerFromSnap(snap);
        } catch (e) {
            console.warn('初始查詢失敗:', e);
        }
    }, 500);
}

async function gsRefreshOngoingBanner() {
    try {
        const snap = await withTimeout(
            db.collection('guests').where('status', '==', 'rescuing').get({ source: 'server' }),
            3000,
            null
        );

        if (!snap) {
            console.warn('⏱️ [gsRefreshOngoingBanner] 伺服器讀取逾時，改用快取');
            const cacheSnap = await withTimeout(
                db.collection('guests').where('status', '==', 'rescuing').get({ source: 'cache' }),
                2000,
                null
            );
            if (!cacheSnap) {
                console.warn('⏱️ 快取也逾時，跳過刷新');
                return;
            }
            gsRenderOngoingBannerFromSnap(cacheSnap);
            return;
        }

        gsRenderOngoingBannerFromSnap(snap);
    } catch (e) {
        console.warn('手動刷新 Banner 失敗:', e.message);
    }
}

function gsRenderOngoingBannerFromSnap(snap) {
    const list = [];
    snap.forEach(d => {
        const data = d.data();
        if (!data.timeLanded) {
            list.push({ id: d.id, ...data });
        }
    });
    console.log('🔄 手動刷新 Banner:', list.length, '筆');
    gsRenderOngoingBanner(list);
}

window.gsRefreshOngoingBanner = gsRefreshOngoingBanner;

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
        const cabinEsc = escapeHtml(item.cabinNumber || '');
        const groupEsc = escapeHtml(item.groupNumber || '');
        const idEsc = escapeJs(item.id || '');
        div.innerHTML = `
            <span>🚠 車廂 ${cabinEsc} 第 ${groupEsc} 組（開始於 ${startTime}）</span>
            <button onclick="gsOpenCompleteFromBanner('${idEsc}')">完成</button>
        `;
        listEl.appendChild(div);
    });
}

function gsOpenCompleteFromBanner(docId) {
    if (_gsSubmitting) return;
    _gsSubmitting = true;

    db.collection('guests').doc(docId).get()
        .then(doc => {
            if (!doc.exists) return;
            const data = doc.data();

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
        })
        .finally(() => {
            _gsSubmitting = false;
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

    const elCabin = document.getElementById('gsCabinNumber');
    const elGroup = document.getElementById('gsGroupNumber');

    if (elCabin && !elCabin.dataset.gsLookupBound) {
        elCabin.dataset.gsLookupBound = 'true';
        elCabin.addEventListener('input', gsOnCabinOrGroupChange);
        elCabin.addEventListener('change', gsOnCabinOrGroupChange);
    }

    if (elGroup && !elGroup.dataset.gsLookupBound) {
        elGroup.dataset.gsLookupBound = 'true';
        elGroup.addEventListener('change', gsOnCabinOrGroupChange);
    }

    console.log('✅ GS 自動查詢已綁定');
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
window.gsScrollToQr = gsScrollToQr;

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

window.gsOnCabinOrGroupChange = gsOnCabinOrGroupChange;
window.gsAutoLookupRecord = gsAutoLookupRecord;
window.gsFillFormFromRecord = gsFillFormFromRecord;
window.gsClearFormForModify = gsClearFormForModify;

console.log('✅ gs.js 已載入（完整版）');
