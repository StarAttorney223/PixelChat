// ── CONFIG ────────────────────────────────────
// const WS_URL = "ws://localhost:3001";  // local dev
const WS_URL = "wss://pixelchat-535b.onrender.com"; // deployed
// ─────────────────────────────────────────────

const COLORS    = ["#00e5ff","#ff00aa","#ffe600","#00ff88","#ff3355","#cc88ff","#ff8800","#88ffee"];
const BG_COLORS = ["#003344","#330022","#332200","#003322","#330011","#220033","#331a00","#002222"];

function getPlayerTheme(uid, colorIdx) {
  if (uid === myUID) return { fg: COLORS[0], bg: BG_COLORS[0] };
  let idx = colorIdx || 0;
  if (idx === 0) {
    let hash = 0;
    for(let i=0; i<uid.length; i++) hash += uid.charCodeAt(i);
    idx = (hash % (COLORS.length - 1)) + 1;
  }
  return { fg: COLORS[idx], bg: BG_COLORS[idx] };
}

let ws           = null;
let myUID        = null;
let myName       = null;
let currentRoom  = null;
let lastMsgUID   = null;
let reconnTimer  = null;
let pendingJoin  = null;

let typingTimer  = null;
let amTyping     = false;
const typingUsers = {};

let pendingMedia = null;
let replyingTo   = null;
let editingMsgId = null;

const msgStore = {};

// ── SCROLL STATE ──────────────────────────────
let userScrolledUp = false;

function isNearBottom() {
  const list = document.getElementById('messagesList');
  return list.scrollHeight - list.scrollTop - list.clientHeight < 100;
}

// The button is injected as a sticky child of #messagesList so it
// always appears above the last message, never over the input row.
// We create it once and reuse it throughout the session.
let _newMsgBtnEl = null;
function _getNewMsgBtn() {
  if (!_newMsgBtnEl) {
    _newMsgBtnEl = document.getElementById('newMsgBtn');
  }
  return _newMsgBtnEl;
}

function showNewMsgBtn() { _getNewMsgBtn().classList.add('visible'); }
function hideNewMsgBtn() { _getNewMsgBtn().classList.remove('visible'); }

function onNewMsgBtnClick() {
  hideNewMsgBtn();
  userScrolledUp = false;
  scrollToBottom();
}

// ── LOBBY ─────────────────────────────────────
function createRoom() {
  const name = document.getElementById('nameInput').value.trim();
  if (!name) return showError("!! ENTER PLAYER NAME FIRST");
  const w = ['NOVA','ECHO','ZETA','LYRA','FLUX','VEGA','NEON','APEX','BYTE','KERN'];
  const code = w[Math.floor(Math.random()*w.length)] + '-' + Math.floor(10+Math.random()*90);
  document.getElementById('roomInput').value = code;
  doJoin(name, code);
}

function joinRoom() {
  const name = document.getElementById('nameInput').value.trim();
  const code = document.getElementById('roomInput').value.trim().toUpperCase();
  if (!name) return showError("!! ENTER YOUR NAME");
  if (!code) return showError("!! ENTER ROOM CODE");
  doJoin(name, code);
}

function doJoin(name, code) {
  showError('');
  pendingJoin = { name, code };
  sessionStorage.setItem('pixelchat_name', name);
  sessionStorage.setItem('pixelchat_room', code);
  openWS(name, code);
}

// ── WEBSOCKET ─────────────────────────────────
function openWS(name, code) {
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  setConn('connecting');
  setInputEnabled(false);
  try { ws = new WebSocket(WS_URL); }
  catch(e) { return showError("!! CANNOT CONNECT TO SERVER"); }

  ws.onopen = () => {
    setConn('connected');
    ws.send(JSON.stringify({ type:'join', name, room:code }));
  };
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    onMsg(msg);
  };
  ws.onclose = () => {
    setConn('disconnected');
    setInputEnabled(false);
    if (currentRoom && pendingJoin) {
      clearTimeout(reconnTimer);
      reconnTimer = setTimeout(() => openWS(pendingJoin.name, pendingJoin.code), 2500);
    }
  };
  ws.onerror = () => {};
}

function onMsg(msg) {
  if (msg.type === 'welcome') {
    myUID = msg.uid; myName = msg.name; currentRoom = msg.room;
    document.getElementById('lobby').style.display    = 'none';
    document.getElementById('chatroom').style.display = 'flex';
    document.querySelectorAll('.roomCodeDisplayVal').forEach(el => el.textContent = msg.room);
    document.getElementById('messagesList').innerHTML = '';
    lastMsgUID = null;
    userScrolledUp = false;

    // Inject the sticky "New Messages" button as the last child of the
    // scroll container. position:sticky + bottom:12px means it always
    // hugs the bottom of the VISIBLE list area, never the input row.
    const list = document.getElementById('messagesList');
    if (!document.getElementById('newMsgBtn')) {
      const btn = document.createElement('button');
      btn.className = 'new-msg-btn';
      btn.id = 'newMsgBtn';
      btn.textContent = '↓ NEW MESSAGES';
      btn.onclick = onNewMsgBtnClick;
      list.appendChild(btn);
    }
    _newMsgBtnEl = document.getElementById('newMsgBtn');

    (msg.history || []).forEach(appendMsg);
    setInputEnabled(true);
    document.getElementById('msgInput').focus();

    list.addEventListener('scroll', () => {
      if (isNearBottom()) {
        userScrolledUp = false;
        hideNewMsgBtn();
      } else {
        userScrolledUp = true;
      }
    }, { passive: true });

  } else if (msg.type === 'user_list') {
    renderUsers(msg.users);

  } else if (msg.type === 'message') {
    appendMsg(msg.msg);

  } else if (msg.type === 'edit') {
    applyEdit(msg);

  } else if (msg.type === 'typing') {
    handleTypingEvent(msg);
  }
}

// ── SCROLL TO BOTTOM (mobile-safe) ────────────────────────────────────────
// Two-pass strategy:
//   Pass 1 — double rAF: fires after the browser's next paint, ensuring the
//             new message node is in the DOM and its height is known.
//   Pass 2 — 200 ms setTimeout: catches secondary reflow from bars collapsing.
//
// On mobile: instant scrollTop (avoids iOS/Android smooth-scroll cutoff bug).
// On desktop: smooth scrollTo.
// +4 px buffer covers sub-pixel rounding in Android WebViews.
function scrollToBottom() {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const list     = document.getElementById('messagesList');

  function doScroll() {
    // scrollHeight already accounts for the sticky button height since it
    // is a child of the flex container. +4 for sub-pixel safety.
    const target = list.scrollHeight + 4;
    if (isMobile) {
      list.scrollTop = target;
    } else {
      list.scrollTo({ top: target, behavior: 'smooth' });
    }
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(doScroll);
  });

  // Second pass: catches reflow after reply/edit bars collapse (150→200ms
  // gives a little more headroom on slow Android devices)
  setTimeout(doScroll, 200);
}

// ── SEND TEXT ─────────────────────────────────
function sendMessage() {
  if (pendingMedia) { sendMedia(); return; }

  const inp  = document.getElementById('msgInput');
  const text = inp.value.trim();
  if (!text) return;

  // EDIT MODE — update in-place, no scroll needed
  if (editingMsgId) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type:'edit', msgId: editingMsgId, text }));
    inp.value = '';
    cancelEdit();
    stopTyping();
    return;
  }

  if (!ws || ws.readyState !== 1) return;
  inp.value = '';
  stopTyping();

  const payload = { type:'chat', text };
  if (replyingTo) {
    payload.replyTo = replyingTo;
    cancelReply();
  }
  ws.send(JSON.stringify(payload));

  // Own message: ALWAYS scroll to bottom regardless of scroll position.
  userScrolledUp = false;
  hideNewMsgBtn();
  scrollToBottom();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') { cancelEdit(); cancelReply(); }
}

// ── TYPING ────────────────────────────────────
function onTyping() {
  if (!ws || ws.readyState !== 1) return;
  if (!amTyping) {
    amTyping = true;
    ws.send(JSON.stringify({ type:'typing', isTyping:true }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!amTyping) return;
  amTyping = false;
  clearTimeout(typingTimer);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'typing', isTyping:false }));
}

function handleTypingEvent({ uid, name, isTyping }) {
  if (isTyping) typingUsers[uid] = name;
  else delete typingUsers[uid];
  renderTypingBar();
}

function renderTypingBar() {
  const bar = document.getElementById('typingBar');
  const names = Object.values(typingUsers);
  if (!names.length) { bar.innerHTML = ''; return; }
  const who = names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} & ${names[1]}`
    : `${names[0]} & ${names.length-1} OTHERS`;
  const verb = names.length === 1 ? 'IS TYPING' : 'ARE TYPING';
  bar.innerHTML = `<span style="color:var(--accent2)">${esc(who)}</span>&nbsp;${verb}<span class="typing-dots"><span></span><span></span><span></span></span>`;
}

// ── REPLY ─────────────────────────────────────
function startReply(msgId) {
  if (replyingTo && replyingTo.msgId === msgId) { cancelReply(); return; }
  const m = msgStore[msgId];
  if (!m) return;
  document.querySelectorAll('.reply-btn.active').forEach(b => b.classList.remove('active'));
  replyingTo = { msgId, uid: m.uid, name: m.name, text: m.text, colorIdx: m.colorIdx };
  const theme = getPlayerTheme(m.uid, m.colorIdx);
  document.getElementById('replyPreviewAuthor').textContent = '↩ ' + m.name;
  document.getElementById('replyPreviewAuthor').style.color = theme.fg;
  document.getElementById('replyPreviewText').textContent = m.text || '[media]';
  document.getElementById('replyPreviewBar').classList.add('show');
  const grp = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (grp) grp.querySelector('.reply-btn')?.classList.add('active');
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  if (replyingTo) {
    const grp = document.querySelector(`[data-msg-id="${replyingTo.msgId}"]`);
    if (grp) grp.querySelector('.reply-btn')?.classList.remove('active');
  }
  replyingTo = null;
  document.getElementById('replyPreviewBar').classList.remove('show');
  document.getElementById('replyPreviewAuthor').textContent = '';
  document.getElementById('replyPreviewText').textContent = '';
}

// ── EDIT ──────────────────────────────────────
function startEdit(msgId) {
  const m = msgStore[msgId];
  if (!m || m.uid !== myUID) return;
  if (editingMsgId === msgId) { cancelEdit(); return; }
  document.querySelectorAll('.edit-btn.active').forEach(b => b.classList.remove('active'));
  editingMsgId = msgId;
  const inp = document.getElementById('msgInput');
  inp.value = m.text;
  inp.classList.add('editing');
  document.getElementById('editIndicator').classList.add('show');
  const grp = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (grp) grp.querySelector('.edit-btn')?.classList.add('active');
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}

function cancelEdit() {
  if (!editingMsgId) return;
  const grp = document.querySelector(`[data-msg-id="${editingMsgId}"]`);
  if (grp) grp.querySelector('.edit-btn')?.classList.remove('active');
  editingMsgId = null;
  const inp = document.getElementById('msgInput');
  inp.value = '';
  inp.classList.remove('editing');
  document.getElementById('editIndicator').classList.remove('show');
}

function applyEdit({ msgId, text }) {
  const m = msgStore[msgId];
  if (!m) return;
  m.text = text;
  const bubble = m.el.querySelector('.bubble');
  if (bubble && !bubble.querySelector('img') && !bubble.querySelector('video')) {
    const existingTag = bubble.querySelector('.edited-tag');
    if (existingTag) existingTag.remove();
    bubble.textContent = text;
    const tag = document.createElement('span');
    tag.className = 'edited-tag';
    tag.textContent = '(edited)';
    bubble.appendChild(tag);
  }
}

// ── MEDIA ─────────────────────────────────────
function onFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) { showToast('!! FILE TOO LARGE (MAX 6MB)'); e.target.value=''; return; }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    pendingMedia = { dataUrl, mediaType: file.type, fileName: file.name };
    const bar = document.getElementById('mediaPreviewBar');
    const thumb = document.getElementById('previewThumb');
    document.getElementById('previewName').textContent = file.name;
    if (file.type.startsWith('image/') || file.type === 'image/gif') {
      thumb.src = dataUrl; thumb.style.display = 'block';
    } else { thumb.style.display = 'none'; }
    bar.classList.add('show');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function cancelMedia() {
  pendingMedia = null;
  document.getElementById('mediaPreviewBar').classList.remove('show');
  document.getElementById('previewThumb').src = '';
}

function sendMedia() {
  if (!pendingMedia || !ws || ws.readyState !== 1) return;
  const payload = { type:'media', ...pendingMedia };
  if (replyingTo) { payload.replyTo = replyingTo; cancelReply(); }
  ws.send(JSON.stringify(payload));
  cancelMedia();
  // Own media send: always scroll to bottom
  userScrolledUp = false;
  hideNewMsgBtn();
  scrollToBottom();
}

// ── LEAVE ─────────────────────────────────────
function leaveRoom() {
  clearTimeout(reconnTimer);
  pendingJoin = null; currentRoom = null;
  sessionStorage.removeItem('pixelchat_name');
  sessionStorage.removeItem('pixelchat_room');
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
  stopTyping(); cancelMedia(); cancelReply(); cancelEdit();
  document.getElementById('chatroom').style.display = 'none';
  document.getElementById('lobby').style.display    = 'flex';
  document.getElementById('messagesList').innerHTML = '';
  document.getElementById('userList').innerHTML     = '';
  document.getElementById('onlineCount').textContent = '0';
  document.getElementById('typingBar').innerHTML    = '';
  lastMsgUID = null;
  userScrolledUp = false;
  _newMsgBtnEl = null;
  Object.keys(typingUsers).forEach(k => delete typingUsers[k]);
  Object.keys(msgStore).forEach(k => delete msgStore[k]);
  closeSidebar();
}

// ── RENDER USERS ──────────────────────────────
function renderUsers(users) {
  document.getElementById('onlineCount').textContent = users.length;
  const list = document.getElementById('userList');
  list.innerHTML = '';
  [...users].sort((a,b) => a.joinedAt - b.joinedAt).forEach(u => {
    const isMe = u.uid === myUID;
    const theme = getPlayerTheme(u.uid, u.colorIdx);
    const fg = theme.fg;
    const bg = theme.bg;
    const d = document.createElement('div');
    d.className = 'user-item' + (isMe ? ' is-me' : '');
    d.innerHTML = `
      <div class="avatar" style="color:${fg};background:${bg}">${u.name[0]}</div>
      <div class="user-info">
        <div class="user-name" style="color:${fg}">${esc(u.name)}</div>
        <div class="user-uid">#${u.uid}</div>
      </div>
      ${isMe ? '<span class="me-tag">YOU</span>' : ''}
    `;
    list.appendChild(d);
  });
}

// ── RENDER MESSAGE ────────────────────────────
function appendMsg(m) {
  const list = document.getElementById('messagesList');

  // Ensure the sticky button stays as the last child after every append
  const btn = document.getElementById('newMsgBtn');

  if (m.type === 'system') {
    const el = document.createElement('div');
    el.className = 'sys-msg'; el.textContent = m.text;
    // Insert before the sticky button so button stays last
    if (btn) list.insertBefore(el, btn); else list.appendChild(el);
    lastMsgUID = null;
    if (!userScrolledUp) scrollToBottom();
    return;
  }

  const isSelf = m.uid === myUID;
  const msgId = m.msgId || (m.uid + '_' + m.ts);
  const grp = document.createElement('div');

  const theme = getPlayerTheme(m.uid, m.colorIdx);
  const fgColor = theme.fg;
  const bgColor = theme.bg;

  grp.className = 'msg-group' + (isSelf ? ' self' : '');
  grp.dataset.msgId = msgId;
  grp.style.setProperty('--user-color', fgColor);
  grp.style.setProperty('--user-bg', bgColor);

  if (m.uid !== lastMsgUID) {
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML = `
      <span class="msg-author" style="color:${fgColor}">${esc(m.name)}</span>
      <span class="msg-uid-tag">#${m.uid}</span>
      <span class="msg-time">${fmtTime(m.ts)}</span>
    `;
    grp.appendChild(meta);
  }

  const b = document.createElement('div');
  b.className = 'bubble';

  if (m.replyTo) {
    const rTheme = getPlayerTheme(m.replyTo.uid, m.replyTo.colorIdx);
    const fg = rTheme.fg;
    const q = document.createElement('div');
    q.className = 'reply-quote';
    q.innerHTML = `<span class="reply-quote-author" style="color:${fg}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;margin-right:2px;margin-bottom:-1px"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg> ${esc(m.replyTo.name)}</span><span class="reply-quote-text">${esc(m.replyTo.text || '[media]')}</span>`;
    q.style.cursor = 'pointer';
    q.onclick = () => scrollToMsg(m.replyTo.msgId);
    b.appendChild(q);
  }

  if (m.type === 'media') {
    const nameEl = document.createElement('span');
    nameEl.className = 'media-name';
    nameEl.textContent = ' ';
    const svgIcon = document.createElement('span');
    svgIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;margin-bottom:-2px;margin-right:4px"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
    nameEl.appendChild(svgIcon);
    nameEl.appendChild(document.createTextNode(m.fileName));
    b.appendChild(nameEl);
    if (m.mediaType.startsWith('image/') || m.mediaType === 'image/gif') {
      const img = document.createElement('img');
      img.src = m.dataUrl; img.alt = m.fileName; img.loading = 'lazy';
      b.appendChild(img);
    } else if (m.mediaType.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = m.dataUrl; vid.controls = true; vid.preload = 'metadata';
      b.appendChild(vid);
    }
  } else {
    const textNode = document.createElement('span');
    textNode.textContent = m.text;
    b.appendChild(textNode);
  }

  grp.appendChild(b);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `<button class="msg-action-btn reply-btn" onclick="startReply('${msgId}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-bottom:-2px;margin-right:4px"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>REPLY</button>${isSelf && m.type !== 'media' ? `<button class="msg-action-btn edit-btn" onclick="startEdit('${msgId}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-bottom:-2px;margin-right:4px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>EDIT</button>` : ''}`;
  grp.appendChild(actions);

  // Insert before the sticky button so it stays the last child
  if (btn) list.insertBefore(grp, btn); else list.appendChild(grp);
  lastMsgUID = m.uid;

  msgStore[msgId] = { uid: m.uid, name: m.name, text: m.text || '', colorIdx: m.colorIdx || 0, el: grp };

  // Own messages: scroll already handled by sendMessage/sendMedia — skip to avoid race.
  // Others' messages: smart scroll.
  if (m.uid === myUID) {
    // handled by sendMessage / sendMedia
  } else if (!userScrolledUp) {
    scrollToBottom();
  } else {
    showNewMsgBtn();
  }
}

function scrollToMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    el.style.outline = '2px solid var(--accent)';
    setTimeout(() => el.style.outline = '', 1200);
  }
}

// ── SIDEBAR (mobile) ──────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ── HELPERS ───────────────────────────────────
function setConn(state) {
  const el = document.getElementById('connPill');
  if (!el) return;
  el.className = 'conn-pill ' + state;
  el.textContent = state.toUpperCase();
}

function setInputEnabled(on) {
  document.getElementById('msgInput').disabled = !on;
  document.getElementById('sendBtn').disabled  = !on;
}

function showError(m) { document.getElementById('lobbyError').textContent = m; }

function copyRoomCode() {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom).then(() => showToast('>> CODE COPIED!'));
}

function showToast(m) {
  const t = document.getElementById('toast');
  t.textContent = m; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:true });
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── SHARE LINK ────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  const savedName = sessionStorage.getItem('pixelchat_name');
  const savedRoom = sessionStorage.getItem('pixelchat_room');

  if (roomParam) {
    document.getElementById('roomInput').value = roomParam.toUpperCase();
    const inp = document.getElementById('roomInput');
    inp.style.borderColor = 'var(--yellow)';
    inp.style.boxShadow = 'inset 3px 3px 0 rgba(0,0,0,.4), 0 0 0 2px rgba(255,230,0,.3)';

    if (savedName) {
      document.getElementById('nameInput').value = savedName;
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('chatroom').style.display = 'flex';
      document.querySelectorAll('.roomCodeDisplayVal').forEach(el => el.textContent = roomParam.toUpperCase());
      doJoin(savedName, roomParam.toUpperCase());
    }
  } else if (savedName && savedRoom) {
    document.getElementById('nameInput').value = savedName;
    document.getElementById('roomInput').value = savedRoom;
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('chatroom').style.display = 'flex';
    document.querySelectorAll('.roomCodeDisplayVal').forEach(el => el.textContent = savedRoom);
    doJoin(savedName, savedRoom);
  }
});

function getShareLink() {
  if (!currentRoom) return null;
  const base = window.location.origin + window.location.pathname;
  return base + '?room=' + encodeURIComponent(currentRoom);
}

function copyShareLink() {
  const link = getShareLink();
  if (!link) return;
  navigator.clipboard.writeText(link).then(() => showToast('>> SHARE LINK COPIED!'));
}
