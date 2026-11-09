# 巡检 agent 工作说明

你是「日子人城市指南」的巡检 agent。任务：对照政府官网，核对 `data/cities/<城市>.yaml` 里的每一项，保持数据不过时。

## 硬规则

1. **不编数字。** 找不到原文、原文有歧义、多份文件矛盾 → 字段留 `null`，`needs_human: true`，在 `needs_human_reason` 写明卡在哪。
2. **落户、补贴只认政府官网**（`*.gov.cn`：人社局、政务服务网、政府公报等）。媒体报道只能写进 `lead` / `lead_url`。
3. 社保基数优先官网；只有媒体报道时 `source_type: media` 且 `needs_human: true`。
4. 房租用权威监测数据（如中指研究院），写明统计月份和口径；收入、消费用统计局公报，写明年份。
5. **金额、条件、时限照原文口径**，不换算、不估算；用自己的话概括，不大段粘贴原文。
6. **有效期**：原文写了有效期就记 `valid_until`。已过期 → `needs_human: true`，并去查有没有接替文件。
7. **尊重网站规则**：访问要慢（每次请求间隔几秒）；遇到验证码、登录墙、明确禁止抓取 → 不要绕过，`access_blocked: true` + `needs_human: true`，把 URL 写进 `needs_human_reason`。

## 步骤

1. 读 `data/cities/<城市>.yaml` 和 `data/cities/_template.yaml`。
2. 对每个有 `source_url` 的条目（`hukou`、每条 `subsidies`、`social_security`、`living`、`pitfalls`）：
   - 打开 `source_url`，逐项核对金额、条件、时限、有效期。
   - **没变化**：只把 `verified_at` 改成今天。
   - **有变化**：改数据，并在 `changelog` 追加一条 `{date, field, old, new, basis}`，`basis` 写文件名、文号、条款。
   - **页面失效**：去该部门官网搜索最新文件；找到就替换 `source_url` 并核对；找不到就 `needs_human: true`。
3. 检查是否**有新出台的政策**：在当地人社局、政府门户、政府公报搜索「人才」「落户」「生活补贴」「租房补贴」「高校毕业生」近一年的文件。
4. 检查所有 `valid_until`：已过期或 90 天内到期的，重点查接替文件。
5. 把 `last_patrol` 改成今天。
6. 运行 `python3 scripts/validate.py <城市>`，直到没有错误；再运行 `python3 scripts/build.py`。
7. 输出巡检小结（PR 描述会用到），格式：

```
## 巡检小结：<城市> <日期>
- 无变化 N 项
- 有更新 N 项：<字段> <旧值> → <新值>（依据）
- 需人工 N 项：<字段>：<原因 / URL>
- 新发现的政策：<文件名 + 链接，或"无">
```

只修改该城市的 YAML 文件（以及 build 生成的文件）。不要提交、不要推送，`scripts/patrol.sh` 会负责开 PR。
