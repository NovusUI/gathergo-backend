// src/modules/auth/google.strategy.ts

import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { getGoogleCallbackUrl } from 'src/config/runtime-env';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private prisma: PrismaService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: getGoogleCallbackUrl(),
      scope: ['email', 'profile'],
      passReqToCallback: true, // This means validate gets 'request' as first param
    });
  }

  // When passReqToCallback is true, first parameter is 'request'
  async validate(
    request: any, // ← ADD THIS
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, emails, displayName, photos } = profile;
    const email = emails[0].value;

    // Get redirect URL from query params (sent from mobile app)
    const redirectUrl =
      request.passportCustom?.oauthRedirect ||
      request.query.state ||
      request.oauthRedirect;
    console.log('Redirect URL from state:', redirectUrl);

    try {
      // Check if user exists
      let user = await this.prisma.user.findUnique({
        where: { email },
      });

      // CASE 1: Existing Google user
      if (user && user?.googleId === id) {
        if (!user.isVerified) {
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { isVerified: true },
          });
        }

        return done(null, {
          id: user.id,
          email: user.email,
          redirectUrl, // Pass redirect URL along
          hasPreferences: user.hasPreferences,
          isProfileComplete: user.isProfileComplete,
          isNewUser: false,
          fullName: user.fullName,
        });
      }

      // CASE 2: Existing email/password user - link accounts
      if (user && !user.googleId) {
        const updatedUser = await this.prisma.user.update({
          where: { email },
          data: {
            googleId: id,
            profilePicUrl: photos[0]?.value || user.profilePicUrl,
            password: null,
            isVerified: true,
          },
        });
        return done(null, {
          id: updatedUser.id,
          email: updatedUser.email,
          redirectUrl,
          hasPreferences: updatedUser.hasPreferences,
          isProfileComplete: user.isProfileComplete,
          isNewUser: false,
          fullName: updatedUser.fullName,
        });
      }

      // CASE 3: New user - create account
      if (!user) {
        const newUser = await this.prisma.user.create({
          data: {
            email,
            googleId: id,
            profilePicUrl: photos[0]?.value,
            isVerified: true,
          },
        });
        return done(null, {
          id: newUser.id,
          email: newUser.email,
          redirectUrl,
          hasPreferences: newUser.hasPreferences,
          isProfileComplete: newUser.isProfileComplete,
          isNewUser: true,
          fullName: displayName || null,
        });
      }

      // CASE 4: Conflict - existing account with different Google ID
      return done(
        new Error('This email is already associated with another account'),
        false,
      );
    } catch (error) {
      return done(error, false);
    }
  }
}
