import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <button type="button" [class]="'toast toast-' + t.kind" (click)="toast.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
})
export class App {
  protected readonly toast = inject(ToastService);
}
