import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Permission } from './models';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree(['/tokens']) : true;
};

/**
 * Token pages: the account must manage :tokenId with the route's
 * `data.permission`. Otherwise back to the token list.
 */
export const tokenGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const tokenId = Number(route.paramMap.get('tokenId') ?? route.parent?.paramMap.get('tokenId'));
  const permission = route.data['permission'] as Permission | undefined;
  const member = auth.membership(tokenId);
  if (member && (!permission || member.permissions.includes(permission))) {
    return true;
  }
  return inject(Router).createUrlTree(['/tokens']);
};
