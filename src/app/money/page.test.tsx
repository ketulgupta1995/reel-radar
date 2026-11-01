// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { routeFetch, stubLocation } from "@/test/pages";
import { ME, currentMonth, importTxns, loadAllTxns, loadSettings, matchPerson, peopleOf, savePerson, setValue, type Txn } from "@/lib/money";

vi.mock("next/navigation", () => ({ usePathname: () => "/money" }));

import MoneyPage from "./page";

const txn = (id: string, extra: Partial<Txn> = {}): Txn => ({
  id,
  date: "2026-10-05",
  amount: 100,
  payee: id,
  category: "other",
  kind: "spend",
  personId: ME,
  source: "manual",
  updatedAt: 1,
  ...extra,
});

function seedOctober() {
  const priya = savePerson({ name: "Priya", aliases: ["Priya Sharma"] });
  setValue("limit:total", 1000);
  setValue("limit:food", 300);
  setValue("income", 5000);
  setValue("goal", 2000);
  importTxns([
    txn("Rajwadi Chai", { amount: 450, category: "food" }),
    txn("Meesho", { amount: 500, category: "shopping", personId: priya.id, date: "2026-10-07" }),
    txn("Meesho refund", { amount: 100, category: "shopping", kind: "refund", personId: priya.id, date: "2026-10-08" }),
    txn("Salary", { amount: 1000, kind: "income", date: "2026-10-01" }),
    txn("Old", { amount: 50, date: "2026-09-01" }),
  ]);
  return priya;
}

describe("MoneyPage", () => {
  it("starts on this month and steps between months", () => {
    routeFetch();
    stubLocation();
    render(<MoneyPage />);
    const now = new Date(currentMonth() + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(now);
    expect(screen.getByText(/Nothing spent in/)).toBeTruthy();
    expect(screen.getByText("Set a monthly limit →")).toBeTruthy();
    expect(screen.getByText("No transactions.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe(now);
  });

  it("shows the month's totals, limits and what family is owed", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = seedOctober();
    render(<MoneyPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("October 2026");
    expect(screen.getByTestId("spent").textContent).toBe("₹850");
    expect(screen.getByText("₹150 left of ₹1,000")).toBeTruthy();
    expect(screen.getByTestId("income").textContent).toBe("₹6,000");
    expect(screen.getByTestId("saved").textContent).toBe("₹5,150");
    expect(screen.getByTestId("owed").textContent).toBe("₹400");

    const cats = within(screen.getByRole("region", { name: "Spending by category" }));
    expect(cats.getByText("₹450").className).toContain("text-red-400"); // over the ₹300 food limit
    expect(cats.getByText("Shopping")).toBeTruthy();
    expect(cats.getByText("47%")).toBeTruthy(); // ₹400 of ₹850, no limit set

    const family = within(screen.getByRole("region", { name: "Family balances" }));
    expect(family.getByText("you owe ₹400")).toBeTruthy();
    expect(family.getByText("spent ₹400 this month")).toBeTruthy();
    fireEvent.click(family.getByLabelText("Mark ₹400 paid to Priya"));
    expect(family.getByText("all settled")).toBeTruthy();
    expect(loadAllTxns().find((t) => t.kind === "settlement")).toMatchObject({ amount: 400, personId: priya.id, payee: "Priya" });
  });

  it("shows what you paid each family member in the month", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = savePerson({ name: "Priya", aliases: ["Priya Sharma"] });
    const meera = savePerson({ name: "Meera", aliases: ["Meera"] });
    importTxns([
      txn("Sent Priya", { amount: 300, kind: "settlement", category: "family", personId: priya.id }),
      txn("Sent Priya again", { amount: 200, kind: "settlement", category: "family", personId: priya.id, date: "2026-10-20", time: "14:05" }),
      txn("Sent Priya in Sept", { amount: 900, kind: "settlement", category: "family", personId: priya.id, date: "2026-09-20" }),
      txn("Meera's Meesho", { amount: 250, category: "shopping", personId: meera.id }),
    ]);
    render(<MoneyPage />);
    const family = within(screen.getByRole("region", { name: "Family balances" }));
    expect(family.getByText("all settled")).toBeTruthy(); // nothing spent since the last payment
    expect(family.getByText("you paid ₹500 this month")).toBeTruthy();
    expect(family.getByText("you owe ₹250")).toBeTruthy();
    expect(family.getByText("spent ₹250 this month")).toBeTruthy();
    expect(family.getByText("Spent since you paid ₹200 on Oct 20, 2:05 PM")).toBeTruthy();
    expect(family.getByText("Everything they've spent; not paid back yet")).toBeTruthy();
  });

  it("lists the transactions behind a family member's balance", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const anita = savePerson({ name: "Anita Desai", aliases: ["Anita Desai"] });
    const pay = (id: string, date: string, time: string, amount: number) =>
      txn(id, { payee: "Desai Anita", amount, date, time, kind: "settlement", category: "family", personId: anita.id, source: "gpay" });
    importTxns([
      txn("Her lunch", { amount: 400, date: "2026-10-20", personId: anita.id }),
      pay("p1", "2026-10-25", "16:23", 10330),
      txn("From Anita", { payee: "Desai Anita", amount: 300, date: "2026-10-28", time: "18:16", kind: "transfer", category: "family" }),
      pay("p2", "2026-10-31", "10:56", 5000),
      pay("p3", "2026-10-31", "10:58", 660),
      txn("Her snack", { amount: 120, date: "2026-10-31", time: "12:00", personId: anita.id }),
      txn("Snack refund", { amount: 20, date: "2026-10-31", time: "13:00", personId: anita.id, kind: "refund" }),
      pay("p4", "2026-10-31", "23:46", 290),
      txn("Her dinner", { amount: 250, date: "2026-11-01", time: "20:00", personId: anita.id }),
      txn("Someone else", { amount: 99 }),
    ]);
    render(<MoneyPage />);
    const family = within(screen.getByRole("region", { name: "Family balances" }));
    expect(family.getByText("you owe ₹250")).toBeTruthy();
    expect(family.getByText("Spent since you paid ₹5,950 on Oct 31 (3 payments, last at 11:46 PM)")).toBeTruthy();

    fireEvent.click(family.getByLabelText("Show transactions with Anita Desai"));
    expect(family.getByText("You paid ₹16,280 in 4 payments · they spent ₹750 · ₹250 owed since your last payment")).toBeTruthy();
    const list = within(family.getByRole("list", { name: "Transactions with Anita Desai" }));
    const rows = list.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(9); // everything with her, newest first, nothing else
    expect(rows[0]).toMatch(/Her dinner.*Owed₹250/);
    expect(rows[1]).toMatch(/Oct 3111:46 PMDesai AnitaYou paid₹290/);
    expect(rows.find((r) => r!.includes("Snack refund"))).toMatch(/Refund.*Covered−₹20/);
    expect(rows.find((r) => r!.includes("Her lunch"))).toMatch(/Covered₹400/);
    expect(rows.find((r) => r!.includes("6:16 PM"))).toMatch(/Not counted₹300/);
    fireEvent.click(family.getByLabelText("Hide transactions with Anita Desai"));
    expect(family.queryByRole("list", { name: "Transactions with Anita Desai" })).toBeNull();
  });

  it("shows each transaction's time when it has one", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    importTxns([
      txn("Breakfast", { time: "09:05" }),
      txn("Lunch", { time: "12:30" }),
      txn("Late snack", { time: "00:15" }),
      txn("Dinner", { time: "21:45" }),
      txn("No time"),
    ]);
    render(<MoneyPage />);
    const list = within(screen.getByRole("region", { name: "Transactions" }));
    for (const t of ["9:05 AM", "12:30 PM", "12:15 AM", "9:45 PM"]) expect(list.getByText(t)).toBeTruthy();
    expect(list.getByText("No time").closest("li")!.textContent).not.toMatch(/AM|PM/);
  });

  it("filters, recategorizes, retypes and deletes transactions", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = seedOctober();
    render(<MoneyPage />);
    const list = within(screen.getByRole("region", { name: "Transactions" }));
    expect(list.getAllByRole("listitem")).toHaveLength(4);
    expect(list.getByText("Mon, Oct 5")).toBeTruthy(); // grouped by day, with the day's spending
    expect(list.getByText("Mon, Oct 5").nextSibling?.textContent).toBe("₹450");
    fireEvent.click(list.getByRole("button", { name: "Priya" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText("Priya · Refund")).toBeTruthy();
    fireEvent.click(list.getByRole("button", { name: "Everyone" }));

    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "meesho" } });
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "food" } }); // by category
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "nothing like it" } });
    expect(list.getByText("No transactions.")).toBeTruthy();
    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "" } });

    // Rows open to edit, one at a time.
    expect(list.queryByLabelText("Category for Rajwadi Chai")).toBeNull();
    fireEvent.click(list.getByText("Meesho"));
    expect(list.getByLabelText("Category for Meesho")).toBeTruthy();
    fireEvent.click(list.getByText("Rajwadi Chai"));
    expect(list.queryByLabelText("Category for Meesho")).toBeNull();

    fireEvent.change(list.getByLabelText("Note for Rajwadi Chai"), { target: { value: " with Priya " } });
    fireEvent.blur(list.getByLabelText("Note for Rajwadi Chai"));
    expect(loadAllTxns().find((t) => t.id === "Rajwadi Chai")?.note).toBe("with Priya");
    expect(list.getByText("Me · with Priya")).toBeTruthy();
    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "with priya" } }); // notes are searched too
    expect(list.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(list.getByLabelText("Search transactions"), { target: { value: "" } });
    fireEvent.change(list.getByLabelText("Note for Rajwadi Chai"), { target: { value: "" } });
    fireEvent.blur(list.getByLabelText("Note for Rajwadi Chai"));
    expect(loadAllTxns().find((t) => t.id === "Rajwadi Chai")?.note).toBeUndefined();

    fireEvent.change(list.getByLabelText("Whose for Rajwadi Chai"), { target: { value: priya.id } });
    expect(loadAllTxns().find((t) => t.id === "Rajwadi Chai")?.personId).toBe(priya.id);
    expect(screen.getByTestId("owed").textContent).toBe("₹850");
    fireEvent.change(list.getByLabelText("Whose for Rajwadi Chai"), { target: { value: ME } });

    fireEvent.change(list.getByLabelText("Category for Rajwadi Chai"), { target: { value: "family" } });
    expect(loadSettings().rules).toMatchObject([{ payee: "rajwadi chai", category: "family" }]);
    fireEvent.change(list.getByLabelText("Type for Rajwadi Chai"), { target: { value: "transfer" } });
    expect(screen.getByTestId("spent").textContent).toBe("₹400");
    expect(list.getByText("Me · Ignored")).toBeTruthy();

    fireEvent.click(list.getByLabelText("Delete Rajwadi Chai"));
    expect(loadAllTxns().some((t) => t.id === "Rajwadi Chai")).toBe(false);
  });

  it("marks a payment as sent to a family member", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = seedOctober();
    const meera = savePerson({ name: "Meera", aliases: [] });
    importTxns([txn("gpay:1", { payee: "Desai Anita", amount: 300, source: "gpay", date: "2026-10-12" }), txn("gpay:2", { payee: "Zomato", kind: "settlement" })]);
    render(<MoneyPage />);
    const list = within(screen.getByRole("region", { name: "Transactions" }));
    fireEvent.click(list.getByText("Zomato"));
    expect((list.getByLabelText("Paid to for Zomato") as HTMLSelectElement).value).toBe(ME); // "To whom?"
    fireEvent.click(list.getByText("Desai Anita"));
    expect(list.queryByLabelText("Paid to for Desai Anita")).toBeNull();

    fireEvent.change(list.getByLabelText("Type for Desai Anita"), { target: { value: "settlement" } });
    expect(loadAllTxns().find((t) => t.id === "gpay:1")).toMatchObject({ kind: "settlement", personId: priya.id });
    fireEvent.change(list.getByLabelText("Paid to for Desai Anita"), { target: { value: meera.id } });
    expect(loadAllTxns().find((t) => t.id === "gpay:1")?.personId).toBe(meera.id);
    expect(loadSettings().people.find((p) => p.id === meera.id)?.aliases).toEqual(["Desai Anita"]);
  });

  it("goes over the overall limit and runs a negative saving", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    setValue("limit:total", 100);
    importTxns([txn("Big", { amount: 250 })]);
    render(<MoneyPage />);
    expect(screen.getByText("₹150 over of ₹100")).toBeTruthy();
    expect(screen.getByTestId("saved").textContent).toBe("−₹250");
    expect(screen.getByText("Add your monthly income →")).toBeTruthy();
  });

  it("adds a transaction, guessing its category", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = savePerson({ name: "Priya Sharma", aliases: [] });
    render(<MoneyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add a transaction" }));
    const form = within(screen.getByRole("form", { name: "Add a transaction" }));
    const add = form.getByRole("button", { name: /^Add/ }) as HTMLButtonElement;
    const pressed = (name: string) => form.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(add.disabled).toBe(true);
    fireEvent.change(form.getByLabelText("Amount"), { target: { value: "₹12a0" } });
    fireEvent.change(form.getByLabelText("What for"), { target: { value: "Swiggy dinner" } });
    expect(pressed("Food & dining")).toBe("true");
    expect(form.getByText("· guessed")).toBeTruthy();
    fireEvent.click(within(form.getByRole("group", { name: "Whose" })).getByRole("button", { name: /Priya/ }));
    fireEvent.change(form.getByLabelText("Date"), { target: { value: "" } }); // falls back to the default
    fireEvent.change(form.getByLabelText("Note"), { target: { value: "birthday" } });
    expect(add.textContent).toContain("₹120");
    fireEvent.submit(form.getByLabelText("Amount").closest("form")!);
    expect(loadAllTxns()).toMatchObject([{ amount: 120, payee: "Swiggy dinner", category: "food", personId: priya.id, date: "2026-10-01", note: "birthday" }]);
    expect((form.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    expect(form.getByRole("status").textContent).toBe("✓ Added ₹120 · Swiggy dinner");

    fireEvent.change(form.getByLabelText("Amount"), { target: { value: "50" } });
    fireEvent.change(form.getByLabelText("What for"), { target: { value: "Gift" } });
    fireEvent.click(form.getByRole("button", { name: "Family & friends" }));
    fireEvent.click(form.getByRole("button", { name: "Income" }));
    fireEvent.click(add);
    expect(loadAllTxns().find((t) => t.payee === "Gift")).toMatchObject({ category: "family", kind: "income" });
    fireEvent.submit(form.getByLabelText("Amount").closest("form")!); // empty: nothing added
    expect(loadAllTxns()).toHaveLength(2);

    // Paying back picks a family member, and needs no "what for".
    fireEvent.click(form.getByRole("button", { name: "Paid back" }));
    expect(form.queryByRole("group", { name: "Category" })).toBeNull();
    expect(within(form.getByRole("group", { name: "Whose" })).queryByRole("button", { name: /Me/ })).toBeNull();
    fireEvent.change(form.getByLabelText("Amount"), { target: { value: "70" } });
    fireEvent.click(add);
    expect(loadAllTxns().find((t) => t.kind === "settlement")).toMatchObject({ amount: 70, payee: "Priya Sharma", personId: priya.id, category: "family" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Add a transaction" })).toBeNull();
    fireEvent.click(screen.getByText("+ Add"));
    fireEvent.click(screen.getByLabelText("Close Add a transaction"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can't pay back with no family, and spends for you alone with no one to pick", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    render(<MoneyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add a transaction" }));
    const form = within(screen.getByRole("form", { name: "Add a transaction" }));
    expect((form.getByRole("button", { name: "Paid back" }) as HTMLButtonElement).disabled).toBe(true);
    expect(form.queryByRole("group", { name: "Whose" })).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Close")[0]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("charts spending by day and compares with last month", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    importTxns([
      txn("a", { amount: 300, date: "2026-10-03" }),
      txn("b", { amount: 600, date: "2026-10-10" }),
      txn("back", { amount: 100, kind: "refund", date: "2026-10-11" }),
      txn("sept", { amount: 1000, date: "2026-09-10" }),
    ]);
    render(<MoneyPage />);
    expect(screen.getByText("▼ 20% vs September (₹1,000)")).toBeTruthy();
    const chart = within(screen.getByRole("figure", { name: "Spending by day" }));
    expect(chart.getAllByRole("button")).toHaveLength(31);
    expect(chart.getByTestId("day-tip").textContent).toBe("Oct 10 · ₹600 (most)");
    expect(chart.getByText("Daily average ₹26")).toBeTruthy(); // ₹800 over 31 days
    fireEvent.mouseEnter(chart.getByLabelText("Oct 3: ₹300"));
    expect(chart.getByTestId("day-tip").textContent).toBe("Oct 3 · ₹300");
    fireEvent.focus(chart.getByLabelText("Oct 11: ₹0")); // a refund never shows below zero
    expect(chart.getByTestId("day-tip").textContent).toBe("Oct 11 · ₹0");
    fireEvent.mouseLeave(chart.getByLabelText("Oct 3: ₹300").parentElement!);
    fireEvent.click(chart.getByLabelText("Oct 1: ₹0"));
    expect(chart.getByTestId("day-tip").textContent).toBe("Oct 1 · ₹0");

    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText("▼ 100% vs October (₹800)")).toBeTruthy();
  });

  const starter = {
    me: ["Arjun Sharma", "Arjun Vikram Sharma"],
    family: [
      { id: "priya", name: "Priya Sharma", aliases: ["Priya Sharma", "Priya Vikram Sharma"] },
      { id: "meera", name: "Meera Sharma", aliases: ["Meera Sharma", "Meera Vikram Sharma"] },
      { id: "vikram", name: "Vikram Sharma", aliases: ["Vikram Sharma"] },
      { id: "anita", name: "Anita Desai", aliases: ["Anita Desai"] },
    ],
  };

  it("adds the starter family once, after the server has been asked", async () => {
    routeFetch({ "/api/money/family": starter });
    stubLocation("?month=2026-10");
    render(<MoneyPage />);
    expect(screen.queryByRole("region", { name: "Family balances" })).toBeNull();
    const family = within(await screen.findByRole("region", { name: "Family balances" }));
    for (const name of ["Priya Sharma", "Meera Sharma", "Vikram Sharma", "Anita Desai"]) expect(family.getByText(name)).toBeTruthy();
    const [me] = peopleOf(loadSettings());
    expect(me.aliases).toEqual(["Arjun Sharma", "Arjun Vikram Sharma"]);
    // Statement names land on the right person, even when one holds another's name.
    expect(matchPerson("MEERA VIKRAM SHARMA", peopleOf(loadSettings()))?.id).toBe("meera");
    expect(matchPerson("Desai Anita", peopleOf(loadSettings()))?.id).toBe("anita");
    expect(matchPerson("Vikram Sharma", peopleOf(loadSettings()))?.id).toBe("vikram");
    expect(matchPerson("VIKRAM MOHAN KULKARNI", peopleOf(loadSettings()))).toBeUndefined();
  });

  it("doesn't add the starter family while offline", async () => {
    routeFetch({ "/api/sync": () => Promise.reject(new Error("offline")) });
    stubLocation("?month=2026-10");
    render(<MoneyPage />);
    await new Promise((r) => setTimeout(r, 20));
    expect(loadSettings().people).toEqual([]);
  });

  it("adds no family when none is configured, and still can once one is", async () => {
    routeFetch({ "/api/money/family": { me: [], family: [] } });
    stubLocation("?month=2026-10");
    const { unmount } = render(<MoneyPage />);
    await new Promise((r) => setTimeout(r, 20));
    expect(loadSettings().people).toEqual([]);
    unmount();

    routeFetch({ "/api/money/family": starter });
    render(<MoneyPage />);
    const family = within(await screen.findByRole("region", { name: "Family balances" }));
    expect(family.getByText("Anita Desai")).toBeTruthy();
  });

  it("takes in changes from the server", async () => {
    stubLocation("?month=2026-10");
    routeFetch({
      "/api/sync": (url: URL, init?: RequestInit) =>
        init?.method === "POST"
          ? { etag: '"e"' }
          : url.searchParams.get("keys")!.startsWith("money-settings")
            ? { docs: { "money-settings": { etag: '"s"', data: { people: [], values: [], rules: [], months: ["2026-10"] } } } }
            : { docs: { "money-2026-10": { etag: '"m"', data: { items: [txn("From phone", { amount: 75 })] } } } },
    });
    render(<MoneyPage />);
    await waitFor(() => expect(screen.getByText("From phone")).toBeTruthy());
    expect(screen.getByTestId("spent").textContent).toBe("₹75");
  });

  it("sorts imported spending one payee at a time, and remembers the answers", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    const priya = savePerson({ name: "Priya Sharma", aliases: [] });
    importTxns([
      txn("r1", { payee: "Ramesh Kumar", amount: 300, source: "gpay", date: "2026-10-03" }),
      txn("r2", { payee: "Ramesh Kumar", amount: 200, source: "gpay", date: "2026-10-09" }),
      txn("h", { payee: "Shri Devi Hospitality", amount: 900, category: "food", source: "gpay", personId: priya.id }),
      txn("s", { payee: "Sai Enterprises", amount: 80, source: "paytm" }),
      txn("q", { payee: "Quick Pay", amount: 40, source: "gpay" }),
    ]);
    render(<MoneyPage />);
    const queue = within(screen.getByRole("region", { name: "Sort your spending" }));
    expect(queue.getByText("4 payees to go · ₹1,520")).toBeTruthy();

    // The biggest first; its matching categories lead the buttons.
    expect(queue.getByText("Shri Devi Hospitality")).toBeTruthy();
    expect(queue.getByText("1 payment · ₹900 · Oct 5 · Priya")).toBeTruthy();
    expect(queue.getByText("Looks like Food & dining or Health. Which is it?")).toBeTruthy();
    const buttons = within(queue.getByRole("group", { name: "Category for Shri Devi Hospitality" })).getAllByRole("button");
    expect(buttons.slice(0, 2).map((b) => b.getAttribute("aria-label"))).toEqual(["Food & dining", "Health"]);
    fireEvent.click(queue.getByLabelText("Food & dining"));
    expect(queue.getByRole("status").textContent).toBe("✓ Shri Devi Hospitality → Food & dining, now and in later imports");

    expect(queue.getByText("2 payments · ₹500 · Oct 3 – Oct 9")).toBeTruthy();
    expect(queue.getByText("What was this?")).toBeTruthy();
    fireEvent.click(queue.getByLabelText("Groceries"));
    expect(loadAllTxns().filter((t) => t.payee === "Ramesh Kumar").map((t) => t.category)).toEqual(["groceries", "groceries"]);
    expect(loadSettings().rules.map((r) => [r.payee, r.category])).toEqual([
      ["shri devi hospitality", "food"],
      ["ramesh kumar", "groceries"],
    ]);
    const cats = within(screen.getByRole("region", { name: "Spending by category" }));
    expect(cats.getByText("Groceries")).toBeTruthy();

    // Keep as Other takes it off the list; Skip only hides it for now.
    fireEvent.click(queue.getByText("Keep as Other"));
    expect(loadSettings().rules.find((r) => r.payee === "sai enterprises")?.category).toBe("other");
    fireEvent.click(queue.getByText("Skip for now →"));
    expect(queue.getByText(/Skipped 1 for now/)).toBeTruthy();
    fireEvent.click(queue.getByText("Show them again"));
    fireEvent.click(queue.getByLabelText("Transport"));
    expect(queue.getByText("All sorted. Your category totals are complete.")).toBeTruthy();
  });

  it("has no sorting card when nothing needs a category", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    seedOctober();
    render(<MoneyPage />);
    expect(screen.queryByRole("region", { name: "Sort your spending" })).toBeNull();
  });

  it("logs cash spending with an amount and one tap", () => {
    routeFetch();
    stubLocation("?month=2026-10");
    render(<MoneyPage />);
    fireEvent.click(screen.getByLabelText("Add cash spending"));
    const sheet = within(screen.getByRole("dialog", { name: "Cash spent" }));
    expect((sheet.getByLabelText("Save as Groceries") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(sheet.getByLabelText("Cash amount"), { target: { value: "₹1a20" } });
    fireEvent.click(sheet.getByLabelText("Save as Groceries"));
    expect(sheet.getByRole("status").textContent).toBe("✓ Added ₹120 cash · Groceries");
    expect((sheet.getByLabelText("Cash amount") as HTMLInputElement).value).toBe("");

    fireEvent.change(sheet.getByLabelText("Cash amount"), { target: { value: "60" } });
    fireEvent.change(sheet.getByLabelText("What for (cash)"), { target: { value: "Auto to station" } });
    fireEvent.change(sheet.getByLabelText("Cash date"), { target: { value: "2026-10-12" } });
    fireEvent.change(sheet.getByLabelText("Cash date"), { target: { value: "" } }); // cleared: back to the default
    fireEvent.click(sheet.getByLabelText("Save as Transport"));
    fireEvent.click(sheet.getByLabelText("Save as Food & dining")); // no amount yet: nothing saved
    fireEvent.click(sheet.getByLabelText("Close Cash spent"));

    expect(loadAllTxns().map((t) => [t.payee, t.amount, t.category, t.source, t.date, t.personId])).toEqual([
      ["Cash", 120, "groceries", "cash", "2026-10-01", ME],
      ["Auto to station", 60, "transport", "cash", "2026-10-01", ME],
    ]);
    expect(screen.getByTestId("spent").textContent).toBe("₹180");
    expect(screen.getByTestId("cash").textContent).toBe("💵 ₹180 of it in cash");
    expect(screen.getAllByText("Me · 💵 Cash")).toHaveLength(2);

    // Recategorizing a cash entry doesn't teach a rule for the name "Cash".
    fireEvent.click(screen.getByText("Cash"));
    fireEvent.change(screen.getByLabelText("Category for Cash"), { target: { value: "food" } });
    expect(loadAllTxns().find((t) => t.payee === "Cash")?.category).toBe("food");
    expect(loadSettings().rules).toEqual([]);
  });
});
