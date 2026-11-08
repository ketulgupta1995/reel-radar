// Pieces shared by the Stats charts, in Bold focus.

export const NO_TAG_COLOR = "rgb(var(--bf-muted))";

export function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[16px] bg-bf-s1 p-4">
      <h3 className="text-[15px] font-black uppercase [font-stretch:115%]">{title}</h3>
      {sub && <p className="mt-0.5 font-bfm text-[11px] text-bf-muted">{sub}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

// Hover/focus tooltip for a chart mark; the mark's whole column is the hit target.
export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-lg bg-bf-ink px-2.5 py-1.5 text-left text-xs text-bf-bg opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus:opacity-100">
      {children}
    </span>
  );
}

export function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-xs text-bf-muted">
      <summary className="cursor-pointer select-none font-bfm hover:text-bf-ink">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left font-bfm tabular-nums">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="py-1 pr-4 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-bf-ink">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-bf-line">
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-4">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 font-bfm text-[11px] text-bf-muted">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${cls}`} /> {label}
        </span>
      ))}
    </div>
  );
}

export const PLANNED = "border border-bf-muted bg-bf-s2";
