// src/validation/validation.module.ts
import { Module } from '@nestjs/common';
import { CarpoolValidationService } from './carpool-validation.service';

@Module({
  providers: [CarpoolValidationService],
  exports: [CarpoolValidationService],
})
export class ValidationModule {}
