export class ScanTicketDto {
  qrCode: string;
  scannerUserId?: string; // ID of user scanning the ticket
  location?: string; // Optional location data
}

export class TicketScanResponseDto {
  success: boolean;
  message: string;
  ticket?: {
    id: string;
    eventName: string;
    ticketType: string;
    userName: string;
    userEmail?: string;
    status: string;
    isUsed: boolean;
  };
}
