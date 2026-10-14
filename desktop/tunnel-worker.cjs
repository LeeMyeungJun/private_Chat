const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ensureCloudflared } = require('./cloudflared.cjs');
let connector, stopping = false, started = false, addressFile, publicUrl = '', registered = false, sentReady = false, output = '';
const send = message => { if (process.connected && !stopping) process.send(message, () => {}); };
function stop() {
  if (stopping) return;
  stopping = true;
  removeOwnAddress();
  if (connector && connector.exitCode === null) {
    connector.once('exit', () => process.exit(0)); connector.kill();
    setTimeout(() => process.exit(0), 3000).unref();
  } else process.exit(0);
}
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
function removeOwnAddress() {
  if (!addressFile || !publicUrl) return;
  try { if (fs.readFileSync(addressFile, 'utf8').trim() === publicUrl) fs.unlinkSync(addressFile); } catch { /* Already removed by the desktop. */ }
}
process.on('exit', removeOwnAddress);
process.on('message', async message => {
  if (message?.type === 'stop') { stop(); return; }
  if (message?.type !== 'start' || started) return;
  started = true;
  addressFile = message.addressFile;
  try {
    const executable = await ensureCloudflared(message.root, text => send({ type: 'status', text }));
    if (stopping || !process.connected) return stop();
    const config = path.join(message.root, '.tools', 'quick-tunnel.yml');
    fs.writeFileSync(config, '# Dedicated empty configuration for anonymous Quick Tunnels.\n');
    send({ type: 'status', text: '외부 접속 주소를 생성하고 있어요.' });
    connector = spawn(executable, ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2', '--url', message.localUrl], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    send({ type: 'pid', pid: connector.pid });
    const timeout = setTimeout(() => { send({ type: 'error', text: '외부 연결 시간이 초과됐습니다. 인터넷 연결을 확인하고 다시 연결해 주세요.' }); stop(); }, 90000);
    function inspect(data) {
      output = (output + data.toString()).slice(-16000);
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
      if (match) publicUrl = match[0];
      if (output.includes('Registered tunnel connection')) registered = true;
      if (publicUrl && registered && !sentReady) { sentReady = true; clearTimeout(timeout); send({ type: 'ready', url: publicUrl }); }
    }
    connector.stdout.on('data', inspect); connector.stderr.on('data', inspect);
    connector.on('error', error => { clearTimeout(timeout); send({ type: 'error', text: '외부 연결 모듈 실행 실패: ' + error.code }); stop(); });
    connector.on('exit', code => { clearTimeout(timeout); if (!stopping) send({ type: 'error', text: '외부 연결이 종료되었습니다. 다시 연결을 눌러 주세요.' }); process.exit(code || 0); });
  } catch (error) { send({ type: 'error', text: error.message }); stop(); }
});
