import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://localhost:8080";

function App() {
  const [session, setSession] = useState(null);
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState("Not connected");
  const [streamStatus, setStreamStatus] = useState("Unity Render Streaming not connected");
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [events, setEvents] = useState([]);
  const videoRef = useRef(null);
  const signalingRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const remoteStreamRef = useRef(null);
  const offerSentRef = useRef(false);
  const [config, setConfig] = useState({
    paint: "silver",
    wheels: "standard",
    camera: "front",
    environment: "studio",
    animation: "idle",
  });

  const canSend = useMemo(() => Boolean(session && socket), [session, socket]);

  useEffect(() => () => stopUnityStream(), []);

  async function startSession() {
    setStatus("Creating session...");
    setStreamStatus("Waiting for Unity session assignment...");
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
    s.on("gateway:session_joined", (msg) => {
      pushEvent("gateway:session_joined", msg);
      startUnityStream(created.session_id);
    });
    s.on("session:status", (msg) => {
      setStatus(`Session ${msg.status}; node=${msg.nodeId}`);
      pushEvent("session:status", msg);
    });
    s.on("session:command_ack", (msg) => pushEvent("session:command_ack", msg.command));
    s.on("gateway:error", (msg) => {
      setStatus(`Gateway error: ${msg.message}`);
      pushEvent("gateway:error", msg);
    });
    setSocket(s);
  }

  function gatewayWebSocketUrl(sessionId) {
    const url = new URL(GATEWAY_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", "browser");
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  }

  function createPeerConnection(connectionId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendUnitySignal({
        type: "candidate",
        data: {
          connectionId,
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid,
        },
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || remoteStreamRef.current || new MediaStream();
      if (!event.streams[0] && !stream.getTracks().includes(event.track)) {
        stream.addTrack(event.track);
      }
      remoteStreamRef.current = stream;
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      setHasRemoteStream(true);
      setStreamStatus("Unity WebRTC media connected");
      videoRef.current?.play().catch(() => {
        setStreamStatus("Unity media connected; browser autoplay is blocked");
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setStreamStatus("Unity WebRTC peer connected");
      if (pc.connectionState === "failed") setStreamStatus("Unity WebRTC peer failed");
      if (pc.connectionState === "disconnected") setStreamStatus("Unity WebRTC peer disconnected");
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "checking") setStreamStatus("Checking Unity WebRTC connection...");
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setStreamStatus("Unity WebRTC media connected");
      }
    };

    return pc;
  }

  function startUnityStream(sessionId) {
    stopUnityStream();

    const connectionId = sessionId;
    const pc = createPeerConnection(connectionId);
    const ws = new WebSocket(gatewayWebSocketUrl(sessionId));

    peerConnectionRef.current = pc;
    signalingRef.current = ws;
    setHasRemoteStream(false);
    setStreamStatus("Connecting to Unity Render Streaming signaling...");

    ws.onopen = () => {
      setStreamStatus("Unity signaling connected; waiting for WebRTC offer...");
      sendUnitySignal({ type: "connect", connectionId });
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        setStreamStatus("Received invalid Unity signaling message");
        return;
      }

      handleUnitySignal(message, connectionId).catch((err) => {
        setStreamStatus(`Unity signaling error: ${err.message}`);
      });
    };

    ws.onclose = () => {
      setStreamStatus("Unity Render Streaming signaling closed");
    };

    ws.onerror = () => {
      setStreamStatus("Unity Render Streaming signaling failed");
    };
  }

  function stopUnityStream() {
    signalingRef.current?.close();
    signalingRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingCandidatesRef.current = [];
    offerSentRef.current = false;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasRemoteStream(false);
  }

  function sendUnitySignal(message) {
    if (signalingRef.current?.readyState === WebSocket.OPEN) {
      signalingRef.current.send(JSON.stringify(message));
    }
  }

  async function handleUnitySignal(message, connectionId) {
    const messageConnectionId = message.from || message.connectionId || message.data?.connectionId;
    if (messageConnectionId && messageConnectionId !== connectionId) return;

    if (message.type === "connect") {
      await sendUnityOffer(connectionId);
      return;
    }

    if (message.type === "offer") {
      await acceptUnityOffer(message.data, connectionId);
      return;
    }

    if (message.type === "answer") {
      await acceptUnityAnswer(message.data);
      return;
    }

    if (message.type === "candidate") {
      await addUnityCandidate(message.data);
      return;
    }

    if (message.type === "disconnect") {
      setStreamStatus("Unity Render Streaming peer disconnected");
      return;
    }

    if (message.type === "error") {
      setStreamStatus(`Unity signaling error: ${message.message}`);
    }
  }

  async function sendUnityOffer(connectionId) {
    const pc = peerConnectionRef.current;
    if (!pc || offerSentRef.current) return;

    offerSentRef.current = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendUnitySignal({
      type: "offer",
      from: connectionId,
      data: { connectionId, sdp: pc.localDescription.sdp },
    });
    setStreamStatus("Sent WebRTC offer to Unity; waiting for answer...");
  }

  async function acceptUnityOffer(data, connectionId) {
    const pc = peerConnectionRef.current;
    if (!pc || !data?.sdp) return;

    const offer = typeof data.sdp === "string" ? { type: "offer", sdp: data.sdp } : data.sdp;
    await pc.setRemoteDescription(offer);
    await flushPendingCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendUnitySignal({
      type: "answer",
      from: connectionId,
      data: { connectionId, sdp: pc.localDescription.sdp },
    });
    setStreamStatus("Answered Unity WebRTC offer; waiting for media...");
  }

  async function acceptUnityAnswer(data) {
    const pc = peerConnectionRef.current;
    if (!pc || !data?.sdp) return;

    const answer = typeof data.sdp === "string" ? { type: "answer", sdp: data.sdp } : data.sdp;
    await pc.setRemoteDescription(answer);
    await flushPendingCandidates();
    setStreamStatus("Unity WebRTC answer received; waiting for media...");
  }

  async function addUnityCandidate(data) {
    const pc = peerConnectionRef.current;
    if (!pc || !data?.candidate) return;

    const candidate = {
      candidate: data.candidate,
      sdpMLineIndex: data.sdpMLineIndex,
      sdpMid: data.sdpMid,
    };

    if (!pc.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  async function flushPendingCandidates() {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    const candidates = pendingCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
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
          <p className="muted">Browser → Gateway/API → Unity render node.</p>
        </div>
        <button onClick={startSession} disabled={Boolean(session)}>Start render session</button>
      </header>

      <section className="grid">
        <div className="card stream">
          <h2>Live Stream Preview</h2>
          <div className="videoShell">
            <video ref={videoRef} autoPlay playsInline muted />
            {!hasRemoteStream && (
              <div className="placeholder">Waiting for Unity Render Streaming media. Start the Unity renderer and render session.</div>
            )}
          </div>
          <p className="muted">{status}</p>
          <p className="muted">{streamStatus}</p>
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
