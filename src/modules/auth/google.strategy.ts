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
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
    const { id, emails, displayName, photos } = profile;
    const email = emails[0].value;

    // Check if user exists
    let user = await this.prisma.user.findUnique({
      where: { email },
    });


    if (user && user?.googleId === id) {
      return done(null, { id: user.id, email: user.email });
    }

    // CASE 2: Existing email/password user - link accounts
  if (user && !user.googleId) {
    const updatedUser = await this.prisma.user.update({
      where: { email },
      data: {
        googleId: id,
        profilePicUrl: photos[0]?.value || user.profilePicUrl,
        password:null
        // Optionally update name if not set
        //name: user.name || displayName,
        // emailVerified: true 
      },
    });
    return done(null, { id: updatedUser.id, email: updatedUser.email });
  }

    // Create if doesn't exist
    if (!user) {
      const newUser  = await this.prisma.user.create({
        data: {
          email,
          googleId: id,
          profilePicUrl: photos[0].value,
          isProfileComplete: false,
        },
      });
      return done(null, { id: newUser.id, email: newUser.email });
    }

    // const payload = {
    //   id: user.id,
    //   email: user.email,
    // };

    // CASE 4: Conflict - existing account with different Google ID
  done(new Error('This email is already associated with another account'), false);
  }
}
