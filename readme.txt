# 🎮 PixelChat

A real-time multiplayer chat app with a retro pixel-style UI.
Built for fun, speed, and that nostalgic game vibe.

---

## ✨ Features

* ⚡ Real-time chat using WebSockets
* 🎨 Unique pixel-themed UI
* 👥 Room-based chatting (join or create rooms)
* 📎 Send images, videos, and GIFs
* ✏️ Edit messages
* 💬 Reply to messages
* ⌨️ Typing indicators
* 📱 Responsive (works on mobile too)

---

## 🛠 Tech Stack

* **Frontend:** HTML, CSS, Vanilla JavaScript
* **Backend:** Node.js + WebSocket (`ws`)
* **Deployment:** Render (or localhost)

---

## 🚀 How to Run Locally

### 1. Clone the repo

```bash
git clone https://github.com/your-username/pixelchat.git
cd pixelchat
```

---

### 2. Install dependencies

```bash
npm install ws
```

---

### 3. Start the server

```bash
node server.js
```

You should see:

```
PixelChat server → ws://localhost:3001
```

---

### 4. Open the frontend

Just open the HTML file in your browser:

```
pixelchat.html
```

---

## 🌐 Connecting to Backend

In your frontend file, you’ll see:

```js
const WS_URL = "ws://localhost:3001";
```

If you deploy your backend (e.g., on Render), replace it with:

```js
const WS_URL = "wss://your-deployed-url";
```

---

## 🎮 How to Use

1. Enter your name
2. Enter a room code (or create one)
3. Share the code with friends
4. Start chatting

---


---

## ⚠️ Notes

* Max media size: ~6MB
* Works best on modern browsers
* WebSocket server must be running before joining


---

👨‍💻 Author

StarAttorney233



If you like this project

Give it a star ⭐ — it helps!
