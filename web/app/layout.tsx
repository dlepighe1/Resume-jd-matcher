import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume matcher: scoring, benchmark, and evidence",
  description:
    "Interactive demo and held-out benchmark for a fine-tuned sentence-transformer that scores how well a resume fits a job posting. Compare it against a frontier language model, the same architecture before training, and a non-neural baseline.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applied before paint so a dark-mode visitor never sees a white flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
