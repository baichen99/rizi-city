/* No browser dependency: test the exact pure helpers used by the UI. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js', 'utf8');
const start = source.indexOf('  function periodNumber(');
const end = source.indexOf('  function historyChart(', start);
const helpers = vm.runInNewContext(source.slice(start,end) + '\n({ periodNumber, chartSegments, comparable })');
const point = (period,value,extra={}) => ({period,value,review_status:'verified',comparability_key:'same', ...extra});
const series = points => ({frequency:'annual', comparability_key:'same',points});
const sizes = segments => Array.from(segments,s=>s.length);
test('missing values break lines and never become zero', () => {
  assert.deepEqual(sizes(helpers.chartSegments(series([point('2023',10),point('2024',null),point('2025',12)]))), [1,1]);
});
test('missing periods, unverified records and new comparability groups break lines', () => {
  assert.deepEqual(sizes(helpers.chartSegments(series([point('2021',1),point('2023',3),point('2024',4,{review_status:'pending'}),point('2025',5),point('2026',6,{comparability_key:'different'})]))), [1,1,1,1]);
});
test('monthly points use calendar spacing including December boundary', () => {
  const s = {frequency:'monthly', comparability_key:'same',points:[point('2025-12',2),point('2026-01',3),point('2026-03',5)]};
  assert.deepEqual(sizes(helpers.chartSegments(s)), [2,1]);
});
test('numeric zero is a real observation, strings are not', () => {
  assert.deepEqual(sizes(helpers.chartSegments(series([point('2023',0),point('2024','2'),point('2025',3)]))), [1,1]);
});
const metric = {metric:'wage',value:20,unit:'元/年',period:'2025',population_scope:'就业人员',review_status:'verified',comparability_key:'same'};
test('comparison requires period, units, population, semantics, and verified numeric values', () => {
  assert.equal(helpers.comparable(metric,{...metric,value:30}),true);
  for(const diff of [{period:'2024'},{unit:'元/月'},{population_scope:'在岗职工'},{comparability_key:'other'},{review_status:'pending'},{value:null},{value:'30'}]) assert.equal(helpers.comparable(metric,{...metric,...diff}),false);
});
test('explicit cross-city group may differ from per-city history group', () => {
  assert.equal(helpers.comparable({...metric,comparability_key:'city-a',cross_city_comparability_key:'wage-scope'}, {...metric,comparability_key:'city-b',cross_city_comparability_key:'wage-scope'}),true);
});
test('legacy algorithms remain present and resident storage is city-only', () => {
  assert.match(source,/function computeIndex\(/);
  assert.match(source,/localStorage\.setItem\("rizi-resident-city", state\.residentCity\)/);
  assert.match(source,/window\.addEventListener\("hashchange"/);
  assert.match(source,/window\.addEventListener\("popstate"/);
  assert.match(source,/URLSearchParams/);
});
const routeSource = source.slice(source.indexOf('  function readHash()'), source.indexOf('  function shareUrl()'));
function routing(hash, saved='') {
  const context = { URLSearchParams, location:{hash}, D:{cities:[{id:'beijing'},{id:'shanghai'}]}, state:{}, ACTIVE:[{key:'rent'},{key:'social'}], PRESETS:[{w:{rent:1,social:1}}], DEG:{bachelor:'本科',master:'硕士'}, rememberedCity:()=>saved };
  vm.createContext(context);
  vm.runInContext(routeSource,context);
  context.readHash();
  return context;
}
test('resident is default, storage opt-in used only on initial empty URL',()=>{
  assert.equal(routing('').state.tab,'resident');
  assert.equal(routing('', 'beijing').state.residentCity,'beijing');
  assert.equal(routing('#resident','beijing').state.residentCity,'');
});
test('route changes reset city and weights and keep legacy links',()=>{
  const c=routing('#index&w=3.2&city=beijing');
  assert.equal(c.state.w.rent,3);
  assert.equal(c.state.myCity,'beijing');
  c.location.hash='#grad&deg=master';c.readHash();
  assert.equal(c.state.w.rent,1);
  assert.equal(c.state.myCity,null);
  assert.equal(c.state.deg,'master');
});
test('malformed and unknown city URL cannot crash or select arbitrary city',()=>{
  assert.equal(routing('#resident&city=%E0%A4%A').state.residentCity,'');
  assert.equal(routing('#unknown').state.tab,'resident');
});
test('resident share contains city only, never personal conditions',()=>{
  const c=routing('#resident&city=beijing');
  c.state.age=28;c.state.deg='master';c.state.policyTopic='social';
  assert.equal(c.hashFor('resident'),'#resident&city=beijing');
});
test('module summary never hides review failure or expiry reason',()=>{
  const code=source.slice(source.indexOf('  function currentLifeModule('),source.indexOf('  function renderResident('));
  const render=vm.runInNewContext(code+'\nmoduleCard', {esc:x=>String(x??''),safeLink:()=>''});
  for(const [status,label] of [['link_only','仅官方资料入口'],['missing','尚未覆盖'],['pending_review','待复核'],['expired','已过期']]) {
    const html=render({title:'水费',status,summary:'摘要仍存在',reason:'复核日期已过',reference_period:'历史资料',next_review_at:'2099-01-01'});
    assert.ok(html.includes(label));assert.ok(html.includes('摘要仍存在'));assert.ok(html.includes('复核日期已过'));assert.ok(html.includes('历史资料'));assert.ok(html.includes('2099-01-01'));
  }
});
const safetyHelpers = vm.runInNewContext(
  source.slice(source.indexOf('  function sourceFor('),source.indexOf('  function recordDetails(')) +
  source.slice(source.indexOf('  function currentLifeModule('),source.indexOf('  function moduleCard(')) +
  '\n({currentLifeRecord, currentLifeModule})');
const verifiedSource = {id:'source',review_status:'verified',review_due:'2027-02-09',verified_at:'2026-11-09'};
const evidence = {source_id:'source',review_status:'verified',value:123,verified_at:'2026-11-09'};
const cityWithSource = s => ({life:{sources:[s]}});
test('offline record values expire at render time without mutating evidence',()=>{
  const c=cityWithSource(verifiedSource);
  assert.equal(safetyHelpers.currentLifeRecord(c,evidence,'2027-02-09').value,123);
  const expired=safetyHelpers.currentLifeRecord(c,evidence,'2027-02-10');
  assert.equal(expired.value,null);assert.equal(expired.review_status,'stale');assert.match(expired.missing_reason,/2027-02-09/);
  assert.equal(evidence.value,123);assert.equal(verifiedSource.review_status,'verified');
});
test('invalid source, future verification, and pending legacy values never render as verified numbers',()=>{
  for(const diff of [{review_status:'pending'},{review_status:'restricted'},{review_due:null},{verified_at:'2028-01-01'}]) {
    assert.equal(safetyHelpers.currentLifeRecord(cityWithSource({...verifiedSource,...diff}),evidence,'2026-11-09').value,null);
  }
  assert.equal(safetyHelpers.currentLifeRecord({},evidence,'2026-11-09').value,null);
  assert.equal(safetyHelpers.currentLifeRecord({}, {value:20,review_status:'pending'},'2026-11-09').value,null);
});
test('stale history point is suppressed and breaks chart segments',()=>{
  const c=cityWithSource(verifiedSource);
  const p=safetyHelpers.currentLifeRecord(c,{...evidence,period:'2025',comparability_key:'same'},'2027-02-10');
  assert.deepEqual(sizes(helpers.chartSegments(series([point('2024',1),p,point('2026',3)]))),[1,1]);
});
test('offline modules downgrade overdue, expired and future rules and cannot enable calculators',()=>{
  const base={status:'link_only',reason:'原有限制',verified_at:'2026-11-09',next_review_at:'2027-02-09',usable:true,calculator_enabled:true};
  const overdue=safetyHelpers.currentLifeModule(base,'2027-02-10');
  assert.equal(overdue.status,'pending_review');assert.match(overdue.reason,/复核窗口/);assert.match(overdue.reason,/原有限制/);assert.equal(overdue.usable,false);assert.equal(overdue.calculator_enabled,false);
  assert.equal(safetyHelpers.currentLifeModule({...base,effective_to:'2026-12-31'},'2027-01-01').status,'expired');
  assert.equal(safetyHelpers.currentLifeModule({...base,effective_from:'2027-01-01'},'2026-12-01').status,'pending_review');
  assert.equal(base.status,'link_only');
});
