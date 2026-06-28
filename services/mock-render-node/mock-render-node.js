import { io } from "socket.io-client";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8080";
const NODE_ID = process.env.NODE_ID || `mock-macos-render-node`;

const socket = io(GATEWAY_URL, { transports: ["websocket"] });
const sessions = new Map(); // sessionId -> config
let frameCounter = 0;

const defaultConfig = {
  paint: "silver",
  wheels: "standard",
  camera: "front",
  environment: "studio",
  animation: "idle"
};

function svgFrame(sessionId, config) {
  frameCounter += 1;
  const paint = config.paint || "silver";
  const wheels = config.wheels || "standard";
  const camera = config.camera || "front";
  const environment = config.environment || "studio";
  const animation = config.animation || "idle";
  const t = new Date().toLocaleTimeString();

  const wheelRadius = wheels === "sport" ? 34 : 28;
  const carY = animation === "bounce" ? 165 + Math.round(Math.sin(frameCounter / 4) * 8) : 165;
  const sky = environment === "sunset" ? "#ffcc88" : environment === "garage" ? "#555" : "#dfefff";

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <rect width="960" height="540" fill="${sky}"/>
    <rect y="360" width="960" height="180" fill="#252525"/>
    <text x="30" y="45" font-family="monospace" font-size="24" fill="#111">Mock Render Node: ${NODE_ID}</text>
    <text x="30" y="78" font-family="monospace" font-size="18" fill="#111">session=${sessionId.slice(0, 8)} frame=${frameCounter} time=${t}</text>
    <text x="30" y="108" font-family="monospace" font-size="18" fill="#111">paint=${paint} wheels=${wheels} camera=${camera} env=${environment} anim=${animation}</text>
    <g transform="translate(180 ${carY})">
      <rect x="110" y="90" rx="35" ry="35" width="480" height="110" fill="${paint}" stroke="#111" stroke-width="6"/>
      <path d="M210 90 L290 20 L430 20 L520 90 Z" fill="${paint}" stroke="#111" stroke-width="6"/>
      <rect x="305" y="35" width="100" height="50" rx="8" fill="#bde7ff" stroke="#111" stroke-width="4"/>
      <rect x="420" y="35" width="75" height="50" rx="8" fill="#bde7ff" stroke="#111" stroke-width="4"/>
      <circle cx="210" cy="210" r="${wheelRadius}" fill="#111"/>
      <circle cx="210" cy="210" r="13" fill="#ddd"/>
      <circle cx="500" cy="210" r="${wheelRadius}" fill="#111"/>
      <circle cx="500" cy="210" r="13" fill="#ddd"/>
    </g>
    <text x="30" y="500" font-family="monospace" font-size="18" fill="#eee">This is intentionally not WebRTC yet: gateway-routed frame streaming over Socket.IO.</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

socket.on("connect", () => {
  console.log(`[mock-render-node] connected to ${GATEWAY_URL}`);
  socket.emit("render:register", {
    nodeId: NODE_ID,
    kind: "mock-svg-renderer",
    capabilities: ["frame-stream", "command-routing", "screenshot-capture"]
  });
});

socket.on("render:registered", (msg) => {
  console.log(`[mock-render-node] registered`, msg);
});

socket.on("render:attach_session", ({ sessionId }) => {
  console.log(`[mock-render-node] attached session ${sessionId}`);
  sessions.set(sessionId, { ...defaultConfig });
  socket.emit("render:event", { sessionId, type: "render.session_attached", payload: { nodeId: NODE_ID } });
});

socket.on("render:command", ({ sessionId, command }) => {
  const config = sessions.get(sessionId) || { ...defaultConfig };
  Object.assign(config, command.payload || {});
  sessions.set(sessionId, config);
  console.log(`[mock-render-node] command ${sessionId}`, command);
  socket.emit("render:event", { sessionId, type: "render.command_applied", payload: { command, config } });
});

setInterval(() => {
  socket.emit("render:heartbeat", { nodeId: NODE_ID, status: "available" });
}, 3000);

setInterval(() => {
  for (const [sessionId, config] of sessions.entries()) {
    socket.emit("render:frame", {
      sessionId,
      frame: svgFrame(sessionId, config),
      metadata: { frameCounter, nodeId: NODE_ID, sentAt: new Date().toISOString() }
    });
  }
}, 500);
