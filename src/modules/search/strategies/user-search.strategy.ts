import { Injectable } from '@nestjs/common';
import { SearchQueryDto } from '../dto/search-query.dto';
import { SearchResultDto } from '../dto/search-result.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UserSearchStrategy {
  constructor(private readonly prisma: PrismaService) {}

  async search(dto: SearchQueryDto): Promise<SearchResultDto<any>> {
    const { query, page = 1, pageSize = 10 } = dto;
    const offset = (page - 1) * pageSize;

    const results = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT *,
        GREATEST(
          similarity(username, $1),
          similarity(email, $1)
        ) AS score
      FROM "User"
      WHERE
        similarity(username, $1) > 0.2 OR
        similarity(email, $1) > 0.2
      ORDER BY score DESC
      OFFSET $2 LIMIT $3
      `,
      query,
      offset,
      pageSize,
    );

    const count = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT COUNT(*) FROM "User"
      WHERE
        similarity(username, $1) > 0.2 OR
        similarity(email, $1) > 0.2
      `,
      query,
    );

    const total = parseInt(count[0]?.count ?? '0', 10);
    return new SearchResultDto(results, total, page, pageSize);
  }
}
