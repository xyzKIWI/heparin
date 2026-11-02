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
- 調整後流速不低於 0 mL/h。

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
