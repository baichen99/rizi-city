const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js','utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json','utf8'));
const start=source.indexOf('  // ---------- 居民城市主页'),end=source.indexOf('  // ---------- 日子指数 ----------',start);
function helpers(payload=data) {
 return vm.runInNewContext(source.slice(start,end)+'\n({BUDGET_FIELDS,freshBudget,budgetAmount,budgetResult,budgetReading,costReference,referenceMoney})',{URL,D:payload});
}
const h=helpers();
function peerFixture() {
 const d=JSON.parse(JSON.stringify(data));
 d.cities=d.cities.filter(c=>['beijing','guangzhou','shanghai','tianjin','hangzhou'].includes(c.id));
 delete d.cities.find(c=>c.id==='hangzhou').living.statistical_metadata;
 return d;
}
function total(extra={}) {return {...h.freshBudget(),total:'5000',income:'8000',...extra};}
function details(extra={}) {return {...h.freshBudget(),mode:'details',amounts:Object.fromEntries(h.BUDGET_FIELDS.map(f=>[f.key,'0'])),...extra};}
test('blank is missing, zero is explicit, and invalid numeric strings are rejected',()=>{
 assert.equal(h.budgetAmount(''),null);assert.equal(h.budgetAmount('  '),null);assert.equal(h.budgetAmount('0'),0);assert.equal(h.budgetAmount('12.34'),12.34);
 for(const value of [null,undefined,0,true,NaN,Infinity,'-1','1e3','Infinity','12foo','1.001','10000001'])assert.ok(Number.isNaN(h.budgetAmount(value)) || h.budgetAmount(value)===null,String(value));
});
test('only one input mode contributes; household totals are never multiplied by people',()=>{
 const a=h.budgetResult(total({people:'3',amounts:{housing:'99999'}}));assert.equal(a.subtotal,5000);assert.equal(a.balance,3000);assert.equal(a.people,3);
 const b=details({total:'999999',people:'3',income:'8000'});b.amounts.housing='2000';b.amounts.food='1800';const r=h.budgetResult(b);assert.equal(r.subtotal,3800);assert.equal(r.balance,4200);
});
test('all required items must be filled or explicitly accounted for before a conclusion',()=>{
 const b=details({income:'8000'});b.amounts.water='';const r=h.budgetResult(b);assert.equal(r.complete,false);assert.equal(r.balance,null);assert.ok(r.missing.includes('水费'));assert.match(h.budgetReading(r).detail,/还没算.*水费/);
 b.included.water='housing';b.amounts.power='';b.included.power='none';assert.equal(h.budgetResult(b).complete,true);
});
test('included fees are not counted twice and annual heating is averaged once',()=>{
 const b=details();b.amounts.housing='3000';b.amounts.water='80';b.included.water='housing';b.amounts.heating='2400';b.amounts.social='500';const r=h.budgetResult(b);assert.equal(r.subtotal,3700);assert.equal(r.complete,true);
 b.included.water='separate';assert.equal(h.budgetResult(b).subtotal,3780);
});
test('missing income or savings target is not silently a confirmed zero',()=>{
 const a=h.budgetResult(total({income:''}));assert.equal(a.income,null);assert.equal(a.balance,null);assert.match(h.budgetReading(a).title,/整户每月预计花/);
 const b=h.budgetResult(total());assert.equal(b.goal,null);assert.equal(b.afterGoal,null);assert.match(h.budgetReading(b).title,/还能留约 3,000/);
});
test('surplus, deficit, savings gap and exact break-even use direct statements',()=>{
 assert.match(h.budgetReading(h.budgetResult(total({income:'4000'}))).title,/还差约 1,000/);
 assert.match(h.budgetReading(h.budgetResult(total({income:'5000'}))).title,/收支刚好打平/);
 assert.match(h.budgetReading(h.budgetResult(total({goal:'2000'}))).title,/达到储蓄目标后.*1,000/);
 assert.match(h.budgetReading(h.budgetResult(total({goal:'3000'}))).title,/刚好够你的储蓄目标/);
 assert.match(h.budgetReading(h.budgetResult(total({goal:'4000'}))).title,/离你的储蓄目标还差约 1,000/);
});
test('tiny real deficits never become a false exact zero',()=>{
 const r=h.budgetResult(total({total:'5000.01',income:'5000'}));assert.equal(r.balance,-.01);assert.match(h.budgetReading(r).title,/0.01/);assert.doesNotMatch(h.budgetReading(r).title,/打平/);
});
test('invalid people, amounts, goal and mode cannot produce personal conclusions',()=>{
 for(const patch of [{people:'0'},{people:'1.5'},{people:'31'},{total:'-1'},{income:'bad'},{goal:'-1'},{mode:'unknown'}]) {const r=h.budgetResult(total(patch));assert.equal(r.complete,false);assert.equal(r.balance,null);assert.match(h.budgetReading(r).title,/需要改/);}
});
test('official monthly reference is separate, annual, and restricted to confirmed peer scope',()=>{
 const d=peerFixture(),f=helpers(d),gz=d.cities.find(c=>c.id==='guangzhou');const ref=f.costReference(gz);assert.equal(ref.monthly,51860/12);assert.equal(ref.record.period,2025);assert.equal(ref.income.value,86069);assert.equal(ref.peers.length,4);assert.equal(ref.rank,2);assert.match(ref.position,/4座同口径城市里第2低/);assert.equal(h.referenceMoney(ref.monthly),'4,300');
 assert.equal(f.costReference(d.cities.find(c=>c.id==='hangzhou')),null);
});
test('stale or mismatched metadata is excluded, not included as zero',()=>{
 const d=JSON.parse(JSON.stringify(data));const gz=d.cities.find(c=>c.id==='guangzhou');gz.living.statistical_metadata.consumption_per_capita.source_value=1;assert.equal(helpers(d).costReference(gz),null);
 const d2=peerFixture();d2.cities.find(c=>c.id==='beijing').living.statistical_metadata.consumption_per_capita.review_due='2026-01-01';assert.equal(helpers(d2).costReference(d2.cities.find(c=>c.id==='guangzhou')).peers.length,3);
});
test('exact ties share rank and no peer group is called a national or happiness score',()=>{
 const d=peerFixture();const gz=d.cities.find(c=>c.id==='guangzhou'),bj=d.cities.find(c=>c.id==='beijing');bj.living.consumption_per_capita=gz.living.consumption_per_capita;bj.living.statistical_metadata.consumption_per_capita.source_value=gz.living.consumption_per_capita;
 const r=helpers(d).costReference(gz);assert.match(r.position,/并列第2低/);assert.doesNotMatch(r.position,/全国|幸福|宽裕|压力/);
});
test('budget data never enters URL, browser storage, requests or share images',()=>{
 const route=source.slice(source.indexOf('  function hashFor('),source.indexOf('  // ---------- 居民城市主页'));
 assert.doesNotMatch(route,/budgets|income|goal|amounts/);
 const share=source.slice(source.indexOf('  function shareGrad('),source.indexOf('  // ---------- 渲染与事件'));
 assert.doesNotMatch(share,/cityBudget|budgetResult|state\.budgets/);
 const budgetCode=source.slice(source.indexOf('  // ---------- Living-cost reference'),source.indexOf('  function comparisonCard('));
 assert.doesNotMatch(budgetCode,/localStorage|sessionStorage|fetch\(|sendBeacon|writeHash|location\./);
});

test('included fees require a directly entered carrier; no cycles or missing carrier count as complete',()=>{
 const b=details({income:'10000'});b.amounts.housing='';b.included.water='housing';assert.equal(h.budgetResult(b).complete,false);assert.equal(h.budgetResult(b).balance,null);
 b.amounts.housing='3000';b.included.housing='water';assert.equal(h.budgetResult(b).complete,false);
 b.included.housing='separate';b.included.power='housing';b.included.heating='power';assert.equal(h.budgetResult(b).complete,false);
 b.included.heating='housing';assert.equal(h.budgetResult(b).complete,true);assert.equal(h.budgetResult(b).subtotal,3000);
});
