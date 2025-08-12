"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
exports.verifyToken = verifyToken;
exports.authMiddleware = authMiddleware;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}
function verifyToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
}
function authMiddleware(required = true) {
    return (req, res, next) => {
        const auth = req.headers.authorization;
        if (!auth) {
            if (required)
                return res.status(401).json({ error: 'Missing Authorization header' });
            return next();
        }
        const [, token] = auth.split(' ');
        try {
            const payload = verifyToken(token);
            req.user = payload;
            return next();
        }
        catch {
            if (required)
                return res.status(401).json({ error: 'Invalid token' });
            return next();
        }
    };
}
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (req.user.role !== role)
            return res.status(403).json({ error: 'Forbidden' });
        return next();
    };
}
