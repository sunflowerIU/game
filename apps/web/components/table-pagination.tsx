interface TablePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

export function TablePagination({ page, pageSize, totalItems, onPageChange }: Readonly<TablePaginationProps>) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const first = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const last = Math.min(safePage * pageSize, totalItems);
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 text-xs text-slate-400">
    <span>Showing {first}–{last} of {totalItems}</span>
    <div className="flex items-center gap-2">
      <button className="rounded-lg border border-white/10 px-3 py-2 font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35" disabled={safePage === 1} onClick={() => onPageChange(safePage - 1)}>Previous</button>
      <span className="min-w-20 text-center">Page {safePage} of {totalPages}</span>
      <button className="rounded-lg border border-white/10 px-3 py-2 font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35" disabled={safePage === totalPages} onClick={() => onPageChange(safePage + 1)}>Next</button>
    </div>
  </div>;
}

export function pageItems<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
  const safePage = Math.min(page, Math.max(1, Math.ceil(items.length / pageSize)));
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}
