import { Module } from '@nestjs/common';
import { UserPreferenceController } from './user-preference.controller';
import { UserPreferenceService } from './user-preference.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EventFeedbackController } from './event-feedback.controller';
import { EventFeedbackService } from './event-feedback.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserPreferenceController, EventFeedbackController],
  providers: [UserPreferenceService, EventFeedbackService],
  exports: [UserPreferenceService],
})
export class UserPreferenceModule {}
