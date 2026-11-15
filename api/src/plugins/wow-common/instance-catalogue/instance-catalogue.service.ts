/**
 * ROK-2210: Nest wrapper over the instance catalogue's pure functions —
 * the `get(id, variant)` ROK-2207 story 1 assumes. Owned by the blizzard
 * plugin (`WowCommonModule`).
 */
import { Injectable } from '@nestjs/common';
import { getInstance, listInstances } from './instance-catalogue';
import type {
  CatalogueCategory,
  CatalogueInstance,
  CatalogueVariant,
} from './instance-catalogue.types';

@Injectable()
export class InstanceCatalogueService {
  /** Listed rows of one variant and category, in list order. */
  list(
    variant: CatalogueVariant,
    category: CatalogueCategory,
  ): CatalogueInstance[] {
    return listInstances(variant, category);
  }

  /** The row for (id, variant), or null for an unknown id. */
  get(id: number, variant: CatalogueVariant): CatalogueInstance | null {
    return getInstance(id, variant);
  }
}
