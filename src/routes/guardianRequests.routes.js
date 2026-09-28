const express = require('express');
const {
  listAbsenceReports, acknowledgeAbsenceReport, listEnquiries, replyToEnquiry,
  listForwardTargets, forwardEnquiry, unassignEnquiry, summary,
} = require('../controllers/guardianRequests.controller');
const { authenticate, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Staff-side view of what guardians submit through the parent portal.
// Teachers only ever see their own class's absence notices and the enquiries
// forwarded to them — that scoping happens in the controller/model.
router.use(authenticate, restrictTo('school_admin', 'teacher'));

router.get('/summary', summary);
router.get('/absences', listAbsenceReports);
router.patch('/absences/:id/acknowledge', acknowledgeAbsenceReport);
router.get('/enquiries', listEnquiries);
router.post('/enquiries/:id/reply', replyToEnquiry);

// Forwarding is an admin decision.
router.get('/enquiries/:id/forward-targets', restrictTo('school_admin'), listForwardTargets);
router.post('/enquiries/:id/forward', restrictTo('school_admin'), forwardEnquiry);
router.post('/enquiries/:id/unassign', restrictTo('school_admin'), unassignEnquiry);

module.exports = router;
