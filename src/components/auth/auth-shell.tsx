/**
 * The centred single-card layout used by sign-in, first-run setup and
 * invitation acceptance.
 *
 * No sidebar and no navigation on purpose: there is nowhere else to go until
 * you are signed in, and offering links that all bounce back here reads as
 * broken.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-full w-full flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Art Grader</div>
          <h1 className="text-3xl font-semibold tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="bg-card rounded-lg p-6">{children}</div>

        {footer && <div className="mt-6 text-xs leading-relaxed text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

/** Inline error text. Errors here are read while typing, so they stay put. */
export function FormError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive leading-relaxed">
      {children}
    </p>
  );
}
