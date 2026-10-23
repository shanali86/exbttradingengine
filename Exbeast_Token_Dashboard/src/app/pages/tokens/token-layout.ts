import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Permission } from '../../core/models';
import { LabelPipe } from '../../shared/format.pipes';

interface Tab {
  path: string;
  label: string;
  permission: Permission;
}

const TABS: Tab[] = [
  { path: 'overview', label: 'Overview', permission: 'analytics.view' },
  { path: 'trades', label: 'Trades', permission: 'analytics.view' },
  { path: 'profile', label: 'Project profile', permission: 'analytics.view' },
  { path: 'requests', label: 'Change requests', permission: 'analytics.view' },
  { path: 'team', label: 'Team', permission: 'team.view' },
  { path: 'activity', label: 'Activity', permission: 'activity.view' },
];

@Component({
  selector: 'app-token-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (member(); as m) {
      <div class="token-head">
        @if (m.token.icon_url) {
          <img [src]="m.token.icon_url" alt="" class="token-icon lg" />
        } @else {
          <span class="token-icon lg token-icon-fallback">{{ m.token.symbol.charAt(0) }}</span>
        }
        <div class="grow">
          <h1>{{ m.token.name }} <span class="muted">{{ m.token.symbol }}</span></h1>
          <span class="badge">{{ m.role | label }}</span>
          @if (m.token.status !== 'active') {
            <span class="badge badge-warn">{{ m.token.status | label }}</span>
          }
        </div>
      </div>
      <nav class="tabs">
        @for (t of tabs(); track t.path) {
          <a [routerLink]="t.path" routerLinkActive="active">{{ t.label }}</a>
        }
      </nav>
      <router-outlet />
    }
  `,
})
export class TokenLayout {
  private readonly auth = inject(AuthService);
  readonly tokenId = input.required<string>();

  protected readonly member = computed(() => this.auth.membership(Number(this.tokenId())));
  protected readonly tabs = computed(() => {
    const perms = this.member()?.permissions ?? [];
    return TABS.filter((t) => perms.includes(t.permission));
  });
}
