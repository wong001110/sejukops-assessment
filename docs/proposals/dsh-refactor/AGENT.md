# Coding agent 執行規則

本包是 Proposed 設計。先檢查任務是否已由責任人釋出，並提供已批准 Spec/ADR 版本與實作授權。未鎖定規格只能做已授權的調查/文件修正，不能自行寫應用程式。用戶已要求獨立 branch 保存本開發思路，該工作只允許規劃文件及必要文件索引變更。本包不授權應用程式實作、merge、migration 執行、live provider 測試或部署；後續開發請核對當次明確授權。

## 開始前

1. 讀 checkout 的 `AGENTS.md`、`docs/README.md`、`docs/DEVELOPMENT_PROTOCOL.md`、`docs/GIT_WORKFLOW.md`、目前 `PROJECT_STATE.md` 和相關 `.agents/skills`。
2. 比較 HEAD 與 `SOURCES.md` 基線；若上游已有新實作，先核對而非重寫。不要回退 repo 以符合舊 research SHA。
3. 取得單一任務、已鎖定 Spec、允許檔案范围與 blocked-by 狀態。提案中的新目錄尚不存在，先在 T00/T01 確認命名。
4. 先寫失敗/越權測試，再最小實作。範圍衝突或缺口回報，不擴張產品角色或資料權限。

## 不可破壞

Owner ≠ SUPER_ADMIN；業務角色不自動有平台權限；preview 禁AI；AI Workspace不得有Owner/platform能力；DSH workspace/path非ACL；不公開raw Host；不開外部MCP；不刪業務資料；不讓AI批准proposal；不把secret或raw tool輸出送browser；保留quota/source/intent/generation/安全provider transport與manual fallback。

## 每個任務的完成證據

- 最終 commit 或工作樹 diff、變更檔案清單、每個変更對應的 Spec/acceptance ID。
- 實際執行命令、環境、結果、測試輸出；清楚標示 pass、fail、未執行，不能把 mock 當 live。
- 正向與負向測試、必要 UI 截圖/錄影或可重現腳本；不得保存真實密鑰或不必要私人資料。
- migration/設定/版本變更與回退演練，殘餘風險及其他需批准行為。

實作 worker 提交 staged change 後交獨立 reviewer。流程為 task → diff → tests → review → accept 或 targeted correction → 再驗證 → merge（另需授權）。拒絕後只修失敗 acceptance，不順便改別的架構。後續任何改動後需針對最終diff重跑受影響測試。

## 正式進度

`PROJECT_STATE.md` 是唯一進度真相。沿 `IMPLEMENTATION_PLAN.md` 的 stable IDs 及既有 acceptance definitions 記錄；本包 DSH-T/S 標籤先作引用，不取代既有AUTH/ISO/ACT等標準。規格Accepted、Task Released、實作Done及Production Deployed是四個不同狀態，不得混用。
