const { withTenantClient } = require('../config/db');

async function createTemplate(schoolId, { name, channel, bodyTemplate }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `INSERT INTO notification_templates (school_id, name, channel, body_template)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [schoolId, name, channel, bodyTemplate]
    );
    return result.rows[0];
  });
}

async function listTemplates(schoolId) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(`SELECT * FROM notification_templates WHERE school_id = $1 ORDER BY name`, [schoolId]);
    return result.rows;
  });
}

/**
 * Renders {{variable}} placeholders in a template body against a plain
 * object of values, e.g. render(template, { student_name: 'Amina', balance: 4500 }).
 */
function renderTemplate(bodyTemplate, values) {
  return bodyTemplate.replace(/{{\s*(\w+)\s*}}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

/**
 * Creates a message + its recipient rows in one transaction. Actual
 * sending happens outside the DB transaction (in the controller, via the
 * notification provider), since network calls shouldn't hold a DB
 * transaction open — this function only persists the "queued" state.
 * `recipients` = [{ guardianId, phone/email resolved by caller }]
 */
async function createMessage(schoolId, { senderId, channel, subject, body, recipients }) {
  return withTenantClient(schoolId, async (client) => {
    const messageResult = await client.query(
      `INSERT INTO messages (school_id, sender_id, channel, subject, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [schoolId, senderId, channel, subject || null, body]
    );
    const message = messageResult.rows[0];

    const recipientRows = [];
    for (const r of recipients) {
      const result = await client.query(
        `INSERT INTO message_recipients (message_id, guardian_id, user_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [message.id, r.guardianId || null, r.userId || null]
      );
      recipientRows.push(result.rows[0]);
    }
    return { message, recipients: recipientRows };
  });
}

async function updateRecipientStatus(schoolId, recipientId, { deliveryStatus, providerMessageId }) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE message_recipients SET delivery_status = $1, provider_message_id = $2 WHERE id = $3 RETURNING *`,
      [deliveryStatus, providerMessageId, recipientId]
    );
    return result.rows[0] || null;
  });
}

async function markMessageStatus(schoolId, messageId, status) {
  return withTenantClient(schoolId, async (client) => {
    const result = await client.query(
      `UPDATE messages SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END
       WHERE id = $2 AND school_id = $3 RETURNING *`,
      [status, messageId, schoolId]
    );
    return result.rows[0] || null;
  });
}

async function getMessageWithRecipients(schoolId, messageId) {
  return withTenantClient(schoolId, async (client) => {
    const messageResult = await client.query(
      `SELECT * FROM messages WHERE id = $1 AND school_id = $2`,
      [messageId, schoolId]
    );
    if (messageResult.rows.length === 0) return null;

    const recipientsResult = await client.query(
      `SELECT mr.*, g.full_name AS guardian_name, g.phone AS guardian_phone, g.email AS guardian_email
       FROM message_recipients mr
       LEFT JOIN guardians g ON g.id = mr.guardian_id
       WHERE mr.message_id = $1`,
      [messageId]
    );
    return { ...messageResult.rows[0], recipients: recipientsResult.rows };
  });
}

module.exports = {
  createTemplate, listTemplates, renderTemplate, createMessage,
  updateRecipientStatus, markMessageStatus, getMessageWithRecipients,
};
