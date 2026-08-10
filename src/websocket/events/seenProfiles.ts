import { Redis } from 'ioredis';
import { AuthenticatedWebSocket } from './types.js';
import { prisma } from '../../db.js';
import { generateReverseDiff, isMediaCached, saveMediaFile } from './helper.js';

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
  const geohash = typeof payload?.geohash === 'string' ? payload.geohash : null;

  if (!Array.isArray(profiles) || profiles.length === 0) {
    ws.sendError('sync_grid', 'Invalid payload: profiles must be a non-empty array');
    return;
  }

  let savedCount = 0;
  const missingMediaHashesSet = new Set<string>();

  for (const card of profiles) {
    const rawId = card?.profileId;
    if (rawId === undefined || rawId === null) continue;
    const profileId = String(rawId);

    // Remove privacy-sensitive fields
    delete card.unreadCount;
    delete card.chatted;
    delete card.upsellItemType;
    delete card.viewed;
    delete card.tapped;
    delete card.isBlockable;
    delete card.hasChattedInLast24Hrs;
    delete card.hasUnviewedSpark;
    delete card.isFavorite;
    delete card.hasUnreadThrob;
    delete card['@type'];

    const distance = typeof card.distanceMeters === 'number'
      ? card.distanceMeters
      : (typeof card.distance === 'number' ? card.distance : null);

    delete card.distanceMeters;
    delete card.distance;

    const onlineUntil = typeof card.onlineUntil === 'number'
      ? new Date(card.onlineUntil)
      : null;

    // Determine profile image media hash
    const pfpHash = typeof card.primaryImageUrl === 'string'
      ? extractMediaHash(card.primaryImageUrl)
      : (typeof card.profileImageMediaHash === 'string'
        ? card.profileImageMediaHash
        : (Array.isArray(card.photoMediaHashes) && card.photoMediaHashes.length > 0 && typeof card.photoMediaHashes[0] === 'string'
          ? card.photoMediaHashes[0]
          : null));
    
    if (pfpHash && !isMediaCached(pfpHash)) {
      missingMediaHashesSet.add(pfpHash);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.grindrProfile.findUnique({
          where: { id: profileId }
        });

        if (!existing) {
          const rawData = JSON.stringify(card);
          const displayName = card.displayName ?? null;
          const age = typeof card.age === 'number' ? card.age : null;
          const profileImageMediaHash = pfpHash || null;

          await tx.grindrProfile.create({
            data: { id: profileId, displayName, age, profileImageMediaHash, onlineUntil, rawData }
          });
        } else {
          const existingDict: Record<string, any> =
            typeof existing.rawData === 'string' ? JSON.parse(existing.rawData) : {};

          // Remove privacy-sensitive fields from existing rawData to prevent merging them back
          delete existingDict.unreadCount;
          delete existingDict.chatted;
          delete existingDict.distanceMeters;
          delete existingDict.distance;
          delete existingDict.upsellItemType;
          delete existingDict.viewed;
          delete existingDict.tapped;
          delete existingDict.isBlockable;
          delete existingDict.hasChattedInLast24Hrs;
          delete existingDict.hasUnviewedSpark;
          delete existingDict.isFavorite;
          delete existingDict.hasUnreadThrob;
          delete existingDict['@type'];

          const mergedData = { ...existingDict, ...card };
          const rawData = JSON.stringify(mergedData);
          
          const displayName = mergedData.displayName ?? null;
          const age = typeof mergedData.age === 'number' ? mergedData.age : null;
          
          const mergedPfpHash = typeof mergedData.primaryImageUrl === 'string'
            ? extractMediaHash(mergedData.primaryImageUrl)
            : (mergedData.profileImageMediaHash ?? null);
          const profileImageMediaHash = mergedPfpHash || null;

          const diffJson = generateReverseDiff(existing.rawData, rawData);

          if (diffJson) {
            await tx.grindrProfileHistory.create({
              data: { profileId, diffJson }
            });
            await tx.grindrProfile.update({
              where: { id: profileId },
              data: { displayName, age, profileImageMediaHash, onlineUntil, rawData }
            });
          } else {
            await tx.grindrProfile.update({
              where: { id: profileId },
              data: { lastSeen: new Date() }
            });
          }
        }

        if (distance !== null && geohash !== null && geohash.length > 0) {
          const distanceExists = await tx.grindrProfileDistance.findFirst({
            where: { profileId, distance, geohash }
          });

          if (!distanceExists) {
            await tx.grindrProfileDistance.create({
              data: { profileId, distance, geohash }
            });
          }
        }
      });

      savedCount++;
    } catch (error) {
      console.error(`[sync_grid] Failed to sync profile ${profileId}:`, error);
    }
  }

  ws.sendSuccess('sync_grid', `Grid synced: ${savedCount}/${profiles.length} profiles saved`, {
    savedCount,
    totalCount: profiles.length,
    missingMediaHashes: Array.from(missingMediaHashesSet)
  });
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
  if (typeof mediaHash !== 'string' || typeof base64Data !== 'string') {
    ws.sendError('upload_media', 'Invalid payload');
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

export async function handleGetProfileByImageHash(
  ws: AuthenticatedWebSocket,
  payload: any
): Promise<void> {
  const deviceId = ws.deviceId;
  if (!deviceId) {
    ws.sendError('get_profile_by_image', 'Device not authenticated');
    return;
  }

  const { mediaHash } = payload || {};
  if (typeof mediaHash !== 'string') {
    ws.sendError('get_profile_by_image', 'Invalid mediaHash');
    return;
  }

  try {
    const media = await prisma.grindrProfileMedia.findUnique({
      where: { mediaHash },
      select: { profileId: true }
    });

    ws.sendSuccess('get_profile_by_image', 'Lookup complete', {
      mediaHash,
      profileId: media ? media.profileId : null
    });
  } catch (error) {
    console.error(`Failed to lookup profile by media hash ${mediaHash}:`, error);
    ws.sendError('get_profile_by_image', 'Failed to lookup profile by image hash');
  }
}
