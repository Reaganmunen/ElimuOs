const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const feeStructureModel = require('../models/feeStructure.model');
const invoiceModel = require('../models/invoice.model');
const paymentModel = require('../models/payment.model');

// -- Fee structures --

const createFeeStructure = asyncHandler(async (req, res) => {
  const { gradeId, termId, itemName, amount, isMandatory } = req.body;
  if (!gradeId || !termId || !itemName || amount == null) {
    throw new ApiError(400, 'gradeId, termId, itemName and amount are required');
  }
  const fee = await feeStructureModel.create(req.user.school_id, { gradeId, termId, itemName, amount, isMandatory }, req.user.id);
  return sendSuccess(res, 201, fee, 'Fee structure created');
});

const listFeeStructures = asyncHandler(async (req, res) => {
  const { gradeId, termId } = req.query;
  if (!gradeId || !termId) throw new ApiError(400, 'gradeId and termId query params are required');
  const fees = await feeStructureModel.listByGradeAndTerm(req.user.school_id, gradeId, termId);
  return sendSuccess(res, 200, fees);
});

const updateFeeStructure = asyncHandler(async (req, res) => {
  const { itemName, amount, isMandatory } = req.body;
  if (itemName === undefined && amount === undefined && isMandatory === undefined) {
    throw new ApiError(400, 'Provide at least one of itemName, amount or isMandatory');
  }
  if (itemName !== undefined && !String(itemName).trim()) throw new ApiError(400, 'itemName cannot be empty');
  if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
    throw new ApiError(400, 'amount must be a number of 0 or more');
  }
  const fee = await feeStructureModel.update(req.user.school_id, req.params.id, {
    itemName: itemName === undefined ? undefined : String(itemName).trim(),
    amount: amount === undefined ? undefined : Number(amount),
    isMandatory,
  }, req.user.id);
  if (!fee) throw new ApiError(404, 'Fee structure not found');
  return sendSuccess(res, 200, fee, 'Fee structure updated');
});

const deleteFeeStructure = asyncHandler(async (req, res) => {
  const result = await feeStructureModel.remove(req.user.school_id, req.params.id, req.user.id);
  if (!result) throw new ApiError(404, 'Fee structure not found');
  return sendSuccess(res, 200, result, 'Fee structure removed');
});

// -- Invoices --

const generateInvoice = asyncHandler(async (req, res) => {
  const { studentId, termId, dueDate } = req.body;
  if (!studentId || !termId) throw new ApiError(400, 'studentId and termId are required');
  try {
    const invoice = await invoiceModel.generateForStudent(req.user.school_id, studentId, termId, dueDate, req.user.id);
    return sendSuccess(res, 201, invoice, 'Invoice generated');
  } catch (err) {
    // Distinguish expected business-rule failures (no fee structure set,
    // duplicate invoice) from real server errors so the client gets a
    // useful 400 instead of a generic 500.
    throw new ApiError(400, err.message);
  }
});

const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceModel.getById(req.user.school_id, req.params.id);
  if (!invoice) throw new ApiError(404, 'Invoice not found');
  return sendSuccess(res, 200, invoice);
});

const listStudentInvoices = asyncHandler(async (req, res) => {
  const invoices = await invoiceModel.listByStudent(req.user.school_id, req.params.studentId);
  return sendSuccess(res, 200, invoices);
});

const listOutstandingInvoices = asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const invoices = await invoiceModel.listOutstanding(req.user.school_id, {
    limit: Number(limit) || 50, offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, invoices);
});

// -- Manual payments (cash/bank/cheque) --

const recordPayment = asyncHandler(async (req, res) => {
  const { invoiceId, studentId, amount, method, referenceNote } = req.body;
  if (!invoiceId || !studentId || !amount || !method) {
    throw new ApiError(400, 'invoiceId, studentId, amount and method are required');
  }
  try {
    const result = await paymentModel.recordManualPayment(req.user.school_id, {
      invoiceId, studentId, amount, method, referenceNote, receivedBy: req.user.id,
    });
    return sendSuccess(res, 201, result, 'Payment recorded');
  } catch (err) {
    throw new ApiError(400, err.message);
  }
});

const listInvoicePayments = asyncHandler(async (req, res) => {
  const payments = await paymentModel.listByInvoice(req.user.school_id, req.params.invoiceId);
  return sendSuccess(res, 200, payments);
});

const listStudentPayments = asyncHandler(async (req, res) => {
  const payments = await paymentModel.listByStudent(req.user.school_id, req.params.studentId);
  return sendSuccess(res, 200, payments);
});

const voidPayment = asyncHandler(async (req, res) => {
  const { invoiceId } = req.body;
  if (!invoiceId) throw new ApiError(400, 'invoiceId is required to recalculate the invoice after voiding');
  const result = await paymentModel.voidPayment(req.user.school_id, req.params.id, invoiceId, req.user.id);
  if (!result) throw new ApiError(404, 'Payment not found');
  return sendSuccess(res, 200, result, 'Payment voided');
});

module.exports = {
  createFeeStructure, listFeeStructures, updateFeeStructure, deleteFeeStructure,
  generateInvoice, getInvoice, listStudentInvoices, listOutstandingInvoices,
  recordPayment, listInvoicePayments, listStudentPayments, voidPayment,
};