# 考公考编页面回归检查

运行 `node tests/civil-ui.test.js`，使用当前 `site/data/cities.json` 检查全部城市的渲染、动态覆盖数、字段与来源、缺失信息、HTML 转义，以及国考自查和重复切换。

可用 `CIVIL_DATA=/path/to/cities.json node tests/civil-ui.test.js` 检查独立获取的数据快照。本次使用 main 的 20 城市数据：19 城有部分信息，重庆保留待采集及失败原因。收录数不是完整核实数，也不是当前可报名数。

城市卡片复用原页面原生 details/summary 折叠结构，长网址可换行。保留省考、事业单位各批次原文，不解析自然语言日期为报名状态、不补写缺失政策、不把待遇混入排名。国考自查仍只使用 national.civil_service。

发布前还需运行 CONTRIBUTING.md 与 validate 工作流要求的数据校验、build 一致性、防泄露及 query 冒烟检查。合并后须检查 Pages 部署及线上 #civil；VM 回归不替代浏览器布局验收。
