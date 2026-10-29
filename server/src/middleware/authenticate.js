const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Sign in to continue.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Your session is invalid or expired. Sign in again.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } });
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'This account is inactive. Contact an administrator.' });
    req.auth = { userId: payload.sub, role: payload.role };
    return next();
  } catch (error) { return next(error); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to access this resource.' });
    }
    return next();
  };
}

module.exports = { authenticate, requireRole };
