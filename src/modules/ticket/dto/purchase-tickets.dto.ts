import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseTicketItemDto {
  @ApiProperty({ example: 'ticket_id_123' })
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  quantity: number;
}

export class PurchaseTicketsDto {
  @ApiProperty({ type: [PurchaseTicketItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseTicketItemDto)
  items: PurchaseTicketItemDto[];
}
