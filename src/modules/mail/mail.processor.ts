import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('mailQueue')
export class MailProcessor extends WorkerHost {
  async process(job: Job) {
    const { name, email, eventTitle } = job.data;

    // Send email using your preferred service (e.g., nodemailer, Resend, SendGrid, etc.)
    console.log(`📧 Sending email to ${email}:`);
    console.log(`Hello ${name}, your ticket for "${eventTitle}" has been confirmed!`);

    // If using nodemailer:
    // await transporter.sendMail({ to: email, subject: 'Your Ticket', text: ... });
  }
}
