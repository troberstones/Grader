import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentAccount } from "@/actions/auth";
import { needsBootstrap } from "@/lib/auth/session";
import { isPublicRoute } from "@/lib/auth-routes";
import { PATHNAME_HEADER } from "@/proxy";
import { GlobalSyncProvider } from "@/components/shared/global-sync";
import { SessionModeProvider } from "@/components/shared/session-mode";
import "./globals.css";

// Manrope: contemporary sans-serif balancing geometric precision with human warmth
const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Art Grader",
  description: "Rubric-based grading for digital art and 3D render assignments",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Null on the sign-in, setup and invitation pages, where the sidebar hides
  // itself anyway. Read here rather than per-page so every route agrees about
  // who is signed in.
  const account = await currentAccount();

  // The real gate. The proxy only checks that a session cookie is *present*,
  // which a stale or forged one also satisfies; this checks that it names a
  // live session belonging to an active account. Enforcing it in the root
  // layout covers every page at once rather than waiting for a guard to be
  // added to each of them one at a time.
  //
  // API routes are not covered — they sit outside the proxy matcher and outside
  // this layout. See docs/security.md.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "/";
  if (!isPublicRoute(pathname) && !account) {
    redirect(await needsBootstrap() ? "/setup" : "/login");
  }

  return (
    // `dark` class forces the editorial dark theme throughout
    <html
      lang="en"
      className={`${manrope.variable} ${geistMono.variable} h-dvh antialiased dark`}
    >
      <body className="h-dvh flex">
        <SessionModeProvider mode={account?.mode ?? "grade"}>
          <GlobalSyncProvider>
            <Sidebar account={account} />
            <main className="flex-1 overflow-auto">{children}</main>
            <Toaster />
          </GlobalSyncProvider>
        </SessionModeProvider>
      </body>
    </html>
  );
}
