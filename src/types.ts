import { Timestamp } from 'firebase/firestore';

export type ItemCategory =
  | 'cervejas'
  | 'doses'
  | 'pratos'
  | 'porcoes'
  | 'sobremesas'
  | 'sem_alcool'
  | 'outros';

export type TabStageStatus = 'open' | 'closing' | 'paid' | 'archived';

export type MarceloIntent = 'MARCAR' | 'FECHAR' | 'BAIXA' | 'VENDA_AVULSA';

export type UserRoleType = 'SUPERADMIN' | 'ADM' | 'Proprietário' | 'Garçom' | 'Caixa' | 'Gerente';

export interface UserProfile {
  id: string;
  ownerId: string;
  email?: string;
  userName: string;
  userRole: UserRoleType;
  storeName: string;
  storeCode: string;
  autoArchivePaidAfter10Min?: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface MenuItem {
  id: string;
  ownerId: string;
  name: string;
  category: ItemCategory;
  price: number;
  synonyms: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface BarTab {
  id: string;
  ownerId: string;
  customerName: string;
  tableLabel: string;
  status: TabStageStatus;
  totalAmount: number;
  paidAmount: number;
  itemCount: number;
  paymentMethod: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface TabItem {
  id: string;
  ownerId: string;
  tabId: string;
  customerName: string;
  itemName: string;
  category: ItemCategory;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  source: 'voz' | 'manual' | 'rapido';
  voiceTranscript: string;
  launchedByName?: string;
  storeName?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface VoiceOperator {
  id: string;
  ownerId: string;
  operatorName: string;
  email?: string;
  passwordHash?: string;
  roleLabel: string;
  storeName?: string;
  storeCode?: string;
  pitchHz: number;
  spectralCentroid: number;
  voicePin: string;
  samplesCount: number;
  accessBlocked?: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ParsedOrderItem {
  itemName: string;
  category: ItemCategory;
  quantity: number;
  unitPrice: number;
}

export interface ParsedSingleCommand {
  intent: MarceloIntent;
  customerName: string;
  tableLabel: string;
  paymentAmount?: number;
  paymentMethod?: string;
  keepConsuming?: boolean;
  items: ParsedOrderItem[];
}

export interface ParsedVoiceOrder {
  understood: boolean;
  unrecognizedReason: string;
  addressedToMarcelo: boolean;
  spokenPin?: string;
  commands: ParsedSingleCommand[];
}

export interface ParsedVoiceMenuProduct {
  name: string;
  category: ItemCategory;
  price: number | null;
  synonyms: string;
}

export interface ParsedVoiceMenuResult {
  understood: boolean;
  unrecognizedReason: string;
  products: ParsedVoiceMenuProduct[];
}

