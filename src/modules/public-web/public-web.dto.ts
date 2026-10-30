import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { ApplyToVolunteerDto } from '../volunteer/dto/volunteer-application.dto';

export class WebEmailDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class WebVerifyEmailDto {
  @IsUUID()
  challengeId: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class WebVolunteerDto extends ApplyToVolunteerDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;
}
