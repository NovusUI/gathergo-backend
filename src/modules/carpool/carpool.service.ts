import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateCarpoolDto } from './dto/create-carpool.dto';
import { UpdateCarpoolDto } from './dto/update-carpool.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { RespondRequestDto } from './dto/respond-request.dto';
import { QueryCarpoolDto } from './dto/query-carpool.dto';
import { ForYouCarpoolDto } from './dto/foryou-carpool.dto';
import { startOfToday } from 'date-fns'

@Injectable()
export class CarpoolService {

    constructor(private prisma: PrismaService) {}

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
              throw new BadRequestException('You can no longer create a carpool for this event');
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
          
            if (existingForEvent){
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
          throw new BadRequestException('You already have a carpool at this departure time');
        }
      
        // Cancel conflicting passenger requests (same time)
        const conflictingPassengerTime = await this.prisma.carpoolPassenger.findMany({
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
          const conflictingPassengerEvent = await this.prisma.carpoolPassenger.findMany({
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
      
        // Daily limit check
        const startOfDay = new Date(data.departureTime);
        startOfDay.setHours(0, 0, 0, 0);
      
        const endOfDay = new Date(data.departureTime);
        endOfDay.setHours(23, 59, 59, 999);
      
        const dailyCount = await this.prisma.carpool.count({
          where: {
            driverId: userId,
            departureTime: {
              gte: startOfDay,
              lte: endOfDay,
            },
            isDeleted: false,
          },
        });
      
        if (dailyCount >= 4) {
          throw new BadRequestException('You can only create up to 4 carpools per day');
        }
      
        // Determine expiresAt
        let expiresAt: Date;
        if (data.eventId) {
        
      
          if (!event) throw new BadRequestException('Invalid event');
      
          expiresAt = new Date(event.endDate );
          expiresAt.setHours(expiresAt.getHours() + 12);
         
        } else {
          expiresAt = new Date(data.departureTime);
          expiresAt.setHours(expiresAt.getHours() + 12);
        }
      
        // Create carpool
        return this.prisma.carpool.create({
          data: {
            ...data,
            driverId: userId,
            expiresAt,
          },
        });
      }
      
      
      // carpool.service.ts
async updateCarpoolExpiryForEvent(eventId: string, newEndDate: Date): Promise<void> {
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
  
      

      async findOne(id: string) {
        const carpool = await this.prisma.carpool.findUnique({
          where: { id, isDeleted:false },
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
            passengers: {
                include: {
                  user: {
                    select: {
                      id: true,
                      username: true,
                    },
                  },
                },
              },
            
          },
        });
      
        if (!carpool) {
          throw new NotFoundException('Carpool not found');
        }
      
        return carpool;
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
          throw new ForbiddenException('You are not allowed to update this carpool');
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
      })
  
      }
      

      async requestRide(passengerId: string, carpoolId: string) {
        const carpool = await this.prisma.carpool.findUnique({ where: { id: carpoolId, isDeleted: false } });
        if (!carpool || carpool.isDeleted) throw new NotFoundException('Carpool not found or deleted');
      
        // 💡 Check if user has created a carpool for this event already
        if (carpool.eventId) {
          const existingDriverCarpool = await this.prisma.carpool.findFirst({
            where: {
              driverId: passengerId,
              eventId: carpool.eventId,
              isDeleted: false,
            },
            include: {
              event: { select: { id: true, title: true } },
              passengers: true,
            },
          });
      
          if (existingDriverCarpool) {
            return {
              message: 'You have already created a carpool for this event',
              carpool: existingDriverCarpool,
            };
          }
        }
      
        if (carpool.availableSeats <= 0) {
          throw new BadRequestException('Carpool is full');
        }
      
        const existing = await this.prisma.carpoolPassenger.findFirst({
          where: { userId: passengerId, carpoolId, status:{ in:["ACCEPTED","REMOVED","PENDING"] }},
          include: {
            carpool:true
          }
        });
        if (existing){

            return {
                message: "you already requested this ride",
                carpool:existing
            }
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
          throw new BadRequestException('You can only have 6 pending requests at a time');
        }
      
        return this.prisma.carpoolPassenger.create({
          data: {
            userId: passengerId,
            carpoolId,
            requestedAt: new Date()
          },
        });
      }
      
  
  async respondToRequest(driverId: string, requestId: string, dto: RespondRequestDto) {
    const request = await this.prisma.carpoolPassenger.findUnique({
      where: { id: requestId },
      include: { carpool: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.carpool.driverId !== driverId) throw new ForbiddenException('You are not allowed to respond');

    if (request.status !== 'PENDING') throw new BadRequestException('Request already processed');

    if (dto.action === 'ACCEPTED') {
      if (request.carpool.availableSeats <= 0) {
        throw new BadRequestException('No seats available');
      }
     
      await this.prisma.$transaction([
        this.prisma.carpoolPassenger.update({
          where: { id: requestId },
          data: { status: dto.action },
        }),
        this.prisma.carpool.update({
          where: { id: request.carpoolId },
          data: { availableSeats: { decrement: 1 } },
        }),
      ]);
    }else {
        await this.prisma.carpoolPassenger.update({
          where: { id: request.id },
          data: { status: dto.action },
        });
      }

      return { message: `Request ${dto.action.toLowerCase()}` };
  }

   // 🚗 Leave a ride
   async leaveRide(carpoolId: string, userId: string) {
    const passengerRequest = await this.prisma.carpoolPassenger.findFirst({
      where: {
        carpoolId,
        userId,
        status: 'ACCEPTED',
      },
    });

    if (!passengerRequest) {
      throw new BadRequestException('You are not an active passenger in this ride');
    }

    await this.prisma.carpoolPassenger.update({
      where: { id: passengerRequest.id },
      data: { status: 'LEFT' },
    });

    await this.prisma.carpool.update({
      where: { id: carpoolId },
      data: { availableSeats: { increment: 1 } },
    });

    return { message: 'You have left the ride' };
  }

   // 🚕 Remove passenger as driver
   async removePassenger(driverId: string, requestId: string) {
    const passenger = await this.prisma.carpoolPassenger.findUnique({
      where: { id: requestId },
      include: {
        carpool: true,
      },
    });
  
    if (!passenger) {
      throw new NotFoundException('Passenger not found');
    }
  
    if (passenger.carpool.driverId !== driverId) {
      throw new ForbiddenException('You are not authorized to remove passengers from this carpool');
    }
  
    await this.prisma.carpoolPassenger.update({
      where: { id: requestId },
      data: { status: 'REMOVED' },
    });
  
    await this.prisma.carpool.update({
      where: { id: passenger.carpoolId },
      data: { availableSeats: { increment: 1 } },
    });
  
    return { message: 'Passenger removed successfully' };
  }
  


  async getActiveCarpools(
   query: QueryCarpoolDto
  ) {
    const { latitude, longitude, page = 1,eventId } = query;
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
            gt: now
        }
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

    if (latitude &&longitude) {
      // Calculate distance for each carpool
      sortedCarpools = carpools
        .map((carpool) => {
          if (
            (carpool as any).latitude &&
            (carpool as any).longitude
          ) {
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

    const data ={

    }

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
    console.log(latitude,longitude)
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
            gte:  now
        }
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
          },
        },
        passengers: true,
      },
    });

    allCarpools.push(...involvedCarpools);

    // Collect existing IDs to avoid repetition
    const existingIds = new Set(involvedCarpools.map(c => c.id));

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

      const eventIds = tickets.map(t => t.eventTicket.event.id);

      

      let eventCarpools = await this.prisma.carpool.findMany({
        where: {
          eventId: { in: eventIds },
          isDeleted: false,
          expiresAt: {
            gt:now
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
            },
          },
          passengers: true,
        },
      });

      if (latitude && longitude) {
        eventCarpools = eventCarpools
          .filter(c => c.latitude !== null && c.longitude !== null)
          .map(c => ({
            ...c,
            distance: this.getDistanceFromLatLonInKm(latitude, longitude, (c as any).latitude, (c as any).longitude),
          }))
          .sort((a, b) => a.distance - b.distance);
      }

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
          departureTime: { gte: startOfToday },
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
            },
          },
          passengers: true,
        },
      });

      if (latitude && longitude) {
        otherCarpools = otherCarpools
          .filter(c => c.latitude !== null && c.longitude !== null)
          .map(c => ({
            ...c,
            distance: this.getDistanceFromLatLonInKm(latitude, longitude, (c as any).latitude, (c as any).longitude),
          }))
          .sort((a, b) => a.distance - b.distance);
      }

      for (const c of otherCarpools) {
        if (allCarpools.length < maxResults) {
          allCarpools.push(c);
        } else break;
      }
    }

    return allCarpools.slice(0, maxResults);
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
