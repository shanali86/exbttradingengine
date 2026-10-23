import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../../../environments/environment';
import { ThemeService } from '../../core/theme.service';
import { ThemeToggle } from '../../shared/theme-toggle';

@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth">
      <div class="auth-top"><app-theme-toggle /></div>
      <div class="auth-brand">
        <img class="brand-logo" [src]="theme.isDark() ? 'brand/logo-on-dark.svg' : 'brand/logo-on-light.svg'" [alt]="brand" />
        <span class="brand-tag">Token Dashboard</span>
      </div>
      <section class="card auth-card">
        <router-outlet />
      </section>
      <p class="auth-foot">For projects listed on {{ brand }}. Trading accounts sign in on the exchange.</p>
    </main>
  `,
})
export class AuthLayout {
  protected readonly theme = inject(ThemeService);
  protected readonly brand = environment.brand;
}
