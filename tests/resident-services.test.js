const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js', 'utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json', 'utf8'));
const start = source.indexOf('  // ---------- 居民城市主页');
const end = source.indexOf('  // ---------- 日子指数 ----------', start);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function helpers(D = data) {
  const context = {D, state:{residentNeed:'benefits',residentSearch:''}, URL, Date, Number, String, Set, Map, JSON, esc,
    REPO:'https://github.com/baichen99/rizi-city',link:(url,label)=>`<a href="${esc(url)}">${esc(label)}</a>`};
  vm.createContext(context); vm.runInContext(source.slice(start,end),context);
  return context;
}
const h = helpers(), today = '2026-11-10';
const fixture = {valid_until:'2026-12-31',verified_at:today,source_date:'2026-01-01',source_url:'https://www.gov.cn/policy'};

test('policy dates, review flags and government links fail closed without claiming eligibility',()=>{
  for (const [patch,label] of [[{valid_until:'2026-11-09'},'已过期'],[{valid_until:'not-a-date'},'期限待核实'],[{effective_from:'2026-12-01'},'尚不能'],[{verified_at:'2027-01-01'},'待核实'],[{source_date:'2027-01-01'},'日期待核实'],[{source_url:'https://gov.cn.evil.test/'},'待核实'],[{needs_human:true},'待核实'],[{access_blocked:true},'待核实'],[{valid_until:null},'有效期待确认']]) {
    assert.ok(h.residentPolicyStatus({...fixture,...patch},today).label.includes(label),JSON.stringify(patch));
  }
  assert.equal(h.residentPolicyStatus(fixture,today).label,'已收录 · 申请前复核');
  assert.match(h.residentPolicyStatus(fixture,today).reason,/不等于你符合条件/);
});

test('housing discovery includes non-cash support, mixed subsidies and purchase support',()=>{
  for(const [type,name] of [['other','新就业青年安居服务（保租房租金补贴）'],['other','青年人才驿站免费住宿'],['living','青年人才租房和生活补贴'],['housing_purchase','首次购房补贴'],['rent','测试租补']]) {
    assert.equal(h.residentSubsidyNeeds({type,name}).join(','),'benefits,housing');
  }
  assert.equal(h.residentSubsidyNeeds({type:'living',name:'应届大学生生活补贴'}).join(','),'benefits');
  const c=data.cities.find(c=>c.id==='shanghai');
  assert.ok(h.matchingResidentServices(h.residentServiceEntries(c,today),'housing','保租房').some(e=>e.id==='subsidy-0'));
});

test('all cities render seven need categories with explicit coverage, time and source boundaries',()=>{
  for(const c of data.cities) {
    for(const need of ['benefits','housing','health','work','utilities','family','elder','all']) {
      h.state.residentNeed=need; h.state.residentSearch='';
      const html=h.residentServiceHub(c);
      assert.equal((html.match(/data-resident-need=/g)||[]).length,8);
      assert.match(html,/不是政策生效日/); assert.match(html,/不是申请截止日/);
      assert.match(html,/全国目录/); assert.match(html,/收录数量不是可申请数量/);
      assert.ok(!html.includes('NaN')&&!html.includes('undefined'));
      if(['family','elder'].includes(need)) assert.match(html,/尚未/);
    }
  }
});

test('national navigation remains distinct and downgrades at viewing time',()=>{
  const c=data.cities[0], rows=h.residentServiceEntries(c,'2026-12-11');
  const national=rows.filter(r=>r.kind==='national_navigation');
  assert.equal(national.length,4);
  assert.ok(national.every(r=>r.status==='全国导航 · 待复核'));
  assert.ok(national.every(r=>r.validUntil==='目录没有统一政策有效期'));
  assert.equal(data.resident_services[0].status,'link_only');
});

test('keyword filter is local, scoped, whitespace aware and honest on empty results',()=>{
  const c=data.cities.find(c=>c.id==='guangzhou'), entries=h.residentServiceEntries(c,today);
  assert.ok(h.matchingResidentServices(entries,'utilities','燃气 企业').length>0);
  assert.equal(h.matchingResidentServices(entries,'family','燃气').length,0);
  h.state.residentNeed='family'; h.state.residentSearch='火星补贴';
  assert.match(h.residentServiceResults(c),/没有匹配到已收录内容/);
  assert.match(h.residentServiceResults(c),/清空关键词/);
});

test('untrusted labels and input are escaped and unsafe links are not rendered',()=>{
  const D=JSON.parse(JSON.stringify(data)); D.resident_services[0].url='javascript:alert(1)';
  D.resident_services[1].title='<img src=x onerror=alert(1)>';
  const r=helpers(D);r.state.residentNeed='family';r.state.residentSearch='" onfocus="alert(1)';
  assert.ok(r.residentServiceHub(D.cities[0]).includes('&quot; onfocus=&quot;'));
  r.state.residentSearch='';const html=r.residentServiceHub(D.cities[0]);
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('javascript:'));
});

test('resident filters never enter share URL or persistent storage',()=>{
  const hash=source.slice(source.indexOf('  function hashFor('),source.indexOf('  function writeHash('));
  assert.doesNotMatch(hash,/residentNeed|residentSearch/);
  assert.doesNotMatch(source,/localStorage\.(setItem|getItem)\([^\n]*(?:residentNeed|residentSearch)/);
  assert.equal((source.match(/document\.addEventListener\("click"/g)||[]).length,1);
});


test('reference price cards remain visible as sourced navigation without copying rates',()=>{
  const c={...data.cities.find(c=>c.id==='guangzhou'),life:{modules:JSON.parse(fs.readFileSync('data/life/utilities/guangzhou.json','utf8'))}};
  for(const id of ['water','power','gas']) {
    const row=h.residentServiceEntries(c,today).find(e=>e.id===`module-${id}`);
    assert.equal(row.status,'官方单价参考');
    assert.equal(row.kind,'local_navigation');
    assert.equal(row.rate_reference,undefined);
  }
});
