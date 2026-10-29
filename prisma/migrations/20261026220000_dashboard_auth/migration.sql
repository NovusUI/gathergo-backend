-- CreateEnum
CREATE TYPE "DashboardRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DashboardAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "DashboardUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "DashboardRole" NOT NULL DEFAULT 'USER',
    "status" "DashboardAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "DashboardUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardUser_username_key" ON "DashboardUser"("username");

-- CreateIndex
CREATE INDEX "DashboardUser_role_status_idx" ON "DashboardUser"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSession_tokenHash_key" ON "DashboardSession"("tokenHash");

-- CreateIndex
CREATE INDEX "DashboardSession_userId_expiresAt_idx" ON "DashboardSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "DashboardSession_expiresAt_idx" ON "DashboardSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "DashboardUser" ADD CONSTRAINT "DashboardUser_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "DashboardUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardSession" ADD CONSTRAINT "DashboardSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DashboardUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

