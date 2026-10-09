# Sejukops DSH 重構開發包

版本 0.1　2026 年 10 月 9 日　狀態 Proposed

本包把 DSH 的聊天 UI、Host runtime 及 settings 元件轉為 Sejukops 可實作的方案。核心方向是保留 Sejukops 的身分、業務授權及人類確認流程，以受控的 DSH Host 提供聊天能力。AI Workspace 不提供 Owner 或平台管理能力；管理控制台、AI Workspace、簡化 chatbot 各有独立介面允許清單。

本次交付是調查、規格與任務設計。用戶另已要求將開發思路保存到 Sejukops 的獨立文件分支，之後交給 Codex 開發；此分支只包含規劃文件，不包含應用程式修改、migration 執行、merge 或部署。此包不取代 repository 的既有權威文件，也不是宣告規格已獲批准。後續開發前，先完成 G0 決策與文件對齊，才可釋出受影響的實作任務。

## 閱讀順序

1. [DECISIONS-AND-AUTHORITY.md](DECISIONS-AND-AUTHORITY.md)：用戶已決定、既有約束、建議與文件權威。
2. [SPEC.md](SPEC.md)：可實作責任、介面、資料與失敗合約，含三介面角色矩陣。
3. [TASKS.md](TASKS.md)：Phase、依賴、coding-agent 範圍、驗收與回滾。
4. [TEST_CASES.md](TEST_CASES.md)：跨租戶、Owner 隔離、串流、取消及業務確認的必測案例。
5. [OPEN-QUESTIONS-AND-GAPS.md](OPEN-QUESTIONS-AND-GAPS.md)：唯一未決事項清單與阻擋關係。
6. [SOURCES.md](SOURCES.md)：固定 commit 的研究依據。
7. [AGENT.md](AGENT.md)：實作與獨立審查的交接規則。
8. [REPO-INTEGRATION.md](REPO-INTEGRATION.md)：獨立文件分支的保存方式與禁止變更。

## 唯一下一道門

G0a：批准並鎖定最小基礎切片的 ADR/Spec：沿用現有 workspace/角色、private fixture room、唯讀 readOrder、私有 Host、mock provider，不新增 Owner/region 管理能力。這讓基礎技術工作能先開發。G0b 再決定 Owner 與 Superadmin 的管理範圍、region 與對話可見性；G1/G2 分別控制真實整合與生產準備。詳細阻擋關係見 OPEN-QUESTIONS-AND-GAPS。不要把本包標成 Locked，或把 Proposed 任務直接當作已批准 implementation。

## 版本基線

- Sejukops `main`：`5284df040ebfe46712c98e7478e7a160389c63f9`
- DSH：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`
- 開發開始時須檢查 upstream 漂移，重新核對引用檔案與相關測試。此處的 SHA 是研究基線，不是要求回退現有 repository。

## 任務狀態的意義

- `READY FOR REVIEW`：內容可審查，尚未批准開發。
- `BLOCKED G0`：至少一項上層決策未定；可補充證據，不能自行選定產品權限。
- `RELEASED`：後续才可由責任人記錄已批准 Spec 版本、相關決策與明確實作授權。
- `DONE`：須同時有 diff、最終測試、獨立 review、可驗證結果；本次沒有任何實作任務處於此狀態。

文件中的 `DSH-Sxx`、`DSH-Txx` 是此提案內的引用標籤，並非 Sejukops 新的永久 task ID。G0 通過後應沿用 `IMPLEMENTATION_PLAN.md` 的 stable ID 規則登錄，避免新增一套相互矛盾的進度系統。
