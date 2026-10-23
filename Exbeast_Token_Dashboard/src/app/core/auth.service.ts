import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { Account, AccountData, LoginData, Membership, Permission } from './models';

const STORAGE_KEY = 'exb_token_owner_session';

interface Session {
  token: string;
  expiresAt: string;
}

/** Login session (bearer token in localStorage) and the account's tokens / roles. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly session = signal<Session | null>(this.readSession());
  readonly account = signal<Account | null>(null);
  readonly memberships = signal<Membership[]>([]);

  readonly isLoggedIn = computed(() => this.session() !== null);
  readonly token = computed(() => this.session()?.token ?? null);

  /** On app start: restore the account behind a stored, unexpired session. */
  async restore(): Promise<void> {
    if (!this.session()) {
      return;
    }
    try {
      this.apply(await this.api.get<AccountData>('/auth/me'));
    } catch {
      this.clear();
    }
  }

  async login(email: string, password: string, google2faCode?: string): Promise<void> {
    const data = await this.api.post<LoginData>('/auth/login', {
      email,
      password,
      google2fa_code: google2faCode || undefined,
    });
    this.start(data);
  }

  /** Invite accepted / any response that logs in. */
  start(data: LoginData): void {
    const session = { token: data.token, expiresAt: data.expires_at };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
    this.apply(data);
  }

  async refresh(): Promise<void> {
    this.apply(await this.api.get<AccountData>('/auth/me'));
  }

  async logout(): Promise<void> {
    try {
      await this.api.post('/auth/logout');
    } catch {
      // the session ends locally either way
    }
    this.clear();
    await this.router.navigate(['/login']);
  }

  /** Session is no longer valid (401): forget it and go to login. */
  expire(): void {
    if (!this.session()) {
      return;
    }
    this.clear();
    void this.router.navigate(['/login'], { queryParams: { expired: 1 } });
  }

  membership(tokenId: number): Membership | undefined {
    return this.memberships().find((m) => m.token.id === tokenId);
  }

  can(tokenId: number, permission: Permission): boolean {
    return this.membership(tokenId)?.permissions.includes(permission) ?? false;
  }

  private apply(data: AccountData): void {
    this.account.set(data.account);
    this.memberships.set(data.tokens);
  }

  private clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    this.account.set(null);
    this.memberships.set([]);
  }

  private readSession(): Session | null {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Session | null;
      if (s?.token && new Date(s.expiresAt).getTime() > Date.now()) {
        return s;
      }
    } catch {
      // corrupt value
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
