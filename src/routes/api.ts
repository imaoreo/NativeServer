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
    const lookingFor = req.query.lookingFor as string;
    const tribe = req.query.tribe as string;
    const ethnicity = req.query.ethnicity as string;
    const sexualPosition = req.query.sexualPosition as string;
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

    if (gender || lookingFor || tribe || ethnicity || sexualPosition) {
      const conditions: string[] = [];
      const params: any[] = [];

      if (gender) {
        params.push(gender);
        conditions.push(`("rawData"::jsonb -> 'genders') @> $${params.length}`);
      }
      if (lookingFor) {
        params.push(lookingFor);
        conditions.push(`("rawData"::jsonb -> 'lookingFor') @> $${params.length}`);
      }
      if (tribe) {
        params.push(tribe);
        conditions.push(`("rawData"::jsonb -> 'grindrTribes') @> $${params.length}`);
      }
      if (ethnicity) {
        params.push(ethnicity);
        conditions.push(`("rawData"::jsonb ->> 'ethnicity') = $${params.length}`);
      }
      if (sexualPosition) {
        params.push(sexualPosition);
        conditions.push(`("rawData"::jsonb ->> 'sexualPosition') = $${params.length}`);
      }

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
