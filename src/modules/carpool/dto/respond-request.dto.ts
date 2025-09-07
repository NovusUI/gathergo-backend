import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class RespondRequestDto {
    @ApiProperty({ description: 'Response action', enum: ['ACCEPTED', 'DECLINED'] })
    @IsEnum(['ACCEPTED', 'DECLINED'], { message: 'Action must be either ACCEPTED or DECLINED' })
    action: 'ACCEPTED' | 'DECLINED';
}