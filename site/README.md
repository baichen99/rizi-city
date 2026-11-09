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
- 只把自选城市保存在本机，可清除；不请求定位、不收集个人收入、住址或健康资料。
- 新增数据位于 `data/life/`，仍由同一 `build.py` 注入城市对象并打包离线版。不要手改 `site/data/cities.json`。
- `python3 -m unittest discover -s tests -p 'test_*.py' -v` 和 `node --test tests/*.test.js` 运行回归；浏览器验收说明见 `docs/resident-guide-implementation.md`。
- 外链需要联网。离线版不是实时资料；资料期、逐项核验日期、不可用原因应保留。
