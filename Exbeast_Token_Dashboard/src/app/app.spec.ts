import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ToastService } from './core/toast.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show toasts', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(ToastService).success('Saved');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.toast-success')?.textContent).toContain('Saved');
  });
});
