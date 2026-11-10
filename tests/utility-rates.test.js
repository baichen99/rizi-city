const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('site/app.js', 'utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json', 'utf8'));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class ReviewDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-10T12:00:00Z'])); } }
const context = {Date:ReviewDate, esc, safeLink:(url,label)=>`<a href="${esc(url)}">${esc(label)}</a>`};
const {moduleCard,currentLifeModule} = vm.runInNewContext(app.slice(app.indexOf('  function currentLifeModule('), app.indexOf('  function renderResident('))+'\n({moduleCard,currentLifeModule})',context);
const cards = JSON.parse(fs.readFileSync('data/life/utilities/guangzhou.json', 'utf8'));
test('water, power and gas show sourced rate values, coverage and conditions',()=>{
  for(const id of ['water','power','gas']) {
    const card=cards.find(m=>m.id===id), html=moduleCard(card);
    assert.match(html,/官方单价参考/);
    assert.ok(html.includes(esc(card.rate_reference.scope)));
    for(const rate of card.rate_reference.items) {
      assert.ok(html.includes(`${rate.approximate ? '约 ' : ''}${rate.value}`));
      assert.ok(html.includes(esc(rate.unit)));
      assert.ok(html.includes(esc(rate.basis)));
    }
    assert.ok(html.includes(card.rate_reference.source_url));
    assert.ok(html.includes(card.rate_reference.source_date));
    assert.match(html,/不提供费用 \/ 待遇计算/);
  }
});
test('expired and future facts are hidden, never treated as current prices',()=>{
  const water=cards.find(m=>m.id==='water');
  for(const date of ['2026-11-09','2027-02-10']) {
    const old=currentLifeModule(water,date);
    assert.equal(old.rate_reference,null);
    assert.equal(old.usable,false);
    assert.equal(old.calculator_enabled,false);
  }
  for(const patch of [{review_status:'pending_independent_review'},{redistribution_status:'link_only'}]) {
    assert.equal(currentLifeModule({...water,...patch},'2026-11-10').rate_reference,null);
  }
});
test('missing heating and non-pilot city retain an explicit gap instead of zero',()=>{
  const html=moduleCard(cards.find(m=>m.id==='heating'));
  assert.match(html,/尚未覆盖/);assert.ok(!html.includes('utility-rates'));
  const other=data.cities.find(c=>c.id==='chengdu');
  assert.equal(other.life.modules.length,0);
});
test('numeric reference descriptions are escaped',()=>{
  const card=JSON.parse(JSON.stringify(cards.find(m=>m.id==='water')));
  card.rate_reference.scope='<img src=x>';
  card.rate_reference.items[0].basis='<script>alert(1)</script>';
  const html=moduleCard(card);
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));
});
test('daily life is first in navigation and before the budget',()=>{
  const resident=app.slice(app.indexOf('  function renderResident('),app.indexOf('  function comparisonRows('));
  assert.match(resident,/\[\["daily","日常生活"\]/);
  assert.ok(resident.indexOf('${renderDaily(c)}') < resident.indexOf('${renderBudget(c)}'));
});

test('Beijing references distinguish annual comprehensive water and seasonal building-area heating',()=>{
  const beijing=JSON.parse(fs.readFileSync('data/life/utilities/beijing.json','utf8'));
  const water=beijing.find(m=>m.id==='water'), heating=beijing.find(m=>m.id==='heating');
  for(const card of [water,heating]) {
    const html=moduleCard(card);
    assert.match(html,/官方单价参考/);
    for(const item of card.rate_reference.items) {
      assert.ok(html.includes(`<strong>${item.value}</strong>`));
      assert.ok(html.includes(esc(item.unit)));
      assert.ok(html.includes(esc(item.basis)));
    }
    assert.ok(html.includes(card.rate_reference.source_url));
    assert.ok(html.includes(card.rate_reference.source_date));
    assert.match(html,/不提供费用 \/ 待遇计算/);
    for(const date of ['2026-11-09','2027-02-10']) {
      assert.equal(currentLifeModule(card,date).rate_reference,null);
    }
  }
  assert.match(moduleCard(water),/综合水价已含/);
  assert.match(moduleCard(water),/不按月重置/);
  assert.match(moduleCard(heating),/元\/建筑平方米·采暖季/);
  assert.match(moduleCard(heating),/非每月/);
});


test('Beijing power and gas render exact annual references and suppress unsafe dates or review',()=>{
  const beijing=JSON.parse(fs.readFileSync('data/life/utilities/beijing.json','utf8'));
  for(const id of ['power','gas']) {
    const card=beijing.find(m=>m.id===id), html=moduleCard(card);
    assert.match(html,/官方单价参考/);
    assert.ok(html.includes(esc(card.rate_reference.scope)));
    assert.ok(html.includes(esc(card.rate_reference.period)));
    assert.ok(html.includes(card.rate_reference.source_url));
    assert.ok(html.includes(card.rate_reference.source_date));
    assert.match(html,/不提供费用 \/ 待遇计算/);
    for(const item of card.rate_reference.items) {
      assert.equal(item.approximate,false);
      assert.ok(html.includes(`<strong>${item.value}</strong>`));
      assert.ok(html.includes(esc(item.unit)));
      assert.ok(html.includes(esc(item.basis)));
    }
    for(const date of ['2026-11-09','2027-02-10']) {
      assert.equal(currentLifeModule(card,date).rate_reference,null);
    }
    for(const patch of [{effective_to:'2026-11-09'}, {effective_from:'2026-11-11'},
                        {review_status:'pending_independent_review'}]) {
      const suppressed=currentLifeModule({...card,...patch},'2026-11-10');
      assert.equal(suppressed.rate_reference,null);
      assert.equal(suppressed.usable,false);
      assert.equal(suppressed.calculator_enabled,false);
      assert.ok(!moduleCard({...card,...patch}).includes('utility-rates'));
    }
  }
});


test('Shanghai municipal water shows annual comprehensive rates with no calculator',()=>{
  const shanghai=JSON.parse(fs.readFileSync('data/life/utilities/shanghai.json','utf8'));
  const water=shanghai.find(m=>m.id==='water'), html=moduleCard(water);
  assert.deepEqual(water.rate_reference.items.map(i=>i.value),[4.05,5.8,8.79]);
  for(const item of water.rate_reference.items) {
    assert.ok(html.includes(`<strong>${item.value}</strong>`));
    assert.ok(html.includes(esc(item.basis)));
    assert.ok(html.includes(esc(item.unit)));
  }
  for(const phrase of ['市属供排水企业服务区域','一户一表','不按月重置','综合水价已含污水处理费','新户未满年','2021-10-22']) assert.ok(html.includes(phrase));
  assert.ok(html.includes(water.rate_reference.source_url));
  assert.match(html,/不提供费用 \/ 待遇计算/);
  assert.equal(water.calculator_enabled,false);
  for(const date of ['2026-11-09','2027-02-10']) assert.equal(currentLifeModule(water,date).rate_reference,null);
  const expired={...water,effective_to:'2026-11-09'};
  assert.equal(currentLifeModule(expired,'2026-11-10').rate_reference,null);
  assert.equal(currentLifeModule(expired,'2026-11-10').calculator_enabled,false);
  for(const id of ['power','gas']) assert.ok(!moduleCard(shanghai.find(m=>m.id===id)).includes('utility-rates'));
});
