import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "SellPilot | Run your business with clarity", template: "%s | SellPilot" },
  description: "A dependable workspace for managing orders, customers, stock and business finances.",
  applicationName: "SellPilot"
};
export const viewport: Viewport = { themeColor: "#1E293B", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
