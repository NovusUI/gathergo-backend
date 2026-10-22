import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventCreationAssistantController } from './event-creation-assistant.controller';
import { EventCreationAssistantService } from './event-creation-assistant.service';
import { ImpactController } from './impact.controller';
import { ImpactService } from './impact.service';

@Module({
  imports: [ConfigModule],
  controllers: [EventCreationAssistantController, ImpactController],
  providers: [EventCreationAssistantService, ImpactService],
})
export class GogoModule {}
