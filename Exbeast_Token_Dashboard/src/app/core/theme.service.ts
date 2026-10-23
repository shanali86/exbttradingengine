import { Injectable, computed, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'exbeast-theme';

/**
 * Light / dark / follow-system appearance (same as the admin panel).
 * The resolved theme goes on `<html data-theme>` (styles.scss switches its colour
 * tokens on it); index.html applies the stored choice before Angular boots, so
 * there is no flash of the wrong theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(!!this.media?.matches);

  readonly preference = signal<ThemePreference>(readStored());
  readonly theme = computed<ResolvedTheme>(() => {
    const p = this.preference();
    return p === 'system' ? (this.systemDark() ? 'dark' : 'light') : p;
  });
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    this.media?.addEventListener?.('change', (e) => {
      this.systemDark.set(e.matches);
      this.apply();
    });
    this.apply();
  }

  set(pref: ThemePreference): void {
    this.preference.set(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // storage blocked: keep it for this session only
    }
    this.apply();
  }

  /** Light ↔ dark (leaves "system" mode). */
  toggle(): void {
    this.set(this.isDark() ? 'light' : 'dark');
  }

  private apply(): void {
    document.documentElement.setAttribute('data-theme', this.theme());
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.isDark() ? '#0d0d0d' : '#0a0a0a');
  }
}

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}
