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

    // ★ 驗證後續處理方式是否選擇
    if (!exitMethod) {
        showMessage('apMessage', '請選擇後續處理方式', 'error');
        return;
    }

    // ★ 若未填寫離場時間，提示確認
    if (!exitTime) {
        if (!confirm('您尚未填寫離場時間，確定要繼續更新嗎？')) {
            return;
        }
    }

    if (ambulance === '需要' && (!ambulancePlate || !hospital)) {
        showMessage('apMessage', '請填寫救護車車牌和醫院名稱', 'error');
        return;
    }

    try {
        showLoader(true);
        const update = {
            exitMethod,
            ambulance,
            ambulancePlate,
            hospital,
            status: 'landed',
            updatedAt: new Date()
        };
        // ★ 只有當 exitTime 有值時才加入
        if (exitTime) {
            update.exitTime = new Date(exitTime);
        } else {
            update.exitTime = null; // 或省略，但設為 null 可清除舊值
        }

        const existingDoc = await db.collection('guests').doc(apCurrentDocId).get();
        const previousData = existingDoc.exists ? existingDoc.data() : null;

        await db.collection('guests').doc(apCurrentDocId).update(update);
        await logAction('guests', apCurrentDocId, 'update', update, previousData);
        showMessage('apMessage', '記錄更新成功！', 'success');
        document.getElementById('apRecordDetails').style.display = 'none';
        apCurrentDocId = null;
        if (typeof mapUpdateFromFirestore === 'function') mapUpdateFromFirestore();
        if (typeof dbLoadRecords === 'function') dbLoadRecords();
        if (typeof monUpdateFromFirestore === 'function') monUpdateFromFirestore();
        setTimeout(startScanner, 2000);
    } catch (e) {
        showMessage('apMessage', '更新失敗: ' + e.message, 'error');
    } finally { showLoader(false); }
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
