const $ = id => document.getElementById(id);
function update(info) {
  $('local-url').textContent = info.localUrl;
  $('share-status').textContent = info.shareStatus;
  $('public-url').textContent = info.publicUrl || (info.sharingBusy ? '주소 생성 중…' : '외부 접속 주소 없음');
  $('public-badge').textContent = info.publicUrl ? '접속 가능' : info.sharingBusy ? '연결 중' : '연결 대기';
  $('public-badge').classList.toggle('ready', Boolean(info.publicUrl));
  $('invite').disabled = !info.publicUrl;
  $('retry').hidden = Boolean(info.publicUrl) || info.sharingBusy;
}
async function action(callback) {
  $('panel-error').textContent = '';
  try { await callback(); } catch (error) { $('panel-error').textContent = error.message; }
}
$('invite').addEventListener('click', () => action(() => window.moeumHost.invite()));
$('retry').addEventListener('click', () => action(async () => update(await window.moeumHost.retrySharing())));
$('stop-server').addEventListener('click', () => action(() => window.moeumHost.quitServer()));
window.moeumHost.onStatus(update);
window.moeumHost.onInvite(() => $('invite').click());
action(async () => update(await window.moeumHost.info()));
