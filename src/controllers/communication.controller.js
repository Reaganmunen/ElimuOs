const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const communicationModel = require('../models/communication.model');
const guardianModel = require('../models/guardian.model');
const notificationProvider = require('../utils/notification.provider');

const createTemplate = asyncHandler(async (req, res) => {
  const { name, channel, bodyTemplate } = req.body;
  if (!name || !channel || !bodyTemplate) throw new ApiError(400, 'name, channel and bodyTemplate are required');
  const template = await communicationModel.createTemplate(req.user.school_id, { name, channel, bodyTemplate });
  return sendSuccess(res, 201, template, 'Template created');
});

const listTemplates = asyncHandler(async (req, res) => {
  const templates = await communicationModel.listTemplates(req.user.school_id);
  return sendSuccess(res, 200, templates);
});

/**
 * Sends a message to either an explicit list of guardianIds or every
 * guardian of a class. Persists the message + recipient rows first (so
 * there's a durable record even if the provider call fails), then attempts
 * delivery per recipient and updates each recipient's status individually —
 * one bad phone number shouldn't fail the whole broadcast.
 */
const sendBroadcast = asyncHandler(async (req, res) => {
  const { channel, subject, body, classId, guardianIds } = req.body;
  if (!channel || !body) throw new ApiError(400, 'channel and body are required');
  if (!['sms', 'email'].includes(channel)) throw new ApiError(400, 'channel must be "sms" or "email"');
  if (!classId && (!Array.isArray(guardianIds) || guardianIds.length === 0)) {
    throw new ApiError(400, 'Provide either classId or a non-empty guardianIds array');
  }

  let guardians;
  if (classId) {
    guardians = await guardianModel.listByClass(req.user.school_id, classId);
  } else {
    guardians = await Promise.all(guardianIds.map((id) => guardianModel.findById(req.user.school_id, id)));
    guardians = guardians.filter(Boolean);
  }
  if (guardians.length === 0) {
    throw new ApiError(400, 'No guardians found for the given class/guardianIds');
  }

  // Resolve THIS school's own sender (shared account + its sender identity, or its own
  // accounts) and validate it BEFORE saving anything, so a misconfigured school gets a
  // clear error instead of a saved-but-undeliverable message.
  const sender = await notificationProvider.forSchool(req.user.school_id);
  await sender.prepare(channel);

  const { message, recipients } = await communicationModel.createMessage(req.user.school_id, {
    senderId: req.user.id,
    channel,
    subject,
    body,
    recipients: guardians.map((g) => ({ guardianId: g.id })),
  });

  let anySucceeded = false;
  for (let i = 0; i < guardians.length; i += 1) {
    const guardian = guardians[i];
    const recipientRow = recipients[i];
    const destination = channel === 'email' ? guardian.email : guardian.phone;
    if (!destination) {
      await communicationModel.updateRecipientStatus(req.user.school_id, recipientRow.id, { deliveryStatus: 'failed', providerMessageId: null });
      continue; // eslint-disable-line no-continue
    }
    try {
      const result = await sender.send(channel, { to: destination, subject, body });
      await communicationModel.updateRecipientStatus(req.user.school_id, recipientRow.id, {
        deliveryStatus: 'delivered', providerMessageId: result.providerMessageId,
      });
      anySucceeded = true;
    } catch (err) {
      console.error(`Failed to send ${channel} to guardian ${guardian.id}:`, err.message);
      await communicationModel.updateRecipientStatus(req.user.school_id, recipientRow.id, { deliveryStatus: 'failed', providerMessageId: null });
    }
  }

  sender.close();
  await communicationModel.markMessageStatus(req.user.school_id, message.id, anySucceeded ? 'sent' : 'failed');
  const finalMessage = await communicationModel.getMessageWithRecipients(req.user.school_id, message.id);

  return sendSuccess(res, 201, finalMessage, 'Broadcast processed');
});

const getMessage = asyncHandler(async (req, res) => {
  const message = await communicationModel.getMessageWithRecipients(req.user.school_id, req.params.id);
  if (!message) throw new ApiError(404, 'Message not found');
  return sendSuccess(res, 200, message);
});

module.exports = { createTemplate, listTemplates, sendBroadcast, getMessage };