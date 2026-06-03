import type { CreateTaskRequest, Task, TaskActionRequest } from "../shared/tasks";

interface TasksResponse {
  tasks: Task[];
}

interface TaskResponse {
  task: Task;
}

export async function fetchTasks(includeDeleted = false) {
  const query = includeDeleted ? "?includeDeleted=true" : "";
  const data = await request<TasksResponse>(`/api/tasks${query}`);
  return data.tasks;
}

export async function createTask(payload: CreateTaskRequest) {
  const data = await request<TaskResponse>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return data.task;
}

export async function completeTask(id: string, note = "", value?: number | null) {
  return updateTask(id, {
    action: "complete",
    note,
    value
  });
}

export async function recordProgress(id: string, percent: number, note: string) {
  return updateTask(id, {
    action: "progress",
    percent,
    note
  });
}

export async function restoreTask(id: string) {
  return updateTask(id, {
    action: "restore"
  });
}

export async function softDeleteTask(id: string) {
  const data = await request<TaskResponse>(`/api/tasks?id=${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  return data.task;
}

async function updateTask(id: string, payload: TaskActionRequest) {
  const data = await request<TaskResponse>(`/api/tasks?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  return data.task;
}

async function request<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}
