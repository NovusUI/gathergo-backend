import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { BadgeModule } from '../badge/badge.module';

@Module({
  imports: [BadgeModule],
  controllers: [UserController],
  providers: [UserService, PrismaService, MediaService],
})
export class UserModule {}
