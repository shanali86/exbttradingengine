import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ApiError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ChangeRequest, MarketStats, Overview, Page, RequestStatus, RequestType } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { LabelPipe, WhenPipe } from '../../shared/format.pipes';

const SETTING_FIELDS = ['tick_size', 'lot_size', 'min_size', 'max_size', 'min_funds', 'price_band_bps'] as const;
type SettingField = (typeof SETTING_FIELDS)[number];

const HELP: Record<SettingField, string> = {
  tick_size: 'Price step',
  lot_size: 'Amount step',
  min_size: 'Minimum amount',
  max_size: 'Maximum amount (0 = none)',
  min_funds: 'Minimum order value',
  price_band_bps: 'Price band (bps, 0 = off)',
};

@Component({
  selector: 'app-requests',
  imports: [ReactiveFormsModule, LabelPipe, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canCreate()) {
      <section class="card">
        <div class="card-head">
          <h2>New change request</h2>
        </div>
        <p class="muted">Market and token settings change only after the exchange approves. You get an email with the decision.</p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <div class="grid grid-2">
            <label>
              What to change
              <select formControlName="type">
                <option value="market_settings">Market trading rules</option>
                <option value="market_status">Market status (pause / resume)</option>
                <option value="token_settings">Deposits / withdrawals</option>
              </select>
            </label>
            @if (form.controls.type.value !== 'token_settings') {
              <label>
                Market
                <select formControlName="market_id">
                  <option [ngValue]="null" disabled>Choose a market</option>
                  @for (m of markets(); track m.id) {
                    <option [ngValue]="m.id">{{ m.symbol }} ({{ m.status | label }})</option>
                  }
                </select>
              </label>
            }
          </div>

          @switch (form.controls.type.value) {
            @case ('market_settings') {
              <div class="grid grid-3" formGroupName="settings">
                @for (f of settingFields; track f) {
                  <label>
                    {{ help[f] }}
                    <input type="number" step="any" min="0" [formControlName]="f" [placeholder]="current(f)" />
                    <small class="muted">Now: {{ current(f) || '—' }}</small>
                  </label>
                }
              </div>
              <small class="muted">Leave a field empty to keep it as it is.</small>
            }
            @case ('market_status') {
              <label>
                New status
                <select formControlName="status">
                  <option value="trading">Trading</option>
                  <option value="halted">Halted (paused)</option>
                  <option value="cancel_only">Cancel only</option>
                  <option value="post_only">Post only</option>
                </select>
              </label>
            }
            @case ('token_settings') {
              <div class="grid grid-2">
                <label class="check"><input type="checkbox" formControlName="deposit_enabled" /> Deposits enabled</label>
                <label class="check"><input type="checkbox" formControlName="withdraw_enabled" /> Withdrawals enabled</label>
              </div>
            }
          }

          <label>
            Reason (optional)
            <textarea rows="3" formControlName="reason" maxlength="2000" placeholder="Why do you need this change?"></textarea>
          </label>
          <div class="actions">
            <button class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send request' }}</button>
          </div>
        </form>
      </section>
    }

    <section class="card">
      <div class="card-head">
        <h2>Requests</h2>
        <select class="select-sm" [value]="status()" (change)="setStatus($any($event.target).value)">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }
      <div class="list">
        @for (r of page()?.data ?? []; track r.id) {
          <article class="list-item">
            <div class="list-main">
              <div class="row">
                <strong>{{ r.type | label }}</strong>
                @if (r.market) { <span class="muted">{{ r.market.symbol }}</span> }
                <span [class]="'badge req-' + r.status">{{ r.status | label }}</span>
              </div>
              <ul class="changes">
                @for (c of entries(r); track c.key) {
                  <li><span class="muted">{{ c.key | label }}:</span> {{ show(c.from) }} → <strong>{{ show(c.to) }}</strong></li>
                }
              </ul>
              @if (r.reason) { <p class="muted small">“{{ r.reason }}”</p> }
              @if (r.admin_note) { <p class="note"><strong>Exchange:</strong> {{ r.admin_note }}</p> }
              <small class="muted">By {{ r.requester?.name ?? 'removed member' }} · {{ r.created_at | when }}
                @if (r.reviewed_at) { · reviewed {{ r.reviewed_at | when }} }
              </small>
            </div>
            @if (r.status === 'pending' && canCreate()) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="cancel(r)">Cancel</button>
            }
          </article>
        } @empty {
          <div class="empty">{{ loading() ? 'Loading…' : 'No requests yet' }}</div>
        }
      </div>
      @if ((page()?.last_page ?? 1) > 1) {
        <div class="pager">
          <button type="button" class="btn btn-ghost btn-sm" [disabled]="pageNo() <= 1" (click)="go(pageNo() - 1)">← Previous</button>
          <span class="muted">Page {{ pageNo() }} of {{ page()?.last_page }}</span>
          <button type="button" class="btn btn-ghost btn-sm" [disabled]="pageNo() >= (page()?.last_page ?? 1)" (click)="go(pageNo() + 1)">Next →</button>
        </div>
      }
    </section>
  `,
})
export class RequestsPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  readonly tokenId = input.required<string>();

  protected readonly settingFields = SETTING_FIELDS;
  protected readonly help = HELP;
  protected readonly page = signal<Page<ChangeRequest> | null>(null);
  protected readonly pageNo = signal(1);
  protected readonly status = signal<RequestStatus | ''>('');
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly overview = signal<Overview | null>(null);
  protected readonly markets = computed<MarketStats[]>(() => (this.overview()?.markets ?? []).filter((m) => m.status !== 'delisted'));
  protected readonly canCreate = computed(() => this.auth.can(Number(this.tokenId()), 'requests.create'));

  protected readonly form = this.fb.group({
    type: this.fb.nonNullable.control<RequestType>('market_settings'),
    market_id: this.fb.control<number | null>(null),
    settings: this.fb.group(Object.fromEntries(SETTING_FIELDS.map((f) => [f, this.fb.control<string | null>(null)]))),
    status: this.fb.nonNullable.control('halted'),
    deposit_enabled: this.fb.nonNullable.control(true),
    withdraw_enabled: this.fb.nonNullable.control(true),
    reason: this.fb.nonNullable.control(''),
  });

  constructor() {
    effect(() => {
      const id = this.tokenId();
      untracked(() => {
        this.pageNo.set(1);
        void this.load();
        this.api.get<Overview>(`/tokens/${id}/overview`).then(
          (o) => {
            this.overview.set(o);
            this.form.patchValue({ deposit_enabled: o.token.deposit_enabled, withdraw_enabled: o.token.withdraw_enabled });
            if (o.markets.length === 1) {
              this.form.patchValue({ market_id: o.markets[0].id });
            }
          },
          () => undefined,
        );
      });
    });
  }

  protected current(field: SettingField): string {
    const m = this.markets().find((x) => x.id === this.form.controls.market_id.value);
    const v = m?.rules[field];
    return v === undefined || v === null ? '' : String(Number(v));
  }

  protected entries(r: ChangeRequest) {
    return Object.entries(r.changes).map(([key, to]) => ({ key, to, from: r.previous?.[key] ?? null }));
  }

  protected show(v: unknown): string {
    if (typeof v === 'boolean') {
      return v ? 'On' : 'Off';
    }
    if (v === null || v === undefined || v === '') {
      return '—';
    }
    const n = Number(v);
    return Number.isFinite(n) && typeof v !== 'boolean' && String(v).trim() !== '' ? String(n) : String(v);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.page.set(
        await this.api.get<Page<ChangeRequest>>(`/tokens/${this.tokenId()}/change-requests`, {
          status: this.status(),
          page: this.pageNo(),
          per_page: 20,
        }),
      );
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.loading.set(false);
    }
  }

  setStatus(value: RequestStatus | ''): void {
    this.status.set(value);
    this.pageNo.set(1);
    void this.load();
  }

  go(page: number): void {
    this.pageNo.set(page);
    void this.load();
  }

  async submit(): Promise<void> {
    const v = this.form.getRawValue();
    let changes: Record<string, unknown>;
    if (v.type === 'market_settings') {
      changes = Object.fromEntries(Object.entries(v.settings).filter(([, x]) => x !== null && String(x).trim() !== ''));
    } else if (v.type === 'market_status') {
      changes = { status: v.status };
    } else {
      changes = { deposit_enabled: v.deposit_enabled, withdraw_enabled: v.withdraw_enabled };
    }
    if (v.type !== 'token_settings' && !v.market_id) {
      this.toast.error('Choose a market.');
      return;
    }
    if (!Object.keys(changes).length) {
      this.toast.error('Enter at least one new value.');
      return;
    }

    this.busy.set(true);
    try {
      await this.api.post(`/tokens/${this.tokenId()}/change-requests`, {
        type: v.type,
        market_id: v.type === 'token_settings' ? undefined : v.market_id,
        changes,
        reason: v.reason.trim() || undefined,
      });
      this.toast.success('Request sent to the exchange for review');
      this.form.controls.settings.reset();
      this.form.controls.reason.reset();
      this.pageNo.set(1);
      void this.load();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(r: ChangeRequest): Promise<void> {
    if (!confirm('Cancel this request?')) {
      return;
    }
    try {
      await this.api.post(`/tokens/${this.tokenId()}/change-requests/${r.id}/cancel`);
      this.toast.success('Request cancelled');
      void this.load();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }
}
