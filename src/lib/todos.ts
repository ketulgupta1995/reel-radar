"use client";

export type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string; // ISO string
};

export type DayTodos = {
  date: string; // YYYY-MM-DD
  todos: Todo[];
};

const TODO_STORAGE_PREFIX = "reel-radar-todos-";

function getStorageKey(date: string): string {
  return `${TODO_STORAGE_PREFIX}${date}`;
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadTodos(date?: string): Todo[] {
  if (typeof window === "undefined") return [];
  const targetDate = date || getTodayDate();
  try {
    const raw = localStorage.getItem(getStorageKey(targetDate));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTodos(todos: Todo[], date?: string): void {
  if (typeof window === "undefined") return;
  const targetDate = date || getTodayDate();
  localStorage.setItem(getStorageKey(targetDate), JSON.stringify(todos, null, 2));
  
  // Also sync with server
  fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: targetDate, todos }),
  }).catch((err) => {
    console.error("[Todos Save] Could not contact /api/todos. Saved only to browser localStorage.", err);
  });
}

export function addTodo(text: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const newTodo: Todo = {
    id: crypto.randomUUID(),
    text,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  const updated = [...todos, newTodo];
  saveTodos(updated, date);
  return updated;
}

export function toggleTodo(id: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) =>
    t.id === id ? { ...t, completed: !t.completed } : t
  );
  saveTodos(updated, date);
  return updated;
}

export function deleteTodo(id: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.filter((t) => t.id !== id);
  saveTodos(updated, date);
  return updated;
}

export function updateTodoText(id: string, text: string, date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.map((t) =>
    t.id === id ? { ...t, text } : t
  );
  saveTodos(updated, date);
  return updated;
}

export function clearCompletedTodos(date?: string): Todo[] {
  const todos = loadTodos(date);
  const updated = todos.filter((t) => !t.completed);
  saveTodos(updated, date);
  return updated;
}

export function getAllStoredDates(): string[] {
  if (typeof window === "undefined") return [];
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(TODO_STORAGE_PREFIX)) {
      const date = key.replace(TODO_STORAGE_PREFIX, "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dates.push(date);
      }
    }
  }
  return dates.sort().reverse(); // Most recent first
}

export function loadAllTodos(): Record<string, Todo[]> {
  if (typeof window === "undefined") return {};
  const dates = getAllStoredDates();
  const result: Record<string, Todo[]> = {};
  for (const date of dates) {
    result[date] = loadTodos(date);
  }
  return result;
}

export function exportTodos(date?: string): void {
  const targetDate = date || getTodayDate();
  const todos = loadTodos(targetDate);
  const blob = new Blob([JSON.stringify({ date: targetDate, todos }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reel-radar-todos-${targetDate}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importTodos(
  file: File,
  onSuccess: (todos: Todo[], date: string) => void,
  onError?: (msg: string) => void
): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup format");
      }
      const { date, todos } = parsed;
      if (!date || !Array.isArray(todos)) {
        throw new Error("Invalid backup format: missing date or todos");
      }
      saveTodos(todos, date);
      onSuccess(todos, date);
    } catch {
      if (onError) {
        onError("Invalid JSON backup file.");
      } else {
        alert("Could not import file: Invalid JSON format.");
      }
    }
  };
  reader.readAsText(file);
}

export async function syncTodosWithServer(date?: string): Promise<Todo[]> {
  const targetDate = date || getTodayDate();
  try {
    const res = await fetch(`/api/todos?date=${targetDate}`);
    if (!res.ok) return loadTodos(targetDate);
    
    const data = await res.json();
    if (data.todos) {
      saveTodos(data.todos, targetDate);
      return data.todos;
    }
    return loadTodos(targetDate);
  } catch (err) {
    console.error("[Todos Sync] Server storage unreachable. Using browser localStorage only.", err);
    return loadTodos(targetDate);
  }
}