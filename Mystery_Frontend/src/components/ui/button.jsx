'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = (props = {}) => {
  const { variant = 'default', size = 'md' } = props;

  const baseStyles = 'inline-flex items-center justify-center rounded-md font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
  
  const variants = {
    default: 'bg-slate-900 text-slate-50 hover:bg-slate-800',
    destructive: 'bg-red-600 text-slate-50 hover:bg-red-700',
    outline: 'border border-slate-200 bg-white hover:bg-slate-100 text-slate-900',
    secondary: 'bg-slate-200 text-slate-900 hover:bg-slate-300',
    ghost: 'hover:bg-slate-100 hover:text-slate-900 text-slate-900',
    link: 'text-slate-900 underline-offset-4 hover:underline',
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 rounded-md px-3',
    lg: 'h-11 rounded-md px-8',
    icon: 'h-10 w-10',
  };

  return cn(
    baseStyles,
    variants[variant] || variants.default,
    sizes[size] || sizes.default
  );
};

const Button = React.forwardRef(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
