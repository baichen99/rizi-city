# 收入与消费的比较口径

`living.statistical_metadata` 为既有收入、消费数值补充经原文核实的语义，不替换原数值，不改变日子指数或灵活就业底线。没有元数据表示范围尚未核实，不能从城市名称、字段名或数值大小猜测。

## 数据契约

映射只允许 `income_per_capita` 和 `consumption_per_capita`，分别独立核验：

- `source_value` 必须是前端可安全表示的有限非负数且严格等于原字段（不超过2^53−1）。原值更新时必须重新核对元数据。
- `period` 是四位年份字符串，必须与 `stats_year` 一致；`unit=元/年`，人均分母保留在总体和方法中。`statistic=mean`，`price_basis=nominal`，不把工资、中位数、月度值或扣价增长率混进来。
- `population_scope` 保留人类可读口径；`population_scope_type` 只能为已证实的 `all_residents`、`urban_residents`、`rural_residents`。常住不是户籍。
- `geographic_scope` 写具体城市完整范围；当前 `geographic_scope_type=city_administrative_area`，不是只覆盖中心城区的交易样本。
- `methodology_key=household_income_expenditure_survey` 表示住户收支调查这一指标体系，不表示样本、权重或误差完全相同。必须保留 `methodology_source_url` 和 `methodology_note`。
- `source_url`、`source_date`、`publisher`、`evidence_locator` 指向实际读到的统计原文，URL必须是真实官方HTTP(S)地址，不擅自改写协议或绕过限制。`source_date` 是页面实际发布日期，不取URL日期。
- `verified_at`、`review_due` 记录核验及复核窗口；`review_status` 可为 `verified`、`needs_review`、`stale`。过期不是把历史事实判错，但须暂停可比资格。未来核验日、错年、错原值、缺字段都不能用于比较。
- `data_status` 为 `preliminary`、`final` 或 `not_specified`；快报和初步数要明确，不把未说明当成最终数。

显式跨城键按已核实语义赋值，格式为：

`resident-statistics|{原字段名}|{人口类型}|city_administrative_area|CNY-person-year|household-survey`

前端除核对该键外，还须匹配年份、单位、统计性质、名义价格基础、人口类型、地域类型和方法，并检查原值绑定及状态日期；不得仅凭同一个键放行。缺元数据可保留旧值及待核口径提示，但无跨城键；存在元数据却失败则应降为待核实。旧字段的未核验/禁止访问标记不能被新元数据覆盖。

## 首批核验

- 广州：2025公报第九节的86069元收入、51860元消费均为城镇居民，不是全体居民数。[原公报](https://www.gz.gov.cn/zwgk/sjfb/tjgb/content/post_10804075.html)发布于2026-05-10，注1为快报统计数。[当地年鉴方法](https://tjj.gz.gov.cn/datav/admin/home/www_nj/2024/directory/08/08%E7%AE%80%E8%A6%81%E8%AF%B4%E6%98%8E.html)明确2014年起按常住地而非户籍纳入、由广州调查队提供、采用住户收支调查。该方法材料是2024年鉴，不伪称为2025专门方法附件。
- 上海：2025公报第十四节96842元收入、57076元消费均为城镇常住居民；[原公报](https://tjj.sh.gov.cn/tjgb/20260330/e0772941e8e041eaaad2df850b44ef98.html)发布2026-03-30，注明初步统计数。[同年收支表及方法](https://tjj.sh.gov.cn/ydsj71/20260120/39ae4cd58421478d897b739d83f39c10.html)实际发布2026-01-21，说明全市16区、与户籍无关、抽样及记账问卷，人均含无收入者且存在抽样误差。
- 北京：2025公报第十节96292元收入、54122元消费均按常住地分为城镇居民；[原公报](https://www.beijing.gov.cn/zhengce/zhengcefagui/202603/t20260325_4565678.html)发布2026-03-25，注释[1]为初步统计数。当地[收入说明](https://tjj.beijing.gov.cn/tjsj_31433/yjdsj_31440/jmsz_32036/2025/202601/t20260121_4452274.html)与[消费说明](https://tjj.beijing.gov.cn/tjsj_31433/yjdsj_31440/jmsz_32036/2025/202601/t20260121_4452284.html)均发布2026-01-21，按常住地调查，外地户籍通常居住半年以上也纳入；不把户籍城市身份当成人口范围。
- 天津：2025全年收入60099元、消费39693元均为城镇居民；[总队原文](http://tjzd.stats.gov.cn/system/2026/01/20/030241179.shtml)发布2026-01-20，年度数据含自产自用部分，不把季度口径混入。保留原HTTP链接，不虚构HTTPS；原文未注明初步或最终，记录未说明。[当地常住人口佐证](https://www.tj.gov.cn/sq/zfsj/sjfb/202601/t20260122_7229572.html)第六节列同一收入值；[国家统计局统一住户调查方法](https://www.stats.gov.cn/zs/tjws/zytjzbqs/jmrj/202501/t20250121_1958392.html)说明按常住地、各调查总队统一方案及样本加权。本次未读取受限的天津年鉴方法PDF，不将它列为已核验证据。
- 武汉：2025年城镇常住居民收入67248元、消费43233元，原值不变。[公报](https://tjj.wuhan.gov.cn/tjfw/tjgb/202604/t20260408_2750693.shtml)实际发布2026-04-09，第十一节明确全年全市、按常住地分，注1为快报数。[2023至2027轮换文件](https://www.wuhan.gov.cn/zwgk/xxgk/zfgb/202205/P020220520545928475674.pdf)见2022年第8期政府公报第14至16页，覆盖各区并组织抽样、记账；计划样本数不当成2025实际样本。
- 其他城市仅在逐城完成数值、人口、地域及方法核验后补入。本批不为缺少正文的城市推定人口类型，也不修改它们既有指数输入。

可支配收入包含工资之外的经营、财产和转移净收入；人均统计含无收入者，不是个人求职工资。消费包含居住等支出及实物项目，不是单身居民现金预算。城市城乡结构、消费结构、样本和误差仍有差别；同组只能做描述性对照，不能声称差异具有统计显著性或直接等于物价差异。

程序校验在 `scripts/resident_statistics.py`，由校验器和构建入口共同调用。测试使用独立虚构夹具，并检查移除元数据后原指数和底线计算完全相同。元数据本身不创建自动复核任务。
