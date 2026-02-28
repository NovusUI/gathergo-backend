import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Delete,
  Patch,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import {
  GrantPermissionDto,
  UpdatePermissionDto,
  SearchUsersDto,
} from '../dto/permission.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ScannerPermissionsService } from './ scanner-permissions.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('scanner-permissions')
@ApiBearerAuth()
@Controller('scanner-permissions')
@UseGuards(JwtAuthGuard)
export class ScannerPermissionsController {
  constructor(private readonly permissionsService: ScannerPermissionsService) {}

  @Post('grant')
  @ApiOperation({ summary: 'Grant scanning permission to a user' })
  async grantPermission(
    @Body() grantPermissionDto: GrantPermissionDto,
    @Request() req,
  ) {
    return this.permissionsService.grantPermission(
      req.user.id,
      grantPermissionDto,
    );
  }

  @Patch(':permissionId')
  @ApiOperation({ summary: 'Update scanning permission' })
  async updatePermission(
    @Param('permissionId') permissionId: string,
    @Body() updatePermissionDto: UpdatePermissionDto,
    @Request() req,
  ) {
    return this.permissionsService.updatePermission(
      req.user.id,
      permissionId,
      updatePermissionDto,
    );
  }

  @Delete(':permissionId/revoke')
  @ApiOperation({ summary: 'Revoke scanning permission (deactivate)' })
  async revokePermission(
    @Param('permissionId') permissionId: string,
    @Request() req,
  ) {
    return this.permissionsService.revokePermission(req.user.id, permissionId);
  }

  @Get('my-granted')
  @ApiOperation({ summary: 'Get all permissions granted by me (as owner)' })
  async getOwnerPermissions(@CurrentUser('id') userId: string) {
    return this.permissionsService.getOwnerPermissions(userId);
  }

  @Get('my-permissions')
  @ApiOperation({
    summary: 'Get all events where user has scanning permissions',
  })
  async getUserPermissions(@Request() req) {
    return this.permissionsService.getUserScannerPermissions(req.user.id);
  }

  //   @Get('my-permission-owners')
  //   @ApiOperation({ summary: 'Get all owners who granted me permissions' })
  //   async getMyPermissionOwners(@Request() req) {
  //     return this.permissionsService.getMyPermissionsOwners(req.user.id);
  //   }

  @Get('search-users')
  @ApiOperation({ summary: 'Search users to grant permission to' })
  async searchUsers(@Query() searchUsersDto: SearchUsersDto, @Request() req) {
    return this.permissionsService.searchUsers(req.user.id, searchUsersDto);
  }

  @Get('can-scan/:eventId')
  @ApiOperation({ summary: 'Check if user can scan for an event' })
  async canScan(@Param('eventId') eventId: string, @Request() req) {
    const canMarkAsUsed = await this.permissionsService.canMarkAsUsed(
      req.user.id,
      eventId,
    );
    return {
      canScan: true, // Everyone can scan to view
      canMarkAsUsed,
      userId: req.user.id,
      eventId,
    };
  }
}
