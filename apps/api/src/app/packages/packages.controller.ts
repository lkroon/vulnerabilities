import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import type { PackageUsageResponse } from '@config-scanner/shared-types';
import { toPackageUsage } from '../dynamo/items';
import { PackagesRepository } from './packages.repository';

@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesRepository) {}

  /**
   * `GET /api/packages/:name/:version/usage` — blast radius (SPEC.md §226).
   *
   * The name is a path segment and scoped packages contain a slash, so clients
   * send it URL-encoded (`%40angular%2Fcore`); Express decodes it once, which is
   * why the route is a single `:name` parameter rather than an attempt to match
   * `@scope/name` across two segments.
   *
   * Rejecting `#` matters: it is the key-design separator, and an id carrying
   * one could otherwise address a key it has no business addressing. The key
   * builders enforce this too — this check exists so the failure is a 400 rather
   * than a 500 from deeper in the stack.
   */
  @Get(':name/:version/usage')
  async usage(
    @Param('name') name: string,
    @Param('version') version: string,
  ): Promise<PackageUsageResponse> {
    if (name.includes('#') || version.includes('#')) {
      throw new BadRequestException(
        'Package name and version must not contain "#"',
      );
    }

    const items = await this.packages.usage(name, version);

    return { package: name, version, projects: items.map(toPackageUsage) };
  }
}
