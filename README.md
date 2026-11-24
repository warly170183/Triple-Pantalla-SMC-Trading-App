# Triple Pantalla + SMC · Trading App

App web de un solo archivo que aplica la estrategia **Triple Pantalla** del Dr. Alexander Elder con confluencia **Smart Money Concepts (SMC)**, usando datos de OKX en vivo (swaps perpetuos USDT).

## Uso
Abre `index.html` en el navegador (doble clic) o sírvelo en local:

```
python3 -m http.server 8000
```

Las llamadas a la API pública de OKX requieren ejecutarse en local (no funciona en entornos que bloqueen `fetch` a otros dominios). El botón «Datos demo» permite probarla sin red.

## Qué hace
- **Pantalla 1 (marea):** MACD-histograma + EMA 13, Sistema Impulso.
- **Pantalla 2 (ola):** Fuerza EMA 2 + Estocástico 5,3 contra la marea.
- **Pantalla 3 (entrada):** orden stop sobre la última vela cerrada de ejecución, stop, TP 1,5R/2,5R/3,5R.
- **SMC (sobre la Ola):** BOS/CHoCH, Order Blocks, FVG, EQH/EQL, barridos de liquidez, premium/descuento. Confluencia 0–4.
- **Opciones de Trading:** operaciones A (ruptura), B (retroceso a OB/FVG) y C (barrido de liquidez), ordenadas por calidad, y ranking de la lista de activos.
- Tamaño de posición por riesgo (2 % por defecto), escáner de lista de activos.

Herramienta educativa; no es asesoramiento financiero.

## Versión AI Studio (`ai-studio/`)
Proyecto completo (Vite + React + Express) con panel de activos, alertas de Telegram con anti-spam y la sección **Evaluación** (registro local de opciones y comprobación posterior, índice de efectividad 0–100).
Configura `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` solo como variables de entorno/Secrets; nunca en el código.
