'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
  title?: string;
  message: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ title = 'Error', message }) => {
  if (!message) return null;

  return (
    <div className="p-4 border-t border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300">
      <div className="flex items-center gap-2 max-w-3xl mx-auto">
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}; 