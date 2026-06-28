import express from "express";
import http from "http";
import cors from "cors";
import axios from "axios";
import { Server } from "socket.io";

const PORT = process.env.PORT || 8080;
const API_URL = process.env.API_URL || "http://localhost:8000";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 5e6
});

const renderNodes = new Map(); // nodeId -> { socketId, status, capabilities, lastSeenAt }
const sessionAssignments = new Map(); // sessionId -> nodeId

function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}

function chooseAvailableNode() {
  for (const [nodeId, node] of renderNodes.entries()) {
    if (node.status === "available") return { nodeId, node };
  }
  return null;
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

io.on("connection", (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  socket.on("render:register", async (msg = {}) => {
    const nodeId = msg.nodeId || `node-${socket.id}`;
    socket.data.role = "render-node";
    socket.data.nodeId = nodeId;
    socket.join(`node:${nodeId}`);

    renderNodes.set(nodeId, {
      socketId: socket.id,
      status: "available",
      kind: msg.kind || "mock",
      capabilities: msg.capabilities || [],
      lastSeenAt: new Date().toISOString()
    });

    console.log(`[render] registered ${nodeId}`);
    socket.emit("render:registered", { nodeId });
    await apiPost("/nodes/register", { node_id: nodeId, kind: msg.kind || "mock", capabilities: msg.capabilities || [] });
  });

  socket.on("render:heartbeat", async (msg = {}) => {
    const nodeId = msg.nodeId || socket.data.nodeId;
    if (!nodeId) return;
    const node = renderNodes.get(nodeId);
    if (node) {
      node.lastSeenAt = new Date().toISOString();
      node.status = msg.status || "available";
    }
    await apiPost(`/nodes/${nodeId}/heartbeat`);
  });

  socket.on("browser:join_session", async (msg = {}) => {
    const { sessionId } = msg;
    if (!sessionId) return socket.emit("gateway:error", { message: "sessionId is required" });

    socket.data.role = "browser";
    socket.data.sessionId = sessionId;
    socket.join(sessionRoom(sessionId));

    let nodeId = sessionAssignments.get(sessionId);
    if (!nodeId) {
      const chosen = chooseAvailableNode();
      if (!chosen) {
        socket.emit("gateway:error", { message: "No render node is registered. Start mock-render-node or Unity render node." });
        return;
      }
      nodeId = chosen.nodeId;
      sessionAssignments.set(sessionId, nodeId);
      await apiPost(`/sessions/${sessionId}/assign`, { node_id: nodeId });
      io.to(`node:${nodeId}`).emit("render:attach_session", { sessionId });
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

    io.to(`node:${nodeId}`).emit("render:command", { sessionId, command });
    io.to(sessionRoom(sessionId)).emit("session:command_ack", { sessionId, command });

    await apiPost(`/sessions/${sessionId}/events`, { source: "browser", type: `command.${command.type}`, payload: command.payload || {} });
    await apiPatch(`/sessions/${sessionId}/configuration`, { patch: command.payload || {} });
  });

  socket.on("render:frame", async (msg = {}) => {
    const { sessionId, frame, metadata } = msg;
    if (!sessionId || !frame) return;
    io.to(sessionRoom(sessionId)).emit("stream:frame", { sessionId, frame, metadata });
  });

  socket.on("render:event", async (msg = {}) => {
    const { sessionId, type, payload } = msg;
    if (!sessionId || !type) return;
    io.to(sessionRoom(sessionId)).emit("render:event", { sessionId, type, payload });
    await apiPost(`/sessions/${sessionId}/events`, { source: "render-node", type, payload: payload || {} });
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected ${socket.id}`);
    if (socket.data.role === "render-node" && socket.data.nodeId) {
      renderNodes.delete(socket.data.nodeId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on ${PORT}; API_URL=${API_URL}`);
});
