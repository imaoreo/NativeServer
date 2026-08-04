-- CreateTable
CREATE TABLE "GrindrProfile" (
    "id" TEXT NOT NULL,
    "displayName" TEXT,
    "age" INTEGER,
    "profileImageMediaHash" TEXT,
    "aboutMe" TEXT,
    "onlineUntil" TIMESTAMP(3),
    "rawData" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrindrProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrindrProfileHistory" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "diffJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrindrProfileHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrindrProfileDistance" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "geohash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrindrProfileDistance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrindrProfileMedia" (
    "mediaHash" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "state" INTEGER NOT NULL,
    "reason" TEXT,
    "takenOnGrindr" BOOLEAN,
    "createdAt" TIMESTAMP(3),
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasImage" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GrindrProfileMedia_pkey" PRIMARY KEY ("mediaHash")
);

-- CreateIndex
CREATE INDEX "GrindrProfileHistory_profileId_idx" ON "GrindrProfileHistory"("profileId");

-- CreateIndex
CREATE INDEX "GrindrProfileDistance_profileId_idx" ON "GrindrProfileDistance"("profileId");

-- CreateIndex
CREATE INDEX "GrindrProfileMedia_profileId_idx" ON "GrindrProfileMedia"("profileId");

-- AddForeignKey
ALTER TABLE "GrindrProfileHistory" ADD CONSTRAINT "GrindrProfileHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GrindrProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrindrProfileDistance" ADD CONSTRAINT "GrindrProfileDistance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GrindrProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrindrProfileMedia" ADD CONSTRAINT "GrindrProfileMedia_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "GrindrProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
