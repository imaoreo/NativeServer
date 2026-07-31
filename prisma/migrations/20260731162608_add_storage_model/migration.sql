-- CreateTable
CREATE TABLE "Storage" (
    "id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "lastModifiedById" TEXT,

    CONSTRAINT "Storage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Storage_userId_idx" ON "Storage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Storage_userId_location_key" ON "Storage"("userId", "location");

-- AddForeignKey
ALTER TABLE "Storage" ADD CONSTRAINT "Storage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storage" ADD CONSTRAINT "Storage_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
