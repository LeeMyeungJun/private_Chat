const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const VERSION = '2026.10.0';
const SHA256 = '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c';
async function ensureCloudflared(root, onProgress = () => {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('현재 자동 설치는 Windows 64비트를 지원합니다.');
  const tools = path.join(root, '.tools');
  const executable = path.join(tools, 'cloudflared.exe');
  await fs.mkdir(tools, { recursive: true });
  try {
    const bytes = await fs.readFile(executable);
    if (createHash('sha256').update(bytes).digest('hex') === SHA256) return executable;
  } catch { /* First launch downloads the vendor release. */ }
  onProgress('최초 실행 준비 중 · 외부 연결 모듈을 다운로드하고 있어요.');
  const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('외부 연결 모듈을 다운로드하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== SHA256) throw new Error('외부 연결 모듈의 무결성 확인에 실패했습니다.');
  const temporary = executable + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, executable);
  return executable;
}
module.exports = { ensureCloudflared, VERSION, SHA256 };
if (require.main === module) ensureCloudflared(path.resolve(__dirname, '..'), text => console.log(text)).then(executable => console.log('Cloudflare connector ready: ' + executable)).catch(error => { console.error(error.message); process.exitCode = 1; });
