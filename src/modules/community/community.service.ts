import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';

@Injectable()
export class CommunityService {
  constructor(private prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateCommunityDto) {
    return this.prisma.community.create({
      data: {
        ...dto,
        ownerId,
      },
    });
  }

  async findAll() {
    return this.prisma.community.findMany();
  }

  async findOne(id: string) {
    const community = await this.prisma.community.findUnique({
      where: { id },
    });

    if (!community) throw new NotFoundException('Community not found');
    return community;
  }

  async update(id: string, dto: UpdateCommunityDto) {
    return this.prisma.community.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    return this.prisma.community.delete({
      where: { id },
    });
  }
}
