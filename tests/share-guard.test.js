const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('site/app.js', 'utf8');
const start = source.indexOf('  function openShare(');
const end = source.indexOf('  // ---------- 渲染与事件', start);
function run(kind, total) {
  const elements = {}, messages = [], generated = [];
  const canvas = {toDataURL: () => 'data:image/png;base64,fixture'};
  const context = {state:{myCity:'beijing'},
    computeIndex: () => ({ranked:[{c:{id:'beijing'},total}]}),
    toast: message => messages.push(message),
    $: id => elements[id] ||= {innerHTML:'',hidden:true,focus:()=>{}},
    shareGrad: () => canvas,
    shareMyCity: () => {generated.push('mycity');return canvas;},
    shareTop5: () => {generated.push('top5');return canvas;},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  context.openShare(kind);
  return {messages,generated,elements};
}
test('unscored city and empty ranking show a message rather than build a broken share', () => {
  for(const kind of ['mycity','top5']) {
    const result=run(kind,null);
    assert.equal(result.generated.length,0);
    assert.equal(result.messages.length,1);
    assert.match(result.messages[0],/权重/);
  }
});
test('a valid score of zero is still shareable', () => {
  for(const kind of ['mycity','top5']) {
    const result=run(kind,0);
    assert.deepEqual(result.generated,[kind]);
    assert.equal(result.messages.length,0);
    assert.equal(result.elements['#sheet'].hidden,false);
  }
});
