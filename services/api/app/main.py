import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "render_platform")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app = FastAPI(title="Render Session API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client: AsyncIOMotorClient | None = None

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

class CreateSessionRequest(BaseModel):
    product_id: str = "demo-car"
    initial_configuration: Dict[str, Any] = Field(default_factory=lambda: {
        "paint": "silver",
        "wheels": "standard",
        "camera": "front",
        "environment": "studio",
        "animation": "idle",
    })

class AssignSessionRequest(BaseModel):
    node_id: str

class RegisterNodeRequest(BaseModel):
    node_id: str
    kind: str = "mock"
    capabilities: list[str] = Field(default_factory=list)
    status: str = "available"

class EventRequest(BaseModel):
    source: str
    type: str
    payload: Dict[str, Any] = Field(default_factory=dict)

class ConfigurationPatch(BaseModel):
    patch: Dict[str, Any]

@app.on_event("startup")
async def startup() -> None:
    global client
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.render_sessions.create_index("session_id", unique=True)
    await db.render_nodes.create_index("node_id", unique=True)
    await db.configuration_events.create_index("session_id")
    await db.stream_events.create_index("session_id")

@app.on_event("shutdown")
async def shutdown() -> None:
    if client:
        client.close()

def db():
    if client is None:
        raise RuntimeError("Mongo client not initialized")
    return client[DB_NAME]

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "api"}

@app.post("/sessions")
async def create_session(req: CreateSessionRequest):
    session_id = str(uuid.uuid4())
    session = {
        "session_id": session_id,
        "product_id": req.product_id,
        "status": "created",
        "assigned_node_id": None,
        "current_configuration": req.initial_configuration,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db().render_sessions.insert_one(session)
    await db().configurations.insert_one({
        "session_id": session_id,
        "configuration": req.initial_configuration,
        "created_at": now_iso(),
    })
    session.pop("_id", None)
    return session

@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    session = await db().render_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.post("/sessions/{session_id}/assign")
async def assign_session(session_id: str, req: AssignSessionRequest):
    result = await db().render_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"assigned_node_id": req.node_id, "status": "assigned", "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "assigned_node_id": req.node_id}

@app.patch("/sessions/{session_id}/configuration")
async def patch_configuration(session_id: str, req: ConfigurationPatch):
    session = await db().render_sessions.find_one({"session_id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    config = session.get("current_configuration", {})
    config.update(req.patch)
    await db().render_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"current_configuration": config, "updated_at": now_iso()}},
    )
    await db().configurations.insert_one({
        "session_id": session_id,
        "configuration": config,
        "patch": req.patch,
        "created_at": now_iso(),
    })
    return {"session_id": session_id, "configuration": config}

@app.post("/nodes/register")
async def register_node(req: RegisterNodeRequest):
    node = {
        "node_id": req.node_id,
        "kind": req.kind,
        "capabilities": req.capabilities,
        "status": req.status,
        "last_seen_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db().render_nodes.update_one(
        {"node_id": req.node_id},
        {"$set": node, "$setOnInsert": {"created_at": now_iso()}},
        upsert=True,
    )
    return node

@app.post("/nodes/{node_id}/heartbeat")
async def heartbeat(node_id: str):
    await db().render_nodes.update_one(
        {"node_id": node_id},
        {"$set": {"status": "available", "last_seen_at": now_iso(), "updated_at": now_iso()}},
        upsert=True,
    )
    return {"node_id": node_id, "status": "available", "last_seen_at": now_iso()}

@app.post("/sessions/{session_id}/events")
async def append_event(session_id: str, req: EventRequest):
    if req.type.startswith("stream."):
        collection = db().stream_events
    else:
        collection = db().configuration_events

    event = {
        "event_id": str(uuid.uuid4()),
        "session_id": session_id,
        "source": req.source,
        "type": req.type,
        "payload": req.payload,
        "created_at": now_iso(),
    }
    await collection.insert_one(event)
    event.pop("_id", None)
    return event

@app.get("/sessions/{session_id}/events")
async def list_events(session_id: str):
    config_events = await db().configuration_events.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    stream_events = await db().stream_events.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return sorted(config_events + stream_events, key=lambda e: e["created_at"])

@app.get("/dashboard")
async def dashboard():
    sessions = await db().render_sessions.find({}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    nodes = await db().render_nodes.find({}, {"_id": 0}).sort("updated_at", -1).to_list(50)
    return {"sessions": sessions, "nodes": nodes}
