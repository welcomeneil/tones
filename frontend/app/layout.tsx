import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const animationGateScript = `(function(){var r=document.documentElement,d=false;function f(){if(d)return;d=true;r.setAttribute('data-ready','');}if(document.fonts&&document.fonts.ready){document.fonts.ready.then(f);setTimeout(f,600);}else{f();}})();`;

const cormorant = Cormorant_Garamond({
  weight: ["400", "500"],
  style: ["normal"],
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
});

const dmSans = DM_Sans({
  weight: "variable",
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "tone zone",
  description:
    "A reference tool for artists.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${dmSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: animationGateScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
