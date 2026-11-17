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

export type ServerAccountRole = 'SUPERADMIN' | 'ADM' | 'Garçom';

interface StoredAccount {
  uid: string;
  email: string;
  passwordHash: string;
  userName: string;
  userRole: ServerAccountRole;
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
  masterRecoveryKey?: string;
}

const DEFAULT_SUPERADMIN_EMAIL = 'superadmin@comandavoz.com';
const DEFAULT_SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
const DEFAULT_MASTER_RECOVERY_KEY = process.env.MASTER_RECOVERY_KEY || 'SUPER2026';

const STORE_DATA_FILE = path.join(__dirname, '.render-bar-store.json');
const storeMemoryMap = new Map<string, ServerStoreSnapshot>();
const accountMemoryMap = new Map<string, StoredAccount>();
let masterRecoveryKey = DEFAULT_MASTER_RECOVERY_KEY;

function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`comanda_voz_salt_v1_${password.trim()}`)
    .digest('hex');
}

function normalizeEmailOrUsername(rawInput: string): string {
  const cleaned = String(rawInput || '')
    .trim()
    .toLowerCase();
  if (
    cleaned === 'superadmin' ||
    cleaned === 'programador' ||
    cleaned === 'dev' ||
    cleaned === 'root'
  ) {
    return DEFAULT_SUPERADMIN_EMAIL;
  }
  return cleaned;
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

function ensureDefaultSuperAdmin(): void {
  const hasSuperAdmin = Array.from(accountMemoryMap.values()).some(
    (acc) => acc.userRole === 'SUPERADMIN'
  );
  if (!hasSuperAdmin) {
    const superAcc: StoredAccount = {
      uid: 'superadmin_master_dev',
      email: DEFAULT_SUPERADMIN_EMAIL,
      passwordHash: hashPassword(DEFAULT_SUPERADMIN_PASSWORD),
      userName: 'Programador (SUPERADMIN)',
      userRole: 'SUPERADMIN',
      storeName: 'Bar Central',
      storeCode: 'BAR-01',
      createdAtMs: Date.now(),
    };
    accountMemoryMap.set(DEFAULT_SUPERADMIN_EMAIL, superAcc);
  }
}

function loadDatabaseFromDisk(): void {
  try {
    if (fs.existsSync(STORE_DATA_FILE)) {
      const raw = fs.readFileSync(STORE_DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedServerDatabase &
        Record<string, ServerStoreSnapshot>;
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.masterRecoveryKey === 'string' && parsed.masterRecoveryKey.trim()) {
          masterRecoveryKey = parsed.masterRecoveryKey.trim();
        }
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
  ensureDefaultSuperAdmin();
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
      masterRecoveryKey,
    };
    fs.writeFileSync(STORE_DATA_FILE, JSON.stringify(payload), 'utf-8');
  } catch (err) {
    console.warn('Aviso ao salvar banco local do bar:', err);
  }
}

loadDatabaseFromDisk();
saveDatabaseToDisk();

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

    const normEmail = normalizeEmailOrUsername(email || '');
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
        error: 'Este e-mail já está cadastrado. Use a aba "Entrar" ou "Recuperar Senha".',
      });
      return;
    }

    const code = cleanStoreCode(storeCode || 'BAR-01');
    const cleanStore =
      String(storeName || 'Bar & Comércio Central')
        .trim()
        .slice(0, 80) || 'Bar & Comércio Central';
    const cleanName =
      String(userName || 'Administrador')
        .trim()
        .slice(0, 60) || 'Administrador';
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

    const sessionPayload = {
      uid: newAdmin.uid,
      email: newAdmin.email,
      userName: newAdmin.userName,
      userRole: newAdmin.userRole,
      storeName: newAdmin.storeName,
      storeCode: newAdmin.storeCode,
    };

    res.json({
      ok: true,
      account: sessionPayload,
      session: sessionPayload,
    });
  });

  // 2. Login with Email/Username & Password (Works for SUPERADMIN, ADM, and Garçom)
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    const normEmail = normalizeEmailOrUsername(email || '');
    if (!normEmail || !password) {
      res.status(400).json({ error: 'Informe seu usuário/e-mail e sua senha.' });
      return;
    }

    ensureDefaultSuperAdmin();
    const acc = accountMemoryMap.get(normEmail);
    const inputHash = hashPassword(String(password));

    if (!acc || acc.passwordHash !== inputHash) {
      res.status(401).json({
        error:
          'Usuário/E-mail ou senha incorretos. Esqueceu a senha? Clique em "Recuperar Senha" abaixo.',
      });
      return;
    }

    const sessionPayload = {
      uid: acc.uid,
      email: acc.email,
      userName: acc.userName,
      userRole: acc.userRole,
      storeName: acc.storeName,
      storeCode: acc.storeCode,
    };

    res.json({
      ok: true,
      account: sessionPayload,
      session: sessionPayload,
    });
  });

  // 3. Password Recovery Endpoint (Works for SUPERADMIN, ADM, and Garçom)
  app.post('/api/auth/recover-password', (req, res) => {
    const { email, verification, newPassword } = req.body as {
      email?: string;
      verification?: string;
      newPassword?: string;
    };

    const normEmail = normalizeEmailOrUsername(email || '');
    const cleanVerif = String(verification || '').trim();
    const cleanNewPass = String(newPassword || '').trim();

    if (!normEmail) {
      res.status(400).json({ error: 'Informe o e-mail ou usuário que deseja recuperar.' });
      return;
    }
    if (!cleanVerif) {
      res.status(400).json({
        error:
          'Informe o Código do Bar (ex: BAR-01), seu Nome cadastrado ou a Chave Mestre do Programador.',
      });
      return;
    }
    if (cleanNewPass.length < 4) {
      res.status(400).json({ error: 'A nova senha precisa ter pelo menos 4 caracteres.' });
      return;
    }

    ensureDefaultSuperAdmin();
    const acc = accountMemoryMap.get(normEmail);
    if (!acc) {
      res.status(404).json({
        error: 'Nenhuma conta encontrada com este e-mail/usuário.',
      });
      return;
    }

    const verifUpper = cleanVerif.toUpperCase();
    const verifLower = cleanVerif.toLowerCase();
    const matchesStoreCode = acc.storeCode.toUpperCase() === verifUpper;
    const matchesUserName = acc.userName.trim().toLowerCase() === verifLower;
    const matchesMasterKey =
      verifUpper === masterRecoveryKey.toUpperCase() ||
      verifUpper === DEFAULT_MASTER_RECOVERY_KEY.toUpperCase();

    if (!matchesStoreCode && !matchesUserName && !matchesMasterKey) {
      res.status(403).json({
        error:
          'Validação incorreta. Informe o Código do Bar correto (ex: BAR-01), seu Nome cadastrado ou a Chave Mestre.',
      });
      return;
    }

    const newHash = hashPassword(cleanNewPass);
    acc.passwordHash = newHash;
    accountMemoryMap.set(normEmail, acc);

    // If this account is a Garçom, also update their passwordHash in the store's voiceOperators list
    const storeSnap = storeMemoryMap.get(acc.storeCode);
    if (storeSnap && Array.isArray(storeSnap.voiceOperators)) {
      storeSnap.voiceOperators = storeSnap.voiceOperators.map((rawOp) => {
        if (rawOp && typeof rawOp === 'object') {
          const op = rawOp as { email?: string; passwordHash?: string };
          if (op.email && normalizeEmailOrUsername(op.email) === normEmail) {
            return { ...op, passwordHash: newHash };
          }
        }
        return rawOp;
      });
      storeMemoryMap.set(acc.storeCode, storeSnap);
    }

    saveDatabaseToDisk();

    const sessionPayload = {
      uid: acc.uid,
      email: acc.email,
      userName: acc.userName,
      userRole: acc.userRole,
      storeName: acc.storeName,
      storeCode: acc.storeCode,
    };

    res.json({
      ok: true,
      message: `Senha de ${acc.userName} (${acc.email}) redefinida com sucesso!`,
      account: sessionPayload,
      session: sessionPayload,
    });
  });

  // 4. ADM or SUPERADMIN Registers a Waiter (Garçom) with Email & Password
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

    if (
      callerRole !== 'SUPERADMIN' &&
      callerRole !== 'ADM' &&
      callerRole !== 'Proprietário'
    ) {
      res.status(403).json({
        error: 'Acesso negado: Somente o ADM ou SUPERADMIN pode cadastrar garçons.',
      });
      return;
    }

    const normEmail = normalizeEmailOrUsername(email || '');
    if (!normEmail || !normEmail.includes('@')) {
      res.status(400).json({ error: 'Informe um e-mail válido para o login do Garçom.' });
      return;
    }
    if (!password || String(password).trim().length < 4) {
      res.status(400).json({ error: 'A senha do Garçom deve ter pelo menos 4 caracteres.' });
      return;
    }

    const code = cleanStoreCode(storeCode || 'BAR-01');
    const cleanStore = String(storeName || 'Bar Central')
      .trim()
      .slice(0, 80);
    const cleanOpName = String(operatorName || 'Garçom')
      .trim()
      .slice(0, 60);
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

    const opPayload = {
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
    };

    res.json({
      ok: true,
      operator: opPayload,
      waiterAccount: opPayload,
    });
  });

  // 5. SUPERADMIN Control Panel Endpoints
  app.get('/api/superadmin/overview', (_req, res) => {
    ensureDefaultSuperAdmin();
    const accountsList = Array.from(accountMemoryMap.values()).map((acc) => ({
      uid: acc.uid,
      email: acc.email,
      userName: acc.userName,
      userRole: acc.userRole,
      storeName: acc.storeName,
      storeCode: acc.storeCode,
      createdAtMs: acc.createdAtMs,
    }));

    const storesList = Array.from(storeMemoryMap.values()).map((st) => {
      const tabsArr = Array.isArray(st.tabs)
        ? (st.tabs as Array<{ status?: string; totalAmount?: number; paidAmount?: number }>)
        : [];
      const activeTabs = tabsArr.filter((t) => t && t.status !== 'archived');
      const totalConsumed = activeTabs.reduce(
        (acc, t) => acc + (Number(t.totalAmount) || 0),
        0
      );
      return {
        storeCode: st.storeCode,
        storeName: st.storeName,
        tabsCount: activeTabs.length,
        totalConsumed: Number(totalConsumed.toFixed(2)),
        menuCount: Array.isArray(st.menuItems) ? st.menuItems.length : 0,
        operatorsCount: Array.isArray(st.voiceOperators) ? st.voiceOperators.length : 0,
        updatedAtMs: st.updatedAtMs,
      };
    });

    res.json({
      ok: true,
      masterRecoveryKey,
      accounts: accountsList,
      stores: storesList,
    });
  });

  app.post('/api/superadmin/save-account', (req, res) => {
    const {
      callerRole,
      email,
      newPassword,
      userName,
      userRole,
      storeName,
      storeCode,
    } = req.body as {
      callerRole?: string;
      email?: string;
      newPassword?: string;
      userName?: string;
      userRole?: ServerAccountRole;
      storeName?: string;
      storeCode?: string;
    };

    if (callerRole !== 'SUPERADMIN' && callerRole !== 'ADM') {
      res.status(403).json({ error: 'Apenas SUPERADMIN ou ADM pode gerenciar contas.' });
      return;
    }

    const normEmail = normalizeEmailOrUsername(email || '');
    if (!normEmail || !normEmail.includes('@')) {
      res.status(400).json({ error: 'Informe um e-mail válido.' });
      return;
    }

    const existing = accountMemoryMap.get(normEmail);
    if (!existing && (!newPassword || String(newPassword).trim().length < 4)) {
      res.status(400).json({
        error: 'Para criar uma nova conta, informe uma senha de pelo menos 4 caracteres.',
      });
      return;
    }

    const validRole: ServerAccountRole =
      callerRole === 'SUPERADMIN' &&
      (userRole === 'SUPERADMIN' || userRole === 'ADM' || userRole === 'Garçom')
        ? userRole
        : existing?.userRole || 'Garçom';

    const code = cleanStoreCode(storeCode || existing?.storeCode || 'BAR-01');
    const cleanStore =
      String(storeName || existing?.storeName || 'Bar Central')
        .trim()
        .slice(0, 80) || 'Bar Central';
    const cleanName =
      String(userName || existing?.userName || 'Usuário')
        .trim()
        .slice(0, 60) || 'Usuário';

    const nextPassHash =
      newPassword && String(newPassword).trim().length >= 4
        ? hashPassword(String(newPassword))
        : existing!.passwordHash;

    const updatedAcc: StoredAccount = {
      uid: existing?.uid || `usr_${code.toLowerCase()}_${Date.now().toString(36)}`,
      email: normEmail,
      passwordHash: nextPassHash,
      userName: cleanName,
      userRole: validRole,
      storeName: cleanStore,
      storeCode: code,
      createdAtMs: existing?.createdAtMs || Date.now(),
    };

    accountMemoryMap.set(normEmail, updatedAcc);

    if (!storeMemoryMap.has(code)) {
      storeMemoryMap.set(code, {
        storeCode: code,
        storeName: cleanStore,
        catalogInitialized: false,
        menuItems: [],
        tabs: [],
        tabItems: [],
        voiceOperators: [],
        updatedAtMs: Date.now(),
      });
    }

    saveDatabaseToDisk();

    res.json({
      ok: true,
      account: {
        uid: updatedAcc.uid,
        email: updatedAcc.email,
        userName: updatedAcc.userName,
        userRole: updatedAcc.userRole,
        storeName: updatedAcc.storeName,
        storeCode: updatedAcc.storeCode,
      },
    });
  });

  app.post('/api/superadmin/delete-account', (req, res) => {
    const { callerRole, email } = req.body as {
      callerRole?: string;
      email?: string;
    };

    if (callerRole !== 'SUPERADMIN') {
      res.status(403).json({ error: 'Somente o SUPERADMIN pode remover qualquer conta.' });
      return;
    }

    const normEmail = normalizeEmailOrUsername(email || '');
    const target = accountMemoryMap.get(normEmail);
    if (!target) {
      res.status(404).json({ error: 'Conta não encontrada.' });
      return;
    }

    accountMemoryMap.delete(normEmail);
    ensureDefaultSuperAdmin();
    saveDatabaseToDisk();

    res.json({ ok: true });
  });

  app.post('/api/superadmin/store-action', (req, res) => {
    const { callerRole, action, storeCode, newMasterKey } = req.body as {
      callerRole?: string;
      action?: 'clear_tabs' | 'delete_store' | 'update_master_key';
      storeCode?: string;
      newMasterKey?: string;
    };

    if (callerRole !== 'SUPERADMIN') {
      res.status(403).json({ error: 'Somente o SUPERADMIN pode executar esta ação.' });
      return;
    }

    if (action === 'update_master_key') {
      const cleanKey = String(newMasterKey || '').trim();
      if (cleanKey.length < 4) {
        res.status(400).json({ error: 'A Chave Mestre deve ter pelo menos 4 caracteres.' });
        return;
      }
      masterRecoveryKey = cleanKey;
      saveDatabaseToDisk();
      res.json({ ok: true, masterRecoveryKey });
      return;
    }

    const code = cleanStoreCode(storeCode || '');
    const current = storeMemoryMap.get(code);
    if (!current) {
      res.status(404).json({ error: 'Bar não encontrado.' });
      return;
    }

    if (action === 'clear_tabs') {
      storeMemoryMap.set(code, {
        ...current,
        tabs: [],
        tabItems: [],
        updatedAtMs: Date.now(),
      });
      saveDatabaseToDisk();
      res.json({ ok: true });
      return;
    }

    if (action === 'delete_store') {
      storeMemoryMap.delete(code);
      saveDatabaseToDisk();
      res.json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Ação inválida.' });
  });

  // 6. Re-hydrate accounts from client localStorage if container restarted
  app.post('/api/auth/rehydrate', (req, res) => {
    const { accounts } = req.body as {
      accounts?: Array<{
        uid: string;
        email: string;
        passwordHash: string;
        userName: string;
        userRole: ServerAccountRole;
        storeName: string;
        storeCode: string;
      }>;
    };
    if (Array.isArray(accounts)) {
      for (const acc of accounts) {
        if (acc && acc.email && acc.passwordHash) {
          const norm = normalizeEmailOrUsername(acc.email);
          if (!accountMemoryMap.has(norm)) {
            accountMemoryMap.set(norm, {
              uid: acc.uid,
              email: norm,
              passwordHash: acc.passwordHash,
              userName: acc.userName,
              userRole:
                acc.userRole === 'SUPERADMIN'
                  ? 'SUPERADMIN'
                  : acc.userRole === 'ADM'
                    ? 'ADM'
                    : 'Garçom',
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

  // 7. Real-time store sync with RBAC & catalogInitialized protection
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
      actionType?: 'add' | 'remove' | 'sync' | 'catalog';
    };

    // Enforce RBAC on the server: Garçom can NEVER perform a 'remove' action
    if (body.callerRole === 'Garçom' && body.actionType === 'remove') {
      res.status(403).json({
        error:
          'Acesso restrito: Garçom pode apenas adicionar. Somente o ADM ou SUPERADMIN pode remover.',
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
            const norm = normalizeEmailOrUsername(op.email);
            const existingAcc = accountMemoryMap.get(norm);
            if (!existingAcc || existingAcc.userRole === 'Garçom') {
              accountMemoryMap.set(norm, {
                uid: op.id || existingAcc?.uid || `op_${Date.now()}`,
                email: norm,
                passwordHash: existingAcc?.passwordHash || op.passwordHash,
                userName: op.operatorName || existingAcc?.userName || 'Garçom',
                userRole: 'Garçom',
                storeName: op.storeName || nextSnapshot.storeName,
                storeCode: code,
                createdAtMs: existingAcc?.createdAtMs || Date.now(),
              });
            }
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
          ? `Comandas abertas/ativas atualmente no bar: ${safeCustomers.map((c) => `"${c}"`).join(', ')}. ATENÇÃO FONÉTICA: Nomes como "Thiago" e "Tiago" (com ou sem H), "Matheus" e "Mateus", "Felipe" e "Phelipe", "Victor" e "Vitor", "Luiz" e "Luis" são a MESMA pessoa! Se houver uma comanda ativa com grafia fonética equivalente, retorne EXATAMENTE o nome da comanda ativa.`
          : 'Nenhuma comanda ativa ainda.';

      const systemInstruction = `Você é o MARCELO, o assistente virtual inteligente de voz de um bar brasileiro (Comanda Voz).
O garçom ou dono do bar fala comandos direcionados a você, muitas vezes na correria SEM PAUSA para vários clientes seguidos!

AS 3 AÇÕES PRINCIPAIS QUE VOCÊ DEVE COMPREENDER PERFEITAMENTE:
1. "MARCAR": Adicionar produtos do cardápio na comanda do cliente.
   Exemplos: "marca 1 litrão para Thiago", "marque 2 espetinhos pro Tiago", "coloca 1 original na conta do Jonas".
   ATENÇÃO CRÍTICA A TAMANHOS E EMBALAGENS:
   - Nunca confunda "coca lata" / "350ml" com "coca cola 2 litros" / "2L", nem "long neck" com "600ml" ou "litrão"!
   - Se o usuário disser uma escolha com "ou" (ex: "coca lata ou coca cola 2 litros"), ou se disser algo ambíguo que serve para dois produtos de tamanhos diferentes (ex: apenas "coca" quando existem Lata e 2 Litros no cardápio), NÃO chute! Retorne "understood": false explicando que ficou ambíguo.
2. "FECHAR": Fechar a conta OU responder quanto ficou / quanto deu a conta do cliente.
   Exemplos: "feche a conta do Thiago", "fechar conta do Tiago", "quanto ficou a conta do Thiago?", "quando ficou a conta do Tiago?" (o microfone muitas vezes transcreve "quanto ficou" como "quando ficou" — entenda ambos como FECHAR!), "quanto deu a conta do Tiago?", "qual o valor da conta do Tiago?".
3. "BAIXA": Dar baixa total ou parcial no pagamento da conta do cliente.
   Exemplos: "dar baixa na conta do Thiago", "dê baixa na conta do Tiago", "dar uma baixa na conta do Tiago", "fazer baixa no Thiago", "baixa de 20 reais na conta do Tiago e continua consumindo", "Tiago pagou a conta", "quitar conta do Thiago".

REGRA DE OURO DE SEGURANÇA ("SE NÃO ENTENDEU, NÃO FAÇA NADA"):
- Se for um comando de MARCAR e o produto pedido NÃO existir no Cardápio do Bar listado abaixo, estiver ambíguo entre dois itens, ou não tiver nome de cliente, retorne "understood": false.
- Nomes com grafia fonética igual (ex: "Thiago" e "Tiago" sem H, "Marcelo" e "Marcelle", "Matheus" e "Mateus") DEVEM ser reconhecidos normalmente e unificados com o nome da comanda ativa se já existir!

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
