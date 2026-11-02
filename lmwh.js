// Enoxaparin（Clexane）VTE／PE 治療劑量（Kiwi 2026-11-03 決定加入 heparin 頁分頁）
//
// 出處：
//   [美國仿單] Lovenox PI（products.sanofi.us/lovenox/lovenox.pdf）2.2：DVT 有或無 PE 住院治療
//              1 mg/kg q12h 或 1.5 mg/kg q24h SC；2.3：CrCl < 30 改 1 mg/kg q24h；VTE 治療無劑量上限
//   [台灣仿單] 克立生注射劑 衛署藥輸字第022354號（Ref. CCDS V13, Feb 2017）4.2：深層靜脈栓塞（不論是否
//              併發肺栓塞）每次 100 anti-Xa IU/kg（= 1 mg/kg）每日 2 次；未列 1.5 mg/kg q24h；> 100 kg 或
//              < 40 kg 未評估；4.3：CrCl 約 30 以下不建議（應用傳統肝素），30–60 列於不建議使用
//   [高醫藥典] 2CLE20／2CLE60：Ccr < 30 once daily；ESRD avoid；品項 20 mg/0.2 mL、60 mg/0.6 mL
//   [2026 PE 指引] 第 6 條（BMI > 40 減量可能合理，2b）、第 24 條（> 150 kg 或 BMI > 40 監測 anti-Xa 效益未確立）
//   [ASH 2018] Recommendation 1：肥胖者依實際體重給藥，不用封頂劑量

export const ENOXAPARIN_MG_PER_ML = 100;
export const DOSE_ROUNDING_MG = 10; // Kiwi 決定：四捨五入至 10 mg

function roundTo(value, increment) {
  return Math.round((value + Number.EPSILON) / increment) * increment;
}

function assertRange(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

// Cockcroft-Gault（實際體重，Cr 單位 mg/dL）；女性 × 0.85。台灣仿單亦以此公式評估腎功能
export function cockcroftGault({ ageYears, weightKg, serumCrMgDl, sex }) {
  const value = ((140 - ageYears) * weightKg) / (72 * serumCrMgDl);
  return sex === "female" ? value * 0.85 : value;
}

function regimen(key, label, mgPerKg, interval, weightKg) {
  const rawMg = mgPerKg * weightKg;
  const doseMg = roundTo(rawMg, DOSE_ROUNDING_MG);
  return { key, label, mgPerKg, interval, rawMg, doseMg, volumeMl: doseMg / ENOXAPARIN_MG_PER_ML };
}

export function calculateEnoxaparin({ weightKg, heightCm = null, ageYears, sex, serumCrMgDl, onDialysis = false }) {
  assertRange("weightKg", weightKg, 20, 300);
  assertRange("ageYears", ageYears, 18, 120);
  assertRange("serumCrMgDl", serumCrMgDl, 0.1, 20);
  if (sex !== "male" && sex !== "female") throw new TypeError("Unknown sex");
  if (heightCm !== null) assertRange("heightCm", heightCm, 100, 250);

  const crclMlMin = cockcroftGault({ ageYears, weightKg, serumCrMgDl, sex });
  const bmi = heightCm === null ? null : weightKg / (heightCm / 100) ** 2;
  const renal = onDialysis ? "dialysis" : crclMlMin < 30 ? "severe" : crclMlMin < 60 ? "moderate" : "normal";

  let regimens;
  if (renal === "dialysis") {
    regimens = []; // 高醫藥典：ESRD avoid
  } else if (renal === "severe") {
    regimens = [regimen("renal-q24h", "1 mg/kg q24h（CrCl < 30）", 1, "q24h", weightKg)];
  } else {
    regimens = [
      regimen("q12h", "1 mg/kg q12h", 1, "q12h", weightKg),
      regimen("q24h", "1.5 mg/kg q24h", 1.5, "q24h", weightKg),
    ];
  }

  return {
    weightKg,
    heightCm,
    ageYears,
    sex,
    serumCrMgDl,
    onDialysis,
    crclMlMin,
    bmi,
    renal,
    regimens,
    lowWeight: weightKg < 40,
    highWeight: weightKg > 100,
    bmiOver40: bmi !== null && bmi > 40,
    antiXaUncertain: weightKg > 150 || (bmi !== null && bmi > 40),
    // BMI > 40 時，2026 PE 指引支持文字引用的 0.8 mg/kg q12h（僅供醫師評估，不自動採用）
    reducedObeseDoseMg: bmi !== null && bmi > 40 ? roundTo(0.8 * weightKg, DOSE_ROUNDING_MG) : null,
  };
}
