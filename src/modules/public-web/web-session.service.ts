import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { WebVerifyEmailDto } from './public-web.dto';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const SESSION_HOURS = 24;

@Injectable()
export class WebSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async requestCode(email: string) {
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const id = randomUUID();
    const now = new Date();
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`web-email:${email}`}, 0))::text`;
      const previous = await tx.webEmailChallenge.findUnique({
        where: { email },
      });
      if (previous && now.getTime() - previous.sentAt.getTime() < 60000)
        throw new BadRequestException(
          'Please wait one minute before requesting another code.',
        );
      return tx.webEmailChallenge.upsert({
        where: { email },
        create: {
          id,
          email,
          codeHash: digest(`${id}:${code}`),
          expiresAt: new Date(now.getTime() + 600000),
        },
        update: {
          id,
          codeHash: digest(`${id}:${code}`),
          attempts: 0,
          expiresAt: new Date(now.getTime() + 600000),
          sentAt: now,
          consumedAt: null,
        },
      });
    });
    try {
      const delivery = await this.mail.sendEmailVerificationCode({
        to: email,
        name: 'there',
        code,
        expiresInMinutes: 10,
      });
      if (delivery.skipped)
        throw new ServiceUnavailableException(
          'Email verification is unavailable. Please try again later.',
        );
    } catch (error) {
      await this.prisma.webEmailChallenge.updateMany({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    return {
      challengeId: challenge.id,
      email,
      expiresAt: challenge.expiresAt,
      message: 'Check your email for your six-digit code.',
    };
  }

  async verifyCode(dto: WebVerifyEmailDto) {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "WebEmailChallenge" WHERE "id" = ${dto.challengeId} FOR UPDATE`;
      const challenge = await tx.webEmailChallenge.findUnique({
        where: { id: dto.challengeId },
      });
      if (
        !challenge ||
        challenge.consumedAt !== null ||
        challenge.expiresAt <= now ||
        challenge.attempts >= 5
      )
        return null;
      if (challenge.codeHash !== digest(`${challenge.id}:${dto.code}`)) {
        // Return the failure so the attempt count commits before the error is raised.
        await tx.webEmailChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
        return null;
      }
      await tx.webEmailChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      const user = await tx.user.upsert({
        where: { email: challenge.email },
        create: { email: challenge.email, isGuest: true, isVerified: true },
        update: {},
      });
      const session = await tx.webSession.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          expiresAt: new Date(now.getTime() + SESSION_HOURS * 3600000),
        },
      });
      return {
        email: user.email,
        fullName: user.fullName,
        existingAccount: !user.isGuest,
        expiresAt: session.expiresAt,
      };
    });
    if (!result)
      throw new BadRequestException(
        'Invalid or expired code. Request another code if needed.',
      );
    return { token, ...result };
  }

  async authenticate(token: string) {
    const session = await this.prisma.webSession.findUnique({
      where: { tokenHash: digest(token) },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, isGuest: true },
        },
      },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException('Verify your email to continue.');
    return session;
  }

  async revoke(id: string) {
    await this.prisma.webSession.deleteMany({ where: { id } });
    return { message: 'Web session ended.' };
  }
}
