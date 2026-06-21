import Peer from "peerjs";
import appLogo from "../assets/app.png";
import "./styles.css";

const brandLogo = document.querySelector("#brand-logo");
const ownId = document.querySelector("#own-id");
const copyId = document.querySelector("#copy-id");
const connectForm = document.querySelector("#connect-form");
const remoteIdInput = document.querySelector("#remote-id");
const statusDot = document.querySelector("#status-dot");
const statusText = document.querySelector("#status-text");
const peerList = document.querySelector("#peer-list");
const chatTitle = document.querySelector("#chat-title");
const clearChat = document.querySelector("#clear-chat");
const messages = document.querySelector("#messages");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");

const connections = new Map();
let activePeerId = null;
let myPeerId = "";

brandLogo.src = appLogo;

const peer = new Peer({
  debug: 1
});

function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function addSystemMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row system";
  row.textContent = text;
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}

function addChatMessage({ text, sender, peerId, time }) {
  const row = document.createElement("div");
  row.className = `message-row ${sender === "me" ? "mine" : "theirs"}`;

  const bubble = document.createElement("article");
  bubble.className = "bubble";

  const meta = document.createElement("span");
  meta.className = "bubble-meta";
  meta.textContent = `${sender === "me" ? "You" : peerId} · ${time ?? formatTime()}`;

  const body = document.createElement("p");
  body.textContent = text;

  bubble.append(meta, body);
  row.append(bubble);
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}

function refreshPeers() {
  peerList.replaceChildren();

  if (connections.size === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-peer";
    empty.textContent = "No connection yet";
    peerList.append(empty);
    chatTitle.textContent = "Ready to connect";
    messageInput.disabled = true;
    sendButton.disabled = true;
    return;
  }

  for (const [peerId, conn] of connections) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = peerId === activePeerId ? "peer-chip active" : "peer-chip";
    button.textContent = conn.open ? peerId : `${peerId} ...`;
    button.addEventListener("click", () => {
      activePeerId = peerId;
      refreshPeers();
    });
    peerList.append(button);
  }

  chatTitle.textContent = activePeerId ? `Connected to ${activePeerId}` : "Peer connected";
  messageInput.disabled = false;
  sendButton.disabled = false;
}

function registerConnection(conn) {
  const peerId = conn.peer;

  if (connections.has(peerId)) {
    connections.get(peerId).close();
  }

  connections.set(peerId, conn);
  activePeerId = peerId;
  refreshPeers();
  setStatus("pending", `Connecting to ${peerId}...`);

  conn.on("open", () => {
    setStatus("online", `Connected to ${peerId}`);
    addSystemMessage(`Connection with ${peerId} is ready.`);
    refreshPeers();
  });

  conn.on("data", (data) => {
    if (!data || data.type !== "chat-message") {
      return;
    }

    addChatMessage({
      text: String(data.text ?? ""),
      sender: "them",
      peerId,
      time: data.time
    });
  });

  conn.on("close", () => {
    connections.delete(peerId);
    if (activePeerId === peerId) {
      activePeerId = connections.keys().next().value ?? null;
    }
    addSystemMessage(`${peerId} closed the connection.`);
    setStatus(connections.size > 0 ? "online" : "pending", connections.size > 0 ? "Peer connected" : "Ready to connect");
    refreshPeers();
  });

  conn.on("error", (error) => {
    setStatus("offline", `Connection error: ${error.message}`);
    addSystemMessage(`Error with ${peerId}: ${error.message}`);
  });
}

peer.on("open", (id) => {
  myPeerId = id;
  ownId.textContent = id;
  setStatus("pending", "Peer ID ready. Share it with your chat partner.");
});

peer.on("connection", (conn) => {
  addSystemMessage(`${conn.peer} wants to chat.`);
  registerConnection(conn);
});

peer.on("disconnected", () => {
  setStatus("offline", "Signaling disconnected. Reconnecting...");
  peer.reconnect();
});

peer.on("error", (error) => {
  setStatus("offline", error.message);
  addSystemMessage(`PeerJS error: ${error.message}`);
});

copyId.addEventListener("click", async () => {
  if (!myPeerId) {
    return;
  }

  await navigator.clipboard.writeText(myPeerId);
  setStatus("pending", "Peer ID copied.");
});

connectForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const remoteId = remoteIdInput.value.trim();
  if (!remoteId || remoteId === myPeerId) {
    setStatus("offline", "Please enter a different peer ID.");
    return;
  }

  const conn = peer.connect(remoteId, {
    reliable: true,
    serialization: "json"
  });
  registerConnection(conn);
  remoteIdInput.value = "";
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text || !activePeerId) {
    return;
  }

  const conn = connections.get(activePeerId);
  if (!conn?.open) {
    setStatus("offline", "The active peer is not ready yet.");
    return;
  }

  const payload = {
    type: "chat-message",
    text,
    time: formatTime()
  };

  conn.send(payload);
  addChatMessage({
    text,
    sender: "me",
    peerId: activePeerId,
    time: payload.time
  });
  messageInput.value = "";
  messageInput.focus();
});

clearChat.addEventListener("click", () => {
  messages.replaceChildren();
});
