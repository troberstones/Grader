import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { GlobalSyncProvider } from "@/components/shared/global-sync";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` class forces the editorial dark theme throughout
    <html
      lang="en"
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="h-full flex">
        <GlobalSyncProvider>
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
          <Toaster />
        </GlobalSyncProvider>
      </body>
    </html>
  );
}
