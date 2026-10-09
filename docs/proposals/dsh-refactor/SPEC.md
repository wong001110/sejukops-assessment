# Sejukops DSH 開發規格

狀態 Proposed，須通過 G0 才可鎖定受影響規格。各節 `DSH-Sxx` 為本提案引用 ID。來源代號見 `SOURCES.md`；U、I、R 見 `DECISIONS-AND-AUTHORITY.md`。所有新欄位與 API 是擬議契約，未聲稱已存在於 repository。

## 1 推薦架構與最小可交付版本

建議保留 Next.js 與 Supabase 業務核心，新增私有 DSH Host 和小型 Sejukops gateway。三個產品介面共用選定 DSH 元件，但各自指定組件及 API 允許清單。模型、Host 或前端不能直接取得跨工作區業務資料。

請求路徑：使用者介面 → Sejukops 登入及 surface policy → room 與 actor 檢查 → 私有 Host adapter → DSH runtime → 受控業務 tool adapter → 現有 Sejukops capability / service。每個 tool 執行前再檢查 actor 與資料 scope；每個可見結果發布前再次確認授權和 generation。

第一個垂直切片只包含已登入且原本可使用 AI 的業務角色、一個唯讀 `readOrder` 工具、一個核定 workspace、兩個互相隔離的虛構 room 與兩個 actor。驗收目標是同一個允許的 room 可由 AI Workspace 和簡化 chatbot 讀取，另一個 room 從 list、直接 ID、歷史、串流及取消都無法存取。管理介面只呈現其已核定 scope 的 room metadata；私人內容查看另受 Q3 決策限制。

現行 Operations AI、dashboard insight 與手動操作入口先保留。首版不引入共享多人聊天室、任意 MCP、plugin marketplace、Electron、任意工作流/子代理管理、AI 自動批准業務動作或新的跨租戶管理模型。未決能力不因畫面有 slot 就自動實作。

DSH 是 developer preview；靜態程式研究沒有證明其可直接生產使用。上線需隔離、負向測試、復原測試與獨立安全審查。[E7]

## 2 DSH 重用與裁剪 DSH S01

來源：U2、U3、U5、U6、CAP-01、UX-01、CLEAN-01；依賴 G0 架構決策。產出一個固定版本、最小依賴閉包的自訂 Web composition。

| 模組群 | 處置 | Sejukops 責任 |
|---|---|---|
| `ui-conversation`、`ui-chat`、`ui-session` | 重用並接 adapter | 顯示授權 transcript、狀態、輸入與停止；不渲染 raw trace |
| `ui-workspace`、`ui-sidebar`、`ui-layout` | 選擇性重用 | room/region 名稱来自服務端；不讓 path 成為 workspace 或 ACL |
| `ui-settings`、`ui-settings-models` | 只重用表單與 revision UX | 透過 Sejukops 設定服務；不直接呼叫 DSH 全域 settings/credentials |
| `ui-model-selection`、`ui-tool` | 重用 | 只列已允許模型；只渲染已清洗的業務 tool 結果與 proposal 連結 |
| `ui-slots`、`ui-renderer`、primitives、theme、locale、store | 保留必要依賴 | 一份 React/ReactDOM/Cordis/slot identity；生命週期與樣式要有邊界 |
| connection、modules、web | 修改啟動與傳輸組成 | browser 只連 gateway，不載入任意 Host boot graph 或任意 dynamic plugin |
| DSH session 與 model runtime | 私有重用 | 單 session 取消、受控 provider transport、配額與 session 對應 |
| shell、terminal、任意 fs 編輯、directory picker、open-in-app | 從產品與 Host tool registry 移除 | UI 沒按鈕不足以通過驗收；直接 RPC/模型工具呼叫亦不可用 |
| plugin 安裝、任意 MCP、raw diagnostics、workflow/subagent 控制 | 首版不註冊或不公開 | 必需的內部服務可保留，但不得讓使用者選路徑、安裝或執行 |
| `ui-approval` | 不能原樣代替業務批准 | 只在能映射既有 canonical proposal 和 Web approval contract 時作視覺重用 |

DSH Web 用 HTTP Remote RPC 加 `/api/remote.mux` WebSocket；本規格選這個 seam。DSH controller 已有 `cancel`。stdio SDK 沒有相同 cancel/close 合約的限制不適用於此 Web 路線。[E2–E5]

先用獨立客製化 Web root，在受控產品 route 掛載。它仍使用 Sejukops 身分和 gateway。是否 direct mount 或樣式隔離需用 spike 驗證，不能假定 DSH 是可直接插入 Next React tree 的單一元件。若用 iframe，只是樣式/生命週期邊界，不提供授權隔離。Next SSR import 不應觸發 DSH 操作 `document` 或另建 React root。

驗收：選定套件可建置；不存在兩份 React/controller singleton；掛載、離開、重入不重複 WebSocket/listener；快捷鍵及 portal 不污染既有頁面；UI 及 Host 均無開發工具能力。

## 3 三介面與角色 DSH S02

來源：U3–U6、I2–I6、AUTH-01、ADMIN-01、STAFF-01、STAFF-02、PREVIEW-01。沿用 `actor-policy.ts` 的保守基礎範圍可在 G0a 局部鎖定；新增 Owner/region/私人內容管理才依賴 Q1–Q4 及 G0b。被所有 gateway、settings 和 UI 任務依賴。

三介面為管理控制台、AI Workspace、簡化 chatbot。管理控制台內保留 Owner 與 Superadmin 的不同入口/授權，不把兩者合成同一種角色。

| 行為 | 管理控制台 Owner | 管理控制台 Superadmin | AI Workspace | 簡化 chatbot |
|---|---|---|---|---|
| staff 管理及 Owner preview | 按現行 Owner scope | 不因 platform role 自動取得另一身分 | 不提供，包含 Owner 登入此介面時 | 不提供 |
| room/region 結構管理 | 只限已核定 Owner scope；G0 前停用新能力 | 只限已核定平台 scope | 不提供管理；只列可使用的 room | 只選允許 room 或目前對話 |
| 私人歷史內容查看 | 不預設全看，須 Q3 明確授權 | 不因維運能力預設全看 | 只讀 actor 可用的對話 | 與相同 actor/room ACL 一致 |
| 業務 AI 與資料讀取 | 不因管理身分自動放行 | 不因平台角色自動放行 | 依目前 business role 及 AI capability | 同一 capability；UI 簡化不增加權限 |
| 已批准模型選擇 | 依管理 scope 或個人會話允許清單 | 同左 | 只在允許清單內選 per-session model | 可隱藏選擇器或用同一清單 |
| workspace 模型政策 | 新 Owner scoped capability 需 ADR 才放行 | 按已核定平台 scope | 不提供 | 不提供 |
| provider endpoint 或 secret 設定 | 現行非 SUPER_ADMIN 拒絕 | 沿既有 `ai_config:manage` gate | 不提供 API、表單或 tool | 不提供 |
| raw diagnostics / reset | 不新增 | 依現有 diagnostics/Demo reset 約束 | 不提供 | 不提供 |
| proposal 準備與批准 | 準備依 business capability；批准走既有 Web | 同左 | 只允許既有可準備能力；跳轉人類批准 | 相同規則，不讓聊天按鈕偷換批准 |

角色細則：

- `ADMIN`、`MANAGER` 只能使用現行 policy 授權的 AI 與業務操作，不能因新 UI 獲得平台設定權。
- `TECHNICIAN` 的簡化 chatbot 不代表新增 native agent 能力；沒有已批准 AI capability 時，呈現現有手動功能或清楚的不可用狀態。
- `SUPER_ADMIN` 管理模型配置，但業務資料仍須合法 workspace/membership scope。不得用 platform role 當通用 tenant bypass。
- Owner 必須由伺服器現有身分/ownership 規則識別，不能靠 `role: "OWNER"` 自製新信任來源。
- preview 保持唯讀，AI run、proposal prepare、cancel、設定寫入均拒絕；顯示預覽不變成 impersonation。
- Guest 仍只在 DEMO scope，受 visit-private history 與共用 atomic daily budget 約束；首個切片可不开放 DSH Guest，舊入口照常。[E8–E11]

伺服器授權是 actor capability ∩ 資源 scope ∩ surface allowlist ∩ 當前狀態。`surface` 由不同受保護 route/handler 或 server-issued session binding 決定，不能信任 browser 傳入 `surface=management`。AI Workspace 的 routes 及 tool registry 永遠不含 Owner/platform mutation；即使 caller 同時是 Owner 也拒絕。前端隱藏與 bundle 分割只是第二層防護。

驗收：逐角色、逐介面 UI/API 矩陣及偽造 surface 測試通過；Owner 功能不在 AI Workspace 的 navigation、context menu、keyboard action、settings、tool 或 proxy RPC 出現。

## 4 Scope 和可信 actor DSH S03

來源：I1–I6、AUTH-01、ISO-01、DEMO-01、OBS-01。既有 workspace/private fixture/actor 範圍可在 G0a 局部鎖定；region、共享與管理可見性才依賴 Q1–Q4 和 G0b。下游為 S04–S08。

### 資料對應

沿用現有 Sejukops workspace 作已存在的資料隔離邊界。`tenant` 只是本方案對安全隔離單位的概念名稱，不能未經決定就新增 tenant、把 OWNER/DEMO 合併或把 branch 升格成 tenant。DSH workspace 的 `path/title/sessionIds` 僅是 runtime 內部容器，沒有商業 ACL。[E4、E9]

新 region 是候選設計：若 Q1 決定它只是 workspace 內的分組，則建立 `region.workspace_id` 與 `room.region_id`，所有外鍵與查詢同時固定 workspace；若 region 等於 branch，應使用有校驗的 branch 外鍵，而非自由字串複製。若它是地理部署區域，另屬 routing/residency，不能和聊天室分組混用。

首版建議資料記錄，沿 repo migration 命名慣例落地：

- `ai_rooms`：opaque room ID、workspace ID、可選 region ID、owner user ID、visibility、title、archived_at、revision。未決共享語意下 `visibility=private`，不用先建群組協作。
- `ai_runtime_sessions`：room ID、runtime instance ID、upstream session ID、profile version、model policy version、history generation、created_at。上游 ID 不對 browser 暴露。
- `ai_runs`：run ID、room ID、request idempotency key、actor reference、auth revision、workspace generation、狀態、last event sequence、開始/結束時間、safe error code。只放必要操作資料，不保存 token 或 secret。
- 若 Q2 批准共享 room，才加入 membership/permissions 表和 sender attribution；不能由 `owner user ID` 猜出共享成員。

Supabase/RLS 與伺服器服務均做 workspace/owner 或已核定 membership 檢查。使用 service-role 的 gateway 仍必須先完成 actor policy；service-role 本身不代表使用者授權。

### Actor 傳遞

1. gateway 用既有 auth resolver 驗證登入、membership、preview、businessReady、auth revision、Guest visit 和 generation。
2. gateway 以 room ID 從資料庫解析 runtime ID、workspace/region 和可用模型，不採用 client actor、cwd、model endpoint、credential target 或 upstream session ID。
3. Host 啟動一次 run 時綁定不可由 prompt 修改的 ExecutionContext。context 只保存服務端 actor 參照、room、run、scope、auth revision、generation、policy version、expires_at；沒有長期 secret。
4. 若 Host 與業務 adapter 跨程序，使用私有 service-to-service transport 加短效且只綁該 run/scope 的 opaque capability，業務 adapter 仍回查当前權限。現有登入 cookie/JWT 不轉交給模型，browser 不能指定此 capability。
5. 每個 tool、結果發布、replay、cancel、設定寫入前重新驗權。失去 membership、登出/revoke、preview 或 generation 改變時立即停止新工具並中止/隱藏不再有權的串流。

選最小可行機制，不為此另建全公司身分平台。內網位址、Host 原 launch token、Origin 檢查及 DSH cookie 都不能代替這套 actor 身分。

驗收：相同帳戶多 workspace、不存在 room、他人 room、被撤銷 actor、Guest visit 串用、猜中 upstream ID 和偽造 actor 均 fail closed；回應不透露別的 scope 物件存在性。

## 5 Gateway 與公開事件 DSH S04

來源：U6、ISO-01、OBS-01、RUN-01、SAFE-01、DSH Web transport 原始碼。依賴 S02–S03；下游 S05–S09。

下列是 gateway 邏輯操作，不要求新建與既有功能重複的 routes。實作 spike 應把它們對映到 repository 路由慣例並鎖定 route contract。每個 mutation 使用既有 origin/CSRF 保護與可追溯 request ID。

| 操作 | Input 與約束 | Output 與主要失敗 |
|---|---|---|
| listRooms / getRoom | server actor，加可選已授權 region/filter/cursor | 授權 metadata；search/cursor 不洩露別人標題、筆數或存在性 |
| createRoom | title、已授權 region；不能帶 workspace/path/任意成員來擴權 | opaque room ID、revision；scope/能力不足拒絕 |
| getHistory | room ID、opaque cursor、限制 page size | safe message projection；不回 raw tool args/result/trace |
| submitTurn | room ID、message、allowed model ID、client request key、expected room revision | 202 + run ID；24 KiB 既有邊界先保留；衝突 409 |
| followRun / replay | room/run ID、最後 event ID | 只屬於此授權 run 的清洗事件；cursor gap 回 resync_required |
| cancelRun | room/run ID、request key | accepted/no-op 與目前狀態；只取消指定已授權 run |
| rename/archive | room ID、expected revision、name/operation | 新 revision；archive 不等於刪除歷史 |
| getModelCatalog | actor、surface 與已授權 room | 僅可選 model ID/label/必要限制；不回 endpoint 或 secret |
| manageRoom / region / settings | 管理 route server binding、scope、expected revision | 僅核定管理 capability；AI Workspace route 絕不轉送 |

未列出的上游 Remote 操作一律不公開，包括任意 settings、credentials、filesystem、plugin、全域 control、fork、raw search/follow、Host session ID 與 diagnostics。fork、共享、永久刪除與檔案附件不是首版需求；不能因上游有 API 就放行。

公開串流事件最小 envelope：`eventId`、`roomId`、`runId`、`sequence`、`type`、`occurredAt`、`schemaVersion`、`payload`。可用 type：`run.started`、`activity`、`message.delta`、`message.completed`、`proposal.available`、`run.cancel_requested`、`run.completed`、`run.cancelled`、`run.failed`、`run.interrupted`、`resync_required`。`payload` 每種類別獨立白名單 schema；不得把任意 DSH event 放入 `data` 欄位逃過過濾。

對需要確實來源或業務判斷的輸出，沿用現有 schema/source 驗證與 deterministic presentation。未驗證模型 prose 不當作業務事實串到使用者畫面；在可驗證完整結果前可只傳安全 activity。`message.delta` 只適用已核定可逐字公開的內容，並經輸出清洗。

DSH Host 的 session control 目前 baseline 列全部 sessions 並 broadcast projection 給全部 streams。因此 browser 不可直接連 Host；gateway 不能先把整批 frame 送到 client 再過濾。必須逐 room/run 檢查後重組安全事件，對 title、metadata、錯誤、統計與 heartbeat 也檢查。Host raw stream 不暴露於公開網路。[E3]

WebSocket 握手沿同源授權或一次性、短效、綁 room/run 的 server ticket；不可把 cookie/secret 放 URL query。重連與每次 replay 都重新驗權。限制每人連線數、每 room 活躍 run、event buffer 大小與單請求上限；數值沿既有界限起步，額外值由壓測後鎖定。

附件首版關閉。若後續批准，需獨立 resource ACL、病毒/型別/大小策略、下載重新驗權和 scoped signed URL；不得打開任意 Host file path/download 作捷徑。

驗收：未授權事件、標題、tool args/result、stack、provider response、key 在連線、重連、錯誤及過期 cursor 中零洩露；原始 Host URL/RPC 的外部連線不可達。

## 6 Session 生命週期與持久化 DSH S05

來源：RUN-01、ISO-01、ACT-01、DEMO-01、OBS-01；依賴 S03–S04；下游所有 UI 與 rollout。

### Run 狀態

服務端單一真相：`QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED`；取消時可進 `CANCEL_REQUESTED` 再到 terminal。對 restart 或無法確認工具結果的情況，使用 `INTERRUPTED` 作 terminal，需要人類查看結果後明確新送，不自動重跑。若 `COMPLETED` 已成立，晚到 cancel 回 `already_terminal`，不可把完成的業務結果改稱取消。

每 room 同時間最多一個 active run；第二個 submit 返回 409 `ROOM_BUSY`，不建不可見 queue。相同 actor、room、client request key 的 retry 返回原 run；key 相同內容不同為 409。即使未來 Q2 批准共享 room，也先維持序列提交，避免無意建立多人協作編輯器。

### 取消

gateway 先查 run 與 actor，透過 runtime adapter 對應該 upstream session 的 `cancel`。DSH 回 `accepted:true` 只表示已接收取消，UI 顯示「正在停止」直到 terminal 事件或後續狀態查詢確認。保留單一 session cancel，不透過關掉整個 Host 影響別人的 run。[E5]

上游 `cancel` 使用 `keepInbox:true`，不代表佇列已清空。首版不開啟 DSH inbox/queue UI，gateway 只允許一個 outstanding prompt，不能提交 pending inbox。啟動或重連若發現非空 inbox，先凍結該 session 並核對，不自動執行。撤權、generation reset 與停用需凍結整個 session 的後續 prompt/tool/output，並按已驗證 controller 合約隔離或清理未執行 inbox；不能只取消當前 turn 後讓下一則排程執行。

cancel_requested 立即禁止新 tool admission；已在途唯讀工作盡量 abort。已建立的 canonical proposal 不因停止生成而被刪除或自動批准，顯示既有 proposal 狀態。若後端業務批准/執行已由人完成，停止聊天不會回滾業務操作。對逾時未能確認停止的 runtime，UI 明確標示狀態待核對，gateway 阻止相同 room 新 run，直到 reconcile 或操作員隔離該 Host。

### 重連與復原

event ID 在同一 history generation 內單調递增且可去重。公開 terminal 與 completed message 先持久化再回報；token delta 可批次 checkpoint，但重連需給安全 snapshot，再從已確認 event sequence 接續。若 cursor 被壓縮或 generation 不符，返回 `resync_required` 並重新取安全 history，不能假造漏失文字。

瀏覽器斷線不等於取消。run 可在原 deadline 內繼續；回來後 query state + replay。登出/撤銷則停止新工具、撤銷串流並按 policy 取消。Host restart 時載入 checkpoint 和 room/session mapping；對仍標 RUNNING 的 run 先核對 persisted terminal。無證據已完成者標 `INTERRUPTED`，不自動重跑 provider 或副作用。

### 儲存責任

- Supabase 保管 room/region/ACL、runtime mapping、run 索引、設定政策、business proposal 及安全 audit。
- DSH 持久卷保管其 JSONL/checkpoint/history（或其現有 persistence seam），不成為 business proposal 的真相。
- gateway 以可重建的安全 projection 提供產品 history。不可同時獨立修改兩份 transcript 造成分歧；runtime record 是 chat 原始來源，Sejukops metadata 與 business state 各自有明確權威。
- 每個隔離 Host 的 `DSH_HOME`、checkpoint/cache 與 credentials 目錄分離。檔案權限與備份需防止 tenant 間讀取。密鑰只在核定 secret store 或短期 runtime 注入，不能進 transcript。
- 以 room/run idempotency、revision compare-and-set 和單 writer lease 防止重複啟動；多 instance/重啟時 lease 過期只能由 reconcile 奪取，不把 DB 記錄當成 runtime 已停止的證明。
- archive 是 UI 状態；retention、export、永久刪除和備份刪除由 Q7 核定，首版不自動清理或刪舊聊天。DEMO generation reset 仍按原 DATA-01 機制切斷過期資料。reset 必須使舊 run、room/session runtime mapping、history projection 與 replay cursor 全部失效；新 generation 不能重新掛接舊 DSH transcript。保留的舊檔只供核定的隔離維運/復原流程，不透過產品 history 或新 run 讀回。

既有上限先不放寬：native workspace agent 5 model steps、6 tool calls、40s runtime deadline、1600 output tokens；HTTP 約 45s 外層界限在長連線設計中改為明確 run deadline，不能因 WebSocket 常駐而變無限執行。Guest 每 provider step reservation、Operations 2 steps/650 tokens、dashboard 180 tokens 的獨立限制保留，未遷移功能仍由原路徑負責。[E10–E12]

驗收：斷線/重連、雙擊送出、兩 tab、cancel race、Host restart、volume restore、過期 generation 和 membership revoke 都有可重現測試；無跨 session 取消、重複 tool 或假 completed。

## 7 模型設定與密鑰 DSH S06

來源：U2、U4、ADMIN-01、OBS-01、SAFE-01；依賴 S02–S03；現行 SUPER_ADMIN gate 及 mock adapter 可在 G0a 局部鎖定，Owner新權限才依賴 Q4/G0b，真實provider配置另依賴Q6/G1。下游 provider integration。

推薦唯一設定權威仍是 Sejukops 現有平台設定服務。DSH models/settings UI 經 adapter 顯示與修改經授權的欄位；不讓 DSH profile patch 和 Supabase 成為可各自寫入的兩套真相。

区分三件事：平台 provider/endpoint/secret 設定、workspace/region 可用模型政策、per-session 模型選擇。現行第一類繼續 `SUPER_ADMIN` gate；Owner 如需管理第二類，新增狹窄 scope capability 需 Q4 ADR 與 explicit policy tests。Owner 可選既有核定 provider 的模型，不等於有權上傳平台 key 或設定任意 endpoint。

設定讀取只回 redacted descriptor、可用模型及 revision。secret 欄位 write-only、獨立提交，不放 generic patch、log、error、WebSocket、storage 或模型 prompt。密鑰管理服務驗權後寫核定 secret store；只把必要值在服務端注入正確 Host，browser 永遠拿不到明文。首版沿用現有 secret/network policy，不新增通用 secret vault。

保存用 optimistic concurrency；舊 revision 回 409 並提示重新載入，不能 last-write-wins。每次 run 固定 `modelPolicyVersion` 與模型，設定變更只影響新 run；安全撤銷/停用則立即阻止新 provider/tool 並處理活躍 run。不得在同一回答中靜默換 provider。

DSH 自訂 endpoint 允許 localhost/IP/ports 的 developer UX 不可直接沿用。必須接入現有 HTTPS、DNS-pinned 與 outbound validation 保護，阻擋 loopback、private/link-local、metadata endpoint、DNS rebinding、redirect downgrade；只接受批准 provider 清單。不能假設 DSH 自動繼承 `safe-sdk-provider.ts`。[E6、E12]

驗收：business actor、Owner 非 SUPER_ADMIN、preview 與偽造 scope 无法變更全域 provider；key 不出現在任何 public projection；衝突 revision、key rotation、provider 不可用與 SSRF 測試有明確結果。

## 8 業務工具與人類確認 DSH S07

來源：CAP-01、ACT-01、KB-01、KB-02、DOC-01、SAFE-01、DEMO-01；依賴 S03–S06。

工具是現有 shared capability/service 的薄 adapter。第一切片只註冊 `readOrder`；驗收通過後逐項加入：

| 邏輯工具 | 既有來源/角色 | 安全條件 |
|---|---|---|
| `readOrder`、`recentOrders` | workspace orders capability | server固定 workspace，逐筆檢查可見性；只回必要欄位 |
| `searchKnowledge` | workspace knowledge service | 保留 publication/index lifecycle、scope、來源引用與 generation |
| `listTechnicians` | 現有技師查詢能力 | 按業務角色和資料 scope，不能變成 staff 帳戶管理 |
| `prepareAssignment` | assignment proposal service | 只在既有 intent/role/schedule checks 通過時準備；模型不能批准 |
| `proposalInspect` | 既有 proposal 狀態讀取 | 只讀可見 canonical proposal；不能以 tool output 代替正式狀態 |

名稱可對映現有 MCP 的 `recent_orders`、`knowledge_search`、`assignment_propose`、`proposal_inspect`，但本規格不要求打開外部 MCP；`MCP_EXTERNAL_ENABLED` 及 MCP-01/02 的 deferred 狀態維持。[E13]

禁止通用 SQL、HTTP fetch、檔案讀寫、shell、任意 URL/任意 MCP target、staff create/disable/reset、Owner preview 切換、ai config、Demo reset、跨 scope search、approve/execute proposal。工具 schema 不含可讓模型任意選 actor、tenant 或 credentials 的欄位。

提案流程：最新使用者訊息符合既有明確意圖 → server 檢查 actor/schedule/source/order/generation → prepare 持久化 `PENDING` canonical payload → 將摘要、版本/有效期及批准連結公開 → 已登入人類在既有 Web confirmation 看同一 payload → 既有 executor 原子檢查狀態/版本/expiry/generation/idempotency → execute 並 audit。

聊天內的「好」「同意」、DSH 通用 approval、prompt 裡的批准字串，或 assistant 自產的按鈕都不能完成批准。若要把既有確認頁放進新 UI，先做 exact contract equivalence review；仍需獨立 authenticated human action，不由模型 tool 發起批准。

保留當前 source validation、deterministic presentation、quota、schedule-intent 與 fail-closed 邏輯。knowledge/tool 回覆及文件是資料，不能變成新的系統指令；attempts to redirect tools/credentials/scope 只回安全失敗或不支援。

驗收：不存在可從 prompt、tool chaining、設定或 callback 批准/執行業務動作的路；payload swap、stale version、expiry、generation reset、重複批准及併發執行不造成錯配或重複 assignment。

## 9 部署 升級與回退 DSH S08

來源：ARCHITECTURE、RUN-01、CLEAN-01、OBS-01；依賴 S01–S07 與 Q5/Q6/Q7。

現行 architecture 是一個 Next.js deployment 與一個 Supabase project。新增 long-lived Host 有真正的 session/WebSocket/checkpoint 理由，但仍是 architecture 變更，須 ADR 批准。不能說目前 architecture 已支持此服務，也不能把 Vercel serverless route 當作 DSH Host 本體。[E9]

推薦先在隔離測試環境運行一個私有、長駐 Node/container Host，每個已核定 tenant boundary 有独立 profile/DSH_HOME/volume。預設部署路線為 Next 負責登入、scope解析、短效 ticket 與適合的 HTTP control；browser 的公開 WebSocket 由長駐 gateway 終止，gateway 驗 ticket 及每個操作，再連私有 DSH Host。原生 Host Remote 永不公開。Vercel 現已提供 Functions WebSockets Beta，不能再以「不支持 WebSocket」排除它；但其連線會受 duration 限制、重連可能換 instance，Next使用experimental upgrade API，需外部持久state。[E15] 若改採此路線或 browser SSE/HTTP，須在 G1 先验证現有Next版本兼容、實際帳戶/環境、timeout、replay、routing、affinity與secret/private-network邊界。Functions支持WS並不等於可原樣托管DSH持久Host。供應商、成本與容量在 Q5 核定，不在靜態研究中假定。

Host 不開公網原生 Remote，出口只允許批准模型 provider 與業務 adapter；不掛載應用原始碼、user home 或跨 tenant volume。Host profile、DSH commit、image digest、adapter contract 和 migration version 共同固定；安全修補不能自動跟 upstream master。

升級流程：讀 upstream diff/授權與安全通告 → 重建 dependency closure/SBOM 並保留 MIT notices → adapter contract tests → mock 角色/隔離/stream regressions → staging backup/restore 與 restart → 指定範圍 canary → 獨立 review → 明確部署批准。不要把 DeepSeek 名稱/logo 使用權視作程式授權的一部分。[E7]

回退採 feature flag 切回舊聊天/手動入口，保留 DSH history 及所有 canonical proposals；history 只有在同一 ACL、generation 與安全 projection 檢查仍有效時可讀。安全 gateway 停用時可暫時不提供 history，不得讓browser改走raw Host或直接檔案旁路。新增 schema 用 additive migration，最初不刪舊欄位或舊紀錄。runtime image 回退前確認 checkpoint 可被上一版讀取；不相容時保留舊 volume snapshot，只對新 instance 測試，不能覆寫原檔。已發生業務動作不靠回退 UI 撤銷。

最低可觀察資料為 request/run/room mapping、actor reference、scope、policy version、quota reservation、tool admission/result code、terminal state、safe failure、proposal ID；使用者只見安全 activity，授權 technical logs 私有保存並清洗敏感內容。監控 run 卡住、cancel 到 terminal 延遲、reconnect gap、拒絕率、quota 衝突、Host restart 和 event filter drop；門檻由測試鎖定。

驗收：外網無法直連 raw Host；同時兩 scope 互不讀寫；滾動升級和回退不遺失 history 或批准紀錄；restore 演練可還原 room/session mapping；新功能旗標可逐 workspace 關閉。

## 10 依賴與開發完成條件 DSH S09

來源：U1、DEVELOPMENT_PROTOCOL、GIT_WORKFLOW、既有 stable criteria；依賴全部規格。

依賴順序：G0a 基礎切片鎖定 → S01/S02/S03 的保守範圍 → S04 → S05/S06 → S07 → S08 → release acceptance；新增 Owner/region 管理另受 G0b。UI composition 可用 mock 與 S02 合約平行驗證，不能先公開真實 Host 再補 ACL。

最小 release 同時滿足：

- Owner/platform 能力在 AI Workspace 的 UI、API、tool、事件四個方向都不可達。
- 對 list/search/direct ID/history/follow/control/reconnect/cancel/settings 的負向隔離測試通過。
- 授權 actor 的 readOrder 真實業務資料來源可核對，未授權 actor 得到一致拒絕。
- 生存期限、quota、provider safe transport、source checks、人類批准與手動 fallback 不退化。
- run submit/stop/reconnect/restart 的最終狀態可驗證，未用 accepted 或 UI 動畫充當完成證據。
- package build、repo既有型別/lint/unit/integration、安全回歸與最終 UI 檢查通過；live provider test 必須在另有明確授權下作有限測試。
- 部署路線、備份、rollback、安全審查和負責人確認完成。完成本文件不等於達成以上條件。

不含生產部署、外部 MCP、重寫 Operations/dashboard、多人協作、檔案附件、批量資料刪除或租戶架構重做。之後新增範圍要回到對應 ADR/Spec，不能在實作 Task 內自行擴寫。
