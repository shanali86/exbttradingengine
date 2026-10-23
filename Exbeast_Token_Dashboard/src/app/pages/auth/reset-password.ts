import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../../core/api.service';
import { PASSWORD_HINT, passwordsMatch, strongPassword } from '../../shared/password-rules';

@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Set a new password</h1>
    @if (!token() || !email()) {
      <div class="alert alert-error">This reset link is incomplete. Open the link from the email again.</div>
    } @else if (done()) {
      <div class="alert alert-success">Password updated. Sign in with your new password.</div>
      <a class="btn btn-primary btn-block" routerLink="/login">Sign in</a>
    } @else {
      <p class="muted">For {{ email() }}</p>
      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="form">
        <label>
          New password
          <input type="password" formControlName="password" autocomplete="new-password" />
          <small [class.error-text]="form.controls.password.touched && form.controls.password.hasError('weak')">{{ hint }}</small>
        </label>
        <label>
          Confirm password
          <input type="password" formControlName="password_confirmation" autocomplete="new-password" />
          @if (form.hasError('mismatch') && form.controls.password_confirmation.touched) {
            <small class="error-text">Passwords do not match.</small>
          }
        </label>
        <button class="btn btn-primary btn-block" [disabled]="form.invalid || busy()">{{ busy() ? 'Saving…' : 'Update password' }}</button>
      </form>
    }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(ApiService);

  readonly token = input<string>();
  readonly email = input<string>();

  protected readonly hint = PASSWORD_HINT;
  protected readonly form = inject(FormBuilder).nonNullable.group(
    {
      password: ['', [Validators.required, strongPassword]],
      password_confirmation: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post('/auth/password/reset', { token: this.token(), email: this.email(), ...this.form.getRawValue() });
      this.done.set(true);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
