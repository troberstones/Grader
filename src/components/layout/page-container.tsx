export function PageContainer({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 p-6 overflow-auto">{children}</div>;
}
