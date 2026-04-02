import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { MailProcessor } from './mail.processor';
import { MailSettingsService } from './mail-settings.service';
import { MailDeliveryService } from './mail-delivery.service';
import { getRedisOptions } from 'src/config/runtime-env';

@Module({
  imports: [
    ConfigModule.forFeature(() => ({
      redis: {
        ...getRedisOptions(),
      },
      resend: {
        apiKey: process.env.RESEND_API_KEY,
        defaultFrom: process.env.RESEND_DEFAULT_FROM || 'onboarding@resend.dev',
      },
    })),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: getRedisOptions(),
      }),
    }),
    BullModule.registerQueue({
      name: 'mailQueue',
    }),
  ],
  providers: [
    MailService,
    MailProcessor,
    MailSettingsService,
    MailDeliveryService,
  ],
  exports: [MailService],
})
export class MailModule {}
