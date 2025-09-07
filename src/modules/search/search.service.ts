import { Injectable } from '@nestjs/common';
import { EventSearchStrategy } from './strategies/event-search.strategy';
import { UserSearchStrategy } from './strategies/user-search.strategy';
import { CommunitySearchStrategy } from './strategies/community-search.strategy';
import { SearchQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  constructor(
    private readonly eventSearch: EventSearchStrategy,
    private readonly userSearch: UserSearchStrategy,
    private readonly communitySearch: CommunitySearchStrategy,
  ) {}

  async search(dto: SearchQueryDto) {
    console.log(dto)
    switch (dto.type) {
      case 'events':
        return this.eventSearch.search(dto);
      case 'users':
        return this.userSearch.search(dto);
      case 'communities':
        return this.communitySearch.search(dto);
      default: {
        const [events, users, communities] = await Promise.all([
          this.eventSearch.search(dto),
          this.userSearch.search(dto),
          this.communitySearch.search(dto),
        ]);
        return { events, users, communities };
      }
    }
  }
}