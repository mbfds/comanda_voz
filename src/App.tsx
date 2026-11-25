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
  increment,
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
  Bluetooth,
  Radio,
  AudioLines,
  Users,
  Ban,
  Unlock,
  BarChart3,
  Award,
  Printer,
  LayoutGrid,
  List,
  Wallet,
  ShoppingBag,
  Calendar,
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
  ParsedVoiceMenuProduct,
  ParsedVoiceMenuResult,
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
  computeCustomerNameSimilarity,
  DEFAULT_BAR_MENU,
  extractCommandAfterMarceloWakeWord,
  formatBRL,
  formatThermalCashClosingText,
  formatThermalReceiptText,
  isMenuRegistrationVoiceCommand,
  normalizePhoneticPt,
  normalizeProductText,
  normalizeText,
  parseVoiceMenuProductsLocally,
  parseVoiceOrderLocally,
  sanitizeCategory,
  sanitizeStoreCode,
  sanitizeString,
  STAGE_LABELS,
  VALIDATION_LIMITS,
} from './utils/barCatalog';
import {
  AcousticSample,
  AudioInputDeviceOption,
  captureVoiceBiometricSample,
  describeVoiceCaptureError,
  isInsideEmbeddedIframe,
  LiveAcousticTracker,
  listAudioInputDevices,
  matchSpeakerAgainstOperators,
  speakAsMarcelo,
} from './utils/voiceBiometrics';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SalesDashboard } from './components/SalesDashboard';

// Web Speech API Type Declarations
interface SpeechRecognitionEvent extends Event {
  resultIndex?: number;
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
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type ActiveSection = 'comandas' | 'caixa' | 'cardapio' | 'vendas' | 'equipe_comercio' | 'superadmin';

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

type SubscriptionStatusType = 'em_dia' | 'pendente' | 'atrasado' | 'bloqueado';

interface SuperAdminAccountSummary {
  uid: string;
  email: string;
  userName: string;
  userRole: 'SUPERADMIN' | 'ADM' | 'Garçom';
  storeName: string;
  storeCode: string;
  monthlyFee?: number;
  subscriptionStatus?: SubscriptionStatusType;
  billingDueDate?: string;
  lastPaymentAtMs?: number;
  createdAtMs: number;
}

interface SuperAdminStoreSummary {
  storeCode: string;
  storeName: string;
  tabsCount: number;
  totalConsumed: number;
  menuCount: number;
  operatorsCount: number;
  admCount?: number;
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
  intent: 'MARCAR' | 'FECHAR' | 'BAIXA' | 'VENDA_AVULSA' | 'CADASTRO_MENU';
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
  {
    stage: '4. Venda Avulsa',
    phrase: 'Marcelo, venda avulsa de litrão no pix',
  },
];

function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTimestampMillis(ts: unknown): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
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

  // Store Profile Form & ADM Settings
  const [profileUserName, setProfileUserName] = useState('');
  const [profileUserRole, setProfileUserRole] = useState<UserRoleType>('ADM');
  const [profileStoreName, setProfileStoreName] = useState('');
  const [profileStoreCode, setProfileStoreCode] = useState('');
  const [autoArchivePaidAfter10Min, setAutoArchivePaidAfter10Min] = useState<boolean>(false);
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

  const canAccessCaixa = useMemo(
    () => isAdmin || currentUserRole === 'Gerente' || currentUserRole === 'Caixa',
    [isAdmin, currentUserRole]
  );

  // Marcelo Assistant & Open-Microphone ("MARCELO" Wake-Word + Bluetooth + Biometrics) State
  const [commandInput, setCommandInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [marceloVoiceReplyEnabled, setMarceloVoiceReplyEnabled] = useState(true);
  const [openMicWakeWordMode, setOpenMicWakeWordMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('comanda_voz_wake_word_mode');
      return saved ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [marceloAwakeWindowActive, setMarceloAwakeWindowActive] = useState(false);
  const [lastIgnoredOpenMicPhrase, setLastIgnoredOpenMicPhrase] = useState('');
  const [audioDevices, setAudioDevices] = useState<AudioInputDeviceOption[]>([]);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem('comanda_voz_selected_mic_id') || 'default';
    } catch {
      return 'default';
    }
  });
  const [showVoiceConfigBar, setShowVoiceConfigBar] = useState(false);
  const [lastVoiceCompatibility, setLastVoiceCompatibility] = useState<{
    operatorName: string;
    confidence: number;
    pitchHz: number;
  } | null>(null);

  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [marceloReport, setMarceloReport] = useState<MarceloReportCard | null>(null);
  const [lastUndo, setLastUndo] = useState<LastActionUndo | null>(null);

  // Selected Tab, Table Map, Category Filters, Venda Avulsa & Caixa State
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<'all' | 'open' | 'closing' | 'paid'>('all');
  const [comandasViewMode, setComandasViewMode] = useState<'lista' | 'mesas'>('lista');
  const [quickAddCategoryFilter, setQuickAddCategoryFilter] = useState<'all' | ItemCategory>('all');
  const [cardapioCategoryFilter, setCardapioCategoryFilter] = useState<'all' | ItemCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedReceipt, setCopiedReceipt] = useState(false);

  // Venda Avulsa (Walk-in / Counter Sale — No Customer Tab) & Caixa Fechamento State
  const [showQuickVendaAvulsa, setShowQuickVendaAvulsa] = useState(false);
  const [avulsaMenuId, setAvulsaMenuId] = useState('');
  const [avulsaQty, setAvulsaQty] = useState(1);
  const [avulsaPaymentMethod, setAvulsaPaymentMethod] = useState('PIX');
  const [caixaDateKey, setCaixaDateKey] = useState(() => toLocalDateInputValue(new Date()));

  // New Tab Inline Form
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newTableLabel, setNewTableLabel] = useState('');
  const [showNewTabForm, setShowNewTabForm] = useState(false);

  // Baixa (Payment Stage 3) Drawer State
  const [showBaixaDrawer, setShowBaixaDrawer] = useState(false);
  const [baixaAmountInput, setBaixaAmountInput] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('PIX');
  const [baixaKeepConsuming, setBaixaKeepConsuming] = useState(false);

  // ADM Waiter Registration & Voice Calibration State
  const [newOpName, setNewOpName] = useState('');
  const [newOpEmail, setNewOpEmail] = useState('');
  const [newOpPassword, setNewOpPassword] = useState('');
  const [newOpVoiceSample, setNewOpVoiceSample] = useState<AcousticSample | null>(null);
  const [capturingNewOpVoice, setCapturingNewOpVoice] = useState(false);
  const [calibratingOpId, setCalibratingOpId] = useState<string | null>(null);
  const [togglingAccessOpId, setTogglingAccessOpId] = useState<string | null>(null);
  const [testingCompatibility, setTestingCompatibility] = useState(false);
  const [registeringWaiter, setRegisteringWaiter] = useState(false);

  // Cardápio (Menu Item) Create & Edit Form State + Voice Registration
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState<ItemCategory>('cervejas');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuSynonyms, setNewMenuSynonyms] = useState('');
  const [savingMenu, setSavingMenu] = useState(false);
  const [isListeningMenuVoice, setIsListeningMenuVoice] = useState(false);
  const [menuVoiceInterim, setMenuVoiceInterim] = useState('');
  const [menuVoiceProcessing, setMenuVoiceProcessing] = useState(false);
  const menuRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const printReceiptPreRef = useRef<HTMLPreElement | null>(null);

  // SUPERADMIN State (All Accounts, All Stores, Master Recovery Key, SaaS Billing)
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
  const [saRoleFilter, setSaRoleFilter] = useState<'all' | 'ADM' | 'Garçom' | 'inadimplentes'>('all');
  const [editingBillingEmail, setEditingBillingEmail] = useState<string | null>(null);
  const [billingFeeInput, setBillingFeeInput] = useState('99,90');
  const [billingDueInput, setBillingDueInput] = useState('Todo dia 10');
  const [billingStatusInput, setBillingStatusInput] = useState<SubscriptionStatusType>('em_dia');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const marceloAwakeUntilMsRef = useRef(0);
  const liveAcousticTrackerRef = useRef<LiveAcousticTracker | null>(null);
  const openMicWakeWordModeRef = useRef(openMicWakeWordMode);
  const consecutiveSpeechErrorsRef = useRef(0);
  const restartSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    openMicWakeWordModeRef.current = openMicWakeWordMode;
    try {
      localStorage.setItem('comanda_voz_wake_word_mode', String(openMicWakeWordMode));
    } catch {
      // ignore
    }
  }, [openMicWakeWordMode]);

  const refreshAudioDevices = async (requestPermission = false) => {
    const devs = await listAudioInputDevices(requestPermission);
    setAudioDevices(devs);
    // Auto-select Bluetooth microphone if newly connected and user hasn't locked another device
    const btDev = devs.find((d) => d.isBluetooth);
    if (btDev && (selectedMicDeviceId === 'default' || !devs.some((d) => d.deviceId === selectedMicDeviceId))) {
      setSelectedMicDeviceId(btDev.deviceId);
      try {
        localStorage.setItem('comanda_voz_selected_mic_id', btDev.deviceId);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    refreshAudioDevices(false);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      const onDeviceChange = () => refreshAudioDevices(false);
      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      };
    }
  }, []);

  // Helper to persist Store snapshot to localStorage + Express server with RBAC headers
  const syncDirectStoreSnapshot = async (nextData: {
    storeCode?: string;
    storeName?: string;
    autoArchivePaidAfter10Min?: boolean;
    menuItems?: MenuItem[];
    tabs?: BarTab[];
    tabItems?: TabItem[];
    voiceOperators?: VoiceOperator[];
    actionType?: 'add' | 'remove' | 'catalog';
    removedTabItemIds?: string[];
    removedTabIds?: string[];
    removedMenuIds?: string[];
    removedOperatorIds?: string[];
    clearedAllMenu?: boolean;
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
    const nextAutoArchive =
      typeof nextData.autoArchivePaidAfter10Min === 'boolean'
        ? nextData.autoArchivePaidAfter10Min
        : autoArchivePaidAfter10Min;
    const updatedMenu = nextData.menuItems ?? menuItems;
    const updatedTabs = nextData.tabs ?? tabs;
    const updatedTabItems = nextData.tabItems ?? tabItems;
    const updatedOperators = nextData.voiceOperators ?? voiceOperators;

    const mutatedScopes: Array<'tabs' | 'tabItems' | 'menuItems' | 'voiceOperators'> = [];
    if (nextData.tabs !== undefined) mutatedScopes.push('tabs');
    if (nextData.tabItems !== undefined) mutatedScopes.push('tabItems');
    if (nextData.menuItems !== undefined) mutatedScopes.push('menuItems');
    if (nextData.voiceOperators !== undefined) mutatedScopes.push('voiceOperators');

    const payload = {
      storeCode: code,
      storeName: sName,
      catalogInitialized: true,
      autoArchivePaidAfter10Min: nextAutoArchive,
      menuItems: updatedMenu,
      tabs: updatedTabs,
      tabItems: updatedTabItems,
      voiceOperators: updatedOperators,
      callerRole: isAdmin ? 'ADM' : 'Garçom',
      callerEmail: directSession?.email || user?.email || '',
      callerUid: directSession?.uid || user?.uid || '',
      callerName: userProfile?.userName || directSession?.userName || '',
      actionType: nextData.actionType || 'add',
      mutatedScopes,
      removedTabItemIds: nextData.removedTabItemIds,
      removedTabIds: nextData.removedTabIds,
      removedMenuIds: nextData.removedMenuIds,
      removedOperatorIds: nextData.removedOperatorIds,
      clearedAllMenu: nextData.clearedAllMenu,
      updatedAtMs: Date.now(),
    };

    try {
      localStorage.setItem(`comanda_voz_store_${code}`, JSON.stringify(payload));
      localStorage.setItem(`comanda_voz_catalog_init_${code}`, 'true');
    } catch {
      // ignore storage quota errors
    }

    try {
      const response = await fetch(`/api/store/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const resData = (await response.json()) as {
          ok?: boolean;
          snapshot?: {
            autoArchivePaidAfter10Min?: boolean;
            menuItems?: MenuItem[];
            tabs?: BarTab[];
            tabItems?: TabItem[];
            voiceOperators?: VoiceOperator[];
          };
        };
        if (resData.snapshot) {
          if (typeof resData.snapshot.autoArchivePaidAfter10Min === 'boolean') {
            setAutoArchivePaidAfter10Min(resData.snapshot.autoArchivePaidAfter10Min);
          }
          if (Array.isArray(resData.snapshot.menuItems)) {
            setMenuItems(resData.snapshot.menuItems);
          }
          if (Array.isArray(resData.snapshot.tabs)) {
            setTabs(resData.snapshot.tabs);
          }
          if (Array.isArray(resData.snapshot.tabItems)) {
            setTabItems(resData.snapshot.tabItems);
          }
          if (Array.isArray(resData.snapshot.voiceOperators)) {
            setVoiceOperators(resData.snapshot.voiceOperators);
          }
          try {
            localStorage.setItem(
              `comanda_voz_store_${code}`,
              JSON.stringify(resData.snapshot)
            );
          } catch {
            // ignore storage quota errors
          }
        }
      }
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
      if (!isInitial && (isMutatingRef.current || Date.now() - lastMutationMsRef.current < 1500)) {
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
            autoArchivePaidAfter10Min?: boolean;
            menuItems?: MenuItem[];
            tabs?: BarTab[];
            tabItems?: TabItem[];
            voiceOperators?: VoiceOperator[];
          };

          if (
            !isCancelled &&
            !isMutatingRef.current &&
            Date.now() - lastMutationMsRef.current >= (isInitial ? 0 : 1500) &&
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
            if (typeof data.autoArchivePaidAfter10Min === 'boolean') {
              setAutoArchivePaidAfter10Min(data.autoArchivePaidAfter10Min);
            }
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
              autoArchivePaidAfter10Min?: boolean;
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

            if (typeof parsed.autoArchivePaidAfter10Min === 'boolean') {
              setAutoArchivePaidAfter10Min(parsed.autoArchivePaidAfter10Min);
            }
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
    }, 2500);

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
          setAutoArchivePaidAfter10Min(Boolean(loaded.autoArchivePaidAfter10Min));
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

  // Real-time check: did the ADM block this logged-in waiter from making new launches?
  const isCurrentWaiterBlocked = useMemo(() => {
    if (isAdmin || currentUserRole !== 'Garçom') return false;
    const myEmail = (directSession?.email || user?.email || '').trim().toLowerCase();
    const myUid = directSession?.uid || user?.uid || '';
    const myName = normalizeText(userProfile?.userName || directSession?.userName || '');
    return voiceOperators.some((op) => {
      if (!op.accessBlocked) return false;
      const matchUid = myUid && op.id === myUid;
      const matchEmail = myEmail && (op.email || '').trim().toLowerCase() === myEmail;
      const matchName = myName && normalizeText(op.operatorName) === myName;
      return Boolean(matchUid || matchEmail || matchName);
    });
  }, [isAdmin, currentUserRole, voiceOperators, directSession, user, userProfile]);

  useEffect(() => {
    if (isCurrentWaiterBlocked && isListening) {
      shouldKeepListeningRef.current = false;
      marceloAwakeUntilMsRef.current = 0;
      setMarceloAwakeWindowActive(false);
      recognitionRef.current?.stop();
      liveAcousticTrackerRef.current?.stop();
      liveAcousticTrackerRef.current = null;
      setIsListening(false);
    }
  }, [isCurrentWaiterBlocked, isListening]);

  // Auto-archive settled ('paid') tabs 10 minutes after payment when enabled in ADM settings
  useEffect(() => {
    if (!autoArchivePaidAfter10Min || !user || !isAdmin) return;

    const TEN_MINUTES_MS = 10 * 60 * 1000;

    const runAutoArchiveCheck = async () => {
      if (isMutatingRef.current) return;
      const nowMs = Date.now();
      const expiredPaidTabs = tabs.filter(
        (t) =>
          t.tableLabel !== 'VENDA_AVULSA' &&
          t.status === 'paid' &&
          getRemainingBalance(t) <= 0 &&
          nowMs - getTimestampMillis(t.updatedAt) >= TEN_MINUTES_MS
      );

      if (expiredPaidTabs.length === 0) return;

      const expiredIds = new Set(expiredPaidTabs.map((t) => t.id));
      try {
        if (isDirectSession) {
          const localTs = makeLocalTimestamp();
          const nextTabs = tabs.map((t) =>
            expiredIds.has(t.id)
              ? { ...t, status: 'archived' as TabStageStatus, updatedAt: localTs }
              : t
          );
          setTabs(nextTabs);
          await syncDirectStoreSnapshot({ tabs: nextTabs, actionType: 'remove' });
        } else {
          const batch = writeBatch(db);
          for (const t of expiredPaidTabs) {
            batch.update(doc(db, 'tabs', t.id), {
              status: 'archived',
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
        }
      } catch (err) {
        console.warn('[AutoArchive] Falha ao arquivar comandas pagas automaticamente:', err);
      }
    };

    runAutoArchiveCheck();
    const intervalId = window.setInterval(runAutoArchiveCheck, 20000);
    return () => window.clearInterval(intervalId);
  }, [autoArchivePaidAfter10Min, user, isAdmin, isDirectSession, tabs]);

  const activeStageTabs = useMemo(
    () => tabs.filter((t) => t.status !== 'archived' && t.tableLabel !== 'VENDA_AVULSA'),
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
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message:
          'Acesso bloqueado pelo ADM: você está impedido de realizar novos lançamentos.',
      });
      return;
    }

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
            const addedTotal = Number(
              (tabState.runningTotal - tabState.previousTotal).toFixed(2)
            );
            const addedCount = Math.max(0, tabState.runningCount - tabState.previousCount);
            batch.update(tabRef, {
              status: 'open',
              customerName: tabState.customerName,
              tableLabel: tabState.tableLabel,
              totalAmount: increment(addedTotal),
              paidAmount: tabState.previousPaid,
              itemCount: increment(addedCount),
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
    let cleanQuery = customerQueryName.trim().replace(/[.!,?;:]+$/g, '').trim();
    for (let i = 0; i < 5; i++) {
      const next = cleanQuery
        .replace(
          /^(?:o|a|os|as|do|da|dos|das|de|no|na|nos|nas|pro|pra|para|conta|comanda|cliente|senhor|sr|seu|dona)\b\s*/i,
          ''
        )
        .trim();
      if (next === cleanQuery) break;
      cleanQuery = next;
    }

    const qNorm = normalizeText(cleanQuery);
    const qPhon = normalizePhoneticPt(cleanQuery);

    const evaluateCustomerTabMatch = (t: BarTab) => {
      const tabNorm = normalizeText(t.customerName);
      const tabPhon = normalizePhoneticPt(t.customerName);
      const exactNormalizedMatch = Boolean(tabNorm && qNorm && tabNorm === qNorm);
      const exactPhoneticMatch = Boolean(tabPhon && qPhon && tabPhon === qPhon);
      const equivalentMatch = areCustomerNamesEquivalent(t.customerName, cleanQuery);
      const fuzzySimilarity = Number(
        computeCustomerNameSimilarity(t.customerName, cleanQuery).toFixed(3)
      );
      const substringMatch = Boolean(
        (qPhon.length >= 2 && tabPhon.includes(qPhon)) ||
          (tabPhon.length >= 3 && qPhon.includes(tabPhon)) ||
          (qNorm.length >= 2 && tabNorm.includes(qNorm)) ||
          (tabNorm.length >= 3 && qNorm.includes(tabNorm))
      );

      const matched = Boolean(
        tabNorm &&
          qNorm &&
          (exactNormalizedMatch ||
            exactPhoneticMatch ||
            equivalentMatch ||
            fuzzySimilarity >= 0.78 ||
            substringMatch)
      );

      let rejectionReason: string | null = null;
      if (!matched) {
        if (!tabNorm || !qNorm) {
          rejectionReason = 'Nome normalizado vazio';
        } else {
          rejectionReason = `Divergência entre "${tabNorm}" (fon: "${tabPhon}") e busca "${qNorm}" (fon: "${qPhon}", sim=${fuzzySimilarity})`;
        }
      }

      return {
        tab: t,
        tabId: t.id,
        tabCustomerName: t.customerName,
        tabNormalized: tabNorm,
        tabPhonetic: tabPhon,
        queryNormalized: qNorm,
        queryPhonetic: qPhon,
        exactNormalizedMatch,
        exactPhoneticMatch,
        equivalentMatch,
        fuzzySimilarity,
        substringMatch,
        status: t.status,
        totalAmount: t.totalAmount,
        paidAmount: t.paidAmount,
        remainingBalance: getRemainingBalance(t),
        matched,
        rejectionReason,
      };
    };

    const evaluatedTabs = activeStageTabs.map(evaluateCustomerTabMatch);
    const matchedEvaluations = evaluatedTabs
      .filter((e) => e.matched)
      .sort((a, b) => {
        const aOpenBalance = a.status !== 'paid' && a.remainingBalance > 0 ? 1 : 0;
        const bOpenBalance = b.status !== 'paid' && b.remainingBalance > 0 ? 1 : 0;
        if (bOpenBalance !== aOpenBalance) return bOpenBalance - aOpenBalance;
        if (b.exactNormalizedMatch !== a.exactNormalizedMatch) {
          return Number(b.exactNormalizedMatch) - Number(a.exactNormalizedMatch);
        }
        if (b.exactPhoneticMatch !== a.exactPhoneticMatch) {
          return Number(b.exactPhoneticMatch) - Number(a.exactPhoneticMatch);
        }
        return b.fuzzySimilarity - a.fuzzySimilarity;
      });
    const matchingTabs = matchedEvaluations.map((e) => e.tab);

    console.info('[DarBaixa:Verificacao]', {
      queryOriginal: customerQueryName,
      queryLimpa: cleanQuery,
      queryNormalizada: qNorm,
      queryFonetica: qPhon,
      totalComandasAtivas: activeStageTabs.length,
      comparacoesPorComanda: evaluatedTabs.map(({ tab: _tab, ...details }) => details),
      comandasFiltradasCount: matchingTabs.length,
      comandasFiltradasIds: matchingTabs.map((t) => t.id),
    });

    // Prefer open/closing tab with remaining balance and strongest normalized/phonetic/fuzzy match
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
      const archivedMatches = tabs
        .filter((t) => t.status === 'archived')
        .map(evaluateCustomerTabMatch)
        .filter((e) => e.matched);
      console.warn('[DarBaixa:FalhaBusca]', {
        motivo:
          activeStageTabs.length === 0
            ? 'Nenhuma comanda ativa na loja atual.'
            : 'Nenhuma comanda ativa passou na comparação de customerName normalizado/fonético/fuzzy.',
        queryOriginal: customerQueryName,
        queryLimpa: cleanQuery,
        queryNormalizada: qNorm,
        queryFonetica: qPhon,
        comparacoesAvaliadas: evaluatedTabs.map(({ tab: _tab, ...details }) => details),
        comandasArquivadasCorrespondentes: archivedMatches.map(({ tab: _tab, ...details }) => details),
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

  // VENDA AVULSA (Direct Walk-in / Counter Sale — immediately settled, NEVER tied to any customer tab or table)
  const executeStageVendaAvulsa = async (
    items: ParsedSingleCommand['items'],
    paymentMethod = 'PIX',
    rawTranscript: string,
    sourceType: 'voz' | 'manual' | 'rapido',
    waiterNameAttr: string,
    storeNameAttr: string
  ) => {
    if (!user || !items || items.length === 0) return;
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message:
          'Acesso bloqueado pelo ADM: você está impedido de realizar novos lançamentos.',
      });
      return;
    }

    const cleanPayMethod = sanitizeString(paymentMethod, 40, 'PIX');
    const cleanTranscript = sanitizeString(
      rawTranscript,
      VALIDATION_LIMITS.TRANSCRIPT_MAX_LEN,
      'Venda Avulsa'
    );
    const cleanWaiterName = sanitizeString(
      waiterNameAttr,
      VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
      'Caixa'
    );
    const cleanStoreName = sanitizeString(
      storeNameAttr,
      VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
      'Bar Central'
    );

    const saleTabId = `tab_avulsa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const localTs = makeLocalTimestamp();
    const newLocalItems: TabItem[] = [];
    const addedItemIds: string[] = [];
    const itemParts: string[] = [];
    const summaryLines: string[] = [];

    let totalSaleAmount = 0;
    let totalSaleCount = 0;

    for (const rawItem of items) {
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

      newLocalItems.push({
        id: itemId,
        ownerId: user.uid,
        tabId: saleTabId,
        customerName: 'Venda Avulsa',
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

      totalSaleAmount = Math.min(
        Number((totalSaleAmount + subtotal).toFixed(2)),
        VALIDATION_LIMITS.MAX_TOTAL
      );
      totalSaleCount = Math.min(totalSaleCount + qty, 10000);
      addedItemIds.push(itemId);
      itemParts.push(`${qty}x ${itemName}`);
      summaryLines.push(`${qty}x ${itemName} (${formatBRL(subtotal)})`);
    }

    const saleTabObj: BarTab = {
      id: saleTabId,
      ownerId: user.uid,
      customerName: 'Venda Avulsa',
      tableLabel: 'VENDA_AVULSA',
      status: 'paid',
      totalAmount: totalSaleAmount,
      paidAmount: totalSaleAmount,
      itemCount: totalSaleCount,
      paymentMethod: cleanPayMethod,
      createdAt: localTs,
      updatedAt: localTs,
    };

    try {
      if (isDirectSession) {
        const nextTabs = [saleTabObj, ...tabs];
        const nextTabItems = [...newLocalItems, ...tabItems];
        setTabs(nextTabs);
        setTabItems(nextTabItems);
        await syncDirectStoreSnapshot({
          tabs: nextTabs,
          tabItems: nextTabItems,
          actionType: 'add',
        });
      } else {
        const batch = writeBatch(db);
        for (const newItem of newLocalItems) {
          batch.set(doc(db, 'tabItems', newItem.id), {
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
        batch.set(doc(db, 'tabs', saleTabId), {
          ownerId: user.uid,
          customerName: 'Venda Avulsa',
          tableLabel: 'VENDA_AVULSA',
          status: 'paid',
          totalAmount: totalSaleAmount,
          paidAmount: totalSaleAmount,
          itemCount: totalSaleCount,
          paymentMethod: cleanPayMethod,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      }

      const spokenText = `Venda avulsa registrada e baixada no ${cleanPayMethod}! ${itemParts.join(', ')} — Total: ${formatBRL(totalSaleAmount)}.`;

      setMarceloReport({
        intent: 'VENDA_AVULSA',
        title: `Venda Avulsa (Balcão) — Baixa no ${cleanPayMethod}`,
        spokenSummary: spokenText,
        customerName: 'Venda Avulsa (Sem Mesa)',
        stageLabel: 'Paga no Balcão (Caixa)',
        waiterAttribution: cleanWaiterName,
        itemsSummary: summaryLines,
        totalConsumed: totalSaleAmount,
        totalPaid: totalSaleAmount,
        remainingBalance: 0,
      });

      setFeedbackBanner({
        type: 'success',
        message: spokenText,
      });
      speakAsMarcelo(spokenText, marceloVoiceReplyEnabled);

      if (isAdmin) {
        setLastUndo({
          description: `Venda avulsa (${itemParts.join(', ')} - ${cleanPayMethod})`,
          tabsAffected: [
            {
              tabId: saleTabId,
              createdNewTab: true,
              customerName: 'Venda Avulsa',
              tableLabel: 'VENDA_AVULSA',
              previousTotal: 0,
              previousPaid: 0,
              previousCount: 0,
              previousStatus: 'paid',
            },
          ],
          addedItemIds,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tabs/tabItems');
    }
  };

  // Master Command Dispatcher for Virtual Assistant "MARCELO"
  const processOrderPhrase = async (
    phrase: string,
    sourceType: 'voz' | 'manual'
  ) => {
    const cleanPhrase = phrase.trim();
    if (!cleanPhrase || !user) return;
    if (isCurrentWaiterBlocked) {
      const blockedMsg =
        'Acesso bloqueado pelo ADM: você não tem permissão para realizar novos lançamentos.';
      setFeedbackBanner({ type: 'error', message: blockedMsg });
      speakAsMarcelo(blockedMsg, marceloVoiceReplyEnabled);
      return;
    }

    let waiterAttr = activeWaiterDisplay.name;
    const storeAttr = activeWaiterDisplay.storeName;

    // Evaluate live voice compatibility against registered Garçons when spoken by voice
    if (sourceType === 'voz' && voiceOperators.length > 0) {
      const liveSample = liveAcousticTrackerRef.current?.getRecentSample();
      if (liveSample) {
        const match = matchSpeakerAgainstOperators(
          liveSample,
          voiceOperators,
          directSession?.email || user?.email || undefined
        );
        if (match.matchedOperator && match.confidence >= 60) {
          if (match.matchedOperator.accessBlocked && !isAdmin) {
            const blockedVoiceMsg = `Acesso de ${match.matchedOperator.operatorName} está bloqueado pelo ADM para novos lançamentos.`;
            setFeedbackBanner({ type: 'error', message: blockedVoiceMsg });
            speakAsMarcelo(blockedVoiceMsg, marceloVoiceReplyEnabled);
            return;
          }
          setLastVoiceCompatibility({
            operatorName: match.matchedOperator.operatorName,
            confidence: match.confidence,
            pitchHz: liveSample.pitchHz,
          });
          waiterAttr = `${match.matchedOperator.operatorName} (Voz ${match.confidence}%)`;
        }
      }
    }

    setIsProcessingCommand(true);
    setFeedbackBanner(null);

    try {
      // 0. Check if user is asking Marcelo to register a new product into the Cardápio
      if (isMenuRegistrationVoiceCommand(cleanPhrase)) {
        await registerMenuProductsFromVoice(cleanPhrase, true);
        setCommandInput('');
        return;
      }

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
        if (cmd.intent === 'VENDA_AVULSA') {
          if (!cmd.items || cmd.items.length === 0) {
            const abortMsg = 'Não identifiquei qual produto foi vendido na venda avulsa.';
            setMarceloReport(null);
            setFeedbackBanner({ type: 'error', message: abortMsg });
            speakAsMarcelo(abortMsg, marceloVoiceReplyEnabled);
            return;
          }
          continue;
        }
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

      const vendaAvulsaCmds = finalParsed.commands.filter((c) => c.intent === 'VENDA_AVULSA');
      const marcarCmds = finalParsed.commands.filter((c) => c.intent === 'MARCAR');
      const fecharCmds = finalParsed.commands.filter((c) => c.intent === 'FECHAR');
      const baixaCmds = finalParsed.commands.filter((c) => c.intent === 'BAIXA');

      for (const vCmd of vendaAvulsaCmds) {
        await executeStageVendaAvulsa(
          vCmd.items,
          vCmd.paymentMethod || 'PIX',
          cleanPhrase,
          sourceType,
          waiterAttr,
          storeAttr
        );
      }

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

  const processOrderPhraseRef = useRef(processOrderPhrase);
  processOrderPhraseRef.current = processOrderPhrase;
  const marceloVoiceReplyEnabledRef = useRef(marceloVoiceReplyEnabled);
  marceloVoiceReplyEnabledRef.current = marceloVoiceReplyEnabled;

  // Release any active SpeechRecognition or live tracker stream so AudioContext biometric capture won't hit NotReadableError
  const releaseActiveMicForBiometrics = async () => {
    let hadActiveMic = false;
    if (restartSpeechTimerRef.current) {
      clearTimeout(restartSpeechTimerRef.current);
      restartSpeechTimerRef.current = null;
    }
    if (shouldKeepListeningRef.current || recognitionRef.current || isListening) {
      hadActiveMic = true;
      shouldKeepListeningRef.current = false;
      marceloAwakeUntilMsRef.current = 0;
      setMarceloAwakeWindowActive(false);
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
    }
    if (liveAcousticTrackerRef.current) {
      hadActiveMic = true;
      liveAcousticTrackerRef.current.stop();
      liveAcousticTrackerRef.current = null;
    }
    if (menuRecognitionRef.current || isListeningMenuVoice) {
      hadActiveMic = true;
      try {
        menuRecognitionRef.current?.stop();
      } catch {
        // ignore
      }
      menuRecognitionRef.current = null;
      setIsListeningMenuVoice(false);
      setMenuVoiceInterim('');
    }
    if (hadActiveMic) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  // Start / Stop Web Speech API Microphone Recognition (Supports Open-Mic "MARCELO" Wake-Word)
  const toggleVoiceRecognition = () => {
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message: 'Acesso bloqueado pelo ADM: não é possível ativar o microfone para lançamentos.',
      });
      return;
    }
    if (isListening) {
      if (restartSpeechTimerRef.current) {
        clearTimeout(restartSpeechTimerRef.current);
        restartSpeechTimerRef.current = null;
      }
      shouldKeepListeningRef.current = false;
      marceloAwakeUntilMsRef.current = 0;
      setMarceloAwakeWindowActive(false);
      setInterimTranscript('');
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      liveAcousticTrackerRef.current?.stop();
      liveAcousticTrackerRef.current = null;
      setIsListening(false);
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setFeedbackBanner({
        type: 'error',
        message:
          'O microfone exige conexão HTTPS (ou localhost). Acesse o sistema via HTTPS para usar comandos de voz.',
      });
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
          'Seu navegador não suporta reconhecimento de voz nativo. Use Google Chrome / Edge ou digite o comando no campo ao lado.',
      });
      return;
    }

    if (restartSpeechTimerRef.current) {
      clearTimeout(restartSpeechTimerRef.current);
      restartSpeechTimerRef.current = null;
    }
    liveAcousticTrackerRef.current?.stop();
    liveAcousticTrackerRef.current = null;

    const createAndWireRecognition = (): SpeechRecognitionInstance => {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'pt-BR';
      recognition.continuous = openMicWakeWordModeRef.current;
      recognition.interimResults = true;

      recognition.onstart = () => {
        if (recognitionRef.current !== recognition) return;
        consecutiveSpeechErrorsRef.current = 0;
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (recognitionRef.current !== recognition) return;
        consecutiveSpeechErrorsRef.current = 0;
        let interim = '';
        const startIdx =
          typeof event.resultIndex === 'number'
            ? Math.max(0, event.resultIndex)
            : Math.max(0, event.results.length - 1);

        for (let i = startIdx; i < event.results.length; i++) {
          const res = event.results[i];
          if (!res || !res[0]) continue;
          if (res.isFinal) {
            const finalPhrase = res[0].transcript.trim();
            setInterimTranscript('');
            if (!finalPhrase) continue;

            if (openMicWakeWordModeRef.current) {
              const wakeInfo = extractCommandAfterMarceloWakeWord(finalPhrase);
              const nowMs = Date.now();

              if (wakeInfo.hasWakeWord) {
                setLastIgnoredOpenMicPhrase('');
                if (wakeInfo.isOnlyWakeWord) {
                  // Waiter said "Marcelo" / "Oi Marcelo": open a 12-second active window for the command
                  marceloAwakeUntilMsRef.current = nowMs + 12000;
                  setMarceloAwakeWindowActive(true);
                  setFeedbackBanner({
                    type: 'success',
                    message:
                      'Marcelo na escuta! Pode falar o comando agora (ex: "marca 1 litrão para Tiago").',
                  });
                  speakAsMarcelo('Pode falar!', marceloVoiceReplyEnabledRef.current);
                } else if (wakeInfo.commandTranscript) {
                  marceloAwakeUntilMsRef.current = 0;
                  setMarceloAwakeWindowActive(false);
                  processOrderPhraseRef.current(wakeInfo.commandTranscript, 'voz');
                }
              } else if (nowMs < marceloAwakeUntilMsRef.current) {
                // Spoken within 12 seconds after saying "Marcelo"
                marceloAwakeUntilMsRef.current = 0;
                setMarceloAwakeWindowActive(false);
                setLastIgnoredOpenMicPhrase('');
                processOrderPhraseRef.current(finalPhrase, 'voz');
              } else {
                // Casual conversation with open microphone: ignore silently without interrupting the waiter!
                setMarceloAwakeWindowActive(false);
                setLastIgnoredOpenMicPhrase(finalPhrase);
              }
            } else {
              processOrderPhraseRef.current(finalPhrase, 'voz');
            }
          } else {
            interim += res[0].transcript;
          }
        }
        setInterimTranscript(interim.trim());
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (recognitionRef.current !== recognition) return;
        const errCode = event.error || 'unknown';

        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          shouldKeepListeningRef.current = false;
          setInterimTranscript('');
          setFeedbackBanner({
            type: 'error',
            message: isInsideEmbeddedIframe()
              ? `Permissão de microfone bloqueada nesta janela incorporada (${errCode}). Clique em "Abrir em Nova Aba" ou libere o microfone no navegador.`
              : `Permissão de microfone negada (${errCode}): clique no cadeado da barra de endereço e libere o microfone.`,
          });
          setIsListening(false);
          return;
        }

        if (errCode === 'audio-capture') {
          shouldKeepListeningRef.current = false;
          setInterimTranscript('');
          setFeedbackBanner({
            type: 'error',
            message:
              'Falha ao capturar áudio (audio-capture). Verifique se o microfone/fone Bluetooth está conectado e não está ocupado por outro app.',
          });
          setIsListening(false);
          return;
        }

        if (errCode === 'network') {
          shouldKeepListeningRef.current = false;
          setInterimTranscript('');
          setFeedbackBanner({
            type: 'error',
            message:
              'Erro de rede no reconhecimento de voz do navegador (network). Verifique sua internet ou digite o comando.',
          });
          setIsListening(false);
          return;
        }

        if (errCode === 'no-speech') {
          if (!openMicWakeWordModeRef.current) {
            shouldKeepListeningRef.current = false;
            setInterimTranscript('');
            setFeedbackBanner({
              type: 'error',
              message: 'Nenhuma fala detectada. Clique em "Falar com Marcelo" e fale logo em seguida.',
            });
            setIsListening(false);
          }
          return;
        }

        consecutiveSpeechErrorsRef.current += 1;
        if (consecutiveSpeechErrorsRef.current >= 3) {
          shouldKeepListeningRef.current = false;
          setInterimTranscript('');
          setFeedbackBanner({
            type: 'error',
            message: `Erro contínuo ao capturar voz (${errCode}). Tente recarregar a página ou verificar o microfone.`,
          });
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return;
        setInterimTranscript('');
        // If Open-Mic Wake-Word mode is active and user didn't click stop, automatically keep listening
        if (
          shouldKeepListeningRef.current &&
          openMicWakeWordModeRef.current &&
          consecutiveSpeechErrorsRef.current < 3
        ) {
          if (restartSpeechTimerRef.current) clearTimeout(restartSpeechTimerRef.current);
          restartSpeechTimerRef.current = setTimeout(() => {
            if (shouldKeepListeningRef.current) {
              try {
                const nextRec = createAndWireRecognition();
                recognitionRef.current = nextRec;
                nextRec.start();
                return;
              } catch {
                // ignore if busy
              }
            }
          }, 260);
          return;
        }
        setIsListening(false);
      };

      return recognition;
    };

    const recognition = createAndWireRecognition();
    consecutiveSpeechErrorsRef.current = 0;
    shouldKeepListeningRef.current = true;
    recognitionRef.current = recognition;
    setInterimTranscript('');
    setLastIgnoredOpenMicPhrase('');
    setFeedbackBanner(null);
    setIsListening(true);

    try {
      // Call synchronously inside user click handler to preserve browser microphone gesture activation
      recognition.start();
    } catch (err) {
      shouldKeepListeningRef.current = false;
      setIsListening(false);
      setFeedbackBanner({
        type: 'error',
        message: describeVoiceCaptureError(err),
      });
    }
  };

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      if (restartSpeechTimerRef.current) clearTimeout(restartSpeechTimerRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      try {
        menuRecognitionRef.current?.stop();
      } catch {
        // ignore
      }
      liveAcousticTrackerRef.current?.stop();
    };
  }, []);

  // Capture 2.4s voice sample when registering a new Waiter
  const handleCaptureVoiceForNewWaiter = async () => {
    setCapturingNewOpVoice(true);
    setFeedbackBanner(null);
    try {
      await releaseActiveMicForBiometrics();
      const sample = await captureVoiceBiometricSample(2400, selectedMicDeviceId);
      if (sample.framesCaptured === 0) {
        setFeedbackBanner({
          type: 'error',
          message:
            'Microfone abriu, mas nenhum áudio foi detectado (pode estar no mudo ou com volume zerado). Fale por 2 a 3 segundos perto do microfone.',
        });
        return;
      }
      setNewOpVoiceSample({
        pitchHz: sample.pitchHz,
        spectralCentroid: sample.spectralCentroid,
      });
      setFeedbackBanner({
        type: 'success',
        message: `Voz do garçom capturada com sucesso (${sample.pitchHz} Hz · Timbre ${Math.round(sample.spectralCentroid)} Hz)!`,
      });
    } catch (err) {
      console.error('[VoiceCapture] New waiter sample failed:', err);
      setFeedbackBanner({
        type: 'error',
        message: describeVoiceCaptureError(err),
      });
    } finally {
      setCapturingNewOpVoice(false);
    }
  };

  // Calibrate / Re-record Voice for an Existing Waiter (Works for ADM or Logged-In Garçom)
  const handleCalibrateExistingWaiterVoice = async (targetOp: VoiceOperator) => {
    if (!user) return;
    setCalibratingOpId(targetOp.id);
    setFeedbackBanner(null);
    try {
      await releaseActiveMicForBiometrics();
      const sample = await captureVoiceBiometricSample(2500, selectedMicDeviceId);
      if (sample.framesCaptured === 0) {
        setFeedbackBanner({
          type: 'error',
          message:
            'Microfone abriu, mas o áudio veio silencioso. Fale continuamente por 3 segundos perto do microfone ou verifique se não está no mudo.',
        });
        return;
      }
      const prevSamples = Math.max(targetOp.samplesCount || 1, 1);
      const blendedPitch =
        prevSamples > 1
          ? Number(((targetOp.pitchHz * prevSamples + sample.pitchHz) / (prevSamples + 1)).toFixed(1))
          : sample.pitchHz;
      const blendedCentroid =
        prevSamples > 1
          ? Number(
              (
                (targetOp.spectralCentroid * prevSamples + sample.spectralCentroid) /
                (prevSamples + 1)
              ).toFixed(1)
            )
          : sample.spectralCentroid;
      const nextSamplesCount = Math.min(prevSamples + 1, 50);

      await fetch('/api/auth/update-waiter-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeCode: currentStoreCode,
          operatorId: targetOp.id,
          email: targetOp.email,
          pitchHz: blendedPitch,
          spectralCentroid: blendedCentroid,
          samplesCount: nextSamplesCount,
          voicePin: targetOp.voicePin || '',
        }),
      }).catch(() => {});

      const localTs = makeLocalTimestamp();
      const nextOps = voiceOperators.map((op) =>
        op.id === targetOp.id
          ? {
              ...op,
              pitchHz: blendedPitch,
              spectralCentroid: blendedCentroid,
              samplesCount: nextSamplesCount,
              updatedAt: localTs,
            }
          : op
      );
      setVoiceOperators(nextOps);

      if (isDirectSession) {
        await syncDirectStoreSnapshot({ voiceOperators: nextOps, actionType: 'add' });
      } else {
        await updateDoc(doc(db, 'voiceOperators', targetOp.id), {
          operatorName: targetOp.operatorName,
          roleLabel: targetOp.roleLabel || 'Garçom',
          storeName: targetOp.storeName || currentStoreName,
          storeCode: targetOp.storeCode || currentStoreCode,
          pitchHz: blendedPitch,
          spectralCentroid: blendedCentroid,
          voicePin: targetOp.voicePin || '',
          samplesCount: nextSamplesCount,
          updatedAt: serverTimestamp(),
        });
      }

      setLastVoiceCompatibility({
        operatorName: targetOp.operatorName,
        confidence: 98,
        pitchHz: blendedPitch,
      });

      setFeedbackBanner({
        type: 'success',
        message: `Voz de ${targetOp.operatorName} cadastrada/calibrada (${blendedPitch} Hz · ${nextSamplesCount} amostras)!`,
      });
    } catch (err) {
      console.error('[VoiceCapture] Calibration failed:', err);
      setFeedbackBanner({
        type: 'error',
        message: describeVoiceCaptureError(err),
      });
    } finally {
      setCalibratingOpId(null);
    }
  };

  // Test Live Voice Compatibility against Registered Waiters
  const handleTestLiveVoiceCompatibility = async () => {
    if (voiceOperators.length === 0) {
      setFeedbackBanner({
        type: 'error',
        message: 'Cadastre pelo menos um garçom na aba Garçons para testar a compatibilidade de voz.',
      });
      return;
    }
    setTestingCompatibility(true);
    setFeedbackBanner(null);
    try {
      await releaseActiveMicForBiometrics();
      const sample = await captureVoiceBiometricSample(2400, selectedMicDeviceId);
      if (sample.framesCaptured === 0) {
        setFeedbackBanner({
          type: 'error',
          message:
            'Microfone abriu, mas nenhum som foi captado. Fale durante os 2,5 segundos do teste.',
        });
        return;
      }
      const match = matchSpeakerAgainstOperators(
        sample,
        voiceOperators,
        directSession?.email || user?.email || undefined
      );
      if (match.matchedOperator) {
        setLastVoiceCompatibility({
          operatorName: match.matchedOperator.operatorName,
          confidence: match.confidence,
          pitchHz: sample.pitchHz,
        });
        setFeedbackBanner({
          type: 'success',
          message: `Compatibilidade de Voz: ${match.confidence}% com o garçom ${match.matchedOperator.operatorName} (Tom medido: ${sample.pitchHz} Hz).`,
        });
      } else {
        setFeedbackBanner({
          type: 'error',
          message: 'Nenhum garçom calibrado encontrado para comparar a voz.',
        });
      }
    } catch (err) {
      console.error('[VoiceCapture] Compatibility test failed:', err);
      setFeedbackBanner({
        type: 'error',
        message: describeVoiceCaptureError(err),
      });
    } finally {
      setTestingCompatibility(false);
    }
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
          autoArchivePaidAfter10Min,
          actionType: 'add',
        });
      } else {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          ownerId: user.uid,
          userName: cleanName,
          userRole: cleanRole,
          storeName: cleanStore,
          storeCode: cleanCode,
          autoArchivePaidAfter10Min,
          createdAt: userProfile?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setFeedbackBanner({
        type: 'success',
        message: `Configurações do bar (${cleanStore}) atualizadas!`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `userProfiles/${user.uid}`);
    } finally {
      setSavingProfile(false);
    }
  };

  // Instant toggle for ADM auto-archive paid tabs after 10 minutes
  const handleToggleAutoArchiveSetting = async (enabled: boolean) => {
    if (!user || !isAdmin) return;
    setAutoArchivePaidAfter10Min(enabled);
    try {
      const cleanName = sanitizeString(
        profileUserName || userProfile?.userName || directSession?.userName || 'Administrador',
        VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN
      );
      const cleanRole: UserRoleType = VALIDATION_LIMITS.VALID_ROLES.includes(profileUserRole)
        ? profileUserRole
        : 'ADM';
      const cleanStore = sanitizeString(
        profileStoreName || currentStoreName,
        VALIDATION_LIMITS.STORE_NAME_MAX_LEN
      );
      const cleanCode = sanitizeStoreCode(profileStoreCode || currentStoreCode, 'BAR-01');

      if (isDirectSession) {
        await syncDirectStoreSnapshot({
          storeCode: cleanCode,
          storeName: cleanStore,
          autoArchivePaidAfter10Min: enabled,
          actionType: 'add',
        });
      } else {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          ownerId: user.uid,
          userName: cleanName,
          userRole: cleanRole,
          storeName: cleanStore,
          storeCode: cleanCode,
          autoArchivePaidAfter10Min: enabled,
          createdAt: userProfile?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setFeedbackBanner({
        type: 'success',
        message: enabled
          ? 'Arquivamento automático ativado: comandas pagas serão arquivadas após 10 minutos.'
          : 'Arquivamento automático desativado: comandas pagas permanecerão na lista até o arquivamento manual.',
      });
    } catch (err) {
      setAutoArchivePaidAfter10Min(!enabled);
      handleFirestoreError(err, OperationType.WRITE, `userProfiles/${user.uid}`);
    }
  };

  // ADM Registers a New Waiter (Garçom) with Email & Password + Optional Voice Print
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

    const initialPitch = newOpVoiceSample?.pitchHz || 145;
    const initialCentroid = newOpVoiceSample?.spectralCentroid || 1850;
    const initialSamplesCount = newOpVoiceSample ? 2 : 1;

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
          pitchHz: initialPitch,
          spectralCentroid: initialCentroid,
          voicePin: '',
          samplesCount: initialSamplesCount,
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
        pitchHz: initialPitch,
        spectralCentroid: initialCentroid,
        voicePin: '',
        samplesCount: initialSamplesCount,
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
      setNewOpVoiceSample(null);

      setFeedbackBanner({
        type: 'success',
        message: `Garçom ${cleanName} (${cleanEmail}) cadastrado com sucesso!`,
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
        await syncDirectStoreSnapshot({
          voiceOperators: nextOps,
          actionType: 'remove',
          removedOperatorIds: [opId],
        });
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

  // ADM Instantly Blocks or Unblocks a Waiter's Access to Prevent New Launches
  const handleToggleWaiterAccess = async (targetOp: VoiceOperator) => {
    if (!user || !isAdmin) return;
    const nextBlocked = !Boolean(targetOp.accessBlocked);
    setTogglingAccessOpId(targetOp.id);
    try {
      const apiRes = await fetch('/api/auth/toggle-waiter-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: currentUserRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADM',
          storeCode: currentStoreCode,
          operatorId: targetOp.id,
          email: targetOp.email || '',
          accessBlocked: nextBlocked,
        }),
      });
      if (!apiRes.ok) {
        const errData = (await apiRes.json().catch(() => ({}))) as { error?: string };
        setFeedbackBanner({
          type: 'error',
          message: errData.error || 'Não foi possível alterar o bloqueio deste garçom.',
        });
        return;
      }

      const localTs = makeLocalTimestamp();
      const nextOps = voiceOperators.map((op) =>
        op.id === targetOp.id
          ? { ...op, accessBlocked: nextBlocked, updatedAt: localTs }
          : op
      );
      setVoiceOperators(nextOps);

      if (isDirectSession) {
        await syncDirectStoreSnapshot({ voiceOperators: nextOps, actionType: 'add' });
      } else {
        await updateDoc(doc(db, 'voiceOperators', targetOp.id), {
          accessBlocked: nextBlocked,
          updatedAt: serverTimestamp(),
        });
      }

      setFeedbackBanner({
        type: 'success',
        message: nextBlocked
          ? `Acesso de ${targetOp.operatorName} bloqueado instantaneamente! Novos lançamentos impedidos.`
          : `Acesso de ${targetOp.operatorName} liberado! O garçom já pode fazer lançamentos novamente.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `voiceOperators/${targetOp.id}`);
    } finally {
      setTogglingAccessOpId(null);
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
          removedTabItemIds: undoInfo.addedItemIds,
          removedTabIds: undoInfo.tabsAffected
            .filter((t) => t.createdNewTab)
            .map((t) => t.tabId),
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
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message: 'Acesso bloqueado pelo ADM: novos lançamentos estão impedidos para o seu usuário.',
      });
      return;
    }

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
          totalAmount: increment(menuItem.price),
          paidAmount: selectedTab.paidAmount,
          itemCount: increment(1),
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
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message: 'Acesso bloqueado pelo ADM: novos lançamentos estão impedidos para o seu usuário.',
      });
      return;
    }
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
          removedTabItemIds: nextQty <= 0 ? [item.id] : undefined,
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
          totalAmount: increment(priceDiff),
          paidAmount: parentTab.paidAmount,
          itemCount: increment(delta),
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
    if (isCurrentWaiterBlocked) {
      setFeedbackBanner({
        type: 'error',
        message: 'Acesso bloqueado pelo ADM: você não pode abrir novas comandas.',
      });
      return;
    }

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

  // Format and print plain-text receipt (40 columns) for 58mm/80mm thermal printers
  const handlePrintReceipt = (tab: BarTab) => {
    const groupedItems = getConsolidatedItemsForTab(tab.id);
    const receiptText = formatThermalReceiptText(
      {
        storeName: currentStoreName,
        customerName: tab.customerName,
        tableLabel: tab.tableLabel,
        statusLabel: STAGE_LABELS[tab.status],
        totalAmount: tab.totalAmount,
        paidAmount: tab.paidAmount,
        itemCount: tab.itemCount,
        paymentMethod: tab.paymentMethod,
        items: groupedItems.map((g) => ({
          itemName: g.itemName,
          quantity: g.totalQuantity,
          unitPrice: g.unitPrice,
          totalSubtotal: g.totalSubtotal,
        })),
      },
      40
    );

    if (printReceiptPreRef.current) {
      printReceiptPreRef.current.textContent = receiptText;
    }

    try {
      window.print();
      setFeedbackBanner({
        type: 'success',
        message: `Conta de ${tab.customerName} formatada (40 colunas) e enviada para impressão térmica.`,
      });
    } catch {
      setFeedbackBanner({
        type: 'error',
        message:
          'Não foi possível abrir o diálogo de impressão neste dispositivo. Use o botão de copiar ao lado.',
      });
    }
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

  // CARDÁPIO POR VOZ: Parse & Register 1 or more products spoken by ADM
  const registerMenuProductsFromVoice = async (
    transcript: string,
    viaMarceloBar = false
  ) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript || !user) return;

    if (!isAdmin) {
      const deniedMsg = 'Somente o ADM pode cadastrar produtos no cardápio.';
      setFeedbackBanner({ type: 'error', message: deniedMsg });
      speakAsMarcelo(deniedMsg, marceloVoiceReplyEnabled);
      return;
    }

    setMenuVoiceProcessing(true);
    try {
      let parsed: ParsedVoiceMenuResult = parseVoiceMenuProductsLocally(cleanTranscript);

      const needsAiFallback =
        !parsed.understood ||
        parsed.products.length === 0 ||
        parsed.products.some((p) => p.price === null);

      if (needsAiFallback) {
        try {
          const resp = await fetch('/api/parse-menu-product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: cleanTranscript }),
          });
          if (resp.ok) {
            const aiParsed = (await resp.json()) as ParsedVoiceMenuResult;
            if (
              aiParsed &&
              aiParsed.understood &&
              Array.isArray(aiParsed.products) &&
              aiParsed.products.length > 0
            ) {
              // Prefer AI result if local failed or if AI resolved price(s) that local missed
              const aiHasPrice = aiParsed.products.some((p) => p.price !== null);
              if (!parsed.understood || aiHasPrice) {
                parsed = aiParsed;
              }
            }
          }
        } catch {
          // Keep local parse result if network/AI unavailable
        }
      }

      if (!parsed.understood || parsed.products.length === 0) {
        const reason =
          parsed.unrecognizedReason ||
          'Não consegui entender o produto e o preço. Diga por exemplo: "Skol Lata 6 reais".';
        setFeedbackBanner({ type: 'error', message: reason });
        speakAsMarcelo(reason, marceloVoiceReplyEnabled);
        return;
      }

      const readyProducts = parsed.products.filter(
        (p): p is ParsedVoiceMenuProduct & { price: number } =>
          typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0
      );
      const missingPriceProducts = parsed.products.filter((p) => p.price === null);

      if (readyProducts.length === 0 && missingPriceProducts.length > 0) {
        const firstPartial = missingPriceProducts[0];
        setEditingMenuId(null);
        setNewMenuName(firstPartial.name);
        setNewMenuCategory(sanitizeCategory(firstPartial.category));
        setNewMenuPrice('');
        setNewMenuSynonyms(firstPartial.synonyms);
        if (viaMarceloBar) {
          setActiveSection('cardapio');
        }
        const askPriceMsg = `Reconheci "${firstPartial.name}" (${CATEGORY_LABELS[sanitizeCategory(firstPartial.category)]}). Informe ou fale o preço para salvar no cardápio.`;
        setFeedbackBanner({ type: 'success', message: askPriceMsg });
        speakAsMarcelo(
          `Reconheci ${firstPartial.name}. Agora informe o preço para salvar.`,
          marceloVoiceReplyEnabled
        );
        return;
      }

      // Persist all recognized products with prices into Cardápio
      isMutatingRef.current = true;
      lastMutationMsRef.current = Date.now();
      const localTs = makeLocalTimestamp();
      let workingMenu = [...menuItems];
      const savedSummaries: string[] = [];

      try {
        for (const prod of readyProducts) {
          const cleanName = sanitizeString(prod.name, VALIDATION_LIMITS.NAME_MAX_LEN);
          const cleanCat = sanitizeCategory(prod.category);
          const cleanPrice = Math.min(
            Math.max(Number(prod.price.toFixed(2)), 0),
            VALIDATION_LIMITS.MAX_PRICE
          );
          const cleanSyn = sanitizeString(
            (prod.synonyms || '').trim() || cleanName.toLowerCase(),
            VALIDATION_LIMITS.SYNONYMS_MAX_LEN
          );

          const existingMatch = workingMenu.find(
            (m) => normalizeProductText(m.name) === normalizeProductText(cleanName)
          );
          const menuId =
            existingMatch?.id ||
            `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          const itemObj: MenuItem = {
            id: menuId,
            ownerId: user.uid,
            name: cleanName,
            category: cleanCat,
            price: cleanPrice,
            synonyms: cleanSyn,
            createdAt: existingMatch?.createdAt || localTs,
            updatedAt: localTs,
          };

          workingMenu = [
            ...workingMenu.filter((m) => m.id !== menuId),
            itemObj,
          ];

          if (!isDirectSession) {
            localStorage.setItem(`comanda_voz_fb_menu_seeded_${user.uid}`, 'true');
            if (existingMatch) {
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

          savedSummaries.push(
            `${cleanName} (${formatBRL(cleanPrice)})${existingMatch ? ' [atualizado]' : ''}`
          );
        }

        workingMenu.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        setMenuItems(workingMenu);

        if (isDirectSession) {
          await syncDirectStoreSnapshot({
            menuItems: workingMenu,
            actionType: 'catalog',
          });
        }
      } finally {
        lastMutationMsRef.current = Date.now();
        isMutatingRef.current = false;
      }

      setEditingMenuId(null);
      setNewMenuName('');
      setNewMenuPrice('');
      setNewMenuSynonyms('');

      const successMessage =
        savedSummaries.length === 1
          ? `Produto cadastrado no cardápio por voz: ${savedSummaries[0]}!`
          : `${savedSummaries.length} produtos cadastrados por voz: ${savedSummaries.join(' | ')}`;

      setFeedbackBanner({ type: 'success', message: successMessage });

      if (viaMarceloBar) {
        setMarceloReport({
          intent: 'CADASTRO_MENU',
          title: 'Cardápio Atualizado por Voz',
          spokenSummary: successMessage,
          customerName: 'Cardápio do Bar',
          stageLabel: `${savedSummaries.length} ${savedSummaries.length === 1 ? 'produto' : 'produtos'}`,
          waiterAttribution: activeWaiterDisplay.name,
          itemsSummary: savedSummaries,
          totalConsumed: 0,
          totalPaid: 0,
          remainingBalance: 0,
        });
      }

      speakAsMarcelo(
        readyProducts.length === 1
          ? `Produto ${readyProducts[0].name} cadastrado no cardápio por ${formatBRL(readyProducts[0].price)}.`
          : `${readyProducts.length} produtos cadastrados no cardápio com sucesso!`,
        marceloVoiceReplyEnabled
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'menuItems');
      setFeedbackBanner({
        type: 'error',
        message: 'Não foi possível salvar o produto falado no cardápio.',
      });
    } finally {
      setMenuVoiceProcessing(false);
    }
  };

  const registerMenuProductsFromVoiceRef = useRef(registerMenuProductsFromVoice);
  registerMenuProductsFromVoiceRef.current = registerMenuProductsFromVoice;

  // Toggle Voice Capture specifically inside Cardápio tab
  const toggleCardapioVoiceCapture = () => {
    if (!isAdmin) return;

    if (isListeningMenuVoice) {
      setMenuVoiceInterim('');
      try {
        menuRecognitionRef.current?.stop();
      } catch {
        // ignore
      }
      menuRecognitionRef.current = null;
      setIsListeningMenuVoice(false);
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setFeedbackBanner({
        type: 'error',
        message:
          'O microfone exige conexão HTTPS (ou localhost). Acesse o sistema via HTTPS para cadastrar produtos por voz.',
      });
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
          'Seu navegador não suporta reconhecimento de voz nativo. Use Google Chrome ou Edge.',
      });
      return;
    }

    // Pause main Comandas recognition if active so both never fight for the mic
    if (isListening || recognitionRef.current) {
      if (restartSpeechTimerRef.current) {
        clearTimeout(restartSpeechTimerRef.current);
        restartSpeechTimerRef.current = null;
      }
      shouldKeepListeningRef.current = false;
      marceloAwakeUntilMsRef.current = 0;
      setMarceloAwakeWindowActive(false);
      setInterimTranscript('');
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (menuRecognitionRef.current !== recognition) return;
      let interim = '';
      const startIdx =
        typeof event.resultIndex === 'number'
          ? Math.max(0, event.resultIndex)
          : Math.max(0, event.results.length - 1);

      for (let i = startIdx; i < event.results.length; i++) {
        const res = event.results[i];
        if (!res || !res[0]) continue;
        if (res.isFinal) {
          const finalPhrase = res[0].transcript.trim();
          setMenuVoiceInterim('');
          if (finalPhrase) {
            registerMenuProductsFromVoiceRef.current(finalPhrase, false);
          }
        } else {
          interim += res[0].transcript;
        }
      }
      setMenuVoiceInterim(interim.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (menuRecognitionRef.current !== recognition) return;
      const errCode = event.error || 'unknown';
      setMenuVoiceInterim('');
      setIsListeningMenuVoice(false);
      menuRecognitionRef.current = null;

      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        setFeedbackBanner({
          type: 'error',
          message: isInsideEmbeddedIframe()
            ? `Permissão de microfone bloqueada nesta janela incorporada (${errCode}). Clique em "Abrir em Nova Aba" ou libere o microfone no navegador.`
            : `Permissão de microfone negada (${errCode}): clique no cadeado da barra de endereço e libere o microfone.`,
        });
      } else if (errCode === 'no-speech') {
        setFeedbackBanner({
          type: 'error',
          message:
            'Nenhuma fala detectada. Clique em "Cadastrar por Voz" e diga o nome e o preço do produto.',
        });
      } else {
        setFeedbackBanner({
          type: 'error',
          message: `Erro ao capturar voz para o cardápio (${errCode}). Tente novamente.`,
        });
      }
    };

    recognition.onend = () => {
      if (menuRecognitionRef.current !== recognition) return;
      menuRecognitionRef.current = null;
      setMenuVoiceInterim('');
      setIsListeningMenuVoice(false);
    };

    menuRecognitionRef.current = recognition;
    setMenuVoiceInterim('');
    setFeedbackBanner(null);
    setIsListeningMenuVoice(true);

    try {
      recognition.start();
    } catch (err) {
      menuRecognitionRef.current = null;
      setIsListeningMenuVoice(false);
      setFeedbackBanner({
        type: 'error',
        message: describeVoiceCaptureError(err),
      });
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
          removedMenuIds: [menuId],
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
          clearedAllMenu: true,
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

  // SUPERADMIN: Update Monthly Subscription Billing or Mark Paid
  const handleSuperAdminUpdateBilling = async (
    targetEmail: string,
    options: {
      monthlyFee?: number;
      subscriptionStatus?: SubscriptionStatusType;
      billingDueDate?: string;
      markPaidNow?: boolean;
    }
  ) => {
    if (!isSuperAdmin) return;
    try {
      const res = await fetch('/api/superadmin/update-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callerRole: 'SUPERADMIN',
          email: targetEmail,
          ...options,
        }),
      });
      if (res.ok) {
        setEditingBillingEmail(null);
        await fetchSuperAdminOverview();
        setFeedbackBanner({
          type: 'success',
          message: options.markPaidNow
            ? `Mensalidade de ${targetEmail} baixada como PAGA (Em Dia)!`
            : `Dados de mensalidade de ${targetEmail} atualizados!`,
        });
      }
    } catch {
      setFeedbackBanner({
        type: 'error',
        message: 'Erro ao atualizar mensalidade.',
      });
    }
  };

  const handleCopyBillingMessage = (acc: SuperAdminAccountSummary) => {
    const feeStr = formatBRL(acc.monthlyFee ?? 99.9);
    const dueStr = acc.billingDueDate || 'Todo dia 10';
    const text = [
      `Olá ${acc.userName} (${acc.storeName} - ${acc.storeCode})!`,
      `Segue o lembrete da mensalidade do sistema Comanda Voz:`,
      `• Valor da Mensalidade: ${feeStr}`,
      `• Vencimento: ${dueStr}`,
      `• Status atual: ${(acc.subscriptionStatus || 'em_dia').toUpperCase().replace('_', ' ')}`,
      `Assim que realizar o pagamento via PIX, envie o comprovante para darmos baixa imediata. Obrigado!`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    setFeedbackBanner({
      type: 'success',
      message: `Mensagem de cobrança (${feeStr}) copiada para enviar no WhatsApp de ${acc.userName}!`,
    });
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
              Sistema completo para Bar e Restaurante — comandas, mapa de mesas, venda avulsa e fechamento de caixa:
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
                <strong className="text-emerald-400">3. Dar Baixa &amp; Venda Avulsa:</strong>{' '}
                &ldquo;Dar baixa no Tiago&rdquo; ou &ldquo;Marcelo, venda avulsa de litrão no pix&rdquo;
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
    <>
      <pre
        ref={printReceiptPreRef}
        aria-hidden="true"
        className="hidden print:block font-mono text-[11px] leading-[1.35] whitespace-pre text-black bg-white p-2 m-0"
      />
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col print:hidden">
      {/* Simple 3-Zone Header */}
      <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-900 sticky top-0 z-30">
        <button
          type="button"
          onClick={() => setActiveSection('comandas')}
          className="text-left whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span className="text-base sm:text-lg font-bold tracking-tight text-slate-50 block leading-tight">
            {currentStoreName} · <span className="text-amber-400">Marcelo</span>
          </span>
          <span className="text-[11px] text-slate-400 block leading-none mt-0.5">
            Gestão de Bar &amp; Restaurante
          </span>
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
          {canAccessCaixa && (
            <button
              type="button"
              onClick={() => setActiveSection('caixa')}
              className={`py-1 transition-colors whitespace-nowrap cursor-pointer ${
                activeSection === 'caixa'
                  ? 'text-emerald-400 font-bold underline underline-offset-8 decoration-2'
                  : 'hover:text-slate-100'
              }`}
            >
              Caixa
            </button>
          )}
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
            <>
              <button
                type="button"
                onClick={() => setActiveSection('vendas')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSection === 'vendas'
                    ? 'text-amber-400 font-bold underline underline-offset-8 decoration-2'
                    : 'hover:text-slate-100'
                }`}
              >
                Vendas
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('equipe_comercio')}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeSection === 'equipe_comercio'
                    ? 'text-amber-400 font-bold underline underline-offset-8 decoration-2'
                    : 'hover:text-slate-100'
                }`}
              >
                Garçons ({voiceOperators.length})
              </button>
            </>
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
        {/* INSTANT ACCESS BLOCK BANNER FOR BLOCKED WAITERS */}
        {isCurrentWaiterBlocked && (
          <div className="bg-red-950/70 border border-red-600/70 rounded-xl p-4 flex items-center gap-3 text-xs sm:text-sm text-red-100">
            <Ban className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <strong className="font-bold text-red-300">
                Acesso bloqueado pelo Administrador:
              </strong>{' '}
              Novos lançamentos por voz, toque rápido ou abertura de comandas estão suspensos
              para sua conta no momento.
            </div>
          </div>
        )}

        {/* ULTRA-CLEAN MARCELO VOICE BAR (Supports Open-Mic "MARCELO" Wake-Word + Bluetooth Mic + Voice Compatibility) */}
        {activeSection === 'comandas' && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (commandInput.trim() && !isCurrentWaiterBlocked) {
                  processOrderPhrase(commandInput, 'manual');
                }
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
            >
              <button
                type="button"
                onClick={toggleVoiceRecognition}
                disabled={isProcessingCommand || isCurrentWaiterBlocked}
                className={`inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                  isListening
                    ? marceloAwakeWindowActive
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                {isListening ? (
                  <>
                    <MicOff className="w-5 h-5" />
                    {openMicWakeWordMode
                      ? marceloAwakeWindowActive
                        ? 'Marcelo Ouvindo Pedido...'
                        : 'Mic Aberto (Diga "MARCELO")'
                      : 'Ouvindo... (Clique p/ parar)'}
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5" />
                    {openMicWakeWordMode ? 'Ligar Mic Aberto ("MARCELO")' : 'Falar com Marcelo'}
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
                  placeholder='Diga: "Marcelo, marca 1 litrão para Tiago" ou "Marcelo, venda avulsa de litrão no pix"'
                  disabled={isProcessingCommand || isCurrentWaiterBlocked}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-lg px-4 py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
                />
                {isProcessingCommand && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-400 font-mono">
                    Processando...
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={isProcessingCommand || isCurrentWaiterBlocked || !commandInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Executar
              </button>

              <button
                type="button"
                onClick={() => setShowVoiceConfigBar((v) => !v)}
                title="Configurar Microfone Bluetooth, Palavra MARCELO e Voz do Garçom"
                className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-3.5 rounded-lg border text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  showVoiceConfigBar || audioDevices.some((d) => d.isBluetooth)
                    ? 'bg-slate-950 border-sky-500/50 text-sky-400'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <Bluetooth className="w-4 h-4" />
                <span className="hidden md:inline">Bluetooth / Voz</span>
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

            {/* Compact Status Bar: Wake-Word Mode + Bluetooth + Voice Compatibility */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenMicWakeWordMode((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors cursor-pointer ${
                    openMicWakeWordMode
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  {openMicWakeWordMode
                    ? 'Ativar só ao falar "MARCELO": LIGADO'
                    : 'Ativar só ao falar "MARCELO": DESLIGADO'}
                </button>

                {lastVoiceCompatibility && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-emerald-500/40 text-emerald-300 font-mono">
                    <AudioLines className="w-3.5 h-3.5" />
                    Voz: {lastVoiceCompatibility.operatorName} ({lastVoiceCompatibility.confidence}% compatível)
                  </span>
                )}

                {isListening && openMicWakeWordMode && lastIgnoredOpenMicPhrase && (
                  <span className="text-amber-300/90 truncate max-w-md">
                    Ouvi: &ldquo;{lastIgnoredOpenMicPhrase}&rdquo; (para executar, comece com &ldquo;Marcelo&rdquo;)
                  </span>
                )}
                {isListening && !lastIgnoredOpenMicPhrase && (
                  <span className="text-emerald-400 font-medium">
                    {interimTranscript
                      ? `Transcrevendo: "${interimTranscript}"`
                      : openMicWakeWordMode
                      ? 'Escutando... Diga "Marcelo" + pedido (ex: "Marcelo marca 1 cerveja pro Tiago")'
                      : 'Escutando... Fale o pedido diretamente'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
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
            </div>

            {/* Expandable Bluetooth Microphone & Waiter Voice Calibration Drawer */}
            {showVoiceConfigBar && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-3 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5 space-y-1">
                    <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                      <Bluetooth className="w-3.5 h-3.5 text-sky-400" />
                      Microfone do Garçom (Fone Bluetooth / Lapela / Aparelho)
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedMicDeviceId}
                        onChange={(e) => {
                          setSelectedMicDeviceId(e.target.value);
                          try {
                            localStorage.setItem('comanda_voz_selected_mic_id', e.target.value);
                          } catch {
                            // ignore
                          }
                        }}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      >
                        <option value="default">Microfone Padrão / Automático</option>
                        {audioDevices.map((dev) => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.isBluetooth ? `[BLUETOOTH] ${dev.label}` : dev.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => refreshAudioDevices(true)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sky-300 font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        Buscar Bluetooth
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-7 flex flex-wrap items-center justify-end gap-2">
                    {(() => {
                      const loggedWaiterOp = voiceOperators.find(
                        (op) =>
                          (op.email &&
                            directSession?.email &&
                            op.email.toLowerCase() === directSession.email.toLowerCase()) ||
                          normalizeText(op.operatorName) ===
                            normalizeText(userProfile?.userName || directSession?.userName || '')
                      );
                      return (
                        <>
                          {loggedWaiterOp && (
                            <button
                              type="button"
                              disabled={calibratingOpId === loggedWaiterOp.id}
                              onClick={() => handleCalibrateExistingWaiterVoice(loggedWaiterOp)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-lg cursor-pointer"
                            >
                              <AudioLines className="w-4 h-4" />
                              {calibratingOpId === loggedWaiterOp.id
                                ? 'Gravando sua voz (fale por 3s)...'
                                : `Gravar Minha Voz (${loggedWaiterOp.operatorName})`}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={testingCompatibility}
                            onClick={handleTestLiveVoiceCompatibility}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-emerald-300 font-semibold rounded-lg cursor-pointer"
                          >
                            <Mic className="w-3.5 h-3.5" />
                            {testingCompatibility
                              ? 'Ouvindo voz (2.5s)...'
                              : 'Testar Compatibilidade de Voz'}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  <strong>Como funciona com Microfone Aberto + Bluetooth:</strong> Conecte o fone Bluetooth no celular/computador e deixe o botão{' '}
                  <strong className="text-amber-300">Mic Aberto (Diga &ldquo;MARCELO&rdquo;)</strong> ligado. O garçom pode conversar livremente com os clientes; o sistema só executa quando ouvir a palavra{' '}
                  <strong className="text-amber-300">&ldquo;MARCELO&rdquo;</strong> antes do pedido!
                </p>
              </div>
            )}

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
                  {feedbackBanner?.type === 'error' &&
                    isInsideEmbeddedIframe() &&
                    /microfone|permissão|iframe|not-allowed|service-not-allowed/i.test(
                      feedbackBanner.message
                    ) && (
                      <a
                        href={typeof window !== 'undefined' ? window.location.href : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded cursor-pointer whitespace-nowrap"
                      >
                        Abrir em Nova Aba
                      </a>
                    )}
                  {marceloReport && (
                    <button
                      type="button"
                      onClick={() => speakAsMarcelo(marceloReport.spokenSummary, true)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 rounded cursor-pointer"
                    >
                      Ouvir
                    </button>
                  )}
                  {isAdmin &&
                    lastUndo &&
                    (marceloReport?.intent === 'MARCAR' ||
                      marceloReport?.intent === 'VENDA_AVULSA') && (
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
            className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border text-xs ${
              feedbackBanner.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-200'
                : 'bg-red-950/50 border-red-800/70 text-red-200'
            }`}
          >
            <span>{feedbackBanner.message}</span>
            <div className="flex items-center gap-2">
              {feedbackBanner.type === 'error' &&
                isInsideEmbeddedIframe() &&
                /microfone|permissão|iframe|not-allowed|service-not-allowed/i.test(
                  feedbackBanner.message
                ) && (
                  <a
                    href={typeof window !== 'undefined' ? window.location.href : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded cursor-pointer whitespace-nowrap"
                  >
                    Abrir em Nova Aba
                  </a>
                )}
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* SECTION 1: COMANDAS (SIMPLE 2-COLUMN LAYOUT) */}
        {activeSection === 'comandas' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Customer Tabs List + Mapa de Mesas + Quick Venda Avulsa */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-100">
                    {comandasViewMode === 'mesas'
                      ? 'Mapa de Mesas'
                      : `Clientes (${filteredTabs.length})`}
                  </h2>
                  <div className="inline-flex p-0.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px]">
                    <button
                      type="button"
                      onClick={() => setComandasViewMode('lista')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded font-medium cursor-pointer ${
                        comandasViewMode === 'lista'
                          ? 'bg-slate-800 text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <List className="w-3 h-3" />
                      Lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setComandasViewMode('mesas')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded font-medium cursor-pointer ${
                        comandasViewMode === 'mesas'
                          ? 'bg-slate-800 text-amber-400'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <LayoutGrid className="w-3 h-3" />
                      Mesas
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isCurrentWaiterBlocked}
                    onClick={() => {
                      if (!avulsaMenuId && menuItems.length > 0) {
                        setAvulsaMenuId(menuItems[0].id);
                      }
                      setShowQuickVendaAvulsa((prev) => !prev);
                      setShowNewTabForm(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 disabled:opacity-40 text-emerald-300 rounded-lg transition-colors cursor-pointer"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" />
                    Avulsa
                  </button>
                  <button
                    type="button"
                    disabled={isCurrentWaiterBlocked}
                    onClick={() => {
                      setShowNewTabForm((prev) => !prev);
                      setShowQuickVendaAvulsa(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 rounded-lg transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Nova Comanda
                  </button>
                </div>
              </div>

              {showQuickVendaAvulsa && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const chosen =
                      menuItems.find((m) => m.id === avulsaMenuId) || menuItems[0];
                    if (!chosen) return;
                    await executeStageVendaAvulsa(
                      [
                        {
                          itemName: chosen.name,
                          category: chosen.category,
                          quantity: Math.max(1, avulsaQty),
                          unitPrice: chosen.price,
                        },
                      ],
                      avulsaPaymentMethod,
                      `Venda avulsa ${avulsaQty}x ${chosen.name} (${avulsaPaymentMethod})`,
                      'manual',
                      activeWaiterDisplay.name,
                      activeWaiterDisplay.storeName
                    );
                    setAvulsaQty(1);
                    setShowQuickVendaAvulsa(false);
                  }}
                  className="p-3 bg-emerald-950/30 border border-emerald-500/40 rounded-lg space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-300">
                      Venda Avulsa (Balcão · Sem Mesa)
                    </span>
                    <span className="text-[11px] text-slate-400">Vai direto pro Caixa</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <select
                      value={avulsaMenuId || menuItems[0]?.id || ''}
                      onChange={(e) => setAvulsaMenuId(e.target.value)}
                      className="sm:col-span-6 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                    >
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({formatBRL(m.price)})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={avulsaQty}
                      onChange={(e) =>
                        setAvulsaQty(Math.max(1, parseInt(e.target.value || '1', 10) || 1))
                      }
                      className="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 font-mono text-center"
                    />
                    <select
                      value={avulsaPaymentMethod}
                      onChange={(e) => setAvulsaPaymentMethod(e.target.value)}
                      className="sm:col-span-4 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                    >
                      <option value="PIX">PIX</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="Cartão de Débito">Débito</option>
                      <option value="Cartão de Crédito">Crédito</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowQuickVendaAvulsa(false)}
                      className="px-3 py-1.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={menuItems.length === 0}
                      className="px-3.5 py-1.5 font-bold bg-emerald-500 text-slate-950 rounded-md hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
                    >
                      Baixar no Caixa
                    </button>
                  </div>
                </form>
              )}

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
                      placeholder="Mesa (ex: Mesa 04)"
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

              {comandasViewMode === 'mesas' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 12 }, (_, idx) => {
                      const numStr = String(idx + 1).padStart(2, '0');
                      const tableNormKey = `mesa ${idx + 1}`;
                      const matchingTabs = activeStageTabs.filter((t) => {
                        const tLabelNorm = normalizeText(t.tableLabel || '');
                        const tNameNorm = normalizeText(t.customerName || '');
                        return (
                          tLabelNorm === tableNormKey ||
                          tLabelNorm === `mesa ${numStr}` ||
                          tNameNorm === tableNormKey ||
                          tNameNorm === `mesa ${numStr}`
                        );
                      });
                      const primaryTab = matchingTabs[0] || null;
                      const tableRemaining = matchingTabs.reduce(
                        (acc, t) => acc + getRemainingBalance(t),
                        0
                      );
                      const isSelected = Boolean(
                        primaryTab && selectedTab?.id === primaryTab.id
                      );
                      const statusStyle = !primaryTab
                        ? 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        : primaryTab.status === 'closing'
                          ? 'bg-sky-950/40 border-sky-500/60 text-sky-200'
                          : primaryTab.status === 'paid' && tableRemaining <= 0
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                            : 'bg-amber-950/30 border-amber-500/60 text-amber-100';

                      return (
                        <button
                          key={numStr}
                          type="button"
                          onClick={() => {
                            if (primaryTab) {
                              setSelectedTabId(primaryTab.id);
                              setShowBaixaDrawer(false);
                            } else {
                              setNewTableLabel(`Mesa ${numStr}`);
                              setNewCustomerName(`Mesa ${numStr}`);
                              setShowNewTabForm(true);
                            }
                          }}
                          className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${statusStyle} ${
                            isSelected ? 'ring-2 ring-amber-400' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-bold">
                            <span>Mesa {numStr}</span>
                            <span className="text-[10px] font-normal opacity-80">
                              {!primaryTab
                                ? 'Livre'
                                : primaryTab.status === 'closing'
                                  ? 'Fechando'
                                  : primaryTab.status === 'paid' && tableRemaining <= 0
                                    ? 'Paga'
                                    : 'Ocupada'}
                            </span>
                          </div>
                          {primaryTab ? (
                            <div className="mt-1 space-y-0.5">
                              <div className="text-[11px] truncate text-slate-200">
                                {primaryTab.customerName}
                              </div>
                              <div className="text-xs font-mono font-bold text-amber-400">
                                {formatBRL(tableRemaining)}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 text-[10px] text-slate-500">+ Abrir</div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {activeStageTabs.filter((t) => !/^mesa\s+\d+/i.test((t.tableLabel || t.customerName).trim())).length > 0 && (
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                      <span className="text-[11px] font-semibold text-slate-400 block">
                        Comandas Individuais (Sem Mesa Fixa)
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {activeStageTabs
                          .filter(
                            (t) =>
                              !/^mesa\s+\d+/i.test((t.tableLabel || t.customerName).trim())
                          )
                          .map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => {
                                setSelectedTabId(t.id);
                                setShowBaixaDrawer(false);
                              }}
                              className={`px-2.5 py-1 rounded-md border text-xs cursor-pointer ${
                                selectedTab?.id === t.id
                                  ? 'bg-slate-800 border-amber-500 text-amber-300 font-bold'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              {t.customerName} · {formatBRL(getRemainingBalance(t))}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
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

                  {autoArchivePaidAfter10Min && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-emerald-300">
                      <span>Auto-arquivo ativo: comandas pagas somem após 10 min</span>
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar cliente ou mesa (ex: Tiago / Mesa 04)..."
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
                </>
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
                        onClick={() => handlePrintReceipt(selectedTab)}
                        title="Imprimir conta em impressora térmica (texto simples, 40 colunas)"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5 text-amber-400" />
                        Imprimir Conta
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
                                    disabled={isCurrentWaiterBlocked}
                                    onClick={() => handleAdjustTabItemQty(latestEntry, 1)}
                                    className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-400 flex items-center justify-center cursor-pointer"
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

                  {/* Quick 1-Tap Product Buttons with Restaurant/Bar Category Tabs */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-300">
                        Toque rápido para marcar na conta de {selectedTab.customerName}:
                      </span>
                      <div className="flex flex-wrap gap-1 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setQuickAddCategoryFilter('all')}
                          className={`px-2 py-0.5 rounded border cursor-pointer ${
                            quickAddCategoryFilter === 'all'
                              ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Todos
                        </button>
                        {(Object.keys(CATEGORY_LABELS) as ItemCategory[])
                          .filter((cat) => menuItems.some((m) => m.category === cat))
                          .map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setQuickAddCategoryFilter(cat)}
                              className={`px-2 py-0.5 rounded border cursor-pointer ${
                                quickAddCategoryFilter === cat
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {CATEGORY_LABELS[cat]}
                            </button>
                          ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {menuItems
                        .filter(
                          (m) =>
                            quickAddCategoryFilter === 'all' ||
                            m.category === quickAddCategoryFilter
                        )
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={isCurrentWaiterBlocked}
                            onClick={() => handleQuickAddMenuItem(item)}
                            className="p-2.5 bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 rounded-lg text-left transition-colors flex items-center justify-between gap-2 cursor-pointer"
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

        {/* SECTION 1B: CAIXA & FECHAMENTO DIÁRIO (Vendas Avulsas + Comandas Baixadas) */}
        {activeSection === 'caixa' && canAccessCaixa && (() => {
          const allAvulsaForDay = tabs.filter(
            (t) =>
              t.tableLabel === 'VENDA_AVULSA' &&
              toLocalDateInputValue(new Date(getTimestampMillis(t.updatedAt || t.createdAt))) ===
                caixaDateKey
          );
          const allPaidTabsForDay = tabs.filter(
            (t) =>
              t.tableLabel !== 'VENDA_AVULSA' &&
              (t.paidAmount || 0) > 0 &&
              toLocalDateInputValue(new Date(getTimestampMillis(t.updatedAt || t.createdAt))) ===
                caixaDateKey
          );

          const directSalesTotal = Number(
            allAvulsaForDay
              .reduce((acc, t) => acc + (t.paidAmount || t.totalAmount || 0), 0)
              .toFixed(2)
          );
          const tabsPaidTotal = Number(
            allPaidTabsForDay.reduce((acc, t) => acc + (t.paidAmount || 0), 0).toFixed(2)
          );
          const totalReceived = Number((directSalesTotal + tabsPaidTotal).toFixed(2));
          const openReceivableTotal = Number(
            activeStageTabs.reduce((acc, t) => acc + getRemainingBalance(t), 0).toFixed(2)
          );
          const openTabsCount = activeStageTabs.filter((t) => getRemainingBalance(t) > 0).length;

          const methodMap = new Map<string, { method: string; total: number; count: number }>();
          for (const t of [...allAvulsaForDay, ...allPaidTabsForDay]) {
            const methodLabel = (t.paymentMethod || '').trim() || 'PIX';
            const paidVal = t.paidAmount || 0;
            if (paidVal <= 0) continue;
            const prev = methodMap.get(methodLabel) || {
              method: methodLabel,
              total: 0,
              count: 0,
            };
            prev.total = Number((prev.total + paidVal).toFixed(2));
            prev.count += 1;
            methodMap.set(methodLabel, prev);
          }
          const byMethod = Array.from(methodMap.values()).sort((a, b) => b.total - a.total);

          const dateLabelFormatted = (() => {
            const parts = caixaDateKey.split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return caixaDateKey;
          })();

          const handlePrintCashClosing = () => {
            const closingText = formatThermalCashClosingText(
              {
                storeName: currentStoreName,
                dateLabel: dateLabelFormatted,
                operatorName: activeWaiterDisplay.name,
                totalReceived,
                directSalesTotal,
                directSalesCount: allAvulsaForDay.length,
                tabsPaidTotal,
                tabsPaidCount: allPaidTabsForDay.length,
                openReceivableTotal,
                openTabsCount,
                byMethod,
              },
              40
            );
            if (printReceiptPreRef.current) {
              printReceiptPreRef.current.textContent = closingText;
            }
            try {
              window.print();
              setFeedbackBanner({
                type: 'success',
                message: `Fechamento de Caixa (${dateLabelFormatted}) formatado (40 colunas) para impressão.`,
              });
            } catch {
              setFeedbackBanner({
                type: 'error',
                message: 'Não foi possível abrir o diálogo de impressão neste dispositivo.',
              });
            }
          };

          return (
            <div className="space-y-5">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                      <Wallet className="w-5 h-5 text-emerald-400" />
                      Caixa &amp; Fechamento Diário
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Separa vendas avulsas de balcão (sem mesa) e recebimentos das comandas.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <label className="inline-flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      <input
                        type="date"
                        value={caixaDateKey}
                        onChange={(e) =>
                          setCaixaDateKey(e.target.value || toLocalDateInputValue(new Date()))
                        }
                        className="bg-transparent text-slate-100 focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handlePrintCashClosing}
                      className="inline-flex items-center gap-1.5 px-4 py-2 font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      Imprimir Fechamento
                    </button>
                  </div>
                </div>

                {/* KPI Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-4 bg-slate-950 border border-emerald-500/40 rounded-lg space-y-1">
                    <span className="text-xs text-slate-400 block">Total em Caixa ({dateLabelFormatted})</span>
                    <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                      {formatBRL(totalReceived)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                    <span className="text-xs text-slate-400 block">
                      Vendas Avulsas ({allAvulsaForDay.length})
                    </span>
                    <span className="text-xl font-bold font-mono tabular-nums text-amber-400">
                      {formatBRL(directSalesTotal)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                    <span className="text-xs text-slate-400 block">
                      Comandas Recebidas ({allPaidTabsForDay.length})
                    </span>
                    <span className="text-xl font-bold font-mono tabular-nums text-sky-400">
                      {formatBRL(tabsPaidTotal)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                    <span className="text-xs text-slate-400 block">
                      Em Aberto Mesas ({openTabsCount})
                    </span>
                    <span className="text-xl font-bold font-mono tabular-nums text-slate-200">
                      {formatBRL(openReceivableTotal)}
                    </span>
                  </div>
                </div>

                {/* Quick Venda Avulsa Bar inside Caixa */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const chosen =
                      menuItems.find((m) => m.id === avulsaMenuId) || menuItems[0];
                    if (!chosen) return;
                    await executeStageVendaAvulsa(
                      [
                        {
                          itemName: chosen.name,
                          category: chosen.category,
                          quantity: Math.max(1, avulsaQty),
                          unitPrice: chosen.price,
                        },
                      ],
                      avulsaPaymentMethod,
                      `Venda avulsa ${avulsaQty}x ${chosen.name} (${avulsaPaymentMethod})`,
                      'manual',
                      activeWaiterDisplay.name,
                      activeWaiterDisplay.storeName
                    );
                    setAvulsaQty(1);
                  }}
                  className="p-3.5 bg-slate-950 border border-emerald-500/30 rounded-lg flex flex-col sm:flex-row items-stretch sm:items-end gap-3 text-xs"
                >
                  <div className="flex-1 space-y-1">
                    <label className="text-emerald-300 font-semibold block">
                      Lançar Venda Avulsa (Balcão — Não entra em mesa)
                    </label>
                    <select
                      value={avulsaMenuId || menuItems[0]?.id || ''}
                      onChange={(e) => setAvulsaMenuId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                    >
                      {menuItems.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} — {formatBRL(m.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-full sm:w-20 space-y-1">
                    <label className="text-slate-400 block">Qtd</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={avulsaQty}
                      onChange={(e) =>
                        setAvulsaQty(Math.max(1, parseInt(e.target.value || '1', 10) || 1))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-center"
                    />
                  </div>
                  <div className="w-full sm:w-44 space-y-1">
                    <label className="text-slate-400 block">Pagamento</label>
                    <select
                      value={avulsaPaymentMethod}
                      onChange={(e) => setAvulsaPaymentMethod(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                    >
                      <option value="PIX">PIX</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={menuItems.length === 0 || isCurrentWaiterBlocked}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    + Registrar e Baixar
                  </button>
                </form>

                {/* Payment Method Breakdown */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">
                    Resumo por Forma de Pagamento
                  </h3>
                  {byMethod.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhum pagamento registrado para {dateLabelFormatted}.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                      {byMethod.map((row) => (
                        <div
                          key={row.method}
                          className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between"
                        >
                          <div>
                            <div className="font-semibold text-slate-200">{row.method}</div>
                            <div className="text-[11px] text-slate-400">
                              {row.count} {row.count === 1 ? 'baixa' : 'baixas'}
                            </div>
                          </div>
                          <div className="font-mono font-bold text-emerald-400">
                            {formatBRL(row.total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Split Tables: Vendas Avulsas vs Comandas Pagas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-amber-400" />
                    Vendas Avulsas do Dia ({allAvulsaForDay.length})
                  </h3>
                  {allAvulsaForDay.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Nenhuma venda avulsa lançada em {dateLabelFormatted}. Diga &ldquo;Marcelo, venda avulsa de litrão no pix&rdquo;.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/50 text-xs">
                      {allAvulsaForDay.map((sale) => {
                        const saleItems = tabItems.filter((i) => i.tabId === sale.id);
                        const timeStr = new Date(
                          getTimestampMillis(sale.createdAt)
                        ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div
                            key={sale.id}
                            className="p-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100">
                                {saleItems.length > 0
                                  ? saleItems
                                      .map((i) => `${i.quantity}x ${i.itemName}`)
                                      .join(', ')
                                  : 'Venda Avulsa'}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {timeStr} · {sale.paymentMethod || 'PIX'} ·{' '}
                                {saleItems[0]?.launchedByName || 'Balcão'}
                              </div>
                            </div>
                            <div className="font-mono font-bold text-amber-400 shrink-0">
                              {formatBRL(sale.paidAmount || sale.totalAmount)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-sky-400" />
                    Comandas Recebidas no Dia ({allPaidTabsForDay.length})
                  </h3>
                  {allPaidTabsForDay.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Nenhuma comanda com baixa registrada em {dateLabelFormatted}.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/50 text-xs">
                      {allPaidTabsForDay.map((t) => {
                        const timeStr = new Date(
                          getTimestampMillis(t.updatedAt || t.createdAt)
                        ).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div
                            key={t.id}
                            className="p-3 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-100 truncate">
                                {t.customerName}
                                {t.tableLabel ? ` · ${t.tableLabel}` : ''}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {timeStr} · {t.paymentMethod || 'PIX'} · {STAGE_LABELS[t.status]}
                              </div>
                            </div>
                            <div className="font-mono font-bold text-emerald-400 shrink-0">
                              {formatBRL(t.paidAmount)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

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
                      Cadastre os itens e preços manualmente ou falando pelo microfone.
                    </p>
                  </div>

                  {/* Voice Product Registration Box */}
                  {!editingMenuId && (
                    <div className="p-3 bg-slate-950 border border-amber-500/30 rounded-lg space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                          <Mic className="w-3.5 h-3.5" />
                          Cadastrar Produto por Voz
                        </span>
                        <button
                          type="button"
                          disabled={menuVoiceProcessing || savingMenu}
                          onClick={toggleCardapioVoiceCapture}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                            isListeningMenuVoice
                              ? 'bg-red-500 hover:bg-red-400 text-white animate-pulse'
                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          }`}
                        >
                          {isListeningMenuVoice ? (
                            <>
                              <MicOff className="w-3.5 h-3.5" />
                              Parar Escuta
                            </>
                          ) : (
                            <>
                              <Mic className="w-3.5 h-3.5" />
                              {menuVoiceProcessing ? 'Cadastrando...' : 'Falar Produto'}
                            </>
                          )}
                        </button>
                      </div>

                      {isListeningMenuVoice ? (
                        <p className="text-emerald-400 font-medium">
                          {menuVoiceInterim
                            ? `Transcrevendo: "${menuVoiceInterim}"`
                            : 'Ouvindo... Diga produto + "reais" + valor (ex: "Porção de salame reais 15").'}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Use <strong className="text-amber-300">&ldquo;reais&rdquo;</strong> para separar o valor:{' '}
                          <span className="text-slate-200">&ldquo;Porção de salame reais 15&rdquo;</span>,{' '}
                          <span className="text-slate-200">&ldquo;Dose de 51 reais 8&rdquo;</span> ou vários juntos:{' '}
                          <span className="text-slate-200">&ldquo;Litrão Brahma reais 18, Água reais 5&rdquo;</span>.
                        </p>
                      )}
                    </div>
                  )}

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
                          <option value="doses">Doses &amp; Drinks</option>
                          <option value="pratos">Pratos &amp; Refeições</option>
                          <option value="porcoes">Porções &amp; Espetos</option>
                          <option value="sobremesas">Sobremesas</option>
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

              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCardapioCategoryFilter('all')}
                  className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                    cardapioCategoryFilter === 'all'
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todos ({menuItems.length})
                </button>
                {(Object.keys(CATEGORY_LABELS) as ItemCategory[])
                  .filter((cat) => menuItems.some((m) => m.category === cat))
                  .map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCardapioCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-md border cursor-pointer ${
                        cardapioCategoryFilter === cat
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-semibold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {CATEGORY_LABELS[cat]} (
                      {menuItems.filter((m) => m.category === cat).length})
                    </button>
                  ))}
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
                      {menuItems
                        .filter(
                          (item) =>
                            cardapioCategoryFilter === 'all' ||
                            item.category === cardapioCategoryFilter
                        )
                        .map((item) => (
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

        {/* SECTION 3: DASHBOARD DE VENDAS (7 DIAS - ADM ONLY) */}
        {activeSection === 'vendas' && isAdmin && (
          <SalesDashboard
            storeName={currentStoreName}
            tabs={tabs}
            tabItems={tabItems}
            getTimestampMillis={getTimestampMillis}
            onGoToComandas={() => setActiveSection('comandas')}
          />
        )}

        {/* SECTION 4: GARÇONS, BIOMETRIA DE VOZ, BLOQUEIO DE ACESSO & RELATÓRIO DE PERFORMANCE (ADM ONLY) */}
        {activeSection === 'equipe_comercio' && isAdmin && (() => {
          const now = new Date();
          const sevenDaysStartMs = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 6
          ).getTime();

          const tabsById = new Map<string, BarTab>();
          for (const t of tabs) {
            tabsById.set(t.id, t);
          }

          const extractWaiterBaseName = (rawAttr?: string): string => {
            return (rawAttr || '')
              .replace(/\s*\((?:Garçom|ADM|Proprietário|SUPERADMIN|Voz\s+\d+%)\)\s*$/i, '')
              .trim();
          };

          const recentItems = tabItems.filter(
            (item) => getTimestampMillis(item.createdAt) >= sevenDaysStartMs
          );

          const waiterPerfRows = voiceOperators.map((op) => {
            const opNorm = normalizeText(op.operatorName);
            let itemsCount = 0;
            let launchesCount = 0;
            let itemsTotalValue = 0;
            const associatedTabIds = new Set<string>();

            for (const item of recentItems) {
              const launcherBase = extractWaiterBaseName(item.launchedByName);
              const launcherNorm = normalizeText(launcherBase);
              if (!launcherNorm || !opNorm) continue;

              const matchesOperator =
                launcherNorm === opNorm ||
                areCustomerNamesEquivalent(launcherBase, op.operatorName);

              if (matchesOperator) {
                const qty = Number(item.quantity);
                const val = Number(item.totalPrice);
                itemsCount += Number.isFinite(qty) && qty > 0 ? qty : 1;
                launchesCount += 1;
                itemsTotalValue += Number.isFinite(val) && val > 0 ? val : 0;
                if (item.tabId) {
                  associatedTabIds.add(item.tabId);
                }
              }
            }

            let associatedTabsTotalValue = 0;
            for (const tId of associatedTabIds) {
              const foundTab = tabsById.get(tId);
              if (foundTab) {
                associatedTabsTotalValue += Number(foundTab.totalAmount) || 0;
              }
            }

            return {
              operator: op,
              itemsCount,
              launchesCount,
              itemsTotalValue: Number(itemsTotalValue.toFixed(2)),
              associatedTabsCount: associatedTabIds.size,
              associatedTabsTotalValue: Number(associatedTabsTotalValue.toFixed(2)),
            };
          });

          waiterPerfRows.sort(
            (a, b) =>
              b.itemsCount - a.itemsCount ||
              b.associatedTabsTotalValue - a.associatedTabsTotalValue
          );

          const totalWaiterItemsWeek = waiterPerfRows.reduce((acc, r) => acc + r.itemsCount, 0);
          const allWaiterTabIds = new Set<string>();
          for (const item of recentItems) {
            const launcherBase = extractWaiterBaseName(item.launchedByName);
            const belongsToAnyWaiter = voiceOperators.some((op) => {
              const opNorm = normalizeText(op.operatorName);
              const launcherNorm = normalizeText(launcherBase);
              return (
                launcherNorm === opNorm ||
                areCustomerNamesEquivalent(launcherBase, op.operatorName)
              );
            });
            if (belongsToAnyWaiter && item.tabId) {
              allWaiterTabIds.add(item.tabId);
            }
          }
          const uniqueTeamTabsValue = Array.from(allWaiterTabIds).reduce(
            (sum, tid) => sum + (Number(tabsById.get(tid)?.totalAmount) || 0),
            0
          );
          const maxItemsPerWaiter = Math.max(
            1,
            ...waiterPerfRows.map((r) => r.itemsCount)
          );
          const topWaiter = waiterPerfRows[0]?.itemsCount > 0 ? waiterPerfRows[0] : null;
          const blockedCount = voiceOperators.filter((op) => op.accessBlocked).length;

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-5 space-y-5">
                  {/* ADM Register Waiter Form + Voice Print */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="space-y-1">
                      <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-amber-400" />
                        Cadastrar Garçom (Login + Voz Compatível)
                      </h2>
                      <p className="text-xs text-slate-400">
                        O garçom entra com e-mail e senha, usa microfone Bluetooth e só pode adicionar
                        pedidos (não remove nada).
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

                      {/* Optional Biometric Voice Capture during Registration */}
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className="font-semibold text-slate-200 block">
                              Biometria de Voz do Garçom (Opcional)
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {newOpVoiceSample
                                ? `Voz capturada: ${newOpVoiceSample.pitchHz} Hz (Timbre ${Math.round(newOpVoiceSample.spectralCentroid)} Hz)`
                                : 'Peça para o garçom falar por 3s para medir compatibilidade'}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={capturingNewOpVoice}
                            onClick={handleCaptureVoiceForNewWaiter}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold rounded-lg shrink-0 cursor-pointer"
                          >
                            <AudioLines className="w-4 h-4" />
                            {capturingNewOpVoice ? 'Ouvindo (3s)...' : 'Gravar Voz (3s)'}
                          </button>
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

                  {/* Store Settings & ADM Options */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Store className="w-4 h-4 text-amber-400" />
                      Dados do Bar &amp; Configurações do ADM
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

                      <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoArchivePaidAfter10Min}
                          onChange={(e) => handleToggleAutoArchiveSetting(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-amber-500 accent-amber-500 cursor-pointer shrink-0"
                        />
                        <span className="space-y-0.5">
                          <span className="block font-semibold text-slate-100">
                            Arquivar comandas automaticamente após 10 minutos de pagamento
                          </span>
                          <span className="block text-[11px] text-slate-400 leading-relaxed">
                            Mantém a lista de comandas limpa apenas com o que está aberto, movendo
                            contas já pagas (zeradas) para o arquivo automaticamente 10 min após a
                            baixa.
                          </span>
                        </span>
                      </label>

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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-slate-100">
                        Garçons Cadastrados ({voiceOperators.length})
                        {blockedCount > 0 && (
                          <span className="ml-2 text-xs font-medium text-red-400">
                            · {blockedCount} {blockedCount === 1 ? 'bloqueado' : 'bloqueados'}
                          </span>
                        )}
                      </h2>
                      <p className="text-xs text-slate-400">
                        Grave a voz de cada garçom ou bloqueie o acesso instantaneamente para
                        impedir novos lançamentos.
                      </p>
                    </div>
                    {voiceOperators.length > 0 && (
                      <button
                        type="button"
                        disabled={testingCompatibility}
                        onClick={handleTestLiveVoiceCompatibility}
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        <AudioLines className="w-4 h-4" />
                        {testingCompatibility ? 'Medindo Voz (2.5s)...' : 'Testar Compatibilidade Agora'}
                      </button>
                    )}
                  </div>

                  {lastVoiceCompatibility && (
                    <div className="p-3 bg-slate-950 border border-emerald-500/40 rounded-lg flex items-center justify-between text-xs">
                      <span className="text-emerald-300 font-medium">
                        Último teste de voz: <strong>{lastVoiceCompatibility.operatorName}</strong> com{' '}
                        <strong className="font-mono">{lastVoiceCompatibility.confidence}%</strong> de
                        compatibilidade ({lastVoiceCompatibility.pitchHz} Hz)
                      </span>
                    </div>
                  )}

                  {voiceOperators.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-400">
                      Nenhum garçom cadastrado ainda. Use o formulário ao lado para criar o login e
                      gravar a voz dos garçons.
                    </div>
                  ) : (
                    <div className="border border-slate-800 rounded-lg overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                            <th className="py-2.5 px-4 font-medium">Garçom</th>
                            <th className="py-2.5 px-4 font-medium">Login</th>
                            <th className="py-2.5 px-4 font-medium">Biometria de Voz</th>
                            <th className="py-2.5 px-4 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                          {voiceOperators.map((op) => {
                            const isBlocked = Boolean(op.accessBlocked);
                            return (
                              <tr
                                key={op.id}
                                className={
                                  isBlocked ? 'bg-red-950/20 hover:bg-red-950/30' : 'hover:bg-slate-800/30'
                                }
                              >
                                <td className="py-2.5 px-4">
                                  <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                                    <span>{op.operatorName}</span>
                                    {isBlocked && (
                                      <span className="text-[10px] font-bold text-red-300 bg-red-950/80 border border-red-700/70 px-1.5 py-0.5 rounded">
                                        BLOQUEADO
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      isBlocked ? 'text-red-400' : 'text-amber-400'
                                    }`}
                                  >
                                    {isBlocked ? 'Lançamentos bloqueados' : 'Ativo · Somente Adicionar'}
                                  </div>
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
                                    <div className="space-y-0.5 font-mono">
                                      <span
                                        className={
                                          op.samplesCount > 1
                                            ? 'text-emerald-400 font-semibold block'
                                            : 'text-slate-400 block'
                                        }
                                      >
                                        {op.samplesCount > 1
                                          ? `Voz Calibrada (${op.pitchHz} Hz)`
                                          : `Padrão (${op.pitchHz} Hz)`}
                                      </span>
                                      <span className="text-[11px] text-slate-500 block font-sans">
                                        {op.samplesCount} {op.samplesCount === 1 ? 'amostra' : 'amostras'}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={togglingAccessOpId === op.id}
                                      onClick={() => handleToggleWaiterAccess(op)}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                                        isBlocked
                                          ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/50'
                                          : 'bg-red-950/70 hover:bg-red-900/80 text-red-200 border-red-700/70'
                                      }`}
                                      title={
                                        isBlocked
                                          ? 'Liberar acesso para este garçom fazer lançamentos'
                                          : 'Bloquear acesso instantaneamente e impedir novos lançamentos'
                                      }
                                    >
                                      {isBlocked ? (
                                        <>
                                          <Unlock className="w-3.5 h-3.5" />
                                          {togglingAccessOpId === op.id
                                            ? 'Atualizando...'
                                            : 'Liberar Acesso'}
                                        </>
                                      ) : (
                                        <>
                                          <Ban className="w-3.5 h-3.5" />
                                          {togglingAccessOpId === op.id
                                            ? 'Bloqueando...'
                                            : 'Bloquear Acesso'}
                                        </>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={calibratingOpId === op.id}
                                      onClick={() => handleCalibrateExistingWaiterVoice(op)}
                                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded font-semibold cursor-pointer"
                                      title="Gravar 3 segundos da voz deste garçom"
                                    >
                                      {calibratingOpId === op.id ? 'Ouvindo 3s...' : 'Gravar Voz'}
                                    </button>
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
                                        Senha
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
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* RELATÓRIO DE PERFORMANCE DOS GARÇONS (ÚLTIMA SEMANA) */}
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-amber-400" />
                      Relatório de Performance — Última Semana (7 dias)
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Quantidade de itens lançados por cada garçom nos últimos 7 dias e o valor
                      total das comandas associadas aos atendimentos de cada funcionário.
                    </p>
                  </div>
                </div>

                {/* KPI Summary Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/60">
                  <div className="p-4 space-y-1">
                    <div className="text-xs text-slate-400">Itens Lançados pela Equipe (7 dias)</div>
                    <div className="text-xl font-bold text-amber-400 font-mono tabular-nums">
                      {totalWaiterItemsWeek} {totalWaiterItemsWeek === 1 ? 'item' : 'itens'}
                    </div>
                  </div>
                  <div className="p-4 space-y-1">
                    <div className="text-xs text-slate-400">Valor Total em Comandas Associadas</div>
                    <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
                      {formatBRL(uniqueTeamTabsValue)}
                      <span className="ml-2 text-xs font-sans font-normal text-slate-400">
                        · {allWaiterTabIds.size}{' '}
                        {allWaiterTabIds.size === 1 ? 'comanda' : 'comandas'}
                      </span>
                    </div>
                  </div>
                  <div className="p-4 space-y-1">
                    <div className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      Destaque da Semana
                    </div>
                    <div className="text-base font-bold text-slate-100 truncate">
                      {topWaiter
                        ? `${topWaiter.operator.operatorName} (${topWaiter.itemsCount} itens)`
                        : 'Sem lançamentos na semana'}
                    </div>
                  </div>
                </div>

                {waiterPerfRows.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-800 rounded-lg text-xs text-slate-400">
                    Cadastre garçons acima para acompanhar a produtividade semanal e o valor das
                    comandas associadas a cada um.
                  </div>
                ) : (
                  <div className="border border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                          <th className="py-2.5 px-4 font-medium">Garçom</th>
                          <th className="py-2.5 px-4 font-medium">Itens Lançados (7 dias)</th>
                          <th className="py-2.5 px-4 font-medium text-right">
                            Valor em Itens Lançados
                          </th>
                          <th className="py-2.5 px-4 font-medium text-right">
                            Comandas Associadas
                          </th>
                          <th className="py-2.5 px-4 font-medium text-right">
                            Valor Total das Comandas
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                        {waiterPerfRows.map((row) => {
                          const sharePct =
                            row.itemsCount > 0
                              ? Math.max(6, Math.round((row.itemsCount / maxItemsPerWaiter) * 100))
                              : 0;
                          return (
                            <tr key={row.operator.id} className="hover:bg-slate-800/30">
                              <td className="py-3 px-4">
                                <div className="font-semibold text-slate-100 flex items-center gap-2">
                                  <span>{row.operator.operatorName}</span>
                                  {row.operator.accessBlocked && (
                                    <span className="text-[10px] font-bold text-red-300 bg-red-950/80 border border-red-700/70 px-1.5 py-0.5 rounded">
                                      BLOQUEADO
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {row.operator.email || 'Sem e-mail'}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div className="min-w-[92px]">
                                    <span className="font-mono tabular-nums font-bold text-amber-400 text-sm">
                                      {row.itemsCount} {row.itemsCount === 1 ? 'item' : 'itens'}
                                    </span>
                                    <span className="block text-[11px] text-slate-500">
                                      {row.launchesCount}{' '}
                                      {row.launchesCount === 1 ? 'lançamento' : 'lançamentos'}
                                    </span>
                                  </div>
                                  <div className="flex-1 max-w-[140px] h-2 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                                    <div
                                      className="h-full bg-amber-500 rounded-full transition-all"
                                      style={{ width: `${sharePct}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200 font-semibold">
                                {formatBRL(row.itemsTotalValue)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                                {row.associatedTabsCount}{' '}
                                {row.associatedTabsCount === 1 ? 'comanda' : 'comandas'}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-400 text-sm">
                                {formatBRL(row.associatedTabsTotalValue)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          );
        })()}

        {/* SECTION 5: SUPERADMIN (ADMINISTRAÇÃO DE USUÁRIOS ADM vs GARÇOM E COBRANÇA DE MENSALIDADES) */}
        {activeSection === 'superadmin' && isSuperAdmin && (() => {
          const admAccounts = superAccounts.filter((a) => a.userRole === 'ADM');
          const waiterAccounts = superAccounts.filter((a) => a.userRole === 'Garçom');
          const totalMonthlyMrr = admAccounts.reduce(
            (sum, a) => sum + (typeof a.monthlyFee === 'number' ? a.monthlyFee : 99.9),
            0
          );
          const unpaidAdms = admAccounts.filter(
            (a) => a.subscriptionStatus && a.subscriptionStatus !== 'em_dia'
          );
          const filteredSuperAccounts = superAccounts.filter((acc) => {
            if (saRoleFilter === 'ADM') return acc.userRole === 'ADM';
            if (saRoleFilter === 'Garçom') return acc.userRole === 'Garçom';
            if (saRoleFilter === 'inadimplentes') {
              return acc.userRole === 'ADM' && acc.subscriptionStatus !== 'em_dia';
            }
            return true;
          });

          return (
            <div className="space-y-6">
              {/* Top Bar: SUPERADMIN Header & Master Key */}
              <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" />
                    Painel SUPERADMIN — Gestão de Mensalidades, ADMs (Donos) e Garçons
                  </h2>
                  <p className="text-xs text-slate-300">
                    Controle quem é <strong>ADM (Dono do Bar)</strong> e quem é{' '}
                    <strong>Garçom</strong>, cobre mensalidades, dê baixa nos pagamentos e gerencie
                    acessos.
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

              {/* 4 SaaS Summary KPI Cards (Users Breakdown & Monthly Billing) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-xs text-slate-400 block">
                    Usuários ADM (Donos de Bar)
                  </span>
                  <div className="text-2xl font-bold font-mono tabular-nums text-amber-400">
                    {admAccounts.length}
                  </div>
                  <span className="text-[11px] text-slate-500 block">
                    Clientes pagantes de mensalidade
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-xs text-slate-400 block">
                    Usuários Garçom (Funcionários)
                  </span>
                  <div className="text-2xl font-bold font-mono tabular-nums text-sky-400">
                    {waiterAccounts.length}
                  </div>
                  <span className="text-[11px] text-slate-500 block">
                    Vinculados aos bares (somente adicionam)
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-xs text-slate-400 block">
                    Receita Mensal de Mensalidades
                  </span>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                    {formatBRL(totalMonthlyMrr)}
                  </div>
                  <span className="text-[11px] text-slate-500 block">
                    Soma das assinaturas dos ADMs
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
                  <span className="text-xs text-slate-400 block">
                    Mensalidades Pendentes / Atrasadas
                  </span>
                  <div
                    className={`text-2xl font-bold font-mono tabular-nums ${
                      unpaidAdms.length > 0 ? 'text-red-400' : 'text-slate-200'
                    }`}
                  >
                    {unpaidAdms.length}
                  </div>
                  <span className="text-[11px] text-slate-500 block">
                    {unpaidAdms.length === 0
                      ? 'Todos os ADMs estão em dia'
                      : 'Requer cobrança / regularização'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Create or Update Any Account (SUPERADMIN, ADM, Garçom) */}
                <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Users className="w-4 h-4 text-amber-400" />
                      Cadastrar ou Editar Usuário (ADM / Garçom)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Defina se o usuário é <strong>ADM (Dono do Bar)</strong> ou{' '}
                      <strong>Garçom</strong> e vincule ao código do bar.
                    </p>
                  </div>

                  <form onSubmit={handleSuperAdminSaveAccount} className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <label className="text-slate-300 block font-medium">Nome *</label>
                      <input
                        type="text"
                        value={saUserName}
                        onChange={(e) => setSaUserName(e.target.value)}
                        placeholder="Ex: Dono do Bar ou Garçom"
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
                        placeholder="Ex: dono@bar.com"
                        required
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <label className="text-slate-300 block font-medium">Tipo de Usuário</label>
                        <select
                          value={saUserRole}
                          onChange={(e) =>
                            setSaUserRole(e.target.value as 'SUPERADMIN' | 'ADM' | 'Garçom')
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                        >
                          <option value="ADM">ADM (Dono - Paga Mensalidade)</option>
                          <option value="Garçom">Garçom (Funcionário)</option>
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
                      {saSaving ? 'Salvando...' : 'Salvar Usuário / Senha'}
                    </button>
                  </form>
                </div>

                {/* Right Column: Users + Monthly Billing Table & Stores Table */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Users & Monthly Fee Management */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-100">
                          Administração de Usuários (ADM vs Garçom) e Mensalidades
                        </h3>
                        <p className="text-xs text-slate-400">
                          Filtre rapidamente quem é ADM ou Garçom e controle o pagamento das
                          mensalidades.
                        </p>
                      </div>

                      {/* Filter Tabs: All / ADM / Garçom / Inadimplentes */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setSaRoleFilter('all')}
                          className={`px-2.5 py-1.5 rounded-lg font-medium cursor-pointer ${
                            saRoleFilter === 'all'
                              ? 'bg-slate-800 text-slate-100'
                              : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Todos ({superAccounts.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSaRoleFilter('ADM')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                            saRoleFilter === 'ADM'
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-950 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          Somente ADMs ({admAccounts.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSaRoleFilter('Garçom')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                            saRoleFilter === 'Garçom'
                              ? 'bg-sky-500 text-slate-950'
                              : 'bg-slate-950 text-sky-400 border border-sky-500/30'
                          }`}
                        >
                          Somente Garçons ({waiterAccounts.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSaRoleFilter('inadimplentes')}
                          className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer ${
                            saRoleFilter === 'inadimplentes'
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-950 text-red-400 border border-red-500/30'
                          }`}
                        >
                          Pendentes / Atrasados ({unpaidAdms.length})
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-800 rounded-lg overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                            <th className="py-2.5 px-3 font-medium">Usuário / E-mail</th>
                            <th className="py-2.5 px-3 font-medium">Tipo (ADM / Garçom)</th>
                            <th className="py-2.5 px-3 font-medium">Bar Vinculado</th>
                            <th className="py-2.5 px-3 font-medium">Mensalidade & Status</th>
                            <th className="py-2.5 px-3 font-medium text-right">Cobrança & Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                          {filteredSuperAccounts.map((acc) => {
                            const status = acc.subscriptionStatus || 'em_dia';
                            const fee = typeof acc.monthlyFee === 'number' ? acc.monthlyFee : 99.9;
                            return (
                              <tr key={acc.email} className="hover:bg-slate-800/30">
                                <td className="py-3 px-3">
                                  <div className="font-semibold text-slate-100">{acc.userName}</div>
                                  <div className="font-mono text-[11px] text-slate-400">
                                    {acc.email}
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  <span
                                    className={
                                      acc.userRole === 'SUPERADMIN'
                                        ? 'text-emerald-400 font-bold'
                                        : acc.userRole === 'ADM'
                                          ? 'text-amber-400 font-bold'
                                          : 'text-sky-400 font-semibold'
                                    }
                                  >
                                    {acc.userRole === 'ADM'
                                      ? 'ADM (Dono do Bar)'
                                      : acc.userRole === 'Garçom'
                                        ? 'Garçom (Funcionário)'
                                        : 'SUPERADMIN'}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-slate-300">
                                  <div>{acc.storeName}</div>
                                  <div className="font-mono text-[11px] text-slate-400">
                                    Código: {acc.storeCode}
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  {acc.userRole === 'ADM' ? (
                                    editingBillingEmail === acc.email ? (
                                      <div className="space-y-1.5 bg-slate-900 p-2 rounded border border-slate-700">
                                        <div className="flex items-center gap-1.5">
                                          <input
                                            type="text"
                                            value={billingFeeInput}
                                            onChange={(e) => setBillingFeeInput(e.target.value)}
                                            placeholder="Valor R$"
                                            className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                                          />
                                          <input
                                            type="text"
                                            value={billingDueInput}
                                            onChange={(e) => setBillingDueInput(e.target.value)}
                                            placeholder="Vencimento"
                                            className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                                          />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <select
                                            value={billingStatusInput}
                                            onChange={(e) =>
                                              setBillingStatusInput(
                                                e.target.value as SubscriptionStatusType
                                              )
                                            }
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                                          >
                                            <option value="em_dia">Em Dia (Pago)</option>
                                            <option value="pendente">Pendente</option>
                                            <option value="atrasado">Atrasado</option>
                                            <option value="bloqueado">Bloqueado</option>
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const parsedFee = parseFloat(
                                                billingFeeInput.replace(',', '.')
                                              );
                                              handleSuperAdminUpdateBilling(acc.email, {
                                                monthlyFee: Number.isFinite(parsedFee)
                                                  ? parsedFee
                                                  : 99.9,
                                                billingDueDate: billingDueInput,
                                                subscriptionStatus: billingStatusInput,
                                              });
                                            }}
                                            className="px-2 py-1 bg-emerald-500 text-slate-950 font-bold rounded cursor-pointer"
                                          >
                                            Salvar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingBillingEmail(null)}
                                            className="text-slate-400 px-1 cursor-pointer"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-0.5 font-mono tabular-nums">
                                        <div className="font-bold text-slate-100">
                                          {formatBRL(fee)}{' '}
                                          <span className="text-[11px] font-normal text-slate-400 font-sans">
                                            ({acc.billingDueDate || 'Todo dia 10'})
                                          </span>
                                        </div>
                                        <div>
                                          <span
                                            className={
                                              status === 'em_dia'
                                                ? 'text-emerald-400 font-semibold'
                                                : status === 'pendente'
                                                  ? 'text-amber-400 font-semibold'
                                                  : 'text-red-400 font-bold'
                                            }
                                          >
                                            {status === 'em_dia'
                                              ? '● Em Dia (Paga)'
                                              : status === 'pendente'
                                                ? '● Pendente'
                                                : status === 'atrasado'
                                                  ? '▲ Atrasada'
                                                  : '✖ Bloqueado'}
                                          </span>
                                        </div>
                                      </div>
                                    )
                                  ) : (
                                    <span className="text-slate-500">
                                      Isento (Incluso no Bar)
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-right space-x-2 whitespace-nowrap">
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
                                      {acc.userRole === 'ADM' && (
                                        <>
                                          {status !== 'em_dia' ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSuperAdminUpdateBilling(acc.email, {
                                                  markPaidNow: true,
                                                })
                                              }
                                              className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded cursor-pointer"
                                              title="Confirmar pagamento da mensalidade"
                                            >
                                              Dar Baixa Mensalidade
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleSuperAdminUpdateBilling(acc.email, {
                                                  subscriptionStatus: 'pendente',
                                                })
                                              }
                                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded cursor-pointer"
                                              title="Marcar mensalidade do mês como pendente"
                                            >
                                              Gerar Cobrança
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => handleCopyBillingMessage(acc)}
                                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded cursor-pointer"
                                            title="Copiar lembrete de mensalidade para WhatsApp"
                                          >
                                            Cobrar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingBillingEmail(acc.email);
                                              setBillingFeeInput(
                                                fee.toFixed(2).replace('.', ',')
                                              );
                                              setBillingDueInput(
                                                acc.billingDueDate || 'Todo dia 10'
                                              );
                                              setBillingStatusInput(status);
                                            }}
                                            className="text-amber-400 hover:underline font-medium cursor-pointer"
                                          >
                                            Valor/Status
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setResettingAccountEmail(acc.email);
                                          setInlineNewPassword('');
                                        }}
                                        className="text-sky-400 hover:underline font-medium cursor-pointer"
                                      >
                                        Senha
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
                                        className="text-slate-300 hover:underline font-medium cursor-pointer"
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
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Stores List */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-100">
                      Todos os Bares Cadastrados ({superStores.length})
                    </h3>

                    {superStores.length === 0 ? (
                      <p className="text-xs text-slate-400">Nenhum bar registrado ainda.</p>
                    ) : (
                      <div className="border border-slate-800 rounded-lg overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                              <th className="py-2.5 px-3 font-medium">Bar / Código</th>
                              <th className="py-2.5 px-3 font-medium">Equipe (ADM / Garçons)</th>
                              <th className="py-2.5 px-3 font-medium">Movimento</th>
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
                                    <span className="font-mono text-amber-400">
                                      ({st.storeCode})
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-300">
                                    <span className="text-amber-400 font-semibold">
                                      {st.admCount ?? 1} ADM
                                    </span>{' '}
                                    ·{' '}
                                    <span className="text-sky-400 font-semibold">
                                      {st.operatorsCount} Garçons
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-slate-300">
                                    {st.tabsCount} comandas · {formatBRL(st.totalConsumed)}
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
                </div>
              </div>
            </div>
          );
        })()}
      </main>
      </div>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ComandaVozWorkspace />
    </ErrorBoundary>
  );
}
