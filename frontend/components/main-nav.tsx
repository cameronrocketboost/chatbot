'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function MainNav() {
  const pathname = usePathname();
  
  return (
    <div className="flex items-center justify-between w-full">
      <Link href="/" className="flex items-center space-x-1">
        <span className="text-sladen-white font-bold text-xl">SLADEN</span>
        <span className="text-sladen-red font-bold text-xl">/</span>
        <span className="text-sladen-gray font-medium text-xl">CHAT</span>
      </Link>
      
      <div className="flex items-center space-x-8">
        <Link
          href="/"
          className={cn(
            "text-sm font-medium text-sladen-white hover:text-sladen-teal transition-colors uppercase tracking-wide relative",
            pathname === "/" && "after:absolute after:bottom-[-18px] after:left-0 after:right-0 after:h-[3px] after:bg-sladen-teal after:rounded-full"
          )}
        >
          Chat
        </Link>
        <Link
          href="/documents"
          className={cn(
            "text-sm font-medium text-sladen-white hover:text-sladen-teal transition-colors uppercase tracking-wide relative",
            pathname === "/documents" && "after:absolute after:bottom-[-18px] after:left-0 after:right-0 after:h-[3px] after:bg-sladen-teal after:rounded-full"
          )}
        >
          Documents
        </Link>
        <Link
          href="/features"
          className={cn(
            "text-sm font-medium text-sladen-white hover:text-sladen-teal transition-colors uppercase tracking-wide relative",
            pathname === "/features" && "after:absolute after:bottom-[-18px] after:left-0 after:right-0 after:h-[3px] after:bg-sladen-teal after:rounded-full"
          )}
        >
          Features
        </Link>
      </div>
    </div>
  );
} 