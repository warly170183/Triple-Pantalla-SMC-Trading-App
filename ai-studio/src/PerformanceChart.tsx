import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface SetupPlan {
  entry: number;
  stop: number;
  stopPct: number;
  tps: Array<{ r: number; p: number }>;
  tgt: number | null;
  tgtR: number | null;
  riskUsd: number;
  qty: number;
  notional: number;
  lev: number;
}

export interface SetupOption {
  id: string;
  name: string;
  dir: 'long' | 'short';
  order: string;
  quality: number;
  status: string;
  plan: SetupPlan;
}

export interface AnalysisSnapshot {
  sym: string;
  tfs: string[];
  demo: boolean;
  capital: number;
  riskPct: number;
  maxLev: number;
  verdict: string;
  tide: string;
  bias: 'long' | 'short';
  opts: SetupOption[];
  tps: Array<{ r: number; p: number }>;
  structR: number | null;
}

type PeriodFilter = '1M' | '3M' | '6M' | 'ALL';

const PERIOD_OPTIONS: Array<{ id: PeriodFilter; label: string; days: number | null }> = [
  { id: '1M', label: '1 mes', days: 30 },
  { id: '3M', label: '3 meses', days: 90 },
  { id: '6M', label: '6 meses', days: 180 },
  { id: 'ALL', label: 'Todos', days: null },
];

interface SimPoint {
  trade: number;
  label: string;
  dateStr: string;
  daysAgo: number;
  balance: number;
  expected: number;
  outcome: 'init' | 'win' | 'loss';
  deltaUsd: number;
  drawdownPct: number;
}

declare global {
  interface Window {
    __TP_STATE__?: AnalysisSnapshot;
  }
}

function getDefaultSnapshot(): AnalysisSnapshot {
  if (typeof window !== 'undefined' && window.__TP_STATE__) {
    return window.__TP_STATE__;
  }
  return {
    sym: 'BTC',
    tfs: ['4H', '1H', '15m'],
    demo: false,
    capital: 1000,
    riskPct: 2,
    maxLev: 10,
    verdict: '',
    tide: '',
    bias: 'long',
    opts: [],
    tps: [
      { r: 1.5, p: 0 },
      { r: 2.5, p: 0 },
      { r: 3.5, p: 0 },
    ],
    structR: null,
  };
}

function buildOutcomes(total: number, winRatePct: number, seed: number): Array<'win' | 'loss'> {
  const winsCount = Math.max(0, Math.min(total, Math.round((total * winRatePct) / 100)));
  const arr: Array<'win' | 'loss'> = [];
  for (let i = 0; i < total; i++) {
    arr.push(i < winsCount ? 'win' : 'loss');
  }
  // Deterministic Fisher-Yates shuffle with LCG so exact winRatePct ratio is preserved
  let s = (seed * 1664525 + 1013904223) >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

const fmtUsd = (v: number) =>
  v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PerformanceChart: React.FC = () => {
  const [snap, setSnap] = useState<AnalysisSnapshot>(getDefaultSnapshot);
  const [selectedSetupId, setSelectedSetupId] = useState<string>('auto');
  const [targetChoice, setTargetChoice] = useState<'tp1' | 'tp2' | 'tp3' | 'struct'>('tp2');
  const [tradesCount, setTradesCount] = useState<number>(60);
  const [period, setPeriod] = useState<PeriodFilter>('ALL');
  const [winRate, setWinRate] = useState<number>(40);
  const [compounding, setCompounding] = useState<'compound' | 'fixed'>('compound');
  const [seed, setSeed] = useState<number>(1);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const custom = e as CustomEvent<AnalysisSnapshot>;
      if (custom.detail) {
        setSnap(custom.detail);
      } else if (window.__TP_STATE__) {
        setSnap({ ...window.__TP_STATE__ });
      }
    };
    window.addEventListener('tp:update', onUpdate);
    if (window.__TP_STATE__) {
      setSnap({ ...window.__TP_STATE__ });
    }
    return () => window.removeEventListener('tp:update', onUpdate);
  }, []);

  const activeSetup: SetupOption | null = useMemo(() => {
    if (!snap.opts || snap.opts.length === 0) return null;
    if (selectedSetupId === 'auto') return snap.opts[0];
    return snap.opts.find((o) => o.id === selectedSetupId) ?? snap.opts[0];
  }, [snap.opts, selectedSetupId]);

  const structR = activeSetup?.plan.tgtR ?? snap.structR ?? null;

  const rewardR = useMemo(() => {
    if (targetChoice === 'struct' && structR != null && structR >= 1) {
      return Number(structR.toFixed(2));
    }
    if (targetChoice === 'tp1') return 1.5;
    if (targetChoice === 'tp3') return 3.5;
    return 2.5;
  }, [targetChoice, structR]);

  const simulation = useMemo(() => {
    const capital = Math.max(1, snap.capital || 1000);
    const riskFrac = Math.max(0.001, Math.min(0.5, (snap.riskPct || 2) / 100));
    const wr = Math.max(1, Math.min(99, winRate)) / 100;
    const outcomes = buildOutcomes(tradesCount, winRate, seed);

    const expectancyR = wr * rewardR - (1 - wr) * 1;
    const profitFactor = (wr * rewardR) / Math.max(0.0001, 1 - wr);

    let bal = capital;
    let peak = capital;
    let maxDdPct = 0;
    let expBal = capital;

    const totalDays = 360;
    const nowMs = Date.now();
    const dayMs = 86400000;
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

    const data: SimPoint[] = [
      {
        trade: 0,
        label: '#0',
        dateStr: fmtDate(new Date(nowMs - totalDays * dayMs)),
        daysAgo: totalDays,
        balance: Number(capital.toFixed(2)),
        expected: Number(capital.toFixed(2)),
        outcome: 'init',
        deltaUsd: 0,
        drawdownPct: 0,
      },
    ];

    outcomes.forEach((out, idx) => {
      const riskAmount = compounding === 'compound' ? bal * riskFrac : capital * riskFrac;
      const delta = out === 'win' ? riskAmount * rewardR : -riskAmount;
      bal = Math.max(0, bal + delta);
      if (bal > peak) peak = bal;
      const dd = peak > 0 ? ((peak - bal) / peak) * 100 : 0;
      if (dd > maxDdPct) maxDdPct = dd;

      if (compounding === 'compound') {
        const expectedMultiplier = 1 + expectancyR * riskFrac;
        expBal = Math.max(0, expBal * expectedMultiplier);
      } else {
        expBal = Math.max(0, expBal + capital * riskFrac * expectancyR);
      }

      const daysAgo = Math.round(totalDays * (1 - (idx + 1) / tradesCount));
      data.push({
        trade: idx + 1,
        label: `#${idx + 1}`,
        dateStr: fmtDate(new Date(nowMs - daysAgo * dayMs)),
        daysAgo,
        balance: Number(bal.toFixed(2)),
        expected: Number(expBal.toFixed(2)),
        outcome: out,
        deltaUsd: Number(delta.toFixed(2)),
        drawdownPct: Number(dd.toFixed(2)),
      });
    });

    const finalBal = data[data.length - 1].balance;
    const totalReturnPct = ((finalBal - capital) / capital) * 100;
    const expectedFinal = data[data.length - 1].expected;
    const expectedReturnPct = ((expectedFinal - capital) / capital) * 100;

    return {
      data,
      capital,
      finalBal,
      totalReturnPct,
      expectedFinal,
      expectedReturnPct,
      expectancyR,
      profitFactor,
      maxDdPct,
    };
  }, [snap.capital, snap.riskPct, tradesCount, winRate, rewardR, compounding, seed]);

  const filteredChart = useMemo(() => {
    const opt = PERIOD_OPTIONS.find((p) => p.id === period) ?? PERIOD_OPTIONS[3];
    let points =
      opt.days == null
        ? simulation.data
        : simulation.data.filter((pt) => pt.daysAgo <= opt.days!);
    if (points.length < 2) {
      points = simulation.data.slice(-Math.min(2, simulation.data.length));
    }

    const minVal = Math.min(...points.map((d) => Math.min(d.balance, d.expected)));
    const maxVal = Math.max(...points.map((d) => Math.max(d.balance, d.expected)));
    const pad = Math.max(simulation.capital * 0.03, (maxVal - minVal) * 0.14);
    const yDomain: [number, number] = [
      Math.max(0, Math.floor(minVal - pad)),
      Math.ceil(maxVal + pad),
    ];

    const startBal = points[0]?.balance ?? simulation.capital;
    const endBal = points[points.length - 1]?.balance ?? simulation.finalBal;
    const periodReturnPct = startBal > 0 ? ((endBal - startBal) / startBal) * 100 : 0;

    return {
      points,
      yDomain,
      periodReturnPct,
      periodLabel: opt.label,
    };
  }, [simulation, period]);

  const isPositive = simulation.finalBal >= simulation.capital;
  const strokeColor = isPositive ? '#3fb950' : '#f85149';

  return (
    <div>
      <h2>
        Simulación de rendimiento de cuenta
        <span className="pill bl">{winRate}% acierto ref.</span>
        <span className={`pill ${isPositive ? 'up' : 'dn'}`}>
          {simulation.totalReturnPct >= 0 ? '+' : ''}
          {simulation.totalReturnPct.toFixed(1)}% ({tradesCount} ops.)
        </span>
      </h2>
      <div className="sub" style={{ marginBottom: 10 }}>
        Proyección del balance ({fmtUsd(simulation.capital)} USDT, riesgo {snap.riskPct}%/op.) si se
        siguen los setups sugeridos
        {activeSetup
          ? ` · Setup activo: ${activeSetup.id} (${activeSetup.name}, calidad ${activeSetup.quality})`
          : ` · Plan base Triple Pantalla (${snap.sym.toUpperCase()})`}
        .
      </div>

      <div className="ctl" style={{ marginBottom: 10 }}>
        <label>
          Setup sugerido
          <select
            value={selectedSetupId}
            onChange={(e) => setSelectedSetupId(e.target.value)}
          >
            {snap.opts && snap.opts.length > 0 ? (
              <>
                <option value="auto">
                  Mejor sugerido ({snap.opts[0].id} · Cal. {snap.opts[0].quality})
                </option>
                {snap.opts.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.id} · {o.name} (Cal. {o.quality})
                  </option>
                ))}
              </>
            ) : (
              <option value="auto">Plan Triple Pantalla + SMC (referencia)</option>
            )}
          </select>
        </label>

        <label>
          Objetivo de salida (R:R)
          <select
            value={targetChoice === 'struct' && structR == null ? 'tp2' : targetChoice}
            onChange={(e) =>
              setTargetChoice(e.target.value as 'tp1' | 'tp2' | 'tp3' | 'struct')
            }
          >
            <option value="tp1">TP1 · 1.5R</option>
            <option value="tp2">TP2 · 2.5R (recomendado)</option>
            <option value="tp3">TP3 · 3.5R</option>
            {structR != null && structR >= 1 && (
              <option value="struct">Liquidez · {structR.toFixed(1)}R</option>
            )}
          </select>
        </label>

        <label>
          Operaciones simuladas
          <select
            value={tradesCount}
            onChange={(e) => setTradesCount(Number(e.target.value))}
          >
            <option value={24}>24 operaciones</option>
            <option value={30}>30 operaciones</option>
            <option value={60}>60 operaciones</option>
            <option value={100}>100 operaciones</option>
            <option value={120}>120 operaciones</option>
          </select>
        </label>

        <label>
          Tasa de acierto (%)
          <select value={winRate} onChange={(e) => setWinRate(Number(e.target.value))}>
            <option value={30}>30%</option>
            <option value={35}>35%</option>
            <option value={40}>40% (referencia)</option>
            <option value={45}>45%</option>
            <option value={50}>50%</option>
          </select>
        </label>

        <label>
          Tamaño de riesgo
          <select
            value={compounding}
            onChange={(e) => setCompounding(e.target.value as 'compound' | 'fixed')}
          >
            <option value="compound">Interés compuesto ({snap.riskPct}% balance)</option>
            <option value="fixed">Riesgo fijo ({snap.riskPct}% inicial)</option>
          </select>
        </label>
      </div>

      <div
        className="row"
        style={{ justifyContent: 'space-between', marginTop: 0, marginBottom: 8 }}
      >
        <div className="row" style={{ marginTop: 0, gap: 6 }}>
          <span className="mut" style={{ fontSize: 12 }}>
            Periodo:
          </span>
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={period === opt.id ? '' : 'sec'}
              style={{ minHeight: 30, padding: '4px 10px', fontSize: 12 }}
              onClick={() => setPeriod(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mut" style={{ fontSize: 12 }}>
          Mostrando {filteredChart.points.length} puntos ({filteredChart.periodLabel}) ·{' '}
          <span className={filteredChart.periodReturnPct >= 0 ? 'up' : 'dn'}>
            {filteredChart.periodReturnPct >= 0 ? '+' : ''}
            {filteredChart.periodReturnPct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="perf-chart-box">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={filteredChart.points}
            margin={{ top: 10, right: 14, left: 4, bottom: 4 }}
          >
            <defs>
              <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.28} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1d242d" strokeDasharray="3 3" />
            <XAxis
              dataKey="dateStr"
              stroke="#8b949e"
              tick={{ fill: '#8b949e', fontSize: 11 }}
              minTickGap={22}
            />
            <YAxis
              domain={filteredChart.yDomain}
              stroke="#8b949e"
              tick={{ fill: '#8b949e', fontSize: 11 }}
              width={66}
              tickFormatter={(v: number) => `${Math.round(v)}`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const pt = payload[0].payload as SimPoint;
                return (
                  <div className="perf-tooltip">
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {pt.trade === 0
                        ? `Balance inicial · ${pt.dateStr}`
                        : `Op. ${pt.label} · ${pt.dateStr}`}
                      {pt.outcome !== 'init' && (
                        <span
                          className={`pill ${pt.outcome === 'win' ? 'up' : 'dn'}`}
                          style={{ marginLeft: 6 }}
                        >
                          {pt.outcome === 'win'
                            ? `Acierto (+${rewardR}R)`
                            : 'Stop (-1R)'}
                        </span>
                      )}
                    </div>
                    <div className="kv">
                      <span className="mut">Balance simulado</span>
                      <span className={pt.balance >= simulation.capital ? 'up' : 'dn'}>
                        {fmtUsd(pt.balance)} USDT
                      </span>
                    </div>
                    {pt.trade > 0 && (
                      <div className="kv">
                        <span className="mut">Resultado op.</span>
                        <span className={pt.deltaUsd >= 0 ? 'up' : 'dn'}>
                          {pt.deltaUsd >= 0 ? '+' : ''}
                          {fmtUsd(pt.deltaUsd)} USDT
                        </span>
                      </div>
                    )}
                    <div className="kv">
                      <span className="mut">Media teórica ({winRate}%)</span>
                      <span className="wr">{fmtUsd(pt.expected)} USDT</span>
                    </div>
                    <div className="kv">
                      <span className="mut">Drawdown</span>
                      <span className={pt.drawdownPct > 0 ? 'dn' : 'mut'}>
                        -{pt.drawdownPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={simulation.capital}
              stroke="#6e7681"
              strokeDasharray="4 4"
              label={{
                value: `Inicial ${fmtUsd(simulation.capital)}`,
                position: 'insideTopLeft',
                fill: '#8b949e',
                fontSize: 11,
              }}
            />
            <Area
              type="monotone"
              dataKey="balance"
              name="Balance simulado"
              stroke={strokeColor}
              strokeWidth={2.2}
              fill="url(#perfGrad)"
              dot={(props: { cx?: number; cy?: number; payload?: SimPoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx == null || cy == null || !payload || payload.outcome === 'init') {
                  return <g key={`dot-${index}`} />;
                }
                if (filteredChart.points.length > 65) return <g key={`dot-${index}`} />;
                return (
                  <circle
                    key={`dot-${index}`}
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={payload.outcome === 'win' ? '#3fb950' : '#f85149'}
                    stroke="#0d1117"
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{ r: 5, stroke: '#e6edf3', strokeWidth: 1.5 }}
            />
            <Line
              type="monotone"
              dataKey="expected"
              name="Trayectoria esperada"
              stroke="#d29922"
              strokeWidth={1.6}
              strokeDasharray="5 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="perf-kpis">
        <div className="perf-kpi">
          <span className="mut">Balance final simulado</span>
          <b className={isPositive ? 'up' : 'dn'}>
            {fmtUsd(simulation.finalBal)} USDT ({simulation.totalReturnPct >= 0 ? '+' : ''}
            {simulation.totalReturnPct.toFixed(1)}%)
          </b>
        </div>
        <div className="perf-kpi">
          <span className="mut">Balance teórico ({winRate}%)</span>
          <b className={simulation.expectedFinal >= simulation.capital ? 'wr' : 'dn'}>
            {fmtUsd(simulation.expectedFinal)} USDT ({simulation.expectedReturnPct >= 0 ? '+' : ''}
            {simulation.expectedReturnPct.toFixed(1)}%)
          </b>
        </div>
        <div className="perf-kpi">
          <span className="mut">Esperanza matemática</span>
          <b className={simulation.expectancyR > 0 ? 'up' : simulation.expectancyR === 0 ? 'wr' : 'dn'}>
            {simulation.expectancyR >= 0 ? '+' : ''}
            {simulation.expectancyR.toFixed(2)} R / op.
          </b>
        </div>
        <div className="perf-kpi">
          <span className="mut">Profit Factor · Max DD</span>
          <b>
            <span className={simulation.profitFactor >= 1 ? 'bl' : 'dn'}>
              PF {simulation.profitFactor.toFixed(2)}
            </span>{' '}
            · <span className="dn">-{simulation.maxDdPct.toFixed(1)}%</span>
          </b>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="note" style={{ marginTop: 0 }}>
          Línea sólida: secuencia simulada con exactamente {winRate}% de aciertos y ratio 1:{rewardR}.
          Línea discontinua amarilla: trayectoria esperada teórica. Simulación educativa sin
          comisiones ni deslizamiento.
        </div>
        <div className="row" style={{ marginTop: 0 }}>
          {winRate !== 40 && (
            <button type="button" className="sec" onClick={() => setWinRate(40)}>
              Volver a 40% ref.
            </button>
          )}
          <button type="button" className="sec" onClick={() => setSeed((s) => s + 1)}>
            Otra secuencia ({winRate}%)
          </button>
        </div>
      </div>
    </div>
  );
};
