import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://localhost:8080";

function App() {
  const [session, setSession] = useState(null);
  const [socket, setSocket] = useState(null);
  const [frame, setFrame] = useState(null);
  const [status, setStatus] = useState("Not connected");
  const [events, setEvents] = useState([]);
  const [config, setConfig] = useState({
    paint: "silver",
    wheels: "standard",
    camera: "front",
    environment: "studio",
    animation: "idle",
  });

  const canSend = useMemo(() => Boolean(session && socket), [session, socket]);

  async function startSession() {
    setStatus("Creating session...");
    const response = await fetch(`${API_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: "demo-car", initial_configuration: config }),
    });
    const created = await response.json();
    setSession(created);

    const s = io(GATEWAY_URL, { transports: ["websocket"] });
    s.on("connect", () => {
      setStatus(`Connected to gateway as ${s.id}`);
      s.emit("browser:join_session", { sessionId: created.session_id });
    });
    s.on("gateway:session_joined", (msg) => pushEvent("gateway:session_joined", msg));
    s.on("session:status", (msg) => {
      setStatus(`Session ${msg.status}; node=${msg.nodeId}`);
      pushEvent("session:status", msg);
    });
    s.on("session:command_ack", (msg) => pushEvent("session:command_ack", msg.command));
    s.on("render:event", (msg) => pushEvent(msg.type, msg.payload));
    s.on("stream:frame", (msg) => setFrame(msg.frame));
    s.on("gateway:error", (msg) => {
      setStatus(`Gateway error: ${msg.message}`);
      pushEvent("gateway:error", msg);
    });
    setSocket(s);
  }

  function pushEvent(type, payload) {
    setEvents((prev) => [{ type, payload, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));
  }

  function sendCommand(type, payload) {
    if (!canSend) return;
    const nextConfig = { ...config, ...payload };
    setConfig(nextConfig);
    socket.emit("browser:command", {
      sessionId: session.session_id,
      command: { type, payload },
    });
  }

  async function refreshEventsFromMongo() {
    if (!session) return;
    const response = await fetch(`${API_URL}/sessions/${session.session_id}/events`);
    const data = await response.json();
    setEvents(data.reverse().map((e) => ({ type: e.type, payload: e.payload, at: e.created_at })));
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">ZeroLight-inspired Prototype</p>
          <h1>Cloud Rendering / 3D Streaming Configurator</h1>
          <p className="muted">Browser → Gateway/API → Render Node. Unity will replace the mock node later.</p>
        </div>
        <button onClick={startSession} disabled={Boolean(session)}>Start render session</button>
      </header>

      <section className="grid">
        <div className="card stream">
          <h2>Live Stream Preview</h2>
          {frame ? <img src={frame} alt="mock render stream" /> : <div className="placeholder">No frame yet. Start the stack and render session.</div>}
          <p className="muted">{status}</p>
          {session && <code>session_id: {session.session_id}</code>}
        </div>

        <div className="card controls">
          <h2>Configurator Controls</h2>
          <div className="controlGroup">
            <h3>Paint</h3>
            <button onClick={() => sendCommand("set_paint", { paint: "silver" })}>Silver</button>
            <button onClick={() => sendCommand("set_paint", { paint: "#c32222" })}>Red</button>
            <button onClick={() => sendCommand("set_paint", { paint: "#114b9b" })}>Blue</button>
          </div>
          <div className="controlGroup">
            <h3>Wheels</h3>
            <button onClick={() => sendCommand("set_wheels", { wheels: "standard" })}>Standard</button>
            <button onClick={() => sendCommand("set_wheels", { wheels: "sport" })}>Sport</button>
          </div>
          <div className="controlGroup">
            <h3>Camera / Environment / Animation</h3>
            <button onClick={() => sendCommand("set_camera", { camera: "front" })}>Front</button>
            <button onClick={() => sendCommand("set_camera", { camera: "side" })}>Side</button>
            <button onClick={() => sendCommand("set_environment", { environment: "studio" })}>Studio</button>
            <button onClick={() => sendCommand("set_environment", { environment: "garage" })}>Garage</button>
            <button onClick={() => sendCommand("set_environment", { environment: "sunset" })}>Sunset</button>
            <button onClick={() => sendCommand("set_animation", { animation: config.animation === "bounce" ? "idle" : "bounce" })}>Toggle animation</button>
          </div>
          <button className="secondary" onClick={refreshEventsFromMongo}>Refresh events from MongoDB</button>
        </div>

        <div className="card events">
          <h2>Event Timeline</h2>
          {events.map((event, index) => (
            <pre key={index}>{event.at} | {event.type}\n{JSON.stringify(event.payload, null, 2)}</pre>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
