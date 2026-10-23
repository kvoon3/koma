import type { IconNode } from 'lucide'
import {
  Building2,
  Car,
  Cat,
  Coffee,
  Dog,
  Leaf,
  Moon,
  Mountain,
  Palette,
  PartyPopper,
  PawPrint,
  Plane,
  Snowflake,
  Tag,
  TreePalm,
  User,
  Users,
  Utensils,
} from 'lucide'

/**
 * Keyword to icon for a photo tag. The icon keys are the stable contract: a
 * renderer draws `TAG_ICON_NODES[tagIcon(name)]`, and an unknown name gets the
 * neutral Tag mark. Rule order is priority, so specific subjects sit above
 * broad ones.
 *
 * ASCII keywords match at a word boundary with an optional plural suffix.
 * Chinese keywords match anywhere, because Chinese has no word breaks.
 */
export type TagIconKey
  = | 'person'
    | 'family'
    | 'cat'
    | 'dog'
    | 'pet'
    | 'food'
    | 'drink'
    | 'nature'
    | 'beach'
    | 'mountain'
    | 'city'
    | 'car'
    | 'plane'
    | 'art'
    | 'night'
    | 'snow'
    | 'celebration'
    | 'tag'

export const TAG_ICON_NODES: Record<TagIconKey, IconNode> = {
  person: User,
  family: Users,
  cat: Cat,
  dog: Dog,
  pet: PawPrint,
  food: Utensils,
  drink: Coffee,
  nature: Leaf,
  beach: TreePalm,
  mountain: Mountain,
  city: Building2,
  car: Car,
  plane: Plane,
  art: Palette,
  night: Moon,
  snow: Snowflake,
  celebration: PartyPopper,
  tag: Tag,
}

export const FALLBACK_TAG_ICON: TagIconKey = 'tag'

interface TagIconRule {
  key: Exclude<TagIconKey, 'tag'>
  keywords: readonly string[]
}

const RULES: readonly TagIconRule[] = [
  {
    key: 'celebration',
    keywords: ['celebration', 'party', 'parties', 'birthday', 'wedding', 'festival', 'holiday', 'christmas', 'firework', 'fireworks', '庆祝', '派对', '聚会', '生日', '婚礼', '节日', '圣诞', '烟花'],
  },
  {
    key: 'family',
    keywords: ['family', 'families', 'parents', '家庭', '全家', '家人', '亲子'],
  },
  {
    key: 'person',
    keywords: ['person', 'people', 'portrait', 'selfie', 'friend', 'child', 'children', 'kid', 'baby', '人物', '人像', '自拍', '肖像', '朋友', '孩子', '婴儿', '人'],
  },
  {
    key: 'food',
    keywords: ['food', 'meal', 'dinner', 'lunch', 'breakfast', 'pizza', 'cake', 'dessert', 'ice cream', 'sushi', 'noodle', 'ramen', 'hot dog', '美食', '食物', '吃', '餐', '蛋糕', '甜点', '寿司', '面', '火锅'],
  },
  {
    key: 'drink',
    keywords: ['drink', 'coffee', 'tea', 'beer', 'wine', 'cocktail', 'juice', '咖啡', '饮品', '饮料', '茶', '啤酒', '红酒', '白酒', '酒水'],
  },
  {
    key: 'cat',
    keywords: ['cat', 'kitten', 'kitty', '猫'],
  },
  {
    key: 'dog',
    keywords: ['dog', 'puppy', '狗'],
  },
  {
    key: 'pet',
    keywords: ['pet', 'animal', '宠物', '动物'],
  },
  {
    key: 'beach',
    keywords: ['beach', 'sea', 'ocean', 'water', 'wave', 'surf', 'island', '海边', '海滩', '沙滩', '海', '水', '浪', '岛'],
  },
  {
    key: 'snow',
    keywords: ['snow', 'winter', 'ski', 'skiing', 'snowman', '雪', '冬天', '滑雪'],
  },
  {
    key: 'mountain',
    keywords: ['mountain', 'hill', 'hike', 'hiking', 'peak', '山', '登山', '爬山', '雪山'],
  },
  {
    key: 'nature',
    keywords: ['nature', 'plant', 'flower', 'tree', 'forest', 'garden', 'leaf', 'park', '自然', '植物', '花', '树', '森林', '花园', '叶', '公园', '草'],
  },
  {
    key: 'city',
    keywords: ['city', 'building', 'architecture', 'apartment', 'street', 'skyline', 'town', 'urban', '城市', '建筑', '街', '楼', '都市'],
  },
  {
    key: 'car',
    keywords: ['car', 'vehicle', 'drive', 'road', '汽车', '车', '自驾', '公路'],
  },
  {
    key: 'plane',
    keywords: ['plane', 'airplane', 'flight', 'airport', 'travel', '飞机', '航班', '机场', '旅行'],
  },
  {
    key: 'art',
    keywords: ['art', 'artist', 'artwork', 'painting', 'museum', 'gallery', 'sculpture', 'drawing', '艺术', '画', '博物馆', '展览', '雕塑'],
  },
  {
    key: 'night',
    keywords: ['night', 'evening', 'dusk', 'moon', '夜', '夜晚', '晚上', '星空', '月亮'],
  },
]

const ASCII_KEYWORD = /^[\x20-\x7E]+$/

/** ASCII needs a word boundary and an optional plural; Chinese matches anywhere. */
function matchesKeyword(name: string, keyword: string): boolean {
  if (!ASCII_KEYWORD.test(keyword))
    return name.includes(keyword)
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z])${escaped}(?:s|es)?(?:[^a-z]|$)`).test(name)
}

export function tagIcon(name: string): TagIconKey {
  const lower = name.toLocaleLowerCase()
  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (matchesKeyword(lower, keyword))
        return rule.key
    }
  }
  return FALLBACK_TAG_ICON
}
