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

const calcomApi = axios.create({
  baseURL: CALCOM_BASE_URL,
  headers: {
    'Authorization': `Bearer ${CALCOM_API_KEY}`,
    'cal-api-version': '2024-08-13',
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
function handleCalcomError(error, actionMessage) {
  return {
    ok: false,
    error_type: "calcom_api_error",
    status: error.response?.status || 500,
    message: actionMessage,
    calcom_hint: error.response?.data?.message || "Ocurrió un error inesperado al contactar Cal.com"
  };
}

// Tool handlers
async function getAvailableSlots(args, debugInfo) {
  try {
    const dateFrom = args.date_from || args.dateFrom || args.start_date || args.startDate;
    const dateTo = args.date_to || args.dateTo || args.end_date || args.endDate;
    const timezone = args.timezone || args.timeZone || CALCOM_TIMEZONE;
    const eventTypeId = args.event_type_id || args.eventTypeId || args.event_type || args.eventType || CALCOM_EVENT_TYPE_ID;

    if (!dateFrom || !dateTo) {
      return { 
        ok: false, 
        error_type: "missing_required_fields",
        missing_fields: ["date_from", "date_to"],
        debug: debugInfo
      };
    }

    // Call v2 slots API
    const response = await calcomApi.get('/v2/slots', {
      params: {
        eventTypeId: eventTypeId,
        start: dateFrom,
        end: dateTo,
        timeZone: timezone
      }
    });

    // V2 typically returns an object with a data property containing the slots structure, or sometimes an array.
    // E.g. { status: "success", data: { "2024-08-13": [{time: "..."}] } } 
    // We normalize this to a flat array.
    const responseData = response.data?.data || response.data || {};
    const slots = [];
    
    // Normalize slots (iterate over date keys if it's an object of arrays, or array of objects)
    if (Array.isArray(responseData)) {
        for (const slot of responseData) {
            slots.push({
                start_time: slot.time || slot.startTime || slot.start,
                end_time: slot.endTime || slot.end,
                timezone: timezone
            });
        }
    } else {
        for (const [date, daySlots] of Object.entries(responseData)) {
        if (Array.isArray(daySlots)) {
            for (const slot of daySlots) {
            slots.push({
                start_time: slot.time || slot.startTime || slot.start,
                end_time: slot.endTime || slot.end,
                timezone: timezone
            });
            }
        }
        }
    }

    return { ok: true, slots, raw_count: slots.length };
  } catch (error) {
    return handleCalcomError(error, 'Error al obtener disponibilidad');
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
