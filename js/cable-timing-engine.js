// ================================================================
// 纜車車距計算引擎（純計算，無視覺、無資料來源）
// 從原始 CoreEngine 提取核心邏輯，移除 STATION_LAYOUT / RAW_SEQUENCE
// ================================================================

class CableTimingEngine {
    /**
     * @param {number[]} sequence - 環形序列（車廂號碼陣列，順序即為環形順序）
     */
    constructor(sequence) {
        if (!sequence || sequence.length === 0) {
            throw new Error('序列不得為空');
        }
        this.sequence = sequence;
        this.total = sequence.length;

        // 建立快速查表（車號 → 位置索引 0-based）
        this.posMap = new Map();
        sequence.forEach((id, index) => {
            this.posMap.set(id, index);
        });

        // 速度常數對照表（來自 Excel Sheet2 G7/M7, G12/M12）
        this.CONSTANTS = {
            '109': { G: 31.4, M: 24.06 },
            '84':  { G: 40,   M: 31.5 }
        };
    }

    /**
     * 更新序列（當車廂排序變更時呼叫）
     */
    updateSequence(sequence) {
        if (!sequence || sequence.length === 0) return;
        this.sequence = sequence;
        this.total = sequence.length;
        this.posMap.clear();
        sequence.forEach((id, index) => {
            this.posMap.set(id, index);
        });
    }

    /**
     * 取得車廂位置（0-based index）
     */
    getPosition(cabinId) {
        if (!this.posMap.has(cabinId)) {
            return -1;
        }
        return this.posMap.get(cabinId);
    }

    /**
     * 計算車距 Gap
     * 公式：gap = pos(目標) - pos(面前)；若 < 0 則 + N（環繞）
     */
    calculateGap(currentId, targetId) {
        const posC = this.getPosition(currentId);
        const posT = this.getPosition(targetId);

        if (posC === -1) {
            return { error: `❌ 錯誤：面前車號 ${currentId} 不存在於當前序列中！` };
        }
        if (posT === -1) {
            return { error: `❌ 錯誤：目標車號 ${targetId} 不存在於當前序列中！` };
        }

        let gap = posT - posC;
        if (gap < 0) gap += this.total;

        return { gap, posCurrent: posC, posTarget: posT };
    }

    /**
     * 計算「秒 / 每車廂」
     * 公式：sec = M + (G - M) * (5 - V)  [4~5.5 m/s]
     *      sec = M + (G - M) * (4 - V)  [0~3.9 m/s]
     */
    calculateTimePerCar(speed, mode) {
        if (speed === 0) return 0;

        const consts = this.CONSTANTS[mode];
        if (!consts) {
            throw new Error(`❌ 未知模式: ${mode}，請使用 '109' 或 '84'`);
        }

        const { G, M } = consts;

        let sec;
        if (speed <= 3.9) {
            sec = M + (G - M) * (4 - speed);
        } else {
            sec = M + (G - M) * (5 - speed);
        }
        return sec;
    }

    /**
     * 完整行車時間推算
     */
    calculateTravelTime(currentId, targetId, speed, mode) {
        const gapResult = this.calculateGap(currentId, targetId);
        if (gapResult.error) return gapResult;

        const { gap, posCurrent, posTarget } = gapResult;
        const secPerCar = this.calculateTimePerCar(speed, mode);
        const totalSeconds = gap * secPerCar;

        const minutes = Math.floor(totalSeconds / 60);
        const secondsRemain = totalSeconds - (minutes * 60);

        const now = new Date();
        const arrival = new Date(now.getTime() + totalSeconds * 1000);

        return {
            currentId,
            targetId,
            speed,
            mode,
            totalCabin: this.total,
            gap,
            secPerCar,
            totalSeconds,
            minutes,
            seconds: secondsRemain.toFixed(2),
            posCurrent: posCurrent + 1,
            posTarget: posTarget + 1,
            currentTime: now.toLocaleTimeString('zh-HK', { hour12: false }),
            arrivalTime: arrival.toLocaleTimeString('zh-HK', { hour12: false }),
            arrivalDate: arrival,
            error: null
        };
    }
}

window.CableTimingEngine = CableTimingEngine;
