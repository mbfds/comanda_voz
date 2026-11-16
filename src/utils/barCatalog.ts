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
  VALID_ROLES: ['Proprietário', 'Garçom', 'Caixa', 'Gerente'] as UserRoleType[],
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
  open: '1. Aberta (Consumindo)',
  closing: '2. Fechando (Conferência)',
  paid: '3. Baixa (Pago)',
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
    synonyms: 'litrão, litrao, litrões, litroes, 1 litrao, um litrao, brahma 1l, skol 1l, litrão de cerveja',
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
    synonyms: 'latinha, cerveja lata, lata brahma, lata skol',
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
    synonyms: 'espetinho, espetinhos, espeto, espetos, espetinho de carne, espetinho de frango, churrasquinho',
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
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
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
 * Parses a single clause (e.g. "marca um litrão para Thiago" or "feche a conta do Fulano").
 * STRICT RULE: If customerName or catalog item is not clearly understood, returns null so nothing is executed!
 */
function parseSingleClauseStrictly(
  clause: string,
  catalog: MenuItem[],
  existingCustomerNames: string[]
): { command: ParsedSingleCommand | null; errorReason?: string } {
  const cleaned = clause.trim().replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
  if (!cleaned) return { command: null, errorReason: 'Comando vazio.' };

  const norm = normalizeText(cleaned);

  // Detect Intent: FECHAR vs BAIXA vs MARCAR
  let intent: MarceloIntent = 'MARCAR';
  if (/\b(baixa|dar baixa|de baixa|dê baixa|pagou|recebi|quitou|abater)\b/i.test(norm)) {
    intent = 'BAIXA';
  } else if (
    /\b(fechar|feche|fecha|fechamento|quanto deu|qual o total|pediu a conta|resumo da conta)\b/i.test(
      norm
    )
  ) {
    intent = 'FECHAR';
  }

  // Handle FECHAR
  if (intent === 'FECHAR') {
    let customerName = '';
    const closeTargetMatch = cleaned.match(
      /(?:conta\s+d[oa]\s+|comanda\s+d[oa]\s+|para\s+o?\s*|pro\s+|d[oa]\s+)([a-zA-ZÀ-ÿ0-9\s]{2,40})$/i
    );
    if (closeTargetMatch && closeTargetMatch[1]) {
      const candidate = closeTargetMatch[1].trim().replace(/[.!,?]+$/, '');
      const existing = existingCustomerNames.find(
        (n) => normalizeText(n) === normalizeText(candidate)
      );
      customerName =
        existing ||
        candidate
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
    } else {
      for (const existing of existingCustomerNames) {
        if (norm.includes(normalizeText(existing))) {
          customerName = existing;
          break;
        }
      }
    }

    if (!customerName) {
      return {
        command: null,
        errorReason: `Não entendi de qual cliente é para fechar a conta no trecho "${cleaned}".`,
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

  // Handle BAIXA
  if (intent === 'BAIXA') {
    let customerName = '';
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

    const baixaTargetMatch = cleaned.match(
      /(?:conta\s+d[oa]\s+|comanda\s+d[oa]\s+|para\s+o?\s*|pro\s+|d[oa]\s+)([a-zA-ZÀ-ÿ0-9\s]{2,40}?)(?:\s+e\s+continua.*|\s+no\s+pix.*|\s+no\s+cartao.*|\s+em\s+dinheiro.*)?$/i
    );
    if (baixaTargetMatch && baixaTargetMatch[1]) {
      const candidate = baixaTargetMatch[1].trim().replace(/[.!,?]+$/, '');
      const existing = existingCustomerNames.find(
        (n) => normalizeText(n) === normalizeText(candidate)
      );
      customerName =
        existing ||
        candidate
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
    } else {
      for (const existing of existingCustomerNames) {
        if (norm.includes(normalizeText(existing))) {
          customerName = existing;
          break;
        }
      }
    }

    if (!customerName) {
      return {
        command: null,
        errorReason: `Não entendi o nome do cliente para dar baixa no trecho "${cleaned}".`,
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

  // Handle MARCAR (Strict: Must have an explicit customerName AND every item must match catalog!)
  let customerName = '';
  let tableLabel = '';
  let orderPart = cleaned;

  const targetRegex =
    /\b(?:na\s+comanda\s+d[oa]\s+|na\s+conta\s+d[oa]\s+|na\s+para\s+o?\s*|para\s+o\s+|para\s+a\s+|para\s+|pro\s+|pra\s+|no\s+|na\s+)([a-zA-ZÀ-ÿ0-9\s]{2,40})$/i;
  const matchTarget = cleaned.match(targetRegex);

  if (matchTarget && matchTarget[1]) {
    const rawTarget = matchTarget[1].trim().replace(/[.!,?]+$/, '');
    orderPart = cleaned.slice(0, matchTarget.index).trim();

    const existingMatch = existingCustomerNames.find(
      (name) => normalizeText(name) === normalizeText(rawTarget)
    );
    if (existingMatch) {
      customerName = existingMatch;
    } else {
      customerName = rawTarget
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }

    if (/^mesa\s+\d+/i.test(customerName)) {
      tableLabel = customerName;
    }
  }

  if (!customerName || customerName.length < 2) {
    return {
      command: null,
      errorReason: `Não entendi para qual cliente marcar no trecho "${cleaned}". Diga por exemplo: "Marcelo, marque 1 litrão para Thiago".`,
    };
  }

  const segments = orderPart
    .replace(/^(marque|marca|marcar|coloca|adiciona|bota|poe|põe|mais)\s+/i, '')
    .split(/\s+e\s+|,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      command: null,
      errorReason: `Não identifiquei a quantidade e o produto para ${customerName}.`,
    };
  }

  const parsedItems: ParsedOrderItem[] = [];

  for (const seg of segments) {
    const segNorm = normalizeText(seg).replace(
      /^(marque|marca|marcar|coloca|adiciona|bota|poe|põe|mais)\s+/i,
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

    for (const menuItem of catalog) {
      const candidates = [
        normalizeText(menuItem.name),
        ...menuItem.synonyms.split(',').map((s) => normalizeText(s)),
      ].filter(Boolean);

      for (const cand of candidates) {
        if (
          itemSearchText === cand ||
          itemSearchText.includes(cand) ||
          cand.includes(itemSearchText)
        ) {
          const score = cand.length;
          if (score > bestScore) {
            bestScore = score;
            matchedItem = menuItem;
          }
        }
      }
    }

    // STRICT RULE: "se não entendeu, não faça nada hein!" -> Do NOT create "Item Avulso" if not matched in catalog!
    if (!matchedItem) {
      return {
        command: null,
        errorReason: `O produto "${itemSearchText}" não foi reconhecido no cardápio. Por segurança, nada foi marcado.`,
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
 * AND enforces strict zero-guessing ("se não entendeu, não faça nada").
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
    .replace(/^(?:oi\s+|ola\s+|ei\s+)?marcelo[\s,.:;-]*/i, '')
    .replace(/\b(?:codigo|senha|pin)\s+[a-z0-9]+\b/gi, '')
    .trim();

  if (!withoutWake) {
    return {
      understood: false,
      unrecognizedReason: 'Você chamou o Marcelo, mas não disse o comando. Nada foi alterado.',
      addressedToMarcelo,
      spokenPin,
      commands: [],
    };
  }

  // Split continuous rapid speech into individual customer commands whenever a new verb appears
  // e.g. "marca um litrao para thiago, marca um litrao para jonas" or "marca 1 litrao pro thiago e marca 2 espetinhos pro jonas"
  const rawClauses = withoutWake
    .split(
      /(?:,\s*|\s+e\s+|\s+)(?=(?:marque|marca|marcar|coloca|adiciona|bota|feche|fecha|fechar|baixa|dê\s+baixa|de\s+baixa)\b)/i
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
