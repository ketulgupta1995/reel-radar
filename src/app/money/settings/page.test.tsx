// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { ME, addTxn, loadAllTxns, loadSettings, peopleOf, setValue, valueOf } from "@/lib/money";

vi.mock("next/navigation", () => ({ usePathname: () => "/money/settings" }));

import MoneySettingsPage from "./page";

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("MoneySettingsPage", () => {
  it("saves your names and family members", () => {
    routeFetch();
    render(<MoneySettingsPage />);
    type("Your names in Google Pay", "Arjun Sharma, ARJUN R SHARMA");
    expect(peopleOf(loadSettings())[0].aliases).toEqual(["Arjun Sharma", "ARJUN R SHARMA"]);
    fireEvent.blur(screen.getByLabelText("Your names in Google Pay")); // unchanged: no save
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meera" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Meera")).toBeTruthy();
    type("Meera's names in Google Pay", "Meera, MEERA VIKRAM SHARMA");
    expect(peopleOf(loadSettings())[1].aliases).toEqual(["Meera", "MEERA VIKRAM SHARMA"]);

    fireEvent.submit(screen.getByLabelText("Name").closest("form")!); // empty name: nothing added
    fireEvent.click(screen.getByLabelText("Remove Meera"));
    expect(peopleOf(loadSettings())).toHaveLength(1);
    expect(screen.queryByText("Meera")).toBeNull();
  });

  it("saves income, goal and limits, and clears them", () => {
    routeFetch();
    render(<MoneySettingsPage />);
    type("Monthly income", "60,000");
    type("Savings goal", "15000");
    type("Spending limit", "30000");
    type("🍽️ Food & dining", "5000.50");
    const s = loadSettings();
    expect([valueOf(s, "income"), valueOf(s, "goal"), valueOf(s, "limit:total"), valueOf(s, "limit:food")]).toEqual([60000, 15000, 30000, 5000.5]);
    expect((screen.getByLabelText("Monthly income") as HTMLInputElement).value).toBe("60000");

    type("Spending limit", "");
    expect(valueOf(loadSettings(), "limit:total")).toBeUndefined();
    fireEvent.blur(screen.getByLabelText("Savings goal")); // unchanged
    expect(loadSettings().values).toHaveLength(3);
  });

  it("takes in settings from the server", async () => {
    routeFetch({
      "/api/sync": (_url: URL, init?: RequestInit) =>
        init?.method === "POST"
          ? { etag: '"e"' }
          : {
              docs: {
                "money-settings": {
                  etag: '"s"',
                  data: { people: [{ id: "x", name: "Priya", aliases: ["Priya"], updatedAt: 5 }], values: [{ key: "income", value: 40000, updatedAt: 5 }], rules: [], months: [] },
                },
              },
            },
    });
    render(<MoneySettingsPage />);
    await waitFor(() => expect((screen.getByLabelText("Monthly income") as HTMLInputElement).value).toBe("40000"));
    expect(screen.getByText("Priya")).toBeTruthy();
  });

  it("deletes all money data after a second click", async () => {
    routeFetch();
    addTxn({ date: "2026-10-05", amount: 80, payee: "Auto", category: "transport", kind: "spend", personId: ME });
    setValue("income", 50000);
    render(<MoneySettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Delete all money data" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(loadAllTxns()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete all money data" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything" }));
    expect((await screen.findByRole("status")).textContent).toBe("All money data was deleted.");
    expect(loadAllTxns()).toEqual([]);
    expect(valueOf(loadSettings(), "income")).toBeUndefined();
    await waitFor(() => expect((screen.getByLabelText("Monthly income") as HTMLInputElement).value).toBe(""));
  });

  it("says so when it can't delete while offline", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    addTxn({ date: "2026-10-05", amount: 80, payee: "Auto", category: "transport", kind: "spend", personId: ME });
    render(<MoneySettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete all money data" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete everything" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/nothing was deleted/);
    expect(loadAllTxns()).toHaveLength(1);
  });

  it("downloads a backup and a CSV, and restores a backup", async () => {
    routeFetch();
    addTxn({ date: "2026-10-05", amount: 120, payee: "Rajwadi Chai", category: "food", kind: "spend", personId: ME });
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), "blob:x")), revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    render(<MoneySettingsPage />);

    fireEvent.click(screen.getByText("Download backup (JSON)"));
    fireEvent.click(screen.getByText("Download transactions (CSV)"));
    expect(names[0]).toMatch(/^money-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(names[1]).toMatch(/^money-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    const backup = JSON.parse(await readBlob(blobs[0]));
    expect(backup.txns.map((t: { payee: string }) => t.payee)).toEqual(["Rajwadi Chai"]);
    const csv = await readBlob(blobs[1]);
    expect(csv.startsWith("Date,Time,Type")).toBe(true);
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blobs[1]);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the byte-order mark Excel needs
    expect(csv).toContain(",Spent,120,120,Food & dining,Rajwadi Chai,Me,,manual");

    // Restoring brings back what the backup had.
    localStorage.clear();
    const pick = (text: string) => fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [new File([text], "money.json")] } });
    pick(JSON.stringify(backup));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Restored 1 transaction and the settings from the backup."));
    expect(loadAllTxns().map((t) => t.payee)).toEqual(["Rajwadi Chai"]);
    pick(JSON.stringify({ ...backup, txns: [...backup.txns, { ...backup.txns[0], id: "two" }] }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Restored 2 transactions and the settings from the backup."));
    pick("not json");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("That file isn't valid JSON."));
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [] } }); // nothing picked
  });

  it("shows a fallback message when the file can't be read", async () => {
    routeFetch();
    render(<MoneySettingsPage />);
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader) {
      setTimeout(() => this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>));
    });
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [new File(["{}"], "money.json")] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Couldn't read that file."));
  });
});

