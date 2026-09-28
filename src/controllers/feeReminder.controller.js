const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const invoiceModel = require('../models/invoice.model');
const guardianModel = require('../models/guardian.model');
const communicationModel = require('../models/communication.model');
const notificationProvider = require('../utils/notification.provider');

const MAX_INVOICES = 100;
const kes = (n) => `KES ${Math.round(Number(n)).toLocaleString('en-KE')}`;

/**
 * SMS fee reminders for accountants. The wording is built server-side from the invoice
 * data — an accountant can trigger a reminder but can't send an arbitrary broadcast.
 * One SMS per guardian, listing every selected child of theirs.
 */
const sendReminders = asyncHandler(async (req, res) => {
  const { invoiceIds } = req.body;
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0 || invoiceIds.length > MAX_INVOICES) {
    throw new ApiError(400, `invoiceIds must be a list of 1 to ${MAX_INVOICES} invoice ids`);
  }
  const schoolId = req.user.school_id;
  const perGuardian = new Map();
  const skipped = [];

  for (const id of [...new Set(invoiceIds)]) {
    const inv = await invoiceModel.getById(schoolId, id);
    if (!inv) continue; // eslint-disable-line no-continue
    const balance = Number(inv.total_amount) - Number(inv.amount_paid || 0);
    const guardians = balance > 0 ? await guardianModel.listByStudent(schoolId, inv.student_id) : [];
    const g = guardians.find((x) => x.is_primary_contact && x.phone) || guardians.find((x) => x.phone);
    if (!g) { skipped.push(inv.student_name); continue; } // eslint-disable-line no-continue
    const entry = perGuardian.get(g.id) || { guardian: g, lines: [] };
    entry.lines.push(`${inv.student_name} ${kes(balance)}`);
    perGuardian.set(g.id, entry);
  }
  if (perGuardian.size === 0) throw new ApiError(400, 'None of the selected invoices has a balance and a guardian phone number');

  const sender = await notificationProvider.forSchool(schoolId);
  await sender.prepare('sms');
  let sent = 0;
  let failed = 0;
  try {
    for (const { guardian, lines } of perGuardian.values()) {
      const body = `Dear ${guardian.full_name.split(' ')[0]}, school fees balance: ${lines.join('; ')}. Please pay via M-Pesa or contact the school accounts office.`;
      const { message, recipients } = await communicationModel.createMessage(schoolId, {
        senderId: req.user.id, channel: 'sms', body, recipients: [{ guardianId: guardian.id }],
      });
      try {
        const result = await sender.send('sms', { to: guardian.phone, body });
        await communicationModel.updateRecipientStatus(schoolId, recipients[0].id, { deliveryStatus: 'delivered', providerMessageId: result.providerMessageId });
        await communicationModel.markMessageStatus(schoolId, message.id, 'sent');
        sent += 1;
      } catch (err) {
        console.error(`Fee reminder to guardian ${guardian.id} failed:`, err.message);
        await communicationModel.updateRecipientStatus(schoolId, recipients[0].id, { deliveryStatus: 'failed', providerMessageId: null });
        await communicationModel.markMessageStatus(schoolId, message.id, 'failed');
        failed += 1;
      }
    }
  } finally {
    sender.close();
  }
  return sendSuccess(res, 201, { sent, failed, skipped }, 'Reminders processed');
});

module.exports = { sendReminders };