import { Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { OnboardingService } from './onboarding.service';
import { SampleDataService } from './sample-data.service';

/**
 * 1E onboarding (FR-10.1): the first-sale checklist status plus the sample
 * catalog load/purge. Owner-session gated — these are self-serve store bootstrap
 * actions, not device traffic.
 */
@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly sample: SampleDataService,
  ) {}

  @Get('status')
  @ApiOperation({ operationId: 'getOnboardingStatus', summary: 'First-sale checklist status' })
  async status(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.onboarding.status(storeId);
  }

  @Post('sample-catalog')
  @ApiOperation({ operationId: 'loadSampleCatalog', summary: 'Load the sample catalog' })
  async load(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.sample.seed(storeId);
  }

  @Delete('sample-catalog')
  @ApiOperation({ operationId: 'purgeSampleCatalog', summary: 'Delete the sample catalog' })
  async purge(@Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.sample.purge(storeId);
  }

  @Post('dismiss')
  @HttpCode(204)
  @ApiOperation({ operationId: 'dismissOnboarding', summary: 'Hide the first-sale checklist' })
  async dismiss(@Req() req: Request) {
    const { storeId } = requireSession(req);
    await this.onboarding.dismiss(storeId);
  }
}
