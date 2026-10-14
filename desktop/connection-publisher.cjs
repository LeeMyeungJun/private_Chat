// A separate public branch contains only a URL and a boot identifier.
// No checkout, staging area, chat data or credentials are modified/published.
const { spawn } = require('node:child_process');
const REMOTE = 'https://github.com/LeeMyeungJun/private_Chat.git';
function git(root, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, ...args], { windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', value => out += value);
    child.stderr.on('data', value => err += value);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err || 'Git publishing failed')); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
async function publishConnection(root, address, instanceId) {
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(address) || !/^[0-9a-f-]{36}$/.test(instanceId)) throw new Error('Invalid connection descriptor');
  const refs = await git(root, ['ls-remote', REMOTE, 'refs/heads/connection']);
  let parent = '';
  if (refs) {
    await git(root, ['fetch', '--quiet', '--no-tags', REMOTE, 'refs/heads/connection']);
    parent = await git(root, ['rev-parse', 'FETCH_HEAD']);
  }
  const blob = await git(root, ['hash-object', '-w', '--stdin'], JSON.stringify({ version: 1, url: address, instanceId, updatedAt: new Date().toISOString() }) + '\n');
  const tree = await git(root, ['mktree'], `100644 blob ${blob}\tconnection.json\n`);
  const commit = await git(root, ['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'Update MainPC connection address\n');
  await git(root, ['push', '--quiet', REMOTE, `${commit}:refs/heads/connection`]);
  return commit;
}
module.exports = { publishConnection };
