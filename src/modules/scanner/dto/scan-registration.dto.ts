export class ScanRegistrationDto {
  qrCode: string;
  scannerUserId?: string;
  location?: string;
}

export class RegistrationScanResponseDto {
  success: boolean;
  message: string;
  registration?: {
    id: string;
    eventName: string;
    userName: string;
    userEmail?: string;
    status: string;
    isUsed: boolean;
  };
}
