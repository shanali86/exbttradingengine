import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ApiError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ThemePreference, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { WhenPipe } from '../../shared/format.pipes';
import { PASSWORD_HINT, passwordsMatch, strongPassword } from '../../shared/password-rules';

@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head"><h1>Account &amp; security</h1></div>

    @if (auth.account(); as a) {
      <section class="card">
        <h2>Profile</h2>
        <dl class="facts">
          <div><dt>Name</dt><dd>{{ a.name }}</dd></div>
          <div><dt>Email</dt><dd>{{ a.email }}</dd></div>
          <div><dt>Last sign-in</dt><dd>{{ a.last_login_at | when }}</dd></div>
        </dl>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Appearance</h2>
          <div class="seg" role="radiogroup" aria-label="Theme">
            @for (o of themeOptions; track o.value) {
              <button type="button" role="radio" [attr.aria-checked]="theme.preference() === o.value" [class.active]="theme.preference() === o.value" (click)="theme.set(o.value)">
                {{ o.label }}
              </button>
            }
          </div>
        </div>
        <p class="muted small">System follows your device's light / dark setting.</p>
      </section>

      <section class="card">
        <h2>Change password</h2>
        <p class="muted">Other devices are signed out; this one stays signed in.</p>
        <form [formGroup]="pw" (ngSubmit)="changePassword()" class="form narrow">
          <label>
            Current password
            <input type="password" formControlName="current_password" autocomplete="current-password" />
          </label>
          <label>
            New password
            <input type="password" formControlName="password" autocomplete="new-password" />
            <small [class.error-text]="pw.controls.password.touched && pw.controls.password.hasError('weak')">{{ hint }}</small>
          </label>
          <label>
            Confirm new password
            <input type="password" formControlName="password_confirmation" autocomplete="new-password" />
            @if (pw.hasError('mismatch') && pw.controls.password_confirmation.touched) {
              <small class="error-text">Passwords do not match.</small>
            }
          </label>
          <div class="actions"><button class="btn btn-primary" [disabled]="pw.invalid || busy()">Update password</button></div>
        </form>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Google Authenticator</h2>
          <span class="badge" [class.badge-ok]="a.google2fa_enabled">{{ a.google2fa_enabled ? 'On' : 'Off' }}</span>
        </div>

        @if (a.google2fa_enabled) {
          <p class="muted">A code from the app is asked at every sign-in. To turn it off, confirm with your password and a code.</p>
          <form [formGroup]="off" (ngSubmit)="disable2fa()" class="form narrow">
            <label>Password <input type="password" formControlName="password" autocomplete="current-password" /></label>
            <label>Code <input inputmode="numeric" maxlength="6" formControlName="google2fa_code" autocomplete="one-time-code" /></label>
            <div class="actions"><button class="btn btn-danger" [disabled]="off.invalid || busy()">Turn off</button></div>
          </form>
        } @else if (setup(); as s) {
          <p class="muted">Scan the QR code with Google Authenticator (or enter the key), then type the 6-digit code.</p>
          <div class="twofa">
            <img [src]="s.qr" alt="QR code" width="180" height="180" />
            <div class="form narrow">
              <label>Key <input [value]="s.secret" readonly /></label>
              <form [formGroup]="on" (ngSubmit)="enable2fa()" class="form">
                <label>Code <input inputmode="numeric" maxlength="6" formControlName="google2fa_code" autocomplete="one-time-code" /></label>
                <div class="actions"><button class="btn btn-primary" [disabled]="on.invalid || busy()">Turn on</button></div>
              </form>
            </div>
          </div>
        } @else {
          <p class="muted">Protect your account with a second step at sign-in.</p>
          <button type="button" class="btn btn-primary" (click)="start2fa()" [disabled]="busy()">Set up</button>
        }
      </section>
    }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly hint = PASSWORD_HINT;
  protected readonly busy = signal(false);
  protected readonly setup = signal<{ qr: SafeUrl; secret: string } | null>(null);

  protected readonly pw = this.fb.group(
    {
      current_password: ['', Validators.required],
      password: ['', [Validators.required, strongPassword]],
      password_confirmation: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );
  protected readonly on = this.fb.group({ google2fa_code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]] });
  protected readonly off = this.fb.group({
    password: ['', Validators.required],
    google2fa_code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  async changePassword(): Promise<void> {
    await this.run(async () => {
      await this.api.post('/auth/password/change', this.pw.getRawValue());
      this.pw.reset();
      this.toast.success('Password changed');
    });
  }

  async start2fa(): Promise<void> {
    await this.run(async () => {
      const d = await this.api.post<{ secret_key: string; qrcode_url: string }>('/auth/2fa/setup');
      // Backend-generated data:image/svg+xml QR code.
      this.setup.set({ qr: this.sanitizer.bypassSecurityTrustUrl(d.qrcode_url), secret: d.secret_key });
    });
  }

  async enable2fa(): Promise<void> {
    await this.run(async () => {
      await this.api.post('/auth/2fa/enable', this.on.getRawValue());
      this.setup.set(null);
      this.on.reset();
      await this.auth.refresh();
      this.toast.success('Google Authenticator is on');
    });
  }

  async disable2fa(): Promise<void> {
    await this.run(async () => {
      await this.api.post('/auth/2fa/disable', this.off.getRawValue());
      this.off.reset();
      await this.auth.refresh();
      this.toast.success('Google Authenticator is off');
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
