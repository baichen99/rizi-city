# skill/：让你的 AI 助手直接回答"去哪座城市领得多"

`skill/rizi-city/` 是一个 Claude Code / Codex 通用的 skill：问它"我硕士毕业，去杭州和成都哪个领得多"，它会查 rizi-city 的数据来回答，**每个数字都附官方来源链接和核验日期**，没核实的 ⚠️ 项会单独提醒。

只依赖 Python 3 标准库。不在本仓库里使用时，会自动读取网页版的数据（`https://baichen99.github.io/rizi-city/data/cities.json`）。

## 安装

```bash
git clone https://github.com/baichen99/rizi-city.git

# Claude Code（所有项目可用）
mkdir -p ~/.claude/skills && cp -R rizi-city/skill/rizi-city ~/.claude/skills/

# Codex
mkdir -p ~/.codex/skills && cp -R rizi-city/skill/rizi-city ~/.codex/skills/
```

想跟着仓库自动更新，可以把 `cp -R` 换成软链接（`ln -s "$PWD/rizi-city/skill/rizi-city" ~/.claude/skills/rizi-city`），之后 `git pull` 就行。

装好后直接问：

- 我硕士毕业，去杭州和成都哪个领得多？
- 本科不想先找工作，哪些城市能直接落户？
- 自由职业，在武汉每月最少要交多少社保？
- 我 2025 年毕业，没签过合同，今年国考还算应届生吗？
- 我最在乎房租，帮我按日子指数排一下。

## 不装 skill，直接用脚本

```bash
python3 skill/rizi-city/scripts/query.py compare 杭州 成都 --degree 硕士
python3 skill/rizi-city/scripts/query.py rank --degree 本科 --by hukou
python3 skill/rizi-city/scripts/query.py free
python3 skill/rizi-city/scripts/query.py index --w 3.1.1.1.1 --city 武汉
```

`index` 和网页用的是同一套算法（见 [`docs/index-method.md`](../docs/index-method.md)），改算法时两边要一起改。
