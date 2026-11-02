// 頁面端對端測試：用真正的瀏覽器開 index.html、填表、按「計算調整」，
// 確認畫面上的標題、處置列、配色、提醒與「複製結果」文字和計算結果一致。
// 不改 index.html 任何內容。
//
// 需要 Playwright（Chromium）。本機沒有時自動略過；CI 設 REQUIRE_E2E=1 時缺少就直接失敗。
// 出處縮寫同 heparin.verify.test.mjs：[頁面表]、[頁面註]、[頁面欄位]、[README]、[原表測試]。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  if (process.env.REQUIRE_E2E === "1") throw new Error("REQUIRE_E2E=1 但找不到 playwright");
}

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

describe("頁面端對端", { skip: chromium ? false : "未安裝 playwright，略過頁面測試" }, () => {
  let server;
  let browser;
  let page;
  let baseUrl;

  before(async () => {
    server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      const file = join(ROOT, path === "" ? "index.html" : path);
      if (!file.startsWith(ROOT)) return res.writeHead(403).end();
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch();
    const context = await browser.newContext();
    // 攔截剪貼簿，讀回「複製結果」的文字
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text) => { window.__copied = text; } },
      });
    });
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.goto(baseUrl);
    assert.deepEqual(errors, []);
  });

  after(async () => {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  });

  // 填表並送出；raw=true 時直接寫入 value（模擬非數字輸入，瀏覽器會把它清成空字串）
  async function run({ indication = "acs", weight, aptt, rate, raw = false }) {
    // radio 本身是透明且 pointer-events:none，使用者實際點的是旁邊的 span
    await page.click(`label.segment:has(input[value="${indication}"]) span`);
    assert.equal(await page.isChecked(`input[name="indication"][value="${indication}"]`), true);
    for (const [id, value] of [["weight", weight], ["aptt", aptt], ["current-rate", rate]]) {
      if (raw) await page.$eval(`#${id}`, (el, v) => { el.value = v; }, value == null ? "" : String(value));
      else await page.fill(`#${id}`, value == null ? "" : String(value));
    }
    await page.evaluate(() => { window.__copied = undefined; });
    await page.click("button.calculate");
    return page.evaluate(async () => {
      const $ = (s) => document.querySelector(s);
      const result = $("#result");
      const shown = result.classList.contains("show");
      if (shown) {
        $("#copy-result").click();
        await new Promise((r) => setTimeout(r, 0));
      }
      return {
        shown,
        error: $("#form-error").textContent,
        classes: [...result.classList].filter((c) => !["result", "show"].includes(c)),
        protocol: $("#result-protocol").textContent,
        title: $("#result-title").textContent,
        target: $("#result-target").textContent,
        range: $("#result-range").textContent,
        rows: [...document.querySelectorAll("#result-actions .action")].map((r) => [
          r.querySelector(".action-label").textContent,
          r.querySelector(".action-value").textContent,
        ]),
        warning: $("#rate-warning").classList.contains("show") ? $("#rate-warning").textContent : "",
        note: $("#result-note").textContent,
        copy: window.__copied ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // 出處：[頁面表] VTE <35「Bolus 80 U/kg；增加 4 U/kg/h」；[原表測試] 40 kg → 3,000 U、+4 mL/h
  test("VTE 低於範圍：bolus＋加速，畫面與複製文字一致", async () => {
    const r = await run({ indication: "vte", weight: 40, aptt: 34, rate: 18 });
    assert.equal(r.shown, true);
    assert.deepEqual(r.classes, []);
    assert.equal(r.protocol, "VTE / PE｜40 kg｜aPTT 34 秒");
    assert.equal(r.title, "低於治療範圍，需上調");
    assert.equal(r.target, "VTE / PE 治療範圍 60–79 秒");
    assert.equal(r.range, "區間 < 35 秒");
    assert.deepEqual(r.rows, [
      ["IV bolus", "3,000 U"],
      ["流速調整", "增加 4 mL/h"],
      ["新流速", "22 mL/h（880 U/h）"],
    ]);
    assert.equal(r.note, "目前 18 mL/h（720 U/h）→ 22 mL/h。請人工核對藥袋濃度與醫囑。");
    assert.equal(r.copy, [
      "Heparin VTE / PE aPTT 調整",
      "體重 40 kg；aPTT 34 秒（< 35 秒）",
      "Bolus 3000 U",
      "流速：18 → 22 mL/h（增加 4 mL/h）",
      "濃度 40 U/mL；須人工核對後執行",
    ].join("\n"));
  });

  // 出處：[頁面表] ACS 50–75「不調整」
  test("ACS 在治療範圍：綠色、不調整", async () => {
    const r = await run({ indication: "acs", weight: 60, aptt: 60, rate: 21 });
    assert.deepEqual(r.classes, ["inrange"]);
    assert.equal(r.title, "已在治療範圍，維持原流速");
    assert.deepEqual(r.rows, [["流速調整", "不調整"], ["新流速", "21 mL/h（840 U/h）"]]);
    assert.match(r.copy, /流速：21 → 21 mL\/h（不調整）/);
  });

  // 出處：[頁面表] ACS 76–85「減少 2 U/kg/h」；[原表測試] 70 kg → −3.5 mL/h
  test("ACS 高於範圍（不暫停）：只減速", async () => {
    const r = await run({ indication: "acs", weight: 70, aptt: 80, rate: 24 });
    assert.deepEqual(r.classes, []);
    assert.equal(r.title, "高於治療範圍，需下調");
    assert.deepEqual(r.rows, [["流速調整", "減少 3.5 mL/h"], ["新流速", "20.5 mL/h（820 U/h）"]]);
  });

  // 出處：[頁面表] ACS 86–100「暫停 30 分；減少 2 U/kg/h」；[原表測試] 40 kg → −2 mL/h
  test("ACS 暫停 30 分：標題先講暫停，再列減速與新流速", async () => {
    const r = await run({ indication: "acs", weight: 40, aptt: 90, rate: 14 });
    assert.deepEqual(r.classes, ["hold"]);
    assert.equal(r.title, "先暫停 30 分鐘");
    assert.deepEqual(r.rows, [
      ["暫停輸注", "30 分鐘"],
      ["流速調整", "減少 2 mL/h"],
      ["新流速", "12 mL/h（480 U/h）"],
    ]);
    assert.equal(r.copy, [
      "Heparin ACS aPTT 調整",
      "體重 40 kg；aPTT 90 秒（86–100 秒）",
      "暫停 30 分鐘",
      "流速：14 → 12 mL/h（減少 2 mL/h）",
      "濃度 40 U/mL；須人工核對後執行",
    ].join("\n"));
  });

  // 出處：[頁面表] ACS >100「暫停 60 分；減少 3 U/kg/h；通知醫師」；[原表測試] 50 kg → −4 mL/h
  test("ACS 暫停 60 分＋通知醫師：紅色", async () => {
    const r = await run({ indication: "acs", weight: 50, aptt: 101, rate: 17 });
    assert.deepEqual(r.classes, ["notify"]);
    assert.equal(r.title, "先暫停 60 分鐘");
    assert.deepEqual(r.rows, [
      ["暫停輸注", "60 分鐘"],
      ["流速調整", "減少 4 mL/h"],
      ["新流速", "13 mL/h（520 U/h）"],
      ["必要處置", "通知醫師"],
    ]);
    assert.match(r.copy, /暫停 60 分鐘\n流速：17 → 13 mL\/h（減少 4 mL\/h）\n通知醫師\n/);
  });

  // 出處：[頁面表] VTE 90–120「暫停 30 分；減少 2 U/kg/h」、>120「暫停 60 分；減少 3 U/kg/h；通知醫師」
  test("VTE 暫停 30 分與暫停 60 分＋通知醫師", async () => {
    const hold = await run({ indication: "vte", weight: 50, aptt: 100, rate: 22 });
    assert.deepEqual(hold.classes, ["hold"]);
    assert.equal(hold.title, "先暫停 30 分鐘");
    assert.deepEqual(hold.rows, [["暫停輸注", "30 分鐘"], ["流速調整", "減少 2.5 mL/h"], ["新流速", "19.5 mL/h（780 U/h）"]]);
    const notify = await run({ indication: "vte", weight: 70, aptt: 121, rate: 28 });
    assert.deepEqual(notify.classes, ["notify"]);
    assert.deepEqual(notify.rows, [
      ["暫停輸注", "60 分鐘"],
      ["流速調整", "減少 5.5 mL/h"],
      ["新流速", "22.5 mL/h（900 U/h）"],
      ["必要處置", "通知醫師"],
    ]);
  });

  // 出處：[頁面表] 每一個切點；畫面區間標示應和 heparin.js 相同
  test("切點上下的畫面區間標示", async () => {
    const cases = [
      ["acs", 39, "< 40 秒"], ["acs", 40, "40–49 秒"], ["acs", 49, "40–49 秒"], ["acs", 50, "50–75 秒"],
      ["acs", 75, "50–75 秒"], ["acs", 76, "76–85 秒"], ["acs", 85, "76–85 秒"], ["acs", 86, "86–100 秒"],
      ["acs", 100, "86–100 秒"], ["acs", 101, "> 100 秒"],
      ["vte", 34, "< 35 秒"], ["vte", 35, "35–49 秒"], ["vte", 49, "35–49 秒"], ["vte", 50, "50–59 秒"],
      ["vte", 59, "50–59 秒"], ["vte", 60, "60–79 秒"], ["vte", 79, "60–79 秒"], ["vte", 80, "80–89 秒"],
      ["vte", 89, "80–89 秒"], ["vte", 90, "90–120 秒"], ["vte", 120, "90–120 秒"], ["vte", 121, "> 120 秒"],
    ];
    for (const [indication, aptt, label] of cases) {
      const r = await run({ indication, weight: 60, aptt, rate: 20 });
      assert.equal(r.range, `區間 ${label}`, `${indication} ${aptt}`);
    }
  });

  // 出處：[README]「原始表列出 40、50、60、70 kg。本工具對其他體重依表格底層的 U/kg 係數推算」
  test("非原表體重：顯示推算提醒；小數體重顯示一位小數", async () => {
    const r = await run({ indication: "acs", weight: 65.5, aptt: 45, rate: 20 });
    assert.equal(r.protocol, "ACS｜65.5 kg｜aPTT 45 秒");
    assert.equal(r.note, "原始表未列 65.5 kg；本結果依 U/kg 係數推算並四捨五入。請醫師／藥師再次核對後使用。");
    assert.deepEqual(r.rows, [["流速調整", "增加 3.5 mL/h"], ["新流速", "23.5 mL/h（940 U/h）"]]); // 2×65.5/40=3.275→3.5
  });

  // 出處：[README] bolus 上限 5,000 U；畫面以千分位顯示
  test("極重體重：bolus 封頂 5,000 U；新流速可超過輸入上限 200 mL/h（記錄目前行為）", async () => {
    const r = await run({ indication: "vte", weight: 300, aptt: 30, rate: 200 });
    assert.deepEqual(r.rows, [
      ["IV bolus", "5,000 U"],
      ["流速調整", "增加 30 mL/h"],
      ["新流速", "230 mL/h（9200 U/h）"],
    ]);
    // 目前流速 8,000 U/h ÷ 300 kg = 26.7 U/kg/h > 25，出現提醒；提醒只看「目前」流速，不看新流速
    assert.match(r.warning, /相當於 26\.7 U\/kg\/h/);
  });

  // 出處：index.html 第 271–280 行「超出常見劑量就出聲提醒（不擋計算）」，門檻 25 U/kg/h（頁面程式碼）
  test("目前流速換算超過 25 U/kg/h 時提醒，剛好 25 不提醒", async () => {
    const over = await run({ indication: "acs", weight: 60, aptt: 60, rate: 40 }); // 1600/60 = 26.7
    assert.match(over.warning, /請再確認：輸入的目前流速相當於 26\.7 U\/kg\/h/);
    const exact = await run({ indication: "acs", weight: 60, aptt: 60, rate: 37.5 }); // 1500/60 = 25
    assert.equal(exact.warning, "");
  });

  // 出處：[README]「調整後流速不低於 0 mL/h」
  test("減到 0：新流速顯示 0，但「流速調整」仍顯示完整減量（記錄目前行為）", async () => {
    const r = await run({ indication: "acs", weight: 60, aptt: 110, rate: 2 });
    assert.deepEqual(r.rows, [
      ["暫停輸注", "60 分鐘"],
      ["流速調整", "減少 4.5 mL/h"],
      ["新流速", "0 mL/h（0 U/h）"],
      ["必要處置", "通知醫師"],
    ]);
    assert.match(r.copy, /流速：2 → 0 mL\/h（減少 4\.5 mL\/h）/);
  });

  // ---------------------------------------------------------------------------
  // 出處：[頁面欄位] required／min／max／step；頁面錯誤訊息文字（index.html 第 233 行）
  const INVALID = "請完整輸入有效的體重、aPTT 與目前流速。";
  const invalidCases = [
    ["體重空白", { weight: "", aptt: 60, rate: 20 }],
    ["aPTT 空白", { weight: 60, aptt: "", rate: 20 }],
    ["流速空白", { weight: 60, aptt: 60, rate: "" }],
    ["體重 0", { weight: 0, aptt: 60, rate: 20 }],
    ["體重負數", { weight: -60, aptt: 60, rate: 20 }],
    ["體重 19.9", { weight: 19.9, aptt: 60, rate: 20 }],
    ["體重 300.1", { weight: 300.1, aptt: 60, rate: 20 }],
    ["aPTT 0", { weight: 60, aptt: 0, rate: 20 }],
    ["aPTT 負數", { weight: 60, aptt: -5, rate: 20 }],
    ["aPTT 300.1", { weight: 60, aptt: 300.1, rate: 20 }],
    ["流速負數", { weight: 60, aptt: 60, rate: -1 }],
    ["流速 200.5", { weight: 60, aptt: 60, rate: 200.5 }],
    ["體重非數字", { weight: "abc", aptt: 60, rate: 20, raw: true }],
    ["aPTT 非數字", { weight: 60, aptt: "4o", rate: 20, raw: true }],
    ["流速非數字", { weight: 60, aptt: 60, rate: "二十", raw: true }],
    ["體重小數第二位（step 0.1）", { weight: 60.25, aptt: 60, rate: 20 }],
    ["流速 17.3（step 0.5）", { weight: 60, aptt: 60, rate: 17.3 }],
  ];
  for (const [name, input] of invalidCases) {
    test(`無效輸入不顯示結果：${name}`, async () => {
      await run({ indication: "acs", weight: 60, aptt: 60, rate: 21 }); // 先有一筆結果
      const r = await run({ indication: "acs", ...input });
      assert.equal(r.shown, false, "前一筆結果必須被收起，不能殘留");
      assert.equal(r.error, INVALID);
    });
  }

  // 出處：[頁面欄位] 範圍內的最小值與最大值都應該可以計算
  test("可輸入範圍的兩端都能計算", async () => {
    const low = await run({ indication: "acs", weight: 20, aptt: 1, rate: 0 });
    assert.equal(low.shown, true);
    assert.deepEqual(low.rows, [["IV bolus", "1,000 U"], ["流速調整", "增加 1 mL/h"], ["新流速", "1 mL/h（40 U/h）"]]);
    const high = await run({ indication: "vte", weight: 300, aptt: 300, rate: 200 });
    assert.equal(high.shown, true);
    assert.equal(high.error, "");
  });
});
