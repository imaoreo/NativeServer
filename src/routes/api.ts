import { Router } from 'express';
import { prisma } from '../db.js';

// Decode geohash to lat/lon
const decodeGeohash = (geohash: string) => {
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let isEven = true;
  let latMin = -90, latMax = 90;
  let lonMin = -180, lonMax = 180;

  for (let i = 0; i < geohash.length; i++) {
    const c = geohash[i].toLowerCase();
    const cd = BASE32.indexOf(c);
    if (cd === -1) continue;

    for (let j = 0; j < 5; j++) {
      const mask = 1 << (4 - j);
      if (isEven) {
        const lonMid = (lonMin + lonMax) / 2;
        if ((cd & mask) !== 0) {
          lonMin = lonMid;
        } else {
          lonMax = lonMid;
        }
      } else {
        const latMid = (latMin + latMax) / 2;
        if ((cd & mask) !== 0) {
          latMin = latMid;
        } else {
          latMax = latMid;
        }
      }
      isEven = !isEven;
    }
  }

  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lonMin + lonMax) / 2
  };
};

// Trilaterate 3+ points
const trilaterate = (points: { lat: number; lon: number; r: number }[]) => {
  if (points.length < 3) return null;

  const lat0 = points[0].lat;
  const lon0 = points[0].lon;
  const latToMeters = 111132.954;
  const lonToMeters = 111132.954 * Math.cos(lat0 * Math.PI / 180);

  const localPoints = points.map(p => {
    const x = (p.lon - lon0) * lonToMeters;
    const y = (p.lat - lat0) * latToMeters;
    return { x, y, r: p.r };
  });

  const x0 = localPoints[0].x;
  const y0 = localPoints[0].y;
  const r0 = localPoints[0].r;

  const M: number[][] = [];
  const K: number[] = [];

  for (let i = 1; i < localPoints.length; i++) {
    const xi = localPoints[i].x;
    const yi = localPoints[i].y;
    const ri = localPoints[i].r;

    const A = 2 * (xi - x0);
    const B = 2 * (yi - y0);
    const C = (xi*xi - x0*x0) + (yi*yi - y0*y0) - (ri*ri - r0*r0);

    M.push([A, B]);
    K.push(C);
  }

  let mt_m_00 = 0, mt_m_01 = 0, mt_m_10 = 0, mt_m_11 = 0;
  let mt_k_0 = 0, mt_k_1 = 0;

  for (let i = 0; i < M.length; i++) {
    const A = M[i][0];
    const B = M[i][1];
    const C = K[i];

    mt_m_00 += A * A;
    mt_m_01 += A * B;
    mt_m_10 += B * A;
    mt_m_11 += B * B;

    mt_k_0 += A * C;
    mt_k_1 += B * C;
  }

  const det = mt_m_00 * mt_m_11 - mt_m_01 * mt_m_10;
  if (Math.abs(det) < 1e-6) return null;

  const inv_00 = mt_m_11 / det;
  const inv_01 = -mt_m_01 / det;
  const inv_10 = -mt_m_10 / det;
  const inv_11 = mt_m_00 / det;

  const x = inv_00 * mt_k_0 + inv_01 * mt_k_1;
  const y = inv_10 * mt_k_0 + inv_11 * mt_k_1;

  const lat = lat0 + y / latToMeters;
  const lon = lon0 + x / lonToMeters;

  return { lat, lon };
};

// Haversine formula
const getHaversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // Earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
};

const router = Router();

router.get('/profiles', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;
    const minAge = parseInt(req.query.minAge as string);
    const maxAge = parseInt(req.query.maxAge as string);
    const hasPhoto = req.query.hasPhoto === 'true';
    const gender = req.query.gender as string;
    const genderExclude = req.query.genderExclude as string;
    const lookingFor = req.query.lookingFor as string;
    const lookingForExclude = req.query.lookingForExclude as string;
    const tribe = req.query.tribe as string;
    const tribeExclude = req.query.tribeExclude as string;
    const ethnicity = req.query.ethnicity as string;
    const ethnicityExclude = req.query.ethnicityExclude as string;
    const sexualPosition = req.query.sexualPosition as string;
    const sexualPositionExclude = req.query.sexualPositionExclude as string;
    const onlineOnly = req.query.onlineOnly === 'true';
    const latitudeVal = parseFloat(req.query.latitude as string);
    const longitudeVal = parseFloat(req.query.longitude as string);
    const radiusVal = parseFloat(req.query.radius as string);

    const where: any = {};

    if (search) {
      where.displayName = {
        contains: search,
        mode: 'insensitive',
      };
    }

    if (!isNaN(minAge) || !isNaN(maxAge)) {
      where.age = {};
      if (!isNaN(minAge)) where.age.gte = minAge;
      if (!isNaN(maxAge)) where.age.lte = maxAge;
    }

    if (hasPhoto) {
      where.profileImageMediaHash = {
        not: null,
      };
    }

    if (onlineOnly) {
      where.onlineUntil = {
        gte: new Date(),
      };
    }

    if (
      gender || genderExclude ||
      lookingFor || lookingForExclude ||
      tribe || tribeExclude ||
      ethnicity || ethnicityExclude ||
      sexualPosition || sexualPositionExclude
    ) {
      const conditions: string[] = [];
      const params: any[] = [];

      // Helper for array fields (JSONB array contains or NOT contains)
      const handleArrayField = (rawDataKey: string, includeVal?: string, excludeVal?: string) => {
        if (includeVal) {
          const vals = includeVal.split(',').map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) {
            const orConds = vals.map(v => {
              params.push(v);
              return `("rawData"::jsonb -> '${rawDataKey}') @> $${params.length}`;
            });
            conditions.push(`(${orConds.join(' OR ')})`);
          }
        }
        if (excludeVal) {
          const vals = excludeVal.split(',').map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) {
            const andConds = vals.map(v => {
              params.push(v);
              return `NOT (("rawData"::jsonb -> '${rawDataKey}') @> $${params.length})`;
            });
            conditions.push(`(${andConds.join(' AND ')})`);
          }
        }
      };

      // Helper for scalar fields (JSONB scalar equal or NOT equal)
      const handleScalarField = (rawDataKey: string, includeVal?: string, excludeVal?: string) => {
        if (includeVal) {
          const vals = includeVal.split(',').map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) {
            const placeholders = vals.map(v => {
              params.push(v);
              return `$${params.length}`;
            });
            conditions.push(`("rawData"::jsonb ->> '${rawDataKey}') IN (${placeholders.join(', ')})`);
          }
        }
        if (excludeVal) {
          const vals = excludeVal.split(',').map(v => v.trim()).filter(Boolean);
          if (vals.length > 0) {
            const placeholders = vals.map(v => {
              params.push(v);
              return `$${params.length}`;
            });
            conditions.push(`(("rawData"::jsonb ->> '${rawDataKey}') NOT IN (${placeholders.join(', ')}) OR ("rawData"::jsonb -> '${rawDataKey}') IS NULL)`);
          }
        }
      };

      handleArrayField('genders', gender, genderExclude);
      handleArrayField('lookingFor', lookingFor, lookingForExclude);
      handleArrayField('grindrTribes', tribe, tribeExclude);
      handleScalarField('ethnicity', ethnicity, ethnicityExclude);
      handleScalarField('sexualPosition', sexualPosition, sexualPositionExclude);

      const sql = `SELECT id FROM "GrindrProfile" WHERE ${conditions.join(' AND ')}`;
      const result: { id: string }[] = await prisma.$queryRawUnsafe(sql, ...params);
      where.id = {
        in: result.map(r => r.id),
      };
    }

    if (!isNaN(latitudeVal) && !isNaN(longitudeVal) && !isNaN(radiusVal)) {
      const candidates = await prisma.grindrProfile.findMany({
        select: {
          id: true,
          distances: true
        }
      });

      const matchingIds: string[] = [];

      for (const profile of candidates) {
        if (profile.distances && profile.distances.length >= 3) {
          const points = profile.distances.map(d => {
            try {
              const coords = decodeGeohash(d.geohash);
              return { lat: coords.latitude, lon: coords.longitude, r: d.distance };
            } catch {
              return null;
            }
          }).filter((p): p is { lat: number, lon: number, r: number } => p !== null);

          const estLoc = trilaterate(points);
          if (estLoc) {
            const dist = getHaversineDistance(latitudeVal, longitudeVal, estLoc.lat, estLoc.lon);
            if (dist <= radiusVal) {
              matchingIds.push(profile.id);
            }
          }
        }
      }

      if (where.id && where.id.in) {
        const existingIds = where.id.in as string[];
        where.id.in = existingIds.filter(id => matchingIds.includes(id));
      } else {
        where.id = {
          in: matchingIds
        };
      }
    }

    const total = await prisma.grindrProfile.count({ where });

    const profiles = await prisma.grindrProfile.findMany({
      where,
      skip,
      take: limit,
      orderBy: {
        lastSeen: 'desc',
      },
      include: {
        medias: {
          orderBy: {
            firstSeen: 'desc',
          },
        },
      },
    });

    res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      profiles,
    });
  } catch (error) {
    console.error('Failed to fetch profiles:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/profiles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await prisma.grindrProfile.findUnique({
      where: { id },
      include: {
        medias: {
          orderBy: {
            firstSeen: 'desc',
          },
        },
        history: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        distances: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (error) {
    console.error('Failed to fetch profile:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
