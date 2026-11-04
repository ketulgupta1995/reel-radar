// Pieces shared by the stats page's charts.

export function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-panel/60 p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-white/50">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Hover/focus tooltip for a chart mark; the mark's whole column is the hit target.
export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-lg border border-white/15 bg-ink px-2.5 py-1.5 text-left text-xs text-white/70 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus:opacity-100">
      {children}
    </span>
  );
}

export function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-4 text-xs text-white/60">
      <summary className="cursor-pointer select-none text-white/45 hover:text-white">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-white/45">
            <tr>
              {head.map((h) => (
                <th key={h} className="py-1 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
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
