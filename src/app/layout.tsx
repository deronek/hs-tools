import type { Metadata } from "next";

import { Footer } from "@/components/footer";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HS Tools",
    template: "%s | HS Tools",
  },
  description: "Tools and calculators for Hypixel SkyBlock.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <TooltipProvider>
          <div className="flex min-h-screen flex-col">
            <main className="flex min-h-0 flex-1 flex-col">{children}</main>
            <Footer />
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
