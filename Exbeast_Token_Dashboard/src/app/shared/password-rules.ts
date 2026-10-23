import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Same rule as the backend: 8+ chars, upper and lower case, a number. */
export const strongPassword: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '');
  if (!v) {
    return null;
  }
  const ok = v.length >= 8 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);
  return ok ? null : { weak: true };
};

/** On the form group: `password` and `password_confirmation` must match. */
export const passwordsMatch: ValidatorFn = (g: AbstractControl): ValidationErrors | null =>
  g.get('password')?.value === g.get('password_confirmation')?.value ? null : { mismatch: true };

export const PASSWORD_HINT = 'At least 8 characters with upper and lower case letters and a number.';
