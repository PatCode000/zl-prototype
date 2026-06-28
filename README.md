# ZeroLight-Inspired Render Platform Prototype

A small interview-prep prototype that simulates a cloud-rendering / 3D-streaming configurator platform.

The first vertical slice intentionally avoids WebRTC. It proves the architecture first:

- Browser creates a render session through FastAPI.
- Browser connects to Node.js Gateway over Socket.IO.
- Mock render node registers as a generic render worker.
- Gateway assigns the browser session to the render node.
- Browser sends configuration commands to the Gateway.
- Gateway routes commands to the assigned render node.
- Mock render node emits SVG frames as a fake live stream.
- FastAPI stores sessions, node status, configurations and events in MongoDB.

Later, the mock render node is replaced by a Unity macOS build using the same protocol.

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
Node.js Realtime Gateway <---- Unity or Mock Render Node
  ^        | commands                  | frames/events
  |        v                           v
Browser Socket.IO client <-------- frame stream
```

Important decision: the browser never talks directly to Unity. Unity registers itself as a render node. The Gateway routes all commands and frames based on a session assignment.

---

## Repo structure

```text
apps/frontend/                 React configurator UI
services/api/                  Python FastAPI Render Session API
services/gateway/              Node.js realtime Gateway
services/mock-render-node/     Mock Unity-like render worker
k8s/                           Kubernetes manifests for backend services
docs/ws-protocol.md            Socket.IO protocol contract
```

---

## Run locally with Docker Compose

From the repo root:

```bash
docker compose up --build
```

Open:

- Frontend: http://localhost:5173
- API health: http://localhost:8000/health
- Gateway health: http://localhost:8080/health
- API dashboard: http://localhost:8000/dashboard

Click **Start render session**. You should see generated frames in the browser. Change paint, wheels, environment and animation. Then click **Refresh events from MongoDB**.

---

## Run services manually

MongoDB:

```bash
docker run --rm -p 27017:27017 --name render-mongo mongo:7
```

FastAPI:

```bash
cd services/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
MONGO_URL=mongodb://localhost:27017 uvicorn app.main:app --reload --port 8000
```

Gateway:

```bash
cd services/gateway
npm install
API_URL=http://localhost:8000 npm run dev
```

Mock render node:

```bash
cd services/mock-render-node
npm install
GATEWAY_URL=http://localhost:8080 npm run dev
```

Frontend:

```bash
cd apps/frontend
npm install
VITE_API_URL=http://localhost:8000 VITE_GATEWAY_URL=http://localhost:8080 npm run dev
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

Key browser events:

- `browser:join_session`
- `browser:command`

Key render node events:

- `render:register`
- `render:heartbeat`
- `render:frame`
- `render:event`

Key gateway-to-render-node events:

- `render:attach_session`
- `render:command`

---

## Kubernetes local run

This assumes a local cluster such as Docker Desktop Kubernetes, Minikube or Kind.

Build local images:

```bash
docker build -t render-api:local ./services/api
docker build -t render-gateway:local ./services/gateway
docker build -t render-frontend:local ./apps/frontend
```

Apply manifests:

```bash
kubectl apply -f k8s/
```

Check pods:

```bash
kubectl get pods -n render-platform
kubectl get svc -n render-platform
```

For Docker Desktop Kubernetes, open:

- Frontend: http://localhost:30517
- API: http://localhost:30080/health
- Gateway: http://localhost:30081/health

External Unity/macOS render node can connect to the Gateway NodePort:

```bash
GATEWAY_URL=http://localhost:30081 npm run dev
```

---

## Next step: replace mock render node with Unity

The Unity build should implement the same contract:

1. Connect to Gateway.
2. Emit `render:register` with node id and capabilities.
3. Emit `render:heartbeat` every few seconds.
4. Listen for `render:attach_session`.
5. Listen for `render:command`.
6. Apply paint/wheels/camera/environment/animation changes in the Unity scene.
7. Emit `render:frame` for MVP frame streaming.
8. Emit `render:event` when commands are applied or errors happen.

For the MVP Unity bridge, keep the command protocol simple and stable. Do not bind the browser to Unity-specific message names.

---

## Production migration path

The prototype separates three planes:

### Control plane

Browser commands go to Gateway, then to the assigned render node. Render nodes are registered workers, not hardcoded local processes.

### Media plane

MVP uses frame streaming over Socket.IO. Later this can move to WebRTC or a dedicated streaming service without changing the Render Session API.

### Data plane

FastAPI and MongoDB store session metadata, current configuration, node status and event history.

### Migration from external macOS Unity node to GPU workers

Current:

```text
Kubernetes backend + external macOS Unity render node
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
3. Start the render node and show it registering with the Gateway.
4. Open the React configurator.
5. Start a render session.
6. Explain session assignment: Browser -> Gateway -> render node.
7. Change paint/wheels/environment/camera.
8. Show the frame stream updating.
9. Refresh events and show commands stored in MongoDB.
10. Show `docs/ws-protocol.md` and explain how Unity can replace the mock.
11. Explain production migration: external node today, GPU-backed workers later.
