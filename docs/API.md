# Hermes Agent Bridge — API Reference

This document describes the public HTTP and Server-Sent Events (SSE) endpoints provided by the Hermes Agent Bridge server.

---

## 🟢 System Endpoints

### 1. health check (`GET /health`)
Returns the current health status of the Hermes server, connection to Ollama/LLM, config profile, and version.

* **URL:** `/health`
* **Method:** `GET`
* **Response Status:** `200 OK` (if LLM is available) or `207 Multi-Status` (if LLM is unavailable/degraded)
* **Response Body:**
```json
{
  "server": "ok",
  "version": "1.0.0",
  "profile": "ILMA",
  "uptime": 120,
  "llm": {
    "status": "ok",
    "model": "llama3.2",
    "baseUrl": "http://localhost:11434/v1"
  }
}
```

### 2. Metrics & Stats (`GET /stats`)
Returns active session count, total requests processed, system memory usage, and uptime.

* **URL:** `/stats`
* **Method:** `GET`
* **Response Status:** `200 OK`
* **Response Body:**
```json
{
  "uptime": 120,
  "activeSessions": 1,
  "totalRequests": 12,
  "memory": {
    "rss": 83431424,
    "heapTotal": 45613056,
    "heapUsed": 28416416,
    "external": 1474128
  }
}
```

---

## 🔄 Session Lifecycle Endpoints

### 3. Start Session (`POST /v1/session/start`)
Initiates a new workspace session and generates a persistent `session_id`.

* **URL:** `/v1/session/start`
* **Method:** `POST`
* **Request Headers:** `Content-Type: application/json`
* **Request Body:**
```json
{
  "workspace": "/absolute/path/to/project",
  "profile": "ILMA"
}
```
* **Response Status:** `200 OK`
* **Response Body:**
```json
{
  "session_id": "dd242a5a-03e8-463a-95c3-a7318ea3841e",
  "status": "started"
}
```

### 4. End Session (`POST /v1/session/end`)
Cleans up and terminates an active workspace session.

* **URL:** `/v1/session/end`
* **Method:** `POST`
* **Request Headers:** `Content-Type: application/json`
* **Request Body:**
```json
{
  "session_id": "dd242a5a-03e8-463a-95c3-a7318ea3841e"
}
```
* **Response Status:** `200 OK`
* **Response Body:**
```json
{
  "session_id": "dd242a5a-03e8-463a-95c3-a7318ea3841e",
  "status": "ended"
}
```

---

## ⚡ Agent Loop & SSE Stream

### 5. SSE Event Stream (`GET /v1/session/:sessionId/stream`)
Establish a persistent connection to stream agent updates, plans, code diffs, execution output, and errors.
Supports auto-resume from connection failure by passing the `lastEventId` query parameter or header.

* **URL:** `/v1/session/:sessionId/stream`
* **Method:** `GET`
* **Headers:** `Accept: text/event-stream`
* **Query Parameters:**
  * `lastEventId` *(optional)*: Replays missed events starting from this ID.
* **Event Types:**
  * `plan`: Stream agent goal and step-by-step plan list.
  * `diff`: Unified diff representation for file edits or terminal commands.
  * `awaiting_approval`: Triggers when steps wait for manual approval.
  * `applied`: Triggers when step writes code or executes a command.
  * `rejected`: Triggers when user cancels execution.
  * `result`: Outputs execution results.
  * `error`: Relays LLM timeouts or file system write errors.
  * `done`: Signal final plan execution completion.

### 6. Run Agent (`POST /v1/agent/run`)
Submits a user coding task to the agent to generate and stream the plan execution loop.

* **URL:** `/v1/agent/run`
* **Method:** `POST`
* **Request Headers:** `Content-Type: application/json`
* **Request Body:**
```json
{
  "session_id": "dd242a5a-03e8-463a-95c3-a7318ea3841e",
  "task": "Create a hello-world.ts script that logs message to console.",
  "workspace": { "root": "/absolute/path/to/project" },
  "mode": "review"
}
```
* **Response Status:** `202 Accepted`

### 7. Approve Step (`POST /v1/agent/approve/:sessionId/:stepId`)
Approve the suggested changes (file write or command execution) for a pending step.

* **URL:** `/v1/agent/approve/:sessionId/:stepId`
* **Method:** `POST`
* **Response Status:** `200 OK`
* **Response Body:**
```json
{
  "status": "approved",
  "step_id": "1"
}
```

### 8. Reject Step (`POST /v1/agent/reject/:sessionId/:stepId`)
Reject a step's action and prompt the agent to proceed to the next step or halt.

* **URL:** `/v1/agent/reject/:sessionId/:stepId`
* **Method:** `POST`
* **Response Status:** `200 OK`
* **Response Body:**
```json
{
  "status": "rejected",
  "step_id": "1"
}
```
