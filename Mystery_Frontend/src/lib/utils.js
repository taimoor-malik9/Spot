import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combine clsx and tailwind-merge for optimal Tailwind class merging
 * @param {...any[]} inputs - Class values to merge
 * @returns {string} Merged class string
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
