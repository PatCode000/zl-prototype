import express from "express";
import http from "http";
import cors from "cors";
import axios from "axios";
import { Server } from "socket.io";
import { WebSocket, WebSocketServer } from "ws";

const PORT = process.env.PORT || 8080;
const API_URL = process.env.API_URL || "http://localhost:8000";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] }
});

const renderNodes = new Map(); // nodeId -> { socketId, status, capabilities, lastSeenAt }
const sessionAssignments = new Map(); // sessionId -> nodeId
const unitySignalingPeers = new Map(); // raw ws -> Set<connectionId>
const unityConnectionPairs = new Map(); // connectionId -> [wsA, wsB]
const UNITY_RENDER_NODE_ID = process.env.UNITY_RENDER_NODE_ID || "unity-renderer";
let unityPeerSequence = 0;

function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}

function chooseAvailableNode() {
  for (const [nodeId, node] of renderNodes.entries()) {
    if (node.status === "available") return { nodeId, node };
  }
  return null;
}

function sendUnitySignaling(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function unityPeerLabel(ws) {
  return ws.peerId || "unity-ws-unknown";
}

function unityPeerRole(ws) {
  return ws.peerRole || "unity-renderer";
}

function unityRendererPeers() {
  return [...unitySignalingPeers.keys()].filter((peer) => unityPeerRole(peer) === "unity-renderer");
}

function sendUnitySignalingToOthers(ws, message) {
  for (const peer of unitySignalingPeers.keys()) {
    if (peer !== ws) sendUnitySignaling(peer, message);
  }
}

function rawSignalingRole(request) {
  const url = new URL(request.url || "/", "http://localhost");
  return url.searchParams.get("role") === "browser" ? "browser" : "unity-renderer";
}

function registerUnitySignalingNode(reason) {
  const previous = renderNodes.get(UNITY_RENDER_NODE_ID);
  const now = new Date().toISOString();

  renderNodes.set(UNITY_RENDER_NODE_ID, {
    socketId: "unity-renderstreaming-ws",
    status: "available",
    kind: "unity-renderer",
    capabilities: ["unity-render-streaming", "webrtc-signaling"],
    lastSeenAt: now,
    registeredAt: previous?.registeredAt || now
  });

  console.log(
    `[unity-signaling] Unity registered as render node nodeId=${UNITY_RENDER_NODE_ID} reason=${reason} unityPeers=${unityRendererPeers().length} rawPeers=${unitySignalingPeers.size}`
  );
}

function touchUnitySignalingNode() {
  const node = renderNodes.get(UNITY_RENDER_NODE_ID);
  if (node) {
    node.lastSeenAt = new Date().toISOString();
    node.status = "available";
  }
}

function getUnityConnectionIds(ws) {
  if (!unitySignalingPeers.has(ws)) {
    unitySignalingPeers.set(ws, new Set());
  }
  return unitySignalingPeers.get(ws);
}

function removeUnitySignalingPeer(ws) {
  const connectionIds = unitySignalingPeers.get(ws) || new Set();
  for (const connectionId of connectionIds) {
    const pair = unityConnectionPairs.get(connectionId);
    if (pair) {
      const other = pair[0] === ws ? pair[1] : pair[0];
      if (other) sendUnitySignaling(other, { type: "disconnect", connectionId });
    } else {
      sendUnitySignalingToOthers(ws, { type: "disconnect", connectionId });
    }
    unityConnectionPairs.delete(connectionId);
  }

  unitySignalingPeers.delete(ws);
  if (unityPeerRole(ws) === "unity-renderer" && unityRendererPeers().length === 0) {
    renderNodes.delete(UNITY_RENDER_NODE_ID);
    console.log(`[unity-signaling] Unity render node removed nodeId=${UNITY_RENDER_NODE_ID}; no Unity signaling peers remain`);
  }
}

function handleUnityConnect(ws, connectionId) {
  if (!connectionId) return;
  console.log(
    `[unity-signaling] ${unityPeerRole(ws)} signaling sent connect peer=${unityPeerLabel(ws)} connectionId=${connectionId}`
  );
  getUnityConnectionIds(ws).add(connectionId);
  if (unityPeerRole(ws) === "unity-renderer") {
    registerUnitySignalingNode(`connect:${connectionId}`);
  }
  sendUnitySignalingToOthers(ws, { type: "connect", connectionId });
  sendUnitySignaling(ws, { type: "connect", connectionId, polite: true });
}

function handleUnityDisconnect(ws, connectionId) {
  if (!connectionId) return;
  console.log(
    `[unity-signaling] ${unityPeerRole(ws)} signaling sent disconnect peer=${unityPeerLabel(ws)} connectionId=${connectionId}`
  );
  getUnityConnectionIds(ws).delete(connectionId);

  const pair = unityConnectionPairs.get(connectionId);
  if (pair) {
    const other = pair[0] === ws ? pair[1] : pair[0];
    if (other) sendUnitySignaling(other, { type: "disconnect", connectionId });
  } else {
    sendUnitySignalingToOthers(ws, { type: "disconnect", connectionId });
  }
  unityConnectionPairs.delete(connectionId);
  sendUnitySignaling(ws, { type: "disconnect", connectionId });
}

function handleUnityOffer(ws, data) {
  const connectionId = data?.connectionId;
  if (!connectionId) return;

  getUnityConnectionIds(ws).add(connectionId);
  const offer = { sdp: data.sdp, datetime: Date.now(), polite: false };
  unityConnectionPairs.set(connectionId, [ws, null]);
  sendUnitySignalingToOthers(ws, { from: connectionId, to: "", type: "offer", data: offer });
}

function handleUnityAnswer(ws, data) {
  const connectionId = data?.connectionId;
  if (!connectionId || !unityConnectionPairs.has(connectionId)) return;

  getUnityConnectionIds(ws).add(connectionId);
  const pair = unityConnectionPairs.get(connectionId);
  const other = pair[0] === ws ? pair[1] : pair[0];
  if (!other) return;

  unityConnectionPairs.set(connectionId, [other, ws]);
  sendUnitySignaling(other, {
    from: connectionId,
    to: "",
    type: "answer",
    data: { sdp: data.sdp, datetime: Date.now() }
  });
}

function handleUnityCandidate(ws, data) {
  const connectionId = data?.connectionId;
  if (!connectionId) return;

  getUnityConnectionIds(ws).add(connectionId);
  const candidate = {
    candidate: data.candidate,
    sdpMLineIndex: data.sdpMLineIndex,
    sdpMid: data.sdpMid,
    datetime: Date.now()
  };

  sendUnitySignalingToOthers(ws, { from: connectionId, to: "", type: "candidate", data: candidate });
}

async function apiPost(path, body = {}) {
  try {
    await axios.post(`${API_URL}${path}`, body, { timeout: 2000 });
  } catch (err) {
    console.warn(`[api] POST ${path} failed:`, err.message);
  }
}

async function apiPatch(path, body = {}) {
  try {
    await axios.patch(`${API_URL}${path}`, body, { timeout: 2000 });
  } catch (err) {
    console.warn(`[api] PATCH ${path} failed:`, err.message);
  }
}

app.get("/health", (_, res) => {
  res.json({ service: "gateway", status: "ok", nodes: renderNodes.size, sessions: sessionAssignments.size });
});

app.get("/nodes", (_, res) => {
  res.json([...renderNodes.entries()].map(([nodeId, value]) => ({ nodeId, ...value })));
});

const unityWss = new WebSocketServer({ noServer: true });
const socketIoUpgradeListeners = server.listeners("upgrade");
server.removeAllListeners("upgrade");
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url || "/", "http://localhost");
  if (pathname.startsWith("/socket.io")) {
    for (const listener of socketIoUpgradeListeners) {
      listener.call(server, request, socket, head);
    }
    return;
  }

  unityWss.handleUpgrade(request, socket, head, (ws) => {
    unityWss.emit("connection", ws, request);
  });
});

unityWss.on("connection", (ws, request) => {
  ws.peerId = `unity-ws-${++unityPeerSequence}`;
  ws.peerRole = rawSignalingRole(request);
  console.log(
    `[unity-signaling] raw WebSocket connected role=${unityPeerRole(ws)} peer=${unityPeerLabel(ws)} remote=${request.socket.remoteAddress || "unknown"} url=${request.url || "/"}`
  );
  unitySignalingPeers.set(ws, new Set());
  if (unityPeerRole(ws) === "unity-renderer") {
    registerUnitySignalingNode("raw-websocket-open");
    apiPost("/nodes/register", {
      node_id: UNITY_RENDER_NODE_ID,
      kind: "unity-renderer",
      capabilities: ["unity-render-streaming", "webrtc-signaling"]
    });

    for (const [peer, connectionIds] of unitySignalingPeers.entries()) {
      if (peer !== ws && unityPeerRole(peer) === "browser") {
        for (const connectionId of connectionIds) {
          sendUnitySignaling(ws, { type: "connect", connectionId });
        }
      }
    }
  }

  ws.on("message", (raw) => {
    if (unityPeerRole(ws) === "unity-renderer") {
      touchUnitySignalingNode();
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendUnitySignaling(ws, { type: "error", message: "Invalid JSON signaling message." });
      return;
    }

    switch (msg.type) {
      case "connect":
        handleUnityConnect(ws, msg.connectionId);
        break;
      case "disconnect":
        handleUnityDisconnect(ws, msg.connectionId);
        break;
      case "offer":
        handleUnityOffer(ws, msg.data);
        break;
      case "answer":
        handleUnityAnswer(ws, msg.data);
        break;
      case "candidate":
        handleUnityCandidate(ws, msg.data);
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    const connectionCount = unitySignalingPeers.get(ws)?.size || 0;
    console.log(
      `[unity-signaling] raw WebSocket disconnected role=${unityPeerRole(ws)} peer=${unityPeerLabel(ws)} trackedConnections=${connectionCount}`
    );
    removeUnitySignalingPeer(ws);
  });

  ws.on("error", (err) => {
    console.warn("[unity-signaling] raw WebSocket error:", err.message);
  });
});

io.on("connection", (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  socket.on("browser:join_session", async (msg = {}) => {
    const { sessionId } = msg;
    if (!sessionId) return socket.emit("gateway:error", { message: "sessionId is required" });

    console.log(`[gateway] frontend starts render session sessionId=${sessionId} socket=${socket.id}`);

    socket.data.role = "browser";
    socket.data.sessionId = sessionId;
    socket.join(sessionRoom(sessionId));

    let nodeId = sessionAssignments.get(sessionId);
    if (!nodeId) {
      const chosen = chooseAvailableNode();
      if (!chosen) {
        console.warn(`[gateway] render node unavailable for sessionId=${sessionId}; registeredNodes=${renderNodes.size}`);
        socket.emit("gateway:error", { message: "No render node is registered. Start the Unity render node." });
        return;
      }
      nodeId = chosen.nodeId;
      console.log(
        `[gateway] render node available for sessionId=${sessionId} nodeId=${nodeId} kind=${chosen.node.kind || "unknown"} status=${chosen.node.status}`
      );
      sessionAssignments.set(sessionId, nodeId);
      await apiPost(`/sessions/${sessionId}/assign`, { node_id: nodeId });
    } else {
      const node = renderNodes.get(nodeId);
      console.log(
        `[gateway] render node already assigned for sessionId=${sessionId} nodeId=${nodeId} registered=${Boolean(node)} status=${node?.status || "unknown"}`
      );
    }

    socket.emit("gateway:session_joined", { sessionId, nodeId });
    io.to(sessionRoom(sessionId)).emit("session:status", { sessionId, status: "assigned", nodeId });
  });

  socket.on("browser:command", async (msg = {}) => {
    const { sessionId, command } = msg;
    if (!sessionId || !command?.type) {
      return socket.emit("gateway:error", { message: "sessionId and command.type are required" });
    }

    const nodeId = sessionAssignments.get(sessionId);
    if (!nodeId) {
      return socket.emit("gateway:error", { message: `No render node assigned for session ${sessionId}` });
    }

    io.to(sessionRoom(sessionId)).emit("session:command_ack", { sessionId, command });

    await apiPost(`/sessions/${sessionId}/events`, { source: "browser", type: `command.${command.type}`, payload: command.payload || {} });
    await apiPatch(`/sessions/${sessionId}/configuration`, { patch: command.payload || {} });
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on ${PORT}; API_URL=${API_URL}`);
});
