const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3001;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

const rooms = {};

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
  room.clients.forEach(client => {
    if (client !== exceptWs && client.readyState === 1) {
      client.send(msg);
    }
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

//Health check (important for deployment)
const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("PixelChat backend is running 🚀");
  }
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MEDIA_BYTES + 1024
});

wss.on("connection", (ws) => {
  ws._uid = null;
  ws._room = null;
  ws._name = null;

  // ✅ Keep connection alive (important for hosting)
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (raw) => {
    if (raw.length > MAX_MEDIA_BYTES + 1024) return;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      const code = (msg.room || "").toUpperCase().trim().slice(0, 20);
      const name = (msg.name || "ANON").toUpperCase().trim().slice(0, 20);
      if (!code || !name) return;

      ws._uid = genUID();
      ws._room = code;
      ws._name = name;

      if (!rooms[code]) {
        rooms[code] = { users: {}, clients: new Set(), messages: [] };
      }

      const room = rooms[code];
      room.clients.add(ws);

      const colorIdx = colorFor(ws._uid);
      room.users[ws._uid] = {
        name,
        uid: ws._uid,
        colorIdx,
        joinedAt: Date.now()
      };

      send(ws, {
        type: "welcome",
        uid: ws._uid,
        colorIdx,
        name,
        room: code,
        history: room.messages.slice(-100)
      });

      pushUserList(code);
      pushSys(code, `${name} JOINED THE ROOM`);

      console.log(`[JOIN] ${name} → ${code}`);
    }

    else if (msg.type === "chat") {
      if (!ws._room || !ws._uid) return;
      const room = rooms[ws._room];
      if (!room) return;

      const text = (msg.text || "").trim().slice(0, 2000);
      if (!text) return;

      const user = room.users[ws._uid];

      const m = {
        type: "chat",
        uid: ws._uid,
        name: ws._name,
        colorIdx: user ? user.colorIdx : 0,
        text,
        ts: Date.now()
      };

      room.messages.push(m);
      if (room.messages.length > 300) room.messages.shift();

      broadcastRoom(ws._room, { type: "message", msg: m });
    }

    else if (msg.type === "media") {
      if (!ws._room || !ws._uid) return;
      const room = rooms[ws._room];
      if (!room) return;

      const { dataUrl, mediaType, fileName } = msg;
      if (!dataUrl || !mediaType) return;

      if (!mediaType.startsWith("image/") && !mediaType.startsWith("video/")) return;

      const user = room.users[ws._uid];

      const m = {
        type: "media",
        uid: ws._uid,
        name: ws._name,
        colorIdx: user ? user.colorIdx : 0,
        dataUrl,
        mediaType,
        fileName: (fileName || "file").slice(0, 100),
        ts: Date.now()
      };

      room.messages.push(m);
      if (room.messages.length > 300) room.messages.shift();

      broadcastRoom(ws._room, { type: "message", msg: m });
    }

    else if (msg.type === "typing") {
      if (!ws._room || !ws._uid) return;

      broadcastRoom(
        ws._room,
        {
          type: "typing",
          uid: ws._uid,
          name: ws._name,
          isTyping: !!msg.isTyping
        },
        ws
      );
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

    if (room.clients.size === 0) {
      delete rooms[ws._room];
    }
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });
});

// Ping clients every 30s (prevents disconnects)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});