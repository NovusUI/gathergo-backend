import { Injectable } from '@nestjs/common';

import { SearchQueryDto } from '../dto/search-query.dto';
import { SearchResultDto } from '../dto/search-result.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class EventSearchStrategy {
  /**TODO: search result shouldnt return everything */
  constructor(private readonly prisma: PrismaService) {}

  async search(dto: SearchQueryDto): Promise<SearchResultDto<any>> {
    const { query, page = 1, pageSize = 10 } = dto;

    if (!query?.trim()) {
      return new SearchResultDto([], 0, page, pageSize); // ✅ return empty result early
    }
    const offset = (page - 1) * pageSize;
    const limit = pageSize

    console.log(limit,"limit")
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        e.*,
        (
          SELECT MIN(et.price)
          FROM "EventTicket" et
          WHERE et."eventId" = e.id
            AND et."isVisible" = true
        ) AS "lowestTicketPrice",
        GREATEST(
          similarity(e.title, $1),
          similarity(e.description, $1),
          similarity(COALESCE(e.location, ''), $1),
          similarity(COALESCE(e."impactTitle", ''), $1)
        ) AS score
      FROM "Event" e
      WHERE
        similarity(e.title, $1) > 0.2 OR
        similarity(e.description, $1) > 0.2 OR
        similarity(COALESCE(e.location, ''), $1) > 0.2 OR
        similarity(COALESCE(e."impactTitle", ''), $1) > 0.2
      ORDER BY score DESC
      OFFSET $2 LIMIT $3
      `,
      query,
      offset,
      limit,
    );

    const count = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT COUNT(*) FROM "Event"
      WHERE
        similarity(title, $1) > 0.2 OR
        similarity(description, $1) > 0.2 OR
        similarity(location, $1) > 0.2 OR
        similarity(COALESCE("impactTitle", ''), $1) > 0.2
      `,
      query,
    );

    const total = parseInt(count[0]?.count ?? '0', 10);
    return new SearchResultDto(data, total, page, pageSize);
  }
}
