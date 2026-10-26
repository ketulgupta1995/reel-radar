"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  loadTodos,
  saveTodos,
  addTodo,
  toggleTodo,
  deleteTodo,
  updateTodoText,
  clearCompletedTodos,
  getAllStoredDates,
  loadAllTodos,
  exportTodos,
  importTodos,
  syncTodosWithServer,
  type Todo,
} from "@/lib/todos";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getRelativeDateLabel(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return formatDate(dateStr);
}

export default function TodosPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => 
    new Date().toISOString().slice(0, 10)
  );
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load todos when date changes
  useEffect(() => {
    const loaded = loadTodos(selectedDate);
    setTodos(loaded);
    // Also load available dates
    setAvailableDates(getAllStoredDates());
  }, [selectedDate]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAddTodo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    const updated = addTodo(newTodoText.trim(), selectedDate);
    setTodos(updated);
    setNewTodoText("");
    inputRef.current?.focus();
  };

  const handleToggle = (id: string) => {
    const updated = toggleTodo(id, selectedDate);
    setTodos(updated);
  };

  const handleDelete = (id: string) => {
    const updated = deleteTodo(id, selectedDate);
    setTodos(updated);
  };

  const handleEditStart = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const handleEditSave = (id: string) => {
    if (!editText.trim()) {
      handleDelete(id);
      return;
    }
    const updated = updateTodoText(id, editText.trim(), selectedDate);
    setTodos(updated);
    setEditingId(null);
    setEditText("");
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText("");
  };

  const handleClearCompleted = () => {
    const updated = clearCompletedTodos(selectedDate);
    setTodos(updated);
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setShowDatePicker(false);
  };

  const handleToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setSelectedDate(today);
    setShowDatePicker(false);
  };

  const handleExport = () => {
    exportTodos(selectedDate);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importTodos(file, (importedTodos, date) => {
      if (date === selectedDate) {
        setTodos(importedTodos);
      }
      alert(`Imported ${importedTodos.length} todos for ${date}`);
    });
    e.target.value = "";
  };

  const handleSync = async () => {
    setSyncStatus("syncing");
    try {
      const synced = await syncTodosWithServer(selectedDate);
      setTodos(synced);
      setSyncStatus("synced");
      setTimeout(() => setSyncStatus("idle"), 2000);
    } catch {
      setSyncStatus("error");
      setTimeout(() => setSyncStatus("idle"), 2000);
    }
  };

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <main className="min-h-screen bg-[#090910] text-white">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-bold tracking-[.2em] text-gold">
            REEL RADAR
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/discover"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Discover
            </Link>
            <Link
              href="/search"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Search
            </Link>
            <Link
              href="/watchlist"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Watchlist
            </Link>
            <Link
              href="/watched"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Viewed
            </Link>
            <Link
              href="/analysis"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Analysis
            </Link>
            <Link
              href="/recommendations"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Recommendations
            </Link>
            <Link
              href="/similar"
              className="text-white/70 transition hover:text-gold text-sm"
            >
              Similar
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Page Title & Date Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Daily Todos</h1>
            <p className="mt-1 text-white/60">Track your daily tasks and notes</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Selector Button */}
            <div className="relative">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm text-white transition hover:border-gold/40 hover:bg-white/10"
              >
                <svg className="h-4 w-4 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-medium">{getRelativeDateLabel(selectedDate)}</span>
                <svg className="h-4 w-4 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Date Picker Dropdown */}
              {showDatePicker && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl border border-white/10 bg-panel shadow-2xl overflow-hidden z-50">
                  <button
                    onClick={handleToday}
                    className="w-full px-4 py-2 text-left text-sm text-gold hover:bg-white/5 transition"
                  >
                    Today
                  </button>
                  <div className="border-t border-white/10" />
                  {availableDates.map((date) => (
                    <button
                      key={date}
                      onClick={() => handleDateSelect(date)}
                      className={`w-full px-4 py-2 text-left text-sm transition ${
                        date === selectedDate
                          ? "bg-gold/10 text-gold"
                          : "text-white/80 hover:bg-white/5"
                      }`}
                    >
                      {getRelativeDateLabel(date)}
                    </button>
                  ))}
                  {availableDates.length === 0 && (
                    <div className="px-4 py-4 text-center text-white/50 text-sm">
                      No previous todo dates
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:border-gold/40 hover:text-gold hover:bg-white/10"
                title="Export todos for this day"
              >
                Export
              </button>
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
                id="import-file"
              />
              <label
                htmlFor="import-file"
                className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:border-gold/40 hover:text-gold hover:bg-white/10 cursor-pointer"
                title="Import todos from JSON"
              >
                Import
              </label>
              <button
                onClick={handleSync}
                disabled={syncStatus === "syncing"}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  syncStatus === "syncing"
                    ? "border-blue-400/50 bg-blue-500/10 text-blue-300 cursor-wait"
                    : syncStatus === "synced"
                    ? "border-green-400/50 bg-green-500/10 text-green-300"
                    : "border-white/20 bg-white/5 text-white/80 hover:border-gold/40 hover:text-gold hover:bg-white/10"
                }`}
                title="Sync with cloud storage"
              >
                {syncStatus === "syncing" ? "Syncing..." : syncStatus === "synced" ? "Synced" : "Sync"}
              </button>
            </div>
          </div>
        </div>

        {/* Add Todo Form */}
        <form onSubmit={handleAddTodo} className="mb-6">
          <div className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              placeholder="What needs to be done today?"
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50 transition"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!newTodoText.trim()}
              className="rounded-xl bg-gold px-6 py-3 font-semibold text-black transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </form>

        {/* Todo List */}
        {todos.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-panel/60 p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-white/20"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-white/80">No todos yet</h3>
            <p className="mt-1 text-white/50">Add your first task above to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                isEditing={editingId === todo.id}
                editText={editText}
                onEditStart={handleEditStart}
                onEditSave={handleEditSave}
                onEditCancel={handleEditCancel}
                onEditTextChange={setEditText}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Footer Stats & Actions */}
        {todos.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-panel/60 p-4">
            <div className="flex items-center gap-4 text-sm text-white/60">
              <span>{activeCount} {activeCount === 1 ? "item" : "items"} left</span>
              <span>{completedCount} completed</span>
            </div>
            {completedCount > 0 && (
              <button
                onClick={handleClearCompleted}
                className="text-xs text-red-400 hover:text-red-300 transition"
              >
                Clear completed
              </button>
            )}
          </div>
        )}

        {/* Previous Days Summary */}
        {availableDates.length > 1 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold mb-4">Previous Days</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {availableDates
                .filter((d) => d !== selectedDate)
                .slice(0, 6)
                .map((date) => {
                  const dayTodos = loadTodos(date);
                  const dayActive = dayTodos.filter((t) => !t.completed).length;
                  const dayCompleted = dayTodos.filter((t) => t.completed).length;
                  return (
                    <button
                      key={date}
                      onClick={() => handleDateSelect(date)}
                      className="rounded-xl border border-white/10 bg-panel/60 p-4 transition hover:border-gold/40 hover:-translate-y-0.5 text-left"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">{getRelativeDateLabel(date)}</span>
                        <span className="text-xs text-white/50">{formatDate(date)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-white/60">
                        {dayTodos.length > 0 && (
                          <>
                            <span className="flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                              {dayCompleted} done
                            </span>
                            {dayActive > 0 && (
                              <span className="flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                                {dayActive} pending
                              </span>
                            )}
                          </>
                        )}
                        {dayTodos.length === 0 && (
                          <span className="text-white/40">No todos</span>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
            {availableDates.length > 7 && (
              <p className="mt-3 text-center text-sm text-white/50">
                +{availableDates.length - 7} more days in history
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function TodoItem({
  todo,
  isEditing,
  editText,
  onEditStart,
  onEditSave,
  onEditCancel,
  onEditTextChange,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  isEditing: boolean;
  editText: string;
  onEditStart: (todo: Todo) => void;
  onEditSave: (id: string) => void;
  onEditCancel: () => void;
  onEditTextChange: (text: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onEditSave(todo.id);
    } else if (e.key === "Escape") {
      onEditCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => onEditTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onEditSave(todo.id)}
          className="w-full bg-transparent px-2 py-1.5 text-white focus:outline-none"
          autoComplete="off"
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-panel/60 p-3 transition hover:border-white/20">
      <div className="flex items-start gap-3">
        <button
          onClick={() => onToggle(todo.id)}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
            todo.completed
              ? "bg-gold border-gold text-black"
              : "border-white/30 text-white/50 hover:border-gold/50 hover:text-gold"
          }`}
          aria-label={todo.completed ? "Mark as incomplete" : "Mark as complete"}
        >
          {todo.completed && (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm leading-relaxed transition ${
              todo.completed ? "line-through text-white/40" : "text-white/90"
            }`}
          >
            {todo.text}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            Added {new Date(todo.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onEditStart(todo)}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition"
            aria-label="Edit todo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(todo.id)}
            className="p-1.5 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10 transition"
            aria-label="Delete todo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}