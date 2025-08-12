import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export interface JwtPayloadShape {
  userId: number;
  username: string;
  role: 'operator' | 'player';
}

export function signToken(payload: JwtPayloadShape): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): JwtPayloadShape {
  return jwt.verify(token, JWT_SECRET) as JwtPayloadShape;
}

export function authMiddleware(required = true) {
  return (req: Request & { user?: JwtPayloadShape }, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization;
    if (!auth) {
      if (required) return res.status(401).json({ error: 'Missing Authorization header' });
      return next();
    }
    const [, token] = auth.split(' ');
    try {
      const payload = verifyToken(token);
      req.user = payload;
      return next();
    } catch {
      if (required) return res.status(401).json({ error: 'Invalid token' });
      return next();
    }
  };
}

export function requireRole(role: 'operator' | 'player') {
  return (req: Request & { user?: JwtPayloadShape }, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
}