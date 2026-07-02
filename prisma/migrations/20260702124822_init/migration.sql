-- CreateTable
CREATE TABLE "ProfileImage" (
    "id" TEXT NOT NULL,
    "mediaHash" TEXT NOT NULL,
    "imageLocation" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileImage_mediaHash_key" ON "ProfileImage"("mediaHash");
