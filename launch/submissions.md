# 投稿：阮一峰周刊、HelloGitHub

投稿入口和格式以对方的最新说明为准，发之前去看一眼：

- 阮一峰《科技爱好者周刊》：在 [ruanyf/weekly](https://github.com/ruanyf/weekly) 仓库按说明提交 Issue
- HelloGitHub：在 [hellogithub.com](https://hellogithub.com) 或 [521xueweihan/HelloGitHub](https://github.com/521xueweihan/HelloGitHub) 按说明提交项目

时间：2026 年 12 月冷启动时投。同一个项目**每个渠道只投一次**，不催稿。

---

## 阮一峰周刊（工具 / 资源栏）

**标题**：日子人城市指南（rizi-city）

**正文**：

一个开源的城市政策数据集，整理了 20 座城市的应届生落户、人才补贴、租房补贴、房租、社保和灵活就业社保。每个数字都附政府官网原文链接和核验日期，找不到原文的标为「待核实」，不估算。

网页版有一个「日子指数」，用房租负担、生活成本、落户难度、补贴力度、社保负担五项公开数据打分，权重可以自己调，调好的权重会写进网址。算法和版本号公开。

数据由 AI agent 对照官网巡检，任何能浏览网页的 agent 读一个说明文件就能参与，所有改动都由人工合并。

- 仓库：https://github.com/baichen99/rizi-city
- 网页：https://baichen99.github.io/rizi-city/

**配图**：`docs/assets/screen-index.png`（日子指数截图）

---

## HelloGitHub

**项目地址**：https://github.com/baichen99/rizi-city

**类别**：其它 / 数据集（以对方分类为准）

**项目标题**：每个数字都带官方来源的城市政策手册

**项目描述**：

给应届生、考公考编的人和自由职业者用的城市政策手册，收录 20 座城市的落户条件、人才补贴、租房补贴、房租、社保和灵活就业社保，每个数字都附政府官网原文和核验日期。

**亮点**：

- 合计只算「真能领到」的钱：只计市级、面向普通应届生、有官方原文、未过期的现金补贴，区级、限专业、购房补贴、过期政策都单独列出并写明原因
- 网页纯静态、手机优先，有可调权重的「日子指数」、国考应届身份自查、自由职业社保测算，还能生成分享图；另提供一个内联数据的离线单文件
- 维护交给 agent：Claude Code、Codex、Muse 等任何 agent 读一份 `patrol.md` 就能巡检，提交方式有 PR、Issue Form 和发报告给主人三种；Action 只校验不合并，有准确率巡检榜
- 附带 Claude Code / Codex skill，问「我硕士毕业去杭州和成都哪个领得多」，回答里带来源链接

**示例代码**：

```bash
python3 skill/rizi-city/scripts/query.py compare 杭州 成都 --degree 硕士
python3 skill/rizi-city/scripts/query.py index --w 3.1.1.1.1 --city 武汉
```

**截图**：`docs/assets/screen-index.png`、`docs/assets/share-top5.png`

**后续更新计划**：补齐「数据收集中」的城市，日子指数的参与城市从 10 座扩到 15 座以上；按省补齐省考的应届认定口径；第二版新增「回老家或去小城」「准备成家」「刚被裁」三个入口。
