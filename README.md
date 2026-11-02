# Heparin dose 調整計算

依高醫 ICU UFH protocol，根據體重、適應症、目前 aPTT 與 pump 流速，計算 ACS 或 VTE/PE 的 heparin pump 流速（含 bolus 與暫停時間）。

## 使用方式

1. 確認藥袋為 heparin 20,000 U / NS 500 mL（40 U/mL）
2. 選擇 ACS 或 VTE/PE
3. 輸入體重、目前 aPTT 與目前流速
4. 人工核對 bolus、暫停時間及新流速後，再依正式醫囑執行

本工具不儲存或傳送任何輸入資料，也不應輸入病人姓名、病歷號或其他識別資訊。

## 計算規則

- aPTT 分段、bolus、暫停與 U/kg/h 增減均依使用者提供的高醫 ICU protocol。
- 原始表列出 40、50、60、70 kg。本工具對其他體重依表格底層的 U/kg 係數推算。
- 流速以 40 U/mL 換算，四捨五入至 0.5 mL/h。
- Bolus 四捨五入至 500 U。上限：ACS 4,000 U（依 2025 ACC/AHA ACS Guideline）；VTE / PE 5,000 U（原表）。
- 調整後流速不低於 0 mL/h。減量超過目前流速時，畫面顯示實際減少的量並註明依表應減多少，提醒新流速為 0（等同停止輸注），請醫師評估。
- aPTT 有小數、落在表列兩列之間時（例如 75.5 秒），一律歸入較高的區間（較少 heparin，降低出血風險），畫面會提醒差距小時由醫師評估。
- 新流速超過 25 U/kg/h 或 2,000 U/h（50 mL/h）時提醒請醫師／藥師確認，不擋計算。指引只規定起始速率上限（ACS 1,000 U/h），沒有規定調整後的速率上限。
- 下次 aPTT：6–8 小時後（急診 q6h–q8h；暫停者自恢復輸注起算）。原表 ICU 為 q8h，連續兩次在治療範圍可改 QD。
- ACS 治療範圍維持高醫 MICU/CCU protocol 的 50–75 秒。2025 ACC/AHA ACS 指引目標為 aPTT 60–80 秒，但未提供調整表；如需改用，須先修訂院內 protocol（構想見 [ACS_GUIDELINE_PROPOSAL.md](ACS_GUIDELINE_PROPOSAL.md)）。

## 資料來源與校對

- 高醫內科加護病房（MICU）與心臟內科加護病房（CCU）共用之「KMUH MICU Heparin Infusion Protocol」照片，由使用者提供；以照片表格逐列人工轉錄（原表 B 表標題為 ACS & Stroke，本工具只用於 ACS）
- [2025 ACC/AHA/ACEP/NAEMSP/SCAI ACS Guideline](https://www.ahajournals.org/doi/10.1161/CIR.0000000000001309)：ACS 起始劑量與 bolus 上限 4,000 U
- [GlobalRPH Heparin Dosing Calculator](https://globalrph.com/medcalcs/heparin-dosing-calculator-custom-options-available/)：起始體重式劑量與介面參考
- 資料最後校對：2026-11-02
- 校對方式：逐列對照原始照片，並以 40／50／60／70 kg 測試案例驗證計算輸出

## 驗證

```powershell
node --test
```

- `heparin.test.mjs`：原表 40／50／60／70 kg 案例
- `heparin.verify.test.mjs`：逐條對照頁面規則表、所有切點、體重邊界、bolus 上限、單位換算與無效輸入
- `heparin.page.test.mjs`：用瀏覽器實際操作頁面（需要 Playwright；本機沒有時自動略過，GitHub Actions 會安裝後執行）
- 驗算結果與待確認事項見 [TEST_REPORT.md](TEST_REPORT.md)

## 更新方法

1. 修改 `heparin.js` 的 protocol 規則及相應測試
2. 更新頁尾與本 README 的校對日期
3. 執行測試並人工核對所有 aPTT 邊界
4. Push 後由 GitHub Pages 發佈

## 免責聲明

本工具僅供臨床決策輔助參考，不取代臨床判斷、正式醫囑、院內規範、官方仿單與最新指引。使用前必須由醫療專業人員核對藥袋濃度、病人狀況與原始 protocol。

## License

MIT
