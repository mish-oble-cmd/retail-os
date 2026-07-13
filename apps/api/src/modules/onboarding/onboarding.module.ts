import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { SampleDataService } from './sample-data.service';

/** 1E onboarding (FR-10.1): first-sale checklist status + sample catalog. */
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, SampleDataService],
  exports: [OnboardingService, SampleDataService],
})
export class OnboardingModule {}
