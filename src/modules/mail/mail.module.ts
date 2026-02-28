import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
//import { MailProcessor } from './mail.processor';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forFeature(() => ({
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
      },
      resend: {
        apiKey: process.env.RESEND_API_KEY,
        defaultFrom: process.env.RESEND_DEFAULT_FROM || 'onboarding@resend.dev',
      },
      github: {
        token: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        templatesPath: process.env.GITHUB_TEMPLATES_PATH || 'email-templates',
      },
    })),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'mailQueue',
    }),
  ],
  // providers: [MailService, MailProcessor],
  providers:[MailService],
  exports: [MailService],
})
export class MailModule {}
