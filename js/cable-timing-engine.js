// ================================================================
// CableTimingEngine.js
// 纜車車距計算引擎（109 / 84 模式）
// 核心公式：gap = (posTarget - posCurrent + N) % N，若 0 則 N
// 到各站：gapToStation = gapToCurrent + STATION_DISTANCE[from][to]（含多圈）
// 站點不變、全程長度相同；模式差異只在車廂數 N → 站間車位數按 N/109 縮放
// ================================================================

const STATION_ORDER = ['TCT', 'AIAS-U', 'NLS-U', 'NPT', 'NLS-D', 'AIAS-D'];

// 109 模式六站累計車位（TCT=0 起），已與原 STATION_DISTANCE_109 逐格驗證一致
const STATION_POS_109 = {
    'TCT':    0,
    'AIAS-U': 8,
    'NLS-U':  38,
    'NPT':    57,
    'NLS-D':  71,
    'AIAS-D': 101
};

// 依模式 N 生成 6×6 站間距離矩陣
// 前提：全程長度相同 → 站間比例固定 → pos = round(POS_109 / 109 * N)
function buildStationDistance(N) {
    const pos = {};
    STATION_ORDER.forEach(st => {
        pos[st] = Math.round(STATION_POS_109[st] / 109 * N);
    });

    // 閉環校正：保證嚴格遞增且 < N（避免 round 造成相鄰站重疊）
    for (let i = 1; i < STATION_ORDER.length; i++) {
        if (pos[STATION_ORDER[i]] <= pos[STATION_ORDER[i - 1]]) {
            pos[STATION_ORDER[i]] = pos[STATION_ORDER[i - 1]] + 1;
        }
    }

    const m = {};
    STATION_ORDER.forEach(from => {
        m[from] = {};
        STATION_ORDER.forEach(to => {
            if (from === to) {
                m[from][to] = 0;
            } else {
                let d = (pos[to] - pos[from] + N) % N;
                if (d === 0) d = N; // 保險；from≠to 時不應發生
                m[from][to] = d;
            }
        });
    });
    return m;
}

const STATION_DISTANCE_109 = buildStationDistance(109);
const STATION_DISTANCE_84  = buildStationDistance(84);

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

        // ★ 完整性檢查：偵測 sequence.length 是否等於 mode
        const expectedTotal = parseInt(mode, 10);
        this.isIncomplete = (!isNaN(expectedTotal) && this.total !== expectedTotal);
        this.expectedTotal = expectedTotal;

        if (this.isIncomplete) {
            console.warn(
                `⚠️ CableTimingEngine: 序列不完整 ` +
                `（模式 ${expectedTotal}，實際 ${this.total}）。` +
                `STATION_DISTANCE 將用 ${this.total} 動態生成，計算結果僅供參考。`
            );
        }

        // ★ 保留原始矩陣（供「完整輸入」時對照）
        this.STATION_DISTANCE = {
            '109': STATION_DISTANCE_109,
            '84':  STATION_DISTANCE_84
        };

        // ★ 核心修正：根據實際 total 動態生成矩陣
        //   完整輸入時（total === mode），buildStationDistance(total) 與現有矩陣完全相同
        //   缺號時（total !== mode），用實際 total 生成，避免「矩陣格數與 total 不匹配」
        this.activeStationDistance = buildStationDistance(this.total);

        // ★ 常數保持不變（G/M 是經驗值，缺號時仍用原值）
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
     * ★ 不做 % total，直接相加，允許「多圈」
     */
    calculateGapToStation(currentId, targetId, currentStation, targetStation) {
        const base = this.calculateGapToCurrent(currentId, targetId);
        if (base.error) return base;

        // ★ 修正：用 activeStationDistance（根據實際 total 動態生成）
        //   - 完整輸入時：activeStationDistance === STATION_DISTANCE[mode]（完全一致）
        //   - 缺號時：activeStationDistance 用實際 total 生成，與 base.gap 單位匹配
        const matrix = this.activeStationDistance;
        if (!matrix || !matrix[currentStation]) {
            return { error: `站點 ${currentStation} 未定義` };
        }
        const dist = matrix[currentStation][targetStation];
        if (dist === undefined) {
            return { error: `站間距離未定義：${currentStation} → ${targetStation}` };
        }

        // ★ 不做 % total，直接相加
        //   base.gap ∈ [1, total]，dist ∈ [0, total-1]
        //   gap ∈ [1, 2*total-1]，代表「目標車到目標站」的實際車位數（含多圈）
        let gap = base.gap + dist;

        return {
            gap,
            baseGap: base.gap,
            stationDist: dist,
            isIncomplete: this.isIncomplete || false
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
        const stations = STATION_ORDER;
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
window.STATION_DISTANCE_109 = STATION_DISTANCE_109;
window.STATION_DISTANCE_84  = STATION_DISTANCE_84;
