import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { EventModule } from './modules/event/event.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { CarpoolModule } from './modules/carpool/carpool.module';
import { FeedModule } from './modules/feed/feed.module';
import { PostModule } from './modules/post/post.module';
import { CommunityModule } from './modules/community/community.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { MediaModule } from './modules/media/media.module';
import { SearchModule } from './modules/search/search.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { UserPreferenceModule } from './modules/user-preference/user-preference.module';
import { UserFollowModule } from './modules/user-follow/user-follow.module';
import { CommunityFollowModule } from './modules/community-follow/community-follow.module';
import { TransactionReferenceModule } from './modules/transaction-reference/transaction-reference.module';
import { EventTicketModule } from './modules/event-ticket/event-ticket.module';
import { ScheduleModule } from '@nestjs/schedule';
//import { MailModule } from './modules/mail/mail.module';
import { CronModule } from './cron-jobs/cron-module';
import { DeviceTokenModule } from './modules/device-token/device-token.module';
import { CarpoolQueueModule } from './queue/carpool/queue.module';
import { MessageModule } from './modules/message/message.module';
import { RedisModule } from './redis/redis.module';
import { GuardsModule } from './common/guards/guards.module';
import { BackgroundNotificationsModule } from './modules/background-notification/backgroundnotification.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ScannerModule } from './modules/scanner/scanner.modules';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { WalletModule } from './modules/wallet/wallet.module';
import { validateEnvironment } from './config/runtime-env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // <--- makes ConfigService available app-wide
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UserModule,
    UserPreferenceModule,
    EventModule,
    TicketModule,
    CarpoolModule,
    FeedModule,
    DashboardModule,
    PostModule,
    CommunityModule,
    TransactionModule,
    MediaModule,
    SearchModule,
    NotificationModule,
    UserFollowModule,
    CommunityFollowModule,
    TransactionReferenceModule,
    EventTicketModule,
    //MailModule,
    CarpoolModule,
    CronModule,
    DeviceTokenModule,
    CarpoolQueueModule,
    MessageModule,
    RedisModule,
    GuardsModule,
    BackgroundNotificationsModule,
    RegistrationModule,
    ScannerModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, RateLimitGuard],
  exports: [PrismaService],
})
export class AppModule {}
