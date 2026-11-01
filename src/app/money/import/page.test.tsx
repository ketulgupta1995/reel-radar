// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { FakeRow, firstPageHeader, gpayPdf, makePdf, paytmPdf, rowText } from "@/test/gpayPdf";
import { ME, importTxns, loadAllTxns, loadSettings, peopleOf, savePerson } from "@/lib/money";

vi.mock("next/navigation", () => ({ usePathname: () => "/money/import" }));

import MoneyImportPage from "./page";

const rows: FakeRow[] = [
  { day: "09 Oct, 2026", time: "02:02 PM", name: "BLINKIT", upi: "101", amount: "158" },
  { day: "10 Oct, 2026", time: "09:02 AM", name: "Canteen", upi: "102", amount: "30" },
  { day: "29 Oct, 2026", time: "08:01 PM", dir: "Received from", name: "Arjun Sharma", upi: "103", amount: "2,000" },
];

const upload = (bytes: Uint8Array, name = "statement.pdf") =>
  fireEvent.change(screen.getByLabelText("Statement PDF"), { target: { files: [new File([bytes], name, { type: "application/pdf" })] } });

describe("MoneyImportPage", () => {
  it("imports a sister's statement as her spending", async () => {
    routeFetch();
    savePerson({ id: ME, name: "Me", aliases: ["Arjun Sharma"] });
    render(<MoneyImportPage />);

    fireEvent.change(screen.getByLabelText("New person's name"), { target: { value: "Priya" } });
    fireEvent.click(screen.getByText("Add person"));
    const priya = peopleOf(loadSettings())[1];
    const whose = within(screen.getByRole("radiogroup", { name: "Whose statement" }));
    expect(whose.getByRole("radio", { name: /Priya/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Drop Priya's statement PDF, or tap to pick")).toBeTruthy();

    upload(gpayPdf(rows));
    const review = within(await screen.findByRole("region", { name: "Review" }));
    expect(review.getByText(/3 transactions for Priya/)).toBeTruthy();
    expect(review.getByText("Oct 1 – Oct 31")).toBeTruthy();
    expect(review.getByText("✓ Matches the statement's total")).toBeTruthy();
    expect((review.getByLabelText("Type for Arjun Sharma") as HTMLSelectElement).value).toBe("settlement");
    fireEvent.change(review.getByLabelText("Type for Arjun Sharma"), { target: { value: "income" } });
    expect(review.getByText("+₹2,000")).toBeTruthy();
    fireEvent.change(review.getByLabelText("Type for Arjun Sharma"), { target: { value: "settlement" } });

    fireEvent.click(review.getByLabelText("Include Canteen ₹30"));
    fireEvent.change(review.getByLabelText("Category for BLINKIT"), { target: { value: "food" } });
    fireEvent.change(review.getByLabelText("Type for BLINKIT"), { target: { value: "spend" } });
    fireEvent.click(review.getByText("Import 2 transactions"));

    expect(screen.getByRole("status").textContent).toContain("Imported 2 transactions.");
    expect(screen.getByText("See October 2026 →").getAttribute("href")).toBe("/money?month=2026-10");
    expect(loadAllTxns().map((t) => [t.payee, t.kind, t.personId, t.category])).toEqual([
      ["Arjun Sharma", "settlement", priya.id, "family"],
      ["BLINKIT", "spend", priya.id, "food"],
    ]);
    // The changed category is remembered for next time.
    expect(loadSettings().rules).toMatchObject([{ payee: "blinkit", category: "food" }]);
  });

  it("marks transactions already imported and re-plans for another owner", async () => {
    routeFetch();
    savePerson({ name: "Priya", aliases: ["Priya Sharma"] });
    importTxns([{ id: "gpay:101", date: "2026-10-09", amount: 158, payee: "BLINKIT", category: "groceries", kind: "spend", personId: ME, source: "gpay", updatedAt: 1 }]);
    render(<MoneyImportPage />);
    expect(screen.getByText(/Add your own name in/)).toBeTruthy();

    upload(gpayPdf([rows[0]]));
    const review = within(await screen.findByRole("region", { name: "Review" }));
    expect(review.getByText("Already imported")).toBeTruthy();
    expect((review.getByLabelText("Include BLINKIT ₹158") as HTMLInputElement).checked).toBe(false);
    expect((review.getByText("Import 0 transactions") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(review.getByText("Select all")); // an already imported one stays out
    expect((review.getByLabelText("Include BLINKIT ₹158") as HTMLInputElement).checked).toBe(false);

    // Imported as yours by mistake: importing it as Priya's moves it to her.
    fireEvent.click(screen.getByRole("radio", { name: /Priya/ }));
    expect(review.getByText(/1 transactions for Priya/)).toBeTruthy();
    expect(review.getByText("Imported as Me's; moves to Priya")).toBeTruthy();
    expect((review.getByLabelText("Include BLINKIT ₹158") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(review.getByText("Select none"));
    expect(review.getByText("Import 0 transactions")).toBeTruthy();
    fireEvent.click(review.getByText("Select all"));
    fireEvent.click(review.getByText("Import 1 transaction"));
    expect(screen.getByRole("status").textContent).toContain("Imported 1 transaction.");
    expect(loadAllTxns()).toMatchObject([{ id: "gpay:101", personId: peopleOf(loadSettings())[1].id }]); // the same UPI id replaces the old copy
  });

  it("marks a payment to a name that doesn't match as sent to a sister, and remembers the name", async () => {
    routeFetch();
    const priya = savePerson({ name: "Priya", aliases: ["Priya Sharma"] });
    const meera = savePerson({ name: "Meera", aliases: ["Meera Sharma"] });
    render(<MoneyImportPage />);

    upload(gpayPdf([{ day: "12 Oct, 2026", time: "10:00 AM", name: "Desai Anita", upi: "201", amount: "500" }, rows[0]]));
    const review = within(await screen.findByRole("region", { name: "Review" }));
    expect((review.getByLabelText("Type for Desai Anita") as HTMLSelectElement).value).toBe("spend");
    expect(review.queryByLabelText("Paid to for Desai Anita")).toBeNull();
    fireEvent.click(review.getByText("📦 Needs a category (1)")); // only the uncategorized one
    expect(review.queryByText("BLINKIT")).toBeNull();
    fireEvent.click(review.getByText("📦 Needs a category (1)"));
    expect(review.getByText("BLINKIT")).toBeTruthy();

    fireEvent.change(review.getByLabelText("Type for Desai Anita"), { target: { value: "settlement" } });
    expect((review.getByLabelText("Paid to for Desai Anita") as HTMLSelectElement).value).toBe(priya.id);
    fireEvent.change(review.getByLabelText("Paid to for Desai Anita"), { target: { value: meera.id } });
    fireEvent.change(review.getByLabelText("Type for BLINKIT"), { target: { value: "settlement" } });
    fireEvent.change(review.getByLabelText("Type for BLINKIT"), { target: { value: "spend" } });
    expect(review.queryByLabelText("Paid to for BLINKIT")).toBeNull();
    fireEvent.click(review.getByText("Import 2 transactions"));

    expect(loadAllTxns().map((t) => [t.payee, t.kind, t.personId, t.category])).toEqual([
      ["Desai Anita", "settlement", meera.id, "other"],
      ["BLINKIT", "spend", ME, "groceries"],
    ]);
    expect(peopleOf(loadSettings()).find((p) => p.id === meera.id)?.aliases).toEqual(["Meera Sharma", "Desai Anita"]);
  });

  it("picks whose statement it is from its email, and warns when the owner can't be right", async () => {
    routeFetch();
    savePerson({ id: ME, name: "Me", aliases: ["Arjun Sharma"] });
    const priya = savePerson({ name: "Priya Sharma", aliases: ["Priya Sharma"] });
    render(<MoneyImportPage />);
    const header = (email: string) => `Transaction statement 9000000002, ${email} Note: x Transaction statement period 01 October 2026 - 31 October 2026 Sent ₹158 Received ₹2,000 Date & time Transaction details Amount`;
    upload(makePdf([`${header("priyasharmapune@gmail.com")} ${rowText(rows[0])} ${rowText(rows[2])}`]));
    expect(await screen.findByText("This is Priya Sharma's statement (priyasharmapune@gmail.com).")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Priya/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/probably someone else's/)).toBeNull();

    // Picking yourself for it: it has a payment from you, so it can't be yours.
    fireEvent.click(screen.getByRole("radio", { name: /Mine/ }));
    expect(screen.getByText(/has a payment with Me \(Arjun Sharma\), so it's probably someone else's/)).toBeTruthy();

    upload(makePdf([`${header("arjunsharma1990@gmail.com")} ${rowText(rows[0])}`]));
    expect(await screen.findByText("This is your statement (arjunsharma1990@gmail.com).")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Mine/ }).getAttribute("aria-checked")).toBe("true");
    expect(priya.id).toBeTruthy();
  });

  it("imports a Paytm statement, picking whose it is by the holder's name", async () => {
    routeFetch();
    savePerson({ id: ME, name: "Me", aliases: ["Arjun Vikram Sharma"] });
    const meera = savePerson({ name: "Meera Sharma", aliases: ["Meera Sharma", "Meera Vikram Sharma"] });
    // Already imported from your Google Pay statement: the same UPI id, so it's the same payment.
    importTxns([{ id: "gpay:664323793383", date: "2026-10-03", amount: 36000, payee: "MEERA VIKRAM SHARMA", category: "family", kind: "settlement", personId: meera.id, source: "gpay", updatedAt: 1 }]);
    render(<MoneyImportPage />);

    upload(
      paytmPdf([
        { day: "31 Oct", time: "8:17 PM", details: "Paid to The Lit Momos", ref: "630445833061", amount: "130", note: "Momos" },
        { day: "03 Oct", time: "6:35 PM", details: "Received from Arjun Vikram Sharma", ref: "664323793383", amount: "36,000", sign: "+" },
      ])
    );
    expect(await screen.findByText("This is Meera Sharma's statement (MEERA VIKRAM SHARMA).")).toBeTruthy();
    const review = within(screen.getByRole("region", { name: "Review" }));
    expect(review.getByText(/2 transactions for Meera Sharma/)).toBeTruthy();
    expect(review.getByText("✓ Matches the statement's total")).toBeTruthy();
    expect(review.getByText("Already imported")).toBeTruthy();
    fireEvent.click(review.getByText("Import 1 transaction"));

    expect(loadAllTxns().find((t) => t.payee === "The Lit Momos")).toMatchObject({ id: "gpay:630445833061", kind: "spend", personId: meera.id, source: "paytm", time: "20:17" });
    expect(loadAllTxns()).toHaveLength(2);
  });

  it("flags totals that don't add up, and explains unreadable files", async () => {
    routeFetch();
    render(<MoneyImportPage />);
    upload(makePdf([`${firstPageHeader(1, "999", "0")} ${rowText(rows[0])}`]));
    expect(await screen.findByText("Statement says ₹999 sent; found ₹158")).toBeTruthy();

    // A file dropped on the box is read the same way.
    const box = screen.getByLabelText("Statement PDF").closest("label")!;
    fireEvent.dragOver(box);
    expect(box.className).toContain("bg-gold/10");
    fireEvent.dragLeave(box);
    expect(box.className).not.toContain("bg-gold/10");
    fireEvent.drop(box, { dataTransfer: { files: [new File([gpayPdf(rows)], "s.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText(/3 transactions for Me/)).toBeTruthy();

    upload(new TextEncoder().encode("not a pdf"), "notes.txt");
    expect((await screen.findByRole("alert")).textContent).toBe("That file isn't a PDF.");
    expect(screen.queryByRole("region", { name: "Review" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Statement PDF"), { target: { files: [] } });
    fireEvent.keyDown(screen.getByLabelText("New person's name"), { key: "Enter" }); // nothing typed: nothing added
    expect(peopleOf(loadSettings())).toHaveLength(1);
  });

  it("shows a fallback message for unexpected errors", async () => {
    routeFetch();
    render(<MoneyImportPage />);
    vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader) {
      setTimeout(() => this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>));
    });
    upload(gpayPdf(rows));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Couldn't read that file."));
  });

  it("asks for a category for what the import couldn't sort", async () => {
    routeFetch();
    importTxns([{ id: "old", date: "2026-09-01", amount: 99, payee: "Earlier Unknown", category: "other", kind: "spend", personId: ME, source: "gpay", updatedAt: 1 }]);
    render(<MoneyImportPage />);
    upload(
      gpayPdf([
        { day: "09 Oct, 2026", time: "02:02 PM", name: "Ramesh Kumar", upi: "201", amount: "158" },
        { day: "10 Oct, 2026", time: "09:02 AM", name: "Canteen", upi: "202", amount: "30" },
      ])
    );
    const review = within(await screen.findByRole("region", { name: "Review" }));
    fireEvent.click(review.getByText("Import 2 transactions"));

    // Only this import's unsorted rows; the earlier one waits on the overview.
    const queue = within(screen.getByRole("region", { name: "Sort your spending" }));
    expect(queue.getByText("1 payee to go · ₹158")).toBeTruthy();
    fireEvent.click(queue.getByLabelText("Personal care"));
    expect(queue.getByText("All sorted. Your category totals are complete.")).toBeTruthy();
    expect(loadAllTxns().find((t) => t.payee === "Ramesh Kumar")?.category).toBe("personal");
    expect(loadSettings().rules).toMatchObject([{ payee: "ramesh kumar", category: "personal" }]);
  });
});

