# 文件分支整合說明

用戶要求：「可以把這個開發思路開個branch寫進去嗎？可重構，之後我會讓codex進行開發」。此工作是保存計畫的 docs-only 分支。允許重構屬後續開發方向，不能把這次文件保存當成現在修改應用程式的授權。

## 在 repository 內保存

1. 先讀目前HEAD的AGENTS與文件權威；核對研究SHA之後的相關變動。
2. 選新的、描述性的文件分支。不要切換或覆寫其他人未提交的工作，也不要改main。
3. 遵repository已有提案/ADR目錄慣例放本包。如果沒有既有慣例，可用 `docs/proposals/dsh-refactor/` 作新proposal目錄；這只是建議，先核對不衝突。
4. `docs/README.md`只加一個清楚標示「Proposed DSH refactor plan」的入口。必要時root README加導向，但不把提案內容冒充已接受架構。
5. 保留現有PRODUCT_DIRECTION、ARCHITECTURE、STAFF_ACCESS的accepted語意。可在提案內記錄待修訂項目；尚未決定的Owner/region權限不能寫成現行規則。
6. 保留IMPLEMENTATION_PLAN所有stable IDs。可加proposal reference/未釋出候選工作，不重排或重命名舊任务。PROJECT_STATE若依repo要求需要記錄，只寫「規劃文件新增」及真實分支/commit，不能寫實作完成、測試通過或部署。
7. 規格一律Proposed；G0a/G0b/G1/G2尚未達成，不因文件分支推送成功自動改Accepted/Locked/Released。

## 允許與禁止

允許：本包Markdown、必要相對連結修正、README/docs索引、遵repository規範的文件進度記錄、文件專用檢查。

禁止：src程式、package/lockfile、supabase migration、runtime/infra配置、secrets、測試程式變更；不安裝DSH、不執行模型、不改permissions、不開外部MCP、不部署、不merge。

若當前repo有新權威/政策或使用者要求與本包不同，先把差異回報並只在文件提案中解釋，不用計畫包覆蓋現行實作或歷史證據。

## 完成證據

- 新分支名稱、commit SHA、remote核對結果與可開啟的GitHub branch/文件連結。
- `git diff --name-only`確認全部變更限文件；完整diff reviewer核對無应用/配置改動。
- Markdown link、引用、encoding及repo要求的文件檢查结果；明確說明應用程式測試未因docs-only變更而宣稱已通過。
- 不自動建立PR，除非用戶另有授權或repo既有要求明確適用；不得自動merge。
