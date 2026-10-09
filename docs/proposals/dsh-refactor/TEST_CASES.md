# 驗收案例

這是待執行測試設計，不是通過報告。用fictional fixtures：工作區W1/W2、合法actor A/B、私人room RA/RB、各自Host H1/H2；另外含同workspace的不同private room，以免只測到tenant隔離。測試actor至少包括有AI權限的staff、TECHNICIAN、SUPER_ADMIN、Owner但非SUPER_ADMIN、Owner preview、Guest DEMO及被撤銷membership。

每個案例記錄版本、環境、步驟、預期/實際、pass/fail/not-run、evidence位置。先mock，再依G1授權做整合/live，不以舊版evidence代替新版本。任何跨scope資料/secret洩露或未經人類批准的業務mutation都是release blocker。

## 必測矩陣

| ID | 情境與操作 | 可觀察的預期 | Spec與既有criterion |
|---|---|---|---|
| TC01 | 每角色進管理、Workspace、chatbot；Owner從Workspace偽造管理surface、RPC及settings URL | Workspace/chatbot均无Owner/platform control；server拒絕；沒有權限的tech/preview不能AI | S02/S04，AUTH-01 ADMIN-01 PREVIEW-01 |
| TC02 | A用RB ID試list/search/history/follow/control/rename/archive/cancel；涵蓋不同及相同workspace私人房 | 一致拒絕；title、counts、cursor、metadata不透露RB存在；合法RA正常 | S03/S04，ISO-01 |
| TC03 | 列Host tool/RPC registry並偽造shell/fs/plugin/MCP/credentials/path請求 | 禁止能力未註冊或server deny；HTTP/WS不能透過generic endpoint繞過 | S01/S04/S07，SAFE-01 CLEAN-01 |
| TC04 | client/body/prompt注入actor、tenant、region、cwd、credential target、upstream session ID | 只能使用server解析context；無能力擴張；invalid schema fail closed | S03，AUTH-01 ISO-01 |
| TC05 | run中撤銷membership、改auth revision、切preview、businessReady=false、Guest visit更換 | 停新tool；撤銷stream/replay；必要時cancel/隔離；不發布撤權後資料 | S02/S03/S05，AUTH-01 DEMO-01 |
| TC06 | 在Host注入另一room projection、title/search row、error、heartbeat metadata | 公開socket、history、list和debug response皆無該內容；記安全drop指標 | S04，OBS-01 ISO-01 |
| TC07 | tool傳secret、raw args、provider stack與惡意指令；生成缺來源/錯generation答案 | 只見safe schema、合法來源；不出secret/trace；模型指令不改工具scope | S04/S07，KB-02 OBS-01 SAFE-01 |
| TC08 | active RA停止；同時RB持續跑；重複cancel和completed之後cancel | RA先CANCEL_REQUESTED再真實terminal；RB不受影響；晚cancel不改completed | S05，RUN-01 |
| TC09 | tokens/activity中斷網路再連，重送event、缺event、過期cursor | 重新驗權；snapshot+sequence不重複訊息；gap回resync；斷線未被稱取消 | S04/S05，RUN-01 |
| TC10 | 同key雙擊submit；同key改message；兩tab不同key同room送出 | 第一次只有一個run；重送回原run；內容不同/room busy回409，不進upstream queue | S05，RUN-01 |
| TC11 | 上游預置pending inbox後cancel（keepInbox:true）、reset、restart/revoke | 首版不送第二prompt；pending inbox被隔離/清理且不可自動執行；無新tool/output | S05，RUN-01 SAFE-01 |
| TC12 | 在started、tool前後、terminal persist前後kill Host，或DB/file短暫不一致 | reconcile至確實terminal或INTERRUPTED；不重跑未確認工具/副作用；映射可恢復 | S05/S08，RUN-01 ACT-01 |
| TC13 | business/Owner非SUPER_ADMIN修改provider；合法admin兩tab舊revision；偽造scope | 未授權拒絕；conflict 409；只一個設定真相；session只選approved model | S02/S06，ADMIN-01 |
| TC14 | endpoint localhost/private/link-local/metadata/redirect/rebinding；key rotation與error | 沿安全transport fail closed；secret永不回UI/log；policy version固定，撤銷可阻斷 | S06，SAFE-01 OBS-01 |
| TC15 | >5model steps、>6tool calls、>40s、>1600output tokens、超quota、並行Guest扣額 | 不超已核定界限；step前reserve原子化；fail清楚；其他runtime限額不放寬 | S05/S07，RUN-01 DEMO-01 |
| TC16 | DEMO reset後用舊room/run/cursor/upstream ID/history generation重播 | 舊run、mapping、projection、cursor均失效；新generation不讀舊DSH transcript | S03/S05，DATA-01 ISO-01 |
| TC17 | Workspace/chatbot切換、三次mount/unmount、back/forward、logout、mobile view | 同room真實狀態一致；無重複socket/root/listener；CSS和快捷鍵不污染；manual可用 | S01/S02/S05，UX-01 STAFF-UX-01 |
| TC18 | 偽造WS origin/ticket、過期/重放/跨room票据、直連Host、慢client/backpressure | fail closed；票据不可轉用；raw Host不可達；buffer有界/可resync | S03/S04/S08，AUTH-01 ISO-01 RUN-01 |
| TC19 | G0b後Owner管理超scope region/room、試看未批准private history、移動到別workspace | scope/revision checks生效；無默示全看權；真實actor audit；Workspace仍不能管理 | S02/S03/S06，STAFF-01 ADMIN-01 |
| TC20 | prepare→payload swap/stale/expiry/reset/double approval；聊天『同意』與DSH approval嘗試 | 只有既有authenticated Web確認能批准相同canonical payload；一次atomic execute/audit | S07，ACT-01 CAP-01 |
| TC21 | 知識未發佈/失效/別workspace來源、order intake偽裝成KB publication | 結果符合原publication/index lifecycle；引用合法；DOC-01邊界不混用 | S07，KB-01 KB-02 DOC-01 |
| TC22 | 新舊image/checkpoint升級、回退flag、volume backup/restore、session reconnect | 先驗格式兼容；history/mapping可恢復；canonical business狀態不回滾；無舊資料刪除 | S08，RUN-01 CLEAN-01 |

## 發布門檻

- 基礎切片：TC01–TC18中相應mock/fixture場景必須通過；TC20/TC21在工具尚未註冊時先驗「不可呼叫」。沒有新管理功能時TC19標deferred，不能記pass。
- 完整管理/業務版本：TC19–TC21轉為完整正反測試；Q1–Q4及相關Spec已lock。
- 生產前：TC22、真實部署route/termination/timeout/reconnect、獨立security review、人類UAT及核定容量/維運條件完成。
- 保留現有repo要求的typecheck、lint、unit、integration與aggregate checks；命令從實際package/scripts讀取，不在本包捏造已存在測試指令。

## Criterion 交叉對照

AUTH-01→TC01/04/05/18；ISO-01→TC02/04/06/16/18；ADMIN-01→TC01/13/19；DATA-01→TC16；CAP-01→TC08/20；ACT-01→TC12/20；RUN-01→TC08–12/15/18/22；KB-01/02→TC07/21；DOC-01→TC21；UX-01→TC17；DEMO-01→TC05/15/16；OBS-01→TC06/07/14；SAFE-01→TC03/07/11/14；CLEAN-01→TC03/22；PREVIEW-01→TC01/05；STAFF-UX-01→TC17。

STAFF-01/02、IMPORT-01及原STAFF-UX-01定義原樣保留。未修改不代表免回歸，也不代表本包重新定義其驗收。MCP-01/02仍deferred。
