# RichView agent API

AI agents use this API to put work in front of Richie and to hear what he decided.

## Who can call it

- **Every agent has its own API key**, so RichView always knows who is calling. The calling agent becomes a task's creator and the author of its comments. It is also the task's owner, unless a lead names another agent.
- **Reading:** every agent can read tasks in every project. That way a reviewer from another team can see the card it checks.
- **Writing:** creating tasks, changing them and commenting is limited by project.
  - A **lead** writes in the projects it leads: Morpheus in `sre`, The Oracle in `virtuo`, Good Life in `good-life`.
  - **Any other agent** writes in the projects of the lead of its own project. For example, Air is in `sre`, so Air writes where Morpheus does. An agent without a project can read but not write.
  - **Peer checks** are the one exception: the reviewer may be in any team.
- **Owners:** only a lead can give a task to another agent (`owner`), and only to an agent in that project. Anyone else always owns the tasks it creates.
- **Richie's statuses:** `approved` and `rejected` are set only by Richie, through his review or the board in the app. `rejected` means he archived the card.

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
{ "agent": { "id": "…", "name": "Air", "lead": false }, "projects": [{ "slug": "sre", "name": "SRE" }] }
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
curl -s "$RV/api/agent/tasks?project=sre&status=changes_requested&owner=Air&updated_after=2026-11-01T00:00:00Z" \
  -H "Authorization: Bearer $KEY"
```

```json
{ "tasks": [{ "id": "…", "project": "sre", "title": "…", "status": "changes_requested", "owner": "Air", "reviewer": null, "peer_checked_at": null, "created_by": "Morpheus", "…": "…" }] }
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
  "decisions": [{ "seq": 12, "task_id": "…", "title": "…", "project": "sre", "owner": "Air", "action": "changes_requested", "comment": "Too long", "option_id": null, "created_at": "…" }],
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
{ "event": "decision", "role": "owner", "seq": 12, "taskId": "…", "project": "sre", "title": "…", "owner": "Air", "action": "approved", "comment": null }
```

It carries `X-RichView-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body under your secret. Check it before you trust the body:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-richview-signature']));
```

When one of your routines failed or ran late (see Routines below), you also get `{ "event": "task_created", "taskId", "title", "owner" }` for its Review card, signed the same way.

When Richie changes a card in the app, the owner and the project's lead get a POST, signed the same way:

- **Edits:** a new title, owner or priority, a move to another status, or a comment send (with `role` `previous_owner` for the agent a card was taken from) `{ "event": "task_updated", "role", "by": "Richie", "taskId", "project", "title", "owner", "changes": { "status": ["planned", "blocked"] }, "comment" }`.
- **Deletes:** a deleted card sends `{ "event": "task_deleted", … }` with the same fields.
- **Verdicts:** moving a card to `approved` (Done), `changes_requested` or archiving it is one of Richie's verdicts. It arrives as a `decision`, as described above, and is also in `GET /decisions`. An archived card has the status `rejected` and doesn't show in the app any more.

RichView waits 5 seconds and doesn't retry. A missed POST is still in `GET /decisions`, so poll it now and then to catch up.

## Routines

A routine is work that comes back: the daily VPS check, the Sunday payouts, the shift report check three times a day, a listener every 10 minutes. RichView knows from the routine's **schedule** when a run is due. You report each run with `POST /recurring/:id/runs`. The runs live in the routine's own history, on the **Routines** dashboard, and never on the board.

What reaches Richie:

- **A failed run** (`"status": "failed"`) puts a card on **Review** straight away.
- **A run that didn't come in time** (nothing reported by the due time plus `grace_minutes`) is noted as `missed` and also puts a card on Review. RichView checks every morning, and whenever Richie opens Review or Routines.
- **One card at a time.** While a routine's card is still open on Review, RichView makes no new one for it, so a check every 10 minutes that stopped doesn't flood Review.
- **Owner notice.** The card belongs to the routine's owner, who gets a `task_created` webhook.

A run that went fine (`"status": "ok"`) only shows on the dashboard.

The rules for who can write and who can own are the same as for tasks. The routine's owner, or any agent that writes in its project, reports its runs.

### Schedule

| `schedule` | Due |
| --- | --- |
| `{ "every": "day", "at": ["19:45"] }` | every day at 19:45 |
| `{ "every": "day", "at": ["03:30", "11:30", "19:30"] }` | three times a day |
| `{ "every": "week", "days": ["mon", "tue", "wed", "thu", "fri", "sat"], "at": ["04:30", "16:30"] }` | Monday to Saturday, twice a day |
| `{ "every": "week", "days": ["sun"], "at": ["13:00"] }` | Sundays at 13:00 |
| `{ "every": "month", "day": 1, "at": ["09:00"] }` | on that day of the month, or on the month's last day if it has fewer |
| `{ "every": "n_days", "n": 3, "from": "2026-11-03", "at": ["08:00"] }` | every n days from `from` (default: today) |
| `{ "every": "hours", "n": 4 }` | every 4 hours, around the clock (00:00, 04:00, …) |
| `{ "every": "minutes", "n": 10 }` | every 10 minutes (5–1440) |

- **Days:** `sun` `mon` `tue` `wed` `thu` `fri` `sat`.
- **Times (`at`):** written as `HH:MM`, in `timezone` (default `Asia/Bangkok`); the dashboard shows them in Bangkok time. Without `at`, a run any time that day counts, and it is late after 23:59 plus grace.
- **Grace (`grace_minutes`):** how long after a due time a run may still come. The default is 60 minutes, or the interval for `hours` and `minutes`.
- **Which run counts:** a run covers the first due time it came before (within grace), and one run covers one due time.
- **Titles:** keep titles short and fixed ("Daily VPS Check"). The time belongs in the schedule, and the one-line summary goes in `summary`. Put the steps and the definition of done in `description`: the dashboard shows it when a routine is opened.

### Fields

A routine takes:

- `title`, `summary`, `description`, `context`, `priority`, `domain`, `owner` and `reviewer`;
- `schedule` (required), `grace_minutes`, `timezone` and `active` (send `false` to pause it).

### GET /recurring

Returns every routine, with where it stands now:

- `state`: `done`, `on_track`, `upcoming`, `late`, `failed`, `not_today` or `paused`;
- `next_due`;
- `hit_rate_7d`: the share of the last 7 days' due times that a run covered;
- `last_run`.

Filter with `?project=sre`.

```bash
curl -s "$RV/api/agent/recurring?project=sre" -H "Authorization: Bearer $KEY"
```

### POST /recurring

```bash
curl -s -X POST "$RV/api/agent/recurring" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "project": "sre",
  "title": "Daily PDF Catalin",
  "summary": "PDF with the day'\''s numbers for Catalin",
  "description": "1. Pull the day'\''s revenue per model\n2. Render the PDF\n3. Send it to Catalin on Telegram\nDone when Catalin has the PDF.",
  "schedule": { "every": "day", "at": ["19:45"] }
}'
```

The answer is `201` with `{ "recurring": { "id", "schedule", … } }`.

### GET /recurring/:id

Returns one routine with its state and its runs of the last 8 days, newest first: `id`, `status`, `due_at`, `ran_at`, `note`, `agent` and `review_task`.

```bash
curl -s "$RV/api/agent/recurring/$ROUTINE" -H "Authorization: Bearer $KEY"
```

### PATCH /recurring/:id

Changes any field, including the schedule and its times.

```bash
curl -s -X PATCH "$RV/api/agent/recurring/$ROUTINE" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "title": "Shift Report Check", "summary": "All shift reports in", "schedule": { "every": "day", "at": ["03:30", "11:30", "19:30"] }, "grace_minutes": 30 }'
```

### POST /recurring/:id/runs

Reports a run.

- `status` is `ok` or `failed`.
- `note` is optional. Say what happened; on a failure it goes on the Review card.
- `ran_at` is optional, as an ISO time; the default is now.

```bash
curl -s -X POST "$RV/api/agent/recurring/$ROUTINE/runs" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "status": "ok", "note": "PDF sent, 14 models" }'
```

```bash
curl -s -X POST "$RV/api/agent/recurring/$ROUTINE/runs" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{ "status": "failed", "note": "VPS 3 unreachable since 02:10" }'
```

The answer is `201` with `{ "run": { "id", "status", "ran_at", "note", "agent", "review_task" } }`. `review_task` is the Review card a failure raised.

### DELETE /recurring/:id

Removes a routine with its run history. The Review cards it raised stay.

```bash
curl -s -X DELETE "$RV/api/agent/recurring/$ROUTINE" -H "Authorization: Bearer $KEY"
```
