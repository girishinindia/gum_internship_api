import { Router } from 'express';
import type { Request, Response } from 'express';
import { ApiResponse } from '../../core/apiResponse';
import { asyncHandler } from '../../core/asyncHandler';
import { zodValidate } from '../../middlewares/zodValidate';
import { CACHE_SECONDS, cacheHeader, catalogService } from './service';
import { catalogListSchema, idParamSchema, slugParamSchema } from './schemas';
import type { CatalogListInput } from './schemas';

/** Public, anonymous, CDN-cacheable. No auth middleware on purpose. */
const router = Router();

router.get(
  '/catalog/categories',
  asyncHandler(async (_req: Request, res: Response) => {
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.categories));
    ApiResponse.ok(res, await catalogService.categories());
  }),
);

router.get(
  '/catalog/internships',
  zodValidate(catalogListSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = req.query as unknown as CatalogListInput;
    const { items, pagination } = await catalogService.list(input);
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.list));
    ApiResponse.paginated(res, items, pagination);
  }),
);

router.get(
  '/catalog/internships/:slug',
  zodValidate(slugParamSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const detail = await catalogService.detail(req.params.slug as string);
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.detail));
    ApiResponse.ok(res, detail);
  }),
);

router.get(
  '/catalog/banners',
  asyncHandler(async (req: Request, res: Response) => {
    const { query } = await import('../../db/pool');
    const placement = typeof req.query.placement === 'string' ? req.query.placement : null;
    const rows = await query(
      `select id, title, image_url as "imageUrl", link_url as "linkUrl", placement, display_order as "displayOrder"
       from cms_banners
       where is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now())
         and ($1::banner_placement is null or placement = $1::banner_placement)
       order by display_order`,
      [placement],
    );
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.list));
    ApiResponse.ok(res, rows);
  }),
);

router.get(
  '/catalog/pages/:slug',
  zodValidate(slugParamSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const { queryOne } = await import('../../db/pool');
    const page = await queryOne(
      `select slug, title, content_md as "contentMd", meta_title as "metaTitle", meta_description as "metaDescription"
       from cms_pages where slug = $1 and is_published`,
      [req.params.slug],
    );
    if (!page) {
      const { AppError } = await import('../../core/appError');
      throw AppError.notFound('Page');
    }
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.detail));
    ApiResponse.ok(res, page);
  }),
);

router.get(
  '/catalog/instructors/:id',
  zodValidate(idParamSchema, 'params'),
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await catalogService.instructor(Number(req.params.id));
    res.set('Cache-Control', cacheHeader(CACHE_SECONDS.instructor));
    ApiResponse.ok(res, profile);
  }),
);

export default router;
