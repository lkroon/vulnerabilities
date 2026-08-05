import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Finding } from '@config-scanner/shared-types';

/**
 * Renders one finding, narrowed on `kind` (SPEC.md §208, CLAUDE.md — "render
 * via exhaustive narrowing; never cast"). The four `@case` branches cover
 * every member of the `Finding` union; there is no `@default` because there
 * is nothing left to fall through to.
 */
@Component({
  selector: 'cs-finding-item',
  templateUrl: './finding-item.html',
  styleUrl: './finding-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindingItem {
  readonly finding = input.required<Finding>();
}
