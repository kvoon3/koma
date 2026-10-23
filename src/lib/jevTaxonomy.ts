/**
 * The tag categories Jev answers for. The icon set is the taxonomy: every
 * non-fallback `TagIconKey` gets one Noul question, and the question id is the
 * icon key. A label is the capitalized id, so the model can never invent a
 * chip the rest of the app does not already know how to draw.
 */
import type { TagIconKey } from './tagIcons'
import { TAG_ICON_NODES } from './tagIcons'

/** The fallback mark is not a subject, so it is not a category. */
export type JevCategoryId = Exclude<TagIconKey, 'tag'>

export interface JevCategory {
  readonly id: JevCategoryId
  readonly label: string
  readonly instruction: string
  readonly criteria: Readonly<{ true: string, false: string }>
}

interface CategoryDefinition {
  readonly instruction: string
  readonly criteria: Readonly<{ true: string, false: string }>
}

/**
 * One narrow judgment per category. The criteria name what counts as yes and
 * no, so overlapping subjects (cat, dog, pet) stay independently answerable.
 */
const DEFINITIONS = {
  person: {
    instruction: 'Does this photo show a person?',
    criteria: {
      true: 'At least one person is clearly visible, including a face, a body, or a silhouette.',
      false: 'No person is visible anywhere in the photo.',
    },
  },
  family: {
    instruction: 'Does this photo show a family?',
    criteria: {
      true: 'Two or more people appear together in a way that reads as a family, such as parents with children or several generations.',
      false: 'The photo shows no people, or only people who do not read as a family group.',
    },
  },
  cat: {
    instruction: 'Does this photo show a cat?',
    criteria: {
      true: 'A domestic cat is clearly visible, including a kitten.',
      false: 'No cat is visible anywhere in the photo.',
    },
  },
  dog: {
    instruction: 'Does this photo show a dog?',
    criteria: {
      true: 'A dog is clearly visible, including a puppy.',
      false: 'No dog is visible anywhere in the photo.',
    },
  },
  pet: {
    instruction: 'Does this photo show a pet animal?',
    criteria: {
      true: 'A kept animal is clearly visible, such as a cat, dog, bird, rabbit, or fish.',
      false: 'No kept animal is visible.',
    },
  },
  food: {
    instruction: 'Does this photo show food?',
    criteria: {
      true: 'Prepared or raw food is clearly visible, including a meal, snack, or ingredient.',
      false: 'No food is visible.',
    },
  },
  drink: {
    instruction: 'Does this photo show a drink?',
    criteria: {
      true: 'A beverage is clearly visible, such as coffee, tea, juice, beer, or wine.',
      false: 'No beverage is visible.',
    },
  },
  nature: {
    instruction: 'Does this photo show nature?',
    criteria: {
      true: 'A natural scene or plant life fills a meaningful part of the photo, such as a forest, garden, flowers, or grassland.',
      false: 'No natural element is prominent.',
    },
  },
  beach: {
    instruction: 'Does this photo show a beach?',
    criteria: {
      true: 'Sand, surf, or a shoreline is clearly visible.',
      false: 'No beach or shoreline is visible.',
    },
  },
  mountain: {
    instruction: 'Does this photo show mountains?',
    criteria: {
      true: 'A mountain, a peak, or a mountain range is clearly visible.',
      false: 'No mountain is visible.',
    },
  },
  city: {
    instruction: 'Does this photo show a city?',
    criteria: {
      true: 'Buildings, streets, or a skyline show an urban area.',
      false: 'No urban area is visible.',
    },
  },
  car: {
    instruction: 'Does this photo show a car?',
    criteria: {
      true: 'A car or another road vehicle is clearly visible.',
      false: 'No car is visible.',
    },
  },
  plane: {
    instruction: 'Does this photo show an airplane?',
    criteria: {
      true: 'An airplane is clearly visible, on the ground or in the air.',
      false: 'No airplane is visible.',
    },
  },
  art: {
    instruction: 'Does this photo show art?',
    criteria: {
      true: 'A painting, sculpture, drawing, or museum display is clearly visible.',
      false: 'No artwork is visible.',
    },
  },
  night: {
    instruction: 'Was this photo taken at night?',
    criteria: {
      true: 'The scene is dark and lit by artificial light, moonlight, or a night sky.',
      false: 'The scene is lit by daylight or is clearly not at night.',
    },
  },
  snow: {
    instruction: 'Does this photo show snow?',
    criteria: {
      true: 'Snow, ice, or a snowy landscape is clearly visible.',
      false: 'No snow or ice is visible.',
    },
  },
  celebration: {
    instruction: 'Does this photo show a celebration?',
    criteria: {
      true: 'People, decorations, or a cake clearly show an event such as a party, wedding, or festival.',
      false: 'No celebration is visible.',
    },
  },
} satisfies Record<JevCategoryId, CategoryDefinition>

/**
 * The category order follows `TAG_ICON_NODES`, so the icon set and the
 * taxonomy cannot drift. A test pins the two lists to the same ids.
 */
export const JEV_CATEGORY_IDS: readonly JevCategoryId[] = (
  Object.keys(TAG_ICON_NODES) as TagIconKey[]
).filter((key): key is JevCategoryId => key !== 'tag')

export const JEV_CATEGORIES: readonly JevCategory[] = JEV_CATEGORY_IDS.map(id => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  ...DEFINITIONS[id],
}))

const BY_ID = new Map<string, JevCategory>(JEV_CATEGORIES.map(category => [category.id, category]))

export function jevCategory(id: string): JevCategory | undefined {
  return BY_ID.get(id)
}
