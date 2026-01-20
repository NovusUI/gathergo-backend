import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateCarpoolDto } from './dto/create-carpool.dto';
import { UpdateCarpoolDto } from './dto/update-carpool.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { RespondRequestDto } from './dto/respond-request.dto';
import { QueryCarpoolDto } from './dto/query-carpool.dto';
import { ForYouCarpoolDto } from './dto/foryou-carpool.dto';
import { startOfToday } from 'date-fns';
import { getRandomNote } from 'src/utils';
import { JoinCarpoolDto } from './dto/join-carpool.dto';
import { MessageService } from '../message/message.service';
import { MessageGateway } from '../message/message.gateway';
import { notificationConstants } from 'src/common/constants';
import { NotificationService } from '../notification/notification.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';

interface CarpoolWithDetails {
  id: string;
  driverId: string;
  eventId: string | null;
  isDeleted: boolean;
  availableSeats: number;
  event: { id: string; title: string } | null;
  passengers: Array<{
    origin: string;
    note: string | null;
    id: string;
    status: string;
    updatedAt: Date | null;
    userId: string;
    carpoolId: string;
    joinedAt: Date | null;
    requestedAt: Date;
    estimatedDistance: string | null;
  }>;
  _count?: {
    passengers?: number;
  };
}

@Injectable()
export class CarpoolService {
  constructor(
    private prisma: PrismaService,
    private messageService: MessageService,
    private messageGateway: MessageGateway,
    private notificationService: NotificationService,
    private readonly pubsubService: RedisPubSubService,
  ) {}

  async create(userId: string, data: CreateCarpoolDto) {
    let event: { endDate: Date } | null = null;
    // Check if driver already has a carpool for the same event
    if (data.eventId) {
      // Load and validate event
      event = await this.prisma.event.findUnique({
        where: { id: data.eventId },
        select: { endDate: true },
      });

      if (!event) {
        throw new BadRequestException('Event not found');
      }

      const now = new Date();
      const sixHoursAfterEnd = new Date(event.endDate);
      sixHoursAfterEnd.setHours(sixHoursAfterEnd.getHours() + 6);

      if (now > sixHoursAfterEnd) {
        throw new BadRequestException(
          'You can no longer create a carpool for this event',
        );
      }

      // Check if driver already has a carpool for this event
      const existingForEvent = await this.prisma.carpool.findFirst({
        where: {
          driverId: userId,
          eventId: data.eventId,
          isDeleted: false,
        },
        include: {
          event: { select: { id: true, title: true } },
          passengers: { select: { id: true, status: true } },
        },
      });

      if (existingForEvent) {
        return {
          message: 'You have already created a carpool for this event',
          carpool: existingForEvent,
        };
      }
    }

    // Check for overlapping departure time
    const overlapping = await this.prisma.carpool.findFirst({
      where: {
        driverId: userId,
        departureTime: data.departureTime,
        isDeleted: false,
      },
    });

    if (overlapping) {
      throw new BadRequestException(
        'You already have a carpool at this departure time',
      );
    }

    // Cancel conflicting passenger requests (same time)
    const conflictingPassengerTime =
      await this.prisma.carpoolPassenger.findMany({
        where: {
          userId,
          status: { in: ['PENDING', 'ACCEPTED'] },
          carpool: {
            departureTime: data.departureTime,
            isDeleted: false,
          },
        },
      });

    for (const p of conflictingPassengerTime) {
      await this.prisma.carpoolPassenger.update({
        where: { id: p.id },
        data: { status: 'CANCELLED' },
      });
    }

    // Cancel conflicting passenger requests (same event)
    if (data.eventId) {
      const conflictingPassengerEvent =
        await this.prisma.carpoolPassenger.findMany({
          where: {
            userId,
            status: { in: ['PENDING', 'ACCEPTED'] },
            carpool: {
              eventId: data.eventId,
              isDeleted: false,
            },
          },
        });

      for (const p of conflictingPassengerEvent) {
        await this.prisma.carpoolPassenger.update({
          where: { id: p.id },
          data: { status: 'CANCELLED' },
        });
      }
    }

    // Determine expiresAt
    let expiresAt: Date;
    if (data.eventId) {
      if (!event) throw new BadRequestException('Invalid event');

      expiresAt = new Date(event.endDate);
      expiresAt.setHours(expiresAt.getHours() + 12);
    } else {
      expiresAt = new Date(data.departureTime);
      expiresAt.setHours(expiresAt.getHours() + 12);
    }

    // Build params array dynamically
    const params: any[] = [
      userId,
      data.eventId ?? null,
      data.origin,
      data.destination ?? null,
      data.departureTime,
      data.description ?? null,
      data.note || getRandomNote(),
      expiresAt,
    ];

    // Prepare startPoint
    let startPointSQL = 'NULL';
    if (data.startPoint?.lng != null && data.startPoint?.lat != null) {
      params.push(data.startPoint.lng, data.startPoint.lat);
      const lngIndex = params.length - 1;
      const latIndex = params.length;
      startPointSQL = `ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)`;
    }

    // Prepare endPoint
    let endPointSQL = 'NULL';
    if (data.endPoint?.lng != null && data.endPoint?.lat != null) {
      params.push(data.endPoint.lng, data.endPoint.lat);
      const lngIndex = params.length - 1;
      const latIndex = params.length;
      endPointSQL = `ST_SetSRID(ST_MakePoint($${lngIndex}, $${latIndex}), 4326)`;
    }

    const createdCarpool = await this.prisma.$queryRawUnsafe<any>(
      `
      INSERT INTO "Carpool" (
        "id", "driverId", "eventId", "origin", "destination",
        "departureTime", "description", "note", "status", "isDeleted", "expiresAt",
        "startPoint", "endPoint", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        $1, $2, $3, $4, $5, $6, $7,
        'ACTIVE', false, $8,
        ${startPointSQL},
        ${endPointSQL},
        now(), now()
      )
      RETURNING
      "id",
      "driverId",
      "eventId",
      "origin",
      "destination",
      "departureTime",
      "description",
      "note",
      "status",
      "isDeleted",
      "expiresAt",
      ${data.startPoint ? 'ST_AsText("startPoint") AS "startPoint"' : 'NULL AS "startPoint"'},
      ${data.endPoint ? 'ST_AsText("endPoint") AS "endPoint"' : 'NULL AS "endPoint"'},
      "createdAt",
      "updatedAt";
    
      `,

      ...params,
    );

    // After creating the carpool
    const created = createdCarpool[0];

    // Fetch updated tray for this user
    const tray = await this.messageService.getConversationTray(userId);

    // Emit real-time tray update
    await this.messageGateway.pushConversationTray(userId, tray);

    return created;
  }

  // carpool.service.ts
  async updateCarpoolExpiryForEvent(
    eventId: string,
    newEndDate: Date,
  ): Promise<void> {
    await this.prisma.carpool.updateMany({
      where: {
        eventId,
        status: {
          in: ['ACTIVE'], // adjust based on your statuses
        },
      },
      data: {
        expiresAt: newEndDate,
      },
    });
  }

  async findOne(id: string, currentUserId: string) {
    const carpool = await this.prisma.carpool.findUnique({
      where: { id, isDeleted: false },
      include: {
        driver: {
          select: {
            id: true,
            username: true,
            profilePicUrlTN: true,
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            location: true,
          },
        },
        passengers: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profilePicUrlTN: true,
              },
            },
          },
        },
      },
    });

    if (!carpool) {
      throw new NotFoundException('Carpool not found');
    }

    // ✅ Check if requester follows driver
    const isFollowingDriver = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUserId,
          followingId: carpool.driverId,
        },
      },
    });

    // ✅ Check if driver follows requester
    const isFollowedByDriver = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: carpool.driverId,
          followingId: currentUserId,
        },
      },
    });

    return {
      ...carpool,
      isFollowingDriver: Boolean(isFollowingDriver),
      isFollowedByDriver: Boolean(isFollowedByDriver),
    };
  }

  async update(userId: string, id: string, data: UpdateCarpoolDto) {
    // Check if the carpool exists and belongs to the user
    const carpool = await this.prisma.carpool.findUnique({
      where: { id },
    });

    if (!carpool) {
      throw new NotFoundException('Carpool not found');
    }

    if (carpool.driverId !== userId) {
      throw new ForbiddenException(
        'You are not allowed to update this carpool',
      );
    }

    return this.prisma.carpool.update({
      where: { id },
      data,
    });
  }

  async remove(userId: string, id: string) {
    const carpool = await this.prisma.carpool.findUnique({ where: { id } });
    if (!carpool || carpool.isDeleted) {
      throw new NotFoundException('Carpool not found');
    }
    if (carpool.driverId !== userId) {
      throw new BadRequestException('You are not the driver of this carpool');
    }

    this.prisma.carpool.update({
      where: { id },
      data: { isDeleted: true },
    });
  }

  async requestRide(
    passengerId: string,
    carpoolId: string,
    data: JoinCarpoolDto,
    username: string,
  ) {
    const carpool = await this.prisma.carpool.findUnique({
      where: { id: carpoolId, isDeleted: false },
      include: {
        _count: {
          select: {
            passengers: {
              where: {
                status: 'ACCEPTED',
              },
            },
          },
        },
        event: true,
      },
    });

    if (!carpool || carpool.isDeleted) {
      throw new NotFoundException('Carpool not found or deleted');
    }

    // 💡 Check if user has created a carpool for this event already
    let existingDriverCarpool: CarpoolWithDetails | null = null;
    if (carpool.eventId) {
      const foundCarpool = (await this.prisma.carpool.findFirst({
        where: {
          driverId: passengerId,
          eventId: carpool.eventId,
          isDeleted: false,
        },
        include: {
          event: { select: { id: true, title: true } },
          passengers: {
            where: {
              status: { in: ['ACCEPTED', 'PENDING'] },
            },
          },
          _count: {
            select: {
              passengers: {
                where: {
                  status: 'ACCEPTED',
                },
              },
            },
          },
        },
      })) as CarpoolWithDetails | null;

      // Explicitly assign the type
      existingDriverCarpool = foundCarpool;
    }

    const acceptedPassengersCount = carpool._count?.passengers || 0;

    if (acceptedPassengersCount >= carpool.availableSeats) {
      throw new BadRequestException('Carpool is full');
    }

    const existing = await this.prisma.carpoolPassenger.findFirst({
      where: {
        userId: passengerId,
        carpoolId,
        status: { in: ['ACCEPTED', 'REMOVED', 'PENDING'] },
      },
      include: {
        carpool: true,
      },
    });

    if (existing) {
      return {
        message: 'you already requested this ride',
        carpool: existing,
      };
    }

    // Limit active requests
    const activeRequests = await this.prisma.carpoolPassenger.count({
      where: {
        userId: passengerId,
        status: 'PENDING',
        requestedAt: {
          gte: startOfToday(),
        },
      },
    });

    if (activeRequests >= 6) {
      throw new BadRequestException(
        'You can only have 6 pending requests at a time',
      );
    }

    // If user has an existing carpool for this event, return info instead of creating request
    if (existingDriverCarpool) {
      return {
        message: 'You have already created a carpool for this event',
        hasExistingCarpool: true,
        existingCarpool: {
          id: existingDriverCarpool.id,
          eventTitle: existingDriverCarpool.event?.title,
          passengerCount: existingDriverCarpool._count?.passengers || 0,
          hasActivePassengers: existingDriverCarpool.passengers.length > 0,
          canCancel: (existingDriverCarpool._count?.passengers || 0) === 0, // Can cancel if no accepted passengers
        },
        targetCarpool: {
          id: carpool.id,
          driverId: carpool.driverId,
          origin: data.origin,
          note: data.note,
          startPoint: data.startPoint,
        },
      };
    }

    let estimatedDistance: string | null = null;

    if (data.startPoint) {
      const result = await this.prisma.$queryRawUnsafe<{ distance: number }[]>(
        `
        SELECT ST_DistanceSphere(
          ST_SetSRID(ST_MakePoint($1, $2), 4326),
          c."startPoint"
        ) AS distance
        FROM "Carpool" c
        WHERE c.id = $3
        `,
        data.startPoint.lng,
        data.startPoint.lat,
        carpoolId,
      );

      const distanceInMeters = result?.[0]?.distance;

      if (distanceInMeters) {
        estimatedDistance = `${(distanceInMeters / 1000).toFixed(1)} km`;
      }
    }

    const [created] = await this.prisma.$queryRawUnsafe<any>(
      `
      INSERT INTO "CarpoolPassenger" 
        ("id", "userId", "carpoolId", "note", "status", "origin", "startPoint", "estimatedDistance")
      VALUES (
        gen_random_uuid(),
        $1, $2, $3, 'PENDING',
        $4,
        ${data.startPoint ? 'ST_SetSRID(ST_MakePoint($5, $6), 4326)' : 'NULL'},
        $7
      )
      RETURNING 
        id, "userId", "carpoolId", note, status, origin,
        ST_AsText("startPoint") as "startPoint",
        "requestedAt",
        "estimatedDistance";
      `,
      passengerId,
      carpoolId,
      data.note ?? null,
      data.origin,
      data.startPoint?.lng,
      data.startPoint?.lat,
      estimatedDistance,
    );

    await this.notificationService.createNotification({
      recipientIds: [carpool.driverId],
      title: notificationConstants.CARPOOL_REQUEST_TITLE_REQUEST,
      message: notificationConstants.CARPOOL_REQUEST_MESSAGE_REQUEST(
        username,
        carpool.event?.title || '',
      ),
      type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_REQUEST,
      imageUrl: carpool.event?.thumbnailUrl || '',
      data: {
        carpoolId,
      },
      link: '/carpool/' + carpoolId,
    });

    return {
      success: true,
      data: created,
    };
  }

  async requestRideAfterCancel(
    passengerId: string,
    carpoolId: string,
    data: { cancelCarpoolId: string } & JoinCarpoolDto,
    username: string,
  ) {
    const { cancelCarpoolId, ...joinData } = data;

    // First, cancel the existing carpool
    const existingCarpool = await this.prisma.carpool.findFirst({
      where: {
        id: cancelCarpoolId,
        driverId: passengerId,
        isDeleted: false,
      },
      include: {
        passengers: {
          where: {
            status: {
              in: ['PENDING', 'ACCEPTED'],
            },
          },

          select: {
            userId: true,
          },
        },
        event: true,
      },
    });

    if (!existingCarpool) {
      throw new NotFoundException('Existing carpool not found');
    }

    // Check if carpool has accepted passengers
    // if (existingCarpool._count.passengers > 0) {
    //   throw new BadRequestException(
    //     'Cannot cancel carpool with accepted passengers. Please remove them first.',
    //   );
    // }

    // Soft delete the existing carpool
    await this.prisma.carpool.update({
      where: { id: cancelCarpoolId },
      data: { isDeleted: true },
    });

    // Notify any pending passengers
    const pendingPassengerIds = existingCarpool.passengers.map((p) => p.userId);

    if (pendingPassengerIds.length > 0) {
      await this.notificationService.createNotification({
        recipientIds: pendingPassengerIds,
        title: notificationConstants.CARPOOL_NOTIFICATION_TYPE_CANCELLED,
        message: notificationConstants.CARPOOL_REQUEST_MESSAGE_CANCELLED(
          existingCarpool.event?.title ?? '',
        ),
        type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_CANCELLED,
        imageUrl: existingCarpool.event?.thumbnailUrl || '',
        data: {
          carpoolId: cancelCarpoolId,
        },
      });

      // Delete pending passenger records
      await this.prisma.carpoolPassenger.deleteMany({
        where: {
          carpoolId: cancelCarpoolId,
          status: 'PENDING',
        },
      });
    }

    // Now proceed with the original ride request
    return this.requestRide(passengerId, carpoolId, joinData, username);
  }

  async respondToRequest(
    driverId: string,
    requestId: string,
    dto: RespondRequestDto,
  ) {
    const request = await this.prisma.carpoolPassenger.findUnique({
      where: { id: requestId },
      include: {
        carpool: {
          select: {
            driverId: true,
            availableSeats: true,
            event: true,
            driver: true,
          },
        },
        user: true,
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.carpool.driverId !== driverId)
      throw new ForbiddenException('You are not allowed to respond');

    if (request.status !== 'PENDING')
      throw new BadRequestException('Request already processed');

    if (dto.action === 'ACCEPTED') {
      if (request.carpool.availableSeats <= 0) {
        throw new BadRequestException('No seats available');
      }

      await this.prisma.$transaction([
        this.prisma.carpoolPassenger.update({
          where: { id: requestId },
          data: { status: dto.action },
        }),
        // this.prisma.carpool.update({
        //   where: { id: request.carpoolId },
        //   data: { availableSeats: { decrement: 1 } },
        // }),
      ]);

      // Fetch updated tray for this user
      const tray = await this.messageService.getConversationTray(
        request.userId,
      );

      // Emit real-time tray update
      await this.messageGateway.pushConversationTray(request.userId, tray);

      await this.notificationService.createNotification({
        recipientIds: [request.userId],
        title: notificationConstants.CARPOOL_REQUEST_TITLE_ACCEPTED,
        message: notificationConstants.CARPOOL_REQUEST_MESSAGE_ACCEPTED(
          request.carpool.driver.username || '',
          request.carpool.event?.title || '',
        ),
        type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_ACCEPTED,
        data: {
          carpoolId: request.carpoolId,
        },
        link: '/chat/' + request.carpoolId,
        imageUrl: request.carpool.event?.thumbnailUrl ?? '',
      });
    } else {
      await this.prisma.carpoolPassenger.update({
        where: { id: request.id },
        data: { status: dto.action },
      });
      await this.notificationService.createNotification({
        recipientIds: [request.userId],
        title: notificationConstants.CARPOOL_REQUEST_TITLE_REJECTED,
        message: notificationConstants.CARPOOL_REQUEST_MESSAGE_REJECT,
        type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_REJECTED,
        data: {
          carpoolId: request.carpoolId,
        },
        link: '/carpool/' + request.carpoolId,
        imageUrl: request.carpool.event?.thumbnailUrl ?? '',
      });
      await this.pubsubService.publishCarpoolUpdate(
        'passenger_added',
        request.carpoolId,
        {
          id: request.userId,
          avatar: request.user.profilePicUrlTN,
          status: 'ACCEPTED',
        },
        request.userId,
      );
    }

    return { message: `Request ${dto.action.toLowerCase()}` };
  }

  // 🚗 Leave a ride
  async leaveRide(carpoolId: string, userId: string, username: string) {
    console.log('this');
    const passengerRequest = await this.prisma.carpoolPassenger.findFirst({
      where: {
        carpoolId,
        userId,
        status: 'ACCEPTED',
      },
      select: {
        carpool: {
          select: {
            driver: true,
            event: true,
          },
        },
        id: true,
      },
    });

    console.log('that');

    if (!passengerRequest) {
      throw new BadRequestException(
        'You are not an active passenger in this ride',
      );
    }

    await this.prisma.carpoolPassenger.update({
      where: { id: passengerRequest.id },
      data: { status: 'LEFT' },
    });

    await this.pubsubService.publishCarpoolUpdate(
      'passenger_removed',
      carpoolId,
      {},
      userId,
    );

    await this.notificationService.createNotification({
      recipientIds: [passengerRequest.carpool.driver.id],
      title: notificationConstants.CARPOOL_REQUEST_TITLE_LEFT,
      message: notificationConstants.CARPOOL_REQUEST_MESSAGE_LEFT(username),
      type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_LEFT,
      imageUrl: passengerRequest.carpool.event?.thumbnailUrl ?? '',
      data: {
        carpoolId: carpoolId,
      },
      link: '/carpool/' + carpoolId,
    });

    return { message: 'You have left the ride' };
  }

  // 🚕 Remove passenger as a driver
  async removePassenger(driverId: string, requestId: string) {
    const passenger = await this.prisma.carpoolPassenger.findUnique({
      where: { id: requestId },
      include: {
        carpool: {
          select: {
            driverId: true,
            event: true,
          },
        },
      },
    });

    if (!passenger) {
      throw new NotFoundException('Passenger not found');
    }

    if (passenger.carpool.driverId !== driverId) {
      throw new ForbiddenException(
        'You are not authorized to remove passengers from this carpool',
      );
    }

    await this.prisma.carpoolPassenger.update({
      where: { id: requestId },
      data: { status: 'REMOVED' },
    });

    await this.pubsubService.publishCarpoolUpdate(
      'passenger_removed',
      passenger.carpoolId,
      {},
      passenger.userId,
    );

    await this.notificationService.createNotification({
      recipientIds: [passenger.userId],
      title: notificationConstants.CARPOOL_REQUEST_TITLE_REMOVED,
      message: notificationConstants.CARPOOL_REQUEST_MESSAGE_REMOVED,
      type: notificationConstants.CARPOOL_NOTIFICATION_TYPE_REMOVED,
      imageUrl: passenger.carpool.event?.thumbnailUrl ?? '',
      data: {
        carpoolId: passenger.carpoolId,
      },
      link: '/carpool/' + passenger.carpoolId,
    });
    // await this.prisma.carpool.update({
    //   where: { id: passenger.carpoolId },
    //   data: { availableSeats: { increment: 1 } },
    // });

    return { message: 'Passenger removed successfully' };
  }

  async getActiveCarpools(query: QueryCarpoolDto) {
    const { latitude, longitude, page = 1, eventId } = query;
    const take = 20;

    const skip = (page - 1) * take;
    const now = new Date();

    // Fetch all active carpools
    const carpools = await this.prisma.carpool.findMany({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        eventId,
        expiresAt: {
          gt: now,
        },
      },
      include: {
        driver: {
          select: {
            id: true,
            username: true,
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
          },
        },
      },
    });

    let sortedCarpools = carpools;

    if (latitude && longitude) {
      // Calculate distance for each carpool
      sortedCarpools = carpools
        .map((carpool) => {
          if ((carpool as any).latitude && (carpool as any).longitude) {
            const distance = this.getDistanceFromLatLonInKm(
              latitude,
              longitude,
              (carpool as any).latitude,
              (carpool as any).longitude,
            );
            return { ...carpool, distance };
          } else {
            // If carpool has no coordinates, assign large distance
            return { ...carpool, distance: Number.MAX_VALUE };
          }
        })
        .sort((a, b) => a.distance - b.distance);
    }

    // Paginate
    const paginated = sortedCarpools.slice(skip, skip + take);

    const data = {};

    return {
      paginated,
      total: carpools.length,
      page,
      pageSize: take,
      totalPages: Math.ceil(carpools.length / take),
    };
  }

  async getForYouCarpools(userId: string, query: ForYouCarpoolDto) {
    const { latitude, longitude } = query;

    const now = new Date();
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const maxResults = 10;

    const allCarpools: any[] = [];

    // 1️⃣ Already involved carpools
    const involvedCarpools = await this.prisma.carpool.findMany({
      where: {
        OR: [
          { driverId: userId },
          {
            passengers: {
              some: {
                userId,
                status: { in: ['PENDING', 'ACCEPTED'] },
              },
            },
          },
        ],
        isDeleted: false,
        expiresAt: {
          gte: now,
        },
      },
      include: {
        driver: {
          select: {
            id: true,
            username: true,
            isVerified: true,
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            startDate: true,
          },
        },
        passengers: true,
      },
    });

    allCarpools.push(...involvedCarpools);

    // Collect existing IDs to avoid repetition
    const existingIds = new Set(involvedCarpools.map((c) => c.id));

    if (allCarpools.length < maxResults) {
      // 2️⃣ Carpools for events you have tickets for in 5 days
      const in5Days = new Date();
      in5Days.setDate(in5Days.getDate() + 5);

      const tickets = await this.prisma.ticket.findMany({
        where: {
          userId,
          eventTicket: {
            event: {
              startDate: {
                gte: now,
                lte: in5Days,
              },
            },
          },
        },
        include: {
          eventTicket: {
            include: {
              event: true,
            },
          },
        },
      });

      const eventIds = tickets.map((t) => t.eventTicket.event.id);

      let eventCarpools = await this.prisma.carpool.findMany({
        where: {
          eventId: { in: eventIds },
          isDeleted: false,
          expiresAt: {
            gt: now,
          },
          id: { notIn: [...existingIds] },
        },
        include: {
          driver: {
            select: {
              id: true,
              username: true,
              isVerified: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
            },
          },
          passengers: true,
        },
      });

      for (const c of eventCarpools) {
        if (allCarpools.length < maxResults) {
          allCarpools.push(c);
          existingIds.add(c.id);
        } else break;
      }
    }

    if (allCarpools.length < maxResults) {
      // 3️⃣ Other active carpools
      let otherCarpools = await this.prisma.carpool.findMany({
        where: {
          status: 'ACTIVE',
          isDeleted: false,
          expiresAt: { gte: startOfToday },
          id: { notIn: [...existingIds] },
        },
        include: {
          driver: {
            select: {
              id: true,
              username: true,
              isVerified: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
              imageUrl: true,
              startDate: true,
            },
          },
          passengers: true,
        },
      });

      for (const c of otherCarpools) {
        if (allCarpools.length < maxResults) {
          allCarpools.push(c);
        } else break;
      }
    }

    return allCarpools.slice(0, maxResults);
  }

  // New method for chat access details
  async getCarpoolChatAccess(carpoolId: string, userId: string) {
    // First get the basic carpool details using your existing method
    const carpool = await this.findOne(carpoolId, userId);

    if (!carpool) {
      throw new NotFoundException('Carpool not found');
    }

    // Check if user can access chat
    const now = new Date();
    const isExpired = carpool.expiresAt && new Date(carpool.expiresAt) < now;
    const isActive = carpool.status === 'ACTIVE' && !isExpired;

    const isDriver = carpool.driverId === userId;
    const isPassenger = carpool.passengers.some(
      (p) => p.userId === userId && p.status === 'ACCEPTED',
    );
    const isMember = isDriver || isPassenger;

    const canChat = isActive && isMember;

    let reason = '';
    if (!isActive) {
      if (carpool.status !== 'ACTIVE') {
        reason = `This carpool is ${carpool.status.toLowerCase()}`;
      } else if (isExpired) {
        reason = 'This carpool chat has expired';
      }
    } else if (!isMember) {
      reason = 'You are not a member of this carpool';
    }

    // Transform passengers to match expected format
    const passengers = carpool.passengers
      .filter((p) => p.status === 'ACCEPTED')
      .map((p) => ({
        id: p.user.id,
        name: p.user.username,
        avatar: p.user.profilePicUrlTN,
        status: p.status as 'ACCEPTED',
      }));

    return {
      id: carpool.id,
      name: `Carpool to ${carpool.event?.title || 'Event'}`,
      status: carpool.status as
        | 'ACTIVE'
        | 'COMPLETED'
        | 'CANCELLED'
        | 'EXPIRED',
      expiresAt: carpool.expiresAt,
      driverId: carpool.driverId,
      driver: {
        id: carpool.driver.id,
        name: carpool.driver.username,
        avatar: carpool.driver.profilePicUrlTN,
      },
      passengers,
      event: carpool.event
        ? {
            id: carpool.event.id,
            name: carpool.event.title,
          }
        : undefined,
      canChat,
      reason: canChat ? undefined : reason,
    };
  }

  private getDistanceFromLatLonInKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const R = 6371; // Radius of earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  }

  private deg2rad(deg: number) {
    return deg * (Math.PI / 180);
  }
}
