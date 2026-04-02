// PixelChat WebSocket Server v3
// ─────────────────────────────
// 1. npm install ws
// 2. node server.js
// 3. Open pixelchat.html in your browser

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = 3001;
// Max media size: 8 MB (base64 encoded images/video previews)
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const rooms = {}; // rooms[code] = { users:{}, clients:Set, messages:[] }

function colorFor(uid) {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = Math.imul(31, h) + uid.charCodeAt(i) | 0;
  return Math.abs(h) % 8;
}

function genUID() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastRoom(code, payload, exceptWs = null) {
  const room = rooms[code];
  if (!room) return;
  const msg = JSON.stringify(payload);
  room.clients.forEach(ws => {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(msg);
  });
}

function pushUserList(code) {
  const room = rooms[code];
  if (!room) return;
  broadcastRoom(code, { type: "user_list", users: Object.values(room.users) });
}

function pushSys(code, text) {
  const room = rooms[code];
  if (!room) return;
  const m = { type: "system", text, ts: Date.now() };
  room.messages.push(m);
  if (room.messages.length > 300) room.messages.shift();
  broadcastRoom(code, { type: "message", msg: m });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("PixelChat v3 running\n");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MEDIA_BYTES + 1024 });

wss.on("connection", (ws) => {
  ws._uid  = null;
  ws._room = null;
  ws._name = null;

  ws.on("message", (raw) => {
    // Guard size
    if (raw.length > MAX_MEDIA_BYTES + 1024) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── JOIN ──
    if (msg.type === "join") {
      const code = (msg.room || "").toUpperCase().trim().slice(0, 20);
      const name = (msg.name || "ANON").toUpperCase().trim().slice(0, 20);
      if (!code || !name) return;

      ws._uid  = genUID();
      ws._room = code;
      ws._name = name;

      if (!rooms[code]) rooms[code] = { users: {}, clients: new Set(), messages: [] };
      const room = rooms[code];
      room.clients.add(ws);

      const colorIdx = colorFor(ws._uid);
      room.users[ws._uid] = { name, uid: ws._uid, colorIdx, joinedAt: Date.now() };

      send(ws, {
        type: "welcome",
        uid: ws._uid, colorIdx, name, room: code,
        history: room.messages.slice(-100)
      });

      pushUserList(code);
      pushSys(code, `${name} JOINED THE ROOM`);
      console.log(`[+] ${name}#${ws._uid} → ${code} (${room.clients.size} online)`);

    // ── CHAT ──
    } else if (msg.type === "chat") {
      if (!ws._room || !ws._uid) return;
      const room = rooms[ws._room];
      if (!room) return;
      const text = (msg.text || "").trim().slice(0, 2000);
      if (!text) return;

      const user = room.users[ws._uid];
      const m = {
        type: "chat",
        uid: ws._uid, name: ws._name,
        colorIdx: user ? user.colorIdx : 0,
        text, ts: Date.now()
      };
      room.messages.push(m);
      if (room.messages.length > 300) room.messages.shift();
      broadcastRoom(ws._room, { type: "message", msg: m });

    // ── MEDIA ──
    } else if (msg.type === "media") {
      if (!ws._room || !ws._uid) return;
      const room = rooms[ws._room];
      if (!room) return;

      // Validate: must have dataUrl and mediaType
      const { dataUrl, mediaType, fileName } = msg;
      if (!dataUrl || !mediaType) return;
      // Only allow images and video
      if (!mediaType.startsWith("image/") && !mediaType.startsWith("video/")) return;

      const user = room.users[ws._uid];
      const m = {
        type: "media",
        uid: ws._uid, name: ws._name,
        colorIdx: user ? user.colorIdx : 0,
        dataUrl, mediaType,
        fileName: (fileName || "file").slice(0, 100),
        ts: Date.now()
      };
      room.messages.push(m);
      if (room.messages.length > 300) room.messages.shift();
      broadcastRoom(ws._room, { type: "message", msg: m });

    // ── TYPING ──
    } else if (msg.type === "typing") {
      if (!ws._room || !ws._uid) return;
      // Broadcast typing status to everyone else in the room
      broadcastRoom(ws._room, {
        type: "typing",
        uid: ws._uid,
        name: ws._name,
        isTyping: !!msg.isTyping
      }, ws);
    }
  });

  ws.on("close", () => {
    if (!ws._room || !ws._uid) return;
    const room = rooms[ws._room];
    if (!room) return;

    room.clients.delete(ws);
    delete room.users[ws._uid];

    pushSys(ws._room, `${ws._name} LEFT THE ROOM`);
    pushUserList(ws._room);
    console.log(`[-] ${ws._name}#${ws._uid} ← ${ws._room} (${room.clients.size} online)`);

    if (room.clients.size === 0) {
      delete rooms[ws._room];
      console.log(`[x] Room ${ws._room} closed`);
    }
  });

  ws.on("error", () => {});
});

server.listen(PORT, () => {
  console.log(`\n🎮  PixelChat v3 → ws://localhost:${PORT}`);
  console.log(`    Open pixelchat.html in your browser!\n`);
});
