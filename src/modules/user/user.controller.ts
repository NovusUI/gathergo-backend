import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CompleteProfileDto } from './dto/complete-profile-dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { EditBioDto } from './dto/edit-bio-dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('user')
@ApiTags('Users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Patch('complete-profile')
  @ApiOperation({ summary: 'Complete user profile after signup' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  async completeProfile(@CurrentUser('id') userId: string, @Body() dto: CompleteProfileDto) {
    return this.userService.completeProfile(userId, dto);
  }

  @Patch('edit-bio')
  @ApiOperation({ summary: 'Edit user bio' })
  @ApiResponse({ status: 200, description: 'bios editted succesfully' })
  async editBio(@CurrentUser('id') userId: string, @Body() dto: EditBioDto) {
    return this.userService.editUserBio(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  async getAllUsers() {
    return this.userService.getAllUsers();
  }

  @Get('by-email/:email')
  @ApiOperation({ summary: 'Get user by email' })
  @ApiParam({ name: 'email', description: 'User email' })
  async getUserByEmail(@Param('email') email: string) {
    return this.userService.getUserByEmail(email);
  }



  @Get('public/:userId')
  @ApiOperation({ summary: 'Get public user profile' })
  @ApiParam({ name: 'userId', description: 'Target user ID' })
  @ApiResponse({ status: 200, description: 'Public profile fetched' })
  async getPublicProfile(
    @Param('userId') targetUserId: string,
    @CurrentUser('id') viewerId?: string,
  ) {
    return this.userService.getPublicProfile(targetUserId, viewerId);
  }

  @Post('/profile-picture')
  @ApiOperation({ summary: 'Upload a profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file']
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async updateProfilePicture(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.userService.updateProfilePicture(userId, file);
  }
}
