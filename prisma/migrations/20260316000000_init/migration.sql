-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CREATOR', 'STREAMER', 'PRODUCER', 'BRAND', 'MODERATOR', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "profileId" TEXT,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "walletAddress" TEXT,
    "campaignLimit" INTEGER NOT NULL DEFAULT 10,
    "firstLoginIp" TEXT,
    "firstLoginAt" TIMESTAMP(3),
    "referralCode" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "isReferralQualified" BOOLEAN NOT NULL DEFAULT false,
    "referredById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CREATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordId" TEXT,
    "discordTag" TEXT,
    "guildRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedById" TEXT,
    "invitesCount" INTEGER NOT NULL DEFAULT 0,
    "bio" VARCHAR(200),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "location" TEXT,
    "showEarnings" BOOLEAN NOT NULL DEFAULT false,
    "socialLinks" JSONB,
    "username" TEXT,
    "website" TEXT,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_profileId_key" ON "User"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_discordId_key" ON "Profile"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_username_key" ON "Profile"("username");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
