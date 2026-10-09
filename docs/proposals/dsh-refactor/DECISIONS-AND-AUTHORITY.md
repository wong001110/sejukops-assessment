# 決策與權威

## 用戶已決定

- U1：調查 DSH 與 Sejukops 的整合，產出可開發版本；允许重構。
- U2：盡量重用 DSH UI 元件、runtime 與 settings；移除面向開發者的工具與入口。
- U3：AI Workspace 按使用者的業務角色提供已授權聊天及業務 UI。
- U4：Owner 及 Superadmin 有各自 scope 的聊天室、區域及模型設定管理介面。
- U5：chatbot 使用精簡 UI。
- U6：AI Workspace 不可碰 Owner 功能。
- U7：把開發思路寫入 Sejukops 的獨立 branch；之後由 Codex 進行開發。此處只保存文件，沒有把應用程式實作視作已開始。

U4 確立產品意圖，但未把 Owner 定義成 Superadmin，也未授權擴張所有現有 `ai_config` 權限。具體角色、scope、region 與授權條件必須用明確 ADR 接上目前模型。

## 現有約束

- I1：Sejukops 身分及業務服務是授權真相；DSH workspace path、前端 UI 狀態、prompt、模型輸出不能成為授權依據。
- I2：Owner 不是一個現成的 business role 字串。現有模型區分 `platformRole = SUPER_ADMIN | USER`、workspace `kind = OWNER | DEMO`，以及 `ADMIN | MANAGER | TECHNICIAN` 業務角色。
- I3：現有 `ai_config:view`、`ai_config:manage`、`diagnostics:view` 由 `SUPER_ADMIN` 控制。要新增 Owner scope 設定，必須修訂對應權威文件與 policy，不能在 UI 先放行。
- I4：Owner 的 staff 管理及 read-only preview 保留；preview 不可藉新 AI 通道變成可執行工作階段。
- I5：保留業務資料、既有 API 相容條件、業務服務檢查、proposal 與人類確認。允許重構不代表允許刪除資料、繞過審核或一次替換所有安全邏輯。
- I6：任何在用戶角色本來不能執行的動作，都不因 AI、管理聊天室或切換介面而取得權限。

## 文件權威

遵循 `docs/README.md` 的既有分類，不新增平行 Bible 組數，不重命名既有文件：

| 既有文件 | 保留責任 | 本次應如何接入 |
|---|---|---|
| `docs/PRODUCT_DIRECTION.md` | 產品 outcomes 與方向 | 記錄三介面和重用 DSH 的已批准產品變更 |
| `docs/ARCHITECTURE.md` | 系統邊界與 stack | 批准後補上 Host gateway、隔離與持久化責任 |
| `docs/STAFF_ACCESS.md` | Owner、staff 與 preview 邊界 | 明確加入 Owner scope 管理權限；保留 preview 約束 |
| `docs/IMPLEMENTATION_PLAN.md` | stable task IDs 和計畫 | 登錄正式任務及依賴，不重編舊 ID |
| `PROJECT_STATE.md` | 唯一進度真相 | 只在實際工作完成並驗證後更新 |
| `AGENTS.md` | 執行約束與當前授權 | 每次任務先讀；不得由本包放寬 |
| `docs/DEVELOPMENT_PROTOCOL.md` 與 `docs/GIT_WORKFLOW.md` | 開發驗證與版本流程 | 保留 task、review、分支與提交要求 |

歷史 `SYSTEM_SPEC`、`AI_CONFIGURATION` 或 OpenWiki 可提供背景，不能凌駕以上的現行權威。若基線後檔案位置或定義改變，先核對 `docs/README.md` 再編輯。

## 推薦但未宣告採納

- R1：保留 Sejukops 為主要產品及授權層，抽取 DSH React 元件並以 adapter 接上私有 DSH Host。
- R2：使用 DSH Web 的 Host Remote HTTP RPC 與 WebSocket 路線；保留其單一 session cancel 能力，再加上 Sejukops scope 驗證。
- R3：首個可運作版本採一個已核定租戶安全邊界一個 Host 執行個體及持久卷。若驗證後確定成本或部署不可接受，另評估共享 Host；不得直接暴露上游單操作者 Host。
- R4：建立小而明確的 gateway 與 adapter，不做通用 plugin marketplace、任意 MCP 註冊平台或全新 orchestration 框架。
- R5：先上線已授權唯讀聊天，再加入既有 proposal 流程，最後才切換完整產品入口。Owner 功能保持在管理控制台。
- R6：保留舊聊天入口作 feature-flag 回退；採 additive migration，初次切換不刪舊紀錄。

## 擬議 ADR

沿 repository 已有 ADR 慣例選下一個可用 ID；若無慣例，先在 `docs/ARCHITECTURE.md` 記錄設計變更位置並取得批准。不要猜一個正式 ADR 編號。

1. DSH 重用邊界：React 元件、Host Remote runtime、settings 外觀和哪些上游能力永久不對使用者開放。
2. 管理權限和區域語意：Owner scope、Superadmin scope、業務角色、region 與既有 workspace 的關係。
3. 信任與隔離：可信 actor 產生、gateway、session/event 的 ACL、Host 執行個體及 storage 邊界。
4. 狀態與升級：session 持久化、proposal 真相、secret 管理、資料遷移與回退。

ADR 狀態從 Proposed 開始。每個 Accepted ADR 需列決策人、日期、理由、受影響文件、相容限制及替代方案。之後才能逐項鎖定 Spec；未受阻礙的部分可以分批鎖定，不能為了排程把所有未決項目當作已解決。
