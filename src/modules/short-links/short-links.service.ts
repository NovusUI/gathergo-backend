import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShortLinkKind } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateShortLinkDto } from './short-links.dto';

@Injectable()
export class ShortLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(target: CreateShortLinkDto) {
    await this.assertTargetExists(target);
    const where = { kind_targetId: target };
    const existing = await this.prisma.shortLink.findUnique({ where });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.shortLink.create({
          data: { ...target, code: randomBytes(6).toString('base64url') },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error;
        // Another share may have created this target, or the random code collided.
        const concurrent = await this.prisma.shortLink.findUnique({ where });
        if (concurrent) return concurrent;
      }
    }
    throw new ConflictException(
      'Could not create a short link. Please try again.',
    );
  }

  async resolve(code: string) {
    const link = await this.prisma.shortLink.findUnique({ where: { code } });
    if (!link) throw new NotFoundException('This shared link is unavailable');
    await this.assertTargetExists(link);
    return link;
  }

  private async assertTargetExists({ kind, targetId }: CreateShortLinkDto) {
    if (kind === ShortLinkKind.carpool) {
      const carpool = await this.prisma.carpool.findUnique({
        where: { id: targetId, isDeleted: false },
        select: { id: true },
      });
      if (!carpool) throw new NotFoundException('Carpool not found');
      return;
    }
    const event = await this.prisma.event.findUnique({
      where: { id: targetId },
      select: { registrationType: true },
    });
    if (
      !event ||
      (kind === ShortLinkKind.foodbank && event.registrationType !== 'foodbank')
    )
      throw new NotFoundException('Event or food bank not found');
  }
}
