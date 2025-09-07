// src/modules/search/search.module.ts
import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { EventSearchStrategy } from './strategies/event-search.strategy';
import { UserSearchStrategy } from './strategies/user-search.strategy';
import { CommunitySearchStrategy } from './strategies/community-search.strategy';
import { PrismaModule } from 'src/prisma/prisma.module';


@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    EventSearchStrategy,
    UserSearchStrategy,
    CommunitySearchStrategy,
  ],
})
export class SearchModule {}
