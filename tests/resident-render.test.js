/* DOM-free rendering smoke tests. These do not replace visual browser QA. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js', 'utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json', 'utf8'));
const start = source.indexOf('  // ---------- 居民城市主页');
const end = source.indexOf('  // ---------- 日子指数 ----------', start);
assert.ok(start > 0 && end > start);
function renderer(payload = data) {
  const elements = {};
  const controls = ['#resident-city', '#compare-a', '#compare-b'];
  function element(selector) {
    if (controls.includes(selector)) return elements[selector] || null;
    if (!elements[selector]) {
      let html = '';
      elements[selector] = {
        get innerHTML() { return html; },
        set innerHTML(value) {
          html = value;
          // Only model shell creation. Real DOM continuity belongs to browser QA.
          for (const id of controls) if (html.includes(`id="${id.slice(1)}"`)) {
            elements[id] ||= {innerHTML: '', value: ''};
          }
        },
      };
    }
    return elements[selector];
  }
  const state = {residentCity: '', compareA: '', compareB: '', policyTopic: 'all'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context = {D: payload, state, Date, Number, String, Set, Map, JSON, URL,
    REPO: 'https://github.com/baichen99/rizi-city', METHOD_URL: 'https://example.org/method',
    esc, link: (url,label) => `<a href="${esc(url)}">${esc(label)}</a>`,
    yamlUrl: c => `https://example.org/${c.id}.yaml`,
    $: element,
    localStorage: {getItem: () => null},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end), context);
  return {state, elements, html: () => Object.values(elements).map(el => el.innerHTML).join(""), run: name => vm.runInContext(name + '()', context)};
}

test('all 20 resident pages and policy filters render with original scope warnings', () => {
  const r = renderer();
  assert.equal(data.cities.length,20);
  for (const city of data.cities) {
    r.state.residentCity = city.id;
    for (const topic of ['all','hukou','subsidy','social']) {
      r.state.policyTopic = topic; r.run('renderResident');
      const html = r.html();
      assert.ok(html.includes(city.city), city.id);
      assert.ok(html.includes('不是全体居民政策库'), city.id);
      assert.ok(html.includes('政策原文不等于申办页面') || html.includes('该主题尚未覆盖已核实事项'), city.id);
      assert.ok(!html.includes('NaN') && !html.includes('undefined'), city.id);
    }
  }
});

test('all city-pair comparison render paths stay finite and include disclosure', () => {
  const r = renderer();
  for (const a of data.cities) for (const b of data.cities) {
    r.state.compareA=a.id; r.state.compareB=b.id; r.run('renderCompare');
    const html=r.html();
    assert.ok(!html.includes('NaN') && !html.includes('undefined'), `${a.id}/${b.id}`);
    assert.ok(html.includes(a===b ? '两座不同的城市' : '所有维度都列出来'));
  }
});

test('empty and unknown city remain explicit selection states', () => {
  const r=renderer();
  for (const city of ['', 'not-a-city']) {
    r.state.residentCity=city; r.run('renderResident');
    assert.ok(r.html().includes('选择城市后查看'));
  }
});

test('city and source text are escaped, not executable markup', () => {
  const fixture=JSON.parse(JSON.stringify(data));
  fixture.cities[0].city='<img src=x onerror=alert(1)>';
  const r=renderer(fixture);r.state.residentCity=fixture.cities[0].id;r.run('renderResident');
  const html=r.html();
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
});
