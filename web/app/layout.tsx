import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";

const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ResumeAI — Resume ↔ Job Match Analyzer",
  description:
    "Score how well a resume fits a job description, and see exactly which requirements it misses. Compare a fine-tuned matching model against general-purpose LLMs on the same pair.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${firaSans.variable} ${firaCode.variable} h-full antialiased`}
        suppressHydrationWarning
      >
        <head>
          {/* Set the `.dark` class on <html> before first paint so every route —
              including the marketing page, which has no ThemeToggle — honors a stored
              theme without a flash of the light default. Reads the same "theme" key
              ThemeToggle writes, falling back to the OS preference. Runs synchronously
              during HTML parsing, before React hydrates. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
            }}
          />
        </head>
        <body className="flex min-h-full flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
