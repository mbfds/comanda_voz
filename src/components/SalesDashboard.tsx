import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { BarTab, TabItem } from '../types';
import { formatBRL } from '../utils/barCatalog';

interface SalesDashboardProps {
  storeName: string;
  tabs: BarTab[];
  tabItems: TabItem[];
  getTimestampMillis: (ts: unknown) => number;
  onGoToComandas: () => void;
}

interface DailyConsumptionPoint {
  dateKey: string;
  shortLabel: string;
  fullDateLabel: string;
  totalConsumed: number;
  itemsCount: number;
  isToday: boolean;
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const WEEKDAY_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const SalesDashboard: React.FC<SalesDashboardProps> = ({
  storeName,
  tabs,
  tabItems,
  getTimestampMillis,
  onGoToComandas,
}) => {
  const { dailyData, total7Days, todayTotal, received7Days, activeTabs7Days } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const pointsMap = new Map<string, DailyConsumptionPoint>();
    const orderedPoints: DailyConsumptionPoint[] = [];

    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(todayStart);
      d.setDate(todayStart.getDate() - offset);
      const key = toLocalDateKey(d);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const weekday = WEEKDAY_SHORT_PT[d.getDay()];
      const isToday = offset === 0;

      const point: DailyConsumptionPoint = {
        dateKey: key,
        shortLabel: isToday ? `Hoje` : `${weekday} ${dd}/${mm}`,
        fullDateLabel: isToday ? `Hoje (${dd}/${mm}/${d.getFullYear()})` : `${weekday}, ${dd}/${mm}/${d.getFullYear()}`,
        totalConsumed: 0,
        itemsCount: 0,
        isToday,
      };
      pointsMap.set(key, point);
      orderedPoints.push(point);
    }

    // Group tabItems per tabId so we can detect any tab whose totalAmount exceeds logged items
    const itemSumByTabId = new Map<string, number>();

    for (const item of tabItems) {
      const ms = getTimestampMillis(item.createdAt);
      const itemDate = new Date(ms);
      const key = toLocalDateKey(itemDate);
      const priceVal = Number(item.totalPrice);
      const qtyVal = Number(item.quantity);

      if (Number.isFinite(priceVal) && priceVal > 0) {
        itemSumByTabId.set(item.tabId, (itemSumByTabId.get(item.tabId) || 0) + priceVal);
      }

      const bucket = pointsMap.get(key);
      if (bucket && Number.isFinite(priceVal) && priceVal > 0) {
        bucket.totalConsumed = Number((bucket.totalConsumed + priceVal).toFixed(2));
        bucket.itemsCount += Number.isFinite(qtyVal) && qtyVal > 0 ? qtyVal : 1;
      }
    }

    // Account for any tab totals created/updated without matching TabItem rows, and compute 7-day receipts
    let receivedSum = 0;
    let tabsCount = 0;

    for (const tab of tabs) {
      const tabMs = getTimestampMillis(tab.updatedAt || tab.createdAt);
      const tabKey = toLocalDateKey(new Date(tabMs));
      const bucket = pointsMap.get(tabKey);

      if (bucket) {
        tabsCount++;
        const paidVal = Number(tab.paidAmount);
        if (Number.isFinite(paidVal) && paidVal > 0) {
          receivedSum = Number((receivedSum + paidVal).toFixed(2));
        }

        const loggedSum = itemSumByTabId.get(tab.id) || 0;
        const tabTotal = Number(tab.totalAmount);
        if (Number.isFinite(tabTotal) && tabTotal > loggedSum + 0.01) {
          const delta = Number((tabTotal - loggedSum).toFixed(2));
          bucket.totalConsumed = Number((bucket.totalConsumed + delta).toFixed(2));
        }
      }
    }

    const total7 = orderedPoints.reduce((acc, p) => Number((acc + p.totalConsumed).toFixed(2)), 0);
    const todayVal = orderedPoints[orderedPoints.length - 1]?.totalConsumed || 0;

    return {
      dailyData: orderedPoints,
      total7Days: total7,
      todayTotal: todayVal,
      received7Days: receivedSum,
      activeTabs7Days: tabsCount,
    };
  }, [tabs, tabItems, getTimestampMillis]);

  const hasAnySales = total7Days > 0;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            Desempenho de Vendas — Últimos 7 Dias
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {storeName} · Consumo total diário lançado nas comandas
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToComandas}
          className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Voltar às Comandas
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/60">
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-400">Consumo Total (7 dias)</div>
          <div className="text-xl font-bold text-amber-400 font-mono tabular-nums">
            {formatBRL(total7Days)}
          </div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-400">Consumo de Hoje</div>
          <div className="text-xl font-bold text-slate-100 font-mono tabular-nums">
            {formatBRL(todayTotal)}
          </div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-400">Recebido / Baixado (7 dias)</div>
          <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">
            {formatBRL(received7Days)}
            <span className="ml-2 text-xs font-sans font-normal text-slate-400">
              · {activeTabs7Days} {activeTabs7Days === 1 ? 'comanda' : 'comandas'}
            </span>
          </div>
        </div>
      </div>

      {/* Bar Chart Area */}
      {!hasAnySales ? (
        <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg bg-slate-950/40 space-y-3">
          <p className="text-sm font-medium text-slate-200">
            Nenhum consumo registrado nos últimos 7 dias
          </p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Assim que os pedidos forem lançados nas comandas pelo Marcelo ou manualmente, o
            faturamento diário aparecerá automaticamente neste gráfico.
          </p>
          <button
            type="button"
            onClick={onGoToComandas}
            className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
          >
            Lançar Pedido em Comandas
          </button>
        </div>
      ) : (
        <div className="w-full h-72 sm:h-80 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dailyData}
              margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis
                dataKey="shortLabel"
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(value: number) => `R$ ${value}`}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const point = payload[0].payload as DailyConsumptionPoint;
                  return (
                    <div className="bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 shadow-lg text-xs space-y-1">
                      <div className="font-semibold text-slate-100">{point.fullDateLabel}</div>
                      <div className="font-mono font-bold text-amber-400 tabular-nums">
                        Consumo: {formatBRL(point.totalConsumed)}
                      </div>
                      <div className="text-slate-400 font-mono tabular-nums">
                        Itens lançados: {point.itemsCount}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="totalConsumed" radius={[6, 6, 0, 0]} maxBarSize={56}>
                {dailyData.map((entry) => (
                  <Cell
                    key={entry.dateKey}
                    fill={entry.isToday ? '#fbbf24' : '#d97706'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};
