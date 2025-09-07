import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTransactionReferenceDto } from './dto/create-transaction-reference.dto';
import { PaystackService } from '../paystack/paystack.service';
import { PaystackResponse } from '../paystack/types/paystack-response.type';
import { nanoid } from 'nanoid';
import { MailService } from '../mail/mail.service';



@Injectable()
export class TransactionReferenceService {
  constructor(
    private prisma: PrismaService,
    private paystackService: PaystackService,
    private mailService: MailService,
  ) {}

  async initiate(userId: string,email:string, dto: CreateTransactionReferenceDto) {
  
    
    let totalAmount = 0;
    const freeTickets:any[] = [];
    const paidTickets :any[]= [];
    const unavailableTickets:{ id: string; reason: string; ticketName: string }[]= [];
    let expectedAmount =0
  
    for (const item of dto.items) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.id },
      });
  
      if (!eventTicket) {
        unavailableTickets.push({ id: item.id, reason: 'Ticket not found', ticketName: item.ticketName });
        continue;
      }
  
      const availableQty = Math.min(item.quantity, eventTicket.quantity);
       
      expectedAmount += item.quantity * (eventTicket.updatedPrice || eventTicket.price)
      if (availableQty === 0) {
        unavailableTickets.push({ id: item.id, reason: 'Out of stock', ticketName: eventTicket.type });
        continue;
      }
  
      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.id,
          reason: `Only ${availableQty} tickets available out of requested ${item.quantity}`,
          ticketName: eventTicket.type
        });
      }
  
      const totalPrice = (eventTicket.updatedPrice || eventTicket.price) * availableQty;
  
      if (eventTicket.price === 0) {
        freeTickets.push({ eventTicketId: item.id, quantity: availableQty,ticketName: eventTicket.type });
      } else {
        paidTickets.push({
          eventTicketId: item.id,
          quantity: availableQty,
          totalPrice,
          ticketName: eventTicket.type
        });
        totalAmount += totalPrice;
      }
    }
  
   
  
    // ✅ Create transaction reference regardless of totalAmount
    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        amount: totalAmount,
        status: totalAmount > 0 ? 'PENDING' : expectedAmount >0 ? 'FAILED':   'SUCCESS',
        metadata: {
          paidTickets,
          unavailableTickets,
          
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
          transactionId: transactionRef.id
        })),
      });
  
      // Update stock
      await this.prisma.eventTicket.update({
        where: { id: freeTicket.eventTicketId },
        data: {sold: { increment: freeTicket.quantity } },
      });
    }
  
    let paymentInitResponse: PaystackResponse | null = null;
  
    if (totalAmount > 0) {
      paymentInitResponse = await this.paystackService.initializeTransaction(
        {
            email,
            amount: totalAmount *100,            // in kobo
            reference: transactionRef.id,
            callback_url: `https://yourcallback.com'`, // <-- adjust to your app
            metadata:{
              "cancel_action": "https://your-cancel-url.com"
            }
          }
      );
    }
  
    return {
      message: paymentInitResponse?.message,
      transactionId: transactionRef.id,
      paymentUrl:paymentInitResponse?.data?.authorization_url || null,
      unavailableTickets,
      freeTickets,
      totalAmount: totalAmount,
      status: paymentInitResponse?.status
    };
  }


  async initiateRegistration(userId: string, email: string, eventId: string) {

    console.log(eventId)
    // ✅ Fetch the event and its registration details
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
  
    if (!event) {
      throw new Error("Event not found");
    }
  
    const price = event.registrationFee || 0; // Ensure fallback

  
    // ✅ Create transaction reference
    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        amount: price,
        status: price > 0 ?"PENDING":"SUCCESS",
        metadata: {
          type: "REGISTRATION",
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
          cancel_action: "https://yourapp.com/payment-cancel", // optional
        },
      });
    }
  
    return {
      message: paymentInitResponse?.message,
      status: paymentInitResponse?.status,
      transactionId: transactionRef.id,
      paymentUrl: paymentInitResponse?.data?.authorization_url || null,
      totalAmount: price 
    };
  }
  
  

  async verifyPayment(reference: string) {
    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: reference },
      include: {
        user: true, // 🟢 Include user details
       
      },
    });
  
    if (!transaction || transaction.status !== 'PENDING') {
      throw new BadRequestException('Invalid or already processed transaction');
    }
  
    // Verify payment from Paystack
    const paystackResponse = await this.paystackService.verifyTransaction(reference);
  
    if (!paystackResponse.status || paystackResponse.data.status !== 'success') {
      await this.prisma.transactionReference.update({
        where: { id: reference },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('Payment verification failed');
    }
  
    // ✅ Guard: Check metadata type
    if (!transaction.metadata || typeof transaction.metadata !== 'object' || Array.isArray(transaction.metadata)) {
      throw new BadRequestException('Invalid metadata format');
    }
  
    const metadata = transaction.metadata as Record<string, any>;
    const paidTickets = metadata.paidTickets || [];
    const unavailableTickets: { id: string; reason: string, ticketName: string }[] =  [];

    console.log(metadata.type)

    if(metadata.type === "REGISTRATION"){


      await this.prisma.registration.create({
      
        data:{
          eventId: metadata.eventId,
          userId: transaction.userId,
          qrCode: nanoid(16),
          transactionId: transaction.id

        }
      });
  
     
    }
  
    else{
    for (const item of paidTickets) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.eventTicketId },
      });
  
      if (!eventTicket) {
        unavailableTickets.push({ id: item.eventTicketId, reason: 'Ticket not found during verification' ,ticketName: item.ticketName});
        continue;
      }
  
      const availableQty = Math.min(item.quantity, eventTicket.quantity);
  
      if (availableQty === 0) {
        unavailableTickets.push({ id: item.eventTicketId, reason: 'Out of stock during verification',ticketName: item.ticketName });
        continue;
      }
  
      // Create tickets
      await this.prisma.ticket.createMany({
        data: Array.from({ length: availableQty }).map(() => ({
          eventTicketId: item.eventTicketId,
          userId: transaction.userId,
          qrCode: nanoid(16),
          transactionId: transaction.id

        })),
      });
  
      // Update stock
      await this.prisma.eventTicket.update({
        where: { id: item.eventTicketId },
        data: { sold: { increment: availableQty } },
      });
  
      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: `Only ${availableQty} issued out of ${item.quantity} requested`,
          ticketName: item.ticketName
        });
      }
    }
  }
  
    // ✅ Update metadata safely
    const updatedMetadata = {
      ...metadata,
     ...(metadata.type === "REGISTRATION" ? {unavailableTickets}:{}),
    };
  
    await this.prisma.transactionReference.update({
      where: { id: reference },
      data: {
        status:  'SUCCESS',
        metadata: updatedMetadata,
      },
    });
  
    await this.mailService.sendTicketConfirmationEmail({
      email: transaction.user.email,
      name: transaction.user.username || "customer",
      eventTitle: "eventnme" // or get from event info
    });
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

  async getTicketOrRegistrationByTrasactionId(transactionId: string, type: string) {
    if (type === "TICKETS") {
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
  
   
      return tickets.map(ticket => ({
        ...ticket,
        eventTicketType: ticket.eventTicket.type,
        event: ticket.eventTicket.event,
      }));
    }
  
    if (type === "REGISTRATION") {
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
  
    throw new BadRequestException("type not found");
  }
  
  
  
}
