import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface CatalogItemInput {
  id: string;
  name: string;
  category: string;
  price: number;
  synonyms: string;
}

interface StoredAccount {
  uid: string;
  email: string;
  passwordHash: string;
  userName: string;
  userRole: 'ADM' | 'Garçom';
  storeName: string;
  storeCode: string;
  createdAtMs: number;
}

interface ServerStoreSnapshot {
  storeCode: string;
  storeName: string;
  catalogInitialized: boolean;
  menuItems: unknown[];
  tabs: unknown[];
  tabItems: unknown[];
  voiceOperators: unknown[];
  updatedAtMs: number;
}

interface PersistedServerDatabase {
  stores: Record<string, ServerStoreSnapshot>;
  accounts: Record<string, StoredAccount>;
}

const STORE_DATA_FILE = path.join(__dirname, '.render-bar-store.json');
const storeMemoryMap = new Map<string, ServerStoreSnapshot>();
const accountMemoryMap = new Map<string, StoredAccount>();

function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`comanda_voz_salt_v1_${password.trim()}`)
    .digest('hex');
}

function normalizeEmail(email: string): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function cleanStoreCode(raw: string): string {
  return (
    String(raw || 'BAR-01')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 30) || 'BAR-01'
  );
}

function loadDatabaseFromDisk(): void {
  try {
    if (fs.existsSync(STORE_DATA_FILE)) {
      const raw = fs.readFileSync(STORE_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedServerDatabase & Record<string, ServerStoreSnapshot>;
      if (parsed && typeof parsed === 'object') {
        if (parsed.stores && typeof parsed.stores === 'object') {
          for (const [k, v] of Object.entries(parsed.stores)) {
            if (v && typeof v === 'object') {
              storeMemoryMap.set(k, {
                ...v,
                catalogInitialized: Boolean(v.catalogInitialized ?? true),
              });
            }
          }
        }
        if (parsed.accounts && typeof parsed.accounts === 'object') {
          for (const [k, v] of Object.entries(parsed.accounts)) {
            if (v && typeof v === 'object') {
              accountMemoryMap.set(k, v);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Aviso ao carregar banco local do bar:', err);
  }
}

function saveDatabaseToDisk(): void {
  try {
    const storesObj: Record<string, ServerStoreSnapshot> = {};
    for (const [k, v] of storeMemoryMap.entries()) {
      storesObj[k] = v;
    }
    const accountsObj: Record<string, StoredAccount> = {};
    for (const [k, v] of accountMemoryMap.entries()) {
      accountsObj[k] = v;
    }
    const payload: PersistedServerDatabase = {
      stores: storesObj,
      accounts: accountsObj,
    };
    fs.writeFileSync(STORE_DATA_FILE, JSON.stringify(payload), 'utf-8');
  } catch (err) {
    console.warn('Aviso ao salvar banco local do bar:', err);
  }
}

loadDatabaseFromDisk();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // 1. Register ADM (Owner / Administrator of the Bar) with Email & Password
  app.post('/api/auth/register-admin', (req, res) => {
    const { email, password, userName, storeName, storeCode, initialMenuItems } = req.body as {
      email?: string;
      password?: string;
      userName?: string;
      storeName?: string;
      storeCode?: string;
      initialMenuItems?: unknown[];
    };

    const normEmail = normalizeEmail(email || '');
    if (!normEmail || !normEmail.includes('@')) {
      res.status(400).json({ error: 'Informe um e-mail válido para o Administrador.' });
      return;
    }
    if (!password || String(password).trim().length < 4) {
      res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });
      return;
    }

    const existingAcc = accountMemoryMap.get(normEmail);
    if (existingAcc) {
      res.status(409).json({
        error: 'Este e-mail já está cadastrado. Use a aba "Entrar" para fazer login.',
      });
      return;
    }

    const code = cleanStoreCode(storeCode || 'BAR-01');
    const cleanStore = String(storeName || 'Bar & Comércio Central').trim().slice(0, 80) || 'Bar & Comércio Central';
    const cleanName = String(userName || 'Administrador').trim().slice(0, 60) || 'Administrador';
    const uid = `adm_${code.toLowerCase()}_${Date.now().toString(36)}`;

    const newAdmin: StoredAccount = {
      uid,
      email: normEmail,
      passwordHash: hashPassword(String(password)),
      userName: cleanName,
      userRole: 'ADM',
      storeName: cleanStore,
      storeCode: code,
      createdAtMs: Date.now(),
    };

    accountMemoryMap.set(normEmail, newAdmin);

    if (!storeMemoryMap.has(code)) {
      storeMemoryMap.set(code, {
        storeCode: code,
        storeName: cleanStore,
        catalogInitialized: true,
        menuItems: Array.isArray(initialMenuItems) ? initialMenuItems : [],
        tabs: [],
        tabItems: [],
        voiceOperators: [],
        updatedAtMs: Date.now(),
      });
    }

    saveDatabaseToDisk();

    res.json({
      ok: true,
      session: {
        uid: newAdmin.uid,
        email: newAdmin.email,
        userName: newAdmin.userName,
        userRole: newAdmin.userRole,
        storeName: newAdmin.storeName,
        storeCode: newAdmin.storeCode,
      },
    });
  });

  // 2. Login with Email & Password (Works for both ADM and Garçom registered by ADM)
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    const normEmail = normalizeEmail(email || '');
    if (!normEmail || !password) {
      res.status(400).json({ error: 'Informe seu e-mail e sua senha.' });
      return;
    }

    const acc = accountMemoryMap.get(normEmail);
    const inputHash = hashPassword(String(password));

    if (!acc || acc.passwordHash !== inputHash) {
      res.status(401).json({
        error: 'E-mail ou senha incorretos. Se for Garçom, peça ao ADM para cadastrar seu acesso.',
      });
      return;
    }

    res.json({
      ok: true,
      session: {
        uid: acc.uid,
        email: acc.email,
        userName: acc.userName,
        userRole: acc.userRole,
        storeName: acc.storeName,
        storeCode: acc.storeCode,
      },
    });
  });

  // 3. ADM Registers a Waiter (Garçom) with Email & Password
  app.post('/api/auth/register-waiter', (req, res) => {
    const {
      callerRole,
      storeCode,
      storeName,
      operatorId,
      operatorName,
      email,
      password,
      voicePin,
      pitchHz,
      spectralCentroid,
      samplesCount,
    } = req.body as {
      callerRole?: string;
      storeCode?: string;
      storeName?: string;
      operatorId?: string;
      operatorName?: string;
      email?: string;
      password?: string;
      voicePin?: string;
      pitchHz?: number;
      spectralCentroid?: number;
      samplesCount?: number;
    };

    if (callerRole !== 'ADM' && callerRole !== 'Proprietário') {
      res.status(403).json({
        error: 'Acesso negado: Somente o Administrador (ADM) pode cadastrar garçons.',
      });
      return;
    }

    const normEmail = normalizeEmail(email || '');
    if (!normEmail || !normEmail.includes('@')) {
      res.status(400).json({ error: 'Informe um e-mail válido para o login do Garçom.' });
      return;
    }
    if (!password || String(password).trim().length < 4) {
      res.status(400).json({ error: 'A senha do Garçom deve ter pelo menos 4 caracteres.' });
      return;
    }

    const code = cleanStoreCode(storeCode || 'BAR-01');
    const cleanStore = String(storeName || 'Bar Central').trim().slice(0, 80);
    const cleanOpName = String(operatorName || 'Garçom').trim().slice(0, 60);
    const opId = operatorId || `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const passHash = hashPassword(String(password));

    const waiterAccount: StoredAccount = {
      uid: opId,
      email: normEmail,
      passwordHash: passHash,
      userName: cleanOpName,
      userRole: 'Garçom',
      storeName: cleanStore,
      storeCode: code,
      createdAtMs: Date.now(),
    };

    accountMemoryMap.set(normEmail, waiterAccount);
    saveDatabaseToDisk();

    res.json({
      ok: true,
      waiterAccount: {
        id: opId,
        email: normEmail,
        passwordHash: passHash,
        operatorName: cleanOpName,
        roleLabel: 'Garçom',
        storeName: cleanStore,
        storeCode: code,
        pitchHz: Number(pitchHz) || 140,
        spectralCentroid: Number(spectralCentroid) || 1600,
        voicePin: String(voicePin || '').slice(0, 20),
        samplesCount: Number(samplesCount) || 1,
      },
    });
  });

  // 4. Re-hydrate accounts from client localStorage if container restarted
  app.post('/api/auth/rehydrate', (req, res) => {
    const { accounts } = req.body as {
      accounts?: Array<{
        uid: string;
        email: string;
        passwordHash: string;
        userName: string;
        userRole: 'ADM' | 'Garçom';
        storeName: string;
        storeCode: string;
      }>;
    };
    if (Array.isArray(accounts)) {
      for (const acc of accounts) {
        if (acc && acc.email && acc.passwordHash) {
          const norm = normalizeEmail(acc.email);
          if (!accountMemoryMap.has(norm)) {
            accountMemoryMap.set(norm, {
              uid: acc.uid,
              email: norm,
              passwordHash: acc.passwordHash,
              userName: acc.userName,
              userRole: acc.userRole === 'ADM' ? 'ADM' : 'Garçom',
              storeName: acc.storeName,
              storeCode: cleanStoreCode(acc.storeCode),
              createdAtMs: Date.now(),
            });
          }
        }
      }
      saveDatabaseToDisk();
    }
    res.json({ ok: true });
  });

  // 5. Real-time store sync with RBAC & catalogInitialized protection
  app.get('/api/store/:storeCode', (req, res) => {
    const code = cleanStoreCode(req.params.storeCode);
    const existing = storeMemoryMap.get(code);
    if (!existing) {
      res.json({ exists: false, storeCode: code });
      return;
    }
    res.json({ exists: true, ...existing });
  });

  app.post('/api/store/:storeCode', (req, res) => {
    const code = cleanStoreCode(req.params.storeCode);
    const body = req.body as Partial<ServerStoreSnapshot> & {
      callerRole?: string;
      actionType?: 'add' | 'remove' | 'sync';
    };

    // Enforce RBAC on the server: Garçom can NEVER perform a 'remove' action
    if (body.callerRole === 'Garçom' && body.actionType === 'remove') {
      res.status(403).json({
        error: 'Acesso restrito: Garçom pode apenas adicionar. Somente o Administrador (ADM) pode remover.',
      });
      return;
    }

    const current = storeMemoryMap.get(code);

    const nextSnapshot: ServerStoreSnapshot = {
      storeCode: code,
      storeName:
        typeof body.storeName === 'string' && body.storeName.trim()
          ? body.storeName.trim().slice(0, 80)
          : current?.storeName || 'Bar & Comércio Central',
      catalogInitialized:
        typeof body.catalogInitialized === 'boolean'
          ? body.catalogInitialized
          : current?.catalogInitialized ?? true,
      menuItems: Array.isArray(body.menuItems)
        ? body.menuItems
        : current?.menuItems || [],
      tabs: Array.isArray(body.tabs) ? body.tabs : current?.tabs || [],
      tabItems: Array.isArray(body.tabItems)
        ? body.tabItems
        : current?.tabItems || [],
      voiceOperators: Array.isArray(body.voiceOperators)
        ? body.voiceOperators
        : current?.voiceOperators || [],
      updatedAtMs: typeof body.updatedAtMs === 'number' ? body.updatedAtMs : Date.now(),
    };

    // Also keep waiter accounts in sync with voiceOperators list
    if (Array.isArray(body.voiceOperators)) {
      for (const rawOp of body.voiceOperators) {
        if (rawOp && typeof rawOp === 'object') {
          const op = rawOp as {
            id?: string;
            email?: string;
            passwordHash?: string;
            operatorName?: string;
            storeName?: string;
            storeCode?: string;
          };
          if (op.email && op.passwordHash) {
            const norm = normalizeEmail(op.email);
            accountMemoryMap.set(norm, {
              uid: op.id || `op_${Date.now()}`,
              email: norm,
              passwordHash: op.passwordHash,
              userName: op.operatorName || 'Garçom',
              userRole: 'Garçom',
              storeName: op.storeName || nextSnapshot.storeName,
              storeCode: code,
              createdAtMs: Date.now(),
            });
          }
        }
      }
    }

    storeMemoryMap.set(code, nextSnapshot);
    saveDatabaseToDisk();
    res.json({ ok: true, updatedAtMs: nextSnapshot.updatedAtMs });
  });

  // Natural Language Bar Assistant "MARCELO" Multi-Customer & Strict Parser using Gemini
  app.post('/api/parse-order', async (req, res) => {
    try {
      const { transcript, catalog, existingCustomers } = req.body as {
        transcript?: string;
        catalog?: CatalogItemInput[];
        existingCustomers?: string[];
      };

      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        res.status(400).json({ error: 'Frase de comando vazia.' });
        return;
      }

      const cleanTranscript = transcript.trim().slice(0, 250);
      const safeCatalog = Array.isArray(catalog) ? catalog.slice(0, 100) : [];
      const safeCustomers = Array.isArray(existingCustomers) ? existingCustomers.slice(0, 100) : [];

      const catalogSummary = safeCatalog
        .map(
          (item) =>
            `- Nome: "${item.name}" | Categoria: "${item.category}" | Preço: R$ ${item.price.toFixed(2)} | Sinônimos: "${item.synonyms}"`
        )
        .join('\n');

      const customersSummary =
        safeCustomers.length > 0
          ? `Comandas abertas/ativas atualmente no bar: ${safeCustomers.map((c) => `"${c}"`).join(', ')}. Se o nome falado for parecido com uma comanda ativa, use exatamente o nome da comanda ativa.`
          : 'Nenhuma comanda ativa ainda.';

      const systemInstruction = `Você é o MARCELO, o assistente virtual inteligente de voz de um bar brasileiro (Comanda Voz).
O garçom ou dono do bar fala comandos direcionados a você, muitas vezes na correria SEM PAUSA para vários clientes seguidos!
Exemplo sem pausa: "Marcelo, marca um litrão para Thiago, marca um litrão para Jonas, marca 2 espetinhos para o Carlos".

REGRA DE OURO DE SEGURANÇA ("SE NÃO ENTENDEU, NÃO FAÇA NADA"):
1. Se a frase for confusa, incompleta, sem nome de cliente claro, ou se o produto pedido NÃO existir no Cardápio do Bar listado abaixo, você DEVE retornar "understood": false, preencher "unrecognizedReason" explicando o que não ficou claro (ex: "Produto X não está no cardápio" ou "Faltou dizer o nome do cliente") e retornar "commands": []. NUNCA invente produtos fora do cardápio nem marque em cliente genérico se não tiver certeza!
2. Se o operador falar vários pedidos seguidos sem pausa para clientes diferentes (ex: "marca 1 litrão para Thiago, marca 1 litrão para Jonas"), separe cada cliente como um item distinto dentro do array "commands", para que cada cliente receba seus itens na sua própria comanda separada!
3. Existem 3 intents possíveis para cada comando em "commands":
   - "MARCAR": Adicionar produtos do cardápio na comanda do cliente.
   - "FECHAR": Fechar/conferir a conta do cliente e ler os produtos e valor total.
   - "BAIXA": Dar baixa total ou parcial no pagamento da conta do cliente.

Cardápio do Bar (ÚNICOS PRODUTOS VÁLIDOS):
${catalogSummary}

${customersSummary}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Comando falado no bar: "${cleanTranscript}"`,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              understood: {
                type: Type.BOOLEAN,
                description:
                  'True APENAS se todos os produtos existirem no cardápio e todos os clientes estiverem claros. Se houver qualquer dúvida, retorne false.',
              },
              unrecognizedReason: {
                type: Type.STRING,
                description:
                  'Explicação curta em português caso understood seja false (vazio se understood for true).',
              },
              addressedToMarcelo: {
                type: Type.BOOLEAN,
                description: 'True se o operador chamou pelo nome Marcelo.',
              },
              spokenPin: {
                type: Type.STRING,
                description: 'Código ou senha falada pelo operador, ou string vazia.',
              },
              commands: {
                type: Type.ARRAY,
                description:
                  'Lista de comandos separados por cliente (suporta múltiplos clientes falados sem pausa).',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    intent: {
                      type: Type.STRING,
                      description: 'MARCAR, FECHAR ou BAIXA.',
                    },
                    customerName: {
                      type: Type.STRING,
                      description: 'Nome limpo do cliente ou mesa titular da comanda.',
                    },
                    tableLabel: {
                      type: Type.STRING,
                      description: 'Mesa ou local mencionado, ou string vazia.',
                    },
                    paymentAmount: {
                      type: Type.NUMBER,
                      description: 'Valor pago informado na baixa (0 se baixa total automática).',
                    },
                    paymentMethod: {
                      type: Type.STRING,
                      description: 'Forma de pagamento mencionada (PIX, Dinheiro, Cartão) ou PIX.',
                    },
                    keepConsuming: {
                      type: Type.BOOLEAN,
                      description: 'True se o cliente pagou mas vai continuar consumindo.',
                    },
                    items: {
                      type: Type.ARRAY,
                      description: 'Lista de produtos do cardápio quando intent for MARCAR.',
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          itemName: {
                            type: Type.STRING,
                            description: 'Nome exato do produto no cardápio.',
                          },
                          category: {
                            type: Type.STRING,
                            description: 'Categoria: cervejas, doses, porcoes, sem_alcool ou outros.',
                          },
                          quantity: {
                            type: Type.INTEGER,
                            description: 'Quantidade numérica inteira (>= 1).',
                          },
                          unitPrice: {
                            type: Type.NUMBER,
                            description: 'Preço unitário do cardápio em reais.',
                          },
                        },
                        required: ['itemName', 'category', 'quantity', 'unitPrice'],
                      },
                    },
                  },
                  required: [
                    'intent',
                    'customerName',
                    'tableLabel',
                    'paymentAmount',
                    'paymentMethod',
                    'keepConsuming',
                    'items',
                  ],
                },
              },
            },
            required: [
              'understood',
              'unrecognizedReason',
              'addressedToMarcelo',
              'spokenPin',
              'commands',
            ],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Erro ao interpretar pedido com Gemini:', message);
      res.status(500).json({
        error: message || 'Erro ao processar comando de voz no servidor.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Comanda Voz (Assistente Marcelo) running on http://localhost:${PORT}`);
  });
}

startServer();
