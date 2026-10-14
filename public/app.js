const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('client') === 'android') document.body.classList.add('android-theme');
const state = { user: null, socket: null, messages: new Map(), files: [], pending: null, busy: false, hasMore: false, dragDepth: 0, maxSize: 50 * 1024 * 1024 };
const mobileView = matchMedia('(max-width:760px), (max-width:1000px) and (max-height:500px)');
let activePanel = null, panelTrigger = null, viewportFrame = 0, fullViewportHeight = 0, viewportWidth = 0;
function syncViewport() {
  cancelAnimationFrame(viewportFrame);
  const stick = state.user && nearBottom();
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    if (!viewport || Math.abs(viewport.scale - 1) < .05) {
      const height = viewport?.height || innerHeight;
      const width = viewport?.width || innerWidth;
      const editing = document.activeElement?.matches('input,textarea');
      if (Math.abs(width - viewportWidth) > 40 || !editing || height > fullViewportHeight) fullViewportHeight = height;
      viewportWidth = width;
      document.body.classList.toggle('keyboard-open', Boolean(state.user && editing && fullViewportHeight - height > 120));
      document.documentElement.style.setProperty('--app-height', height + 'px');
      document.documentElement.style.setProperty('--app-top', (viewport?.offsetTop || 0) + 'px');
      if (stick) scrollBottom();
    }
  });
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
window.addEventListener('resize', syncViewport);
mobileView.addEventListener('change', () => { closePanel(); syncViewport(); });
function updateSendButton() { $('send-button').disabled = state.busy || !state.socket?.connected || (!state.pending && !$('message-input').value.trim() && !state.files.length); }
function syncPanels() {
  const modal = mobileView.matches && Boolean(activePanel);
  $('sidebar').classList.toggle('open', activePanel === 'members');
  $('file-drawer').hidden = activePanel !== 'files';
  $('panel-backdrop').hidden = !modal;
  document.querySelector('.chat-main').inert = modal;
  $('sidebar').inert = modal && activePanel !== 'members';
  for (const [kind, id, label] of [['members', 'sidebar', '함께 있는 사람'], ['files', 'file-drawer', '공유 파일']]) {
    const panel = $(id);
    if (modal && activePanel === kind) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', label); }
    else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
  }
  $('menu-button').setAttribute('aria-expanded', String(activePanel === 'members'));
  $('files-button').setAttribute('aria-expanded', String(activePanel === 'files'));
}
function closePanel({ back = true, restore = true } = {}) {
  const wasOpen = Boolean(activePanel); activePanel = null; syncPanels();
  if (restore && wasOpen) panelTrigger?.focus({ preventScroll: true });
  if (back && wasOpen && history.state?.moeumPanel) history.back();
}
function togglePanel(kind, trigger) {
  if (activePanel === kind) return closePanel();
  if (mobileView.matches && !activePanel && !history.state?.moeumPanel) history.pushState({ ...history.state, moeumPanel: true }, '');
  activePanel = kind; panelTrigger = trigger;
  if (mobileView.matches) document.activeElement?.blur();
  syncPanels();
  if (mobileView.matches) $(kind === 'members' ? 'members-close' : 'files-close').focus({ preventScroll: true });
}
window.addEventListener('popstate', () => closePanel({ back: false }));
document.addEventListener('keydown', event => {
  if (!activePanel) return;
  if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
  if (event.key !== 'Tab' || !mobileView.matches) return;
  const panel = $(activePanel === 'members' ? 'sidebar' : 'file-drawer');
  const controls = [...panel.querySelectorAll('button:not(:disabled), a[href], input, [tabindex="0"]')].filter(node => node.getClientRects().length);
  const target = event.shiftKey ? controls.at(-1) : controls[0];
  if ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls.at(-1))) { event.preventDefault(); target?.focus(); }
});
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function bytes(size) { return size < 1024 ? size + ' B' : size < 1024 ** 2 ? (size / 1024).toFixed(1) + ' KB' : (size / 1024 ** 2).toFixed(1) + ' MB'; }
function initials(name) { return Array.from(name).slice(0, 2).join(''); }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 3500); }
async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && state.user) showLogin(); throw new Error(data.error || '요청에 실패했습니다.'); }
  return data;
}
function showLogin() {
  state.socket?.disconnect(); state.socket = null; state.user = null;
  closePanel({ restore: false }); document.body.classList.remove('chat-active');
  $('workspace').hidden = true; $('login').hidden = false;
  if (!mobileView.matches) $('nickname').focus();
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter || $('login-form').querySelector('button[type="submit"]'); button.disabled = true; $('login-error').textContent = '';
  try {
    const { user } = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: $('nickname').value }) });
    try { localStorage.setItem('moeum-nickname', user.nickname); } catch { /* Optional nickname memory. */ }
    enter(user);
  } catch (error) { $('login-error').textContent = error.message; } finally { button.disabled = false; }
});
function enter(user) {
  state.user = user; state.messages.clear(); state.pending = null; state.files.forEach(file => URL.revokeObjectURL(file.preview)); state.files = [];
  $('message-list').replaceChildren(); $('message-input').value = ''; $('send-error').hidden = true; renderPreviews();
  $('login').hidden = true; $('workspace').hidden = false;
  document.body.classList.add('chat-active'); closePanel({ restore: false }); syncViewport();
  $('profile-name').textContent = user.nickname; $('profile-avatar').textContent = initials(user.nickname);
  $('file-drawer').hidden = true; $('search-bar').hidden = true; $('search-input').value = '';
  const socket = io({ autoConnect: false }); state.socket = socket;
  socket.on('connect', async () => {
    updateSendButton();
    $('connection').textContent = '연결됨 · 함께 이야기해요'; $('connection').classList.add('online'); $('reconnect-banner').hidden = true;
    try {
      if (!state.messages.size) { const data = await api('/api/messages'); data.messages.forEach(message => state.messages.set(message.id, message)); state.hasMore = data.hasMore; renderMessages(true); }
      else {
        let after = Math.max(...[...state.messages.values()].map(m => m.seq));
        let more = true;
        while (more) {
          const data = await api('/api/messages?after=' + after + '&limit=500');
          data.messages.forEach(addMessage); more = data.hasMore; after = data.messages.at(-1)?.seq || after;
        }
      }
      refreshFiles();
    } catch (error) { toast(error.message); }
  });
  socket.on('disconnect', reason => {
    updateSendButton();
    $('connection').textContent = '연결을 기다리는 중'; $('connection').classList.remove('online'); $('reconnect-banner').hidden = false;
    if (reason === 'io server disconnect') showLogin();
  });
  socket.on('connect_error', error => {
    if (error.message === 'AUTH_REQUIRED') { showLogin(); $('login-error').textContent = '서버가 재시작되었거나 입장이 만료되었습니다. 다시 입장해 주세요.'; }
  });
  socket.on('message', addMessage);
  socket.on('presence', users => {
    $('member-count').textContent = users.length; $('members').replaceChildren();
    for (const member of users) {
      const row = element('div', 'member'); row.append(element('span', 'avatar', initials(member.nickname)));
      const info = element('div'); const name = element('strong', '', member.nickname);
      if (member.id === state.user?.id) name.append(element('span', 'you-tag', '나'));
      info.append(name, element('small', '', '온라인')); row.append(info, element('span', 'small-dot')); $('members').append(row);
    }
  });
  const typingUsers = new Map();
  socket.on('typing', user => {
    typingUsers.set(user.id, { name: user.nickname, until: Date.now() + 2600 });
    updateTyping();
  });
  function updateTyping() {
    clearTimeout(updateTyping.timer);
    for (const [id, user] of typingUsers) if (user.until < Date.now()) typingUsers.delete(id);
    $('typing').textContent = [...typingUsers.values()].map(u => u.name).slice(0, 3).join(', ') + (typingUsers.size ? ' 님이 입력 중이에요…' : '');
    if (typingUsers.size) updateTyping.timer = setTimeout(updateTyping, 700);
  }
  socket.connect(); if (!mobileView.matches) $('message-input').focus();
}
function nearBottom() { return $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 110; }
function scrollBottom() { $('messages').scrollTop = $('messages').scrollHeight; $('new-messages').hidden = true; }
function addMessage(message) {
  if (state.messages.has(message.id)) return;
  const stick = nearBottom() || message.userId === state.user?.id;
  state.messages.set(message.id, message); renderMessages(stick);
  if (!stick) $('new-messages').hidden = false;
  if (message.attachments.length) refreshFiles();
}
function fileCard(file) {
  const link = element('a', 'file-card'); link.href = '/files/' + file.id + '?download=1'; link.download = file.name;
  const badge = element('span', 'file-type'); badge.append(icon('file'));
  const details = element('span', 'file-details'); details.append(element('strong', '', file.name), element('small', '', bytes(file.size) + (file.media && !file.inlinePlayable ? ' · ' + (file.duration > 600 ? '10분 초과 · 다운로드' : '첨부파일 다운로드') : ' · 다운로드')));
  link.append(badge, details, icon('download')); return link;
}
function mediaCard(file) {
  const card = element('div', 'media-card ' + file.media + '-card');
  const header = element('div', 'media-header'), badge = element('span', 'file-type'); badge.append(icon(file.media === 'video' ? 'photo' : 'audio'));
  const details = element('div', 'file-details');
  const minutes = Math.floor(file.duration / 60), seconds = String(Math.floor(file.duration % 60)).padStart(2, '0');
  details.append(element('strong', '', file.name), element('small', '', `${minutes}:${seconds} · ${bytes(file.size)}`));
  const download = element('a', 'icon-button'); download.href = '/files/' + file.id + '?download=1'; download.download = file.name; download.setAttribute('aria-label', file.name + ' 다운로드'); download.append(icon('download'));
  header.append(badge, details, download); card.append(header);
  const player = element(file.media === 'video' ? 'video' : 'audio', 'media-player');
  player.controls = true; player.preload = 'none'; player.src = '/files/' + file.id;
  player.setAttribute('aria-label', file.name + ' 재생');
  if (file.media === 'video') player.playsInline = true;
  player.addEventListener('play', () => document.querySelectorAll('audio,video').forEach(other => { if (other !== player) other.pause(); }));
  player.addEventListener('error', () => { if (!card.querySelector('.media-error')) card.append(element('p', 'media-error', '이 브라우저에서 재생할 수 없습니다. 다운로드해서 들어 주세요.')); });
  card.append(player); return card;
}
function renderMessages(stick = false) {
  const container = $('messages'); const oldTop = container.scrollTop;
  const list = $('message-list');
  const existing = new Map([...list.children].filter(node => node.dataset.messageId).map(node => [node.dataset.messageId, node]));
  const dates = new Map([...list.children].filter(node => node.dataset.date).map(node => [node.dataset.date, node]));
  const desired = [];
  const query = $('search-input').value.trim().toLocaleLowerCase();
  const sorted = [...state.messages.values()].sort((a, b) => a.seq - b.seq);
  $('workspace').classList.toggle('has-messages', sorted.length > 0);
  let previousDate = '', found = 0;
  for (const message of sorted) {
    if (query && ![message.text, message.nickname, ...message.attachments.map(f => f.name)].join(' ').toLocaleLowerCase().includes(query)) continue;
    found++;
    const created = new Date(message.createdAt);
    const day = created.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    if (day !== previousDate) { const divider = dates.get(day) || element('div', 'date-divider', day); divider.dataset.date = day; desired.push(divider); previousDate = day; }
    if (existing.has(message.id)) { desired.push(existing.get(message.id)); continue; }
    const row = element('article', 'message' + (message.userId === state.user?.id ? ' mine' : ''));
    row.dataset.messageId = message.id;
    row.append(element('span', 'avatar', initials(message.nickname)));
    const body = element('div', 'message-body'), meta = element('div', 'message-meta');
    const time = element('time', '', created.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })); time.dateTime = message.createdAt;
    meta.append(element('strong', '', message.nickname), time); body.append(meta);
    if (message.text) body.append(element('div', 'bubble', message.text));
    if (message.attachments.length) {
      const attachments = element('div', 'message-attachments');
      for (const file of message.attachments) {
        if (file.inlinePlayable && file.media) { attachments.append(mediaCard(file)); continue; }
        if (!file.image) { attachments.append(fileCard(file)); continue; }
        const button = element('button', 'image-attachment'); button.type = 'button'; button.setAttribute('aria-label', file.name + ' 확대');
        const image = element('img'); image.src = '/files/' + file.id; image.alt = file.name; image.loading = 'lazy';
        image.addEventListener('load', () => { if (stick && nearBottom()) scrollBottom(); }, { once: true });
        const caption = element('span', 'image-caption'); caption.append(element('span', '', file.name), element('span', '', bytes(file.size)));
        button.append(image, caption); button.addEventListener('click', () => openImage(file)); attachments.append(button);
      }
      body.append(attachments);
    }
    row.append(body); desired.push(row);
  }
  // Keep existing media nodes in place so incoming messages do not stop playback.
  desired.forEach((node, index) => { if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null); });
  const keep = new Set(desired); [...list.children].forEach(node => { if (!keep.has(node)) node.remove(); });
  $('older').hidden = !state.hasMore || Boolean(query);
  $('search-count').textContent = query ? found + '개' : '';
  $('search-empty').hidden = !query || found > 0;
  if (stick) scrollBottom(); else container.scrollTop = oldTop;
}
$('older').addEventListener('click', async () => {
  const button = $('older'); button.disabled = true;
  const oldHeight = $('messages').scrollHeight, oldTop = $('messages').scrollTop;
  try {
    const before = Math.min(...[...state.messages.values()].map(m => m.seq));
    const data = await api('/api/messages?before=' + before); data.messages.forEach(m => state.messages.set(m.id, m)); state.hasMore = data.hasMore;
    renderMessages(); $('messages').scrollTop = oldTop + $('messages').scrollHeight - oldHeight;
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
$('messages').addEventListener('scroll', () => { if (nearBottom()) $('new-messages').hidden = true; });
$('new-messages').addEventListener('click', scrollBottom);
function openImage(file) {
  $('large-image').src = '/files/' + file.id; $('large-image').alt = file.name;
  $('image-download').href = '/files/' + file.id + '?download=1'; $('image-download').download = file.name; $('image-dialog').showModal();
}
$('image-close').addEventListener('click', () => $('image-dialog').close());
$('image-dialog').addEventListener('click', event => { if (event.target === $('image-dialog')) $('image-dialog').close(); });
async function refreshFiles() {
  if (!state.user) return;
  try {
    const { files } = await api('/api/files'); $('file-count').textContent = files.length; $('shared-files').replaceChildren();
    if (!files.length) $('shared-files').append(element('p', 'drawer-empty', '아직 공유한 파일이 없어요.\n첫 번째 파일을 나눠 보세요.'));
    for (const file of files) {
      const item = element('div', 'shared-file'); item.append(fileCard(file), element('small', '', file.nickname + ' · ' + new Date(file.createdAt).toLocaleDateString('ko-KR'))); $('shared-files').append(item);
    }
  } catch (error) { if (state.user) toast(error.message); }
}
function addFiles(files) {
  if (state.busy || state.pending) { toast('진행 중인 전송을 완료한 후 첨부해 주세요.'); return; }
  for (const file of files) {
    if (state.files.length >= 10) { toast('한 번에 10개까지 첨부할 수 있어요.'); break; }
    if (file.size > state.maxSize) { toast(file.name + ': 파일당 최대 50MB까지 가능해요.'); continue; }
    if (state.files.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
    state.files.push({ file, preview: ['image/png','image/jpeg','image/webp','image/gif'].includes(file.type) ? URL.createObjectURL(file) : null });
  }
  renderPreviews();
}
function renderPreviews() {
  updateSendButton();
  const container = $('attachment-preview'); container.replaceChildren(); container.hidden = !state.files.length;
  state.files.forEach((item, index) => {
    const row = element('div', 'preview-item');
    if (item.preview) { const image = element('img'); image.src = item.preview; image.alt = item.file.name; row.append(image); } else row.append(icon('file'));
    const detail = element('div'); detail.append(element('strong', '', item.file.name), element('small', '', bytes(item.file.size)));
    const remove = element('button', 'icon-button'); remove.type = 'button'; remove.setAttribute('aria-label', item.file.name + ' 첨부 취소'); remove.append(icon('close')); remove.disabled = state.busy || Boolean(state.pending);
    remove.addEventListener('click', () => { if (item.preview) URL.revokeObjectURL(item.preview); state.files.splice(index, 1); renderPreviews(); });
    row.append(detail, remove); container.append(row);
  });
}
$('attach-button').addEventListener('click', () => { if (mobileView.matches) { $('message-input').blur(); $('attachment-dialog').showModal(); } else $('file-input').click(); });
for (const id of ['file-input', 'photo-input', 'camera-input']) $(id).addEventListener('change', event => { addFiles([...event.target.files]); event.target.value = ''; });
$('attachment-close').addEventListener('click', () => $('attachment-dialog').close());
$('attachment-dialog').addEventListener('click', event => { if (event.target === $('attachment-dialog')) $('attachment-dialog').close(); });
for (const [button, input] of [['choose-photo','photo-input'], ['choose-camera','camera-input'], ['choose-file','file-input']]) $(button).addEventListener('click', () => { $('attachment-dialog').close(); $(input).click(); });
$('message-input').addEventListener('paste', event => {
  const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  if (files.length) { event.preventDefault(); addFiles(files); }
});
document.addEventListener('dragenter', event => {
  if (!state.user || !event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); state.dragDepth++; $('drop-overlay').hidden = false;
});
document.addEventListener('dragover', event => { if (state.user && event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', event => { if (!state.user) return; state.dragDepth = Math.max(0, state.dragDepth - 1); if (!state.dragDepth) $('drop-overlay').hidden = true; });
document.addEventListener('drop', event => {
  if (!state.user) return;
  event.preventDefault(); state.dragDepth = 0; $('drop-overlay').hidden = true; addFiles([...event.dataTransfer.files]);
});
$('message-input').addEventListener('input', () => { const input = $('message-input'); const stick = nearBottom(); input.style.height = 'auto'; input.style.height = Math.min(mobileView.matches ? 120 : 160, input.scrollHeight) + 'px'; updateSendButton(); if (stick) scrollBottom(); if (state.socket?.connected) state.socket.emit('typing'); });
$('message-input').addEventListener('beforeinput', event => { if (state.busy) event.preventDefault(); });
$('message-input').addEventListener('keydown', event => { if (!mobileView.matches && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); } });
$('send-button').addEventListener('pointerdown', event => { if (document.activeElement === $('message-input')) event.preventDefault(); });
function uploadFiles(files) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); request.open('POST', '/api/upload'); request.timeout = 10 * 60 * 1000;
    const body = new FormData(); files.forEach(item => body.append('files', item.file));
    $('upload-status').hidden = false; $('upload-label').textContent = '파일을 업로드하고 있어요…'; $('upload-progress').value = 0;
    request.upload.onprogress = event => { if (event.lengthComputable) { const progress = Math.round(event.loaded / event.total * 100); $('upload-progress').value = progress; $('upload-label').textContent = progress === 100 ? '파일을 저장하고 있어요…' : '파일 업로드 ' + progress + '%'; } };
    request.onload = () => {
      $('upload-status').hidden = true;
      try { const data = JSON.parse(request.responseText); if (request.status >= 200 && request.status < 300) resolve(data.files); else { if (request.status === 401) showLogin(); reject(new Error(data.error || '파일 업로드 실패')); } } catch { reject(new Error('파일 업로드에 실패했습니다.')); }
    };
    request.onerror = request.ontimeout = () => { $('upload-status').hidden = true; reject(new Error('업로드가 중단되었습니다. 다시 시도해 주세요.')); };
    request.send(body);
  });
}
function setBusy(value) {
  state.busy = value; updateSendButton(); $('attach-button').disabled = value || Boolean(state.pending);
  $('message-input').readOnly = !value && Boolean(state.pending); $('retry-button').disabled = value; renderPreviews();
}
async function send() {
  if (state.busy) return;
  if (!state.socket?.connected) { toast('연결을 기다린 뒤 다시 보내 주세요.'); return; }
  if (!state.pending && !$('message-input').value.trim() && !state.files.length) return;
  const focusComposer = !mobileView.matches || document.activeElement === $('message-input');
  $('send-error').hidden = true;
  if (!state.pending) state.pending = { clientId: crypto.randomUUID(), text: $('message-input').value.trim(), attachments: null };
  setBusy(true);
  try {
    if (!state.pending.attachments) state.pending.attachments = state.files.length ? (await uploadFiles(state.files)).map(file => file.id) : [];
    const result = await new Promise((resolve, reject) => state.socket.timeout(15000).emit('message:send', state.pending, (error, response) => error ? reject(new Error('전송 확인을 받지 못했습니다. 다시 보내기를 눌러 주세요.')) : resolve(response)));
    if (result.error) throw new Error(result.error);
    addMessage(result.message); state.pending = null;
    state.files.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview); }); state.files = [];
    $('message-input').value = ''; $('message-input').style.height = 'auto'; scrollBottom();
  } catch (error) {
    // Upload failures are safe to edit. Unacknowledged messages retain their ID for retry.
    if (state.pending && !state.pending.attachments) state.pending = null;
    $('send-error').hidden = false; $('send-error').querySelector('span').textContent = error.message;
  } finally { setBusy(false); if (!state.pending && focusComposer) $('message-input').focus(); }
}
$('composer').addEventListener('submit', event => { event.preventDefault(); send(); });
$('retry-button').addEventListener('click', send);
$('search-button').addEventListener('click', () => { $('search-bar').hidden = !$('search-bar').hidden; if (!$('search-bar').hidden) $('search-input').focus(); else { $('search-input').value = ''; renderMessages(); } });
$('search-close').addEventListener('click', () => { $('search-bar').hidden = true; $('search-input').value = ''; renderMessages(); });
$('search-input').addEventListener('input', () => renderMessages());
$('files-button').addEventListener('click', () => { togglePanel('files', $('files-button')); if (activePanel === 'files') refreshFiles(); });
$('files-close').addEventListener('click', () => closePanel());
$('menu-button').addEventListener('click', () => togglePanel('members', $('menu-button')));
$('members-close').addEventListener('click', () => closePanel());
$('panel-backdrop').addEventListener('click', () => closePanel());
$('room-button').addEventListener('click', () => closePanel());
$('invite').addEventListener('click', async () => {
  if (window.moeumClient) { try { toast(await window.moeumClient.invite() ? '초대 주소를 복사했어요.' : '서버의 외부 접속 주소를 준비 중이에요.'); } catch (error) { toast(error.message); } return; }
  if (['127.0.0.1','localhost'].includes(location.hostname)) { toast('MainPC에서는 공유주소.txt의 외부 접속 주소를 전달해 주세요.'); return; }
  try { await navigator.clipboard.writeText(location.origin); toast('초대 링크를 복사했어요. 닉네임만 입력하면 입장할 수 있어요.'); } catch { toast('브라우저 주소창의 링크를 복사해 주세요.'); }
});
$('logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); showLogin(); } catch (error) { toast(error.message); } });
async function boot() {
  syncViewport();
  if (history.state?.moeumPanel) { const { moeumPanel, ...other } = history.state; history.replaceState(other, ''); }
  try { $('nickname').value = localStorage.getItem('moeum-nickname') || ''; } catch { /* Storage can be disabled. */ }
  try { const info = await api('/api/info'); state.maxSize = info.maxFileSize; document.querySelectorAll('.room-name').forEach(node => node.textContent = info.roomName); } catch { $('login-error').textContent = '서버에 연결할 수 없습니다. 잠시 후 새로고침해 주세요.'; }
  try { const { user } = await api('/api/me'); enter(user); } catch { /* First visit requires login. */ }
}
boot();
