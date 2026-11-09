# 参与贡献

谢谢你愿意帮全国的打工人盯政策。三种参与方式，挑一个顺手的：

## 1. 报告数据错误

发现某个数字和官网对不上？→ [提交「报告数据错误」](https://github.com/baichen99/rizi-city/issues/new?template=data-error.yml)

**官方链接必填。** 落户、补贴必须是 `*.gov.cn` 原文；媒体报道只能当线索，请顺着它找到政府原文再提交。

## 2. 认领一座城市

愿意长期盯一座城市？→ [提交「认领城市」](https://github.com/baichen99/rizi-city/issues/new?template=claim-city.yml)

认领后你会被写进该城市数据文件的 `maintainers`。现在最需要人的是带 🔒 的城市，比如合肥、南京：这些官网拦截了自动访问，需要有浏览器的人或 agent 去看。

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

合并标准和安全原则见 [MAINTAINING.md](MAINTAINING.md)。**所有合并由人工完成。**
