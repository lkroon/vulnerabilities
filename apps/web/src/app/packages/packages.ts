import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, concat, of, switchMap } from 'rxjs';
import type { PackageUsageResponse } from '@config-scanner/shared-types';
import { PackagesApi } from './packages-api';

/**
 * A submitted blast-radius query. Distinct from the form state — the form can
 * be typed ahead while the previous query's results are still on screen.
 */
interface PackageQuery {
  name: string;
  version: string;
}

/** Before any submission, the screen shows a hint rather than a result. */
const IDLE = Symbol('idle');
/** A request is in flight. */
const LOADING = Symbol('loading');
type UsageState = typeof IDLE | typeof LOADING | PackageUsageResponse | null;

/**
 * SPEC.md §236 screen 4 — package blast-radius lookup (SPEC.md §226).
 *
 * The only screen with user input, so the only place a typed reactive form
 * shows up (SPEC.md §241): two `FormControl<string>`s, `nonNullable: true`,
 * and a validator that rejects `#` — the key-design separator. The API would
 * return a 400 for the same input (`packages.controller.ts`), but the form
 * fails it before any bytes leave the browser, and the client-side check is
 * the demo of the contract, not the enforcement of it.
 *
 * `IDLE`, `LOADING`, `null` and the response are one discriminated union — a
 * single value that cannot represent impossible combinations, where two
 * booleans would allow "loading while never submitted" to exist.
 */
@Component({
  selector: 'cs-packages',
  imports: [DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './packages.html',
  styleUrl: './packages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Packages {
  private readonly api = inject(PackagesApi);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[^#]+$/)],
    }),
    version: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[^#]+$/)],
    }),
  });

  private readonly query = signal<PackageQuery | null>(null);

  private readonly state = toSignal(
    toObservable(this.query).pipe(
      switchMap((query) => {
        if (query === null) {
          return of<UsageState>(IDLE);
        }
        // Emit LOADING synchronously before the request, so the previous
        // response is not shown as the result of the new query while it is
        // still in flight.
        return concat(
          of<UsageState>(LOADING),
          this.api.usage(query.name, query.version).pipe(
            catchError(() => of<UsageState>(null)),
          ),
        );
      }),
    ),
    { initialValue: IDLE },
  );

  protected readonly loading = computed(() => this.state() === LOADING);
  protected readonly failed = computed(() => this.state() === null);
  protected readonly result = computed(() => {
    const state = this.state();
    return state === IDLE || state === LOADING || state === null
      ? null
      : state;
  });

  protected submit(): void {
    if (this.form.invalid) {
      return;
    }
    // `.value` on a typed FormGroup is Partial — controls could be disabled —
    // so the fully-known shape comes from `getRawValue()` (Angular forms.d.ts).
    const { name, version } = this.form.getRawValue();
    this.query.set({ name: name.trim(), version: version.trim() });
  }
}
