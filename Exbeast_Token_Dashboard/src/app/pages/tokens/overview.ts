import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiError, ApiService } from '../../core/api.service';
import { ChartDay, Overview } from '../../core/models';
import { BarChart } from '../../shared/bar-chart';
import { CompactPipe, LabelPipe, NumPipe, WhenPipe } from '../../shared/format.pipes';

type Metric = 'quote_volume' | 'volume' | 'trades';

const REFRESH_MS = 60_000;

@Component({
  selector: 'app-overview',
  imports: [BarChart, NumPipe, CompactPipe, LabelPipe, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="alert alert-error">{{ error() }} <button class="btn btn-ghost btn-sm" (click)="load()">Retry</button></div>
    }

    @if (data(); as d) {
      <div class="kpis">
        <div class="card kpi">
          <span>24h volume</span>
          <strong>{{ d.summary.quote_volume_24h_usdt | compact }} <small>USDT</small></strong>
          <small class="muted">{{ d.summary.volume_24h | compact }} {{ d.token.symbol }}</small>
        </div>
        <div class="card kpi">
          <span>24h trades</span>
          <strong>{{ d.summary.trades_24h | num: 0 }}</strong>
          <small class="muted">{{ d.summary.trades_total | num: 0 }} all time</small>
        </div>
        <div class="card kpi">
          <span>Holders on {{ brand }}</span>
          <strong>{{ d.summary.holders | num: 0 }}</strong>
          <small class="muted">{{ d.summary.held_on_exchange | compact }} {{ d.token.symbol }} held</small>
        </div>
        <div class="card kpi">
          <span>All-time volume</span>
          <strong>{{ d.summary.quote_volume_total | compact }} <small>USDT</small></strong>
          <small class="muted">{{ d.summary.markets_trading }} / {{ d.summary.markets }} markets trading</small>
        </div>
      </div>

      <section class="card">
        <div class="card-head">
          <h2>Daily activity</h2>
          <div class="seg">
            @for (m of metrics; track m.key) {
              <button type="button" [class.active]="metric() === m.key" (click)="metric.set(m.key)">{{ m.label }}</button>
            }
          </div>
          <select class="select-sm" [value]="days()" (change)="setDays($any($event.target).value)">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <app-bar-chart [points]="points()" [label]="metricLabel()" [unit]="metricUnit()" />
      </section>

      <section class="card">
        <div class="card-head">
          <h2>Markets</h2>
          <small class="muted">Updated {{ d.generated_at | when }}</small>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Market</th><th>Status</th><th class="r">Last price</th><th class="r">24h change</th>
                <th class="r">24h high / low</th><th class="r">24h volume</th><th class="r">Trades</th><th class="r">Best bid / ask</th>
              </tr>
            </thead>
            <tbody>
              @for (m of d.markets; track m.id) {
                <tr>
                  <td><strong>{{ m.symbol }}</strong></td>
                  <td><span class="badge" [class]="'badge status-' + m.status">{{ m.status | label }}</span></td>
                  <td class="r mono">{{ m.last_price | num }}</td>
                  <td class="r mono" [class.up]="(m.change_24h_pct ?? 0) > 0" [class.down]="(m.change_24h_pct ?? 0) < 0">
                    {{ m.change_24h_pct === null ? '—' : (m.change_24h_pct > 0 ? '+' : '') + m.change_24h_pct + '%' }}
                  </td>
                  <td class="r mono">{{ m.high_24h | num }} / {{ m.low_24h | num }}</td>
                  <td class="r mono">{{ m.quote_volume_24h | compact }} {{ m.quote }}</td>
                  <td class="r mono">{{ m.trades_24h | num: 0 }}</td>
                  <td class="r mono">
                    @if (m.engine.reachable) {
                      {{ m.engine.best_bid | num }} / {{ m.engine.best_ask | num }}
                    } @else {
                      <span class="muted">offline</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="empty">No markets yet. The exchange creates them.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (!error()) {
      <div class="loading">Loading overview…</div>
    }
  `,
})
export class OverviewPage {
  private readonly api = inject(ApiService);
  readonly tokenId = input.required<string>();

  protected readonly brand = environment.brand;
  protected readonly data = signal<Overview | null>(null);
  protected readonly chart = signal<ChartDay[]>([]);
  protected readonly error = signal('');
  protected readonly days = signal(30);
  protected readonly metric = signal<Metric>('quote_volume');
  protected readonly metrics: { key: Metric; label: string }[] = [
    { key: 'quote_volume', label: 'Volume (USDT)' },
    { key: 'volume', label: 'Volume (token)' },
    { key: 'trades', label: 'Trades' },
  ];

  protected readonly points = computed(() =>
    this.chart().map((d) => ({ label: d.date, value: Number(d[this.metric()]) || 0 })),
  );
  protected readonly metricLabel = computed(() => this.metrics.find((m) => m.key === this.metric())!.label);
  protected readonly metricUnit = computed(() =>
    this.metric() === 'trades' ? 'trades' : this.metric() === 'quote_volume' ? 'USDT' : this.data()?.token.symbol ?? '',
  );

  constructor() {
    effect(() => {
      this.tokenId();
      untracked(() => {
        this.data.set(null);
        void this.load();
      });
    });
    const timer = setInterval(() => void this.load(true), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async load(quiet = false): Promise<void> {
    const id = this.tokenId();
    if (!quiet) {
      this.error.set('');
    }
    try {
      const [overview, chart] = await Promise.all([
        this.api.get<Overview>(`/tokens/${id}/overview`),
        this.api.get<ChartDay[]>(`/tokens/${id}/chart`, { days: this.days() }),
      ]);
      this.data.set(overview);
      this.chart.set(chart);
      this.error.set('');
    } catch (e) {
      if (!quiet) {
        this.error.set((e as ApiError).message);
      }
    }
  }

  async setDays(value: string): Promise<void> {
    this.days.set(Number(value));
    try {
      this.chart.set(await this.api.get<ChartDay[]>(`/tokens/${this.tokenId()}/chart`, { days: this.days() }));
    } catch (e) {
      this.error.set((e as ApiError).message);
    }
  }
}
