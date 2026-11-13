// Shared by the planner page tests (todos/page*.test.tsx), split across files so they run in parallel.
import { vi } from "vitest";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { Todo } from "@/lib/todos";
import PlannerPage from "@/app/todos/page";

// Sunday 8 November 2026, 9:40 am.
export const T = "2026-11-08";
export const Y = "2026-11-07";

export const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-11-01T00:00:00.000Z", ...extra });
export const at = (h: number, m = 0) => vi.setSystemTime(new Date(2026, 10, 8, h, m));
export const open = () => render(<PlannerPage />);
export const tasks = () => within(screen.getByRole("list", { name: "Tasks" }));
export const tiles = () => within(screen.getByRole("group", { name: "Log items" }));
export const flashed = (text: string | RegExp) => screen.findByText(text);
export const add = (text: string) => {
  fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText("Add a task"));
};

export class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static sent: { title: string; body?: string }[] = [];
  constructor(title: string, opts?: { body?: string }) {
    FakeNotification.sent.push({ title, body: opts?.body });
  }
}
export const resetNotifications = () => {
  FakeNotification.permission = "granted";
  FakeNotification.sent = [];
};

// jsdom has no DragEvent: give the event what the drop handlers read.
export const dragTo = (kind: "dragOver" | "drop", el: HTMLElement, id: string, at: { clientX?: number; clientY?: number }) => {
  const event = createEvent[kind](el, { dataTransfer: { getData: (k: string) => (k === "text/todo-id" ? id : ""), setData: () => {} } });
  for (const [k, v] of Object.entries(at)) Object.defineProperty(event, k, { value: v });
  fireEvent(event.target === el ? el : el, event);
};
export const box = (el: HTMLElement, r: Partial<DOMRect>) => {
  el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, ...r }) as DOMRect;
};

// A drag from the week, with what its drop handler reads, and modifier keys or a position if given.
export const weekDrag = (kind: "dragOver" | "drop", el: Element, id: string, from: string, extra: Record<string, unknown> = {}) => {
  const event = createEvent[kind](el, { dataTransfer: { getData: (k: string) => (k === "text/todo-id" ? id : k === "text/todo-date" ? from : ""), dropEffect: "" } });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(event, k, { value: v });
  fireEvent(el, event);
};
