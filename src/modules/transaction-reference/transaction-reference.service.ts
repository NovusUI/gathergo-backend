import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionReferenceDto } from './dto/create-transaction-reference.dto';
import { PaystackService } from '../paystack/paystack.service';
import { PaystackResponse } from '../paystack/types/paystack-response.type';
import { nanoid } from 'nanoid';
//import { MailService } from '../mail/mail.service';
import { DonationService } from '../donation/donation.service';
import { InitiateDonationDto } from './dto/initiate-donation.dto';
import { TicketService } from '../ticket/ticket.service';
import { NotificationService } from '../notification/notification.service';
import { RegistrationService } from '../registration/registration.service';
import * as crypto from 'crypto';

@Injectable()
export class TransactionReferenceService {
  constructor(
    private prisma: PrismaService,
    private paystackService: PaystackService,
    //private mailService: MailService,
    private donationService: DonationService,
    private ticketService: TicketService,
    private registrationService: RegistrationService,
    private notificationService: NotificationService,
  ) {}

  async initiate(
    userId: string,
    email: string,
    dto: CreateTransactionReferenceDto,
  ) {
    let totalAmount = 0;
    const freeTickets: any[] = [];
    const paidTickets: any[] = [];
    const unavailableTickets: {
      id: string;
      reason: string;
      ticketName: string;
    }[] = [];
    let expectedAmount = 0;
    let eventId: null | string = null;

    for (const item of dto.items) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.id },
      });

      if (!eventId) eventId = eventTicket?.eventId || null;

      if (!eventTicket) {
        unavailableTickets.push({
          id: item.id,
          reason: 'Ticket not found',
          ticketName: item.ticketName,
        });
        continue;
      }

      const availableQty = Math.min(item.quantity, eventTicket.quantity);

      expectedAmount +=
        item.quantity * (eventTicket.updatedPrice || eventTicket.price);
      if (availableQty === 0) {
        unavailableTickets.push({
          id: item.id,
          reason: 'Out of stock',
          ticketName: eventTicket.type,
        });
        continue;
      }

      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.id,
          reason: `Only ${availableQty} tickets available out of requested ${item.quantity}`,
          ticketName: eventTicket.type,
        });
      }

      const totalPrice =
        (eventTicket.updatedPrice || eventTicket.price) * availableQty;

      if (eventTicket.price === 0) {
        freeTickets.push({
          eventTicketId: item.id,
          quantity: availableQty,
          ticketName: eventTicket.type,
        });
      } else {
        paidTickets.push({
          eventTicketId: item.id,
          quantity: availableQty,
          totalPrice,
          ticketName: eventTicket.type,
        });
        totalAmount += totalPrice;
      }
    }

    // ✅ Create transaction reference regardless of totalAmount
    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        amount: totalAmount,
        eventId: eventId,
        status:
          totalAmount > 0
            ? 'PENDING'
            : expectedAmount > 0
              ? 'FAILED'
              : 'SUCCESS',
        metadata: {
          paidTickets,
          unavailableTickets,
          ...(eventId && { eventId }),
        },
      },
    });

    // ✅ Create free tickets immediately
    for (const freeTicket of freeTickets) {
      await this.prisma.ticket.createMany({
        data: Array.from({ length: freeTicket.quantity }).map(() => ({
          eventTicketId: freeTicket.eventTicketId,
          userId,
          qrCode: nanoid(16),
          transactionId: transactionRef.id,
        })),
      });

      // Update stock
      await this.prisma.eventTicket.update({
        where: { id: freeTicket.eventTicketId },
        data: { sold: { increment: freeTicket.quantity } },
      });
    }

    let paymentInitResponse: PaystackResponse | null = null;

    if (totalAmount > 0) {
      paymentInitResponse = await this.paystackService.initializeTransaction({
        email,
        amount: totalAmount * 100, // in kobo
        reference: transactionRef.id,
        callback_url: `https://yourcallback.com'`, // <-- adjust to your app
        metadata: {
          cancel_action: 'https://your-cancel-url.com',
        },
      });
    }

    return {
      message: paymentInitResponse?.message,
      transactionId: transactionRef.id,
      paymentUrl: paymentInitResponse?.data?.authorization_url || null,
      unavailableTickets,
      freeTickets,
      totalAmount: totalAmount,
      status: paymentInitResponse?.status,
    };
  }

  async initiateRegistration(userId: string, email: string, eventId: string) {
    console.log(eventId);
    // ✅ Fetch the event and its registration details
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error('Event not found');
    }

    const price = event.registrationFee || 0; // Ensure fallback

    // ✅ Create transaction reference
    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        amount: price,
        eventId: eventId,
        status: price > 0 ? 'PENDING' : 'SUCCESS',
        metadata: {
          type: 'REGISTRATION',
          eventId,
        },
      },
    });

    // ✅ If registration is free, create it immediately
    if (price === 0) {
      await this.prisma.registration.create({
        data: {
          userId,
          qrCode: nanoid(16),
          transactionId: transactionRef.id,
          eventId,
        },
      });
    }

    let paymentInitResponse: PaystackResponse | null = null;

    if (price > 0) {
      paymentInitResponse = await this.paystackService.initializeTransaction({
        email,
        amount: price * 100, // Paystack expects kobo
        reference: transactionRef.id,
        callback_url: `https://yourcallback.com/payment-success`, // ✅ Update to your app
        metadata: {
          cancel_action: 'https://yourapp.com/payment-cancel', // optional
        },
      });
    }

    return {
      message: paymentInitResponse?.message,
      status: paymentInitResponse?.status,
      transactionId: transactionRef.id,
      paymentUrl: paymentInitResponse?.data?.authorization_url || null,
      totalAmount: price,
    };
  }

  async initiateDonation(
    userId: string,
    email: string,
    dto: InitiateDonationDto,
  ) {
    const { eventId, amount, message, isAnonymous } = dto;

    // ✅ Fetch the event to verify it's a donation event
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Verify event is donation type
    if (event.registrationType !== 'donation') {
      throw new BadRequestException('Event is not a donation event');
    }

    // Verify minimum amount
    if (amount < 500) {
      throw new BadRequestException(
        'Minimum donation amount is ₦1000 (100000 kobo)',
      );
    }

    // ✅ Create transaction reference
    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        amount: amount,
        status: 'PENDING',
        eventId: eventId,
        metadata: {
          type: 'DONATION',
          eventId,
          message,
          isAnonymous: isAnonymous || false,
        },
      },
    });

    // ✅ Initialize Paystack payment
    const paymentInitResponse =
      await this.paystackService.initializeTransaction({
        email,
        amount: amount * 100,
        reference: transactionRef.id,
        callback_url: `https://yourcallback.com/donation-success`, // Update with your actual callback URL
        metadata: {
          cancel_action: 'https://yourapp.com/donation-cancel',
        },
      });

    return {
      message: paymentInitResponse?.message,
      status: paymentInitResponse?.status,
      transactionId: transactionRef.id,
      paymentUrl: paymentInitResponse?.data?.authorization_url,
      totalAmount: amount * 100,
      amountInNaira: amount,
      event: {
        id: event.id,
        title: event.title,
      },
    };
  }

  // async verifyPayment(payload: any, signature: string) {
  //   console.log(payload);

  //   const secret = process.env.PAYSTACK_SECRET_KEY;

  //   if (!secret) {
  //     throw new InternalServerErrorException(
  //       'Paystack secret key not configured',
  //     );
  //   }

  //   const hash = crypto
  //     .createHmac('sha512', secret)
  //     .update(JSON.stringify(payload))
  //     .digest('hex');

  //   if (hash !== signature) {
  //     throw new UnauthorizedException('Invalid Paystack signature');
  //   }
  // }
  async verifyPayment(payload: any, signature: string) {
    console.log(payload.data.reference);
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret) {
      throw new InternalServerErrorException(
        'Paystack secret key not configured',
      );
    }

    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (hash !== signature) {
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    const { data } = payload;

    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: data.reference },
      include: {
        user: true,
      },
    });

    if (!transaction || transaction.status !== 'PENDING') {
      throw new BadRequestException('Invalid or already processed transaction');
    }

    if (payload.data.amount !== transaction.amount * 100) {
      throw new BadRequestException('Amount mismatch');
    }

    // Verify payment from Paystack
    // const paystackResponse =
    //   await this.paystackService.verifyTransaction(reference);

    // if (
    //   !paystackResponse.status ||
    //   paystackResponse.data.status !== 'success'
    // ) {
    //   await this.prisma.transactionReference.update({
    //     where: { id: reference },
    //     data: { status: 'FAILED' },
    //   });
    //   throw new BadRequestException('Payment verification failed');
    // }

    // ✅ Guard: Check metadata type
    if (
      !transaction.metadata ||
      typeof transaction.metadata !== 'object' ||
      Array.isArray(transaction.metadata)
    ) {
      throw new BadRequestException('Invalid metadata format');
    }

    const metadata = transaction.metadata as Record<string, any>;
    const paidTickets = metadata.paidTickets || [];
    let unavailableTickets: {
      id: string;
      reason: string;
      ticketName: string;
    }[] = [];

    console.log(metadata.type);

    if (metadata.type === 'REGISTRATION') {
      await this.registrationService.createRegistration(
        metadata.eventId,
        transaction.userId,
        transaction.id,
      );
    } else if (metadata.type === 'DONATION') {
      // ✅ Create donation using DonationService
      try {
        const donation = await this.donationService.createDonation(
          {
            eventId: metadata.eventId,
            amount: transaction.amount,
            message: metadata.message,
            isAnonymous: metadata.isAnonymous,
            transactionId: transaction.id,
          },
          transaction.userId,
          transaction.user.username ?? '',
        );

        // Update transaction metadata with donation info
        const updatedMetadata = {
          ...metadata,
          donationId: donation.id,
          donationCreated: true,
        };

        await this.prisma.transactionReference.update({
          where: { id: data.reference },
          data: {
            status: 'SUCCESS',
            metadata: updatedMetadata,
          },
        });

        // Send donation confirmation email
        // await this.mailService.sendDonationConfirmationEmail({
        //   email: transaction.user.email,
        //   name: transaction.user.username || transaction.user.fullName || 'Donor',
        //   eventTitle: donation.event?.title || 'Event',
        //   amount: donation.amountInNaira,
        //   message: donation.message,
        //   transactionId: donation.transactionId,
        // });

        return {
          message: 'Payment verified and donation recorded',
          donation,
        };
      } catch (error) {
        // If donation creation fails, mark transaction as failed
        await this.prisma.transactionReference.update({
          where: { id: data.reference },
          data: { status: 'FAILED' },
        });
        throw new BadRequestException(
          `Donation creation failed: ${error.message}`,
        );
      }
    } else {
      try {
        const tickets = await this.ticketService.create(
          transaction,
          paidTickets,
          metadata.eventId,
          transaction.user.username ?? '',
        );
        unavailableTickets = tickets || [];
      } catch (error) {
        console.log(error);
      }
    }

    // ✅ Update metadata safely
    const updatedMetadata = {
      ...metadata,
      ...(['REGISTRATION', 'DONATION'].includes(metadata.type)
        ? {}
        : { unavailableTickets }),
    };

    await this.prisma.transactionReference.update({
      where: { id: data.reference },
      data: {
        status: 'SUCCESS',
        metadata: updatedMetadata,
      },
    });

    // await this.mailService.sendTicketConfirmationEmail({
    //   email: transaction.user.email,
    //   name: transaction.user.username || 'customer',
    //   eventTitle: 'eventnme', // or get from event info
    // });
    return {
      message: 'Payment verified and tickets issued',
      unavailableTickets,
    };
  }

  async getTransactionStatus(id: string) {
    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return {
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
    };
  }

  async getTicketOrRegistrationByTrasactionId(
    transactionId: string,
    type: string,
  ) {
    if (type === 'TICKETS') {
      const tickets = await this.prisma.ticket.findMany({
        where: { transactionId },
        include: {
          eventTicket: {
            include: {
              event: {
                select: {
                  title: true,
                  startDate: true,
                  endDate: true,
                  thumbnailUrl: true,
                },
              },
            },
          },
        },
      });

      return tickets.map((ticket) => ({
        ...ticket,
        eventTicketType: ticket.eventTicket.type,
        event: ticket.eventTicket.event,
      }));
    }

    if (type === 'REGISTRATION') {
      const registrations = await this.prisma.registration.findMany({
        where: { transactionId },
        include: {
          event: {
            select: {
              title: true,
              startDate: true,
              endDate: true,
              thumbnailUrl: true,
            },
          },
        },
      });

      return registrations;
    }

    if (type === 'DONATION') {
      const donation = await this.prisma.donation.findFirst({
        where: { transactionId },
        include: {
          event: {
            select: {
              title: true,
              startDate: true,
              endDate: true,
              thumbnailUrl: true,
              description: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              profilePicUrl: true,
            },
          },
        },
      });

      if (!donation) {
        throw new NotFoundException('Donation not found for this transaction');
      }

      return {
        ...donation,
        amountInNaira: donation.amount / 100,
      };
    }
  }
}
