/**
 * 스크립트는 (주제) (장소) (소요시간) 00 플레이스홀더가 든 템플릿이다.
 * OPIc은 주제가 랜덤으로 나오므로 같은 스크립트를 여러 주제로 바꿔 연습하는 게 핵심.
 */
export interface Topic {
  name: string
  /** (주제) 대입어 — 영어 */
  en: string
  /** (장소) 대입어 */
  placeEn?: string
  /** 00 (구체적 최애) 대입어 */
  favoriteEn?: string
  /**
   * 과거비교 스크립트의 00 자리에 쓰는 산업·시스템 이름.
   * 교재 TIP: "사람들이 쇼핑하는 방식 → shopping industry" 처럼 주제를 산업으로 바꿔 대입한다.
   */
  industryEn?: string
  /** 선택주제(설문에서 고른 것) / 돌발주제 */
  kind: 'selected' | 'surprise'
}

export const TOPIC_PRESETS: Topic[] = [
  // ── 선택주제 ────────────────────────────────────────────
  { kind: 'selected', name: '영화보기', en: 'watching movies', placeEn: 'movie theater', favoriteEn: 'action movies', industryEn: 'movie industry' },
  { kind: 'selected', name: '음악감상', en: 'listening to music', placeEn: 'concert hall', favoriteEn: 'ballad music', industryEn: 'music industry' },
  { kind: 'selected', name: '콘서트', en: 'going to concerts', placeEn: 'concert hall', favoriteEn: 'outdoor festivals', industryEn: 'music industry' },
  { kind: 'selected', name: '공원가기', en: 'going to the park', placeEn: 'park', favoriteEn: 'having a picnic' },
  { kind: 'selected', name: '해변가기', en: 'going to the beach', placeEn: 'beach', favoriteEn: 'walking along the shore' },
  { kind: 'selected', name: '쇼핑', en: 'shopping', placeEn: 'shopping mall', favoriteEn: 'online shopping', industryEn: 'shopping industry' },
  { kind: 'selected', name: '조깅', en: 'jogging', placeEn: 'park', favoriteEn: 'running along the river', industryEn: 'health industry' },
  { kind: 'selected', name: '자전거', en: 'riding my bike', placeEn: 'bike trail', favoriteEn: 'riding along the river', industryEn: 'health industry' },
  { kind: 'selected', name: '걷기', en: 'going for a walk', placeEn: 'park', favoriteEn: 'walking at night', industryEn: 'health industry' },
  { kind: 'selected', name: '수영', en: 'swimming', placeEn: 'swimming pool', favoriteEn: 'the indoor pool', industryEn: 'health industry' },
  { kind: 'selected', name: '헬스', en: 'working out', placeEn: 'gym', favoriteEn: 'weight training', industryEn: 'health industry' },
  { kind: 'selected', name: '카페가기', en: 'going to cafes', placeEn: 'cafe', favoriteEn: 'an iced americano' },
  { kind: 'selected', name: '국내여행', en: 'traveling domestically', placeEn: 'Jeju island', favoriteEn: 'Jeju island', industryEn: 'travel industry' },
  { kind: 'selected', name: '해외여행', en: 'traveling abroad', placeEn: 'airport', favoriteEn: 'Switzerland', industryEn: 'travel industry' },
  { kind: 'selected', name: '집 휴가', en: 'spending my vacation at home', placeEn: 'living room', favoriteEn: 'watching Netflix', industryEn: 'OTT industry' },
  { kind: 'selected', name: '주말/자유시간', en: 'enjoying my free time', placeEn: 'park', favoriteEn: 'watching movies' },
  { kind: 'selected', name: '요리', en: 'cooking', placeEn: 'kitchen', favoriteEn: 'Korean food', industryEn: 'food industry' },
  { kind: 'selected', name: '집안일', en: 'doing household chores', placeEn: 'kitchen', favoriteEn: 'cooking' },
  { kind: 'selected', name: '집 개선', en: 'doing home improvement projects', placeEn: 'living room', favoriteEn: 'decorating my place', industryEn: 'housing industry' },

  // ── 돌발주제 ────────────────────────────────────────────
  { kind: 'surprise', name: '티비', en: 'watching TV', placeEn: 'living room', favoriteEn: 'travel shows', industryEn: 'OTT industry' },
  { kind: 'surprise', name: '독서', en: 'reading books', placeEn: 'library', favoriteEn: 'essays', industryEn: 'publishing industry' },
  { kind: 'surprise', name: '외식', en: 'eating out', placeEn: 'restaurant', favoriteEn: 'Japanese food', industryEn: 'restaurant industry' },
  { kind: 'surprise', name: '음식배달', en: 'ordering food delivery', placeEn: 'restaurant', favoriteEn: 'pizza', industryEn: 'food delivery industry' },
  { kind: 'surprise', name: '은행', en: 'doing my banking', placeEn: 'bank', favoriteEn: 'online banking', industryEn: 'banking industry' },
  { kind: 'surprise', name: '호텔', en: 'staying at hotels', placeEn: 'hotel', favoriteEn: 'a staycation', industryEn: 'hotel industry' },
  { kind: 'surprise', name: '미용실', en: 'going to the hair salon', placeEn: 'hair salon', favoriteEn: 'a head spa' },
  { kind: 'surprise', name: '재활용', en: 'recycling', placeEn: 'recycling area', favoriteEn: 'upcycling stores', industryEn: 'recycling system' },
  { kind: 'surprise', name: '테크놀로지', en: 'using my smartphone', placeEn: 'home', favoriteEn: 'YouTube', industryEn: 'technology' },
  { kind: 'surprise', name: '인터넷서핑', en: 'surfing the internet', placeEn: 'home', favoriteEn: 'YouTube', industryEn: 'technology' },
  { kind: 'surprise', name: '교통수단', en: 'taking public transportation', placeEn: 'subway station', favoriteEn: 'the subway', industryEn: 'public transportation system' },
  { kind: 'surprise', name: '약속/파티', en: 'meeting up with people', placeEn: 'restaurant', favoriteEn: 'having dinner together' },
  { kind: 'surprise', name: '명절', en: 'spending the holidays', placeEn: 'my parents’ place', favoriteEn: 'cooking together' },
  { kind: 'surprise', name: '계절/날씨', en: 'enjoying the season', placeEn: 'park', favoriteEn: 'autumn', industryEn: 'weather forecast system' },
  { kind: 'surprise', name: '지형', en: 'hiking', placeEn: 'mountain', favoriteEn: 'hiking in autumn' },
  { kind: 'surprise', name: '패션', en: 'shopping for clothes', placeEn: 'shopping mall', favoriteEn: 'casual style', industryEn: 'fashion industry' },
  { kind: 'surprise', name: '건강', en: 'staying healthy', placeEn: 'gym', favoriteEn: 'salad', industryEn: 'health industry' },
  { kind: 'surprise', name: '집', en: 'spending time at home', placeEn: 'living room', favoriteEn: 'watching TV', industryEn: 'housing industry' },
  { kind: 'surprise', name: '동네', en: 'walking around my neighborhood', placeEn: 'park', favoriteEn: 'the cafe nearby' },
  { kind: 'surprise', name: '취업/입사', en: 'preparing for my career', placeEn: 'job fair', favoriteEn: 'studying English' },
]

/** 과거비교에서 00 자리에 industryEn을 쓸 카테고리 */
export const INDUSTRY_CATEGORIES = new Set(['과거비교'])

const PLACEHOLDER = /\((주제|장소|소요시간)\)|00/g

export interface SubstituteOptions {
  /** 00 자리에 favoriteEn 대신 industryEn을 쓴다 (과거비교용) */
  industry?: boolean
}

/** 플레이스홀더를 하이라이트 마크업 없이 텍스트로 대입한다 */
export function substitute(text: string, topic: Topic | null, opts?: SubstituteOptions): string {
  if (!topic) return text
  return text.replace(PLACEHOLDER, (m) => {
    if (m === '(주제)') return topic.en
    if (m === '(장소)') return topic.placeEn ?? topic.en
    if (m === '00') {
      if (opts?.industry) return topic.industryEn ?? topic.favoriteEn ?? topic.en
      return topic.favoriteEn ?? topic.en
    }
    return m // (소요시간)은 스스로 채워 말하는 연습이 되도록 남겨둔다
  })
}

/** 화면 표시용: 플레이스홀더 위치를 분리해 하이라이트할 수 있게 쪼갠다 */
export function tokenize(text: string): { text: string; isPlaceholder: boolean }[] {
  const out: { text: string; isPlaceholder: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), isPlaceholder: false })
    out.push({ text: m[0], isPlaceholder: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), isPlaceholder: false })
  return out
}

const KEYWORD_HINTS: { re: RegExp; name: string }[] = [
  { re: /movie|film|cinema|theater/i, name: '영화보기' },
  { re: /music|song|musician|composer|concert|festival/i, name: '음악감상' },
  { re: /park\b/i, name: '공원가기' },
  { re: /beach|seaside/i, name: '해변가기' },
  { re: /shop|mall|store|buy|purchase/i, name: '쇼핑' },
  { re: /jog|run\b|running/i, name: '조깅' },
  { re: /bike|bicycle|riding/i, name: '자전거' },
  { re: /swim/i, name: '수영' },
  { re: /gym|work ?out|fitness/i, name: '헬스' },
  { re: /cafe|coffee/i, name: '카페가기' },
  { re: /hotel/i, name: '호텔' },
  { re: /bank/i, name: '은행' },
  { re: /restaurant|eat out|dining|food/i, name: '외식' },
  { re: /deliver/i, name: '음식배달' },
  { re: /hair salon|haircut|hair style/i, name: '미용실' },
  { re: /recycl/i, name: '재활용' },
  { re: /internet|website|online|surf/i, name: '인터넷서핑' },
  { re: /phone|cell ?phone|smart ?phone|technolog|appliance|device|gadget/i, name: '테크놀로지' },
  { re: /transportation|subway|bus\b|train/i, name: '교통수단' },
  { re: /holiday/i, name: '명절' },
  { re: /weather|season|rain|snow/i, name: '계절/날씨' },
  { re: /geograph|mountain|hiking/i, name: '지형' },
  { re: /fashion|clothe|wear|style/i, name: '패션' },
  { re: /health|healthy|fit\b/i, name: '건강' },
  { re: /chore|dishes|laundry|responsibilit/i, name: '집안일' },
  { re: /home improvement|furniture/i, name: '집 개선' },
  { re: /neighborhood|neighbour/i, name: '동네' },
  { re: /vacation at home|home vacation|staycation/i, name: '집 휴가' },
  { re: /appointment|promise|meet/i, name: '약속/파티' },
  { re: /librar|book|read/i, name: '독서' },
  { re: /\bTV\b|television|show\b/i, name: '티비' },
  { re: /travel|trip|abroad/i, name: '국내여행' },
  { re: /free time|weekend|sunday/i, name: '주말/자유시간' },
  { re: /house|apartment|room\b|live in/i, name: '집' },
  { re: /industry|company|work for/i, name: '취업/입사' },
]

const byName = new Map(TOPIC_PRESETS.map((t) => [t.name, t]))

/**
 * 문항 텍스트에서 주제를 추정한다. 콤보 3문항은 같은 주제로 묶이므로
 * 문항을 합쳐 넣으면 그 콤보의 주제가 나온다. 못 찾으면 null.
 */
export function guessTopic(text: string): Topic | null {
  for (const h of KEYWORD_HINTS) {
    if (h.re.test(text)) {
      const t = byName.get(h.name)
      if (t) return t
    }
  }
  return null
}
