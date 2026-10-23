import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ApiError, ApiService } from '../../core/api.service';
import { ActivityItem, SimplePage } from '../../core/models';
import { WhenPipe } from '../../shared/format.pipes';

@Component({
  selector: 'app-activity',
  imports: [WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="card-head">
        <h2>Activity</h2>
        <small class="muted">What your team did on this token, and the exchange's decisions.</small>
      </div>
      @if (error()) {
        <div class="alert alert-error">{{ error() }}</div>
      }
      <ol class="timeline">
        @for (a of page()?.data ?? []; track a.id) {
          <li>
            <span class="dot"></span>
            <div>
              <div>{{ a.description }}</div>
              <small class="muted">{{ a.by.name }}@if (a.by.email) { · {{ a.by.email }} } · {{ a.created_at | when }}</small>
            </div>
          </li>
        } @empty {
          <li class="empty">{{ loading() ? 'Loading…' : 'No activity yet' }}</li>
        }
      </ol>
      <div class="pager">
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="!page()?.prev_page_url" (click)="go(pageNo() - 1)">← Newer</button>
        <span class="muted">Page {{ pageNo() }}</span>
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="!page()?.next_page_url" (click)="go(pageNo() + 1)">Older →</button>
      </div>
    </section>
  `,
})
export class ActivityPage {
  private readonly api = inject(ApiService);
  readonly tokenId = input.required<string>();

  protected readonly page = signal<SimplePage<ActivityItem> | null>(null);
  protected readonly pageNo = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      this.tokenId();
      untracked(() => {
        this.pageNo.set(1);
        void this.load();
      });
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.page.set(await this.api.get<SimplePage<ActivityItem>>(`/tokens/${this.tokenId()}/activity`, { page: this.pageNo(), per_page: 30 }));
    } catch (e) {
      this.error.set((e as ApiError).message);
    } finally {
      this.loading.set(false);
    }
  }

  go(page: number): void {
    this.pageNo.set(Math.max(1, page));
    void this.load();
  }
}
