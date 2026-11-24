import React, { useEffect, useMemo, useState } from 'react';
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
import type { AnalysisSnapshot } from './PerformanceChart.tsx';

interface ArchNode {
  id: string;
  step: string;
  title: string;
  subtitle: string;
  layer: 'Ingesta' | 'Motor Core' | 'Interfaz y Alertas';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  files: string[];
  summary: string;
  details: string[];
  inputs: string;
  outputs: string;
}

interface ArchEdge {
  from: string;
  to: string;
  label: string;
}

const NODES: ArchNode[] = [
  {
    id: 'data',
    step: '01',
    title: 'Ingesta y Estado',
    subtitle: 'OKX API v5 · Demo · Config',
    layer: 'Ingesta',
    x: 24,
    y: 112,
    w: 175,
    h: 86,
    color: '#58a6ff',
    files: ['index.html (okx, load, demoBars, localStorage)'],
    summary:
      'Obtiene velas OHLCV cerradas en tres temporalidades simultáneas (Marea, Ola y Ejecución) desde la API pública de swaps perpetuos de OKX o genera series sintéticas en modo Demo.',
    details: [
      'Filtra exclusivamente velas confirmadas (b.ok === true) para evitar señales falsas antes del cierre.',
      'Persiste símbolo, temporalidades, capital, riesgo %, apalancamiento y preferencias de alerta en localStorage.',
      'Emite eventos personalizados tp:update con el estado consolidado hacia los módulos React.',
    ],
    inputs: 'Ticker (BTC, ETH...), preset temporal, capital y riesgo %',
    outputs: '3 series OHLCV cerradas [T, W, X] + precio live',
  },
  {
    id: 'elder',
    step: '02',
    title: 'Motor Triple Pantalla',
    subtitle: 'EMA · MACD · Fuerza · Estocástico',
    layer: 'Motor Core',
    x: 245,
    y: 34,
    w: 185,
    h: 86,
    color: '#3fb950',
    files: ['index.html (ema, macd, impulse, force, stoch, atr)'],
    summary:
      'Implementa la metodología del Dr. Alexander Elder en 3 marcos temporales: define la dirección de la Marea, detecta retrocesos en la Ola y calcula la orden stop en Ejecución.',
    details: [
      'Pantalla 1 (Marea): evalúa pendiente de EMA 13 e histograma MACD (12,26,9) + Sistema Impulso (verde/rojo/azul).',
      'Pantalla 2 (Ola): valida retrocesos a favor de la marea con Índice de Fuerza EMA 2 y Estocástico (5,3).',
      'Pantalla 3 (Entrada): coloca orden buy-stop / sell-stop 1 tick más allá de la última vela cerrada de ejecución.',
    ],
    inputs: 'Velas [T, W, X] e indicadores técnicos calculados en cliente',
    outputs: 'Sesgo direccional, confianza, puntuación de Ola (0–2) y ATR',
  },
  {
    id: 'smc',
    step: '03',
    title: 'Motor SMC (Ola)',
    subtitle: 'BOS/CHoCH · OB · FVG · Liquidez',
    layer: 'Motor Core',
    x: 245,
    y: 192,
    w: 185,
    h: 86,
    color: '#d29922',
    files: ['index.html (pivots, smcScan)'],
    summary:
      'Analiza la estructura institucional Smart Money Concepts sobre la temporalidad intermedia (Ola) para exigir confluencia antes de validar un setup completo.',
    details: [
      'Detecta pivotes de 3 velas, rupturas BOS a favor y cambios de carácter CHoCH en contra.',
      'Identifica Order Blocks vigentes, Fair Value Gaps (FVG) sin rellenar y zonas Premium / Descuento (50%).',
      'Localiza máximos/mínimos iguales (EQH/EQL) y barridos recientes de liquidez (SSL/BSL) como objetivos y stops.',
    ],
    inputs: 'Velas cerradas de la Ola (W) y volatilidad ATR(14)',
    outputs: 'Puntuación SMC (0–4), zonas POI, barridos y objetivo estructural',
  },
  {
    id: 'options',
    step: '04',
    title: 'Opciones y Sizing',
    subtitle: 'Setups A/B/C · Calidad · Riesgo',
    layer: 'Motor Core',
    x: 478,
    y: 112,
    w: 175,
    h: 86,
    color: '#a371f7',
    files: ['index.html (buildOptions, mkPlan, analyze)'],
    summary:
      'Sintetiza los resultados de Triple Pantalla y SMC para construir hasta tres planes accionables (A ruptura, B retroceso a OB/FVG y C barrido), ordenados por calidad.',
    details: [
      'Calcula una puntuación heurística 0–100 combinando Marea (15–30), Ola (0–30), SMC (0–40) y bonos/penalizaciones.',
      'Dimensiona automáticamente tamaño de posición, nocional y apalancamiento requerido según el % de riesgo.',
      'Define objetivos TP1 (1.5R), TP2 (2.5R), TP3 (3.5R) y objetivo estructural de liquidez (≥1R).',
    ],
    inputs: 'Señales de Triple Pantalla + confluencia SMC + config de riesgo',
    outputs: 'Veredicto global, Plan de trade y lista rankeada A/B/C',
  },
  {
    id: 'scanner',
    step: '05',
    title: 'Escáner y Alertas',
    subtitle: 'Ranking · Toast · Notif. · Telegram',
    layer: 'Interfaz y Alertas',
    x: 696,
    y: 34,
    w: 162,
    h: 86,
    color: '#f85149',
    files: ['index.html (scan, notifySetup)', 'server.ts (/api/telegram/*)'],
    summary:
      'Recorre secuencialmente la lista de activos configurada, genera el ranking por calidad y dispara alertas visuales, nativas y por Telegram cuando aparece un «SETUP COMPLETO + SMC».',
    details: [
      'Renderiza tabla resumen multi-activo y ranking ordenado de mayor a menor calidad.',
      'Integra notificaciones toast en pantalla y window.Notification del navegador.',
      'Envía alertas seguras a Telegram a través del proxy Express (/api/telegram/alert) usando credenciales en servidor.',
    ],
    inputs: 'Lista de símbolos (BTC, ETH, SOL...) y motor analyze()',
    outputs: 'Tabla de escáner, ranking A/B/C, toast y Telegram Bot',
  },
  {
    id: 'react',
    step: '06',
    title: 'Módulo React + Recharts',
    subtitle: 'Rendimiento · Periodos · Arquitectura',
    layer: 'Interfaz y Alertas',
    x: 696,
    y: 192,
    w: 162,
    h: 86,
    color: '#58a6ff',
    files: ['src/main.tsx', 'src/PerformanceChart.tsx', 'src/ArchitectureSection.tsx'],
    summary:
      'Capa modular en React 19 + TypeScript montada sobre contenedores dedicados que escucha eventos tp:update para proyectar el rendimiento de cuenta y visualizar la arquitectura.',
    details: [
      'PerformanceChart.tsx simula la curva de balance con Recharts (40% acierto ref., interés compuesto/fijo).',
      'Filtra la simulación por periodos (1 mes, 3 meses, 6 meses, Todos) recalculando dominio Y y retorno.',
      'ArchitectureSection.tsx expone la topología interactiva del sistema y su modelo de pesos en tiempo real.',
    ],
    inputs: 'CustomEvent tp:update + window.__TP_STATE__',
    outputs: 'Gráficos Recharts responsivos y diagramas interactivos',
  },
];

const EDGES: ArchEdge[] = [
  { from: 'data', to: 'elder', label: 'Velas T/W/X' },
  { from: 'data', to: 'smc', label: 'Velas Ola (W)' },
  { from: 'elder', to: 'options', label: 'Marea + Ola' },
  { from: 'smc', to: 'options', label: 'OB / FVG / Sweep' },
  { from: 'options', to: 'scanner', label: 'Setups + Veredicto' },
  { from: 'options', to: 'react', label: 'Evento tp:update' },
];

const QUALITY_WEIGHTS = [
  { name: 'Marea (alta)', puntos: 30, fill: '#3fb950', desc: 'EMA 13 y MACD-H alineados (15 si está en giro)' },
  { name: 'Ola (2/2)', puntos: 30, fill: '#58a6ff', desc: 'Índice de Fuerza EMA 2 + Estocástico 5,3 (15 pts c/u)' },
  { name: 'SMC (4/4)', puntos: 40, fill: '#d29922', desc: 'Estructura, Zona P/D, POI cercano y Barrido (10 pts c/u)' },
  { name: 'Bono C (Barrido)', puntos: 15, fill: '#a371f7', desc: '+10 por barrido de liquidez +5 si estructura acompaña' },
  { name: 'Bono B (En OB/FVG)', puntos: 10, fill: '#79c0ff', desc: '+5 por retroceso a POI +5 si el precio ya está dentro' },
  { name: 'Exceso Apalanc.', puntos: -10, fill: '#f85149', desc: 'Penalización si el apalancamiento supera tu máximo' },
];

function edgePath(a: ArchNode, b: ArchNode): string {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export const ArchitectureSection: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>('options');
  const [viewMode, setViewMode] = useState<'flow' | 'weights'>('flow');
  const [pulseIndex, setPulseIndex] = useState<number | null>(null);
  const [snap, setSnap] = useState<AnalysisSnapshot | null>(() =>
    typeof window !== 'undefined' && window.__TP_STATE__ ? window.__TP_STATE__ : null
  );

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const custom = e as CustomEvent<AnalysisSnapshot>;
      if (custom.detail) setSnap(custom.detail);
      else if (window.__TP_STATE__) setSnap({ ...window.__TP_STATE__ });
    };
    window.addEventListener('tp:update', onUpdate);
    return () => window.removeEventListener('tp:update', onUpdate);
  }, []);

  useEffect(() => {
    if (pulseIndex === null) return;
    const timer = window.setTimeout(() => {
      if (pulseIndex >= NODES.length - 1) {
        setPulseIndex(null);
      } else {
        const next = pulseIndex + 1;
        setPulseIndex(next);
        setSelectedId(NODES[next].id);
      }
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [pulseIndex]);

  const activeNode = useMemo(
    () => NODES.find((n) => n.id === selectedId) ?? NODES[0],
    [selectedId]
  );

  const liveStatsForNode = useMemo(() => {
    if (!snap) return [];
    switch (activeNode.id) {
      case 'data':
        return [
          { k: 'Activo configurado', v: snap.sym.toUpperCase() },
          { k: 'Temporalidades', v: snap.tfs.join(' / ') },
          { k: 'Origen activo', v: snap.demo ? 'Datos demo sintéticos' : 'OKX Swaps USDT' },
          { k: 'Capital · Riesgo', v: `${snap.capital} USDT · ${snap.riskPct}%` },
        ];
      case 'elder':
        return [
          { k: 'Marea actual', v: snap.tide || 'Sin analizar aún' },
          { k: 'Sesgo', v: snap.verdict ? (snap.bias === 'long' ? 'Alcista (Largo)' : 'Bajista (Corto)') : '—' },
          { k: 'Veredicto', v: snap.verdict || 'Pulsa «Analizar» para evaluar' },
        ];
      case 'smc':
        return [
          { k: 'Objetivo estructural', v: snap.structR != null ? `${snap.structR.toFixed(1)}R` : 'Sin objetivo ≥1R' },
          { k: 'Riesgo base TP', v: snap.tps.map((t) => `${t.r}R`).join(' · ') },
        ];
      case 'options':
        return [
          { k: 'Opciones detectadas', v: String(snap.opts?.length ?? 0) },
          {
            k: 'Mejor opción',
            v: snap.opts?.length ? `${snap.opts[0].id} · Calidad ${snap.opts[0].quality}/100` : 'Ninguna activa',
          },
        ];
      case 'scanner':
        return [
          { k: 'Canal visual', v: 'Toast UI + Browser Notification API' },
          { k: 'Canal Telegram', v: 'Proxy Express POST /api/telegram/alert' },
        ];
      case 'react':
        return [
          { k: 'Puente de datos', v: 'CustomEvent(tp:update)' },
          { k: 'Motor gráfico', v: 'Recharts 3 · ResponsiveContainer' },
        ];
      default:
        return [];
    }
  }, [activeNode.id, snap]);

  const startPulse = () => {
    setViewMode('flow');
    setPulseIndex(0);
    setSelectedId(NODES[0].id);
  };

  return (
    <div>
      <h2>
        Arquitectura
        <span className="pill bl">Híbrida Canvas + React/Recharts</span>
        <span className="pill up">6 módulos desacoplados</span>
      </h2>
      <div className="sub" style={{ marginBottom: 10 }}>
        Estructura interna de la aplicación, flujo de datos desde OKX hasta los motores Triple
        Pantalla + SMC, generación de opciones, alertas y simulación de rendimiento.
      </div>

      <div
        className="row"
        style={{ justifyContent: 'space-between', marginTop: 0, marginBottom: 10 }}
      >
        <div className="row" style={{ marginTop: 0, gap: 6 }}>
          <button
            type="button"
            className={viewMode === 'flow' ? '' : 'sec'}
            style={{ minHeight: 32, padding: '5px 12px', fontSize: 12 }}
            onClick={() => setViewMode('flow')}
          >
            Diagrama interactivo de flujo
          </button>
          <button
            type="button"
            className={viewMode === 'weights' ? '' : 'sec'}
            style={{ minHeight: 32, padding: '5px 12px', fontSize: 12 }}
            onClick={() => setViewMode('weights')}
          >
            Modelo de pesos (Recharts)
          </button>
        </div>
        <button
          type="button"
          className="sec"
          style={{ minHeight: 32, padding: '5px 12px', fontSize: 12 }}
          onClick={startPulse}
        >
          {pulseIndex !== null ? `Recorriendo paso ${pulseIndex + 1}/6…` : 'Simular flujo de señal'}
        </button>
      </div>

      {viewMode === 'flow' ? (
        <>
          <div className="arch-diagram-wrap">
            <svg
              viewBox="0 0 880 312"
              className="arch-svg"
              role="img"
              aria-label="Diagrama interactivo de arquitectura de la aplicación"
            >
              <defs>
                <marker
                  id="arch-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#58a6ff" />
                </marker>
                <marker
                  id="arch-arrow-dim"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#3b4452" />
                </marker>
              </defs>

              {/* Layer column headers */}
              <text x="111" y="18" textAnchor="middle" fill="#8b949e" fontSize="11" fontWeight="600">
                1. CAPA DE DATOS
              </text>
              <text x="448" y="18" textAnchor="middle" fill="#8b949e" fontSize="11" fontWeight="600">
                2. MOTORES DE ANÁLISIS Y DECISIÓN
              </text>
              <text x="777" y="18" textAnchor="middle" fill="#8b949e" fontSize="11" fontWeight="600">
                3. SALIDAS Y ANALÍTICA
              </text>

              {/* Edges */}
              {EDGES.map((edge) => {
                const a = NODES.find((n) => n.id === edge.from)!;
                const b = NODES.find((n) => n.id === edge.to)!;
                const highlighted = a.id === selectedId || b.id === selectedId;
                const d = edgePath(a, b);
                const mx = (a.x + a.w + b.x) / 2;
                const my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
                return (
                  <g key={`${edge.from}-${edge.to}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={highlighted ? '#58a6ff' : '#2f3846'}
                      strokeWidth={highlighted ? 2.2 : 1.5}
                      className={highlighted ? 'arch-flow-active' : ''}
                      markerEnd={highlighted ? 'url(#arch-arrow)' : 'url(#arch-arrow-dim)'}
                    />
                    <rect
                      x={mx - 42}
                      y={my - 9}
                      width="84"
                      height="16"
                      rx="4"
                      fill="#0d1117"
                      stroke={highlighted ? '#58a6ff' : '#232a33'}
                      strokeWidth="0.8"
                    />
                    <text
                      x={mx}
                      y={my + 2}
                      textAnchor="middle"
                      fill={highlighted ? '#e6edf3' : '#8b949e'}
                      fontSize="9.5"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {NODES.map((node, idx) => {
                const isSelected = node.id === selectedId;
                const isPulsing = pulseIndex === idx;
                return (
                  <g
                    key={node.id}
                    className="arch-node"
                    onClick={() => {
                      setPulseIndex(null);
                      setSelectedId(node.id);
                    }}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={node.w}
                      height={node.h}
                      rx="9"
                      fill={isSelected ? '#1c2430' : '#161b22'}
                      stroke={isSelected || isPulsing ? node.color : '#2a313c'}
                      strokeWidth={isSelected || isPulsing ? 2.2 : 1.2}
                    />
                    <rect
                      x={node.x}
                      y={node.y}
                      width="5"
                      height={node.h}
                      rx="3"
                      fill={node.color}
                    />
                    <text
                      x={node.x + 14}
                      y={node.y + 20}
                      fill={node.color}
                      fontSize="10"
                      fontWeight="700"
                    >
                      {node.step} · {node.layer.toUpperCase()}
                    </text>
                    <text
                      x={node.x + 14}
                      y={node.y + 40}
                      fill="#e6edf3"
                      fontSize="12.5"
                      fontWeight="700"
                    >
                      {node.title}
                    </text>
                    <text x={node.x + 14} y={node.y + 58} fill="#8b949e" fontSize="10.5">
                      {node.subtitle}
                    </text>
                    <text x={node.x + 14} y={node.y + 74} fill="#58a6ff" fontSize="9.5">
                      {isSelected ? '● Seleccionado' : 'Clic para inspeccionar'}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="arch-inspector">
            <div className="arch-inspector-col">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="pill" style={{ color: activeNode.color }}>
                  Módulo {activeNode.step}
                </span>
                <b style={{ fontSize: 15 }}>{activeNode.title}</b>
                <span className="pill">{activeNode.layer}</span>
              </div>
              <p className="arch-p">{activeNode.summary}</p>
              <ul className="arch-ul">
                {activeNode.details.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="arch-inspector-col">
              <div className="kv">
                <span className="mut">Entradas</span>
                <span style={{ textAlign: 'right' }}>{activeNode.inputs}</span>
              </div>
              <div className="kv">
                <span className="mut">Salidas</span>
                <span style={{ textAlign: 'right' }}>{activeNode.outputs}</span>
              </div>
              <div className="kv">
                <span className="mut">Implementación</span>
                <span className="bl" style={{ textAlign: 'right' }}>
                  {activeNode.files.join(', ')}
                </span>
              </div>
              {liveStatsForNode.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #232a33' }}>
                  <div className="mut" style={{ fontSize: 11, marginBottom: 4 }}>
                    ESTADO EN VIVO DEL MÓDULO
                  </div>
                  {liveStatsForNode.map((st) => (
                    <div className="kv" key={st.k}>
                      <span className="mut">{st.k}</span>
                      <span>{st.v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="arch-weights-grid">
          <div className="perf-chart-box" style={{ padding: '12px 10px 6px' }}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={QUALITY_WEIGHTS}
                layout="vertical"
                margin={{ top: 6, right: 20, left: 10, bottom: 4 }}
              >
                <CartesianGrid stroke="#1d242d" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-15, 45]}
                  stroke="#8b949e"
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={122}
                  stroke="#8b949e"
                  tick={{ fill: '#e6edf3', fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(88, 166, 255, 0.08)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload as (typeof QUALITY_WEIGHTS)[number];
                    return (
                      <div className="perf-tooltip">
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {d.name}{' '}
                          <span className={`pill ${d.puntos >= 0 ? 'up' : 'dn'}`}>
                            {d.puntos >= 0 ? `+${d.puntos}` : d.puntos} pts
                          </span>
                        </div>
                        <div className="mut">{d.desc}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="puntos" radius={[0, 4, 4, 0]}>
                  {QUALITY_WEIGHTS.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="arch-explain-box">
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Cómo colaboran las capas</h3>
            <p className="arch-p">
              La aplicación sigue una arquitectura <b>desacoplada orientada a eventos</b>. El núcleo
              matemático y los tres gráficos de velas en HTML5 Canvas operan en <code>index.html</code>{' '}
              con latencia cero, mientras que los módulos analíticos avanzados corren en{' '}
              <b>React 19 + Recharts</b>.
            </p>
            <div className="kv">
              <span className="mut">1. Núcleo cuantitativo</span>
              <span>Cálculo síncrono de indicadores y SMC</span>
            </div>
            <div className="kv">
              <span className="mut">2. Bus de eventos</span>
              <span className="bl">CustomEvent(&apos;tp:update&apos;)</span>
            </div>
            <div className="kv">
              <span className="mut">3. Analítica Recharts</span>
              <span>Simulación 40% y pesos de calidad</span>
            </div>
            <div className="kv">
              <span className="mut">4. Sistema de alertas</span>
              <span>Toast UI + Navegador + Telegram Bot</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
