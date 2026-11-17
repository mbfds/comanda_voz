import {
  ItemCategory,
  MarceloIntent,
  MenuItem,
  ParsedOrderItem,
  ParsedSingleCommand,
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
  VALID_CATEGORIES: ['cervejas', 'doses', 'porcoes', 'sem_alcool', 'outros'] as ItemCategory[],
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
  porcoes: 'Porções & Espetos',
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
 * Bounded Levenshtein edit distance for catching 1-2 letter phonetic STT slips
 * (e.g. "marcelo" vs "marcele", "tiago" vs "hiago" vs "diago" vs "tigo").
 */
function phoneticEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
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

function getSingleNameTokenSimilarity(tokA: string, tokB: string): number {
  const normA = normalizeText(tokA);
  const normB = normalizeText(tokB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const phonA = normalizePhoneticPt(tokA);
  const phonB = normalizePhoneticPt(tokB);
  if (!phonA || !phonB) return 0;
  if (phonA === phonB) return 0.98;

  const groupA = getCanonicalCustomerNameGroup(tokA);
  const groupB = getCanonicalCustomerNameGroup(tokB);
  if (groupA && groupB && groupA === groupB) return 0.96;

  // Aggressive prefix/shortening equivalence for spoken names (>= 4 chars, e.g. "tiag" <-> "thiago")
  const shorter = phonA.length <= phonB.length ? phonA : phonB;
  const longer = phonA.length <= phonB.length ? phonB : phonA;
  if (shorter.length >= 4 && longer.startsWith(shorter)) {
    return 0.85 + 0.1 * (shorter.length / longer.length);
  }

  // Bounded Levenshtein distance for phonetic STT recognition slips
  const minLen = Math.min(phonA.length, phonB.length);
  const maxLen = Math.max(phonA.length, phonB.length);
  const dist = phoneticEditDistance(phonA, phonB);
  if (minLen >= 3 && maxLen >= 4 && dist <= 1) {
    return 0.90;
  }
  if (minLen >= 5 && maxLen >= 6 && dist <= 2) {
    return 0.82;
  }

  // Aggressive character bigram/trigram Dice similarity for noisy speech-to-text transcripts
  if (phonA.length >= 4 && phonB.length >= 4) {
    const bi = computeCharNGramDice(phonA, phonB, 2);
    const tri = computeCharNGramDice(phonA, phonB, 3);
    const combinedDice = bi * 0.6 + tri * 0.4;
    if (combinedDice >= 0.70) {
      return combinedDice * 0.92;
    }
  }

  return 0;
}

/**
 * Computes aggressive customer name similarity [0..1] combining exact, phonetic,
 * Portuguese synonym groups, bounded Levenshtein, and character n-gram Dice matching.
 */
export function computeCustomerNameSimilarity(nameA: string, nameB: string): number {
  const normA = normalizeCustomerNameForSearch(nameA);
  const normB = normalizeCustomerNameForSearch(nameB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const phonA = normalizePhoneticPt(normA);
  const phonB = normalizePhoneticPt(normB);
  if (!phonA || !phonB) return 0;
  if (phonA === phonB) return 0.99;

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
    if (condensedA === condensedB) return 0.96;
    const condSim = getSingleNameTokenSimilarity(condensedA, condensedB);
    if (condSim >= 0.85) return condSim * 0.96;
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

  // Fallback token-coverage + full-phrase n-gram similarity for partial multi-word names
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

  const fullDice = computeCharNGramDice(phonA, phonB, 2) * 0.6 + computeCharNGramDice(phonA, phonB, 3) * 0.4;
  return fullDice >= 0.72 ? fullDice * 0.90 : 0;
}

/**
 * Checks if two customer names refer to the same person (including Thiago/Tiago,
 * Marcelo/Marcelle/Marcele, synonym groups, and aggressive fuzzy/phonetic matches).
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
} {
  const padded = ` ${normProd} `;
  let sizeGroup: string | null = null;

  if (/\b(?:lata|latinha|latas|latinhas|350ml|269ml|350|269|latao|473ml)\b/.test(padded)) {
    sizeGroup = 'LATA_350';
  } else if (/\b(?:2l|2litro|2litros)\b/.test(padded)) {
    sizeGroup = 'GARRAFA_2L';
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

  return { sizeGroup, variants };
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
    const dist = phoneticEditDistance(phonA, phonB);
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
  searchQualifiers: { sizeGroup: string | null; variants: Set<string> },
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

/**
 * Parses a single clause for the 3 core intents:
 * 1. MARCAR (add items to customer's tab)
 * 2. FECHAR (close/review bill, or answer "quanto/quando ficou a conta do cliente")
 * 3. BAIXA (record payment / dar baixa)
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
  // 1) BAIXA: "dar baixa", "dar uma baixa", "dê baixa", "da baixa", "deu baixa", "abaixa a conta", "baixar", "pagou", "recebi", "quitou", "quitar", "zerar", "abater"
  // 2) FECHAR / CONSULTAR CONTA: "fechar", "feche", "fecha", "quanto ficou", "quando ficou", "quanto deu", "quanto ta", "qual o valor", "qual o total", "ver a conta", "resumo da conta", "pediu a conta"
  // 3) MARCAR: default when adding items
  let intent: MarceloIntent = 'MARCAR';

  if (
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

  const targetRegex =
    /\b(?:na\s+comanda\s+d[oa]\s+|na\s+conta\s+d[oa]\s+|comanda\s+d[oa]\s+|conta\s+d[oa]\s+|na\s+para\s+o?\s*|para\s+o\s+|para\s+a\s+|para\s+|pro\s+|pra\s+|no\s+|na\s+)([a-zA-ZÀ-ÿ0-9\s]{2,45})$/i;
  const matchTarget = cleanedForMarcar.match(targetRegex);

  if (matchTarget && matchTarget[1]) {
    const rawTarget = cleanCustomerCandidateText(matchTarget[1]);
    orderPart = cleanedForMarcar.slice(0, matchTarget.index).trim();
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

  const segments = orderPart
    .replace(
      /^(marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais)\s+/i,
      ''
    )
    .split(/\s+e\s+|,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      command: null,
      errorReason: `Não identifiquei o produto para marcar na conta de ${customerName}.`,
    };
  }

  const parsedItems: ParsedOrderItem[] = [];

  for (const seg of segments) {
    const segNorm = normalizeText(seg).replace(
      /^(marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais)\s+/i,
      ''
    );
    let qty = 1;
    let itemSearchText = segNorm;

    const qtyMatch = segNorm.match(
      /^(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b\s*(.*)$/
    );
    if (qtyMatch && qtyMatch[2]) {
      const remainder = qtyMatch[2].trim();
      // Do NOT treat volume/weight numbers like "2 litros de coca" or "600 ml" as quantity
      const startsWithUnit = /^(?:litros?|l\b|mls?\b|gramas?|g\b|kg\b)/i.test(remainder);
      if (!startsWithUnit) {
        const qToken = qtyMatch[1];
        qty = Number.isNaN(Number(qToken)) ? PT_NUMBERS[qToken] || 1 : parseInt(qToken, 10);
        itemSearchText = remainder.replace(/^(de\s+)/, '').trim();
      }
    }

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
      /(?:,\s*|\s+e\s+|\s+)(?=(?:marque|marca|marcar|coloca|coloque|adiciona|bota|lanca|lança|anota|feche|fecha|fechar|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quando\s+deu|quanto\s+ta|dar\s+(?:a\s+|uma\s+)?baixa|dar\s+(?:a\s+)?baixar|d[aáeê]\s+(?:a\s+|uma\s+)?baixa|fazer\s+(?:a\s+|uma\s+)?baixa|faz\s+(?:a\s+|uma\s+)?baixa|baixar|quitar|zerar)\b)|(?:,\s*|\s+e\s+)(?=(?:baixa\s+(?:n[oa]|d[oa]|a\s+conta)\b))/i
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

