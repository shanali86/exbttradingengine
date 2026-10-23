import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { SOCIAL_KEYS, SocialKey, TokenProfile } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { LabelPipe } from '../../shared/format.pipes';

const HTTPS = Validators.pattern(/^https:\/\/\S+$/i);

@Component({
  selector: 'app-profile',
  imports: [ReactiveFormsModule, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="alert alert-error">{{ error() }}</div>
    }
    @if (profile(); as p) {
      <form [formGroup]="form" (ngSubmit)="save()">
        <section class="card">
          <div class="card-head">
            <h2>Project profile</h2>
            @if (!canEdit()) {
              <span class="badge badge-soft">Read only</span>
            }
          </div>
          <p class="muted">Shown to traders with {{ p.symbol }}. Changes go live as soon as you save.</p>

          <div class="form grid grid-2">
            <label>
              Token name
              <input formControlName="name" />
            </label>
            <label>
              Logo URL
              <input formControlName="icon_url" placeholder="https://…/logo.png" />
              @if (invalid('icon_url')) { <small class="error-text">Use an https:// link.</small> }
            </label>
            <label class="span-2">
              Description
              <textarea rows="6" formControlName="description" maxlength="5000"></textarea>
              <small class="muted">{{ form.controls.description.value.length }} / 5000</small>
            </label>
            <label>
              Website
              <input formControlName="website_url" placeholder="https://" />
              @if (invalid('website_url')) { <small class="error-text">Use an https:// link.</small> }
            </label>
            <label>
              Whitepaper
              <input formControlName="whitepaper_url" placeholder="https://" />
              @if (invalid('whitepaper_url')) { <small class="error-text">Use an https:// link.</small> }
            </label>
            <label class="span-2">
              Block explorer
              <input formControlName="explorer_url" placeholder="https://" />
              @if (invalid('explorer_url')) { <small class="error-text">Use an https:// link.</small> }
            </label>
          </div>
        </section>

        <section class="card">
          <h2>Social links</h2>
          <div class="form grid grid-2" formGroupName="social_links">
            @for (k of socialKeys; track k) {
              <label>
                {{ k | label }}
                <input [formControlName]="k" placeholder="https://" />
                @if (form.controls.social_links.controls[k].invalid) { <small class="error-text">Use an https:// link.</small> }
              </label>
            }
          </div>
        </section>

        <section class="card">
          <h2>Exchange settings</h2>
          <p class="muted">Changed by the exchange. Ask for a change on the Change requests tab.</p>
          <dl class="facts">
            <div><dt>Symbol</dt><dd>{{ p.symbol }}</dd></div>
            <div><dt>Decimals</dt><dd>{{ p.decimals }}</dd></div>
            <div><dt>Status</dt><dd>{{ p.status | label }}</dd></div>
            <div><dt>Deposits</dt><dd>{{ p.deposit_enabled ? 'Enabled' : 'Disabled' }}</dd></div>
            <div><dt>Withdrawals</dt><dd>{{ p.withdraw_enabled ? 'Enabled' : 'Disabled' }}</dd></div>
          </dl>
        </section>

        @if (canEdit()) {
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="fill(p)" [disabled]="form.pristine || busy()">Discard</button>
            <button class="btn btn-primary" [disabled]="form.invalid || form.pristine || busy()">{{ busy() ? 'Saving…' : 'Save changes' }}</button>
          </div>
        }
      </form>
    } @else if (!error()) {
      <div class="loading">Loading profile…</div>
    }
  `,
})
export class ProfilePage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly tokenId = input.required<string>();

  protected readonly socialKeys = SOCIAL_KEYS;
  protected readonly profile = signal<TokenProfile | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly canEdit = computed(() => this.auth.can(Number(this.tokenId()), 'profile.update'));

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', Validators.maxLength(5000)],
    icon_url: ['', HTTPS],
    website_url: ['', HTTPS],
    whitepaper_url: ['', HTTPS],
    explorer_url: ['', HTTPS],
    social_links: this.fb.group(
      Object.fromEntries(SOCIAL_KEYS.map((k) => [k, new FormControl('', { nonNullable: true, validators: HTTPS })])) as Record<
        SocialKey,
        FormControl<string>
      >,
    ),
  });

  constructor() {
    effect(() => {
      const id = this.tokenId();
      const editable = this.canEdit();
      untracked(() => {
        editable ? this.form.enable() : this.form.disable();
        void this.load(id);
      });
    });
  }

  protected invalid(name: 'icon_url' | 'website_url' | 'whitepaper_url' | 'explorer_url'): boolean {
    return this.form.controls[name].invalid;
  }

  private async load(id: string): Promise<void> {
    this.error.set('');
    try {
      const p = await this.api.get<TokenProfile>(`/tokens/${id}/profile`);
      this.profile.set(p);
      this.fill(p);
    } catch (e) {
      this.error.set((e as ApiError).message);
    }
  }

  protected fill(p: TokenProfile): void {
    this.form.reset({
      name: p.name,
      description: p.description ?? '',
      icon_url: p.icon_url ?? '',
      website_url: p.website_url ?? '',
      whitepaper_url: p.whitepaper_url ?? '',
      explorer_url: p.explorer_url ?? '',
      social_links: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, p.social_links?.[k] ?? ''])),
    });
  }

  async save(): Promise<void> {
    const v = this.form.getRawValue();
    const blank = (s: string) => s.trim() || null;
    this.busy.set(true);
    try {
      const p = await this.api.put<TokenProfile>(`/tokens/${this.tokenId()}/profile`, {
        name: v.name.trim(),
        description: blank(v.description),
        icon_url: blank(v.icon_url),
        website_url: blank(v.website_url),
        whitepaper_url: blank(v.whitepaper_url),
        explorer_url: blank(v.explorer_url),
        social_links: Object.fromEntries(Object.entries(v.social_links).filter(([, url]) => url.trim())),
      });
      this.profile.set(p);
      this.fill(p);
      this.toast.success('Profile saved');
      // Name / logo also show in the sidebar.
      void this.auth.refresh();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }
}
