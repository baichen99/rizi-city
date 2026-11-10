const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js','utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json','utf8'));
const start = source.indexOf('  // ---------- 居民城市主页');
const end = source.indexOf('  // ---------- 日子指数 ----------',start);
const h = vm.runInNewContext(source.slice(start,end)+'\n({yoyChange,metricReading,metricGuide,historyExplanation,chartSegments,livingRecord,currentLifeRecord,comparisonRows,comparisonUnit,populationLabel,comparable})',{URL});
const house = (value, extra={}) => ({metric:'housing_new_yoy_index',statistic:'index',comparison:'year_on_year',unit:'上年同月=100',period:'2026-09',review_status:'verified',value,...extra});
test('100 reference translates exact year-on-year changes, not amounts or month-on-month',()=>{
  assert.equal(h.metricReading(house(97.3)),'比去年同月低 2.7%');
  assert.equal(h.metricReading(house(102.8)),'比去年同月高 2.8%');
  assert.equal(h.metricReading(house(100)),'与去年同月持平');
  assert.match(h.metricGuide(house(97.3)).basis,/2026年9月与2025年9月/);
  assert.match(h.metricGuide(house(97.3)).caution,/不能倒推房价金额/);
});
test('unverified values and unknown index semantics never receive a percentage interpretation',()=>{
  for(const patch of [{value:null},{value:'97.3'},{value:true},{value:NaN},{value:Infinity},{review_status:'pending'},{unit:'2025=100'},{comparison:'month_on_month'},{statistic:'mean'},{period:'2026'},{period:'2026-13'}]) assert.equal(h.yoyChange(house(97.3,patch)),null);
});
test('amount examples are explicit, annual default is retained, missing data gets no calculation',()=>{
  const wage={metric:'wage_nonprivate_mean',value:166790,unit:'元/年',statistic:'mean',gross_or_net:'gross',includes_bonus:true,review_status:'verified'};
  assert.match(h.metricReading(wage),/年平均工资约 16.68万元/);
  assert.match(h.metricGuide(wage).example,/13,899元\/月.*不是每月到手工资/);
  assert.match(h.metricGuide(wage).caution,/含奖金/);
  assert.equal(h.metricGuide({...wage,value:null}).example,undefined);
  const rent={metric:'rent',value:81.48,unit:'元/㎡/月',review_status:'verified'};
  assert.match(h.metricGuide(rent).example,/假设30㎡.*2,444元\/月.*不是具体房源报价/);
  assert.match(h.metricGuide({metric:'income'}).caution,/城镇或全体居民/);
});
test('history describes percentage points while preserving missing observations',()=>{
  const points=[house(97.7,{period:'2026-08',comparability_key:'same'}),house(97.3,{comparability_key:'same'}),house(null,{period:'2026-10',review_status:'missing',comparability_key:'same'})];
  const series={frequency:'monthly',points};
  const text=h.historyExplanation(series,h.chartSegments(series));
  assert.match(text,/低 0.4 个百分点/);assert.match(text,/不能据此计算环比/);assert.match(text,/1个期间暂无可用数值/);assert.match(text,/不把旧年值当现状/);
});
const metadata=(value,field='income_per_capita',extra={})=>({source_value:value,period:'2025',unit:'元/年',statistic:'mean',price_basis:'nominal',population_scope:'城镇常住居民（按常住地统计）',population_scope_type:'urban_residents',geographic_scope:'甲市',geographic_scope_type:'city_administrative_area',methodology_key:'household_income_expenditure_survey',cross_city_comparability_key:`resident-statistics|${field}|urban_residents|city_administrative_area|CNY-person-year|household-survey`,source_url:'https://example.gov.cn/report',source_date:'2026-03-01',publisher:'统计局',verified_at:'2026-11-09',review_due:'2027-02-09',review_status:'verified',evidence_locator:'居民收入段',...extra});
function record(extra={}, livingExtra={}) {
 const c={city:'甲市',living:{income_per_capita:86069,stats_year:2025,verified_at:'2026-11-09',statistical_metadata:{income_per_capita:metadata(86069,'income_per_capita',extra)},...livingExtra}};
 return h.currentLifeRecord(c,h.livingRecord(c,'income','income_per_capita','居民收入','元/年',2025,'https://example.gov.cn/legacy','旧数据口径未确认'),'2026-11-09');
}
test('verified metadata binds the exact old value and opens only matching semantics',()=>{
 const a=record(),b=record({geographic_scope:'乙市',population_scope:'城镇居民'});
 assert.equal(h.populationLabel(a),'城镇常住居民');assert.equal(a.value,86069);assert.equal(h.comparable(a,b),true);assert.equal(record({source_url:'http://tjzd.stats.gov.cn/system/report.shtml'}).value,86069);
 for(const patch of [{population_scope_type:'all_residents',cross_city_comparability_key:'resident-statistics|income_per_capita|all_residents|city_administrative_area|CNY-person-year|household-survey'},{period:'2024'},{unit:'元/月'},{statistic:'median'},{price_basis:'real'},{methodology_key:'different'}]) assert.ok(!h.comparable(a,record(patch)));
});
test('wrong raw value, fake key, stale or future metadata cannot upgrade an old record',()=>{
 for(const patch of [{source_value:1},{source_value:'86069'},{source_value:true},{cross_city_comparability_key:'same-fake-key'},{review_due:'2026-11-08'},{review_due:null},{review_due:'2026-13-01'},{review_due:'2027-02-30'},{source_date:'2026-02-30'},{verified_at:'2026-02-30'},{verified_at:'2026-11-10'},{source_date:'2026-11-10'},{review_status:'pending'},{publisher:null},{evidence_locator:null},{source_url:'https://gov.cn.evil.example/a'},{source_url:'https://user@gov.cn/a'}]) {const r=record(patch);assert.equal(r.value,null,JSON.stringify(patch));assert.notEqual(r.review_status,'verified');}
 const legacy=record({}, {statistical_metadata:undefined});assert.equal(legacy.value,86069);assert.ok(!legacy.cross_city_comparability_key);
});
test('all eight comparison dimensions remain visible with honest statuses',()=>{
 const a=JSON.parse(JSON.stringify(data.cities.find(c=>c.id==='beijing'))),b=JSON.parse(JSON.stringify(data.cities.find(c=>c.id==='shanghai')));
 delete a.living.statistical_metadata; delete b.living.statistical_metadata;
 const rows=h.comparisonRows(a,b);assert.equal(rows.length,8);assert.equal(rows.filter(r=>r.canCompare).length,2);
 assert.equal(rows.find(r=>r.metric==='income').state,'reference');assert.match(rows.find(r=>r.metric==='income').reason,/尚未确认一致/);
 assert.equal(rows.find(r=>r.metric==='wage_median').state,'missing');assert.match(rows.find(r=>r.metric==='wage_median').reason,/不补0/);
 assert.ok(rows.every(r=>typeof r.canCompare==='boolean'));
});
test('index original-input labels reject bad numbers rather than invent zero',()=>{
 const a=source.indexOf('  function indexRawValue('),b=source.indexOf('  function renderIndex(',a);
 const f=vm.runInNewContext(source.slice(a,b)+'\nindexRawValue',{numberText:n=>String(n),TIER_LABEL:{job:'先就业'}});
 for(const value of [null,'0',true,NaN,Infinity])for(const key of ['rent','subsidy'])assert.equal(f({index:{[key]:{ok:true,value}}},{key}),'缺已核实数据');
 assert.equal(f({index:{rent:{ok:true,value:0}}},{key:'rent'}),'0%');
});

test('invalid years and unsafe bound amounts never become verified',()=>{
 for(const year of [null,undefined,'null','',0,20250,'20x5'])assert.equal(record({period:String(year)},{stats_year:year}).value,null);
 for(const value of [-1,Number.MAX_SAFE_INTEGER+1,Infinity,NaN,true,'86069']) {
  const r=record({}, {income_per_capita:value,statistical_metadata:{income_per_capita:metadata(value)}});
  assert.equal(r.value,null,String(value));
 }
});
test('partially verified population scope stays unknown, not asserted different',()=>{
 const a=JSON.parse(JSON.stringify(data.cities.find(c=>c.id==='guangzhou'))),b=JSON.parse(JSON.stringify(data.cities.find(c=>c.id==='beijing')));
 delete b.living.statistical_metadata;
 a.living.statistical_metadata={income_per_capita:metadata(a.living.income_per_capita)};
 assert.match(h.comparisonRows(a,b).find(r=>r.metric==='income').reason,/尚未确认一致/);
 assert.equal(h.comparisonUnit({metric:'income',unit:'元/年'}),'每人/年');
 assert.equal(h.comparisonUnit({metric:'wage_private_mean',unit:'元/年',gross_or_net:'gross'}),'每年 · 税前');
});
