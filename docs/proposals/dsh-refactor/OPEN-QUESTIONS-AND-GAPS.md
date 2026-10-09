# 未決事項與缺口

此檔是未決產品和部署決策的唯一清單。Spec 與 Task 引用 Q 編號，不用各自猜一套答案。預設值是最低權限的開發測試邊界，不代表用戶已採納完整產品政策。

## 分段決策門

- G0a 基礎切片：確認保留現有權威與授權、同意私有 Host/adapter 的技術 spike、鎖定既有 workspace 下 private fixture room、唯讀 readOrder、原本有 AI capability 的已登入角色、無新 Owner 管理能力。只需批准本切片的 Spec；Q1–Q4 的新產品功能不阻擋 mock/隔離基礎實作。
- G0b 管理與區域：Q1–Q4 解決，批准 Owner scoped capability、region schema、對話可見性與相應權威文件修訂，才釋出 T10。
- G1 受控整合：Q5/Q6 的測試部署、模型配置及運行邊界確認，才做真實 provider 與測試環境連線；live calls 另需明確授權。
- G2 生產準備：Q5–Q8 的 production policy、retention、升級責任與容量證據完成，安全 review 通過，才可請求部署批准。

## 決策清單

| ID | 待定問題 | 保守基礎切片 | 決策責任及被阻擋工作 |
|---|---|---|---|
| Q1 | 區域代表 branch、workspace 内分組、獨立 tenant，還是地理部署區域 | 不新增 region 語意，room 直接連既有 workspace；用 fixture 驗隔離 | 產品責任人決定，架構責任人核對；阻擋 region schema、管理入口、跨region路由 |
| Q2 | 聊天室是私人 thread 還是共享員工房間；誰能建立與邀請 | private owner-only room；已授權 actor 只開自己的 room；同時一個 run | 產品責任人；阻擋群組成員、共享歷史、多人送訊息/通知 |
| Q3 | Owner/Superadmin 可看哪些 room metadata 及內容；私人對話是否可被管理員查閱 | 不賦予全看權。管理頁僅 mock fixture，或沿既有已授權能力 | 產品與資料責任人；阻擋真實管理列表、內容監看、稽核查閱介面 |
| Q4 | Owner 可管理何種模型政策；全域provider/secret與workspace模型清單如何分工 | 現有 global ai_config gate 維持 SUPER_ADMIN；業務端只選 approved models | 產品與安全責任人；阻擋新Owner設定權，不阻擋原SUPER_ADMIN adapter |
| Q5 | 哪個平台可跑長駐Host、私有gateway、WebSocket、持久卷；隔離單位與成本上限 | 本地/隔離測試container，按既有workspace隔離；不宣稱production兼容 | 架構/部署責任人；阻擋真實部署、availability/容量承諾 |
| Q6 | provider/model清單、runtime注入與secret store、outbound policy如何繼承 | mock provider；平台現有設定單一權威，沿用安全transport條件 | 平台/安全責任人；阻擋live provider、key設定與rotation實驗 |
| Q7 | 正式使用者history保留多久、Guest仍否visit-private、export/deletion與備份期限 | Guest留舊入口；不刪舊資料，不開附件/export；archive只隱藏 | 產品/資料責任人；阻擋持久化Guest切換、正式retention/deletion |
| Q8 | 上游安全更新/維運人、可接受停機、RPO/RTO與容量門檻 | 明確測試結果，不給無證據SLA；停用flag能回舊入口 | 發布責任人；阻擋production launch與升級承諾 |

## 必须補實驗的技術缺口

- X1：DSH package dependency closure、React/Cordis singleton、build/import/CSS/root lifecycle。由 T01 提供实际 build/browser 證據。
- X2：Host profile 移除開發 tools 後是否仍可啟動；哪些內部 filesystem services 必要。由 T02 列註冊表與拒絕測試，不做盲目刪 package。
- X3：gateway 能否受控呈現 stream 並維持 session/cancel/replay。由 T04–T06 提供兩 actor/兩room負向測試。
- X4：safe provider transport、每 step budget、deadline 與來源驗證如何掛接 DSH runtime。由 T07/T08 證明；沒有hook時要小範圍fork，不移除既有規則。
- X5：checkpoint restart、跨 DB/file reconciliation、持久卷 restore 和上游格式相容。由 T06/T12 提供 crash 注入與復原結果。
- X6：既有 signed-staff、人類UAT與並行測試的缺口。保持在 PROJECT_STATE，不把過去11次live/22checks當作本重構或production已驗收。

## 決策紀錄格式

每個 Q 寫明：決策、決策人與日期、依據、受影響 Spec、ADR/權威文件修訂、何時生效及仍保留的限制。未答問題保持 Open。需產品決定時不得用 coding agent 的「合理假設」自行關閉。
