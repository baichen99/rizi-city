const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const workflow = fs.readFileSync('.github/workflows/patrol-check.yml', 'utf8');
const script = workflow.split('          script: |\n')[1].split('  issue-check:')[0].split('\n').map(l => l.replace(/^ {12}/, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const execute = new AsyncFunction('context', 'github', 'core', script);
async function check(options = {}) {
  const pr = {number: 10, base: {sha:'base'}, head: {sha: 'abc', ref: 'data/test'}, body: 'Agent: codex', title: 'Update city', labels: [], changed_files: 1, ...options.pr};
  const files = options.files ?? [{filename: 'data/cities/test.yaml', patch: '@@ -1 +1 @@\n-source_url: https://old.gov.cn\n+source_url: https://new.gov.cn/a', additions: 1, deletions: 1}];
  let failure, writes = 0, calls = 0;
  const messages = [];
  const summary = {addHeading(){return this}, addRaw(message){messages.push(message);return this}, async write(){writes++}};
  const github = {rest: {pulls: {get: async () => ({data: ++calls > 1 && options.latest ? {...pr, ...options.latest} : pr}), listFiles: () => {}}}, paginate: async (_method, args) => {assert.equal(args.per_page, 100); return files}};
  await execute({payload: {pull_request: {...pr, head: {...pr.head, sha: options.eventSha ?? pr.head.sha}}}, repo: {owner:'owner', repo:'repo'}}, github, {setFailed: m => failure = m, info(){}, summary});
  if (options.expectSummary) assert.match(messages.join("\n"), options.expectSummary);
  return {failure, writes};
}
test('ordinary data branch without patrol label still checks sources', async () => assert.equal((await check()).failure, undefined));
test('missing agent fails ordinary data PR', async () => assert.match((await check({pr:{body:''}})).failure, /Agent/));
for (const url of ['https://gov.cn.evil.example/a','https://evil.example/a','https://user:pass@gov.cn/a','javascript:alert(1)']) {
  test('rejects unsafe source ' + url, async () => assert.ok((await check({files:[{filename:'data/cities/x.yaml',patch:'@@ -0,0 +1 @@\n+source_url: '+url,additions:1,deletions:0}]})).failure));
}
for (const url of ['https://gov.cn/a','https://city.gov.cn/a','https://cih-index.com/a','https://www.cih-index.com/a']) {
  test('allows existing official whitelist ' + url, async () => assert.equal((await check({files:[{filename:'data/cities/x.yaml',patch:'@@ -0,0 +1 @@\n+source_url: '+url,additions:1,deletions:0}]})).failure, undefined));
}
test('missing patch fails', async () => assert.match((await check({files:[{filename:'data/cities/x.yaml'}]})).failure,/diff/));
test('truncated hunk fails', async () => assert.ok((await check({files:[{filename:'data/cities/x.yaml',patch:'@@ -0,0 +1,2 @@\n+source_url: https://gov.cn',additions:2,deletions:0}]})).failure));
test('missing whole hunk fails totals', async () => assert.ok((await check({files:[{filename:'data/cities/x.yaml',patch:'@@ -0,0 +1 @@\n+source_url: https://gov.cn',additions:2,deletions:0}]})).failure));
test('pagination mismatch fails', async () => assert.match((await check({pr:{changed_files:2}})).failure,/文件列表/));
test('API limit fails', async () => assert.match((await check({pr:{changed_files:3001}})).failure,/上限/));
test('renamed city cannot evade check', async () => assert.ok((await check({files:[{filename:'archive/x.yaml',previous_filename:'data/cities/x.yaml'}]})).failure));
test('unrelated PR skips', async () => assert.deepEqual(await check({pr:{changed_files:0,body:''},files:[]}),{failure:undefined,writes:0}));
test('patrol title still enforces agent without data files', async () => assert.ok((await check({pr:{changed_files:0,title:'巡检',body:''},files:[]})).failure));
test('stale event fails', async () => assert.match((await check({eventSha:'old'})).failure,/过期/));
test('edit during check fails', async () => assert.match((await check({latest:{body:'changed'}})).failure,/已更新/));
test('workflow has no privileged PR trigger or PR writes', () => {
  const pr = workflow.split('  issue-check:')[0];
  assert.doesNotMatch(pr,/^  pull_request_target:|^  workflow_run:/m);
  assert.doesNotMatch(pr,/issues: write|pull-requests: write|actions\/checkout/);
  assert.match(workflow,/issue-check:\n    if: github.event_name == 'issues'/);
  assert.match(workflow,/issues: write/);
});
const issueScript = workflow.split('          script: |\n')[2].split('\n').map(l => l.replace(/^ {12}/, '')).join('\n');
async function issueCheck(body) {
  const calls = {labels:[],comments:[]};
  await new AsyncFunction('context','github','core',issueScript)(
    {eventName:'issues',payload:{issue:{number:1,body,labels:[{name:'agent-patrol'}]}},repo:{owner:'o',repo:'r'}},
    {rest:{issues:{addLabels:async x=>calls.labels.push(x.labels),createComment:async x=>calls.comments.push(x.body)}}},
    {info(){},warning(){}}
  );
  return calls;
}
test('Issue retains successful agent labeling without comment', async () => {
  const result = await issueCheck('### agent 名称\nCodex\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
  assert.deepEqual(result.labels,[['agent-patrol','agent:codex']]); assert.equal(result.comments.length,0);
});
test('Issue retains needs-source label and problem comment', async () => {
  const result = await issueCheck('Agent: codex\nsource_url: https://evil.example');
  assert.ok(result.labels[0].includes('needs-source')); assert.equal(result.comments.length,1);
});

test('base update during check fails', async () => assert.match((await check({latest:{base:{sha:'new-base'}}})).failure,/已更新/));
test('label update during check fails', async () => assert.match((await check({latest:{labels:[{name:'agent-patrol'}]}})).failure,/已更新/));
test('label reordering is not a change', async () => assert.equal((await check({pr:{labels:[{name:'x'},{name:'y'}]},latest:{labels:[{name:'y'},{name:'x'}]}})).failure,undefined));
test('valid deletion explicitly requires human verification in summary', async () => assert.equal((await check({files:[{filename:'data/cities/x.yaml',patch:'@@ -1 +0,0 @@\n-source_url: https://gov.cn',additions:0,deletions:1}],expectSummary:/未发现新增来源 URL，仍需人工核实/})).failure,undefined));
test('rename without patch fails for manual review', async () => assert.match((await check({files:[{filename:'data/cities/new.yaml',previous_filename:'data/cities/old.yaml',status:'renamed',additions:0,deletions:0}]})).failure,/人工复核/));


const signedBodies = [
  ['维护助手 Muse（agent:muse）补录。', 'agent:muse'],
  ['维护助手：Muse（agent：muse）', 'agent:muse'],
  ['维护助手 dots (agent: dots)', 'agent:dots'],
  ['- 维护助手 Claude Code (agent: claude code)', 'agent:claude-code'],
  ['正文\n维护助手 Muse（AGENT: MUSE）\n其他内容', 'agent:muse'],
  ['维护助手 Other（agent:new-helper）', 'agent:other'],
];
const unsignedBodies = [
  '正文讨论（agent:muse）格式，并非署名。',
  '请参考维护助手 Muse（agent:muse）的历史提交。',
  '> 维护助手 Muse（agent:muse）补录。',
  '`维护助手 Muse（agent:muse）`',
  '```text\n维护助手 Muse（agent:muse）\n```',
  '~~~text\n维护助手 Muse（agent:muse）\n~~~',
  '````text\n```\n维护助手 Muse（agent:muse）\n````',
  '- ```text\n  维护助手 Muse（agent:muse）\n  ```',
  '1. ```text\n   维护助手 Muse（agent:muse）\n   ```',
  '```text\n- ```\n维护助手 Muse（agent:muse）\n```',
  '    维护助手 Muse（agent:muse）',
  '维护助手 Muse（agent:muse)',
  '维护助手 Muse(agent:muse）',
  '维护助手 Muse（agent:\nmuse）',
  '维护助手 Muse（agent:）',
  '维护助手（agent:muse）',
];
for (const [body, label] of signedBodies) {
  test('explicit parenthetical signature works in PR and Issue: ' + body, async () => {
    assert.equal((await check({pr:{body}})).failure, undefined);
    const result = await issueCheck(body + '\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
    assert.deepEqual(result.labels, [['agent-patrol', label]]);
    assert.equal(result.comments.length, 0);
  });
}
for (const body of unsignedBodies) {
  test('parenthetical mention is not a signature in PR or Issue: ' + body, async () => {
    assert.match((await check({pr:{body}})).failure, /Agent/);
    const result = await issueCheck(body + '\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
    assert.ok(result.labels[0].includes('needs-source'));
    assert.ok(!result.labels[0].some(label => label.startsWith('agent:')));
    assert.match(result.comments[0], /agent 名称/);
  });
}
test('parenthetical signature does not override explicit Agent field', async () => {
  const result = await issueCheck('Agent: dots\n维护助手 Muse（agent:muse）\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
  assert.deepEqual(result.labels, [['agent-patrol', 'agent:dots']]);
});
test('signature after a fenced example is still read', async () => {
  const body = '```text\n维护助手 Other（agent:other）\n```\n维护助手 Muse（agent:muse）';
  const result = await issueCheck(body + '\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
  assert.deepEqual(result.labels, [['agent-patrol', 'agent:muse']]);
});

test('signature after a list fenced example is still read', async () => {
  const body = '- ```text\n  维护助手 Other（agent:other）\n  ```\n维护助手 Muse（agent:muse）';
  const result = await issueCheck(body + '\n```yaml\nitems:\n  source_url: https://city.gov.cn/a\n```');
  assert.deepEqual(result.labels, [['agent-patrol', 'agent:muse']]);
});
