// registration/registration.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('registrations')
@UseGuards(JwtAuthGuard)
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Get('my')
  async getMyRegistrations(@Request() req) {
    const userId = req.user.id;
    return this.registrationService.getUserRegistrations(userId);
  }

  @Get('event/:eventId')
  async getEventRegistrations(
    @Param('eventId') eventId: string,
    @Request() req,
  ) {
    const userId = req.user.id;
    return this.registrationService.getEventRegistrations(eventId, userId);
  }

  //   @Post('verify/:qrCode')
  //   async verifyRegistration(
  //     @Param('qrCode') qrCode: string,
  //     @Body() body: { markAsCheckedIn?: boolean },
  //     @Request() req,
  //   ) {
  //     const userId = req.user.id;

  //     // Only event creators or admins should be able to verify registrations
  //     // You might want to add additional authorization logic here
  //     return this.registrationService.verifyRegistration(
  //       qrCode,
  //       body.markAsCheckedIn ?? true,
  //     );
  //   }

  // @Delete(':registrationId')
  // async cancelRegistration(
  //   @Param('registrationId') registrationId: string,
  //   @Request() req,
  // ) {
  //   const userId = req.user.id;
  //   return this.registrationService.cancelRegistration(registrationId, userId);
  // }

  // @Get('verify-status/:qrCode')
  // async checkRegistrationStatus(@Param('qrCode') qrCode: string) {
  //   try {
  //     const result = await this.registrationService.verifyRegistration(
  //       qrCode,
  //       false, // Don't mark as checked in
  //     );
  //     return {
  //       isValid: true,
  //       ...result,
  //     };
  //   } catch (error) {
  //     return {
  //       isValid: false,
  //       message: error.message,
  //     };
  //   }
  // }

  // @Get('event/:eventId/check')
  // @UseGuards(RolesGuard)
  // @Roles('event_creator')
  // async checkIfUserIsRegistered(
  //   @Param('eventId') eventId: string,
  //   @Query('userId') userId: string,
  //   @Request() req,
  // ) {
  //   // Event creator checking if a specific user is registered
  //   const eventCreatorId = req.user.id;

  //   // Verify the event belongs to this creator
  //   const event = await this.registrationService['prisma'].event.findUnique({
  //     where: { id: eventId },
  //     select: { creatorId: true },
  //   });

  //   if (!event || event.creatorId !== eventCreatorId) {
  //     throw new BadRequestException('Event not found or unauthorized');
  //   }

  //   const registration = await this.registrationService['prisma'].registration.findFirst({
  //     where: {
  //       eventId,
  //       userId,
  //       status: 'active',
  //     },
  //     select: {
  //       id: true,
  //       createdAt: true,
  //       isCheckedIn: true,
  //       qrCode: true,
  //       user: {
  //         select: {
  //           id: true,
  //           username: true,
  //           fullName: true,
  //           email: true,
  //         },
  //       },
  //     },
  //   });

  //   return {
  //     isRegistered: !!registration,
  //     registration,
  //   };
  // }
}
