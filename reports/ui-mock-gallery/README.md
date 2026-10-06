# SejukOps 16:9 UI 截圖圖庫

[開啟分類圖庫](index.html)。點擊圖片放大；支援分類、搜尋、左右鍵切換及下載原圖。

來源：PR #39 `514746b`，本機分支 `ui-mock-gallery`。每張圖片均經 PNG 標頭檢查為 **1920 × 1080（16:9）**；長頁與內部捲動區域使用分段截圖。

Mock 資料：48 工單、12 客戶、3 分店、6 技師、6 知識文件、3 模型設定、12 員工、28 AI 觀測紀錄。營運情境包含待派工、逾期、已安排、進行中、完成與結案；客戶地址、技師分店與員工身份相互對應。展示時間為 2026-10-05 16:00 MYT 的固定營運快照。

## 頁面及功能

| 原始頁面路由 | 截圖涵蓋內容 | 範例 |
|---|---|---|
| `/` | 產品首頁 | [圖片](001-home.png) |
| `/login` | 員工登入與失敗提示 | [圖片](002-staff-login.png) |
| `/owner/login` | Owner 登入 | [圖片](003-owner-login.png) |
| `/demo` | Demo 入口 | [圖片](004-demo-entry.png) |
| `/owner` | Owner 帳號與唯讀視角 | [圖片](005-owner-account.png) |
| `/owner/password` | Owner 密碼表單 | [圖片](006-owner-password.png) |
| `/account/password` | 員工密碼設定／成功 | [圖片](007-staff-password.png) |
| `/access-denied` | 無權限頁面 | [圖片](008-access-denied.png) |
| `/workspaces/[id]` | 工作區入口 → 工單 | [圖片](108-orders.png) |
| `/workspaces/[id]/overview` | 三角色 Dashboard、圖表與工作量 | [圖片](101-guest-admin-dashboard.png) |
| `/workspaces/[id]/orders` | 工單、篩選、詳情、新增、匯入、AI Assist、現場進度 | [圖片](108-orders.png) |
| `/workspaces/[id]/schedule` | 三角色排程、重新安排與日期選擇器 | [圖片](112-guest-manager-schedule.png) |
| `/workspaces/[id]/agent` | AI 對話、五種畫布、即時執行、取消、提案與確認 | [圖片](170-agent-comparison-canvas.png) |
| `/workspaces/[id]/knowledge` | 搜尋與引用、草稿、文字／PDF、索引／重試／發布 | [圖片](065-knowledge-results.png) |
| `/workspaces/[id]/assignment` | 保存、審阅、確認／執行、失效拒絕 | [圖片](037-assignment-review.png) |
| `/platform/ai-settings` | 供應商、測試、新增／編輯／刪除、路由、Guest 額度 | [圖片](135-ai-settings.png) |
| `/platform/staff` | 員工清單、新增／編輯／停用、臨時密碼、Excel 匯入 | [圖片](142-staff.png) |
| `/platform/demo` | Demo 世代、重設確認與結果 | [圖片](152-platform.png) |
| `/diagnostics/ai-observability` | AI 紀錄、分頁、狀態篩選與追蹤詳情 | [圖片](155-diagnostics.png) |

另含空白清單、載入失敗、Guest AI 額度用盡、索引失敗及提案過期／資料變更拒絕等狀態。完整逐張清單及執行紀錄見 [browser-results.json](browser-results.json)。

## 驗證

- 瀏覽器：62 個操作流程完成；沒有 JavaScript page errors、外部 HTTP 請求或未解決的瀏覽器流程失敗。
- 圖庫：分類、搜尋、放大、下一張及 Esc 關閉另行檢查。
- `pnpm lint`、`pnpm typecheck`：通過。
- 五個相關測試檔：39 個測試通過，包含工單關聯、技師／員工身份、時間順序、AI 觀測契約及元件操作。
- 初始六檔測試：42 通過、5 失敗。五個失敗屬未修改的 `tests/ui/knowledge-workspace.test.tsx`：測試未切換 Search／Manage 分頁便寻找當時不顯示的欄位。實際瀏覽器已驗證搜尋、建立草稿、文字／PDF 審阅、索引、重試及發布；沒有改寫測試讓它通過。
- 獨立唯讀審查指出的 ID 重複、員工身份、引用來源、技師分店、已完成工單時間及 Dashboard 數據不一致問題已修正。

這是實際 React 元件及原始頁面版型搭配本機 MSW 的 UI 證據。伺服器登入／帳號邊界以 preview-only adapter 取代，AI 回覆、PDF／Excel 解析及臨時密碼均為腳本化 Mock；Native Agent 使用固定資料快照。未連接 Supabase、真實 Auth、付費 AI 或正式部署，也不代表 Human UAT 已通過。未改動 `src/` 產品程式、依賴宣告或鎖檔。

## 重跑

從仓庫根目錄先以 `node tests/ui-browser/start.mjs` 啟動既有本機預覽，再執行：

```sh
node scripts/tests/ui-browser/realistic-gallery.mjs
python scripts/tests/ui-browser/build-realistic-gallery.py
```

瀏覽器工具路徑可用 `UI_PLAYWRIGHT_PATH`／`UI_CHROMIUM_PATH` 指定。所有新增資料只存在 tests 及本機瀏覽器記憶體。
