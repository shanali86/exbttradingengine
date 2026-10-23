import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiError, ApiService } from '../../core/api.service';
import { Overview, SimplePage, Trade } from '../../core/models';
import { NumPipe, WhenPipe } from '../../shared/format.pipes';

@Component({
  selector: 'app-trades',
  imports: [NumPipe, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="card-head">
        <h2>Latest trades</h2>
        <select class="select-sm" [value]="symbol()" (change)="setSymbol($any($event.target).value)">
          <option value="">All markets</option>
          @for (s of symbols(); track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>
        <button type="button" class="btn btn-ghost btn-sm" (click)="load()">Refresh</button>
      </div>

      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time</th><th>Market</th><th>Side</th><th class="r">Price</th><th class="r">Amount</th><th class="r">Total</th></tr>
          </thead>
          <tbody>
            @for (t of page()?.data ?? []; track t.trade_id) {
              <tr>
                <td>{{ t.created_time | when }}</td>
                <td>{{ t.symbol }}</td>
                <td><span [class.up]="t.side === 'buy'" [class.down]="t.side === 'sell'">{{ t.side ?? '—' }}</span></td>
                <td class="r mono">{{ t.price | num }}</td>
                <td class="r mono">{{ t.size | num }}</td>
                <td class="r mono">{{ t.funds | num: 4 }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">{{ loading() ? 'Loading…' : 'No trades yet' }}</td></tr>
            }
          </tbody>
        </table>
      </div>

      <div class="pager">
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="!page()?.prev_page_url || loading()" (click)="go(pageNo() - 1)">← Newer</button>
        <span class="muted">Page {{ pageNo() }}</span>
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="!page()?.next_page_url || loading()" (click)="go(pageNo() + 1)">Older →</button>
      </div>
    </section>
  `,
})
export class TradesPage {
  private readonly api = inject(ApiService);
  readonly tokenId = input.required<string>();

  protected readonly page = signal<SimplePage<Trade> | null>(null);
  protected readonly pageNo = signal(1);
  protected readonly symbol = signal('');
  protected readonly symbols = signal<string[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const id = this.tokenId();
      untracked(() => {
        this.pageNo.set(1);
        this.symbol.set('');
        void this.load();
        // Market filter options (overview is cached server-side).
        this.api.get<Overview>(`/tokens/${id}/overview`).then(
          (o) => this.symbols.set(o.markets.map((m) => m.symbol)),
          () => undefined,
        );
      });
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.page.set(
        await this.api.get<SimplePage<Trade>>(`/tokens/${this.tokenId()}/trades`, {
          symbol: this.symbol(),
          page: this.pageNo(),
          per_page: 50,
        }),
      );
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.loading.set(false);
    }
  }

  setSymbol(value: string): void {
    this.symbol.set(value);
    this.pageNo.set(1);
    void this.load();
  }

  go(page: number): void {
    this.pageNo.set(Math.max(1, page));
    void this.load();
  }
}
