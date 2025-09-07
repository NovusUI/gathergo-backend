import { PartialType } from '@nestjs/mapped-types';
import { CreateCarpoolDto } from './create-carpool.dto';

export class UpdateCarpoolDto extends PartialType(CreateCarpoolDto) {}
