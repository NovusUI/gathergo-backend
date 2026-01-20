// src/modules/auth/google.strategy.ts

import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private prisma: PrismaService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: 'http://localhost:4000/api/v1/auth/google/redirect',
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
        return done(null, {
          id: user.id,
          email: user.email,
          redirectUrl, // Pass redirect URL along
          hasPreferences: user.hasPreferences,
          isProfileComplete: user.isProfileComplete,
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
          },
        });
        return done(null, {
          id: updatedUser.id,
          email: updatedUser.email,
          redirectUrl,
          hasPreferences: updatedUser.hasPreferences,
          isProfileComplete: user.isProfileComplete,
        });
      }

      // CASE 3: New user - create account
      if (!user) {
        const newUser = await this.prisma.user.create({
          data: {
            email,
            googleId: id,
            profilePicUrl: photos[0]?.value,
          },
        });
        return done(null, {
          id: newUser.id,
          email: newUser.email,
          redirectUrl,
          hasPreferences: newUser.hasPreferences,
          isProfileComplete: newUser.isProfileComplete,
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
