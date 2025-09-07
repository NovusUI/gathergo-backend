import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class MediaService {
  constructor(private readonly firebase: FirebaseService) {}

  async uploadFile(file: Express.Multer.File, folder: string = 'posts') {
    console.log(file,"fileeeeeee")
    if (!file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image uploads are allowed');
    }

    // Main upload
    const url = await this.firebase.uploadPostMedia(
      file.buffer,
      file.mimetype,
      file.originalname,
      folder,
    );

    // Thumbnail upload
    const thumbnailUrl = await this.firebase.uploadResizedImage(
      file.buffer,
      300,
      60,
      folder,
      '-thumb',
    );

    return {
      url,
      thumbnailUrl,
    };
  }


  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // Extract the file path from the URL
      const decodedPath = decodeURIComponent(
        fileUrl.split('/o/')[1].split('?')[0] // Firebase Storage URL pattern
      );
  
      await this.firebase.deleteFile(decodedPath);
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new InternalServerErrorException('Failed to delete old image');
    }
  }
  
}
