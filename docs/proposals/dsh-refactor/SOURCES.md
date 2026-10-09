# 研究來源

查核日期 2026 年 10 月 9 日。程式部分為固定 commit 的唯讀研究；沒有執行 repo build、runtime、live模型或部署驗證。每個source用來描述當前程式/文件，方案中的新schema/API/目錄是推薦設計，不能當成已有實作。

Sejukops 基線 `5284df040ebfe46712c98e7478e7a160389c63f9`；DSH 基線 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。

## E1 DSH 元件與 Web 組成

- [packages/client/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/README.md)
- [packages/client/ui-chat/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-chat/package.json)
- [packages/client/ui-conversation/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-conversation/package.json)
- [packages/client/web/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/web/README.md)
- [packages/client/ui-renderer/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-renderer/README.md)
- [packages/client/ui-layout/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-layout/README.md)

## E2 單操作者連線及 Web Remote

- [packages/client/connection/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/connection/README.md)
- [packages/client/connection/src/operator-peer.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/connection/src/operator-peer.ts)

## E3 全域 session control 與公開資料風險

- [packages/api/session-controller/src/control.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/src/control.ts)
- [packages/api/session-controller/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/src/index.ts)
- [packages/api/session-controller/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/README.md)

## E4 DSH workspace 結構與 session storage

- [packages/workspace/workspace/src/spec.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/workspace/workspace/src/spec.ts)
- [packages/session/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/session/README.md)

## E5 Web per-session 取消與 stdio 差異

- [packages/api/session-controller/src/commands.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/src/commands.ts)
- [packages/api/session-controller/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/api/session-controller/src/index.ts)
- [packages/sdk/protocol/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/sdk/protocol/README.md)

## E6 Settings 與 credentials UX

- [packages/client/ui-settings-models/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/client/ui-settings-models/README.md)
- [packages/settings/settings/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/settings/settings/README.md)

## E7 安全成熟度與授權

- [SAFETY.md](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/SAFETY.md)
- [LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/LICENSE)

## E8 Sejukops 現行 actor 與 staff 邊界

- [src/lib/auth/actor-policy.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/auth/actor-policy.ts)
- [docs/STAFF_ACCESS.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/STAFF_ACCESS.md)

## E9 Sejukops 權威與架構

- [docs/README.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/README.md)
- [docs/PRODUCT_DIRECTION.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/PRODUCT_DIRECTION.md)
- [docs/ARCHITECTURE.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/ARCHITECTURE.md)
- [docs/IMPLEMENTATION_PLAN.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/IMPLEMENTATION_PLAN.md)
- [PROJECT_STATE.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/PROJECT_STATE.md)
- [AGENTS.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/AGENTS.md)
- [docs/DEVELOPMENT_PROTOCOL.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/DEVELOPMENT_PROTOCOL.md)
- [docs/GIT_WORKFLOW.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/GIT_WORKFLOW.md)

## E10 現行 native agent 及 HTTP 輸出

- [src/lib/ai/runtime/workspace-native-agent.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/ai/runtime/workspace-native-agent.ts)
- [src/app/api/workspaces/[workspaceId]/agent/run/route.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/app/api/workspaces/%5BworkspaceId%5D/agent/run/route.ts)
- [src/lib/ai/runtime/workspace-native-presentation.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/ai/runtime/workspace-native-presentation.ts)

## E11 canonical proposal 與 shared capabilities

- [src/lib/services/workspace-orders/assignment-proposals.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/services/workspace-orders/assignment-proposals.ts)
- [src/lib/capabilities/recent-orders.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/capabilities/recent-orders.ts)
- [src/lib/services/workspace-knowledge/service.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/services/workspace-knowledge/service.ts)

## E12 安全 provider 及其他 AI 模式

- [src/lib/ai/providers/safe-sdk-provider.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/ai/providers/safe-sdk-provider.ts)
- [src/lib/ai/runtime/operations-ask.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/ai/runtime/operations-ask.ts)
- [src/lib/ai/runtime/dashboard-insight.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/ai/runtime/dashboard-insight.ts)

## E13 現有 MCP 邊界

- [src/lib/mcp/workspace-server.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/lib/mcp/workspace-server.ts)
- [src/app/api/mcp/route.ts](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/src/app/api/mcp/route.ts)

## E14 既有對抗驗證及 eval

- [docs/RED_TEAM_TESTING.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/docs/RED_TEAM_TESTING.md)
- [evals/ai/README.md](https://github.com/wong001110/sejukops-assessment/blob/5284df040ebfe46712c98e7478e7a160389c63f9/evals/ai/README.md)

## E15 Vercel WebSocket 現行官方能力

- [Vercel WebSockets 官方文件](https://vercel.com/docs/functions/websockets)，頁面標示 2026 年 8 月 10 日更新；2026 年 10 月 9 日查核。
- [Vercel WebSocket Public Beta 公告](https://vercel.com/changelog/websocket-support-is-now-in-public-beta)

官方現已支持 Functions WebSockets Beta，需 Fluid compute；連線達 Function 最長時間會中斷，重新連線不保證同一 instance，因此持久狀態應放外部儲存。Next.js 有 experimental upgrade API。這些能力不代表 DSH Host 的持久檔案和長駐程序已可原樣部署到 Functions；本方案仍推薦長駐私有 Host/gateway，其他路線須以 G1 實驗確認。

## 可核對程度

- repo path、commit、角色、DSH controller/設定/儲存行為有來源依据。
- 完整 dependency build、部署兼容性、負載、成本、安全審查及最終可用性尚待開發階段實驗。
- 過去 Sejukops live 測試記錄不是此新 runtime 的通過證據。
- region、共享房間、管理員看私人對話和Owner模型管理範圍是产品待決，集中記於OPEN-QUESTIONS-AND-GAPS。