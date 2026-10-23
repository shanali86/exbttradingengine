import { Pipe, PipeTransform } from '@angular/core';

/** 1234.5678 -> "1,234.5678" (up to `max` decimals, trailing zeros dropped). */
@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform(value: number | string | null | undefined, max = 8): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return '—';
    }
    return n.toLocaleString('en-US', { maximumFractionDigits: max });
  }
}

/** 1234567 -> "1.23M". */
@Pipe({ name: 'compact' })
export class CompactPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) {
      return '—';
    }
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
  }
}

/** ISO string or epoch ms -> "Oct 20, 2026, 14:05". */
@Pipe({ name: 'when' })
export class WhenPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
}

/** "market_settings" -> "Market settings". */
@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const s = value.replace(/[_.]/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
