import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="flex items-start justify-between pb-8">
      <div>
        {/* Editorial headline — generous letter-spacing, no bold border compensation needed */}
        <h2 className="text-2xl font-semibold tracking-tight leading-none">
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 ml-6">{actions}</div>
      )}
    </div>
  );
}
