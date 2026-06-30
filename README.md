# ZeroLight-Inspired Render Platform Prototype

A small interview-prep prototype that simulates a cloud-rendering / 3D-streaming configurator platform.

The current vertical slice uses Unity Render Streaming as the media path:

- Browser creates a render session through FastAPI.
- Browser connects to Node.js Gateway over Socket.IO for session/control events.
- Unity renderer connects to the Gateway over raw WebSocket signaling.
- Gateway assigns the browser session to the render node.
- Browser sends configuration commands to the Gateway.
- Browser and Unity exchange WebRTC offer/answer/candidate messages through the Gateway.
- Unity Render Streaming media plays in the browser as a WebRTC video stream.
- FastAPI stores sessions, node status, configurations and events in MongoDB.

---

## Architecture

```text
Browser / React UI
  | HTTP: create session, read events
  v
Python FastAPI Render API  ---> MongoDB
  ^
  | event/config writes from Gateway
  |
Node.js Realtime Gateway <---- Unity Renderer
  ^        | Socket.IO control          | raw WebSocket signaling
  |        v                            v
Browser Socket.IO client        Browser WebRTC video
```

Important decision: the Gateway remains the rendezvous point. Socket.IO is used for browser session/control events; live media stays on Unity Render Streaming WebRTC and is not converted into Socket.IO image frames.

---

## Repo structure

```text
apps/frontend/                 React configurator UI
services/api/                  Python FastAPI Render Session API
services/gateway/              Node.js realtime Gateway
services/unity-renderer/       Unity project and local Linux player artifacts
k8s/                           Kubernetes manifests for backend services
docs/ws-protocol.md            Socket.IO control and Unity raw signaling contract
```

---

## API endpoints

- `GET /health`
- `POST /sessions`
- `GET /sessions/{session_id}`
- `POST /sessions/{session_id}/assign`
- `PATCH /sessions/{session_id}/configuration`
- `POST /nodes/register`
- `POST /nodes/{node_id}/heartbeat`
- `POST /sessions/{session_id}/events`
- `GET /sessions/{session_id}/events`
- `GET /dashboard`

---

## WebSocket / Socket.IO protocol

See `docs/ws-protocol.md`.

Key browser Socket.IO events:

- `browser:join_session`
- `browser:command`

Key Unity Render Streaming raw WebSocket messages:

- `connect`
- `disconnect`
- `offer`
- `answer`
- `candidate`

---

## Run on Kubernetes

This assumes a local cluster such as Docker Desktop Kubernetes, Minikube or Kind.

Build local images:

```bash
docker build -t render-api:loadbalancer ./services/api
docker build -t render-gateway:loadbalancer ./services/gateway
docker build -t render-frontend:local ./apps/frontend
docker build -t unity-renderer:local ./services/unity-renderer
```

The Unity image expects Linux player artifacts in:

```text
services/unity-renderer/builds/
  unity-build.x86_64
  UnityPlayer.so
  unity-build_Data/
```

`builds/` is intentionally treated as local/generated output. Rebuild or copy Unity player artifacts there before building `unity-renderer:local`.

In Kubernetes the Unity renderer runs as the `unity-renderer` deployment and connects outbound to the Gateway with `SIGNALING_URL=ws://gateway:8080`. It does not need a Kubernetes Service unless the renderer later exposes an inbound API.

Apply manifests:

```bash
kubectl apply -f k8s/
```

Check resources:

```bash
kubectl get pods -n render-platform
kubectl get svc -n render-platform
```

Open through LoadBalancer services:

- Frontend: http://localhost:5173
- API: http://localhost:8000/health
- Gateway: http://localhost:8080/health

Verify from a terminal:

```bash
curl http://localhost:8000/health
open http://localhost:5173
```

MongoDB is intentionally internal only at `mongo:27017`; it is not exposed through LoadBalancer.

Click **Start render session** in the frontend. You should see the Unity Render Streaming WebRTC video in the browser. Change paint, wheels, environment and animation to persist command/configuration events. Then click **Refresh events from MongoDB**.

The Unity build implements the Unity Render Streaming contract:

1. Connect to the Gateway raw WebSocket signaling endpoint.
2. Exchange `connect`, `disconnect`, `offer`, `answer`, and `candidate` messages.
3. Send Unity Render Streaming WebRTC media to the browser.

For the MVP Unity bridge, keep browser command names stable and do not convert WebRTC media into Socket.IO frames.

---

## Production migration path

The prototype separates three planes:

### Control plane

Browser commands go to Gateway/API for session control, event persistence and configuration updates. Unity renderer availability is registered from its raw WebSocket signaling connection.

### Media plane

Unity Render Streaming uses raw WebSocket signaling through the Gateway and WebRTC media directly in the browser video element.

### Data plane

FastAPI and MongoDB store session metadata, current configuration, node status and event history.

### Migration from containerized Unity renderer to GPU workers

Current:

```text
Kubernetes backend + Unity renderer deployment
```

Later:

```text
Kubernetes backend + GPU-backed render worker pool
```

Because the Gateway talks to generic render nodes, a future worker can be:

- Unity running on a GPU VM
- Unreal Pixel Streaming-style worker
- containerized render worker where licensing/platform support allows it
- cloud GPU instance registered into the same Gateway

The browser does not need to know which worker type is assigned.

---

## Demo script for interview

1. Start the backend stack.
2. Show MongoDB, FastAPI and Gateway health checks.
3. Start the Unity renderer deployment and show it registering with the Gateway.
4. Open the React configurator.
5. Start a render session.
6. Explain session assignment: Browser -> Gateway -> render node.
7. Change paint/wheels/environment/camera.
8. Show the Unity WebRTC video stream playing.
9. Refresh events and show commands stored in MongoDB.
10. Show `docs/ws-protocol.md` and explain how Unity stays behind the generic render-node contract.
11. Explain production migration: containerized Unity renderer today, GPU-backed workers later.
