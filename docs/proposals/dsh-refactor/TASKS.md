# 分階段開發任務

全部為 agent-ready 的 Proposed 任務模板，目前未獲實作授權。每個任務釋出前必須列明已鎖定的 Spec 版本與審批證據；沒有 lock 就保持 blocked。G0a 可先鎖定最小基礎切片，G0b 才解鎖新 Owner/region 能力。不要等待所有未來產品選項才驗證基礎依賴，也不要跳過與該任務直接相關的決策。

## 階段與依賴

| Phase | Epic | Sprint 順序 | 任務 | 完成出口 |
|---|---|---|---|---|
| P0 | 範圍與技術邊界 | S0 | T00，然後 T01 | G0a lock、依賴/route/file scope報告 |
| P1 | 私有運行與隔離 | S1 | T02、T03平行；再T04 | 無開發工具Host與可信actor gateway |
| P1 | 事件與復原 | S2 | T05、T06；T07可平行 | 安全projection、取消/reconnect、單一設定權威 |
| P2 | 最小業務切片 | S3 | T08、T09 | 雙介面同room正向、雙actor隔離負向 |
| P3 | 管理與既有業務能力 | S4 | T10需G0b；T11 | scoped管理、KB/proposal人類批准不退化 |
| P4 | 發布驗證 | S5 | T12，然後T13 | 獨立review、回退證據、部署批准請求 |

Sprint 是依賴分組，不承諾固定天數。T01 後才按真實 build/接口差距估工；不能以靜態研究報精確完成日期。

依賴 DAG：T00 → T01 → T02；T00 → T03；T02 + T03 → T04；T04 → T05 → T06；T03 + T04 → T07；T02/T04/T06/T07 → T08；T01/T05/T06/T08 → T09；G0b + T03/T07/T09 → T10；T08/T09 → T11；T06–T11 → T12 → T13。若發布範圍明確排除管理新功能，可讓 T10 保持 blocked，且不得宣稱 Owner/region 產品需求已交付。

## 共用執行邊界

以下新目錄只是建議檔案scope，不聲稱repo已存在。T00/T01確認後，寫入正式Task且限制每一單的可改範圍：`src/lib/ai/dsh/**`、`src/components/ai/dsh/**`、`services/dsh-host/**`、`services/dsh-gateway/**`、對應測試與 additive migrations。API routes 使用既有 `src/app/api/workspaces/[workspaceId]/...` 慣例，精確名稱由 T01 route contract 決定。

所有 Task 共用保護範圍：未列出的auth policy、業務service、既有API、Operations/dashboard runtime、外部MCP、歷史資料、deployment secrets和既有stable IDs。若必須改它們，先修改該Task scope並review，不能順帶改。改動共有helpers須回歸原callers。

每單必備 evidence：最終diff、檔案清單、Spec及既有criterion映射、實際命令/結果、正負向測試、未執行項目、回退檢查。共用 DoD：所有本Task acceptance成立、最終變更測試通過、review無未解阻擋、scope未擴張，進度才可寫入PROJECT_STATE。

## T00 對齊權威與釋出切片

- 目標與來源：確認 G0a，核定 S01–S09 中最小切片的相關契約；對應 AUTH-01、ISO-01、CAP-01、UX-01。
- 前置：當前 HEAD、原權威文件、用戶決策；允許文件工作後執行。阻擋：任何不清楚的上層衝突。
- 可改：經批准的 ADR 位置、docs/PRODUCT_DIRECTION、ARCHITECTURE、STAFF_ACCESS、IMPLEMENTATION_PLAN；僅記錄真實狀態的 PROJECT_STATE。保護：全部應用程式與既有進度證據。
- 工作：核對SHA漂移；保留stable IDs；將private room、既有角色、readOrder、mock provider與無Owner新權的基礎範圍正式鎖定；登錄正式Task IDs及各Task file scope。
- 驗收：G0a acceptance來源明確；Q1–Q8未被偷偷關閉；Owner/region管理需G0b；README/Spec/Task用詞一致；不得把本提案本身當approval。
- 測試與證據：文件diff、引用完整性、依賴無循環、decision-to-Spec-to-Task對照；不宣稱程式測試。
- DoD：G0a由責任人批准且所有下一單的locked Spec可取得。
- 回退：revert文檔提案，不改已accepted歷史；保留decision記錄。

## T01 驗證 DSH 元件與傳輸 seam

- 目標與來源：S01、S04、S08；CAP-01、UX-01、CLEAN-01。
- 前置：T00及G0a鎖定；只在已授權的隔離prototype工作區，不部署。
- 可改：獨立 spike 目錄、最低必要 package/lockfile、測試 fixture、route contract文檔。保護：生產route、既有UI、secret和全域theme。
- 工作：固定DSH commit；選最小client dependency graph；mock Host接 ui-conversation/chat/session；核對React/ReactDOM/Cordis/slots唯一性、root/CSS/portal/shortcut/unmount；定義gateway操作與具體公開route/WS termination mapping。
- 驗收：乾淨build；SSR/import不動document；連續mount/unmount三次無重複listener或socket；既有頁面body/html/theme不被污染；證明選定HTTP RPC/WS及單session cancel seam，不誤用stdio限制。
- 測試與證據：dependency tree、bundle/啟動圖、瀏覽器正反導航、exact route table、需fork檔案清單、license notices。
- DoD：選一條可實作client mount/transport路線並更新鎖定Spec；若失敗提出最小替代，不自行重寫全UI。
- 回退：刪隔離spike或revert測試branch；未影響正式入口。

## T02 建立最小私有 Host profile

- 目標與來源：S01、S07、S08；CAP-01、SAFE-01。
- 前置：T01確定依賴閉包。
- 可改：`services/dsh-host/**`的profile、adapter hooks、container/test config；保護：全域宿主機配置、所有production網路/密鑰。
- 工作：保留session/model所需核心服務；只註冊mock或readOrder stub；移除shell/fs write/terminal/plugin install/任意MCP與Owner工具；固定DSH_HOME；只綁私有地址。
- 驗收：最小profile啟動/重啟成功；registry清單無禁用工具；直接RPC、模型tool名偽造和boot graph皆無法開啟；必需fs service僅內部store可用，無任意使用者path。
- 測試與證據：registered tools、允許RPC、私有port檢查、拒絕測試TC01/TC03、啟動logs清洗。
- DoD：只提供gateway測試接口，未公開任何上游控制面。
- 回退：停用新profile/image；保留測試volume作診斷，不移除既有資料。

## T03 建立 room 和 actor 對應

- 目標與來源：S02–S03、S05；AUTH-01、ISO-01、DEMO-01。
- 前置：T00；基礎private room方案已lock。region/共享模式未過G0b不可加入。
- 可改：additive migrations、room/run repositories、RLS、對應policy wrappers與tests。保護：現有角色enum、Owner/DEMO邊界、原actor resolver與business role semantics。
- 工作：新增opaque room/runtime mapping/run索引；room固定workspace與owner；resolve現有actor；服務端ExecutionContext；membership/auth revision/generation失效；service-role查詢也驗scope。
- 驗收：不同actor/workspace/Guest visit不能互讀metadata；惡意room ID、workspace/body actor不能改authority；preview/businessReady false拒絕；new generation不能讀舊history mapping。
- 測試與證據：schema與RLS測試、TC02/TC04/TC05/TC16、migration up及非破壞rollback演練。
- DoD：兩個fictional actors/rooms的fixture可重現，所有隔離負向通過。
- 回退：關feature flag並回舊入口；保留新增表，不在已含資料時drop。

## T04 實作窄 gateway 與握手驗權

- 目標與來源：S02–S04、S08；AUTH-01、ISO-01、OBS-01。
- 前置：T02、T03；T01 route mapping已lock。
- 可改：核定gateway service、workspace API handlers、transport adapter及tests；保護：原Host直接對外proxy、現有auth規則及其他API。
- 工作：實作list/history/submit/cancel/catalog的明確schema；server surface binding、origin/CSRF、opaque mappings、私有service-to-service context；WebSocket ticket或同源方案、reconnect重驗；拒絕所有未列Remote操作。
- 驗收：list/search/direct ID/follow/control/設定越權全部拒絕；Owner在AI Workspace仍不可Owner APIs；client無法偽造surface；ticket短效單次且不可跨room/run；Host原地址不可由browser直接使用。
- 測試與證據：TC01–TC06、TC18、API schema snapshot、socket握手/吊銷/跨origin測試。
- DoD：只有被授權的邏輯操作能抵达Host，raw broadcast未對browser送出。
- 回退：關閉新routes/WS入口及flags；不動舊API。

## T05 實作安全事件和 history 投影

- 目標與來源：S04–S05、S07；OBS-01、KB-02、ISO-01。
- 前置：T04。
- 可改：projection adapter、event envelope、history/replay API與tests。保護：raw trace/log/credentials直接透出、原source驗證放寬。
- 工作：按event type白名單重建payload；list/title/error亦隔離；為安全activity、validated answer、proposal ID建立render contract；snapshot/sequence/gap；generation reset使projection與cursor失效。
- 驗收：注入secret/raw args/provider error/其他room title均不出現在網路payload；無scope frame連heartbeat metadata也不能洩露；未驗证prose不當作grounded answer串流；重播去重且gap要求resync。
- 測試與證據：TC06/TC07/TC09/TC16、network capture fixture、source validation regression。
- DoD：所有公開event/histories通過schema与資料外洩negative tests。
- 回退：停用stream adapter，回舊已驗证入口；保留raw store私有。

## T06 實作 run 取消與復原

- 目標與來源：S05、S08；RUN-01、ACT-01、DATA-01。
- 前置：T05、T03。
- 可改：run service、lease/idempotency、cancel adapter、reconcile、restart/replay tests。保護：業務proposal批准/執行邏輯。
- 工作：單room單run、重複request不重跑、真實terminal；DSH cancel accepted→settled；關閉queue入口並拒絕第二prompt；keepInbox:true情況發現pending時隔離；revoke/reset凍結整個session；crash後INTERRUPTED且不重播副作用。
- 驗收：TC08–TC12/TC16；cancel A不影響B；晚到cancel不改completed；accepted未settled UI不顯示已停止；reset失效所有舊run/mapping/cursor；checkpoint與DB失配可reconcile；未確認執行結果不自動重試。
- 測試與證據：故障注入順序、兩tab race、程序kill/restore、state transition table、cancel延遲測量。
- DoD：每個測試run都有真實、可查的最終狀態或明確隔離狀態；沒有隱藏queue繼續跑。
- 回退：先拒新run，drain/隔離活躍run再關flag；保留store與proposal，不強刪session。

## T07 接上單一設定與安全 provider

- 目標與來源：S06、S02；ADMIN-01、SAFE-01、OBS-01。
- 前置：T03/T04，Q6測試配置核定；未有live授權時用mock。
- 可改：settings UI adapter、既有platform config service整合層、provider transport wrapper與tests。保護：`ai_config` SUPER_ADMIN條件與secret store現有權限。
- 工作：reuse DSH表單，重定向為Sejuk服務；write-only key、redacted descriptor、revision conflict；per-session allowed catalog；沿用HTTPS/DNS-pinned outbound政策；run固定model policy version。
- 驗收：TC13/TC14；非SUPER_ADMIN及AI Workspace設定寫入拒絕；key無public/log leak；localhost/IP/metadata/rebinding/redirect不繞過；rotation/new revision不靜默改當前run。
- 測試與證據：role/transport/regression tests、設定source-of-truth圖、mock key紅action測試，真實secret不得進證據。
- DoD：只有一個可寫settings真相；mock provider與現有安全限制通過。
- 回退：回舊settings UI及provider路徑；不還原失效key、不把key寫回檔案history。

## T08 完成 readOrder 垂直切片

- 目標與來源：S03–S07；CAP-01、RUN-01、ISO-01、DEMO-01、KB-02。
- 前置：T02/T04/T06/T07。
- 可改：readOrder adapter、run budget/deadline hooks、結果presentation與tests。保護：既有shared capability語意、source/intent checks、原Operations/dashboard。
- 工作：服務端actor綁定；readOrder唯讀；原5steps/6tools/40s/1600tokens及outer deadline具體接上；每step quota保留；來源/generation在公開前再驗證。
- 驗收：正確actor可以讀同scope訂單，其他人不能；無任意SQL/HTTP/fs；超限、provider中斷、來源不符均safe fail；mock結果與現有capability結果一致。
- 測試與證據：TC02/TC05/TC07/TC15、bounded run fixture、工具呼叫次數/配額斷言。
- DoD：一條完整submit→tool→validated answer→cancel/replay測試通過。live model另有G1及授權才執行。
- 回退：切回原agent入口；adapter保留disabled，不替換所有舊runtime。

## T09 組裝 Workspace 與簡化 chatbot

- 目標與來源：S01–S02、S04–S05；UX-01、PREVIEW-01、STAFF-UX-01。
- 前置：T01/T05/T06/T08。
- 可改：核定client root、`src/components/ai/dsh/**`、受控產品route與UI tests。保護：Owner現有頁面、平台settings、全域樣式、其他業務入口。
- 工作：AI Workspace只組business slots；chatbot只留對話/輸入/停止/必要room選擇與來源；不註冊Owner menus/actions；按actor capability顯示；保留原手動fallback。
- 驗收：同允許room的兩介面狀態一致；不允許角色不能因精簡chat獲AI；Owner登入Workspace也無管理入口/API；preview無AI；reload/back/forward/logout/revoke/error/cancel均清楚。
- 測試與證據：TC01/TC08/TC09/TC17、desktop/mobile視覺驗收、快捷鍵與unmount、無raw event network capture。
- DoD：UI角色矩陣和雙介面垂直切片通過，沒有把整套DSH管理UI包進Workspace。
- 回退：按workspace關flag，恢復舊chat/手動UI；保留history並提供狀態說明。

## T10 加入已核定管理範圍

- 目標與來源：S02–S03、S06；U4、ADMIN-01、STAFF-01。
- 前置：G0b正式完成Q1–Q4，T03/T07/T09。未完成時本Task完全blocked，不能替用預設全看權。
- 可改：經ADR指定的Owner/Superadmin管理route、窄capability、region mapping migration與tests。保護：preview禁AI、Owner/staff身份、全域credential gate，除非另有明確改動決策。
- 工作：依已核定region/room政策提供建立、rename/archive、模型允許清單管理；Owner與Superadmin單獨capability；私人內容可見性按Q3；稽核保持真實actor。
- 驗收：每管理操作都驗scope/revision；無跨workspace region搬移；Owner無法改platform secret；AI Workspace不能調此API；private room授權不能由管理角色推定。
- 測試與證據：更新role matrix、TC01/TC02/TC13/TC19、批准ADR trace、migration與audit tests。
- DoD：用戶要求的管理能力逐項可驗證；任何未做項目明列deferred，不能被『管理功能完成』掩蓋。
- 回退：先關新管理mutation，保留讀取及原管理功能；新增region資料不刪除。

## T11 接回 KB 與 proposal 流程

- 目標與來源：S07、S04；CAP-01、ACT-01、KB-01/02、DOC-01。
- 前置：T08/T09；每新增工具有locked schema。
- 可改：recentOrders/searchKnowledge/listTechnicians/prepareAssignment/proposalInspect薄adapter、對應renderer與tests。保護：canonical proposal、Web approval/executor/SQL idempotency與知識publication rules。
- 工作：逐工具註冊白名單；intent、schedule、order/source/generation checks；只輸出PENDING摘要和既有Web確認連結；公開activity不送raw tool results。
- 驗收：TC07/TC15/TC20；準備≠批准；模型不能調approve/execute；聊天『同意』無效；stale/swap/expiry/reset/double-approve都不能錯配或重複；KB只引用有效已發佈來源。
- 測試與證據：舊ACT/KB回歸、精確payload comparison、SQL atomic/idempotency證據與prompt injection負向。
- DoD：新runtime接上現有業務核心，沒有第二套proposal engine。
- 回退：移除新tool註冊，原Web confirmation保留；所有既有PENDING/APPROVED紀錄仍可正常處理。

## T12 完成受控整合與獨立驗收

- 目標與來源：S08–S09、全部既有criterion。
- 前置：範圍內T06–T11；G1測試部署/模型參數核定；live與部署動作各有授權。
- 可改：evals/tests/fixtures、staging設定與rollback runbook；不得為了測試通過放寬policy。
- 工作：mock全矩陣→隔離staging→有限live provider→人類UAT→獨立review；測兩個隔離Host/actors、restart、volume restore、WS再連/終止、舊新入口互換；檢查最終diff全量aggregate checks。
- 驗收：TEST_CASES全部scope內案例pass；Q5路由/生命週期/持久化有實證；無未處理權限與資料洩漏阻擋；signed-staff/並行/Guest缺口誠實列明。
- 測試與證據：可重跑命令、actual環境/版本/請求數、每項pass/fail/not-run、最終commit、review與狹窄修正記錄；不得拿舊11次live/22checks算新版本。
- DoD：release candidate通過獨立review，不等於已production部署。
- 回退：關staging flag、restore測試snapshot；停止live calls但不刪證據或真實business紀錄。

## T13 釋出與回退演練

- 目標與來源：S08–S09；RUN-01、OBS-01、CLEAN-01。
- 前置：T12、G2、明確production部署批准；未有批准只能完成runbook與dry-run。
- 可改：核定環境的feature flags、image pin、additive migration配置、runbook及真實PROJECT_STATE；保護：未批准workspace/tenant、舊資料和secrets。
- 工作：備份且驗restore→指定workspace canary→監控安全拒絕/卡住/cancel/reconnect/錯誤→核對成功→批准後擴大。切換前列舊run drain/隔離方案及不可逆業務狀態。
- 驗收：明確canary scope、監控門檻與責任人；flag關閉即可回舊入口；前一image/checkpoint compatibility已核對；沒有drop舊表或清history；發布版本與remote確實一致。
- 測試與證據：批准、deployment/image digest、migration結果、canary/rollback演練、後續觀察窗口與停止條件。
- DoD：批准範圍內可用且觀察窗口達成，未完成項目留PROJECT_STATE；不用中間accepted結果宣稱成功。
- 回退：停止新run→drain或隔離→關flag→回舊入口；必要時回前一兼容image並掛載對應snapshot。業務proposal及已執行assignment保持真實狀態。
