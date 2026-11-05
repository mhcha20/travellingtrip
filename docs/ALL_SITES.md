# 所有網站一覽（mhcha20）

最後整理：2026-11-06。呢份同一份內容放咗喺每個 repo 嘅 `docs/ALL_SITES.md`，改咗其中一個記得同步其他（或者只改呢度註明邊個最新）。
每個網站自己嘅詳細資料睇該 repo 嘅 `CLAUDE.md`（Claude Code 開 repo 會自動讀）。

## 共通做法（所有網站）
- 用戶用**廣東話**溝通，回覆用繁體廣東話；用戶唔係寫程式嘅人，講結果、講測試咗咩、未測咩。
- 全部網站部署喺 **Railway**（workspace「mhcha20's Projects」），push 去「部署 branch」就自動重新部署。**部署 branch 唔一定係 GitHub 默認 branch**，下面有列。
- 部署會令做緊嘅背景工作中斷（例如報告生成），push 前先睇 Railway log。
- **唔好提交任何密碼、金鑰、token**；所有密鑰只放 Railway Variables。大部分 repo 係**公開**嘅。
- AI 功能：多數網站用 Anthropic API（`ANTHROPIC_API_KEY`，模型 `claude-opus-5-5`），部分用 xAI Grok（`XAI_API_KEY`）或 OpenRouter 做後備。
- 前端改完用 Playwright 以 390px 手機闊度測（cloud session：`/opt/pw-browsers/chromium`）。
- Node 伺服器要處理 SIGTERM（exit 0），`railway.json` 用 `node server.js` 直接啟動，否則每次部署都會收到「Deploy Crashed」電郵。

## 網站清單

| 網站 | 用途 | Repo（公開？） | 部署 branch | 網址 | Railway project | 資料儲存 |
|---|---|---|---|---|---|---|
| JLaw 報告中心 | 列 Drive 股票報告、WhatsApp 分享、截圖檢查、買賣訊號、回測、群友對照 | `mhcha20/Jlaw-report`（公開） | `claude/drive-reports-whatsapp-share-6m44wo`（AI session 唔准直接 push，要開 PR） | jlaw-report-a74806.up.railway.app | `jlaw-report` | Volume `/data` |
| JLaw 報告生成器 | 撳掣用 Claude／Grok 出大盤報告同個股三份報告 | `mhcha20/jlawreportgenerate`（公開） | `main` | jlawreportgenerate-production.up.railway.app | `loving-renewal` | Volume `/data` |
| 截圖自動化 | 每日 TradingView 大盤圖＋富途牛牛個股截圖，上載 Google Drive（俾上面兩個網站用） | `mhcha20/screencapture`（私人） | 唔喺 Railway；行喺雲端電腦（systemd timer），見該 repo | — | — | Google Drive |
| 2027 鄉郊選舉指引問答 | 選管會指引搜尋＋Claude 回答、提名表格遮蓋工具、重要日子 | `mhcha20/2027ruralelection`（公開） | `main` | web-production-81c64.up.railway.app（全站 Basic auth） | `2027ruralelection` | Volume `/data`（遮蓋範本） |
| 北海道旅行紀錄 | 支出、日記、行程、訂位、想去地點（收據 AI 讀圖、連結匯入、Google 相片） | `mhcha20/travellingtrip`（公開） | `claude/trusting-galileo-l0hhih` | web-production-0a671.up.railway.app（Google 登入） | `travellingtrip` | Postgres |
| 外賣紀錄 | 上傳 Keeta 截圖 → AI 讀圖入庫 → 收入／時數／距離分析 | `mhcha20/food-delivery-records`（私人） | `master` | web-production-0943b.up.railway.app（Google／密碼登入） | `food-delivery-records` | Postgres |
| 兔仔玩具預訂 | 玩具預訂追蹤、截圖 AI 入單、想預訂清單、Telegram 提醒同問答 | `mhcha20/rabbittoysordering`（公開） | `claude/keen-cerf-g5e2qs` | web-production-89b33.up.railway.app（密碼） | `rabbittoysordering` | Volume `/data`（items.json＋相片） |
| 速成打字班 | 倉頡／速成教學、1200 字特訓（純前端單檔） | `mhcha20/chinesetyping`（公開） | `main` | **未有公開網址**（Railway 冇 domain；直接開 `index.html` 都用得） | `chinesetyping` | 冇 |
| SIM uncle（eSIM 叔叔） | 六語言全球 eSIM 網店：Stripe、Vizlync／TGT 自動履約、會員、推薦、部落格 SEO | `mhcha20/simuncle`（公開） | `main` | simuncle.com | `simuncle` | MySQL＋R2 |
| Chiikawa Store | Chiikawa 日本正版周邊香港網店（Stripe、官方店匯入、後台） | `mhcha20/chiikawa-store`（私人） | `migrate-off-manus` | chiikawastore.com | `Chiikawa_store` | MySQL＋R2 |
| Building Pass | 送遞員大廈通行密碼查詢（截圖 AI 填表、GPS 就近） | 同上 repo 嘅 `building-pass/` 目錄 | `migrate-off-manus`（root directory `building-pass`） | adventurous-peace-production.up.railway.app | `Building-pass` | MySQL |
| 餐廳相片 Dashboard | Google Drive 餐廳相片同步、搜尋、地圖、待送清單（要批准先睇到） | `mhcha20/restphoto`（公開） | `main` | web-production-dffd9.up.railway.app | `restphoto` | MySQL＋R2 |
| Iwantphoto | AI 商品圖工作台（去背、各電商平台圖組、Stripe 訂閱） | `mhcha20/iwantphoto`（公開） | `main` | iwantphoto.com | `iwantphoto` | MySQL＋S3 |

另外 Railway 仲有一個空 project `rare-adventure`（入面冇 service，2026-11-05 已刪咗 service；project 本身可以喺 Railway → Settings 刪走）。

## 網站之間嘅關係
- **截圖自動化 → Google Drive → JLaw 報告中心／報告生成器**：大盤截圖資料夾 `1M8hNhlePL5MHD-_SvGZlQ02srBHFq_rl`，個股截圖 `1xkPBlGhK0SEn2dGIzAINQNIFL33m0hG_`。
- **報告生成器** 經 **報告中心** 嘅 API（`/api/drive/ls`、`/api/shots`、`/api/ohlcv`、`/api/upload`…）讀截圖、行情同上載 PDF；兩邊共用 Google OAuth 用戶端。
- SIM uncle、Chiikawa Store、Building Pass、餐廳相片、Iwantphoto 都係由 **Manus** 搬過嚟 Railway（React 19＋Vite＋Express＋tRPC＋Drizzle），搬遷文件喺各 repo（`DEPLOY.md`、`EXTERNAL_HOSTING_HANDOVER.md`、`README-HOSTING.md`）。

## 已知要跟進（2026-11-06 整理時發現）
- **restphoto**：Railway 部署 `main`，但 2026-10-31「改用 Anthropic API」嗰個 commit 只喺 `claude/compassionate-heisenberg-swcvrz`，未 merge 入 `main`，所以未上線。
- **chiikawa-store**：Railway 部署 `migrate-off-manus`；GitHub `main` 有個 2026-11-04「Use XAI_API_KEY for Grok chat」commit 係另一條歷史，未入部署 branch，未上線。
- `chinesetyping` 冇公開網址，要用就喺 Railway 撳 Generate Domain。
