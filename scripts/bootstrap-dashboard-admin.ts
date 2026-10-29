import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import {
  DashboardAccountStatus,
  DashboardRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { CreateDashboardUserDto } from '../src/modules/dashboard-auth/dashboard-auth.dto';
import { DASHBOARD_BCRYPT_ROUNDS } from '../src/modules/dashboard-auth/dashboard-auth.types';

async function bootstrap() {
  await ConfigModule.forRoot({ envFilePath: ['.env.local', '.env'] });
  const dto = plainToInstance(CreateDashboardUserDto, {
    username: process.env.DASHBOARD_BOOTSTRAP_USERNAME,
    fullName: process.env.DASHBOARD_BOOTSTRAP_FULL_NAME,
    password: process.env.DASHBOARD_BOOTSTRAP_PASSWORD,
    role: DashboardRole.ADMIN,
  });
  const errors = await validate(dto);
  if (errors.length)
    throw new Error(
      'Set DASHBOARD_BOOTSTRAP_USERNAME (3–40 letters/numbers/._-), DASHBOARD_BOOTSTRAP_FULL_NAME, and DASHBOARD_BOOTSTRAP_PASSWORD (at least 12 characters; at most 72 UTF-8 bytes).',
    );
  const passwordHash = await bcrypt.hash(dto.password, DASHBOARD_BCRYPT_ROUNDS);
  delete process.env.DASHBOARD_BOOTSTRAP_PASSWORD;
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.dashboardUser.count({
          where: {
            role: DashboardRole.ADMIN,
            status: DashboardAccountStatus.ACTIVE,
          },
        });
        if (existing)
          throw new Error(
            'An active dashboard admin already exists. Use Dashboard users to create additional accounts.',
          );
        await tx.dashboardUser.create({
          data: {
            username: dto.username,
            fullName: dto.fullName,
            role: DashboardRole.ADMIN,
            passwordHash,
            mustChangePassword: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    process.stdout.write(
      `Dashboard admin "${dto.username}" created. Change the temporary password at first sign-in.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Dashboard bootstrap failed.'}\n`,
  );
  process.exitCode = 1;
});
