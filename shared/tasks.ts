export const TASK_TYPES = ["one-time", "recurring", "long-running"] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = "active" | "completed";
export type RecurrenceMode = "daily" | "weekly" | "monthly" | "custom";

export interface Recurrence {
  mode: RecurrenceMode;
  intervalDays: number;
}

export interface ProgressEntry {
  id: string;
  percent: number;
  note: string;
  recordedAt: string;
}

export interface RecurringEntry {
  id: string;
  completedAt: string;
  completedOn?: string;
  note: string;
  value: number | null;
  nextDueAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  details: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  hasDueDate?: boolean;
  completedAt: string | null;
  deletedAt: string | null;
  recurrence?: Recurrence;
  completionCount?: number;
  lastCompletedAt?: string | null;
  recurringHistory?: RecurringEntry[];
  progress?: number;
  progressHistory?: ProgressEntry[];
}

export interface CreateTaskRequest {
  title: string;
  details?: string;
  type: TaskType;
  dueAt?: string | null;
  recurrence?: Recurrence;
  progress?: number;
}

export type TaskActionRequest =
  | {
      action: "complete";
      note?: string;
      value?: number | null;
      details?: string;
    }
  | {
      action: "progress";
      percent: number;
      note: string;
      details?: string;
    }
  | {
      action: "restore";
    };
