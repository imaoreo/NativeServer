import { Redis } from 'ioredis';
import { AuthenticatedWebSocket } from './types.js';
import { prisma } from '../../db.js';
import type { Prisma } from '@prisma/client';
import { generateReverseDiff, isMediaCached, saveMediaFile, isValidMediaHash, checkRateLimit, saveChatMediaFile, MAX_CHAT_MEDIA_BYTES, isValidGrindrId, saveAlbumMediaFile, albumMediaContentType, MAX_ALBUM_MEDIA_BYTES } from './helper.js';

export async function handleSyncSeenProfile(
  ws: AuthenticatedWebSocket,
  payload: any,
  redis: Redis
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('sync_seen_profile', 'Device not authenticated');
    return;
  }

  const profile = payload.profile || payload;
  const geohash = typeof payload.geohash === 'string' ? payload.geohash : null;

  if (!profile || typeof profile.profileId !== 'string') {
    ws.sendError('sync_seen_profile', 'Invalid profile payload');
    return;
  }

  const profileId = profile.profileId;
  const displayName = profile.displayName || null;
  const age = typeof profile.age === 'number' ? profile.age : null;
  const aboutMe = profile.aboutMe || null;
  const profileImageMediaHash = profile.profileImageMediaHash || null;
  const onlineUntil = profile.onlineUntil ? new Date(profile.onlineUntil) : null;
  
  const distance = typeof profile.distance === 'number' ? profile.distance : null;
  delete profile.distance;
  delete profile.distanceMeters;
  delete profile.unreadCount;
  delete profile.chatted;
  delete profile.tapped;
  delete profile.tapped;
  delete profile.isBlockable;
  delete profile.hasChattedInLast24Hrs;
  delete profile.hasUnviewedSpark;
  delete profile.isFavorite;
  delete profile.hasUnreadThrob;
  delete profile['@type'];
  
  const rawData = JSON.stringify(profile);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.grindrProfile.findUnique({
        where: { id: profileId }
      });

      if (!existing) {
        await tx.grindrProfile.create({
          data: {
            id: profileId,
            displayName,
            age,
            aboutMe,
            profileImageMediaHash,
            onlineUntil,
            rawData
          }
        });
      } else {
        const diffJson = generateReverseDiff(existing.rawData, rawData);

        if (diffJson) {
          await tx.grindrProfileHistory.create({
            data: {
              profileId,
              diffJson
            }
          });

          await tx.grindrProfile.update({
            where: { id: profileId },
            data: {
              displayName,
              age,
              aboutMe,
              profileImageMediaHash,
              onlineUntil,
              rawData
            }
          });
        } else {
          await tx.grindrProfile.update({
            where: { id: profileId },
            data: {
              lastSeen: new Date()
            }
          });
        }
      }

      if (distance !== null && geohash !== null && geohash.length > 0) {
        const distanceExists = await tx.grindrProfileDistance.findFirst({
          where: { profileId, distance, geohash }
        });

        if (!distanceExists) {
          await tx.grindrProfileDistance.create({
            data: {
              profileId,
              distance,
              geohash
            }
          });
        }
      }

      if (Array.isArray(profile.medias)) {
        for (const media of profile.medias) {
          if (!media.mediaHash) continue;
          
          const mediaCreatedAt = media.createdAt ? new Date(media.createdAt) : null;
          const cached = isMediaCached(media.mediaHash);

          await tx.grindrProfileMedia.upsert({
            where: { mediaHash: media.mediaHash },
            update: {
              lastSeen: new Date(),
              type: media.type,
              state: media.state,
              reason: media.reason || null,
              takenOnGrindr: media.takenOnGrindr !== undefined ? media.takenOnGrindr : null,
              createdAt: mediaCreatedAt,
              hasImage: cached
            },
            create: {
              mediaHash: media.mediaHash,
              profileId,
              type: media.type,
              state: media.state,
              reason: media.reason || null,
              takenOnGrindr: media.takenOnGrindr !== undefined ? media.takenOnGrindr : null,
              createdAt: mediaCreatedAt,
              hasImage: cached
            }
          });
        }
      }
    });

    const missingMediaHashes: string[] = [];
    if (Array.isArray(profile.medias)) {
      for (const media of profile.medias) {
        if (media.mediaHash && !isMediaCached(media.mediaHash)) {
          missingMediaHashes.push(media.mediaHash);
        }
      }
    }

    ws.sendSuccess('sync_seen_profile', 'Profile synced successfully', {
      profileId,
      missingMediaHashes
    });
  } catch (error) {
    console.error(`Failed to sync profile ${profileId}:`, error);
    ws.sendError('sync_seen_profile', 'Failed to sync profile');
  }
}

function extractMediaHash(imageUrl: string): string {
  if (!imageUrl) return '';
  const cleanUrl = imageUrl.split('?')[0].split('#')[0];
  const parts = cleanUrl.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

const PRIVATE_GRID_FIELDS = [
  'unreadCount', 'chatted', 'distanceMeters', 'distance', 'upsellItemType', 'viewed', 'tapped', 'isBlockable',
  'hasChattedInLast24Hrs', 'hasUnviewedSpark', 'isFavorite', 'hasUnreadThrob', '@type'
];

function stripPrivateGridFields(card: Record<string, any>): void {
  for (const field of PRIVATE_GRID_FIELDS) {
    delete card[field];
  }
}

type GridCard = {
  profileId: string;
  card: Record<string, any>;
  distance: number | null;
  onlineUntil: Date | null;
  pfpHash: string | null;
};

function gridPfpHash(card: Record<string, any>): string | null {
  const hash = typeof card.primaryImageUrl === 'string'
    ? extractMediaHash(card.primaryImageUrl)
    : (typeof card.profileImageMediaHash === 'string'
      ? card.profileImageMediaHash
      : (Array.isArray(card.photoMediaHashes) && card.photoMediaHashes.length > 0 && typeof card.photoMediaHashes[0] === 'string'
        ? card.photoMediaHashes[0]
        : null));
  return hash || null;
}

export async function handleSyncGrid(
  ws: AuthenticatedWebSocket,
  payload: any,
  redis: Redis
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('sync_grid', 'Device not authenticated');
    return;
  }

  const profiles: any[] = payload?.profiles;
  const geohash = typeof payload?.geohash === 'string' && payload.geohash.length > 0 ? payload.geohash : null;

  if (!Array.isArray(profiles) || profiles.length === 0) {
    ws.sendError('sync_grid', 'Invalid payload: profiles must be a non-empty array');
    return;
  }

  const cards = new Map<string, GridCard>();
  const missingMediaHashesSet = new Set<string>();

  for (const card of profiles) {
    const rawId = card?.profileId;
    if (rawId === undefined || rawId === null) continue;
    const profileId = String(rawId);

    const distance = typeof card.distanceMeters === 'number'
      ? card.distanceMeters
      : (typeof card.distance === 'number' ? card.distance : null);
    const onlineUntil = typeof card.onlineUntil === 'number' ? new Date(card.onlineUntil) : null;

    stripPrivateGridFields(card);

    const pfpHash = gridPfpHash(card);
    if (pfpHash && !isMediaCached(pfpHash)) {
      missingMediaHashesSet.add(pfpHash);
    }

    cards.set(profileId, { profileId, card, distance, onlineUntil, pfpHash });
  }

  ws.sendSuccess('sync_grid', `Grid received: ${cards.size}/${profiles.length} profiles queued`, {
    savedCount: cards.size,
    totalCount: profiles.length,
    missingMediaHashes: Array.from(missingMediaHashesSet)
  });

  saveGridCards([...cards.values()], geohash).catch((error) => {
    console.error(`[sync_grid] Failed to save ${cards.size} profiles:`, error);
  });
}

async function saveGridCards(cards: GridCard[], geohash: string | null): Promise<void> {
  if (cards.length === 0) return;
  const profileIds = cards.map((entry) => entry.profileId);

  const [existingProfiles, existingDistances] = await Promise.all([
    prisma.grindrProfile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, rawData: true }
    }),
    geohash
      ? prisma.grindrProfileDistance.findMany({
        where: { profileId: { in: profileIds }, geohash },
        select: { profileId: true, distance: true }
      })
      : Promise.resolve([])
  ]);

  const existingById = new Map(existingProfiles.map((profile) => [profile.id, profile.rawData]));
  const knownDistances = new Set(existingDistances.map((row) => `${row.profileId}|${row.distance}`));

  const newProfiles: Prisma.GrindrProfileCreateManyInput[] = [];
  const histories: Prisma.GrindrProfileHistoryCreateManyInput[] = [];
  const changedUpdates: Prisma.PrismaPromise<unknown>[] = [];
  const unchangedIds: string[] = [];
  const newDistances: Prisma.GrindrProfileDistanceCreateManyInput[] = [];

  for (const { profileId, card, distance, onlineUntil, pfpHash } of cards) {
    const existingRaw = existingById.get(profileId);

    if (existingRaw === undefined) {
      newProfiles.push({
        id: profileId,
        displayName: card.displayName ?? null,
        age: typeof card.age === 'number' ? card.age : null,
        profileImageMediaHash: pfpHash,
        onlineUntil,
        rawData: JSON.stringify(card)
      });
    } else {
      const existingDict: Record<string, any> = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : {};
      stripPrivateGridFields(existingDict);

      const mergedData = { ...existingDict, ...card };
      const rawData = JSON.stringify(mergedData);
      const diffJson = generateReverseDiff(existingRaw, rawData);

      if (diffJson) {
        const mergedPfpHash = typeof mergedData.primaryImageUrl === 'string'
          ? extractMediaHash(mergedData.primaryImageUrl)
          : (mergedData.profileImageMediaHash ?? null);

        histories.push({ profileId, diffJson });
        changedUpdates.push(prisma.grindrProfile.update({
          where: { id: profileId },
          data: {
            displayName: mergedData.displayName ?? null,
            age: typeof mergedData.age === 'number' ? mergedData.age : null,
            profileImageMediaHash: mergedPfpHash || null,
            onlineUntil,
            rawData
          }
        }));
      } else {
        unchangedIds.push(profileId);
      }
    }

    if (distance !== null && geohash !== null) {
      const key = `${profileId}|${distance}`;
      if (!knownDistances.has(key)) {
        knownDistances.add(key);
        newDistances.push({ profileId, distance, geohash });
      }
    }
  }

  await prisma.$transaction([
    prisma.grindrProfile.createMany({ data: newProfiles, skipDuplicates: true }),
    ...changedUpdates,
    prisma.grindrProfile.updateMany({ where: { id: { in: unchangedIds } }, data: { lastSeen: new Date() } }),
    prisma.grindrProfileHistory.createMany({ data: histories }),
    prisma.grindrProfileDistance.createMany({ data: newDistances })
  ]);
}

export async function handleUploadMedia(
  ws: AuthenticatedWebSocket,
  payload: any
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('upload_media', 'Device not authenticated');
    return;
  }

  const { mediaHash, base64Data } = payload || {};
  if (!isValidMediaHash(mediaHash) || typeof base64Data !== 'string') {
    ws.sendError('upload_media', 'Invalid payload');
    return;
  }

  if (base64Data.length > Math.ceil(MAX_CHAT_MEDIA_BYTES * 4 / 3) + 4) {
    ws.sendError('upload_media', 'Media too large');
    return;
  }

  try {
    await saveMediaFile(mediaHash, base64Data);

    await prisma.grindrProfileMedia.updateMany({
      where: { mediaHash },
      data: { hasImage: true }
    });

    ws.sendSuccess('upload_media', 'Media uploaded and cached successfully', { mediaHash });
  } catch (error) {
    console.error(`Failed to upload media ${mediaHash}:`, error);
    ws.sendError('upload_media', 'Failed to save media');
  }
}

export async function handleUploadChatMedia(
  ws: AuthenticatedWebSocket,
  payload: any,
  redis: Redis
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('upload_chat_media', 'Device not authenticated');
    return;
  }

  const { mediaHash, base64Data } = payload || {};
  if (!isValidMediaHash(mediaHash) || typeof base64Data !== 'string') {
    ws.sendError('upload_chat_media', 'Invalid payload');
    return;
  }

  if (base64Data.length > Math.ceil(MAX_CHAT_MEDIA_BYTES * 4 / 3) + 4) {
    ws.sendError('upload_chat_media', 'Media too large');
    return;
  }

  if (await checkRateLimit(redis, `rl:chatmedia:${deviceId}`, 60, 600)) {
    ws.sendError('upload_chat_media', 'Too many uploads');
    return;
  }

  try {
    await saveChatMediaFile(mediaHash, Buffer.from(base64Data, 'base64'));
    ws.sendSuccess('upload_chat_media', 'Chat media cached successfully', { mediaHash });
  } catch (error) {
    console.error(`Failed to upload chat media ${mediaHash}:`, error);
    ws.sendError('upload_chat_media', 'Failed to save media');
  }
}

export async function handleUploadAlbumMedia(
  ws: AuthenticatedWebSocket,
  payload: any,
  redis: Redis
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('upload_album_media', 'Device not authenticated');
    return;
  }

  const { albumId, contentId, ownerProfileId, base64Data } = payload || {};
  if (!isValidGrindrId(albumId) || !isValidGrindrId(contentId) || !isValidGrindrId(ownerProfileId) || typeof base64Data !== 'string') {
    ws.sendError('upload_album_media', 'Invalid payload');
    return;
  }

  if (base64Data.length > Math.ceil(MAX_ALBUM_MEDIA_BYTES * 4 / 3) + 4) {
    ws.sendError('upload_album_media', 'Media too large');
    return;
  }

  const existing = await prisma.grindrAlbumMedia.findUnique({ where: { albumId_contentId: { albumId, contentId } } });
  if (existing) {
    ws.sendSuccess('upload_album_media', 'Already backed up', { albumId, contentId });
    return;
  }

  if (await checkRateLimit(redis, `rl:albummedia:${deviceId}`, 120, 600)) {
    ws.sendError('upload_album_media', 'Too many uploads');
    return;
  }

  try {
    const fileName = await saveAlbumMediaFile(albumId, contentId, Buffer.from(base64Data, 'base64'));

    await prisma.grindrAlbumMedia.createMany({
      data: [{ albumId, contentId, ownerProfileId, contentType: albumMediaContentType(fileName), fileName, uploadedById: deviceId }],
      skipDuplicates: true
    });

    ws.sendSuccess('upload_album_media', 'Album media backed up', { albumId, contentId });
  } catch (error) {
    console.error(`Failed to back up album media ${albumId}/${contentId}:`, error);
    ws.sendError('upload_album_media', 'Failed to save media');
  }
}

const MAX_IMAGE_LOOKUPS = 100;

type ImageLookupMatch = { mediaHash: string; profileId: string | null; displayName: string | null };

async function lookupProfilesByImageHashes(mediaHashes: string[]): Promise<ImageLookupMatch[]> {
  const matches = new Map<string, { profileId: string; displayName: string | null }>();

  const medias = await prisma.grindrProfileMedia.findMany({
    where: { mediaHash: { in: mediaHashes } },
    select: { mediaHash: true, profileId: true, profile: { select: { displayName: true } } }
  });
  for (const media of medias) {
    matches.set(media.mediaHash, { profileId: media.profileId, displayName: media.profile.displayName });
  }

  const remaining = mediaHashes.filter((hash) => !matches.has(hash));
  if (remaining.length > 0) {
    const profiles = await prisma.grindrProfile.findMany({
      where: { profileImageMediaHash: { in: remaining } },
      select: { id: true, displayName: true, profileImageMediaHash: true },
      orderBy: { lastSeen: 'desc' }
    });
    for (const profile of profiles) {
      if (profile.profileImageMediaHash && !matches.has(profile.profileImageMediaHash)) {
        matches.set(profile.profileImageMediaHash, { profileId: profile.id, displayName: profile.displayName });
      }
    }
  }

  return mediaHashes.map((mediaHash) => ({
    mediaHash,
    profileId: matches.get(mediaHash)?.profileId ?? null,
    displayName: matches.get(mediaHash)?.displayName ?? null
  }));
}

export async function handleGetProfileByImageHash(
  ws: AuthenticatedWebSocket,
  payload: any
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('get_profile_by_image', 'Device not authenticated');
    return;
  }

  const { mediaHashes } = payload || {};

  if (!Array.isArray(mediaHashes) || mediaHashes.length === 0 || mediaHashes.length > MAX_IMAGE_LOOKUPS || !mediaHashes.every((hash) => typeof hash === 'string')) {
    ws.sendError('get_profile_by_image', `mediaHashes must be 1-${MAX_IMAGE_LOOKUPS} strings`);
    return;
  }

  try {
    const results = await lookupProfilesByImageHashes([...new Set(mediaHashes as string[])]);
    ws.sendSuccess('get_profile_by_image', 'Lookup complete', { profiles: results });
  } catch (error) {
    console.error(`Failed to lookup profiles by media hash:`, error);
    ws.sendError('get_profile_by_image', 'Failed to lookup profile by image hash');
  }
}
