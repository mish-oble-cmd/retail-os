import { Module } from '@nestjs/common';

/**
 * loyalty module — wired empty in Phase 0 (phase-0-foundations.md §0.4).
 * Boundaries per monorepo-structure.md rule 2: other modules may only import
 * this module's exported services, never its internals or tables.
 */
@Module({})
export class LoyaltyModule {}
