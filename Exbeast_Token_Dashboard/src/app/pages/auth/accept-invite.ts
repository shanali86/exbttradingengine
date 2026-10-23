import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { LoginData, Role, TokenRef } from '../../core/models';
import { LabelPipe, WhenPipe } from '../../shared/format.pipes';
import { PASSWORD_HINT, passwordsMatch, strongPassword } from '../../shared/password-rules';

interface InviteInfo {
  email: string;
  role: Role;
  token: TokenRef;
  expires_at: string;
  account_exists: boolean;
}

@Component({
  selector: 'app-accept-invite',
  imports: [ReactiveFormsModule, LabelPipe, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="loading">Checking invitation…</div>
    } @else if (!invite()) {
      <h1>Invitation</h1>
      <div class="alert alert-error">{{ error() || 'This invitation link is invalid or has expired. Ask for a new invitation.' }}</div>
    } @else {
      @let inv = invite()!;
      <h1>Join {{ inv.token.name }}</h1>
      <div class="invite-box">
        @if (inv.token.icon_url) {
          <img [src]="inv.token.icon_url" alt="" class="token-icon" />
        } @else {
          <span class="token-icon token-icon-fallback">{{ inv.token.symbol.charAt(0) }}</span>
        }
        <div>
          <strong>{{ inv.token.symbol }}</strong> as <span class="badge">{{ inv.role | label }}</span>
          <small class="muted block">{{ inv.email }} · valid until {{ inv.expires_at | when }}</small>
        </div>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      @if (inv.account_exists) {
        <p class="muted">You already have a dashboard account. Enter its password to accept.</p>
        <form [formGroup]="existing" (ngSubmit)="accept()" class="form">
          <label>
            Password
            <input type="password" formControlName="password" autocomplete="current-password" />
          </label>
          <button class="btn btn-primary btn-block" [disabled]="existing.invalid || busy()">{{ busy() ? 'Joining…' : 'Accept invitation' }}</button>
        </form>
      } @else {
        <p class="muted">Create your dashboard account.</p>
        <form [formGroup]="fresh" (ngSubmit)="accept()" class="form">
          <label>
            Your name
            <input formControlName="name" autocomplete="name" />
          </label>
          <label>
            Password
            <input type="password" formControlName="password" autocomplete="new-password" />
            <small [class.error-text]="fresh.controls.password.touched && fresh.controls.password.hasError('weak')">{{ hint }}</small>
          </label>
          <label>
            Confirm password
            <input type="password" formControlName="password_confirmation" autocomplete="new-password" />
            @if (fresh.hasError('mismatch') && fresh.controls.password_confirmation.touched) {
              <small class="error-text">Passwords do not match.</small>
            }
          </label>
          <button class="btn btn-primary btn-block" [disabled]="fresh.invalid || busy()">{{ busy() ? 'Creating…' : 'Create account & join' }}</button>
        </form>
      }
    }
  `,
})
export class AcceptInvitePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** ?token= from the email link. */
  readonly token = input<string>();

  protected readonly hint = PASSWORD_HINT;
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly invite = signal<InviteInfo | null>(null);

  protected readonly existing = this.fb.group({ password: ['', Validators.required] });
  protected readonly fresh = this.fb.group(
    {
      name: ['', [Validators.required, Validators.maxLength(100)]],
      password: ['', [Validators.required, strongPassword]],
      password_confirmation: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.loading.set(false);
      return;
    }
    try {
      this.invite.set(await this.api.post<InviteInfo>('/auth/invite/check', { token }));
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.loading.set(false);
    }
  }

  async accept(): Promise<void> {
    const inv = this.invite();
    if (!inv) {
      return;
    }
    const body = inv.account_exists ? this.existing.getRawValue() : this.fresh.getRawValue();
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await this.api.post<LoginData>('/auth/invite/accept', { token: this.token(), ...body });
      this.auth.start(data);
      await this.router.navigate(['/tokens', inv.token.id, 'overview']);
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
