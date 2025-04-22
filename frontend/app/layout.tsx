import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { Toaster } from "@/components/ui/toaster"
import Link from 'next/link';
import { TooltipProvider } from "@/components/ui/tooltip"
import { Sidebar } from '@/components/sidebar';
import { MainNav } from '@/components/main-nav';

import "./globals.css"

export const metadata: Metadata = {
  title: "Sladen Chat",
  description: "Chat with your documents using AI",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${GeistSans.className} flex flex-col min-h-screen bg-slate-50 antialiased`}>
        <TooltipProvider>
          <Toaster />
          <header className="p-4 border-b border-border/30 bg-sladen-navy text-sladen-white sticky top-0 z-50">
            <div className="container max-w-6xl mx-auto">
              <MainNav />
            </div>
          </header>
          <div className="flex flex-1 relative">
            <Sidebar defaultOpen={false} />
            <div className="flex-1">
              {children}
            </div>
          </div>
        </TooltipProvider>
      </body>
    </html>
  )
}