// app.js
const COLORS    = ["#00e5ff","#ff00aa","#ffe600","#00ff88","#ff3355","#cc88ff","#ff8800","#88ffee"];
const BG_COLORS = ["#003344","#330022","#332200","#003322","#330011","#220033","#331a00","#002222"];

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
let userScrolledUp = false;

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

// ── SEND TEXT ─────────────────────────────────
function sendMessage() {
  if (pendingMedia) { sendMedia(); return; }

  const inp  = document.getElementById('msgInput');
  const text = inp.value.trim();
  if (!text) return;

  // EDIT MODE — update in-place, no scroll needed
  if (editingMsgId) {
    sendEditPayload(editingMsgId, text);
    inp.value = '';
    cancelEdit();
    stopTyping();
    return;
  }

  inp.value = '';
  stopTyping();

  const payload = { type:'chat', text };
  if (replyingTo) {
    payload.replyTo = replyingTo;
    cancelReply();
  }
  sendChatPayload(payload);

  // Own message: ALWAYS scroll to bottom regardless of scroll position.
  userScrolledUp = false;
  hideNewMsgBtn();
  scrollToBottom();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape') { cancelEdit(); cancelReply(); }
}

// ── MEDIA ─────────────────────────────────────
function sendMedia() {
  if (!pendingMedia) return;
  const payload = { type:'media', ...pendingMedia };
  if (replyingTo) { payload.replyTo = replyingTo; cancelReply(); }
  sendMediaPayload(payload);
  cancelMedia();
  // Own media send: always scroll to bottom
  userScrolledUp = false;
  hideNewMsgBtn();
  scrollToBottom();
}

// ── TYPING ────────────────────────────────────
function onTyping() {
  if (!amTyping) {
    amTyping = true;
    sendTypingPayload(true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (!amTyping) return;
  amTyping = false;
  clearTimeout(typingTimer);
  sendTypingPayload(false);
}

function handleTypingEvent({ uid, name, isTyping }) {
  if (isTyping) typingUsers[uid] = name;
  else delete typingUsers[uid];
  renderTypingBar();
}

// ── LEAVE ─────────────────────────────────────
function leaveRoom() {
  clearTimeout(reconnTimer);
  pendingJoin = null; currentRoom = null;
  sessionStorage.removeItem('pixelchat_name');
  sessionStorage.removeItem('pixelchat_room');
  
  closeWS();
  stopTyping(); 
  cancelMedia(); 
  cancelReply(); 
  cancelEdit();
  hideChatroomUI();

  Object.keys(typingUsers).forEach(k => delete typingUsers[k]);
  Object.keys(msgStore).forEach(k => delete msgStore[k]);
}

// ── SHARE LINK ────────────────────────────────
function copyRoomCode() {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom).then(() => showToast('>> CODE COPIED!'));
}

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
      showChatroomUI(roomParam.toUpperCase());
      doJoin(savedName, roomParam.toUpperCase());
    }
  } else if (savedName && savedRoom) {
    document.getElementById('nameInput').value = savedName;
    document.getElementById('roomInput').value = savedRoom;
    showChatroomUI(savedRoom);
    doJoin(savedName, savedRoom);
  }
});
