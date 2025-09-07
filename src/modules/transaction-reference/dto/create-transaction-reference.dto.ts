import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsUUID, IsInt, Min,IsString } from 'class-validator';

export class TransactionTicketItemDto {
  @ApiProperty({ example: 'uuid-of-ticket-type' })
  @IsUUID()
  id: string; // eventTicketId

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({example:"ticket name"})
  @IsString()
  ticketName: string
}

export class CreateTransactionReferenceDto {
  @ApiProperty({
    type: [TransactionTicketItemDto],
    description: 'List of tickets to purchase (id and quantity)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransactionTicketItemDto)
  items: TransactionTicketItemDto[];
}
