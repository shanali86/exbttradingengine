import { Routes } from '@angular/router';
import { authGuard, guestGuard, tokenGuard } from './core/guards';

export const routes: Routes = [
  // "/" → the token list (authGuard sends signed-out visitors to /login). Must come
  // first: otherwise "/" matches the empty-path auth layout below with no page inside.
  { path: '', pathMatch: 'full', redirectTo: 'tokens' },

  // Public (auth) pages
  {
    path: '',
    loadComponent: () => import('./pages/auth/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: 'login', canActivate: [guestGuard], title: 'Sign in', loadComponent: () => import('./pages/auth/login').then((m) => m.LoginPage) },
      { path: 'forgot-password', canActivate: [guestGuard], title: 'Forgot password', loadComponent: () => import('./pages/auth/forgot-password').then((m) => m.ForgotPasswordPage) },
      { path: 'reset-password', title: 'Reset password', loadComponent: () => import('./pages/auth/reset-password').then((m) => m.ResetPasswordPage) },
      // Link from the invitation email: works logged in or out.
      { path: 'accept-invite', title: 'Accept invitation', loadComponent: () => import('./pages/auth/accept-invite').then((m) => m.AcceptInvitePage) },
    ],
  },

  // Dashboard
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell').then((m) => m.Shell),
    children: [
      { path: 'tokens', title: 'My tokens', loadComponent: () => import('./pages/tokens/token-list').then((m) => m.TokenListPage) },
      { path: 'account', title: 'Account & security', loadComponent: () => import('./pages/account/account').then((m) => m.AccountPage) },
      {
        path: 'tokens/:tokenId',
        canActivate: [tokenGuard],
        loadComponent: () => import('./pages/tokens/token-layout').then((m) => m.TokenLayout),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'overview' },
          { path: 'overview', title: 'Overview', canActivate: [tokenGuard], data: { permission: 'analytics.view' }, loadComponent: () => import('./pages/tokens/overview').then((m) => m.OverviewPage) },
          { path: 'trades', title: 'Trades', canActivate: [tokenGuard], data: { permission: 'analytics.view' }, loadComponent: () => import('./pages/tokens/trades').then((m) => m.TradesPage) },
          { path: 'profile', title: 'Project profile', canActivate: [tokenGuard], data: { permission: 'analytics.view' }, loadComponent: () => import('./pages/tokens/profile').then((m) => m.ProfilePage) },
          { path: 'requests', title: 'Change requests', canActivate: [tokenGuard], data: { permission: 'analytics.view' }, loadComponent: () => import('./pages/tokens/requests').then((m) => m.RequestsPage) },
          { path: 'team', title: 'Team', canActivate: [tokenGuard], data: { permission: 'team.view' }, loadComponent: () => import('./pages/tokens/team').then((m) => m.TeamPage) },
          { path: 'activity', title: 'Activity', canActivate: [tokenGuard], data: { permission: 'activity.view' }, loadComponent: () => import('./pages/tokens/activity').then((m) => m.ActivityPage) },
        ],
      },
    ],
  },

  { path: '**', redirectTo: 'tokens' },
];
