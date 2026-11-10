// No dependencies: exercise the production render/event code with a minimal DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(process.env.CIVIL_DATA || path.join(root, 'site/data/cities.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'site/app.js'), 'utf8');
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function boot(input) {
  const nodes = new Map(), handlers = {};
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {innerHTML:'', querySelectorAll:()=>[], hidden:false,
      addEventListener(){}, setAttribute(){}});
    return nodes.get(key);
  };
  const document = {querySelector:node, querySelectorAll:()=>[], addEventListener:(k,v)=>handlers[k]=v};
  vm.runInNewContext(source, {document, window:{RIZI_DATA:input, addEventListener(){}},
    location:{hash:'#civil'}, history:{replaceState(){}, pushState(){}}, URLSearchParams, console});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!node('#meta').textContent, 'load must not fail');
  return {html:()=>node('#tab-civil').innerHTML,
    click:dataset=>handlers.click({target:{closest:()=>({dataset, classList:{contains:()=>false}})}})};
}
(async () => {
  const app = await boot(data);
  const html = app.html();
  assert.equal((html.match(/data-civil-city=/g)||[]).length, data.cities.length);
  const covered = data.cities.filter(c=>c.civil_service && (c.civil_service.fresh_grad_rule||c.civil_service.exam_schedule||c.civil_service.treatment)).length;
  assert.ok(html.includes(`已收录 ${covered} / ${data.cities.length}`));
  assert.ok(!html.includes('还在采集中（0 /'));
  assert.ok(html.includes('历史批次不是可报名机会'));
  assert.ok(html.includes('国考、省考（含直辖市市考）和事业单位招聘'));
  for (const c of data.cities) {
    const fragment = html.split(`data-civil-city="${c.id}"`)[1].split('</details>')[0];
    assert.ok(fragment.includes(escape(c.city)));
    for (const key of ['fresh_grad_rule','exam_schedule','treatment','announcement_url','source_url','verified_at','needs_human_reason']) {
      if(c.civil_service?.[key]) assert.ok(fragment.includes(escape(c.civil_service[key])), `${c.city}: ${key}`);
    }
  }
  const current = String(data.national.civil_service.fresh_grad.current_class);
  app.click({civil:'year',val:current});
  assert.ok(app.html().includes('你就是这次国考的应届生'));
  app.click({civil:'year',val:String(data.national.civil_service.fresh_grad.choose_job_years[0])});
  assert.ok(app.html().includes('再回答几个问题'));
  for (const [civil,val] of [['contract','no'],['social','no'],['files','school']]) app.click({civil,val});
  assert.ok(app.html().includes('按国家规则，你大概率还算应届'));
  app.click({tab:'civil'});
  assert.equal((app.html().match(/data-civil-city=/g)||[]).length, data.cities.length);
  const synthetic = structuredClone(data);
  synthetic.cities[0].civil_service = {treatment:'待遇 <script> & 未核实',needs_human:true,needs_human_reason:'原因 <img>',access_blocked:true};
  synthetic.cities[1].civil_service = {};
  delete synthetic.cities[2].civil_service;
  const edge = (await boot(synthetic)).html();
  assert.ok(edge.includes('待遇 &lt;script&gt; &amp; 未核实'));
  assert.ok(!edge.includes('<script>'));
  assert.ok(edge.includes('尚未核实，不代表没有相关政策或公告。'));
  assert.ok(edge.includes('部分官网访问受限'));
  const empty = edge.split(`data-civil-city="${synthetic.cities[1].id}"`)[1].split('</details>')[0];
  assert.ok(!empty.includes('undefined') && !empty.includes('null'));
  console.log(`PASS: ${data.cities.length} cities; ${covered} covered; fields, sources, missing data, escaping, national self-check and repeated navigation`);
})().catch(error => {console.error(error); process.exitCode=1;});
