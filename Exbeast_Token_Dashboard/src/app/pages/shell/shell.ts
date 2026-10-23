import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { LabelPipe } from '../../shared/format.pipes';
import { ThemeToggle } from '../../shared/theme-toggle';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LabelPipe, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.nav-open]="navOpen()">
      <aside class="sidebar">
        <a routerLink="/tokens" class="sidebar-brand" [attr.aria-label]="brand + ' token dashboard'">
          <img src="brand/logo-on-dark.svg" [alt]="brand" class="brand-logo" />
          <span class="brand-tag">Token</span>
        </a>

        <div class="sidebar-section">My tokens</div>
        <nav class="sidebar-nav">
          @for (m of auth.memberships(); track m.token.id) {
            <a [routerLink]="['/tokens', m.token.id]" routerLinkActive="active">
              @if (m.token.icon_url) {
                <img [src]="m.token.icon_url" alt="" class="token-icon sm" />
              } @else {
                <span class="token-icon sm token-icon-fallback">{{ m.token.symbol.charAt(0) }}</span>
              }
              <span class="grow">{{ m.token.symbol }}</span>
              <span class="badge badge-soft">{{ m.role | label }}</span>
            </a>
          } @empty {
            <span class="muted pad">No tokens yet</span>
          }
        </nav>

        <div class="sidebar-section">Account</div>
        <nav class="sidebar-nav">
          <a routerLink="/account" routerLinkActive="active">Account &amp; security</a>
        </nav>
      </aside>

      <div class="main">
        <header class="topbar">
          <button type="button" class="btn btn-ghost menu-btn" (click)="navOpen.set(!navOpen())" aria-label="Menu">☰</button>
          <div class="grow"></div>
          <app-theme-toggle />
          @if (auth.account(); as a) {
            <div class="user">
              <span class="avatar">{{ a.name.charAt(0).toUpperCase() }}</span>
              <span class="user-meta"><strong>{{ a.name }}</strong><small>{{ a.email }}</small></span>
            </div>
          }
          <button type="button" class="btn btn-ghost" (click)="auth.logout()">Sign out</button>
        </header>
        <main class="content">
          <router-outlet />
        </main>
      </div>
      <div class="backdrop" (click)="navOpen.set(false)"></div>
    </div>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly brand = environment.brand;
  protected readonly navOpen = signal(false);

  constructor() {
    // Close the mobile menu after navigating.
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe(() => this.navOpen.set(false));
  }
}
