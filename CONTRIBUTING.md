# 参与贡献

谢谢你愿意帮全国的打工人盯政策。三种参与方式，挑一个顺手的：

## 1. 报告数据错误

发现某个数字和官网对不上？→ [提交「报告数据错误」](https://github.com/baichen99/rizi-city/issues/new?template=data-error.yml)

**官方链接必填。** 落户、补贴必须是 `*.gov.cn` 原文；媒体报道只能当线索，请顺着它找到政府原文再提交。

## 2. 加入城市维护

愿意长期关注一座城市的某类信息？→ [提交「加入城市维护」](https://github.com/baichen99/rizi-city/issues/new?template=claim-city.yml)。旧的 `claim-city` 链接和标签继续可用。

**一座城市可以由多人共同维护；不登记也可以纠错、巡检和提交 PR。** 按「城市 + 领域」分工，例如广州的考公考编、社保或住房。同一领域也欢迎多人协作和交叉核验，不设独占名额。

登记时说明领域、巡检频率、下次检查日期和当前状态。维护者确认后，通过普通 PR 将活跃参与者加入城市 YAML 的 `maintainers` 数组；具体分工和进度保留在登记 Issue。这个名单是联系与致谢信息，不授予 GitHub 写入、审核或合并权限，也不赋予否决其他贡献的权利。

想暂停、缩小范围或退出，更新原登记 Issue 即可，留下未完成项、来源和相关 PR，方便其他人接手。协作和交接细则见 [维护说明](MAINTAINING.md#多人协作与交接)。

### 开始一次巡检前

先查看已有 Issue 和 PR。如果准备做较大范围的巡检，使用[「巡检协调」](https://github.com/baichen99/rizi-city/issues/new?template=patrol-task.yml)说明城市、具体字段、批次和预计完成时间，并关联已有工作；小修正直接开 PR 即可，不必等待登记批准。重叠任务先沟通分工，紧急纠错不受等待限制。

一次巡检只改一城的约定范围。推荐 `SCOPE=civil_service scripts/patrol.sh guangzhou` 这样的领域巡检；每个并行任务使用独立 checkout 或 worktree。脚本会生成唯一分支、拒绝同一工作区同时运行，并检查无关文件和领域改动。各 PR 仍可能同时修改生成文件，合并前需同步最新 main，再运行 `build.py`，不能直接用某一侧覆盖其他城市的数据。

## 3. 用你自己的 agent 巡检

给你的 agent 一句话：

> 请阅读 https://github.com/baichen99/rizi-city/blob/main/agent/patrol.md ，按说明巡检「杭州」，完成后按文中方式提交结果。

- 能用终端和 GitHub 的 agent，直接开 PR；也可以运行 `scripts/patrol.sh <城市>`
- 只能用浏览器的 agent，会生成一个[「巡检报告」Issue](https://github.com/baichen99/rizi-city/issues/new?template=patrol-report.yml) 的预填链接，交给你提交
- 都不行的，让它把报告发给你，你复制进 Issue 就行

每份巡检都会进入[🏅 巡检榜](docs/leaderboard.md)。

## 新增城市

→ [提交「申请新增城市」](https://github.com/baichen99/rizi-city/issues/new?template=new-city.yml)。复制 `data/cities/_template.yaml` 开始填写，规则见 [MAINTAINING.md](MAINTAINING.md)。

## 本地开发

```bash
pip install -r requirements.txt
bash scripts/install-hooks.sh     # 启用防泄露检查
python3 scripts/validate.py
python3 scripts/build.py
```

合并标准和安全原则见 [MAINTAINING.md](MAINTAINING.md)。**所有合并须仓库维护者批准，加入维护不授予合并权限。**
