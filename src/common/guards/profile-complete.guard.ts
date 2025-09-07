// src/common/guards/profile-complete.guard.ts

import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ProfileCompleteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No user found in request');
    }

    if (!user.isProfileComplete) {
      throw new ForbiddenException('You must complete your profile to access this resource');
    }

    return true;
  }
}
