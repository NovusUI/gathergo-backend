import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';

@Global() // Makes it accessible app-wide
@Module({
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
