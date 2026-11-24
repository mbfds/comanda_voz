import {
  ItemCategory,
  MarceloIntent,
  MenuItem,
  ParsedOrderItem,
  ParsedSingleCommand,
  ParsedVoiceMenuProduct,
  ParsedVoiceMenuResult,
  ParsedVoiceOrder,
  TabStageStatus,
  UserRoleType,
} from '../types';

// Validation constants synchronized verbatim with firebase-blueprint.json
export const VALIDATION_LIMITS = {
  ID_MAX_LEN: 128,
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  NAME_MAX_LEN: 80,
  OPERATOR_NAME_MAX_LEN: 60,
  STORE_NAME_MAX_LEN: 80,
  STORE_CODE_MAX_LEN: 30,
  TABLE_MAX_LEN: 40,
  SYNONYMS_MAX_LEN: 200,
  TRANSCRIPT_MAX_LEN: 250,
  VOICE_PIN_MAX_LEN: 30,
  MAX_PRICE: 100000,
  MAX_TOTAL: 1000000,
  MAX_QTY: 500,
  VALID_CATEGORIES: [
    'cervejas',
    'doses',
    'pratos',
    'porcoes',
    'sobremesas',
    'sem_alcool',
    'outros',
  ] as ItemCategory[],
  VALID_STATUSES: ['open', 'closing', 'paid', 'archived'] as TabStageStatus[],
  VALID_ROLES: ['SUPERADMIN', 'ADM', 'Proprietário', 'Garçom', 'Caixa', 'Gerente'] as UserRoleType[],
};

export function sanitizeString(val: string, maxLen: number, fallback = ''): string {
  const cleaned = (val ?? '').trim().slice(0, maxLen);
  return cleaned || fallback;
}

export function sanitizeStoreCode(val: string, fallback = 'BAR-01'): string {
  const cleaned = (val ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_\-]/g, '')
    .slice(0, VALIDATION_LIMITS.STORE_CODE_MAX_LEN);
  return cleaned || fallback;
}

export function sanitizeCategory(cat: string): ItemCategory {
  if (VALIDATION_LIMITS.VALID_CATEGORIES.includes(cat as ItemCategory)) {
    return cat as ItemCategory;
  }
  return 'outros';
}

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  cervejas: 'Cervejas',
  doses: 'Doses & Drinks',
  pratos: 'Pratos & Refeições',
  porcoes: 'Porções & Espetos',
  sobremesas: 'Sobremesas',
  sem_alcool: 'Sem Álcool',
  outros: 'Outros',
};

export const STAGE_LABELS: Record<TabStageStatus, string> = {
  open: 'Aberta',
  closing: 'Fechando',
  paid: 'Paga (Baixada)',
  archived: 'Arquivada',
};

export interface DefaultMenuSeed {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  synonyms: string;
}

export const DEFAULT_BAR_MENU: DefaultMenuSeed[] = [
  {
    id: 'item_litrao_brahma',
    name: 'Litrão Brahma / Skol 1L',
    category: 'cervejas',
    price: 18.0,
    synonyms:
      'litrão, litrao, litrões, litroes, litrao brahma, litrao skol, brahma 1l, skol 1l, litrão de cerveja',
  },
  {
    id: 'item_cerveja_original',
    name: 'Cerveja Original 600ml',
    category: 'cervejas',
    price: 16.0,
    synonyms: 'original, original 600, cerveja original, garrafa original, cerveja 600',
  },
  {
    id: 'item_cerveja_heineken',
    name: 'Cerveja Heineken 600ml',
    category: 'cervejas',
    price: 19.0,
    synonyms: 'heineken 600, cerveja heineken, verdinha, garrafa heineken, heineken',
  },
  {
    id: 'item_long_neck',
    name: 'Long Neck Heineken 330ml',
    category: 'cervejas',
    price: 12.0,
    synonyms: 'long neck, longneck, heineken long neck, heineken pequena, long neck 330',
  },
  {
    id: 'item_cerveja_lata',
    name: 'Cerveja Lata 350ml',
    category: 'cervejas',
    price: 7.0,
    synonyms: 'latinha, cerveja lata, lata brahma, brahma lata, lata skol, skol lata, cerveja 350',
  },
  {
    id: 'item_dose_cachaca',
    name: 'Dose de Cachaça Artesanal',
    category: 'doses',
    price: 8.0,
    synonyms: 'dose, doses, cachaça, cachaca, pinga, dose de pinga, dose de cachaca, branquinha',
  },
  {
    id: 'item_caipirinha_limao',
    name: 'Caipirinha de Limão',
    category: 'doses',
    price: 22.0,
    synonyms: 'caipirinha, caipirinhas, caipirinha de limao, caipiroska',
  },
  {
    id: 'item_dose_campari',
    name: 'Dose de Campari / Whisky',
    category: 'doses',
    price: 18.0,
    synonyms: 'campari, whisky, uisque, dose de campari, red label',
  },
  {
    id: 'item_espetinho_carne',
    name: 'Espetinho (Carne / Frango)',
    category: 'porcoes',
    price: 10.0,
    synonyms:
      'espetinho, espetinhos, espeto, espetos, espetinho de carne, espetinho de frango, churrasquinho',
  },
  {
    id: 'item_porcao_batata',
    name: 'Porção de Batata Frita',
    category: 'porcoes',
    price: 32.0,
    synonyms: 'batata, batata frita, porcao de batata, porção de batata, fritas',
  },
  {
    id: 'item_porcao_calabresa',
    name: 'Porção de Calabresa Acebolada',
    category: 'porcoes',
    price: 38.0,
    synonyms: 'calabresa, porcao de calabresa, porção de calabresa, linguiça',
  },
  {
    id: 'item_torresmo_rolo',
    name: 'Porção de Torresmo',
    category: 'porcoes',
    price: 28.0,
    synonyms: 'torresmo, panceta, pururuca, porcao de torresmo',
  },
  {
    id: 'item_coca_lata',
    name: 'Refrigerante Lata 350ml',
    category: 'sem_alcool',
    price: 7.0,
    synonyms: 'coca lata, coca cola lata, guarana lata, refri lata, refrigerante lata, refri, guarana',
  },
  {
    id: 'item_agua_mineral',
    name: 'Água Mineral 500ml',
    category: 'sem_alcool',
    price: 5.0,
    synonyms: 'água, agua, agua com gas, agua sem gas',
  },
  {
    id: 'item_red_bull',
    name: 'Energético Red Bull',
    category: 'sem_alcool',
    price: 16.0,
    synonyms: 'energético, energetico, red bull, redbull',
  },
];

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Normalizes general text: decomposes accents, removes zero-width/apostrophe/special
 * characters (keeping numeric decimal separators), and collapses whitespace.
 */
export function normalizeText(str: string): string {
  return (str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF'’`´]/g, '')
    .replace(/[^a-z0-9\s.,/-]/g, ' ')
    .replace(/(?<!\d)[.,/-]+|[.,/-]+(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aggressively sanitizes raw STT or typed transcripts before command & name parsing:
 * converts currency symbols (R$) into "reais", strips emojis/special characters,
 * normalizes decimal numbers, and removes stray punctuation while preserving
 * clause separators (commas) and numbers.
 */
export function sanitizeVoiceTranscriptForParsing(str: string): string {
  return (str ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\br\s*\$\s*/gi, ' reais ')
    .replace(/['’`´"“”«»*()[\]{}<>@#%&_+=~^|\\!?]/g, ' ')
    .replace(/(?<!\d)[.,;:/-]+|[.,;:/-]+(?!\d)/g, (m) => (m.includes(',') ? ', ' : ' '))
    .replace(/(?<!\d)\s*,\s*|\s*,\s*(?!\d)/g, ', ')
    .replace(/,\s*,+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aggressively cleans a customer name for search/matching:
 * removes accents, special characters, punctuation, honorifics, and extra spaces.
 */
export function normalizeCustomerNameForSearch(str: string): string {
  let cleaned = (str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF'’`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let i = 0; i < 4; i++) {
    const next = cleaned
      .replace(
        /^(?:o|a|os|as|do|da|dos|das|de|no|na|nos|nas|pro|pra|para|conta|comanda|cliente|senhor|sr|seu|dona)\b\s*/i,
        ''
      )
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned;
}

/**
 * Mapa de sinonímia e variações fonéticas para nomes de clientes comuns no Brasil.
 * Reduz erros de reconhecimento de voz (STT) quando o navegador transcreve variações
 * homófonas ou próximas (ex: Thiago/Tiago/Hiago, Marcelo/Marcelle/Marcele/Marcello,
 * Matheus/Mateus, Felipe/Filipe/Phelipe, Victor/Vitor, Luiz/Luis, etc.).
 */
export const COMMON_CUSTOMER_NAME_SYNONYMS: Record<string, string[]> = {
  thiago: [
    'thiago',
    'tiago',
    'thyago',
    'tyago',
    'tiagu',
    'thiagu',
    'tiagho',
    'thiagho',
    'tihago',
    'teago',
    'theago',
    'tiaguinho',
    'thiaguinho',
    'tiaguim',
    'thiaguim',
    'hiago',
    'iago',
    'yago',
  ],
  marcelo: [
    'marcelo',
    'marcello',
    'marcelle',
    'marcele',
    'marceli',
    'marcelly',
    'marcely',
    'marcela',
    'marcella',
    'marcelinho',
    'celo',
  ],
  matheus: ['matheus', 'mateus', 'matheuzinho', 'mateuzinho', 'matias', 'mathias'],
  felipe: ['felipe', 'phelipe', 'filipe', 'philipe', 'felipinho', 'lipe', 'lipinho'],
  victor: ['victor', 'vitor', 'vitinho', 'vitorino', 'vitoria', 'victoria'],
  luiz: ['luiz', 'luis', 'luizinho', 'luisinho', 'luisa', 'luiza'],
  raphael: ['raphael', 'rafael', 'rafa', 'rafinha', 'rafaela', 'raphaela'],
  gabriel: ['gabriel', 'gabriell', 'biel', 'gabi', 'gaby', 'gabriela', 'gabriella'],
  lucas: ['lucas', 'lucca', 'luca', 'luquinhas', 'lukinhas', 'lukas'],
  guilherme: ['guilherme', 'guilerme', 'gui', 'guizinho'],
  henrique: ['henrique', 'enrique', 'rique', 'riquinho', 'henri'],
  arthur: ['arthur', 'artur', 'arturzinho', 'tutu'],
  wagner: ['wagner', 'vagner', 'vaguinho', 'waguinho'],
  wellington: ['wellington', 'welington', 'weliton', 'wellinton'],
  washington: ['washington', 'washinton', 'uoxinton', 'voxinton'],
  william: ['william', 'wiliam', 'willian', 'wilian', 'will'],
  wesley: ['wesley', 'ueslei', 'weslei', 'uesley'],
  wanderson: ['wanderson', 'vanderson', 'vando'],
  walter: ['walter', 'valter', 'valtinho'],
  waldir: ['waldir', 'valdir'],
  wilson: ['wilson', 'vilson', 'uilson'],
  alexandre: ['alexandre', 'alessandro', 'alex', 'ale', 'xande', 'xandao', 'xandinho'],
  cristian: ['cristian', 'christian', 'cristiano', 'christiano', 'cris', 'chris'],
  carlos: ['carlos', 'carlinhos', 'kauan', 'cauan', 'kaua', 'caua'],
  caio: ['caio', 'kayo', 'kaio', 'caique', 'kaique'],
  daniel: ['daniel', 'dani', 'dany', 'danilo', 'daniela', 'daniella'],
  diego: ['diego', 'dyego', 'diogo'],
  eduardo: ['eduardo', 'edu', 'dudu'],
  fernando: ['fernando', 'nando', 'fernanda', 'nanda'],
  francisco: ['francisco', 'chico', 'chiquinho', 'fran'],
  gustavo: ['gustavo', 'guga'],
  joao: ['joao', 'joão', 'jao', 'jão', 'joaozinho', 'joca'],
  jose: ['jose', 'josé', 'ze', 'zé', 'zezinho'],
  jonas: ['jonas', 'jhonas', 'jonathan', 'jhonatan', 'jonatas', 'jhonatas', 'john', 'jhon'],
  juliana: ['juliana', 'juliano', 'ju', 'juju', 'julia', 'giulia'],
  leandro: ['leandro', 'leo', 'léo', 'leonardo', 'leozinho'],
  leticia: ['leticia', 'letícia', 'le', 'lele'],
  camila: ['camila', 'kamila', 'camilla', 'kamilla', 'mila', 'camilinha'],
  carina: ['carina', 'karina', 'karine', 'carine'],
  carolina: ['carolina', 'karolina', 'carol', 'karol', 'caroline', 'karoline'],
  catia: ['catia', 'katia', 'kátia', 'cátia'],
  kelly: ['kelly', 'keli', 'kely', 'queli', 'celi'],
  stephany: ['stephany', 'stefani', 'estefani', 'stephanie', 'stefany'],
  jessica: ['jessica', 'jéssica', 'jesica'],
  thais: ['thais', 'taís', 'tais', 'thaís'],
  thamires: ['thamires', 'tamires', 'thamyres', 'tamyres', 'tami'],
  thaina: ['thayna', 'taina', 'tainá', 'thaina', 'thiara', 'tiara'],
  vanessa: ['vanessa', 'vanesa', 'van'],
  priscila: ['priscila', 'pricila', 'pri', 'priscilla'],
  patricia: ['patricia', 'patrícia', 'pati', 'paty'],
  paulo: ['paulo', 'paulinho', 'paula', 'paulinha', 'paulao', 'paulão'],
  pedro: ['pedro', 'pedrinho', 'pepe'],
  roberto: ['roberto', 'beto', 'betinho'],
  rodrigo: ['rodrigo', 'digao', 'digão'],
  vinicius: ['vinicius', 'vinícius', 'vini', 'vinny'],
  bruno: ['bruno', 'bruninho', 'bruna', 'bruninha'],
  anderson: ['anderson', 'andinho'],
  andre: ['andre', 'andré', 'dede', 'dedé'],
  antonio: ['antonio', 'antônio', 'tonho', 'toninho'],
  marcos: ['marcos', 'marquinhos', 'marcao', 'marcão', 'marco', 'marcus'],
  michel: ['michel', 'michael', 'maicon', 'maycon', 'michele', 'michelle'],
};

/**
 * Phonetic normalization for Brazilian Portuguese customer names.
 * Ensures "Thiago" and "Tiago", "Matheus" and "Mateus", "Phelipe" and "Felipe",
 * "Victor" and "Vitor", "Luiz" and "Luis", "Yago" and "Iago", "Wagner" and "Vagner",
 * "Marcelle" and "Marcele" normalize consistently.
 */
export function normalizePhoneticPt(str: string): string {
  const preCleaned = (str ?? '')
    .toLowerCase()
    // Preserve cedilla s-sound before stripping diacritics (e.g. Gonçalo -> Gonsalo)
    .replace(/ç/g, 's')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF'’`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!preCleaned) return '';

  return preCleaned
    // Collapse consecutive duplicate letters first so "tthiago" / "thh" simplify cleanly
    .replace(/([a-z])\1+/g, '$1')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't') // Thiago -> tiago, Matheus -> mateus, Thais -> tais, Nathan -> natan
    .replace(/chr/g, 'cr')
    .replace(/sc([ei])/g, 's$1')
    .replace(/\bh/g, '') // leading silent h (e.g. Henrique -> enrique, Hiago -> iago)
    .replace(/([^clns])h/g, '$1') // silent h anywhere except ch, lh, nh, sh (e.g. Arthur -> artur, Tiagho -> tiago)
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/k/g, 'c')
    .replace(/qu([ei])/g, 'c$1') // Henrique/Enrike -> enrice, Caique/Kaique -> caice
    .replace(/g([ei])/g, 'j$1') // Giovana/Jiovana, Geovana/Jeovana
    .replace(/c([ei])/g, 's$1') // Marcelo/Marselo, Marcele/Marsele, Cesar/Sesar
    .replace(/([aeiou])z([aeiou])/g, '$1s$2') // Luiza -> luisa, Eliza -> elisa
    .replace(/ct/g, 't') // Victor -> Vitor
    .replace(/pt/g, 't') // Baptista -> Batista
    .replace(/z\b/g, 's') // Luiz -> Luis, Beatriz -> Beatris
    .replace(/\b([a-z]{4,})u\b/g, '$1o') // tiagu -> tiago, marcelu -> marcelo, danilu -> danilo
    .replace(/([a-z])\1+/g, '$1') // second collapse after phonetic substitutions
    .replace(/\s+/g, ' ')
    .trim();
}

// Fast lookup table mapping normalized & phonetic name tokens to their canonical group key
const CUSTOMER_NAME_SYNONYM_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(COMMON_CUSTOMER_NAME_SYNONYMS)) {
    const canonNorm = normalizeText(canonical);
    const canonPhon = normalizePhoneticPt(canonical);
    map.set(canonNorm, canonNorm);
    if (canonPhon) map.set(canonPhon, canonNorm);
    for (const variant of variants) {
      const vNorm = normalizeText(variant);
      const vPhon = normalizePhoneticPt(variant);
      if (vNorm) map.set(vNorm, canonNorm);
      if (vPhon) map.set(vPhon, canonNorm);
    }
  }
  return map;
})();

export function getCanonicalCustomerNameGroup(token: string): string | undefined {
  const norm = normalizeText(token);
  if (!norm) return undefined;
  const byNorm = CUSTOMER_NAME_SYNONYM_LOOKUP.get(norm);
  if (byNorm) return byNorm;
  const phon = normalizePhoneticPt(token);
  return phon ? CUSTOMER_NAME_SYNONYM_LOOKUP.get(phon) : undefined;
}

/**
 * Full Levenshtein edit distance between two strings (used for typo & STT slip tolerance).
 */
export function computeLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Normalized Levenshtein similarity in [0..1], where 1.0 means identical strings.
 */
export function computeLevenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return Math.max(0, 1 - computeLevenshteinDistance(a, b) / maxLen);
}

/**
 * Soundex phonetic encoding adapted for Brazilian Portuguese names.
 * Pre-normalizes silent letters and homophone digraphs (th->t, ph->f, y->i, k->c,
 * w->v, ç->s, silent h) before computing the 4-character Soundex key (e.g.
 * "Tiago" and "Thiago" both produce "T200", "Matheus" and "Mateus" -> "M320",
 * "Felipe" and "Phelipe" -> "F410").
 */
export function computeSoundexPt(token: string): string {
  const phon = normalizePhoneticPt(token).replace(/[^a-z]/g, '');
  if (!phon) return '';

  const soundexDigit = (ch: string): string => {
    switch (ch) {
      case 'b':
      case 'f':
      case 'p':
      case 'v':
        return '1';
      case 'c':
      case 'g':
      case 'j':
      case 'k':
      case 'q':
      case 's':
      case 'x':
      case 'z':
        return '2';
      case 'd':
      case 't':
        return '3';
      case 'l':
        return '4';
      case 'm':
      case 'n':
        return '5';
      case 'r':
        return '6';
      default:
        return '';
    }
  };

  const firstChar = phon[0].toUpperCase();
  let lastCode = soundexDigit(phon[0]);
  let result = firstChar;

  for (let i = 1; i < phon.length && result.length < 4; i++) {
    const ch = phon[i];
    if (ch === 'h' || ch === 'w' || ch === 'y') {
      continue;
    }
    const code = soundexDigit(ch);
    if (code && code !== lastCode) {
      result += code;
    }
    lastCode = code || '';
  }

  return result.padEnd(4, '0').slice(0, 4);
}

/**
 * Compares two tokens via Portuguese Soundex similarity [0..1].
 */
function computeSoundexSimilarity(tokA: string, tokB: string): number {
  const sxA = computeSoundexPt(tokA);
  const sxB = computeSoundexPt(tokB);
  if (!sxA || !sxB) return 0;
  if (sxA === sxB) return 1.0;

  // Partial Soundex credit when initial phonetic class matches and trailing digits align closely
  if (sxA[0] === sxB[0]) {
    const sxDist = computeLevenshteinDistance(sxA.slice(1), sxB.slice(1));
    return Math.max(0, 1 - sxDist / 3) * 0.75;
  }

  return 0;
}

function getSingleNameTokenSimilarity(tokA: string, tokB: string): number {
  const normA = normalizeText(tokA);
  const normB = normalizeText(tokB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const phonA = normalizePhoneticPt(tokA);
  const phonB = normalizePhoneticPt(tokB);
  if (!phonA || !phonB) return 0;

  // Combine Soundex phonetic code similarity + Levenshtein edit similarity
  const soundexSim = computeSoundexSimilarity(tokA, tokB);
  const rawLevSim = computeLevenshteinSimilarity(normA, normB);
  const phonLevSim = computeLevenshteinSimilarity(phonA, phonB);
  const bestLevSim = Math.max(rawLevSim, phonLevSim);

  // Exact phonetic + Soundex identity (e.g. "Tiago" & "Thiago" -> soundexSim=1.0, phonLevSim=1.0 -> ~0.99)
  if (phonA === phonB && soundexSim === 1.0) {
    return 0.99;
  }

  // Same canonical Brazilian name group (e.g. "Thiago" <-> "Hiago", "Marcelo" <-> "Marcelle")
  const groupA = getCanonicalCustomerNameGroup(tokA);
  const groupB = getCanonicalCustomerNameGroup(tokB);
  if (groupA && groupB && groupA === groupB) {
    return Math.max(0.96, 0.55 * soundexSim + 0.45 * bestLevSim);
  }

  // Combined Soundex + Levenshtein score (requires reasonable Levenshtein alignment so unrelated names like
  // "Thiago" (T200) and "Tais" (T200) aren't conflated solely by Soundex collision)
  if (soundexSim === 1.0 && bestLevSim >= 0.60) {
    return Number((0.55 * soundexSim + 0.45 * bestLevSim).toFixed(4));
  }

  // Strong Levenshtein match for minor typing/STT slips
  const minLen = Math.min(phonA.length, phonB.length);
  const maxLen = Math.max(phonA.length, phonB.length);
  const phonDist = computeLevenshteinDistance(phonA, phonB);
  if (minLen >= 3 && maxLen >= 4 && phonDist <= 1) {
    return soundexSim > 0
      ? Math.max(0.88, 0.40 * soundexSim + 0.60 * bestLevSim)
      : bestLevSim >= 0.80
      ? 0.82
      : 0.35 * soundexSim + 0.65 * bestLevSim;
  }
  if (minLen >= 5 && maxLen >= 6 && phonDist <= 2 && soundexSim >= 0.5) {
    return Math.max(0.80, 0.45 * soundexSim + 0.55 * bestLevSim);
  }

  // Aggressive prefix/shortening equivalence for spoken names (>= 4 chars, e.g. "tiag" <-> "thiago")
  const shorter = phonA.length <= phonB.length ? phonA : phonB;
  const longer = phonA.length <= phonB.length ? phonB : phonA;
  if (shorter.length >= 4 && longer.startsWith(shorter)) {
    return 0.85 + 0.1 * (shorter.length / longer.length);
  }

  // Character n-gram Dice + Soundex/Levenshtein fallback for longer noisy STT transcripts
  if (phonA.length >= 4 && phonB.length >= 4) {
    const bi = computeCharNGramDice(phonA, phonB, 2);
    const tri = computeCharNGramDice(phonA, phonB, 3);
    const combinedDice = bi * 0.6 + tri * 0.4;
    const hybrid = combinedDice * 0.55 + bestLevSim * 0.25 + soundexSim * 0.20;
    if (hybrid >= 0.72) {
      return hybrid;
    }
  }

  return 0;
}

/**
 * Computes aggressive customer name similarity [0..1] combining Levenshtein distance
 * and Portuguese-adapted Soundex phonetic encoding, plus synonym groups and n-gram fallback.
 * For example, "Tiago" and "Thiago" achieve ~0.99 (99%) similarity.
 */
export function computeCustomerNameSimilarity(nameA: string, nameB: string): number {
  const normA = normalizeCustomerNameForSearch(nameA);
  const normB = normalizeCustomerNameForSearch(nameB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const phonA = normalizePhoneticPt(normA);
  const phonB = normalizePhoneticPt(normB);
  if (!phonA || !phonB) return 0;
  if (phonA === phonB && computeSoundexPt(normA) === computeSoundexPt(normB)) {
    return 0.99;
  }
  if (phonA === phonB) return 0.98;

  const tokensA = normA.split(/\s+/).filter(Boolean);
  const tokensB = normB.split(/\s+/).filter(Boolean);

  if (tokensA.length === 1 && tokensB.length === 1) {
    return getSingleNameTokenSimilarity(tokensA[0], tokensB[0]);
  }

  // Handle names split by special characters (e.g., "Thi@go" -> "thi go" vs "Tiago")
  if (
    (tokensA.length === 1 && tokensB.length > 1) ||
    (tokensB.length === 1 && tokensA.length > 1)
  ) {
    const condensedA = phonA.replace(/\s+/g, '');
    const condensedB = phonB.replace(/\s+/g, '');
    if (condensedA === condensedB) return 0.98;
    const condSim = getSingleNameTokenSimilarity(condensedA, condensedB);
    if (condSim >= 0.85) return condSim * 0.97;
  }

  if (tokensA.length === tokensB.length) {
    const sims = tokensA.map((t, idx) => getSingleNameTokenSimilarity(t, tokensB[idx]));
    if (sims.every((s) => s >= 0.78)) {
      return sims.reduce((acc, s) => acc + s, 0) / sims.length;
    }
  }

  // First-name equivalence when one is a single first name (e.g. "Tiago" vs "Thiago Silva")
  if (
    tokensA[0] &&
    tokensB[0] &&
    tokensA[0].length >= 2 &&
    tokensB[0].length >= 2 &&
    (tokensA.length === 1 || tokensB.length === 1)
  ) {
    const firstSim = getSingleNameTokenSimilarity(tokensA[0], tokensB[0]);
    if (firstSim >= 0.78) {
      return firstSim * 0.95;
    }
  }

  // Fallback token-coverage + Levenshtein/Soundex similarity for partial multi-word names
  const smaller = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const larger = tokensA.length <= tokensB.length ? tokensB : tokensA;
  let matchedSimSum = 0;
  let matchedTokens = 0;
  for (const sTok of smaller) {
    let bestTok = 0;
    for (const lTok of larger) {
      const sim = getSingleNameTokenSimilarity(sTok, lTok);
      if (sim > bestTok) bestTok = sim;
    }
    if (bestTok >= 0.80) {
      matchedTokens++;
      matchedSimSum += bestTok;
    }
  }
  if (matchedTokens === smaller.length && smaller.length > 0) {
    return (matchedSimSum / smaller.length) * 0.92;
  }

  const fullLevSim = computeLevenshteinSimilarity(phonA, phonB);
  const fullDice = computeCharNGramDice(phonA, phonB, 2) * 0.6 + computeCharNGramDice(phonA, phonB, 3) * 0.4;
  const fullHybrid = Math.max(fullLevSim, fullDice);
  return fullHybrid >= 0.74 ? fullHybrid * 0.90 : 0;
}

/**
 * Checks if two customer names refer to the same person using combined Levenshtein
 * distance and Portuguese Soundex similarity (so e.g. "Tiago" and "Thiago" reach ~99%
 * similarity and never create duplicate tabs).
 */
export function areCustomerNamesEquivalent(nameA: string, nameB: string): boolean {
  return computeCustomerNameSimilarity(nameA, nameB) >= 0.78;
}

function cleanCustomerCandidateText(raw: string): string {
  let cleaned = sanitizeVoiceTranscriptForParsing(raw)
    .replace(/[.!,?;:]+$/g, '')
    .trim();
  for (let i = 0; i < 5; i++) {
    const next = cleaned
      .replace(
        /^(?:o|a|os|as|do|da|dos|das|de|no|na|nos|nas|pro|pra|para|conta|comanda|cliente|senhor|sr|seu|dona)\b\s*/i,
        ''
      )
      .trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned;
}

/**
 * Finds an existing customer name from active tabs using aggressive phonetic,
 * synonym, and fuzzy n-gram matching (e.g. "Tiago" / "Tiagu" / "Diago" matches "Thiago").
 */
export function resolveCustomerNameFromExisting(
  spokenCandidate: string,
  existingCustomerNames: string[]
): string {
  const cleaned = cleanCustomerCandidateText(spokenCandidate);
  if (!cleaned) return '';

  const cleanedSearch = normalizeCustomerNameForSearch(cleaned);
  const cleanedPhon = normalizePhoneticPt(cleanedSearch);

  // Score all existing customer names (normalized & phonetically pre-cleaned) and select the strongest confident match
  let bestExisting = '';
  let bestScore = 0;

  for (const existing of existingCustomerNames) {
    const existingClean = cleanCustomerCandidateText(existing);
    if (!existingClean) continue;

    const existingSearch = normalizeCustomerNameForSearch(existingClean);
    const existingPhon = normalizePhoneticPt(existingSearch);

    // Fast-path exact phonetic equivalence (e.g. "Thiago" === "Tiago")
    if (cleanedPhon && existingPhon && cleanedPhon === existingPhon) {
      return existing.trim();
    }

    const score = computeCustomerNameSimilarity(existingClean, cleaned);
    if (score >= 0.78 && score > bestScore) {
      bestScore = score;
      bestExisting = existing.trim();
    }
  }

  if (bestExisting) return bestExisting;

  // Title-case the new customer name (using cleaned text free of special characters)
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const PT_NUMBERS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  meia: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

/**
 * Strips polite/conversational prefixes so phrases like
 * "quando eu peço para dar baixa na conta do thiago" or "quero dar baixa na conta do thiago"
 * are normalized cleanly to the core command, without stripping "Marcelo" when "Marcelo" is the customer.
 */
function stripPolitePrefixes(raw: string): string {
  let text = raw.trim();
  // Strip wake-word "Marcelo" at the beginning ONLY if not immediately followed by "pagou/quitou"
  text = text
    .replace(
      /^(?:(?:oi|ola|olá|ei|opa|fala|escuta)\s+)?(?:marcelo[\s,.:;-]+)(?!pagou\b|quitou\b|pediu\b)/i,
      ''
    )
    .trim();

  const prefixPattern =
    /^(?:(?:por\s+favor|pf|por\s+gentileza|faz\s+favor|faz\s+o\s+seguinte|quando\s+eu\s+peco\s+para|quando\s+eu\s+peço\s+para|eu\s+peco\s+para|eu\s+peço\s+para|peco\s+para|peço\s+para|eu\s+quero|quero\s+que\s+voce|quero\s+que\s+você|quero|preciso\s+que|preciso|pode|poderia|vamos|me\s+fala|me\s+diz|me\s+passa|me\s+passe|me\s+ve|me\s+vê|ve\s+ai|vê\s+aí|veja)\b[\s,.:;-]*)+/i;

  for (let i = 0; i < 3; i++) {
    const next = text.replace(prefixPattern, '').trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * Extracts customer name from a FECHAR or BAIXA phrase, supporting:
 * - "dar baixa na conta do thiago" / "dá baixa na conta do tiago" / "dar uma baixa na conta do thiago"
 * - "quanto ficou a conta do thiago" / "quando ficou a conta do tiago"
 * - "feche a conta do tiago" / "fechar tiago" / "fechar conta da marcelle"
 * - "baixa no tiago" / "tiago pagou" / "marcelo pagou"
 */
function extractCustomerForAccountAction(
  cleanedClause: string,
  existingCustomerNames: string[]
): string {
  const clauseNoPolite = stripPolitePrefixes(cleanedClause);

  // 1. Strip payment-method modifiers anywhere and trailing continuation phrases cleanly
  let stripped = clauseNoPolite
    .replace(/[.!,?;:]+$/g, '')
    .replace(/\b(?:no|via)\s+pix\b/gi, ' ')
    .replace(/\b(?:no|via)\s+cart[aã]o(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?\b/gi, ' ')
    .replace(/\b(?:em|no)\s+(?:dinheiro|esp[eé]cie)\b/gi, ' ')
    .replace(/\bno\s+valor(?:\s+de)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let i = 0; i < 4; i++) {
    const next = stripped
      .replace(
        /(?:\s+e\s+continua.*|\s+por\s+favor.*|\s+por\s+gentileza.*|\s+agora.*|\s+hoje|\s+ai|\s+aí|\s+pf)$/i,
        ''
      )
      .trim();
    if (next === stripped) break;
    stripped = next;
  }
  stripped = stripped
    .replace(/\b(?:de\s+(?:reais|valor)\s+|(?:de|valor|reais|rs)\s+)\d+(?:[.,]\d+)?\s*(?:reais|real|conto|pila)?\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:reais|real|conto|pila)\b/gi, ' ')
    .replace(/[.!,?;:]+$/g, '')
    .trim();

  // Remove action verbs from the start (including "dar uma baixa", "dar a baixa", "abaixar", "deu baixa", etc.)
  stripped = stripped
    .replace(
      /^(?:fechar|feche|fecha|fechamento|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quando\s+deu|quanto\s+t[aá]|quanto\s+est[aá]|qual\s+o\s+total|qual\s+o\s+valor|qual\s+[eé]\s+a\s+conta|pediu\s+a\s+conta|resumo\s+da\s+conta|ver\s+a\s+conta|fala\s+a\s+conta|passa\s+a\s+conta|dar\s+(?:a\s+|uma\s+)?baixa|dar\s+(?:a\s+)?baixar|d[aáeê]\s+(?:a\s+|uma\s+)?baixa|d[aáeê]\s+baixar|deu\s+(?:a\s+)?baixa|t[aá]\s+baixa|dar\s+abaixa|fazer\s+(?:a\s+|uma\s+)?baixa|faz\s+(?:a\s+|uma\s+)?baixa|confirma(?:r)?\s+(?:a\s+)?baixa|registra(?:r)?\s+(?:a\s+)?baixa|baixar|baixe|baixa|abaixar|abaixa|quitar|quite|quita|zerar|zere|zera|pagar|pague|paga|receber|recebi|abater)\b\s*/i,
      ''
    )
    .trim();

  // Repeatedly strip leading prepositions, numbers left from payment amounts, and account nouns
  for (let i = 0; i < 8; i++) {
    const next = stripped
      .replace(
        /^(?:n[oa]s?|d[oa]s?|de|para\s+o|para\s+a|para|pro|pra|em|o|a|as|os|uma|um|conta|comanda|pagamento|valor|total|cliente|senhor|sr|seu|dona|\d+(?:[.,]\d+)?)\b\s*/i,
        ''
      )
      .trim();
    if (next === stripped) break;
    stripped = next;
  }

  // Strip trailing status words ("pagou", "quitou", "deu baixa", "conta", "comanda")
  stripped = stripped
    .replace(
      /\s+\b(?:pagou|quitou|ja\s+pagou|j[aá]\s+pagou|deu\s+baixa|paga|pago|conta|comanda)\b.*$/i,
      ''
    )
    .trim();

  if (
    stripped.length >= 2 &&
    !/^(?:conta|comanda|total|baixa|fechar|pix|dinheiro|cartao|cartão)$/i.test(normalizeText(stripped))
  ) {
    return resolveCustomerNameFromExisting(stripped, existingCustomerNames);
  }

  // 2. Fallback: sliding-window scan across words in the clause against existingCustomerNames via fuzzy & phonetic scoring
  const clauseWords = clauseNoPolite
    .replace(/[.!,?;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let bestExisting = '';
  let bestScore = 0;

  for (const existing of existingCustomerNames) {
    const existingTokens = normalizeText(existing).split(' ').filter(Boolean);
    const maxWin = Math.min(3, Math.max(1, existingTokens.length));
    for (let win = 1; win <= maxWin; win++) {
      for (let i = 0; i <= clauseWords.length - win; i++) {
        const sliceStr = clauseWords.slice(i, i + win).join(' ');
        const sim = computeCustomerNameSimilarity(existing, sliceStr);
        if (sim >= 0.78 && sim > bestScore) {
          bestScore = sim;
          bestExisting = existing;
        }
      }
    }
  }

  return bestExisting;
}

// --- Product Matching Engine (Qualifier-Aware + Token Scoring + Ambiguity Guard) ---

const PRODUCT_STOPWORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'em', 'e', 'a', 'o']);

/**
 * Normalizes product text: removes accents, converts hyphens/slashes to spaces,
 * standardizes Brazilian beverage volumes ("2 litros" / "dois litros" / "2l" -> "2l",
 * "350 ml" -> "350ml", "600 ml" -> "600ml", "1 litro" -> "1l").
 */
export function normalizeProductText(str: string): string {
  return normalizeText(str)
    .replace(/\b(?:dois|2)\s*(?:litros?|l)?\s+e\s+mei[oa]\b/g, ' 2l5 ')
    .replace(/\b2[.,]5\s*(?:litros?|l)?\b/g, ' 2l5 ')
    .replace(/\b(?:um|uma|1)\s*(?:litros?|l)?\s+e\s+mei[oa]\b/g, ' 1l5 ')
    .replace(/\b1[.,]5\s*(?:litros?|l)?\b/g, ' 1l5 ')
    .replace(/[-/.,_+]+/g, ' ')
    .replace(/\b(?:dois|2)\s*(?:litros?|l)\b/g, ' 2l ')
    .replace(/\b(?:tres|3)\s*(?:litros?|l)\b/g, ' 3l ')
    .replace(/\b(?:um|uma|1)\s*(?:litros?|l)\b/g, ' 1l ')
    .replace(/\b(\d+)\s*(?:litros?|l)\b/g, ' $1l ')
    .replace(/\b(\d+)\s*(?:mls?)\b/g, ' $1ml ')
    .replace(/\bmeio\s*litro\b/g, ' 500ml ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeProduct(normProd: string): string[] {
  return normProd
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !PRODUCT_STOPWORDS.has(t));
}

function extractProductQualifiers(normProd: string): {
  sizeGroup: string | null;
  variants: Set<string>;
  isHalfPortion: boolean;
} {
  const padded = ` ${normProd} `;
  let sizeGroup: string | null = null;

  if (/\b(?:lata|latinha|latas|latinhas|350ml|269ml|350|269|latao|473ml)\b/.test(padded)) {
    sizeGroup = 'LATA_350';
  } else if (/\b2l5\b/.test(padded)) {
    sizeGroup = 'GARRAFA_2_5L';
  } else if (/\b(?:2l|2litro|2litros)\b/.test(padded)) {
    sizeGroup = 'GARRAFA_2L';
  } else if (/\b1l5\b/.test(padded)) {
    sizeGroup = 'GARRAFA_1_5L';
  } else if (/\b(?:1l|litrao|litroes)\b/.test(padded)) {
    sizeGroup = 'LITRAO_1L';
  } else if (/\b(?:600ml|600)\b/.test(padded)) {
    sizeGroup = 'GARRAFA_600';
  } else if (/\b(?:long\s*neck|longneck|330ml|330|pequena)\b/.test(padded)) {
    sizeGroup = 'LONG_NECK';
  } else if (/\b(?:ks|290ml|290)\b/.test(padded)) {
    sizeGroup = 'GARRAFA_KS';
  }

  const variants = new Set<string>();
  if (/\b(?:zero|sem\s+acucar|diet|light)\b/.test(padded)) variants.add('ZERO');
  if (/\b(?:sem\s+gas)\b/.test(padded)) variants.add('SEM_GAS');
  if (/\b(?:com\s+gas)\b/.test(padded)) variants.add('COM_GAS');

  const isHalfPortion = /\b(?:meia|meio)\b/.test(padded);

  return { sizeGroup, variants, isHalfPortion };
}

function buildCharNGrams(str: string, n: number): string[] {
  const clean = str.replace(/\s+/g, '');
  if (!clean) return [];
  if (clean.length <= n) return [clean];
  const grams: string[] = [];
  for (let i = 0; i <= clean.length - n; i++) {
    grams.push(clean.slice(i, i + n));
  }
  return grams;
}

/**
 * Computes Sørensen–Dice similarity [0..1] over character n-grams (bigrams/trigrams).
 */
function computeCharNGramDice(a: string, b: string, n = 2): number {
  const gramsA = buildCharNGrams(a, n);
  const gramsB = buildCharNGrams(b, n);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;

  const freqB = new Map<string, number>();
  for (const g of gramsB) {
    freqB.set(g, (freqB.get(g) || 0) + 1);
  }

  let intersection = 0;
  for (const g of gramsA) {
    const count = freqB.get(g) || 0;
    if (count > 0) {
      intersection++;
      freqB.set(g, count - 1);
    }
  }

  return (2 * intersection) / (gramsA.length + gramsB.length);
}

/**
 * Returns similarity [0..1] between two individual product tokens using exact,
 * phonetic, plural/singular, prefix (e.g. "espet" -> "espetinho", "orig" -> "original"),
 * fuzzy Levenshtein distance, and bigram Dice similarity.
 */
function getProductTokenSimilarity(tokA: string, tokB: string): number {
  if (!tokA || !tokB) return 0;
  if (tokA === tokB) return 1.0;

  const phonA = normalizePhoneticPt(tokA);
  const phonB = normalizePhoneticPt(tokB);
  if (phonA && phonB && phonA === phonB) return 0.98;

  // Plural / singular match
  if (tokA.length >= 3 && tokB.length >= 3) {
    if (`${tokA}s` === tokB || `${tokB}s` === tokA) return 0.96;
    if (`${tokA}es` === tokB || `${tokB}es` === tokA) return 0.95;
  }

  // Aggressive prefix match for short/partial spoken names (e.g. "orig" -> "original", "espet" -> "espetinho", "2" -> "2l")
  const shorter = tokA.length <= tokB.length ? tokA : tokB;
  const longer = tokA.length <= tokB.length ? tokB : tokA;
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    return 0.85 + 0.1 * (shorter.length / longer.length);
  }
  if (phonA && phonB) {
    const pShort = phonA.length <= phonB.length ? phonA : phonB;
    const pLong = phonA.length <= phonB.length ? phonB : phonA;
    if (pShort.length >= 3 && pLong.startsWith(pShort)) {
      return 0.84 + 0.1 * (pShort.length / pLong.length);
    }
  }

  // Bounded Levenshtein for STT misspellings (e.g. "heinekem" <-> "heineken", "raimeken" <-> "heineken")
  if (phonA.length >= 4 && phonB.length >= 4) {
    const dist = computeLevenshteinDistance(phonA, phonB);
    const maxLen = Math.max(phonA.length, phonB.length);
    if (dist <= 1) return 0.88;
    if (maxLen >= 6 && dist <= 2) return 0.78;
  }

  // Fallback character bigram + trigram Dice similarity for fuzzy token matching
  if (tokA.length >= 3 && tokB.length >= 3) {
    const bi = computeCharNGramDice(phonA || tokA, phonB || tokB, 2);
    const tri = computeCharNGramDice(phonA || tokA, phonB || tokB, 3);
    const combined = bi * 0.6 + tri * 0.4;
    if (combined >= 0.58) return combined * 0.9;
  }

  return 0;
}

/**
 * Sliding-window token n-gram similarity: finds the best contiguous sub-phrase
 * inside `candTokens` that matches `searchNorm` (ideal for short/partial queries like
 * "calabresa", "batata", "coca 2l", "coca lata" inside longer menu titles).
 */
function computeBestSubphraseNGramScore(
  searchNorm: string,
  searchTokens: string[],
  candTokens: string[]
): number {
  const maxWin = Math.min(candTokens.length, searchTokens.length + 1);
  let best = 0;
  for (let winSize = 1; winSize <= maxWin; winSize++) {
    for (let start = 0; start <= candTokens.length - winSize; start++) {
      const sliceStr = candTokens.slice(start, start + winSize).join(' ');
      const bi = computeCharNGramDice(searchNorm, sliceStr, 2);
      const tri = computeCharNGramDice(searchNorm, sliceStr, 3);
      const dice = bi * 0.55 + tri * 0.45;
      if (dice > best) best = dice;
    }
  }
  return best;
}

function scoreCandidatePhrase(
  searchNorm: string,
  searchTokens: string[],
  searchQualifiers: { sizeGroup: string | null; variants: Set<string>; isHalfPortion: boolean },
  candRaw: string,
  isPrimaryName: boolean
): number {
  const candNorm = normalizeProductText(candRaw);
  if (!candNorm) return -1;
  const candTokens = tokenizeProduct(candNorm);
  if (candTokens.length === 0) return -1;

  const candQualifiers = extractProductQualifiers(candNorm);

  // Check qualifier conflicts (e.g., user asked for "2 litros" vs catalog item is "Lata 350ml")
  if (
    searchQualifiers.sizeGroup &&
    candQualifiers.sizeGroup &&
    searchQualifiers.sizeGroup !== candQualifiers.sizeGroup
  ) {
    return -999; // Hard disqualification on conflicting container/volume size
  }
  if (searchQualifiers.variants.has('ZERO') !== candQualifiers.variants.has('ZERO')) {
    if (searchQualifiers.variants.has('ZERO') || candQualifiers.variants.has('ZERO')) {
      return -999;
    }
  }
  if (
    (searchQualifiers.variants.has('COM_GAS') && candQualifiers.variants.has('SEM_GAS')) ||
    (searchQualifiers.variants.has('SEM_GAS') && candQualifiers.variants.has('COM_GAS'))
  ) {
    return -999;
  }

  // Best fuzzy token similarity for each spoken token and each candidate token
  let searchSimSum = 0;
  let matchedSearchCount = 0;
  for (const sTok of searchTokens) {
    let bestTokSim = 0;
    for (const cTok of candTokens) {
      const sim = getProductTokenSimilarity(sTok, cTok);
      if (sim > bestTokSim) bestTokSim = sim;
    }
    if (bestTokSim >= 0.55) {
      matchedSearchCount++;
      searchSimSum += bestTokSim;
    }
  }

  let matchedCandCount = 0;
  for (const cTok of candTokens) {
    let bestTokSim = 0;
    for (const sTok of searchTokens) {
      const sim = getProductTokenSimilarity(sTok, cTok);
      if (sim > bestTokSim) bestTokSim = sim;
    }
    if (bestTokSim >= 0.55) {
      matchedCandCount++;
    }
  }

  // Character n-gram Dice (full + sliding-window token n-gram subphrase)
  const fullDice =
    computeCharNGramDice(searchNorm, candNorm, 2) * 0.55 +
    computeCharNGramDice(searchNorm, candNorm, 3) * 0.45;
  const subphraseDice = computeBestSubphraseNGramScore(searchNorm, searchTokens, candTokens);
  const bestNGramDice = Math.max(fullDice, subphraseDice);

  if (matchedSearchCount === 0 && bestNGramDice < 0.48) return -1;

  const avgSearchSim = matchedSearchCount > 0 ? searchSimSum / searchTokens.length : 0;
  let score = 0;

  if (searchNorm === candNorm) {
    score = 1000;
  } else if (
    matchedSearchCount === searchTokens.length &&
    matchedCandCount === candTokens.length
  ) {
    // All tokens match (including fuzzy/prefix/unordered e.g. "skol lata" === "lata skol")
    score = Math.round(780 + avgSearchSim * 120);
  } else if (matchedSearchCount === searchTokens.length) {
    // Every word the user spoke matched inside this candidate (e.g. "coca 2l" inside "coca cola 2l", or "batata" inside "porcao batata frita")
    const extraCandTokens = Math.max(0, candTokens.length - matchedCandCount);
    score = Math.round(540 + avgSearchSim * 160 + bestNGramDice * 80 - extraCandTokens * 25);
  } else if (matchedCandCount === candTokens.length) {
    // Candidate is a subset of what the user spoke (e.g. generic synonym)
    const missingFromCand = Math.max(0, searchTokens.length - matchedSearchCount);
    score = Math.round(300 + avgSearchSim * 100 + bestNGramDice * 60 - missingFromCand * 75);
  } else if (matchedSearchCount > 0 && matchedSearchCount / searchTokens.length >= 0.5) {
    // Partial token overlap boosted by n-gram subphrase similarity
    const unmatchedSearch = searchTokens.length - matchedSearchCount;
    const extraCand = candTokens.length - matchedCandCount;
    score = Math.round(
      240 + avgSearchSim * 140 + bestNGramDice * 120 - unmatchedSearch * 75 - extraCand * 18
    );
  } else if (bestNGramDice >= 0.52) {
    // Pure character n-gram fuzzy match (catches merged words / heavy STT typos like "longneck" / "heinekem" / "cocacola")
    score = Math.round(220 + bestNGramDice * 260);
  } else {
    return -1;
  }

  // Strong boost if size/variant qualifier explicitly matches
  if (
    searchQualifiers.sizeGroup &&
    candQualifiers.sizeGroup &&
    searchQualifiers.sizeGroup === candQualifiers.sizeGroup
  ) {
    score += 320;
  }
  if (searchQualifiers.variants.has('ZERO') && candQualifiers.variants.has('ZERO')) {
    score += 180;
  }
  if (searchQualifiers.isHalfPortion && candQualifiers.isHalfPortion) {
    score += 200;
  } else if (searchQualifiers.isHalfPortion && !candQualifiers.isHalfPortion) {
    score -= 160;
  } else if (!searchQualifiers.isHalfPortion && candQualifiers.isHalfPortion) {
    score -= 90;
  }
  // Slight preference if user didn't specify size and candidate also doesn't lock to a specific size
  if (!searchQualifiers.sizeGroup && candQualifiers.sizeGroup) {
    score -= 25;
  }
  if (isPrimaryName) {
    score += 35;
  }

  return score;
}

function matchCatalogItemStrictly(
  itemSearchText: string,
  catalog: MenuItem[]
): { item?: MenuItem; errorReason?: string } {
  const searchNorm = normalizeProductText(itemSearchText);
  if (!searchNorm) {
    return { errorReason: 'Nome do produto vazio. Nada foi marcado.' };
  }

  // Explicitly block spoken choices with "ou" (e.g., "coca lata ou coca cola 2 litros")
  if (/\bou\b/i.test(searchNorm)) {
    return {
      errorReason: `Você disse duas opções com "ou" ("${itemSearchText}"). Por segurança, diga apenas o produto exato que deseja marcar.`,
    };
  }

  const searchTokens = tokenizeProduct(searchNorm);
  if (searchTokens.length === 0) {
    return { errorReason: `Não identifiquei o produto "${itemSearchText}". Nada foi marcado.` };
  }

  const searchQualifiers = extractProductQualifiers(searchNorm);

  const scoredItems: Array<{ item: MenuItem; score: number; hasHardConflictOnName: boolean }> = [];

  for (const menuItem of catalog) {
    const nameNorm = normalizeProductText(menuItem.name);
    const nameQualifiers = extractProductQualifiers(nameNorm);
    const hasHardConflictOnName =
      Boolean(
        searchQualifiers.sizeGroup &&
          nameQualifiers.sizeGroup &&
          searchQualifiers.sizeGroup !== nameQualifiers.sizeGroup
      ) ||
      (searchQualifiers.variants.has('ZERO') !== nameQualifiers.variants.has('ZERO') &&
        (searchQualifiers.variants.has('ZERO') || nameQualifiers.variants.has('ZERO')));

    if (hasHardConflictOnName) {
      continue;
    }

    const synonymList = menuItem.synonyms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let bestItemScore = scoreCandidatePhrase(
      searchNorm,
      searchTokens,
      searchQualifiers,
      menuItem.name,
      true
    );

    for (const syn of synonymList) {
      const synScore = scoreCandidatePhrase(
        searchNorm,
        searchTokens,
        searchQualifiers,
        syn,
        false
      );
      if (synScore > bestItemScore) {
        bestItemScore = synScore;
      }
    }

    // Also score against combined primary name + synonyms n-grams when user combines brand + size
    if (synonymList.length > 0) {
      const combinedScore = scoreCandidatePhrase(
        searchNorm,
        searchTokens,
        searchQualifiers,
        `${menuItem.name} ${synonymList.join(' ')}`,
        false
      );
      if (combinedScore - 80 > bestItemScore) {
        bestItemScore = combinedScore - 80;
      }
    }

    if (bestItemScore >= 240) {
      scoredItems.push({ item: menuItem, score: bestItemScore, hasHardConflictOnName });
    }
  }

  if (scoredItems.length === 0) {
    return {
      errorReason: `O produto "${itemSearchText}" não está cadastrado no cardápio. Nada foi marcado.`,
    };
  }

  scoredItems.sort((a, b) => b.score - a.score);

  const top1 = scoredItems[0];
  const top2 = scoredItems[1];

  // Ambiguity guard: if top 2 distinct menu items are too close in score (even on shared exact synonyms like "coca")
  if (top2 && top2.score >= top1.score - 55) {
    return {
      errorReason: `Ficou ambíguo para "${itemSearchText}": você quer "${top1.item.name}" ou "${top2.item.name}"? Nada foi marcado.`,
    };
  }

  return { item: top1.item };
}

function parseSingleSegmentQtyAndName(seg: string): {
  qty: number;
  itemSearchText: string;
} {
  const segNorm = normalizeText(seg).replace(
    /^(?:marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais|de|do|da)\s+/i,
    ''
  );
  let qty = 1;
  let itemSearchText = segNorm;

  const qtyMatch = segNorm.match(
    /^(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b\s*(.*)$/
  );
  if (qtyMatch && qtyMatch[2]) {
    const remainder = qtyMatch[2].trim();
    // Do NOT treat volume/weight/fraction numbers like "2 litros de coca", "2 e meio", or "600 ml" as quantity
    const startsWithUnit =
      /^(?:litros?|l\b|mls?\b|gramas?|g\b|kg\b|e\s+mei[oa]\b)/i.test(remainder);
    if (!startsWithUnit) {
      const qToken = qtyMatch[1];
      qty = Number.isNaN(Number(qToken)) ? PT_NUMBERS[qToken] || 1 : parseInt(qToken, 10);
      itemSearchText = remainder.replace(/^(de\s+)/, '').trim();
    }
  }

  return { qty, itemSearchText };
}

/**
 * Splits order items cleanly by comma (ignoring decimal commas like "2,5") and " e ",
 * while preserving compound product names like "Coca Cola 2L e Meio", "2 litros e meio",
 * "2 e meio", "Meio a Meio", or catalog items that legitimately contain " e ".
 */
function smartSplitOrderSegments(rawOrderText: string, catalog: MenuItem[]): string[] {
  const commaChunks = rawOrderText
    .split(/,(?!\d)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const COMPOUND_MARKER = '__COMPOUND_E__';
  const result: string[] = [];

  for (const chunk of commaChunks) {
    const protectedChunk = chunk
      .replace(
        /\b(\d+|um|uma|dois|duas|tr[eê]s|1l|2l|3l|litros?|l)\s+e\s+(mei[oa])\b/gi,
        `$1 ${COMPOUND_MARKER} $2`
      )
      .replace(/\b(meio)\s+a\s+(meio)\b/gi, '$1 a $2');

    const unmasked = protectedChunk.replace(new RegExp(COMPOUND_MARKER, 'g'), 'e');

    // If there's an explicit quantity after " e " (e.g. "1 litrão e 2 água"), split there
    const hasExplicitNextItemQty =
      /\s+e\s+(?=(?:\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|mais)\b)/i.test(
        protectedChunk
      );

    if (!hasExplicitNextItemQty && /\s+e\s+/i.test(protectedChunk)) {
      const wholeParsed = parseSingleSegmentQtyAndName(unmasked);
      if (wholeParsed.itemSearchText) {
        const directWholeMatch = matchCatalogItemStrictly(wholeParsed.itemSearchText, catalog);
        if (directWholeMatch.item) {
          result.push(unmasked);
          continue;
        }
      }
    }

    const parts = protectedChunk
      .split(/\s+e\s+/i)
      .map((p) => p.replace(new RegExp(COMPOUND_MARKER, 'g'), 'e').trim())
      .filter(Boolean);

    result.push(...parts);
  }

  return result;
}

/**
 * Parses a single clause for the 4 core intents:
 * 1. MARCAR (add items to customer's tab)
 * 2. FECHAR (close/review bill, or answer "quanto/quando ficou a conta do cliente")
 * 3. BAIXA (record payment / dar baixa)
 * 4. VENDA_AVULSA (direct counter sale, settled immediately with no tab/table)
 */
function parseSingleClauseStrictly(
  clause: string,
  catalog: MenuItem[],
  existingCustomerNames: string[],
  fallbackSelectedCustomerName?: string
): { command: ParsedSingleCommand | null; errorReason?: string } {
  const cleaned = stripPolitePrefixes(clause.trim().replace(/^[,.;:\s]+|[,.;:\s]+$/g, ''));
  if (!cleaned) return { command: null, errorReason: 'Comando vazio.' };

  const norm = normalizeText(cleaned);

  // Detect Intent:
  // 1) VENDA_AVULSA: immediate counter/walk-in sale with instant payment ("venda avulsa de litrão no pix")
  // 2) BAIXA: "dar baixa", "pagou", "quitou", "zerar", etc.
  // 3) FECHAR / CONSULTAR CONTA: "fechar", "quanto ficou", etc.
  // 4) MARCAR: default when adding items to a customer/table tab
  let intent: MarceloIntent = 'MARCAR';

  if (
    /\b(?:venda\s+avulsa|venda\s+direta|vendas\s+avulsas|avulsa|avulso|venda\s+(?:de\s+|no\s+)?balcao)\b/i.test(
      norm
    )
  ) {
    intent = 'VENDA_AVULSA';
  } else if (
    /\b(baixa|dar\s+(?:a\s+|uma\s+)?baixa|dar\s+(?:a\s+)?baixar|d[aáeê]\s+(?:a\s+|uma\s+)?baixa|deu\s+(?:a\s+)?baixa|t[aá]\s+baixa|dar\s+abaixa|fazer\s+(?:a\s+|uma\s+)?baixa|faz\s+(?:a\s+|uma\s+)?baixa|abaixar|abaixa|baixar|baixe|pagou|pagar|paga|recebi|quitou|quitar|quita|zerar|zere|zera|abater)\b/i.test(
      norm
    )
  ) {
    intent = 'BAIXA';
  } else if (
    /\b(fechar|feche|fecha|fechamento|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quando\s+deu|quanto\s+ta|quanto\s+esta|qual\s+o\s+total|qual\s+o\s+valor|qual\s+e\s+a\s+conta|pediu\s+a\s+conta|resumo\s+da\s+conta|ver\s+a\s+conta|fala\s+a\s+conta|passa\s+a\s+conta|me\s+passa\s+a\s+conta|me\s+passe\s+a\s+conta)\b/i.test(
      norm
    )
  ) {
    intent = 'FECHAR';
  }

  // Handle VENDA_AVULSA (Direct Walk-in / Counter Sale — No Customer Tab/Table)
  if (intent === 'VENDA_AVULSA') {
    let paymentMethod = 'PIX';
    if (/\b(?:dinheiro|especie|esp[eé]cie|cash)\b/i.test(norm)) paymentMethod = 'Dinheiro';
    else if (/\bcr[eé]dito\b|\bcredito\b/i.test(norm)) paymentMethod = 'Cartão de Crédito';
    else if (/\bd[eé]bito\b|\bdebito\b|\bcart[aã]o\b|\bcartao\b/i.test(norm)) {
      paymentMethod = 'Cartão de Débito';
    }

    let cleanedSale = sanitizeVoiceTranscriptForParsing(cleaned)
      .replace(/\b(?:no|via|em|pelo|com)\s+pix\b/gi, ' ')
      .replace(/\b(?:no|via|em|pelo|com)\s+cart[aã]o(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?\b/gi, ' ')
      .replace(/\b(?:no|via|em|pelo|com)\s+(?:cr[eé]dito|d[eé]bito)\b/gi, ' ')
      .replace(/\b(?:no|via|em|pelo|com)\s+(?:dinheiro|esp[eé]cie)\b/gi, ' ')
      .replace(/\b(?:pix|dinheiro|cart[aã]o)\s*$/i, ' ')
      .replace(/\b(?:[àa]\s+vista|j[aá]\s+pago|j[aá]\s+baixa|dar\s+baixa|na\s+hora)\b/gi, ' ')
      .replace(
        /^(?:fazer|faz|lan[cç]ar|lanca|registrar|registra|passar|passa|anotar|anota|marcar|marca|botar|bota)?\s*(?:uma\s+|a\s+)?(?:venda\s+avulsa|venda\s+direta|venda\s+(?:de\s+|no\s+)?balc[aã]o|avulsa|avulso)\s*(?:de|do|da)?\s*/i,
        ''
      )
      .replace(/\b(?:no\s+balc[aã]o|venda\s+avulsa|venda\s+direta|avulsa|avulso)\b/gi, ' ')
      .replace(/\s+(?:por\s+favor|por\s+gentileza|pf|obrigado|obrigada|valeu)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    cleanedSale = cleanedSale.replace(/^(?:de|do|da)\s+/i, '').trim();

    const saleSegments = smartSplitOrderSegments(cleanedSale, catalog);

    if (saleSegments.length === 0) {
      return {
        command: null,
        errorReason:
          'Não identifiquei qual produto foi vendido na venda avulsa. Diga por exemplo: "Marcelo, venda avulsa de litrão no pix".',
      };
    }

    const parsedSaleItems: ParsedOrderItem[] = [];
    for (const seg of saleSegments) {
      const { qty, itemSearchText } = parseSingleSegmentQtyAndName(seg);

      if (!itemSearchText) {
        return {
          command: null,
          errorReason: `Produto incompleto na venda avulsa ("${seg}"). Nada foi lançado.`,
        };
      }

      const matchResult = matchCatalogItemStrictly(itemSearchText, catalog);
      if (!matchResult.item) {
        return {
          command: null,
          errorReason:
            matchResult.errorReason ||
            `O produto "${itemSearchText}" não está cadastrado no cardápio. Nada foi lançado.`,
        };
      }

      parsedSaleItems.push({
        itemName: matchResult.item.name,
        category: matchResult.item.category,
        quantity: Math.min(Math.max(qty, 1), VALIDATION_LIMITS.MAX_QTY),
        unitPrice: matchResult.item.price,
      });
    }

    return {
      command: {
        intent: 'VENDA_AVULSA',
        customerName: 'Venda Avulsa',
        tableLabel: 'VENDA_AVULSA',
        paymentMethod,
        items: parsedSaleItems,
      },
    };
  }

  // Handle FECHAR / QUANTO FICOU A CONTA
  if (intent === 'FECHAR') {
    const rawCustomerName =
      extractCustomerForAccountAction(cleaned, existingCustomerNames) ||
      (fallbackSelectedCustomerName?.trim() || '');
    const customerName = rawCustomerName
      ? resolveCustomerNameFromExisting(rawCustomerName, existingCustomerNames)
      : '';

    if (!customerName) {
      return {
        command: null,
        errorReason: `Não identifiquei o nome do cliente para consultar/fechar a conta. Diga por exemplo: "Quanto ficou a conta do Tiago?" ou "Feche a conta do Tiago".`,
      };
    }

    return {
      command: {
        intent: 'FECHAR',
        customerName: sanitizeString(customerName, VALIDATION_LIMITS.NAME_MAX_LEN),
        tableLabel: '',
        items: [],
      },
    };
  }

  // Handle BAIXA (Pagamento)
  if (intent === 'BAIXA') {
    let paymentAmount: number | undefined;
    // Match explicit currency/amount (e.g., "baixa de 20 reais", "20 reais", "R$ 20") without matching "mesa 2"
    const amountMatch =
      norm.match(
        /(?:de\s+(?:reais\s+|valor\s+)?|valor\s+|reais\s+|rs\s+|r\$\s*)(\d+(?:[.,]\d+)?)\s*(?:reais|real|conto|pila)?/i
      ) || norm.match(/(\d+(?:[.,]\d+)?)\s*(?:reais|real|conto|pila)\b/i);

    if (amountMatch && amountMatch[1]) {
      const val = parseFloat(amountMatch[1].replace(',', '.'));
      if (val > 0) paymentAmount = val;
    }

    const keepConsuming = /\b(continua|continuar|aberta|bebendo|consumindo|parcial)\b/i.test(norm);
    let paymentMethod = 'PIX';
    if (/\bcash|dinheiro|especie\b/i.test(norm)) paymentMethod = 'Dinheiro';
    else if (/\bcredito\b/i.test(norm)) paymentMethod = 'Cartão de Crédito';
    else if (/\bdebito|cartao\b/i.test(norm)) paymentMethod = 'Cartão de Débito';

    const rawCustomerName =
      extractCustomerForAccountAction(cleaned, existingCustomerNames) ||
      (fallbackSelectedCustomerName?.trim() || '');
    const customerName = rawCustomerName
      ? resolveCustomerNameFromExisting(rawCustomerName, existingCustomerNames)
      : '';

    if (!customerName) {
      return {
        command: null,
        errorReason: `Não identifiquei o nome do cliente para dar baixa. Selecione a comanda na lista ou diga: "Dar baixa na conta do Tiago".`,
      };
    }

    return {
      command: {
        intent: 'BAIXA',
        customerName: sanitizeString(customerName, VALIDATION_LIMITS.NAME_MAX_LEN),
        tableLabel: '',
        paymentAmount,
        paymentMethod,
        keepConsuming,
        items: [],
      },
    };
  }

  // Handle MARCAR (Stage 1: Add items to customer tab)
  let customerName = '';
  let tableLabel = '';
  // Strip trailing polite phrases/punctuation before isolating the target customer name
  const cleanedForMarcar = sanitizeVoiceTranscriptForParsing(cleaned)
    .replace(/\s+(?:por\s+favor|por\s+gentileza|pf|obrigado|obrigada|valeu)\s*$/i, '')
    .trim();
  let orderPart = cleanedForMarcar;

  const explicitTargetRegex =
    /^(.*)\b(?:na\s+comanda\s+d[oa]\s+|na\s+conta\s+d[oa]\s+|comanda\s+d[oa]\s+|conta\s+d[oa]\s+|na\s+para\s+o?\s*|para\s+o\s+|para\s+a\s+|para\s+|pro\s+|pra\s+)([a-zA-ZÀ-ÿ0-9\s]{2,45})$/i;
  const fallbackTargetRegex =
    /^(.*)\b(?:no\s+|na\s+)([a-zA-ZÀ-ÿ0-9\s]{2,45})$/i;
  const matchTarget =
    cleanedForMarcar.match(explicitTargetRegex) ||
    cleanedForMarcar.match(fallbackTargetRegex);

  if (matchTarget && matchTarget[2]) {
    const rawTarget = cleanCustomerCandidateText(matchTarget[2]);
    orderPart = matchTarget[1].trim();
    customerName = resolveCustomerNameFromExisting(rawTarget, existingCustomerNames);

    if (/^mesa\s+\d+/i.test(customerName)) {
      tableLabel = customerName;
    }
  }

  if (!customerName || customerName.length < 2) {
    return {
      command: null,
      errorReason: `Não entendi para qual cliente marcar. Diga por exemplo: "Marca 1 litrão para Tiago".`,
    };
  }

  const strippedOrderPart = orderPart
    .replace(
      /^(marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais)\s+/i,
      ''
    )
    .trim();
  const segments = smartSplitOrderSegments(strippedOrderPart, catalog);

  if (segments.length === 0) {
    return {
      command: null,
      errorReason: `Não identifiquei o produto para marcar na conta de ${customerName}.`,
    };
  }

  const parsedItems: ParsedOrderItem[] = [];

  for (const seg of segments) {
    const { qty, itemSearchText } = parseSingleSegmentQtyAndName(seg);

    if (!itemSearchText) {
      return {
        command: null,
        errorReason: `Produto incompleto no trecho "${seg}". Nada foi marcado.`,
      };
    }

    const matchResult = matchCatalogItemStrictly(itemSearchText, catalog);

    if (!matchResult.item) {
      return {
        command: null,
        errorReason:
          matchResult.errorReason ||
          `O produto "${itemSearchText}" não está cadastrado no cardápio. Nada foi marcado.`,
      };
    }

    parsedItems.push({
      itemName: matchResult.item.name,
      category: matchResult.item.category,
      quantity: Math.min(Math.max(qty, 1), VALIDATION_LIMITS.MAX_QTY),
      unitPrice: matchResult.item.price,
    });
  }

  return {
    command: {
      intent: 'MARCAR',
      customerName: sanitizeString(customerName, VALIDATION_LIMITS.NAME_MAX_LEN),
      tableLabel: sanitizeString(tableLabel, VALIDATION_LIMITS.TABLE_MAX_LEN, ''),
      items: parsedItems,
    },
  };
}

/**
 * Detects the "MARCELO" wake word in an open-microphone transcript (e.g. Bluetooth headset).
 * If the waiter is chatting with customers ("já trago pra senhora... Marcelo, marca 1 litrão pro Tiago"),
 * discards all background speech before "Marcelo" and extracts only the command directed at the assistant.
 * Also safely distinguishes "Marcelo" as wake-word vs "Marcelo" as a customer name ("dar baixa no Marcelo").
 */
export function extractCommandAfterMarceloWakeWord(transcript: string): {
  hasWakeWord: boolean;
  isOnlyWakeWord: boolean;
  commandTranscript: string;
} {
  const cleaned = (transcript ?? '').trim();
  const norm = normalizeText(cleaned);
  if (!norm) {
    return { hasWakeWord: false, isOnlyWakeWord: false, commandTranscript: '' };
  }

  // 1. User spoke ONLY the wake word (e.g. "Marcelo", "Oi Marcelo", "Ei Marcelo", "Fala Marcelo")
  if (
    /^(?:(?:oi|ola|ei|opa|fala|escuta|ai|ou)\s+)*(?:marcelo|marcello|marcelinho)[\s,.:;!?-]*$/i.test(
      norm
    )
  ) {
    return { hasWakeWord: true, isOnlyWakeWord: true, commandTranscript: '' };
  }

  // 2. Wake word at the beginning of the sentence (not followed by "pagou/quitou/pediu" where Marcelo is the customer)
  const startMatch = cleaned.match(
    /^(?:(?:oi|ola|olá|ei|opa|fala|escuta|ai|aí)\s+)*(?:marcelo|marcello|marcelinho)[\s,.:;!?-]+(?!pagou\b|quitou\b|pediu\b)(.+)$/i
  );
  if (startMatch && startMatch[1]) {
    return {
      hasWakeWord: true,
      isOnlyWakeWord: false,
      commandTranscript: startMatch[1].trim(),
    };
  }

  // 3. Wake word spoken in the middle of open-microphone conversation right before an order/action verb
  // e.g. "beleza amigo já trago viu marcelo marca 1 litrão para o tiago"
  const midWakeRegex =
    /\b(?:(?:oi|ola|olá|ei|opa|fala|escuta)\s+)?(?:marcelo|marcello|marcelinho)[\s,.:;!?-]+(?=(?:por\s+favor|pf|quero|preciso|pode|poderia|vamos|me\s+ve|me\s+vê|me\s+fala|me\s+diz|me\s+passa|marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais|um|uma|dois|duas|tres|três|quatro|cinco|seis|1|2|3|4|5|6|feche|fecha|fechar|quanto|quando|qual|ver\s+a\s+conta|resumo|dar|da|dá|de|dê|fazer|faz|baixa|baixar|abaixa|abaixar|quitar|quite|zerar|pagar|receber)\b)/i;
  const midMatch = midWakeRegex.exec(cleaned);
  if (midMatch && typeof midMatch.index === 'number') {
    const afterWake = cleaned.slice(midMatch.index + midMatch[0].length).trim();
    if (afterWake) {
      return {
        hasWakeWord: true,
        isOnlyWakeWord: false,
        commandTranscript: afterWake,
      };
    }
  }

  // 4. Wake word spoken at the very end of a sentence to trigger listening (e.g. "blz obrigado viu, ei marcelo")
  if (/(?:,\s*|\s+)(?:(?:oi|ola|olá|ei|opa|fala|escuta)\s+)(?:marcelo|marcello|marcelinho)[\s,.:;!?-]*$/i.test(norm)) {
    return { hasWakeWord: true, isOnlyWakeWord: true, commandTranscript: '' };
  }

  return {
    hasWakeWord: false,
    isOnlyWakeWord: false,
    commandTranscript: cleaned,
  };
}

/**
 * Supports chained continuous voice commands without pauses:
 * e.g. "Marcelo, marca um litrão para Thiago, marca um litrão para Jonas"
 * AND understands MARCAR, FECHAR ("quanto/quando ficou a conta do Tiago"), and DAR BAIXA
 * ("dar baixa na conta do Thiago", "dá baixa no Tiago", "dar baixa na conta").
 */
export function parseVoiceOrderLocally(
  transcript: string,
  catalog: MenuItem[],
  existingCustomerNames: string[],
  fallbackSelectedCustomerName?: string
): ParsedVoiceOrder {
  // 1. Aggressive pre-normalization: strip special characters, emojis, currency symbols, and stray punctuation
  const rawCleaned = sanitizeVoiceTranscriptForParsing(transcript);
  const normFull = normalizeText(rawCleaned);

  // 2. Pre-normalize existing customer names and fallback customer name before searching
  const normalizedExistingCustomers = Array.from(
    new Set(
      (existingCustomerNames || [])
        .map((name) => sanitizeVoiceTranscriptForParsing(name))
        .filter((name) => normalizeCustomerNameForSearch(name).length >= 2)
    )
  );
  const cleanFallbackCustomer = fallbackSelectedCustomerName
    ? resolveCustomerNameFromExisting(
        sanitizeVoiceTranscriptForParsing(fallbackSelectedCustomerName),
        normalizedExistingCustomers
      )
    : undefined;

  const wakeExtraction = extractCommandAfterMarceloWakeWord(rawCleaned);
  const addressedToMarcelo = wakeExtraction.hasWakeWord || /\bmarcelo\b/i.test(normFull);

  let spokenPin = '';
  const pinMatch = normFull.match(/\b(?:codigo|senha|pin)\s+([a-z0-9]+)\b/i);
  if (pinMatch && pinMatch[1]) {
    spokenPin = pinMatch[1];
  }

  const effectiveRaw = wakeExtraction.hasWakeWord
    ? wakeExtraction.commandTranscript
    : rawCleaned;

  const withoutWake = stripPolitePrefixes(
    sanitizeVoiceTranscriptForParsing(effectiveRaw)
      .replace(
        /^(?:oi\s+|ola\s+|olá\s+|ei\s+|fala\s+)?(?:marcelo[\s,.:;-]+)(?!pagou\b|quitou\b|pediu\b)/i,
        ''
      )
      .replace(/\b(?:codigo|senha|pin)\s+[a-z0-9]+\b/gi, '')
      .trim()
  );

  if (!withoutWake) {
    return {
      understood: false,
      unrecognizedReason:
        'Diga o comando completo, por exemplo: "Marcelo, marca 1 litrão para Tiago" ou "Marcelo, dar baixa na conta do Tiago".',
      addressedToMarcelo,
      spokenPin,
      commands: [],
    };
  }

  // Split continuous rapid speech into candidate clauses ONLY on multi-command boundaries.
  // Never split "dar" + "uma" + "baixa", "dar" + "baixa", "dá" + "baixa", "dê" + "baixa", or polite auxiliary words.
  const rawParts = withoutWake
    .split(
      /(?:,\s*|\s+e\s+|\s+)(?=(?:marque|marca|marcar|coloca|coloque|adiciona|bota|lanca|lança|anota|feche|fecha|fechar|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quando\s+deu|quanto\s+ta|venda\s+avulsa|venda\s+direta|dar\s+(?:a\s+|uma\s+)?baixa|dar\s+(?:a\s+)?baixar|d[aáeê]\s+(?:a\s+|uma\s+)?baixa|fazer\s+(?:a\s+|uma\s+)?baixa|faz\s+(?:a\s+|uma\s+)?baixa|baixar|quitar|zerar)\b)|(?:,\s*|\s+e\s+)(?=(?:baixa\s+(?:n[oa]|d[oa]|a\s+conta)\b))/i
    )
    .map((c) => c.trim())
    .filter(Boolean);

  // Merge any introductory / incomplete prefix fragment with the following clause
  // (e.g., if a user said "fechar e dar baixa na conta do Thiago" or "dar baixa e fechar a conta do Thiago")
  const mergedClauses: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    const normPart = normalizeText(part);
    const isFillerOrIncompleteVerb =
      /^(?:eu|quero|peco|pedi|para|pra|por\s+favor|pf|pode|poderia|vamos|dar|dar\s+a|dar\s+uma|da|da\s+a|da\s+uma|de|fazer|fazer\s+a|fazer\s+uma|faz|faz\s+a|fechar|feche|fecha|fechar\s+a\s+conta|feche\s+a\s+conta)$/i.test(
        normPart
      );
    if (isFillerOrIncompleteVerb && i + 1 < rawParts.length) {
      if (/^(?:fechar|feche|fecha)/i.test(normPart)) {
        continue;
      }
      rawParts[i + 1] = `${part} ${rawParts[i + 1]}`;
      continue;
    }

    // If user said "dar baixa e fechar a conta do Thiago", merge into "dar baixa a conta do Thiago"
    const isBareBaixa =
      /^(?:dar\s+(?:a\s+|uma\s+)?baixa|d[aáeê]\s+(?:a\s+|uma\s+)?baixa|baixa|baixar)$/i.test(
        normPart
      );
    if (isBareBaixa && i + 1 < rawParts.length && /^(?:fechar|feche|fecha)\b/i.test(normalizeText(rawParts[i + 1]))) {
      const nextWithoutFechar = rawParts[i + 1].replace(/^(?:fechar|feche|fecha)\s*/i, '').trim();
      mergedClauses.push(`${part} ${nextWithoutFechar}`.trim());
      i++;
      continue;
    }

    mergedClauses.push(part);
  }

  const finalClauses = mergedClauses.length > 0 ? mergedClauses : [withoutWake];
  const commands: ParsedSingleCommand[] = [];
  // Keep customer name identity consistent across chained clauses (e.g. "Thiago" and "Tiago" in same breath)
  const runningCustomers = [...normalizedExistingCustomers];

  for (const clause of finalClauses) {
    const { command, errorReason } = parseSingleClauseStrictly(
      clause,
      catalog,
      runningCustomers,
      cleanFallbackCustomer
    );
    if (!command) {
      return {
        understood: false,
        unrecognizedReason:
          errorReason ||
          'Não compreendi todos os itens ou clientes falados. Por segurança, nada foi marcado.',
        addressedToMarcelo,
        spokenPin,
        commands: [],
      };
    }
    if (
      command.customerName &&
      !runningCustomers.some((c) => areCustomerNamesEquivalent(c, command.customerName))
    ) {
      runningCustomers.push(command.customerName);
    }
    commands.push(command);
  }

  if (commands.length === 0) {
    return {
      understood: false,
      unrecognizedReason: 'Comando não compreendido. Nada foi alterado.',
      addressedToMarcelo,
      spokenPin,
      commands: [],
    };
  }

  return {
    understood: true,
    unrecognizedReason: '',
    addressedToMarcelo,
    spokenPin,
    commands,
  };
}

// --- Voice Cardápio (Product Registration) Engine ---

const PT_SPOKEN_UNITS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  meia: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};

const PT_SPOKEN_TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};

const PT_SPOKEN_HUNDREDS: Record<string, number> = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
};

function parsePortugueseIntPhrase(phrase: string): number | null {
  const norm = normalizeText(phrase);
  if (!norm) return null;
  if (/^\d+$/.test(norm)) {
    const val = parseInt(norm, 10);
    return Number.isFinite(val) ? val : null;
  }

  const tokens = norm.split(/\s+/).filter((t) => t && t !== 'e');
  if (tokens.length === 0) return null;

  let total = 0;
  let matchedAny = false;
  for (const tok of tokens) {
    if (PT_SPOKEN_HUNDREDS[tok] !== undefined) {
      total += PT_SPOKEN_HUNDREDS[tok];
      matchedAny = true;
    } else if (PT_SPOKEN_TENS[tok] !== undefined) {
      total += PT_SPOKEN_TENS[tok];
      matchedAny = true;
    } else if (PT_SPOKEN_UNITS[tok] !== undefined) {
      total += PT_SPOKEN_UNITS[tok];
      matchedAny = true;
    } else {
      return null;
    }
  }
  return matchedAny ? total : null;
}

/**
 * Detects whether a phrase directed at Marcelo is asking to register/add a new
 * product in the bar's Cardápio (menu catalog) rather than marking a customer's tab.
 */
export function isMenuRegistrationVoiceCommand(transcript: string): boolean {
  const wake = extractCommandAfterMarceloWakeWord(transcript);
  const effective = normalizeText(wake.hasWakeWord ? wake.commandTranscript : transcript);
  if (!effective) return false;

  return (
    /\b(?:cadastrar|cadastra|cadastro|criar|cria|novo|nova|incluir|inclui|inserir|insere)\s+(?:um\s+|uma\s+|o\s+|a\s+|novo\s+|nova\s+)?(?:produto|item)\b/i.test(
      effective
    ) ||
    /\b(?:adicionar|adiciona|colocar|coloca|botar|bota|cadastrar|cadastra|incluir|inserir)\s+(?:um\s+|uma\s+|o\s+|a\s+)?(?:produto|item)?\s*(?:no|ao|na)\s+(?:cardapio|catalogo|menu|lista\s+de\s+produtos)\b/i.test(
      effective
    ) ||
    /\badicionar\s+(?:um\s+|uma\s+|o\s+|a\s+|novo\s+)?produto\b/i.test(effective)
  );
}

/**
 * Infers the most appropriate bar ItemCategory from explicit spoken category hints
 * or common Brazilian bar product names.
 */
export function inferProductCategory(
  productName: string,
  explicitHint?: string
): ItemCategory {
  const hintNorm = normalizeText(explicitHint || '');
  if (hintNorm) {
    if (/\b(?:cerveja|cervejas|chopp|breja)\b/.test(hintNorm)) return 'cervejas';
    if (/\b(?:dose|doses|drink|drinks|destilado|destilados|coquetel|coqueteis)\b/.test(hintNorm)) {
      return 'doses';
    }
    if (/\b(?:prato|pratos|refeicao|refeicoes|almoco|jantar|executivo|pf|marmita|marmitex)\b/.test(hintNorm)) {
      return 'pratos';
    }
    if (/\b(?:porcao|porcoes|espeto|espetos|espetinho|espetinhos|petisco|petiscos|lanche)\b/.test(hintNorm)) {
      return 'porcoes';
    }
    if (/\b(?:sobremesa|sobremesas|doce|doces)\b/.test(hintNorm)) {
      return 'sobremesas';
    }
    if (/\b(?:sem\s+alcool|nao\s+alcool|nao\s+alcoolico|refri|refrigerante|refrigerantes|agua|suco|energetico)\b/.test(hintNorm)) {
      return 'sem_alcool';
    }
    if (/\b(?:outro|outros|diversos|geral)\b/.test(hintNorm)) return 'outros';
  }

  const norm = normalizeText(productName);
  if (
    /\b(?:cerveja|chopp|chope|litrao|litroes|skol|brahma|heineken|original|antarctica|antartica|bohemia|budweiser|corona|stella|amstel|spaten|sub\s*zero|itaipava|kaiser|petra|devassa|imperio|eisenbahn|becks|michelob|colorado|baden|patagonia|schin|bavaria|glacier|crystal|long\s*neck|longneck|latao)\b/.test(
      norm
    )
  ) {
    return 'cervejas';
  }
  if (
    /\b(?:dose|cachaca|pinga|whisky|uisque|vodka|vodca|gin|campari|caipirinha|caipiroska|caipivodka|drink|batida|tequila|rum|conhaque|licor|vinho|espumante|montilla|jack\s*daniels|red\s*label|black\s*label|ballantines|johnnie|chivas|absolut|smirnoff|tanqueray|beefeater|jurupinga|catuaba|aperol|negroni|mojito|margarita|martini)\b/.test(
      norm
    )
  ) {
    return 'doses';
  }
  if (
    /\b(?:prato|pf|executivo|marmita|marmitex|parmegiana|strogonoff|estrogonofe|feijoada|bife|acebolado|file\s+mignon|virado|baiao|galinhada|tropeiro|macarrao|espaguete|lasanha|risoto|moqueca|salmao|omelete|salada|sopa|caldo|refeicao|almoco|jantar|self\s+service)\b/.test(
      norm
    )
  ) {
    return 'pratos';
  }
  if (
    /\b(?:pudim|sorvete|acai|torta|bolo|mousse|petit\s+gateau|sobremesa|brigadeiro|brownie|pave|romeu\s+e\s+julieta|cocada|doce)\b/.test(
      norm
    )
  ) {
    return 'sobremesas';
  }
  if (
    /\b(?:porcao|espetinho|espeto|churrasquinho|batata|fritas|calabresa|torresmo|panceta|pururuca|mandioca|aipim|macaxeira|polenta|frango|passarinho|carne|picanha|contra\s*file|alcatra|linguica|salgado|pastel|coxinha|kibe|quibe|bolinho|tira\s*gosto|petisco|amendoim|queijo|provolone|sanduiche|lanche|hamburguer|burger|xis|tapioca|isca|camarao|tilapia|peixe|salame)\b/.test(
      norm
    )
  ) {
    return 'porcoes';
  }
  if (
    /\b(?:coca|guarana|fanta|sprite|pepsi|refri|refrigerante|agua|suco|energetico|red\s*bull|redbull|monster|tnt|bally|h2oh|tonica|schweppes|gelo|cafe|cha|del\s*valle|toddynho|achocolatado|limonada|soda)\b/.test(
      norm
    )
  ) {
    return 'sem_alcool';
  }
  return 'outros';
}

function formatProductNamePt(raw: string): string {
  const lowerKeep = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'e', 'ao', 'em', 'a']);
  const tokens = raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);

  return tokens
    .map((tok, idx) => {
      const lower = tok.toLowerCase();
      // Preserve units like 350ml, 600ml, 1L, 2L
      if (/^\d+ml$/i.test(lower)) return `${lower.slice(0, -2)}ml`;
      if (/^\d+l$/i.test(lower)) return `${lower.slice(0, -1)}L`;
      if (/^\d+g$/i.test(lower)) return `${lower.slice(0, -1)}g`;
      if (idx > 0 && lowerKeep.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function buildAutoProductSynonyms(name: string, explicitSynonyms?: string): string {
  if (explicitSynonyms && explicitSynonyms.trim()) {
    return sanitizeString(explicitSynonyms.trim(), VALIDATION_LIMITS.SYNONYMS_MAX_LEN);
  }
  const cleanLower = name.trim().toLowerCase();
  const asciiLower = normalizeText(name);
  const parts = [cleanLower];
  if (asciiLower && asciiLower !== cleanLower) {
    parts.push(asciiLower);
  }
  return sanitizeString(parts.join(', '), VALIDATION_LIMITS.SYNONYMS_MAX_LEN);
}

function extractPriceFromProductClause(clause: string): {
  price: number | null;
  remainingNameText: string;
} {
  const working = clause.trim();
  const centsTokenRegexStr =
    '(\\d{1,2}|cinquenta|vinte|trinta|quarenta|sessenta|setenta|oitenta|noventa|dez|quinze|cinco|meia)';

  const resolveCents = (rawCents?: string): number => {
    if (!rawCents) return 0;
    const cNorm = normalizeText(rawCents);
    if (cNorm === 'meia') return 50;
    const parsed = /^\d+$/.test(cNorm) ? parseInt(cNorm, 10) : parsePortugueseIntPhrase(cNorm);
    return parsed !== null && parsed >= 0 && parsed < 100 ? parsed : 0;
  };

  // 1A. Explicit separator BEFORE numeric price: "porção de salame reais 15", "dose de 51 reais 8", "dose de 51 reais 8 e 50", "cachaça 51 valor 10"
  const sepBeforeNumRegex = new RegExp(
    `(?:\\b(?:por|a|custa|custando|sai(?:\\s+a)?)\\s+)?\\b(?:reais|real|valor(?:\\s+de)?|preco(?:\\s+de)?|preço(?:\\s+de)?)\\s+(?:de\\s+)?(\\d+(?:[.,]\\d{1,2})?)(?:\\s+e\\s+${centsTokenRegexStr}(?:\\s*centavos?)?)?\\b`,
    'i'
  );
  const sepBeforeNumMatch = sepBeforeNumRegex.exec(working);
  if (sepBeforeNumMatch && sepBeforeNumMatch[1]) {
    let val = parseFloat(sepBeforeNumMatch[1].replace(',', '.'));
    if (sepBeforeNumMatch[2] && Number.isInteger(val)) {
      val += resolveCents(sepBeforeNumMatch[2]) / 100;
    }
    if (!Number.isNaN(val) && val >= 0 && val <= VALIDATION_LIMITS.MAX_PRICE) {
      const before = working.slice(0, sepBeforeNumMatch.index).trim();
      const after = working
        .slice(sepBeforeNumMatch.index + sepBeforeNumMatch[0].length)
        .trim();
      return {
        price: Number(val.toFixed(2)),
        remainingNameText: `${before} ${after}`.replace(/\s+/g, ' ').trim(),
      };
    }
  }

  // 1B. Explicit separator BEFORE spoken Portuguese price: "porção de salame reais quinze", "dose de 51 reais oito e cinquenta"
  const sepBeforeSpokenRegex =
    /(?:\b(?:por|a|custa|custando|sai(?:\s+a)?)\s+)?\b(?:reais|real|valor(?:\s+de)?|preco(?:\s+de)?|preço(?:\s+de)?)\s+(?:de\s+)?((?:(?:cem|cento|duzentos|trezentos|quatrocentos|quinhentos|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|zero|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove)(?:\s+e\s+)?){1,4})(?:\s+e\s+(cinquenta|vinte|trinta|quarenta|sessenta|setenta|oitenta|noventa|dez|quinze|cinco|meia|\d{1,2})(?:\s*centavos?)?)?/i;
  const sepBeforeSpokenMatch = sepBeforeSpokenRegex.exec(working);
  if (sepBeforeSpokenMatch && sepBeforeSpokenMatch[1]) {
    const intPart = parsePortugueseIntPhrase(sepBeforeSpokenMatch[1]);
    if (intPart !== null && intPart >= 0) {
      let val = intPart;
      if (sepBeforeSpokenMatch[2]) {
        val += resolveCents(sepBeforeSpokenMatch[2]) / 100;
      }
      const before = working.slice(0, sepBeforeSpokenMatch.index).trim();
      const after = working
        .slice(sepBeforeSpokenMatch.index + sepBeforeSpokenMatch[0].length)
        .trim();
      return {
        price: Number(val.toFixed(2)),
        remainingNameText: `${before} ${after}`.replace(/\s+/g, ' ').trim(),
      };
    }
  }

  // 2. Classic numeric price BEFORE "reais" (or explicit "por X" / trailing decimal "15,50")
  // NOTE: Never match bare "de <num>" or bare trailing integers like "51" in "Dose de 51"!
  const numericPatterns: RegExp[] = [
    // "dose de 51 8 reais" / "por 18 reais e 50 centavos"
    /(?:\b(?:por|a|custa|custando|sai(?:\s+a)?)\s+)?(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|conto|pila)(?:\s+e\s+(\d{1,2}|cinquenta|vinte|trinta|quarenta|sessenta|setenta|oitenta|noventa|dez|quinze|cinco|meia)(?:\s*centavos?)?)?\b/i,
    // "por 6 e 50" / "6 e 50"
    /(?:\b(?:por|a|custa|custando|sai(?:\s+a)?)\s+)?(\d+)\s+e\s+(\d{2}|cinquenta)\b(?:\s*centavos?)?/i,
    // "por 18,50" / "custa 18"
    /\b(?:por|custa|custando|sai(?:\s+a)?)\s+(\d+(?:[.,]\d{1,2})?)\b/i,
    // Explicit trailing decimal only (e.g. "Heineken 12,50" — never bare integers like "51")
    /(?:^|\s)(\d+[.,]\d{1,2})\s*$/,
  ];

  for (const pat of numericPatterns) {
    const m = pat.exec(working);
    if (!m || !m[1]) continue;

    // Skip if matched number is actually a volume token right next to ml/l/litros
    const afterMatch = working.slice(m.index + m[0].length).trim();
    if (/^(?:ml|mls|l|litro|litros|g|gramas|kg)\b/i.test(afterMatch)) {
      continue;
    }

    let val = parseFloat(m[1].replace(',', '.'));
    if (m[2] && Number.isInteger(val)) {
      val += resolveCents(m[2]) / 100;
    }

    if (!Number.isNaN(val) && val >= 0 && val <= VALIDATION_LIMITS.MAX_PRICE) {
      const before = working.slice(0, m.index).trim();
      const after = working.slice(m.index + m[0].length).trim();
      const joined = `${before} ${after}`.replace(/\s+/g, ' ').trim();
      return {
        price: Number(val.toFixed(2)),
        remainingNameText: joined,
      };
    }
  }

  // 3. Fully spoken Portuguese price BEFORE "reais" (e.g. "dezoito reais", "vinte e cinco reais e cinquenta")
  const spokenRegex =
    /(?:\b(?:por|a|custa|custando|sai(?:\s+a)?)\s+)?((?:(?:cem|cento|duzentos|trezentos|quatrocentos|quinhentos|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|zero|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove)(?:\s+e\s+)?){1,4})\s*(?:reais|real|conto|pila)(?:\s+e\s+((?:cinquenta|vinte|trinta|quarenta|sessenta|setenta|oitenta|noventa|dez|quinze|cinco|meia|\d{1,2}))(?:\s*centavos?)?)?/i;

  const spokenMatch = spokenRegex.exec(working);
  if (spokenMatch && spokenMatch[1]) {
    const intPart = parsePortugueseIntPhrase(spokenMatch[1]);
    if (intPart !== null && intPart >= 0) {
      let val = intPart;
      if (spokenMatch[2]) {
        val += resolveCents(spokenMatch[2]) / 100;
      }
      const before = working.slice(0, spokenMatch.index).trim();
      const after = working.slice(spokenMatch.index + spokenMatch[0].length).trim();
      const joined = `${before} ${after}`.replace(/\s+/g, ' ').trim();
      return {
        price: Number(val.toFixed(2)),
        remainingNameText: joined,
      };
    }
  }

  return { price: null, remainingNameText: working };
}

function parseSingleMenuProductClause(clause: string): ParsedVoiceMenuProduct | null {
  let working = sanitizeVoiceTranscriptForParsing(clause)
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')
    .trim();
  if (!working) return null;

  // Strip registration command prefixes
  working = stripPolitePrefixes(working)
    .replace(
      /^(?:cadastrar|cadastra|cadastro|criar|cria|adicionar|adiciona|colocar|coloca|botar|bota|incluir|inclui|inserir|insere|novo|nova)\s+(?:um\s+|uma\s+|o\s+|a\s+|novo\s+|nova\s+)?(?:produto|item)?\s*(?:(?:no|ao|na)\s+(?:cardapio|cardápio|catalogo|catálogo|menu))?\s*/i,
      ''
    )
    .replace(/^(?:no|ao|na)\s+(?:cardapio|cardápio|catalogo|catálogo|menu)\s+/i, '')
    .replace(/^(?:um|uma|o|a)\s+(?=produto|item)/i, '')
    .replace(/^(?:produto|item)\s+/i, '')
    .trim();

  // Extract explicit synonyms ("apelidos ...", "sinônimos ...", "palavras chave ...")
  let explicitSynonyms = '';
  const synMatch = working.match(
    /\b(?:apelidos?|sin[oô]nimos?|palavras[\s-]+chaves?)\s*(?:de|:)?\s*(.+)$/i
  );
  if (synMatch && synMatch[1]) {
    explicitSynonyms = synMatch[1].trim();
    working = working.slice(0, synMatch.index).trim();
  }

  // Extract explicit category ("categoria cervejas", "na categoria porções", "tipo doses")
  let explicitCategoryHint = '';
  const catRegex =
    /\b(?:na\s+categoria(?:\s+de)?|categoria(?:\s+de)?|tipo(?:\s+de)?)\s+(cervejas?|doses?(?:\s+e\s+drinks?)?|drinks?|pratos?(?:\s+e\s+refei[cç][oõ]es?)?|refei[cç][oõ]es?|por[cç][oõ]es?(?:\s+e\s+espetos?)?|espetos?|sobremesas?|sem\s+[aá]lcool|n[aã]o\s+alco[oó]lic[oa]s?|outros?)\b/i;
  const catMatch = catRegex.exec(working);
  if (catMatch && catMatch[1]) {
    explicitCategoryHint = catMatch[1].trim();
    const before = working.slice(0, catMatch.index).trim();
    const after = working.slice(catMatch.index + catMatch[0].length).trim();
    working = `${before} ${after}`.replace(/\s+/g, ' ').trim();
  }

  // Extract price and isolate product name
  const { price, remainingNameText } = extractPriceFromProductClause(working);

  let cleanNameRaw = remainingNameText
    .replace(/\b(?:no\s+card[aá]pio|ao\s+card[aá]pio|para\s+o\s+card[aá]pio)\b/gi, ' ')
    .replace(/\s+(?:por|valor|pre[cç]o|custa|reais|real|a|de)\s*$/i, '')
    .replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize spoken volume units neatly inside product name
  cleanNameRaw = cleanNameRaw
    .replace(/\b(\d+)\s*litros?\b/gi, '$1L')
    .replace(/\b(\d+)\s*mls?\b/gi, '$1ml')
    .replace(/\bum\s+litro\b/gi, '1L')
    .replace(/\bdois\s+litros\b/gi, '2L');

  if (!cleanNameRaw || cleanNameRaw.length < 2) {
    return null;
  }

  const formattedName = sanitizeString(
    formatProductNamePt(cleanNameRaw),
    VALIDATION_LIMITS.NAME_MAX_LEN
  );
  const category = inferProductCategory(formattedName, explicitCategoryHint);
  const synonyms = buildAutoProductSynonyms(formattedName, explicitSynonyms);

  return {
    name: formattedName,
    category,
    price,
    synonyms,
  };
}

/**
 * Parses one or more bar products spoken in Portuguese for adding to the Cardápio.
 * Supports:
 * - Separator-first standard: "Porção de salame reais 15", "Dose de 51 reais 8"
 * - Classic format: "Skol Lata 6 reais", "Dose de 51 8 reais"
 * - Multiple products in one breath: "Porção de salame reais 15, Dose de 51 reais 8"
 * - Name-only fallback (returns price: null without stealing numbers like "51" in "Dose de 51")
 */
export function parseVoiceMenuProductsLocally(transcript: string): ParsedVoiceMenuResult {
  const rawCleaned = sanitizeVoiceTranscriptForParsing(transcript);
  if (!rawCleaned) {
    return {
      understood: false,
      unrecognizedReason:
        'Diga o nome do produto, a palavra "reais" e o valor. Ex: "Porção de salame reais 15".',
      products: [],
    };
  }

  const wake = extractCommandAfterMarceloWakeWord(rawCleaned);
  const effective = (wake.hasWakeWord ? wake.commandTranscript : rawCleaned).trim();
  if (!effective) {
    return {
      understood: false,
      unrecognizedReason:
        'Diga o nome do produto, "reais" e o valor após chamar o Marcelo.',
      products: [],
    };
  }

  // If user explicitly mentions "apelidos ..." or "sinônimos ...", keep as a single product so commas inside synonyms aren't split
  const hasExplicitSynonyms = /\b(?:apelidos?|sin[oô]nimos?|palavras[\s-]+chaves?)\b/i.test(
    effective
  );

  let candidateClauses: string[] = [effective];
  if (!hasExplicitSynonyms) {
    // Split on semicolon, comma, or " e " right after a complete price (either "<num> reais" OR "reais <num>")
    const splitOnPriceBoundaries = effective
      .replace(
        /(\d+(?:[.,]\d{1,2})?\s*(?:reais|real|conto|pila))\s+e\s+(?![0-9]{1,2}\b|cinquenta\b|centavos?\b|vinte\b|trinta\b|quarenta\b|sessenta\b|setenta\b|oitenta\b|noventa\b|dez\b|quinze\b|cinco\b|meia\b)/gi,
        '$1 ; '
      )
      .replace(
        /(\b(?:reais|real|valor|pre[cç]o)\s+\d+(?:[.,]\d{1,2})?(?:\s+e\s+(?:\d{1,2}|cinquenta|meia)(?:\s*centavos?)?)?)\s+e\s+(?![0-9]{1,2}\b|cinquenta\b|centavos?\b|vinte\b|trinta\b|quarenta\b|sessenta\b|setenta\b|oitenta\b|noventa\b|dez\b|quinze\b|cinco\b|meia\b)/gi,
        '$1 ; '
      )
      .split(/\s*[;,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (splitOnPriceBoundaries.length > 1) {
      // Only treat splits as separate products if at least 2 parts parse cleanly with prices
      const testParsed = splitOnPriceBoundaries
        .map((c) => parseSingleMenuProductClause(c))
        .filter((p): p is ParsedVoiceMenuProduct => Boolean(p && p.price !== null));
      if (testParsed.length >= 2) {
        candidateClauses = splitOnPriceBoundaries;
      }
    }
  }

  const products: ParsedVoiceMenuProduct[] = [];
  for (const clause of candidateClauses) {
    const parsed = parseSingleMenuProductClause(clause);
    if (parsed) {
      products.push(parsed);
    }
  }

  if (products.length === 0) {
    return {
      understood: false,
      unrecognizedReason:
        'Não consegui identificar o nome do produto. Diga por exemplo: "Porção de salame reais 15".',
      products: [],
    };
  }

  return {
    understood: true,
    unrecognizedReason: '',
    products,
  };
}

export interface ThermalReceiptItemInput {
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalSubtotal: number;
}

export interface ThermalReceiptInput {
  storeName: string;
  customerName: string;
  tableLabel?: string;
  statusLabel: string;
  totalAmount: number;
  paidAmount: number;
  itemCount: number;
  paymentMethod?: string;
  items: ThermalReceiptItemInput[];
  printedAt?: Date;
}

function formatPlainBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `R$ ${safe.toFixed(2).replace('.', ',')}`;
}

function stripThermalUnsafeChars(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapTextToWidth(text: string, width: number): string[] {
  const clean = stripThermalUnsafeChars(text);
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function centerTextToWidth(text: string, width: number): string[] {
  return wrapTextToWidth(text, width).map((line) => {
    const padTotal = Math.max(0, width - line.length);
    const padLeft = Math.floor(padTotal / 2);
    return `${' '.repeat(padLeft)}${line}`;
  });
}

function formatColumnsLine(leftText: string, rightText: string, width: number): string[] {
  const cleanLeft = stripThermalUnsafeChars(leftText);
  const cleanRight = stripThermalUnsafeChars(rightText);

  if (cleanLeft.length + 1 + cleanRight.length <= width) {
    const spaces = width - cleanLeft.length - cleanRight.length;
    return [`${cleanLeft}${' '.repeat(spaces)}${cleanRight}`];
  }

  const maxLeftWidth = Math.max(10, width - cleanRight.length - 1);
  const wrappedLeft = wrapTextToWidth(cleanLeft, maxLeftWidth);
  const result: string[] = [];
  for (let i = 0; i < wrappedLeft.length; i++) {
    const part = wrappedLeft[i];
    if (i === wrappedLeft.length - 1) {
      const spaces = Math.max(1, width - part.length - cleanRight.length);
      result.push(`${part}${' '.repeat(spaces)}${cleanRight}`.slice(0, width));
    } else {
      result.push(part);
    }
  }
  return result;
}

/**
 * Formats a customer's bar tab as plain text (ASCII-safe, 32 to 48 columns wide)
 * ready for 58mm (32 cols) or 80mm (40-48 cols) thermal receipt printers.
 */
export function formatThermalReceiptText(
  input: ThermalReceiptInput,
  columns = 40
): string {
  const width = Math.min(48, Math.max(32, Math.round(columns)));
  const doubleDivider = '='.repeat(width);
  const singleDivider = '-'.repeat(width);
  const printedDate = input.printedAt || new Date();
  const formattedDate = printedDate.toLocaleDateString('pt-BR');
  const formattedTime = printedDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const remaining = Math.max(
    0,
    Number(((input.totalAmount || 0) - (input.paidAmount || 0)).toFixed(2))
  );

  const lines: string[] = [];
  lines.push(doubleDivider);
  lines.push(...centerTextToWidth((input.storeName || 'COMANDA VOZ').toUpperCase(), width));
  lines.push(...centerTextToWidth('CONFERENCIA DE CONTA', width));
  lines.push(doubleDivider);

  lines.push(...wrapTextToWidth(`Cliente: ${input.customerName}`, width));
  if (input.tableLabel && input.tableLabel.trim()) {
    lines.push(...wrapTextToWidth(`Mesa/Local: ${input.tableLabel}`, width));
  }
  lines.push(...formatColumnsLine(`Status: ${input.statusLabel}`, `${formattedDate} ${formattedTime}`, width));
  lines.push(singleDivider);
  lines.push(...formatColumnsLine('QTD ITEM', 'SUBTOTAL', width));
  lines.push(singleDivider);

  if (input.items.length === 0) {
    lines.push(...centerTextToWidth('(Nenhum item lancado)', width));
  } else {
    for (const item of input.items) {
      const itemLabel = `${item.quantity}x ${item.itemName}`;
      const subtotalLabel = formatPlainBRL(item.totalSubtotal);
      lines.push(...formatColumnsLine(itemLabel, subtotalLabel, width));
      if (item.quantity > 1) {
        lines.push(
          ...wrapTextToWidth(`   (${item.quantity} un x ${formatPlainBRL(item.unitPrice)})`, width)
        );
      }
    }
  }

  lines.push(singleDivider);
  lines.push(...formatColumnsLine('Qtd. de itens:', String(input.itemCount || 0), width));
  lines.push(...formatColumnsLine('TOTAL CONSUMIDO:', formatPlainBRL(input.totalAmount), width));

  if ((input.paidAmount || 0) > 0) {
    const payLabel = input.paymentMethod
      ? `JA PAGO (${stripThermalUnsafeChars(input.paymentMethod)}):`
      : 'JA PAGO:';
    lines.push(...formatColumnsLine(payLabel, formatPlainBRL(input.paidAmount), width));
  }

  lines.push(doubleDivider);
  if (remaining <= 0 && (input.totalAmount || 0) > 0) {
    lines.push(...formatColumnsLine('CONTA QUITADA:', formatPlainBRL(0), width));
  } else {
    lines.push(...formatColumnsLine('FALTA PAGAR:', formatPlainBRL(remaining), width));
  }
  lines.push(doubleDivider);
  lines.push('');
  lines.push(...centerTextToWidth('Obrigado pela preferencia!', width));
  lines.push(...centerTextToWidth('Comanda Voz - Marcelo', width));
  lines.push('');

  return lines.join('\n');
}

export interface ThermalCashClosingInput {
  storeName: string;
  dateLabel: string;
  operatorName: string;
  totalReceived: number;
  directSalesTotal: number;
  directSalesCount: number;
  tabsPaidTotal: number;
  tabsPaidCount: number;
  openReceivableTotal: number;
  openTabsCount: number;
  byMethod: Array<{ method: string; total: number; count: number }>;
  printedAt?: Date;
}

/**
 * Formats a daily Cash Register Closing (Fechamento de Caixa) summary as
 * 40-column plain text ready for 58mm/80mm thermal printers.
 */
export function formatThermalCashClosingText(
  input: ThermalCashClosingInput,
  columns = 40
): string {
  const width = Math.min(48, Math.max(32, Math.round(columns)));
  const doubleDivider = '='.repeat(width);
  const singleDivider = '-'.repeat(width);
  const printedDate = input.printedAt || new Date();
  const formattedTime = printedDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines: string[] = [];
  lines.push(doubleDivider);
  lines.push(...centerTextToWidth((input.storeName || 'COMANDA VOZ').toUpperCase(), width));
  lines.push(...centerTextToWidth('FECHAMENTO DE CAIXA', width));
  lines.push(doubleDivider);
  lines.push(...formatColumnsLine(`Data: ${input.dateLabel}`, `Hora: ${formattedTime}`, width));
  lines.push(...wrapTextToWidth(`Responsavel: ${input.operatorName}`, width));
  lines.push(singleDivider);
  lines.push(...formatColumnsLine('ENTRADAS RECEBIDAS', 'VALOR', width));
  lines.push(singleDivider);
  lines.push(
    ...formatColumnsLine(
      `Vendas Avulsas (${input.directSalesCount})`,
      formatPlainBRL(input.directSalesTotal),
      width
    )
  );
  lines.push(
    ...formatColumnsLine(
      `Comandas Pagas (${input.tabsPaidCount})`,
      formatPlainBRL(input.tabsPaidTotal),
      width
    )
  );
  lines.push(singleDivider);
  lines.push(...centerTextToWidth('POR FORMA DE PAGAMENTO', width));
  if (input.byMethod.length === 0) {
    lines.push(...centerTextToWidth('(Nenhum recebimento)', width));
  } else {
    for (const row of input.byMethod) {
      lines.push(
        ...formatColumnsLine(
          `${stripThermalUnsafeChars(row.method)} (${row.count})`,
          formatPlainBRL(row.total),
          width
        )
      );
    }
  }
  lines.push(doubleDivider);
  lines.push(...formatColumnsLine('TOTAL EM CAIXA:', formatPlainBRL(input.totalReceived), width));
  lines.push(
    ...formatColumnsLine(
      `Em Aberto Mesas (${input.openTabsCount}):`,
      formatPlainBRL(input.openReceivableTotal),
      width
    )
  );
  lines.push(doubleDivider);
  lines.push('');
  lines.push(...centerTextToWidth('Comanda Voz - Bar & Restaurante', width));
  lines.push('');

  return lines.join('\n');
}




