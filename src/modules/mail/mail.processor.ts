import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
 import { Resend } from 'resend';
 import { ConfigService } from '@nestjs/config';
 import { GithubTemplateService } from './github-template.service';
import { Injectable, Logger } from '@nestjs/common';

@Processor('mailQueue')
@Injectable()
export class MailProcessor extends WorkerHost {
  private resend: Resend;
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private configService: ConfigService,
    private githubTemplateService: GithubTemplateService
  ) {
    super();
    const apiKey = this.configService.get<string>('resend.apiKey');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    this.resend = new Resend(apiKey);
  }

  async process(job: Job) {
    const { name, data } = job;

    try {
      switch (name) {
        case 'ticketConfirmation':
          await this.processTicketConfirmation(data);
          break;
        case 'donationConfirmation':
          await this.processDonationConfirmation(data);
          break;
        case 'registrationConfirmation':
          await this.processRegistrationConfirmation(data);
          break;
        case 'donationTargetReached':
          await this.processDonationTargetReached(data);
          break;
        case 'welcomeEmail':
          await this.processWelcomeEmail(data);
          break;
        case 'customEmail':
          await this.processCustomEmail(data);
          break;
        default:
          this.logger.warn(`Unknown job type: ${name}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}:`, error);
      // You might want to implement retry logic here
      throw error;
    }
  }

  private async processTicketConfirmation(data: any) {
    const {
      to,
      name,
      eventTitle,
      eventDate,
      venue,
      ticketId,
      ticketType,
      price,
      quantity,
      eventImage,
      qrCode,
      cc,
      bcc,
      replyTo,
      subject,
    } = data;

    const html = await this.githubTemplateService.getTemplate('ticket-confirmation', {
      name,
      eventTitle,
      eventDate: eventDate || 'TBD',
      venue: venue || 'Online',
      ticketId: ticketId || 'N/A',
      ticketType: ticketType || 'General Admission',
      price: price ? `$${price.toFixed(2)}` : 'Free',
      quantity: quantity || 1,
      totalAmount: price && quantity ? `$${(price * quantity).toFixed(2)}` : 'Free',
      eventImage: eventImage || '',
      qrCode: qrCode || '',
      year: new Date().getFullYear(),
      currentDate: new Date().toLocaleDateString(),
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject: subject || `Your Ticket Confirmation: ${eventTitle}`,
   
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
      template: {id:"",variables:JSON.parse(html)}
    });

    this.logger.log(`Ticket confirmation email sent to ${to}`);
  }

  private async processDonationConfirmation(data: any) {
    const {
      to,
      name,
      amount,
      currency = 'USD',
      donationId,
      campaignTitle,
      campaignId,
      paymentMethod,
      isRecurring = false,
      recurrence,
      taxReceipt = false,
      cc,
      bcc,
      replyTo,
      subject,
    } = data;

    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);

    const html = await this.githubTemplateService.getTemplate('donation-confirmation', {
      name,
      amount: formattedAmount,
      rawAmount: amount,
      currency,
      donationId: donationId || 'N/A',
      campaignTitle: campaignTitle || 'General Fund',
      campaignId: campaignId || '',
      paymentMethod: paymentMethod || 'Credit Card',
      isRecurring,
      recurrence: recurrence || 'Monthly',
      taxReceipt,
      transactionDate: new Date().toLocaleDateString(),
      transactionTime: new Date().toLocaleTimeString(),
      year: new Date().getFullYear(),
      // Generate receipt number if not provided
      receiptNumber: donationId ? `REC-${donationId}` : `REC-${Date.now()}`,
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject: subject || `Donation Confirmation - Thank You!`,
        template: {id:"",variables:JSON.parse(html)},
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
    });

    this.logger.log(`Donation confirmation email sent to ${to}`);
  }

  private async processRegistrationConfirmation(data: any) {
    const {
      to,
      name,
      eventTitle,
      eventDate,
      venue,
      registrationId,
      registrationType,
      confirmationCode,
      loginUrl,
      profileUrl,
      cc,
      bcc,
      replyTo,
      subject,
    } = data;

    const html = await this.githubTemplateService.getTemplate('registration-confirmation', {
      name,
      eventTitle: eventTitle || 'Event Registration',
      eventDate: eventDate || 'TBD',
      venue: venue || 'Online',
      registrationId: registrationId || 'N/A',
      registrationType: registrationType || 'Attendee',
      confirmationCode: confirmationCode || 'N/A',
      loginUrl: loginUrl || '#',
      profileUrl: profileUrl || '#',
      registrationDate: new Date().toLocaleDateString(),
      year: new Date().getFullYear(),
      supportEmail: 'support@example.com',
      eventManager: 'events@example.com',
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject: subject || 'Registration Confirmation',
      template: {id:"",variables:JSON.parse(html)},
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
    });

    this.logger.log(`Registration confirmation email sent to ${to}`);
  }

  private async processDonationTargetReached(data: any) {
    const {
      to,
      campaignTitle,
      targetAmount,
      currentAmount,
      donorsCount,
      campaignUrl,
      campaignImage,
      organizerName,
      cc,
      bcc,
      replyTo,
      subject,
    } = data;

    const formattedTarget = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(targetAmount);

    const formattedCurrent = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(currentAmount);

    const percentage = Math.min(100, Math.round((currentAmount / targetAmount) * 100));

    const html = await this.githubTemplateService.getTemplate('donation-target-reached', {
      campaignTitle,
      targetAmount: formattedTarget,
      currentAmount: formattedCurrent,
      rawTargetAmount: targetAmount,
      rawCurrentAmount: currentAmount,
      donorsCount,
      campaignUrl: campaignUrl || '#',
      campaignImage: campaignImage || '',
      organizerName: organizerName || 'The Campaign Team',
      percentage,
      achievementDate: new Date().toLocaleDateString(),
      year: new Date().getFullYear(),
      // Calculate overfunding if any
      overfundedAmount: currentAmount > targetAmount ?
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(currentAmount - targetAmount) : '$0.00',
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject: subject || `🎉 We Did It! ${campaignTitle} Target Reached!`,
      template: {id:"",variables:JSON.parse(html)},
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
    });

    this.logger.log(`Donation target reached email sent to ${to}`);
  }

  private async processWelcomeEmail(data: any) {
    const { to, name, activationLink, loginLink, profileSetupLink, cc, bcc, replyTo, subject } = data;

    const html = await this.githubTemplateService.getTemplate('welcome', {
      name,
      activationLink: activationLink || '#',
      loginLink: loginLink || '#',
      profileSetupLink: profileSetupLink || '#',
      year: new Date().getFullYear(),
      signupDate: new Date().toLocaleDateString(),
      supportEmail: 'support@example.com',
      communityUrl: 'https://community.example.com',
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject: subject || 'Welcome to Our Community!',
      template: {id:"",variables:JSON.parse(html)},
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
    });

    this.logger.log(`Welcome email sent to ${to}`);
  }

  private async processCustomEmail(data: any) {
    const {
      templateName,
      to,
      subject,
      variables,
      cc,
      bcc,
      replyTo,
      attachments,
    } = data;

    const html = await this.githubTemplateService.getTemplate(templateName, {
      ...variables,
      year: new Date().getFullYear(),
      currentDate: new Date().toLocaleDateString(),
    });

    await this.resend.emails.send({
      from: this.configService.get<string>('resend.defaultFrom'),
      to: Array.isArray(to) ? to : [to],
      subject,
     
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo,
      attachments,
      template: {id:"",variables:JSON.parse(html)},
    });

    this.logger.log(`Custom email ${templateName} sent to ${to}`);
  }
}
