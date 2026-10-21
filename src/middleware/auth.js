import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { ApiError } from './error.js';

export function signToken(user) {
  return jwt.sign({ id: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

async function userFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(decoded.id);
  } catch {
    return null;
  }
}

// Requires a valid token
export async function protect(req, _res, next) {
  try {
    const user = await userFromRequest(req);
    if (!user) return next(new ApiError(401, 'Please login to continue'));
    if (user.status === 'Inactive') return next(new ApiError(403, 'Your account is inactive. Contact support.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Attaches req.user when a valid token is present, but never blocks the request
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await userFromRequest(req);
    next();
  } catch (err) {
    next(err);
  }
}

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};
