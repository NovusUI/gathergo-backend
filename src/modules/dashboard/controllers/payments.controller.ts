import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { PaymentsService } from '../services/payments.service';
import { GetPaymentsDto } from '../dto/get-payments.dto';

@ApiTags('Dashboard')
@Controller('dashboard/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated payments' })
  @ApiResponse({ status: 200, description: 'Returns paginated payments' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getPayments(
    @CurrentUser('id') userId: string,
    @Query(new ValidationPipe({ transform: true })) dto: GetPaymentsDto,
  ) {
    const result = await this.paymentsService.getPayments(userId, dto);
    return {
      message: 'Payments retrieved successfully',
      ...result,
    };
  }
}
