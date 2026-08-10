import { Router } from 'express';
import { prisma } from '../db.js';

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
