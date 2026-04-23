export function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-inset ring-bench-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-bench-700">{label}</p>
      <p className="mt-1 text-sm font-semibold capitalize leading-5">{value}</p>
    </div>
  );
}
