import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import {
  ShortLinkRedirectController,
  ShortLinksController,
} from './short-links.controller';
import { ShortLinksService } from './short-links.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShortLinksController, ShortLinkRedirectController],
  providers: [ShortLinksService],
})
export class ShortLinksModule {}
