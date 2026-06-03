import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  X
} from "lucide-react";
import {
  completeTask,
  createTask,
  fetchTasks,
  recordProgress,
  restoreTask,
  softDeleteTask
} from "./api";
import type { RecurrenceMode, Task, TaskType } from "../shared/tasks";

type StatusFilter = "active" | "completed" | "deleted" | "all";
type TaskCategory = "once" | "daily" | "weekly" | "monthly" | "project";
type AppView = TaskCategory | "insights";

interface TaskFormState {
  title: string;
  details: string;
  type: TaskType;
  dueAt: string;
  recurrenceMode: RecurrenceMode;
  intervalDays: string;
}

const initialFormState: TaskFormState = {
  title: "",
  details: "",
  type: "one-time",
  dueAt: "",
  recurrenceMode: "daily",
  intervalDays: "7"
};

const categoryItems: Array<{
  id: TaskCategory;
  label: string;
  icon: typeof ClipboardCheck;
}> = [
  {
    id: "once",
    label: "Once",
    icon: ClipboardCheck
  },
  {
    id: "daily",
    label: "Daily",
    icon: Calendar
  },
  {
    id: "weekly",
    label: "Weekly",
    icon: CalendarDays
  },
  {
    id: "monthly",
    label: "Monthly",
    icon: CalendarRange
  },
  {
    id: "project",
    label: "Project",
    icon: BarChart3
  }
];

const navigationItems: Array<{
  id: AppView;
  label: string;
  icon: typeof ClipboardCheck;
}> = [
  ...categoryItems,
  {
    id: "insights",
    label: "Insights",
    icon: Activity
  }
];

const typeLabels: Record<TaskType, string> = {
  "one-time": "One-time",
  recurring: "Recurring",
  "long-running": "Long-running"
};

const typeIcons = {
  "one-time": ClipboardCheck,
  recurring: RotateCw,
  "long-running": BarChart3
};

const RESET_TIME_ZONE = "America/Los_Angeles";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(initialFormState);
  const [selectedView, setSelectedView] = useState<AppView>("once");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const [progressPercent, setProgressPercent] = useState("0");
  const [recurringTask, setRecurringTask] = useState<Task | null>(null);
  const [recurringNote, setRecurringNote] = useState("");
  const [recurringValue, setRecurringValue] = useState("");

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const includeDeleted = statusFilter === "deleted";
      setTasks(await fetchTasks(includeDeleted));
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not load tasks");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const counts = useMemo(() => {
    const categoryCounts = categoryItems.reduce(
      (totals, item) => {
        totals[item.id] = tasks.filter((task) => !task.deletedAt && task.status === "active" && taskMatchesCategory(task, item.id)).length;
        return totals;
      },
      {} as Record<TaskCategory, number>
    );

    return {
      categories: categoryCounts
    };
  }, [tasks]);

  const selectedNavigationItem = useMemo(
    () => navigationItems.find((item) => item.id === selectedView) || navigationItems[0],
    [selectedView]
  );

  const visibleTasks = useMemo(() => {
    if (!isTaskCategory(selectedView)) {
      return [];
    }

    return tasks
      .filter((task) => {
        if (statusFilter === "active") {
          return !task.deletedAt && task.status === "active";
        }

        if (statusFilter === "completed") {
          return !task.deletedAt && task.status === "completed";
        }

        if (statusFilter === "deleted") {
          return Boolean(task.deletedAt);
        }

        return !task.deletedAt;
      })
      .filter((task) => taskMatchesCategory(task, selectedView))
      .sort(sortTasks);
  }, [selectedView, statusFilter, tasks]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");

    try {
      const nextTask = await createTask({
        title: form.title,
        details: form.details,
        type: form.type,
        dueAt: toIsoDate(form.dueAt),
        recurrence:
          form.type === "recurring"
            ? {
                mode: form.recurrenceMode,
                intervalDays: getIntervalDays(form.recurrenceMode, form.intervalDays)
              }
            : undefined
      });

      setTasks((currentTasks) => [nextTask, ...currentTasks]);
      setForm(initialFormState);
      setSelectedView(getTaskCategory(nextTask));
      setStatusFilter("active");
      setIsCreateModalOpen(false);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not create task");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleComplete(task: Task, note = "", value?: number | null) {
    setIsSaving(true);
    setError("");

    try {
      const updatedTask = await completeTask(task.id, note, value);
      replaceTask(updatedTask);
      setRecurringTask(null);
      setRecurringNote("");
      setRecurringValue("");
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not complete task");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleProgressSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!progressTask) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const progress = getProgressInputValue(progressPercent);
      const updatedTask = await recordProgress(progressTask.id, progress, `Progress set to ${progress}%`);
      replaceTask(updatedTask);
      setProgressTask(null);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not save progress");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(task: Task) {
    setIsSaving(true);
    setError("");

    try {
      const updatedTask = await softDeleteTask(task.id);
      replaceTask(updatedTask);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not delete task");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRestore(task: Task) {
    setIsSaving(true);
    setError("");

    try {
      const updatedTask = await restoreTask(task.id);
      replaceTask(updatedTask);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "Could not restore task");
    } finally {
      setIsSaving(false);
    }
  }

  function replaceTask(updatedTask: Task) {
    setTasks((currentTasks) => {
      const exists = currentTasks.some((task) => task.id === updatedTask.id);

      if (!exists) {
        return [updatedTask, ...currentTasks];
      }

      return currentTasks.map((task) => (task.id === updatedTask.id ? updatedTask : task));
    });
  }

  function openProgressDialog(task: Task) {
    setProgressTask(task);
    setProgressPercent(String(task.progress ?? 0));
  }

  function openCreateDialog(category = getDefaultCreateCategory(selectedView)) {
    setForm(createFormStateForCategory(category));
    setIsCreateModalOpen(true);
  }

  function selectFormCategory(category: TaskCategory) {
    setForm((currentForm) => ({
      ...currentForm,
      ...getCategoryFormDefaults(category)
    }));
  }

  function startCompleteTask(task: Task) {
    if (task.type === "recurring") {
      setRecurringTask(task);
      setRecurringNote("");
      setRecurringValue("");
      return;
    }

    void handleComplete(task);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Justodo</p>
          <h1>{selectedNavigationItem.label}</h1>
        </div>
      </header>

      <div
        className={`workspace ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${
          selectedView === "insights" ? "insights-layout" : ""
        }`}
      >
        <aside className="sidebar">
          <nav className="category-nav" aria-label="Task categories">
            <div className="sidebar-header">
              {!isSidebarCollapsed ? <span>Lists</span> : null}
              <button
                className="icon-button"
                type="button"
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setIsSidebarCollapsed((currentValue) => !currentValue)}
              >
                {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              </button>
            </div>

            <div className="category-list">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const count = isTaskCategory(item.id) ? counts.categories[item.id] : null;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedView === item.id ? "selected" : ""}
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => setSelectedView(item.id)}
                  >
                    <Icon size={20} />
                    {!isSidebarCollapsed ? (
                      <>
                        <span>{item.label}</span>
                        {count !== null ? <strong>{count}</strong> : null}
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>

        {selectedView === "insights" ? (
          <section className="main-panel">
            {error ? (
              <div className="alert" role="alert">
                <span>{error}</span>
                <button className="icon-button" type="button" title="Dismiss" aria-label="Dismiss" onClick={() => setError("")}>
                  <X size={18} />
                </button>
              </div>
            ) : null}
            <InsightsPanel tasks={tasks} isLoading={isLoading} />
          </section>
        ) : (
          <>
            <section className="task-sidebar">
              {error ? (
                <div className="alert" role="alert">
                  <span>{error}</span>
                  <button className="icon-button" type="button" title="Dismiss" aria-label="Dismiss" onClick={() => setError("")}>
                    <X size={18} />
                  </button>
                </div>
              ) : null}

              <div className="panel-toolbar">
                <div className="filter-group" aria-label="Status filter">
                  {(["active", "completed", "all", "deleted"] as StatusFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={statusFilter === filter ? "selected" : ""}
                      onClick={() => setStatusFilter(filter)}
                    >
                      {filterLabel(filter)}
                    </button>
                  ))}
                </div>
                <button
                  className="icon-button primary add-task-button"
                  type="button"
                  title="Add task"
                  aria-label="Add task"
                  onClick={() => openCreateDialog()}
                  disabled={isSaving}
                >
                  <Plus size={20} />
                </button>
              </div>

              <div className="task-list" aria-busy={isLoading || isSaving}>
                {isLoading ? <p className="empty-state">Loading tasks...</p> : null}
                {!isLoading && visibleTasks.length === 0 ? <p className="empty-state">No tasks in this view.</p> : null}

                {visibleTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    disabled={isSaving}
                    onComplete={startCompleteTask}
                    onProgress={openProgressDialog}
                    onDelete={(selectedTask) => void handleDelete(selectedTask)}
                    onRestore={(selectedTask) => void handleRestore(selectedTask)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {isCreateModalOpen ? (
        <Modal title="Add Task" onClose={() => setIsCreateModalOpen(false)}>
          <form className="modal-form" onSubmit={handleCreateTask}>
            <div className="field">
              <span>List</span>
              <div className="segmented category-picker">
                {categoryItems.map((item) => {
                  const Icon = item.icon;
                  const isSelected = getFormCategory(form) === item.id;

                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={isSelected ? "selected" : ""}
                      onClick={() => selectFormCategory(item.id)}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="field">
              <span>Title</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Apply to role"
                required
              />
            </label>

            <label className="field">
              <span>Notes</span>
              <textarea
                value={form.details}
                onChange={(event) => setForm({ ...form, details: event.target.value })}
                rows={4}
                placeholder="Context, links, or acceptance criteria"
              />
            </label>

            <label className="field">
              <span>{form.type === "recurring" ? "Next Due" : "Due"}</span>
              <input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="solid-button" disabled={isSaving}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {progressTask ? (
        <Modal title="Update Progress" onClose={() => setProgressTask(null)}>
          <form className="modal-form" onSubmit={handleProgressSubmit}>
            <p className="modal-task-title">{progressTask.title}</p>
            <label className="field progress-slider-field">
              <span>Progress</span>
              <div className="progress-slider-readout">
                <div className="progress-track">
                  <span style={{ width: `${getProgressInputValue(progressPercent)}%` }} />
                </div>
                <strong>{getProgressInputValue(progressPercent)}%</strong>
              </div>
              <input
                className="progress-range"
                type="range"
                min={0}
                max={100}
                step={1}
                value={progressPercent}
                onChange={(event) => setProgressPercent(event.target.value)}
              />
              <div className="progress-scale" aria-hidden="true">
                <span>0%</span>
                <span>100%</span>
              </div>
            </label>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setProgressTask(null)}>
                Cancel
              </button>
              <button type="submit" className="solid-button" disabled={isSaving}>
                Save Progress
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {recurringTask ? (
        <Modal title="Complete Recurring Task" onClose={() => setRecurringTask(null)}>
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleComplete(recurringTask, recurringNote, parseOptionalNumber(recurringValue));
            }}
          >
            <p className="modal-task-title">{recurringTask.title}</p>
            <label className="field">
              <span>Completion Number</span>
              <input
                type="number"
                min={0}
                step="any"
                value={recurringValue}
                onChange={(event) => setRecurringValue(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="field">
              <span>Completion Note</span>
              <textarea
                value={recurringNote}
                onChange={(event) => setRecurringNote(event.target.value)}
                rows={4}
                placeholder="Optional"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={() => setRecurringTask(null)}>
                Cancel
              </button>
              <button type="submit" className="solid-button" disabled={isSaving}>
                Complete
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}

interface TaskRowProps {
  task: Task;
  disabled: boolean;
  onComplete: (task: Task) => void;
  onProgress: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
}

function TaskRow({ task, disabled, onComplete, onProgress, onDelete, onRestore }: TaskRowProps) {
  const Icon = typeIcons[task.type];
  const isDeleted = Boolean(task.deletedAt);
  const progress = task.progress ?? 0;

  return (
    <article className={`task-card ${isDeleted ? "deleted" : ""}`}>
      <div className="task-main">
        <div className="task-icon" aria-hidden="true">
          <Icon size={20} />
        </div>
        <div className="task-copy">
          <div className="task-title-row">
            <h3>{task.title}</h3>
            <span className={`type-chip ${task.type}`}>{typeLabels[task.type]}</span>
          </div>
          {task.details ? <p className="task-details">{task.details}</p> : null}
          <div className="task-meta">
            <span>{task.status === "completed" ? "Completed" : "Active"}</span>
            {task.dueAt ? <span>{formatDateLabel(task.dueAt)}</span> : null}
            {task.type === "recurring" ? <span>{task.completionCount ?? 0} completions</span> : null}
            {task.type === "recurring" && task.recurrence ? <span>{recurrenceLabel(task.recurrence.mode)}</span> : null}
            {isDeleted && task.deletedAt ? <span>Deleted {formatDateLabel(task.deletedAt)}</span> : null}
          </div>

          {task.type === "long-running" ? (
            <div className="progress-block" aria-label={`${progress} percent complete`}>
              <div className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
              <strong>{progress}%</strong>
            </div>
          ) : null}

          {task.type === "long-running" && task.progressHistory?.length ? (
            <details className="history">
              <summary>Progress History</summary>
              <ol>
                {task.progressHistory
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.percent}%</strong>
                      <span>{entry.note}</span>
                      <time>{formatDateLabel(entry.recordedAt)}</time>
                    </li>
                  ))}
              </ol>
            </details>
          ) : null}

          {task.type === "recurring" && task.recurringHistory?.length ? (
            <details className="history">
              <summary>Completion History</summary>
              <ol>
                {task.recurringHistory
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <strong>{formatDateLabel(entry.completedAt)}</strong>
                      <span>{formatHistoryEntry(entry.note, entry.value)}</span>
                      {entry.nextDueAt ? <time>Next {formatDateLabel(entry.nextDueAt)}</time> : null}
                    </li>
                  ))}
              </ol>
            </details>
          ) : null}
        </div>
      </div>

      <div className="task-actions">
        {isDeleted ? (
          <button
            className="icon-button"
            type="button"
            title="Restore task"
            aria-label={`Restore ${task.title}`}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onRestore(task);
            }}
          >
            <RotateCcw size={18} />
          </button>
        ) : (
          <>
            {task.status === "active" && task.type !== "long-running" ? (
              <button
                className="icon-button success"
                type="button"
                title="Complete task"
                aria-label={`Complete ${task.title}`}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onComplete(task);
                }}
              >
                <Check size={18} />
              </button>
            ) : null}

            {task.type === "long-running" ? (
              <button
                className="icon-button success"
                type="button"
                title="Update progress"
                aria-label={`Update progress for ${task.title}`}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onProgress(task);
                }}
              >
                <BarChart3 size={18} />
              </button>
            ) : null}

            <button
              className="icon-button danger"
              type="button"
              title="Delete task"
              aria-label={`Delete ${task.title}`}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(task);
              }}
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

interface RecurringValueGraphProps {
  entries: RecurringValueGraphEntry[];
}

interface RecurringValueGraphEntry {
  id: string;
  completedAt: string;
  completedOn?: string;
  value: number;
}

function RecurringValueGraph({ entries }: RecurringValueGraphProps) {
  const chartEntries = entries.slice(-12);
  const values = chartEntries.map((entry) => entry.value);
  const maxValue = Math.max(...values, 1);
  const chartMax = getNiceChartMax(maxValue);
  const chartWidth = 360;
  const chartHeight = 220;
  const plotLeft = 46;
  const plotRight = 342;
  const plotTop = 18;
  const plotBottom = 164;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const yTicks = getYAxisTicks(chartMax);
  const points = chartEntries.map((entry, index) => {
    const x = chartEntries.length === 1 ? plotLeft + plotWidth / 2 : plotLeft + (index / (chartEntries.length - 1)) * plotWidth;
    const y = plotBottom - (entry.value / chartMax) * plotHeight;

    return {
      ...entry,
      x,
      y,
      labelY: y - 12 < plotTop ? y + 18 : y - 12,
      textAnchor: getChartTextAnchor(x, plotLeft, plotRight)
    };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints =
    points.length > 1
      ? `${points[0].x},${plotBottom} ${linePoints} ${points[points.length - 1].x},${plotBottom}`
      : "";
  const dateLabels = getChartDateLabels(chartEntries).map((label) => ({
    ...label,
    x: plotLeft + (label.x / 100) * plotWidth,
    textAnchor: getChartTextAnchor(plotLeft + (label.x / 100) * plotWidth, plotLeft, plotRight)
  }));

  return (
    <div className="recurring-graph" aria-label="Recurring task value graph">
      <svg
        className="line-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={`${chartEntries.length} recorded values by date`}
      >
        <text
          className="chart-axis-title y-axis-title"
          x="14"
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${(plotTop + plotBottom) / 2})`}
        >
          Value
        </text>
        <text className="chart-axis-title" x={(plotLeft + plotRight) / 2} y="214" textAnchor="middle">
          Date
        </text>

        {yTicks.map((tick) => {
          const y = plotBottom - (tick / chartMax) * plotHeight;

          return (
            <g key={tick}>
              <line className="chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
              <text className="chart-y-label" x={plotLeft - 10} y={y} textAnchor="end" dominantBaseline="middle">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        <line className="chart-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
        <line className="chart-axis" x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} />

        {dateLabels.map((label) => (
          <g key={`${label.completedAt}-${label.x}`}>
            <line className="chart-tick" x1={label.x} x2={label.x} y1={plotBottom} y2={plotBottom + 6} />
            <text className="chart-x-label" x={label.x} y={plotBottom + 22} textAnchor={label.textAnchor}>
              {formatChartDateLabel(label.completedOn || label.completedAt)}
            </text>
          </g>
        ))}

        {points.length > 1 ? <polyline className="line-area" points={areaPoints} /> : null}
        {points.length > 1 ? <polyline className="line-stroke" points={linePoints} /> : null}
        {points.map((point) => (
          <g key={point.id}>
            <title>{`${formatDateLabel(point.completedAt)}: ${formatNumber(point.value)}`}</title>
            <circle className="line-point-halo" cx={point.x} cy={point.y} r="4.4" />
            <circle className="line-point" cx={point.x} cy={point.y} r="2.4" />
            <text className="point-value-label" x={point.x} y={point.labelY} textAnchor={point.textAnchor}>
              {formatNumber(point.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

interface InsightsPanelProps {
  tasks: Task[];
  isLoading: boolean;
}

function InsightsPanel({ tasks, isLoading }: InsightsPanelProps) {
  const summaries = getRecurringInsightSummaries(tasks);

  if (isLoading) {
    return <p className="empty-state">Loading insights...</p>;
  }

  if (!summaries.length) {
    return <p className="empty-state">No recurring values yet.</p>;
  }

  return (
    <div className="insights-view">
      <div className="insight-list">
        {summaries.map((summary) => (
          <section className="insight-card" key={summary.task.id}>
            <div className="insight-header">
              <div>
                <h3>{summary.task.title}</h3>
                <p>{recurrenceLabel(summary.task.recurrence?.mode || "daily")}</p>
              </div>
            </div>
            <RecurringValueGraph entries={summary.entries} />
          </section>
        ))}
      </div>
    </div>
  );
}

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function sortTasks(first: Task, second: Task) {
  const firstDue = first.dueAt ? new Date(first.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const secondDue = second.dueAt ? new Date(second.dueAt).getTime() : Number.MAX_SAFE_INTEGER;

  if (firstDue !== secondDue) {
    return firstDue - secondDue;
  }

  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
}

function taskMatchesCategory(task: Task, category: TaskCategory) {
  return getTaskCategory(task) === category;
}

function isTaskCategory(view: AppView): view is TaskCategory {
  return view !== "insights";
}

function getDefaultCreateCategory(view: AppView): TaskCategory {
  return isTaskCategory(view) ? view : "once";
}

function getTaskCategory(task: Task): TaskCategory {
  if (task.type === "one-time") {
    return "once";
  }

  if (task.type === "long-running") {
    return "project";
  }

  if (task.recurrence?.mode === "weekly") {
    return "weekly";
  }

  if (task.recurrence?.mode === "monthly") {
    return "monthly";
  }

  return "daily";
}

function createFormStateForCategory(category: TaskCategory): TaskFormState {
  return {
    ...initialFormState,
    ...getCategoryFormDefaults(category)
  };
}

function getCategoryFormDefaults(category: TaskCategory): Pick<TaskFormState, "type" | "recurrenceMode" | "intervalDays"> {
  if (category === "project") {
    return {
      type: "long-running",
      recurrenceMode: "daily",
      intervalDays: "7"
    };
  }

  if (category === "weekly") {
    return {
      type: "recurring",
      recurrenceMode: "weekly",
      intervalDays: "7"
    };
  }

  if (category === "monthly") {
    return {
      type: "recurring",
      recurrenceMode: "monthly",
      intervalDays: "30"
    };
  }

  if (category === "daily") {
    return {
      type: "recurring",
      recurrenceMode: "daily",
      intervalDays: "1"
    };
  }

  return {
    type: "one-time",
    recurrenceMode: "daily",
    intervalDays: "7"
  };
}

function getFormCategory(form: TaskFormState): TaskCategory {
  if (form.type === "one-time") {
    return "once";
  }

  if (form.type === "long-running") {
    return "project";
  }

  if (form.recurrenceMode === "weekly") {
    return "weekly";
  }

  if (form.recurrenceMode === "monthly") {
    return "monthly";
  }

  return "daily";
}

function getIntervalDays(mode: RecurrenceMode, customDays: string) {
  if (mode === "weekly") {
    return 7;
  }

  if (mode === "monthly") {
    return 30;
  }

  if (mode === "custom") {
    return Number(customDays);
  }

  return 1;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getProgressInputValue(value: string) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function getRecurringValueEntries(task: Task) {
  if (task.type !== "recurring" || !task.recurringHistory?.length) {
    return [];
  }

  const entriesByDate = new Map<string, RecurringValueGraphEntry>();

  for (const entry of task.recurringHistory.slice().sort(sortGraphEntries)) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
      continue;
    }

    const dateKey = getGraphDateKey(entry.completedOn, entry.completedAt);
    const currentEntry = entriesByDate.get(dateKey);

    entriesByDate.set(dateKey, {
      id: entry.id,
      completedAt: entry.completedAt,
      completedOn: entry.completedOn,
      value: (currentEntry?.value || 0) + entry.value
    });
  }

  return [...entriesByDate.values()];
}

function getRecurringInsightSummaries(tasks: Task[]) {
  return tasks
    .filter((task) => !task.deletedAt && task.type === "recurring")
    .map((task) => {
      const entries = getRecurringValueEntries(task).sort(sortGraphEntries);

      return {
        task,
        entries
      };
    })
    .filter((summary) => summary.entries.length > 0)
    .sort((first, second) => {
      const firstLatest = first.entries[first.entries.length - 1];
      const secondLatest = second.entries[second.entries.length - 1];

      if (!firstLatest || !secondLatest) {
        return 0;
      }

      return (
        getGraphDateTime(secondLatest.completedOn, secondLatest.completedAt) -
        getGraphDateTime(firstLatest.completedOn, firstLatest.completedAt)
      );
    });
}

function sortGraphEntries(
  first: {
    completedAt: string;
    completedOn?: string;
  },
  second: {
    completedAt: string;
    completedOn?: string;
  }
) {
  return getGraphDateTime(first.completedOn, first.completedAt) - getGraphDateTime(second.completedOn, second.completedAt);
}

function getNiceChartMax(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalizedValue = value / magnitude;
  const niceValue = normalizedValue <= 1 ? 1 : normalizedValue <= 2 ? 2 : normalizedValue <= 5 ? 5 : 10;

  return niceValue * magnitude;
}

function getYAxisTicks(maxValue: number) {
  return [0, maxValue / 2, maxValue];
}

function getChartTextAnchor(x: number, plotLeft: number, plotRight: number): "start" | "middle" | "end" {
  if (x - plotLeft < 16) {
    return "start";
  }

  if (plotRight - x < 16) {
    return "end";
  }

  return "middle";
}

function getChartDateLabels(entries: RecurringValueGraphEntry[]) {
  if (entries.length <= 3) {
    return entries.map((entry, index) => ({
      completedAt: entry.completedAt,
      completedOn: entry.completedOn,
      x: entries.length === 1 ? 50 : (index / (entries.length - 1)) * 100
    }));
  }

  const middleIndex = Math.floor((entries.length - 1) / 2);

  return [0, middleIndex, entries.length - 1].map((index) => ({
    completedAt: entries[index].completedAt,
    completedOn: entries[index].completedOn,
    x: (index / (entries.length - 1)) * 100
  }));
}

function getGraphDateKey(completedOn: string | undefined, completedAt: string) {
  if (completedOn && /^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
    return completedOn;
  }

  return getResetDateKey(new Date(completedAt));
}

function getGraphDateTime(completedOn: string | undefined, completedAt: string) {
  if (completedOn && /^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
    const [year, month, day] = completedOn.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }

  return new Date(completedAt).getTime();
}

function recurrenceLabel(mode: RecurrenceMode) {
  if (mode === "weekly") {
    return "Weekly";
  }

  if (mode === "monthly") {
    return "Monthly";
  }

  if (mode === "custom") {
    return "Custom";
  }

  return "Daily";
}

function formatHistoryEntry(note: string, value: number | null | undefined) {
  const valueText = typeof value === "number" && Number.isFinite(value) ? `Value ${formatNumber(value)}` : "";

  if (note && valueText) {
    return `${valueText} - ${note}`;
  }

  return valueText || note || "Done";
}

function toIsoDate(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getResetDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RESET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";

  return `${year}-${month}-${day}`;
}

function filterLabel(filter: StatusFilter) {
  if (filter === "active") {
    return "Active";
  }

  if (filter === "completed") {
    return "Completed";
  }

  if (filter === "deleted") {
    return "Deleted";
  }

  return "All";
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatChartDateLabel(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric"
    }).format(new Date(year, month - 1, day));
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(value);
}
