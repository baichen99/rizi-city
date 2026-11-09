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
    { key: "rent", short: "房租", label: "房租负担", dir: -1, how: "30㎡ 单间月租 ÷ 人均月可支配收入" },
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
    tab: "index",
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
    const parts = location.hash.replace(/^#/, "").split("&").filter(Boolean);
    for (const p of parts) {
      const [k, v] = p.split("=");
      if (!v && ["index", "grad", "civil", "free"].includes(k)) state.tab = k;
      if (k === "w" && v) {
        const nums = v.split(".").map(Number);
        if (nums.length === ACTIVE.length && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 5)) {
          ACTIVE.forEach((m, i) => (state.w[m.key] = nums[i]));
        }
      }
      if (k === "deg" && DEG[v]) state.deg = v;
      if (k === "city" && v) state.myCity = decodeURIComponent(v);
    }
  }
  function hashFor(tab) {
    const h = [tab];
    if (tab === "index") {
      h.push("w=" + ACTIVE.map((m) => state.w[m.key]).join("."));
      if (state.myCity) h.push("city=" + encodeURIComponent(state.myCity));
    }
    if (tab === "grad") h.push("deg=" + state.deg);
    return "#" + h.join("&");
  }
  function writeHash() {
    try { history.replaceState(null, "", hashFor(state.tab)); } catch (_) { /* file:// 下可能不允许 */ }
  }
  function shareUrl() {
    const base = location.protocol.startsWith("http") ? location.origin + location.pathname : "https://baichen99.github.io/rizi-city/";
    return base + hashFor(state.tab);
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

  function renderIndex() {
    const el = $("#tab-index");
    const sumW = ACTIVE.reduce((a, m) => a + state.w[m.key], 0);
    const { ranked, pending } = computeIndex();
    const presetOn = (p) => ACTIVE.every((m) => p.w[m.key] === state.w[m.key]);
    el.innerHTML = `
      <div>
        <h2>日子指数：哪座城市更好过日子？</h2>
        <p class="sub">${ACTIVE.length} 项公开数据，各自归一化到 0–100 分再按你的权重加权。拖一拖滑块，看看你在乎的东西换了，排名怎么变。</p>
      </div>
      <div class="card">
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
            <div class="rank-head"><span class="rank-no">${r.rank}</span><span class="rank-name">${esc(r.c.city)}</span><span class="rank-score">${r.total == null ? "—" : r.total.toFixed(0)}</span></div>
            <div class="bar"><i style="width:${(r.total || 0).toFixed(1)}%"></i></div>
            <div class="parts">
              ${ACTIVE.map((m) => r.scores[m.key] == null
                ? `<span class="miss" title="${esc(r.c.index[m.key].reason)}">${m.short} ⚠️缺</span>`
                : `<span title="${esc(m.how)}">${m.short} <b>${r.scores[m.key].toFixed(0)}</b></span>`).join("")}
            </div>
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
    if (fe.pension_base_min != null) items.push(`<li><span class="lbl">养老</span>：基数下限 ${money(fe.pension_base_min)} 元/月 × ${esc(fe.pension_rate)}%（${esc(fe.pension_year || "")}）<br><span class="d">${link(fe.source_url, "来源")} · ${verifiedLine(fe)}</span></li>`);
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
  const RENDER = { index: renderIndex, grad: renderGrad, civil: renderCivil, free: renderFree };
  function show(tab) {
    state.tab = tab;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    for (const k of Object.keys(RENDER)) $("#tab-" + k).hidden = k !== tab;
    RENDER[tab]();
    writeHash();
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
    t.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#2b2620;color:#fff;padding:8px 14px;border-radius:999px;font-size:14px;z-index:30";
    document.body.appendChild(t); setTimeout(() => t.remove(), 1600);
  }
  async function copyLink() {
    const u = shareUrl();
    try { await navigator.clipboard.writeText(u); toast("链接已复制"); } catch (_) { prompt("复制这个链接：", u); }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) { if (e.target.id === "sheet") $("#sheet").hidden = true; return; }
    const d = t.dataset;
    if (d.tab) return show(d.tab);
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
    if (e.target.id === "my-city") { state.myCity = e.target.value || null; writeHash(); }
    if (e.target.id === "civil-project") { state.civil.project = e.target.checked; rerenderKeepOpen(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#sheet").hidden = true; });

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
