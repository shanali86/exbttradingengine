import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { CompactPipe } from './format.pipes';

export interface BarPoint {
  label: string;
  value: number;
}

/** Dependency-free SVG bar chart with a hover tooltip. */
@Component({
  selector: 'app-bar-chart',
  imports: [CompactPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points().length) {
      <div class="chart">
        <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
          @for (g of grid(); track g.y) {
            <line class="chart-grid" x1="0" [attr.x2]="width" [attr.y1]="g.y" [attr.y2]="g.y" />
          }
          @for (b of bars(); track b.label; let i = $index) {
            <rect
              class="chart-bar"
              [class.active]="hover() === i"
              [attr.x]="b.x"
              [attr.y]="b.y"
              [attr.width]="b.w"
              [attr.height]="b.h"
              (mouseenter)="hover.set(i)"
              (mouseleave)="hover.set(null)"
            />
          }
        </svg>
        <div class="chart-axis">
          <span>{{ points()[0].label }}</span>
          <span>{{ points()[points().length - 1].label }}</span>
        </div>
        <div class="chart-scale">{{ max() | compact }}</div>
        @if (hover() !== null) {
          <div class="chart-tip">
            <strong>{{ points()[hover()!].value | compact }}</strong> {{ unit() }}
            <span>{{ points()[hover()!].label }}</span>
          </div>
        }
      </div>
    } @else {
      <div class="empty">No data yet</div>
    }
  `,
})
export class BarChart {
  readonly points = input.required<BarPoint[]>();
  readonly label = input('Chart');
  readonly unit = input('');

  protected readonly width = 600;
  protected readonly height = 180;
  protected readonly hover = signal<number | null>(null);

  protected readonly max = computed(() => Math.max(0, ...this.points().map((p) => p.value)));

  protected readonly bars = computed(() => {
    const pts = this.points();
    const max = this.max() || 1;
    const slot = this.width / Math.max(pts.length, 1);
    const w = Math.max(2, slot * 0.7);
    return pts.map((p, i) => {
      const h = p.value > 0 ? Math.max(2, (p.value / max) * (this.height - 8)) : 0;
      return { label: p.label, x: i * slot + (slot - w) / 2, y: this.height - h, w, h };
    });
  });

  protected readonly grid = computed(() => [0.25, 0.5, 0.75].map((f) => ({ y: this.height * f })));
}
