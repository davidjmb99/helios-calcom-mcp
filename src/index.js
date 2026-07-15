const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const CALCOM_BASE_URL = process.env.CALCOM_BASE_URL || 'https://api.cal.com';
const CALCOM_API_KEY = process.env.CALCOM_API_KEY;
const CALCOM_EVENT_TYPE_ID = process.env.CALCOM_EVENT_TYPE_ID || '4494139';
const CALCOM_TIMEZONE = process.env.CALCOM_TIMEZONE || 'Europe/Madrid';
const CALCOM_MCP_TOKEN = process.env.CALCOM_MCP_TOKEN;

function normalizeCalcomBaseUrl(value) {
  return String(value || "https://api.cal.com")
    .replace(/\/+$/, "")
    .replace(/\/v2$/, "");
}

const calcomApi = axios.create({
  baseURL: normalizeCalcomBaseUrl(CALCOM_BASE_URL),
  headers: {
    'Authorization': `Bearer ${CALCOM_API_KEY}`,
    'cal-api-version': '2024-09-04',
    'Content-Type': 'application/json'
  }
});

// Middleware for authorization
const requireMcpAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== CALCOM_MCP_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Helper for safe error handling
function handleCalcomError(error, actionMessage, debugInfo) {
  const errRes = {
    ok: false,
    error_type: "calcom_api_error",
    status: error.response?.status || 500,
    message: actionMessage,
    calcom_hint: error.response?.data?.message || "Ocurrió un error inesperado al contactar Cal.com"
  };
  if (debugInfo) {
    errRes.debug = debugInfo;
  }
  return errRes;
}

// Tool handlers
async function getAvailableSlots(args, debugInfo) {
  try {
    const dateFrom = args.date_from || args.dateFrom || args.start_date || args.startDate;
    const dateTo = args.date_to || args.dateTo || args.end_date || args.endDate;
    const timeZone = args.timezone || args.timeZone || CALCOM_TIMEZONE;
    const rawEventTypeId = args.event_type_id || args.eventTypeId || args.event_type || args.eventType || CALCOM_EVENT_TYPE_ID;

    if (!dateFrom || !dateTo) {
      return { 
        ok: false, 
        error_type: "missing_required_fields",
        missing_fields: ["date_from", "date_to"],
        debug: debugInfo
      };
    }

    const eventTypeIdNumber = Number(rawEventTypeId);
    if (isNaN(eventTypeIdNumber)) {
      return {
        ok: false,
        error_type: "invalid_event_type_id",
        message: "event_type_id must be a valid number"
      };
    }

    const base = normalizeCalcomBaseUrl(CALCOM_BASE_URL);
    const url = new URL(`${base}/v2/slots`);
    url.searchParams.set("eventTypeId", String(eventTypeIdNumber));
    url.searchParams.set("start", dateFrom);
    url.searchParams.set("end", dateTo);
    url.searchParams.set("timeZone", timeZone);
    url.searchParams.set("format", "range");

    const slotsDebugInfo = {
      endpoint: "/v2/slots",
      final_url_without_secret: url.toString(),
      eventTypeId: eventTypeIdNumber,
      start: dateFrom,
      end: dateTo,
      timeZone,
      format: "range",
      calApiVersion: "2024-09-04",
      calcomBaseUrlNormalized: base
    };

    try {
      const response = await axios.get(url.toString(), {
        headers: {
          "Authorization": `Bearer ${CALCOM_API_KEY}`,
          "cal-api-version": "2024-09-04"
        }
      });

      const data = response.data || {};
      const slots = [];
      for (const daySlots of Object.values(data.data || {})) {
        if (Array.isArray(daySlots)) {
          for (const slot of daySlots) {
            slots.push({
              start_time: slot.start,
              end_time: slot.end,
              timezone: timeZone
            });
          }
        }
      }

      return { ok: true, slots, raw_count: slots.length };

    } catch (apiError) {
      return handleCalcomError(apiError, 'Error al obtener disponibilidad', slotsDebugInfo);
    }
  } catch (error) {
    return { ok: false, error: 'Internal Error in getAvailableSlots' };
  }
}

async function createBooking(args) {
  try {
    const eventTypeId = args.event_type_id || args.eventTypeId || args.event_type || args.eventType || CALCOM_EVENT_TYPE_ID;
    const startTime = args.start_time || args.startTime;
    const timezone = args.timezone || args.timeZone || CALCOM_TIMEZONE;
    
    const patientFirstName = args.patient_first_name || args.patientFirstName;
    const patientLastName = args.patient_last_name || args.patientLastName;
    const patientEmail = args.patient_email || args.patientEmail;
    const patientPhone = args.patient_phone || args.patientPhone;
    const notes = args.notes;

    const missing_fields = [];
    if (!startTime) missing_fields.push('start_time');
    if (!patientFirstName) missing_fields.push('patient_first_name');
    if (!patientLastName) missing_fields.push('patient_last_name');
    if (!patientEmail) missing_fields.push('patient_email');
    if (!patientPhone) missing_fields.push('patient_phone');

    if (missing_fields.length > 0) {
      return {
        ok: false,
        error_type: "missing_required_fields",
        missing_fields
      };
    }

    const response = await calcomApi.post('/v2/bookings', {
      eventTypeId: parseInt(eventTypeId, 10),
      start: startTime,
      attendee: {
        name: `${patientFirstName} ${patientLastName}`,
        email: patientEmail,
        phoneNumber: patientPhone,
        timeZone: timezone
      },
      metadata: {
        notes
      }
    });

    return { ok: true, booking: response.data };
  } catch (error) {
    return handleCalcomError(error, 'Error al crear la cita');
  }
}

async function rescheduleBooking(args) {
  try {
    const bookingId = args.booking_id || args.bookingId;
    const newStartTime = args.new_start_time || args.newStartTime || args.start_time || args.startTime;
    
    if (!bookingId || !newStartTime) {
       return { ok: false, error: 'booking_id and new_start_time are required' };
    }

    const response = await calcomApi.post(`/v2/bookings/${bookingId}/reschedule`, {
      start: newStartTime,
      reschedulingReason: "Rescheduled via API"
    });

    return { ok: true, booking: response.data };
  } catch (error) {
    return handleCalcomError(error, 'Error al reprogramar la cita');
  }
}

async function cancelBooking(args) {
  try {
    const bookingId = args.booking_id || args.bookingId;
    const reason = args.reason || "Cancelled via API";

    if (!bookingId) {
       return { ok: false, error: 'booking_id is required' };
    }

    const response = await calcomApi.post(`/v2/bookings/${bookingId}/cancel`, {
      cancellationReason: reason
    });

    return { ok: true, result: response.data };
  } catch (error) {
    return handleCalcomError(error, 'Error al cancelar la cita');
  }
}

app.get('/debug/calcom-slots-test', requireMcpAuth, async (req, res) => {
  try {
    const base = normalizeCalcomBaseUrl(CALCOM_BASE_URL);
    const url = new URL(`${base}/v2/slots`);
    url.searchParams.set("eventTypeId", "4494139");
    url.searchParams.set("start", "2026-07-16");
    url.searchParams.set("end", "2026-07-20");
    url.searchParams.set("timeZone", "Europe/Madrid");
    url.searchParams.set("format", "range");

    const response = await axios.get(url.toString(), {
      headers: {
        "Authorization": `Bearer ${CALCOM_API_KEY}`,
        "cal-api-version": "2024-09-04"
      }
    });

    const data = response.data || {};
    const slots = [];
    for (const daySlots of Object.values(data.data || {})) {
      if (Array.isArray(daySlots)) {
        for (const slot of daySlots) {
          slots.push({
            start_time: slot.start,
            end_time: slot.end,
            timezone: "Europe/Madrid"
          });
        }
      }
    }

    res.json({
      status: response.status,
      final_url_without_secret: url.toString(),
      raw_count: slots.length,
      sample_slots: slots.slice(0, 3)
    });
  } catch (error) {
    res.status(500).json(handleCalcomError(error, 'Error en test aislado', {
      final_url_without_secret: "https://api.cal.com/v2/slots?..."
    }));
  }
});

app.post('/mcp', requireMcpAuth, async (req, res) => {
  const body = req.body || {};
  const tool = body.tool || body.name || body.method || body.params?.name || body.params?.tool;

  const args =
    body.arguments ||
    body.args ||
    body.input ||
    body.params?.arguments ||
    body.params?.args ||
    body.params?.input ||
    body.params ||
    body;

  if (!tool) {
    return res.status(400).json({ ok: false, error: 'Missing tool name in body' });
  }

  const dateFrom = args.date_from || args.dateFrom || args.start_date || args.startDate;
  const dateTo = args.date_to || args.dateTo || args.end_date || args.endDate;
  const eventTypeId = args.event_type_id || args.eventTypeId || args.event_type || args.eventType || CALCOM_EVENT_TYPE_ID;

  const debugInfo = {
    tool,
    body_keys: Object.keys(body),
    arg_keys: Object.keys(args || {}),
    has_date_from: Boolean(dateFrom),
    has_date_to: Boolean(dateTo),
    has_event_type_id: Boolean(eventTypeId)
  };

  console.log("[mcp_request]", debugInfo);

  let result;
  switch (tool) {
    case 'get_available_slots':
      result = await getAvailableSlots(args, debugInfo);
      break;
    case 'create_booking':
      result = await createBooking(args);
      break;
    case 'reschedule_booking':
      result = await rescheduleBooking(args);
      break;
    case 'cancel_booking':
      result = await cancelBooking(args);
      break;
    default:
      return res.status(404).json({ ok: false, error: 'Tool not found' });
  }

  res.json(result);
});

// Error handling middleware to prevent leaking secrets
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 helios-calcom-mcp is running on port ${PORT}`);
});
