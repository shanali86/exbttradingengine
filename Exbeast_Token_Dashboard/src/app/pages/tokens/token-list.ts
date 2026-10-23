import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { LabelPipe } from '../../shared/format.pipes';

@Component({
  selector: 'app-token-list',
  imports: [RouterLink, LabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <div>
        <h1>My tokens</h1>
        <p class="muted">Tokens your account manages on the exchange.</p>
      </div>
    </div>

    @if (auth.memberships().length) {
      <div class="grid grid-3">
        @for (m of auth.memberships(); track m.token.id) {
          <a class="card token-card" [routerLink]="['/tokens', m.token.id, 'overview']">
            @if (m.token.icon_url) {
              <img [src]="m.token.icon_url" alt="" class="token-icon lg" />
            } @else {
              <span class="token-icon lg token-icon-fallback">{{ m.token.symbol.charAt(0) }}</span>
            }
            <div class="grow">
              <strong>{{ m.token.name }}</strong>
              <small class="muted block">{{ m.token.symbol }}</small>
            </div>
            <span class="badge">{{ m.role | label }}</span>
          </a>
        }
      </div>
    } @else {
      <div class="card empty">
        Your account has no tokens yet. The exchange or your project's owner can give you access.
      </div>
    }
  `,
})
export class TokenListPage implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    // Only one token: go straight to it.
    const list = this.auth.memberships();
    if (list.length === 1) {
      void this.router.navigate(['/tokens', list[0].token.id, 'overview'], { replaceUrl: true });
    }
  }
}
