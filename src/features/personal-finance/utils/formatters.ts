/**
 * Utility functions for currency and date formatting
 */

export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(amount) + ' ₫';
}

export function formatNumberVi(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function parseNumberVi(str: string): number {
  if (!str) return 0;
  // Remove dots, spaces, and non-digit characters except minus
  const cleaned = str.replace(/[^\d-]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}
