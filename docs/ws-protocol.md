# Gateway WebSocket Protocol

## Render node -> Gateway

### render:register
```json
{
  "nodeId": "unity-renderer-01",
  "kind": "unity-renderer",
  "capabilities": ["frame-stream", "command-routing"]
}
```

### render:heartbeat
```json
{ "nodeId": "unity-renderer-01", "status": "available" }
```

### render:frame
```json
{
  "sessionId": "uuid",
  "frame": "data:image/svg+xml;base64,...",
  "metadata": { "frameCounter": 42 }
}
```

### render:event
```json
{
  "sessionId": "uuid",
  "type": "render.command_applied",
  "payload": {}
}
```

## Gateway -> Render node

### render:attach_session
```json
{ "sessionId": "uuid" }
```

### render:command
```json
{
  "sessionId": "uuid",
  "command": {
    "type": "set_paint",
    "payload": { "paint": "#c32222" }
  }
}
```

## Browser -> Gateway

### browser:join_session
```json
{ "sessionId": "uuid" }
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
