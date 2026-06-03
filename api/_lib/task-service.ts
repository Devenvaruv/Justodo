import { ObjectId } from "mongodb";
import type { CreateTaskRequest, Recurrence, Task, TaskType } from "../../shared/tasks.js";
import { getTasksCollection, serializeTask, type TaskDocument } from "./mongo.js";

const VALID_TASK_TYPES = new Set<TaskType>(["one-time", "recurring", "long-running"]);

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export async function insertTask(body: CreateTaskRequest): Promise<Task> {
  const title = normalizeText(body.title);
  const details = normalizeText(body.details);

  if (!title) {
    throw new ApiError(400, "Title is required");
  }

  if (!VALID_TASK_TYPES.has(body.type)) {
    throw new ApiError(400, "Task type is invalid");
  }

  const now = new Date().toISOString();
  const dueAt = normalizeDate(body.dueAt);
  const document: TaskDocument = {
    _id: new ObjectId(),
    title,
    details,
    type: body.type,
    status: "active",
    createdAt: now,
    updatedAt: now,
    dueAt,
    hasDueDate: Boolean(dueAt),
    completedAt: null,
    deletedAt: null
  };

  if (body.type === "recurring") {
    document.recurrence = normalizeRecurrence(body.recurrence);
    document.completionCount = 0;
    document.lastCompletedAt = null;
    document.recurringHistory = [];
  }

  if (body.type === "long-running") {
    const progress = clampProgress(body.progress ?? 0);
    document.progress = progress;
    document.progressHistory = [];

    if (progress >= 100) {
      document.status = "completed";
      document.completedAt = now;
    }
  }

  const collection = await getTasksCollection();
  await collection.insertOne(document);

  return serializeTask(document);
}

export function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCompletionValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.min(1_000_000, numericValue));
}

export function clampProgress(value: number) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

export function getNextDueAt(date: Date, recurrence: Recurrence) {
  if (recurrence.mode === "weekly") {
    return addDays(date, 7);
  }

  if (recurrence.mode === "monthly") {
    return addMonths(date, 1);
  }

  return addDays(date, recurrence.intervalDays);
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeRecurrence(value: Recurrence | undefined): Recurrence {
  if (value?.mode === "weekly") {
    return {
      mode: "weekly",
      intervalDays: 7
    };
  }

  if (value?.mode === "monthly") {
    return {
      mode: "monthly",
      intervalDays: 30
    };
  }

  if (value?.mode === "custom") {
    const intervalDays = Number(value.intervalDays);

    return {
      mode: "custom",
      intervalDays: Number.isFinite(intervalDays) ? Math.max(1, Math.min(365, Math.floor(intervalDays))) : 1
    };
  }

  return {
    mode: "daily",
    intervalDays: 1
  };
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + Math.max(1, days));
  return nextDate;
}

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date);
  const originalDay = nextDate.getDate();

  nextDate.setDate(1);
  nextDate.setMonth(nextDate.getMonth() + Math.max(1, months));

  const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
  nextDate.setDate(Math.min(originalDay, lastDayOfMonth));

  return nextDate;
}
