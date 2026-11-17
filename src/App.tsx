/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  deleteDoc,
  updateDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import {
  Mic,
  MicOff,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Search,
  Volume2,
  VolumeX,
  Receipt,
  LogOut,
  RotateCcw,
  Send,
  Utensils,
  UserPlus,
  Copy,
  Check,
  AlertCircle,
  ShieldCheck,
  Banknote,
  Store,
  Lock,
  Mail,
  KeyRound,
  Edit3,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  logoutUser,
  OperationType,
} from './firebase';
import {
  BarTab,
  ItemCategory,
  MenuItem,
  ParsedSingleCommand,
  ParsedVoiceOrder,
  TabItem,
  TabStageStatus,
  UserProfile,
  UserRoleType,
  VoiceOperator,
} from './types';
import {
  areCustomerNamesEquivalent,
  CATEGORY_LABELS,
  DEFAULT_BAR_MENU,
  formatBRL,
  normalizePhoneticPt,
  normalizeText,
  parseVoiceOrderLocally,
  sanitizeCategory,
  sanitizeStoreCode,
  sanitizeString,
  STAGE_LABELS,
  VALIDATION_LIMITS,
} from './utils/barCatalog';
import { speakAsMarcelo } from './utils/voiceBiometrics';
import { ErrorBoundary } from './components/ErrorBoundary';

// Web Speech API Type Declarations
interface SpeechRecognitionEvent extends Event {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
      isFinal: boolean;
    };
    length: number;
  };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type ActiveSection = 'comandas' | 'cardapio' | 'equipe_comercio' | 'superadmin';

interface DirectBarSession {
  uid: string;
  email: string;
  userName: string;
  userRole: UserRoleType;
  storeName: string;
  storeCode: string;
}

interface LocalAccountBackup {
  uid: string;
  email: string;
  passwordPlainOrHash: string;
  userName: string;
  userRole: 'SUPERADMIN' | 'ADM' | 'Garçom';
  storeName: string;
  storeCode: string;
}

interface SuperAdminAccountSummary {
  uid: string;
  email: string;
  userName: string;
  userRole: 'SUPERADMIN' | 'ADM' | 'Garçom';
  storeName: string;
  storeCode: string;
  createdAtMs: number;
}

interface SuperAdminStoreSummary {
  storeCode: string;
  storeName: string;
  tabsCount: number;
  totalConsumed: number;
  menuCount: number;
  operatorsCount: number;
  updatedAtMs: number;
}

interface TabSnapshotUndoState {
  tabId: string;
  createdNewTab: boolean;
  customerName: string;
  tableLabel: string;
  previousTotal: number;
  previousPaid: number;
  previousCount: number;
  previousStatus: TabStageStatus;
}

interface LastActionUndo {
  description: string;
  tabsAffected: TabSnapshotUndoState[];
  addedItemIds: string[];
}

interface MarceloReportCard {
  intent: 'MARCAR' | 'FECHAR' | 'BAIXA';
  title: string;
  spokenSummary: string;
  customerName: string;
  stageLabel: string;
  waiterAttribution: string;
  itemsSummary: string[];
  totalConsumed: number;
  totalPaid: number;
  remainingBalance: number;
}

const DIRECT_SESSION_STORAGE_KEY = 'comanda_voz_direct_session_v2';
const LOCAL_ACCOUNTS_BACKUP_KEY = 'comanda_voz_accounts_backup_v1';

const SIMPLE_VOICE_EXAMPLES = [
  {
    stage: '1. Marcar',
    phrase: 'Marcelo, marca 1 litrão para Tiago',
  },
  {
    stage: '2. Fechar / Valor',
    phrase: 'Quanto ficou a conta do Thiago?',
  },
  {
    stage: '3. Dar Baixa',
    phrase: 'Dar baixa na conta do Tiago',
  },
];

function getTimestampMillis(ts: unknown): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object') {
    const obj = ts as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      _ms?: number;
    };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.toDate === 'function') return obj.toDate().getTime();
    if (typeof obj._ms === 'number') return obj._ms;
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return Date.now();
}

function makeLocalTimestamp(): Timestamp {
  const now = Date.now();
  return {
    seconds: Math.floor(now / 1000),
    nanoseconds: 0,
    toMillis: () => now,
    toDate: () => new Date(now),
  } as unknown as Timestamp;
}

function getRemainingBalance(tab: BarTab): number {
  const paid = Number.isFinite(tab.paidAmount) ? tab.paidAmount : 0;
  return Math.max(0, Number((tab.totalAmount - paid).toFixed(2)));
}

function loadLocalAccountsBackup(): LocalAccountBackup[] {
  try {
    const raw = localStorage.getItem(LOCAL_ACCOUNTS_BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccountToLocalBackup(acc: LocalAccountBackup) {
  try {
    const list = loadLocalAccountsBackup().filter(
      (a) => a.email.toLowerCase() !== acc.email.toLowerCase()
    );
    list.push(acc);
    localStorage.setItem(LOCAL_ACCOUNTS_BACKUP_KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}

function removeAccountFromLocalBackup(email?: string) {
  if (!email) return;
  try {
    const list = loadLocalAccountsBackup().filter(
      (a) => a.email.toLowerCase() !== email.toLowerCase()
    );
    localStorage.setItem(LOCAL_ACCOUNTS_BACKUP_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function ComandaVozWorkspace() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [directSession, setDirectSession] = useState<DirectBarSession | null>(() => {
    try {
      const saved = localStorage.getItem(DIRECT_SESSION_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DirectBarSession;
        if (parsed && parsed.uid && parsed.storeCode) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });

  const [authReady, setAuthReady] = useState(false);
  const [activeSection, setActiveSection] = useState<ActiveSection>('comandas');

  // Email & Password Auth State (Login vs Register ADM vs Recover Password)
  const [authTab, setAuthTab] = useState<'login' | 'register_adm' | 'recover_password'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authFormError, setAuthFormError] = useState<string | null>(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);

  // Register ADM Form State
  const [regAdmName, setRegAdmName] = useState('');
  const [regAdmEmail, setRegAdmEmail] = useState('');
  const [regAdmPassword, setRegAdmPassword] = useState('');
  const [regStoreName, setRegStoreName] = useState('Bar Central');
  const [regStoreCode, setRegStoreCode] = useState('BAR-01');

  // Password Recovery Form State
  const [recEmail, setRecEmail] = useState('');
  const [recVerification, setRecVerification] = useState('');
  const [recNewPassword, setRecNewPassword] = useState('');

  // Unified user accessor (prioritize direct Email/Password session)
  const isDirectSession = Boolean(directSession);
  const user = useMemo(() => {
    if (directSession) {
      return {
        uid: directSession.uid,
        displayName: directSession.userName,
        email: directSession.email || `${directSession.storeCode.toLowerCase()}@comandavoz.bar`,
      } as User;
    }
    if (firebaseUser) return firebaseUser;
    return null;
  }, [firebaseUser, directSession]);

  // Firestore / Store Real-Time State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tabs, setTabs] = useState<BarTab[]>([]);
  const [tabItems, setTabItems] = useState<TabItem[]>([]);
  const [voiceOperators, setVoiceOperators] = useState<VoiceOperator[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Mutation Lock Refs to prevent background polling from overwriting Cardápio / Tab edits
  const isMutatingRef = useRef(false);
  const lastMutationMsRef = useRef(0);

  // Store Profile Form
  const [profileUserName, setProfileUserName] = useState('');
  const [profileUserRole, setProfileUserRole] = useState<UserRoleType>('ADM');
  const [profileStoreName, setProfileStoreName] = useState('');
  const [profileStoreCode, setProfileStoreCode] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Strict Role-Based Access Control (RBAC):
  // SUPERADMIN (Programador) controls everything across all stores and users.
  // ADM ('ADM' or 'Proprietário') has full control over their store.
  // Garçom ('Garçom') can ONLY add items, NEVER remove anything or manage Cardápio/Garçons.
  const currentUserRole: UserRoleType = useMemo(() => {
    if (directSession?.userRole) return directSession.userRole;
    if (userProfile?.userRole) return userProfile.userRole;
    return 'ADM';
  }, [directSession, userProfile]);

  const isSuperAdmin = useMemo(() => currentUserRole === 'SUPERADMIN', [currentUserRole]);

  const isAdmin = useMemo(
    () =>
      isSuperAdmin ||
      currentUserRole === 'ADM' ||
      currentUserRole === 'Proprietário',
    [isSuperAdmin, currentUserRole]
  );

  // Marcelo Assistant State
  const [commandInput, setCommandInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [marceloVoiceReplyEnabled, setMarceloVoiceReplyEnabled] = useState(true);

  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [marceloReport, setMarceloReport] = useState<MarceloReportCard | null>(null);
  const [lastUndo, setLastUndo] = useState<LastActionUndo | null>(null);

  // Selected Tab & Stage Filters
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | 'open' | 'closing' | 'paid'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  // New Tab Inline Form
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newTableLabel, setNewTableLabel] = useState('');
  const [showNewTabForm, setShowNewTabForm] = useState(false);

  // Baixa (Payment Stage 3) Drawer State
  const [showBaixaDrawer, setShowBaixaDrawer] = useState(false);
  const [baixaAmountInput, setBaixaAmountInput] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('PIX');
  const [baixaKeepConsuming, setBaixaKeepConsuming] = useState(false);

  // ADM Waiter Registration State
  const [newOpName, setNewOpName] = useState('');
  const [newOpEmail, setNewOpEmail] = useState('');
  const [newOpPassword, setNewOpPassword] = useState('');
  const [registeringWaiter, setRegisteringWaiter] = useState(false);

  // Cardápio (Menu Item) Create & Edit Form State
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState<ItemCategory>('cervejas');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuSynonyms, setNewMenuSynonyms] = useState('');
  const [savingMenu, setSavingMenu] = useState(false);

  // SUPERADMIN State (All Accounts, All Stores, Master Recovery Key)
  const [superAccounts, setSuperAccounts] = useState<SuperAdminAccountSummary[]>([]);
  const [superStores, setSuperStores] = useState<SuperAdminStoreSummary[]>([]);
  const [masterRecoveryKeyState, setMasterRecoveryKeyState] = useState('SUPER2026');
  const [saUserEmail, setSaUserEmail] = useState('');
  const [saUserName, setSaUserName] = useState('');
  const [saUserPassword, setSaUserPassword] = useState('');
  const [saUserRole, setSaUserRole] = useState<'SUPERADMIN' | 'ADM' | 'Garçom'>('ADM');
  const [saStoreName, setSaStoreName] = useState('Bar Central');
  const [saStoreCode, setSaStoreCode] = useState('BAR-01');
  const [saSaving, setSaSaving] = useState(false);
  const [resettingAccountEmail, setResettingAccountEmail] = useState<string | null>(null);
  const [inlineNewPassword, setInlineNewPassword] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Helper to persist Store snapshot to localStorage + Express server with RBAC headers
  const syncDirectStoreSnapshot = async (nextData: {
    storeCode?: string;
    storeName?: string;
    menuItems?: MenuItem[];
    tabs?: BarTab[];
    tabItems?: TabItem[];
    voiceOperators?: VoiceOperator[];
    actionType?: 'add' | 'remove' | 'catalog';
  }) => {
    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();

    const code = sanitizeStoreCode(
      nextData.storeCode || directSession?.storeCode || profileStoreCode || 'BAR-01'
    );
    const sName = sanitizeString(
      nextData.storeName || directSession?.storeName || profileStoreName || 'Bar Central',
      VALIDATION_LIMITS.STORE_NAME_MAX_LEN
    );
    const updatedMenu = nextData.menuItems ?? menuItems;
    const updatedTabs = nextData.tabs ?? tabs;
    const updatedTabItems = nextData.tabItems ?? tabItems;
    const updatedOperators = nextData.voiceOperators ?? voiceOperators;

    const payload = {
      storeCode: code,
      storeName: sName,
      catalogInitialized: true,
      menuItems: updatedMenu,
      tabs: updatedTabs,
      tabItems: updatedTabItems,
      voiceOperators: updatedOperators,
      callerRole: isAdmin ? 'ADM' : 'Garçom',
      actionType: nextData.actionType || 'add',
      updatedAtMs: Date.now(),
    };

    try {
      localStorage.setItem(`comanda_voz_store_${code}`, JSON.stringify(payload));
      localStorage.setItem(`comanda_voz_catalog_init_${code}`, 'true');
    } catch {
      // ignore storage quota errors
    }

    try {
      await fetch(`/api/store/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // offline fallback handled by localStorage
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // Email/Username & Password Login Handler (Works for SUPERADMIN, ADM, and Garçom)
  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthFormError(null);
    setAuthSuccessMsg(null);
    const rawLogin = loginEmail.trim().toLowerCase();
    const cleanEmail =
      rawLogin === 'superadmin' || rawLogin === 'programador'
        ? 'superadmin@comandavoz.com'
        : rawLogin;
    const cleanPass = loginPassword.trim();

    if (!cleanEmail || !cleanPass) {
      setAuthFormError('Informe seu usuário/e-mail e senha para entrar.');
      return;
    }

    setAuthBusy(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password: cleanPass }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          ok: boolean;
          account?: DirectBarSession;
          session?: DirectBarSession;
        };
        const acc = data.account || data.session;
        if (data.ok && acc) {
          const session: DirectBarSession = {
            uid: acc.uid,
            email: acc.email,
            userName: acc.userName,
            userRole: acc.userRole,
            storeName: acc.storeName,
            storeCode: acc.storeCode,
          };
          localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
          saveAccountToLocalBackup({
            uid: session.uid,
            email: session.email,
            passwordPlainOrHash: cleanPass,
            userName: session.userName,
            userRole:
              session.userRole === 'SUPERADMIN'
                ? 'SUPERADMIN'
                : session.userRole === 'Garçom'
                  ? 'Garçom'
                  : 'ADM',
            storeName: session.storeName,
            storeCode: session.storeCode,
          });
          setDirectSession(session);
          setLoginPassword('');
          return;
        }
      }

      // Check local backup in case container restarted
      const backupMatch = loadLocalAccountsBackup().find(
        (acc) =>
          acc.email.toLowerCase() === cleanEmail && acc.passwordPlainOrHash === cleanPass
      );

      if (backupMatch) {
        const session: DirectBarSession = {
          uid: backupMatch.uid,
          email: backupMatch.email,
          userName: backupMatch.userName,
          userRole: backupMatch.userRole,
          storeName: backupMatch.storeName,
          storeCode: backupMatch.storeCode,
        };
        localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
        setDirectSession(session);
        setLoginPassword('');
        return;
      }

      const errData = (await response.json().catch(() => ({}))) as { error?: string };
      setAuthFormError(
        errData.error ||
          'Usuário/E-mail ou senha incorretos. Esqueceu sua senha? Clique em "Recuperar Senha".'
      );
    } catch {
      setAuthFormError('Erro de conexão ao validar login. Tente novamente.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Password Recovery Handler (Works for SUPERADMIN, ADM, and Garçom)
  const handleRecoverPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthFormError(null);
    setAuthSuccessMsg(null);

    const rawEmail = recEmail.trim().toLowerCase();
    const cleanEmail =
      rawEmail === 'superadmin' || rawEmail === 'programador'
        ? 'superadmin@comandavoz.com'
        : rawEmail;
    const cleanVerif = recVerification.trim();
    const cleanNewPass = recNewPassword.trim();

    if (!cleanEmail || !cleanVerif || cleanNewPass.length < 4) {
      setAuthFormError(
        'Preencha o e-mail/usuário, o código de validação (Código do Bar, Nome ou Chave Mestre) e a nova senha (mín. 4 caracteres).'
      );
      return;
    }

    setAuthBusy(true);
    try {
      const response = await fetch('/api/auth/recover-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          verification: cleanVerif,
          newPassword: cleanNewPass,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        account?: DirectBarSession;
        session?: DirectBarSession;
      };

      const acc = data.account || data.session;
      if (response.ok && data.ok && acc) {
        const session: DirectBarSession = {
          uid: acc.uid,
          email: acc.email,
          userName: acc.userName,
          userRole: acc.userRole,
          storeName: acc.storeName,
          storeCode: acc.storeCode,
        };
        localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
        saveAccountToLocalBackup({
          uid: session.uid,
          email: session.email,
          passwordPlainOrHash: cleanNewPass,
          userName: session.userName,
          userRole:
            session.userRole === 'SUPERADMIN'
              ? 'SUPERADMIN'
              : session.userRole === 'Garçom'
                ? 'Garçom'
                : 'ADM',
          storeName: session.storeName,
          storeCode: session.storeCode,
        });
        setRecNewPassword('');
        setRecVerification('');
        setDirectSession(session);
        return;
      }

      // Also check localStorage backup if offline or container restarted
      const localMatch = loadLocalAccountsBackup().find(
        (b) =>
          b.email.toLowerCase() === cleanEmail &&
          (b.storeCode.toUpperCase() === cleanVerif.toUpperCase() ||
            b.userName.toLowerCase() === cleanVerif.toLowerCase() ||
            cleanVerif.toUpperCase() === 'SUPER2026')
      );

      if (localMatch) {
        const updatedBackup: LocalAccountBackup = {
          ...localMatch,
          passwordPlainOrHash: cleanNewPass,
        };
        saveAccountToLocalBackup(updatedBackup);
        const session: DirectBarSession = {
          uid: updatedBackup.uid,
          email: updatedBackup.email,
          userName: updatedBackup.userName,
          userRole: updatedBackup.userRole,
          storeName: updatedBackup.storeName,
          storeCode: updatedBackup.storeCode,
        };
        localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
        setDirectSession(session);
        return;
      }

      setAuthFormError(
        data.error ||
          'Não foi possível validar a recuperação. Confira o e-mail e o Código do Bar (ou Chave Mestre).'
      );
    } catch {
      setAuthFormError('Erro ao redefinir a senha. Verifique sua conexão.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Register ADM Account (Email & Password + Bar Info)
  const handleRegisterAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthFormError(null);

    const cleanName = sanitizeString(regAdmName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN);
    const cleanEmail = regAdmEmail.trim().toLowerCase();
    const cleanPass = regAdmPassword.trim();
    const cleanStore = sanitizeString(regStoreName, VALIDATION_LIMITS.STORE_NAME_MAX_LEN);
    const cleanCode = sanitizeStoreCode(regStoreCode, 'BAR-01');

    if (!cleanName || !cleanEmail.includes('@') || cleanPass.length < 4) {
      setAuthFormError('Preencha seu nome, e-mail válido e senha de no mínimo 4 dígitos.');
      return;
    }

    setAuthBusy(true);
    try {
      const response = await fetch('/api/auth/register-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: cleanName,
          email: cleanEmail,
          password: cleanPass,
          storeName: cleanStore,
          storeCode: cleanCode,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        account?: DirectBarSession;
        session?: DirectBarSession;
      };

      const acc = data.account || data.session;
      if (!response.ok || !data.ok || !acc) {
        setAuthFormError(data.error || 'Não foi possível criar a conta ADM.');
        return;
      }

      const session: DirectBarSession = {
        uid: acc.uid,
        email: acc.email,
        userName: acc.userName,
        userRole: 'ADM',
        storeName: acc.storeName,
        storeCode: acc.storeCode,
      };

      localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
      saveAccountToLocalBackup({
        uid: session.uid,
        email: session.email,
        passwordPlainOrHash: cleanPass,
        userName: session.userName,
        userRole: 'ADM',
        storeName: session.storeName,
        storeCode: session.storeCode,
      });

      setDirectSession(session);
      setRegAdmPassword('');
    } catch {
      setAuthFormError('Erro ao criar conta ADM. Verifique sua conexão.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOutAll = async () => {
    try {
      localStorage.removeItem(DIRECT_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setDirectSession(null);
    if (firebaseUser) {
      await logoutUser();
    }
  };

  // 1. Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2A. Email/Password Session Loader & Real-Time Polling Sync
  useEffect(() => {
    if (!authReady || firebaseUser || !directSession) return;
    setDataLoading(true);

    const code = sanitizeStoreCode(directSession.storeCode, 'BAR-01');
    const nowTs = makeLocalTimestamp();
    const initialProfile: UserProfile = {
      id: directSession.uid,
      ownerId: directSession.uid,
      email: directSession.email,
      userName: directSession.userName,
      userRole: directSession.userRole,
      storeName: directSession.storeName,
      storeCode: code,
      createdAt: nowTs,
      updatedAt: nowTs,
    };
    setUserProfile(initialProfile);
    setProfileUserName(initialProfile.userName);
    setProfileUserRole(initialProfile.userRole);
    setProfileStoreName(initialProfile.storeName);
    setProfileStoreCode(initialProfile.storeCode);

    const buildSeededMenu = (): MenuItem[] =>
      DEFAULT_BAR_MENU.map((seed) => ({
        id: `${seed.id}_${code.toLowerCase()}`,
        ownerId: directSession.uid,
        name: sanitizeString(seed.name, VALIDATION_LIMITS.NAME_MAX_LEN),
        category: sanitizeCategory(seed.category),
        price: Math.min(Math.max(seed.price, 0), VALIDATION_LIMITS.MAX_PRICE),
        synonyms: sanitizeString(seed.synonyms, VALIDATION_LIMITS.SYNONYMS_MAX_LEN),
        createdAt: nowTs,
        updatedAt: nowTs,
      }));

    let isCancelled = false;

    const loadFromServerOrLocal = async (isInitial: boolean) => {
      if (!isInitial && (isMutatingRef.current || Date.now() - lastMutationMsRef.current < 4000)) {
        return;
      }

      const wasCatalogInitializedLocally =
        localStorage.getItem(`comanda_voz_catalog_init_${code}`) === 'true';

      try {
        const res = await fetch(`/api/store/${encodeURIComponent(code)}`);
        if (res.ok) {
          const data = (await res.json()) as {
            exists?: boolean;
            catalogInitialized?: boolean;
            menuItems?: MenuItem[];
            tabs?: BarTab[];
            tabItems?: TabItem[];
            voiceOperators?: VoiceOperator[];
          };

          if (
            !isCancelled &&
            !isMutatingRef.current &&
            Date.now() - lastMutationMsRef.current >= (isInitial ? 0 : 4000) &&
            data.exists
          ) {
            const isCatInit =
              Boolean(data.catalogInitialized) ||
              wasCatalogInitializedLocally ||
              Array.isArray(data.menuItems);

            const loadedMenu = Array.isArray(data.menuItems)
              ? isCatInit
                ? data.menuItems
                : data.menuItems.length > 0
                  ? data.menuItems
                  : buildSeededMenu()
              : buildSeededMenu();

            localStorage.setItem(`comanda_voz_catalog_init_${code}`, 'true');
            setMenuItems(loadedMenu);
            setTabs(Array.isArray(data.tabs) ? data.tabs : []);
            setTabItems(Array.isArray(data.tabItems) ? data.tabItems : []);
            setVoiceOperators(Array.isArray(data.voiceOperators) ? data.voiceOperators : []);
            setDataLoading(false);
            return;
          }
        }
      } catch {
        // fallback to localStorage
      }

      if (isCancelled) return;

      if (isInitial) {
        try {
          const localRaw = localStorage.getItem(`comanda_voz_store_${code}`);
          if (localRaw) {
            const parsed = JSON.parse(localRaw) as {
              menuItems?: MenuItem[];
              tabs?: BarTab[];
              tabItems?: TabItem[];
              voiceOperators?: VoiceOperator[];
            };
            const loadedMenu = Array.isArray(parsed.menuItems)
              ? parsed.menuItems
              : buildSeededMenu();

            const loadedTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
            const loadedTabItems = Array.isArray(parsed.tabItems) ? parsed.tabItems : [];
            const loadedOps = Array.isArray(parsed.voiceOperators) ? parsed.voiceOperators : [];

            setMenuItems(loadedMenu);
            setTabs(loadedTabs);
            setTabItems(loadedTabItems);
            setVoiceOperators(loadedOps);
            setDataLoading(false);

            await syncDirectStoreSnapshot({
              storeCode: code,
              storeName: directSession.storeName,
              menuItems: loadedMenu,
              tabs: loadedTabs,
              tabItems: loadedTabItems,
              voiceOperators: loadedOps,
              actionType: 'add',
            });
            return;
          }
        } catch {
          // ignore
        }

        const seeded = buildSeededMenu();
        setMenuItems(seeded);
        setTabs([]);
        setTabItems([]);
        setVoiceOperators([]);
        setDataLoading(false);
        await syncDirectStoreSnapshot({
          storeCode: code,
          storeName: directSession.storeName,
          menuItems: seeded,
          tabs: [],
          tabItems: [],
          voiceOperators: [],
          actionType: 'add',
        });
      }
    };

    loadFromServerOrLocal(true);
    const intervalId = window.setInterval(() => {
      loadFromServerOrLocal(false);
    }, 3500);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authReady, firebaseUser, directSession]);

  // 2B. Real-time Firestore Listeners
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    setDataLoading(true);

    const profileRef = doc(db, 'userProfiles', firebaseUser.uid);
    const menuQuery = query(
      collection(db, 'menuItems'),
      where('ownerId', '==', firebaseUser.uid)
    );
    const tabsQuery = query(collection(db, 'tabs'), where('ownerId', '==', firebaseUser.uid));
    const tabItemsQuery = query(
      collection(db, 'tabItems'),
      where('ownerId', '==', firebaseUser.uid)
    );
    const operatorsQuery = query(
      collection(db, 'voiceOperators'),
      where('ownerId', '==', firebaseUser.uid)
    );

    const unsubProfile = onSnapshot(
      profileRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Omit<UserProfile, 'id'>;
          const loaded: UserProfile = { id: snap.id, ...data };
          setUserProfile(loaded);
          setProfileUserName(loaded.userName);
          setProfileUserRole(loaded.userRole);
          setProfileStoreName(loaded.storeName);
          setProfileStoreCode(loaded.storeCode);
        } else {
          const defaultUserName = sanitizeString(
            firebaseUser.displayName ||
              firebaseUser.email?.split('@')[0] ||
              'Administrador',
            VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
            'Administrador'
          );
          const defaultStoreName = 'Bar Central';
          const defaultStoreCode = `BAR-${firebaseUser.uid.slice(0, 5).toUpperCase()}`;

          setDoc(profileRef, {
            ownerId: firebaseUser.uid,
            userName: defaultUserName,
            userRole: 'ADM',
            storeName: defaultStoreName,
            storeCode: sanitizeStoreCode(defaultStoreCode),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch((err) =>
            handleFirestoreError(err, OperationType.CREATE, `userProfiles/${firebaseUser.uid}`)
          );
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `userProfiles/${firebaseUser.uid}`)
    );

    const unsubMenu = onSnapshot(
      menuQuery,
      async (snap) => {
        const seededFlagKey = `comanda_voz_fb_menu_seeded_${firebaseUser.uid}`;
        const alreadySeededOnce = localStorage.getItem(seededFlagKey) === 'true';

        if (snap.empty && !alreadySeededOnce) {
          localStorage.setItem(seededFlagKey, 'true');
          try {
            const batch = writeBatch(db);
            for (const seed of DEFAULT_BAR_MENU) {
              const docId = `${seed.id}_${firebaseUser.uid.slice(0, 8)}`;
              const ref = doc(db, 'menuItems', docId);
              batch.set(ref, {
                ownerId: firebaseUser.uid,
                name: sanitizeString(seed.name, VALIDATION_LIMITS.NAME_MAX_LEN),
                category: sanitizeCategory(seed.category),
                price: Math.min(Math.max(seed.price, 0), VALIDATION_LIMITS.MAX_PRICE),
                synonyms: sanitizeString(seed.synonyms, VALIDATION_LIMITS.SYNONYMS_MAX_LEN),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, 'menuItems');
          }
          return;
        }

        if (!snap.empty && !alreadySeededOnce) {
          localStorage.setItem(seededFlagKey, 'true');
        }

        const loaded: MenuItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MenuItem, 'id'>),
        }));
        loaded.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        setMenuItems(loaded);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'menuItems')
    );

    const unsubTabs = onSnapshot(
      tabsQuery,
      (snap) => {
        const loaded: BarTab[] = snap.docs.map((d) => {
          const raw = d.data() as Omit<BarTab, 'id'> & { paidAmount?: number };
          return {
            id: d.id,
            ...raw,
            paidAmount: typeof raw.paidAmount === 'number' ? raw.paidAmount : 0,
          };
        });
        loaded.sort((a, b) => getTimestampMillis(b.updatedAt) - getTimestampMillis(a.updatedAt));
        setTabs(loaded);
        setDataLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tabs')
    );

    const unsubTabItems = onSnapshot(
      tabItemsQuery,
      (snap) => {
        const loaded: TabItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TabItem, 'id'>),
        }));
        loaded.sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
        setTabItems(loaded);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tabItems')
    );

    const unsubOperators = onSnapshot(
      operatorsQuery,
      (snap) => {
        const loaded: VoiceOperator[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<VoiceOperator, 'id'>),
        }));
        setVoiceOperators(loaded);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'voiceOperators')
    );

    return () => {
      unsubProfile();
      unsubMenu();
      unsubTabs();
      unsubTabItems();
      unsubOperators();
    };
  }, [authReady, firebaseUser]);

  const currentStoreName = useMemo(
    () =>
      sanitizeString(
        userProfile?.storeName || directSession?.storeName || 'Bar Central',
        VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
        'Bar Central'
      ),
    [userProfile, directSession]
  );

  const currentStoreCode = useMemo(
    () => sanitizeStoreCode(userProfile?.storeCode || directSession?.storeCode || 'BAR-01'),
    [userProfile, directSession]
  );

  const activeWaiterDisplay = useMemo(() => {
    const baseName =
      directSession?.userName ||
      userProfile?.userName ||
      user?.displayName ||
      user?.email?.split('@')[0] ||
      'Operador';
    const baseRole = isAdmin ? 'ADM' : 'Garçom';
    return {
      name: `${baseName} (${baseRole})`,
      storeName: currentStoreName,
    };
  }, [isAdmin, userProfile, directSession, user, currentStoreName]);

  const activeStageTabs = useMemo(
    () => tabs.filter((t) => t.status !== 'archived'),
    [tabs]
  );

  const stageCounts = useMemo(() => {
    return {
      all: activeStageTabs.length,
      open: activeStageTabs.filter((t) => t.status === 'open').length,
      closing: activeStageTabs.filter((t) => t.status === 'closing').length,
      paid: activeStageTabs.filter((t) => t.status === 'paid').length,
    };
  }, [activeStageTabs]);

  const filteredTabs = useMemo(() => {
    return activeStageTabs.filter((t) => {
      if (stageFilter !== 'all' && t.status !== stageFilter) return false;
      if (!searchQuery.trim()) return true;
      const qPhon = normalizePhoneticPt(searchQuery);
      const qNorm = normalizeText(searchQuery);
      return (
        normalizePhoneticPt(t.customerName).includes(qPhon) ||
        normalizeText(t.customerName).includes(qNorm) ||
        normalizeText(t.tableLabel).includes(qNorm)
      );
    });
  }, [activeStageTabs, stageFilter, searchQuery]);

  useEffect(() => {
    if (
      activeStageTabs.length > 0 &&
      (!selectedTabId || !activeStageTabs.some((t) => t.id === selectedTabId))
    ) {
      setSelectedTabId(activeStageTabs[0].id);
    } else if (activeStageTabs.length === 0) {
      setSelectedTabId(null);
    }
  }, [activeStageTabs, selectedTabId]);

  const selectedTab = useMemo(
    () => activeStageTabs.find((t) => t.id === selectedTabId) || null,
    [activeStageTabs, selectedTabId]
  );

  const getConsolidatedItemsForTab = (targetTabId: string) => {
    const items = tabItems.filter((i) => i.tabId === targetTabId);
    const map = new Map<
      string,
      {
        key: string;
        itemName: string;
        category: ItemCategory;
        unitPrice: number;
        totalQuantity: number;
        totalSubtotal: number;
        entries: TabItem[];
      }
    >();

    for (const entry of items) {
      const key = `${normalizeText(entry.itemName)}_${entry.unitPrice.toFixed(2)}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += entry.quantity;
        existing.totalSubtotal += entry.totalPrice;
        existing.entries.push(entry);
      } else {
        map.set(key, {
          key,
          itemName: entry.itemName,
          category: entry.category,
          unitPrice: entry.unitPrice,
          totalQuantity: entry.quantity,
          totalSubtotal: entry.totalPrice,
          entries: [entry],
        });
      }
    }
    return Array.from(map.values());
  };

  const consolidatedSelectedItems = useMemo(
    () => (selectedTab ? getConsolidatedItemsForTab(selectedTab.id) : []),
    [selectedTab, tabItems]
  );

  // STAGE 1: MARCAR ITENS (Supports phonetic matching "Thiago" <-> "Tiago" and multi-customer continuous speech)
  const executeMultiCustomerStage1Marcar = async (
    marcarCommands: ParsedSingleCommand[],
    rawTranscript: string,
    sourceType: 'voz' | 'manual',
    waiterNameAttr: string,
    storeNameAttr: string
  ) => {
    if (!user || marcarCommands.length === 0) return;

    const cleanTranscript = sanitizeString(
      rawTranscript,
      VALIDATION_LIMITS.TRANSCRIPT_MAX_LEN,
      ''
    );
    const cleanWaiterName = sanitizeString(
      waiterNameAttr,
      VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
      'Garçom'
    );
    const cleanStoreName = sanitizeString(
      storeNameAttr,
      VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
      'Bar Central'
    );

    const addedItemIds: string[] = [];
    const newLocalTabItems: TabItem[] = [];
    const tabsAffectedMap = new Map<
      string,
      {
        tabId: string;
        createdNewTab: boolean;
        customerName: string;
        tableLabel: string;
        previousTotal: number;
        previousPaid: number;
        previousCount: number;
        previousStatus: TabStageStatus;
        runningTotal: number;
        runningCount: number;
      }
    >();

    const perCustomerSpokenParts: string[] = [];
    const allItemsSummaryLines: string[] = [];
    let lastTargetTabId = '';
    let grandTotalConsumed = 0;
    let grandTotalPaid = 0;
    let grandRemainingBalance = 0;
    const localTs = makeLocalTimestamp();

    for (const cmd of marcarCommands) {
      const cleanCustomerName = sanitizeString(
        cmd.customerName,
        VALIDATION_LIMITS.NAME_MAX_LEN,
        ''
      );
      if (!cleanCustomerName || !cmd.items || cmd.items.length === 0) continue;

      const cleanTableLabel = sanitizeString(
        cmd.tableLabel,
        VALIDATION_LIMITS.TABLE_MAX_LEN,
        ''
      );

      // Phonetic equivalence check so "Tiago" and "Thiago" always map to the same customer tab!
      let tabState = Array.from(tabsAffectedMap.values()).find((t) =>
        areCustomerNamesEquivalent(t.customerName, cleanCustomerName)
      );

      if (!tabState) {
        const existingTab = activeStageTabs.find((t) =>
          areCustomerNamesEquivalent(t.customerName, cleanCustomerName)
        );
        const targetTabId =
          existingTab?.id ||
          `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        tabState = {
          tabId: targetTabId,
          createdNewTab: !existingTab,
          customerName: existingTab ? existingTab.customerName : cleanCustomerName,
          tableLabel: cleanTableLabel || existingTab?.tableLabel || '',
          previousTotal: existingTab ? existingTab.totalAmount : 0,
          previousPaid: existingTab ? existingTab.paidAmount : 0,
          previousCount: existingTab ? existingTab.itemCount : 0,
          previousStatus: existingTab ? existingTab.status : 'open',
          runningTotal: existingTab ? existingTab.totalAmount : 0,
          runningCount: existingTab ? existingTab.itemCount : 0,
        };
        tabsAffectedMap.set(targetTabId, tabState);
      }

      const customerItemParts: string[] = [];

      for (const rawItem of cmd.items) {
        const qty = Math.min(
          Math.max(Math.round(Number(rawItem.quantity) || 1), 1),
          VALIDATION_LIMITS.MAX_QTY
        );
        const unitPrice = Math.min(
          Math.max(Number(rawItem.unitPrice) || 0, 0),
          VALIDATION_LIMITS.MAX_PRICE
        );
        const subtotal = Math.min(
          Number((qty * unitPrice).toFixed(2)),
          VALIDATION_LIMITS.MAX_TOTAL
        );
        const itemName = sanitizeString(
          rawItem.itemName,
          VALIDATION_LIMITS.NAME_MAX_LEN,
          'Item'
        );
        const category = sanitizeCategory(rawItem.category);

        const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        newLocalTabItems.push({
          id: itemId,
          ownerId: user.uid,
          tabId: tabState.tabId,
          customerName: tabState.customerName,
          itemName,
          category,
          quantity: qty,
          unitPrice,
          totalPrice: subtotal,
          source: sourceType,
          voiceTranscript: cleanTranscript,
          launchedByName: cleanWaiterName,
          storeName: cleanStoreName,
          createdAt: localTs,
          updatedAt: localTs,
        });

        tabState.runningTotal = Math.min(
          Number((tabState.runningTotal + subtotal).toFixed(2)),
          VALIDATION_LIMITS.MAX_TOTAL
        );
        tabState.runningCount = Math.min(tabState.runningCount + qty, 10000);

        addedItemIds.push(itemId);
        customerItemParts.push(`${qty}x ${itemName}`);
        allItemsSummaryLines.push(
          `${tabState.customerName}: +${qty}x ${itemName} (${formatBRL(subtotal)})`
        );
      }

      perCustomerSpokenParts.push(
        `${customerItemParts.join(' e ')} para ${tabState.customerName}`
      );
      lastTargetTabId = tabState.tabId;
    }

    if (tabsAffectedMap.size === 0) return;

    for (const tabState of tabsAffectedMap.values()) {
      grandTotalConsumed += tabState.runningTotal;
      grandTotalPaid += tabState.previousPaid;
      grandRemainingBalance += Math.max(
        0,
        Number((tabState.runningTotal - tabState.previousPaid).toFixed(2))
      );
    }

    try {
      if (isDirectSession) {
        const nextTabs = [...tabs];
        for (const tabState of tabsAffectedMap.values()) {
          if (tabState.createdNewTab) {
            nextTabs.unshift({
              id: tabState.tabId,
              ownerId: user.uid,
              customerName: tabState.customerName,
              tableLabel: tabState.tableLabel,
              status: 'open',
              totalAmount: tabState.runningTotal,
              paidAmount: 0,
              itemCount: tabState.runningCount,
              paymentMethod: '',
              createdAt: localTs,
              updatedAt: localTs,
            });
          } else {
            const idx = nextTabs.findIndex((t) => t.id === tabState.tabId);
            if (idx >= 0) {
              nextTabs[idx] = {
                ...nextTabs[idx],
                status: 'open',
                customerName: tabState.customerName,
                tableLabel: tabState.tableLabel,
                totalAmount: tabState.runningTotal,
                paidAmount: tabState.previousPaid,
                itemCount: tabState.runningCount,
                updatedAt: localTs,
              };
            }
          }
        }
        const nextTabItems = [...newLocalTabItems, ...tabItems];
        setTabs(nextTabs);
        setTabItems(nextTabItems);
        await syncDirectStoreSnapshot({
          tabs: nextTabs,
          tabItems: nextTabItems,
          actionType: 'add',
        });
      } else {
        const batch = writeBatch(db);
        for (const newItem of newLocalTabItems) {
          const itemRef = doc(db, 'tabItems', newItem.id);
          batch.set(itemRef, {
            ownerId: newItem.ownerId,
            tabId: newItem.tabId,
            customerName: newItem.customerName,
            itemName: newItem.itemName,
            category: newItem.category,
            quantity: newItem.quantity,
            unitPrice: newItem.unitPrice,
            totalPrice: newItem.totalPrice,
            source: newItem.source,
            voiceTranscript: newItem.voiceTranscript,
            launchedByName: newItem.launchedByName,
            storeName: newItem.storeName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        for (const tabState of tabsAffectedMap.values()) {
          const tabRef = doc(db, 'tabs', tabState.tabId);
          if (tabState.createdNewTab) {
            batch.set(tabRef, {
              ownerId: user.uid,
              customerName: tabState.customerName,
              tableLabel: tabState.tableLabel,
              status: 'open',
              totalAmount: tabState.runningTotal,
              paidAmount: 0,
              itemCount: tabState.runningCount,
              paymentMethod: '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            batch.update(tabRef, {
              status: 'open',
              customerName: tabState.customerName,
              tableLabel: tabState.tableLabel,
              totalAmount: tabState.runningTotal,
              paidAmount: tabState.previousPaid,
              itemCount: tabState.runningCount,
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
      }

      if (lastTargetTabId) {
        setSelectedTabId(lastTargetTabId);
      }

      const customerNamesList = Array.from(tabsAffectedMap.values())
        .map((t) => t.customerName)
        .join(', ');

      const spokenText =
        tabsAffectedMap.size > 1
          ? `Marcado para ${customerNamesList}! ${perCustomerSpokenParts.join('; ')}.`
          : `Marcado! ${perCustomerSpokenParts[0]}. Total de ${customerNamesList}: ${formatBRL(grandRemainingBalance)}.`;

      setMarceloReport({
        intent: 'MARCAR',
        title: `1. Marcado na Comanda de ${customerNamesList}`,
        spokenSummary: spokenText,
        customerName: customerNamesList,
        stageLabel: STAGE_LABELS.open,
        waiterAttribution: cleanWaiterName,
        itemsSummary: allItemsSummaryLines,
        totalConsumed: grandTotalConsumed,
        totalPaid: grandTotalPaid,
        remainingBalance: grandRemainingBalance,
      });

      setFeedbackBanner({
        type: 'success',
        message: spokenText,
      });
      speakAsMarcelo(spokenText, marceloVoiceReplyEnabled);

      if (isAdmin) {
        setLastUndo({
          description: perCustomerSpokenParts.join(' | '),
          tabsAffected: Array.from(tabsAffectedMap.values()).map((t) => ({
            tabId: t.tabId,
            createdNewTab: t.createdNewTab,
            customerName: t.customerName,
            tableLabel: t.tableLabel,
            previousTotal: t.previousTotal,
            previousPaid: t.previousPaid,
            previousCount: t.previousCount,
            previousStatus: t.previousStatus,
          })),
          addedItemIds,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tabs/tabItems');
    }
  };

  // STAGE 2: FECHAR CONTA / QUANTO FICOU A CONTA (Matches "Thiago" or "Tiago" phonetically!)
  const executeStage2Fechar = async (
    customerQueryName: string,
    waiterNameAttr: string
  ) => {
    if (!user) return;
    const qPhon = normalizePhoneticPt(customerQueryName);
    const matchesCustomer = (t: BarTab) =>
      areCustomerNamesEquivalent(t.customerName, customerQueryName) ||
      (qPhon.length >= 2 && normalizePhoneticPt(t.customerName).includes(qPhon));

    const targetTab =
      activeStageTabs.find((t) => matchesCustomer(t) && t.status !== 'paid') ||
      activeStageTabs.find(matchesCustomer);

    if (!targetTab) {
      const msg = `Não encontrei comanda aberta para "${customerQueryName}".`;
      setFeedbackBanner({ type: 'error', message: msg });
      speakAsMarcelo(msg, marceloVoiceReplyEnabled);
      return;
    }

    const grouped = getConsolidatedItemsForTab(targetTab.id);
    const itemsListStrings = grouped.map(
      (g) => `${g.totalQuantity}x ${g.itemName} (${formatBRL(g.totalSubtotal)})`
    );
    const spokenItems =
      grouped.length > 0
        ? grouped.map((g) => `${g.totalQuantity} ${g.itemName}`).join(', ')
        : 'nenhum item marcado';

    const remaining = getRemainingBalance(targetTab);

    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const nextTabs = tabs.map((t) =>
          t.id === targetTab.id
            ? { ...t, status: 'closing' as TabStageStatus, updatedAt: localTs }
            : t
        );
        setTabs(nextTabs);
        await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'add' });
      } else {
        await updateDoc(doc(db, 'tabs', targetTab.id), {
          status: 'closing',
          totalAmount: targetTab.totalAmount,
          paidAmount: targetTab.paidAmount,
          itemCount: targetTab.itemCount,
          updatedAt: serverTimestamp(),
        });
      }

      setSelectedTabId(targetTab.id);
      setBaixaAmountInput(remaining.toFixed(2));
      setShowBaixaDrawer(true);

      const spokenSummary =
        targetTab.paidAmount > 0
          ? `A conta de ${targetTab.customerName} tem: ${spokenItems}. Total consumido: ${formatBRL(targetTab.totalAmount)}. Já pagou: ${formatBRL(targetTab.paidAmount)}. Falta pagar: ${formatBRL(remaining)}.`
          : `A conta de ${targetTab.customerName} ficou em ${formatBRL(remaining)}. Produtos: ${spokenItems}.`;

      setMarceloReport({
        intent: 'FECHAR',
        title: `2. Conta de ${targetTab.customerName}: ${formatBRL(remaining)}`,
        spokenSummary,
        customerName: targetTab.customerName,
        stageLabel: STAGE_LABELS.closing,
        waiterAttribution: waiterNameAttr,
        itemsSummary: itemsListStrings,
        totalConsumed: targetTab.totalAmount,
        totalPaid: targetTab.paidAmount,
        remainingBalance: remaining,
      });

      setFeedbackBanner({
        type: 'success',
        message: spokenSummary,
      });
      speakAsMarcelo(spokenSummary, marceloVoiceReplyEnabled);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tabs/${targetTab.id}`);
    }
  };

  // STAGE 3: DAR BAIXA NA CONTA (Matches "Thiago" or "Tiago" phonetically!)
  const executeStage3Baixa = async (
    customerQueryName: string,
    customPaymentAmount: number | undefined,
    paymentMethod = 'PIX',
    keepOpenToConsume = false,
    waiterNameAttr: string
  ) => {
    if (!user) return;
    const cleanQuery = customerQueryName
      .trim()
      .replace(/^(?:o|a|os|as|do|da|dos|das|de|no|na|pro|pra|para)\s+/i, '')
      .replace(/[.!,?;:]+$/g, '')
      .trim();
    const qNorm = normalizeText(cleanQuery);
    const qPhon = normalizePhoneticPt(cleanQuery);

    const isCustomerTabMatch = (t: BarTab): boolean => {
      const tabNorm = normalizeText(t.customerName);
      const tabPhon = normalizePhoneticPt(t.customerName);
      if (!tabNorm || !qNorm) return false;
      if (tabNorm === qNorm) return true;
      if (qPhon && tabPhon && tabPhon === qPhon) return true;
      if (areCustomerNamesEquivalent(t.customerName, cleanQuery)) return true;
      if (qPhon.length >= 2 && tabPhon.includes(qPhon)) return true;
      if (qNorm.length >= 2 && tabNorm.includes(qNorm)) return true;
      return false;
    };

    const matchingTabs = activeStageTabs.filter(isCustomerTabMatch);

    console.info('[DarBaixa:Verificacao]', {
      queryOriginal: customerQueryName,
      queryNormalizada: qNorm,
      queryFonetica: qPhon,
      totalComandasAtivas: activeStageTabs.length,
      comandasDisponiveis: activeStageTabs.map((t) => ({
        id: t.id,
        customerName: t.customerName,
        normalizado: normalizeText(t.customerName),
        fonetico: normalizePhoneticPt(t.customerName),
        status: t.status,
        totalAmount: t.totalAmount,
        paidAmount: t.paidAmount,
      })),
      comandasFiltradasCount: matchingTabs.length,
      comandasFiltradasIds: matchingTabs.map((t) => t.id),
    });

    // Prefer exact normalized match with remaining balance, then open/closing tabs, then any match
    const targetTab =
      matchingTabs.find(
        (t) =>
          normalizeText(t.customerName) === qNorm &&
          t.status !== 'paid' &&
          getRemainingBalance(t) > 0
      ) ||
      matchingTabs.find((t) => t.status !== 'paid' && getRemainingBalance(t) > 0) ||
      matchingTabs.find((t) => t.status !== 'paid') ||
      matchingTabs[0];

    if (!targetTab) {
      const archivedMatches = tabs.filter(
        (t) => t.status === 'archived' && isCustomerTabMatch(t)
      );
      console.warn('[DarBaixa:FalhaBusca]', {
        motivo: 'Nenhuma comanda ativa correspondente encontrada.',
        queryOriginal: customerQueryName,
        queryNormalizada: qNorm,
        comandasArquivadasCorrespondentes: archivedMatches.map((t) => ({
          id: t.id,
          customerName: t.customerName,
          status: t.status,
        })),
      });
      const msg = `Não encontrei a comanda de "${customerQueryName}" para dar baixa.`;
      setFeedbackBanner({ type: 'error', message: msg });
      speakAsMarcelo(msg, marceloVoiceReplyEnabled);
      return;
    }

    if (
      targetTab.status === 'paid' &&
      getRemainingBalance(targetTab) <= 0 &&
      (!customPaymentAmount || customPaymentAmount <= 0)
    ) {
      console.info('[DarBaixa:JaPaga]', {
        tabId: targetTab.id,
        customerName: targetTab.customerName,
        status: targetTab.status,
        totalAmount: targetTab.totalAmount,
        paidAmount: targetTab.paidAmount,
      });
      setSelectedTabId(targetTab.id);
      const alreadyPaidMsg = `A conta de ${targetTab.customerName} já está paga e zerada (${formatBRL(targetTab.totalAmount)}).`;
      setFeedbackBanner({ type: 'success', message: alreadyPaidMsg });
      speakAsMarcelo(alreadyPaidMsg, marceloVoiceReplyEnabled);
      return;
    }

    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();

    const currentRemaining = getRemainingBalance(targetTab);
    const amountBeingPaid =
      customPaymentAmount && customPaymentAmount > 0
        ? Math.min(customPaymentAmount, VALIDATION_LIMITS.MAX_TOTAL)
        : currentRemaining > 0
          ? currentRemaining
          : targetTab.totalAmount;

    const nextPaidAmount =
      currentRemaining > 0
        ? Math.min(
            Number((targetTab.paidAmount + amountBeingPaid).toFixed(2)),
            VALIDATION_LIMITS.MAX_TOTAL
          )
        : targetTab.totalAmount;

    const nextRemaining = Math.max(
      0,
      Number((targetTab.totalAmount - nextPaidAmount).toFixed(2))
    );

    const nextStatus: TabStageStatus =
      nextRemaining > 0 || keepOpenToConsume ? 'open' : 'paid';

    console.info('[DarBaixa:AtualizandoTab]', {
      tabId: targetTab.id,
      customerName: targetTab.customerName,
      statusAnterior: targetTab.status,
      statusNovo: nextStatus,
      paidAmountNovo: nextPaidAmount,
      remainingNovo: nextRemaining,
      modo: isDirectSession ? 'directSession' : 'firestore',
    });

    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const nextTabs = tabs.map((t) =>
          t.id === targetTab.id
            ? {
                ...t,
                status: nextStatus,
                paidAmount: nextPaidAmount,
                paymentMethod: sanitizeString(paymentMethod, 40, 'PIX'),
                updatedAt: localTs,
              }
            : t
        );
        setTabs(nextTabs);
        await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'add' });
      } else {
        await updateDoc(doc(db, 'tabs', targetTab.id), {
          status: nextStatus,
          paidAmount: nextPaidAmount,
          paymentMethod: sanitizeString(paymentMethod, 40, 'PIX'),
          totalAmount: targetTab.totalAmount,
          itemCount: targetTab.itemCount,
          updatedAt: serverTimestamp(),
        });
      }

      if (stageFilter === 'open' || stageFilter === 'closing') {
        setStageFilter('all');
      }
      setSelectedTabId(targetTab.id);
      setShowBaixaDrawer(false);

      const grouped = getConsolidatedItemsForTab(targetTab.id);
      const itemsListStrings = grouped.map(
        (g) => `${g.totalQuantity}x ${g.itemName} (${formatBRL(g.totalSubtotal)})`
      );

      const spokenSummary =
        nextStatus === 'open'
          ? `Baixa parcial de ${formatBRL(amountBeingPaid)} registrada na conta de ${targetTab.customerName}. Falta pagar: ${formatBRL(nextRemaining)}.`
          : `Baixa realizada com sucesso! A conta de ${targetTab.customerName} (${formatBRL(targetTab.totalAmount)}) foi paga e zerada.`;

      setMarceloReport({
        intent: 'BAIXA',
        title: `3. Baixa na Conta de ${targetTab.customerName}`,
        spokenSummary,
        customerName: targetTab.customerName,
        stageLabel: STAGE_LABELS[nextStatus],
        waiterAttribution: waiterNameAttr,
        itemsSummary: itemsListStrings,
        totalConsumed: targetTab.totalAmount,
        totalPaid: nextPaidAmount,
        remainingBalance: nextRemaining,
      });

      setFeedbackBanner({
        type: 'success',
        message: spokenSummary,
      });
      speakAsMarcelo(spokenSummary, marceloVoiceReplyEnabled);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tabs/${targetTab.id}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // Archive / Close Paid Tab (removes from active list when customer leaves)
  const handleArchivePaidTab = async (tab: BarTab) => {
    if (!user || !isAdmin) return;
    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();
    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const nextTabs = tabs.map((t) =>
          t.id === tab.id ? { ...t, status: 'archived' as TabStageStatus, updatedAt: localTs } : t
        );
        setTabs(nextTabs);
        await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'remove' });
      } else {
        await updateDoc(doc(db, 'tabs', tab.id), {
          status: 'archived',
          updatedAt: serverTimestamp(),
        });
      }
      setFeedbackBanner({
        type: 'success',
        message: `Comanda de ${tab.customerName} encerrada e arquivada.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tabs/${tab.id}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // Master Command Dispatcher for Virtual Assistant "MARCELO"
  const processOrderPhrase = async (
    phrase: string,
    sourceType: 'voz' | 'manual'
  ) => {
    const cleanPhrase = phrase.trim();
    if (!cleanPhrase || !user) return;

    const waiterAttr = activeWaiterDisplay.name;
    const storeAttr = activeWaiterDisplay.storeName;

    setIsProcessingCommand(true);
    setFeedbackBanner(null);

    try {
      // 1. Run local phonetic & multi-customer parser first
      const localStrict = parseVoiceOrderLocally(
        cleanPhrase,
        menuItems,
        activeStageTabs.map((t) => t.customerName),
        selectedTab?.customerName
      );

      let finalParsed: ParsedVoiceOrder = localStrict;

      const isExplicitAmbiguityAbort =
        !localStrict.understood &&
        /^(?:Ficou ambíguo|Você disse duas opções)/i.test(localStrict.unrecognizedReason || '');

      // 2. Fallback to Gemini on server if phrase has complex natural wording (but never override explicit ambiguity aborts)
      if (!localStrict.understood && !isExplicitAmbiguityAbort) {
        const response = await fetch('/api/parse-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: cleanPhrase,
            catalog: menuItems.map((m) => ({
              id: m.id,
              name: m.name,
              category: m.category,
              price: m.price,
              synonyms: m.synonyms,
            })),
            existingCustomers: activeStageTabs.map((t) => t.customerName),
          }),
        });

        if (response.ok) {
          const geminiParsed = (await response.json()) as ParsedVoiceOrder;
          if (geminiParsed && typeof geminiParsed.understood === 'boolean') {
            finalParsed = geminiParsed;
          }
        }
      }

      if (
        !finalParsed.understood ||
        !Array.isArray(finalParsed.commands) ||
        finalParsed.commands.length === 0
      ) {
        const reason =
          finalParsed.unrecognizedReason ||
          'Não compreendi o produto ou o nome do cliente.';
        setMarceloReport(null);
        setFeedbackBanner({
          type: 'error',
          message: reason,
        });
        speakAsMarcelo(
          isExplicitAmbiguityAbort
            ? reason
            : 'Não entendi com segurança. Nada foi marcado. Por favor, repita.',
          marceloVoiceReplyEnabled
        );
        return;
      }

      for (const cmd of finalParsed.commands) {
        if (!cmd.customerName || cmd.customerName.trim().length < 2) {
          const abortMsg = 'Faltou dizer o nome do cliente.';
          setMarceloReport(null);
          setFeedbackBanner({ type: 'error', message: abortMsg });
          speakAsMarcelo(abortMsg, marceloVoiceReplyEnabled);
          return;
        }
        if (cmd.intent === 'MARCAR' && (!cmd.items || cmd.items.length === 0)) {
          const abortMsg = `Não identifiquei o produto para ${cmd.customerName}.`;
          setMarceloReport(null);
          setFeedbackBanner({ type: 'error', message: abortMsg });
          speakAsMarcelo(abortMsg, marceloVoiceReplyEnabled);
          return;
        }
      }

      const marcarCmds = finalParsed.commands.filter((c) => c.intent === 'MARCAR');
      const fecharCmds = finalParsed.commands.filter((c) => c.intent === 'FECHAR');
      const baixaCmds = finalParsed.commands.filter((c) => c.intent === 'BAIXA');

      if (marcarCmds.length > 0) {
        await executeMultiCustomerStage1Marcar(
          marcarCmds,
          cleanPhrase,
          sourceType,
          waiterAttr,
          storeAttr
        );
      }

      for (const fCmd of fecharCmds) {
        await executeStage2Fechar(fCmd.customerName, waiterAttr);
      }

      for (const bCmd of baixaCmds) {
        await executeStage3Baixa(
          bCmd.customerName,
          bCmd.paymentAmount && bCmd.paymentAmount > 0 ? bCmd.paymentAmount : undefined,
          bCmd.paymentMethod || 'PIX',
          Boolean(bCmd.keepConsuming),
          waiterAttr
        );
      }

      setCommandInput('');
    } catch {
      setFeedbackBanner({
        type: 'error',
        message: 'Não foi possível validar o comando. Nenhuma comanda foi alterada.',
      });
    } finally {
      setIsProcessingCommand(false);
    }
  };

  // Start / Stop Web Speech API Microphone Recognition
  const toggleVoiceRecognition = async () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setFeedbackBanner({
        type: 'error',
        message:
          'Seu navegador não suporta microfone nativo. Use o Chrome ou digite o comando no campo ao lado.',
      });
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.results.length - 1; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const finalPhrase = res[0].transcript.trim();
          setInterimTranscript('');
          if (finalPhrase) {
            processOrderPhrase(finalPhrase, 'voz');
          }
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'no-speech') {
        setFeedbackBanner({
          type: 'error',
          message: `Permissão de microfone (${event.error}): verifique o áudio do navegador.`,
        });
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setInterimTranscript('');
    setIsListening(true);
    recognition.start();
  };

  // Save Logged-In ADM & Comércio Profile
  const handleSaveUserProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin || !profileUserName.trim() || !profileStoreName.trim()) return;
    setSavingProfile(true);
    try {
      const cleanName = sanitizeString(profileUserName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN);
      const cleanRole: UserRoleType = VALIDATION_LIMITS.VALID_ROLES.includes(profileUserRole)
        ? profileUserRole
        : 'ADM';
      const cleanStore = sanitizeString(profileStoreName, VALIDATION_LIMITS.STORE_NAME_MAX_LEN);
      const cleanCode = sanitizeStoreCode(profileStoreCode, 'BAR-01');

      if (isDirectSession) {
        const nextSession: DirectBarSession = {
          uid: directSession?.uid || `adm_${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          email: directSession?.email || '',
          userName: cleanName,
          userRole: cleanRole,
          storeName: cleanStore,
          storeCode: cleanCode,
        };
        try {
          localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
        } catch {
          // ignore
        }
        setDirectSession(nextSession);
        setUserProfile({
          id: nextSession.uid,
          ownerId: nextSession.uid,
          email: nextSession.email,
          userName: cleanName,
          userRole: cleanRole,
          storeName: cleanStore,
          storeCode: cleanCode,
          createdAt: userProfile?.createdAt || makeLocalTimestamp(),
          updatedAt: makeLocalTimestamp(),
        });
        await syncDirectStoreSnapshot({
          storeCode: cleanCode,
          storeName: cleanStore,
          actionType: 'add',
        });
      } else {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          ownerId: user.uid,
          userName: cleanName,
          userRole: cleanRole,
          storeName: cleanStore,
          storeCode: cleanCode,
          createdAt: userProfile?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setFeedbackBanner({
        type: 'success',
        message: `Dados do bar (${cleanStore}) atualizados!`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `userProfiles/${user.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  // ADM Registers a New Waiter (Garçom) with Email & Password
  const handleSaveTrainedOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;

    const cleanName = sanitizeString(newOpName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN);
    const cleanEmail = newOpEmail.trim().toLowerCase();
    const cleanPass = newOpPassword.trim();

    if (!cleanName || !cleanEmail.includes('@') || cleanPass.length < 4) {
      setFeedbackBanner({
        type: 'error',
        message: 'Preencha o nome do garçom, e-mail e senha (mínimo 4 caracteres).',
      });
      return;
    }

    setRegisteringWaiter(true);
    try {
      const apiRes = await fetch('/api/auth/register-waiter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: 'ADM',
          operatorName: cleanName,
          email: cleanEmail,
          password: cleanPass,
          storeName: currentStoreName,
          storeCode: currentStoreCode,
          pitchHz: 145,
          spectralCentroid: 1850,
          voicePin: '',
          samplesCount: 1,
        }),
      });

      const apiData = (await apiRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        operator?: VoiceOperator;
        waiterAccount?: VoiceOperator;
      };

      if (!apiRes.ok && apiData.error) {
        setFeedbackBanner({ type: 'error', message: apiData.error });
        setRegisteringWaiter(false);
        return;
      }

      const returnedOp = apiData.operator || apiData.waiterAccount;
      const opId =
        returnedOp?.id || `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const opPayload: VoiceOperator = {
        id: opId,
        ownerId: user.uid,
        operatorName: cleanName,
        email: cleanEmail,
        roleLabel: 'Garçom',
        storeName: currentStoreName,
        storeCode: currentStoreCode,
        pitchHz: 145,
        spectralCentroid: 1850,
        voicePin: '',
        samplesCount: 1,
        createdAt: makeLocalTimestamp(),
        updatedAt: makeLocalTimestamp(),
      };

      saveAccountToLocalBackup({
        uid: opId,
        email: cleanEmail,
        passwordPlainOrHash: cleanPass,
        userName: cleanName,
        userRole: 'Garçom',
        storeName: currentStoreName,
        storeCode: currentStoreCode,
      });

      const nextOps = [
        ...voiceOperators.filter((op) => (op.email || '').toLowerCase() !== cleanEmail),
        opPayload,
      ];
      setVoiceOperators(nextOps);

      if (isDirectSession) {
        await syncDirectStoreSnapshot({ voiceOperators: nextOps, actionType: 'add' });
      } else {
        await setDoc(doc(db, 'voiceOperators', opId), {
          ownerId: opPayload.ownerId,
          operatorName: opPayload.operatorName,
          roleLabel: opPayload.roleLabel,
          storeName: opPayload.storeName,
          storeCode: opPayload.storeCode,
          pitchHz: opPayload.pitchHz,
          spectralCentroid: opPayload.spectralCentroid,
          voicePin: opPayload.voicePin,
          samplesCount: opPayload.samplesCount,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setNewOpName('');
      setNewOpEmail('');
      setNewOpPassword('');

      setFeedbackBanner({
        type: 'success',
        message: `Garçom ${cleanName} (${cleanEmail}) cadastrado! Ele já pode entrar com e-mail e senha.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'voiceOperators');
    } finally {
      setRegisteringWaiter(false);
    }
  };

  // Delete Waiter Operator (STRICTLY ADM ONLY)
  const handleDeleteOperator = async (opId: string) => {
    if (!user || !isAdmin) return;
    const targetOp = voiceOperators.find((op) => op.id === opId);
    try {
      const nextOps = voiceOperators.filter((op) => op.id !== opId);
      setVoiceOperators(nextOps);
      if (targetOp?.email) {
        removeAccountFromLocalBackup(targetOp.email);
      }

      if (isDirectSession) {
        await syncDirectStoreSnapshot({ voiceOperators: nextOps, actionType: 'remove' });
      } else {
        await deleteDoc(doc(db, 'voiceOperators', opId));
      }
      setFeedbackBanner({
        type: 'success',
        message: `Garçom ${targetOp?.operatorName || ''} removido pelo ADM.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `voiceOperators/${opId}`);
    }
  };

  // Undo last launch (STRICTLY ADM ONLY)
  const handleUndoLastLaunch = async () => {
    if (!lastUndo || !user || !isAdmin) return;
    const undoInfo = lastUndo;
    setLastUndo(null);

    try {
      if (isDirectSession) {
        const nextTabItems = tabItems.filter((i) => !undoInfo.addedItemIds.includes(i.id));
        let nextTabs = [...tabs];
        const localTs = makeLocalTimestamp();
        for (const tSnap of undoInfo.tabsAffected) {
          if (tSnap.createdNewTab) {
            nextTabs = nextTabs.filter((t) => t.id !== tSnap.tabId);
          } else {
            nextTabs = nextTabs.map((t) =>
              t.id === tSnap.tabId
                ? {
                    ...t,
                    status: tSnap.previousStatus,
                    customerName: tSnap.customerName,
                    tableLabel: tSnap.tableLabel,
                    totalAmount: Math.max(0, tSnap.previousTotal),
                    paidAmount: Math.max(0, tSnap.previousPaid),
                    itemCount: Math.max(0, tSnap.previousCount),
                    updatedAt: localTs,
                  }
                : t
            );
          }
        }
        setTabs(nextTabs);
        setTabItems(nextTabItems);
        await syncDirectStoreSnapshot({
          tabs: nextTabs,
          tabItems: nextTabItems,
          actionType: 'remove',
        });
      } else {
        const batch = writeBatch(db);
        for (const itemId of undoInfo.addedItemIds) {
          batch.delete(doc(db, 'tabItems', itemId));
        }
        for (const tSnap of undoInfo.tabsAffected) {
          const tabRef = doc(db, 'tabs', tSnap.tabId);
          if (tSnap.createdNewTab) {
            batch.delete(tabRef);
          } else {
            batch.update(tabRef, {
              status: tSnap.previousStatus,
              customerName: tSnap.customerName,
              tableLabel: tSnap.tableLabel,
              totalAmount: Math.max(0, tSnap.previousTotal),
              paidAmount: Math.max(0, tSnap.previousPaid),
              itemCount: Math.max(0, tSnap.previousCount),
              updatedAt: serverTimestamp(),
            });
          }
        }
        await batch.commit();
      }
      setMarceloReport(null);
      setFeedbackBanner({
        type: 'success',
        message: `Lançamento desfeito: ${undoInfo.description}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tabItems');
    }
  };

  // Quick 1-Tap Add Menu Item to Selected Tab
  const handleQuickAddMenuItem = async (menuItem: MenuItem) => {
    if (!user || !selectedTab) return;

    const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTotal = Math.min(
      Number((selectedTab.totalAmount + menuItem.price).toFixed(2)),
      VALIDATION_LIMITS.MAX_TOTAL
    );
    const newCount = Math.min(selectedTab.itemCount + 1, 10000);
    const waiterAttr = sanitizeString(
      activeWaiterDisplay.name,
      VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
      'Garçom'
    );
    const storeAttr = sanitizeString(
      activeWaiterDisplay.storeName,
      VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
      'Bar Central'
    );

    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const newEntry: TabItem = {
          id: itemId,
          ownerId: user.uid,
          tabId: selectedTab.id,
          customerName: selectedTab.customerName,
          itemName: menuItem.name,
          category: menuItem.category,
          quantity: 1,
          unitPrice: menuItem.price,
          totalPrice: menuItem.price,
          source: 'rapido',
          voiceTranscript: `+1 ${menuItem.name}`,
          launchedByName: waiterAttr,
          storeName: storeAttr,
          createdAt: localTs,
          updatedAt: localTs,
        };
        const nextTabItems = [newEntry, ...tabItems];
        const nextTabs = tabs.map((t) =>
          t.id === selectedTab.id
            ? {
                ...t,
                status: 'open' as TabStageStatus,
                totalAmount: newTotal,
                itemCount: newCount,
                updatedAt: localTs,
              }
            : t
        );
        setTabs(nextTabs);
        setTabItems(nextTabItems);
        await syncDirectStoreSnapshot({
          tabs: nextTabs,
          tabItems: nextTabItems,
          actionType: 'add',
        });
      } else {
        const batch = writeBatch(db);
        batch.set(doc(db, 'tabItems', itemId), {
          ownerId: user.uid,
          tabId: selectedTab.id,
          customerName: selectedTab.customerName,
          itemName: menuItem.name,
          category: menuItem.category,
          quantity: 1,
          unitPrice: menuItem.price,
          totalPrice: menuItem.price,
          source: 'rapido',
          voiceTranscript: `+1 ${menuItem.name}`,
          launchedByName: waiterAttr,
          storeName: storeAttr,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.update(doc(db, 'tabs', selectedTab.id), {
          status: 'open',
          customerName: selectedTab.customerName,
          tableLabel: selectedTab.tableLabel,
          totalAmount: newTotal,
          paidAmount: selectedTab.paidAmount,
          itemCount: newCount,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
      }
      setFeedbackBanner({
        type: 'success',
        message: `+1 ${menuItem.name} adicionado na conta de ${selectedTab.customerName}.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tabItems');
    }
  };

  // Adjust quantity or delete an individual TabItem entry
  // STRICT RULE: Garçom can ONLY add (delta > 0). Only ADM can decrease or delete (delta < 0).
  const handleAdjustTabItemQty = async (item: TabItem, delta: number) => {
    if (!user) return;
    if (delta < 0 && !isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Somente o ADM pode remover itens da comanda.',
      });
      return;
    }

    const parentTab = activeStageTabs.find((t) => t.id === item.tabId);
    if (!parentTab) return;

    const nextQty = item.quantity + delta;
    const priceDiff = Number((delta * item.unitPrice).toFixed(2));
    const nextTabTotal = Math.max(0, Number((parentTab.totalAmount + priceDiff).toFixed(2)));
    const nextTabCount = Math.max(0, parentTab.itemCount + delta);

    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const nextTabItems =
          nextQty <= 0
            ? tabItems.filter((i) => i.id !== item.id)
            : tabItems.map((i) =>
                i.id === item.id
                  ? {
                      ...i,
                      quantity: Math.min(nextQty, VALIDATION_LIMITS.MAX_QTY),
                      totalPrice: Number((nextQty * item.unitPrice).toFixed(2)),
                      updatedAt: localTs,
                    }
                  : i
              );
        const nextTabs = tabs.map((t) =>
          t.id === parentTab.id
            ? {
                ...t,
                status:
                  parentTab.status === 'paid' && nextTabTotal > parentTab.paidAmount
                    ? ('open' as TabStageStatus)
                    : parentTab.status,
                totalAmount: nextTabTotal,
                itemCount: nextTabCount,
                updatedAt: localTs,
              }
            : t
        );
        setTabs(nextTabs);
        setTabItems(nextTabItems);
        await syncDirectStoreSnapshot({
          tabs: nextTabs,
          tabItems: nextTabItems,
          actionType: delta < 0 ? 'remove' : 'add',
        });
      } else {
        const batch = writeBatch(db);
        const itemRef = doc(db, 'tabItems', item.id);
        const tabRef = doc(db, 'tabs', parentTab.id);

        if (nextQty <= 0) {
          batch.delete(itemRef);
        } else {
          batch.update(itemRef, {
            quantity: Math.min(nextQty, VALIDATION_LIMITS.MAX_QTY),
            totalPrice: Number((nextQty * item.unitPrice).toFixed(2)),
            updatedAt: serverTimestamp(),
          });
        }

        batch.update(tabRef, {
          status:
            parentTab.status === 'paid' && nextTabTotal > parentTab.paidAmount
              ? 'open'
              : parentTab.status,
          customerName: parentTab.customerName,
          tableLabel: parentTab.tableLabel,
          totalAmount: nextTabTotal,
          paidAmount: parentTab.paidAmount,
          itemCount: nextTabCount,
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tabItems/${item.id}`);
    }
  };

  // Create a new Open Comanda manually (Matches phonetically so "Tiago" and "Thiago" don't duplicate)
  const handleCreateManualTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newCustomerName.trim()) return;

    const cleanName = sanitizeString(newCustomerName, VALIDATION_LIMITS.NAME_MAX_LEN);
    const cleanTable = sanitizeString(newTableLabel, VALIDATION_LIMITS.TABLE_MAX_LEN);
    const existing = activeStageTabs.find((t) =>
      areCustomerNamesEquivalent(t.customerName, cleanName)
    );
    if (existing) {
      setSelectedTabId(existing.id);
      setShowNewTabForm(false);
      setNewCustomerName('');
      setNewTableLabel('');
      return;
    }

    const tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      if (isDirectSession) {
        const localTs = makeLocalTimestamp();
        const newTabObj: BarTab = {
          id: tabId,
          ownerId: user.uid,
          customerName: cleanName,
          tableLabel: cleanTable,
          status: 'open',
          totalAmount: 0,
          paidAmount: 0,
          itemCount: 0,
          paymentMethod: '',
          createdAt: localTs,
          updatedAt: localTs,
        };
        const nextTabs = [newTabObj, ...tabs];
        setTabs(nextTabs);
        await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'add' });
      } else {
        await setDoc(doc(db, 'tabs', tabId), {
          ownerId: user.uid,
          customerName: cleanName,
          tableLabel: cleanTable,
          status: 'open',
          totalAmount: 0,
          paidAmount: 0,
          itemCount: 0,
          paymentMethod: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setSelectedTabId(tabId);
      setNewCustomerName('');
      setNewTableLabel('');
      setShowNewTabForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tabs/${tabId}`);
    }
  };

  // Copy Formatted Audit Receipt for WhatsApp / Thermal Printer
  const handleCopyAuditReceipt = (tab: BarTab) => {
    const remaining = getRemainingBalance(tab);
    const lines: string[] = [
      `${currentStoreName.toUpperCase()}`,
      `CONTA DE: ${tab.customerName}${tab.tableLabel ? ` (${tab.tableLabel})` : ''}`,
      `--------------------------------`,
    ];

    for (const group of consolidatedSelectedItems) {
      lines.push(
        `${group.totalQuantity}x ${group.itemName} = ${formatBRL(group.totalSubtotal)}`
      );
    }

    lines.push(`--------------------------------`);
    lines.push(`TOTAL CONSUMIDO: ${formatBRL(tab.totalAmount)}`);
    if (tab.paidAmount > 0) {
      lines.push(`JÁ PAGO: ${formatBRL(tab.paidAmount)}`);
    }
    lines.push(`VALOR A PAGAR: ${formatBRL(remaining)}`);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 2500);
  };

  // CARDÁPIO CRUD: Add or Edit Product in Bar Menu Catalog (ADM ONLY)
  const handleAddOrUpdateMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) return;

    const trimmedName = newMenuName.trim();
    const cleanedPriceStr = newMenuPrice.replace(/[R$\s]/g, '').replace(',', '.');
    const priceNum = parseFloat(cleanedPriceStr);

    if (!trimmedName || Number.isNaN(priceNum) || priceNum < 0) {
      setFeedbackBanner({
        type: 'error',
        message: 'Informe o nome do produto e o preço (ex: 18,00).',
      });
      return;
    }

    setSavingMenu(true);
    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();

    const menuId =
      editingMenuId || `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      const cleanName = sanitizeString(trimmedName, VALIDATION_LIMITS.NAME_MAX_LEN);
      const cleanCat = sanitizeCategory(newMenuCategory);
      const cleanPrice = Math.min(Number(priceNum.toFixed(2)), VALIDATION_LIMITS.MAX_PRICE);
      const cleanSyn = sanitizeString(
        newMenuSynonyms.trim() || cleanName.toLowerCase(),
        VALIDATION_LIMITS.SYNONYMS_MAX_LEN
      );
      const localTs = makeLocalTimestamp();

      const updatedItemObj: MenuItem = {
        id: menuId,
        ownerId: user.uid,
        name: cleanName,
        category: cleanCat,
        price: cleanPrice,
        synonyms: cleanSyn,
        createdAt: localTs,
        updatedAt: localTs,
      };

      const nextMenu = [
        ...menuItems.filter((m) => m.id !== menuId),
        updatedItemObj,
      ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

      setMenuItems(nextMenu);

      if (isDirectSession) {
        await syncDirectStoreSnapshot({
          menuItems: nextMenu,
          actionType: 'catalog',
        });
      } else {
        localStorage.setItem(`comanda_voz_fb_menu_seeded_${user.uid}`, 'true');
        if (editingMenuId) {
          await updateDoc(doc(db, 'menuItems', menuId), {
            name: cleanName,
            category: cleanCat,
            price: cleanPrice,
            synonyms: cleanSyn,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'menuItems', menuId), {
            ownerId: user.uid,
            name: cleanName,
            category: cleanCat,
            price: cleanPrice,
            synonyms: cleanSyn,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      const actionWord = editingMenuId ? 'atualizado' : 'cadastrado';
      setEditingMenuId(null);
      setNewMenuName('');
      setNewMenuPrice('');
      setNewMenuSynonyms('');
      setFeedbackBanner({
        type: 'success',
        message: `Produto "${cleanName}" (${formatBRL(cleanPrice)}) ${actionWord} no cardápio!`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `menuItems/${menuId}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
      setSavingMenu(false);
    }
  };

  const handleStartEditMenuItem = (item: MenuItem) => {
    if (!isAdmin) return;
    setEditingMenuId(item.id);
    setNewMenuName(item.name);
    setNewMenuCategory(item.category);
    setNewMenuPrice(item.price.toFixed(2).replace('.', ','));
    setNewMenuSynonyms(item.synonyms || '');
  };

  const handleDeleteMenuItem = async (menuId: string) => {
    if (!user || !isAdmin) return;

    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();

    const targetItem = menuItems.find((m) => m.id === menuId);
    const nextMenu = menuItems.filter((m) => m.id !== menuId);

    setMenuItems(nextMenu);
    if (editingMenuId === menuId) {
      setEditingMenuId(null);
      setNewMenuName('');
      setNewMenuPrice('');
      setNewMenuSynonyms('');
    }

    try {
      if (isDirectSession) {
        await syncDirectStoreSnapshot({
          menuItems: nextMenu,
          actionType: 'remove',
        });
      } else {
        localStorage.setItem(`comanda_voz_fb_menu_seeded_${user.uid}`, 'true');
        await deleteDoc(doc(db, 'menuItems', menuId));
      }
      setFeedbackBanner({
        type: 'success',
        message: `Produto "${targetItem?.name || 'Item'}" removido do cardápio.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `menuItems/${menuId}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  const handleClearAllMenuItems = async () => {
    if (!user || !isAdmin || menuItems.length === 0) return;

    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();
    const oldItems = [...menuItems];
    setMenuItems([]);

    try {
      if (isDirectSession) {
        await syncDirectStoreSnapshot({
          menuItems: [],
          actionType: 'remove',
        });
      } else {
        localStorage.setItem(`comanda_voz_fb_menu_seeded_${user.uid}`, 'true');
        const batch = writeBatch(db);
        for (const item of oldItems) {
          batch.delete(doc(db, 'menuItems', item.id));
        }
        await batch.commit();
      }
      setFeedbackBanner({
        type: 'success',
        message: 'Cardápio limpo! Agora você pode cadastrar seus produtos.',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'menuItems');
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  const handleRestoreDefaultMenu = async () => {
    if (!user || !isAdmin) return;

    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();
    const nowTs = makeLocalTimestamp();
    const code = currentStoreCode.toLowerCase();

    const restored: MenuItem[] = DEFAULT_BAR_MENU.map((seed) => ({
      id: `${seed.id}_${code}_${Date.now().toString(36).slice(-3)}`,
      ownerId: user.uid,
      name: sanitizeString(seed.name, VALIDATION_LIMITS.NAME_MAX_LEN),
      category: sanitizeCategory(seed.category),
      price: Math.min(Math.max(seed.price, 0), VALIDATION_LIMITS.MAX_PRICE),
      synonyms: sanitizeString(seed.synonyms, VALIDATION_LIMITS.SYNONYMS_MAX_LEN),
      createdAt: nowTs,
      updatedAt: nowTs,
    })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    setMenuItems(restored);

    try {
      if (isDirectSession) {
        await syncDirectStoreSnapshot({
          menuItems: restored,
          actionType: 'catalog',
        });
      } else {
        localStorage.setItem(`comanda_voz_fb_menu_seeded_${user.uid}`, 'true');
        const batch = writeBatch(db);
        for (const item of restored) {
          batch.set(doc(db, 'menuItems', item.id), {
            ownerId: user.uid,
            name: item.name,
            category: item.category,
            price: item.price,
            synonyms: item.synonyms,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      setFeedbackBanner({
        type: 'success',
        message: 'Cardápio padrão restaurado!',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'menuItems');
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // SUPERADMIN: Load Overview of all Accounts & Stores
  const fetchSuperAdminOverview = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await fetch('/api/superadmin/overview');
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          masterRecoveryKey?: string;
          accounts?: SuperAdminAccountSummary[];
          stores?: SuperAdminStoreSummary[];
        };
        if (data.ok) {
          if (data.masterRecoveryKey) setMasterRecoveryKeyState(data.masterRecoveryKey);
          setSuperAccounts(Array.isArray(data.accounts) ? data.accounts : []);
          setSuperStores(Array.isArray(data.stores) ? data.stores : []);
        }
      }
    } catch {
      // ignore network error
    }
  };

  useEffect(() => {
    if (isSuperAdmin && activeSection === 'superadmin') {
      fetchSuperAdminOverview();
    }
  }, [isSuperAdmin, activeSection, tabs, menuItems, voiceOperators]);

  const handleSuperAdminSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSaSaving(true);
    try {
      const res = await fetch('/api/superadmin/save-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: 'SUPERADMIN',
          email: saUserEmail.trim(),
          newPassword: saUserPassword.trim() || undefined,
          userName: saUserName.trim(),
          userRole: saUserRole,
          storeName: saStoreName.trim(),
          storeCode: saStoreCode.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        account?: SuperAdminAccountSummary;
      };
      if (!res.ok || !data.ok) {
        setFeedbackBanner({
          type: 'error',
          message: data.error || 'Erro ao salvar conta.',
        });
        return;
      }
      if (data.account && saUserPassword.trim()) {
        saveAccountToLocalBackup({
          uid: data.account.uid,
          email: data.account.email,
          passwordPlainOrHash: saUserPassword.trim(),
          userName: data.account.userName,
          userRole: data.account.userRole,
          storeName: data.account.storeName,
          storeCode: data.account.storeCode,
        });
      }
      setSaUserEmail('');
      setSaUserName('');
      setSaUserPassword('');
      await fetchSuperAdminOverview();
      setFeedbackBanner({
        type: 'success',
        message: 'Conta salva/atualizada com sucesso pelo SUPERADMIN!',
      });
    } finally {
      setSaSaving(false);
    }
  };

  const handleQuickResetUserPassword = async (targetEmail: string, targetName: string) => {
    if (!isAdmin || !inlineNewPassword.trim() || inlineNewPassword.trim().length < 4) {
      setFeedbackBanner({
        type: 'error',
        message: 'Informe uma nova senha de pelo menos 4 caracteres.',
      });
      return;
    }
    try {
      const res = await fetch('/api/superadmin/save-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: isSuperAdmin ? 'SUPERADMIN' : 'ADM',
          email: targetEmail,
          newPassword: inlineNewPassword.trim(),
          userName: targetName,
        }),
      });
      if (res.ok) {
        setResettingAccountEmail(null);
        setInlineNewPassword('');
        if (isSuperAdmin) await fetchSuperAdminOverview();
        setFeedbackBanner({
          type: 'success',
          message: `Nova senha definida para ${targetName} (${targetEmail})!`,
        });
      }
    } catch {
      setFeedbackBanner({
        type: 'error',
        message: 'Erro ao redefinir a senha do usuário.',
      });
    }
  };

  const handleSuperAdminDeleteAccount = async (targetEmail: string) => {
    if (!isSuperAdmin) return;
    try {
      const res = await fetch('/api/superadmin/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerRole: 'SUPERADMIN', email: targetEmail }),
      });
      if (res.ok) {
        removeAccountFromLocalBackup(targetEmail);
        await fetchSuperAdminOverview();
        setFeedbackBanner({
          type: 'success',
          message: `Conta ${targetEmail} removida pelo SUPERADMIN.`,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleSuperAdminSwitchStore = (targetCode: string, targetName: string) => {
    if (!isSuperAdmin || !directSession) return;
    const nextSession: DirectBarSession = {
      ...directSession,
      storeCode: sanitizeStoreCode(targetCode),
      storeName: sanitizeString(targetName, VALIDATION_LIMITS.STORE_NAME_MAX_LEN, 'Bar Central'),
    };
    localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    setDirectSession(nextSession);
    setActiveSection('comandas');
    setFeedbackBanner({
      type: 'success',
      message: `SUPERADMIN agora controlando o bar: ${nextSession.storeName} (${nextSession.storeCode})`,
    });
  };

  const handleSuperAdminStoreAction = async (
    action: 'clear_tabs' | 'delete_store' | 'update_master_key',
    storeCode?: string
  ) => {
    if (!isSuperAdmin) return;
    try {
      const res = await fetch('/api/superadmin/store-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: 'SUPERADMIN',
          action,
          storeCode,
          newMasterKey: masterRecoveryKeyState,
        }),
      });
      if (res.ok) {
        await fetchSuperAdminOverview();
        if (action === 'clear_tabs' && storeCode === currentStoreCode) {
          setTabs([]);
          setTabItems([]);
        }
        setFeedbackBanner({
          type: 'success',
          message:
            action === 'update_master_key'
              ? `Chave Mestre atualizada para "${masterRecoveryKeyState}"!`
              : action === 'clear_tabs'
                ? `Comandas do bar ${storeCode} zeradas pelo SUPERADMIN.`
                : `Bar ${storeCode} removido.`,
        });
      }
    } catch {
      // ignore
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-sm text-slate-400">Carregando Comanda Voz...</div>
      </div>
    );
  }

  // LOGIN SCREEN (CLEAN & SIMPLE WITH PASSWORD RECOVERY + SUPERADMIN)
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 max-w-[1200px] w-full mx-auto">
          <span className="text-lg font-bold tracking-tight text-slate-100">
            Comanda Voz · Marcelo
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setAuthTab('recover_password');
                setAuthFormError(null);
              }}
              className="px-3 py-2 text-xs font-medium text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
            >
              Recuperar Senha
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('register_adm');
                setAuthFormError(null);
              }}
              className="px-3.5 py-2 text-xs font-semibold bg-slate-800 text-amber-400 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Criar Conta ADM
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('login');
                setAuthFormError(null);
              }}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Entrar
            </button>
          </div>
        </header>

        <main className="max-w-[1100px] w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 space-y-5">
            <h1
              className="text-3xl sm:text-4xl font-bold text-slate-50 tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Marque, consulte e dê baixa nas comandas falando com o Marcelo.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Simples e direto para a correria do bar:
            </p>
            <div className="space-y-2.5 text-sm text-slate-300">
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                <strong className="text-amber-400">1. Marcar:</strong> &ldquo;Marca 1 litrão para
                Tiago&rdquo; (entende Tiago com ou sem H)
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                <strong className="text-sky-400">2. Fechar / Valor:</strong> &ldquo;Quanto ficou a
                conta do Tiago?&rdquo; ou &ldquo;Feche a conta do Tiago&rdquo;
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                <strong className="text-emerald-400">3. Dar Baixa:</strong> &ldquo;Dar baixa na
                conta do Tiago&rdquo;
              </div>
            </div>
          </div>

          {/* Right Column: Clean Login / Register / Password Recovery Box */}
          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5 text-xs">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthFormError(null);
                  setAuthSuccessMsg(null);
                }}
                className={`py-2.5 px-2 rounded-md font-bold transition-colors cursor-pointer ${
                  authTab === 'login'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('register_adm');
                  setAuthFormError(null);
                  setAuthSuccessMsg(null);
                }}
                className={`py-2.5 px-2 rounded-md font-bold transition-colors cursor-pointer ${
                  authTab === 'register_adm'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Criar Conta ADM
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('recover_password');
                  setAuthFormError(null);
                  setAuthSuccessMsg(null);
                }}
                className={`py-2.5 px-2 rounded-md font-bold transition-colors cursor-pointer ${
                  authTab === 'recover_password'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Recuperar Senha
              </button>
            </div>

            {authFormError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{authFormError}</span>
              </div>
            )}

            {authSuccessMsg && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-lg text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{authSuccessMsg}</span>
              </div>
            )}

            {authTab === 'login' && (
              <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-amber-400" />
                    E-mail ou Usuário
                  </label>
                  <input
                    type="text"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="Seu e-mail (ou digite superadmin)"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-medium flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setRecEmail(loginEmail);
                        setAuthTab('recover_password');
                        setAuthFormError(null);
                      }}
                      className="text-amber-400 hover:underline font-medium cursor-pointer"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Sua senha"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3.5 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-lg transition-colors cursor-pointer"
                >
                  {authBusy ? 'Entrando...' : 'Entrar no Sistema'}
                </button>

                <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLoginEmail('superadmin@comandavoz.com');
                      setLoginPassword('superadmin123');
                      setAuthFormError(null);
                    }}
                    className="text-amber-400 font-semibold hover:underline cursor-pointer"
                  >
                    Preencher Programador (SUPERADMIN)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('register_adm');
                      setAuthFormError(null);
                    }}
                    className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Criar Conta ADM
                  </button>
                </div>
              </form>
            )}

            {authTab === 'register_adm' && (
              <form onSubmit={handleRegisterAdminAccount} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-slate-300 block font-medium">Seu Nome (ADM)</label>
                  <input
                    type="text"
                    value={regAdmName}
                    onChange={(e) => setRegAdmName(e.target.value)}
                    placeholder="Ex: Carlos"
                    required
                    maxLength={60}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">E-mail do ADM</label>
                    <input
                      type="email"
                      value={regAdmEmail}
                      onChange={(e) => setRegAdmEmail(e.target.value)}
                      placeholder="Ex: adm@bar.com"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Senha</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={regAdmPassword}
                      onChange={(e) => setRegAdmPassword(e.target.value)}
                      placeholder="Mín. 4 caracteres"
                      required
                      minLength={4}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Nome do Bar</label>
                    <input
                      type="text"
                      value={regStoreName}
                      onChange={(e) => setRegStoreName(e.target.value)}
                      placeholder="Ex: Bar do Zé"
                      required
                      maxLength={80}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Código do Bar</label>
                    <input
                      type="text"
                      value={regStoreCode}
                      onChange={(e) => setRegStoreCode(e.target.value)}
                      placeholder="Ex: BAR-01"
                      required
                      maxLength={30}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-lg transition-colors cursor-pointer"
                >
                  {authBusy ? 'Criando Conta...' : 'Criar Conta ADM e Entrar'}
                </button>
              </form>
            )}

            {authTab === 'recover_password' && (
              <form onSubmit={handleRecoverPassword} className="space-y-3.5">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 leading-relaxed">
                  Informe seu <strong>E-mail/Usuário</strong> e valide com o{' '}
                  <strong className="text-amber-400">Código do Bar</strong> (ex: BAR-01), seu{' '}
                  <strong className="text-amber-400">Nome cadastrado</strong> ou a{' '}
                  <strong className="text-amber-400">Chave Mestre do Programador</strong> para criar
                  uma nova senha na hora.
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 block font-medium">
                    E-mail ou Usuário a recuperar *
                  </label>
                  <input
                    type="text"
                    value={recEmail}
                    onChange={(e) => setRecEmail(e.target.value)}
                    placeholder="Ex: adm@bar.com ou superadmin"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">
                      Código do Bar / Nome / Chave Mestre *
                    </label>
                    <input
                      type="text"
                      value={recVerification}
                      onChange={(e) => setRecVerification(e.target.value)}
                      placeholder="Ex: BAR-01 ou SUPER2026"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Nova Senha *</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={recNewPassword}
                      onChange={(e) => setRecNewPassword(e.target.value)}
                      placeholder="Mín. 4 caracteres"
                      required
                      minLength={4}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-lg transition-colors cursor-pointer"
                >
                  {authBusy ? 'Redefinindo...' : 'Redefinir Senha e Entrar'}
                </button>
              </form>
            )}
          </div>
        </main>

        <footer className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-500">
          Comanda Voz · Assistente Marcelo
        </footer>
      </div>
    );
  }

  // MAIN WORKSPACE (DECLUTTERED, CLEAN, FEW CLICKS)
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Simple 3-Zone Header */}
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-900 sticky top-0 z-30">
        <button
          type="button"
          onClick={() => setActiveSection('comandas')}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {currentStoreName} · <span className="text-amber-400">Marcelo</span>
        </button>

        {/* Clean Top Navigation */}
        <nav className="flex items-center gap-5 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('comandas')}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'comandas'
                ? 'text-amber-400 font-bold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Comandas ({activeStageTabs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('cardapio')}
            className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
              activeSection === 'cardapio'
                ? 'text-amber-400 font-bold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Cardápio ({menuItems.length})
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveSection('equipe_comercio')}
              className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
                activeSection === 'equipe_comercio'
                  ? 'text-amber-400 font-bold underline underline-offset-8 decoration-2'
                  : 'hover:text-slate-100'
              }`}
            >
              Garçons ({voiceOperators.length})
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setActiveSection('superadmin')}
              className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
                activeSection === 'superadmin'
                  ? 'text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                  : 'text-emerald-400/80 hover:text-emerald-300'
              }`}
            >
              SUPERADMIN
            </button>
          )}
        </nav>

        {/* User Role & Sign Out */}
        <div className="flex items-center gap-3 shrink-0 text-xs">
          <span className="hidden sm:inline text-slate-400">
            {isSuperAdmin ? 'SUPERADMIN:' : isAdmin ? 'ADM:' : 'Garçom:'}{' '}
            <strong className="text-slate-100">
              {userProfile?.userName || directSession?.userName}
            </strong>
          </span>
          <button
            type="button"
            onClick={handleSignOutAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-[1320px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5 flex-1">
        {/* ULTRA-CLEAN MARCELO VOICE BAR (Always visible on Comandas) */}
        {activeSection === 'comandas' && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (commandInput.trim()) {
                  processOrderPhrase(commandInput, 'manual');
                }
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
            >
              <button
                type="button"
                onClick={toggleVoiceRecognition}
                disabled={isProcessingCommand}
                className={`inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isListening
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-5 h-5" />
                    Ouvindo... (Clique p/ parar)
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5" />
                    Falar com Marcelo
                  </>
                )}
              </button>

              <div className="relative flex-1">
                <input
                  type="text"
                  value={
                    interimTranscript
                      ? `${commandInput} ${interimTranscript}`.trim()
                      : commandInput
                  }
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder='Fale ou digite: "Marca 1 litrão para Tiago", "Quanto ficou a conta do Tiago?" ou "Dar baixa no Tiago"'
                  disabled={isProcessingCommand}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                {isProcessingCommand && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400 font-mono">
                    Processando...
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={isProcessingCommand || !commandInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Executar
              </button>

              <button
                type="button"
                onClick={() => setMarceloVoiceReplyEnabled((v) => !v)}
                title={marceloVoiceReplyEnabled ? 'Voz do Marcelo ligada' : 'Voz do Marcelo muda'}
                className={`inline-flex items-center justify-center px-3.5 py-3.5 rounded-lg border transition-colors shrink-0 cursor-pointer ${
                  marceloVoiceReplyEnabled
                    ? 'bg-slate-950 border-amber-500/40 text-amber-400'
                    : 'bg-slate-950 border-slate-800 text-slate-500'
                }`}
              >
                {marceloVoiceReplyEnabled ? (
                  <Volume2 className="w-5 h-5" />
                ) : (
                  <VolumeX className="w-5 h-5" />
                )}
              </button>
            </form>

            {/* 3 Simple Stage Shortcuts */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">Exemplos rápidos:</span>
              {SIMPLE_VOICE_EXAMPLES.map((ex) => (
                <button
                  key={ex.stage}
                  type="button"
                  disabled={isProcessingCommand}
                  onClick={() => processOrderPhrase(ex.phrase, 'manual')}
                  className="px-2.5 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-md text-slate-300 transition-colors cursor-pointer"
                >
                  <strong className="text-amber-400">{ex.stage}:</strong> &ldquo;{ex.phrase}&rdquo;
                </button>
              ))}
            </div>

            {/* Clean Response Banner from Marcelo */}
            {(marceloReport || feedbackBanner) && (
              <div
                className={`p-3.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-3 ${
                  feedbackBanner?.type === 'error'
                    ? 'bg-red-950/50 border-red-800/70 text-red-200'
                    : 'bg-slate-950 border-amber-500/50 text-slate-100'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {feedbackBanner?.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium">
                    {feedbackBanner?.message || marceloReport?.spokenSummary}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {marceloReport && (
                    <button
                      type="button"
                      onClick={() => speakAsMarcelo(marceloReport.spokenSummary, true)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 rounded cursor-pointer"
                    >
                      Ouvir
                    </button>
                  )}
                  {isAdmin && lastUndo && marceloReport?.intent === 'MARCAR' && (
                    <button
                      type="button"
                      onClick={handleUndoLastLaunch}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Desfazer
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setFeedbackBanner(null);
                      setMarceloReport(null);
                    }}
                    className="text-slate-400 hover:text-slate-200 px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Global Feedback Banner when on Cardápio or Garçons tab */}
        {activeSection !== 'comandas' && feedbackBanner && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-xs ${
              feedbackBanner.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-200'
                : 'bg-red-950/50 border-red-800/70 text-red-200'
            }`}
          >
            <span>{feedbackBanner.message}</span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* SECTION 1: COMANDAS (SIMPLE 2-COLUMN LAYOUT) */}
        {activeSection === 'comandas' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Customer Tabs List */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  Clientes ({filteredTabs.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setShowNewTabForm((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Nova Comanda
                </button>
              </div>

              {showNewTabForm && (
                <form
                  onSubmit={handleCreateManualTab}
                  className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="Nome (ex: Tiago)"
                      required
                      maxLength={80}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                    <input
                      type="text"
                      value={newTableLabel}
                      onChange={(e) => setNewTableLabel(e.target.value)}
                      placeholder="Mesa (opcional)"
                      maxLength={40}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewTabForm(false)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 text-xs font-bold bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 cursor-pointer"
                    >
                      Abrir
                    </button>
                  </div>
                </form>
              )}

              {/* Simple Stage Filter */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setStageFilter('all')}
                  className={`py-1.5 rounded font-medium cursor-pointer ${
                    stageFilter === 'all'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todas ({stageCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setStageFilter('open')}
                  className={`py-1.5 rounded font-medium cursor-pointer ${
                    stageFilter === 'open'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Abertas ({stageCounts.open})
                </button>
                <button
                  type="button"
                  onClick={() => setStageFilter('closing')}
                  className={`py-1.5 rounded font-medium cursor-pointer ${
                    stageFilter === 'closing'
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fechando ({stageCounts.closing})
                </button>
                <button
                  type="button"
                  onClick={() => setStageFilter('paid')}
                  className={`py-1.5 rounded font-medium cursor-pointer ${
                    stageFilter === 'paid'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Pagas ({stageCounts.paid})
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cliente (ex: Tiago / Thiago)..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
                />
              </div>

              {/* Customer List */}
              {dataLoading ? (
                <div className="space-y-2 py-4">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-14 bg-slate-950 border border-slate-800/60 rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredTabs.length === 0 ? (
                <div className="text-center py-8 px-4 border border-dashed border-slate-800 rounded-lg space-y-1">
                  <p className="text-sm font-medium text-slate-300">Nenhuma comanda aberta</p>
                  <p className="text-xs text-slate-500">
                    Fale &ldquo;Marca 1 litrão para Tiago&rdquo; para abrir automaticamente.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {filteredTabs.map((tab) => {
                    const isSelected = selectedTab?.id === tab.id;
                    const remaining = getRemainingBalance(tab);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setSelectedTabId(tab.id);
                          setShowBaixaDrawer(false);
                        }}
                        className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                          isSelected
                            ? 'bg-slate-800 border-amber-500'
                            : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-100 truncate">
                              {tab.customerName}
                            </span>
                            {tab.tableLabel && (
                              <span className="text-xs text-slate-400">· {tab.tableLabel}</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                            <span
                              className={
                                tab.status === 'open'
                                  ? 'text-amber-400'
                                  : tab.status === 'closing'
                                    ? 'text-sky-400'
                                    : 'text-emerald-400'
                              }
                            >
                              {STAGE_LABELS[tab.status]}
                            </span>{' '}
                            · {tab.itemCount} itens
                          </div>
                        </div>

                        <div className="text-right shrink-0 font-mono tabular-nums">
                          <div className="text-base font-bold text-amber-400">
                            {formatBRL(remaining)}
                          </div>
                          {tab.paidAmount > 0 && (
                            <div className="text-[11px] text-emerald-400">
                              Pago: {formatBRL(tab.paidAmount)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Selected Comanda (Clean, Focused, Few Buttons) */}
            <div className="lg:col-span-7">
              {!selectedTab ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center space-y-2">
                  <Receipt className="w-8 h-8 text-amber-400 mx-auto" />
                  <h3 className="text-base font-semibold text-slate-200">
                    Selecione ou abra uma comanda
                  </h3>
                  <p className="text-xs text-slate-400">
                    Diga &ldquo;Marca 1 litrão para Tiago&rdquo; para começar.
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
                  {/* Customer Header + 2 Clear Main Buttons (Fechar/Ver Conta & Dar Baixa) */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-50">
                          {selectedTab.customerName}
                        </h2>
                        {selectedTab.tableLabel && (
                          <span className="text-xs text-slate-400">
                            · {selectedTab.tableLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                        {STAGE_LABELS[selectedTab.status]} · Consumido:{' '}
                        {formatBRL(selectedTab.totalAmount)}
                        {selectedTab.paidAmount > 0
                          ? ` · Já Pago: ${formatBRL(selectedTab.paidAmount)}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-right font-mono tabular-nums mr-1">
                        <span className="text-[11px] text-slate-400 block font-sans">
                          Falta Pagar
                        </span>
                        <span className="text-2xl font-bold text-amber-400">
                          {formatBRL(getRemainingBalance(selectedTab))}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          executeStage2Fechar(
                            selectedTab.customerName,
                            activeWaiterDisplay.name
                          )
                        }
                        className="px-3.5 py-2.5 text-xs font-bold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                      >
                        Fechar / Ouvir Conta
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          executeStage3Baixa(
                            selectedTab.customerName,
                            undefined,
                            'PIX',
                            false,
                            activeWaiterDisplay.name
                          )
                        }
                        className="px-4 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                      >
                        Dar Baixa Total
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setBaixaAmountInput(getRemainingBalance(selectedTab).toFixed(2));
                          setShowBaixaDrawer((v) => !v);
                        }}
                        className="px-3 py-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-lg transition-colors cursor-pointer"
                      >
                        Baixa Parcial
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyAuditReceipt(selectedTab)}
                        title="Copiar conta para WhatsApp"
                        className="p-2.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        {copiedReceipt ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Banner when account is PAID / BAIXADA */}
                  {selectedTab.status === 'paid' && (
                    <div className="p-3.5 bg-emerald-950/60 border border-emerald-600/60 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-emerald-200">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          <strong>CONTA BAIXADA / PAGA:</strong> Total pago{' '}
                          {formatBRL(selectedTab.paidAmount)}. Se o cliente pedir mais itens, basta
                          marcar normalmente!
                        </span>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleArchivePaidTab(selectedTab)}
                          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          Arquivar / Remover da Lista
                        </button>
                      )}
                    </div>
                  )}

                  {/* STAGE 3 DRAWER: DAR BAIXA */}
                  {showBaixaDrawer && (
                    <div className="p-4 bg-slate-950 border border-emerald-600/60 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                          <Banknote className="w-4 h-4" />
                          Receber / Dar Baixa — {selectedTab.customerName}
                        </h3>
                        <span className="text-xs text-slate-400 font-mono">
                          Falta: {formatBRL(getRemainingBalance(selectedTab))}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-slate-400 block">Valor Pago (R$)</label>
                          <input
                            type="text"
                            value={baixaAmountInput}
                            onChange={(e) => setBaixaAmountInput(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block">Pagamento</label>
                          <select
                            value={selectedPaymentMethod}
                            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                          >
                            <option value="PIX">PIX</option>
                            <option value="Dinheiro">Dinheiro</option>
                            <option value="Cartão de Débito">Cartão de Débito</option>
                            <option value="Cartão de Crédito">Cartão de Crédito</option>
                          </select>
                        </div>

                        <div className="flex items-end">
                          <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer py-2">
                            <input
                              type="checkbox"
                              checked={baixaKeepConsuming}
                              onChange={(e) => setBaixaKeepConsuming(e.target.checked)}
                              className="rounded border-slate-700"
                            />
                            Continua consumindo
                          </label>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setShowBaixaDrawer(false)}
                          className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const parsedVal = parseFloat(baixaAmountInput.replace(',', '.'));
                            executeStage3Baixa(
                              selectedTab.customerName,
                              !Number.isNaN(parsedVal) && parsedVal > 0 ? parsedVal : undefined,
                              selectedPaymentMethod,
                              baixaKeepConsuming,
                              activeWaiterDisplay.name
                            );
                          }}
                          className="px-5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                        >
                          Confirmar Baixa
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Clean List of Products in the Selected Comanda */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-200">
                        Produtos Marcados ({selectedTab.itemCount})
                      </span>
                      <span>
                        {isAdmin ? 'ADM: pode adicionar (+) ou remover (-)' : 'Garçom: somente adicionar (+)'}
                      </span>
                    </div>

                    {consolidatedSelectedItems.length === 0 ? (
                      <div className="p-6 text-center bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400">
                        Nenhum produto marcado ainda. Fale com o Marcelo ou clique em um produto
                        abaixo.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/50">
                        {consolidatedSelectedItems.map((group) => {
                          const latestEntry = group.entries[0];
                          return (
                            <div
                              key={group.key}
                              className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-100 text-sm">
                                  {group.itemName}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {formatBRL(group.unitPrice)} cada · Por:{' '}
                                  {latestEntry.launchedByName || activeWaiterDisplay.name}
                                </div>
                              </div>

                              <div className="flex items-center gap-4 shrink-0">
                                <div className="flex items-center gap-2">
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={() => handleAdjustTabItemQty(latestEntry, -1)}
                                      className="w-7 h-7 rounded bg-slate-800 hover:bg-red-900/60 text-slate-200 flex items-center justify-center cursor-pointer"
                                      title="Diminuir / Remover (ADM)"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <span className="font-mono tabular-nums font-bold text-sm text-slate-100 w-6 text-center">
                                    {group.totalQuantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustTabItemQty(latestEntry, 1)}
                                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 flex items-center justify-center cursor-pointer"
                                    title="Adicionar +1"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <span className="font-mono tabular-nums font-bold text-sm text-amber-400 w-20 text-right">
                                  {formatBRL(group.totalSubtotal)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Quick 1-Tap Product Buttons */}
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <span className="text-xs font-semibold text-slate-300 block">
                      Toque rápido para marcar na conta de {selectedTab.customerName}:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {menuItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleQuickAddMenuItem(item)}
                          className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-left transition-colors flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-200 truncate">
                              {item.name}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-amber-400">
                              + {formatBRL(item.price)}
                            </div>
                          </div>
                          <Plus className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 2: CARDÁPIO (SIMPLE & RELIABLE CRUD FOR ADM) */}
        {activeSection === 'cardapio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              {isAdmin ? (
                <>
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <Utensils className="w-4 h-4 text-amber-400" />
                      {editingMenuId ? 'Editar Produto' : 'Novo Produto no Cardápio'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      Cadastre os itens e preços que o Marcelo deve reconhecer.
                    </p>
                  </div>

                  <form onSubmit={handleAddOrUpdateMenuItem} className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Nome do Produto *</label>
                      <input
                        type="text"
                        value={newMenuName}
                        onChange={(e) => setNewMenuName(e.target.value)}
                        placeholder="Ex: Litrão Brahma 1L"
                        required
                        maxLength={80}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-slate-300 block font-medium">Categoria</label>
                        <select
                          value={newMenuCategory}
                          onChange={(e) => setNewMenuCategory(e.target.value as ItemCategory)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100"
                        >
                          <option value="cervejas">Cervejas</option>
                          <option value="doses">Doses & Drinks</option>
                          <option value="porcoes">Porções & Espetos</option>
                          <option value="sem_alcool">Sem Álcool</option>
                          <option value="outros">Outros</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-300 block font-medium">Preço (R$) *</label>
                        <input
                          type="text"
                          value={newMenuPrice}
                          onChange={(e) => setNewMenuPrice(e.target.value)}
                          placeholder="Ex: 18,00"
                          required
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 font-mono tabular-nums focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">
                        Palavras-chave específicas de voz (separe por vírgula)
                      </label>
                      <input
                        type="text"
                        value={newMenuSynonyms}
                        onChange={(e) => setNewMenuSynonyms(e.target.value)}
                        placeholder="Ex: coca 2l, coca 2 litros (evite palavras genéricas repetidas)"
                        maxLength={200}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {editingMenuId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMenuId(null);
                            setNewMenuName('');
                            setNewMenuPrice('');
                            setNewMenuSynonyms('');
                          }}
                          className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={savingMenu}
                        className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        {savingMenu
                          ? 'Salvando...'
                          : editingMenuId
                            ? 'Salvar Alterações'
                            : 'Salvar Produto'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <Lock className="w-4 h-4" />
                    Cardápio (Somente Consulta)
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Somente o <strong>ADM</strong> pode adicionar, editar ou excluir produtos do
                    cardápio.
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-100">
                  Itens do Cardápio ({menuItems.length})
                </h2>

                {isAdmin && (
                  <div className="flex items-center gap-2 text-xs">
                    {menuItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllMenuItems}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/70 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar Tudo
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRestoreDefaultMenu}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restaurar Padrão
                    </button>
                  </div>
                )}
              </div>

              {menuItems.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg space-y-2 text-xs">
                  <p className="text-slate-300 font-semibold">Cardápio vazio.</p>
                  <p className="text-slate-400">
                    Use o formulário ao lado para criar seus produtos.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 px-4 font-medium">Produto</th>
                        <th className="py-2.5 px-4 font-medium">Apelidos de Voz</th>
                        <th className="py-2.5 px-4 font-medium text-right">Preço</th>
                        {isAdmin && (
                          <th className="py-2.5 px-4 font-medium text-right">Ações</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                      {menuItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4 font-semibold text-slate-100">
                            {item.name}
                            <span className="block text-[11px] text-slate-400 font-normal">
                              {CATEGORY_LABELS[item.category]}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-400">{item.synonyms || '—'}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-400">
                            {formatBRL(item.price)}
                          </td>
                          {isAdmin && (
                            <td className="py-2.5 px-4 text-right space-x-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleStartEditMenuItem(item)}
                                className="text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                                title="Editar produto"
                              >
                                <Edit3 className="w-4 h-4 inline" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMenuItem(item.id)}
                                className="text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                                title="Deletar produto"
                              >
                                <Trash2 className="w-4 h-4 inline" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 3: GARÇONS & BAR (ADM ONLY) */}
        {activeSection === 'equipe_comercio' && isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-5">
              {/* ADM Register Waiter Form */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-amber-400" />
                    Cadastrar Garçom (Login E-mail e Senha)
                  </h2>
                  <p className="text-xs text-slate-400">
                    O garçom entra com este e-mail e senha e só pode adicionar pedidos (não remove
                    nada).
                  </p>
                </div>

                <form onSubmit={handleSaveTrainedOperator} className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Nome do Garçom *</label>
                    <input
                      type="text"
                      value={newOpName}
                      onChange={(e) => setNewOpName(e.target.value)}
                      placeholder="Ex: Rodrigo"
                      required
                      maxLength={60}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">E-mail do Garçom *</label>
                      <input
                        type="email"
                        value={newOpEmail}
                        onChange={(e) => setNewOpEmail(e.target.value)}
                        placeholder="Ex: rodrigo@bar.com"
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Senha do Garçom *</label>
                      <input
                        type="text"
                        value={newOpPassword}
                        onChange={(e) => setNewOpPassword(e.target.value)}
                        placeholder="Mín. 4 caracteres"
                        required
                        minLength={4}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      registeringWaiter ||
                      !newOpName.trim() ||
                      !newOpEmail.trim() ||
                      newOpPassword.trim().length < 4
                    }
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    {registeringWaiter ? 'Cadastrando...' : 'Cadastrar Garçom'}
                  </button>
                </form>
              </div>

              {/* Store Settings */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Store className="w-4 h-4 text-amber-400" />
                  Dados do Bar
                </h3>
                <form onSubmit={handleSaveUserProfile} className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-400 block">Nome do Bar</label>
                      <input
                        type="text"
                        value={profileStoreName}
                        onChange={(e) => setProfileStoreName(e.target.value)}
                        required
                        maxLength={80}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400 block">Código</label>
                      <input
                        type="text"
                        value={profileStoreCode}
                        onChange={(e) => setProfileStoreCode(e.target.value)}
                        required
                        maxLength={30}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {savingProfile ? 'Salvando...' : 'Salvar Dados do Bar'}
                  </button>
                </form>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-100">
                Garçons Cadastrados ({voiceOperators.length})
              </h2>

              {voiceOperators.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-400">
                  Nenhum garçom cadastrado ainda. Use o formulário ao lado para criar o login dos
                  garçons.
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 px-4 font-medium">Nome</th>
                        <th className="py-2.5 px-4 font-medium">E-mail de Login</th>
                        <th className="py-2.5 px-4 font-medium">Senha / Permissão</th>
                        <th className="py-2.5 px-4 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                      {voiceOperators.map((op) => (
                        <tr key={op.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4 font-semibold text-slate-100">
                            {op.operatorName}
                          </td>
                          <td className="py-2.5 px-4 text-slate-300 font-mono">
                            {op.email || '—'}
                          </td>
                          <td className="py-2.5 px-4">
                            {resettingAccountEmail === op.email && op.email ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={inlineNewPassword}
                                  onChange={(e) => setInlineNewPassword(e.target.value)}
                                  placeholder="Nova senha"
                                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 w-28"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQuickResetUserPassword(op.email!, op.operatorName)
                                  }
                                  className="px-2 py-1 bg-emerald-500 text-slate-950 font-bold rounded cursor-pointer"
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResettingAccountEmail(null);
                                    setInlineNewPassword('');
                                  }}
                                  className="text-slate-400 hover:text-slate-200 px-1 cursor-pointer"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <span className="text-amber-400">Somente Adicionar</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-3 whitespace-nowrap">
                            {op.email && (
                              <button
                                type="button"
                                onClick={() => {
                                  setResettingAccountEmail(op.email!);
                                  setInlineNewPassword('');
                                }}
                                className="text-sky-400 hover:underline font-medium cursor-pointer"
                                title="Redefinir senha do garçom"
                              >
                                Trocar Senha
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteOperator(op.id)}
                              className="text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                              title="Remover garçom"
                            >
                              <Trash2 className="w-4 h-4 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: SUPERADMIN (PROGRAMADOR - CONTROLE TOTAL DE BARES, USUÁRIOS E SENHAS) */}
        {activeSection === 'superadmin' && isSuperAdmin && (
          <div className="space-y-6">
            {/* Top Bar: Master Recovery Key & Programmer Status */}
            <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Painel do Programador (SUPERADMIN) — Controle Total
                </h2>
                <p className="text-xs text-slate-300">
                  Você pode acessar qualquer bar em tempo real, criar/editar contas, trocar senhas e
                  definir a Chave Mestre de recuperação.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <div className="space-y-1">
                  <label className="text-slate-400 block">Chave Mestre de Recuperação</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={masterRecoveryKeyState}
                      onChange={(e) => setMasterRecoveryKeyState(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono font-bold w-36"
                    />
                    <button
                      type="button"
                      onClick={() => handleSuperAdminStoreAction('update_master_key')}
                      className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Salvar Chave
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Create or Update Any Account (SUPERADMIN, ADM, Garçom) */}
              <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-100">
                    Criar ou Editar Qualquer Usuário
                  </h3>
                  <p className="text-xs text-slate-400">
                    Crie novos ADMs, Garçons ou altere a senha do seu próprio usuário SUPERADMIN.
                  </p>
                </div>

                <form onSubmit={handleSuperAdminSaveAccount} className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">Nome *</label>
                    <input
                      type="text"
                      value={saUserName}
                      onChange={(e) => setSaUserName(e.target.value)}
                      placeholder="Ex: Programador ou Dono do Bar"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-300 block font-medium">E-mail de Login *</label>
                    <input
                      type="email"
                      value={saUserEmail}
                      onChange={(e) => setSaUserEmail(e.target.value)}
                      placeholder="Ex: superadmin@comandavoz.com"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Cargo</label>
                      <select
                        value={saUserRole}
                        onChange={(e) =>
                          setSaUserRole(e.target.value as 'SUPERADMIN' | 'ADM' | 'Garçom')
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      >
                        <option value="ADM">ADM (Dono do Bar)</option>
                        <option value="Garçom">Garçom (Só Adiciona)</option>
                        <option value="SUPERADMIN">SUPERADMIN (Programador)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Senha *</label>
                      <input
                        type="text"
                        value={saUserPassword}
                        onChange={(e) => setSaUserPassword(e.target.value)}
                        placeholder="Mín. 4 dígitos"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Nome do Bar</label>
                      <input
                        type="text"
                        value={saStoreName}
                        onChange={(e) => setSaStoreName(e.target.value)}
                        placeholder="Ex: Bar Central"
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Código do Bar</label>
                      <input
                        type="text"
                        value={saStoreCode}
                        onChange={(e) => setSaStoreCode(e.target.value)}
                        placeholder="Ex: BAR-01"
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saSaving}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    {saSaving ? 'Salvando...' : 'Salvar Conta / Redefinir Senha'}
                  </button>
                </form>
              </div>

              {/* Right Column: All Users & All Stores Tables */}
              <div className="lg:col-span-8 space-y-6">
                {/* Stores List */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-100">
                    Todos os Bares Cadastrados ({superStores.length})
                  </h3>

                  {superStores.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhum bar registrado ainda.</p>
                  ) : (
                    <div className="border border-slate-800 rounded-lg overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                            <th className="py-2.5 px-3 font-medium">Bar / Código</th>
                            <th className="py-2.5 px-3 font-medium">Comandas</th>
                            <th className="py-2.5 px-3 font-medium">Cardápio</th>
                            <th className="py-2.5 px-3 font-medium text-right">Controle</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                          {superStores.map((st) => {
                            const isCurrent = st.storeCode === currentStoreCode;
                            return (
                              <tr key={st.storeCode} className="hover:bg-slate-800/30">
                                <td className="py-2.5 px-3 font-semibold text-slate-100">
                                  {st.storeName}{' '}
                                  <span className="font-mono text-amber-400">({st.storeCode})</span>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-300">
                                  {st.tabsCount} ativas · {formatBRL(st.totalConsumed)}
                                </td>
                                <td className="py-2.5 px-3 text-slate-400">
                                  {st.menuCount} itens · {st.operatorsCount} garçons
                                </td>
                                <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSuperAdminSwitchStore(st.storeCode, st.storeName)
                                    }
                                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                                      isCurrent
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                    }`}
                                  >
                                    {isCurrent ? 'Bar Ativo' : 'Acessar Bar'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSuperAdminStoreAction('clear_tabs', st.storeCode)
                                    }
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
                                  >
                                    Zerar Comandas
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* All Accounts List */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-100">
                    Todos os Usuários e Senhas ({superAccounts.length})
                  </h3>

                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                          <th className="py-2.5 px-3 font-medium">Usuário / E-mail</th>
                          <th className="py-2.5 px-3 font-medium">Cargo</th>
                          <th className="py-2.5 px-3 font-medium">Bar</th>
                          <th className="py-2.5 px-3 font-medium text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                        {superAccounts.map((acc) => (
                          <tr key={acc.email} className="hover:bg-slate-800/30">
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-100">{acc.userName}</div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {acc.email}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={
                                  acc.userRole === 'SUPERADMIN'
                                    ? 'text-emerald-400 font-bold'
                                    : acc.userRole === 'ADM'
                                      ? 'text-amber-400 font-bold'
                                      : 'text-slate-300'
                                }
                              >
                                {acc.userRole}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">
                              {acc.storeName}{' '}
                              <span className="font-mono text-slate-400">({acc.storeCode})</span>
                            </td>
                            <td className="py-2.5 px-3 text-right space-x-2 whitespace-nowrap">
                              {resettingAccountEmail === acc.email ? (
                                <span className="inline-flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={inlineNewPassword}
                                    onChange={(e) => setInlineNewPassword(e.target.value)}
                                    placeholder="Nova senha"
                                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 w-24"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQuickResetUserPassword(acc.email, acc.userName)
                                    }
                                    className="px-2 py-1 bg-emerald-500 text-slate-950 font-bold rounded cursor-pointer"
                                  >
                                    OK
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResettingAccountEmail(null);
                                      setInlineNewPassword('');
                                    }}
                                    className="text-slate-400 px-1 cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResettingAccountEmail(acc.email);
                                      setInlineNewPassword('');
                                    }}
                                    className="text-sky-400 hover:underline font-medium cursor-pointer"
                                  >
                                    Trocar Senha
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSaUserName(acc.userName);
                                      setSaUserEmail(acc.email);
                                      setSaUserRole(acc.userRole);
                                      setSaStoreName(acc.storeName);
                                      setSaStoreCode(acc.storeCode);
                                      setSaUserPassword('');
                                    }}
                                    className="text-amber-400 hover:underline font-medium cursor-pointer"
                                  >
                                    Editar
                                  </button>
                                  {acc.userRole !== 'SUPERADMIN' && (
                                    <button
                                      type="button"
                                      onClick={() => handleSuperAdminDeleteAccount(acc.email)}
                                      className="text-slate-400 hover:text-red-400 cursor-pointer"
                                      title="Excluir usuário"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 inline" />
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ComandaVozWorkspace />
    </ErrorBoundary>
  );
}
