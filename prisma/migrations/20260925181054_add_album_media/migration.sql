-- CreateTable
CREATE TABLE "GrindrAlbumMedia" (
    "albumId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "ownerProfileId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrindrAlbumMedia_pkey" PRIMARY KEY ("albumId","contentId")
);

-- CreateIndex
CREATE INDEX "GrindrAlbumMedia_ownerProfileId_idx" ON "GrindrAlbumMedia"("ownerProfileId");

