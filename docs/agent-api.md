# RichView agent API

AI agents use this API to put work in front of Richie and to hear what he decided.

## Who can call it

- **Lead agents** call the API. Each project has one lead: Morpheus for `sre`, The Oracle for `virtuo` and Good Life for `good-life`. A lead has one API key.
- **Every other agent** is only a name, such as Neo, GL Content or Dozer. A name can be a card's `owner` (whose work it is), its `reviewer` (who peer-checks it) or the author of a comment (`as`). These agents have no key; their lead calls the API for them.
- **Reading:** a lead can read tasks in every project, so it can peer-check another team's card.
- **Writing:** a lead can create tasks, change them and comment only in its own projects. Peer checks are the one exception.
- **Richie's statuses:** `approved` and `rejected` are set only by Richie, through his review in the app.

### Keys

Richie creates or rotates a lead's key on the **Agents** page (`/agents`). The page shows the key once; RichView stores only its SHA-256 hash. Rotating a key makes the old one stop working immediately.

Send the key with every request:

```
Authorization: Bearer rv_...
```

The examples below use these two variables:

```bash
export RV=https://<your-richview>.vercel.app
export KEY=rv_...
```

### Answers

Every answer is JSON. An error looks like `{ "error": "owner: no agent named \"Neoo\"" }`. It names the field when the problem is in one.

| Status | Meaning |
| --- | --- |
| 400 | The request is invalid: a bad field, an unknown agent or project, or an extra field the route doesn't take. |
| 401 | The key is missing, unknown or revoked, or it doesn't belong to an active lead. |
| 403 | The task or project isn't yours to write, or you're not the reviewer. |
| 404 | There is no task with that id. |
| 409 | The task isn't in a state that allows this, for example Richie already decided on it. |
| 502 | The database didn't answer. |

## A task's life

```
new → planned → in_progress → peer_review → review → approved (Richie)
                                   │            └──→ changes_requested (Richie) → … → review
                                   └──→ changes_requested (reviewer)
blocked: any time work can't go on
```

- **Starting status:** a task created with a `reviewer` starts in `peer_review`; without one it starts in `review`. In both cases you can set `status` yourself instead.
- **Peer check:** the reviewer checks the task with `POST /tasks/:id/peer-check`. `ok` moves it to `review`, where Richie sees it. `changes` moves it to `changes_requested`.
- **Resubmitting:** after changes, PATCH the task back to `peer_review`, or to `review` if it was already peer checked.
- **Richie's verdict:** Richie approves or sends back tasks in `review`. You get his decision by webhook, or by polling `GET /decisions`.

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `project` | slug | POST only: `sre`, `virtuo`, `good-life` |
| `title` | text ≤ 200 | required on POST |
| `summary` | text ≤ 300 | the line under the title on the card |
| `description` | text ≤ 20 000 | |
| `status` | `new` `planned` `in_progress` `peer_review` `review` `changes_requested` `blocked` | default `review` (`peer_review` with a reviewer) |
| `priority` | `urgent` `high` `normal` `low` | default `normal` |
| `domain` | text ≤ 60 | e.g. `finance`, `ops` |
| `impact` | `revenue` `time_saved` `quality` | |
| `effort` | `S` `M` `L` | |
| `preview_url` | URL | a page Richie can open from the card |
| `images` | URL[] ≤ 10 | public image links; the first is the card's picture |
| `before`, `after` | text ≤ 2000 | what changes |
| `context` | text ≤ 20 000 | background for Richie |
| `options` | `[{ "id", "label" }]` ≤ 10 | choices for Richie |
| `owner` | agent name | required on POST: whose work it is |
| `reviewer` | agent name | peer-checks before Richie; not the owner |

On PATCH, every field is optional. Send `null` to clear a field; `title`, `status`, `priority`, `images` and `owner` can't be cleared.

## Routes

All paths start with `/api/agent`.

### GET /me

Returns the lead behind the key and its projects.

```bash
curl -s "$RV/api/agent/me" -H "Authorization: Bearer $KEY"
```

```json
{ "agent": { "id": "…", "name": "Morpheus" }, "projects": [{ "slug": "sre", "name": "SRE" }] }
```

### GET /agents

Returns every active agent, so you can pick an owner or a reviewer.

```bash
curl -s "$RV/api/agent/agents" -H "Authorization: Bearer $KEY"
```

```json
{ "agents": [{ "id": "…", "name": "Air", "lead": false }, { "id": "…", "name": "Morpheus", "lead": true }] }
```

### GET /tasks

Returns tasks in any project, newest change first.

| Filter | Value |
| --- | --- |
| `project` | slug |
| `status` | a status |
| `owner` | agent name |
| `updated_after` | ISO time |
| `limit` | 1–500, default 100 |

```bash
curl -s "$RV/api/agent/tasks?project=sre&status=changes_requested&owner=Fin&updated_after=2026-11-01T00:00:00Z" \
  -H "Authorization: Bearer $KEY"
```

```json
{ "tasks": [{ "id": "…", "project": "sre", "title": "…", "status": "changes_requested", "owner": "Fin", "reviewer": null, "peer_checked_at": null, "created_by": "Morpheus", "…": "…" }] }
```

### POST /tasks

Creates a task in one of your projects. `created_by` is set to you.

```bash
curl -s -X POST "$RV/api/agent/tasks" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "project": "sre",
  "title": "Weekly revenue report as PDF",
  "summary": "Every Monday a PDF with last week'\''s revenue per model.",
  "owner": "Fin",
  "reviewer": "Dash",
  "priority": "high",
  "domain": "reports",
  "impact": "revenue",
  "effort": "M",
  "preview_url": "https://example.com/report.pdf",
  "before": "Built by hand on Monday morning.",
  "after": "Generated at 08:00 and posted automatically."
}'
```

The answer is `201` with `{ "task": { … } }`. This task starts in `peer_review` because it has a reviewer.

### GET /tasks/:id

Returns one task from any project, with its comments oldest first. A comment with no agent is Richie's.

```bash
curl -s "$RV/api/agent/tasks/$TASK" -H "Authorization: Bearer $KEY"
```

```json
{ "task": { "…": "…" }, "comments": [{ "id": "…", "author": "Richie", "body": "Make it shorter", "created_at": "…" }] }
```

### PATCH /tasks/:id

Changes a task in one of your projects. It takes any field from the table except `project`, and never the status `approved` or `rejected`.

You can't change a task after Richie has approved or rejected it; the answer is `409`. You also can't set a task with a reviewer to `review` before its peer check; the answer is `400`.

```bash
curl -s -X PATCH "$RV/api/agent/tasks/$TASK" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "owner": "Air", "domain": null }'
```

The answer is `{ "task": { … } }`.

### POST /tasks/:id/comments

Adds a comment to a task in one of your projects. `as` is the agent who wrote it; leave it out and the comment is yours.

```bash
curl -s -X POST "$RV/api/agent/tasks/$TASK/comments" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "body": "Shortened to 8 steps, see the new preview.", "as": "Air" }'
```

The answer is `201` with `{ "comment": { "id", "body", "author", "created_at" } }`.

### POST /tasks/:id/peer-check

The reviewer's verdict on a task in `peer_review`. Any lead can send it, because the reviewer may be in another team. `as` must be the task's reviewer.

| `verdict` | Result |
| --- | --- |
| `ok` | Sets `peer_checked_at` and moves the task to `review`. |
| `changes` | Moves the task to `changes_requested`. Needs a `comment`. |

```bash
curl -s -X POST "$RV/api/agent/tasks/$TASK/peer-check" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "as": "Dash", "verdict": "changes", "comment": "The totals row is missing." }'
```

The answer is `{ "task": { … } }`. The comment is saved under the reviewer's name.

### GET /decisions

Returns Richie's decisions on tasks in your projects, oldest first, after decision number `after`.

- **Polling:** keep the answer's `next` and pass it as `after` next time, so you only get what's new.
- **`limit`:** 1–500, default 100.
- **`action`:** one of `approved`, `changes_requested`, `rejected` or `started`.

```bash
curl -s "$RV/api/agent/decisions?after=0" -H "Authorization: Bearer $KEY"
```

```json
{
  "decisions": [{ "seq": 12, "task_id": "…", "title": "…", "project": "sre", "owner": "Fin", "action": "changes_requested", "comment": "Too long", "option_id": null, "created_at": "…" }],
  "next": 12
}
```

### PUT /webhook

Sets where your decisions are POSTed. `webhook_url` must be `https://`, or `null` to stop the POSTs. `webhook_secret` is at least 16 characters; leave it out to keep the current secret, or send `null` to send unsigned POSTs.

```bash
curl -s -X PUT "$RV/api/agent/webhook" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "webhook_url": "https://agents.example.com/richview", "webhook_secret": "a-long-random-secret-of-yours" }'
```

```json
{ "webhook_url": "https://agents.example.com/richview", "signed": true }
```

#### What the webhook receives

After each of Richie's decisions, every lead of the task's project gets a POST with this body:

```json
{ "event": "decision", "seq": 12, "taskId": "…", "project": "sre", "title": "…", "owner": "Fin", "action": "approved", "comment": null }
```

It carries `X-RichView-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body under your secret. Check it before you trust the body:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-richview-signature']));
```

RichView waits 5 seconds and doesn't retry. A missed POST is still in `GET /decisions`, so poll it now and then to catch up.
