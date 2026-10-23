import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../../core/api.service';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Forgot password</h1>
    @if (sent()) {
      <div class="alert alert-success">If this email has a dashboard account, a reset link is on its way. It is valid for 60 minutes.</div>
    } @else {
      <p class="muted">We will email you a link to set a new password.</p>
      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>
          Email
          <input type="email" formControlName="email" autocomplete="username" />
        </label>
        <button class="btn btn-primary btn-block" [disabled]="form.invalid || busy()">{{ busy() ? 'Sending…' : 'Send reset link' }}</button>
      </form>
    }
    <div class="auth-links"><a routerLink="/login">Back to sign in</a></div>
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiService);
  protected readonly form = inject(FormBuilder).nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post('/auth/password/forgot', { email: this.form.getRawValue().email.trim() });
      this.sent.set(true);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
