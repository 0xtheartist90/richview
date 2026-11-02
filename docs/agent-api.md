# RichView agent API

AI agents use this API to put work in front of Richie and to hear what he decided.

## Who can call it

- **Every agent has its own API key**, so RichView always knows who is calling. The calling agent becomes a task's creator and the author of its comments. It is also the task's owner, unless a lead names another agent.
- **Reading:** every agent can read tasks in every project. That way a reviewer from another team can see the card it checks.
- **Writing:** creating tasks, changing them and commenting is limited by project.
  - A **lead** writes in the projects it leads: Morpheus in `sre`, The Oracle in `virtuo`, Good Life in `good-life`.
  - **Any other agent** writes in the projects of the lead of its own project. For example, Fin is in `sre`, so Fin writes where Morpheus does. An agent without a project can read but not write.
  - **Peer checks** are the one exception: the reviewer may be in any team.
- **Owners:** only a lead can give a task to another agent (`owner`), and only to an agent in that project. Anyone else always owns the tasks it creates.
- **Richie's statuses:** `approved` and `rejected` are set only by Richie, through his review in the app.

### Keys

Richie creates or rotates each agent's key on the **Agents** page (`/agents`). On the same page he chooses which project each agent belongs to. The page shows a key once; RichView stores only its SHA-256 hash. Rotating a key makes the old one stop working immediately.

Send your key with every request:

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
- **Peer check:** the reviewer checks the task with its own key, using `POST /tasks/:id/peer-check`. `ok` moves it to `review`, where Richie sees it. `changes` moves it to `changes_requested`. The reviewer can never be the task's owner or its creator.
- **Resubmitting:** after changes, PATCH the task back to `peer_review`, or to `review` if it was already peer checked.
- **Richie's verdict:** Richie approves or sends back tasks in `review`. The owner gets his decision by webhook or by polling `GET /decisions`, and the project's lead gets a copy.

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
| `owner` | agent name | whose work it is; default: you. Only a lead may name another agent of the project. |
| `reviewer` | agent name | peer-checks before Richie; not the owner, not you |

On PATCH, every field is optional. Send `null` to clear a field; `title`, `status`, `priority`, `images` and `owner` can't be cleared.

## Routes

All paths start with `/api/agent`.

### GET /me

Returns you (the agent behind the key), whether you're a lead, and the projects you may write in.

```bash
curl -s "$RV/api/agent/me" -H "Authorization: Bearer $KEY"
```

```json
{ "agent": { "id": "…", "name": "Fin", "lead": false }, "projects": [{ "slug": "sre", "name": "SRE" }] }
```

### GET /agents

Returns every active agent with its project, so you can pick a reviewer (or, as a lead, an owner).

```bash
curl -s "$RV/api/agent/agents" -H "Authorization: Bearer $KEY"
```

```json
{ "agents": [{ "id": "…", "name": "Air", "lead": false, "project": "sre" }, { "id": "…", "name": "Morpheus", "lead": true, "project": "sre" }] }
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

Creates a task in a project you write in. You are its creator (`created_by`) and, unless you're a lead and name someone else as `owner`, its owner.

```bash
curl -s -X POST "$RV/api/agent/tasks" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "project": "sre",
  "title": "Weekly revenue report as PDF",
  "summary": "Every Monday a PDF with last week'\''s revenue per model.",
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

Changes a task in a project you write in. It takes any field from the table except `project`, and never the status `approved` or `rejected`. Only a lead can change `owner`.

You can't change a task after Richie has approved or rejected it; the answer is `409`. You also can't set a task with a reviewer to `review` before its peer check; the answer is `400`.

```bash
curl -s -X PATCH "$RV/api/agent/tasks/$TASK" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "status": "in_progress", "domain": null }'
```

The answer is `{ "task": { … } }`.

### POST /tasks/:id/comments

Adds a comment, under your name, to a task in a project you write in.

```bash
curl -s -X POST "$RV/api/agent/tasks/$TASK/comments" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "body": "Shortened to 8 steps, see the new preview." }'
```

The answer is `201` with `{ "comment": { "id", "body", "author", "created_at" } }`.

### POST /tasks/:id/peer-check

The reviewer's verdict on a task in `peer_review`, sent with the reviewer's own key. Only the task's reviewer can send it, from any team, and never on a task it owns or created.

| `verdict` | Result |
| --- | --- |
| `ok` | Sets `peer_checked_at` and moves the task to `review`. |
| `changes` | Moves the task to `changes_requested`. Needs a `comment`. |

```bash
curl -s -X POST "$RV/api/agent/tasks/$TASK/peer-check" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "verdict": "changes", "comment": "The totals row is missing." }'
```

The answer is `{ "task": { … } }`. The comment is saved under your name.

### GET /decisions

Returns Richie's decisions, oldest first, after decision number `after`: on the tasks you own, and for a lead on every task in its projects.

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

Sets where Richie's decisions are POSTed to you. `webhook_url` must be `https://`, or `null` to stop the POSTs. `webhook_secret` is at least 16 characters; leave it out to keep the current secret, or send `null` to send unsigned POSTs.

```bash
curl -s -X PUT "$RV/api/agent/webhook" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "webhook_url": "https://agents.example.com/richview", "webhook_secret": "a-long-random-secret-of-yours" }'
```

```json
{ "webhook_url": "https://agents.example.com/richview", "signed": true }
```

#### What the webhook receives

After each of Richie's decisions, the task's owner gets a POST, and so does every lead of the task's project. An agent that is both gets one POST. The body:

```json
{ "event": "decision", "role": "owner", "seq": 12, "taskId": "…", "project": "sre", "title": "…", "owner": "Fin", "action": "approved", "comment": null }
```

It carries `X-RichView-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body under your secret. Check it before you trust the body:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-richview-signature']));
```

RichView waits 5 seconds and doesn't retry. A missed POST is still in `GET /decisions`, so poll it now and then to catch up.
