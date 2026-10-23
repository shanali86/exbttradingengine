import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiError, ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PendingInvite, Role, Team, TeamMember } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { LabelPipe, WhenPipe } from '../../shared/format.pipes';

@Component({
  selector: 'app-team',
  imports: [ReactiveFormsModule, LabelPipe, WhenPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canManage()) {
      <section class="card">
        <h2>Invite a team member</h2>
        <p class="muted">An existing dashboard account gets access at once. Other emails get an invitation link, valid for 7 days.</p>
        <form [formGroup]="form" (ngSubmit)="invite()" class="inline-form">
          <input type="email" formControlName="email" placeholder="name@project.io" aria-label="Email" />
          <select formControlName="role" aria-label="Role">
            <option value="manager">Manager</option>
            <option value="analyst">Analyst</option>
          </select>
          <button class="btn btn-primary" [disabled]="form.invalid || busy()">{{ busy() ? 'Sending…' : 'Invite' }}</button>
        </form>
      </section>
    }

    @if (error()) {
      <div class="alert alert-error">{{ error() }}</div>
    }

    <section class="card">
      <h2>Members</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            @for (m of team()?.members ?? []; track m.id) {
              <tr>
                <td><strong>{{ m.account?.name ?? '—' }}</strong> @if (m.account?.id === me()) { <span class="muted">(you)</span> }</td>
                <td>{{ m.account?.email }}</td>
                <td>
                  @if (canManage() && m.role !== 'owner') {
                    <select class="select-sm" [value]="m.role" (change)="changeRole(m, $any($event.target).value)">
                      <option value="manager">Manager</option>
                      <option value="analyst">Analyst</option>
                    </select>
                  } @else {
                    <span class="badge">{{ m.role | label }}</span>
                  }
                </td>
                <td>{{ m.account?.last_login_at | when }}</td>
                <td class="r">
                  @if (canManage() && m.role !== 'owner') {
                    <button type="button" class="btn btn-ghost btn-sm danger" (click)="remove(m)">Remove</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">Loading…</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (team()?.pending_invites?.length) {
      <section class="card">
        <h2>Pending invitations</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              @for (i of team()!.pending_invites; track i.id) {
                <tr>
                  <td>{{ i.email }}</td>
                  <td><span class="badge">{{ i.role | label }}</span></td>
                  <td>{{ i.created_at | when }}</td>
                  <td>{{ i.expires_at | when }}</td>
                  <td class="r">
                    @if (canManage() && i.role !== 'owner') {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="resend(i)">Resend</button>
                      <button type="button" class="btn btn-ghost btn-sm danger" (click)="revoke(i)">Revoke</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <section class="card">
      <h2>Roles</h2>
      <div class="grid grid-3">
        @for (r of roles; track r.role) {
          <div class="role-card">
            <strong>{{ r.role | label }}</strong>
            <p class="muted small">{{ r.text }}</p>
          </div>
        }
      </div>
    </section>
  `,
})
export class TeamPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly tokenId = input.required<string>();

  protected readonly team = signal<Team | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly canManage = computed(() => this.auth.can(Number(this.tokenId()), 'team.manage'));
  protected readonly me = computed(() => this.auth.account()?.id);
  protected readonly roles: { role: Role; text: string }[] = [
    { role: 'owner', text: 'Everything, including the team. Owners are assigned by the exchange.' },
    { role: 'manager', text: 'Analytics, project profile and change requests. Cannot manage the team.' },
    { role: 'analyst', text: 'Read only: analytics, profile, requests and team.' },
  ];

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['analyst' as Role, Validators.required],
  });

  constructor() {
    effect(() => {
      this.tokenId();
      untracked(() => void this.load());
    });
  }

  private get base(): string {
    return `/tokens/${this.tokenId()}/team`;
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      this.team.set(await this.api.get<Team>(this.base));
    } catch (e) {
      this.error.set((e as ApiError).message);
    }
  }

  async invite(email = this.form.getRawValue().email, role: Role = this.form.getRawValue().role): Promise<void> {
    this.busy.set(true);
    try {
      const res = await this.api.postWithMessage(this.base, { email: email.trim(), role });
      this.toast.success(res.message);
      this.form.reset({ email: '', role: 'analyst' });
      void this.load();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  resend(i: PendingInvite): void {
    void this.invite(i.email, i.role);
  }

  async changeRole(m: TeamMember, role: Role): Promise<void> {
    try {
      await this.api.put(`${this.base}/${m.id}`, { role });
      this.toast.success('Role updated');
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
    void this.load();
  }

  async remove(m: TeamMember): Promise<void> {
    if (!confirm(`Remove ${m.account?.email ?? 'this member'} from the team?`)) {
      return;
    }
    try {
      await this.api.delete(`${this.base}/${m.id}`);
      this.toast.success('Member removed');
      void this.load();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }

  async revoke(i: PendingInvite): Promise<void> {
    if (!confirm(`Revoke the invitation for ${i.email}?`)) {
      return;
    }
    try {
      await this.api.delete(`${this.base}/invites/${i.id}`);
      this.toast.success('Invitation revoked');
      void this.load();
    } catch (e) {
      this.toast.error((e as ApiError).message);
    }
  }
}
