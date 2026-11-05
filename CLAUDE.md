# 北海道旅行紀錄（travellingtrip）

給日後 AI 嘅項目背景。用戶用廣東話溝通，回覆用繁體廣東話；用戶唔係寫程式嘅人。所有網站一覽：`docs/ALL_SITES.md`。

## 係咩
2027-02-16 至 02-25 北海道冬季旅行嘅私人網站（2026-11-02 起做）。北海道雪夜主題（雪花、襯線標題、行程按地區分色）。分頁：
- **💴 消費**：記支出（JPY↔HKD，匯率存 settings，默認 0.052）；**收據影相自動讀圖**（`receipt.js`）。
- **📝 旅行日記**。
- **📍 想去**：儲存地點（社交媒體連結）＋地圖＋Google Maps 連結；
  - 貼連結**自動填寫**名稱、地區、類型、備註、Google 對應（`linkimport.js`，背景 job＋輪詢，手機斷線都唔怕；一定上網核實分店、現價、營業時間、仲有冇開，保留來源）；
  - Google Places 評分同相片（`gplaces.js`：多語言 listing＋同名地點，最多 30 張，AI 揀食物相，顯示最多 10 張；byte 相同嘅重複相刪走）；
  - 每個地點最多 10 張自己相，掃動相簿＋全螢幕；食物類型 tag 篩選；警示標記（例如旅程期間休息，卡片變灰、地圖灰 pin）；重複地點警告（同 Google listing／同連結／附近相似名）；
  - 「我附近」：GPS 按距離排、步行時間、附近餐廳連結。
- **🗓 行程**、**🎫 預訂**、**🎒 清單**：內容寫死喺 `public/data.js`（`TRIP`、`ITINERARY` 等）。

## 檔案
- `server.js`：Node（`pg`）伺服器。Postgres 表：`expenses`、`journal`、`places`（id＋jsonb）、`settings`、`receipts`、`photos`（bytea 存圖）。
  API：`GET /api/config`、`POST /api/login`（Google ID token）、`POST /api/logout`、`GET /api/me`、`GET /api/state`、`PUT/DELETE /api/{expenses|journal|places}/<id>`、`POST /api/linkimport`＋`GET /api/linkimport/<job>`、`/api/places/search|photo|<id>`、`/api/photos`、`/api/receipts`、`PUT /api/settings/<key>`、`POST /api/import`；`/health`。
- `grok.js`：xAI Grok（Responses API，`XAI_MODEL` 默認 `grok-4.7`）；有 `XAI_API_KEY` 就優先用 Grok，否則用 Claude（`claude-opus-5-5`）。
- `receipt.js`、`linkimport.js`、`gplaces.js`：AI 讀收據、連結匯入、Google 相片。
- `public/`：`index.html`、`app.js`、`data.js`（行程／預訂資料）、`login.html`、`style.css`、`snow.js`。

## 登入
- 有 `GOOGLE_CLIENT_ID` 就要 Google 登入，而且 email 要喺 `ALLOWED_EMAILS`；未登入乜都睇唔到（只開放 login.html、style.css、snow.js）。session cookie 30 日（`SESSION_SECRET`）。
- 冇 Google 設定時用 `TRIP_PASSWORD`。

## 部署
- Railway project `travellingtrip`（id `ee35c387-2be5-4137-8c9b-16a92e2d5f62`），service `web`（`79e24481-6652-4901-a547-77fd27bc2050`）＋`Postgres`，環境 `production`（`966ff3bc-887b-4265-b049-abc91aee5fbf`）。
- **部署 branch：`claude/trusting-galileo-l0hhih`**（亦係 GitHub 默認 branch）。網址 https://web-production-0a671.up.railway.app
- Variables（只記名稱）：`DATABASE_URL`、`GOOGLE_CLIENT_ID`、`ALLOWED_EMAILS`、`SESSION_SECRET`、`TRIP_PASSWORD`、`ANTHROPIC_API_KEY`、`XAI_API_KEY`、`GOOGLE_MAP_API_KEY`（程式亦接受 `GOOGLE_MAPS_API_KEY`）。

## 注意
- repo **公開**：新加嘅私人資料（預約號、付款、個人資料）唔好寫入 repo，放資料庫。

## 修改歷史（摘要）
- 2026-11-02：網站（支出、日記、行程、預訂）→ Postgres → Google 登入＋白名單 → 收據 AI → 北海道主題 → 想去分頁＋地圖 → 我附近 → 地點相片＋Google 食物相（多輪調整）→ 連結自動填寫（上網核實、背景 job、進度顯示、來源 chips、重複警告）。
- 2026-11-03：食物類型 tag、警示標記。
- 2026-11-04：收據、連結匯入、食物相改用 `XAI_API_KEY`（Grok），Claude 做後備。
