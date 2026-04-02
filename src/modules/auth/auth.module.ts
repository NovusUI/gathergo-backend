import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FirebaseModule } from '../firebase/firebase.module';
import { MailModule } from '../mail/mail.module';
import { getJwtExpiresIn, getJwtSecret } from 'src/config/runtime-env';

@Module({
  imports: [
    PrismaModule,
    FirebaseModule,
    MailModule,
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || getJwtSecret(),
        signOptions: {
          expiresIn:
            configService.get<string>('JWT_EXPIRES_IN') || getJwtExpiresIn(),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy],
})
export class AuthModule {}
