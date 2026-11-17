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
  VALID_ROLES: ['ADM', 'Proprietário', 'Garçom', 'Caixa', 'Gerente'] as UserRoleType[],
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
      'litrão, litrao, litrões, litroes, 1 litrao, um litrao, brahma, skol, litrão de cerveja, litrao brahma, litrao skol',
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
    synonyms: 'heineken, heineken 600, verdinha, garrafa heineken',
  },
  {
    id: 'item_long_neck',
    name: 'Long Neck Heineken 330ml',
    category: 'cervejas',
    price: 12.0,
    synonyms: 'long neck, longneck, heineken pequena',
  },
  {
    id: 'item_cerveja_lata',
    name: 'Cerveja Lata 350ml',
    category: 'cervejas',
    price: 7.0,
    synonyms: 'latinha, cerveja lata, lata brahma, lata skol, lata',
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
    synonyms: 'coca, coca lata, coca-cola, guaraná, guarana, refri, refrigerante',
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

export function normalizeText(str: string): string {
  return (str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Phonetic normalization for Brazilian Portuguese customer names.
 * Ensures "Thiago" and "Tiago", "Matheus" and "Mateus", "Phelipe" and "Felipe",
 * "Victor" and "Vitor", "Luiz" and "Luis", "Yago" and "Iago", "Wagner" and "Vagner"
 * always resolve to the exact same key!
 */
export function normalizePhoneticPt(str: string): string {
  return normalizeText(str)
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/\bh/g, '') // leading silent h (e.g. Henrique -> enrique, Helena -> elena)
    .replace(/([^cln])h/g, '$1') // silent h anywhere except ch, lh, nh (e.g. Arthur -> artur)
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/k/g, 'c')
    .replace(/ct/g, 't') // Victor -> Vitor
    .replace(/z\b/g, 's') // Luiz -> Luis, Beatriz -> Beatris
    .replace(/ss/g, 's')
    .replace(/([a-z])\1+/g, '$1') // collapse double letters
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if two customer names refer to the same person (including Thiago/Tiago phonetic match).
 */
export function areCustomerNamesEquivalent(nameA: string, nameB: string): boolean {
  const normA = normalizeText(nameA);
  const normB = normalizeText(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const phonA = normalizePhoneticPt(nameA);
  const phonB = normalizePhoneticPt(nameB);
  if (!phonA || !phonB) return false;
  if (phonA === phonB) return true;

  // Check if one is a prefix/token match of the other (e.g. "Tiago" vs "Thiago Silva")
  const tokensA = phonA.split(' ');
  const tokensB = phonB.split(' ');
  if (tokensA[0] && tokensA[0].length >= 3 && tokensA[0] === tokensB[0]) {
    if (tokensA.length === 1 || tokensB.length === 1) return true;
  }

  return false;
}

/**
 * Finds an existing customer name from active tabs using phonetic matching (e.g. "Tiago" matches "Thiago").
 */
export function resolveCustomerNameFromExisting(
  spokenCandidate: string,
  existingCustomerNames: string[]
): string {
  const cleaned = spokenCandidate
    .trim()
    .replace(/^[oOaA]\s+/i, '')
    .replace(/[.!,?;:]+$/g, '')
    .trim();
  if (!cleaned) return '';

  // 1. Exact or phonetic match against existing tabs
  const matchedExisting = existingCustomerNames.find((existing) =>
    areCustomerNamesEquivalent(existing, cleaned)
  );
  if (matchedExisting) return matchedExisting;

  // 2. Title-case the new customer name
  return cleaned
    .split(/\s+/)
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
 * Extracts customer name from a FECHAR or BAIXA phrase, supporting:
 * - "quanto ficou a conta do thiago" / "quando ficou a conta do tiago"
 * - "feche a conta do tiago" / "fechar tiago"
 * - "dar baixa na conta do thiago" / "baixa no tiago" / "tiago pagou"
 */
function extractCustomerForAccountAction(
  cleanedClause: string,
  existingCustomerNames: string[]
): string {
  // First check if any existing customer name (or its phonetic equivalent like Tiago/Thiago) appears in the clause
  const clauseWords = cleanedClause
    .replace(/[.!,?;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const existing of existingCustomerNames) {
    const existingPhon = normalizePhoneticPt(existing);
    const existingTokens = existingPhon.split(' ');
    for (let i = 0; i < clauseWords.length; i++) {
      const wordPhon = normalizePhoneticPt(clauseWords[i]);
      if (wordPhon && wordPhon.length >= 2 && wordPhon === existingPhon) {
        return existing;
      }
      if (existingTokens.length > 1) {
        const sliceStr = clauseWords
          .slice(i, i + existingTokens.length)
          .map((w) => normalizePhoneticPt(w))
          .join(' ');
        if (sliceStr === existingPhon) {
          return existing;
        }
      }
    }
  }

  // Next, extract via prepositions ("conta do X", "comanda da X", "para X", "do X", "no X")
  const prepMatch = cleanedClause.match(
    /(?:conta\s+d[oa]\s+|comanda\s+d[oa]\s+|para\s+o?\s*|pro\s+|pra\s+|no\s+|na\s+|d[oa]\s+)([a-zA-ZÀ-ÿ0-9\s]{2,40}?)(?:\s+e\s+continua.*|\s+no\s+pix.*|\s+no\s+cartao.*|\s+em\s+dinheiro.*|\s+por\s+favor.*|\s+agora.*)?$/i
  );
  if (prepMatch && prepMatch[1]) {
    const candidate = prepMatch[1]
      .trim()
      .replace(/\b(conta|comanda|valor|total|agora|ai|aí|pf|por favor)\b/gi, '')
      .trim();
    if (candidate.length >= 2) {
      return resolveCustomerNameFromExisting(candidate, existingCustomerNames);
    }
  }

  // Or if the user said "tiago pagou" or "fechar tiago" or "baixa tiago"
  const directVerbMatch = cleanedClause.match(
    /^(?:feche|fecha|fechar|baixa|dar\s+baixa|de\s+baixa|dê\s+baixa|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quanto\s+ta|quanto\s+está)\s+(?:a\s+conta\s+|a\s+comanda\s+|o\s+|a\s+)?([a-zA-ZÀ-ÿ0-9\s]{2,35})$/i
  );
  if (directVerbMatch && directVerbMatch[1]) {
    const candidate = directVerbMatch[1]
      .replace(/^(d[oa]|no|na|pro|pra)\s+/i, '')
      .trim();
    if (candidate.length >= 2) {
      return resolveCustomerNameFromExisting(candidate, existingCustomerNames);
    }
  }

  const paidPrefixMatch = cleanedClause.match(
    /^(?:o\s+|a\s+)?([a-zA-ZÀ-ÿ]{2,30})\s+(?:pagou|quitou|deu\s+baixa)/i
  );
  if (paidPrefixMatch && paidPrefixMatch[1]) {
    return resolveCustomerNameFromExisting(paidPrefixMatch[1], existingCustomerNames);
  }

  return '';
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
  existingCustomerNames: string[]
): { command: ParsedSingleCommand | null; errorReason?: string } {
  const cleaned = clause.trim().replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
  if (!cleaned) return { command: null, errorReason: 'Comando vazio.' };

  const norm = normalizeText(cleaned);

  // Detect Intent:
  // 1) BAIXA: "dar baixa", "dê baixa", "da baixa", "baixa na conta", "pagou", "recebi", "quitou", "abater"
  // 2) FECHAR / CONSULTAR CONTA: "fechar", "feche", "fecha", "quanto ficou", "quando ficou" (common STT variation!), "quanto deu", "quanto ta", "qual o valor", "qual o total", "ver a conta", "resumo da conta", "pediu a conta"
  // 3) MARCAR: default when adding items
  let intent: MarceloIntent = 'MARCAR';

  if (
    /\b(baixa|dar\s+baixa|de\s+baixa|da\s+baixa|baixar|pagou|recebi|quitou|abater)\b/i.test(
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
    const customerName = extractCustomerForAccountAction(cleaned, existingCustomerNames);

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
    const amountMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*(?:reais|real|conto|pila)?/);
    if (amountMatch && amountMatch[1]) {
      const val = parseFloat(amountMatch[1].replace(',', '.'));
      if (val > 0) paymentAmount = val;
    }

    const keepConsuming = /\b(continua|continuar|aberta|bebendo|consumindo|parcial)\b/i.test(norm);
    let paymentMethod = 'PIX';
    if (/\bcash|dinheiro|especie\b/i.test(norm)) paymentMethod = 'Dinheiro';
    else if (/\bcredito\b/i.test(norm)) paymentMethod = 'Cartão de Crédito';
    else if (/\bdebito|cartao\b/i.test(norm)) paymentMethod = 'Cartão de Débito';

    const customerName = extractCustomerForAccountAction(cleaned, existingCustomerNames);

    if (!customerName) {
      return {
        command: null,
        errorReason: `Não identifiquei o nome do cliente para dar baixa. Diga por exemplo: "Dar baixa na conta do Tiago".`,
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
  let orderPart = cleaned;

  const targetRegex =
    /\b(?:na\s+comanda\s+d[oa]\s+|na\s+conta\s+d[oa]\s+|na\s+para\s+o?\s*|para\s+o\s+|para\s+a\s+|para\s+|pro\s+|pra\s+|no\s+|na\s+)([a-zA-ZÀ-ÿ0-9\s]{2,40})$/i;
  const matchTarget = cleaned.match(targetRegex);

  if (matchTarget && matchTarget[1]) {
    const rawTarget = matchTarget[1].trim().replace(/[.!,?]+$/, '');
    orderPart = cleaned.slice(0, matchTarget.index).trim();
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
    .replace(/^(marque|marca|marcar|coloca|coloque|adiciona|bota|poe|põe|lanca|lança|anota|mais)\s+/i, '')
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
    if (qtyMatch) {
      const qToken = qtyMatch[1];
      qty = Number.isNaN(Number(qToken)) ? PT_NUMBERS[qToken] || 1 : parseInt(qToken, 10);
      itemSearchText = qtyMatch[2].replace(/^(de\s+)/, '').trim();
    }

    if (!itemSearchText) {
      return {
        command: null,
        errorReason: `Produto incompleto no trecho "${seg}". Nada foi marcado.`,
      };
    }

    let matchedItem: MenuItem | undefined;
    let bestScore = 0;
    const itemSearchPhon = normalizePhoneticPt(itemSearchText);

    for (const menuItem of catalog) {
      const candidates = [
        normalizeText(menuItem.name),
        ...menuItem.synonyms.split(',').map((s) => normalizeText(s)),
      ].filter(Boolean);

      for (const cand of candidates) {
        const candPhon = normalizePhoneticPt(cand);
        if (
          itemSearchText === cand ||
          itemSearchText.includes(cand) ||
          cand.includes(itemSearchText) ||
          (candPhon.length >= 3 &&
            (itemSearchPhon === candPhon ||
              itemSearchPhon.includes(candPhon) ||
              candPhon.includes(itemSearchPhon)))
        ) {
          const score = cand.length;
          if (score > bestScore) {
            bestScore = score;
            matchedItem = menuItem;
          }
        }
      }
    }

    if (!matchedItem) {
      return {
        command: null,
        errorReason: `O produto "${itemSearchText}" não está cadastrado no cardápio. Nada foi marcado.`,
      };
    }

    parsedItems.push({
      itemName: matchedItem.name,
      category: matchedItem.category,
      quantity: Math.min(Math.max(qty, 1), VALIDATION_LIMITS.MAX_QTY),
      unitPrice: matchedItem.price,
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
 * Supports chained continuous voice commands without pauses:
 * e.g. "Marcelo, marca um litrão para Thiago, marca um litrão para Jonas"
 * AND understands MARCAR, FECHAR ("quanto/quando ficou a conta do Tiago"), and DAR BAIXA.
 */
export function parseVoiceOrderLocally(
  transcript: string,
  catalog: MenuItem[],
  existingCustomerNames: string[]
): ParsedVoiceOrder {
  const rawCleaned = transcript.trim();
  const normFull = normalizeText(rawCleaned);

  const addressedToMarcelo = /\bmarcelo\b/i.test(normFull);

  let spokenPin = '';
  const pinMatch = normFull.match(/\b(?:codigo|senha|pin)\s+([a-z0-9]+)\b/i);
  if (pinMatch && pinMatch[1]) {
    spokenPin = pinMatch[1];
  }

  const withoutWake = rawCleaned
    .replace(/^(?:oi\s+|ola\s+|ei\s+|fala\s+)?(?:marcelo[\s,.:;-]*)+/i, '')
    .replace(/\b(?:codigo|senha|pin)\s+[a-z0-9]+\b/gi, '')
    .trim();

  if (!withoutWake) {
    return {
      understood: false,
      unrecognizedReason:
        'Diga o comando completo, por exemplo: "Marca 1 litrão para Tiago" ou "Quanto ficou a conta do Tiago?".',
      addressedToMarcelo,
      spokenPin,
      commands: [],
    };
  }

  // Split continuous rapid speech into individual customer commands whenever a new command verb appears
  const rawClauses = withoutWake
    .split(
      /(?:,\s*|\s+e\s+|\s+)(?=(?:marque|marca|marcar|coloca|coloque|adiciona|bota|lanca|lança|anota|feche|fecha|fechar|quanto\s+ficou|quando\s+ficou|quanto\s+deu|quanto\s+ta|baixa|dar\s+baixa|dê\s+baixa|de\s+baixa|da\s+baixa)\b)/i
    )
    .map((c) => c.trim())
    .filter(Boolean);

  const commands: ParsedSingleCommand[] = [];

  for (const clause of rawClauses) {
    const { command, errorReason } = parseSingleClauseStrictly(
      clause,
      catalog,
      existingCustomerNames
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
