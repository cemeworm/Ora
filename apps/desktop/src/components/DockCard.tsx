import type { ReactNode } from "react";

export function DockCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-white p-3 text-xs leading-5 text-bench-700 shadow-sm ring-1 ring-inset ring-bench-200">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bench-900">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
