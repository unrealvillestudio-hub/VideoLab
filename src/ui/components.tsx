import React, { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Panel = ({ children, className }: { children: ReactNode, className?: string }) => (
  <div className={cn("uv-panel p-4", className)}>
    {children}
  </div>
);

export const Button = ({ children, className, variant = 'primary', ...props }: any) => (
  <button 
    className={cn(
      "px-4 py-2 rounded-md font-medium transition-all active:scale-95 disabled:opacity-50",
      variant === 'primary' ? "bg-blue-600 hover:bg-blue-500 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

export const IconButton = ({ icon: Icon, className, ...props }: any) => (
  <button 
    className={cn("p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors", className)}
    {...props}
  >
    <Icon size={18} />
  </button>
);
