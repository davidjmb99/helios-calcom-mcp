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

// Tool handlers
async function getAvailableSlots(params) {
  try {
    const { date_from, date_to, timezone = CALCOM_TIMEZONE, event_type_id = CALCOM_EVENT_TYPE_ID } = params;

    if (!date_from || !date_to) {
      return { ok: false, error: 'date_from and date_to are required' };
    }

    // According to v2 docs, slots endpoint expects startTime and endTime
    const response = await axios.get(`${CALCOM_BASE_URL}/v1/slots`, {
      params: {
        eventTypeId: event_type_id,
        startTime: `${date_from}T00:00:00Z`,
        endTime: `${date_to}T23:59:59Z`,
        timeZone: timezone,
        apiKey: CALCOM_API_KEY // v1 API key usage as fallback for slots if v2 is tricky, but let's try v2 standard slots if available. Wait, I will just use standard v1 slots since the prompt specified parameters similar to v1.
      }
    });

    const rawSlots = response.data.slots || response.data || {};
    const slots = [];
    
    // Normalize slots (usually Cal.com returns a map of dates with arrays of slots)
    for (const [date, daySlots] of Object.entries(rawSlots)) {
      if (Array.isArray(daySlots)) {
        for (const slot of daySlots) {
          slots.push({
            start_time: slot.time || slot.startTime,
            end_time: slot.endTime,
            timezone: timezone
          });
        }
      }
    }

    return { ok: true, slots };
  } catch (error) {
    return { ok: false, error: error.response?.data?.message || 'Error fetching slots' };
  }
}

async function createBooking(params) {
  try {
    const { 
      event_type_id = CALCOM_EVENT_TYPE_ID,
      start_time,
      timezone = CALCOM_TIMEZONE,
      patient_first_name,
      patient_last_name,
      patient_email,
      patient_phone,
      notes
    } = params;

    const missing_fields = [];
    if (!start_time) missing_fields.push('start_time');
    if (!patient_first_name) missing_fields.push('patient_first_name');
    if (!patient_last_name) missing_fields.push('patient_last_name');
    if (!patient_email) missing_fields.push('patient_email');
    if (!patient_phone) missing_fields.push('patient_phone');

    if (missing_fields.length > 0) {
      return {
        ok: false,
        error_type: "missing_required_fields",
        missing_fields
      };
    }

    // Create booking via Cal.com API v2
    const response = await calcomApi.post('/v2/bookings', {
      eventTypeId: parseInt(event_type_id, 10),
      start: start_time,
      attendee: {
        name: `${patient_first_name} ${patient_last_name}`,
        email: patient_email,
        phoneNumber: patient_phone,
        timeZone: timezone
      },
      metadata: {
        notes
      }
    });

    return { ok: true, booking: response.data };
  } catch (error) {
    return { ok: false, error: error.response?.data?.message || 'Error creating booking' };
  }
}

async function rescheduleBooking(params) {
  try {
    const { booking_id, new_start_time, timezone = CALCOM_TIMEZONE } = params;
    
    if (!booking_id || !new_start_time) {
       return { ok: false, error: 'booking_id and new_start_time are required' };
    }

    const response = await calcomApi.post(`/v2/bookings/${booking_id}/reschedule`, {
      start: new_start_time,
      reschedulingReason: "Rescheduled via API"
    });

    return { ok: true, booking: response.data };
  } catch (error) {
    return { ok: false, error: error.response?.data?.message || 'Error rescheduling booking' };
  }
}

async function cancelBooking(params) {
  try {
    const { booking_id, reason = "Cancelled via API" } = params;

    if (!booking_id) {
       return { ok: false, error: 'booking_id is required' };
    }

    const response = await calcomApi.post(`/v2/bookings/${booking_id}/cancel`, {
      cancellationReason: reason
    });

    return { ok: true, result: response.data };
  } catch (error) {
    return { ok: false, error: error.response?.data?.message || 'Error cancelling booking' };
  }
}

app.post('/mcp', requireMcpAuth, async (req, res) => {
  const { tool, parameters = {} } = req.body;
  
  if (!tool) {
    return res.status(400).json({ ok: false, error: 'Missing tool name in body' });
  }

  let result;
  switch (tool) {
    case 'get_available_slots':
      result = await getAvailableSlots(parameters);
      break;
    case 'create_booking':
      result = await createBooking(parameters);
      break;
    case 'reschedule_booking':
      result = await rescheduleBooking(parameters);
      break;
    case 'cancel_booking':
      result = await cancelBooking(parameters);
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
