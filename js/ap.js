// ================================================================
// Assembly Point 模組
// ================================================================

let apCurrentDocId = null;
let apScanning = false;

// ---- 掃描器 ----
async function startScanner() {
    const video = document.getElementById('scanner-video');
    stopScanner();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
        await video.play();
        apScanning = true;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        function tick() {
            if (!apScanning) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.height = video.videoHeight;
                canvas.width = video.videoWidth;
                ctx.drawImage(video, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
                if (code) {
                    try {
                        const data = JSON.parse(code.data);
                        if (data.type === 'guestRecord' && data.docId) {
                            apScanning = false;
                            stopScanner();
                            apLoadRecord(data.docId);
                        }
                    } catch(e) {}
                }
            }
            requestAnimationFrame(tick);
        }
        tick();
        showMessage('apMessage', '掃描器已啟動，請對準 QR 碼', 'info');
    } catch (e) {
        showMessage('apMessage', '無法啟動相機: ' + e.message, 'error');
    }
}

function stopScanner() {
    const video = document.getElementById('scanner-video');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    apScanning = false;
}

// ================================================================
// ★ 手動搜尋記錄
// ================================================================
async function apManualSearch() {
    const cabin = document.getElementById('apManualCabin').value.trim();
    const group = document.getElementById('apManualGroup').value;

    if (!cabin) {
        showMessage('apMessage', '請輸入車廂號碼', 'error');
        return;
    }
    if (!group) {
        showMessage('apMessage', '請選擇組別', 'error');
        return;
    }

    try {
        showLoader(true);
        const snapshot = await db.collection('guests')
            .where('cabinNumber', '==', cabin)
            .where('groupNumber', '==', group)
            .get();

        if (snapshot.empty) {
            showMessage('apMessage', `找不到車廂 ${cabin} 第 ${group} 組的記錄`, 'error');
            return;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();
        apCurrentDocId = doc.id;

        document.getElementById('apRecordDetails').style.display = 'block';
        document.getElementById('apCabinNumber').textContent = data.cabinNumber || '-';
        document.getElementById('apGroupNumber').textContent = data.groupNumber ? `第${data.groupNumber}組` : '-';
        document.getElementById('apGuestName').textContent = data.guestName || '-';
        document.getElementById('apHealthStatus').textContent = data.healthStatus || '-';

        document.getElementById('apAmbulance').value = data.ambulance || '';
        document.getElementById('apAmbulancePlate').value = data.ambulancePlate || '';
        document.getElementById('apHospital').value = data.hospital || '';
        document.getElementById('apExitMethod').value = data.exitMethod || '';
        document.getElementById('apOtherExitInput').value = '';
        document.getElementById('apExitTime').value = '';

        toggleApAmbulance();
        toggleApOtherExit();

        showMessage('apMessage', `✅ 已載入車廂 ${cabin} 第 ${group} 組的記錄，請填寫離場資訊`, 'success');
        document.getElementById('apRecordDetails').scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        showMessage('apMessage', '搜尋失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

function apClearManualSearch() {
    document.getElementById('apManualCabin').value = '';
    document.getElementById('apManualGroup').value = '';
    showMessage('apMessage', '已清除搜尋條件', 'info');
}

// ================================================================
// 載入記錄（QR Code 掃描後呼叫，也供手動搜尋呼叫）
// ================================================================
async function apLoadRecord(docId) {
    try {
        showLoader(true);
        const doc = await db.collection('guests').doc(docId).get();
        if (!doc.exists) { showMessage('apMessage', '找不到記錄', 'error'); return; }
        const data = doc.data();
        apCurrentDocId = docId;
        document.getElementById('apRecordDetails').style.display = 'block';
        document.getElementById('apCabinNumber').textContent = data.cabinNumber || '-';
        document.getElementById('apGroupNumber').textContent = data.groupNumber ? `第${data.groupNumber}組` : '-';
        document.getElementById('apGuestName').textContent = data.guestName || '-';
        document.getElementById('apHealthStatus').textContent = data.healthStatus || '-';
        document.getElementById('apAmbulance').value = data.ambulance || '';
        document.getElementById('apAmbulancePlate').value = data.ambulancePlate || '';
        document.getElementById('apHospital').value = data.hospital || '';
        document.getElementById('apExitMethod').value = data.exitMethod || '';
        document.getElementById('apOtherExitInput').value = '';
        document.getElementById('apExitTime').value = '';
        toggleApAmbulance();
        toggleApOtherExit();
        showMessage('apMessage', '記錄載入成功，請填寫離場資訊', 'success');
        document.getElementById('apRecordDetails').scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        showMessage('apMessage', '載入失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
}

function toggleApAmbulance() {
    const v = document.getElementById('apAmbulance').value;
    document.getElementById('apAmbulanceFields').style.display = v === '需要' ? 'block' : 'none';
}

function toggleApOtherExit() {
    const v = document.getElementById('apExitMethod').value;
    document.getElementById('apOtherExitContainer').style.display = v === '其他' ? 'block' : 'none';
}

// ---- ★ 修改：更新記錄（不再強制要求離場時間，但會提示確認） ----
async function apUpdateRecord() {
    if (!apCurrentDocId) { showMessage('apMessage', '請先掃描 QR 碼或手動尋找記錄', 'error'); return; }
    let exitMethod = document.getElementById('apExitMethod').value;
    const exitTime = document.getElementById('apExitTime').value;
    const ambulance = document.getElementById('apAmbulance').value;
    const ambulancePlate = document.getElementById('apAmbulancePlate').value.trim();
    const hospital = document.getElementById('apHospital').value.trim();

    if (exitMethod === '其他') {
        const other = document.getElementById('apOtherExitInput').value.trim();
        if (!other) { showMessage('apMessage', '請輸入其他後續處理方式', 'error'); return; }
        exitMethod = other;
    }
    if (!exitMethod) { showMessage('apMessage', '請填寫後續處理', 'error'); return; }
    if (!exitTime) {
        // ★ 若未填寫離場時間，詢問是否確認更新（不更新 exitTime）
        if (!confirm('⚠️ 您尚未填寫離場時間，確定要更新記錄嗎？（離場時間將保持不變）')) {
            return;
        }
    }
    if (ambulance === '需要' && (!ambulancePlate || !hospital)) {
        showMessage('apMessage', '請填寫救護車車牌和醫院名稱', 'error');
        return;
    }

    try {
        showLoader(true);
        // ★ 構建更新物件，僅包含有變更的欄位
        const updateData = {
            exitMethod: exitMethod,
            ambulance: ambulance,
            ambulancePlate: ambulancePlate,
            hospital: hospital,
            status: 'landed',
            updatedAt: new Date()
        };

        // ★ 僅當 exitTime 有值時才加入，否則保留原有值
        if (exitTime) {
            updateData.exitTime = new Date(exitTime);
        }

        // 讀取更新前資料（用於日誌）
        const existingDoc = await db.collection('guests').doc(apCurrentDocId).get();
        const previousData = existingDoc.exists ? existingDoc.data() : null;

        await db.collection('guests').doc(apCurrentDocId).update(updateData);
        await logAction('guests', apCurrentDocId, 'update', updateData, previousData);

        showMessage('apMessage', '記錄更新成功！', 'success');
        document.getElementById('apRecordDetails').style.display = 'none';
        apCurrentDocId = null;
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
        setTimeout(startScanner, 2000);
    } catch (e) {
        showMessage('apMessage', '更新失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}
// ---- 開啟編輯模態框 ----
function openApEditModal() {
    if (!apCurrentDocId) {
        showMessage('apMessage', '請先載入一筆記錄', 'error');
        return;
    }
    // 載入最新資料
    db.collection('guests').doc(apCurrentDocId).get().then(doc => {
        if (doc.exists) {
            const data = doc.data();
            fillApEditModal(data);
            document.getElementById('apEditModal').style.display = 'flex';
        } else {
            showMessage('apMessage', '記錄不存在', 'error');
        }
    }).catch(err => {
        showMessage('apMessage', '載入資料失敗: ' + err.message, 'error');
    });
}

function fillApEditModal(data) {
    document.getElementById('apEditCabinNumber').value = data.cabinNumber || '';
    document.getElementById('apEditGroupNumber').value = data.groupNumber ? '第' + data.groupNumber + '組' : '';
    document.getElementById('apEditGuestName').value = data.guestName || '';
    document.getElementById('apEditContactNumber').value = data.contactNumber || '';
    document.getElementById('apEditGender').value = data.gender || '';
    document.getElementById('apEditAgeRange').value = data.ageRange || '';
    document.getElementById('apEditHealthStatus').value = data.healthStatus || '未能分類';
    // 轉換時間格式
    const timeLanded = data.timeLanded;
    if (timeLanded) {
        // 嘗試轉換為 datetime-local 可接受格式
        let formatted = '';
        try {
            let date;
            if (timeLanded.toDate && typeof timeLanded.toDate === 'function') {
                date = timeLanded.toDate();
            } else if (typeof timeLanded === 'string') {
                date = new Date(timeLanded);
            } else if (timeLanded.seconds) {
                date = new Date(timeLanded.seconds * 1000);
            } else {
                date = new Date(timeLanded);
            }
            if (!isNaN(date.getTime())) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                formatted = `${year}-${month}-${day}T${hours}:${minutes}`;
            }
        } catch (e) {}
        document.getElementById('apEditTimeLanded').value = formatted;
    } else {
        document.getElementById('apEditTimeLanded').value = '';
    }
    document.getElementById('apEditRemarks').value = data.remarks || '';
}

function closeApEditModal() {
    document.getElementById('apEditModal').style.display = 'none';
}

async function saveApEditModal() {
    if (!apCurrentDocId) {
        showMessage('apMessage', '無記錄可更新', 'error');
        return;
    }
    const updateData = {
        guestName: document.getElementById('apEditGuestName').value.trim(),
        contactNumber: document.getElementById('apEditContactNumber').value.trim(),
        gender: document.getElementById('apEditGender').value,
        ageRange: document.getElementById('apEditAgeRange').value,
        healthStatus: document.getElementById('apEditHealthStatus').value,
        timeLanded: document.getElementById('apEditTimeLanded').value || null,
        remarks: document.getElementById('apEditRemarks').value.trim(),
        updatedAt: new Date()
    };
    if (!updateData.guestName) {
        showMessage('apMessage', '請輸入被救者姓名', 'error');
        return;
    }
    try {
        showLoader(true);
        // 保留原有的 timeReachedTop, createdAt, cabinNumber, groupNumber 不變
        const existingDoc = await db.collection('guests').doc(apCurrentDocId).get();
        if (existingDoc.exists) {
            const existing = existingDoc.data();
            updateData.cabinNumber = existing.cabinNumber;
            updateData.groupNumber = existing.groupNumber;
            updateData.timeReachedTop = existing.timeReachedTop;
            updateData.createdAt = existing.createdAt;
        }
        await db.collection('guests').doc(apCurrentDocId).update(updateData);
        showMessage('apMessage', '✅ 記錄更新成功！', 'success');
        closeApEditModal();
        // 重新載入記錄詳情（更新賓客資訊顯示）
        if (apCurrentDocId) {
            apLoadRecord(apCurrentDocId);
        }
        // 更新地圖、監控、Dashboard
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
    } catch (e) {
        showMessage('apMessage', '更新失敗: ' + e.message, 'error');
    } finally {
        showLoader(false);
    }
}

// ---- 初始化函數 ----
function initAssemblyPoint() {
    console.log('✅ Assembly Point 初始化完成');
    document.getElementById('apRecordDetails').style.display = 'none';
    document.getElementById('apMessage').className = 'message';
    document.getElementById('apManualCabin').value = '';
    document.getElementById('apManualGroup').value = '';
}

// ---- 暴露 ----
window.startScanner = startScanner;
window.stopScanner = stopScanner;
window.apManualSearch = apManualSearch;
window.apClearManualSearch = apClearManualSearch;
window.apUpdateRecord = apUpdateRecord;
window.toggleApAmbulance = toggleApAmbulance;
window.toggleApOtherExit = toggleApOtherExit;
window.initAssemblyPoint = initAssemblyPoint;
// 暴露全域
window.openApEditModal = openApEditModal;
window.closeApEditModal = closeApEditModal;
window.saveApEditModal = saveApEditModal;
