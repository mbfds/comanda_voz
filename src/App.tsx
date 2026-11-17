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
  Clock,
  Receipt,
  LogOut,
  RotateCcw,
  Send,
  Utensils,
  History,
  UserPlus,
  Copy,
  Check,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  Banknote,
  FileSpreadsheet,
  Store,
  UserCheck,
  Lock,
  Mail,
  KeyRound,
  Edit3,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  auth,
  checkGoogleRedirectResult,
  db,
  firebaseProjectId,
  handleFirestoreError,
  loginWithGoogle,
  loginWithGoogleRedirect,
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
  CATEGORY_LABELS,
  DEFAULT_BAR_MENU,
  formatBRL,
  normalizeText,
  parseVoiceOrderLocally,
  sanitizeCategory,
  sanitizeStoreCode,
  sanitizeString,
  STAGE_LABELS,
  VALIDATION_LIMITS,
} from './utils/barCatalog';
import {
  AcousticSample,
  captureVoiceBiometricSample,
  matchSpeakerAgainstOperators,
  speakAsMarcelo,
} from './utils/voiceBiometrics';
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

type ActiveSection = 'comandas' | 'equipe_comercio' | 'auditoria' | 'cardapio';

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
  userRole: 'ADM' | 'Garçom';
  storeName: string;
  storeCode: string;
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

const MARCELO_VOICE_EXAMPLES = [
  'Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas',
  'Marcelo, marque 2 espetinhos e 1 coca lata para Thiago',
  'Marcelo, feche a conta do Thiago',
  'Marcelo, dê baixa de 10 reais na conta do Thiago e continua consumindo',
  'Marcelo, dê baixa na conta do Jonas',
];

const TRAINING_PHRASES = [
  'Marcelo, marca um litrão para Thiago, marca um litrão para Jonas',
  'Marcelo, feche a conta e me passe o valor total',
  'Marcelo, dê baixa na conta do cliente agora',
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

function formatTime(ts: unknown): string {
  if (!ts) return 'Agora';
  const ms = getTimestampMillis(ts);
  return new Date(ms).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

  // Email & Password Auth State (Login Tab vs Register ADM Tab)
  const [authTab, setAuthTab] = useState<'login' | 'register_adm'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authFormError, setAuthFormError] = useState<string | null>(null);

  // Register ADM Form State
  const [regAdmName, setRegAdmName] = useState('');
  const [regAdmEmail, setRegAdmEmail] = useState('');
  const [regAdmPassword, setRegAdmPassword] = useState('');
  const [regStoreName, setRegStoreName] = useState('Bar & Comércio Central');
  const [regStoreCode, setRegStoreCode] = useState('BAR-01');

  // Google Auth Error Diagnostic State
  const [googleLoginBusy, setGoogleLoginBusy] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState<{
    code: string;
    domain: string;
    message: string;
  } | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Unified user accessor (works for both Email/Password Session and Firebase Auth User)
  const isDirectSession = !firebaseUser && Boolean(directSession);
  const user = useMemo(() => {
    if (firebaseUser) return firebaseUser;
    if (directSession) {
      return {
        uid: directSession.uid,
        displayName: directSession.userName,
        email: directSession.email || `${directSession.storeCode.toLowerCase()}@comandavoz.bar`,
      } as User;
    }
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

  // Active Waiter / User Selector & Store Profile Form
  const [selectedWaiterId, setSelectedWaiterId] = useState<string>('logged_user');
  const [profileUserName, setProfileUserName] = useState('');
  const [profileUserRole, setProfileUserRole] = useState<UserRoleType>('ADM');
  const [profileStoreName, setProfileStoreName] = useState('');
  const [profileStoreCode, setProfileStoreCode] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Strict Role-Based Access Control (RBAC):
  // ADM ('ADM' or 'Proprietário') has full control.
  // Garçom ('Garçom') can ONLY add items, NEVER remove anything or manage Cardápio/Garçons.
  const currentUserRole: UserRoleType = useMemo(() => {
    if (directSession?.userRole) return directSession.userRole;
    if (userProfile?.userRole) return userProfile.userRole;
    return 'ADM';
  }, [directSession, userProfile]);

  const isAdmin = useMemo(
    () => currentUserRole === 'ADM' || currentUserRole === 'Proprietário',
    [currentUserRole]
  );

  // Marcelo Assistant & Security State
  const [commandInput, setCommandInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [marceloVoiceReplyEnabled, setMarceloVoiceReplyEnabled] = useState(true);
  const [requireWakeWordMarcelo, setRequireWakeWordMarcelo] = useState(true);
  const [requireTrainedVoiceLock, setRequireTrainedVoiceLock] = useState(false);
  const [lastSpeakerMatch, setLastSpeakerMatch] = useState<{
    operatorName: string;
    storeName: string;
    confidence: number;
  } | null>(null);

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
  const [categoryFilter, setCategoryFilter] = useState<ItemCategory | 'todas'>('todas');
  const [waiterFilter, setWaiterFilter] = useState<string>('todos');
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

  // ADM Waiter Registration State (Email + Senha + Optional Voice Biometrics)
  const [newOpName, setNewOpName] = useState('');
  const [newOpEmail, setNewOpEmail] = useState('');
  const [newOpPassword, setNewOpPassword] = useState('');
  const [newOpPin, setNewOpPin] = useState('');
  const [trainingSamples, setTrainingSamples] = useState<AcousticSample[]>([]);
  const [isRecordingSample, setIsRecordingSample] = useState(false);
  const [registeringWaiter, setRegisteringWaiter] = useState(false);

  // Cardápio (Menu Item) Create & Edit Form State
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState<ItemCategory>('cervejas');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuSynonyms, setNewMenuSynonyms] = useState('');
  const [savingMenu, setSavingMenu] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const continuousModeRef = useRef(continuousMode);
  continuousModeRef.current = continuousMode;

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
      nextData.storeName || directSession?.storeName || profileStoreName || 'Bar & Comércio Central',
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

  // Email & Password Login Handler (For both ADM and Garçom registered by ADM)
  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthFormError(null);
    const cleanEmail = loginEmail.trim().toLowerCase();
    const cleanPass = loginPassword.trim();

    if (!cleanEmail || !cleanPass) {
      setAuthFormError('Informe seu e-mail e senha para entrar.');
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
          account: {
            uid: string;
            email: string;
            userName: string;
            userRole: UserRoleType;
            storeName: string;
            storeCode: string;
          };
        };
        if (data.ok && data.account) {
          const session: DirectBarSession = {
            uid: data.account.uid,
            email: data.account.email,
            userName: data.account.userName,
            userRole: data.account.userRole,
            storeName: data.account.storeName,
            storeCode: data.account.storeCode,
          };
          localStorage.setItem(DIRECT_SESSION_STORAGE_KEY, JSON.stringify(session));
          saveAccountToLocalBackup({
            uid: session.uid,
            email: session.email,
            passwordPlainOrHash: cleanPass,
            userName: session.userName,
            userRole: session.userRole === 'Garçom' ? 'Garçom' : 'ADM',
            storeName: session.storeName,
            storeCode: session.storeCode,
          });
          setDirectSession(session);
          setLoginPassword('');
          return;
        }
      }

      // Check local backup in case Render free-tier container restarted and lost memory
      const backupMatch = loadLocalAccountsBackup().find(
        (acc) =>
          acc.email.toLowerCase() === cleanEmail && acc.passwordPlainOrHash === cleanPass
      );

      if (backupMatch) {
        // Re-register on server transparently
        if (backupMatch.userRole === 'ADM') {
          await fetch('/api/auth/register-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userName: backupMatch.userName,
              email: backupMatch.email,
              password: cleanPass,
              storeName: backupMatch.storeName,
              storeCode: backupMatch.storeCode,
            }),
          }).catch(() => {});
        }
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
          'E-mail ou senha incorretos. Se você é o dono do bar, clique na aba "Criar Conta ADM" ao lado.'
      );
    } catch {
      setAuthFormError('Erro de conexão ao validar login. Tente novamente.');
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
      setAuthFormError('Preencha seu nome, um e-mail válido e uma senha de pelo menos 4 caracteres.');
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
        account?: {
          uid: string;
          email: string;
          userName: string;
          userRole: UserRoleType;
          storeName: string;
          storeCode: string;
        };
      };

      if (!response.ok || !data.ok || !data.account) {
        setAuthFormError(data.error || 'Não foi possível criar a conta ADM.');
        return;
      }

      const session: DirectBarSession = {
        uid: data.account.uid,
        email: data.account.email,
        userName: data.account.userName,
        userRole: 'ADM',
        storeName: data.account.storeName,
        storeCode: data.account.storeCode,
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

  // Google Login Handler with Redirect Fallback & Render Unauthorized-Domain Diagnostic
  const handleGoogleSignIn = async () => {
    setGoogleLoginBusy(true);
    setGoogleAuthError(null);
    const currentDomain = window.location.hostname || 'seu-app.onrender.com';
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: string }).code)
          : 'auth/unknown';
      const msg = err instanceof Error ? err.message : String(err);

      if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
        try {
          await loginWithGoogleRedirect();
          return;
        } catch {
          // continue to error display
        }
      }

      if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
        setGoogleAuthError({
          code: 'auth/unauthorized-domain',
          domain: currentDomain,
          message: `O domínio "${currentDomain}" não está autorizado para pop-up do Google. Use o Login por E-mail e Senha ao lado para entrar imediatamente como ADM ou Garçom.`,
        });
      } else if (code !== 'auth/popup-closed-by-user') {
        setGoogleAuthError({
          code,
          domain: currentDomain,
          message: `Não foi possível abrir o login Google (${code}). Use o Login por E-mail e Senha ao lado.`,
        });
      }
    } finally {
      setGoogleLoginBusy(false);
    }
  };

  const handleSignOutAll = async () => {
    try {
      localStorage.removeItem(DIRECT_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setDirectSession(null);
    setSelectedWaiterId('logged_user');
    if (firebaseUser) {
      await logoutUser();
    }
  };

  // 1. Auth Listener (Firebase Auth + Redirect Check)
  useEffect(() => {
    checkGoogleRedirectResult().catch(() => {});
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setFirebaseUser(currentUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // 2A. Email/Password Session Loader & Real-Time Polling Sync (With Mutation Lock & Zero Unwanted Reseed!)
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
      // Never overwrite state with a background poll while a mutation is in flight or just finished!
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

            // CRITICAL FIX: Respect empty array if user deleted items! Only seed if never initialized.
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
              catalogInitialized?: boolean;
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

            // Re-push local store to server in case Render container woke up from sleep
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

  // 2B. Real-time Firestore Listeners (When logged in via Firebase Google Auth)
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
              'Administrador Principal',
            VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
            'Administrador Principal'
          );
          const defaultStoreName = 'Bar & Comércio Central';
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

  // Active Waiter & Store Attribution Resolver
  const currentStoreName = useMemo(
    () =>
      sanitizeString(
        userProfile?.storeName || directSession?.storeName || 'Bar & Comércio Central',
        VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
        'Bar & Comércio Central'
      ),
    [userProfile, directSession]
  );

  const currentStoreCode = useMemo(
    () => sanitizeStoreCode(userProfile?.storeCode || directSession?.storeCode || 'BAR-01'),
    [userProfile, directSession]
  );

  const activeWaiterDisplay = useMemo(() => {
    // If logged in as Garçom, always attribute launches to the logged-in Garçom
    if (!isAdmin) {
      const waiterName =
        directSession?.userName || userProfile?.userName || user?.displayName || 'Garçom';
      return {
        name: `${waiterName} (Garçom)`,
        storeName: currentStoreName,
      };
    }

    if (selectedWaiterId !== 'logged_user') {
      const foundOp = voiceOperators.find((op) => op.id === selectedWaiterId);
      if (foundOp) {
        return {
          name: `${foundOp.operatorName} (${foundOp.roleLabel})`,
          storeName: foundOp.storeName || currentStoreName,
        };
      }
    }
    const baseName =
      userProfile?.userName ||
      directSession?.userName ||
      user?.displayName ||
      user?.email?.split('@')[0] ||
      'ADM';
    const baseRole = userProfile?.userRole || directSession?.userRole || 'ADM';
    return {
      name: `${baseName} (${baseRole})`,
      storeName: currentStoreName,
    };
  }, [isAdmin, selectedWaiterId, voiceOperators, userProfile, directSession, user, currentStoreName]);

  // Active (non-archived) tabs across the 3 stages
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
      const q = normalizeText(searchQuery);
      return (
        normalizeText(t.customerName).includes(q) ||
        normalizeText(t.tableLabel).includes(q)
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

  const selectedTabItems = useMemo(
    () => (selectedTab ? tabItems.filter((item) => item.tabId === selectedTab.id) : []),
    [selectedTab, tabItems]
  );

  // Helper to consolidate items for any tabId
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

  // Totals across the bar right now
  const barSummary = useMemo(() => {
    const totalPendingBalance = activeStageTabs.reduce(
      (acc, t) => acc + getRemainingBalance(t),
      0
    );
    const totalPaidReceived = tabs.reduce(
      (acc, t) => acc + (Number.isFinite(t.paidAmount) ? t.paidAmount : 0),
      0
    );
    const totalItemsCount = activeStageTabs.reduce((acc, t) => acc + t.itemCount, 0);
    return {
      totalPendingBalance,
      totalPaidReceived,
      totalItemsCount,
    };
  }, [activeStageTabs, tabs]);

  // Distinct waiter names who launched items for filtering in Audit Log
  const distinctWaitersInLog = useMemo(() => {
    const set = new Set<string>();
    for (const item of tabItems) {
      if (item.launchedByName) set.add(item.launchedByName);
    }
    return Array.from(set);
  }, [tabItems]);

  const filteredAuditTabItems = useMemo(() => {
    if (waiterFilter === 'todos') return tabItems;
    return tabItems.filter((i) => i.launchedByName === waiterFilter);
  }, [tabItems, waiterFilter]);

  // MULTI-CUSTOMER BATCH STAGE 1 HANDLER: MARCAR ITENS (Allowed for both ADM and Garçom)
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

      const normCust = normalizeText(cleanCustomerName);
      let tabState = Array.from(tabsAffectedMap.values()).find(
        (t) => normalizeText(t.customerName) === normCust
      );

      if (!tabState) {
        const existingTab = activeStageTabs.find(
          (t) => normalizeText(t.customerName) === normCust
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
          ? `Anotado em ${tabsAffectedMap.size} comandas separadas! ${perCustomerSpokenParts.join('; ')}. Lançado por ${cleanWaiterName}.`
          : `Anotado! ${perCustomerSpokenParts[0]}. Saldo a pagar de ${customerNamesList}: ${formatBRL(grandRemainingBalance)}.`;

      setMarceloReport({
        intent: 'MARCAR',
        title:
          tabsAffectedMap.size > 1
            ? `Marcelo Marcou em ${tabsAffectedMap.size} Comandas Separadas (${customerNamesList})`
            : `Marcelo Marcou na Conta de ${customerNamesList}`,
        spokenSummary: spokenText,
        customerName: customerNamesList,
        stageLabel: STAGE_LABELS.open,
        waiterAttribution: `${cleanWaiterName} · ${cleanStoreName}`,
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

  // STAGE 2 HANDLER: FECHAR CONTA ("Marcelo, feche a conta do {cliente}")
  const executeStage2Fechar = async (
    customerQueryName: string,
    waiterNameAttr: string,
    storeNameAttr: string
  ) => {
    if (!user) return;
    const targetTab = activeStageTabs.find(
      (t) =>
        normalizeText(t.customerName) === normalizeText(customerQueryName) ||
        normalizeText(t.customerName).includes(normalizeText(customerQueryName))
    );

    if (!targetTab) {
      const msg = `Marcelo informa: Não encontrei comanda aberta para "${customerQueryName}". Nenhuma conta foi alterada.`;
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
          ? `Fechando a conta de ${targetTab.customerName}. Produtos: ${spokenItems}. Total consumido: ${formatBRL(targetTab.totalAmount)}. Já pago: ${formatBRL(targetTab.paidAmount)}. Falta pagar: ${formatBRL(remaining)}.`
          : `Fechando a conta de ${targetTab.customerName}. Produtos: ${spokenItems}. Total a pagar: ${formatBRL(remaining)}.`;

      setMarceloReport({
        intent: 'FECHAR',
        title: `Resumo de Fechamento — ${targetTab.customerName}`,
        spokenSummary,
        customerName: targetTab.customerName,
        stageLabel: STAGE_LABELS.closing,
        waiterAttribution: `${waiterNameAttr} · ${storeNameAttr}`,
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

  // STAGE 3 HANDLER: BAIXA NA CONTA ("Marcelo, dê baixa na conta do {cliente}")
  const executeStage3Baixa = async (
    customerQueryName: string,
    customPaymentAmount: number | undefined,
    paymentMethod = 'PIX',
    keepOpenToConsume = false,
    waiterNameAttr: string,
    storeNameAttr: string
  ) => {
    if (!user) return;
    const targetTab = activeStageTabs.find(
      (t) =>
        normalizeText(t.customerName) === normalizeText(customerQueryName) ||
        normalizeText(t.customerName).includes(normalizeText(customerQueryName))
    );

    if (!targetTab) {
      const msg = `Marcelo informa: Não encontrei a comanda de "${customerQueryName}" para dar baixa. Nada foi feito.`;
      setFeedbackBanner({ type: 'error', message: msg });
      speakAsMarcelo(msg, marceloVoiceReplyEnabled);
      return;
    }

    const currentRemaining = getRemainingBalance(targetTab);
    const amountBeingPaid =
      customPaymentAmount && customPaymentAmount > 0
        ? Math.min(customPaymentAmount, VALIDATION_LIMITS.MAX_TOTAL)
        : currentRemaining;

    const nextPaidAmount = Math.min(
      Number((targetTab.paidAmount + amountBeingPaid).toFixed(2)),
      VALIDATION_LIMITS.MAX_TOTAL
    );
    const nextRemaining = Math.max(
      0,
      Number((targetTab.totalAmount - nextPaidAmount).toFixed(2))
    );

    const nextStatus: TabStageStatus =
      nextRemaining > 0 || keepOpenToConsume ? 'open' : 'paid';

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

      setSelectedTabId(targetTab.id);
      setShowBaixaDrawer(false);

      const grouped = getConsolidatedItemsForTab(targetTab.id);
      const itemsListStrings = grouped.map(
        (g) => `${g.totalQuantity}x ${g.itemName} (${formatBRL(g.totalSubtotal)})`
      );

      const spokenSummary =
        nextStatus === 'open'
          ? `Baixa registrada de ${formatBRL(amountBeingPaid)} na conta de ${targetTab.customerName}. A comanda segue aberta para consumo. Saldo restante: ${formatBRL(nextRemaining)}.`
          : `Baixa concluída! Conta de ${targetTab.customerName} paga integralmente (${formatBRL(nextPaidAmount)} via ${paymentMethod}).`;

      setMarceloReport({
        intent: 'BAIXA',
        title:
          nextStatus === 'paid'
            ? `Baixa Concluída (Conta Paga) — ${targetTab.customerName}`
            : `Baixa Parcial & Continua Consumindo — ${targetTab.customerName}`,
        spokenSummary,
        customerName: targetTab.customerName,
        stageLabel: STAGE_LABELS[nextStatus],
        waiterAttribution: `${waiterNameAttr} · ${storeNameAttr}`,
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
    }
  };

  // Master Command Dispatcher for Virtual Assistant "MARCELO"
  const processOrderPhrase = async (
    phrase: string,
    sourceType: 'voz' | 'manual',
    speakerVerified = true,
    matchedWaiterOp?: VoiceOperator | null
  ) => {
    const cleanPhrase = phrase.trim();
    if (!cleanPhrase || !user) return;

    const hasWakeWord = /\bmarcelo\b/i.test(normalizeText(cleanPhrase));
    if (sourceType === 'voz' && requireWakeWordMarcelo && !hasWakeWord) {
      const msg = `Marcelo não executou nada: chame pelo nome dizendo "Marcelo, marque..." para evitar comandos acidentais.`;
      setFeedbackBanner({ type: 'error', message: msg });
      return;
    }

    if (sourceType === 'voz' && requireTrainedVoiceLock && !speakerVerified) {
      const msg = `Marcelo bloqueou o comando: Voz não reconhecida como garçom/operador cadastrado deste comércio. Nada foi alterado.`;
      setFeedbackBanner({ type: 'error', message: msg });
      speakAsMarcelo(
        'Voz não cadastrada neste comércio. Nada foi feito.',
        marceloVoiceReplyEnabled
      );
      return;
    }

    const waiterAttr = !isAdmin
      ? activeWaiterDisplay.name
      : matchedWaiterOp
        ? `${matchedWaiterOp.operatorName} (${matchedWaiterOp.roleLabel})`
        : activeWaiterDisplay.name;
    const storeAttr = matchedWaiterOp?.storeName || activeWaiterDisplay.storeName;

    setIsProcessingCommand(true);
    setFeedbackBanner(null);

    try {
      const localStrict = parseVoiceOrderLocally(
        cleanPhrase,
        menuItems,
        activeStageTabs.map((t) => t.customerName)
      );

      let finalParsed: ParsedVoiceOrder = localStrict;

      if (!localStrict.understood) {
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
          'Não compreendi com clareza o produto do cardápio ou o nome do cliente.';
        const safeAbortMsg = `Marcelo não fez nada: ${reason} Por favor, repita o comando.`;
        setMarceloReport(null);
        setFeedbackBanner({
          type: 'error',
          message: safeAbortMsg,
        });
        speakAsMarcelo(
          'Não entendi com segurança. Nada foi marcado. Por favor, repita.',
          marceloVoiceReplyEnabled
        );
        return;
      }

      for (const cmd of finalParsed.commands) {
        if (!cmd.customerName || cmd.customerName.trim().length < 2) {
          const abortMsg = `Marcelo não fez nada: faltou informar o nome do cliente em um dos pedidos.`;
          setMarceloReport(null);
          setFeedbackBanner({ type: 'error', message: abortMsg });
          speakAsMarcelo('Faltou o nome do cliente. Nada foi marcado.', marceloVoiceReplyEnabled);
          return;
        }
        if (cmd.intent === 'MARCAR') {
          if (!cmd.items || cmd.items.length === 0) {
            const abortMsg = `Marcelo não fez nada: não identifiquei o produto para ${cmd.customerName}.`;
            setMarceloReport(null);
            setFeedbackBanner({ type: 'error', message: abortMsg });
            speakAsMarcelo(abortMsg, marceloVoiceReplyEnabled);
            return;
          }
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
        await executeStage2Fechar(fCmd.customerName, waiterAttr, storeAttr);
      }

      for (const bCmd of baixaCmds) {
        await executeStage3Baixa(
          bCmd.customerName,
          bCmd.paymentAmount && bCmd.paymentAmount > 0 ? bCmd.paymentAmount : undefined,
          bCmd.paymentMethod || 'PIX',
          Boolean(bCmd.keepConsuming),
          waiterAttr,
          storeAttr
        );
      }

      setCommandInput('');
    } catch {
      const abortMsg =
        'Não foi possível validar o comando com segurança. Nenhuma comanda foi alterada.';
      setFeedbackBanner({ type: 'error', message: abortMsg });
    } finally {
      setIsProcessingCommand(false);
    }
  };

  // Start / Stop Web Speech API Microphone Recognition + Live Waiter Voice Biometric Identification
  const toggleVoiceRecognition = async () => {
    if (isListening) {
      setContinuousMode(false);
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
          'Seu navegador não suporta reconhecimento de voz nativo. Use o Chrome/Edge ou digite o comando abaixo.',
      });
      return;
    }

    let liveVoiceAuthorized = true;
    let detectedWaiter: VoiceOperator | null = null;

    if (voiceOperators.length > 0) {
      captureVoiceBiometricSample(1800)
        .then((sample) => {
          const { matchedOperator, confidence } = matchSpeakerAgainstOperators(
            sample,
            voiceOperators
          );
          if (matchedOperator) {
            detectedWaiter = matchedOperator;
            setLastSpeakerMatch({
              operatorName: `${matchedOperator.operatorName} (${matchedOperator.roleLabel})`,
              storeName: matchedOperator.storeName || currentStoreName,
              confidence,
            });
            liveVoiceAuthorized = confidence >= 62;
          }
        })
        .catch(() => {});
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'pt-BR';
    recognition.continuous = continuousMode;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.results.length - 1; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const finalPhrase = res[0].transcript.trim();
          setInterimTranscript('');
          if (finalPhrase) {
            processOrderPhrase(
              finalPhrase,
              'voz',
              liveVoiceAuthorized,
              detectedWaiter
            );
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
          message: `Microfone (${event.error}): verifique a permissão de áudio do navegador.`,
        });
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (continuousModeRef.current) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    setInterimTranscript('');
    setIsListening(true);
    recognition.start();
  };

  // Save Logged-In ADM & Comércio Profile (Restricted to ADM)
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
        message: `Dados do Comércio (${cleanStore}) e Administrador (${cleanName}) atualizados!`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `userProfiles/${user.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  // Record a Voice Biometric Sample for Waiter/Operator Training
  const handleRecordTrainingSample = async () => {
    if (isRecordingSample || trainingSamples.length >= 3) return;
    setIsRecordingSample(true);
    try {
      const sample = await captureVoiceBiometricSample(2200);
      setTrainingSamples((prev) => [...prev, sample]);
    } catch {
      setFeedbackBanner({
        type: 'error',
        message: 'Não foi possível acessar o microfone para gravar a amostra de voz.',
      });
    } finally {
      setIsRecordingSample(false);
    }
  };

  // ADM Registers a New Waiter (Garçom) with Email & Password + Optional Voice Biometrics
  const handleSaveTrainedOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Permissão negada: Somente o ADM pode cadastrar garçons.',
      });
      return;
    }

    const cleanName = sanitizeString(newOpName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN);
    const cleanEmail = newOpEmail.trim().toLowerCase();
    const cleanPass = newOpPassword.trim();

    if (!cleanName || !cleanEmail.includes('@') || cleanPass.length < 4) {
      setFeedbackBanner({
        type: 'error',
        message: 'Informe o nome do garçom, um e-mail válido e uma senha (mínimo 4 caracteres).',
      });
      return;
    }

    setRegisteringWaiter(true);
    const avgPitch =
      trainingSamples.length > 0
        ? trainingSamples.reduce((acc, s) => acc + s.pitchHz, 0) / trainingSamples.length
        : 145;
    const avgCentroid =
      trainingSamples.length > 0
        ? trainingSamples.reduce((acc, s) => acc + s.spectralCentroid, 0) /
          trainingSamples.length
        : 1850;
    const samplesCount = trainingSamples.length > 0 ? trainingSamples.length : 1;

    try {
      // 1. Register Waiter Login Account on Server API so Garçom can log in with Email & Password
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
          pitchHz: Math.min(Math.max(Number(avgPitch.toFixed(1)), 45), 550),
          spectralCentroid: Math.min(Math.max(Number(avgCentroid.toFixed(1)), 100), 9500),
          voicePin: sanitizeString(newOpPin, VALIDATION_LIMITS.VOICE_PIN_MAX_LEN, ''),
          samplesCount,
        }),
      });

      const apiData = (await apiRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        operator?: VoiceOperator;
      };

      if (!apiRes.ok && apiData.error) {
        setFeedbackBanner({ type: 'error', message: apiData.error });
        setRegisteringWaiter(false);
        return;
      }

      const opId =
        apiData.operator?.id || `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const opPayload: VoiceOperator = {
        id: opId,
        ownerId: user.uid,
        operatorName: cleanName,
        email: cleanEmail,
        roleLabel: 'Garçom',
        storeName: currentStoreName,
        storeCode: currentStoreCode,
        pitchHz: Math.min(Math.max(Number(avgPitch.toFixed(1)), 45), 550),
        spectralCentroid: Math.min(Math.max(Number(avgCentroid.toFixed(1)), 100), 9500),
        voicePin: sanitizeString(newOpPin, VALIDATION_LIMITS.VOICE_PIN_MAX_LEN, ''),
        samplesCount,
        createdAt: makeLocalTimestamp(),
        updatedAt: makeLocalTimestamp(),
      };

      // Save Waiter Account in local backup so it works even across Render restarts
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
      setNewOpPin('');
      setTrainingSamples([]);
      if (trainingSamples.length > 0) {
        setRequireTrainedVoiceLock(true);
      }

      const msg = `Garçom ${cleanName} (${cleanEmail}) cadastrado pelo ADM! Ele já pode entrar com e-mail e senha (permissão: somente adicionar).`;
      setFeedbackBanner({ type: 'success', message: msg });
      speakAsMarcelo(`Garçom ${cleanName} cadastrado com sucesso.`, marceloVoiceReplyEnabled);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'voiceOperators');
    } finally {
      setRegisteringWaiter(false);
    }
  };

  // Delete Waiter Operator (STRICTLY ADM ONLY)
  const handleDeleteOperator = async (opId: string) => {
    if (!user || !isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Permissão negada: Somente o ADM pode remover garçons.',
      });
      return;
    }

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
      if (selectedWaiterId === opId) {
        setSelectedWaiterId('logged_user');
      }
      setFeedbackBanner({
        type: 'success',
        message: `Garçom ${targetOp?.operatorName || ''} removido pelo ADM.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `voiceOperators/${opId}`);
    }
  };

  // Undo last single or multi-customer launch in 1 click (STRICTLY ADM ONLY)
  const handleUndoLastLaunch = async () => {
    if (!lastUndo || !user) return;
    if (!isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Permissão negada: Garçom não pode remover ou desfazer itens. Solicite ao ADM.',
      });
      return;
    }

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
        message: `Lançamento desfeito pelo ADM: ${undoInfo.description}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tabItems');
    }
  };

  // Quick 1-Tap Add Menu Item to Selected Tab (Allowed for both ADM and Garçom)
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
          voiceTranscript: `Atalho rápido (+1 ${menuItem.name})`,
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
          voiceTranscript: `Atalho rápido (+1 ${menuItem.name})`,
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
        message: `+1 ${menuItem.name} adicionado para ${selectedTab.customerName} por ${activeWaiterDisplay.name}`,
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
        message: 'Permissão negada: O Garçom só pode adicionar itens. Somente o ADM pode remover itens da comanda.',
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

  // Create a new Open Comanda manually (Allowed for both ADM and Garçom)
  const handleCreateManualTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newCustomerName.trim()) return;

    const cleanName = sanitizeString(newCustomerName, VALIDATION_LIMITS.NAME_MAX_LEN);
    const cleanTable = sanitizeString(newTableLabel, VALIDATION_LIMITS.TABLE_MAX_LEN);
    const existing = activeStageTabs.find(
      (t) => normalizeText(t.customerName) === normalizeText(cleanName)
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
      `${currentStoreName.toUpperCase()} (${currentStoreCode})`,
      `EXTRATO DE CONTA - ASSISTENTE MARCELO`,
      `Cliente: ${tab.customerName}${tab.tableLabel ? ` (${tab.tableLabel})` : ''}`,
      `Estágio: ${STAGE_LABELS[tab.status]}`,
      `--------------------------------`,
      `PRODUTOS CONSUMIDOS:`,
    ];

    for (const group of consolidatedSelectedItems) {
      lines.push(
        `${group.totalQuantity}x ${group.itemName} (${formatBRL(group.unitPrice)}) = ${formatBRL(group.totalSubtotal)}`
      );
    }

    lines.push(`--------------------------------`);
    lines.push(`HISTÓRICO HORA A HORA E GARÇOM:`);
    for (const entry of [...selectedTabItems].reverse()) {
      lines.push(
        `[${formatTime(entry.createdAt)}] +${entry.quantity}x ${entry.itemName} | Garçom: ${entry.launchedByName || activeWaiterDisplay.name}`
      );
    }
    lines.push(`--------------------------------`);
    lines.push(`TOTAL CONSUMIDO: ${formatBRL(tab.totalAmount)}`);
    lines.push(`JÁ PAGO (BAIXAS): ${formatBRL(tab.paidAmount)}`);
    lines.push(`FALTA PAGAR: ${formatBRL(remaining)}`);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedReceipt(true);
    setTimeout(() => setCopiedReceipt(false), 2500);
  };

  // CARDÁPIO CRUD: Add or Edit Product in Bar Menu Catalog (ADM ONLY)
  const handleAddOrUpdateMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Permissão negada: Somente o ADM pode criar ou editar itens do cardápio.',
      });
      return;
    }

    const trimmedName = newMenuName.trim();
    const cleanedPriceStr = newMenuPrice.replace(/[R$\s]/g, '').replace(',', '.');
    const priceNum = parseFloat(cleanedPriceStr);

    if (!trimmedName || Number.isNaN(priceNum) || priceNum < 0) {
      setFeedbackBanner({
        type: 'error',
        message: 'Informe um nome válido para o produto e o preço (ex: 18,00).',
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

      // Update UI immediately so there is zero lag or race condition
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
        message: `Produto "${cleanName}" (${formatBRL(cleanPrice)}) ${actionWord} no cardápio com sucesso!`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `menuItems/${menuId}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
      setSavingMenu(false);
    }
  };

  // Start Editing an Existing Menu Item
  const handleStartEditMenuItem = (item: MenuItem) => {
    if (!isAdmin) return;
    setEditingMenuId(item.id);
    setNewMenuName(item.name);
    setNewMenuCategory(item.category);
    setNewMenuPrice(item.price.toFixed(2).replace('.', ','));
    setNewMenuSynonyms(item.synonyms || '');
  };

  // Delete Individual Product from Cardápio (ADM ONLY, Permanent without auto-reseeding!)
  const handleDeleteMenuItem = async (menuId: string) => {
    if (!user || !isAdmin) {
      setFeedbackBanner({
        type: 'error',
        message: 'Permissão negada: Somente o ADM pode remover produtos do cardápio.',
      });
      return;
    }

    isMutatingRef.current = true;
    lastMutationMsRef.current = Date.now();

    const targetItem = menuItems.find((m) => m.id === menuId);
    const nextMenu = menuItems.filter((m) => m.id !== menuId);

    // Immediately update UI state and mark catalog as initialized so it never auto-reseeds
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
        message: `Produto "${targetItem?.name || 'Item'}" removido do cardápio pelo ADM.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `menuItems/${menuId}`);
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // Clear All Menu Items so ADM can build custom menu from scratch (ADM ONLY)
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
        message: 'Cardápio limpo pelo ADM! Agora você pode cadastrar apenas os seus produtos.',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'menuItems');
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  // Restore Default Bar Menu Items (ADM ONLY)
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
        message: 'Cardápio padrão do bar restaurado com sucesso!',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'menuItems');
    } finally {
      lastMutationMsRef.current = Date.now();
      isMutatingRef.current = false;
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-sm text-slate-400">Inicializando Assistente Marcelo...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 max-w-[1440px] w-full mx-auto">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            Comanda Voz · Marcelo
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#login-email"
              onClick={() => setAuthTab('login')}
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Login (E-mail e Senha)
            </a>
            <a
              href="#login-email"
              onClick={() => setAuthTab('register_adm')}
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Cadastro ADM
            </a>
            <a
              href="#login-email"
              className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              Acesso Garçons
            </a>
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setAuthTab('register_adm')}
              className="px-3.5 py-2 text-xs font-semibold bg-slate-800 text-amber-400 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Criar Conta ADM
            </button>
            <button
              type="button"
              onClick={() => setAuthTab('login')}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Entrar com E-mail
            </button>
          </div>
        </header>

        <main className="max-w-[1200px] w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-medium text-amber-400 tracking-wide">
              Assistente Virtual Marcelo · Controle de Acesso ADM & Garçons
            </p>
            <h1
              className="text-3xl sm:text-5xl font-bold text-slate-50 tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Fale sem pausa: &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;.
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              O <strong>Administrador (ADM)</strong> cadastra o cardápio e cria o login (e-mail e
              senha) de cada <strong>Garçom</strong>. O garçom entra no celular dele e consegue{' '}
              <strong>somente adicionar</strong> pedidos — qualquer remoção ou exclusão é exclusiva
              do ADM.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Perfil ADM (Dono / Gerente)
                </div>
                <p className="text-slate-400">
                  Cadastra garçons com e-mail e senha, edita e deleta itens do cardápio, dá baixa e
                  pode remover itens de comandas.
                </p>
              </div>
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
                <div className="font-bold text-amber-400 flex items-center gap-1.5">
                  <Lock className="w-4 h-4" />
                  Perfil Garçom (Somente Adição)
                </div>
                <p className="text-slate-400">
                  Entra com o e-mail e senha criados pelo ADM. Lança pedidos por voz ou toque, mas
                  é bloqueado de remover qualquer item.
                </p>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoginBusy}
                className="px-4 py-2.5 text-xs font-semibold bg-slate-900 text-slate-300 border border-slate-800 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {googleLoginBusy ? 'Conectando ao Google...' : 'Opcional: Entrar com Google (ADM)'}
              </button>
            </div>

            {/* Diagnostic Panel when Google Login is blocked on onrender.com */}
            {googleAuthError && (
              <div className="p-4 bg-slate-900 border border-amber-500/60 rounded-xl space-y-2 text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-amber-300">
                      Aviso de Domínio Google ({googleAuthError.domain})
                    </p>
                    <p className="text-slate-300 leading-relaxed">{googleAuthError.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(googleAuthError.domain);
                      setCopiedDomain(true);
                      setTimeout(() => setCopiedDomain(false), 2500);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    {copiedDomain ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Domínio copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar domínio ({googleAuthError.domain}) para o Firebase
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Email & Password Login + ADM Account Creation */}
          <div
            id="login-email"
            className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5 text-xs"
          >
            {/* Segmented Tab Switcher: Entrar vs Criar Conta ADM */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthFormError(null);
                }}
                className={`py-2.5 px-3 rounded-md font-bold transition-colors cursor-pointer ${
                  authTab === 'login'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Entrar (E-mail e Senha)
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('register_adm');
                  setAuthFormError(null);
                }}
                className={`py-2.5 px-3 rounded-md font-bold transition-colors cursor-pointer ${
                  authTab === 'register_adm'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Criar Conta ADM
              </button>
            </div>

            {authFormError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-lg text-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{authFormError}</span>
              </div>
            )}

            {authTab === 'login' ? (
              <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100">
                    Acesso do ADM ou Garçom
                  </h2>
                  <p className="text-slate-400">
                    Digite seu e-mail e senha cadastrados para acessar as comandas do bar.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-amber-400" />
                    E-mail de Acesso
                  </label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="Ex: adm@bar.com ou garcom@bar.com"
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-medium flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    Senha
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Digite sua senha"
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
                  {authBusy ? 'Verificando credenciais...' : 'Entrar no Sistema'}
                </button>

                <div className="pt-2 border-t border-slate-800 text-center">
                  <span className="text-slate-400">Primeiro acesso do dono do bar? </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('register_adm');
                      setAuthFormError(null);
                    }}
                    className="text-amber-400 font-semibold hover:underline cursor-pointer"
                  >
                    Criar Conta ADM aqui
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterAdminAccount} className="space-y-3.5">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100">
                    Cadastrar Administrador (Dono do Bar)
                  </h2>
                  <p className="text-slate-400">
                    Crie sua conta ADM com e-mail e senha. Depois de entrar, você poderá cadastrar
                    os garçons e editar o cardápio.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 block font-medium">Nome do Administrador (ADM)</label>
                  <input
                    type="text"
                    value={regAdmName}
                    onChange={(e) => setRegAdmName(e.target.value)}
                    placeholder="Ex: Carlos (ADM)"
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
                    <label className="text-slate-300 block font-medium">Senha do ADM</label>
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
                    <label className="text-slate-300 block font-medium">Nome do Bar / Comércio</label>
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
                    <label className="text-slate-300 block font-medium">Código do Comércio</label>
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
                  {authBusy ? 'Criando Conta ADM...' : 'Criar Conta ADM e Entrar'}
                </button>
              </form>
            )}
          </div>
        </main>

        <footer className="border-t border-slate-900 px-6 py-4 text-center text-xs text-slate-500">
          Comanda Voz · Assistente Virtual Marcelo para Bares
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-slate-900/90 sticky top-0 z-30">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('comandas');
          }}
          className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
        >
          Comanda Voz · Marcelo
        </a>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            onClick={() => setActiveSection('comandas')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'comandas'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Comandas ({activeStageTabs.length})
          </button>
          <button
            onClick={() => setActiveSection('equipe_comercio')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'equipe_comercio'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Garçons & Comércio ({voiceOperators.length + 1})
          </button>
          <button
            onClick={() => setActiveSection('auditoria')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'auditoria'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Linha do Tempo ({tabItems.length})
          </button>
          <button
            onClick={() => setActiveSection('cardapio')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeSection === 'cardapio'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : 'hover:text-slate-100'
            }`}
          >
            Cardápio ({menuItems.length})
          </button>
        </nav>

        {/* Zone 3: Role Indicator + Sign Out */}
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold ${
              isAdmin
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                : 'bg-amber-950/80 text-amber-300 border border-amber-700/50'
            }`}
          >
            {isAdmin ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5" />
                ADM ({userProfile?.userName || directSession?.userName || 'Dono'})
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                GARÇOM ({directSession?.userName || userProfile?.userName || 'Somente Adição'})
              </>
            )}
          </span>
          <button
            onClick={handleSignOutAll}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1">
        {/* ASSISTENTE VIRTUAL "MARCELO" COMMAND CENTER */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-base sm:text-lg font-bold text-slate-50">
                  Assistente Marcelo — Pedidos Contínuos Sem Pausa & Proteção Anti-Erro
                </h1>
                <span className="text-xs text-slate-400">
                  · {isAdmin ? 'Modo ADM (Controle Total)' : 'Modo Garçom (Somente Adição — Sem Remoção)'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Fale direto sem pausa:{' '}
                <span className="text-slate-200 font-mono">
                  &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;
                </span>
              </p>
            </div>

            {/* Active Establishment (Comércio) + Waiter Attribution & KPI Strip */}
            <div className="flex flex-wrap items-center gap-4 text-xs border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800 shrink-0">
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-slate-400 block text-[11px]">
                  Comércio: <strong className="text-slate-200">{currentStoreName}</strong> ({currentStoreCode})
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-slate-400">Lançando como:</span>
                  {isAdmin ? (
                    <select
                      value={selectedWaiterId}
                      onChange={(e) => setSelectedWaiterId(e.target.value)}
                      className="bg-transparent text-amber-400 font-semibold focus:outline-none cursor-pointer"
                    >
                      <option value="logged_user" className="bg-slate-900 text-slate-100">
                        {userProfile?.userName || directSession?.userName || 'ADM'} (ADM)
                      </option>
                      {voiceOperators.map((op) => (
                        <option key={op.id} value={op.id} className="bg-slate-900 text-slate-100">
                          {op.operatorName} ({op.roleLabel})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-amber-400 font-bold">
                      {activeWaiterDisplay.name}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-7 w-px bg-slate-800 hidden sm:block" />
              <div>
                <span className="text-slate-400 block">A Receber</span>
                <span className="text-base font-bold text-amber-400 font-mono tabular-nums">
                  {formatBRL(barSummary.totalPendingBalance)}
                </span>
              </div>
              <div className="h-7 w-px bg-slate-800 hidden sm:block" />
              <div>
                <span className="text-slate-400 block">Baixado (Pago)</span>
                <span className="text-base font-bold text-emerald-400 font-mono tabular-nums">
                  {formatBRL(barSummary.totalPaidReceived)}
                </span>
              </div>
            </div>
          </div>

          {/* Voice Microphone Trigger + Direct Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (commandInput.trim()) {
                processOrderPhrase(commandInput, 'manual', true, null);
              }
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <button
              type="button"
              onClick={toggleVoiceRecognition}
              disabled={isProcessingCommand}
              className={`inline-flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isListening
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="w-5 h-5" />
                  Ouvindo &ldquo;Marcelo...&rdquo;
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
                  interimTranscript ? `${commandInput} ${interimTranscript}`.trim() : commandInput
                }
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder='Ex: "Marcelo, marca um litrão para Thiago, marca um litrão para Jonas" (sem pausa)'
                disabled={isProcessingCommand}
                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              {isProcessingCommand && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400 font-mono">
                  Marcelo analisando...
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={isProcessingCommand || !commandInput.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              Enviar Comando
            </button>
          </form>

          {/* Security & Assistant Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-800/80 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMarceloVoiceReplyEnabled((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  marceloVoiceReplyEnabled
                    ? 'bg-slate-950 border-amber-500/40 text-amber-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                {marceloVoiceReplyEnabled ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
                Voz do Marcelo: {marceloVoiceReplyEnabled ? 'Ligada' : 'Muda'}
              </button>

              <button
                type="button"
                onClick={() => setRequireWakeWordMarcelo((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  requireWakeWordMarcelo
                    ? 'bg-slate-950 border-sky-500/40 text-sky-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                Exigir chamar &ldquo;Marcelo&rdquo;: {requireWakeWordMarcelo ? 'Sim' : 'Não'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (voiceOperators.length === 0) {
                    setActiveSection('equipe_comercio');
                  } else {
                    setRequireTrainedVoiceLock((v) => !v);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  requireTrainedVoiceLock
                    ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                {requireTrainedVoiceLock ? (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
                )}
                Bloqueio de Voz Cadastrada:{' '}
                {requireTrainedVoiceLock
                  ? 'Ativo (Protegido)'
                  : voiceOperators.length === 0
                    ? 'Cadastrar Garçom / Voz'
                    : 'Desativado'}
              </button>

              <button
                type="button"
                onClick={() => setContinuousMode((prev) => !prev)}
                className={`px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  continuousMode
                    ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                Escuta Contínua: {continuousMode ? 'Ativa' : 'Desligada'}
              </button>
            </div>

            {lastSpeakerMatch && (
              <div className="text-slate-400 font-mono tabular-nums">
                Garçom reconhecido por voz:{' '}
                <strong className="text-slate-200">{lastSpeakerMatch.operatorName}</strong> (
                {lastSpeakerMatch.confidence}%)
              </div>
            )}
          </div>

          {/* 1-Click Test Voice Phrases Bar */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-slate-400 mr-1">
              Testar fala corrida e estágios:
            </span>
            {MARCELO_VOICE_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={isProcessingCommand}
                onClick={() => processOrderPhrase(example, 'manual', true, null)}
                className="px-2.5 py-1 text-xs bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                &ldquo;{example}&rdquo;
              </button>
            ))}
          </div>

          {/* MARCELO LIVE SPOKEN REPORT CARD */}
          {marceloReport && (
            <div className="p-4 bg-slate-950 border border-amber-500/50 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Volume2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm font-bold text-slate-100">
                    {marceloReport.title}
                  </span>
                  <span className="text-xs text-slate-400">
                    · {marceloReport.stageLabel} · Lançado por: {marceloReport.waiterAttribution}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => speakAsMarcelo(marceloReport.spokenSummary, true)}
                    className="px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 rounded cursor-pointer"
                  >
                    Ouvir Marcelo Novamente
                  </button>
                  {isAdmin && lastUndo && marceloReport.intent === 'MARCAR' && (
                    <button
                      type="button"
                      onClick={handleUndoLastLaunch}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Desfazer Lote (ADM)
                    </button>
                  )}
                </div>
              </div>

              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                &ldquo;{marceloReport.spokenSummary}&rdquo;
              </p>

              {marceloReport.itemsSummary.length > 0 && (
                <div className="text-xs text-slate-300 space-y-1">
                  <span className="text-slate-400 block">
                    Detalhamento separado por cliente:
                  </span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums text-amber-300">
                    {marceloReport.itemsSummary.map((line, idx) => (
                      <span key={idx}>• {line}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-slate-400 block font-sans">Total Consumido</span>
                  <span className="text-sm font-bold text-slate-100">
                    {formatBRL(marceloReport.totalConsumed)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-sans">Já Pago (Baixas)</span>
                  <span className="text-sm font-bold text-emerald-400">
                    {formatBRL(marceloReport.totalPaid)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-sans">Falta Pagar Agora</span>
                  <span className="text-sm font-bold text-amber-400">
                    {formatBRL(marceloReport.remainingBalance)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Feedback Banner */}
          {feedbackBanner && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border text-xs ${
                feedbackBanner.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-200'
                  : 'bg-red-950/50 border-red-800/70 text-red-200'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {feedbackBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span>{feedbackBanner.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-slate-400 hover:text-slate-200 text-[11px] underline cursor-pointer"
              >
                Fechar aviso
              </button>
            </div>
          )}
        </section>

        {/* SECTION 1: COMANDAS NOS 3 ESTÁGIOS */}
        {activeSection === 'comandas' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (5 cols): Comandas List with 3-Stage Segmented Control */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Comandas de {currentStoreName} ({filteredTabs.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Cada cliente falado sem pausa entra separado aqui
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewTabForm((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                  Nova Comanda
                </button>
              </div>

              {/* 3-Stage Interactive Filter Tabs */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setStageFilter('all')}
                  className={`py-1.5 px-2 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                  className={`py-1.5 px-2 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    stageFilter === 'open'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  1. Aberta ({stageCounts.open})
                </button>
                <button
                  type="button"
                  onClick={() => setStageFilter('closing')}
                  className={`py-1.5 px-2 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    stageFilter === 'closing'
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  2. Fechando ({stageCounts.closing})
                </button>
                <button
                  type="button"
                  onClick={() => setStageFilter('paid')}
                  className={`py-1.5 px-2 rounded font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    stageFilter === 'paid'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  3. Baixa ({stageCounts.paid})
                </button>
              </div>

              {showNewTabForm && (
                <form
                  onSubmit={handleCreateManualTab}
                  className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="Nome do cliente (ex: Thiago)"
                      required
                      maxLength={80}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                    <input
                      type="text"
                      value={newTableLabel}
                      onChange={(e) => setNewTableLabel(e.target.value)}
                      placeholder="Mesa/Local (ex: Mesa 4)"
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
                      className="px-3.5 py-1.5 text-xs font-semibold bg-amber-500 text-slate-950 rounded-md hover:bg-amber-400 cursor-pointer"
                    >
                      Abrir Comanda
                    </button>
                  </div>
                </form>
              )}

              {/* Search Comandas */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar cliente ou mesa..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
                />
              </div>

              {/* Comandas List */}
              {dataLoading ? (
                <div className="space-y-2.5 py-4">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-16 bg-slate-950 border border-slate-800/60 rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredTabs.length === 0 ? (
                <div className="text-center py-10 px-4 border border-dashed border-slate-800 rounded-lg space-y-2">
                  <p className="text-sm font-medium text-slate-300">
                    Nenhuma comanda neste estágio
                  </p>
                  <p className="text-xs text-slate-500">
                    Fale{' '}
                    <span className="text-slate-300 font-mono">
                      &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;
                    </span>{' '}
                    para abrir as comandas separadas.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
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
                            ? 'bg-slate-800/90 border-amber-500/70'
                            : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-100 truncate">
                              {tab.customerName}
                            </span>
                            {tab.tableLabel && (
                              <span className="text-xs text-slate-400">
                                · {tab.tableLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono tabular-nums">
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
                            </span>
                            <span>·</span>
                            <span>{tab.itemCount} un.</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 font-mono tabular-nums">
                          <div className="text-base font-bold text-amber-400">
                            {formatBRL(remaining)}
                          </div>
                          {tab.paidAmount > 0 ? (
                            <div className="text-[11px] text-emerald-400">
                              Já pagou {formatBRL(tab.paidAmount)}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              Total {formatBRL(tab.totalAmount)}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column (7 cols): Selected Comanda 3-Stage Control & Proof */}
            <div className="lg:col-span-7 space-y-6">
              {!selectedTab ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center space-y-3">
                  <Receipt className="w-8 h-8 text-amber-400 mx-auto" />
                  <h3 className="text-base font-semibold text-slate-200">
                    Nenhuma Comanda Selecionada
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Diga &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para
                    Jonas&rdquo; para criar as comandas separadas em tempo real.
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
                  {/* 3-Stage Stepper Header */}
                  <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        if (isDirectSession) {
                          const localTs = makeLocalTimestamp();
                          const nextTabs = tabs.map((t) =>
                            t.id === selectedTab.id
                              ? { ...t, status: 'open' as TabStageStatus, updatedAt: localTs }
                              : t
                          );
                          setTabs(nextTabs);
                          await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'add' });
                        } else {
                          await updateDoc(doc(db, 'tabs', selectedTab.id), {
                            status: 'open',
                            customerName: selectedTab.customerName,
                            tableLabel: selectedTab.tableLabel,
                            totalAmount: selectedTab.totalAmount,
                            paidAmount: selectedTab.paidAmount,
                            itemCount: selectedTab.itemCount,
                            updatedAt: serverTimestamp(),
                          });
                        }
                      }}
                      className={`py-2 px-3 rounded-md font-semibold text-left transition-colors cursor-pointer ${
                        selectedTab.status === 'open'
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      1. Abertura (Consumindo)
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        executeStage2Fechar(
                          selectedTab.customerName,
                          activeWaiterDisplay.name,
                          activeWaiterDisplay.storeName
                        )
                      }
                      className={`py-2 px-3 rounded-md font-semibold text-left transition-colors cursor-pointer ${
                        selectedTab.status === 'closing'
                          ? 'bg-sky-500 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      2. Fechando (Conferência)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setBaixaAmountInput(getRemainingBalance(selectedTab).toFixed(2));
                        setShowBaixaDrawer(true);
                      }}
                      className={`py-2 px-3 rounded-md font-semibold text-left transition-colors cursor-pointer ${
                        selectedTab.status === 'paid'
                          ? 'bg-emerald-500 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      3. Baixa (Pagamento)
                    </button>
                  </div>

                  {/* Comanda Customer Title & Financial Summary */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-50">
                          {selectedTab.customerName}
                        </h2>
                        {selectedTab.tableLabel && (
                          <span className="text-xs text-slate-400">
                            · {selectedTab.tableLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        {STAGE_LABELS[selectedTab.status]} · {selectedTab.itemCount} itens ·{' '}
                        {currentStoreName}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-right font-mono tabular-nums">
                        <span className="text-xs text-slate-400 block font-sans">
                          Total Consumido: {formatBRL(selectedTab.totalAmount)}
                        </span>
                        {selectedTab.paidAmount > 0 && (
                          <span className="text-xs text-emerald-400 block font-sans">
                            Já Pago (Baixas): - {formatBRL(selectedTab.paidAmount)}
                          </span>
                        )}
                        <span className="text-2xl font-bold text-amber-400 block">
                          Falta: {formatBRL(getRemainingBalance(selectedTab))}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyAuditReceipt(selectedTab)}
                          className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedReceipt ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Extrato
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            executeStage2Fechar(
                              selectedTab.customerName,
                              activeWaiterDisplay.name,
                              activeWaiterDisplay.storeName
                            )
                          }
                          className="px-3.5 py-2.5 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          2. Fechar / Ler Conta
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setBaixaAmountInput(getRemainingBalance(selectedTab).toFixed(2));
                            setShowBaixaDrawer((v) => !v);
                          }}
                          className="px-4 py-2.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          3. Dar Baixa
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* STAGE 3 DRAWER: DAR BAIXA */}
                  {showBaixaDrawer && (
                    <div className="p-4 bg-slate-950 border border-emerald-600/60 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                          <Banknote className="w-4 h-4" />
                          3º Estágio: Dar Baixa no Pagamento — {selectedTab.customerName}
                        </h3>
                        <span className="text-xs text-slate-400 font-mono tabular-nums">
                          Saldo devedor atual: {formatBRL(getRemainingBalance(selectedTab))}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                        <div className="space-y-1">
                          <label className="text-slate-400 block">
                            Valor Pago Agora (R$)
                          </label>
                          <input
                            type="text"
                            value={baixaAmountInput}
                            onChange={(e) => setBaixaAmountInput(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono tabular-nums font-bold"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400 block">Forma de Pagamento</label>
                          <select
                            value={selectedPaymentMethod}
                            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                          >
                            <option value="PIX">PIX</option>
                            <option value="Cartão de Débito">Cartão de Débito</option>
                            <option value="Cartão de Crédito">Cartão de Crédito</option>
                            <option value="Dinheiro">Dinheiro</option>
                          </select>
                        </div>

                        <div className="space-y-1 flex flex-col justify-end">
                          <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer py-2">
                            <input
                              type="checkbox"
                              checked={baixaKeepConsuming}
                              onChange={(e) => setBaixaKeepConsuming(e.target.checked)}
                              className="rounded border-slate-700"
                            />
                            Cliente continua consumindo
                          </label>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
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
                              activeWaiterDisplay.name,
                              activeWaiterDisplay.storeName
                            );
                          }}
                          className="px-5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                        >
                          Confirmar Baixa na Conta
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Consolidated Items Table */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                        Produtos Marcados na Conta de {selectedTab.customerName}
                      </h3>
                      <span className="text-xs text-slate-400">
                        {isAdmin
                          ? 'ADM: pode adicionar (+) ou remover (-)'
                          : 'Garçom: somente adicionar (+)'}
                      </span>
                    </div>

                    {consolidatedSelectedItems.length === 0 ? (
                      <div className="p-6 text-center bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-400">
                        Nenhum produto marcado ainda. Diga &ldquo;Marcelo, marque 1 litrão para{' '}
                        {selectedTab.customerName}&rdquo; ou toque em um item abaixo.
                      </div>
                    ) : (
                      <div className="border border-slate-800 rounded-lg overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                              <th className="py-2.5 px-3 font-medium">Produto</th>
                              <th className="py-2.5 px-3 font-medium text-right">Unitário</th>
                              <th className="py-2.5 px-3 font-medium text-center">Qtd</th>
                              <th className="py-2.5 px-3 font-medium text-right">Subtotal</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                            {consolidatedSelectedItems.map((group) => {
                              const latestEntry = group.entries[0];
                              return (
                                <tr key={group.key} className="hover:bg-slate-800/30">
                                  <td className="py-2.5 px-3">
                                    <div className="font-semibold text-slate-100">
                                      {group.itemName}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {CATEGORY_LABELS[group.category]} · Último por:{' '}
                                      {latestEntry.launchedByName || activeWaiterDisplay.name}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                                    {formatBRL(group.unitPrice)}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="flex items-center justify-center gap-2">
                                      {isAdmin && (
                                        <button
                                          type="button"
                                          onClick={() => handleAdjustTabItemQty(latestEntry, -1)}
                                          className="w-6 h-6 rounded bg-slate-800 hover:bg-red-900/60 text-slate-200 flex items-center justify-center cursor-pointer"
                                          title="ADM: Diminuir quantidade"
                                        >
                                          <Minus className="w-3 h-3" />
                                        </button>
                                      )}
                                      <span className="font-mono tabular-nums font-bold text-sm text-slate-100 w-7 text-center">
                                        {group.totalQuantity}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleAdjustTabItemQty(latestEntry, 1)}
                                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
                                        title="Adicionar +1 unidade"
                                      >
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-amber-400">
                                    {formatBRL(group.totalSubtotal)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Quick 1-Tap Counter Buttons */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-300">
                        Adicionar em 1 Toque para {selectedTab.customerName}:
                      </span>
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {(['todas', 'cervejas', 'doses', 'porcoes', 'sem_alcool'] as const).map(
                          (cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setCategoryFilter(cat)}
                              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                categoryFilter === cat
                                  ? 'bg-slate-800 text-amber-400'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {cat === 'todas' ? 'Todos' : CATEGORY_LABELS[cat]}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {menuItems
                        .filter(
                          (m) => categoryFilter === 'todas' || m.category === categoryFilter
                        )
                        .slice(0, 12)
                        .map((item) => (
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

                  {/* Chronological Voice, Waiter & Store Proof Log */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        Prova de Consumo & Garçom Responsável ({selectedTabItems.length} registros)
                      </h3>
                      <span className="text-[11px] text-slate-400">
                        {isAdmin
                          ? 'ADM pode excluir lançamentos incorretos'
                          : 'Somente o ADM pode remover lançamentos'}
                      </span>
                    </div>

                    {selectedTabItems.length > 0 && (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {selectedTabItems.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-950 border border-slate-800/80 rounded-lg text-xs"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono tabular-nums text-slate-400">
                                  {formatTime(entry.createdAt)}
                                </span>
                                <span className="font-semibold text-slate-100">
                                  +{entry.quantity}x {entry.itemName}
                                </span>
                                <span className="text-slate-400">
                                  · Garçom:{' '}
                                  <strong className="text-amber-300">
                                    {entry.launchedByName || activeWaiterDisplay.name}
                                  </strong>
                                </span>
                              </div>
                              {entry.voiceTranscript && (
                                <p className="text-[11px] text-slate-400 truncate">
                                  Frase: &ldquo;{entry.voiceTranscript}&rdquo; (
                                  {entry.storeName || currentStoreName})
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="font-mono tabular-nums font-semibold text-slate-200">
                                {formatBRL(entry.totalPrice)}
                              </span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleAdjustTabItemQty(entry, -entry.quantity)}
                                  className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                                  title="ADM: Remover este lançamento"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 2: GARÇONS, USUÁRIOS & COMÉRCIO + CADASTRO DE GARÇOM PELO ADM */}
        {activeSection === 'equipe_comercio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: ADM Store Settings & ADM Waiter Registration (Email + Password + Voice) */}
            <div className="lg:col-span-5 space-y-6">
              {isAdmin ? (
                <>
                  {/* Store & ADM User Card */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                        <Store className="w-5 h-5 text-amber-400" />
                        Configurações do Comércio e Administrador (ADM)
                      </h2>
                      <p className="text-xs text-slate-400">
                        Defina o nome e código do seu bar/comércio e seus dados de ADM
                      </p>
                    </div>

                    <form onSubmit={handleSaveUserProfile} className="space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-slate-300 block">Nome do Comércio / Bar</label>
                          <input
                            type="text"
                            value={profileStoreName}
                            onChange={(e) => setProfileStoreName(e.target.value)}
                            placeholder="Ex: Bar do Zé"
                            required
                            maxLength={80}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-300 block">Código do Comércio</label>
                          <input
                            type="text"
                            value={profileStoreCode}
                            onChange={(e) => setProfileStoreCode(e.target.value)}
                            placeholder="Ex: BAR-01"
                            required
                            maxLength={30}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-slate-300 block">Nome do Administrador (ADM)</label>
                        <input
                          type="text"
                          value={profileUserName}
                          onChange={(e) => setProfileUserName(e.target.value)}
                          placeholder="Ex: Carlos Silva"
                          required
                          maxLength={60}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        {savingProfile ? 'Salvando...' : 'Atualizar Dados do Comércio'}
                      </button>
                    </form>
                  </div>

                  {/* ADM Register Waiter Form (Email & Password + Optional Voice) */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-amber-400" />
                        Cadastrar Garçom (E-mail, Senha e Voz)
                      </h2>
                      <p className="text-xs text-slate-400">
                        Crie o e-mail e senha para o garçom entrar no sistema. O garçom cadastrado{' '}
                        <strong className="text-amber-300">só consegue adicionar itens</strong> (não
                        remove nada).
                      </p>
                    </div>

                    <form onSubmit={handleSaveTrainedOperator} className="space-y-3.5 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <label className="text-slate-300 block font-medium">
                            Nome do Garçom *
                          </label>
                          <input
                            type="text"
                            value={newOpName}
                            onChange={(e) => setNewOpName(e.target.value)}
                            placeholder="Ex: Rodrigo"
                            required
                            maxLength={60}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-300 block font-medium">
                            PIN Falado (Opcional)
                          </label>
                          <input
                            type="text"
                            value={newOpPin}
                            onChange={(e) => setNewOpPin(e.target.value)}
                            placeholder="Ex: 10"
                            maxLength={20}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <label className="text-slate-300 block font-medium">
                            E-mail de Login do Garçom *
                          </label>
                          <input
                            type="email"
                            value={newOpEmail}
                            onChange={(e) => setNewOpEmail(e.target.value)}
                            placeholder="Ex: rodrigo@bar.com"
                            required
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-300 block font-medium">
                            Senha do Garçom *
                          </label>
                          <input
                            type="text"
                            value={newOpPassword}
                            onChange={(e) => setNewOpPassword(e.target.value)}
                            placeholder="Mínimo 4 dígitos"
                            required
                            minLength={4}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                          />
                        </div>
                      </div>

                      {/* Optional Voice Sample Recording Steps */}
                      <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                            <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
                            Treinamento Vocal Opcional ({trainingSamples.length}/3 amostras)
                          </span>
                          {trainingSamples.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setTrainingSamples([])}
                              className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                            >
                              Limpar voz
                            </button>
                          )}
                        </div>

                        <p className="text-slate-400 text-[11px]">
                          Opcional: grave a voz do garçom lendo:{' '}
                          <strong className="text-amber-300 font-mono">
                            &ldquo;{TRAINING_PHRASES[Math.min(trainingSamples.length, 2)]}&rdquo;
                          </strong>
                        </p>

                        <button
                          type="button"
                          disabled={isRecordingSample || trainingSamples.length >= 3}
                          onClick={handleRecordTrainingSample}
                          className={`w-full py-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                            isRecordingSample
                              ? 'bg-red-600 text-white'
                              : trainingSamples.length >= 3
                                ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          <Mic className="w-3.5 h-3.5" />
                          {isRecordingSample
                            ? 'Gravando voz do garçom...'
                            : trainingSamples.length >= 3
                              ? '3 Amostras de Voz Gravadas!'
                              : `Gravar Amostra de Voz (${trainingSamples.length}/3)`}
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={
                          registeringWaiter ||
                          !newOpName.trim() ||
                          !newOpEmail.trim() ||
                          newOpPassword.trim().length < 4
                        }
                        className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        {registeringWaiter
                          ? 'Cadastrando Garçom...'
                          : `Cadastrar Garçom no Comércio (${currentStoreCode})`}
                      </button>
                    </form>
                  </div>
                </>
              ) : (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <Lock className="w-4 h-4" />
                    Área Exclusiva do Administrador (ADM)
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    Você está conectado como <strong>Garçom ({directSession?.userName})</strong> no
                    comércio <strong>{currentStoreName}</strong>.
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    • Sua conta tem permissão para <strong>adicionar pedidos</strong> nas comandas
                    por voz ou toque rápido.
                    <br />• Somente o <strong>ADM</strong> pode cadastrar/remover garçons, alterar o
                    cardápio ou remover itens de comandas.
                  </p>
                </div>
              )}
            </div>

            {/* Right Column: Registered Waiters & Store Attribution Table */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Equipe Cadastrada no Comércio ({voiceOperators.length + 1})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Comércio: <strong className="text-amber-400">{currentStoreName}</strong> ·
                    Código: <strong className="font-mono text-slate-200">{currentStoreCode}</strong>
                  </p>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Usuário / Garçom</th>
                      <th className="py-2.5 px-4 font-medium">E-mail de Login</th>
                      <th className="py-2.5 px-4 font-medium">Permissão</th>
                      <th className="py-2.5 px-4 font-medium text-right">Lançamentos</th>
                      <th className="py-2.5 px-4 font-medium text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                    {/* Logged-in Primary User Row */}
                    <tr className="bg-slate-900/50">
                      <td className="py-2.5 px-4 font-semibold text-slate-100">
                        {userProfile?.userName || directSession?.userName || 'Operador'}
                        <span className="block text-[11px] text-amber-400 font-normal">
                          Sessão Atual ({isAdmin ? 'ADM' : 'Garçom'})
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 font-mono">
                        {directSession?.email || user.email || '—'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isAdmin
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                              : 'bg-amber-950 text-amber-300 border border-amber-700/50'
                          }`}
                        >
                          {isAdmin ? 'ADM (Adiciona e Remove)' : 'Garçom (Somente Adiciona)'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-200">
                        {
                          tabItems.filter((i) =>
                            (i.launchedByName || '').includes(
                              userProfile?.userName || directSession?.userName || 'Operador'
                            )
                          ).length
                        }{' '}
                        itens
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="text-[11px] text-emerald-400 font-semibold">Conectado</span>
                      </td>
                    </tr>

                    {/* Enrolled Waiters */}
                    {voiceOperators.map((op) => {
                      const launchedCount = tabItems.filter((i) =>
                        (i.launchedByName || '').includes(op.operatorName)
                      ).length;
                      const isActive = selectedWaiterId === op.id;

                      return (
                        <tr key={op.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-4 font-semibold text-slate-100">
                            {op.operatorName}
                            <span className="block text-[11px] text-slate-400 font-normal">
                              {op.roleLabel} {op.voicePin ? `· PIN: ${op.voicePin}` : ''}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-300 font-mono">
                            {op.email || 'Voz local'}
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300">
                              Somente Adicionar
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-200">
                            {launchedCount} itens
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-2">
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setSelectedWaiterId(op.id)}
                                  className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                                    isActive
                                      ? 'bg-amber-500 text-slate-950'
                                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                  }`}
                                >
                                  {isActive ? 'Ativo' : 'Testar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOperator(op.id)}
                                  className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                                  title="ADM: Remover garçom"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline" />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: LINHA DO TEMPO DE VOZ (AUDITORIA POR GARÇOM E COMÉRCIO) */}
        {activeSection === 'auditoria' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <History className="w-4 h-4 text-amber-400" />
                  Auditoria de Lançamentos por Garçom e Comércio
                </h2>
                <p className="text-xs text-slate-400">
                  Saiba exatamente quem lançou cada produto, em qual comércio e para qual cliente
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">Filtrar por Garçom:</span>
                <select
                  value={waiterFilter}
                  onChange={(e) => setWaiterFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
                >
                  <option value="todos">Todos os Garçons ({tabItems.length})</option>
                  {distinctWaitersInLog.map((wName) => (
                    <option key={wName} value={wName}>
                      {wName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredAuditTabItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-lg">
                Nenhum lançamento encontrado para este filtro.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Horário</th>
                      <th className="py-2.5 px-4 font-medium">Garçom / Usuário</th>
                      <th className="py-2.5 px-4 font-medium">Comércio</th>
                      <th className="py-2.5 px-4 font-medium">Cliente</th>
                      <th className="py-2.5 px-4 font-medium">Produto Marcado</th>
                      <th className="py-2.5 px-4 font-medium">Frase Falada</th>
                      <th className="py-2.5 px-4 font-medium text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                    {filteredAuditTabItems.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">
                          {formatTime(entry.createdAt)}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-amber-300">
                          {entry.launchedByName || activeWaiterDisplay.name}
                        </td>
                        <td className="py-2.5 px-4 text-slate-300">
                          {entry.storeName || currentStoreName}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-100">
                          {entry.customerName}
                        </td>
                        <td className="py-2.5 px-4 text-slate-200">
                          {entry.quantity}x {entry.itemName}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 italic">
                          &ldquo;{entry.voiceTranscript}&rdquo;
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-amber-400">
                          {formatBRL(entry.totalPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SECTION 4: CARDÁPIO & PREÇOS DO BAR (CRUD COMPLETO PARA O ADM) */}
        {activeSection === 'cardapio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              {isAdmin ? (
                <>
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <Utensils className="w-4 h-4 text-amber-400" />
                      {editingMenuId ? 'Editar Produto do Cardápio' : 'Criar Novo Produto no Cardápio'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      Adicione ou edite seus produtos. O Marcelo reconhece automaticamente pelo nome
                      ou apelidos de voz.
                    </p>
                  </div>

                  <form onSubmit={handleAddOrUpdateMenuItem} className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Nome do Produto *</label>
                      <input
                        type="text"
                        value={newMenuName}
                        onChange={(e) => setNewMenuName(e.target.value)}
                        placeholder="Ex: Litrão Antarctica 1L"
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
                        Apelidos de Voz (opcional, separados por vírgula)
                      </label>
                      <input
                        type="text"
                        value={newMenuSynonyms}
                        onChange={(e) => setNewMenuSynonyms(e.target.value)}
                        placeholder="Ex: litrão, antarctica, litrão azul"
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
                            ? 'Salvar Alterações do Produto'
                            : 'Adicionar Produto ao Cardápio'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <Lock className="w-4 h-4" />
                    Cardápio Protegido pelo ADM
                  </div>
                  <p className="text-slate-400 leading-relaxed">
                    Somente o <strong>Administrador (ADM)</strong> pode criar, editar ou excluir
                    produtos e preços do cardápio.
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Produtos no Cardápio ({menuItems.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isAdmin
                      ? 'Clique no ícone de lápis para editar ou na lixeira para deletar permanentemente'
                      : 'Consulta de preços e apelidos de voz'}
                  </p>
                </div>

                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {menuItems.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllMenuItems}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/70 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Limpar Todo o Cardápio
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRestoreDefaultMenu}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restaurar Cardápio Padrão
                    </button>
                  </div>
                )}
              </div>

              {menuItems.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg space-y-3 text-xs">
                  <p className="text-slate-300 font-semibold">
                    Seu cardápio está vazio no momento.
                  </p>
                  <p className="text-slate-400">
                    Cadastre seus produtos usando o formulário ao lado ou clique em &ldquo;Restaurar
                    Cardápio Padrão&rdquo;.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 px-4 font-medium">Produto</th>
                        <th className="py-2.5 px-4 font-medium">Categoria</th>
                        <th className="py-2.5 px-4 font-medium">Apelidos Reconhecidos</th>
                        <th className="py-2.5 px-4 font-medium text-right">Preço</th>
                        {isAdmin && (
                          <th className="py-2.5 px-4 font-medium text-right">Ações (ADM)</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                      {menuItems.map((item) => (
                        <tr
                          key={item.id}
                          className={`hover:bg-slate-800/30 ${
                            editingMenuId === item.id ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-4 font-semibold text-slate-100">{item.name}</td>
                          <td className="py-2.5 px-4 text-slate-400">
                            {CATEGORY_LABELS[item.category]}
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
                                <Edit3 className="w-3.5 h-3.5 inline" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMenuItem(item.id)}
                                className="text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                                title="Excluir produto do cardápio"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
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
