# helios-calcom-mcp

MCP wrapper controlado para conectar Cal.com con Hermes/Helios. Este servicio expone de manera segura y limitada un conjunto de herramientas de **Cal.com API v2**:

1. `get_available_slots`
2. `create_booking`
3. `reschedule_booking`
4. `cancel_booking`

## Variables de Entorno

Debes proveer las siguientes variables de entorno para que el servicio funcione:

```env
NODE_ENV=production
PORT=3000
CALCOM_BASE_URL=https://api.cal.com
CALCOM_API_KEY=tu_api_key_de_calcom
CALCOM_EVENT_TYPE_ID=4494139
CALCOM_TIMEZONE=Europe/Madrid
CALCOM_MCP_TOKEN=token_secreto_para_autorizar_peticiones
```

## Ejecución con Docker

```bash
docker build -t helios-calcom-mcp .
docker run -p 3000:3000 --env-file .env helios-calcom-mcp
```

## Endpoints

### `GET /health`
Comprueba el estado del servicio.

**Ejemplo de uso:**
```bash
curl http://localhost:3000/health
```

**Respuesta:**
```json
{
  "ok": true
}
```

### `GET /debug/calcom-slots-test`
Ruta de diagnóstico para verificar que la comunicación con Cal.com funciona de manera directa. Requiere autorización del MCP.

**Ejemplo de uso:**
```bash
curl http://localhost:3000/debug/calcom-slots-test -H "Authorization: Bearer tu_token_secreto_mcp"
```

### `POST /mcp`
Punto de entrada unificado para herramientas MCP. Requiere autorización.

**Ejemplo de uso (get_available_slots):**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer tu_token_secreto_mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_available_slots",
    "arguments": {
      "date_from": "2026-08-01",
      "date_to": "2026-08-07",
      "timezone": "Europe/Madrid",
      "event_type_id": "4494139"
    }
  }'
```

**Respuestas de error por autenticación:**
Si falta el token o es incorrecto:
```json
{
  "error": "Unauthorized"
}
```
*(Status 401)*
