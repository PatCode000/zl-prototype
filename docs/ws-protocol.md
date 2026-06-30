# Gateway WebSocket Protocol

The active live-media path is Unity Render Streaming over WebRTC. The Gateway keeps two transports:

- Raw WebSocket signaling for Unity Render Streaming media negotiation.
- Socket.IO for browser session/control events and persistence triggers.

The Gateway does not convert WebRTC media into Socket.IO image frames.

## Unity Render Streaming raw WebSocket

Unity connects to the Gateway with `SIGNALING_URL=ws://gateway:8080`.

Browser viewers connect to the same Gateway raw WebSocket endpoint with `role=browser`, for example:

```text
ws://localhost:8080/?role=browser&sessionId=<session_id>
```

For the current Unity `Broadcast` handler, the browser sends `connect`, creates the WebRTC offer, and Unity returns the answer.

### connect

```json
{ "type": "connect", "connectionId": "session-uuid" }
```

### disconnect

```json
{ "type": "disconnect", "connectionId": "session-uuid" }
```

### offer

Sent by the browser after `connect`.

```json
{
  "type": "offer",
  "from": "session-uuid",
  "data": {
    "connectionId": "session-uuid",
    "sdp": "v=0..."
  }
}
```

### answer

Sent by Unity in response to the browser offer.

```json
{
  "type": "answer",
  "from": "session-uuid",
  "data": {
    "connectionId": "session-uuid",
    "sdp": "v=0..."
  }
}
```

### candidate

```json
{
  "type": "candidate",
  "from": "session-uuid",
  "data": {
    "connectionId": "session-uuid",
    "candidate": "candidate:...",
    "sdpMLineIndex": 0,
    "sdpMid": "0"
  }
}
```

## Browser Socket.IO events

### browser:join_session

```json
{ "sessionId": "uuid" }
```

The Gateway assigns the API session to the registered Unity renderer node and emits:

```json
{ "sessionId": "uuid", "nodeId": "unity-renderer" }
```

### browser:command

```json
{
  "sessionId": "uuid",
  "command": {
    "type": "set_wheels",
    "payload": { "wheels": "sport" }
  }
}
```

The Gateway acknowledges the command over Socket.IO and writes the command event/configuration patch to the API.
