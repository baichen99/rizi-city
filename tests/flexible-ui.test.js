/* DOM-free checks complement, rather than replace, mobile browser QA. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js', 'utf8');
const data = JSON.parse(fs.readFileSync('site/data/cities.json', 'utf8'));
const start = source.indexOf('  // ---------- 自由职业 ----------');
const end = source.indexOf('  // ---------- 分享图', start);
assert.ok(start > 0 && end > start);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function details(city) {
  const context = {city, esc, money: n => String(n),
    link: (url, label) => url ? `<a href="${esc(url)}">${esc(label)}</a>` : '',
    verifiedLine: fe => `核验 ${esc(fe.verified_at)}`, yamlUrl: c => c.id + '.yaml'};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return vm.runInContext('freeDetails(city)', context);
}

test('Shenzhen pension row keeps rate scope, effective date and base evidence together', () => {
  const city = data.cities.find(c => c.id === 'shenzhen');
  const html = details(city);
  const row = html.match(/<li><span class="lbl">养老<\/span>[\s\S]*?<\/li>/)[0];
  assert.match(row, /5521/);
  assert.match(row, /2026-07-01/);
  assert.match(row, /20% 为基本养老/);
  assert.match(row, /深圳户籍养老合计比例为 21%/);
  assert.match(row, /非深户为 20%/);
  assert.match(row, /27603/);
  assert.match(row, /5510/);
  assert.ok(row.includes(city.flexible_employment.pension_base_source_url));
  assert.equal(city.flexible_employment.monthly_total_min, null);
  assert.equal(city.floor.social, null);
  assert.equal(city.flexible_employment.needs_human, true);
});

test('pension notes are escaped and optional fields do not leak placeholders', () => {
  const city = JSON.parse(JSON.stringify(data.cities.find(c => c.id === 'shenzhen')));
  city.flexible_employment.pension_note = '<img src=x onerror=alert(1)>';
  const escaped = details(city);
  assert.ok(escaped.includes('&lt;img'));
  assert.ok(!escaped.includes('<img src=x'));
  delete city.flexible_employment.pension_note;
  delete city.flexible_employment.pension_base_source_url;
  const legacy = details(city);
  assert.ok(!legacy.includes('基数依据'));
  assert.ok(!legacy.includes('undefined') && !legacy.includes('null'));
});

test('all cities keep their existing empty and populated flexible-employment paths', () => {
  for (const city of data.cities) {
    const html = details(city);
    assert.ok(!html.includes('undefined') && !html.includes('NaN'), city.id);
    if (city.flexible_employment.pension_base_min == null) assert.ok(!html.includes('class="lbl">养老</span>'), city.id);
  }
});
