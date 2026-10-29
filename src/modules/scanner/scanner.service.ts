import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  ScanDto,
  ScanResultDto,
  ValidationResultDto,
  QuickScanResultDto,
  ScanType,
} from './dto/scan.dto';
import { databaseNow } from '../checkout/checkout-inventory';
import { FoodBankService } from '../food-bank/food-bank.service';
import {
  mealCollectionDetails,
  MEAL_COLLECTION_MESSAGES,
} from '../food-bank/collection-policy';
import { PrismaService } from 'src/prisma/prisma.service';
import { ScannerPermissionsService } from './permisions/ scanner-permissions.service';

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private prisma: PrismaService,
    private permissionsService: ScannerPermissionsService,
    private foodBank: FoodBankService,
  ) {}

  // Main scan method
  async scan(
    qrCode: string,
    userId: string,
    markAsUsed: boolean = false,
    location?: string,
  ): Promise<ScanResultDto> {
    try {
      if (qrCode.startsWith('ggmeal:'))
        return await this.scanMeal(qrCode, userId, markAsUsed);
      // Try to find ticket first
      let ticket = await this.prisma.ticket.findUnique({
        where: { qrCode },
        include: {
          eventTicket: {
            include: {
              event: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              fullName: true,
            },
          },
        },
      });

      if (ticket) {
        return await this.handleTicketScan(
          ticket,
          userId,
          markAsUsed,
          location,
        );
      }

      const registration = await this.prisma.registration.findUnique({
        where: { qrCode },
        include: {
          event: true,
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              fullName: true,
            },
          },
        },
      });

      if (registration) {
        return await this.handleRegistrationScan(
          registration,
          userId,
          markAsUsed,
          location,
        );
      }

      throw new NotFoundException('QR code not found');
    } catch (error) {
      await this.logScan({
        type: 'validation',
        qrCode,
        scannedById: userId,
        action: 'scan',
        success: false,
        message: error.message,
      });

      return {
        success: false,
        message: error.message,
        error: error.response?.error || 'SCAN_FAILED',
      };
    }
  }

  // Validate without marking as used
  async validate(qrCode: string, userId: string): Promise<ValidationResultDto> {
    try {
      if (qrCode.startsWith('ggmeal:')) {
        const result = await this.scanMeal(qrCode, userId, false);
        return {
          isValid: result.success,
          canMarkUsed: result.data.permissions.canMarkUsed,
          message: result.message,
          data: result.data,
        };
      }
      let item: any = await this.prisma.ticket.findUnique({
        where: { qrCode },
        include: {
          eventTicket: {
            include: {
              event: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              fullName: true,
            },
          },
        },
      });

      let type: ScanType = ScanType.TICKET;
      let eventId: string;

      if (!item) {
        item = await this.prisma.registration.findUnique({
          where: { qrCode },
          include: {
            event: true,
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                fullName: true,
              },
            },
          },
        });
        type = ScanType.REGISTRATION;
      }

      if (!item) {
        return {
          isValid: false,
          canMarkUsed: false,
          message: 'QR code not found',
        };
      }

      eventId =
        type === ScanType.TICKET ? item.eventTicket.eventId : item.eventId;

      // Check if user has permission to mark as used
      const canMarkUsed = await this.permissionsService.canMarkAsUsed(
        userId,
        eventId,
      );

      // Check validity
      const isValid = this.checkValidity(item, type);

      await this.logScan({
        type: 'validation',
        qrCode,
        scannedById: userId,
        eventId,
        action: 'validate',
        success: true,
        message: isValid ? 'Valid' : 'Invalid',
      });

      return {
        isValid,
        canMarkUsed,
        message: isValid ? 'Valid' : this.getInvalidReason(item, type),
        data: {
          type,
          id: item.id,
          eventId,
          eventName:
            type === ScanType.TICKET
              ? item.eventTicket.event.title
              : item.event.title,
          eventDate:
            type === ScanType.TICKET
              ? item.eventTicket.event.startDate
              : item.event.startDate,
          userName: item.user.fullName || item.user.username || item.user.email,
          status: item.status,
          isUsed: item.isUsed,
          transactionId: item.transactionId,
        },
      };
    } catch (error) {
      await this.logScan({
        type: 'validation',
        qrCode,
        scannedById: userId,
        action: 'validate',
        success: false,
        message: error.message,
      });

      return {
        isValid: false,
        canMarkUsed: false,
        message: error.message,
      };
    }
  }

  private async scanMeal(qrCode: string, userId: string, markAsUsed: boolean) {
    const found = await this.foodBank.findForScan(qrCode);
    let pass = found.pass;
    const { userName } = found;
    const canMarkUsed = await this.permissionsService.canMarkAsUsed(
      userId,
      pass.eventId,
    );
    if (markAsUsed) {
      if (!canMarkUsed)
        throw new ForbiddenException(
          'Only authorised food bank staff can record collection',
        );
      pass = await this.foodBank.redeem(pass.id, userId);
    }
    const details = mealCollectionDetails(pass, await databaseNow(this.prisma));
    const valid = details.status === 'ready';
    const message = markAsUsed
      ? 'Meal collected'
      : MEAL_COLLECTION_MESSAGES[details.status];
    await this.logScan({
      type: 'meal',
      qrCode,
      scannedById: userId,
      eventId: pass.eventId,
      action: markAsUsed ? 'mark_used' : 'validate',
      success: markAsUsed || valid,
      message,
    });
    return {
      success: markAsUsed || valid,
      message,
      data: {
        type: ScanType.MEAL,
        id: pass.id,
        eventId: pass.eventId,
        eventName: pass.event.title,
        eventDate: pass.collectionStart,
        userName,
        status: 'active',
        isUsed: markAsUsed || pass.isUsed,
        qrCode,
        mealCollection: details,
        permissions: {
          canMarkUsed,
          canViewDetails: true,
        },
      },
    };
  }

  // Quick scan - minimal data for fast scanning
  async quickScan(qrCode: string, userId: string): Promise<QuickScanResultDto> {
    const validation = await this.validate(qrCode, userId);

    return {
      isValid: validation.isValid,
      canMarkUsed: validation.canMarkUsed,
      message: validation.message,
      type: validation.data?.type,
      eventName: validation.data?.eventName,
      userName: validation.data?.userName,
      eventDate: validation.data?.eventDate,
      mealCollection: validation.data?.mealCollection,
      qrCode,
    };
  }

  // Bulk scan
  async bulkScan(
    scans: Array<{ qrCode: string; markAsUsed?: boolean }>,
    userId: string,
  ) {
    const results: any[] = [];

    for (const scan of scans) {
      try {
        const result = await this.scan(scan.qrCode, userId, scan.markAsUsed);
        results.push({
          qrCode: scan.qrCode,
          ...result,
        });
      } catch (error) {
        results.push({
          qrCode: scan.qrCode,
          success: false,
          message: error.message,
        });
      }
    }

    return results;
  }

  // Get scan history for user
  async getScanHistory(
    userId: string,
    filters?: {
      eventId?: string;
      type?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      page?: number;
    },
  ) {
    const {
      eventId,
      type,
      startDate,
      endDate,
      limit = 50,
      page = 1,
    } = filters || {};
    const skip = (page - 1) * limit;

    const where: any = {
      scannedById: userId,
      ...(eventId && { eventId }),
      ...(type && { type }),
      ...(startDate && { createdAt: { gte: startDate } }),
      ...(endDate && { createdAt: { lte: endDate } }),
    };

    const scans = await this.prisma.scanLog.findMany({
      where,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
          },
        },
        ticket: {
          include: {
            eventTicket: {
              include: {
                event: true,
              },
            },
          },
        },
        registration: {
          include: {
            event: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    return scans.map((scan) => ({
      id: scan.id,
      type: scan.type,
      qrCode: scan.qrCode,
      eventName:
        scan.event?.title ||
        scan.ticket?.eventTicket.event.title ||
        scan.registration?.event.title,
      eventDate:
        scan.event?.startDate ||
        scan.ticket?.eventTicket.event.startDate ||
        scan.registration?.event.startDate,
      action: scan.action,
      success: scan.success,
      message: scan.message,
      scannedAt: scan.createdAt,
      metadata: scan.metadata,
    }));
  }

  // Get statistics for scanner
  async getScannerStats(userId: string, eventId?: string) {
    const where: any = { scannedById: userId };
    if (eventId) where.eventId = eventId;

    const totalScans = await this.prisma.scanLog.count({ where });
    const successfulScans = await this.prisma.scanLog.count({
      where: { ...where, success: true },
    });
    const ticketsMarkedUsed = await this.prisma.scanLog.count({
      where: {
        ...where,
        type: 'ticket',
        action: 'marked_used',
        success: true,
      },
    });
    const registrationsMarkedUsed = await this.prisma.scanLog.count({
      where: {
        ...where,
        type: 'registration',
        action: 'marked_used',
        success: true,
      },
    });

    // Get recent scans
    const recentScans = await this.prisma.scanLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        event: {
          select: {
            title: true,
          },
        },
      },
    });

    return {
      totalScans,
      successfulScans,
      failedScans: totalScans - successfulScans,
      ticketsMarkedUsed,
      registrationsMarkedUsed,
      successRate: totalScans > 0 ? (successfulScans / totalScans) * 100 : 0,
      recentScans: recentScans.map((scan) => ({
        type: scan.type,
        action: scan.action,
        success: scan.success,
        message: scan.message,
        scannedAt: scan.createdAt,
        eventName: scan.event?.title,
      })),
    };
  }

  // Private methods
  private async handleTicketScan(
    ticket: any,
    userId: string,
    markAsUsed: boolean,
    location?: string,
  ): Promise<ScanResultDto> {
    const eventId = ticket.eventTicket.eventId;

    // Check if user can mark as used
    const canMarkUsed = await this.permissionsService.canMarkAsUsed(
      userId,
      eventId,
    );

    if (markAsUsed && !canMarkUsed) {
      throw new ForbiddenException(
        'You do not have permission to mark tickets as used',
      );
    }

    // Validate ticket
    const isValid = this.checkValidity(ticket, ScanType.TICKET);
    if (!isValid) {
      throw new Error(this.getInvalidReason(ticket, ScanType.TICKET));
    }

    let updatedTicket = ticket;
    let action = 'validated';

    if (markAsUsed && canMarkUsed) {
      updatedTicket = await this.markTicketAsUsed(ticket.id, userId, location);
      action = 'marked_used';
    }

    await this.logScan({
      type: 'ticket',
      qrCode: ticket.qrCode,
      scannedById: userId,
      eventId,
      ticketId: ticket.id,
      action,
      success: true,
      message: `Ticket ${markAsUsed ? 'marked as used' : 'validated'}`,
      metadata: { location },
    });

    return {
      success: true,
      message: markAsUsed ? 'Ticket marked as used' : 'Ticket validated',
      data: {
        type: ScanType.TICKET,
        id: updatedTicket.id,
        eventId,
        eventName: ticket.eventTicket.event.title,
        eventDate: ticket.eventTicket.event.startDate,
        userName:
          ticket.user.fullName || ticket.user.username || ticket.user.email,
        userEmail: ticket.user.email,
        status: updatedTicket.status,
        isUsed: updatedTicket.isUsed,
        transactionId: ticket.transactionId,
        permissions: {
          canMarkUsed,
          canViewDetails: true,
        },
        scannedAt: updatedTicket.scannedAt || new Date(),
        scanLocation: updatedTicket.scanLocation,
        scannedBy: updatedTicket.scannedBy,
        qrCode: updatedTicket.qrCode,
      },
    };
  }

  private async handleRegistrationScan(
    registration: any,
    userId: string,
    markAsUsed: boolean,
    location?: string,
  ): Promise<ScanResultDto> {
    const eventId = registration.eventId;

    // Check if user can mark as used
    const canMarkUsed = await this.permissionsService.canMarkAsUsed(
      userId,
      eventId,
    );

    if (markAsUsed && !canMarkUsed) {
      throw new ForbiddenException(
        'You do not have permission to mark registrations as used',
      );
    }

    // Validate registration
    const isValid = this.checkValidity(registration, ScanType.REGISTRATION);
    if (!isValid) {
      throw new Error(
        this.getInvalidReason(registration, ScanType.REGISTRATION),
      );
    }

    let updatedRegistration = registration;
    let action = 'validated';

    if (markAsUsed && canMarkUsed) {
      updatedRegistration = await this.markRegistrationAsUsed(
        registration.id,
        userId,
        location,
      );
      action = 'marked_used';
    }

    await this.logScan({
      type: 'registration',
      qrCode: registration.qrCode,
      scannedById: userId,
      eventId,
      registrationId: registration.id,
      action,
      success: true,
      message: `Registration ${markAsUsed ? 'marked as used' : 'validated'}`,
      metadata: { location },
    });

    return {
      success: true,
      message: markAsUsed
        ? 'Registration marked as used'
        : 'Registration validated',
      data: {
        type: ScanType.REGISTRATION,
        id: updatedRegistration.id,
        eventId,
        eventName: registration.event.title,
        eventDate: registration.event.startDate,
        userName:
          registration.user.fullName ||
          registration.user.username ||
          registration.user.email,
        userEmail: registration.user.email,
        status: updatedRegistration.status,
        isUsed: updatedRegistration.isUsed,
        transactionId: registration.transactionId,
        permissions: {
          canMarkUsed,
          canViewDetails: true,
        },
        scannedAt: updatedRegistration.scannedAt || new Date(),
        scanLocation: updatedRegistration.scanLocation,
        scannedBy: updatedRegistration.scannedBy,
        qrCode: updatedRegistration.qrCode,
      },
    };
  }

  private checkValidity(item: any, type: ScanType): boolean {
    if (type === ScanType.DONATION) {
      return item.status === 'active';
    }

    if (item.isUsed) return false;
    if (item.status !== 'active') return false;

    // Check event dates if applicable
    const event =
      type === ScanType.TICKET ? item.eventTicket.event : item.event;
    if (event.endDate && new Date(event.endDate) < new Date()) {
      return false;
    }

    return true;
  }

  private getInvalidReason(item: any, type: ScanType): string {
    if (type === ScanType.DONATION) {
      return item.status !== 'active'
        ? `Donation is ${item.status}`
        : 'Invalid';
    }

    if (item.isUsed)
      return `${type === ScanType.TICKET ? 'Ticket' : 'Registration'} has already been used`;
    if (item.status !== 'active')
      return `${type === ScanType.TICKET ? 'Ticket' : 'Registration'} is ${item.status}`;

    const event =
      type === ScanType.TICKET ? item.eventTicket.event : item.event;
    if (event.endDate && new Date(event.endDate) < new Date()) {
      return 'Event has ended';
    }

    return 'Invalid';
  }

  private async markTicketAsUsed(
    ticketId: string,
    scannedBy: string,
    location?: string,
  ) {
    return this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        isUsed: true,
        status: 'used',
        scannedAt: new Date(),
        scannedBy: scannedBy,
        scanLocation: location,
      },
    });
  }

  private async markRegistrationAsUsed(
    registrationId: string,
    scannedBy: string,
    location?: string,
  ) {
    return this.prisma.registration.update({
      where: { id: registrationId },
      data: {
        isUsed: true,
        status: 'used',
        scannedAt: new Date(),
        scannedBy: scannedBy,
        scanLocation: location,
      },
    });
  }

  private async logScan(data: {
    type: string;
    qrCode: string;
    scannedById: string;
    eventId?: string;
    ticketId?: string;
    registrationId?: string;
    action: string;
    success: boolean;
    message: string;
    metadata?: any;
  }) {
    try {
      await this.prisma.scanLog.create({
        data,
      });
    } catch (error) {
      this.logger.error('Failed to log scan:', error);
    }
  }
}
