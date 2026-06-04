# Justodo

URL: https://justodo-one.vercel.app/

## Task Types

- One-time tasks complete once and stay completed.
- Recurring tasks support daily, weekly, monthly, or custom day intervals. Completing one schedules the next due date only when the task was created with a due date.
- Recurring tasks have editable persistent notes, and completions can store an optional numeric value that is graphed from completion history.
- Task notes can be edited without completing the task.
- Completing a recurring task again on the same calendar date adds to that date's value instead of adding a duplicate graph point.
- Long-running tasks keep progress history with percentage updates and editable persistent project notes.
- Deleting a task sets `deletedAt` instead of removing the MongoDB document.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Add your MongoDB Atlas connection string to `.env`:

   ```bash
   MONGODB_URI=mongodb+srv://...
   MONGODB_DB=justodo
   JUSTODO_API_TOKEN=random
   JUSTODO_TIMEZONE=America/Los_Angeles
   ```

3. Run the local dev server:

   ```bash
   npm run dev
   ```

   `npm run dev` serves the React app and the `/api/tasks` handler locally.

## Automation API

Use this endpoint when another script, cron job, or automation tool should create tasks:

```text
POST /api/automation/tasks
```

Authenticate with either `Authorization: Bearer <JUSTODO_API_TOKEN>` or `x-api-key: <JUSTODO_API_TOKEN>`.

Example one-time task:

```bash
curl -X POST https://justodo-one.vercel.app/api/automation/tasks \
  -H "Authorization: Bearer $JUSTODO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Follow up with recruiter","type":"one-time","details":"Send note before noon"}'
```

Example daily recurring task:

```bash
curl -X POST https://justodo-one.vercel.app/api/automation/tasks \
  -H "Authorization: Bearer $JUSTODO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Apply to jobs","type":"recurring","recurrence":{"mode":"daily","intervalDays":1}}'
```

Example long-running task:

```bash
curl -X POST https://justodo-one.vercel.app/api/automation/tasks \
  -H "Authorization: Bearer $JUSTODO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Portfolio rebuild","type":"long-running","progress":10}'
```

