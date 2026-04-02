import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailService } from 'src/modules/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DonationImpactMapService {
  private readonly logger = new Logger(DonationImpactMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendImpactMapEmails() {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const events = await this.prisma.event.findMany({
      where: {
        registrationType: 'donation',
        endDate: { lte: cutoff },
        impactMapSentAt: null,
      },
      select: {
        id: true,
        title: true,
        endDate: true,
        donationTarget: true,
        thumbnailUrl: true,
        impactTitle: true,
        impactDescription: true,
        impactPercentage: true,
        creator: {
          select: {
            username: true,
            fullName: true,
          },
        },
      },
      take: 50,
      orderBy: { endDate: 'asc' },
    });

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: {
    id: string;
    title: string;
    endDate: Date;
    donationTarget: number | null;
    thumbnailUrl: string | null;
    impactTitle: string | null;
    impactDescription: string | null;
    impactPercentage: number | null;
    creator: {
      username: string | null;
      fullName: string | null;
    };
  }) {
    const [supporterEntries, donationAggregate] = await Promise.all([
      this.prisma.donation.findMany({
        where: {
          eventId: event.id,
          status: 'completed',
        },
        distinct: ['userId'],
        select: {
          userId: true,
        },
      }),
      this.prisma.donation.aggregate({
        where: {
          eventId: event.id,
          status: 'completed',
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const supporters = supporterEntries.length
      ? await this.prisma.user.findMany({
          where: {
            id: {
              in: supporterEntries.map((entry) => entry.userId),
            },
          },
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
          },
        })
      : [];

    if (supporters.length === 0) {
      await this.markImpactMapSent(event.id);
      return;
    }

    const amountRaised = Number(donationAggregate._sum.amount || 0) / 100;
    const donationTarget = Number(event.donationTarget || 0) / 100;
    const organizerName =
      event.creator.fullName?.trim() ||
      event.creator.username?.trim() ||
      'the GatherGo community';

    const results = await Promise.allSettled(
      supporters.map((supporter) =>
        this.mailService.sendImpactMap({
          to: supporter.email,
          jobId: `impact-map:${event.id}:${supporter.id}`,
          name: this.resolveDisplayName(supporter),
          eventTitle: event.title,
          organizerName,
          eventEndDate: event.endDate.toLocaleDateString(),
          donationTarget,
          amountRaised,
          supportersCount: supporters.length,
          impactTitle: event.impactTitle || 'your chosen cause',
          impactDescription:
            event.impactDescription ||
            'This campaign gives back directly to a real-world cause.',
          impactPercentage: event.impactPercentage ?? 100,
          campaignUrl: this.buildFrontendUrl(`/event/${event.id}`),
          campaignImage: event.thumbnailUrl || undefined,
        }),
      ),
    );

    const failedResults = results.filter(
      (result) => result.status === 'rejected',
    );

    if (failedResults.length > 0) {
      this.logger.warn(
        `Impact map email queueing failed for event ${event.id} (${failedResults.length}/${results.length} recipients)`,
      );
      return;
    }

    const skippedResults = results.filter(
      (result) => result.status === 'fulfilled' && result.value.skipped,
    );

    if (skippedResults.length > 0) {
      this.logger.log(
        `Impact map email skipped for event ${event.id}; leaving it unsent so it can be retried later`,
      );
      return;
    }

    await this.markImpactMapSent(event.id);
  }

  private async markImpactMapSent(eventId: string) {
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        impactMapSentAt: new Date(),
      },
    });
  }

  private buildFrontendUrl(path: string) {
    const baseUrl = process.env.FRONTEND_URL?.trim();
    if (!baseUrl) {
      return undefined;
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    return `${normalizedBaseUrl}/${normalizedPath}`;
  }

  private resolveDisplayName(user: {
    email?: string | null;
    username?: string | null;
    fullName?: string | null;
  }) {
    const preferredName = user.fullName?.trim() || user.username?.trim();
    if (preferredName) {
      return preferredName;
    }

    return user.email?.split('@')[0]?.trim() || 'there';
  }
}
