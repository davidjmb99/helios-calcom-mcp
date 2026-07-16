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
    const rawEventTypeId = args.event_type_id || args.eventTypeId || args.event_type || args.eventType || CALCOM_EVENT_TYPE_ID;
    const eventTypeIdNumber = Number(rawEventTypeId);
    
    const startTime = args.start_time || args.startTime || args.start;
    const timezone = args.timezone || args.timeZone || CALCOM_TIMEZONE;
    
    const patientFirstName = args.patient_first_name || args.patientFirstName;
    const patientLastName = args.patient_last_name || args.patientLastName;
    const patientEmail = args.patient_email || args.patientEmail || args.email;
    const patientPhone = args.patient_phone || args.patientPhone || args.phone;
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

    if (isNaN(eventTypeIdNumber)) {
      return {
        ok: false,
        error_type: "invalid_event_type_id",
        message: "event_type_id must be a valid number"
      };
    }

    console.log("[create_booking]", {
      eventTypeId: eventTypeIdNumber,
      start: startTime,
      timezone,
      hasFirstName: Boolean(patientFirstName),
      hasLastName: Boolean(patientLastName),
      hasEmail: Boolean(patientEmail),
      hasPhone: Boolean(patientPhone)
    });

    const base = normalizeCalcomBaseUrl(CALCOM_BASE_URL);
    const url = new URL(`${base}/v2/bookings`);

    const payload = {
      eventTypeId: eventTypeIdNumber,
      start: startTime,
      attendee: {
        name: `${patientFirstName} ${patientLastName}`,
        email: patientEmail,
        timeZone: timezone,
        phoneNumber: patientPhone
      },
      metadata: {
        source: "helios-calcom-mcp",
        notes
      }
    };

    const debugInfo = {
      endpoint: "/v2/bookings",
      eventTypeId: eventTypeIdNumber,
      start: startTime,
      timezone: timezone,
      attendee_email_present: Boolean(patientEmail),
      attendee_phone_present: Boolean(patientPhone),
      calApiVersion: "2024-08-13"
    };

    try {
      const response = await axios.post(url.toString(), payload, {
        headers: {
          "Authorization": `Bearer ${CALCOM_API_KEY}`,
          "cal-api-version": "2024-08-13",
          "Content-Type": "application/json"
        }
      });

      const data = response.data?.data || response.data || {};

      return {
        ok: true,
        booking_id: data.id,
        booking_uid: data.uid,
        status: data.status,
        title: data.title,
        start_time: data.start,
        end_time: data.end,
        duration: data.duration,
        timezone: data.attendees?.[0]?.timeZone || timezone,
        event_type_id: data.eventTypeId,
        event_type_slug: data.eventType?.slug || null,
        attendee_name: data.attendees?.[0]?.name || null,
        attendee_email: data.attendees?.[0]?.email || null,
        attendee_phone: data.attendees?.[0]?.phoneNumber || null,
        location: data.location || data.meetingUrl || null,
        cancel_url: data.cancelUrl || data.cancel_url || null,
        reschedule_url: data.rescheduleUrl || data.reschedule_url || null
      };
    } catch (apiError) {
      return handleCalcomError(apiError, 'Error al crear la cita', debugInfo);
    }
  } catch (error) {
    return { ok: false, error: 'Internal Error in createBooking' };
  }
}

async function rescheduleBooking(args) {
  try {
    const bookingUid = args.booking_uid || args.bookingUid || args.uid || args.booking_id || args.bookingId;
    const newStartTime = args.new_start_time || args.newStartTime || args.start_time || args.startTime || args.start;
    const reason = args.reason || args.rescheduling_reason || args.reschedulingReason || "Reprogramación solicitada";

    if (!bookingUid) {
       return { 
         ok: false, 
         error_type: "missing_required_fields",
         missing_fields: ["booking_uid"]
       };
    }

    if (!newStartTime) {
       return { 
         ok: false, 
         error_type: "missing_required_fields",
         missing_fields: ["new_start_time"]
       };
    }

    console.log("[reschedule_booking]", {
      bookingUidPresent: Boolean(bookingUid),
      newStartTimePresent: Boolean(newStartTime),
      reasonPresent: Boolean(reason)
    });

    const base = normalizeCalcomBaseUrl(CALCOM_BASE_URL);
    const url = new URL(`${base}/v2/bookings/${encodeURIComponent(bookingUid)}/reschedule`);

    const debugInfo = {
      endpoint: "/v2/bookings/{booking_uid}/reschedule",
      booking_uid_present: Boolean(bookingUid),
      new_start_time_present: Boolean(newStartTime),
      reason_present: Boolean(reason),
      calApiVersion: "2024-08-13"
    };

    try {
      const response = await axios.post(url.toString(), {
        start: newStartTime,
        reschedulingReason: reason
      }, {
        headers: {
          "Authorization": `Bearer ${CALCOM_API_KEY}`,
          "cal-api-version": "2024-08-13",
          "Content-Type": "application/json"
        }
      });

      const data = response.data?.data || response.data || {};

      return {
        ok: true,
        booking_id: data.id,
        booking_uid: data.uid,
        status: data.status,
        rescheduled_from_uid: data.rescheduledFromUid || null,
        rescheduling_reason: data.reschedulingReason || null,
        title: data.title || null,
        start_time: data.start || null,
        end_time: data.end || null,
        duration: data.duration || null,
        timezone: data.attendees?.[0]?.timeZone || CALCOM_TIMEZONE || null,
        event_type_id: data.eventTypeId || null,
        event_type_slug: data.eventType?.slug || null,
        attendee_name: data.attendees?.[0]?.name || null,
        attendee_email: data.attendees?.[0]?.email || null,
        attendee_phone: data.attendees?.[0]?.phoneNumber || null,
        location: data.location || data.meetingUrl || null
      };
    } catch (apiError) {
      return handleCalcomError(apiError, 'Error al reprogramar la cita', debugInfo);
    }
  } catch (error) {
    return { ok: false, error: 'Internal Error in rescheduleBooking' };
  }
}

async function cancelBooking(args) {
  try {
    const bookingUid = args.booking_uid || args.bookingUid || args.uid || args.booking_id || args.bookingId;
    const reason = args.reason || args.cancellation_reason || args.cancellationReason || "Cancelación solicitada";

    if (!bookingUid) {
       return { 
         ok: false, 
         error_type: "missing_required_fields",
         missing_fields: ["booking_uid"]
       };
    }

    console.log("[cancel_booking]", {
      bookingUidPresent: Boolean(bookingUid),
      reasonPresent: Boolean(reason)
    });

    const base = normalizeCalcomBaseUrl(CALCOM_BASE_URL);
    const url = new URL(`${base}/v2/bookings/${encodeURIComponent(bookingUid)}/cancel`);

    const debugInfo = {
      endpoint: "/v2/bookings/{booking_uid}/cancel",
      booking_uid_present: Boolean(bookingUid),
      reason_present: Boolean(reason),
      calApiVersion: "2024-08-13"
    };

    try {
      const response = await axios.post(url.toString(), {
        cancellationReason: reason
      }, {
        headers: {
          "Authorization": `Bearer ${CALCOM_API_KEY}`,
          "cal-api-version": "2024-08-13",
          "Content-Type": "application/json"
        }
      });

      const data = response.data?.data || response.data || {};

      return {
        ok: true,
        booking_id: data.id,
        booking_uid: data.uid,
        status: data.status,
        cancellation_reason: data.cancellationReason || null,
        title: data.title || null,
        start_time: data.start || null,
        end_time: data.end || null,
        timezone: data.attendees?.[0]?.timeZone || null,
        event_type_id: data.eventTypeId || null,
        event_type_slug: data.eventType?.slug || null,
        attendee_name: data.attendees?.[0]?.name || null,
        attendee_email: data.attendees?.[0]?.email || null,
        attendee_phone: data.attendees?.[0]?.phoneNumber || null
      };
    } catch (apiError) {
      return handleCalcomError(apiError, 'Error al cancelar la cita', debugInfo);
    }
  } catch (error) {
    return { ok: false, error: 'Internal Error in cancelBooking' };
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
