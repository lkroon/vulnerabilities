import { IsString, Length, Matches } from 'class-validator';
import type { CreateProjectRequest } from '@config-scanner/shared-types';

/**
 * Request body of `POST /api/orgs/:orgId/projects`.
 *
 * `implements CreateProjectRequest` is the load-bearing part: the contract still
 * lives in `libs/shared-types` (CLAUDE.md — never redeclare a DTO in an app), and
 * adding a field there fails this build until the field is declared and
 * validated here. What the class adds is the *runtime* half — TypeScript types
 * are erased at compile time, so decorators plus the global `ValidationPipe` are
 * what actually reject a malformed body. This is the Pydantic analogue
 * (SPEC.md §56).
 *
 * The decorators cannot live on the interface in `shared-types`: that would make
 * `class-validator` a dependency of the Angular bundle, for code the browser
 * never runs.
 */
export class CreateProjectDto implements CreateProjectRequest {
  /**
   * Becomes part of a partition key (`PROJECT#<projectId>`), so the character
   * set is restricted rather than merely non-empty — `#` would corrupt the key
   * design, and a URL-unsafe id would break every path that carries it.
   */
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,63}$/, {
    message:
      'projectId must be lowercase alphanumeric with hyphens, starting with a letter or digit, at most 64 characters',
  })
  projectId!: string;

  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Matches(/^[\w.-]+\/[\w.-]+$/, {
    message: 'repo must be in "owner/name" form',
  })
  repo!: string;

  @IsString()
  @Length(1, 255)
  defaultBranch!: string;
}
