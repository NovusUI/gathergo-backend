import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CreateShortLinkDto, ShortCodeDto } from './short-links.dto';
import { ShortLinksService } from './short-links.service';

@ApiTags('Short links')
@Controller('share-links')
@UseGuards(JwtAuthGuard)
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create or reuse a short link for an event, food bank or carpool',
  })
  create(@Body() target: CreateShortLinkDto) {
    return this.links.create(target);
  }

  @Get(':code')
  @Public()
  @ApiOperation({
    summary: 'Resolve a public short code to its app destination',
  })
  resolve(@Param() { code }: ShortCodeDto) {
    return this.links.resolve(code);
  }
}

@ApiTags('Short links')
@Controller('s')
@Public()
export class ShortLinkRedirectController {
  constructor(private readonly links: ShortLinksService) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Redirect a branded short link to its full page URL',
  })
  async redirect(@Param() { code }: ShortCodeDto, @Res() response: Response) {
    const link = await this.links.resolve(code);
    const paths = {
      event: '/event',
      foodbank: '/food-bank',
      carpool: '/carpool',
    } as const;
    const url = new URL(
      `${paths[link.kind]}/${encodeURIComponent(link.targetId)}`,
      'https://gathergo.events',
    );
    response.setHeader('Cache-Control', 'no-store');
    response.redirect(302, url.toString());
  }
}
