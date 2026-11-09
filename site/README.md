# site/

GitHub Pages 网页（纯静态单页，没有构建步骤）。

- `index.html`、`style.css`、`app.js`：页面本体。
- `data/cities.json`：由 `scripts/build.py` 从 `data/` 生成，**不要手改**。
- 本地预览：`cd site && python3 -m http.server`，打开 <http://localhost:8000>。直接双击 `index.html` 读不到 JSON。
- 离线单文件：`python3 scripts/build.py` 会顺便生成 `dist/rizi-city-offline.html`（内联数据，不提交），发布 Release 时由 `release.yml` 自动上传为附件。
- 部署：`main` 上 `site/` 有变动时，`pages.yml` 自动发布。
- 日子指数的算法见 [`docs/index-method.md`](../docs/index-method.md)，改公式要同步改文档并升版本号。
