/**
 * Finance role middleware — attaches req.financeRole based on user's role.
 * SUPER_ADMIN / FINANCE_ADMIN / VIEW_ONLY / STUDENT
 */
const attachFinanceRole = (req, _res, next) => {
  const role = req.user?.role || '';
  if (['ADMIN', 'SUPER_ADMIN'].includes(role)) req.financeRole = 'SUPER_ADMIN';
  else if (['TEACHER_ADMIN', 'SUB_ADMIN'].includes(role)) req.financeRole = 'FINANCE_ADMIN';
  else if (role === 'STUDENT') req.financeRole = 'STUDENT';
  else req.financeRole = 'VIEW_ONLY';
  next();
};

const requireFinanceAdmin = (req, res, next) => {
  if (!['SUPER_ADMIN', 'FINANCE_ADMIN'].includes(req.financeRole)) {
    return res.status(403).json({ success: false, message: 'Finance admin access required' });
  }
  next();
};

module.exports = { attachFinanceRole, requireFinanceAdmin };
