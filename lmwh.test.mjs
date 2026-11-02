// Enoxaparin 分頁的驗算測試。預期值依出處以手算列出，不引用 lmwh.js 的常數。
// 出處縮寫：
//   [美國仿單] Lovenox PI 2.2／2.3（products.sanofi.us/lovenox/lovenox.pdf）
//   [台灣仿單] 克立生注射劑 衛署藥輸字第022354號（Ref. CCDS V13, Feb 2017）4.2、4.3、4.4
//   [高醫藥典] 2CLE20／2CLE60（Kiwi 2026-11-03 提供，未放入 repo）
//   [2026 PE 指引] 2026 AHA/ACC Acute PE Guideline Section 4.2.1 第 6、24 條
//   [ASH 2018] Blood Adv 2018;2:3257 Recommendation 1
//   [CG] Cockcroft DW, Gault MH. Nephron 1976;16:31-41
//   [Kiwi] Kiwi 2026-11-03 決定：放 heparin 分頁、兩種劑量都顯示、四捨五入至 10 mg、不設上限

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calculateEnoxaparin, cockcroftGault } from "./lmwh.js";

const base = { weightKg: 60, heightCm: null, ageYears: 60, sex: "male", serumCrMgDl: 1, onDialysis: false };
const calc = (overrides) => calculateEnoxaparin({ ...base, ...overrides });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

describe("Cockcroft-Gault", () => {
  // 出處：[CG]；[台灣仿單] 4.4 以 µmol/L 表示：男 (140−年齡)×體重/(0.814×Cr)，女 ×0.85
  test("男 60 歲 70 kg Cr 1.0 = 77.8；女 × 0.85 = 66.1", () => {
    close(cockcroftGault({ ageYears: 60, weightKg: 70, serumCrMgDl: 1, sex: "male" }), (80 * 70) / 72);
    close(cockcroftGault({ ageYears: 60, weightKg: 70, serumCrMgDl: 1, sex: "female" }), ((80 * 70) / 72) * 0.85);
  });

  test("與台灣仿單 µmol/L 版公式一致（誤差 < 0.1%）", () => {
    for (const [age, wt, cr] of [[30, 50, 0.6], [60, 70, 1], [85, 45, 2.3], [45, 120, 4]]) {
      const tw = ((140 - age) * wt) / (0.814 * cr * 88.4);
      const ours = cockcroftGault({ ageYears: age, weightKg: wt, serumCrMgDl: cr, sex: "male" });
      assert.ok(Math.abs(ours - tw) / tw < 0.001, `${age} ${wt} ${cr}`);
    }
  });
});

describe("劑量：1 mg/kg q12h 與 1.5 mg/kg q24h，四捨五入至 10 mg", () => {
  // 出處：[美國仿單] 2.2；[台灣仿單] 4.2（100 anti-Xa IU/kg = 1 mg/kg，每日 2 次）；[Kiwi] 四捨五入至 10 mg
  const cases = [
    // [體重, q12h 劑量, q24h 劑量]
    [40, 40, 60],
    [45, 50, 70], // 45 → 50（剛好一半進位）；67.5 → 70
    [60, 60, 90],
    [63, 60, 90], // 94.5 → 90
    [64.9, 60, 100], // 97.35 → 100
    [65, 70, 100], // 97.5 → 100
    [70, 70, 110], // 105 → 110
    [84, 80, 130], // 126 → 130
    [100, 100, 150],
    [150, 150, 230], // 225 → 230
  ];
  for (const [kg, q12, q24] of cases) {
    test(`${kg} kg → q12h ${q12} mg、q24h ${q24} mg`, () => {
      const out = calc({ weightKg: kg, ageYears: 30 });
      assert.equal(out.renal, "normal");
      assert.deepEqual(out.regimens.map((r) => [r.key, r.interval, r.doseMg]), [["q12h", "q12h", q12], ["q24h", "q24h", q24]]);
      close(out.regimens[0].rawMg, kg);
      close(out.regimens[1].rawMg, kg * 1.5);
      for (const r of out.regimens) close(r.volumeMl, r.doseMg / 100); // 100 mg/mL
    });
  }

  // 出處：[美國仿單]、[台灣仿單] 都沒有 VTE 治療劑量上限；[ASH 2018] 不封頂；[Kiwi] 不設上限
  test("不設上限：300 kg → 300 mg q12h、450 mg q24h", () => {
    const out = calc({ weightKg: 300, ageYears: 30 });
    assert.deepEqual(out.regimens.map((r) => r.doseMg), [300, 450]);
  });
});

describe("腎功能", () => {
  // 出處：[美國仿單] 2.3、[高醫藥典]：CrCl < 30 改 1 mg/kg q24h；[高醫藥典] ESRD avoid
  // 男 60 歲 54 kg：CrCl = 80×54/(72×Cr) = 60/Cr
  test("CrCl 剛好 30 不算重度；29.9 算重度，只給 1 mg/kg q24h", () => {
    const at30 = calc({ weightKg: 54, serumCrMgDl: 2 });
    close(at30.crclMlMin, 30, 1e-9);
    assert.equal(at30.renal, "moderate");
    assert.equal(at30.regimens.length, 2);
    const below = calc({ weightKg: 54, serumCrMgDl: 2.01 });
    assert.equal(below.renal, "severe");
    assert.deepEqual(below.regimens.map((r) => [r.key, r.mgPerKg, r.interval, r.doseMg]), [["renal-q24h", 1, "q24h", 50]]);
  });

  test("CrCl 剛好 60 為正常；59.4 為 30–60", () => {
    assert.equal(calc({ weightKg: 54, serumCrMgDl: 1 }).renal, "normal");
    assert.equal(calc({ weightKg: 54, serumCrMgDl: 1.01 }).renal, "moderate");
  });

  test("透析／ESRD：不給劑量（即使 CrCl 算出來很高）", () => {
    const out = calc({ ageYears: 30, onDialysis: true });
    assert.equal(out.renal, "dialysis");
    assert.deepEqual(out.regimens, []);
  });

  test("女性 × 0.85 會改變分級：女 60 歲 54 kg Cr 1.8 → 28.3（重度）；男 33.3（30–60）", () => {
    assert.equal(calc({ weightKg: 54, serumCrMgDl: 1.8, sex: "male" }).renal, "moderate");
    assert.equal(calc({ weightKg: 54, serumCrMgDl: 1.8, sex: "female" }).renal, "severe");
  });
});

describe("體重與 BMI 提醒", () => {
  // 出處：[台灣仿單] 4.2：> 100 kg 或 < 40 kg 未評估；[2026 PE 指引] 第 6、24 條
  test("體重門檻：< 40 kg、> 100 kg、> 150 kg（剛好等於不提醒）", () => {
    assert.equal(calc({ weightKg: 39.9 }).lowWeight, true);
    assert.equal(calc({ weightKg: 40 }).lowWeight, false);
    assert.equal(calc({ weightKg: 100 }).highWeight, false);
    assert.equal(calc({ weightKg: 100.1 }).highWeight, true);
    assert.equal(calc({ weightKg: 150 }).antiXaUncertain, false);
    assert.equal(calc({ weightKg: 150.1 }).antiXaUncertain, true);
  });

  test("BMI > 40：提醒並附 0.8 mg/kg 參考值；剛好 40 不提醒；沒填身高不算 BMI", () => {
    const obese = calc({ weightKg: 120, heightCm: 170 }); // 41.5
    close(obese.bmi, 120 / 1.7 ** 2);
    assert.equal(obese.bmiOver40, true);
    assert.equal(obese.antiXaUncertain, true);
    assert.equal(obese.reducedObeseDoseMg, 100); // 0.8 × 120 = 96 → 100
    assert.equal(obese.regimens[0].doseMg, 120, "主劑量仍依實際體重，不自動減量");
    const at40 = calc({ weightKg: 90, heightCm: 150 }); // 90 / 2.25 = 40
    assert.equal(at40.bmiOver40, false);
    assert.equal(at40.reducedObeseDoseMg, null);
    const noHeight = calc({ weightKg: 120 });
    assert.equal(noHeight.bmi, null);
    assert.equal(noHeight.bmiOver40, false);
  });
});

describe("無效輸入", () => {
  // 出處：頁面欄位 min／max（index.html LMWH 分頁）；[台灣仿單] 僅適用成人
  test("體重、年齡、Cr、身高超出範圍或非數字都拒絕", () => {
    const bad = [
      { weightKg: 19.9 }, { weightKg: 300.1 }, { weightKg: NaN }, { weightKg: "60" },
      { ageYears: 17 }, { ageYears: 121 }, { ageYears: undefined },
      { serumCrMgDl: 0.09 }, { serumCrMgDl: 20.1 }, { serumCrMgDl: 0 },
      { heightCm: 99 }, { heightCm: 250.1 }, { heightCm: NaN },
    ];
    for (const o of bad) assert.throws(() => calc(o), RangeError, JSON.stringify(o));
  });

  test("性別缺漏或未知都拒絕", () => {
    for (const sex of [undefined, null, "", "M", "男"]) assert.throws(() => calc({ sex }), TypeError, String(sex));
  });
});
