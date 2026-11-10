/* 日子人城市指南 · 网页。数据来自 data/cities.json（由 scripts/build.py 生成）。
 * 规则：只把「已核实、未过期」的数字算进合计和排名；⚠️ 项单独列出并说明原因。 */
(() => {
  "use strict";

  const REPO = "https://github.com/baichen99/rizi-city";
  const REPO_SHORT = "github.com/baichen99/rizi-city";
  const METHOD_URL = REPO + "/blob/main/docs/index-method.md";
  const DEG = { associate: "专科", bachelor: "本科", master: "硕士", phd: "博士" };
  const DEG_KEYS = Object.keys(DEG);
  const TIER_SCORE = { direct: 2, job: 1, quota: 0 };
  const TIER_LABEL = { direct: "直接落户", job: "先就业或缴社保", quota: "单位指标或积分" };
  const METRICS = [
    { key: "rent", short: "房租", label: "房租负担", dir: -1, how: "假设30㎡月租 ÷ 人均月可支配收入（年数÷12），不是你的实际负担" },
    { key: "cost", short: "生活成本", label: "生活成本", dir: -1, how: "人均消费支出 ÷ 人均可支配收入" },
    { key: "hukou", short: "落户", label: "落户难度", dir: 1, how: "本科：直接落户 > 先就业 > 指标或积分" },
    { key: "subsidy", short: "补贴", label: "补贴力度", dir: 1, how: "本科一次性补贴 + 首年租房补贴" },
    { key: "commute", short: "通勤", label: "通勤", dir: -1, off: true, how: "暂停用：还没有统一口径的官方来源" },
    { key: "social", short: "社保", label: "社保负担", dir: -1, how: "灵活就业每月最少自缴 ÷ 人均月可支配收入" },
  ];
  const ACTIVE = METRICS.filter((m) => !m.off);
  const PRESETS = [
    { name: "等权", w: { rent: 1, cost: 1, hukou: 1, subsidy: 1, social: 1 } },
    { name: "我更在乎房租", w: { rent: 3, cost: 1, hukou: 1, subsidy: 1, social: 1 } },
    { name: "只想先落户", w: { rent: 1, cost: 0, hukou: 4, subsidy: 1, social: 0 } },
    { name: "能领钱最重要", w: { rent: 1, cost: 0, hukou: 1, subsidy: 4, social: 0 } },
    { name: "自由职业视角", w: { rent: 2, cost: 2, hukou: 0, subsidy: 0, social: 3 } },
  ];

  const state = {
    tab: "resident",
    residentCity: "", compareA: "", compareB: "", policyTopic: "all",
    w: { ...PRESETS[0].w },
    deg: "bachelor",
    age: null,
    gradSort: "money",
    freeSort: "social",
    myCity: null,
    civil: { year: "", contract: "", social: "", files: "", project: false },
  };

  let D = null; // 数据
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text || "官方原文")}</a>` : "");
  const money = (n) => {
    if (n == null) return "—";
    if (n >= 10000) return (n / 10000).toFixed(2).replace(/\.?0+$/, "") + " 万";
    return Math.round(n).toLocaleString("zh-CN");
  };
  const pct = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
  const yamlUrl = (c) => `${REPO}/blob/main/data/cities/${c.id}.yaml`;
  const claimUrl = (c) => `${REPO}/issues/new?template=claim-city.yml&title=${encodeURIComponent("认领：" + c.city)}&city=${encodeURIComponent(c.city)}`;
  const verifiedLine = (sec) => (sec && sec.verified_at ? `核验 ${esc(sec.verified_at)}` : "未核验");

  // ---------- URL 状态 ----------
  function readHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const first = location.hash.slice(1).split("&")[0];
    state.tab = ["resident", "compare", "index", "grad", "civil", "free"].includes(first) ? first : "resident";
    state.residentCity = ""; state.compareA = ""; state.compareB = ""; state.myCity = null;
    state.w = { ...PRESETS[0].w }; state.deg = "bachelor";
    const validCity = id => D.cities.some(c => c.id === id) ? id : "";
    const city = validCity(params.get("city"));
    if (state.tab === "resident") state.residentCity = city || (!location.hash ? validCity(rememberedCity()) : "");
    if (state.tab === "index") state.myCity = city || null;
    if (state.tab === "compare") { state.compareA = validCity(params.get("a")); state.compareB = validCity(params.get("b")); }
    const nums = (params.get("w") || "").split(".").map(Number);
    if (nums.length === ACTIVE.length && nums.every(n => Number.isInteger(n) && n >= 0 && n <= 5)) ACTIVE.forEach((m,i) => state.w[m.key] = nums[i]);
    if (DEG[params.get("deg")]) state.deg = params.get("deg");
  }
  function hashFor(tab) {
    const h = [tab];
    if (tab === "resident" && state.residentCity) h.push("city=" + encodeURIComponent(state.residentCity));
    if (tab === "compare") { if(state.compareA) h.push("a=" + encodeURIComponent(state.compareA)); if(state.compareB) h.push("b=" + encodeURIComponent(state.compareB)); }
    if (tab === "index") { h.push("w=" + ACTIVE.map(m => state.w[m.key]).join(".")); if(state.myCity) h.push("city=" + encodeURIComponent(state.myCity)); }
    if (tab === "grad") h.push("deg=" + state.deg);
    return "#" + h.join("&");
  }
  function writeHash(push = false) {
    const next = hashFor(state.tab);
    if (location.hash === next) return;
    try { history[push ? "pushState" : "replaceState"](null, "", next); } catch (_) { /* file:// may disallow history */ }
  }
  function shareUrl() {
    const base = location.protocol.startsWith("http") ? location.origin + location.pathname : "https://baichen99.github.io/rizi-city/";
    return base + hashFor(state.tab);
  }

  // ---------- 居民城市主页：事实、口径和行动分别展示 ----------
  const LIFE_STATUS = { restricted: "仅官方入口", stale: "待复核", pending_review: "待复核", verified: "已核实", pending: "待核实", needs_review: "待核实", expired: "已过期", missing: "尚未覆盖", not_covered: "尚未覆盖" };
  const lifeValue = (r) => typeof r.value === "number" && Number.isFinite(r.value) ? r.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
  const safeLink = (url, label) => /^https?:\/\//i.test(url || "") ? link(url, label) : "";
  function rememberedCity() { try { return localStorage.getItem("rizi-resident-city") || ""; } catch (_) { return ""; } }
  function cityOptions(value) { return `<option value="">请选择城市</option>` + D.cities.map(c => `<option value="${esc(c.id)}" ${c.id === value ? "selected" : ""}>${esc(c.city)}</option>`).join(""); }
  function statisticsSourceUrl(value) {
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol) && (u.hostname === "gov.cn" || u.hostname.endsWith(".gov.cn")) && !u.username && !u.password && !u.port;
    } catch (_) { return false; }
  }
  function livingRecord(c, metric, field, label, unit, period, source, population) {
    const l = c.living || {};
    const record = { id: metric, metric, label, value: l[field], unit, period, source_url: source, population_scope: population, geographic_scope: c.city, review_status: (l.needs_human && (!l.needs_human_fields?.length || l.needs_human_fields.includes(field))) || l.access_blocked ? "pending" : l[field] == null ? "missing" : "verified", verified_at: l.verified_at, missing_reason: l.needs_human_reason || "尚未覆盖", comparability_key: metric === "rent" ? `${metric}:legacy` : null };
    const m = l.statistical_metadata?.[field];
    if (!m || !["income_per_capita", "consumption_per_capita"].includes(field)) return record;
    const expectedKey = `resident-statistics|${field}|${m.population_scope_type}|city_administrative_area|CNY-person-year|household-survey`;
    const complete = (!m.cross_city_comparability_key || m.cross_city_comparability_key === expectedKey) && m.price_basis === "nominal" && Number.isFinite(m.source_value) && m.source_value >= 0 && m.source_value <= Number.MAX_SAFE_INTEGER && m.source_value === l[field] && /^(19|20)\d{2}$/.test(String(l.stats_year)) && typeof m.period === "string" && m.period === String(l.stats_year) && m.unit === "元/年" && m.statistic === "mean"
      && ["all_residents", "urban_residents", "rural_residents"].includes(m.population_scope_type) && m.population_scope && m.geographic_scope && m.geographic_scope_type === "city_administrative_area"
      && m.methodology_key === "household_income_expenditure_survey" && statisticsSourceUrl(m.source_url) && calendarDate(m.source_date)
      && m.publisher && m.evidence_locator && calendarDate(m.verified_at) && calendarDate(m.review_due) && m.source_date <= m.verified_at && m.review_due >= m.verified_at;
    const status = complete && record.review_status === "verified" ? m.review_status : "pending_review";
    return { ...record, source_id: `living:${field}`, source_url: m.source_url, verified_at: m.verified_at,
      statistic: m.statistic, population_scope: m.population_scope || population, population_scope_type: m.population_scope_type,
      geographic_scope: m.geographic_scope || c.city, geographic_scope_type: m.geographic_scope_type,
      methodology_key: m.methodology_key, price_basis: m.price_basis, notes: m.methodology_note, data_status: m.data_status,
      cross_city_comparability_key: complete && typeof m.cross_city_comparability_key === "string" ? m.cross_city_comparability_key : null,
      review_status: status, missing_reason: complete ? record.missing_reason : "口径元数据与原值、年份或方法未匹配，暂不作为已核实数据展示或比较。",
      metadata_source: {id:`living:${field}`, url:m.source_url, publisher:m.publisher, title:(m.publisher || "待核实") + "统计原文", published_at:m.source_date, verified_at:m.verified_at, review_due:m.review_due, review_status:status} };
  }
  function lifeRecords(c) {
    const l = c.living || {};
    const records = [...(c.life?.overview || [])];
    for (const [metric, field, label, unit, period, source, population] of [
      ["rent", "rent_avg_per_sqm", "住宅平均租金", "元/㎡/月", l.rent_period, l.rent_source_url, l.rent_source || "监测机构住宅租赁样本"],
      ["income", "income_per_capita", "居民人均可支配收入", "元/年", l.stats_year, l.stats_source_url, "居民人均可支配收入（不是工资）；旧数据未结构化记录城镇 / 全体居民口径，请查看原统计公报"],
      ["consumption", "consumption_per_capita", "居民人均消费支出", "元/年", l.stats_year, l.stats_source_url, "居民人均消费支出（包含居住等支出）；旧数据未结构化记录城镇 / 全体居民口径，请查看原统计公报"],
    ]) records.push(livingRecord(c, metric, field, label, unit, period, source, population));
    for (const [metric, label, unit] of [["housing_new_yoy_index", "新建商品住宅价格指数", "指数"], ["wage_nonprivate_mean", "城镇非私营单位就业人员平均工资", "元/年"], ["wage_private_mean", "城镇私营单位就业人员平均工资", "元/年"], ["wage_median", "工资中位数", "元/年"], ["life_expectancy", "出生时预期寿命", "岁"]]) {
      if (!records.some(r => r.metric === metric)) records.push({ metric, label, unit, value: null, review_status: "missing", missing_reason: metric === "wage_median" ? "未找到同口径公开数据" : "尚未覆盖已核实数据" });
    }
    return records.map(r => currentLifeRecord(c, r));
  }
  function sourceFor(c, r) { return r.metadata_source || (c.life?.sources || []).find(s => s.id === r.source_id) || {}; }
  function calendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  // Recheck static/offline snapshots at viewing time; never mutate their evidence.
  function currentLifeRecord(c, r, today = new Date().toISOString().slice(0, 10)) {
    const s = sourceFor(c, r);
    let reason = "", status = r.review_status;
    if (r.source_id) {
      if (!s.id || s.review_status !== "verified") { status = s.review_status === "restricted" ? "restricted" : "pending_review"; reason = "来源尚未通过核验，暂不展示数值。"; }
      else if (!calendarDate(s.review_due)) { status = "pending_review"; reason = "来源缺少有效复核日期，暂不展示数值。"; }
      else if (s.review_due < today) { status = "stale"; reason = `已超过来源复核日期 ${s.review_due}，需重新核验后展示数值。`; }
      else if (s.verified_at > today || r.verified_at > today) { status = "pending_review"; reason = "核验日期晚于查看日期，暂不作为已核验记录。"; }
    }
    if (status !== "verified") return { ...r, value: null, review_status: status || "pending_review", missing_reason: [reason, r.missing_reason].filter(Boolean).join(" ") || "数据尚未核实，不参与数值展示或比较。" };
    return { ...r };
  }
  function recordDetails(c, r) {
    const s = sourceFor(c, r);
    const semantic = { mean: "平均数", median: "中位数", index: "价格指数", nominal: "名义金额（当年价）", gross: "税前", net: "税后", new: "新建商品住宅", resale: "二手住宅", transaction: "成交", listing: "挂牌" };
    return `<dl class="life-facts"><dt>统计期间</dt><dd>${esc(r.period || "未提供")}</dd><dt>地域 / 对象</dt><dd>${esc(r.geographic_scope || "未提供")} · ${esc(r.population_scope || "未提供")}</dd><dt>统计口径</dt><dd>${esc([r.statistic, r.gross_or_net, r.price_basis, r.market_segment, r.reference_period, r.base_period ? "编制方法基期 " + r.base_period + "（不是同比的100参照）" : null, r.notes].filter(Boolean).map(v => semantic[v] || v).join(" · ") || r.label)}</dd>${r.comparison === "year_on_year" ? `<dt>同比参照</dt><dd>${esc(r.unit)}；与上年同月比较，不是环比。</dd>` : ""}${r.data_status ? `<dt>数据状态</dt><dd>${esc(({preliminary:"初步数", flash:"快报数", final:"最终数", not_specified:"原文未说明是否最终数"})[r.data_status] || r.data_status)}</dd>` : ""}<dt>原文发布</dt><dd>${esc(s.published_at || "未提供")}</dd><dt>来源核验</dt><dd>${esc(r.verified_at || s.verified_at || "未提供核验日")}（不是统计年份）</dd><dt>来源复核期限</dt><dd>${esc(s.review_due || "旧数据未提供独立复核期限")}</dd></dl>${safeLink(r.source_url || s.url || s.source_url, s.title || s.publisher || "查看来源原文") + (s.attribution ? `<p class="small">${esc(s.attribution)}</p>` : "") || '<p class="small">暂无已核实来源链接。</p>'}`;
  }
  // Display explanations are derived only from verified values, never stored as new data.
  const checkedValue = r => r.review_status === "verified" && typeof r.value === "number" && Number.isFinite(r.value);
  const numberText = (value, digits = 2) => value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
  const yearAmount = value => Math.abs(value) >= 10000 ? `${numberText(value / 10000)}万元` : `${numberText(value)}元`;
  function periodLabel(period) {
    const m = /^(\d{4})(?:-(\d{2}))?$/.exec(String(period || ""));
    return m ? `${m[1]}年${m[2] ? Number(m[2]) + "月" : ""}` : String(period || "期间未提供");
  }
  function yoyChange(r) {
    return checkedValue(r) && r.metric === "housing_new_yoy_index" && r.statistic === "index" && r.comparison === "year_on_year" && r.unit === "上年同月=100" && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.period || "")
      ? Math.round((r.value - 100) * 100) / 100 : null;
  }
  function metricReading(r) {
    if (!checkedValue(r)) return "暂无已核实数值";
    const change = yoyChange(r);
    if (change !== null) return change === 0 ? "与去年同月持平" : `比去年同月${change < 0 ? "低" : "高"} ${numberText(Math.abs(change))}%`;
    if (r.metric === "rent" && r.unit === "元/㎡/月") return `每平方米每月约 ${numberText(r.value)} 元`;
    if (["wage_nonprivate_mean", "wage_private_mean", "wage_median"].includes(r.metric) && r.unit === "元/年") return `${r.statistic === "median" ? "工资中间水平" : "年平均工资"}约 ${yearAmount(r.value)}${r.gross_or_net === "gross" ? "（税前）" : ""}`;
    if (r.metric === "income" && r.unit === "元/年") return `平均每人一年可支配约 ${yearAmount(r.value)}`;
    if (r.metric === "consumption" && r.unit === "元/年") return `平均每人一年消费约 ${yearAmount(r.value)}`;
    return `${lifeValue(r)} ${r.unit || ""}`.trim();
  }
  function metricGuide(r) {
    const has = checkedValue(r), change = yoyChange(r);
    const guides = {
      housing_new_yoy_index: { meaning: "看新建商品住宅价格相对去年同月的变化，不是每平方米售价。", caution: "不能倒推房价金额，也不能判断你的房子涨跌。同比不等于与上个月相比的环比。" },
      rent: { meaning: "监测样本的每平方米月租平均单价，不是一套房的月租。", caution: "具体租金还取决于地段、面积和房型；不是房源报价。" },
      income: { meaning: "按统计范围内人口平均的一年可支配收入，不是在职者的平均工资。", caution: "人口范围可能是城镇或全体居民，按原公报口径看；不代表你个人能挣到的钱。" },
      consumption: { meaning: "统计范围内居民一年消费支出的平均数，包含居住等开销。", caution: "不是你个人必须花的钱，也不要把它和房租直接相加。人口范围请看原公报。" },
      wage_nonprivate_mean: { meaning: "城镇非私营单位就业人员的工资平均数。“非私营”不等于全部是体制内工作。", caution: "只代表这类统计单位，不包含所有劳动者；平均数不代表多数人的工资。" },
      wage_private_mean: { meaning: "城镇私营单位就业人员的工资平均数，不是所有打工人的收入。", caution: "不能代表个体经营者、自由职业者或每个人的到手工资。" },
      wage_median: { meaning: "把同一人群的工资从低到高排，中间位置的数。它和平均工资不是一回事。", caution: "没有同口径中位数时，不能用平均数猜，也不把缺失当作0。" },
      life_expectancy: { meaning: "假设统计当年的各年龄死亡率保持不变，新生儿平均预期可活多少年。", caution: "这是特定人口的群体指标，不是去世者平均年龄，也不预测个人寿命。历史年份不代表现状。" },
    };
    const guide = { ...(guides[r.metric] || { meaning: "按标注的单位、年份和统计对象理解这个数。", caution: "不同口径不能直接比较。" }) };
    if (change !== null) {
      const m = /^(\d{4})-(\d{2})$/.exec(r.period || "");
      guide.basis = `100 = 上年同月的价格水平${m ? `；这里比较${periodLabel(r.period)}与${Number(m[1]) - 1}年${Number(m[2])}月` : ""}。`;
      guide.example = "读数示例（不是新增城市数据）：100表示持平，102表示同比涨2%，98表示同比降2%。";
    } else if (r.metric === "housing_new_yoy_index") {
      guide.basis = "只有明确标注“上年同月=100”的同比指数，才能用指数减100读出同比涨跌幅。";
    }
    if (has && r.metric === "rent" && r.unit === "元/㎡/月") guide.example = `只看量级：假设30㎡，${numberText(r.value)} × 30 ≈ ${numberText(Math.round(r.value * 30))}元/月。面积是假设，乘算示意不是具体房源报价。`;
    if (has && ["wage_nonprivate_mean", "wage_private_mean", "income", "consumption"].includes(r.metric) && r.unit === "元/年") {
      const wage = r.metric.startsWith("wage");
      guide.example = `只看量级：年数 ${numberText(r.value)} ÷ 12 ≈ ${numberText(Math.round(r.value / 12))}元/月。这只是把年数摊到12个月${wage ? "，不是每月到手工资" : "，不是新增月度统计"}。`;
      if (wage && r.gross_or_net === "gross") guide.caution += " 税前口径" + (r.includes_bonus ? "含奖金等，" : "，") + "未扣个人税费、社保和公积金。";
    }
    return guide;
  }
  function explanationDetails(r) {
    const guide = metricGuide(r);
    return `${guide.basis ? `<p>${esc(guide.basis)}</p>` : ""}${guide.example ? `<p>${esc(guide.example)}</p>` : ""}<p>${esc(guide.caution)}</p>`;
  }
  function metricCard(c, r) {
    const has = checkedValue(r), guide = metricGuide(r);
    return `<article class="card metric-card" data-metric="${esc(r.metric)}"><div class="metric-top"><h3>${esc(r.label)}</h3><span class="life-status">${esc(LIFE_STATUS[r.review_status] || r.review_status || "待核实")}</span></div><p class="metric-reading">${esc(metricReading(r))}</p><p class="metric-original">原始数值：<strong>${lifeValue(r)}</strong>${has ? " " + esc(r.unit) : ""} · ${esc(r.period || "期间未提供")}</p>${!has ? `<p class="small">${esc(r.missing_reason || "未找到同口径公开数据")}</p>` : ""}<p class="metric-meaning">${esc(guide.meaning)}</p>${populationLabel(r) ? `<p class="metric-scope">统计人口：${esc(populationLabel(r))}${r.data_status === "preliminary" ? " · 初步数" : ""}</p>` : ""}${guide.basis ? `<p class="metric-basis">${esc(guide.basis)}</p>` : ""}<details class="metric-explainer"><summary>怎么理解？看例子与边界</summary>${explanationDetails(r)}</details><details><summary>口径与来源</summary>${recordDetails(c, r)}</details></article>`;
  }
  // Pure chart helpers: missing and unverified points always break the line.
  function periodNumber(period, frequency) {
    const m = /^(\d{4})(?:-(\d{2}))?$/.exec(String(period));
    if (!m) return null;
    return frequency === "monthly" ? (m[2] ? +m[1] * 12 + +m[2] - 1 : null) : +m[1];
  }
  function pointGroup(p, series) {
    return JSON.stringify([p.comparability_key || series.comparability_key, p.unit || series.unit, p.population_scope, p.geographic_scope]);
  }
  function chartSegments(series) {
    const points = [...(series.points || [])].sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const segments = []; let segment = [], previous = null, previousGroup = null;
    for (const p of points) {
      const n = periodNumber(p.period, series.frequency);
      const valid = Number.isFinite(p.value) && p.value !== null && p.review_status === "verified" && n !== null;
      const group = pointGroup(p, series);
      if (!valid || (previous !== null && (n !== previous + 1 || group !== previousGroup))) { if (segment.length) segments.push(segment); segment = []; }
      if (valid) segment.push(p);
      previous = valid ? n : null; previousGroup = valid ? group : null;
    }
    if (segment.length) segments.push(segment);
    return segments;
  }
  function comparable(a, b) {
    return a && b && a.metric === b.metric && a.unit === b.unit && a.period === b.period && (a.cross_city_comparability_key || a.comparability_key) && (a.cross_city_comparability_key || a.comparability_key) === (b.cross_city_comparability_key || b.comparability_key) && (a.population_scope_type || a.population_scope) === (b.population_scope_type || b.population_scope) && a.statistic === b.statistic && a.price_basis === b.price_basis && a.methodology_key === b.methodology_key && a.geographic_scope_type === b.geographic_scope_type && a.review_status === "verified" && b.review_status === "verified" && Number.isFinite(a.value) && Number.isFinite(b.value);
  }
  function historyExplanation(series, segments) {
    const valid = segments.flat(), lastSegment = segments[segments.length - 1] || [];
    const latest = valid[valid.length - 1];
    if (!latest) return "尚无已核实观测，不能判断走势；没有数值不代表为0。";
    let text = `最新已核实观测：${periodLabel(latest.period)}，${metricReading(latest)}。`;
    const change = yoyChange(latest), previous = lastSegment[lastSegment.length - 2];
    if (change !== null) {
      if (previous && yoyChange(previous) !== null) {
        const delta = Math.round((change - yoyChange(previous)) * 100) / 100;
        text += delta === 0 ? "同比涨跌幅与前一个月相同。" : `同比涨跌幅比前一个月${delta > 0 ? "高" : "低"} ${numberText(Math.abs(delta))} 个百分点。`;
      }
      text += "每个点各自与去年同月比；曲线上升不一定表示比上个月涨价，不能据此计算环比。";
    } else if (previous) text += `前一条相邻观测是${periodLabel(previous.period)}的${lifeValue(previous)} ${previous.unit || series.unit}；仅描述这两个已核实期间。`;
    const missing = (series.points || []).filter(p => !checkedValue(p)).length;
    if (missing) text += `另有${missing}个期间暂无可用数值，留空、不补点，也不把旧年值当现状。`;
    return text;
  }
  function historyChart(c, series, index) {
    series = { ...series, points: (series.points || []).map(p => currentLifeRecord(c, p)) };
    const groups = new Map();
    for (const p of series.points || []) { const key = pointGroup(p, series); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
    if (groups.size > 1) return [...groups.values()].map((points,i) => historyChart(c, {...series, label: series.label + " · 口径组 " + (i + 1), unit: points[0].unit || series.unit, comparability_key: points[0].comparability_key || series.comparability_key, points}, `${index}-${i}`)).join("");
    const segments = chartSegments(series), valid = segments.flat();
    const titleId = `history-title-${index}`;
    let graph = '<p class="small">尚无可绘制的已核实历史数据。</p>';
    if (valid.length) {
      const timeline = [...series.points].filter(p => Number.isFinite(periodNumber(p.period, series.frequency))).sort((a,b) => periodNumber(a.period, series.frequency) - periodNumber(b.period, series.frequency));
      const periods = timeline.map(p => periodNumber(p.period, series.frequency));
      const minX = Math.min(...periods), maxX = Math.max(...periods);
      const hasReference = valid.every(p => yoyChange(p) !== null);
      let minY = Math.min(...valid.map(p => p.value), ...(hasReference ? [100] : [])), maxY = Math.max(...valid.map(p => p.value), ...(hasReference ? [100] : []));
      if (minY === maxY) { minY -= 1; maxY += 1; }
      // Separate coordinate systems keep labels legible when a chart is only 260px wide.
      // CSS chooses one SVG, so resizing does not require a state-changing rerender.
      graph = [[620, "wide"], [300, "narrow"]].map(([width, mode]) => {
        const x = p => 62 + (periodNumber(p.period, series.frequency) - minX) / (maxX - minX || 1) * (width - 110);
        const y = p => 152 - (p.value - minY) / (maxY - minY || 1) * 110;
        const id = `${titleId}-${mode}`;
        return `<svg class="history-chart history-${mode}" viewBox="0 0 ${width} 195" role="img" aria-labelledby="${id}"><title id="${id}">${esc(series.label)}历史观测，${esc(series.unit)}。缺失期间断线，完整数值见下方表格。</title><path d="M62 24V152H${width - 38}" class="chart-axis"/><text x="4" y="45">${esc(maxY)}</text><text x="4" y="154">${esc(minY)}</text>${hasReference ? `<path d="M62 ${y({value:100})}H${width - 48}" class="chart-reference"/><text x="62" y="${y({value:100}) - 8}" class="chart-reference-label">100：去年同月</text>` : ""}${segments.map(ps => `${ps.length > 1 ? `<polyline points="${ps.map(p => `${x(p)},${y(p)}`).join(" ")}"/>` : ""}${ps.map(p => `<circle tabindex="0" role="img" aria-label="${esc(p.period)}，${lifeValue(p)} ${esc(series.unit)}；${esc(sourceFor(c,p).title || "来源未提供")}；核验 ${esc(p.verified_at || sourceFor(c,p).verified_at || "未提供")}" cx="${x(p)}" cy="${y(p)}" r="4"><title>${esc(p.period)}：${lifeValue(p)} ${esc(series.unit)}；${esc(sourceFor(c,p).title || "来源未提供")}；核验 ${esc(p.verified_at || sourceFor(c,p).verified_at || "未提供")}</title></circle>`).join("")}`).join("")}<text x="62" y="182">${esc(timeline[0].period)}</text><text x="${width - 48}" y="182" text-anchor="end">${esc(timeline[timeline.length - 1].period)}</text></svg>`;
      }).join("");
    }
    return `<article class="card"><h3>${esc(series.label)}</h3><p class="small">${esc(series.unit)} · ${esc(series.points?.[0]?.population_scope || "对象见明细")}。${esc(series.notes || "")} 只连接相邻且同口径的已核实观测，不补点、不把缺失当 0。纵轴按观测范围缩放，可能不从 0 起。</p><p class="trend-reading">${esc(historyExplanation(series, segments))}</p>${graph}<details><summary>查看历史数据表与来源（${(series.points || []).length} 条）</summary><div class="table-scroll history-table"><table role="table"><caption>${esc(series.label)}历史观测</caption><thead role="rowgroup"><tr role="row"><th scope="col">期间</th><th scope="col">数值（${esc(series.unit)}）</th><th scope="col">状态 / 来源</th></tr></thead><tbody role="rowgroup">${(series.points || []).map(p => `<tr><th scope="row">${esc(p.period)}</th><td role="cell">${lifeValue(p)} <span class="history-value-unit">${esc(series.unit)}</span></td><td role="cell">${esc(LIFE_STATUS[p.review_status] || "待核实")} ${safeLink(sourceFor(c,p).url || sourceFor(c,p).source_url, sourceFor(c,p).title || "原文") + " · 核验 " + esc(p.verified_at || sourceFor(c,p).verified_at || "未提供")}${p.missing_reason ? esc(p.missing_reason) : ""}</td></tr>`).join("")}</tbody></table></div></details></article>`;
  }
  function policyCards(c) {
    const policies = [
      { ...c.hukou, title: "毕业生 / 人才落户", topic: "hukou", audience: "毕业生或人才引进对象，按原文件条件", summary: c.hukou?.summary, window: c.hukou?.apply_window },
      ...(c.subsidies || []).map(s => ({ ...s, title: s.name, topic: "subsidy", audience: s.target || "以原文件为准", summary: s.amount, window: s.deadline_rule })),
      { ...c.flexible_employment, title: "灵活就业参保", topic: "social", audience: c.flexible_employment?.hukou_restriction, summary: c.flexible_employment?.calc, window: c.flexible_employment?.apply_channel },
    ].filter(p => state.policyTopic === "all" || p.topic === state.policyTopic);
    return `<section aria-labelledby="policy-heading"><h2 id="policy-heading">政策与办理线索</h2><p class="sub">目前覆盖毕业生 / 人才政策和灵活就业参保，不是全体居民政策库。主题筛选不判断个人资格。</p><label class="life-filter">按主题浏览 <select id="policy-topic"><option value="all">全部已收录主题</option>${[["hukou","落户"],["subsidy","人才补贴"],["social","灵活就业参保"]].map(([v,l])=>`<option value="${v}" ${state.policyTopic===v?"selected":""}>${l}</option>`).join("")}</select></label><div class="life-stack">${policies.map(p => {
      const expired = p.valid_until && p.valid_until < new Date().toISOString().slice(0,10);
      return `<article class="card"><h3>${esc(p.title)} <span class="life-status">${expired ? "依据文件已过期，延续情况待确认" : p.needs_human ? "待核实" : p.verified_at ? "资料已核验 · 资格仍需确认" : "尚未覆盖"}</span></h3><p>${esc(p.summary || "尚无已核实说明")}</p><p class="small"><strong>适用对象：</strong>${esc(p.audience || "尚未核实，请先看原文")}</p><details><summary>条件、期限和办理入口</summary><ul>${(p.conditions || []).map(x=>`<li>${esc(x)}</li>`).join("")}</ul><p>期限 / 渠道：${esc(p.window || "未见固定截止日期，需向官方确认")}</p><p>材料：尚未结构化核实，请按官方清单准备。</p><p>${safeLink(p.source_url, "政策原文 ↗")}</p>${p.official_action_url ? safeLink(p.official_action_url, "已核实官方办理入口 ↗") : '<p class="note">尚无单独核实的在线办理入口。政策原文不等于申办页面。</p>'}<p class="small">原文发布日期：${esc(p.source_date || "未提供")} · 有效至：${esc(p.valid_until || "需向官方确认")} · 资料核验：${esc(p.verified_at || "未核验")}</p>${p.needs_human_reason ? `<p class="note">${esc(p.needs_human_reason)}</p>` : ""}</details></article>`;
    }).join("") || '<p class="note">该主题尚未覆盖已核实事项。</p>'}</div>${c.subsidy_scan?.living_none || c.subsidy_scan?.rent_none ? `<p class="note">既有扫描仅针对普通应届生的市级现金生活 / 租房补贴，排除区级、行业限定和实物配租；不表示本市没有其他居民补贴。${esc(c.subsidy_scan.basis || "")}</p>` : ""}</section>`;
  }
  function currentLifeModule(m, today = new Date().toISOString().slice(0, 10)) {
    let status = m.status, reason = "";
    if (m.effective_to && m.effective_to < today) { status = "expired"; reason = "来源记录已到期；仅留历史入口。"; }
    else if (m.effective_from && m.effective_from > today) { status = "pending_review"; reason = "尚未到生效日，不能视为现行规则。"; }
    else if (m.verified_at > today) { status = "pending_review"; reason = "核验日期晚于查看日期，不能作为已核验记录。"; }
    else if (m.next_review_at && m.next_review_at < today) { status = "pending_review"; reason = "已超过复核窗口；入口及规则均需重新打开核验。"; }
    return { ...m, status, rate_reference: status === "reference_values" && m.review_status === "reviewed" && m.redistribution_status === "fact_extract" ? m.rate_reference : null, reason: reason + (m.reason || ""), usable: false, calculator_enabled: false };
  }
  function moduleCard(m) {
    m = currentLifeModule(m);
    const ref = m.rate_reference;
    const statuses = {link_only: "仅官方资料入口", reference_values: "官方单价参考", missing: "尚未覆盖", pending_review: "待复核", expired: "已过期"};
    const rates = ref ? `<div class="utility-reference"><p class="small utility-scope">${esc(ref.scope)}</p><dl class="utility-rates">${ref.items.map(r=>`<div><dt>${esc(r.label)}</dt><dd><strong>${r.approximate ? "约 " : ""}${esc(r.value)}</strong> <span>${esc(r.unit)}</span><small>${esc(r.basis)}</small></dd></div>`).join("")}</dl><p class="small">${esc(ref.period)}</p><p class="small">${esc(ref.note)}</p><p class="small">${safeLink(ref.source_url, ref.source_label)} · ${esc(ref.source_date)}</p></div>` : `<p>${esc(m.summary || "尚未覆盖")}</p><p class="note">${esc(m.reason || "尚未完成现行性与适用范围核验")}</p>`;
    return `<article class="card utility-card" data-module="${esc(m.id)}"><h3>${esc(m.title)} <span class="life-status">${esc(statuses[m.status] || "待复核")}</span></h3>${rates}<details class="utility-evidence"><summary>适用条件、来源与核验</summary>${ref ? `<p>${esc(m.summary)}</p><p class="note">${esc(m.reason)}</p>` : ""}<p class="small">覆盖范围：${esc(m.coverage || "未提供")}</p><p class="small">资料期间：${esc(m.reference_period || "未提供")} · 原文日期：${esc(m.source_date || "未提供")}</p><p class="small">资料核验：${esc(m.verified_at || "未提供")} · 计划复核：${esc(m.next_review_at || "未提供")}</p><p class="small">${esc(m.verification_scope || "入口核验不等于当前规则或服务可用性已确认")}。本页不提供费用 / 待遇计算。</p>${(m.links || []).map(l=>safeLink(l.url,l.label)).join("<br>")}</details></article>`;
  }
  function renderDaily(c) {
    return `<section id="life-daily"><h2>日常生活</h2><p class="sub">先看有来源的单价、适用范围和办理入口。单价不是月账单，未核实的项目明确留空。</p><div class="metric-grid">${(c.life?.modules || []).map(moduleCard).join("") || '<p class="note">本城账单、气候、就医、菜篮子与街区导航尚未覆盖；不提供未经核实的价格。</p>'}</div></section>`;
  }
  function renderResident() {
    const c = D.cities.find(c => c.id === state.residentCity);
    const saved = rememberedCity();
    // Keep the original native select connected while its picker commits on iOS.
    // Replacing it and focusing a new select can reopen the picker or lose a tap.
    if (!$("#resident-city")) {
      $("#tab-resident").innerHTML = `<div class="resident-intro"></div><div class="card city-picker"><label for="resident-city">我住在</label><select id="resident-city">${cityOptions("")}</select><div class="row" id="resident-city-actions"></div><p class="small" id="resident-city-preference"></p></div><div id="resident-content" class="panel-content"></div>`;
    }
    $(".resident-intro").innerHTML = `<p class="kicker">把日子过在这里</p><h2>${c ? esc(c.city) + "，生活概况" : "先看看你生活的城市"}</h2><p class="sub">看懂公开数据，找到政策原文。先看日常生活，再查政策、月开支和生活水平。</p>`;
    if ($("#resident-city").value !== state.residentCity) $("#resident-city").value = state.residentCity;
    $("#resident-city-actions").innerHTML = `<button class="btn ghost" data-remember ${!c ? "disabled" : ""}>在本机记住这座城</button><button class="btn ghost" data-forget ${!saved ? "disabled" : ""}>清除记住的城市</button>${c ? '<button class="btn ghost" data-copy>分享城市页</button>' : ""}`;
    $("#resident-city-preference").innerHTML = `${saved ? "已记住：" + esc(D.cities.find(x=>x.id===saved)?.city || saved) + "。" : "默认不保存。"}仅在此浏览器保存城市；分享链接不含个人条件。`;
    $("#resident-content").innerHTML = `${!c ? `<div class="resident-empty"><span aria-hidden="true">⌂</span><h3>一城一份，慢慢看清楚</h3><p>选择城市后查看概况、历史观测、政策和生活入口。未覆盖的数据会明确留空。</p><p><a href="#compare">还在考虑搬家？比较两座城市 →</a></p></div>` : `<nav class="life-jumps" aria-label="本城内容">${[["daily","日常生活"],["policies","政策"],["budget","月开支"],["overview","概况"],["history","历史走势"],["sources","来源与更新"]].map(([id,l])=>`<button class="chip" data-jump="${id}">${l}</button>`).join("")}</nav>${renderDaily(c)}<div id="life-policies">${policyCards(c)}</div>${renderBudget(c)}<section id="life-overview"><h2>生活的几个侧面</h2><p class="sub">数字的时间和对象可能不同，请展开查看。没有值不代表为 0。</p><div class="metric-grid">${lifeRecords(c).map(r=>metricCard(c,r)).join("")}</div></section><section id="life-history"><h2>沿着时间看变化</h2><p class="sub">每张图独立呈现同一可比序列。历史数据不冒充现状。</p><div class="life-stack">${(c.life?.series || []).map((s,i)=>historyChart(c,s,i)).join("") || '<p class="note">尚未收录满足同口径要求的历史序列，暂不绘图。</p>'}</div></section><section id="life-sources"><h2>来源与资料更新</h2><p class="sub">重新核验不等于政策发生变化。目前未建立独立的政策生效变更流，请以原文为准。</p><div class="card"><h3>资料核验</h3><p>本城最近核验：${esc(c.latest_verified || "未提供")}。统计年份请查看各指标。</p><details><summary>全部新增数据来源（${(c.life?.sources || []).length}）</summary><ul>${(c.life?.sources || []).map(s=>`<li>${safeLink(s.url || s.source_url, s.title || s.id)} <span class="small">${esc(s.verified_at || "")}</span></li>`).join("")}</ul></details><p>${link(yamlUrl(c),"查看城市数据与维护记录")} · ${link(REPO + "/issues/new?template=data-error.yml", "报告数据问题")}</p></div></section>`}`;
  }
  function comparisonRows(a, b) {
    const left = lifeRecords(a), right = lifeRecords(b);
    const order = ["rent", "housing_new_yoy_index", "income", "consumption", "wage_nonprivate_mean", "wage_private_mean", "wage_median", "life_expectancy"];
    return order.map(metric => {
      const r = left.find(x => x.metric === metric), s = right.find(x => x.metric === metric);
      const canCompare = Boolean(comparable(r, s)), available = checkedValue(r) && checkedValue(s);
      let reason = "统计对象、期间和指标口径一致，可以读两城差异。";
      if (!available) reason = !checkedValue(r) && !checkedValue(s) ? "两城都还缺已核实数值，不补0，也不猜测。" : "一座城市还缺已核实数值，暂时不能做两城比较。";
      else if (!canCompare) {
        reason = r.period !== s.period ? `统计期间不同（${r.period || "未提供"} / ${s.period || "未提供"}），只分别展示，不作高低比较。`
          : r.unit !== s.unit ? "计量单位不同，不能直接作高低比较。"
          : r.population_scope_type && s.population_scope_type && r.population_scope_type !== s.population_scope_type ? "统计对象不同，不能直接作高低比较。"
          : "人口范围或统计口径尚未确认一致，只分别看原文，不作高低比较。";
      }
      return { metric, r, s, canCompare, state: canCompare ? "ready" : available ? "reference" : "missing", reason };
    });
  }
  function comparisonNumber(r) {
    if (!checkedValue(r)) return "暂无";
    const change = yoyChange(r);
    if (change !== null) return change === 0 ? "同比持平" : `${change < 0 ? "下降" : "上涨"}${numberText(Math.abs(change))}%`;
    if (r.unit === "元/年") return yearAmount(r.value);
    return lifeValue(r);
  }
  function comparisonUnit(r) {
    if (yoyChange(r) !== null) return "与去年同月相比";
    if (r.unit === "元/年") return ["income", "consumption"].includes(r.metric) ? "每人/年" : r.gross_or_net === "gross" ? "每年 · 税前" : "每年";
    return r.unit || "单位未提供";
  }
  function populationLabel(r) {
    if (!["income", "consumption"].includes(r.metric)) return "";
    return checkedValue(r) ? ({urban_residents:"城镇常住居民",all_residents:"全体常住居民",rural_residents:"农村常住居民"})[r.population_scope_type] || "人口范围待核实" : "";
  }
  // ---------- Living-cost reference and private, in-memory household plan ----------
  const BUDGET_FIELDS = [
    {key:"housing",label:"住房",hint:"整户房租、房贷及物业等"},
    {key:"food",includedIn:["other"],label:"吃饭买菜",hint:"全家合计，含外食"},
    {key:"water",includedIn:["housing","other"],label:"水费",hint:"填账单月均金额"},
    {key:"power",includedIn:["housing","other"],label:"电费",hint:"含已用电支付的制冷、取暖"},
    {key:"gas",includedIn:["housing","other"],label:"燃气",hint:"已含的取暖不重复填"},
    {key:"heating",includedIn:["housing","power","gas","other"],label:"供暖费（全年）",hint:"单独付的全年费用，按12个月摊开",annual:true},
    {key:"transport",includedIn:["other"],label:"交通",hint:"整户通勤、出行合计"},
    {key:"social",includedIn:["other"],label:"另付税费、社保",hint:"只填尚未从可用收入扣除的部分"},
    {key:"other",label:"其他开销",hint:"通讯、医疗、育儿、娱乐和其他债务等，不含储蓄"},
  ];
  function freshBudget() { return {mode:"total",people:"1",income:"",goal:"",total:"",amounts:{},included:{}}; }
  function cityBudget(c) { state.budgets ||= {}; return state.budgets[c.id] ||= freshBudget(); }
  function budgetAmount(raw) {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) return NaN;
    const n = Number(raw); return Number.isFinite(n) && n <= 10000000 ? n : NaN;
  }
  function budgetResult(b) {
    const people = typeof b.people === "string" && /^\d+$/.test(b.people) ? Number(b.people) : NaN;
    const income = budgetAmount(b.income), goal = budgetAmount(b.goal);
    const missing = [], invalid = [], entered = [], included = [];
    let subtotal = 0;
    if (!Number.isInteger(people) || people < 1 || people > 30) invalid.push("人数（1至30人）");
    if (b.mode === "details") {
      for (const f of BUDGET_FIELDS) {
        const mode = b.included[f.key] || "separate";
        if (mode === "none") { entered.push(f.key); continue; }
        if ((f.includedIn || []).includes(mode)) { included.push([f,mode]); continue; }
        if (mode !== "separate") { invalid.push(f.label + "计入方式"); continue; }
        const value = budgetAmount(b.amounts[f.key] ?? "");
        if (value === null) missing.push(f.label);
        else if (!Number.isFinite(value)) invalid.push(f.label);
        else { subtotal += f.annual ? value / 12 : value; entered.push(f.key); }
      }
      for (const [f,target] of included) {
        const amount = budgetAmount(b.amounts[target] ?? "");
        const targetLabel = BUDGET_FIELDS.find(item=>item.key === target).label;
        if ((b.included[target] || "separate") !== "separate" || amount === null || !Number.isFinite(amount)) missing.push(`${f.label}所含的${targetLabel}金额`);
        else entered.push(f.key);
      }
    } else if (b.mode === "total") {
      const value = budgetAmount(b.total);
      if (value === null) missing.push("整户月开支");
      else if (!Number.isFinite(value)) invalid.push("整户月开支");
      else { subtotal = value; entered.push("total"); }
    } else invalid.push("填写方式");
    if (income !== null && !Number.isFinite(income)) invalid.push("可用收入");
    if (goal !== null && !Number.isFinite(goal)) invalid.push("储蓄目标");
    // Round after summing, not each item's annual-to-monthly conversion.
    subtotal = Math.round(subtotal * 100) / 100;
    const complete = missing.length === 0 && invalid.length === 0;
    const balance = complete && income !== null ? Math.round((income - subtotal) * 100) / 100 : null;
    const afterGoal = balance !== null && goal !== null ? Math.round((balance - goal) * 100) / 100 : null;
    return {people,income,goal,subtotal,missing,invalid,entered,complete,balance,afterGoal};
  }
  function budgetMoney(n) { return numberText(n, Math.abs(n) < 1 && n !== 0 ? 2 : 0); }
  function budgetReading(r) {
    if (r.invalid.length) return {title:"有几项需要改一下",detail:"请检查：" + r.invalid.join("、")};
    if (!r.complete) return {title:r.entered.length ? `已填开销合计约 ${budgetMoney(r.subtotal)} 元/月` : "把你的月开支填进来",detail:"还没算：" + r.missing.join("、")};
    if (r.balance === null) return {title:`整户每月预计花 ${budgetMoney(r.subtotal)} 元`,detail:"再填整户可用收入，就能看每月还能留下多少。"};
    if (r.balance < 0) return {title:`按这份预算，每月还差约 ${budgetMoney(-r.balance)} 元`,detail:"目前填的开销超过了可用收入，可以调整开销或收入计划。"};
    if (r.balance === 0 && (r.goal === null || r.goal === 0)) return {title:"按这份预算，收支刚好打平",detail:"每月可用收入与已填开销相同，暂时没有结余。"};
    if (r.afterGoal !== null) {
      if (r.afterGoal < 0) return {title:`离你的储蓄目标还差约 ${budgetMoney(-r.afterGoal)} 元/月`,detail:`支付这些开销后可留 ${budgetMoney(r.balance)} 元；你希望每月存 ${budgetMoney(r.goal)} 元。`};
      if (r.afterGoal === 0) return {title:"付完开销，刚好够你的储蓄目标",detail:`每月存下 ${budgetMoney(r.goal)} 元后，没有额外余量。`};
      return {title:`达到储蓄目标后，还能留约 ${budgetMoney(r.afterGoal)} 元/月`,detail:`已经预留每月 ${budgetMoney(r.goal)} 元储蓄。`};
    }
    return {title:`付完这些开销，每月还能留约 ${budgetMoney(r.balance)} 元`,detail:"可以再设一个储蓄目标，看看计划能否做到。"};
  }
  function verifiedResidentRecord(c, metric) {
    const r = lifeRecords(c).find(r => r.metric === metric);
    return r && checkedValue(r) && r.statistic === "mean" && r.price_basis === "nominal" && r.cross_city_comparability_key && r.metadata_source ? r : null;
  }
  function costReference(c) {
    const r = verifiedResidentRecord(c,"consumption");
    if (!r) return null;
    const peers = D.cities.map(city => ({city,record:verifiedResidentRecord(city,"consumption")})).filter(p => p.record && comparable(r,p.record)).sort((a,b) => a.record.value-b.record.value || a.city.city.localeCompare(b.city.city,"zh"));
    const rank = 1 + peers.filter(p=>p.record.value < r.value).length;
    const ties = peers.filter(p=>p.record.value === r.value).length;
    const place = ties === peers.length ? "消费均值相同" : r.value === peers[0]?.record.value ? `${ties > 1 ? "并列" : ""}最低` : r.value === peers[peers.length-1]?.record.value ? `${ties > 1 ? "并列" : ""}最高` : `${ties > 1 ? "并列" : ""}第${rank}低`;
    const position = peers.length < 2 ? "同口径城市还在补齐" : `${peers.length}座同口径城市里${place}`;
    const income = verifiedResidentRecord(c,"income");
    const sameIncome = income && income.period === r.period && income.population_scope_type === r.population_scope_type && income.methodology_key === r.methodology_key && income.geographic_scope_type === r.geographic_scope_type;
    return {record:r,monthly:r.value/12,peers,rank,position,income:sameIncome ? income : null};
  }
  function referenceMoney(n) { return n > 0 && n < 100 ? "不到100" : numberText(Math.round(n / 100) * 100,0); }
  function costReferenceCard(c) {
    const ref = costReference(c);
    if (!ref) return `<div class="card cost-reference"><h3>${esc(c.city)}一个月的消费水平</h3><p class="cost-headline">整月开支的可比资料还没补齐</p><p>可以先用下面的预算，算自己的生活开销。</p></div>`;
    const r = ref.record;
    return `<div class="card cost-reference"><p class="kicker">${esc(c.city)} · 一个月的消费水平</p><h3 class="cost-headline">每人每月约 <strong>${referenceMoney(ref.monthly)}</strong> 元</h3><p class="cost-position">${esc(ref.position)}</p><p class="small">${esc(r.period)}年 · ${esc(populationLabel(r))}人均消费年数÷12${r.data_status === "preliminary" ? " · 初步数" : ""}。这是统计平均，不是每个人的实际账单。</p>${ref.income ? `<p class="cost-income">同一人群的可支配收入约 <strong>${referenceMoney(ref.income.value/12)}元/人/月</strong>。</p>` : ""}<details class="cost-evidence"><summary>看看参照城市和原始数据</summary><ul class="reference-cities">${ref.peers.map(p=>`<li><span>${esc(p.city.city)}</span><strong>约${referenceMoney(p.record.value/12)}元/人/月</strong></li>`).join("")}</ul><p>只比较上面这些同年、同人口口径城市，按未舍入的年值排序；不是全国排名。居民消费已包括居住、水电等，也可能含自有住房虚拟租金，不与下面的个人预算相加。</p><p>居民收入包含各类居民的收入，不是工资。工资平均数与中位数见生活概况。</p><p>原年消费：${lifeValue(r)}元；除12约${numberText(ref.monthly,0)}元/月。卡片取整到百元，便于看量级。</p>${recordDetails(c,r)}${ref.income ? `<p>原年可支配收入：${lifeValue(ref.income)}元。</p>${recordDetails(c,ref.income)}` : ""}</details></div>`;
  }
  function budgetOutput(b) {
    const r = budgetResult(b), reading = budgetReading(r);
    return `<div class="budget-output ${r.invalid.length || r.balance < 0 || r.afterGoal < 0 ? "budget-attention" : ""}" ><h4>${esc(reading.title)}</h4><p>${esc(reading.detail)}</p>${r.complete ? `<p class="small">整户计划月开支约 ${budgetMoney(r.subtotal)} 元 · ${r.people}人简单均摊约 ${budgetMoney(r.subtotal/r.people)} 元/人</p>` : `<p class="small">空白是待补，不按0算。填齐前不判断生活余量。</p>`}</div>`;
  }
  function budgetInput(key,label,value,hint="") {
    return `<label class="budget-field"><span>${esc(label)}</span><input type="number" min="0" max="10000000" step="0.01" inputmode="decimal" data-budget="${key}" value="${esc(value)}" placeholder="先留空也可以">${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
  }
  function renderBudget(c) {
    const b = cityBudget(c);
    return `<section id="life-budget"><h2>一个月过日子，要花多少？</h2>${costReferenceCard(c)}<details class="card budget-planner"><summary>按我的情况算一算</summary><div class="budget-form"><p>填整户每月的计划金额，马上看还能留下多少。仅在当前页面计算，不保存、不放进分享链接。</p><div class="budget-basics"><label class="budget-field"><span>一起生活的人数</span><input type="number" min="1" max="30" step="1" inputmode="numeric" data-budget="people" value="${esc(b.people)}"></label>${budgetInput("income","整户月可用收入（元）",b.income,"已扣税、代扣社保和公积金后的金额")}${budgetInput("goal","每月想存下（元，可选）",b.goal,"储蓄另算，不放进下面的开销")}</div><div class="budget-modes" role="group" aria-label="预算填写方式"><button class="chip" data-budget-mode="total" aria-pressed="${b.mode === "total"}">直接填月总额</button><button class="chip" data-budget-mode="details" aria-pressed="${b.mode === "details"}">按项目拆开算</button></div>${b.mode === "total" ? budgetInput("total","整户每月计划开支（元）",b.total,"含住房、吃饭、水电、交通、另付社保与其他开销，不含储蓄") : `<p class="small">都是整户金额，不会再乘人数。包费项目选清楚含在哪一项，承接项要填金额；没有此项支出选“不适用”。</p><div class="budget-items">${BUDGET_FIELDS.map(f=>`<div class="budget-item"><label><span>${f.label}</span><input type="number" min="0" max="10000000" step="0.01" inputmode="decimal" data-budget-item="${f.key}" value="${esc(b.amounts[f.key] || "")}" ${b.included[f.key] && b.included[f.key] !== "separate" ? "disabled" : ""} placeholder="${f.annual ? "元/全年" : "元/月"}" aria-label="${f.label}金额"></label><select data-budget-included="${f.key}" aria-label="${f.label}如何计入">${[["separate","单独填写"],...(f.includedIn || []).map(key=>[key,"含在" + ({housing:"住房",power:"电费",gas:"燃气",other:"其他"})[key]]),["none","不适用"]].map(([value,label])=>`<option value="${value}" ${(b.included[f.key] || "separate") === value ? "selected" : ""}>${label}</option>`).join("")}</select><small>${f.hint}</small></div>`).join("")}</div>`}<div id="budget-result" role="status" aria-live="polite">${budgetOutput(b)}</div><button class="btn ghost" data-budget-reset>清空本城预算</button></div></details></section>`;
  }
  function updateBudgetOutput() {
    const c = D.cities.find(c=>c.id === state.residentCity);
    if (c && $("#budget-result")) $("#budget-result").innerHTML = budgetOutput(cityBudget(c));
  }
  function rerenderBudget(focusSelector) {
    const c = D.cities.find(c=>c.id === state.residentCity);
    if (!c) return;
    const open = $(".budget-planner")?.open;
    const section = $("#life-budget");
    section.outerHTML = renderBudget(c);
    $(".budget-planner").open = open;
    $(focusSelector)?.focus();
  }

  function comparisonCard(a, b, row) {
    const labels = {rent:"租房单价", housing_new_yoy_index:"新房价格变化", income:"居民可支配收入", consumption:"居民消费支出", wage_nonprivate_mean:"非私营单位工资", wage_private_mean:"私营单位工资", wage_median:"工资中位数", life_expectancy:"出生时预期寿命"};
    const statuses = {ready:"同口径可比", reference:"仅分别参考", missing:"数据待补"};
    const {r, s} = row;
    const values = [[a,r],[b,s]];
    return `<article class="card comparison-card" data-metric="${esc(row.metric)}" data-comparable="${row.canCompare}"><header class="comparison-heading"><h3>${esc(labels[row.metric] || r.label)}</h3><span class="comparison-status ${row.state}">${statuses[row.state]}</span></header><div class="comparison-values">${values.map(([city, record], i) => `<section class="comparison-city city-side-${i}" aria-label="${esc(city.city)}${esc(record.label)}"><h4>${esc(city.city)}</h4><p class="comparison-number${checkedValue(record) ? "" : " missing"}">${esc(comparisonNumber(record))}</p><p class="comparison-unit">${esc(comparisonUnit(record))}</p><p class="comparison-period">${esc(record.period || "期间未提供")}${record.data_status === "preliminary" ? " · 初步数" : ""}</p>${populationLabel(record) ? `<p class="comparison-scope">${esc(populationLabel(record))}</p>` : ""}${yoyChange(record) !== null ? `<p class="comparison-original">原始指数 ${lifeValue(record)}</p>` : ""}<p class="comparison-source">${checkedValue(record) ? esc(sourceFor(city,record).publisher || (record.metric === "rent" ? city.living?.rent_source : "") || "原文见下方") : esc(LIFE_STATUS[record.review_status] || "尚未覆盖")}</p></section>`).join("")}</div><p class="comparison-reason">${esc(row.reason)}</p>${row.metric === "housing_new_yoy_index" ? '<p class="comparison-tip">100代表去年同月水平。比较的是涨跌幅，不能判断哪城房价更便宜，也不是环比。</p>' : ""}<details class="comparison-details"><summary>查看解释、限制与两城来源</summary>${values.map(([city,record])=>`<div class="comparison-evidence"><h4>${esc(city.city)} · ${esc(record.label)}</h4><p>原始数值：${lifeValue(record)} ${esc(record.unit || "")} · ${esc(record.period || "期间未提供")}</p><p>${esc(metricGuide(record).meaning)}</p>${!checkedValue(record) ? `<p class="note">${esc(record.missing_reason || "尚无已核实数值")}</p>` : ""}${explanationDetails(record)}${recordDetails(city,record)}</div>`).join("")}</details></article>`;
  }
  function renderCompare() {
    const a = D.cities.find(c=>c.id===state.compareA), b = D.cities.find(c=>c.id===state.compareB);
    const rows = a && b && a !== b ? comparisonRows(a, b) : [];
    const count = state => rows.filter(r => r.state === state).length;
    if (!$("#compare-a")) {
      $("#tab-compare").innerHTML = `<h2>两座城市，放在一起看</h2><p class="sub">先看租房、收入与生活数据，再判断什么对你重要。不把不同年份、不同人群硬凑成排名。</p><div class="card compare-pickers"><label>第一座城市<select id="compare-a">${cityOptions("")}</select></label><label>第二座城市<select id="compare-b">${cityOptions("")}</select></label></div><div id="compare-results" class="panel-content"></div>`;
    }
    if ($("#compare-a").value !== state.compareA) $("#compare-a").value = state.compareA;
    if ($("#compare-b").value !== state.compareB) $("#compare-b").value = state.compareB;
    $("#compare-results").innerHTML = `${a && b ? a===b ? '<p class="note">请选择两座不同的城市。</p>' : `<div class="compare-coverage" aria-label="数据可比性"><strong>${rows.length}个维度</strong><span>${count("ready")}项同口径可比</span><span>${count("reference")}项仅分别参考</span><span>${count("missing")}项数据待补</span></div><p class="small">所有维度都列出来。灰色“暂无”不是0，标注“仅分别参考”的项目不比较高低。</p><div class="row compare-city-links"><a class="btn ghost" href="#resident&city=${encodeURIComponent(a.id)}">${esc(a.city)}生活页 →</a><a class="btn ghost" href="#resident&city=${encodeURIComponent(b.id)}">${esc(b.city)}生活页 →</a></div><div class="comparison-grid">${rows.map(row=>comparisonCard(a,b,row)).join("")}</div>` : '<p class="note">选择两座城市，即可查看已覆盖、不可比和待补的生活维度。</p>'}<div class="card"><h3>还想按自己的偏好排序？</h3><p>日子指数使用本科落户、补贴和灵活就业等特定条件，是相对分，不是适用于所有居民的城市总分。</p><div class="row"><a href="#index">日子指数与权重 →</a><a href="#grad">应届生 →</a><a href="#civil">考公考编 →</a><a href="#free">自由职业 →</a></div><p>${link(METHOD_URL,"了解指数方法")}</p></div>`;
  }

  // ---------- 日子指数 ----------
  function rawNum(c, m) {
    const v = c.index[m.key];
    if (!v || !v.ok) return null;
    return m.key === "hukou" ? TIER_SCORE[v.value] : v.value;
  }
  function computeIndex() {
    const rows = D.cities.map((c) => ({ c, miss: ACTIVE.filter((m) => !c.index[m.key].ok) }));
    const ranked = rows.filter((r) => r.miss.length <= 1);
    const pending = rows.filter((r) => r.miss.length > 1);
    const range = {};
    for (const m of ACTIVE) {
      const vals = ranked.map((r) => rawNum(r.c, m)).filter((v) => v != null);
      range[m.key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    for (const r of ranked) {
      r.scores = {};
      let sw = 0, s = 0;
      for (const m of ACTIVE) {
        const v = rawNum(r.c, m);
        if (v == null) continue;
        const { min, max } = range[m.key];
        const sc = max === min ? 100 : (m.dir < 0 ? (max - v) / (max - min) : (v - min) / (max - min)) * 100;
        r.scores[m.key] = sc;
        const w = state.w[m.key] || 0;
        sw += w; s += w * sc;
      }
      r.total = sw > 0 ? s / sw : null;
    }
    ranked.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.c.city.localeCompare(b.c.city, "zh"));
    ranked.forEach((r, i) => (r.rank = i + 1));
    return { ranked, pending };
  }
  const weightText = () => ACTIVE.map((m) => `${m.short}×${state.w[m.key]}`).join("  ");

  function indexRawValue(city, metric) {
    const input = city.index[metric.key];
    if (!input?.ok) return "缺已核实数据";
    if (metric.key === "hukou") return TIER_LABEL[input.value] || "口径未确认";
    if (!Number.isFinite(input.value)) return "缺已核实数据";
    if (metric.key === "subsidy") return `${numberText(input.value)}元`;
    return `${numberText(input.value * 100)}%`;
  }
  function indexLifeReading(c) {
    const ref = costReference(c);
    return ref ? `居民月均消费约 <strong>${referenceMoney(ref.monthly)}元/人</strong>，${esc(ref.position)}。<br><span class="small">${esc(ref.record.period)}年 · ${esc(populationLabel(ref.record))}</span> <a href="#resident&city=${encodeURIComponent(c.id)}">算我的月开支 →</a>` : `整月开支的可比资料还在补齐。<a href="#resident&city=${encodeURIComponent(c.id)}">先算我的月开支 →</a>`;
  }
  function renderIndex() {
    const el = $("#tab-index");
    const sumW = ACTIVE.reduce((a, m) => a + state.w[m.key], 0);
    const { ranked, pending } = computeIndex();
    const presetOn = (p) => ACTIVE.every((m) => p.w[m.key] === state.w[m.key]);
    el.innerHTML = `
      <div>
        <h2>日子指数：哪座城市更好过日子？</h2>
        <p class="sub">按你在乎的${ACTIVE.length}件事，把当前可排名的城市放在一起比。分数越高，只表示在这套条件和权重下更靠前。</p>
      </div>
      <div class="card index-guide">
        <h3>先看月开支，再看偏好排名</h3><p>每座城的消费量级放在分数旁边。选中城市，还能按自己的开销算每月结余。</p><details><summary>80分是什么意思？</summary>
        <p>是当前${ranked.length}座入榜城市之间的相对分，不是幸福概率，也不是城市综合体检。0分不等于差，100分不等于完美。</p>
        <p class="small">主要面向本科落户、补贴与灵活就业等特定条件；城市、数据或权重变了，分数也会变。</p>
        <details><summary>看一个算分例子</summary><p>示意，不是城市数据：假设房租负担最低20%、最高40%，某城25%，这一项得75分。表示它在这组城市中相对靠前，不是房租便宜75%。</p><p>权重0：这一项不计入总分；有数据的项目中，3按三份、1按一份参与加权。缺1项按其余有数据项目重新加权；是否入榜仍按全部启用项目的数据完整性判断。</p></details></details>
      </div>
      <div class="card">
        <p class="small">滑块越大，这件事在你的总分里占得越重；0表示不计入总分。</p>
        <div class="row">${PRESETS.map((p, i) => `<button class="chip" data-preset="${i}" aria-pressed="${presetOn(p)}">${esc(p.name)}</button>`).join("")}</div>
        <div class="weights">
          ${METRICS.map((m) => m.off
            ? `<div class="w-row off"><span>${m.label}</span><span class="tiny">${m.how}</span><output>—</output></div>`
            : `<label class="w-row"><span>${m.label}</span><input type="range" min="0" max="5" step="1" value="${state.w[m.key]}" data-w="${m.key}" aria-label="${m.label}权重"><output>${state.w[m.key]}</output></label>`).join("")}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-share="top5">生成我的 Top 5 分享图</button>
          <button class="btn ghost" data-copy>复制带权重的链接</button>
        </div>
      </div>
      ${sumW === 0 ? `<p class="note">权重全是 0，没法排名。至少给一项加点分吧。</p>` : `
      <ol class="rank">
        ${ranked.map((r) => `
          <li>
            <div class="rank-head"><span class="rank-no">${r.rank}</span><a class="rank-name" href="#resident&city=${encodeURIComponent(r.c.id)}">${esc(r.c.city)}</a><span class="rank-score">${r.total == null ? "—" : r.total.toFixed(0)}</span></div>
            <div class="bar"><i style="width:${(r.total || 0).toFixed(1)}%"></i></div><p class="rank-life">${indexLifeReading(r.c)}</p>
            <div class="parts">
              ${ACTIVE.map((m) => r.scores[m.key] == null
                ? `<span class="miss" title="${esc(r.c.index[m.key].reason)}">${m.short} ⚠️缺</span>`
                : `<span title="${esc(m.how)}">${m.short} <b>${r.scores[m.key].toFixed(0)}</b></span>`).join("")}
            </div>
            <details class="rank-explanation"><summary>看原始数据和分数</summary><ul>${ACTIVE.map(m => `<li><strong>${esc(m.label)}</strong>：${esc(indexRawValue(r.c, m))}${r.scores[m.key] == null ? "，本项不计分" : ` → 本项相对分${r.scores[m.key].toFixed(0)}`}<br><span class="small">${esc(m.how)}</span></li>`).join("")}</ul></details>
            ${r.miss.length ? `<div class="parts tiny" style="margin-top:4px">⚠️ ${esc(r.miss[0].label)}：${esc(r.c.index[r.miss[0].key].reason)}（这一项不计分，按其余几项加权）</div>` : ""}
          </li>`).join("")}
      </ol>`}
      <div class="card">
        <h3>我的城市排第几？</h3>
        <div class="row">
          <select id="my-city" aria-label="选择城市">
            <option value="">选一座城市</option>
            ${D.cities.map((c) => `<option value="${esc(c.id)}" ${state.myCity === c.id ? "selected" : ""}>${esc(c.city)}</option>`).join("")}
          </select>
          <button class="btn" data-share="mycity">生成分享图</button>
        </div>
      </div>
      <div class="card">
        <h3>数据收集中（${pending.length} 座）</h3>
        <p class="small">缺 2 项及以上已核实数据的城市暂不排名。缺的多半是官网打不开、原文是图片，或者政策刚换版。你的 agent 闲着的话，<a href="${REPO}/blob/main/agent/patrol.md" target="_blank" rel="noopener">让它来巡检</a>。</p>
        <ul class="src">
          ${pending.map((r) => `<li><span class="lbl">${esc(r.c.city)}</span> <a href="${esc(claimUrl(r.c))}" target="_blank" rel="noopener">认领</a><br><span class="d">${r.miss.map((m) => `${m.label}：${esc(r.c.index[m.key].reason)}`).join("；")}</span></li>`).join("")}
        </ul>
      </div>
      <p class="note calm">日子指数仅反映公开数据，不代表城市好坏，欢迎<a href="${REPO}/issues/new?template=data-error.yml&title=${encodeURIComponent("日子指数权重讨论")}" target="_blank" rel="noopener">提 Issue 讨论权重</a>。通勤指标暂停用；每项公式和来源见<a href="${METHOD_URL}" target="_blank" rel="noopener">算法说明</a>（${esc(D.index_version)}）。</p>`;
  }

  // ---------- 应届生 ----------
  function gradRow(c) {
    const b = c.by_degree[state.deg];
    const h = c.hukou || {};
    const once = b.counted.filter((x) => x.period === "once").reduce((a, x) => a + x.total, 0);
    const rentYear = b.counted.filter((x) => x.type === "rent" && x.period !== "once")
      .reduce((a, x) => a + (x.period === "month" ? x.per * 12 : x.per), 0);
    let hk; // {cls, text, rank}
    const hs = c.status.hukou;
    const elig = b.hukou_eligible;
    const amax = b.hukou_age_max;
    const tier = (h.tier_by_degree || {})[state.deg];
    if (hs !== "verified") hk = { cls: "b-warn", text: hs === "blocked" ? "🔒 官网打不开" : "⚠️ 待核实", rank: 9 };
    else if (elig === false) hk = { cls: "b-bad", text: "不能落户", rank: 8 };
    else if (elig == null) hk = { cls: "b-warn", text: "⚠️ 不确定", rank: 7 };
    else if (state.age && amax && state.age > amax) hk = { cls: "b-bad", text: `超龄（原文 ${amax} 周岁）`, rank: 8 };
    else if (state.age && amax && state.age === amax) hk = { cls: "b-warn", text: `卡在 ${amax} 周岁，看原文`, rank: 6 };
    else hk = { cls: "b-good", text: "能落户" + (tier ? "·" + TIER_LABEL[tier] : ""), rank: tier ? 2 - TIER_SCORE[tier] : 3 };
    const ss = c.social_security || {};
    return { c, b, once, rentYear, hk, rent30: c.floor.rent, ssMin: ss.base_min, ssOk: c.status.social_security === "verified" };
  }
  function sortedGrad() {
    const rows = D.cities.map(gradRow);
    const by = {
      money: (a, b) => b.b.total - a.b.total || a.b.excluded.length - b.b.excluded.length,
      hukou: (a, b) => a.hk.rank - b.hk.rank || b.b.total - a.b.total,
      rent: (a, b) => (a.rent30 ?? 1e9) - (b.rent30 ?? 1e9),
    }[state.gradSort];
    return rows.sort((a, b) => by(a, b) || a.c.city.localeCompare(b.c.city, "zh"));
  }
  function subsidySources(c, deg) {
    const b = c.by_degree[deg];
    const subs = c.subsidies || [];
    const out = [];
    for (const it of b.counted) {
      const s = subs[it.index] || {};
      out.push(`<li><span class="lbl">✅ ${esc(it.name)}</span>：${money(it.per)} 元${it.period === "once" ? "（一次性）" : it.period === "year" ? "/年" : "/月"}${it.period !== "once" ? `，按原文上限合计 ${money(it.total)} 元` : ""}<br>
        <span class="d">${esc(s.amount || "")}${s.deadline_rule ? "｜申请时限：" + esc(s.deadline_rule) : ""}</span><br>
        <span class="d">${esc(s.policy_name || "")} ${link(s.source_url)} · ${verifiedLine(s)}${s.valid_until ? " · 有效期至 " + esc(s.valid_until) : ""}</span></li>`);
    }
    for (const it of b.excluded) {
      const s = subs[it.index] || {};
      out.push(`<li><span class="lbl">⚠️ ${esc(it.name)}（未计入）</span>${it.per != null ? `：原文 ${money(it.per)} 元` : ""}<br>
        <span class="d">没算进合计的原因：${esc(it.reason)}</span>${s.source_url ? `<br><span class="d">${link(s.source_url)}</span>` : s.lead_url ? `<br><span class="d">线索（非官方）：${link(s.lead_url, "来源")}</span>` : ""}</li>`);
    }
    const scan = c.subsidy_scan || {};
    if (c.status.living_subsidy === "none" || c.status.rent_subsidy === "none") {
      const what = [c.status.living_subsidy === "none" && "生活补贴", c.status.rent_subsidy === "none" && "租房补贴"].filter(Boolean).join("、");
      out.push(`<li><span class="lbl">✅ 已核实：无市级现金${what}</span><br><span class="d">${esc(scan.basis || "")} ${link(scan.source_url, "依据")} · ${verifiedLine(scan)}</span><br><span class="d">区级、限行业或限专业的补贴不算在内。</span></li>`);
    }
    return out.join("");
  }
  function cityDetails(c, deg) {
    const h = c.hukou || {}, lv = c.living || {}, ss = c.social_security || {};
    const items = [];
    items.push(`<li><span class="lbl">落户</span>：${esc(h.summary || "待核实")}${h.age_limit ? `<br><span class="d">年龄：${esc(h.age_limit)}</span>` : ""}${(h.conditions || []).length ? `<br><span class="d">${h.conditions.map(esc).join("；")}</span>` : ""}
      <br><span class="d">${esc(h.policy_name || "")} ${link(h.source_url)} · ${verifiedLine(h)}${h.valid_until ? " · 有效期至 " + esc(h.valid_until) : ""}${h.needs_human ? " · ⚠️ " + esc(h.needs_human_reason || "待人工核实") : ""}</span></li>`);
    items.push(subsidySources(c, deg));
    if (lv.rent_avg_per_sqm != null) items.push(`<li><span class="lbl">房租</span>：${lv.rent_avg_per_sqm} 元/㎡/月，30㎡ 单间约 ${money(c.floor.rent)} 元/月<br><span class="d">${esc(lv.rent_source || "")}（${esc(lv.rent_period || "")}）${link(lv.rent_source_url, "来源")} · ${verifiedLine(lv)}</span></li>`);
    if (ss.base_min != null) items.push(`<li><span class="lbl">${c.status.social_security === "verified" ? "" : "⚠️ "}职工社保缴费基数</span>：${money(ss.base_min)}–${money(ss.base_max)} 元/月（${esc(ss.year || "")}，${esc(ss.scope || "")}）<br><span class="d">${link(ss.source_url, "来源")} · ${verifiedLine(ss)}${ss.needs_human ? " · ⚠️ " + esc(ss.needs_human_reason || "") : ""}</span></li>`);
    else items.push(`<li><span class="lbl">⚠️ 职工社保缴费基数</span>：${esc(ss.needs_human_reason || "未找到官方原文")}</li>`);
    for (const p of c.pitfalls || []) if (p && p.text) items.push(`<li><span class="lbl">坑</span>：${esc(p.text)} ${link(p.source_url, "依据")}</li>`);
    items.push(`<li class="d">这座城市的全部数据：${link(yamlUrl(c), c.id + ".yaml")} · 发现不对？<a href="${REPO}/issues/new?template=data-error.yml&title=${encodeURIComponent("数据有误：" + c.city)}" target="_blank" rel="noopener">告诉我们</a></li>`);
    return `<ul class="src">${items.join("")}</ul>`;
  }
  function renderGrad() {
    const el = $("#tab-grad");
    const rows = sortedGrad();
    el.innerHTML = `
      <div>
        <h2>我是应届生：去哪、能落户吗、能领多少？</h2>
        <p class="sub">「能领」只合计有官方原文、已核验、未过期的市级现金补贴，按原文上限算。⚠️ 项单独列出，不算进去。</p>
      </div>
      <div class="card">
        <div class="row">
          <div class="seg" role="group" aria-label="学历">${DEG_KEYS.map((k) => `<button data-deg="${k}" aria-pressed="${state.deg === k}">${DEG[k]}</button>`).join("")}</div>
          <label class="inline">年龄 <input type="number" id="age" min="16" max="60" inputmode="numeric" placeholder="可选" value="${state.age ?? ""}" style="width:76px"></label>
        </div>
        <div class="row" style="margin-top:10px">
          <span class="small">排序</span>
          ${[["money", "最能领钱"], ["hukou", "落户最容易"], ["rent", "房租最低"]].map(([k, t]) => `<button class="chip" data-gsort="${k}" aria-pressed="${state.gradSort === k}">${t}</button>`).join("")}
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" data-share="grad">生成分享图：我是${DEG[state.deg]}，能领多少</button></div>
      </div>
      <div class="cities">
        ${rows.map((r) => `
          <details class="city">
            <summary>
              <div class="city-top">
                <span class="city-name">${esc(r.c.city)} <span class="badge ${r.hk.cls}">${esc(r.hk.text)}</span></span>
                <span class="city-total">${r.b.counted.length ? money(r.b.total) : "0"}<small> 元${r.b.excluded.some((x) => x.type === "living" || x.type === "rent") ? " ⚠️" : ""}</small></span>
              </div>
              <dl class="kv">
                <div><dt>一次性补贴</dt><dd>${r.once ? money(r.once) : "—"}</dd></div>
                <div><dt>每年租房补贴</dt><dd>${r.rentYear ? money(r.rentYear) : "—"}</dd></div>
                <div><dt>单间房租/月</dt><dd>${r.rent30 == null ? "—" : money(r.rent30)}</dd></div>
                <div><dt>社保基数下限</dt><dd>${r.ssMin == null ? "—" : money(r.ssMin) + (r.ssOk ? "" : " ⚠️")}</dd></div>
                <div style="grid-column: span 2"><dt>补贴情况</dt><dd style="font-weight:400;font-size:13px">${gradNote(r)}</dd></div>
              </dl>
              <div class="more">点开看每个数字的来源和核验日期 ↓</div>
            </summary>
            <div class="city-body">${cityDetails(r.c, state.deg)}</div>
          </details>`).join("")}
      </div>
      <p class="tiny">补贴往往还有年龄、户籍、社保月数、申请时限等条件，点开看原文口径。单间房租 = 每平米月租 × 30㎡。</p>`;
  }
  function gradNote(r) {
    const ex = r.b.excluded.filter((x) => x.type === "living" || x.type === "rent").length;
    const st = r.c.status;
    if (r.b.counted.length) return ex ? `已计入 ${r.b.counted.length} 项，另有 ${ex} 项待核实` : `已计入 ${r.b.counted.length} 项`;
    if (st.living_subsidy === "none" && st.rent_subsidy === "none") return "✅ 已核实：无市级现金补贴";
    if (ex) return `⚠️ ${ex} 项待核实，暂不计入`;
    if (st.rent_subsidy === "verified" || st.living_subsidy === "verified") return "有补贴但金额无法取单一值（如按区分档），见详情";
    return "⚠️ 还没查清";
  }

  // ---------- 考公考编 ----------
  function civilVerdict() {
    const fg = D.national.civil_service.fresh_grad;
    const s = state.civil;
    const cur = fg.current_class, years = fg.choose_job_years;
    if (!s.year) return null;
    const y = Number(s.year);
    if (y >= cur) return { cls: "yes", head: "你就是这次国考的应届生", why: `本次国考面向 ${cur} 届毕业生，学历学位取得时间一般截止到 ${cur} 年 7 月。` };
    if (!years.includes(y)) {
      if (s.project) return { cls: "maybe", head: "可能还能报应届岗", why: `已过两年择业期，但原文规定：${fg.grassroots_project}。` };
      return { cls: "no", head: "按国家规则，大概率不算应届了", why: `国家规定择业期为两年，本次国考只把 ${years.join("、")} 届未落实工作单位的毕业生按应届对待。参加过服务基层项目的情况另有规定，可勾选上面的选项再看。` };
    }
    if (!s.contract || !s.social || !s.files) return { cls: "maybe", head: "再回答几个问题", why: "把上面的问题答完，才能对照原文判断。" };
    if (s.contract === "yes" || s.files === "unit")
      return { cls: "no", head: "大概率不算应届", why: "原文的标准是「离校时和择业期内未落实工作单位」，并且户口、档案、组织关系还在学校或人才、就业服务机构。签过劳动合同，或档案已经转到单位，通常意味着已经落实了工作单位。" };
    if (s.files === "unknown")
      return { cls: "maybe", head: "先去确认档案在哪", why: "原文要求户口、档案、组织关系保留在原毕业学校或各级毕业生就业主管部门、人才交流服务机构、公共就业服务机构。档案去向会直接影响认定，先查清楚。" };
    if (s.social === "yes")
      return { cls: "maybe", head: "说不准，以招考公告为准", why: fg.social_security_note + " 没签劳动合同、档案也在学校或人才机构，按原文条件看是符合的，但社保记录可能在资格审查时被问到。" };
    return { cls: "yes", head: "按国家规则，你大概率还算应届", why: "没签劳动合同、没缴职工社保、档案在学校或人才机构，符合原文「未落实工作单位」的条件。" };
  }
  const civilHasFacts = (cs) => Boolean(cs && (cs.fresh_grad_rule || cs.exam_schedule || cs.treatment));
  function civilCity(c) {
    const cs = c.civil_service || {};
    const facts = civilHasFacts(cs);
    const pending = cs.needs_human || cs.access_blocked || !cs.verified_at;
    const row = (label, value) => `<li><span class="lbl">${label}</span><br>${esc(value || "尚未核实，不代表没有相关政策或公告。")}</li>`;
    return `<details class="city" data-civil-city="${esc(c.id)}"><summary>
      <div class="city-top"><span class="city-name">${esc(c.city)}</span><span class="badge ${pending || !facts ? "b-warn" : "b-good"}">${!facts ? "待采集" : pending ? "已收录 · 部分待核实" : "已收录"}</span></div>
      <p class="small">${verifiedLine(cs)} · 应届口径${cs.fresh_grad_rule ? "已收录" : "待核实"} · 考试安排${cs.exam_schedule ? "已收录" : "待核实"}</p>
      <div class="more">展开看批次、适用范围和官方来源 ↓</div>
      </summary><div class="city-body" style="overflow-wrap:anywhere">
      <ul class="src">
        ${row("应届认定（按各考试、各批次原文）", cs.fresh_grad_rule)}
        ${row("考试安排（含历史批次，不代表正在报名）", cs.exam_schedule)}
        ${cs.treatment ? row("待遇（仅限原文适用范围）", cs.treatment) : ""}
        <li>${cs.announcement_url ? link(cs.announcement_url, "招考公告") : "公告链接待核实"}${cs.source_url ? " · " + link(cs.source_url, "规则原文 / 来源") : ""}<br><span class="d">${verifiedLine(cs)}；核验日期不是报名截止日期。</span></li>
        ${cs.needs_human || cs.needs_human_reason ? row("⚠️ 待人工核实", cs.needs_human_reason || "仍有内容需要人工核实。") : ""}
        ${cs.access_blocked ? "<li>🔒 部分官网访问受限；只展示已收录内容，不能据此判断公告未发布。</li>" : ""}
        <li>${link(yamlUrl(c), "查看这座城市的数据记录")}</li>
      </ul></div></details>`;
  }
  function renderCivil() {
    const el = $("#tab-civil");
    const cs = D.national.civil_service;
    const fg = cs.fresh_grad;
    const s = state.civil;
    const v = civilVerdict();
    const opt = (k, val, text) => `<button class="chip" data-civil="${k}" data-val="${val}" aria-pressed="${s[k] === val}">${text}</button>`;
    const prev = fg.choose_job_years;
    el.innerHTML = `
      <div>
        <h2>我还算应届生吗？</h2>
        <p class="sub">对照${esc(cs.exam)}的报考指南原文自查。只是帮你读原文，<strong>最终以具体招考公告和招录机关资格审查为准</strong>。</p>
      </div>
      <div class="card">
        <div class="q"><span>1. 你是哪一届毕业的？</span><div class="row">
          ${opt("year", String(fg.current_class), `${fg.current_class} 届（该批次应届）`)}
          ${prev.slice().reverse().map((y) => opt("year", String(y), `${y} 届`)).join("")}
          ${opt("year", String(Math.min(...prev) - 1), `${Math.min(...prev) - 1} 届或更早`)}
        </div></div>
        ${s.year && prev.includes(Number(s.year)) ? `
        <div class="q"><span>2. 毕业后签过劳动合同吗？</span><div class="row">${opt("contract", "yes", "签过")}${opt("contract", "no", "没签过")}</div></div>
        <div class="q"><span>3. 毕业后缴过职工社保吗？</span><div class="row">${opt("social", "yes", "缴过")}${opt("social", "no", "没缴过")}</div></div>
        <div class="q"><span>4. 户口、档案、组织关系现在在哪？</span><div class="row">${opt("files", "school", "学校或人才、就业服务机构")}${opt("files", "unit", "工作单位")}${opt("files", "unknown", "不清楚")}</div></div>` : ""}
        ${s.year && Number(s.year) < Math.min(...prev) ? `
        <label class="inline" style="margin-top:10px"><input type="checkbox" id="civil-project" ${s.project ? "checked" : ""}> 参加过三支一扶、西部计划等服务基层项目，且服务期满考核合格（参加前没有工作经历）</label>` : ""}
      </div>
      ${v ? `<div class="verdict ${v.cls}"><strong>${esc(v.head)}</strong><span class="small">${esc(v.why)}</span></div>` : ""}
      <div class="card">
        <h3>官方依据</h3>
        <blockquote>国家统一招生的普通高校毕业生离校时和在择业期内（国家规定择业期为二年）未落实工作单位，其户口、档案、组织关系仍保留在原毕业学校，或者保留在各级毕业生就业主管部门（毕业生就业指导服务中心）、各级人才交流服务机构和各级公共就业服务机构的毕业生，可按应届高校毕业生对待。</blockquote>
        <ul class="src">
          <li>来源：${link(cs.source_url, cs.source_title)} · 核验 ${esc(cs.verified_at)}</li>
          <li><span class="lbl">社保</span>：${esc(fg.social_security_note)}</li>
          <li><span class="lbl">服务基层项目</span>：${esc(fg.grassroots_project)}</li>
          <li><span class="lbl">留学回国</span>：${esc(fg.returnee)}</li>
          <li><span class="lbl">截止时间</span>：${esc(fg.qualification_deadline)}</li>
        </ul>
      </div>
      <p class="note">⚠️ 这是国考口径。各省省考、事业单位招聘对应届的认定可能不同（比如有的省明确写了社保怎么算），<strong>以招考公告为准</strong>。</p>
      <div class="card">
        <h3>各城市考试安排与应届口径</h3>
        <p class="small">已收录 ${D.cities.filter((c) => civilHasFacts(c.civil_service)).length} / ${D.cities.length} 座城市的部分信息；应届口径 ${D.cities.filter((c) => c.civil_service?.fresh_grad_rule).length} 座，考试安排 ${D.cities.filter((c) => c.civil_service?.exam_schedule).length} 座。收录不等于全部核实或当前可报名。</p>
        <p class="note">国考、省考（含直辖市市考）和事业单位招聘分别适用各自公告，不能互相套用。以下保留原文的年份与适用范围；历史批次不是可报名机会，缴费、准考证打印和笔试日期也不是报名窗口。缺失信息不等于没有政策或公告。</p>
      </div>
      <div class="cities">${D.cities.map(civilCity).join("")}</div>`;
  }

  // ---------- 自由职业 ----------
  function nonlocalBadge(fe) {
    if (fe.nonlocal_allowed === true) return `<span class="badge b-good">外地户籍可交</span>`;
    if (fe.nonlocal_allowed === false) return `<span class="badge b-bad">限本地户籍</span>`;
    return `<span class="badge b-warn">外地户籍？待核实</span>`;
  }
  function freeDetails(c) {
    const fe = c.flexible_employment || {}, lv = c.living || {};
    const items = [];
    if (fe.monthly_total_min != null) items.push(`<li><span class="lbl">${c.floor.social == null ? "⚠️ " : ""}每月最少自缴</span>：${money(fe.monthly_total_min)} 元<br><span class="d">算法：${esc(fe.calc || "")}</span></li>`);
    if (fe.pension_base_min != null) items.push(`<li><span class="lbl">养老</span>：基数下限 ${money(fe.pension_base_min)} 元/月 × ${esc(fe.pension_rate)}%（${esc(fe.pension_year || "")}）${fe.pension_note ? `<br><span class="d">${esc(fe.pension_note)}</span>` : ""}<br><span class="d">${link(fe.source_url, "来源")}${fe.pension_base_source_url ? ` · ${link(fe.pension_base_source_url, "基数依据")}` : ""} · ${verifiedLine(fe)}</span></li>`);
    if (fe.medical_monthly_min != null || fe.medical_note) items.push(`<li><span class="lbl">医保</span>：${fe.medical_monthly_min != null ? money(fe.medical_monthly_min) + " 元/月" : ""}${fe.medical_note ? `<br><span class="d">${esc(fe.medical_note)}</span>` : ""}${fe.medical_source_url ? `<br><span class="d">${link(fe.medical_source_url, "来源")}</span>` : ""}</li>`);
    if (fe.hukou_restriction) items.push(`<li><span class="lbl">户籍限制</span>：${esc(fe.hukou_restriction)} ${link(fe.hukou_source_url || fe.source_url, "依据")}</li>`);
    if (fe.apply_channel) items.push(`<li><span class="lbl">去哪办</span>：${esc(fe.apply_channel)}</li>`);
    if (lv.rent_avg_per_sqm != null) items.push(`<li><span class="lbl">房租</span>：${lv.rent_avg_per_sqm} 元/㎡/月 × 30㎡ ≈ ${money(c.floor.rent)} 元/月<br><span class="d">${esc(lv.rent_source || "")}（${esc(lv.rent_period || "")}）${link(lv.rent_source_url, "来源")}</span></li>`);
    if (fe.needs_human) items.push(`<li><span class="lbl">⚠️ 待核实</span>：${esc(fe.needs_human_reason || "")}</li>`);
    items.push(`<li class="d">${link(yamlUrl(c), c.id + ".yaml")}</li>`);
    return `<ul class="src">${items.join("")}</ul>`;
  }
  function renderFree() {
    const el = $("#tab-free");
    const ok = D.cities.filter((c) => c.floor.social != null);
    const rest = D.cities.filter((c) => c.floor.social == null);
    const key = state.freeSort === "social" ? (c) => c.floor.social : (c) => c.floor.total ?? 1e9;
    ok.sort((a, b) => key(a) - key(b));
    rest.sort((a, b) => (a.flexible_employment?.monthly_total_min == null) - (b.flexible_employment?.monthly_total_min == null) || a.city.localeCompare(b.city, "zh"));
    const card = (c, i) => {
      const fe = c.flexible_employment || {};
      return `<details class="city"><summary>
        <div class="city-top"><span class="city-name">${i != null ? `<span class="rank-no">${i + 1}</span> ` : ""}${esc(c.city)} ${nonlocalBadge(fe)}</span>
          <span class="city-total">${c.floor.social != null ? money(c.floor.social) : "—"}<small> 元/月</small></span></div>
        <dl class="kv">
          <div><dt>最少自缴社保</dt><dd>${c.floor.social != null ? money(c.floor.social) : fe.monthly_total_min != null ? money(fe.monthly_total_min) + " ⚠️" : "⚠️ 待核实"}</dd></div>
          <div><dt>单间房租</dt><dd>${c.floor.rent == null ? "—" : money(c.floor.rent)}</dd></div>
          <div><dt>每月底线成本</dt><dd>${c.floor.total == null ? "—" : money(c.floor.total)}</dd></div>
        </dl>
        <div class="more">点开看算法和来源 ↓</div>
      </summary><div class="city-body">${freeDetails(c)}</div></details>`;
    };
    el.innerHTML = `
      <div>
        <h2>自己交社保，每月最少多少？</h2>
        <p class="sub">按灵活就业人员的最低档算：职工养老（基数下限 × 个人比例）+ 职工医保最低月缴。</p>
      </div>
      <p class="note calm"><strong>每月生活底线成本 = 最少自缴社保 + 单间房租</strong>（每平米月租 × 30㎡）。不含吃饭、交通和其他开销，只是一个"最少要准备多少"的参考。⚠️ 未核实的数字不计入。</p>
      <div class="row"><span class="small">排序</span>
        ${[["social", "社保最少"], ["floor", "底线成本最低"]].map(([k, t]) => `<button class="chip" data-fsort="${k}" aria-pressed="${state.freeSort === k}">${t}</button>`).join("")}
      </div>
      <div class="cities">${ok.map((c, i) => card(c, i)).join("")}</div>
      <h3 style="margin-top:22px">⚠️ 还没算出来的城市（${rest.length} 座）</h3>
      <p class="small">多半是医保月缴额没找到官方原文，或者官方页面是图片读不出来。这些城市不进排行。</p>
      <div class="cities">${rest.map((c) => card(c, null)).join("")}</div>`;
  }

  // ---------- 分享图（竖版 3:4，1080×1440） ----------
  const W = 1080, H = 1440;
  function wrapText(ctx, text, x, y, maxW, lh) {
    let line = "";
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = ch; } else line += ch;
    }
    if (line) ctx.fillText(line, x, y);
    return y + lh;
  }
  function baseCanvas(title, subtitle) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const F = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = "#f7f1e6"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#d9653b"; ctx.beginPath(); ctx.arc(W - 90, 110, 210, 0, Math.PI * 2); ctx.globalAlpha = .12; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#d9653b"; ctx.font = `600 34px ${F}`; ctx.fillText("日子人城市指南", 80, 120);
    ctx.fillStyle = "#2b2620"; ctx.font = `700 64px ${F}`;
    let y = wrapText(ctx, title, 80, 215, W - 160, 82);
    if (subtitle) { ctx.fillStyle = "#6b6157"; ctx.font = `400 32px ${F}`; y = wrapText(ctx, subtitle, 80, y + 4, W - 160, 46); }
    return { cv, ctx, F, y: y + 20 };
  }
  function footer(ctx, F, notes) {
    let y = H - 210;
    ctx.fillStyle = "#e7dccb"; ctx.fillRect(80, y - 40, W - 160, 2);
    ctx.fillStyle = "#b7791f"; ctx.font = `500 28px ${F}`;
    for (const n of notes) { y = wrapText(ctx, n, 80, y, W - 160, 40); }
    ctx.fillStyle = "#6b6157"; ctx.font = `400 28px ${F}`;
    ctx.fillText(`数据以官网为准 · 核验日期 ${D.latest_verified}`, 80, H - 110);
    ctx.fillStyle = "#2b2620"; ctx.font = `600 30px ${F}`;
    ctx.fillText(REPO_SHORT, 80, H - 66);
  }
  function rowsBlock(ctx, F, y, rows) {
    // rows: [{name, value, bar(0-1), note}]
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ctx.fillStyle = "#fffaf2"; roundRect(ctx, 80, y, W - 160, 138, 28); ctx.fill();
      ctx.fillStyle = i < 3 ? "#d9653b" : "#9a8f83"; ctx.font = `700 48px ${F}`; ctx.fillText(String(i + 1), 116, y + 66);
      ctx.fillStyle = "#2b2620"; ctx.font = `700 48px ${F}`; ctx.fillText(r.name, 186, y + 66);
      ctx.textAlign = "right"; ctx.font = `700 52px ${F}`; ctx.fillText(r.value, W - 116, y + 68); ctx.textAlign = "left";
      if (r.bar != null) {
        ctx.fillStyle = "#e7dccb"; roundRect(ctx, 186, y + 88, W - 302, 14, 7); ctx.fill();
        ctx.fillStyle = "#e9a17f"; roundRect(ctx, 186, y + 88, Math.max(14, (W - 302) * r.bar), 14, 7); ctx.fill();
      }
      if (r.note) { ctx.fillStyle = "#b7791f"; ctx.font = `500 26px ${F}`; ctx.fillText(r.note, 186, y + (r.bar != null ? 126 : 110)); }
      y += 152;
    }
    return y;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function shareGrad() {
    const rows = D.cities.map(gradRow).filter((r) => r.b.total > 0).sort((a, b) => b.b.total - a.b.total).slice(0, 5);
    const { cv, ctx, F, y } = baseCanvas(`我是${DEG[state.deg]}，这 ${rows.length} 座城市能领最多`, "只算已核实、未过期的市级现金补贴，按原文上限合计");
    const max = rows[0] ? rows[0].b.total : 1;
    let warn = false;
    rowsBlock(ctx, F, y + 10, rows.map((r) => {
      const ex = r.b.excluded.some((x) => x.type === "living" || x.type === "rent");
      warn = warn || ex;
      return { name: r.c.city, value: money(r.b.total) + " 元", bar: r.b.total / max, note: ex ? "⚠️ 另有待核实补贴未计入" : (r.hk.cls === "b-good" ? r.hk.text : "落户：" + r.hk.text) };
    }));
    footer(ctx, F, [warn ? "⚠️ 标记项还有补贴没核实清楚，没算进去。补贴大多有年龄、户籍、社保月数和申请时限要求。" : "补贴大多有年龄、户籍、社保月数和申请时限要求，申请前看原文。"]);
    return cv;
  }
  function shareTop5() {
    const { ranked } = computeIndex();
    const top = ranked.filter((r) => r.total != null).slice(0, 5);
    const { cv, ctx, F, y } = baseCanvas("我的日子指数 Top 5", "我的权重：" + weightText());
    let warn = false;
    rowsBlock(ctx, F, y + 10, top.map((r) => {
      if (r.miss.length) warn = true;
      return { name: r.c.city, value: r.total.toFixed(0) + " 分", bar: r.total / 100, note: r.miss.length ? `⚠️ 缺${r.miss[0].label}数据，按其余项计分` : "" };
    }));
    footer(ctx, F, [(warn ? "⚠️ 标记的城市有一项数据还没核实。" : "") + `日子指数仅反映公开数据，不代表城市好坏。参与排名 ${ranked.length} 座，通勤暂停用。`]);
    return cv;
  }
  function shareMyCity() {
    const id = state.myCity;
    const { ranked, pending } = computeIndex();
    const r = ranked.find((x) => x.c.id === id);
    if (!r) {
      const p = pending.find((x) => x.c.id === id);
      const { cv, ctx, F, y } = baseCanvas(`${p.c.city}的日子指数还在收集中`, "缺 2 项及以上已核实数据，暂不排名");
      ctx.font = `500 34px ${F}`; ctx.fillStyle = "#2b2620";
      let yy = y + 30;
      for (const m of p.miss) { yy = wrapText(ctx, `⚠️ ${m.label}：${p.c.index[m.key].reason}`, 80, yy, W - 160, 50) + 10; }
      ctx.fillStyle = "#d9653b"; ctx.font = `600 36px ${F}`; wrapText(ctx, "你的 agent 闲着吗？来认领这座城市一起巡检。", 80, yy + 30, W - 160, 50);
      footer(ctx, F, ["数据不全的城市不硬排，缺了就老实写缺。"]);
      return cv;
    }
    const { cv, ctx, F, y } = baseCanvas(`${r.c.city}在日子指数里排第 ${r.rank}`, `共 ${ranked.length} 座城市参与排名 · 我的权重：${weightText()}`);
    ctx.fillStyle = "#d9653b"; ctx.font = `800 220px ${F}`; ctx.fillText(r.total.toFixed(0), 80, y + 210);
    const numW = ctx.measureText(r.total.toFixed(0)).width;
    ctx.fillStyle = "#6b6157"; ctx.font = `400 40px ${F}`; ctx.fillText("分 / 100", 80 + numW + 24, y + 210);
    let yy = y + 330;
    for (const m of ACTIVE) {
      const sc = r.scores[m.key];
      ctx.fillStyle = "#2b2620"; ctx.font = `600 36px ${F}`; ctx.fillText(m.label, 80, yy);
      ctx.fillStyle = "#e7dccb"; roundRect(ctx, 300, yy - 26, 560, 20, 10); ctx.fill();
      if (sc != null) { ctx.fillStyle = "#e9a17f"; roundRect(ctx, 300, yy - 26, Math.max(20, 560 * sc / 100), 20, 10); ctx.fill(); }
      ctx.textAlign = "right"; ctx.fillStyle = sc == null ? "#b7791f" : "#2b2620"; ctx.fillText(sc == null ? "⚠️ 缺" : sc.toFixed(0), W - 80, yy); ctx.textAlign = "left";
      yy += 78;
    }
    footer(ctx, F, [r.miss.length ? `⚠️ ${r.miss[0].label}：${r.c.index[r.miss[0].key].reason}，这一项不计分。` : "每项按参与排名的城市做 0–100 归一化。日子指数仅反映公开数据，不代表城市好坏。"]);
    return cv;
  }
  function openShare(kind) {
    if (kind === "mycity" && !state.myCity) { const s = $("#my-city"); s && s.focus(); return; }
    if (kind === "mycity" && computeIndex().ranked.find(r => r.c.id === state.myCity)?.total === null) {
      toast("当前权重无法计算这座城市的得分，请给有数据的项目增加权重。"); return;
    }
    if (kind === "top5" && !computeIndex().ranked.some(r => r.total != null)) {
      toast("当前权重无法生成排名，请至少给一项增加权重。"); return;
    }
    const cv = { grad: shareGrad, top5: shareTop5, mycity: shareMyCity }[kind]();
    const url = cv.toDataURL("image/png");
    const name = `rizi-city-${kind}.png`;
    $("#sheet-body").innerHTML = `
      <img src="${url}" alt="分享图预览">
      <div class="row"><a class="btn" href="${url}" download="${name}">保存图片</a><button class="btn ghost" data-copy>复制链接</button></div>
      <p class="tiny">手机上也可以长按图片保存。图上的数字以官网为准，⚠️ 项是还没核实的。</p>`;
    $("#sheet").hidden = false;
  }

  // ---------- 渲染与事件 ----------
  const RENDER = { resident: renderResident, compare: renderCompare, index: renderIndex, grad: renderGrad, civil: renderCivil, free: renderFree };
  function show(tab, push = false) {
    const changed = state.tab !== tab;
    state.tab = tab;
    document.querySelectorAll(".tabs button").forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.tab === tab)); b.tabIndex = b.dataset.tab === tab ? 0 : -1; b.id = "nav-" + b.dataset.tab; b.setAttribute("aria-controls", "tab-" + b.dataset.tab); $("#tab-" + b.dataset.tab).setAttribute("aria-labelledby", b.id); });
    for (const k of Object.keys(RENDER)) $("#tab-" + k).hidden = k !== tab;
    RENDER[tab]();
    writeHash(push);
    if (push && changed) $("#main-content").scrollIntoView({ block: "start" });
  }
  function rerenderKeepOpen() {
    const panel = $("#tab-" + state.tab);
    const open = [...panel.querySelectorAll("details[open] .city-name")].map((e) => e.textContent);
    RENDER[state.tab]();
    panel.querySelectorAll("details").forEach((d) => { if (open.includes($(".city-name", d)?.textContent)) d.open = true; });
    writeHash();
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));max-width:calc(100vw - 32px);width:max-content;overflow-wrap:anywhere;text-align:center;transform:translateX(-50%);background:#2b2620;color:#fff;padding:8px 14px;border-radius:999px;font-size:14px;z-index:30";
    document.body.appendChild(t); setTimeout(() => t.remove(), 1600);
  }
  async function copyLink() {
    const u = shareUrl();
    try { await navigator.clipboard.writeText(u); toast("链接已复制"); } catch (_) { prompt("复制这个链接：", u); }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) { if (e.target.id === "sheet") $("#sheet").hidden = true; return; }
    if (t.classList.contains("skip-link")) { e.preventDefault(); $("#main-content").focus(); return; }
    const d = t.dataset;
    if (d.tab) return show(d.tab, true);
    if (d.jump) { const section = $("#life-" + d.jump); section?.scrollIntoView({ block: "start" }); section?.setAttribute("tabindex", "-1"); section?.focus({ preventScroll: true }); return; }
    if ("remember" in d) { try { localStorage.setItem("rizi-resident-city", state.residentCity); toast("已在本机记住城市"); renderResident(); } catch (_) { toast("浏览器未允许保存，请使用城市链接"); } return; }
    if ("forget" in d) { try { localStorage.removeItem("rizi-resident-city"); toast("已清除记住的城市"); renderResident(); } catch (_) { toast("无法清除，请检查浏览器存储设置"); } return; }
    if (d.budgetMode) {
      const c = D.cities.find(c=>c.id === state.residentCity);
      if (c && ["total","details"].includes(d.budgetMode)) { cityBudget(c).mode = d.budgetMode; rerenderBudget(`[data-budget-mode="${d.budgetMode}"]`); }
      return;
    }
    if ("budgetReset" in d) {
      const c = D.cities.find(c=>c.id === state.residentCity);
      if (c) { state.budgets[c.id] = freshBudget(); rerenderBudget("[data-budget=people]"); }
      return;
    }
    if (d.preset != null) { state.w = { ...PRESETS[+d.preset].w }; return rerenderKeepOpen(); }
    if (d.deg) { state.deg = d.deg; return rerenderKeepOpen(); }
    if (d.gsort) { state.gradSort = d.gsort; return rerenderKeepOpen(); }
    if (d.fsort) { state.freeSort = d.fsort; return rerenderKeepOpen(); }
    if (d.civil) {
      state.civil[d.civil] = d.val;
      if (d.civil === "year") Object.assign(state.civil, { contract: "", social: "", files: "", project: false });
      return rerenderKeepOpen();
    }
    if (d.share) return openShare(d.share);
    if ("copy" in d) return copyLink();
    if ("close" in d) $("#sheet").hidden = true;
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.budget || t.dataset.budgetItem) {
      const c = D.cities.find(c=>c.id === state.residentCity);
      if (c) {
        const b = cityBudget(c);
        if (["people","income","goal","total"].includes(t.dataset.budget)) b[t.dataset.budget] = t.validity?.badInput ? "invalid" : t.value;
        if (BUDGET_FIELDS.some(f=>f.key === t.dataset.budgetItem)) b.amounts[t.dataset.budgetItem] = t.validity?.badInput ? "invalid" : t.value;
        updateBudgetOutput();
      }
      return;
    }
    if (t.dataset.w) {
      state.w[t.dataset.w] = +t.value;
      t.nextElementSibling.textContent = t.value;
      // 滑动时只重画排行，避免滑块失去焦点
      clearTimeout(t._tm);
      t._tm = setTimeout(() => {
        const sel = document.activeElement && document.activeElement.dataset.w;
        renderIndex(); writeHash();
        if (sel) { const s = $(`[data-w="${sel}"]`); s && s.focus(); }
      }, 120);
    }
    if (t.id === "age") {
      const v = parseInt(t.value, 10);
      state.age = Number.isFinite(v) && v > 0 ? v : null;
      clearTimeout(t._tm);
      t._tm = setTimeout(() => { rerenderKeepOpen(); const a = $("#age"); a.focus(); a.setSelectionRange?.(a.value.length, a.value.length); }, 400);
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset.budgetIncluded) {
      const key = e.target.dataset.budgetIncluded, c = D.cities.find(c=>c.id === state.residentCity);
      const field = BUDGET_FIELDS.find(f=>f.key === key);
      if (c && field && ["separate","none",...(field.includedIn || [])].includes(e.target.value)) {
        cityBudget(c).included[key] = e.target.value;
        rerenderBudget(`[data-budget-included="${key}"]`);
      }
      return;
    }
    if (["resident-city", "compare-a", "compare-b"].includes(e.target.id)) { state[{"resident-city":"residentCity", "compare-a":"compareA", "compare-b":"compareB"}[e.target.id]] = e.target.value; show(state.tab, true); }
    if (e.target.id === "policy-topic") { state.policyTopic = e.target.value; renderResident(); $("#policy-topic")?.focus(); }
    if (e.target.id === "my-city") { state.myCity = e.target.value || null; writeHash(); }
    if (e.target.id === "civil-project") { state.civil.project = e.target.checked; rerenderKeepOpen(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#sheet").hidden = true; });

  window.addEventListener("hashchange", () => { if (D) { readHash(); show(state.tab); } });
  window.addEventListener("popstate", () => { if (D) { readHash(); show(state.tab); } });
  document.querySelector(".tabs").addEventListener("keydown", e => {
    const buttons = [...document.querySelectorAll(".tabs button")];
    const i = buttons.indexOf(e.target);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); show(buttons[next].dataset.tab, true);
  });
  async function load() {
    if (window.RIZI_DATA) return window.RIZI_DATA;
    const r = await fetch("data/cities.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  load().then((data) => {
    D = data;
    const ranked = computeIndex().ranked.length;
    $("#meta").innerHTML = `${D.city_count} 座城市 · ${ranked} 座参与日子指数 · 最近核验 ${esc(D.latest_verified)}${window.RIZI_OFFLINE ? " · 离线版" : ""}`;
    readHash();
    show(state.tab);
  }).catch((err) => {
    $("#meta").textContent = "数据加载失败：" + err.message + "。如果是直接双击打开的 index.html，请用离线版或本地起一个服务器。";
  });
})();
