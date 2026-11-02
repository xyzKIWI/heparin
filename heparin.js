export const HEPARIN_CONCENTRATION = 40;
export const SOURCE_WEIGHTS_KG = [40, 50, 60, 70];

// 下次 aPTT：急診 q6h–q8h（Kiwi 2026-11-02）；原表 ICU 為 q8h，連續兩次在治療範圍內可改 QD
export const RECHECK_APTT_HOURS = "6–8";

// 新流速偏高提醒（不擋計算，Kiwi 2026-11-02 決定）：超過 25 U/kg/h（與目前流速提醒同門檻）
// 或超過 2,000 U/h（高醫藥典 Agglutex 2AGG5 VTE「18 U/kg/h (max: 2000 U)」的起始速率上限，40 U/mL 時 = 50 mL/h）。
// 指引與藥典都沒有規定依 aPTT 調整後的速率上限，所以只提醒、不封頂。
export const HIGH_RATE_UNITS_PER_KG_HOUR = 25;
export const HIGH_RATE_UNITS_HOUR = 2000;

// 原表只列整數 aPTT。有小數、落在兩列之間時（例如 75.5 秒），一律歸入「較高」的區間，
// 也就是給較少 heparin、降低出血風險（Kiwi 2026-11-02 決定）。因此每一列以「≤ 該列上限整數」判斷。

export const PROTOCOLS = {
  acs: {
    label: "ACS",
    therapeuticRange: "50–75 秒",
    // 依 2025 ACC/AHA ACS guideline UFH bolus 上限 4,000 U（Kiwi 2026-11-02 決定）
    bolusCapUnits: 4000,
    bands: [
      { label: "< 40 秒", test: (value) => value <= 39, bolusPerKg: 50, rateDeltaPerKg: 2 },
      { label: "40–49 秒", test: (value) => value <= 49, rateDeltaPerKg: 2 },
      { label: "50–75 秒", test: (value) => value <= 75, rateDeltaPerKg: 0 },
      { label: "76–85 秒", test: (value) => value <= 85, rateDeltaPerKg: -2 },
      { label: "86–100 秒", test: (value) => value <= 100, holdMinutes: 30, rateDeltaPerKg: -2 },
      { label: "> 100 秒", test: () => true, holdMinutes: 60, rateDeltaPerKg: -3, notifyPhysician: true },
    ],
  },
  vte: {
    label: "VTE / PE",
    // 原表 70 kg <35 秒：80 U/kg × 70 = 5,600 U，表列 5,000 U
    bolusCapUnits: 5000,
    therapeuticRange: "60–79 秒",
    bands: [
      { label: "< 35 秒", test: (value) => value <= 34, bolusPerKg: 80, rateDeltaPerKg: 4 },
      { label: "35–49 秒", test: (value) => value <= 49, bolusPerKg: 40, rateDeltaPerKg: 2 },
      { label: "50–59 秒", test: (value) => value <= 59, rateDeltaPerKg: 2 },
      { label: "60–79 秒", test: (value) => value <= 79, rateDeltaPerKg: 0 },
      { label: "80–89 秒", test: (value) => value <= 89, rateDeltaPerKg: -2 },
      { label: "90–120 秒", test: (value) => value <= 120, holdMinutes: 30, rateDeltaPerKg: -2 },
      { label: "> 120 秒", test: () => true, holdMinutes: 60, rateDeltaPerKg: -3, notifyPhysician: true },
    ],
  },
};

function roundToIncrement(value, increment) {
  return Math.round((value + Number.EPSILON) / increment) * increment;
}

function roundBolus(units, capUnits) {
  return Math.min(capUnits, roundToIncrement(units, 500));
}

function assertFiniteInRange(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

export function calculateAdjustment({ indication, weightKg, apttSeconds, currentRateMlHour }) {
  const protocol = PROTOCOLS[indication];
  if (!protocol) throw new TypeError("Unknown indication");

  assertFiniteInRange("weightKg", weightKg, 20, 300);
  assertFiniteInRange("apttSeconds", apttSeconds, 1, 300);
  assertFiniteInRange("currentRateMlHour", currentRateMlHour, 0, 200);

  const findBand = (value) => protocol.bands.find(({ test }) => test(value));
  const band = findBand(apttSeconds);
  // 小數 aPTT 落在兩列之間：記下較低那一列，畫面提醒「差距很小時請醫師評估」
  const floorBand = findBand(Math.floor(apttSeconds));
  const bolusUnits = band.bolusPerKg ? roundBolus(weightKg * band.bolusPerKg, protocol.bolusCapUnits) : 0;
  const rawRateDelta = (weightKg * band.rateDeltaPerKg) / HEPARIN_CONCENTRATION;
  // 依表應增減的量（mL/h）
  const protocolDeltaMlHour = Math.sign(rawRateDelta) * roundToIncrement(Math.abs(rawRateDelta), 0.5);
  const newRateMlHour = roundToIncrement(
    Math.max(0, currentRateMlHour + protocolDeltaMlHour),
    0.5,
  );
  // 減量超過目前流速時新流速為 0；此時實際只減了目前流速那麼多
  const clampedToZero = currentRateMlHour + protocolDeltaMlHour < 0;
  const rateDeltaMlHour = clampedToZero ? -currentRateMlHour : protocolDeltaMlHour;

  return {
    indication,
    indicationLabel: protocol.label,
    therapeuticRange: protocol.therapeuticRange,
    bandLabel: band.label,
    // 依 protocol 的 U/kg/h 增減方向判定，不看四捨五入後的 mL/h
    apttStatus: band.rateDeltaPerKg > 0 ? "below" : band.rateDeltaPerKg < 0 ? "above" : "in-range",
    weightKg,
    apttSeconds,
    concentrationUnitsMl: HEPARIN_CONCENTRATION,
    bolusUnits,
    holdMinutes: band.holdMinutes ?? 0,
    rateDeltaMlHour,
    protocolDeltaMlHour,
    clampedToZero,
    // 新流速為 0（等同停止輸注），不論是否被截到 0，都需要醫師評估
    reachesZero: newRateMlHour === 0 && protocolDeltaMlHour < 0,
    betweenBands: floorBand !== band,
    lowerBandLabel: floorBand !== band ? floorBand.label : null,
    recheckApttHours: RECHECK_APTT_HOURS,
    currentRateMlHour,
    currentUnitsHour: currentRateMlHour * HEPARIN_CONCENTRATION,
    newRateMlHour,
    newUnitsHour: newRateMlHour * HEPARIN_CONCENTRATION,
    newUnitsPerKgHour: (newRateMlHour * HEPARIN_CONCENTRATION) / weightKg,
    highNewRate:
      (newRateMlHour * HEPARIN_CONCENTRATION) / weightKg > HIGH_RATE_UNITS_PER_KG_HOUR ||
      newRateMlHour * HEPARIN_CONCENTRATION > HIGH_RATE_UNITS_HOUR,
    notifyPhysician: band.notifyPhysician ?? false,
    isSourceWeight: SOURCE_WEIGHTS_KG.includes(weightKg),
  };
}
