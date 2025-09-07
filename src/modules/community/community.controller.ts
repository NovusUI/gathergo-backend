import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Patch,
    Delete,
    UseGuards,
  } from '@nestjs/common';
  import { CommunityService } from './community.service';
  import { CreateCommunityDto } from './dto/create-community.dto';
  import { UpdateCommunityDto } from './dto/update-community.dto';
  import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
  import { CurrentUser } from 'src/common/decorators/current-user.decorator';
  import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
  
  @ApiTags('Communities')
  @Controller('communities')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  export class CommunityController {
    constructor(private readonly communityService: CommunityService) {}
  
    @Post()
    
    async create(@CurrentUser('id') userId: string, @Body() dto: CreateCommunityDto) {
      return this.communityService.create(userId, dto);
    }
  
    @Get()
    async findAll() {
      return this.communityService.findAll();
    }
  
    @Get(':id')
    async findOne(@Param('id') id: string) {
      return this.communityService.findOne(id);
    }
  
    @Patch(':id')

    async update(@Param('id') id: string, @Body() dto: UpdateCommunityDto) {
      return this.communityService.update(id, dto);
    }
  
    @Delete(':id')

    async remove(@Param('id') id: string) {
      return this.communityService.remove(id);
    }
  }
  