import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

type RateBucket = {
  count: number;
  resetAt: number;
  blockedUntil?: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) return true;

    const req = context.switchToHttp().getRequest();
    const now = Date.now();
    const ip = this.getIp(req);
    const route = `${req.method}:${req.route?.path || req.originalUrl || ''}`;

    const identityField = options.identityField;
    const identityValue = identityField
      ? this.normalizeIdentity(req?.body?.[identityField] ?? req?.query?.[identityField])
      : '';

    const key = `${route}|${ip}|${identityField || 'ip'}|${identityValue || '-'}`;
    const windowMs = options.windowSec * 1000;
    const envCooldownSec = Number(process.env.AUTH_LOCKOUT_SECONDS);
    const cooldownSec =
      options.cooldownSec ??
      (Number.isFinite(envCooldownSec) ? envCooldownSec : 900);
    const cooldownMs = cooldownSec * 1000;

    let bucket = RateLimitGuard.buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + windowMs,
      };
    }

    if (bucket.blockedUntil && now < bucket.blockedUntil) {
      const retryInSec = Math.ceil((bucket.blockedUntil - now) / 1000);
      throw new HttpException(
        `Too many requests. Retry in ${retryInSec}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      bucket.blockedUntil = now + cooldownMs;
      RateLimitGuard.buckets.set(key, bucket);
      throw new HttpException(
        'Too many requests. Please wait before retrying.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    RateLimitGuard.buckets.set(key, bucket);
    return true;
  }

  private getIp(req: any): string {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return req?.ip || req?.socket?.remoteAddress || 'unknown-ip';
  }

  private normalizeIdentity(value: unknown): string {
    if (!value) return '';
    return String(value).trim().toLowerCase();
  }
}
