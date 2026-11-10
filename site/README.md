# site/

GitHub Pages 网页（纯静态单页，没有构建步骤）。

- `index.html`、`style.css`、`app.js`：页面本体。
- `data/cities.json`：由 `scripts/build.py` 从 `data/` 生成，**不要手改**。
- 本地预览：`cd site && python3 -m http.server`，打开 <http://localhost:8000>。直接双击 `index.html` 读不到 JSON。
- 离线单文件：`python3 scripts/build.py` 会顺便生成 `dist/rizi-city-offline.html`（内联数据，不提交），发布 Release 时由 `release.yml` 自动上传为附件。
- 部署：`main` 上 `site/` 有变动时，`pages.yml` 自动发布。
- 日子指数的算法见 [`docs/index-method.md`](../docs/index-method.md)，改公式要同步改文档并升版本号。

## 居民入口与历史序列

- `#resident&city=guangzhou` 打开本城，`#compare` 对比两城；旧 `#index / #grad / #civil / #free` 链接继续可用。
- 只把自选城市保存在本机，可清除；不请求定位。个人预算可选填收入和开销，仅在当前页面内存计算，刷新即清空，不上传、不进入URL或分享图。
- 新增数据位于 `data/life/`，仍由同一 `build.py` 注入城市对象并打包离线版。不要手改 `site/data/cities.json`。
- `python3 -m unittest discover -s tests -p 'test_*.py' -v` 和 `node --test tests/*.test.js` 运行回归；浏览器验收说明见 `docs/resident-guide-implementation.md`。
- 外链需要联网。离线版不是实时资料；资料期、逐项核验日期、不可用原因应保留。

- 月消费参照与个人预算的口径、缺失处理和隐私边界见 [`docs/living-budget-method.md`](../docs/living-budget-method.md)。

## 按居民需求查政策

- 本城页日常生活内容之后，可按补贴、住房、医保、就业、水电气暖、家庭和养老需求查政策。关键词只在当前主题的已收录资料中本地检索，不上传、不保存。
- 本城政策与全国官方导航分开，保留适用对象、有效期未知/过期状态、核验日和官方来源。没有收录不表示没有政策。
- 全国目录原始数据为 `data/resident-services.json`；边界、来源核验和维护方法见 [`docs/resident-services.md`](../docs/resident-services.md)。

## 城市下拉交互回归

- 居民页和两城比较页保留原生 `select` 节点，只更新其旁边的内容；不要在 `change` 后移除控件再强制聚焦新控件，以免打断 iOS 原生选择器。
- `python3 tests/city_select_browser.py` 覆盖 Chromium / WebKit 的移动和桌面视口：一次选值、连续切换、清空、同城比较、返回/前进、记住城市，以及 DOM 连续连接和无额外 focus。先运行 `playwright install chromium webkit`。
- 此回归使用浏览器 `select_option` 发出 input/change，并非操作 iOS 系统滚轮。发布后仍应在真实 iPhone Safari 上检查：打开城市选择器、选城市并确认一次、重开换城、取消、比较页左右切换。不得将 WebKit 模拟写成 iPhone 实机验证。
