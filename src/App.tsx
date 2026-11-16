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
} from 'lucide-react';
import {
  auth,
  db,
  handleFirestoreError,
  loginWithGoogle,
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

function formatTime(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return 'Agora';
  return ts.toDate().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getRemainingBalance(tab: BarTab): number {
  const paid = Number.isFinite(tab.paidAmount) ? tab.paidAmount : 0;
  return Math.max(0, Number((tab.totalAmount - paid).toFixed(2)));
}

function ComandaVozWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeSection, setActiveSection] = useState<ActiveSection>('comandas');

  // Firestore Real-Time State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tabs, setTabs] = useState<BarTab[]>([]);
  const [tabItems, setTabItems] = useState<TabItem[]>([]);
  const [voiceOperators, setVoiceOperators] = useState<VoiceOperator[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [seedingMenu, setSeedingMenu] = useState(false);

  // Active Waiter / User Selector & Store Profile Form
  const [selectedWaiterId, setSelectedWaiterId] = useState<string>('logged_user');
  const [profileUserName, setProfileUserName] = useState('');
  const [profileUserRole, setProfileUserRole] = useState<UserRoleType>('Proprietário');
  const [profileStoreName, setProfileStoreName] = useState('');
  const [profileStoreCode, setProfileStoreCode] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

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

  // Voice Operator / Waiter Registration State
  const [newOpName, setNewOpName] = useState('');
  const [newOpRole, setNewOpRole] = useState('Garçom');
  const [newOpPin, setNewOpPin] = useState('');
  const [trainingSamples, setTrainingSamples] = useState<AcousticSample[]>([]);
  const [isRecordingSample, setIsRecordingSample] = useState(false);

  // New Menu Item Form State
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState<ItemCategory>('cervejas');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuSynonyms, setNewMenuSynonyms] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const continuousModeRef = useRef(continuousMode);
  continuousModeRef.current = continuousMode;

  // 1. Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (!currentUser) {
        setUserProfile(null);
        setMenuItems([]);
        setTabs([]);
        setTabItems([]);
        setVoiceOperators([]);
        setDataLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // 2. Real-time Firestore Listeners
  useEffect(() => {
    if (!authReady || !user) return;
    setDataLoading(true);

    const profileRef = doc(db, 'userProfiles', user.uid);
    const menuQuery = query(collection(db, 'menuItems'), where('ownerId', '==', user.uid));
    const tabsQuery = query(collection(db, 'tabs'), where('ownerId', '==', user.uid));
    const tabItemsQuery = query(collection(db, 'tabItems'), where('ownerId', '==', user.uid));
    const operatorsQuery = query(
      collection(db, 'voiceOperators'),
      where('ownerId', '==', user.uid)
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
          // Initialize default store & user profile automatically on first login
          const defaultUserName = sanitizeString(
            user.displayName || user.email?.split('@')[0] || 'Operador Principal',
            VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
            'Operador Principal'
          );
          const defaultStoreName = 'Bar & Comércio Central';
          const defaultStoreCode = `BAR-${user.uid.slice(0, 5).toUpperCase()}`;

          setDoc(profileRef, {
            ownerId: user.uid,
            userName: defaultUserName,
            userRole: 'Proprietário',
            storeName: defaultStoreName,
            storeCode: sanitizeStoreCode(defaultStoreCode),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `userProfiles/${user.uid}`));
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `userProfiles/${user.uid}`)
    );

    const unsubMenu = onSnapshot(
      menuQuery,
      (snap) => {
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
        loaded.sort((a, b) => {
          const tA = a.updatedAt?.toMillis?.() ?? 0;
          const tB = b.updatedAt?.toMillis?.() ?? 0;
          return tB - tA;
        });
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
        loaded.sort((a, b) => {
          const tA = a.createdAt?.toMillis?.() ?? Date.now();
          const tB = b.createdAt?.toMillis?.() ?? Date.now();
          return tB - tA;
        });
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
  }, [authReady, user]);

  // Seed default Brazilian bar catalog automatically if user has 0 menu items
  useEffect(() => {
    if (!authReady || !user || dataLoading || seedingMenu) return;
    if (menuItems.length === 0) {
      setSeedingMenu(true);
      const seedDefaultMenu = async () => {
        try {
          const batch = writeBatch(db);
          for (const seed of DEFAULT_BAR_MENU) {
            const docId = `${seed.id}_${user.uid.slice(0, 8)}`;
            const ref = doc(db, 'menuItems', docId);
            batch.set(ref, {
              ownerId: user.uid,
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
        } finally {
          setSeedingMenu(false);
        }
      };
      seedDefaultMenu();
    }
  }, [authReady, user, dataLoading, menuItems.length, seedingMenu]);

  // Active Waiter & Store Attribution Resolver
  const currentStoreName = useMemo(
    () =>
      sanitizeString(
        userProfile?.storeName || 'Bar & Comércio Central',
        VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
        'Bar & Comércio Central'
      ),
    [userProfile]
  );

  const currentStoreCode = useMemo(
    () => sanitizeStoreCode(userProfile?.storeCode || 'BAR-01'),
    [userProfile]
  );

  const activeWaiterDisplay = useMemo(() => {
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
      userProfile?.userName || user?.displayName || user?.email?.split('@')[0] || 'Operador';
    const baseRole = userProfile?.userRole || 'Proprietário';
    return {
      name: `${baseName} (${baseRole})`,
      storeName: currentStoreName,
    };
  }, [selectedWaiterId, voiceOperators, userProfile, user, currentStoreName]);

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

  // MULTI-CUSTOMER BATCH STAGE 1 HANDLER: MARCAR ITENS (Supports 1 or N customers in a single continuous breath!)
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

    const batch = writeBatch(db);
    const addedItemIds: string[] = [];
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

      // Check if we already touched this customer in this same chained phrase or in existing active tabs
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
        const itemRef = doc(db, 'tabItems', itemId);

        batch.set(itemRef, {
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
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
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

      grandTotalConsumed += tabState.runningTotal;
      grandTotalPaid += tabState.previousPaid;
      grandRemainingBalance += Math.max(
        0,
        Number((tabState.runningTotal - tabState.previousPaid).toFixed(2))
      );
    }

    try {
      await batch.commit();
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

    // STRICT RULE: "se não entendeu, não faça nada!"
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
      await updateDoc(doc(db, 'tabs', targetTab.id), {
        status: 'closing',
        totalAmount: targetTab.totalAmount,
        paidAmount: targetTab.paidAmount,
        itemCount: targetTab.itemCount,
        updatedAt: serverTimestamp(),
      });

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
      await updateDoc(doc(db, 'tabs', targetTab.id), {
        status: nextStatus,
        paidAmount: nextPaidAmount,
        paymentMethod: sanitizeString(paymentMethod, 40, 'PIX'),
        totalAmount: targetTab.totalAmount,
        itemCount: targetTab.itemCount,
        updatedAt: serverTimestamp(),
      });

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

    // 1. Check wake word "Marcelo" if required on voice commands
    const hasWakeWord = /\bmarcelo\b/i.test(normalizeText(cleanPhrase));
    if (sourceType === 'voz' && requireWakeWordMarcelo && !hasWakeWord) {
      const msg = `Marcelo não executou nada: chame pelo nome dizendo "Marcelo, marque..." para evitar comandos acidentais.`;
      setFeedbackBanner({ type: 'error', message: msg });
      return;
    }

    // 2. Check trained voice operator lock if enabled
    if (sourceType === 'voz' && requireTrainedVoiceLock && !speakerVerified) {
      const msg = `Marcelo bloqueou o comando: Voz não reconhecida como garçom/operador cadastrado deste comércio. Nada foi alterado.`;
      setFeedbackBanner({ type: 'error', message: msg });
      speakAsMarcelo(
        'Voz não cadastrada neste comércio. Nada foi feito.',
        marceloVoiceReplyEnabled
      );
      return;
    }

    // Resolve which Waiter and Store are executing this command
    const waiterAttr = matchedWaiterOp
      ? `${matchedWaiterOp.operatorName} (${matchedWaiterOp.roleLabel})`
      : activeWaiterDisplay.name;
    const storeAttr = matchedWaiterOp?.storeName || activeWaiterDisplay.storeName;

    setIsProcessingCommand(true);
    setFeedbackBanner(null);

    try {
      // First run our strict local multi-customer parser to validate catalog items & customers
      const localStrict = parseVoiceOrderLocally(
        cleanPhrase,
        menuItems,
        activeStageTabs.map((t) => t.customerName)
      );

      let finalParsed: ParsedVoiceOrder = localStrict;

      // If local parser didn't immediately match, or to handle complex phrasing via Gemini:
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

      // STRICT SAFETY CHECK: "se não entendeu, não faça nada hein!"
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

      // Verify that every MARCAR command has valid customerName and at least 1 valid item in the bar's catalog
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

      // Group all MARCAR commands so chained orders ("marca 1 litrão para Thiago, marca 1 litrão para Jonas") commit together
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

  // Save Logged-In User & Comércio Profile
  const handleSaveUserProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profileUserName.trim() || !profileStoreName.trim()) return;
    setSavingProfile(true);
    try {
      await setDoc(doc(db, 'userProfiles', user.uid), {
        ownerId: user.uid,
        userName: sanitizeString(profileUserName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN),
        userRole: VALIDATION_LIMITS.VALID_ROLES.includes(profileUserRole)
          ? profileUserRole
          : 'Proprietário',
        storeName: sanitizeString(profileStoreName, VALIDATION_LIMITS.STORE_NAME_MAX_LEN),
        storeCode: sanitizeStoreCode(profileStoreCode, 'BAR-01'),
        createdAt: userProfile?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setFeedbackBanner({
        type: 'success',
        message: `Perfil de usuário (${profileUserName}) e Comércio (${profileStoreName}) atualizados!`,
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

  // Save Trained Waiter / Operator Profile to Firestore (Linked to Store / Comércio)
  const handleSaveTrainedOperator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newOpName.trim() || trainingSamples.length === 0) return;

    const avgPitch =
      trainingSamples.reduce((acc, s) => acc + s.pitchHz, 0) / trainingSamples.length;
    const avgCentroid =
      trainingSamples.reduce((acc, s) => acc + s.spectralCentroid, 0) /
      trainingSamples.length;

    const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'voiceOperators', opId), {
        ownerId: user.uid,
        operatorName: sanitizeString(newOpName, VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN),
        roleLabel: sanitizeString(newOpRole, VALIDATION_LIMITS.TABLE_MAX_LEN, 'Garçom'),
        storeName: currentStoreName,
        storeCode: currentStoreCode,
        pitchHz: Math.min(Math.max(Number(avgPitch.toFixed(1)), 45), 550),
        spectralCentroid: Math.min(Math.max(Number(avgCentroid.toFixed(1)), 100), 9500),
        voicePin: sanitizeString(newOpPin, VALIDATION_LIMITS.VOICE_PIN_MAX_LEN, ''),
        samplesCount: trainingSamples.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewOpName('');
      setNewOpPin('');
      setTrainingSamples([]);
      setSelectedWaiterId(opId);
      setRequireTrainedVoiceLock(true);
      const msg = `Garçom/Usuário ${newOpName} cadastrado no comércio ${currentStoreName} com sucesso!`;
      setFeedbackBanner({ type: 'success', message: msg });
      speakAsMarcelo(msg, marceloVoiceReplyEnabled);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `voiceOperators/${opId}`);
    }
  };

  const handleDeleteOperator = async (opId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'voiceOperators', opId));
      if (selectedWaiterId === opId) {
        setSelectedWaiterId('logged_user');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `voiceOperators/${opId}`);
    }
  };

  // Undo last single or multi-customer launch in 1 click
  const handleUndoLastLaunch = async () => {
    if (!lastUndo || !user) return;
    const undoInfo = lastUndo;
    setLastUndo(null);

    try {
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
      setMarceloReport(null);
      setFeedbackBanner({
        type: 'success',
        message: `Lançamento desfeito com sucesso: ${undoInfo.description}`,
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

    try {
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
        launchedByName: sanitizeString(
          activeWaiterDisplay.name,
          VALIDATION_LIMITS.OPERATOR_NAME_MAX_LEN,
          'Garçom'
        ),
        storeName: sanitizeString(
          activeWaiterDisplay.storeName,
          VALIDATION_LIMITS.STORE_NAME_MAX_LEN,
          'Bar Central'
        ),
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
      setFeedbackBanner({
        type: 'success',
        message: `+1 ${menuItem.name} marcado para ${selectedTab.customerName} por ${activeWaiterDisplay.name}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tabItems');
    }
  };

  // Adjust quantity or delete an individual TabItem entry
  const handleAdjustTabItemQty = async (item: TabItem, delta: number) => {
    if (!user) return;
    const parentTab = activeStageTabs.find((t) => t.id === item.tabId);
    if (!parentTab) return;

    const nextQty = item.quantity + delta;
    const priceDiff = Number((delta * item.unitPrice).toFixed(2));
    const nextTabTotal = Math.max(0, Number((parentTab.totalAmount + priceDiff).toFixed(2)));
    const nextTabCount = Math.max(0, parentTab.itemCount + delta);

    try {
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
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tabItems/${item.id}`);
    }
  };

  // Create a new Open Comanda manually
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

  // Add New Product to Bar Menu Catalog
  const handleAddMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newMenuName.trim() || !newMenuPrice) return;

    const priceNum = parseFloat(newMenuPrice.replace(',', '.'));
    if (Number.isNaN(priceNum) || priceNum < 0) return;

    const menuId = `menu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'menuItems', menuId), {
        ownerId: user.uid,
        name: sanitizeString(newMenuName, VALIDATION_LIMITS.NAME_MAX_LEN),
        category: sanitizeCategory(newMenuCategory),
        price: Math.min(Number(priceNum.toFixed(2)), VALIDATION_LIMITS.MAX_PRICE),
        synonyms: sanitizeString(newMenuSynonyms, VALIDATION_LIMITS.SYNONYMS_MAX_LEN),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewMenuName('');
      setNewMenuPrice('');
      setNewMenuSynonyms('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `menuItems/${menuId}`);
    }
  };

  const handleDeleteMenuItem = async (menuId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'menuItems', menuId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `menuItems/${menuId}`);
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
            <a href="#estagios" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Pedidos Sem Pausa
            </a>
            <a href="#equipe" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Garçons & Comércio
            </a>
            <a href="#seguranca" className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0">
              Proteção de Voz
            </a>
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={loginWithGoogle}
              className="px-4 py-2 text-xs font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Entrar com Google
            </button>
          </div>
        </header>

        <main className="max-w-[1200px] w-full mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-6">
            <p className="text-xs font-medium text-amber-400 tracking-wide">
              Assistente Virtual Marcelo · Controle por Garçom e Comércio
            </p>
            <h1
              className="text-3xl sm:text-5xl font-bold text-slate-50 tracking-tight leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Fale vários clientes sem pausa: &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;.
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              Na correria do bar, fale vários pedidos seguidos e o Marcelo separa cada produto na
              comanda certa, registrando qual garçom lançou e a qual comércio pertence. E se o
              Marcelo não entender com 100% de certeza, ele não altera nada na conta.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                onClick={loginWithGoogle}
                className="px-6 py-3 text-sm font-semibold bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Acessar Comanda Voz
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4 text-xs">
            <h2 className="text-sm font-bold text-slate-100 border-b border-slate-800 pb-3">
              Segurança Total no Balcão
            </h2>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <span className="text-amber-400 font-semibold">
                Pedidos Múltiplos Sem Pausa
              </span>
              <p className="text-slate-200 font-mono">
                &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;
              </p>
              <p className="text-slate-400">
                Cria ou soma na comanda de Thiago e na de Jonas separadamente na mesma hora.
              </p>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <span className="text-sky-400 font-semibold">
                Se Não Entender, Não Faz Nada
              </span>
              <p className="text-slate-400">
                Zero chute: se faltar o nome do cliente ou o produto não existir no cardápio, o
                Marcelo avisa e não suja nenhuma comanda.
              </p>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <span className="text-emerald-400 font-semibold">
                Rastreamento por Garçom e Comércio
              </span>
              <p className="text-slate-400">
                Cada usuário/garçom tem seu cadastro vinculado ao comércio, gravando quem lançou
                cada item.
              </p>
            </div>
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

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={logoutUser}
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
                  · Se não entender, nada é alterado
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Fale direto sem pausa:{' '}
                <span className="text-slate-200 font-mono">
                  &ldquo;Marcelo, marca 1 litrão para Thiago, marca 1 litrão para Jonas&rdquo;
                </span>
              </p>
            </div>

            {/* Active Establishment (Comércio) + Waiter Selector & KPI Strip */}
            <div className="flex flex-wrap items-center gap-4 text-xs border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800 shrink-0">
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-slate-400 block text-[11px]">
                  Comércio: <strong className="text-slate-200">{currentStoreName}</strong> ({currentStoreCode})
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-slate-400">Lançando como:</span>
                  <select
                    value={selectedWaiterId}
                    onChange={(e) => setSelectedWaiterId(e.target.value)}
                    className="bg-transparent text-amber-400 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="logged_user" className="bg-slate-900 text-slate-100">
                      {userProfile?.userName || user.displayName || 'Usuário Principal'} ({userProfile?.userRole || 'Proprietário'})
                    </option>
                    {voiceOperators.map((op) => (
                      <option key={op.id} value={op.id} className="bg-slate-900 text-slate-100">
                        {op.operatorName} ({op.roleLabel})
                      </option>
                    ))}
                  </select>
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
                    · {marceloReport.stageLabel} · Garçom: {marceloReport.waiterAttribution}
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
                  {lastUndo && marceloReport.intent === 'MARCAR' && (
                    <button
                      type="button"
                      onClick={handleUndoLastLaunch}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Desfazer Lote
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

          {/* Feedback Banner for strict abort ("se não entendeu, não faça nada") or quick notifications */}
          {feedbackBanner && !marceloReport && (
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
                        await updateDoc(doc(db, 'tabs', selectedTab.id), {
                          status: 'open',
                          customerName: selectedTab.customerName,
                          tableLabel: selectedTab.tableLabel,
                          totalAmount: selectedTab.totalAmount,
                          paidAmount: selectedTab.paidAmount,
                          itemCount: selectedTab.itemCount,
                          updatedAt: serverTimestamp(),
                        });
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
                        Use + ou - para ajuste rápido
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
                                      <button
                                        type="button"
                                        onClick={() => handleAdjustTabItemQty(latestEntry, -1)}
                                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
                                      >
                                        <Minus className="w-3 h-3" />
                                      </button>
                                      <span className="font-mono tabular-nums font-bold text-sm text-slate-100 w-7 text-center">
                                        {group.totalQuantity}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleAdjustTabItemQty(latestEntry, 1)}
                                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
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
                        .slice(0, 9)
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
                        Hora exata + qual garçom lançou
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
                                  · Garçom: <strong className="text-amber-300">{entry.launchedByName || activeWaiterDisplay.name}</strong>
                                </span>
                              </div>
                              {entry.voiceTranscript && (
                                <p className="text-[11px] text-slate-400 truncate">
                                  Frase: &ldquo;{entry.voiceTranscript}&rdquo; ({entry.storeName || currentStoreName})
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <span className="font-mono tabular-nums font-semibold text-slate-200">
                                {formatBRL(entry.totalPrice)}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleAdjustTabItemQty(entry, -entry.quantity)}
                                className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                                title="Remover este lançamento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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

        {/* SECTION 2: GARÇONS, USUÁRIOS & COMÉRCIO + TREINAMENTO DE VOZ */}
        {activeSection === 'equipe_comercio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Establishment (Comércio) & Logged-in User Profile + New Waiter Registration */}
            <div className="lg:col-span-5 space-y-6">
              {/* Store & Current User Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Store className="w-5 h-5 text-amber-400" />
                    Identificação do Comércio e Meu Usuário
                  </h2>
                  <p className="text-xs text-slate-400">
                    Defina o nome e código do seu bar/comércio e seus dados de usuário
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
                        placeholder="Ex: BAR-ZE-01"
                        required
                        maxLength={30}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-slate-300 block">Seu Nome de Usuário</label>
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
                    <div className="space-y-1">
                      <label className="text-slate-300 block">Sua Função no Comércio</label>
                      <select
                        value={profileUserRole}
                        onChange={(e) => setProfileUserRole(e.target.value as UserRoleType)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      >
                        <option value="Proprietário">Proprietário</option>
                        <option value="Gerente">Gerente</option>
                        <option value="Garçom">Garçom</option>
                        <option value="Caixa">Caixa</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    {savingProfile ? 'Salvando...' : 'Atualizar Dados do Comércio e Meu Usuário'}
                  </button>
                </form>
              </div>

              {/* Register & Train Waiter Voice Profile */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Fingerprint className="w-5 h-5 text-amber-400" />
                    Cadastrar Garçom / Usuário com Voz Treinada
                  </h2>
                  <p className="text-xs text-slate-400">
                    Vincule cada garçom ao comércio <strong className="text-slate-200">{currentStoreName}</strong> e grave 3 frases da voz dele para sabermos quem lançou cada item.
                  </p>
                </div>

                <form onSubmit={handleSaveTrainedOperator} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-slate-300 block">Nome do Garçom</label>
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
                      <label className="text-slate-300 block">Cargo</label>
                      <select
                        value={newOpRole}
                        onChange={(e) => setNewOpRole(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                      >
                        <option value="Garçom">Garçom</option>
                        <option value="Proprietário">Proprietário</option>
                        <option value="Caixa">Caixa</option>
                        <option value="Gerente">Gerente</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-300 block">PIN Falado</label>
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

                  {/* 3 Voice Sample Recording Steps */}
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        Treinamento Vocal ({trainingSamples.length}/3 amostras)
                      </span>
                      {trainingSamples.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setTrainingSamples([])}
                          className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                        >
                          Reiniciar
                        </button>
                      )}
                    </div>

                    <p className="text-slate-400">
                      Peça ao garçom para ler a frase #{Math.min(trainingSamples.length + 1, 3)}:{' '}
                      <strong className="text-amber-300 font-mono block mt-1">
                        &ldquo;{TRAINING_PHRASES[Math.min(trainingSamples.length, 2)]}&rdquo;
                      </strong>
                    </p>

                    <button
                      type="button"
                      disabled={isRecordingSample || trainingSamples.length >= 3}
                      onClick={handleRecordTrainingSample}
                      className={`w-full py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                        isRecordingSample
                          ? 'bg-red-600 text-white'
                          : trainingSamples.length >= 3
                            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                            : 'bg-slate-800 hover:bg-slate-700 text-amber-400'
                      }`}
                    >
                      <Mic className="w-4 h-4" />
                      {isRecordingSample
                        ? 'Gravando voz do garçom (fale agora)...'
                        : trainingSamples.length >= 3
                          ? '3 Amostras de Voz Concluídas!'
                          : `Gravar Amostra de Voz ${trainingSamples.length + 1} de 3`}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={!newOpName.trim() || trainingSamples.length === 0}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Cadastrar Garçom no Comércio ({currentStoreCode})
                  </button>
                </form>
              </div>
            </div>

            {/* Right Column: Registered Waiters & Store Attribution Table */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Usuários e Garçons Vinculados ao Comércio ({voiceOperators.length + 1})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Comércio ativo: <strong className="text-amber-400">{currentStoreName}</strong> · Código: <strong className="font-mono text-slate-200">{currentStoreCode}</strong>
                  </p>
                </div>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Usuário / Garçom</th>
                      <th className="py-2.5 px-4 font-medium">Comércio Vinculado</th>
                      <th className="py-2.5 px-4 font-medium">Assinatura de Voz</th>
                      <th className="py-2.5 px-4 font-medium text-right">Itens Lançados</th>
                      <th className="py-2.5 px-4 font-medium text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                    {/* Logged-in Primary User Row */}
                    <tr className="bg-slate-900/50">
                      <td className="py-2.5 px-4 font-semibold text-slate-100">
                        {userProfile?.userName || user.displayName || 'Operador Principal'}
                        <span className="block text-[11px] text-amber-400 font-normal">
                          {userProfile?.userRole || 'Proprietário'} (Conta Google Logada)
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {currentStoreName}
                        <span className="block text-[11px] font-mono text-slate-400">
                          {currentStoreCode}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400">Titular da Conta</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-200">
                        {
                          tabItems.filter((i) =>
                            (i.launchedByName || '').includes(
                              userProfile?.userName || user.displayName || 'Operador'
                            )
                          ).length
                        }{' '}
                        lançamentos
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedWaiterId('logged_user')}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                            selectedWaiterId === 'logged_user'
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {selectedWaiterId === 'logged_user' ? 'Ativo Agora' : 'Usar'}
                        </button>
                      </td>
                    </tr>

                    {/* Enrolled Voice Waiters */}
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
                          <td className="py-2.5 px-4 text-slate-300">
                            {op.storeName || currentStoreName}
                            <span className="block text-[11px] font-mono text-slate-400">
                              {op.storeCode || currentStoreCode}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-400">
                            {op.pitchHz} Hz / {op.spectralCentroid} Hz
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-200">
                            {launchedCount} lançamentos
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => setSelectedWaiterId(op.id)}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                                isActive
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {isActive ? 'Ativo Agora' : 'Selecionar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteOperator(op.id)}
                              className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                              title="Remover garçom"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
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

        {/* SECTION 4: CARDÁPIO & PREÇOS DO BAR */}
        {activeSection === 'cardapio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Utensils className="w-4 h-4 text-amber-400" />
                  Cadastrar Produto no Cardápio
                </h2>
                <p className="text-xs text-slate-400">
                  O Marcelo só marca produtos que existirem aqui no cardápio (evitando erros)
                </p>
              </div>

              <form onSubmit={handleAddMenuItem} className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-slate-300 block">Nome do Produto</label>
                  <input
                    type="text"
                    value={newMenuName}
                    onChange={(e) => setNewMenuName(e.target.value)}
                    placeholder="Ex: Litrão Antarctica 1L"
                    required
                    maxLength={80}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-slate-300 block">Categoria</label>
                    <select
                      value={newMenuCategory}
                      onChange={(e) => setNewMenuCategory(e.target.value as ItemCategory)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                    >
                      <option value="cervejas">Cervejas</option>
                      <option value="doses">Doses & Drinks</option>
                      <option value="porcoes">Porções & Espetos</option>
                      <option value="sem_alcool">Sem Álcool</option>
                      <option value="outros">Outros</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-slate-300 block">Preço (R$)</label>
                    <input
                      type="text"
                      value={newMenuPrice}
                      onChange={(e) => setNewMenuPrice(e.target.value)}
                      placeholder="Ex: 18,00"
                      required
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 block">
                    Apelidos de Voz (separados por vírgula)
                  </label>
                  <input
                    type="text"
                    value={newMenuSynonyms}
                    onChange={(e) => setNewMenuSynonyms(e.target.value)}
                    placeholder="Ex: antarctica, litrão azul, boa"
                    maxLength={200}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Salvar Produto no Cardápio
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-100">
                  Produtos Autorizados no Cardápio ({menuItems.length})
                </h2>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-4 font-medium">Produto</th>
                      <th className="py-2.5 px-4 font-medium">Categoria</th>
                      <th className="py-2.5 px-4 font-medium">Apelidos Reconhecidos</th>
                      <th className="py-2.5 px-4 font-medium text-right">Preço</th>
                      <th className="py-2.5 px-4 font-medium text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                    {menuItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-semibold text-slate-100">{item.name}</td>
                        <td className="py-2.5 px-4 text-slate-400">
                          {CATEGORY_LABELS[item.category]}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">{item.synonyms || '—'}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-400">
                          {formatBRL(item.price)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteMenuItem(item.id)}
                            className="text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                            title="Excluir item do cardápio"
                          >
                            <Trash2 className="w-3.5 h-3.5 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
