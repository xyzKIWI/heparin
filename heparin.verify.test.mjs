// 驗算測試：只測試、不改任何劑量／濃度／切點／上限／暫停時間。
//
// 「預期值」一律由本檔自行依出處重算（整數運算），不引用 heparin.js 的 PROTOCOLS，
// 避免拿程式自己去驗證自己。出處縮寫：
//   [頁面表]   index.html「查看高醫調整規則」表格（第 147–159 行）
//   [頁面註]   index.html 頁尾「臨床安全」段落（第 183–185 行）
//   [頁面濃度] index.html 藥袋濃度提示（第 100 行）
//   [頁面欄位] index.html 三個輸入欄位的 min／max／step（第 114–122 行）
//   [README]   README.md「計算規則」段落
//   [原表照片] 高醫 KMUH MICU Heparin Infusion Protocol 原表照片（Kiwi 2026-11-02 提供，未放入 repo）；
//              本檔第 0 節逐格轉錄 40／50／60／70 kg 的調整列
//   [原表測試] heparin.test.mjs 既有測試的 40／50／60／70 kg 案例，已與 [原表照片] 核對一致
//   [2025 指引] 2025 ACC/AHA/ACEP/NAEMSP/SCAI ACS Guideline, Section 4.4 Parenteral
//              Anticoagulation 表格（https://www.ahajournals.org/doi/10.1161/CIR.0000000000001309）
// 找不到可驗證出處的項目，註解寫「未找到可驗證範例」，測試只鎖住目前行為以防回歸。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { calculateAdjustment, HEPARIN_CONCENTRATION, PROTOCOLS, SOURCE_WEIGHTS_KG } from "./heparin.js";

const HTML = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const README = readFileSync(new URL("./README.md", import.meta.url), "utf8");

const calc = (indication, weightKg, apttSeconds, currentRateMlHour) =>
  calculateAdjustment({ indication, weightKg, apttSeconds, currentRateMlHour });

// ---------------------------------------------------------------------------
// 預期值（依 [頁面表] 手動轉錄，整數 aPTT 上下限皆含）
// lo/hi 為 null 代表「<」或「>」開放端
// ---------------------------------------------------------------------------
const EXPECTED = {
  acs: {
    label: "ACS",
    therapeuticRange: "50–75 秒",
    bands: [
      { lo: null, hi: 39, label: "< 40 秒", bolusPerKg: 50, perKg: 2, hold: 0, notify: false },
      { lo: 40, hi: 49, label: "40–49 秒", bolusPerKg: 0, perKg: 2, hold: 0, notify: false },
      { lo: 50, hi: 75, label: "50–75 秒", bolusPerKg: 0, perKg: 0, hold: 0, notify: false },
      { lo: 76, hi: 85, label: "76–85 秒", bolusPerKg: 0, perKg: -2, hold: 0, notify: false },
      { lo: 86, hi: 100, label: "86–100 秒", bolusPerKg: 0, perKg: -2, hold: 30, notify: false },
      { lo: 101, hi: null, label: "> 100 秒", bolusPerKg: 0, perKg: -3, hold: 60, notify: true },
    ],
  },
  vte: {
    label: "VTE / PE",
    therapeuticRange: "60–79 秒",
    bands: [
      { lo: null, hi: 34, label: "< 35 秒", bolusPerKg: 80, perKg: 4, hold: 0, notify: false },
      { lo: 35, hi: 49, label: "35–49 秒", bolusPerKg: 40, perKg: 2, hold: 0, notify: false },
      { lo: 50, hi: 59, label: "50–59 秒", bolusPerKg: 0, perKg: 2, hold: 0, notify: false },
      { lo: 60, hi: 79, label: "60–79 秒", bolusPerKg: 0, perKg: 0, hold: 0, notify: false },
      { lo: 80, hi: 89, label: "80–89 秒", bolusPerKg: 0, perKg: -2, hold: 0, notify: false },
      { lo: 90, hi: 120, label: "90–120 秒", bolusPerKg: 0, perKg: -2, hold: 30, notify: false },
      { lo: 121, hi: null, label: "> 120 秒", bolusPerKg: 0, perKg: -3, hold: 60, notify: true },
    ],
  },
};

const CONCENTRATION = 40; // [頁面濃度] 20,000 U / 500 mL
// Bolus 上限：ACS 4,000 U（[2025 指引] loading dose max 4000 IU；Kiwi 2026-11-02 決定 ACS 上限都改為 4,000）
//            VTE 5,000 U（[原表照片] 70 kg <35 秒：80 U/kg × 70 = 5,600 U，表列 5,000 U）
const BOLUS_CAP = { acs: 4000, vte: 5000 };
const BOLUS_STEP = 500; // [README]、[頁面註]

// 整數 aPTT → 依 [頁面表] 找區間
function expectedBand(indication, aptt) {
  return EXPECTED[indication].bands.find(
    ({ lo, hi }) => (lo === null || aptt >= lo) && (hi === null || aptt <= hi),
  );
}

// 以「十分之一公斤」整數做精確運算，避免浮點誤差影響預期值。
// [README]：流速以 40 U/mL 換算，四捨五入至 0.5 mL/h。
// 減量時以「減少的量」四捨五入（例如 5.25 → 減 5.5），依 [原表測試] 70 kg、>120 秒 = −5.5 mL/h。
function expectedDeltaMlHour(weightKg, perKg) {
  if (perKg === 0) return 0;
  const tenths = Math.round(weightKg * 10);
  // mL/h = tenths × |perKg| / 10 / 40；以 0.5 mL/h 為單位 = tenths × |perKg| / 200，四捨五入
  const halves = Math.floor((2 * tenths * Math.abs(perKg) + 200) / 400);
  return Math.sign(perKg) * halves * 0.5;
}

// [README]：Bolus 四捨五入至 500 U，上限 ACS 4,000 U、VTE / PE 5,000 U
function expectedBolus(weightKg, perKg, cap) {
  if (!perKg) return 0;
  const tenths = Math.round(weightKg * 10);
  const steps = Math.floor((2 * tenths * perKg + 10 * BOLUS_STEP) / (20 * BOLUS_STEP));
  return Math.min(cap, steps * BOLUS_STEP);
}

// [README]：調整後流速不低於 0 mL/h
function expectedNewRate(currentRate, delta) {
  return Math.max(0, currentRate + delta);
}

function assertMatchesExpected(indication, weightKg, aptt, rate, band = expectedBand(indication, aptt)) {
  const out = calc(indication, weightKg, aptt, rate);
  const delta = expectedDeltaMlHour(weightKg, band.perKg);
  const ctx = `${indication} ${weightKg} kg aPTT ${aptt} rate ${rate}`;
  assert.equal(out.bandLabel, band.label, `${ctx} bandLabel`);
  assert.equal(out.bolusUnits, expectedBolus(weightKg, band.bolusPerKg, BOLUS_CAP[indication]), `${ctx} bolusUnits`);
  assert.equal(out.holdMinutes, band.hold, `${ctx} holdMinutes`);
  assert.equal(out.notifyPhysician, band.notify, `${ctx} notifyPhysician`);
  assert.equal(out.rateDeltaMlHour, delta, `${ctx} rateDeltaMlHour`);
  assert.equal(out.newRateMlHour, expectedNewRate(rate, delta), `${ctx} newRateMlHour`);
  assert.equal(out.newUnitsHour, out.newRateMlHour * CONCENTRATION, `${ctx} newUnitsHour`);
  return out;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const normLabel = (s) => s.replace(/\s|秒/g, "");

// ===========================================================================
describe("0. 高醫原表照片逐格比對", () => {
  // 出處：[原表照片]「高醫內科加護病房 靜脈注射抗凝血藥物劑量調整指引 KMUH MICU Heparin Infusion Protocol」
  //       A. Heparin for Thromboembolism、B. Heparin for ACS & Stroke（Kiwi 於 2026-11-02 提供，照片未放入 repo）
  // 以下逐格轉錄 40／50／60／70 kg 的 aPTT 調整列（不含 Initial dosing 列，本工具不計算初始劑量）。
  // 每格：[bolus U, mL/h 增減（負為 ↓）, 暫停分鐘, 是否「並請告知醫師」]
  const PHOTO = {
    vte: [
      // aPTT 代表值, 列名, 40 kg, 50 kg, 60 kg, 70 kg
      [30, "< 35 s", [3000, 4, 0, false], [4000, 5, 0, false], [5000, 6, 0, false], [5000, 7, 0, false]],
      [40, "35 ~ 49 s", [1500, 2, 0, false], [2000, 2.5, 0, false], [2500, 3, 0, false], [3000, 3.5, 0, false]],
      [55, "50 ~ 59 s", [0, 2, 0, false], [0, 2.5, 0, false], [0, 3, 0, false], [0, 3.5, 0, false]],
      [70, "60 ~ 79 s", [0, 0, 0, false], [0, 0, 0, false], [0, 0, 0, false], [0, 0, 0, false]],
      [85, "80 ~ 89 s", [0, -2, 0, false], [0, -2.5, 0, false], [0, -3, 0, false], [0, -3.5, 0, false]],
      [100, "90 ~ 120 s", [0, -2, 30, false], [0, -2.5, 30, false], [0, -3, 30, false], [0, -3.5, 30, false]],
      [130, "> 120 s", [0, -3, 60, true], [0, -4, 60, true], [0, -4.5, 60, true], [0, -5.5, 60, true]],
    ],
    acs: [
      [30, "< 40 s", [2000, 2, 0, false], [2500, 2.5, 0, false], [3000, 3, 0, false], [3500, 3.5, 0, false]],
      [45, "40 ~ 49 s", [0, 2, 0, false], [0, 2.5, 0, false], [0, 3, 0, false], [0, 3.5, 0, false]],
      [60, "50 ~ 75 s", [0, 0, 0, false], [0, 0, 0, false], [0, 0, 0, false], [0, 0, 0, false]],
      [80, "76 ~ 85 s", [0, -2, 0, false], [0, -2.5, 0, false], [0, -3, 0, false], [0, -3.5, 0, false]],
      [90, "86 ~ 100 s", [0, -2, 30, false], [0, -2.5, 30, false], [0, -3, 30, false], [0, -3.5, 30, false]],
      [110, "> 100 s", [0, -3, 60, true], [0, -4, 60, true], [0, -4.5, 60, true], [0, -5.5, 60, true]],
    ],
  };

  for (const [indication, rows] of Object.entries(PHOTO)) {
    for (const [aptt, rowLabel, ...cells] of rows) {
      test(`原表 ${indication === "vte" ? "Thromboembolism" : "ACS & Stroke"}「${rowLabel}」40／50／60／70 kg`, () => {
        cells.forEach(([bolus, delta, hold, notify], i) => {
          const kg = [40, 50, 60, 70][i];
          const out = calc(indication, kg, aptt, 30);
          assert.deepEqual(
            [out.bolusUnits, out.rateDeltaMlHour, out.holdMinutes, out.notifyPhysician],
            [bolus, delta, hold, notify],
            `${kg} kg`,
          );
          assert.equal(normLabel(out.bandLabel), normLabel(rowLabel.replace(" ~ ", "–").replace(" s", "")), `${kg} kg 區間`);
        });
      });
    }
  }

  // 出處：[原表照片] 兩張表的「泡法：heparin 20000U in N/S 500ml → 40U/ml」
  test("原表濃度 20000 U / 500 mL = 40 U/mL", () => {
    assert.equal(20000 / 500, HEPARIN_CONCENTRATION);
  });

  // 出處：[原表照片] 頁尾「f/u APTT q8h（若連續兩次 APTT 均在治療範圍內，可以改 QD 監測）；f/u Hb and Plt regularly (initially, QD)」
  test("原表重抽 aPTT q8h、連續兩次在範圍內改 QD，與頁尾文字一致", () => {
    assert.match(HTML, /原表為 q8h、連續兩次治療範圍可改 QD，並追蹤 Hb 與 platelet/);
  });
});

// ===========================================================================
describe("1. 程式規則與頁面文字一致", () => {
  // 出處：[頁面表]。把頁面上給人看的表格逐列解析，確認程式用的規則和表格一字不差。
  test("頁面規則表每一列與 heparin.js 的區間、bolus、暫停、增減、通知醫師完全一致", () => {
    const tbody = HTML.match(/<summary>查看高醫調整規則<\/summary>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1];
    const rows = [...tbody.matchAll(/<tr>(?:<td rowspan="\d+">([^<]+)<\/td>)?<td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
    const parsed = { acs: [], vte: [] };
    let current = null;
    for (const [, group, aptt, action] of rows) {
      if (group) current = group.trim() === "ACS" ? "acs" : "vte";
      const text = decode(action);
      const rate = text.match(/(增加|減少) (\d+) U\/kg\/h/);
      parsed[current].push({
        label: normLabel(decode(aptt)),
        bolusPerKg: Number(text.match(/Bolus (\d+) U\/kg/)?.[1] ?? 0),
        perKg: rate ? (rate[1] === "增加" ? 1 : -1) * Number(rate[2]) : (assert.match(text, /不調整/), 0),
        hold: Number(text.match(/暫停 (\d+) 分/)?.[1] ?? 0),
        notify: text.includes("通知醫師"),
      });
    }
    for (const indication of ["acs", "vte"]) {
      const code = PROTOCOLS[indication].bands.map((b) => ({
        label: normLabel(b.label),
        bolusPerKg: b.bolusPerKg ?? 0,
        perKg: b.rateDeltaPerKg,
        hold: b.holdMinutes ?? 0,
        notify: b.notifyPhysician ?? false,
      }));
      assert.deepEqual(code, parsed[indication], indication);
      // 本檔手動轉錄的 EXPECTED 也必須與頁面表一致
      assert.deepEqual(
        EXPECTED[indication].bands.map(({ label, bolusPerKg, perKg, hold, notify }) => ({
          label: normLabel(label), bolusPerKg, perKg, hold, notify,
        })),
        parsed[indication],
      );
    }
  });

  // 出處：[頁面濃度] 20,000 U / NS 500 mL ＝ 40 U/mL；[README] 使用方式第 1 點
  test("濃度 40 U/mL 與藥袋 20,000 U / 500 mL 相符", () => {
    assert.match(HTML, /Heparin 20,000 U \/ NS 500 mL ＝ 40 U\/mL/);
    assert.equal(20000 / 500, CONCENTRATION);
    assert.equal(HEPARIN_CONCENTRATION, CONCENTRATION);
    assert.match(HTML, /濃度 40 U\/mL；須人工核對後執行/);
  });

  // 出處：[頁面表]「不調整」那一列即治療範圍；README「計算規則」
  test("治療範圍標示等於「不調整」的區間", () => {
    for (const indication of ["acs", "vte"]) {
      const out = calc(indication, 60, 70, 20);
      assert.equal(out.therapeuticRange, EXPECTED[indication].therapeuticRange);
      const inRange = EXPECTED[indication].bands.find((b) => b.perKg === 0);
      assert.equal(normLabel(inRange.label), normLabel(EXPECTED[indication].therapeuticRange));
    }
  });

  // 出處：[README]、[頁面註] 的文字敘述
  test("README 與頁尾的捨入／上限敘述存在且一致", () => {
    assert.match(README, /四捨五入至 0\.5 mL\/h/);
    assert.match(README, /Bolus 四捨五入至 500 U。上限：ACS 4,000 U（依 2025 ACC\/AHA ACS Guideline）；VTE \/ PE 5,000 U（原表）/);
    assert.match(README, /調整後流速不低於 0 mL\/h/);
    assert.match(HTML, /流速四捨五入至 0\.5 mL\/h，bolus 四捨五入至 500 U，上限 ACS 4,000 U（依 2025 ACC\/AHA 指引）、VTE \/ PE 5,000 U/);
  });

  // 出處：[頁面欄位] 與 heparin.js 的 assertFiniteInRange；兩邊範圍不一致時頁面會出現「通過驗證卻算不出來」
  test("頁面輸入欄位 min／max 與計算模組的接受範圍一致", () => {
    const attr = (id) => {
      const tag = HTML.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
      return { min: Number(tag.match(/min="([^"]+)"/)[1]), max: Number(tag.match(/max="([^"]+)"/)[1]) };
    };
    const ranges = { weight: [20, 300], aptt: [1, 300], "current-rate": [0, 200] };
    for (const [id, [min, max]] of Object.entries(ranges)) {
      assert.deepEqual(attr(id), { min, max }, id);
    }
    // 範圍內最小值、最大值都要算得出來
    assert.doesNotThrow(() => calc("acs", 20, 1, 0));
    assert.doesNotThrow(() => calc("vte", 300, 300, 200));
  });

  // 出處：[頁面註]「原表為 q8h、連續兩次治療範圍可改 QD，並追蹤 Hb 與 platelet」
  // 重抽 aPTT 的時間只以頁尾文字呈現，計算結果不含重抽時間，因此只能檢查文字存在。
  test("重抽 aPTT 時間：頁尾文字有 q8h 與連續兩次治療範圍改 QD", () => {
    assert.match(HTML, /原表為 q8h、連續兩次治療範圍可改 QD，並追蹤 Hb 與 platelet/);
    const out = calc("acs", 60, 60, 21);
    assert.equal("recheckHours" in out, false, "計算結果目前沒有重抽時間欄位（報告記錄）");
  });
});

// ===========================================================================
describe("2. aPTT 區間：每區至少一例，切點上下各測一次", () => {
  // 出處：[頁面表]。整數 aPTT 上下限皆含，例如 ACS「40–49」含 40 與 49。
  const cases = {
    acs: [1, 20, 39, 40, 45, 49, 50, 60, 75, 76, 80, 85, 86, 95, 100, 101, 150, 300],
    vte: [1, 20, 34, 35, 42, 49, 50, 55, 59, 60, 70, 79, 80, 85, 89, 90, 105, 120, 121, 200, 300],
  };
  for (const [indication, values] of Object.entries(cases)) {
    for (const aptt of values) {
      test(`${indication} aPTT ${aptt} 秒 → ${expectedBand(indication, aptt).label}`, () => {
        assertMatchesExpected(indication, 60, aptt, 20);
      });
    }
  }

  // 出處：[頁面表]，以 40／50／60／70 kg 掃過 1–300 秒所有整數
  test("所有整數 aPTT（1–300 秒）× 原表體重 40／50／60／70 kg 都與頁面表一致", () => {
    for (const indication of ["acs", "vte"]) {
      for (const weight of SOURCE_WEIGHTS_KG) {
        for (let aptt = 1; aptt <= 300; aptt += 1) assertMatchesExpected(indication, weight, aptt, 20);
      }
    }
  });

  // 出處：[頁面表] 由上到下 aPTT 越高、流速增減越少、暫停越久（單調性）
  test("aPTT 越高，增減量不會變多、暫停不會變短（0.1 秒步進掃描）", () => {
    for (const indication of ["acs", "vte"]) {
      let prev = calc(indication, 60, 1, 20);
      for (let t = 11; t <= 3000; t += 1) {
        const out = calc(indication, 60, t / 10, 20);
        assert.ok(out.rateDeltaMlHour <= prev.rateDeltaMlHour, `${indication} ${t / 10}`);
        assert.ok(out.holdMinutes >= prev.holdMinutes, `${indication} ${t / 10}`);
        prev = out;
      }
    }
  });

  // 未找到可驗證範例：頁面表只列整數，原表對兩個整數之間的小數沒有規定。
  // 以下鎖住「目前」行為以防回歸，並列入報告「邊界行為可疑」請 Kiwi 判斷。
  // 目前規則：ACS 75.5、85.5 歸到「較高」區間；其餘（含 VTE 79.5、89.5）歸到「較低」區間。
  const gapCases = [
    ["acs", 39.5, "< 40 秒"],
    ["acs", 49.5, "40–49 秒"],
    ["acs", 75.5, "76–85 秒"],
    ["acs", 85.5, "86–100 秒"],
    ["acs", 100.5, "> 100 秒"],
    ["vte", 34.5, "< 35 秒"],
    ["vte", 49.5, "35–49 秒"],
    ["vte", 59.5, "50–59 秒"],
    ["vte", 79.5, "60–79 秒"],
    ["vte", 89.5, "80–89 秒"],
    ["vte", 120.5, "> 120 秒"],
  ];
  for (const [indication, aptt, label] of gapCases) {
    test(`小數 aPTT ${indication} ${aptt} 秒目前歸在 ${label}（未找到可驗證範例）`, () => {
      assert.equal(calc(indication, 60, aptt, 20).bandLabel, label);
    });
  }
});

// ===========================================================================
describe("3. 體重邊界與 bolus 上限", () => {
  // 出處：[原表測試] 宣稱為原始照片的 40／50／60／70 kg 表列值（此處重新列出以便對照）
  test("原表體重 40／50／60／70 kg 的既有表列案例", () => {
    const table = [
      // [indication, kg, aPTT, rate, bolus, delta, hold]
      ["vte", 40, 34, 18, 3000, 4, 0],
      ["vte", 50, 40, 22, 2000, 2.5, 0],
      ["vte", 60, 55, 26, 0, 3, 0],
      ["vte", 70, 70, 28, 0, 0, 0],
      ["vte", 60, 85, 26, 0, -3, 0],
      ["vte", 50, 100, 22, 0, -2.5, 30],
      ["vte", 70, 121, 28, 0, -5.5, 60],
      ["acs", 40, 39, 14, 2000, 2, 0],
      ["acs", 50, 45, 17, 0, 2.5, 0],
      ["acs", 60, 60, 21, 0, 0, 0],
      ["acs", 70, 80, 24, 0, -3.5, 0],
      ["acs", 40, 90, 14, 0, -2, 30],
      ["acs", 50, 101, 17, 0, -4, 60],
    ];
    for (const [ind, kg, aptt, rate, bolus, delta, hold] of table) {
      const out = assertMatchesExpected(ind, kg, aptt, rate);
      assert.deepEqual([out.bolusUnits, out.rateDeltaMlHour, out.holdMinutes], [bolus, delta, hold], `${ind} ${kg} ${aptt}`);
      assert.equal(out.isSourceWeight, true);
    }
  });

  // 出處：[頁面欄位] 體重 min=20；[頁面表] U/kg 係數；[README] 捨入規則
  test("極輕 20 kg（可輸入最小值）", () => {
    const acs = assertMatchesExpected("acs", 20, 30, 5);
    assert.deepEqual([acs.bolusUnits, acs.rateDeltaMlHour, acs.newRateMlHour], [1000, 1, 6]); // 50×20=1000 U；2×20/40=1
    const vte = assertMatchesExpected("vte", 20, 30, 9);
    assert.deepEqual([vte.bolusUnits, vte.rateDeltaMlHour, vte.newRateMlHour], [1500, 2, 11]); // 80×20=1600→1500；4×20/40=2
    const vteHigh = assertMatchesExpected("vte", 20, 130, 9);
    assert.deepEqual([vteHigh.rateDeltaMlHour, vteHigh.newRateMlHour], [-1.5, 7.5]); // 3×20/40=1.5
    assert.equal(acs.isSourceWeight, false);
  });

  // 出處：ACS 上限 4,000 U：[2025 指引]（Kiwi 2026-11-02 決定）；VTE 上限 5,000 U：[原表照片]、[README]
  // 計算點 = 上限 ÷ U/kg
  test("bolus 上限 ACS 4,000 U、VTE 5,000 U：剛好到上限、超過上限都封頂", () => {
    // ACS 50 U/kg：80 kg 剛好 4,000；75 kg（3,750）起四捨五入到 4,000
    assert.equal(calc("acs", 70, 30, 20).bolusUnits, 3500); // 原表 70 kg = 3,500 U，不受影響
    assert.equal(calc("acs", 74.9, 30, 20).bolusUnits, 3500); // 3745 → 3500
    assert.equal(calc("acs", 75, 30, 20).bolusUnits, 4000); // 3750 → 4000（剛好一半，進位）
    assert.equal(calc("acs", 80, 30, 20).bolusUnits, 4000);
    assert.equal(calc("acs", 85, 30, 20).bolusUnits, 4000); // 4250 → 四捨五入 4500 → 封頂 4000
    assert.equal(calc("acs", 95, 30, 20).bolusUnits, 4000); // 4750 → 5000 → 封頂 4000
    assert.equal(calc("acs", 150, 30, 20).bolusUnits, 4000); // 7500 → 封頂
    assert.equal(calc("acs", 300, 30, 20).bolusUnits, 4000); // 15000 → 封頂
    // VTE 80 U/kg：62.5 kg 剛好 5,000
    assert.equal(calc("vte", 59.3, 30, 20).bolusUnits, 4500); // 4744 → 4500
    assert.equal(calc("vte", 59.4, 30, 20).bolusUnits, 5000); // 4752 → 5000
    assert.equal(calc("vte", 62.5, 30, 20).bolusUnits, 5000);
    assert.equal(calc("vte", 300, 30, 20).bolusUnits, 5000); // 24000 → 封頂
    // VTE 40 U/kg：125 kg 剛好 5,000
    assert.equal(calc("vte", 118.7, 40, 20).bolusUnits, 4500); // 4748 → 4500
    assert.equal(calc("vte", 118.8, 40, 20).bolusUnits, 5000); // 4752 → 5000
    assert.equal(calc("vte", 125, 40, 20).bolusUnits, 5000);
    assert.equal(calc("vte", 300, 40, 20).bolusUnits, 5000); // 12000 → 封頂
  });

  // 出處：[頁面欄位] 體重 max=300；[頁面表] U/kg 係數
  // 流速增減沒有上限（README／頁面皆未提），報告列為「沒有封頂保護」。
  test("極重 300 kg：bolus 封頂，但流速增減不封頂（記錄目前行為）", () => {
    const up = assertMatchesExpected("vte", 300, 30, 200);
    assert.equal(up.bolusUnits, 5000);
    assert.equal(up.rateDeltaMlHour, 30); // 4×300/40
    assert.equal(up.newRateMlHour, 230); // 超過輸入欄位上限 200 mL/h
    assert.equal(up.newUnitsHour, 9200);
    const down = assertMatchesExpected("acs", 300, 150, 100);
    assert.equal(down.rateDeltaMlHour, -22.5); // 3×300/40
  });

  // 出處：[頁面欄位] 體重 20–300
  test("體重超出 20–300 kg 會被拒絕", () => {
    for (const w of [19.9, 300.1, 0, -60, 1000]) {
      assert.throws(() => calc("acs", w, 60, 20), RangeError, String(w));
    }
  });

  // 出處：[頁面表] 最小 U/kg/h 係數為 2，在最輕 20 kg 下 = 1 mL/h；確認非零區間不會被捨入成 0
  test("可輸入範圍內，需要調整的區間不會被四捨五入成「不調整」", () => {
    for (const indication of ["acs", "vte"]) {
      for (const band of EXPECTED[indication].bands.filter((b) => b.perKg !== 0)) {
        for (let t = 200; t <= 3000; t += 1) {
          const aptt = band.lo ?? band.hi;
          assert.notEqual(calc(indication, t / 10, aptt, 50).rateDeltaMlHour, 0, `${indication} ${band.label} ${t / 10} kg`);
        }
      }
    }
  });
});

// ===========================================================================
describe("4. 單位換算 U/kg/h → U/h → mL/h 與進位方式", () => {
  // 出處：[README]「流速以 40 U/mL 換算，四捨五入至 0.5 mL/h」、「Bolus 四捨五入至 500 U，上限 5,000 U」
  // 以十分之一公斤整數精確運算當作預期值，掃描 20.0–300.0 kg 每 0.1 kg（頁面 step=0.1）。
  test("20.0–300.0 kg 每 0.1 kg × 每個區間：bolus、mL/h 增減、新流速、U/h 全部吻合", () => {
    for (const indication of ["acs", "vte"]) {
      for (const band of EXPECTED[indication].bands) {
        const aptt = band.lo ?? band.hi;
        for (let t = 200; t <= 3000; t += 1) {
          const w = t / 10;
          const out = calc(indication, w, aptt, 100);
          assert.equal(out.bolusUnits, expectedBolus(w, band.bolusPerKg, BOLUS_CAP[indication]), `${indication} ${band.label} ${w} kg bolus`);
          assert.equal(out.rateDeltaMlHour, expectedDeltaMlHour(w, band.perKg), `${indication} ${band.label} ${w} kg delta`);
          assert.equal(out.newRateMlHour, expectedNewRate(100, out.rateDeltaMlHour));
          assert.equal(out.newUnitsHour, out.newRateMlHour * 40);
          assert.equal(out.currentUnitsHour, 100 * 40);
          // 結果一定是 0.5 mL/h 的倍數、bolus 一定是 500 U 的倍數
          assert.equal((out.newRateMlHour * 2) % 1, 0);
          assert.equal(out.bolusUnits % 500, 0);
        }
      }
    }
  });

  // 出處：[README] 四捨五入；剛好一半時的進位方向
  test("剛好一半時進位：增量 2.25 → 2.5、減量 2.25 → 減 2.5、5.25 → 減 5.5", () => {
    assert.equal(calc("acs", 45, 45, 20).rateDeltaMlHour, 2.5); // 2×45/40 = 2.25
    assert.equal(calc("acs", 45, 80, 20).rateDeltaMlHour, -2.5); // 減量以絕對值進位
    assert.equal(calc("acs", 70, 101, 24).rateDeltaMlHour, -5.5); // 3×70/40 = 5.25，[原表測試] 同為 −5.5
    assert.equal(calc("acs", 55, 45, 20).rateDeltaMlHour, 3); // 2.75 → 3
    assert.equal(calc("acs", 45.1, 45, 20).rateDeltaMlHour, 2.5); // 2.255 → 2.5
    assert.equal(calc("acs", 44.9, 45, 20).rateDeltaMlHour, 2); // 2.245 → 2
  });

  // 出處：[README] 四捨五入至 0.5 mL/h。頁面目前流速 step=0.5，所以新流速永遠是 0.5 的倍數；
  // 但模組本身也接受非 0.5 倍數的目前流速（例如 pump 上 17.3 mL/h），此時新流速再四捨五入。
  test("目前流速不是 0.5 的倍數時（模組層級），新流速仍捨入到 0.5 mL/h", () => {
    const out = calc("acs", 60, 45, 17.3); // 17.3 + 3 = 20.3 → 20.5
    assert.equal(out.rateDeltaMlHour, 3);
    assert.equal(out.newRateMlHour, 20.5);
    assert.equal(out.currentUnitsHour, 17.3 * 40); // 692 U/h（未捨入）
  });

  // 出處：[README]「調整後流速不低於 0 mL/h」
  test("減量後不低於 0 mL/h；但 rateDeltaMlHour 仍顯示完整減量（記錄目前行為）", () => {
    const out = calc("acs", 60, 110, 2); // 減 4.5 mL/h，但只剩 2 mL/h
    assert.equal(out.newRateMlHour, 0);
    assert.equal(out.newUnitsHour, 0);
    assert.equal(out.rateDeltaMlHour, -4.5, "頁面會顯示「減少 4.5 mL/h」，實際只減了 2 mL/h（報告記錄）");
    const zero = calc("vte", 60, 130, 0);
    assert.equal(zero.newRateMlHour, 0);
  });
});

// ===========================================================================
describe("5. 缺值、0、負數、非數字", () => {
  // 出處：[頁面欄位] min／max；heparin.js 以 RangeError／TypeError 拒絕。頁面另以表單驗證先擋（見 heparin.page.test.mjs）。
  const bad = [undefined, null, NaN, Infinity, -Infinity, "", "60", "abc", [], {}];

  test("體重：缺值／非數字／0／負數都拒絕", () => {
    for (const v of [...bad, 0, -1]) assert.throws(() => calc("acs", v, 60, 20), RangeError, String(v));
  });
  test("aPTT：缺值／非數字／0／負數都拒絕，1 與 300 可接受、超過 300 拒絕", () => {
    for (const v of [...bad, 0, -1, 0.9, 300.1]) assert.throws(() => calc("acs", 60, v, 20), RangeError, String(v));
    assert.doesNotThrow(() => calc("acs", 60, 1, 20));
    assert.doesNotThrow(() => calc("acs", 60, 300, 20));
  });
  test("目前流速：缺值／非數字／負數拒絕，0 與 200 可接受、超過 200 拒絕", () => {
    for (const v of [...bad, -0.5, -1, 200.5]) assert.throws(() => calc("acs", 60, 60, v), RangeError, String(v));
    assert.equal(calc("acs", 60, 45, 0).newRateMlHour, 3); // 0 → 增加 3
    assert.doesNotThrow(() => calc("acs", 60, 60, 200));
  });
  test("適應症：缺值或未知都拒絕", () => {
    for (const v of [undefined, null, "", "ACS", "pe", "invalid"]) {
      assert.throws(() => calc(v, 60, 60, 20), TypeError, String(v));
    }
    // 物件原型上的名稱（如 "toString"）也會被拒絕（雖然不是預期的錯誤訊息）
    assert.throws(() => calc("toString", 60, 60, 20), TypeError);
  });
  test("整個參數物件缺漏時拒絕", () => {
    assert.throws(() => calculateAdjustment({}), TypeError);
    assert.throws(() => calculateAdjustment({ indication: "acs" }), RangeError);
  });
});

// ===========================================================================
describe("6. 暫停與加減速流程", () => {
  // 出處：[頁面表] ACS 86–100「暫停 30 分；減少 2 U/kg/h」、>100「暫停 60 分；減少 3 U/kg/h；通知醫師」
  //       VTE 90–120「暫停 30 分；減少 2 U/kg/h」、>120「暫停 60 分；減少 3 U/kg/h；通知醫師」
  test("只有暫停區間有 holdMinutes，只有最高區間通知醫師，只有低於範圍的區間有 bolus", () => {
    for (const indication of ["acs", "vte"]) {
      for (const band of EXPECTED[indication].bands) {
        const out = calc(indication, 60, band.lo ?? band.hi, 20);
        assert.equal(out.holdMinutes, band.hold, band.label);
        assert.equal(out.notifyPhysician, band.notify, band.label);
        if (out.bolusUnits) assert.equal(out.apttStatus, "below", band.label);
        if (out.holdMinutes) assert.equal(out.apttStatus, "above", band.label);
      }
    }
  });

  test("ACS 60 kg、21 mL/h：每個區間的完整處置", () => {
    const flow = [
      [30, { bolusUnits: 3000, holdMinutes: 0, rateDeltaMlHour: 3, newRateMlHour: 24, notifyPhysician: false, apttStatus: "below" }],
      [45, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: 3, newRateMlHour: 24, notifyPhysician: false, apttStatus: "below" }],
      [60, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: 0, newRateMlHour: 21, notifyPhysician: false, apttStatus: "in-range" }],
      [80, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: -3, newRateMlHour: 18, notifyPhysician: false, apttStatus: "above" }],
      [90, { bolusUnits: 0, holdMinutes: 30, rateDeltaMlHour: -3, newRateMlHour: 18, notifyPhysician: false, apttStatus: "above" }],
      [110, { bolusUnits: 0, holdMinutes: 60, rateDeltaMlHour: -4.5, newRateMlHour: 16.5, notifyPhysician: true, apttStatus: "above" }],
    ];
    for (const [aptt, expected] of flow) {
      const out = calc("acs", 60, aptt, 21);
      for (const [k, v] of Object.entries(expected)) assert.equal(out[k], v, `aPTT ${aptt} ${k}`);
    }
  });

  test("VTE 60 kg、26 mL/h：每個區間的完整處置", () => {
    const flow = [
      [30, { bolusUnits: 5000, holdMinutes: 0, rateDeltaMlHour: 6, newRateMlHour: 32, notifyPhysician: false }], // 80×60=4800→5000
      [40, { bolusUnits: 2500, holdMinutes: 0, rateDeltaMlHour: 3, newRateMlHour: 29, notifyPhysician: false }], // 40×60=2400→2500
      [55, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: 3, newRateMlHour: 29, notifyPhysician: false }],
      [70, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: 0, newRateMlHour: 26, notifyPhysician: false }],
      [85, { bolusUnits: 0, holdMinutes: 0, rateDeltaMlHour: -3, newRateMlHour: 23, notifyPhysician: false }],
      [100, { bolusUnits: 0, holdMinutes: 30, rateDeltaMlHour: -3, newRateMlHour: 23, notifyPhysician: false }],
      [130, { bolusUnits: 0, holdMinutes: 60, rateDeltaMlHour: -4.5, newRateMlHour: 21.5, notifyPhysician: true }],
    ];
    for (const [aptt, expected] of flow) {
      const out = calc("vte", 60, aptt, 26);
      for (const [k, v] of Object.entries(expected)) assert.equal(out[k], v, `aPTT ${aptt} ${k}`);
    }
  });
});

// ===========================================================================
describe("7. 初始 bolus 與初始速率（頁面文字對照公開指引）", () => {
  // 本工具不計算初始 bolus／初始速率，只在「起始劑量參考」表列文字。
  test("計算模組沒有初始劑量模式（只做 aPTT 調整）", () => {
    const out = calc("acs", 60, 60, 21);
    assert.equal("initialBolusUnits" in out, false);
    assert.match(HTML, /僅作起始劑量對照；本頁 aPTT 調整以高醫 protocol 為準/);
  });

  // 出處：[2025 指引] Section 4.4：UFH loading dose 60 IU/kg (max 4000 IU)，initial infusion 12 IU/kg/h (max 1000 IU/h)
  // 原本頁面寫 max 5,000 U，Kiwi 2026-11-02 決定依 2025 指引改為 4,000 U。
  test("ACS 初始 bolus 上限：頁面 4,000 U，與 2025 指引一致", () => {
    assert.match(HTML, /Bolus 60 U\/kg（max 4,000 U）；12 U\/kg\/h（max 1,000 U\/h）（2025 ACC\/AHA ACS Guideline）/);
  });

  test("ACS 初始速率：頁面 12 U/kg/h（max 1,000 U/h）與 2025 指引一致", () => {
    assert.match(HTML, /12 U\/kg\/h（max 1,000 U\/h）/);
  });

  // 出處：[2025 指引] Section 4.4：aPTT 治療範圍 60–80 s；頁面（高醫 protocol）ACS 為 50–75 秒。
  // 治療範圍要改需要新的 aPTT 區間切點，指引沒有提供 nomogram，待 Kiwi 決定，列入報告。
  test("ACS 治療範圍：頁面 50–75 秒 vs 2025 指引 60–80 秒", { todo: "與 2025 ACC/AHA 指引不一致，待 Kiwi 決定是否改區間" }, () => {
    assert.equal(calc("acs", 60, 60, 21).therapeuticRange, "60–80 秒");
  });

  // VTE 初始 80 U/kg、18 U/kg/h 為 Raschke 1993 nomogram 的起始劑量
  // （Raschke RA, et al. Ann Intern Med 1993;119(9):874-81，PMID 8214998，doi:10.7326/0003-4819-119-9-199311010-00002）。
  // 頁面只寫「標準 Raschke 80 U/kg；18 U/kg/h」，與該文獻一致；高醫原表的 VTE 初始劑量未找到可驗證範例。
  test("VTE 初始劑量文字：80 U/kg；18 U/kg/h", () => {
    assert.match(HTML, /標準 Raschke 80 U\/kg；18 U\/kg\/h/);
  });
});
