// ================================================================
// CableTimingEngine.js
// 纜車車距計算引擎（109 模式，可擴充 84）
// 核心公式：gap = (posTarget - posCurrent + N) % N，若 0 則 N
// 到各站：gapToStation = (gapToCurrent + STATION_DISTANCE[from][to]) % N
// ================================================================

const STATION_DISTANCE_109 = {
    //              To:  TCT  AIAS-U  NLS-U  NPT  NLS-D  AIAS-D
    'TCT':    { 'TCT':   0, 'AIAS-U':   8, 'NLS-U':  38, 'NPT':  57, 'NLS-D':  71, 'AIAS-D': 101 },
    'AIAS-U': { 'TCT': 101, 'AIAS-U':   0, 'NLS-U':  30, 'NPT':  49, 'NLS-D':  63, 'AIAS-D':  93 },
    'NLS-U':  { 'TCT':  71, 'AIAS-U':  79, 'NLS-U':   0, 'NPT':  19, 'NLS-D':  33, 'AIAS-D':  63 },
    'NPT':    { 'TCT':  52, 'AIAS-U':  60, 'NLS-U':  90, 'NPT':   0, 'NLS-D':  14, 'AIAS-D':  44 },
    'NLS-D':  { 'TCT':  38, 'AIAS-U':  46, 'NLS-U':  76, 'NPT':  95, 'NLS-D':   0, 'AIAS-D':  30 },
    'AIAS-D': { 'TCT':   8, 'AIAS-U':  16, 'NLS-U':  46, 'NPT':  65, 'NLS-D':  79, 'AIAS-D':   0 }
};

// 84 模式矩陣：先用 109 結構佔位，待你提供 84 序列後替換
const STATION_DISTANCE_84 = {
    'TCT':    { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 },
    'AIAS-U': { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 },
    'NLS-U':  { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 },
    'NPT':    { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 },
    'NLS-D':  { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 },
    'AIAS-D': { 'TCT': 0, 'AIAS-U': 0, 'NLS-U': 0, 'NPT': 0, 'NLS-D': 0, 'AIAS-D': 0 }
};

class CableTimingEngine {
    /**
     * @param {string[]} sequence - 已過濾空值的車號陣列（順序即運行方向）
     * @param {string} mode - '109' 或 '84'
     */
    constructor(sequence, mode = '109') {
        if (!sequence || sequence.length === 0) {
            throw new Error('序列不得為空');
        }
        this.sequence = sequence;
        this.total = sequence.length;
        this.mode = mode;

        // ★ 字串 key，支援 WC-1 等非數字車號
        this.posMap = new Map();
        sequence.forEach((id, idx) => {
            this.posMap.set(String(id).trim(), idx);
        });

        this.STATION_DISTANCE = {
            '109': STATION_DISTANCE_109,
            '84':  STATION_DISTANCE_84
        };
        this.CONSTANTS = {
            '109': { G: 31.4, M: 24.06 },
            '84':  { G: 40,   M: 31.5 }
        };
    }

    /** 取得車廂位置（0-based）；找不到回 -1 */
    getPosition(id) {
        const key = String(id).trim();
        return this.posMap.has(key) ? this.posMap.get(key) : -1;
    }

    /**
     * 目標車到「當前站」的車位數
     * ★ 目標車 = 面前車時，gap = N（繞一整圈）
     */
    calculateGapToCurrent(currentId, targetId) {
        const posC = this.getPosition(currentId);
        const posT = this.getPosition(targetId);

        if (posC === -1) return { error: `面前車 "${currentId}" 不在序列中` };
        if (posT === -1) return { error: `目標車 "${targetId}" 不在序列中` };

        let gap = (posT - posC + this.total) % this.total;
        if (gap === 0) gap = this.total;   // ★ 目標車 = 面前車 → 繞一整圈

        return {
            gap,
            posCurrent: posC + 1,
            posTarget: posT + 1,
            total: this.total
        };
    }

    /**
     * 目標車到「指定站」的車位數
     * 算法：目標車先到當前站（gapToCurrent），再從當前站走到目標站
     */
    calculateGapToStation(currentId, targetId, currentStation, targetStation) {
        const base = this.calculateGapToCurrent(currentId, targetId);
        if (base.error) return base;

        const matrix = this.STATION_DISTANCE[this.mode];
        if (!matrix || !matrix[currentStation]) {
            return { error: `站點 ${currentStation} 未定義` };
        }
        const dist = matrix[currentStation][targetStation];
        if (dist === undefined) {
            return { error: `站間距離未定義：${currentStation} → ${targetStation}` };
        }

        let gap = (base.gap + dist) % this.total;
        if (gap === 0) gap = this.total;

        return {
            gap,
            baseGap: base.gap,
            stationDist: dist
        };
    }

    /** 秒／車廂 */
    calculateTimePerCar(speed) {
        if (speed === 0) return 0;
        const { G, M } = this.CONSTANTS[this.mode];
        return speed <= 3.9
            ? M + (G - M) * (4 - speed)
            : M + (G - M) * (5 - speed);
    }

    /**
     * 完整行車時間推算
     * @param {string} currentId - 面前車號
     * @param {string} targetId - 目標車號
     * @param {number} speed - 繩速（m/s）
     * @param {string} currentStation - 當前站（'TCT' / 'AIAS-U' / ...）
     */
    calculateTravelTime(currentId, targetId, speed, currentStation) {
        const base = this.calculateGapToCurrent(currentId, targetId);
        if (base.error) return base;

        const secPerCar = this.calculateTimePerCar(speed);
        const totalSeconds = base.gap * secPerCar;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds - minutes * 60;

        const now = new Date();
        const arrival = new Date(now.getTime() + totalSeconds * 1000);

        // 到各站時間
        const stations = ['TCT', 'AIAS-U', 'NLS-U', 'NPT', 'NLS-D', 'AIAS-D'];
        const stationETAs = {};
        stations.forEach(st => {
            const r = this.calculateGapToStation(currentId, targetId, currentStation, st);
            if (!r.error) {
                const sec = r.gap * secPerCar;
                const eta = new Date(now.getTime() + sec * 1000);
                stationETAs[st] = {
                    gap: r.gap,
                    totalSeconds: sec,
                    minutes: Math.floor(sec / 60),
                    seconds: (sec % 60).toFixed(2),
                    arrivalTime: eta.toLocaleTimeString('zh-HK', { hour12: false })
                };
            }
        });

        return {
            ...base,
            secPerCar,
            totalSeconds,
            minutes,
            seconds: seconds.toFixed(2),
            currentTime: now.toLocaleTimeString('zh-HK', { hour12: false }),
            arrivalTime: arrival.toLocaleTimeString('zh-HK', { hour12: false }),
            stationETAs,
            error: null
        };
    }
}

window.CableTimingEngine = CableTimingEngine;
