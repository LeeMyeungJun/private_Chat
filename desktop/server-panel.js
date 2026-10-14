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
let announcementId, announcementSignature;
$('announcement-form').addEventListener('submit', async event => {
  event.preventDefault(); $('announce').disabled = true; $('announcement-result').textContent = '공지를 게시하고 있습니다…';
  const payload = { title: $('announcement-title').value.trim(), body: $('announcement-body').value.trim() };
  const signature = JSON.stringify(payload);
  if (signature !== announcementSignature) { announcementSignature = signature; announcementId = crypto.randomUUID(); }
  try {
    const result = await window.moeumHost.announce({ ...payload, clientId: announcementId });
    if (result.error) throw new Error(result.error);
    $('announcement-result').textContent = result.pushSent ? '채팅 공지를 게시하고 모바일 알림을 발송했습니다.' : '채팅 공지는 게시했습니다. 모바일 알림: ' + result.warning;
    $('announcement-form').reset(); announcementId = announcementSignature = undefined;
  } catch (error) { $('announcement-result').textContent = error.message; }
  finally { $('announce').disabled = false; }
});
window.moeumHost.onStatus(update);
window.moeumHost.onInvite(() => $('invite').click());
action(async () => update(await window.moeumHost.info()));
