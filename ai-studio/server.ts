import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

interface TelegramAlertBody {
  symbol?: unknown;
  verdict?: unknown;
  bias?: unknown;
  tide?: unknown;
  timeframes?: unknown;
  price?: unknown;
  entry?: unknown;
  stop?: unknown;
  smcScore?: unknown;
  tps?: unknown;
  isTest?: unknown;
}

// Per-IP sliding window rate limiter and duplicate alert suppression
const ipHits = new Map<string, number[]>();
const lastAlertBySymbol = new Map<string, { bias: string; t: number }>();
const ALERT_COOLDOWN_MS = 30 * 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= 30) {
    ipHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

function sanitizeText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
}

function sanitizeNumOrStr(val: unknown): string {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val >= 1000 ? val.toFixed(2) : val >= 1 ? val.toFixed(4) : val.toPrecision(4);
  }
  if (typeof val === 'string') {
    return val.replace(/[^0-9.,\-+]/g, '').slice(0, 24);
  }
  return '—';
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/telegram/status', (_req: Request, res: Response) => {
    const hasBotToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
    const hasChatId = Boolean(process.env.TELEGRAM_CHAT_ID?.trim());
    res.json({
      configured: hasBotToken && hasChatId,
      hasBotToken,
      hasChatId,
    });
  });

  app.get('/api/telegram/verify', async (req: Request, res: Response) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    if (!botToken || !chatId) {
      res.status(503).json({
        configured: false,
        tokenValid: false,
        chatValid: false,
        error: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en Settings → Secrets.',
      });
      return;
    }

    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({
        configured: true,
        tokenValid: false,
        chatValid: false,
        error: 'Demasiadas verificaciones en un minuto. Espera un momento.',
      });
      return;
    }

    try {
      const meResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
        signal: AbortSignal.timeout(8000),
      });
      const meData = (await meResp.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { username?: string };
      };
      if (!meResp.ok || !meData.ok) {
        res.json({
          configured: true,
          tokenValid: false,
          chatValid: false,
          botUsername: null,
          error: 'TELEGRAM_BOT_TOKEN inválido o revocado en @BotFather.',
        });
        return;
      }

      const chatResp = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      const chatData = (await chatResp.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { type?: string };
      };
      if (!chatResp.ok || !chatData.ok) {
        res.json({
          configured: true,
          tokenValid: true,
          chatValid: false,
          botUsername: meData.result?.username ? sanitizeText(meData.result.username, 40) : null,
          error: chatData.description
            ? `TELEGRAM_CHAT_ID rechazado (${sanitizeText(chatData.description, 100)}). Verifica el ID o envía /start al bot.`
            : 'TELEGRAM_CHAT_ID no válido o el bot no tiene acceso al chat.',
        });
        return;
      }

      res.json({
        configured: true,
        tokenValid: true,
        chatValid: true,
        botUsername: meData.result?.username ? sanitizeText(meData.result.username, 40) : null,
        chatType: chatData.result?.type ? sanitizeText(chatData.result.type, 20) : null,
      });
    } catch {
      res.status(502).json({
        configured: true,
        tokenValid: false,
        chatValid: false,
        error: 'No se pudo conectar con la API de Telegram.',
      });
    }
  });

  app.post('/api/telegram/alert', async (req: Request, res: Response) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

    if (!botToken || !chatId) {
      res.status(503).json({
        ok: false,
        configured: false,
        error: 'Telegram no configurado. Añade TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en Settings → Secrets.',
      });
      return;
    }

    const clientIp = req.ip || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({ ok: false, error: 'Demasiadas alertas en un minuto. Espera un momento.' });
      return;
    }

    const body = (req.body ?? {}) as TelegramAlertBody;
    const symbol = sanitizeText(body.symbol, 24).toUpperCase();
    if (!symbol || !/^[A-Z0-9._-]{1,24}$/.test(symbol)) {
      res.status(400).json({ ok: false, error: 'Símbolo inválido.' });
      return;
    }

    const bias = body.bias === 'short' ? 'short' : body.bias === 'long' ? 'long' : null;
    if (!bias) {
      res.status(400).json({ ok: false, error: 'Dirección (bias) inválida.' });
      return;
    }

    const verdict = sanitizeText(body.verdict, 160);
    if (!verdict) {
      res.status(400).json({ ok: false, error: 'Veredicto requerido.' });
      return;
    }

    const isTest = body.isTest === true;
    const now = Date.now();
    if (!isTest) {
      const prev = lastAlertBySymbol.get(symbol);
      if (prev && prev.bias === bias && now - prev.t < ALERT_COOLDOWN_MS) {
        res.json({ ok: true, deduplicated: true });
        return;
      }
    }

    const tide = sanitizeText(body.tide, 32);
    const tfs = Array.isArray(body.timeframes)
      ? body.timeframes
          .slice(0, 3)
          .map((t) => sanitizeText(t, 12))
          .filter(Boolean)
      : [];
    const smcScore =
      typeof body.smcScore === 'number' && Number.isFinite(body.smcScore)
        ? Math.max(0, Math.min(4, Math.round(body.smcScore)))
        : null;

    const priceStr = sanitizeNumOrStr(body.price);
    const entryStr = sanitizeNumOrStr(body.entry);
    const stopStr = sanitizeNumOrStr(body.stop);
    const tpsStr = Array.isArray(body.tps)
      ? body.tps
          .slice(0, 3)
          .map((tp) => sanitizeNumOrStr(tp))
          .filter((x) => x !== '—')
          .join(' / ')
      : '';

    const dirEmoji = bias === 'long' ? '🟢 COMPRA' : '🔴 VENTA';
    const header = isTest
      ? `[PRUEBA] ${dirEmoji} · ${symbol}`
      : `🚨 ${dirEmoji} · ${symbol}`;

    const lines = [
      header,
      `Veredicto: ${verdict}`,
      tfs.length ? `Temporalidades: ${tfs.join(' / ')}` : '',
      tide ? `Marea: ${tide}` : '',
      smcScore !== null ? `SMC: ${smcScore}/4` : '',
      `Precio: ${priceStr}`,
      `Entrada: ${entryStr}`,
      `Stop: ${stopStr}`,
      tpsStr ? `TPs (1.5R / 2.5R / 3.5R): ${tpsStr}` : '',
    ].filter(Boolean);

    try {
      const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines.join('\n'),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8000),
      });

      const tgData = (await tgResp.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number };
      };

      if (!tgResp.ok || !tgData.ok) {
        res.status(502).json({
          ok: false,
          error: tgData.description
            ? `Telegram rechazó el envío: ${sanitizeText(tgData.description, 120)}`
            : 'Error al enviar mensaje a Telegram.',
        });
        return;
      }

      if (!isTest) lastAlertBySymbol.set(symbol, { bias, t: Date.now() });
      res.json({ ok: true, messageId: tgData.result?.message_id ?? null });
    } catch {
      res.status(502).json({
        ok: false,
        error: 'No se pudo conectar con la API de Telegram.',
      });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
