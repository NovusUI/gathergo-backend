import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  GrantPermissionDto,
  UpdatePermissionDto,
  SearchUsersDto,
} from '../dto/permission.dto';
import { PrismaService } from 'src/prisma/prisma.service';

type PermissionUserSummary = {
  id: string;
  username?: string | null;
  fullName?: string | null;
  profilePicUrl?: string | null;
  profilePicUrlTN?: string | null;
};

@Injectable()
export class ScannerPermissionsService {
  private readonly logger = new Logger(ScannerPermissionsService.name);

  constructor(private prisma: PrismaService) {}

  // Grant permission to scanner for ALL owner's events
  async grantPermission(ownerId: string, dto: GrantPermissionDto) {
    let scannerId = dto.scannerId;

    // If email is provided, find user by email
    if (dto.userEmail && !scannerId) {
      const user = await this.findUserByEmail(dto.userEmail);
      scannerId = user.id;
    }

    if (!scannerId) {
      throw new BadRequestException(
        'Either scannerId or userEmail must be provided',
      );
    }

    // Don't allow granting permission to self
    if (scannerId === ownerId) {
      throw new BadRequestException('Cannot grant permission to yourself');
    }

    // Check if scanner user exists
    const scanner = await this.prisma.user.findUnique({
      where: { id: scannerId },
    });

    if (!scanner) {
      throw new NotFoundException('Scanner user not found');
    }

    // Check if permission already exists
    const existingPermission = await this.prisma.scannerPermission.findUnique({
      where: {
        ownerId_scannerId: {
          ownerId,
          scannerId,
        },
      
      },
      include: {
        scanner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
    });

    if (existingPermission) {
      // Update existing permission
      const updated = await this.prisma.scannerPermission.update({
        where: { id: existingPermission.id },
        data: {
          isActive: true,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          isDeleted:false,
        },
        include: {
          scanner: {
            select: {
              id: true,
              fullName: true,
              username: true,
              profilePicUrl: true,
              profilePicUrlTN: true,
            },
          },
          owner: {
            select: {
              id: true,
              fullName: true,
              username: true,
              profilePicUrl: true,
              profilePicUrlTN: true,
            },
          },
        },
      });

      this.logger.log(
        `Permission reactivated for scanner ${scannerId} by owner ${ownerId}`,
      );
      return this.mapPermissionToResponse(updated);
    }

    // Create new permission
    const permission = await this.prisma.scannerPermission.create({
      data: {
        ownerId,
        scannerId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        scanner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
    });

    this.logger.log(
      `Permission granted to scanner ${scannerId} by owner ${ownerId}`,
    );
    return this.mapPermissionToResponse(permission);
  }

  // Revoke permission (deactivate)
  async revokePermission(ownerId: string, permissionId: string) {
    const permission = await this.prisma.scannerPermission.findUnique({
      where: { id: permissionId },
      include: {
        scanner: true,
        owner: true,
      },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    if (permission.ownerId !== ownerId) {
      throw new ForbiddenException('Only permission owner can revoke it');
    }

    const updated = await this.prisma.scannerPermission.update({
      where: { id: permissionId },
      data: { isActive: false, isDeleted: true },
      include: {
        scanner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
    });

    this.logger.log(
      `Permission revoked for scanner ${permission.scannerId} by owner ${ownerId}`,
    );
    return this.mapPermissionToResponse(updated);
  }

  // Update permission
  async updatePermission(
    ownerId: string,
    permissionId: string,
    dto: UpdatePermissionDto,
  ) {
    const permission = await this.prisma.scannerPermission.findUnique({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    if (permission.ownerId !== ownerId) {
      throw new ForbiddenException('Only permission owner can update it');
    }

    const updated = await this.prisma.scannerPermission.update({
      where: { id: permissionId },
      data: {
        isActive: dto.isActive,
        expiresAt: dto.expiresAt
          ? new Date(dto.expiresAt)
          : permission.expiresAt,
      },
      include: {
        scanner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
    });

    this.logger.log(`Permission updated: ${permissionId}`);
    return this.mapPermissionToResponse(updated);
  }

  // Get all permissions granted by an owner
  async getOwnerPermissions(ownerId: string) {
    const permissions = await this.prisma.scannerPermission.findMany({
      where: { ownerId, isDeleted: false },
      include: {
        scanner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get all events for this owner to include in response
    const ownerEvents = await this.prisma.event.findMany({
      where: { creatorId: ownerId },
      select: {
        id: true,
        title: true,
        startDate: true,
        location: true,
      },
    });

    return permissions.map((permission) =>
      this.mapPermissionToResponse(permission, ownerEvents),
    );
  }

  // Check if user has permission to mark as used for a specific event
  async canMarkAsUsed(userId: string, eventId: string): Promise<boolean> {
    // Get the event to find its owner
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { creatorId: true },
    });

    if (!event) {
      return false;
    }

    // Event owners can always mark as used
    if (event.creatorId === userId) {
      return true;
    }

    // Check if there's an active permission from this event's owner to the user
    const permission = await this.prisma.scannerPermission.findUnique({
      where: {
        ownerId_scannerId: {
          ownerId: event.creatorId,
          scannerId: userId,
        },
      },
    });

    if (!permission || !permission.isActive) {
      return false;
    }

    // Check if permission has expired
    if (permission.expiresAt && permission.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  // Search users to grant permission to (excluding those who already have permission)
  async searchUsers(ownerId: string, dto: SearchUsersDto) {
    const {
      email,
      username,
      fullName,
      limit = 10,
      excludePermitted = true,
    } = dto;

    const where: any = {};

    if (email) {
      where.email = { contains: email, mode: 'insensitive' };
    }

    if (username) {
      where.username = { contains: username, mode: 'insensitive' };
    }

    if (fullName) {
      where.fullName = { contains: fullName, mode: 'insensitive' };
    }

    // Exclude owner themselves
    where.NOT = { id: ownerId };

    // If excluding users who already have permission
    if (excludePermitted) {
      const existingPermissions = await this.prisma.scannerPermission.findMany({
        where: { ownerId },
        select: { scannerId: true },
      });

      const excludedIds = existingPermissions.map((p) => p.scannerId);
      if (excludedIds.length > 0) {
        where.id = { notIn: excludedIds };
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        fullName: true,
        profilePicUrl: true,
        profilePicUrlTN: true,
      },
      take: limit,
      orderBy: { username: 'asc' },
    });

    return users.map((user) => this.mapUserSummary(user));
  }

  // Remove permission permanently
  async removePermission(ownerId: string, permissionId: string) {
    const permission = await this.prisma.scannerPermission.findUnique({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    if (permission.ownerId !== ownerId) {
      throw new ForbiddenException('Only permission owner can remove it');
    }

    await this.prisma.scannerPermission.delete({
      where: { id: permissionId },
    });

    this.logger.log(`Permission removed: ${permissionId}`);
    return { success: true, message: 'Permission removed successfully' };
  }

  // Get all owners who have granted permission to current user
  // async getMyPermissionsOwners(userId: string) {
  //   const permissions = await this.prisma.scannerPermission.findMany({
  //     where: {
  //       scannerId: userId,
  //       isActive: true,
  //       OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  //     },
  //     include: {
  //       owner: {
  //         select: {
  //           id: true,
  //           fullName: true,
  //           email: true,
  //           username: true,
  //           profilePicUrl: true,
  //         },
  //       },
  //     },
  //   });

  //   return permissions.map((p) => ({
  //     ownerId: p.owner.id,
  //     ownerName: p.owner.fullName || p.owner.username,
  //     ownerEmail: p.owner.email,
  //     ownerImage: p.owner.profilePicUrl,
  //     permissionId: p.id,
  //     expiresAt: p.expiresAt,
  //   }));

  // }

  // Get permissions where user is scanner
  async getUserScannerPermissions(userId: string) {
    const permissions = await this.prisma.scannerPermission.findMany({
      where: {
        scannerId: userId,
        isActive: true,
        isDeleted: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            username: true,
            profilePicUrl: true,
            profilePicUrlTN: true,
          },
        },
      },
    });

    return permissions.map((permission) => ({
      permissionId: permission.id,
      ownerId: permission.ownerId,
      owner: this.mapUserSummary(permission.owner),
      expiresAt: permission.expiresAt,
      createdAt: permission.createdAt,
    }));
  }

  // Helper method to find user by email
  private async findUserByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
        profilePicUrl: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found with this email');
    }

    return user;
  }

  // Helper method to map permission to response DTO
  private mapPermissionToResponse(permission: any, accessibleEvents?: any[]) {
    return {
      id: permission.id,
      scannerId: permission.scannerId,
      ownerId: permission.ownerId,
      scanner: this.mapUserSummary(permission.scanner),
      owner: this.mapUserSummary(permission.owner),
      isActive: permission.isActive,
      expiresAt: permission.expiresAt,
      createdAt: permission.createdAt,
      accessibleEvents: accessibleEvents || [],
    };
  }

  private mapUserSummary(user: PermissionUserSummary) {
    return {
      id: user.id,
      username: user.username || null,
      fullName: user.fullName || null,
      profilePicUrl: user.profilePicUrlTN || user.profilePicUrl || null,
    };
  }
}
