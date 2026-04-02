// src/common/guards/guards.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { WsJwtGuard } from './ws-jwt.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getJwtExpiresIn, getJwtSecret } from 'src/config/runtime-env';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: async (configService: ConfigService) => ({
          secret: configService.get<string>('JWT_SECRET') || getJwtSecret(),
          signOptions: {
            expiresIn:
              configService.get<string>('JWT_EXPIRES_IN') ||
              getJwtExpiresIn(),
          },
        }),
      }),
  ],
  providers: [JwtAuthGuard, WsJwtGuard],
  exports: [JwtAuthGuard, WsJwtGuard,JwtModule],
})
export class GuardsModule {}
