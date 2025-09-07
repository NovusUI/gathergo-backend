// src/users/dtos/complete-profile.dto.ts

import { ApiProperty,  } from '@nestjs/swagger';
import { IsNotEmpty, } from 'class-validator';



export class EditBioDto {
  @ApiProperty({
    example: 'something about me',
    description: 'something about the user',
  })

  @IsNotEmpty()
  bio: string;


}
