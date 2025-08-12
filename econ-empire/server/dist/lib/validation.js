"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMessageSchema = exports.TariffSubmissionSchema = exports.TariffItemSchema = exports.CreateGameSchema = exports.LoginSchema = void 0;
const zod_1 = require("zod");
exports.LoginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(50),
});
exports.CreateGameSchema = zod_1.z.object({
    totalRounds: zod_1.z.number().int().min(1).max(50).default(5),
    roundDurationSeconds: zod_1.z.number().int().min(60).max(7200).default(900),
});
exports.TariffItemSchema = zod_1.z.object({
    productCode: zod_1.z.string(),
    toCountryCode: zod_1.z.string(),
    ratePercent: zod_1.z.number().int().min(0).max(100),
});
exports.TariffSubmissionSchema = zod_1.z.array(exports.TariffItemSchema).min(1);
exports.ChatMessageSchema = zod_1.z.object({
    content: zod_1.z.string().min(1).max(5000),
    toCountryCode: zod_1.z.string().optional(),
});
