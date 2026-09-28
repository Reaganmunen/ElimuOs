const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const adjustmentModel = require('../models/feeAdjustment.model');
const paymentModel = require('../models/payment.model');
const familyModel = require('../models/family.model');
const feeStructureModel = require('../models/feeStructure.model');

// Business-rule failures from the models are thrown as plain Errors; surface them as 400s,
// the same way fee.controller.js does for invoices and payments.
const bad = (err) => { throw new ApiError(400, err.message); };

const applyAdjustment = asyncHandler(async (req, res) => {
  const { kind, amount, reason } = req.body;
  try {
    return sendSuccess(res, 201, await adjustmentModel.apply(req.user.school_id, { invoiceId: req.params.id, kind, amount, reason }, req.user.id), 'Adjustment applied');
  } catch (err) { return bad(err); }
});

const reverseAdjustment = asyncHandler(async (req, res) => {
  try {
    return sendSuccess(res, 200, await adjustmentModel.reverse(req.user.school_id, req.params.id, req.user.id, req.body.reason), 'Adjustment reversed');
  } catch (err) { return bad(err); }
});

const refundInvoice = asyncHandler(async (req, res) => {
  const { amount, method, reason, referenceNote } = req.body;
  try {
    return sendSuccess(res, 201, await paymentModel.recordRefund(req.user.school_id, {
      invoiceId: req.params.id, amount, method, reason, referenceNote, receivedBy: req.user.id,
    }), 'Refund recorded');
  } catch (err) { return bad(err); }
});

const carryArrears = asyncHandler(async (req, res) => {
  const { fromTermId, toTermId, classId, studentId } = req.body;
  try {
    return sendSuccess(res, 200, await adjustmentModel.carryForward(req.user.school_id, { fromTermId, toTermId, classId, studentId }, req.user.id), 'Arrears carried forward');
  } catch (err) { return bad(err); }
});

const listFamilies = asyncHandler(async (req, res) => {
  const { q, owing, siblings } = req.query;
  return sendSuccess(res, 200, await familyModel.listFamilies(req.user.school_id, { q, onlyOwing: owing === '1', siblings: siblings === '1' }));
});

const copyFeeStructures = asyncHandler(async (req, res) => {
  const { fromTermId, toTermId, gradeId } = req.body;
  if (!fromTermId || !toTermId || String(fromTermId) === String(toTermId)) throw new ApiError(400, 'fromTermId and toTermId are required and must differ');
  return sendSuccess(res, 200, await feeStructureModel.copyTerm(req.user.school_id, { fromTermId, toTermId, gradeId }, req.user.id), 'Fee structures copied');
});

module.exports = { applyAdjustment, reverseAdjustment, refundInvoice, carryArrears, listFamilies, copyFeeStructures };