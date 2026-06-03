import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ObjectId } from "mongodb";
import { getTasksCollection, serializeTask, type TaskDocument } from "./_lib/mongo.js";
import {
  ApiError,
  clampProgress,
  getNextDueAt,
  insertTask,
  normalizeCompletionValue,
  normalizeText
} from "./_lib/task-service.js";
import type { CreateTaskRequest, TaskActionRequest } from "../shared/tasks.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method === "GET") {
      await listTasks(request, response);
      return;
    }

    if (request.method === "POST") {
      await createTask(request, response);
      return;
    }

    if (request.method === "PATCH") {
      await updateTask(request, response);
      return;
    }

    if (request.method === "DELETE") {
      await softDeleteTask(request, response);
      return;
    }

    response.setHeader("Allow", "GET,POST,PATCH,DELETE");
    response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    response.status(statusCode).json({ error: message });
  }
}

async function listTasks(request: VercelRequest, response: VercelResponse) {
  const collection = await getTasksCollection();
  const includeDeleted = parseBooleanQuery(request.query.includeDeleted);
  const filter = includeDeleted ? {} : { deletedAt: null };
  const tasks = await collection
    .find(filter)
    .sort({ deletedAt: 1, status: 1, dueAt: 1, updatedAt: -1, createdAt: -1 })
    .limit(500)
    .toArray();

  response.status(200).json({ tasks: tasks.map(serializeTask) });
}

async function createTask(request: VercelRequest, response: VercelResponse) {
  const body = parseBody<CreateTaskRequest>(request);
  const task = await insertTask(body);
  response.status(201).json({ task });
}

async function updateTask(request: VercelRequest, response: VercelResponse) {
  const id = parseObjectId(request);

  if (!id) {
    response.status(400).json({ error: "Valid task id is required" });
    return;
  }

  const body = parseBody<TaskActionRequest>(request);
  const collection = await getTasksCollection();

  if (body.action === "restore") {
    await collection.updateOne({ _id: id }, { $set: { deletedAt: null, updatedAt: new Date().toISOString() } });
    await sendUpdatedTask(collection, id, response);
    return;
  }

  const task = await collection.findOne({ _id: id, deletedAt: null });

  if (!task) {
    response.status(404).json({ error: "Task not found" });
    return;
  }

  if (body.action === "complete") {
    await completeTask(collection, task, normalizeText(body.note), normalizeCompletionValue(body.value));
    await sendUpdatedTask(collection, id, response);
    return;
  }

  if (body.action === "progress") {
    await updateProgress(collection, task, body.percent, body.note, body.details);
    await sendUpdatedTask(collection, id, response);
    return;
  }

  response.status(400).json({ error: "Action is invalid" });
}

async function completeTask(
  collection: Awaited<ReturnType<typeof getTasksCollection>>,
  task: TaskDocument,
  note: string,
  value: number | null
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const completedOn = getDateKey(now);

  if (task.type === "one-time") {
    await collection.updateOne(
      { _id: task._id },
      {
        $set: {
          status: "completed",
          completedAt: nowIso,
          updatedAt: nowIso
        }
      }
    );
    return;
  }

  if (task.type === "recurring") {
    const recurrence = task.recurrence || { mode: "daily", intervalDays: 1 };
    const nextDueAt = task.hasDueDate ? getNextDueAt(now, recurrence).toISOString() : null;
    const matchingEntries = (task.recurringHistory || [])
      .filter((entry) => getRecurringEntryDateKey(entry.completedOn, entry.completedAt) === completedOn)
      .sort((first, second) => new Date(first.completedAt).getTime() - new Date(second.completedAt).getTime());
    const existingEntry = matchingEntries[matchingEntries.length - 1];

    if (existingEntry) {
      const combinedValue = addRecurringCompletionValues(matchingEntries, value);

      await collection.updateOne(
        { _id: task._id },
        {
          $set: {
            status: "active",
            dueAt: nextDueAt,
            lastCompletedAt: nowIso,
            updatedAt: nowIso,
            completionCount: getUniqueRecurringCompletionCount(task, completedOn),
            "recurringHistory.$[entry].completedAt": nowIso,
            "recurringHistory.$[entry].completedOn": completedOn,
            "recurringHistory.$[entry].note": note,
            "recurringHistory.$[entry].value": combinedValue,
            "recurringHistory.$[entry].nextDueAt": nextDueAt
          }
        },
        {
          arrayFilters: [{ "entry.id": existingEntry.id }]
        }
      );

      const duplicateIds = matchingEntries.filter((entry) => entry.id !== existingEntry.id).map((entry) => entry.id);

      if (duplicateIds.length) {
        await collection.updateOne(
          { _id: task._id },
          {
            $pull: {
              recurringHistory: {
                id: {
                  $in: duplicateIds
                }
              }
            }
          }
        );
      }

      return;
    }

    await collection.updateOne(
      { _id: task._id },
      {
        $set: {
          status: "active",
          dueAt: nextDueAt,
          lastCompletedAt: nowIso,
          updatedAt: nowIso
        },
        $inc: {
          completionCount: 1
        },
        $push: {
          recurringHistory: {
            id: new ObjectId().toHexString(),
            completedAt: nowIso,
            completedOn,
            note,
            value,
            nextDueAt
          }
        }
      }
    );
    return;
  }

  throw new Error("Use progress updates for long-running tasks");
}

async function updateProgress(
  collection: Awaited<ReturnType<typeof getTasksCollection>>,
  task: TaskDocument,
  percent: number,
  note: string,
  details?: string
) {
  if (task.type !== "long-running") {
    throw new Error("Progress can only be updated on long-running tasks");
  }

  const now = new Date().toISOString();
  const progress = clampProgress(percent);
  const normalizedNote = normalizeText(note);
  const completedAt = progress >= 100 ? task.completedAt || now : null;
  const updates: Record<string, string | number | null> = {
    progress,
    status: progress >= 100 ? "completed" : "active",
    completedAt,
    updatedAt: now
  };

  if (typeof details === "string") {
    updates.details = normalizeText(details);
  }

  await collection.updateOne(
    { _id: task._id },
    {
      $set: updates,
      $push: {
        progressHistory: {
          id: new ObjectId().toHexString(),
          percent: progress,
          note: normalizedNote,
          recordedAt: now
        }
      }
    }
  );
}

async function softDeleteTask(request: VercelRequest, response: VercelResponse) {
  const id = parseObjectId(request);

  if (!id) {
    response.status(400).json({ error: "Valid task id is required" });
    return;
  }

  const collection = await getTasksCollection();
  const now = new Date().toISOString();
  await collection.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now } });
  await sendUpdatedTask(collection, id, response);
}

async function sendUpdatedTask(
  collection: Awaited<ReturnType<typeof getTasksCollection>>,
  id: ObjectId,
  response: VercelResponse
) {
  const task = await collection.findOne({ _id: id });

  if (!task) {
    response.status(404).json({ error: "Task not found" });
    return;
  }

  response.status(200).json({ task: serializeTask(task) });
}

function parseObjectId(request: VercelRequest) {
  const rawId = Array.isArray(request.query.id) ? request.query.id[0] : request.query.id;

  if (!rawId || !ObjectId.isValid(rawId)) {
    return null;
  }

  return new ObjectId(rawId);
}

function parseBody<T>(request: VercelRequest): T {
  if (typeof request.body === "string") {
    return JSON.parse(request.body || "{}") as T;
  }

  return (request.body || {}) as T;
}

function parseBooleanQuery(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue === "true" || rawValue === "1";
}

function getRecurringEntryDateKey(completedOn: string | undefined, completedAt: string) {
  if (completedOn && /^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
    return completedOn;
  }

  return getDateKey(new Date(completedAt));
}

function getUniqueRecurringCompletionCount(task: TaskDocument, currentCompletedOn: string) {
  const dateKeys = new Set((task.recurringHistory || []).map((entry) => getRecurringEntryDateKey(entry.completedOn, entry.completedAt)));
  dateKeys.add(currentCompletedOn);

  return dateKeys.size;
}

function addRecurringCompletionValues(entries: Array<{ value?: number | null }>, incomingValue: number | null) {
  const existingValue = entries.reduce((sum, entry) => {
    return typeof entry.value === "number" && Number.isFinite(entry.value) ? sum + entry.value : sum;
  }, 0);

  if (incomingValue === null) {
    return existingValue || null;
  }

  return existingValue + incomingValue;
}

function getDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.JUSTODO_TIMEZONE || "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";

  return `${year}-${month}-${day}`;
}
