import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Sign in</h1>
    <p class="muted">Manage your listed token.</p>

    @if (expired()) {
      <div class="alert alert-info">Your session ended. Please sign in again.</div>
    }
    @if (error()) {
      <div class="alert alert-error">{{ error() }}</div>
    }

    <form [formGroup]="form" (ngSubmit)="submit()" class="form">
      <label>
        Email
        <input type="email" formControlName="email" autocomplete="username" />
      </label>
      <label>
        Password
        <input type="password" formControlName="password" autocomplete="current-password" />
      </label>
      @if (needsCode()) {
        <label>
          Google Authenticator code
          <input inputmode="numeric" maxlength="6" formControlName="code" autocomplete="one-time-code" placeholder="123456" />
        </label>
      }
      <button class="btn btn-primary btn-block" [disabled]="form.invalid || busy()">
        {{ busy() ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <div class="auth-links">
      <a routerLink="/forgot-password">Forgot password?</a>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query params (?next=/tokens/3/team, ?expired=1). */
  readonly next = input<string>();
  readonly expired = input<string>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    code: [''],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly needsCode = signal(false);

  async submit(): Promise<void> {
    const { email, password, code } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(email.trim(), password, code.trim());
      const next = this.next();
      await this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : '/tokens');
    } catch (e) {
      const err = e as ApiError;
      if ((err.data as { google2fa_required?: boolean } | null)?.google2fa_required) {
        this.needsCode.set(true);
        this.error.set('Enter the 6-digit code from Google Authenticator.');
      } else {
        this.error.set(err.message);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
