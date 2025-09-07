import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceTokenService } from './device-token.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';


@Controller('device-token')
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async save(@Req() req, @Body('token') token: string) {
    await this.deviceTokenService.saveToken(req.user.id, token);
    return { message: 'Token saved successfully' };
  }
}
