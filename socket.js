// socket.js
const WS_URL = "wss://pixelchat-535b.onrender.com"; // deployed

let ws = null;

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
    
    if (msg.type === 'welcome') {
      myUID = msg.uid; myName = msg.name; currentRoom = msg.room;
      handleWelcome(msg);
    } else if (msg.type === 'user_list') {
      renderUsers(msg.users);
    } else if (msg.type === 'message') {
      appendMsg(msg.msg);
    } else if (msg.type === 'edit') {
      applyEdit(msg);
    } else if (msg.type === 'typing') {
      handleTypingEvent(msg);
    }
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

function closeWS() {
  if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
}

function sendChatPayload(payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendEditPayload(msgId, text) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'edit', msgId, text }));
}

function sendMediaPayload(payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendTypingPayload(isTyping) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'typing', isTyping }));
}
